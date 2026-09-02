import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  ActionBarPrimitive,
  AssistantRuntimeProvider,
  BranchPickerPrimitive,
  ComposerPrimitive,
  ErrorPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAui,
  useAuiState,
  useLocalRuntime
} from '@assistant-ui/react';
import { librarianStreamUrl } from '../shared/thingy-config.ts';
import { renderMarkdown } from '../shared/thingy-markdown.ts';
import { createChatMessageActions } from '../shared/thingy-message-actions.ts';
import { createDictationController, speechInputSupported } from '../shared/thingy-voice.ts';
import { postJsonStream, read as readStream } from '../shared/thingy-stream.ts';
import { AGENT_SETUP_TIMEOUT_MS } from '../shared/thingy-timeouts.ts';
import { userLocalContext } from '../shared/thingy-local-context.ts';
import { AccountPanel } from './AccountPanel.tsx';
import { trackEvent } from '../shared/thingy-analytics.ts';
import { iconSvg } from '../shared/thingy-icons.ts';
import { activeDialog, confirmDialog, promptDialog, settleDialog } from '../shared/stores/dialog-store.ts';
import * as session from '../shared/thingy-session.ts';
import {
  createThingyAdapter,
  createThingyFeedbackAdapter,
  createThingyHistoryAdapter,
  type ThingyThreadBinding
} from './thingy-runtime.ts';

const messageActionsService = createChatMessageActions({ track: (name, value) => trackEvent(name, value) });

const DEFAULT_WELCOME = "Hi. I'm Thingy. Ask me what you're curious about and I'll help you explore the archive.";
const GUEST_WELCOME =
  "Hi. I'm Thingy - ask me anything about Jamie Thingelstad's public archive: twenty-five years of blog posts, the Weekly Thing newsletter, and the Another Thing podcast. You can try a few questions as a guest; signing in is free for Weekly Thing readers.";

export interface Chat2Initial {
  prompt: string;
  from: { href: string; name: string } | null;
}

interface ConversationSummary {
  id: string;
  title: string;
  shared_at?: string;
  updated_at?: string;
}

function useSignalValue<T>(signal: { value: T; subscribe: (fn: () => void) => () => void }): T {
  return useSyncExternalStore(
    useCallback((notify) => signal.subscribe(notify), [signal]),
    () => signal.value
  );
}

function Icon({ name }: { name: string }) {
  return <span aria-hidden="true" dangerouslySetInnerHTML={{ __html: iconSvg(name) }} />;
}

// ---------------------------------------------------------------------------
// Message rendering: Thingy's own markdown pipeline (WT citation links,
// photo thumbnails) stays the renderer; assistant-ui supplies the message
// lifecycle around it.

function AssistantText({ text }: { text: string }) {
  const metadata = useAuiState((state) => state.message.metadata);
  const citations = ((metadata?.custom as { citations?: ThingyCitation[] } | undefined)?.citations ||
    []) as ThingyCitation[];
  // renderMarkdown is a cheap pure function; recomputing per streamed frame
  // matches what the Preact renderer did.
  const html = renderMarkdown(text, citations);
  return <div className="librarian-answer-content" dangerouslySetInnerHTML={{ __html: html }} />;
}

function AssistantTextPart(props: { text: string }) {
  return <AssistantText text={props.text} />;
}

function ActivityPart(props: { text: string }) {
  const lines = props.text.split('\n').filter(Boolean);
  if (!lines.length) return null;
  return (
    <details className="librarian-activity thingy-aui-activity">
      <summary>
        Archive work{' '}
        <span className="thingy-aui-activity-count">
          {lines.length} step{lines.length === 1 ? '' : 's'}
        </span>
      </summary>
      <ul>
        {lines.map((line, index) => (
          <li key={index}>{line}</li>
        ))}
      </ul>
    </details>
  );
}

function messageHostOf(event: React.MouseEvent<HTMLButtonElement>) {
  return (event.currentTarget as HTMLElement).closest<HTMLElement>('.librarian-message');
}

