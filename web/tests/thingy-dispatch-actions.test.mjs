import assert from 'node:assert/strict';
import test from 'node:test';

// The actions factory touches window.localStorage and timers; install
// minimal globals before importing.
function storage() {
  const values = new Map();
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, String(value))
  };
}
global.window = global.window || {};
global.window.localStorage = storage();
global.window.setInterval = () => 0;
global.window.clearInterval = () => {};

const {
  assistantClarificationText,
  clarifyRequest,
  createDispatchActions,
  draftTitle,
  inputPlaceholderForDraft,
  readyDispatchText,
  titleFromPrompt
} = await import('../src/shared/thingy-dispatch-actions.js');

const {
  dispatchBusy,
  dispatchInputDisabled,
  dispatchInputPlaceholder,
  dispatchMessages,
  drafts: draftsSignal,
  activeDraftId
} = await import('../src/shared/stores/dispatch-store.js');

test('titleFromPrompt collapses whitespace and caps at 80 chars', () => {
  assert.equal(titleFromPrompt('  What   about\nRSS?  '), 'What about RSS?');
  assert.equal(titleFromPrompt(''), 'Dispatch');
  assert.equal(titleFromPrompt('x'.repeat(200)).length, 80);
});

test('draftTitle prefers title, then prompt, then direction', () => {
  assert.equal(draftTitle({ title: 'T', prompt: 'P', direction: 'D' }), 'T');
  assert.equal(draftTitle({ prompt: 'P', direction: 'D' }), 'P');
  assert.equal(draftTitle({ direction: 'D' }), 'D');
  assert.equal(draftTitle({}), 'New Dispatch');
});

test('assistantClarificationText combines message and question when distinct', () => {
  assert.equal(
    assistantClarificationText({ message: 'Tell me more.', question: 'Which year?' }),
    'Tell me more.\n\nWhich year?'
  );
  assert.equal(
    assistantClarificationText({ message: 'Which year? Tell me.', question: 'Which year?' }),
    'Which year? Tell me.'
  );
  assert.equal(
    assistantClarificationText({}),
    'What angle should I use for this Dispatch?'
  );
});

test('readyDispatchText falls back to the shaped-direction copy for questions or generation claims', () => {
  assert.equal(readyDispatchText({ message: 'All shaped and ready.' }, 'dir'), 'All shaped and ready.');
  assert.match(readyDispatchText({ message: 'Ready? Generating now!' }, 'the direction'), /I have shaped this Dispatch direction/);
  assert.match(readyDispatchText({}, 'the direction'), /the direction/);
});

test('clarifyRequest treats needs_clarification as an answer to the open question', () => {
  const request = clarifyRequest({
    stage: 'needs_clarification',
    prompt: 'seed',
    direction: 'dir',
    currentQuestion: 'Which year?'
  }, '2024');
  assert.equal(request.prompt, 'seed');
  assert.equal(request.answer, '2024');
  assert.equal(request.nextQuestion, 'Which year?');
});

test('clarifyRequest treats ready-stage text as an adjustment', () => {
  const request = clarifyRequest({
    stage: 'ready',
    prompt: 'seed',
    direction: 'dir'
  }, 'tighter focus');
  assert.match(request.prompt, /Original Dispatch seed: seed/);
  assert.match(request.prompt, /Current confirmed direction: dir/);
  assert.match(request.prompt, /Reader adjustment: tighter focus/);
  assert.equal(request.answer, '');
  assert.equal(request.nextQuestion, '');
});

test('clarifyRequest starts fresh for an empty draft', () => {
  const request = clarifyRequest({ stage: 'empty' }, 'new topic');
  assert.equal(request.prompt, 'new topic');
  assert.equal(request.nextPrompt, 'new topic');
});

test('inputPlaceholderForDraft maps stages to placeholder copy', () => {
  assert.match(inputPlaceholderForDraft({ stage: 'sent' }, false), /Start a new Dispatch/);
  assert.match(inputPlaceholderForDraft({ stage: 'needs_clarification' }, true), /clarification question/);
  assert.match(inputPlaceholderForDraft({ stage: 'ready' }, true), /Adjust the direction/);
  assert.match(inputPlaceholderForDraft({ stage: 'empty' }, true), /Tell Thingy/);
});

function fakeSession(overrides = {}) {
  return {
    token: () => 'tok',
    tokenExpired: () => false,
    ensureFreshToken: async () => true,
    clearAuth: () => {},
    signInUrl: () => '/signin/',
    storedEmail: () => 'reader@example.com',
    storedProfile: () => ({}),
    persistAuth: () => {},
    authHeaders: () => ({}),
    postJson: async () => ({}),
    ...overrides
  };
}

