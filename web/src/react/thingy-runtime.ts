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
  // Share-link continuation (contract 4.7): the server seeds context from
  // this token; sharedMessageCount marks how many thread messages came
  // from the shared transcript so the guest lane's client history only
  // carries the guest's OWN turns (the server already has the rest).
  shareToken?: string;
  sharedMessageCount?: number;
  onConversationId?: (id: string) => void;
  onGuestRemaining?: (remaining: number) => void;
  // The history load reports the stored title - deep-history permalinks
  // reload outside the rail's window and would otherwise show "New chat".
  onConversationTitle?: (id: string, title: string) => void;
  onTurnRecorded?: () => void;
}

interface StreamedTurnState {
  activity: string[];
  text: string;
  citations: ThingyCitation[];
  requestId: string;
  receipt?: { duration_ms?: number; total_tokens?: number; tool_steps?: number };
}

function messageText(message: { content: readonly unknown[] }) {
  return message.content
    .map((part) => {
      const p = part as { type?: string; text?: string };
      return p.type === 'text' ? String(p.text || '') : '';
    })
    .join('');
}

export const liveActivityStatus = (() => {
  let value = '';
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next: string) {
      if (next === value) return;
      value = next;
      listeners.forEach((listener) => listener());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }
  };
})();

function assistantParts(state: StreamedTurnState) {
  const parts: Array<Record<string, unknown>> = [];
  if (state.activity.length) {
    parts.push({ type: 'reasoning', text: state.activity.join('\n') });
  }
  parts.push({ type: 'text', text: state.text });
  return parts as never;
}

export function guestHistoryFromMessages(messages: readonly { role: string; content: readonly unknown[] }[]) {
  return messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message) => ({ role: message.role, content: messageText(message) }))
    .filter((entry) => entry.content.trim());
}

// Branch anchor: the turn a user message follows is the nearest preceding
// assistant message in the context assistant-ui hands the adapter - its
// metadata carries the Librarian request_id. Root turns derive ''.
// Exported for tests.
export function deriveParentRequestId(messages: readonly { role: string; metadata?: { custom?: unknown } }[]): string {
  let lastUserIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      lastUserIndex = i;
      break;
    }
  }
  if (lastUserIndex < 0) return '';
  const parentAssistant = [...messages.slice(0, lastUserIndex)]
    .reverse()
    .find((message) => message.role === 'assistant');
  return String(((parentAssistant?.metadata?.custom || {}) as { request_id?: string }).request_id || '');
}

export function createThingyAdapter(binding: ThingyThreadBinding): ChatModelAdapter {
  return {
    async *run({ messages, abortSignal }) {
      const lastUser = [...messages].reverse().find((message) => message.role === 'user');
      const question = lastUser ? messageText(lastUser) : '';
      const parentRequestId = deriveParentRequestId(messages);
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
            ...(binding.shareToken ? { share_token: binding.shareToken } : {}),
            // Guests have no server-side history; their own turns ride
            // along (seeded share messages are excluded - the server
            // rebuilds those from the token).
            ...(binding.guest
              ? { history: guestHistoryFromMessages(messages.slice(binding.sharedMessageCount || 0, -1)) }
              : {})
          }
        });
      } catch (error) {
        // An expired session answers 401: clear it and hand off to sign-in
        // instead of leaving a dead composer (classic-chat behavior).
        if (!binding.guest && isAuthError(error)) {
          session.clearAuth();
          window.location.href = session.signInUrl();
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
      liveActivityStatus.set('Thinking...');
      try {
        while (!readerDone || queue.length) {
          if (!queue.length) {
            await new Promise<void>((resolve) => {
              wake = resolve;
            });
            wake = null;
            continue;
          }
          const { eventName, data } = queue.shift()!;
          if (eventName === 'done') {
            const receipt = (data as { receipt?: { duration_ms?: number; total_tokens?: number; tool_steps?: number } })
              .receipt;
            if (receipt && typeof receipt === 'object') state.receipt = receipt;
          }
          if (eventName === 'meta' || eventName === 'done') {
            state.requestId = data.request_id || state.requestId;
            if (typeof data.guest_remaining === 'number') binding.onGuestRemaining?.(data.guest_remaining);
            if (data.conversation_id && data.conversation_id !== binding.conversationId) {
              binding.conversationId = data.conversation_id;
              binding.onConversationId?.(data.conversation_id);
            }
          } else if (eventName === 'status') {
            const line = String(data.commentary || data.message || '').trim();
            // Every status phrase drives the live "what's happening" line;
            // only tool steps also become durable activity rows.
            if (line) liveActivityStatus.set(String(data.message || line));
            if (data.kind === 'tool' && line) {
              state.activity.push(line);
              yield { content: assistantParts(state) };
            }
          } else if (eventName === 'answer_delta') {
            if (!state.text) liveActivityStatus.set('Writing the answer...');
            state.text += String(data.delta || '');
            yield { content: assistantParts(state) };
          } else if (eventName === 'answer') {
            state.text = String(data.answer || state.text);
            yield { content: assistantParts(state) };
          } else if (eventName === 'citations') {
            state.citations = Array.isArray(data.citations) ? (data.citations as ThingyCitation[]) : [];
          } else if (eventName === 'error') {
            streamErrorMessage = String(data.error || 'Thingy is unavailable.');
            // Guest quota rejections carry guest_remaining: 0 so the
            // composer locks instead of inviting a doomed retry (QA F04).
            if (typeof data.guest_remaining === 'number') binding.onGuestRemaining?.(data.guest_remaining);
          }
        }
        await reading;
      } finally {
        // Success, error, or user stop: the live line must not outlive
        // the run (generator finally runs on .return() too).
        liveActivityStatus.set('');
      }
      if (streamErrorMessage) throw new Error(streamErrorMessage);
      if (readError) throw readError instanceof Error ? readError : new Error('Thingy is unavailable.');
      if (!state.text.trim()) throw new Error('Thingy did not return an answer. Please try again.');

      binding.onTurnRecorded?.();
      yield {
        content: assistantParts(state),
        metadata: {
          custom: { request_id: state.requestId, citations: state.citations, receipt: state.receipt }
        }
      } as never;
    }
  };
}

