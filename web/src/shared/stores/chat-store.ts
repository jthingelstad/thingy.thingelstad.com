// @ts-check
// Signal store for the Thingy chat surface (/chat/). Components read these
// signals; bootChat() writes to them. Dispatch's state lives in
// dispatch-store.js, and the cross-surface notice lives in ui-store.js.

import { computed, signal } from '@preact/signals';

// --- Conversations ----------------------------------------------------------

// The list of recent conversation summaries shown in the rail. Owned by the
// chat controller for now; the controller pushes new arrays into this signal
// through its renderRecents() sync step.
const conversations = signal<ThingyConversationSummary[]>([]);

// String id of the active conversation, or null when no chat is selected.
const activeConversationId = signal<string | null>(null);

// Modes the signed-in user is entitled to. Always contains at least
// { id: 'thingy', label: 'Thingy' }.
const availableModes = signal<ThingyMode[]>([{ id: 'thingy', label: 'Thingy' }]);

// The mode selected for the next new conversation (the mode picker value).
// Existing conversations carry their own mode in the conversation summary.
const activeMode = signal('thingy');

// Render models for the active transcript. User messages carry plain text;
// assistant messages carry a reactive AssistantMessageModel updated by the
// streaming action layer.
const chatMessages = signal<ThingyChatViewMessage[]>([]);

// --- Auth gate --------------------------------------------------------------
// (signedIn lives in ui-store — it's cross-surface identity state shared
// with dispatch and AccountMenu.)

// Email currently shown in the sign-in input.
const authEmail = signal('');

// Inline validation error under the email input ('' when valid).
const authEmailError = signal('');

// Status text under the sign-in form.
const authMessage = signal('');

// Which secondary action button is offered: 'none', 'subscribe', or
// 'resend_confirmation'. Set by the auth response handler.
const authAction = signal<'none' | 'subscribe' | 'resend_confirmation'>('none');

// True while a sign-in / subscribe / resend POST is in flight; disables
// both the primary and secondary buttons.
const authBusy = signal(false);

// --- Composer ---------------------------------------------------------------

// Current draft text in the chat composer textarea. The chat controller
// mirrors the textarea's value into this signal so the count and submit
// button can subscribe; writes to the signal are not the source of truth
// for the input.
const questionText = signal('');

// The native checkbox values selected in the declarative source picker.
const selectedSources = signal<string[]>(['weekly_thing', 'blog', 'podcast']);

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

const interactionBusy = computed(
  () => answerInFlight.value || welcomeInFlight.value || mapInFlight.value || conversationCreateInFlight.value
);

export {
  activeConversationId,
  activeMode,
  answerInFlight,
  authAction,
  authBusy,
  authEmail,
  authEmailError,
  authMessage,
  availableModes,
  chatMessages,
  conversationCreateInFlight,
  conversations,
  hasSources,
  interactionBusy,
  mapInFlight,
  questionText,
  selectedSources,
  stoppable,
  welcomeInFlight
};
