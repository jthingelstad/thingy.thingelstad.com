import { useEffect, useMemo, useRef, useState } from 'react';
import { AssistantRuntimeProvider, ThreadPrimitive, useAui, useAuiState, useLocalRuntime } from '@assistant-ui/react';
import { promptDialog } from '../../shared/stores/dialog-store.ts';
import { trackEvent } from '../../shared/thingy-analytics.ts';
import {
  createThingyAdapter,
  createThingyFeedbackAdapter,
  createThingyHistoryAdapter,
  historyItemsFromStored,
  type ThingyThreadBinding
} from '../thingy-runtime.ts';
import { AssistantMessage, EditComposer, UserMessage } from './Messages.tsx';
import { Composer } from './Composer.tsx';
import { Icon } from './Icon.tsx';

// Corpus-grounded follow-up chips from the welcome agent (contract 4.4).
// Each suggestion is grounded in retrieved archive passages server-side -
// never a static sampled list. Tapping one sends it as the first message.
// The pool holds up to 6 (4.10); three show at a time as centered
// content-width pills - invitations, not a task list - and the shuffle
// control rotates the rest in.
function SuggestionChips({ suggestions, pending = false }: { suggestions: string[]; pending?: boolean }) {
  const aui = useAui();
  const [offset, setOffset] = useState(0);
  // DETERMINISTIC GEOMETRY (mis-click fix, live QA): one truncated
  // single-line row per chip, so skeletons, shuffled sets, and loaded
  // chips all occupy exactly the same three rows. Pills are content-width
  // but each sits centered on its own row.
  const CHIP =
    'inline-block max-w-full truncate rounded-full border px-4 py-1.5 text-center text-[13.5px] leading-snug';
  if (!suggestions.length) {
    // Skeletons only while a welcome request is actually in flight; a
    // seeded prompt never fetches suggestions (R3-03).
    if (!pending) return null;
    return (
      <div className="flex flex-col items-center gap-2" aria-hidden="true">
        {['w-64', 'w-52', 'w-72'].map((width) => (
          <span key={width} className={`${CHIP} ${width} animate-pulse border-line-soft bg-surface-2 select-none`}>
            &nbsp;
          </span>
        ))}
      </div>
    );
  }
  const visible = [0, 1, 2].map((slot) => suggestions[(offset + slot) % suggestions.length]).filter(Boolean);
  const shuffleable = suggestions.length > 3;
  return (
    <div className="flex flex-col items-center gap-2" aria-label="Suggested questions">
      {visible.map((suggestion, index) => (
        <button
          key={suggestion}
          type="button"
          title={suggestion}
          className={`thingy-aui-suggestion ${CHIP} border-line-soft bg-surface text-ink-soft transition-colors hover:border-accent hover:bg-accent-soft hover:text-ink`}
          onClick={() => {
            trackEvent('librarian.welcome_suggestion', String(index + 1));
            aui.composer.setText(suggestion);
            aui.composer.send();
          }}
        >
          {suggestion}
        </button>
      ))}
      {shuffleable ? (
        <button
          type="button"
          className="thingy-aui-shuffle mt-0.5 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] text-muted transition-colors hover:bg-surface-2 hover:text-ink-soft [&_svg]:size-3.5"
          onClick={() => setOffset((value) => (value + 3) % suggestions.length)}
        >
          <Icon name="rotate-ccw" />
          Different ideas
        </button>
      ) : null}
    </div>
  );
}

function StreamingAnnouncer() {
  const running = useAuiState((state) => Boolean(state.thread.isRunning));
  const [message, setMessage] = useState('');
  const sawRunRef = useRef(false);
  useEffect(() => {
    if (running) {
      sawRunRef.current = true;
      setMessage('Thingy is answering.');
    } else if (sawRunRef.current) {
      // Neutral on purpose: this also fires after a rejection or error,
      // where "Answer ready" was announced misleadingly (QA R2-01).
      setMessage('Thingy finished responding.');
    }
  }, [running]);
  return (
    <span className="sr-only" aria-live="polite" role="status">
      {message}
    </span>
  );
}

