import type { Signal } from '@preact/signals';
import { questionText } from '../stores/chat-store.ts';

// Renders a "n / max" counter that subscribes to a text signal. Defaults to
// the chat composer's questionText so existing chat call sites work without
// passing the signal explicitly; dispatch passes its own (dispatchText from
// dispatch-store) via the `text` prop.
interface ComposerCountProps {
  maxChars: number;
  text?: Signal<string>;
}

function ComposerCount({ maxChars, text = questionText }: ComposerCountProps) {
  const length = text.value.length;
  const warning = length > maxChars * 0.9;
  return (
    <span class={`composer-count${warning ? ' warning' : ''}`}>
      {length} / {maxChars}
    </span>
  );
}

export { ComposerCount };
