import { render } from 'preact';
import { useEffect } from 'preact/hooks';
import { useComputed } from '@preact/signals';
import { renderAssistantResponse, renderCuriosityMap } from '../thingy-chat-rendering.js';
import { escapeHtml } from '../thingy-markdown.js';
import { formatElapsedTime } from '../models/assistant-message.js';

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
  const elapsedLabel = useComputed(() => formatElapsedTime(model.elapsedSeconds.value));
  const html = useComputed(() => {
    const artifact = model.artifactHtml.value;
    if (artifact) return artifact;
    const status = model.status.value;
    const active = status === 'pending' || status === 'streaming';
    if (status === 'pending' && !model.content.value && !model.experience.value) {
      const fallback = model.statusFallback.value;
      return `<p class="librarian-status-line"><span class="librarian-thinking-dot"></span><span>${escapeHtml(fallback)}</span><span class="librarian-elapsed">${escapeHtml(elapsedLabel.value)}</span></p>`;
    }
    return renderAssistantResponse(
      model.content.value,
      model.citations.value,
      model.experience.value,
      model.activity.value,
      model.commentary.value,
      { active, label: model.label.value, elapsedLabel: active ? elapsedLabel.value : '' }
    );
  });
  return <div dangerouslySetInnerHTML={{ __html: html.value }} />;
}

function AssistantMessage({ model }) {
  const status = model.status.value;
  useEffect(() => {
    if (status !== 'pending' && status !== 'streaming') return undefined;
    function tick() {
      model.elapsedSeconds.value = Math.max(0, Math.floor((Date.now() - model.startedAt.value) / 1000));
    }
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [model, status]);
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
