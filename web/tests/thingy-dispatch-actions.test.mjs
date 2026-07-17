import assert from 'node:assert/strict';
import test from 'node:test';

// The actions factory touches window.localStorage and timers; install
// minimal globals before importing.
function storage() {
  const values = new Map();
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, String(value))
  };
}
global.window = global.window || {};
global.window.localStorage = storage();
global.window.setInterval = () => 0;
global.window.clearInterval = () => {};

const { createDispatchActions, dispatchBriefMarkdown, draftTitle, inputPlaceholderForDraft, titleFromPrompt } =
  await import('../src/shared/thingy-dispatch-actions.ts');
const { AGENT_RESPONSE_TIMEOUT_MS } = await import('../src/shared/thingy-timeouts.ts');

const {
  dispatchBusy,
  dispatchInputDisabled,
  dispatchInputPlaceholder,
  dispatchMessages,
  drafts: draftsSignal,
  activeDraftId
} = await import('../src/shared/stores/dispatch-store.ts');

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

test('dispatchBriefMarkdown renders goal, angle, fit, and sources', () => {
  const text = dispatchBriefMarkdown({
    user_goal: 'Understand RSS',
    working_angle: 'Connect RSS to ownership',
    coverage_status: 'focused',
    selected_sources: [{ label: 'WT10', title: 'Open web', why: 'Core source' }],
    excluded_scope: ['podcast detours']
  });
  assert.match(text, /\*\*Dispatch brief\*\*/);
  assert.match(text, /Understand RSS/);
  assert.match(text, /Connect RSS to ownership/);
  assert.match(text, /Archive fit:\*\* Focused/);
  assert.match(text, /WT10 - Open web: Core source/);
  assert.match(text, /podcast detours/);
  assert.equal(dispatchBriefMarkdown({}), '');
});

