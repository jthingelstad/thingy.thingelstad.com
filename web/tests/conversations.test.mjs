import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deleteConversationSummaryList,
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

  const result = upsertConversationSummaryList([local], {
    id: 'server-1',
    title: 'What Jamie means by RSS',
    updated_at: '2026-06-09T02:00:00.000Z'
  }, {
    activeConversationId: local.id,
    replaceId: local.id,
    maxRecents: 20
  });

  assert.equal(result.activeConversationId, 'server-1');
  assert.deepEqual(result.conversations.map((entry) => entry.id), ['server-1']);
  assert.equal(result.conversations[0].local, false);
});

test('deleteConversationSummaryList clears the active id only for the deleted conversation', () => {
  const rows = [
    { id: 'a', updated_at: '2026-06-09T02:00:00.000Z' },
    { id: 'b', updated_at: '2026-06-09T01:00:00.000Z' }
  ];

  const inactiveDelete = deleteConversationSummaryList(rows, 'b', { activeConversationId: 'a' });
  assert.equal(inactiveDelete.activeConversationId, 'a');
  assert.deepEqual(inactiveDelete.conversations.map((entry) => entry.id), ['a']);

  const activeDelete = deleteConversationSummaryList(rows, 'a', { activeConversationId: 'a' });
  assert.equal(activeDelete.activeConversationId, '');
  assert.deepEqual(activeDelete.conversations.map((entry) => entry.id), ['b']);
});