interface StoredMessage {
  role?: string;
  content?: string;
  request_id?: string;
  parent_request_id?: string;
  created_at?: string;
  citations?: unknown;
  duration_ms?: number;
  total_tokens?: number;
}

// Real tree reconstruction: turns carry parent_request_id (4.3), so a
// user message's parent is the assistant message of the turn it follows,
// and branches survive reload. Rows from pre-branching turns have no
// parent ids and chain linearly, exactly as before. Exported for tests.
export function historyItemsFromStored(stored: StoredMessage[]) {
  const items: Array<{ parentId: string | null; message: ThreadMessageLike }> = [];
  let previousId: string | null = null;
  const seenAssistantIds = new Set<string>();
  const seenUserIds = new Set<string>();
  for (const [index, message] of stored.entries()) {
    const role = message.role === 'assistant' ? 'assistant' : 'user';
    const text = String(message.content || '');
    if (!text.trim()) continue;
    const requestId = String(message.request_id || `row-${index}`);
    const id = role === 'user' ? `u-${requestId}` : `a-${requestId}`;
    const declaredParent = String(message.parent_request_id || '');
    let parentId: string | null;
    if (role === 'user') {
      parentId =
        declaredParent && seenAssistantIds.has(`a-${declaredParent}`)
          ? `a-${declaredParent}`
          : declaredParent
            ? null
            : previousId;
    } else {
      // Public share payloads omit request_id; the synthetic row ids then
      // point at a user id that never existed and aui drops the answer as
      // an orphan. Fall back to adjacency.
      parentId = seenUserIds.has(`u-${requestId}`) ? `u-${requestId}` : previousId;
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
                  // Share payloads omit request_id; the synthetic row id
                  // is for the tree only and must not reach feedback or
                  // parent derivation as if it were real.
                  request_id: message.request_id ? requestId : '',
                  citations: Array.isArray(message.citations) ? message.citations : [],
                  ...(Number(message.duration_ms) > 0
                    ? {
                        receipt: {
                          duration_ms: Number(message.duration_ms),
                          ...(Number(message.total_tokens) > 0 ? { total_tokens: Number(message.total_tokens) } : {})
                        }
                      }
                    : {})
                }
              }
            }
          : {})
      } as ThreadMessageLike
    });
    if (role === 'assistant') seenAssistantIds.add(id);
    if (role === 'user') seenUserIds.add(id);
    previousId = id;
  }
  return items;
}

// Server-side conversations are the canonical record: load maps the stored
// turns into the branch tree; append is a no-op because the Librarian
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
      const stored = Array.isArray(data.messages) ? (data.messages as StoredMessage[]) : [];
      const title = String((data.conversation as { title?: string } | undefined)?.title || '').trim();
      if (title) binding.onConversationTitle?.(binding.conversationId, title);
      return { messages: historyItemsFromStored(stored) as never };
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
