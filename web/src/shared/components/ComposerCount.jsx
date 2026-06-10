import { render } from 'preact';
import { questionText } from '../stores/chat-store.js';

// Renders a "n / max" counter that subscribes to a text signal. Defaults to
// the chat composer's questionText so existing chat call sites work without
// passing the signal explicitly; dispatch and any other surface can pass
// its own signal via the `text` prop.
function ComposerCount({ maxChars, text = questionText }) {
  const length = text.value.length;
  const warning = length > maxChars * 0.9;
  return (
    <span class={`composer-count${warning ? ' warning' : ''}`}>
      {length} / {maxChars}
    </span>
  );
}

function mountComposerCount(host, props = {}) {
  if (!host) return () => {};
  render(<ComposerCount {...props} />, host);
  return () => render(null, host);
}

export { ComposerCount, mountComposerCount };
