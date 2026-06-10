// Cross-surface UI signals. Today this is just the notice (toast) surface
// used by chat actions for non-fatal feedback; dispatch can use it too.

import { signal } from '@preact/signals';

// `text` is the visible message; `nonce` advances on every emission so the
// consumer can dismiss-and-rearm correctly even when the same string is
// shown twice in a row.
const noticeText = signal('');
const noticeNonce = signal(0);

function showNotice(text) {
  noticeText.value = String(text || '');
  noticeNonce.value = noticeNonce.value + 1;
}

function clearNotice() {
  noticeText.value = '';
}

export {
  clearNotice,
  noticeNonce,
  noticeText,
  showNotice
};
