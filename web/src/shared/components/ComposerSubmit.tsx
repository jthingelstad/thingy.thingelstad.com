import { render, type JSX } from 'preact';
import { iconSvg } from '../thingy-icons.ts';
import { hasSources, interactionBusy, questionText, stoppable } from '../stores/chat-store.ts';

const ASK_ICON = iconSvg('arrow-up');
const STOP_ICON = iconSvg('square');

interface ComposerSubmitProps {
  maxChars: number;
  onStop: () => void;
}

function ComposerSubmit({ maxChars, onStop }: ComposerSubmitProps) {
  const stop = stoppable.value;
  const busy = interactionBusy.value;
  const text = questionText.value;
  const hasText = Boolean(text.trim());
  const overLimit = text.length > maxChars;
  const disabled = stop ? false : busy || !hasSources.value || !hasText || overLimit;
  const label = stop ? 'Stop answer' : busy ? 'Thingy is answering' : 'Ask Thingy';

  function handleClick(event: JSX.TargetedMouseEvent<HTMLButtonElement>) {
    if (!stop) return;
    event.preventDefault();
    onStop?.();
  }

  return (
    <button
      type="submit"
      class={`composer-send${stop ? ' is-stop' : ''}`}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={handleClick}
      data-tinylytics-event="librarian.question_submit"
    >
      <span class="composer-send-ask" aria-hidden="true" dangerouslySetInnerHTML={{ __html: ASK_ICON }} />
      <span class="composer-send-stop" aria-hidden="true" dangerouslySetInnerHTML={{ __html: STOP_ICON }} />
    </button>
  );
}

function mountComposerSubmit(host: HTMLElement | null, props: ComposerSubmitProps) {
  if (!host) return () => {};
  render(<ComposerSubmit {...props} />, host);
  return () => render(null, host);
}

export { ComposerSubmit, mountComposerSubmit };
