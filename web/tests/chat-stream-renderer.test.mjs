import assert from 'node:assert/strict';
import test from 'node:test';

const { createAssistantStreamRenderer } = await import('../src/shared/thingy-chat-stream-renderer.js');
const { createAssistantMessageModel } = await import('../src/shared/models/assistant-message.js');

// No rAF shim needed — the renderer now updates signals directly on every
// delta so Preact's own batching handles rendering. The old rAF approach
// caused all deltas to accumulate and appear at once because the rAF
// macrotask never fired while readStream's microtask chain was hot.

test('appendDelta updates content immediately and concatenates deltas', () => {
  const model = createAssistantMessageModel();
  const renderer = createAssistantStreamRenderer({ model });

  renderer.appendDelta('Hel');
  assert.equal(model.content.value, 'Hel', 'first delta visible immediately');
  renderer.appendDelta('lo ');
  renderer.appendDelta('Thingy');
  assert.equal(model.content.value, 'Hello Thingy');
});

test('first delta flips status from pending to streaming', () => {
  const model = createAssistantMessageModel();
  const renderer = createAssistantStreamRenderer({ model });
  assert.equal(model.status.value, 'pending');
  renderer.appendDelta('hi');
  assert.equal(model.status.value, 'streaming');
});

test('appendDelta trims leading whitespace from the start of the answer', () => {
  const model = createAssistantMessageModel();
  const renderer = createAssistantStreamRenderer({ model });
  renderer.appendDelta('   leading');
  assert.equal(model.content.value, 'leading');
  renderer.appendDelta(' middle');
  assert.equal(model.content.value, 'leading middle');
});

test('setAnswer replaces content wholesale', () => {
  const model = createAssistantMessageModel();
  const renderer = createAssistantStreamRenderer({ model });
  renderer.appendDelta('partial');
  renderer.setAnswer('final answer');
  assert.equal(model.content.value, 'final answer');
});

test('setCitations updates the signal immediately', () => {
  const model = createAssistantMessageModel();
  const renderer = createAssistantStreamRenderer({ model });
  renderer.setCitations([{ id: 'c1' }, { id: 'c2' }]);
  assert.deepEqual(model.citations.value, [{ id: 'c1' }, { id: 'c2' }]);
});

test('setCitations coerces non-arrays to []', () => {
  const model = createAssistantMessageModel();
  const renderer = createAssistantStreamRenderer({ model });
  renderer.setCitations(null);
  assert.deepEqual(model.citations.value, []);
});

test('setExperience updates the signal immediately', () => {
  const model = createAssistantMessageModel();
  const renderer = createAssistantStreamRenderer({ model });
  const experience = { kind: 'spark', title: 'Spark' };
  renderer.setExperience(experience);
  assert.equal(model.experience.value, experience);
  renderer.setExperience(null);
  assert.equal(model.experience.value, null);
});

test('finish(done) sets status to done and returns current content', () => {
  const model = createAssistantMessageModel();
  const renderer = createAssistantStreamRenderer({ model });
  renderer.appendDelta('Hello');
  const result = renderer.finish();
  assert.equal(model.content.value, 'Hello');
  assert.equal(model.status.value, 'done');
  assert.equal(result.answer, 'Hello');
});

test('finish(stopped) preserves partial content and marks stopped', () => {
  const model = createAssistantMessageModel();
  const renderer = createAssistantStreamRenderer({ model });
  renderer.appendDelta('partial answer');
  renderer.finish('stopped');
  assert.equal(model.content.value, 'partial answer');
  assert.equal(model.status.value, 'stopped');
});

test('fail() records error + retry prompt at the current content', () => {
  const model = createAssistantMessageModel();
  const renderer = createAssistantStreamRenderer({ model });
  renderer.appendDelta('partial');
  renderer.fail('Stream lost.', 'original prompt');
  assert.equal(model.content.value, 'partial');
  assert.equal(model.errorMessage.value, 'Stream lost.');
  assert.equal(model.retryPrompt.value, 'original prompt');
  assert.equal(model.status.value, 'error');
});

test('fail() does not set retryPrompt when omitted', () => {
  const model = createAssistantMessageModel();
  const renderer = createAssistantStreamRenderer({ model });
  renderer.fail('Unavailable');
  assert.equal(model.errorMessage.value, 'Unavailable');
  assert.equal(model.retryPrompt.value, '');
});

test('status() appends an activity step and ensures streaming', () => {
  const model = createAssistantMessageModel();
  const renderer = createAssistantStreamRenderer({ model });
  renderer.status('Searching archive');
  assert.equal(model.status.value, 'streaming');
  assert.equal(model.activity.value.length, 1);
  assert.equal(model.activity.value[0].label, 'Searching archive');
});

test('label and statusFallback options carry into the model', () => {
  const model = createAssistantMessageModel();
  createAssistantStreamRenderer({ model, label: 'Welcome', statusFallback: 'getting oriented' });
  assert.equal(model.label.value, 'Welcome');
  assert.equal(model.statusFallback.value, 'getting oriented');
});

test('throws when constructed without a model', () => {
  assert.throws(() => createAssistantStreamRenderer({}), /requires a model/);
});
