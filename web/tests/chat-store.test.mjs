import assert from 'node:assert/strict';
import test from 'node:test';
import {
  activeConversationId,
  answerInFlight,
  availableModes,
  conversationCreateInFlight,
  conversations,
  interactionBusy,
  questionText,
  stoppable,
  welcomeInFlight
} from '../src/shared/stores/chat-store.ts';
import { signedIn } from '../src/shared/stores/ui-store.ts';

function resetInFlight() {
  answerInFlight.value = false;
  welcomeInFlight.value = false;
  conversationCreateInFlight.value = false;
  stoppable.value = false;
}

test('chat-store ships sensible initial values', () => {
  resetInFlight();
  assert.deepEqual(conversations.value, []);
  assert.equal(activeConversationId.value, null);
  assert.deepEqual(availableModes.value, [{ id: 'thingy', label: 'Thingy' }]);
  assert.equal(signedIn.value, false);
  assert.equal(questionText.value, '');
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

test('interactionBusy leaves the composer available during the asynchronous welcome', () => {
  resetInFlight();
  welcomeInFlight.value = true;
  assert.equal(interactionBusy.value, false);
  welcomeInFlight.value = false;
});

test('interactionBusy reflects conversationCreateInFlight', () => {
  resetInFlight();
  conversationCreateInFlight.value = true;
  assert.equal(interactionBusy.value, true);
  conversationCreateInFlight.value = false;
  assert.equal(interactionBusy.value, false);
});

test('interactionBusy stays true when multiple flags overlap', () => {
  resetInFlight();
  answerInFlight.value = true;
  welcomeInFlight.value = true;
  assert.equal(interactionBusy.value, true);
  answerInFlight.value = false;
  assert.equal(interactionBusy.value, false, 'welcome does not block a new question');
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
