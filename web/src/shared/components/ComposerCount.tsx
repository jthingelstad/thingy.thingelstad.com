import { render } from 'preact';
import { questionText } from '../stores/chat-store.ts';

// Renders a "n / max" counter that subscribes to a text signal. Defaults to
// the chat composer's questionText so existing chat call sites work without
// passing the signal explicitly; dispatch passes its own (dispatchText from
// dispatch-store) via the `text` prop.
function ComposerCount({ maxChars, text = questionText }) {
  const length = text.value.length;
  const warning = length > maxChars * 0.9;
  return (
    <span class={`composer-count${warning ? ' warning' : ''}`}>
      {length} / {maxChars}
    </span>
  );
}

function mountComposerCount(host, props: Parameters<typeof ComposerCount>[0]) {
  if (!host) return () => {};
  render(<ComposerCount {...props} />, host);
  return () => render(null, host);
}

export { ComposerCount, mountComposerCount };
