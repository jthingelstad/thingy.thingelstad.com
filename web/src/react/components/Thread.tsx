import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
  const pool = [...new Set(suggestions.filter(Boolean))];
  // DETERMINISTIC GEOMETRY (mis-click fix, live QA): one truncated
  // single-line row per chip, so skeletons, shuffled sets, and loaded
  // chips keep stable row heights, with up to three distinct questions. Desktop pills are
  // content-width and centered on their own row; on a phone they are
  // full-width cards (Felt & Tangerine, MobileGuest board).
  const CHIP =
    'inline-flex min-h-12 w-full max-w-full items-center justify-between gap-3 rounded-2xl border-2 px-4 text-left text-[15px] leading-snug font-semibold sm:w-auto sm:justify-center sm:rounded-full sm:px-5 sm:text-center sm:text-[15.5px]';
  if (!pool.length) {
    // Skeletons only while a welcome request is actually in flight; a
    // seeded prompt never fetches suggestions (R3-03).
    if (!pending) return null;
    return (
      <div className="flex flex-col items-center gap-2 sm:gap-2.5" aria-hidden="true">
        {['sm:w-80', 'sm:w-64', 'sm:w-96'].map((width) => (
          <span key={width} className={`${CHIP} ${width} animate-pulse border-rule bg-toy select-none`}>
            &nbsp;
          </span>
        ))}
      </div>
    );
  }
  const visible = Array.from({ length: Math.min(3, pool.length) }, (_, slot) => pool[(offset + slot) % pool.length]);
  const shuffleable = pool.length > 3;
  return (
    <div className="flex flex-col items-center gap-2 sm:gap-2.5" aria-label="Suggested questions">
      {visible.map((suggestion, index) => (
        <button
          key={suggestion}
          type="button"
          title={suggestion}
          className={`thingy-aui-suggestion ${CHIP} border-ink bg-paper text-ink transition-colors hover:border-tangerine hover:bg-[#ffe6d3] [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-clay`}
          onClick={() => {
            trackEvent('librarian.welcome_suggestion', String(index + 1));
            aui.composer.setText(suggestion);
            aui.composer.send();
          }}
        >
          <span className="min-w-0 truncate">{suggestion}</span>
          <Icon name="arrow-right" />
        </button>
      ))}
      {shuffleable ? (
        <button
          type="button"
          className="thingy-aui-shuffle inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-[13.5px] font-semibold text-quiet transition-colors hover:bg-toy hover:text-ink [&_svg]:size-[15px]"
          onClick={() => setOffset((value) => (value + 3) % pool.length)}
        >
          <Icon name="shuffle" />
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
  historyPending,
  lead,
  startAtTop
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
  lead?: ReactNode;
  startAtTop?: boolean;
}) {
  // A shared transcript opens at the top and stays put while it lays
  // out; following the newest content starts with the reader's first
  // follow-up.
  const running = useAuiState((state) => state.thread.isRunning);
  const [followed, setFollowed] = useState(false);
  useEffect(() => {
    if (running) setFollowed(true);
  }, [running]);
  const follow = !startAtTop || followed || running;
  return (
    <ThreadPrimitive.Root
      data-readonly={readOnly ? 'true' : undefined}
      data-guest-locked={composerLocked ? 'true' : undefined}
      className="librarian-chat thingy-aui-thread flex min-h-0 flex-1 flex-col has-[.thingy-aui-empty]:justify-center"
    >
      <ThreadPrimitive.Viewport
        scrollToBottomOnInitialize={!startAtTop}
        autoScroll={follow}
        className="thingy-chat-scroll min-h-0 flex-1 overflow-y-auto has-[.thingy-aui-empty]:flex-none has-[.thingy-aui-empty]:overflow-visible"
      >
        <div className="librarian-messages mx-auto w-full max-w-3xl px-4 pt-6 pb-2">
          {lead}
          <ThreadPrimitive.Empty>
            {welcome ? (
              <div className="thingy-aui-empty flex flex-col gap-5 pt-2 sm:gap-7 sm:pt-6">
                {/* The mascot with the greeting in its speech bubble, chips
                    as invitations. The greeting is composed client-side at
                    mount and never swapped (4.10). Beside each other on a
                    wide screen, stacked on a phone. */}
                <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center sm:gap-2">
                  <div className="relative size-[150px] shrink-0 sm:size-[190px]" aria-hidden="true">
                    <span className="absolute bottom-1 left-5 h-3.5 w-[110px] rounded-[50%] bg-[#e4d6b6] sm:bottom-1.5 sm:left-[22px] sm:h-[18px] sm:w-[150px]" />
                    <img
                      className="absolute inset-0 size-full select-none"
                      src="/img/thingy.png"
                      alt=""
                      width="1022"
                      height="1022"
                      loading="eager"
                      draggable={false}
                    />
                  </div>
                  <div className="thingy-aui-greeting flex max-w-[400px] flex-col gap-2 text-center sm:text-left">
                    <p className="thingy-display rounded-[20px] border-2 border-ink bg-paper px-[18px] py-3.5 text-[25px] leading-[1.1] text-balance text-ink shadow-[4px_4px_0_var(--thingy-ink)] sm:rounded-[22px_22px_22px_6px] sm:px-[22px] sm:py-[18px] sm:text-[30px]">
                      {welcome}
                    </p>
                    {welcomeSubtext ? (
                      <p className="px-2 text-[15.5px] leading-normal text-[#3e4a63]">{welcomeSubtext}</p>
                    ) : null}
                  </div>
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
              <div className="ml-auto h-11 w-3/5 animate-pulse rounded-[22px_22px_6px_22px] bg-toy" />
              <div className="flex flex-col gap-2.5">
                <div className="h-4 w-full animate-pulse rounded-md bg-toy" />
                <div className="h-4 w-11/12 animate-pulse rounded-md bg-toy" />
                <div className="h-4 w-4/6 animate-pulse rounded-md bg-toy" />
              </div>
            </div>
          ) : null}
          <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage, EditComposer }} />
          <StreamingAnnouncer />
        </div>
        <ThreadPrimitive.ScrollToBottom asChild>
          <button
            type="button"
            className="sticky bottom-3.5 left-1/2 z-10 grid size-11 -translate-x-1/2 place-items-center rounded-full border-2 border-ink bg-paper text-ink shadow-[0_3px_0_var(--thingy-ink)] transition-colors hover:bg-toy disabled:hidden [&_svg]:size-5"
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
  draftKey,
  lead
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
  // Content that scrolls with the transcript, above the first message
  // (the share page's title and banner).
  lead?: ReactNode;
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
          icon: 'thumbs-down',
          label: 'Your feedback',
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
  // A shared transcript reads from the top (title, banner, question);
  // chats still land on the latest turn.
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
        lead={lead}
        startAtTop={Boolean(sharedMessages?.length)}
      />
    </AssistantRuntimeProvider>
  );
}
