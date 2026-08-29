import { useEffect } from 'preact/hooks';
import { chatMessages } from '../stores/chat-store.ts';
import { AssistantMessage } from './AssistantMessage.tsx';
import { MessageActions } from './MessageActions.tsx';

interface FeedbackInput {
  requestId: string;
  reaction: string;
  comment: string;
}

interface ChatMessagesProps {
  scrollContainer: () => HTMLElement | null;
  onRetry: (messageId: string, prompt: string) => void;
  submitFeedback: (input: FeedbackInput) => Promise<{ reaction?: string }>;
  track?: (name: string, value?: string) => void;
}

function ChatMessages({ scrollContainer, onRetry, submitFeedback, track }: ChatMessagesProps) {
  const messages = chatMessages.value;

  useEffect(() => {
    // Stick to the bottom only when the reader is already there. An
    // unconditional scroll here yanked the transcript down on every parent
    // render (the inline scrollContainer prop invalidated the deps), which
    // defeated ChatApp's autoFollow logic while someone read older turns.
    const scroll = scrollContainer();
    if (!scroll) return;
    const nearBottom = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 64;
    if (nearBottom) scroll.scrollTop = scroll.scrollHeight;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

  return (
    <div class="chat-messages-list">
      {messages.map((message) => {
        if (message.role === 'user') {
          return (
            <article key={message.id} class="librarian-message librarian-message-user">
              <p>{message.prompt}</p>
              <MessageActions role="prompt" prompt={message.prompt} submitFeedback={submitFeedback} track={track} />
            </article>
          );
        }
        const model = message.model;
        if (!model) return null;
        const status = model.status.value;
        const pending = status === 'pending' || status === 'streaming';
        const requestId = String(model.requestId.value || '');
        return (
          <article
            key={message.id}
            class={`librarian-message librarian-message-assistant${pending ? ' librarian-message-pending' : ''}`}
          >
            <AssistantMessage model={model} onRetry={(prompt) => onRetry(message.id, prompt)} />
            {status === 'done' && requestId ? (
              <MessageActions
                role="response"
                requestId={requestId}
                retryPrompt={message.prompt}
                onRetry={(prompt) => onRetry(message.id, prompt)}
                submitFeedback={submitFeedback}
                track={track}
              />
            ) : null}
          </article>
        );
      })}
    </div>
  );
}

export { ChatMessages };