function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="librarian-message librarian-message-assistant">
      <MessagePrimitive.Parts components={{ Text: AssistantTextPart, Reasoning: ActivityPart }} />
      <MessagePrimitive.Error>
        <ErrorPrimitive.Root className="thingy-aui-error">
          <ErrorPrimitive.Message />
        </ErrorPrimitive.Root>
      </MessagePrimitive.Error>
      <div className="librarian-feedback">
        <button
          type="button"
          aria-label="Copy answer"
          title="Copy answer"
          onClick={(event) => {
            const host = messageHostOf(event);
            if (host) void messageActionsService.copyAnswerRichText(host);
          }}
        >
          <Icon name="copy" />
        </button>
        <button
          type="button"
          aria-label="Share answer"
          title="Share answer"
          onClick={(event) => {
            const host = messageHostOf(event);
            if (host) void messageActionsService.shareAnswer(host);
          }}
        >
          <Icon name="share" />
        </button>
        <ActionBarPrimitive.Root hideWhenRunning autohide="never" className="thingy-aui-actionbar">
          <ActionBarPrimitive.FeedbackPositive asChild>
            <button type="button" aria-label="Good response" title="Good response">
              <Icon name="thumbs-up" />
            </button>
          </ActionBarPrimitive.FeedbackPositive>
          <ActionBarPrimitive.FeedbackNegative asChild>
            <button type="button" aria-label="Bad response" title="Bad response">
              <Icon name="thumbs-down" />
            </button>
          </ActionBarPrimitive.FeedbackNegative>
          <ActionBarPrimitive.Reload asChild>
            <button type="button" aria-label="Regenerate answer" title="Regenerate answer">
              <Icon name="rotate-ccw" />
            </button>
          </ActionBarPrimitive.Reload>
        </ActionBarPrimitive.Root>
        <BranchPickerFooter />
      </div>
    </MessagePrimitive.Root>
  );
}

function BranchPickerFooter() {
  return (
    <BranchPickerPrimitive.Root hideWhenSingleBranch className="thingy-aui-branchpicker">
      <BranchPickerPrimitive.Previous asChild>
        <button type="button" aria-label="Previous version" title="Previous version">
          <Icon name="chevron-left" />
        </button>
      </BranchPickerPrimitive.Previous>
      <span className="thingy-aui-branch-count">
        <BranchPickerPrimitive.Number /> / <BranchPickerPrimitive.Count />
      </span>
      <BranchPickerPrimitive.Next asChild>
        <button type="button" aria-label="Next version" title="Next version">
          <Icon name="chevron-right" />
        </button>
      </BranchPickerPrimitive.Next>
    </BranchPickerPrimitive.Root>
  );
}

function UserMessage() {
  const promptText = useAuiState((state) =>
    state.message.content.map((part) => ('text' in part ? String(part.text || '') : '')).join('')
  );
  return (
    <MessagePrimitive.Root className="librarian-message librarian-message-user">
      <MessagePrimitive.Parts />
      <div className="librarian-prompt-actions thingy-aui-user-actions">
        <button
          type="button"
          aria-label="Copy prompt"
          title="Copy prompt"
          onClick={() => void messageActionsService.copyPrompt(promptText)}
        >
          <Icon name="copy" />
        </button>
        <button
          type="button"
          aria-label="Share prompt"
          title="Share prompt"
          onClick={() => void messageActionsService.sharePrompt(promptText)}
        >
          <Icon name="share" />
        </button>
        <ActionBarPrimitive.Root hideWhenRunning autohide="never" className="thingy-aui-actionbar">
          <ActionBarPrimitive.Edit asChild>
            <button type="button" aria-label="Edit message" title="Edit and resend">
              <Icon name="pencil" />
            </button>
          </ActionBarPrimitive.Edit>
        </ActionBarPrimitive.Root>
        <BranchPickerFooter />
      </div>
    </MessagePrimitive.Root>
  );
}

function EditComposer() {
  return (
    <ComposerPrimitive.Root className="thingy-aui-edit-composer">
      <ComposerPrimitive.Input className="thingy-aui-edit-input" />
      <div className="thingy-aui-edit-actions">
        <ComposerPrimitive.Cancel asChild>
          <button type="button">Cancel</button>
        </ComposerPrimitive.Cancel>
        <ComposerPrimitive.Send asChild>
          <button type="button" className="primary">
            Send
          </button>
        </ComposerPrimitive.Send>
      </div>
    </ComposerPrimitive.Root>
  );
}

// ---------------------------------------------------------------------------

const MAX_QUESTION_CHARS = 1200;

