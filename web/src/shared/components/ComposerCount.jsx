import { render } from 'preact';
import { questionText } from '../stores/chat-store.js';

function ComposerCount({ maxChars }) {
  const length = questionText.value.length;
  const warning = length > maxChars * 0.9;
  return (
    <span class={`composer-count${warning ? ' warning' : ''}`}>
      {length} / {maxChars}
    </span>
  );
}

function mountComposerCount(host, props = {}) {
  if (!host) return;
  render(<ComposerCount {...props} />, host);
}

export { ComposerCount, mountComposerCount };
