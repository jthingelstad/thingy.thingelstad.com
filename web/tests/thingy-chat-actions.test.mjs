import assert from 'node:assert/strict';
import test from 'node:test';

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

const { chatState, createChatActions } = await import('../src/shared/thingy-chat-actions.js');
const {
  activeConversationId,
  conversations
} = await import('../src/shared/stores/chat-store.js');

function fakeSession(overrides = {}) {
  return {
    normalizeEmail: (value) => String(value || '').trim().toLowerCase(),
    token: () => 'tok',
    tokenExpired: () => false,
    tokenNeedsRefresh: () => false,
    storedEmail: () => 'reader@example.com',
    storedProfile: () => ({}),
    updateStoredProfile: () => ({}),
    mergeProfile: (data) => data?.profile || {},
    persistAuth: () => {},
    clearAuth: () => {},
    refreshAuth: async () => null,
    signInUrl: () => '/signin/',
    authHeaders: () => ({}),
    postJson: async () => ({}),
    ...overrides
  };
}

function freshActions(overrides = {}) {
  conversations.value = [];
  activeConversationId.value = null;
  return createChatActions({
    session: fakeSession(overrides.session || {}),
    streamBase: 'https://stream.example',
    ui: { currentScope: () => 'all', ...(overrides.ui || {}) }
  });
}

test('createLocalConversationShell notifies the conversations signal', () => {
  const actions = freshActions();
  let notifications = 0;
  const unsubscribe = conversations.subscribe(() => { notifications += 1; });
  const before = notifications;
  const shell = actions.createLocalConversationShell('thingy');
  unsubscribe();
  assert.ok(notifications > before, 'signal notified on shell creation');
  assert.equal(chatState.activeConversationId, shell.id);
  assert.equal(chatState.conversations[0].id, shell.id);
  assert.equal(shell.draft, true);
});

test('renameConversation (local) replaces the entry immutably and notifies', async () => {
  const actions = freshActions();
  const shell = actions.createLocalConversationShell('thingy');
  const originalEntry = chatState.conversations[0];
  let notifications = 0;
  const unsubscribe = conversations.subscribe(() => { notifications += 1; });
  const before = notifications;
  const ok = await actions.renameConversation(shell.id, 'My renamed chat');
  unsubscribe();
  assert.equal(ok, true);
  assert.ok(notifications > before, 'signal notified on rename');
  const renamed = chatState.conversations.find((entry) => entry.id === shell.id);
  assert.equal(renamed.title, 'My renamed chat');
  assert.equal(renamed.draft, false, 'renamed conversation is no longer a draft');
  assert.notEqual(renamed, originalEntry, 'entry object replaced, not mutated');
});

test('deleteConversation (local) removes the entry and reports wasActive', async () => {
  const actions = freshActions();
  const shell = actions.createLocalConversationShell('thingy');
  const result = await actions.deleteConversation(shell.id);
  assert.deepEqual(result, { ok: true, wasActive: true });
  assert.equal(chatState.conversations.length, 0);
});

test('deleteConversation (server) round-trips the API and surfaces failures', async () => {
  const calls = [];
  const actions = freshActions({
    session: {
      postJson: async (path, payload) => {
        calls.push(payload);
        if (payload.action === 'delete' && payload.conversation_id === 'boom') {
          const error = new Error('nope');
          throw error;
        }
        return {};
      }
    }
  });
  conversations.value = [
    { id: 'srv-1', conversation_id: 'srv-1', title: 'Kept', turn_count: 2 },
    { id: 'boom', conversation_id: 'boom', title: 'Fails', turn_count: 1 }
  ];
  const ok = await actions.deleteConversation('srv-1');
  assert.equal(ok.ok, true);
  assert.equal(chatState.conversations.length, 1);

  const failed = await actions.deleteConversation('boom');
  assert.equal(failed.ok, false);
  assert.equal(chatState.conversations.length, 1, 'failed delete leaves the entry');
  assert.equal(calls.filter((c) => c.action === 'delete').length, 2);
});

test('upsertPendingConversation replaces the active local shell with the server id', () => {
  const actions = freshActions();
  const shell = actions.createLocalConversationShell('thingy');
  actions.upsertPendingConversation({
    conversationId: 'srv-9',
    title: 'What about RSS?',
    scope: 'all',
    mode: 'thingy'
  });
  assert.equal(chatState.activeConversationId, 'srv-9');
  assert.equal(chatState.conversations.some((entry) => entry.id === shell.id), false, 'local shell replaced');
  const entry = chatState.conversations.find((e) => e.id === 'srv-9');
  assert.equal(entry.title, 'What about RSS?');
  assert.equal(entry.draft, false);
});

test('validateEmail writes the inline error signal', async () => {
  const actions = freshActions();
  const { authEmail, authEmailError } = await import('../src/shared/stores/chat-store.js');
  authEmail.value = 'not-an-email';
  assert.equal(actions.validateEmail(), false);
  assert.match(authEmailError.value, /valid email/);
  authEmail.value = 'reader@example.com';
  assert.equal(actions.validateEmail(), true);
  assert.equal(authEmailError.value, '');
});
