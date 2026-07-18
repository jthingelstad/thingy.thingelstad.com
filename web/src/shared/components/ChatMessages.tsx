import { type JSX } from 'preact';
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
  onEmbeddedPrompt: (prompt: string, kind: 'map' | 'experience') => void;
  submitFeedback: (input: FeedbackInput) => Promise<{ reaction?: string }>;
  track?: (name: string, value?: string) => void;
}

function ChatMessages({ scrollContainer, onRetry, onEmbeddedPrompt, submitFeedback, track }: ChatMessagesProps) {
  const messages = chatMessages.value;

  useEffect(() => {
    const scroll = scrollContainer();
    if (scroll) scroll.scrollTop = scroll.scrollHeight;
  }, [messages, scrollContainer]);

  function handleMessageClick(event: JSX.TargetedMouseEvent<HTMLElement>) {
    const target = event.target instanceof Element ? event.target : null;
    const button = target?.closest<HTMLButtonElement>('button[data-experience-prompt], button[data-map-prompt]');
    if (!button) return;
    const mapPrompt = button.dataset.mapPrompt || '';
    const experiencePrompt = button.dataset.experiencePrompt || '';
    onEmbeddedPrompt(mapPrompt || experiencePrompt, mapPrompt ? 'map' : 'experience');
  }

  return (
    <div class="chat-messages-list">
      {messages.map((message) => {
        if (message.role === 'user') {
          return (
            <article key={message.id} class="librarian-message librarian-message-user">
              <p>{message.prompt}</p>
              <MessageActions
                role="prompt"
                prompt={message.prompt}
                scope={message.scope}
                submitFeedback={submitFeedback}
                track={track}
              />
            </article>
          );
        }
        const model = message.model;
        if (!model) return null;
        const status = model.status.value;
        const pending = status === 'pending' || status === 'streaming';
        const requestId = String(model.requestId.value || '');
        const artifact = Boolean(model.artifactHtml.value);
        return (
          <article
            key={message.id}
            class={`librarian-message librarian-message-assistant${pending ? ' librarian-message-pending' : ''}`}
            onClick={handleMessageClick}
          >
            <AssistantMessage model={model} onRetry={(prompt) => onRetry(message.id, prompt)} />
            {status === 'done' && !artifact && requestId ? (
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
