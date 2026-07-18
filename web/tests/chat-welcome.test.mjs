import assert from 'node:assert/strict';
import test from 'node:test';
import { signal } from '@preact/signals';
import { DEFAULT_WELCOME, createChatWelcomeController } from '../src/shared/thingy-chat-welcome.ts';

function deferred() {
  let resolve;
  const promise = new Promise((done) => (resolve = done));
  return { promise, resolve };
}

test('welcome renders deterministic content immediately while personalization continues', async () => {
  const stream = deferred();
  const inFlight = [];
  const model = {
    activity: signal([]),
    commentary: signal([]),
    content: signal(DEFAULT_WELCOME),
    status: signal('pending')
  };
  const controller = createChatWelcomeController({
    canStart: () => true,
    ensureFreshToken: async () => true,
    prepareProfile: () => {},
    createMessage: () => ({ id: 'welcome-1', model }),
    removeMessage: () => {},
    stream: () => stream.promise,
    setInFlight: (value) => inFlight.push(value),
    track: () => {}
  });

  const pending = controller.start();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(model.content.value, DEFAULT_WELCOME);
  assert.deepEqual(inFlight, [true]);
  stream.resolve();
  await pending;
  assert.deepEqual(inFlight, [true, false]);
});

test('cancelling a welcome aborts personalization and removes only the pending message', async () => {
  let aborted = false;
  let removed = '';
  const controller = createChatWelcomeController({
    canStart: () => true,
    ensureFreshToken: async () => true,
    prepareProfile: () => {},
    createMessage: () => ({
      id: 'welcome-2',
      model: {
        activity: signal([]),
        commentary: signal([]),
        content: signal(DEFAULT_WELCOME),
        status: signal('pending')
      }
    }),
    removeMessage: (id) => (removed = id),
    stream: (_model, signalController) =>
      new Promise((_resolve, reject) => {
        signalController.signal.addEventListener('abort', () => {
          aborted = true;
          reject(new DOMException('Aborted', 'AbortError'));
        });
      }),
    setInFlight: () => {},
    track: () => {}
  });

  const pending = controller.start();
  await Promise.resolve();
  await Promise.resolve();
  controller.cancel();
  await pending;
  assert.equal(aborted, true);
  assert.equal(removed, 'welcome-2');
});
