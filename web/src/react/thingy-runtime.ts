// The load-bearing piece of the React chat: a ChatModelAdapter that speaks
// the Librarian's versioned SSE contract (4.x), plus history/feedback
// adapters backed by /conversations and /feedback. assistant-ui owns the
// message lifecycle (streaming, stop, edit, regenerate, branching); this
// module owns the wire. The Vercel AI SDK is deliberately absent - the
// Librarian IS the agent runtime.

import type { ChatModelAdapter, FeedbackAdapter, ThreadHistoryAdapter, ThreadMessageLike } from '@assistant-ui/react';
import { librarianApiUrl, librarianStreamUrl } from '../shared/thingy-config.ts';
import { userLocalContext } from '../shared/thingy-local-context.ts';
import { postJsonStream, read } from '../shared/thingy-stream.ts';
import { AGENT_RESPONSE_TIMEOUT_MS } from '../shared/thingy-timeouts.ts';
import { isAuthError } from '../shared/thingy-url.ts';
import * as session from '../shared/thingy-session.ts';

// Mutable per-page binding shared between the adapter, the history adapter,
// and the app shell (rail refreshes, guest meter, active conversation).
export interface ThingyThreadBinding {
  conversationId: string;
  guest: boolean;
  onConversationId?: (id: string) => void;
  onGuestRemaining?: (remaining: number) => void;
  onTurnRecorded?: () => void;
}

interface StreamedTurnState {
  activity: string[];
  text: string;
  citations: ThingyCitation[];
  requestId: string;
}

function messageText(message: { content: readonly unknown[] }) {
  return message.content
    .map((part) => {
      const p = part as { type?: string; text?: string };
      return p.type === 'text' ? String(p.text || '') : '';
    })
    .join('');
}

function assistantParts(state: StreamedTurnState) {
  const parts: Array<Record<string, unknown>> = [];
  if (state.activity.length) {
    parts.push({ type: 'reasoning', text: state.activity.join('\n') });
  }
  parts.push({ type: 'text', text: state.text });
  return parts as never;
}

function guestHistoryFromMessages(messages: readonly { role: string; content: readonly unknown[] }[]) {
  return messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message) => ({ role: message.role, content: messageText(message) }))
    .filter((entry) => entry.content.trim());
}

export function createThingyAdapter(binding: ThingyThreadBinding): ChatModelAdapter {
  return {
    async *run({ messages, abortSignal }) {
      const lastUser = [...messages].reverse().find((message) => message.role === 'user');
      const question = lastUser ? messageText(lastUser) : '';
      // Branch anchor: the turn this message follows is simply the nearest
      // preceding assistant message in the context assistant-ui hands us -
      // its metadata carries the Librarian request_id. First turns (and
      // guests) send none.
      const lastUserIndex = lastUser ? messages.lastIndexOf(lastUser) : -1;
      const parentAssistant = [...messages.slice(0, Math.max(0, lastUserIndex))]
        .reverse()
        .find((message) => message.role === 'assistant');
      const parentRequestId = String(
        ((parentAssistant?.metadata?.custom || {}) as { request_id?: string }).request_id || ''
      );
      const controller = new AbortController();
      abortSignal.addEventListener('abort', () => controller.abort(), { once: true });

      let response: Response;
      try {
        response = await postJsonStream({
          baseUrl: librarianStreamUrl(),
          path: '/chat',
          controller,
          timeoutMs: AGENT_RESPONSE_TIMEOUT_MS,
          abortMessage: 'Thingy spent too long in the archive. Please try again with a narrower angle.',
          headers: session.authHeaders(),
          payload: {
            message: question,
            scope: 'all',
            mode: 'thingy',
            conversation_id: binding.conversationId || undefined,
            // Always present, even when '': an empty value tells the server
            // this is a root turn (edit of the first message) with no prior
            // context, distinct from a legacy client omitting the field.
            parent_request_id: parentRequestId,
            client_context: userLocalContext(),
            user_profile: {},
            // Guests have no server-side history; the transcript rides along.
            ...(binding.guest ? { history: guestHistoryFromMessages(messages.slice(0, -1)) } : {})
          }
        });
      } catch (error) {
        // An expired session answers 401: clear it and hand off to sign-in
        // instead of leaving a dead composer (classic-chat behavior).
        if (!binding.guest && isAuthError(error)) {
          session.clearAuth();
          window.location.href = session.signInUrl('/chat/');
        }
        throw error;
      }

      const state: StreamedTurnState = { activity: [], text: '', citations: [], requestId: '' };
      const queue: Array<{ eventName: string; data: ThingyStreamData }> = [];
      let readerDone = false;
      let wake: (() => void) | null = null;
      let readError: unknown = null;

      const reading = read(response, (eventName, data) => {
        queue.push({ eventName, data });
        wake?.();
      })
        .catch((error: unknown) => {
          readError = error;
        })
        .finally(() => {
          readerDone = true;
          wake?.();
        });

      let streamErrorMessage = '';
      while (!readerDone || queue.length) {
        if (!queue.length) {
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
          wake = null;
          continue;
        }
        const { eventName, data } = queue.shift()!;
        if (eventName === 'meta' || eventName === 'done') {
          state.requestId = data.request_id || state.requestId;
          if (typeof data.guest_remaining === 'number') binding.onGuestRemaining?.(data.guest_remaining);
          if (data.conversation_id && data.conversation_id !== binding.conversationId) {
            binding.conversationId = data.conversation_id;
            binding.onConversationId?.(data.conversation_id);
          }
        } else if (eventName === 'status') {
          const line = String(data.commentary || data.message || '').trim();
          if (data.kind === 'tool' && line) {
            state.activity.push(line);
            yield { content: assistantParts(state) };
          }
        } else if (eventName === 'answer_delta') {
          state.text += String(data.delta || '');
          yield { content: assistantParts(state) };
        } else if (eventName === 'answer') {
          state.text = String(data.answer || state.text);
          yield { content: assistantParts(state) };
        } else if (eventName === 'citations') {
          state.citations = Array.isArray(data.citations) ? (data.citations as ThingyCitation[]) : [];
        } else if (eventName === 'error') {
          streamErrorMessage = String(data.error || 'Thingy is unavailable.');
        }
      }
      await reading;
      if (streamErrorMessage) throw new Error(streamErrorMessage);
      if (readError) throw readError instanceof Error ? readError : new Error('Thingy is unavailable.');
      if (!state.text.trim()) throw new Error('Thingy did not return an answer. Please try again.');

      binding.onTurnRecorded?.();
      yield {
        content: assistantParts(state),
        metadata: {
          custom: { request_id: state.requestId, citations: state.citations }
        }
      } as never;
    }
  };
}

