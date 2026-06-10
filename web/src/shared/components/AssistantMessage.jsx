import { render } from 'preact';
import { useComputed } from '@preact/signals';
import { renderAssistantResponse, renderCuriosityMap } from '../thingy-chat-rendering.js';

function StreamNote({ text }) {
  return <p class="librarian-stream-note">{text}</p>;
}

function StreamError({ message, retryPrompt }) {
  return (
    <div class="librarian-stream-error">
      <p>{message}</p>
      {retryPrompt ? (
        <button
          type="button"
          class="librarian-retry"
          data-retry-prompt={retryPrompt}
        >
          Try again
        </button>
      ) : null}
    </div>
  );
}

function AssistantBody({ model }) {
  const html = useComputed(() => {
    const artifact = model.artifactHtml.value;
    if (artifact) return artifact;
    const status = model.status.value;
    if (status === 'pending' && !model.content.value && !model.experience.value) {
      const fallback = model.statusFallback.value;
      return `<p class="librarian-status-line"><span class="librarian-thinking-dot"></span>${fallback}</p>`;
    }
    return renderAssistantResponse(
      model.content.value,
      model.citations.value,
      model.experience.value,
      model.activity.value,
      model.commentary.value,
      { active: status === 'pending' || status === 'streaming', label: model.label.value }
    );
  });
  return <div dangerouslySetInnerHTML={{ __html: html.value }} />;
}

function AssistantMessage({ model }) {
  const status = model.status.value;
  const hasPartial = useComputed(() => Boolean(
    String(model.content.value || '').trim()
    || model.experience.value
    || model.artifactHtml.value
  ));
  const errorMessage = model.errorMessage.value;
  const retryPrompt = model.retryPrompt.value;
  return (
    <>
      <AssistantBody model={model} />
      {status === 'stopped' ? (
        <StreamNote text={hasPartial.value ? 'Answer stopped.' : 'Answer stopped.'} />
      ) : null}
      {status === 'error' && errorMessage ? (
        <StreamError
          message={hasPartial.value ? `Thingy lost the thread mid-answer. ${errorMessage}` : errorMessage}
          retryPrompt={retryPrompt}
        />
      ) : null}
    </>
  );
}

function mountAssistantMessage(host, model) {
  if (!host) return () => {};
  render(<AssistantMessage model={model} />, host);
  return () => render(null, host);
}

export { AssistantMessage, mountAssistantMessage, renderCuriosityMap };
