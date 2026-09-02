import { useEffect, useMemo, useRef } from 'react';
import { AssistantRuntimeProvider, ThreadPrimitive, useAui, useLocalRuntime } from '@assistant-ui/react';
import { trackEvent as track } from '../../shared/thingy-analytics.ts';
import { promptDialog } from '../../shared/stores/dialog-store.ts';
import { trackEvent } from '../../shared/thingy-analytics.ts';
import {
  createThingyAdapter,
  createThingyFeedbackAdapter,
  createThingyHistoryAdapter,
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
    <div className="thingy-aui-suggestions" aria-label="Suggested questions">
      {suggestions.map((suggestion) => (
        <button
          key={suggestion}
          type="button"
          className="thingy-aui-suggestion"
          onClick={() => {
            track('librarian.welcome_suggestion');
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

function Thread({ guest, welcome, suggestions }: { guest: boolean; welcome: string; suggestions: string[] }) {
  return (
    <ThreadPrimitive.Root className="librarian-chat thingy-chat thingy-aui-thread">
      <ThreadPrimitive.Viewport className="thingy-chat-scroll" autoScroll>
        <div className="librarian-messages">
          <ThreadPrimitive.Empty>
            <div className="thingy-aui-empty">
              <article className="librarian-message librarian-message-assistant">
                <div className="librarian-answer-content">
                  <p>{welcome}</p>
                </div>
              </article>
              <SuggestionChips suggestions={suggestions} />
            </div>
          </ThreadPrimitive.Empty>
          <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage, EditComposer }} />
        </div>
        <ThreadPrimitive.ScrollToBottom asChild>
          <button type="button" className="thingy-aui-scrollbottom" aria-label="Jump to latest" title="Jump to latest">
            <Icon name="arrow-down" />
          </button>
        </ThreadPrimitive.ScrollToBottom>
      </ThreadPrimitive.Viewport>
      <Composer guest={guest} />
    </ThreadPrimitive.Root>
  );
}

export function ThreadHost({
  binding,
  guest,
  welcome,
  suggestions,
  initialPrompt
}: {
  binding: ThingyThreadBinding;
  guest: boolean;
  welcome: string;
  suggestions: string[];
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
      <Thread guest={guest} welcome={welcome} suggestions={suggestions} />
    </AssistantRuntimeProvider>
  );
}
