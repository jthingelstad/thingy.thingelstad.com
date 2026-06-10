import assert from 'node:assert/strict';
import test from 'node:test';
import {
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
} from '../src/shared/stores/dispatch-store.js';

test('dispatch-store ships sensible initial values', () => {
  assert.deepEqual(drafts.value, []);
  assert.equal(activeDraftId.value, null);
  assert.deepEqual(dispatchMessages.value, []);
  assert.equal(dispatchStatusMessage.value, '');
  assert.equal(dispatchStatusKind.value, '');
  assert.deepEqual(dispatchActions.value, []);
  assert.equal(dispatchInputDisabled.value, false);
  assert.equal(typeof dispatchInputPlaceholder.value, 'string');
  assert.equal(dispatchBusy.value, false);
  assert.equal(dispatchText.value, '');
});

test('dispatch signals are independently mutable', () => {
  drafts.value = [{ id: 'a', title: 'A' }];
  activeDraftId.value = 'a';
  dispatchStatusMessage.value = 'Ready';
  dispatchStatusKind.value = 'success';
  assert.deepEqual(drafts.value.map((d) => d.id), ['a']);
  assert.equal(activeDraftId.value, 'a');
  assert.equal(dispatchStatusMessage.value, 'Ready');
  assert.equal(dispatchStatusKind.value, 'success');

  // Mutating one does not reset another.
  drafts.value = [];
  assert.equal(dispatchStatusMessage.value, 'Ready');

  // Cleanup so other tests don't see this state.
  activeDraftId.value = null;
  dispatchStatusMessage.value = '';
  dispatchStatusKind.value = '';
});
