import assert from 'node:assert/strict';
import test from 'node:test';
import {
  activeConversationId,
  answerInFlight,
  authAction,
  authBusy,
  authEmail,
  authEmailError,
  authMessage,
  availableModes,
  conversationCreateInFlight,
  conversations,
  hasSources,
  interactionBusy,
  mapInFlight,
  questionText,
  signedIn,
  stoppable,
  welcomeInFlight
} from '../src/shared/stores/chat-store.js';

function resetInFlight() {
  answerInFlight.value = false;
  welcomeInFlight.value = false;
  mapInFlight.value = false;
  conversationCreateInFlight.value = false;
  stoppable.value = false;
}

test('chat-store ships sensible initial values', () => {
  resetInFlight();
  assert.deepEqual(conversations.value, []);
  assert.equal(activeConversationId.value, null);
  assert.deepEqual(availableModes.value, [{ id: 'thingy', label: 'Thingy' }]);
  assert.equal(signedIn.value, false);
  assert.equal(authEmail.value, '');
  assert.equal(authEmailError.value, '');
  assert.equal(authMessage.value, '');
  assert.equal(authAction.value, 'none');
  assert.equal(authBusy.value, false);
  assert.equal(questionText.value, '');
  assert.equal(hasSources.value, true);
  assert.equal(interactionBusy.value, false);
});

test('interactionBusy reflects answerInFlight', () => {
  resetInFlight();
  assert.equal(interactionBusy.value, false);
  answerInFlight.value = true;
  assert.equal(interactionBusy.value, true);
  answerInFlight.value = false;
  assert.equal(interactionBusy.value, false);
});

test('interactionBusy reflects welcomeInFlight, mapInFlight, and conversationCreateInFlight', () => {
  resetInFlight();
  for (const sig of [welcomeInFlight, mapInFlight, conversationCreateInFlight]) {
    sig.value = true;
    assert.equal(interactionBusy.value, true, `${sig} makes interactionBusy true`);
    sig.value = false;
    assert.equal(interactionBusy.value, false);
  }
});

test('interactionBusy stays true when multiple flags overlap', () => {
  resetInFlight();
  answerInFlight.value = true;
  welcomeInFlight.value = true;
  assert.equal(interactionBusy.value, true);
  answerInFlight.value = false;
  // Still true because welcome is still running.
  assert.equal(interactionBusy.value, true);
  welcomeInFlight.value = false;
  assert.equal(interactionBusy.value, false);
});

test('stoppable is an independent signal from interactionBusy', () => {
  resetInFlight();
  stoppable.value = true;
  assert.equal(stoppable.value, true);
  assert.equal(interactionBusy.value, false, 'stoppable does not imply busy on its own');
  stoppable.value = false;
});
