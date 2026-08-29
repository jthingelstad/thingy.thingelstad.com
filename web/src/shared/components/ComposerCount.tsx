import { questionText } from '../stores/chat-store.ts';

// Renders a "n / max" counter that subscribes to the chat composer's
// questionText signal.
interface ComposerCountProps {
  maxChars: number;
}

function ComposerCount({ maxChars }: ComposerCountProps) {
  const length = questionText.value.length;
  const warning = length > maxChars * 0.9;
  return (
    <span class={`composer-count${warning ? ' warning' : ''}`}>
      {length} / {maxChars}
    </span>
  );
}

export { ComposerCount };
