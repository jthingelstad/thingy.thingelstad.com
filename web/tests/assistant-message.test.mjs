import assert from 'node:assert/strict';
import test from 'node:test';
import { createAssistantMessageModel } from '../src/shared/models/assistant-message.js';

test('createAssistantMessageModel starts at pending with empty content', () => {
  const model = createAssistantMessageModel();
  assert.equal(model.content.value, '');
  assert.deepEqual(model.citations.value, []);
  assert.deepEqual(model.activity.value, []);
  assert.deepEqual(model.commentary.value, []);
  assert.equal(model.experience.value, null);
  assert.equal(model.artifactHtml.value, '');
  assert.equal(model.status.value, 'pending');
  assert.equal(model.errorMessage.value, '');
  assert.equal(model.retryPrompt.value, '');
  assert.equal(model.requestId.value, '');
});

test('createAssistantMessageModel applies the passed options', () => {
  const model = createAssistantMessageModel({
    content: 'preset',
    citations: [{ id: 'c1' }],
    activity: [{ label: 'Reading' }],
    status: 'done',
    statusFallback: 'orienting',
    label: 'Session Setup',
    requestId: 'req-123'
  });
  assert.equal(model.content.value, 'preset');
  assert.deepEqual(model.citations.value, [{ id: 'c1' }]);
  assert.deepEqual(model.activity.value, [{ label: 'Reading' }]);
  assert.equal(model.status.value, 'done');
  assert.equal(model.statusFallback.value, 'orienting');
  assert.equal(model.label.value, 'Session Setup');
  assert.equal(model.requestId.value, 'req-123');
});

test('every model gets a unique id', () => {
  const a = createAssistantMessageModel();
  const b = createAssistantMessageModel();
  assert.notEqual(a.id, b.id);
  assert.match(a.id, /^assistant-\d+$/);
});

test('signals on a model are independent', () => {
  const model = createAssistantMessageModel();
  model.content.value = 'streaming text';
  model.citations.value = [{ id: 'a' }];
  assert.equal(model.content.value, 'streaming text');
  assert.deepEqual(model.citations.value, [{ id: 'a' }]);
  // Mutating one signal does not reset another.
  model.activity.value = [{ label: 'Step' }];
  assert.equal(model.content.value, 'streaming text');
});

test('invalid options types are coerced or ignored', () => {
  const model = createAssistantMessageModel({
    content: null,
    citations: 'not-an-array',
    activity: undefined,
    requestId: 42
  });
  assert.equal(model.content.value, '');
  assert.deepEqual(model.citations.value, []);
  assert.deepEqual(model.activity.value, []);
  assert.equal(model.requestId.value, '42');
});
