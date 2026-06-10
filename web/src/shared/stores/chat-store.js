// Signal store for the Thingy chat surface. Components read these signals;
// imperative code calls the action helpers to mutate them. This is the
// receiving end of the REPLATFORM.md migration — additions land here as
// each island moves over.

import { computed, signal } from '@preact/signals';

// --- Conversations ----------------------------------------------------------

// The list of recent conversation summaries shown in the rail. Owned by the
// chat controller for now; the controller pushes new arrays into this signal
// through its renderRecents() sync step.
const conversations = signal([]);

// String id of the active conversation, or null when no chat is selected.
const activeConversationId = signal(null);

// Modes the signed-in user is entitled to. Always contains at least
// { id: 'thingy', label: 'Thingy' }.
const availableModes = signal([{ id: 'thingy', label: 'Thingy' }]);

// --- Composer ---------------------------------------------------------------

// Current draft text in the composer textarea. The chat controller mirrors
// the textarea's value into this signal so the count and submit button can
// subscribe; writes to the signal are not the source of truth for the input.
const questionText = signal('');

// True when at least one source is selected in the source picker. The
// source picker is still imperative; the controller mirrors its state.
const hasSources = signal(true);

// In-flight flags. Components read interactionBusy and stoppable; the chat
// controller flips the underlying flags as each operation starts and ends.
const answerInFlight = signal(false);
const welcomeInFlight = signal(false);
const mapInFlight = signal(false);
const conversationCreateInFlight = signal(false);

// True while an answer is streaming AND the user can abort it.
const stoppable = signal(false);

const interactionBusy = computed(() => (
  answerInFlight.value
  || welcomeInFlight.value
  || mapInFlight.value
  || conversationCreateInFlight.value
));

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
  activeConversationId,
  answerInFlight,
  availableModes,
  clearNotice,
  conversationCreateInFlight,
  conversations,
  hasSources,
  interactionBusy,
  mapInFlight,
  noticeNonce,
  noticeText,
  questionText,
  showNotice,
  stoppable,
  welcomeInFlight
};
