// Signal store for the Thingy chat surface. Components read these signals;
// imperative code calls the action helpers to mutate them. This is the
// receiving end of the REPLATFORM.md migration — additions land here as
// each island moves over.

import { signal } from '@preact/signals';

// --- Transient UI -----------------------------------------------------------

// Notice (toast) surface. `text` is the visible message; `nonce` advances on
// every emission so the consumer can dismiss-and-rearm correctly even when
// the same string is shown twice in a row.
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