function Composer({ guest }: { guest: boolean }) {
  const aui = useAui();
  const text = useAuiState((state) => state.composer.text);
  const textRef = useRef('');
  textRef.current = text;
  const [listening, setListening] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState('');
  const dictationRef = useRef<ReturnType<typeof createDictationController> | null>(null);
  const speechSupported = speechInputSupported();
  useEffect(() => {
    if (!speechSupported) return undefined;
    dictationRef.current = createDictationController({
      maxChars: MAX_QUESTION_CHARS,
      getText: () => textRef.current,
      onText: (value) => aui.composer.setText(value),
      onStatus: setVoiceStatus,
      onListeningChange: setListening,
      onTrack: (name, value) => trackEvent(name, value)
    });
    return () => {
      dictationRef.current?.dispose();
      dictationRef.current = null;
    };
    // Dictation owns a SpeechRecognition instance for the composer's life.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="thingy-composer-zone">
      <ComposerPrimitive.Root className="librarian-form librarian-question-form thingy-input composer-box">
        <label htmlFor="librarian-question" className="sr-only">
          Ask Thingy
        </label>
        <ComposerPrimitive.Input
          id="librarian-question"
          className="thingy-aui-input"
          placeholder="Ask Thingy…"
          rows={1}
          maxLength={MAX_QUESTION_CHARS}
          autoFocus
        />
        <div className="thingy-aui-composer-row">
          <span className="thingy-aui-composer-left">
            {speechSupported ? (
              <button
                type="button"
                className={`thingy-aui-mic${listening ? ' is-listening' : ''}`}
                aria-label={listening ? 'Stop voice input' : 'Ask by voice'}
                aria-pressed={listening}
                title={listening ? 'Stop voice input' : 'Ask by voice'}
                onClick={() => (listening ? dictationRef.current?.stop() : dictationRef.current?.start())}
              >
                <Icon name="mic" />
              </button>
            ) : null}
            <span className="thingy-aui-composer-hint" aria-live="polite">
              {voiceStatus || (guest ? 'Guest preview' : '')}
            </span>
          </span>
          <span
            id="librarian-question-count"
            className={`thingy-aui-count${text.length < 1000 ? ' is-quiet' : ''}`}
            aria-hidden="true"
          >
            <span className="composer-count">
              {text.length} / {MAX_QUESTION_CHARS}
            </span>
          </span>
          <ThreadPrimitive.If running={false}>
            <ComposerPrimitive.Send asChild>
              <button type="button" className="composer-send" aria-label="Ask Thingy">
                <Icon name="arrow-up" />
              </button>
            </ComposerPrimitive.Send>
          </ThreadPrimitive.If>
          <ThreadPrimitive.If running>
            <ComposerPrimitive.Cancel asChild>
              <button type="button" className="composer-send thingy-aui-stop" aria-label="Stop answering" title="Stop">
                <Icon name="square" />
              </button>
            </ComposerPrimitive.Cancel>
          </ThreadPrimitive.If>
        </div>
      </ComposerPrimitive.Root>
    </div>
  );
}

function useAgentWelcome(guest: boolean, seeded: boolean) {
  const [welcomeText, setWelcomeText] = useState(guest ? GUEST_WELCOME : DEFAULT_WELCOME);
  useEffect(() => {
    if (guest || seeded) return undefined;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await postJsonStream({
          baseUrl: librarianStreamUrl(),
          path: '/welcome',
          controller,
          timeoutMs: AGENT_SETUP_TIMEOUT_MS,
          abortMessage: 'welcome timeout',
          headers: session.authHeaders(),
          payload: {
            scope: 'all',
            mode: 'thingy',
            client_context: userLocalContext(),
            user_profile: { preferred_name: String(session.storedProfile().preferred_name || '') }
          }
        });
        let text = '';
        await readStream(response, (eventName, data) => {
          if (eventName === 'answer_delta') {
            text += String(data.delta || '');
            setWelcomeText(text || DEFAULT_WELCOME);
          } else if (eventName === 'answer') {
            text = String(data.answer || text);
            setWelcomeText(text || DEFAULT_WELCOME);
          }
        });
        trackEvent('librarian.welcome_success');
      } catch {
        trackEvent('librarian.welcome_error', 'client');
      }
    })();
    return () => controller.abort();
    // One welcome per page load.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return welcomeText;
}

function Thread({ guest, welcome }: { guest: boolean; welcome: string }) {
  return (
    <ThreadPrimitive.Root className="librarian-chat thingy-chat thingy-aui-thread">
      <ThreadPrimitive.Viewport className="thingy-chat-scroll" autoScroll>
        <div className="librarian-messages">
          <ThreadPrimitive.Empty>
            <article className="librarian-message librarian-message-assistant">
              <div className="librarian-answer-content">
                <p>{welcome}</p>
              </div>
            </article>
          </ThreadPrimitive.Empty>
          <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage, EditComposer }} />
        </div>
      </ThreadPrimitive.Viewport>
      <Composer guest={guest} />
    </ThreadPrimitive.Root>
  );
}