test('inputPlaceholderForDraft maps stages to placeholder copy', () => {
  assert.match(inputPlaceholderForDraft({ stage: 'sent' }, false), /Start a new Dispatch/);
  assert.match(inputPlaceholderForDraft({ stage: 'needs_clarification' }, true), /Answer Thingy/);
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

// Fake planner stream: postStream captures the request, readEvents replays
// a scripted event list into the handler.
function fakeStream(turns) {
  const requests = [];
  let turnIndex = 0;
  return {
    requests,
    postStream: async (request) => {
      requests.push(request);
      return { turn: turnIndex };
    },
    readEvents: async (response, onEvent) => {
      const events = turns[Math.min(turnIndex, turns.length - 1)];
      turnIndex += 1;
      for (const [eventName, data] of events) {
        if (eventName === '__throw__') throw new Error(String(data));
        await onEvent(eventName, data);
      }
    }
  };
}

function progressMessages() {
  return dispatchMessages.value.filter((message) => message.kind === 'progress');
}

test('createDraft activates a fresh draft and renders it into the signals', () => {
  dispatchBusy.value = false;
  const actions = createDispatchActions({
    session: fakeSession(),
    streamBase: 'https://stream.test',
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
    streamBase: 'https://stream.test',
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

test('planWithThingy streams a planning turn into a ready draft', async () => {
  dispatchBusy.value = false;
  const saves = [];
  const session = fakeSession({
    postJson: async (path, payload) => {
      if (payload.action === 'save_draft') saves.push(payload);
      return { dispatch: { id: 'srv-1' } };
    }
  });
  const stream = fakeStream([
    [
      ['meta', { conversation_id: 'conv-1', mode: 'dispatch' }],
      ['status', { kind: 'tool', tool_name: 'check_dispatch_fit', message: 'Checking dispatch fit...' }],
      ['answer_delta', { delta: 'The archive is focused here. ' }],
      ['answer_delta', { delta: 'Brief is ready to lock.' }],
      [
        'dispatch_brief',
        {
          status: 'ready',
          brief: {
            user_goal: 'Understand RSS',
            working_angle: 'Connect RSS to ownership and publishing',
            coverage_status: 'focused',
            generation_instructions: 'Trace the RSS thread with dates and links.',
            selected_sources: [{ id: 'S1', label: 'WT10', title: 'Open web', why: 'Core source' }],
            status: 'ready'
          }
        }
      ],
      ['done', { request_id: 'req-1' }]
    ]
  ]);
  const actions = createDispatchActions({
    session,
    streamBase: 'https://stream.test',
    postStream: stream.postStream,
    readEvents: stream.readEvents,
    onRender: () => {},
    activeKey: 'plan-ready-test'
  });
  actions.createDraft({ activate: true, render: false });
  actions.addMessage('user', 'Write about RSS');
  await actions.planWithThingy('Write about RSS');

  const draft = actions.activeDraft();
  assert.equal(draft.stage, 'ready');
  assert.equal(draft.conversationId, 'conv-1');
  assert.equal(draft.direction, 'Connect RSS to ownership and publishing');
  assert.equal(draft.brief.coverage_status, 'focused');

  const request = stream.requests[0];
  assert.equal(request.path, '/chat');
  assert.equal(request.baseUrl, 'https://stream.test');
  assert.equal(request.payload.mode, 'dispatch');
  assert.equal(request.payload.message, 'Write about RSS');
  assert.equal(request.payload.conversation_id, undefined);
  assert.equal(request.timeoutMs, AGENT_RESPONSE_TIMEOUT_MS);
  assert.equal(request.headers.authorization, 'Bearer tok');

  const assistant = dispatchMessages.value.filter((message) => message.role === 'assistant' && !message.kind);
  assert.equal(assistant.at(-1).text, 'The archive is focused here. Brief is ready to lock.');
  assert.ok(dispatchMessages.value.some((message) => message.kind === 'brief' && /Dispatch brief/.test(message.text)));
  const progress = progressMessages();
  assert.equal(progress.length, 1);
  assert.equal(progress[0].status, 'complete');

  const finalSave = saves.at(-1);
  assert.equal(finalSave.status, 'ready');
  assert.equal(finalSave.conversation_id, 'conv-1');
  assert.equal(finalSave.brief.working_angle, 'Connect RSS to ownership and publishing');
  assert.equal(dispatchBusy.value, false, 'busy resets after planning');
});

test('planWithThingy keeps the conversation across turns and updates the brief card in place', async () => {
  dispatchBusy.value = false;
  const session = fakeSession({
    postJson: async () => ({ dispatch: { id: 'srv-2' } })
  });
  const stream = fakeStream([
    [
      ['meta', { conversation_id: 'conv-2' }],
      ['answer_delta', { delta: 'RSS is broad. Which angle?' }],
      [
        'dispatch_brief',
        {
          status: 'draft',
          brief: {
            user_goal: 'RSS Dispatch',
            working_angle: 'RSS broadly',
            coverage_status: 'broad',
            generation_instructions: 'TBD',
            status: 'draft'
          }
        }
      ],
      ['done', {}]
    ],
    [
      ['meta', { conversation_id: 'conv-2' }],
      ['answer_delta', { delta: 'Narrowed to ownership. Ready.' }],
      [
        'dispatch_brief',
        {
          status: 'ready',
          brief: {
            user_goal: 'RSS Dispatch',
            working_angle: 'RSS and ownership',
            coverage_status: 'focused',
            generation_instructions: 'Trace it.',
            selected_sources: [{ id: 'S1', title: 'Open web', url: 'https://example.com' }],
            status: 'ready'
          }
        }
      ],
      ['done', {}]
    ]
  ]);
  const actions = createDispatchActions({
    session,
    streamBase: 'https://stream.test',
    postStream: stream.postStream,
    readEvents: stream.readEvents,
    onRender: () => {},
    activeKey: 'plan-turns-test'
  });
  actions.createDraft({ activate: true, render: false });

  actions.addMessage('user', 'Write about RSS');
  await actions.planWithThingy('Write about RSS');
  assert.equal(actions.activeDraft().stage, 'needs_clarification');

  actions.addMessage('user', 'Focus on ownership');
  await actions.planWithThingy('Focus on ownership');

  assert.equal(stream.requests[1].payload.conversation_id, 'conv-2');
  assert.equal(actions.activeDraft().stage, 'ready');
  const briefCards = dispatchMessages.value.filter((message) => message.kind === 'brief');
  assert.equal(briefCards.length, 1, 'one brief card updated in place');
  assert.match(briefCards[0].text, /RSS and ownership/);
});

test('planWithThingy restores the previous stage when the stream fails', async () => {
  dispatchBusy.value = false;
  const session = fakeSession();
  const stream = fakeStream([
    [
      ['meta', { conversation_id: 'conv-3' }],
      ['__throw__', 'boom']
    ]
  ]);
  const actions = createDispatchActions({
    session,
    streamBase: 'https://stream.test',
    postStream: stream.postStream,
    readEvents: stream.readEvents,
    onRender: () => {},
    activeKey: 'plan-fail-test'
  });
  actions.createDraft({ activate: true, render: false });
  await actions.planWithThingy('topic');
  assert.equal(actions.activeDraft().stage, 'empty', 'stage rolled back');
  const progress = progressMessages();
  assert.deepEqual(
    progress.map((message) => message.status),
    ['failed']
  );
  const lastMessage = dispatchMessages.value[dispatchMessages.value.length - 1];
  assert.equal(lastMessage.text, 'boom');
});

test('generateDispatch writes progress into the Dispatch transcript', async () => {
  dispatchBusy.value = false;
  const payloads = [];
  const session = fakeSession({
    postJson: async (path, payload) => {
      payloads.push(payload);
      if (payload.action === 'create') return { dispatch: { id: 'srv-1', status: 'queued' } };
      return { dispatch: { id: 'srv-1' } };
    }
  });
  const actions = createDispatchActions({ session, streamBase: 'https://stream.test', onRender: () => {} });
  const draft = actions.createDraft({ activate: true, render: false });
  Object.assign(draft, {
    stage: 'ready',
    prompt: 'Write about RSS',
    direction: 'A Dispatch about RSS',
    brief: {
      coverage_status: 'focused',
      selected_sources: [{ label: 'WT10', title: 'Open web' }]
    }
  });

  await actions.generateDispatch();

  const progress = progressMessages();
  assert.deepEqual(
    progress.map((message) => message.baseId || message.id),
    ['generate-start', 'generate-save', 'generate-queue']
  );
  assert.ok(
    progress.every((message) => String(message.id).startsWith('generate-1:')),
    'generation progress rows are scoped to the run'
  );
  assert.equal(progress[0].status, 'complete');
  assert.equal(progress[1].status, 'complete');
  assert.equal(progress[2].status, 'complete');
  assert.match(progress[0].text, /brief we shaped/i);
  assert.match(progress[0].text, /Archive fit: Focused/i);
  assert.match(progress[1].text, /direction and brief/i);
  assert.match(progress[2].text, /checking the generation status/i);
  const createPayload = payloads.find((payload) => payload.action === 'create');
  assert.equal(createPayload.brief.coverage_status, 'focused');
});

test('deleteDispatch respects the confirmDelete hook', async () => {
  dispatchBusy.value = false;
  let confirmed = false;
  const actions = createDispatchActions({
    session: fakeSession(),
    streamBase: 'https://stream.test',
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
