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
function SuggestionChips({ suggestions }: { suggestions: string[] }) {
  const aui = useAui();
  // DETERMINISTIC GEOMETRY: three stacked single-line rows whether the
  // chips are skeletons or real. Wrapped pill rows re-broke the mis-click
  // fix in live QA - long questions wrapped to a second row the skeleton
  // never reserved, and the extra row landed under the pointer. One
  // truncated line per chip means loading and loaded states occupy
  // exactly the same box.
  const CHIP_ROW =
    'block w-full max-w-xl truncate rounded-xl border px-3.5 py-1.5 text-left text-[13.5px] leading-snug';
  if (!suggestions.length) {
    return (
      <div className="grid gap-2" aria-hidden="true">
        {[0, 1, 2].map((slot) => (
          <span
            key={slot}
            className={`${CHIP_ROW} animate-pulse border-line-soft bg-surface-2 text-transparent select-none`}
          >
            &nbsp;
          </span>
        ))}
      </div>
    );
  }
  return (
    <div className="grid gap-2" aria-label="Suggested questions">
      {suggestions.slice(0, 3).map((suggestion) => (
        <button
          key={suggestion}
          type="button"
          title={suggestion}
          className={`thingy-aui-suggestion ${CHIP_ROW} border-line bg-surface text-ink transition-colors hover:border-accent hover:bg-accent-soft`}
          onClick={() => {
            trackEvent('librarian.welcome_suggestion');
            aui.composer.setText(suggestion);
            aui.composer.send();
          }}
        >
          {suggestion}
        </button>
      ))}
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
      setMessage('Answer ready.');
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
  suggestions,
  readOnly,
  composerLocked,
  draftKey,
  historyPending
}: {
  guest: boolean;
  welcome: string;
  suggestions: string[];
  readOnly?: boolean;
  composerLocked?: boolean;
  draftKey?: string;
  historyPending?: boolean;
}) {
  return (
    <ThreadPrimitive.Root
      data-readonly={readOnly ? 'true' : undefined}
      className="librarian-chat thingy-aui-thread flex min-h-0 flex-1 flex-col has-[.thingy-aui-empty]:justify-center"
    >
      <ThreadPrimitive.Viewport className="thingy-chat-scroll min-h-0 flex-1 overflow-y-auto has-[.thingy-aui-empty]:flex-none has-[.thingy-aui-empty]:overflow-visible">
        <div className="librarian-messages mx-auto w-full max-w-3xl px-4 pt-6 pb-2">
          <ThreadPrimitive.Empty>
            {welcome ? (
              <div className="thingy-aui-empty flex flex-col gap-4">
                <article className="librarian-message librarian-message-assistant">
                  <div className="librarian-answer-content">
                    <p className="min-h-28 text-[17px] leading-relaxed text-ink">{welcome}</p>
                  </div>
                </article>
                <SuggestionChips suggestions={suggestions} />
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
  suggestions,
  initialPrompt,
  sharedMessages,
  readOnly,
  composerLocked,
  draftKey
}: {
  binding: ThingyThreadBinding;
  guest: boolean;
  welcome: string;
  suggestions: string[];
  initialPrompt?: string;
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
        trackEvent('librarian.feedback_submit', 'down');
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
      <Thread
        guest={guest}
        welcome={welcome}
        suggestions={suggestions}
        readOnly={readOnly}
        composerLocked={composerLocked}
        draftKey={draftKey}
        historyPending={historyPending}
      />
    </AssistantRuntimeProvider>
  );
}