// ---------------------------------------------------------------------------
// Dialog host (React port of ThingyDialog, same store + CSS)

function DialogHost() {
  const dialog = useSignalValue(activeDialog);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [value, setValue] = useState('');
  const [renderedId, setRenderedId] = useState(0);
  if (dialog && dialog.id !== renderedId) {
    setRenderedId(dialog.id);
    setValue(dialog.request.kind === 'prompt' ? String(dialog.request.initialValue || '') : '');
  }
  useEffect(() => {
    if (dialog) (inputRef.current || textareaRef.current)?.focus();
    // Focus keys off the dialog id alone.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [dialog?.id]);
  if (!dialog) return null;
  const { request } = dialog;
  const isPrompt = request.kind === 'prompt';
  const settle = (v: boolean | string | null) => settleDialog(v);
  const cancel = () => settle(isPrompt ? null : false);
  return (
    <div className="thingy-dialog-scrim" onClick={cancel}>
      <div className="thingy-dialog" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h2>{request.title}</h2>
        {request.body ? <p className="thingy-dialog-body">{request.body}</p> : null}
        {isPrompt ? (
          <form
            className="thingy-dialog-form"
            onSubmit={(e) => {
              e.preventDefault();
              settle(value);
            }}
          >
            {request.multiline ? (
              <textarea
                ref={textareaRef}
                value={value}
                rows={4}
                maxLength={request.maxLength}
                onInput={(e) => setValue((e.target as HTMLTextAreaElement).value)}
              />
            ) : (
              <input
                ref={inputRef}
                type="text"
                value={value}
                maxLength={request.maxLength}
                onInput={(e) => setValue((e.target as HTMLInputElement).value)}
              />
            )}
          </form>
        ) : null}
        <div className="thingy-dialog-actions">
          {request.hideCancel ? null : (
            <button type="button" className="thingy-dialog-cancel" onClick={cancel}>
              {request.cancelLabel || 'Cancel'}
            </button>
          )}
          <button
            type="button"
            className={`thingy-dialog-confirm${request.danger ? ' danger' : ''}`}
            onClick={() => settle(isPrompt ? value : true)}
          >
            {request.confirmLabel || 'OK'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function ThreadHost({
  binding,
  guest,
  welcome,
  initialPrompt
}: {
  binding: ThingyThreadBinding;
  guest: boolean;
  welcome: string;
  initialPrompt?: string;
}) {
  const adapter = useMemo(() => createThingyAdapter(binding), [binding]);
  const history = useMemo(() => createThingyHistoryAdapter(binding), [binding]);
  const feedback = useMemo(
    () =>
      createThingyFeedbackAdapter(async () => {
        const value = await promptDialog({
          title: 'What went wrong?',
          body: 'Optional, but it helps Jamie tune Thingy.',
          multiline: true,
          maxLength: 1000,
          confirmLabel: 'Send feedback'
        });
        trackEvent('librarian.feedback_submit', 'down');
        return value;
      }),
    []
  );
  // History only for existing server conversations: a brand-new thread has
  // nothing to load, and racing an empty async load against a seeded
  // append trips assistant-ui's message repository.
  const runtime = useLocalRuntime(adapter, {
    adapters: { ...(binding.conversationId && !guest ? { history } : {}), feedback }
  });
  const sentInitialRef = useRef(false);
  useEffect(() => {
    if (!initialPrompt || sentInitialRef.current) return;
    sentInitialRef.current = true;
    // Deferred a tick so the runtime finishes mounting before the seeded
    // prompt (archive links, homepage example chips) starts the run.
    const timer = window.setTimeout(() => {
      runtime.thread.append({ role: 'user', content: [{ type: 'text', text: initialPrompt }] });
    }, 50);
    return () => window.clearTimeout(timer);
    // One-shot on mount.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <Thread guest={guest} welcome={welcome} />
    </AssistantRuntimeProvider>
  );
}

export function Chat2App({ initial }: { initial: Chat2Initial }) {
  const [signedIn] = useState(() => session.sessionActive());
  const guest = !signedIn;
  const [activeId, setActiveId] = useState('');
  // The thread's mount identity. Only explicit navigation (rail click, New
  // chat) may change it: when the FIRST turn of a new thread streams its
  // conversation id back, remounting on that id would wipe the in-flight
  // exchange, so onConversationId updates activeId (rail highlight) only.
  const [mountedId, setMountedId] = useState('');
  const [threadEpoch, setThreadEpoch] = useState(0);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [guestRemaining, setGuestRemaining] = useState<number | null>(null);
  const [mobileRailOpen, setMobileRailOpen] = useState(false);
  const bindingRef = useRef<ThingyThreadBinding | null>(null);

  const conversationKey = mountedId || `new-${threadEpoch}`;
  const binding = useMemo<ThingyThreadBinding>(() => {
    const next: ThingyThreadBinding = {
      conversationId: mountedId,
      guest,
      onConversationId: (id) => {
        setActiveId(id);
        void refreshConversations();
      },
      onGuestRemaining: setGuestRemaining,
      onTurnRecorded: () => void refreshConversations()
    };
    bindingRef.current = next;
    return next;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationKey, guest]);

  const refreshConversations = useCallback(async () => {
    if (guest) return;
    try {
      const data = await session.postJson('/conversations', { action: 'list' }, session.authHeaders());
      const list = Array.isArray(data.conversations) ? data.conversations : [];
      setConversations(
        list.map((entry) => ({
          id: String(entry.conversation_id || entry.id || ''),
          title: String(entry.title || 'Untitled chat'),
          shared_at: String(entry.shared_at || ''),
          updated_at: String(entry.updated_at || '')
        }))
      );
    } catch {
      /* rail stays as-is */
    }
  }, [guest]);

  useEffect(() => {
    if (!guest) void refreshConversations();
    trackEvent('librarian.chat2_visit', guest ? 'guest' : 'reader');
    // Boot effect: runs once per page load by design.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function newConversation() {
    setActiveId('');
    setMountedId('');
    setThreadEpoch((n) => n + 1);
    setMobileRailOpen(false);
  }

  async function deleteConversation(id: string) {
    const ok = await confirmDialog({
      title: 'Delete this conversation?',
      body: 'The conversation and its saved history are removed for good.',
      confirmLabel: 'Delete',
      danger: true
    });
    if (!ok) return;
    await session.postJson('/conversations', { action: 'delete', conversation_id: id }, session.authHeaders());
    if (id === activeId) newConversation();
    void refreshConversations();
  }

  async function renameConversation(id: string, current: string) {
    const title = (
      await promptDialog({
        title: 'Rename conversation',
        initialValue: current,
        maxLength: 120,
        confirmLabel: 'Rename'
      })
    )?.trim();
    if (!title || title === current) return;
    await session.postJson('/conversations', { action: 'rename', conversation_id: id, title }, session.authHeaders());
    void refreshConversations();
  }

  async function shareConversation(id: string, shared: boolean) {
    const confirmed = await confirmDialog(
      shared
        ? {
            title: 'Refresh the share link?',
            body: 'The link stays the same and picks up the latest messages.',
            confirmLabel: 'Refresh link'
          }
        : {
            title: 'Share this conversation?',
            body: 'Anyone with the link can read the entire conversation, including your questions. You can stop sharing at any time.',
            confirmLabel: 'Share'
          }
    );
    if (!confirmed) return;
    const data = await session.postJson(
      '/conversations',
      { action: 'share', conversation_id: id },
      session.authHeaders()
    );
    const url = String((data.share as { url?: string } | undefined)?.url || '');
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      await promptDialog({ title: 'Copy this share link', initialValue: url, confirmLabel: 'Done', hideCancel: true });
    }
    trackEvent('librarian.share_link_create');
    void refreshConversations();
  }

  const welcome = useAgentWelcome(guest, Boolean(initial.prompt));
  const [railCollapsed, setRailCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem('thingyRailCollapsed') === '1';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem('thingyRailCollapsed', railCollapsed ? '1' : '0');
    } catch {
      /* private browsing */
    }
  }, [railCollapsed]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        newConversation();
      }
    }
    function onStorage(event: StorageEvent) {
      if (event.key !== null && event.key !== session.signedInHintKey && event.key !== session.storageKey) return;
      const nowSignedIn = session.sessionActive();
      // Signed out (or in) from another tab: reload into the right mode.
      if (nowSignedIn !== signedIn) window.location.reload();
    }
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('storage', onStorage);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('storage', onStorage);
    };
    // Bound once; newConversation identity is stable enough for a shortcut.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className="thingy-page">
      <h1 className="sr-only">Thingy chat</h1>
      <div
        className={`thingy-app-shell${guest ? ' is-guest' : ''}${mobileRailOpen ? ' is-mobile-rail-open' : ''}${railCollapsed ? ' is-collapsed' : ''}`}
        id="thingy-app-shell"
      >
        {guest ? null : (
          <nav className="rail thingy-aui-rail" aria-label="Conversations">
            <div className="thingy-aui-rail-head">
              <button
                type="button"
                className="thingy-aui-collapse"
                aria-label={railCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                title={railCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                onClick={() => setRailCollapsed(!railCollapsed)}
              >
                <Icon name="panel-left" />
              </button>
              <img className="rail-mark" src="/img/thingy.png" alt="" width="1022" height="1022" />
              <button type="button" className="rail-newchat thingy-aui-newchat" onClick={newConversation}>
                <Icon name="pencil" /> {railCollapsed ? '' : 'New chat'}
              </button>
            </div>
            <div className="rail-body">
              <p className="thingy-aui-rail-label">Recents</p>
              <ul className="thingy-aui-recents">
                {conversations.map((entry) => (
                  <li key={entry.id} className={entry.id === activeId ? 'is-active' : ''}>
                    <button
                      type="button"
                      className="thingy-aui-recent"
                      onClick={() => {
                        setActiveId(entry.id);
                        setMountedId(entry.id);
                        setMobileRailOpen(false);
                      }}
                    >
                      {entry.title}
                      {entry.shared_at ? (
                        <span className="thingy-aui-shared-dot" title="Shared" aria-label="Shared">
                          <Icon name="share" />
                        </span>
                      ) : null}
                    </button>
                    <span className="thingy-aui-recent-actions">
                      <button
                        type="button"
                        title={entry.shared_at ? 'Refresh share link' : 'Share'}
                        aria-label="Share"
                        onClick={() => void shareConversation(entry.id, Boolean(entry.shared_at))}
                      >
                        <Icon name="share" />
                      </button>
                      <button
                        type="button"
                        title="Rename"
                        aria-label="Rename"
                        onClick={() => void renameConversation(entry.id, entry.title)}
                      >
                        <Icon name="pencil" />
                      </button>
                      <button
                        type="button"
                        title="Delete"
                        aria-label="Delete"
                        onClick={() => void deleteConversation(entry.id)}
                      >
                        <Icon name="trash" />
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="thingy-aui-rail-foot">
              <AccountPanel />
            </div>
          </nav>
        )}
        {guest ? null : <div className="rail-scrim" aria-hidden="true" onClick={() => setMobileRailOpen(false)} />}
        <section className="thingy-conversation">
          <div className="mobile-chatbar thingy-aui-header">
            {guest ? null : (
              <button
                type="button"
                className="mobile-chatbar-circle"
                aria-label={mobileRailOpen ? 'Hide conversations' : 'Show conversations'}
                aria-expanded={mobileRailOpen}
                onClick={() => setMobileRailOpen(!mobileRailOpen)}
              >
                <Icon name="panel-left" />
              </button>
            )}
            <div className="mobile-chatbar-title">
              <span>{conversations.find((c) => c.id === activeId)?.title || 'New chat'}</span>
            </div>
            <div className="mobile-chatbar-actions">
              <button
                type="button"
                className="mobile-chatbar-action"
                aria-label="New chat"
                title="New chat"
                onClick={newConversation}
              >
                <Icon name="pencil" />
              </button>
            </div>
          </div>
          {initial.from ? (
            <a className="return-chip" href={initial.from.href} data-tinylytics-event="network.return">
              <Icon name="arrow-left" />
              <span>
                Return to <strong>{initial.from.name}</strong>
              </span>
            </a>
          ) : null}
          {guest ? (
            <aside className="thingy-guest-banner" aria-label="Guest preview">
              <span>
                {guestRemaining === 0
                  ? "You've used today's guest questions."
                  : typeof guestRemaining === 'number'
                    ? `Guest preview — ${guestRemaining} question${guestRemaining === 1 ? '' : 's'} left today.`
                    : 'Guest preview — ask a few questions, no account needed.'}
              </span>
              <a href={session.signInUrl('/chat/')}>Sign in free for more</a>
            </aside>
          ) : null}
          <ThreadHost
            key={conversationKey}
            binding={binding}
            guest={guest}
            welcome={welcome}
            initialPrompt={activeId ? undefined : initial.prompt}
          />
        </section>
      </div>
      <DialogHost />
    </section>
  );
}