test('createDraft activates a fresh draft and renders it into the signals', () => {
  dispatchBusy.value = false;
  const actions = createDispatchActions({
    session: fakeSession(),
    onRender: () => {}
  });
  actions.createDraft({ activate: true, render: false });
  actions.render();
  assert.equal(draftsSignal.value.length, 1);
  assert.equal(draftsSignal.value[0].title, 'New Dispatch');
  assert.equal(activeDraftId.value, draftsSignal.value[0].id);
  assert.equal(dispatchMessages.value.length, 1);
  assert.match(dispatchMessages.value[0].text, /make your first Dispatch/);
  assert.equal(dispatchInputDisabled.value, false);
  assert.match(dispatchInputPlaceholder.value, /Tell Thingy/);
});

test('createDraft gives later Dispatches contextual guided openings', () => {
  dispatchBusy.value = false;
  const actions = createDispatchActions({
    session: fakeSession(),
    onRender: () => {}
  });
  const first = actions.createDraft({ activate: true, render: false });
  actions.addMessage('user', 'Write about RSS');
  for (let index = 0; index < 5; index += 1) {
    actions.createDraft({ activate: true, render: false });
    actions.addMessage('user', `Dispatch seed ${index}`);
  }
  const seventh = actions.createDraft({ activate: true, render: false });

  assert.match(first.messages[0].text, /first Dispatch/);
  assert.match(seventh.messages[0].text, /seventh Dispatch/);
});

test('clarifyWithThingy moves an empty draft to ready and persists through the API', async () => {
  dispatchBusy.value = false;
  const calls = [];
  const session = fakeSession({
    postJson: async (path, payload) => {
      calls.push(payload.action);
      if (payload.action === 'clarify') {
        return { needs_clarification: false, direction: 'A focused direction', message: 'Shaped it.' };
      }
      return { dispatch: { id: 'srv-1' } };
    }
  });
  const actions = createDispatchActions({ session, onRender: () => {} });
  actions.createDraft({ activate: true, render: false });
  actions.addMessage('user', 'Write about RSS');
  await actions.clarifyWithThingy('Write about RSS');

  const draft = actions.activeDraft();
  assert.equal(draft.stage, 'ready');
  assert.equal(draft.direction, 'A focused direction');
  assert.deepEqual(calls.filter((c) => c === 'clarify'), ['clarify']);
  assert.ok(calls.includes('save_draft'), 'draft persisted to server');
  const lastMessage = dispatchMessages.value[dispatchMessages.value.length - 1];
  assert.equal(lastMessage.text, 'Shaped it.');
  assert.equal(dispatchBusy.value, false, 'busy resets after clarify');
});

test('clarifyWithThingy restores the previous stage when the API fails', async () => {
  dispatchBusy.value = false;
  const session = fakeSession({
    postJson: async (path, payload) => {
      if (payload.action === 'clarify') throw new Error('boom');
      return { dispatch: {} };
    }
  });
  const actions = createDispatchActions({ session, onRender: () => {} });
  actions.createDraft({ activate: true, render: false });
  await actions.clarifyWithThingy('topic');
  assert.equal(actions.activeDraft().stage, 'empty', 'stage rolled back');
  const lastMessage = dispatchMessages.value[dispatchMessages.value.length - 1];
  assert.equal(lastMessage.text, 'boom');
});

test('generateDispatch writes progress into the Dispatch transcript', async () => {
  dispatchBusy.value = false;
  const session = fakeSession({
    postJson: async (path, payload) => {
      if (payload.action === 'create') return { dispatch: { id: 'srv-1', status: 'queued' } };
      return { dispatch: { id: 'srv-1' } };
    }
  });
  const actions = createDispatchActions({ session, onRender: () => {} });
  const draft = actions.createDraft({ activate: true, render: false });
  Object.assign(draft, {
    stage: 'ready',
    prompt: 'Write about RSS',
    direction: 'A Dispatch about RSS'
  });

  await actions.generateDispatch();

  const progress = dispatchMessages.value.filter((message) => message.kind === 'progress');
  assert.deepEqual(progress.map((message) => message.id), ['generate-start', 'generate-save', 'generate-queue']);
  assert.match(progress[0].text, /saving the current direction/i);
  assert.match(progress[1].text, /generation request/i);
  assert.match(progress[2].text, /checking the generation status/i);
});

test('deleteDispatch respects the confirmDelete hook', async () => {
  dispatchBusy.value = false;
  let confirmed = false;
  const actions = createDispatchActions({
    session: fakeSession(),
    onRender: () => {},
    confirmDelete: () => confirmed
  });
  const draft = actions.createDraft({ activate: true, render: false });
  actions.addMessage('user', 'keep me honest');

  await actions.deleteDispatch(draft.id);
  assert.ok(actions.draftById(draft.id), 'declined confirm leaves the draft');

  confirmed = true;
  await actions.deleteDispatch(draft.id);
  assert.equal(actions.draftById(draft.id), undefined, 'confirmed delete removes the draft');
});