// Server-side conversations are the canonical record: load maps the stored
// turns into a linear parent chain; append is a no-op because the Librarian
// records every turn itself during /chat.
export function createThingyHistoryAdapter(binding: ThingyThreadBinding): ThreadHistoryAdapter {
  return {
    async load() {
      if (!binding.conversationId || binding.guest) return { messages: [] };
      const data = await session.postJson(
        '/conversations',
        { action: 'get', conversation_id: binding.conversationId },
        session.authHeaders()
      );
      const stored = Array.isArray(data.messages) ? data.messages : [];
      // Real tree reconstruction: turns carry parent_request_id (4.3), so a
      // user message's parent is the assistant message of the turn it
      // follows, and branches survive reload. Rows from pre-branching turns
      // have no parent ids and chain linearly, exactly as before.
      const items: Array<{ parentId: string | null; message: ThreadMessageLike }> = [];
      let previousId: string | null = null;
      const seenAssistantIds = new Set<string>();
      for (const [index, message] of stored.entries()) {
        const role = message.role === 'assistant' ? 'assistant' : 'user';
        const text = String(message.content || '');
        if (!text.trim()) continue;
        const requestId = String(message.request_id || `row-${index}`);
        const id = role === 'user' ? `u-${requestId}` : `a-${requestId}`;
        const declaredParent = String((message as { parent_request_id?: string }).parent_request_id || '');
        let parentId: string | null;
        if (role === 'user') {
          parentId =
            declaredParent && seenAssistantIds.has(`a-${declaredParent}`)
              ? `a-${declaredParent}`
              : declaredParent
                ? null
                : previousId;
        } else {
          parentId = `u-${requestId}`;
        }
        items.push({
          parentId,
          message: {
            id,
            role,
            content: [{ type: 'text', text }],
            createdAt: message.created_at ? new Date(String(message.created_at)) : undefined,
            ...(role === 'assistant'
              ? {
                  status: { type: 'complete', reason: 'stop' },
                  metadata: {
                    custom: {
                      request_id: requestId,
                      citations: Array.isArray(message.citations) ? message.citations : []
                    }
                  }
                }
              : {})
          } as ThreadMessageLike
        });
        if (role === 'assistant') seenAssistantIds.add(id);
        previousId = id;
      }
      return { messages: items as never };
    },
    async append() {
      /* The Librarian records turns server-side during /chat. */
    }
  };
}

export function createThingyFeedbackAdapter(
  onNegative: (requestId: string) => Promise<string | null>
): FeedbackAdapter {
  return {
    submit(feedback) {
      const custom = (feedback.message.metadata?.custom || {}) as { request_id?: string };
      const requestId = String(custom.request_id || '');
      if (!requestId) return;
      void (async () => {
        let comment = '';
        if (feedback.type === 'negative') {
          const value = await onNegative(requestId);
          if (value === null) return;
          comment = value.trim().slice(0, 1000);
        }
        await fetch(`${librarianStreamUrl()}/feedback`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...session.authHeaders() },
          body: JSON.stringify({
            request_id: requestId,
            reaction: feedback.type === 'positive' ? 'up' : 'down',
            comment
          })
        }).catch(() => {});
      })();
    }
  };
}

export function apiBase() {
  return librarianApiUrl();
}
