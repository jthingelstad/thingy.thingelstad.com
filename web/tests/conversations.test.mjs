import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createLocalConversation,
  dedupeEmptyConversationDrafts,
  deleteConversationSummaryList,
  isEmptyConversationDraft,
  upsertConversationSummaryList
} from '../src/shared/thingy-conversations.js';

test('upsertConversationSummaryList replaces a local draft with the server conversation', () => {
  const local = {
    id: 'local-chat-1',
    conversation_id: 'local-chat-1',
    title: 'New chat',
    mode: 'thingy',
    updated_at: '2026-06-09T01:00:00.000Z',
    turn_count: 0
  };

  const result = upsertConversationSummaryList(
    [local],
    {
      id: 'server-1',
      title: 'What Jamie means by RSS',
      updated_at: '2026-06-09T02:00:00.000Z'
    },
    {
      activeConversationId: local.id,
      replaceId: local.id,
      maxRecents: 20
    }
  );

  assert.equal(result.activeConversationId, 'server-1');
  assert.deepEqual(
    result.conversations.map((entry) => entry.id),
    ['server-1']
  );
  assert.equal(result.conversations[0].local, false);
});

test('createLocalConversation marks the shell as an explicit draft', () => {
  const shell = createLocalConversation({ mode: 'thingy' });
  assert.equal(shell.draft, true);
  assert.equal(isEmptyConversationDraft(shell), true);
});

test('a user-titled conversation is never treated as an empty draft', () => {
  const renamed = {
    id: 'server-1',
    title: 'New chat',
    mode: 'thingy',
    turn_count: 0,
    draft: false
  };
  assert.equal(isEmptyConversationDraft(renamed), false);
  const deduped = dedupeEmptyConversationDrafts([
    renamed,
    { id: 'local-chat-2', title: 'New chat', mode: 'thingy', turn_count: 0, draft: true }
  ]);
  assert.deepEqual(
    deduped.map((entry) => entry.id),
    ['server-1', 'local-chat-2']
  );
});

test('explicit drafts dedupe to one per mode, preferring the active conversation', () => {
  const list = [
    { id: 'local-chat-1', title: 'New chat', mode: 'thingy', turn_count: 0, draft: true },
    { id: 'local-chat-2', title: 'New chat', mode: 'thingy', turn_count: 0, draft: true }
  ];
  const deduped = dedupeEmptyConversationDrafts(list, { activeConversationId: 'local-chat-2' });
  assert.deepEqual(
    deduped.map((entry) => entry.id),
    ['local-chat-2']
  );
});

test('deleteConversationSummaryList clears the active id only for the deleted conversation', () => {
  const rows = [
    { id: 'a', updated_at: '2026-06-09T02:00:00.000Z' },
    { id: 'b', updated_at: '2026-06-09T01:00:00.000Z' }
  ];

  const inactiveDelete = deleteConversationSummaryList(rows, 'b', { activeConversationId: 'a' });
  assert.equal(inactiveDelete.activeConversationId, 'a');
  assert.deepEqual(
    inactiveDelete.conversations.map((entry) => entry.id),
    ['a']
  );

  const activeDelete = deleteConversationSummaryList(rows, 'a', { activeConversationId: 'a' });
  assert.equal(activeDelete.activeConversationId, '');
  assert.deepEqual(
    activeDelete.conversations.map((entry) => entry.id),
    ['b']
  );
});
