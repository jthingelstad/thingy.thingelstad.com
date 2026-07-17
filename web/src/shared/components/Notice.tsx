import { render } from 'preact';
import { useSignal, useSignalEffect } from '@preact/signals';
import { useEffect, useRef } from 'preact/hooks';
import { clearNotice, noticeNonce, noticeText } from '../stores/ui-store.ts';

const VISIBLE_MS = 4000;

function Notice() {
  const visible = useSignal(false);
  const timer = useRef(0);

  useSignalEffect(() => {
    // Touch both so the effect re-runs when either changes.
    const [text] = [noticeText.value, noticeNonce.value];
    if (!text) {
      visible.value = false;
      return;
    }
    visible.value = true;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      visible.value = false;
      clearNotice();
    }, VISIBLE_MS);
  });

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    []
  );

  return (
    <div class={`thingy-notice${visible.value ? ' is-visible' : ''}`} role="status" aria-live="polite">
      {noticeText.value}
    </div>
  );
}

function mountNotice(host) {
  if (!host) return () => {};
  render(<Notice />, host);
  return () => render(null, host);
}

export { Notice, mountNotice };
