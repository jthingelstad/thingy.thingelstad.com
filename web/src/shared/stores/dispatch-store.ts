// @ts-check
// Signal store for the Thingy Dispatch surface (/dispatch/). bootDispatch()
// writes to these signals; the dispatch components subscribe to them. The
// chat surface uses chat-store.js, and the cross-surface notice lives in
// ui-store.js.

import { signal } from '@preact/signals';

// Dispatch draft summaries shown in the rail. The dispatch controller mirrors
// its in-memory drafts array into this signal.
const drafts = signal<ThingyDispatchDraftSummary[]>([]);

// String id of the active dispatch draft.
const activeDraftId = signal<string | null>(null);

// Rendered messages for the active draft (already-HTML-safe text).
const dispatchMessages = signal<ThingyDispatchMessage[]>([]);

// Status surface under the dispatch composer.
const dispatchStatusMessage = signal('');
const dispatchStatusKind = signal('');

// Action buttons shown above the status row (e.g. "Generate Dispatch",
// "Check Status"). Each entry is { id, label, kind, href? }; the dispatch
// controller derives them from the active draft's stage.
const dispatchActions = signal<ThingyDispatchAction[]>([]);

// Composer enablement. Set by bootDispatch as draft stage changes.
const dispatchInputDisabled = signal(false);
const dispatchInputPlaceholder = signal('Tell Thingy what this Dispatch should explore...');
const dispatchBusy = signal(false);

// Current draft text in the dispatch composer textarea — shared with
// ComposerCount so the count subscribes the same way the chat composer does.
const dispatchText = signal('');

export {
  activeDraftId,
  dispatchActions,
  dispatchBusy,
  dispatchInputDisabled,
  dispatchInputPlaceholder,
  dispatchMessages,
  dispatchStatusKind,
  dispatchStatusMessage,
  dispatchText,
  drafts
};
