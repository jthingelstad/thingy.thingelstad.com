import assert from 'node:assert/strict';
import test from 'node:test';

// The stream renderer schedules flushes through window.requestAnimationFrame,
// so install a manual frame controller before importing it.
function installFrameController() {
  let nextId = 1;
  const pending = new Map();
  global.window = global.window || {};
  global.window.requestAnimationFrame = (cb) => {
    const id = nextId++;
    pending.set(id, cb);
    return id;
  };
  global.window.cancelAnimationFrame = (id) => {
    pending.delete(id);
  };
  return {
    flush() {
      const callbacks = Array.from(pending.values());
      pending.clear();
      for (const cb of callbacks) cb(performance.now());
    },
    pendingCount() {
      return pending.size;
    },
    reset() {
      pending.clear();
    }
  };
}

const frame = installFrameController();

const { createAssistantStreamRenderer } = await import('../src/shared/thingy-chat-stream-renderer.js');
const { createAssistantMessageModel } = await import('../src/shared/models/assistant-message.js');

test('appendDelta buffers content and flushes via rAF', () => {
  frame.reset();
  const model = createAssistantMessageModel();
  const renderer = createAssistantStreamRenderer({ model });

  renderer.appendDelta('Hel');
  renderer.appendDelta('lo ');
  renderer.appendDelta('Thingy');
  // Buffered, not yet flushed.
  assert.equal(model.content.value, '');
  assert.equal(frame.pendingCount(), 1, 'one rAF scheduled across many deltas');

  frame.flush();
  assert.equal(model.content.value, 'Hello Thingy');
});

test('first content flip moves status from pending to streaming', () => {
  frame.reset();
  const model = createAssistantMessageModel();
  const renderer = createAssistantStreamRenderer({ model });
  assert.equal(model.status.value, 'pending');

  renderer.appendDelta('hi');
  assert.equal(model.status.value, 'streaming');
  frame.flush();
});

test('appendDelta trims leading whitespace at the start of the buffer', () => {
  frame.reset();
  const model = createAssistantMessageModel();
  const renderer = createAssistantStreamRenderer({ model });
  renderer.appendDelta('   leading');
  frame.flush();
  assert.equal(model.content.value, 'leading');
});

test('setAnswer replaces the buffer wholesale', () => {
  frame.reset();
  const model = createAssistantMessageModel();
  const renderer = createAssistantStreamRenderer({ model });

  renderer.appendDelta('partial');
  renderer.setAnswer('final answer');
  frame.flush();
  assert.equal(model.content.value, 'final answer');
});

test('setCitations updates immediately (no rAF needed)', () => {
  frame.reset();
  const model = createAssistantMessageModel();
  const renderer = createAssistantStreamRenderer({ model });
  renderer.setCitations([{ id: 'c1' }, { id: 'c2' }]);
  assert.deepEqual(model.citations.value, [{ id: 'c1' }, { id: 'c2' }]);
  // No rAF scheduled — citation updates are infrequent and benefit from
  // immediate visibility.
  assert.equal(frame.pendingCount(), 0);
});

test('setCitations coerces non-arrays to []', () => {
  frame.reset();
  const model = createAssistantMessageModel();
  const renderer = createAssistantStreamRenderer({ model });
  renderer.setCitations(null);
  assert.deepEqual(model.citations.value, []);
});

test('setExperience updates the signal immediately', () => {
  frame.reset();
  const model = createAssistantMessageModel();
  const renderer = createAssistantStreamRenderer({ model });
  const experience = { kind: 'spark', title: 'Spark' };
  renderer.setExperience(experience);
  assert.equal(model.experience.value, experience);
  renderer.setExperience(null);
  assert.equal(model.experience.value, null);
});

test('finish(done) flushes the pending buffer and sets status', () => {
  frame.reset();
  const model = createAssistantMessageModel();
  const renderer = createAssistantStreamRenderer({ model });

  renderer.appendDelta('Hello');
  assert.equal(frame.pendingCount(), 1);
  const result = renderer.finish();
  // Pending frame cancelled, buffer flushed inline.
  assert.equal(frame.pendingCount(), 0);
  assert.equal(model.content.value, 'Hello');
  assert.equal(model.status.value, 'done');
  assert.equal(result.answer, 'Hello');
});

test('finish(stopped) preserves partial content and marks stopped', () => {
  frame.reset();
  const model = createAssistantMessageModel();
  const renderer = createAssistantStreamRenderer({ model });
  renderer.appendDelta('partial answer');
  renderer.finish('stopped');
  assert.equal(model.content.value, 'partial answer');
  assert.equal(model.status.value, 'stopped');
});

test('fail() preserves partial content and records error + retry prompt', () => {
  frame.reset();
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
  frame.reset();
  const model = createAssistantMessageModel();
  const renderer = createAssistantStreamRenderer({ model });
  renderer.fail('Unavailable');
  assert.equal(model.errorMessage.value, 'Unavailable');
  assert.equal(model.retryPrompt.value, '');
});

test('status() appends an activity step and ensures streaming', () => {
  frame.reset();
  const model = createAssistantMessageModel();
  const renderer = createAssistantStreamRenderer({ model });
  renderer.status('Searching archive');
  assert.equal(model.status.value, 'streaming');
  assert.equal(model.activity.value.length, 1);
  assert.equal(model.activity.value[0].label, 'Searching archive');
});

test('label and statusFallback options carry into the model', () => {
  frame.reset();
  const model = createAssistantMessageModel();
  createAssistantStreamRenderer({ model, label: 'Welcome', statusFallback: 'getting oriented' });
  assert.equal(model.label.value, 'Welcome');
  assert.equal(model.statusFallback.value, 'getting oriented');
});

test('throws when constructed without a model', () => {
  assert.throws(() => createAssistantStreamRenderer({}), /requires a model/);
});
