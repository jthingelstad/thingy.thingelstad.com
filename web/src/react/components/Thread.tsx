import { useEffect, useMemo, useRef } from 'react';
import { AssistantRuntimeProvider, ThreadPrimitive, useAui, useLocalRuntime } from '@assistant-ui/react';
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
  if (!suggestions.length) return null;
  return (
    <div className="flex flex-wrap gap-2" aria-label="Suggested questions">
      {suggestions.map((suggestion) => (
        <button
          key={suggestion}
          type="button"
          className="thingy-aui-suggestion rounded-full border border-line bg-surface px-3.5 py-1.5 text-left text-[13.5px] leading-snug text-ink transition-colors hover:border-accent hover:bg-accent-soft"
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

function Thread({
  guest,
  welcome,
  suggestions,
  readOnly
}: {
  guest: boolean;
  welcome: string;
  suggestions: string[];
  readOnly?: boolean;
}) {
  return (
    <ThreadPrimitive.Root className="librarian-chat thingy-aui-thread flex min-h-0 flex-1 flex-col has-[.thingy-aui-empty]:justify-center">
      <ThreadPrimitive.Viewport className="thingy-chat-scroll min-h-0 flex-1 overflow-y-auto has-[.thingy-aui-empty]:flex-none has-[.thingy-aui-empty]:overflow-visible">
        <div className="librarian-messages mx-auto w-full max-w-3xl px-4 pt-6 pb-2">
          <ThreadPrimitive.Empty>
            <div className="thingy-aui-empty flex flex-col gap-4">
              <article className="librarian-message librarian-message-assistant">
                <div className="librarian-answer-content">
                  <p className="text-[17px] leading-relaxed text-ink">{welcome}</p>
                </div>
              </article>
              <SuggestionChips suggestions={suggestions} />
            </div>
          </ThreadPrimitive.Empty>
          <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage, EditComposer }} />
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
      {readOnly ? null : <Composer guest={guest} />}
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
  readOnly
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
}) {
  const adapter = useMemo(() => createThingyAdapter(binding), [binding]);
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
    return createThingyHistoryAdapter(binding);
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
      <Thread guest={guest} welcome={welcome} suggestions={suggestions} readOnly={readOnly} />
    </AssistantRuntimeProvider>
  );
}