function Thread({
  guest,
  welcome,
  welcomeSubtext = '',
  suggestions,
  suggestionsPending,
  readOnly,
  composerLocked,
  draftKey,
  historyPending
}: {
  guest: boolean;
  welcome: string;
  welcomeSubtext?: string;
  suggestions: string[];
  suggestionsPending?: boolean;
  readOnly?: boolean;
  composerLocked?: boolean;
  draftKey?: string;
  historyPending?: boolean;
}) {
  return (
    <ThreadPrimitive.Root
      data-readonly={readOnly ? 'true' : undefined}
      data-guest-locked={composerLocked ? 'true' : undefined}
      className="librarian-chat thingy-aui-thread flex min-h-0 flex-1 flex-col has-[.thingy-aui-empty]:justify-center"
    >
      <ThreadPrimitive.Viewport className="thingy-chat-scroll min-h-0 flex-1 overflow-y-auto has-[.thingy-aui-empty]:flex-none has-[.thingy-aui-empty]:overflow-visible">
        <div className="librarian-messages mx-auto w-full max-w-3xl px-4 pt-6 pb-2">
          <ThreadPrimitive.Empty>
            {welcome ? (
              <div className="thingy-aui-empty flex flex-col gap-5 pt-6 sm:pt-10">
                {/* Claude-style empty state: the mark, one short display
                    line, chips as invitations. Composed client-side at
                    mount and never swapped (4.10). */}
                <img
                  className="thingy-empty-pop mx-auto size-28 select-none sm:size-32"
                  src="/img/thingy.png"
                  alt=""
                  width="1022"
                  height="1022"
                  loading="eager"
                  draggable={false}
                />
                <div className="thingy-aui-greeting flex flex-col gap-1.5 text-center">
                  <p className="text-[26px] leading-snug font-extrabold tracking-tight text-balance text-ink sm:text-[30px]">
                    {welcome}
                  </p>
                  {welcomeSubtext ? (
                    <p className="text-[14.5px] leading-relaxed text-ink-soft">{welcomeSubtext}</p>
                  ) : null}
                </div>
                <SuggestionChips suggestions={suggestions} pending={suggestionsPending} />
              </div>
            ) : null}
          </ThreadPrimitive.Empty>
          {historyPending ? (
            // A mounted conversation whose history is still loading:
            // transcript skeletons, not a flash of the greeting. Rendered
            // outside ThreadPrimitive.Empty - aui does not show Empty
            // while the history adapter's load is in flight.
            <div className="thingy-history-skeleton flex flex-col gap-5 pt-2" aria-hidden="true">
              <div className="ml-auto h-10 w-3/5 animate-pulse rounded-2xl bg-surface-2" />
              <div className="flex flex-col gap-2.5">
                <div className="h-4 w-full animate-pulse rounded-md bg-surface-2" />
                <div className="h-4 w-11/12 animate-pulse rounded-md bg-surface-2" />
                <div className="h-4 w-4/6 animate-pulse rounded-md bg-surface-2" />
              </div>
            </div>
          ) : null}
          <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage, EditComposer }} />
          <StreamingAnnouncer />
        </div>
        <ThreadPrimitive.ScrollToBottom asChild>
          <button
            type="button"
            className="sticky bottom-3.5 left-1/2 z-10 grid size-9 -translate-x-1/2 place-items-center rounded-full border border-line bg-surface text-ink shadow-md transition-colors hover:border-accent disabled:hidden [&_svg]:size-4"
            aria-label="Jump to latest"
          >
            <Icon name="arrow-down" />
          </button>
        </ThreadPrimitive.ScrollToBottom>
      </ThreadPrimitive.Viewport>
      {readOnly ? null : <Composer guest={guest} locked={composerLocked} draftKey={draftKey} />}
    </ThreadPrimitive.Root>
  );
}

export function ThreadHost({
  binding,
  guest,
  welcome,
  welcomeSubtext = '',
  suggestions,
  suggestionsPending,
  initialPrompt,
  initialPromptAutoSend,
  sharedMessages,
  readOnly,
  composerLocked,
  draftKey
}: {
  binding: ThingyThreadBinding;
  guest: boolean;
  welcome: string;
  welcomeSubtext?: string;
  suggestions: string[];
  suggestionsPending?: boolean;
  initialPrompt?: string;
  initialPromptAutoSend?: boolean;
  // A shared-conversation transcript preloaded into the thread (share
  // continuation): rendered like history, forked on the first message.
  sharedMessages?: Array<{ role?: string; content?: string; citations?: unknown }>;
  readOnly?: boolean;
  // Guest daily cap reached: the composer disables with an explanation
  // instead of letting the visitor type into a server error.
  composerLocked?: boolean;
  // Keys the per-conversation composer draft in sessionStorage.
  draftKey?: string;
}) {
  const adapter = useMemo(() => createThingyAdapter(binding), [binding]);
  const [historyPending, setHistoryPending] = useState(() =>
    Boolean(binding.conversationId && !binding.guest && !sharedMessages?.length)
  );
  const history = useMemo(() => {
    if (sharedMessages?.length) {
      return {
        async load() {
          return { messages: historyItemsFromStored(sharedMessages) as never };
        },
        async append() {
          /* server records turns */
        }
      };
    }
    const inner = createThingyHistoryAdapter(binding);
    return {
      async load() {
        try {
          return await inner.load();
        } finally {
          setHistoryPending(false);
        }
      },
      append: inner.append
    };
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [binding]);
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
        // The adapter tracks feedback_submit after a successful POST; a
        // canceled dialog must not count (it used to fire even on cancel).
        return value;
      }),
    []
  );
  // History only for existing server conversations: a brand-new thread has
  // nothing to load, and racing an empty async load against a seeded
  // append trips assistant-ui's message repository.
  const runtime = useLocalRuntime(adapter, {
    adapters: {
      ...((binding.conversationId && !guest) || sharedMessages?.length ? { history } : {}),
      feedback
    }
  });
  const sentInitialRef = useRef(false);
  useEffect(() => {
    if (!initialPrompt || sentInitialRef.current) return;
    sentInitialRef.current = true;
    // Deferred a tick so the runtime finishes mounting before the seeded
    // prompt (archive links, homepage example chips) is applied.
    const timer = window.setTimeout(() => {
      if (guest || !initialPromptAutoSend) {
        // Guests only PREFILL (the blog's explore links auto-submitted
        // for every JS-executing crawler walking twenty years of posts),
        // and signed-in readers auto-send only when the visit came from
        // the network's own properties - an arbitrary page linking
        // ?prompt= must not spend quota or forge a turn (audit W3).
        runtime.thread.composer.setText(initialPrompt);
        return;
      }
      runtime.thread.append({ role: 'user', content: [{ type: 'text', text: initialPrompt }] });
    }, 50);
    return () => window.clearTimeout(timer);
    // One-shot on mount.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <Thread
        guest={guest}
        welcome={welcome}
        welcomeSubtext={welcomeSubtext}
        suggestions={suggestions}
        suggestionsPending={suggestionsPending}
        readOnly={readOnly}
        composerLocked={composerLocked}
        draftKey={draftKey}
        historyPending={historyPending}
      />
    </AssistantRuntimeProvider>
  );
}
