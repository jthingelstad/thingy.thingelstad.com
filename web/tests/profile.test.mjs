import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatActiveSpan,
  formatCardIssued,
  formatChatModel,
  formatDailyQuota,
  formatProfileActivity,
  usageMeters
} from '../src/shared/thingy-profile.ts';

test("Today's usage writes counts with a thousands separator", () => {
  const sentence = formatDailyQuota({
    quota: { chat_used: 18, chat_max: 100, tokens_today: 41_000, mcp_used: 37, mcp_max: 1000 }
  });
  assert.equal(
    sentence,
    '18 of 100 chat turns · 41k tokens · 37 of 1,000 MCP tool calls used today. Resets at midnight UTC.'
  );
});

test("Today's usage separates thousands in every count", () => {
  const sentence = formatDailyQuota({
    quota: { chat_used: 1234, chat_max: 2000, tokens_today: 0, mcp_used: 1500, mcp_max: 10_000 }
  });
  assert.equal(
    sentence,
    '1,234 of 2,000 chat turns · 1,500 of 10,000 MCP tool calls used today. Resets at midnight UTC.'
  );
});

test("Today's usage leaves MCP out until a call is made, and is empty without a limit", () => {
  assert.equal(
    formatDailyQuota({ quota: { chat_used: 0, chat_max: 50, mcp_used: 0, mcp_max: 500 } }),
    '0 of 50 chat turns used today. Resets at midnight UTC.'
  );
  assert.equal(formatDailyQuota({ quota: { chat_used: 0, chat_max: 0 } }), '');
  assert.equal(formatDailyQuota({}), '');
});

test('the owner account reports turns without limits', () => {
  assert.equal(
    formatDailyQuota({ quota: { unlimited: true, turns_today: 0 } }),
    'Quiet so far today - and no limits on the owner account.'
  );
  assert.equal(
    formatDailyQuota({ quota: { unlimited: true, turns_today: 1200, tokens_today: 2_500_000 } }),
    '1,200 chat turns · 2.5M tokens today. No limits on the owner account.'
  );
});

test('usage meters mirror the sentence and nothing more', () => {
  assert.deepEqual(usageMeters({ quota: { chat_used: 18, chat_max: 100, mcp_used: 37, mcp_max: 1000 } }), [
    { kind: 'chat', label: 'Chat turns', value: '18 / 100', percent: 18 },
    { kind: 'mcp', label: 'MCP tool calls', value: '37 / 1,000', percent: 3.7 }
  ]);
  // No MCP calls: the sentence leaves MCP out, so the meters do too.
  assert.deepEqual(
    usageMeters({ quota: { chat_used: 60, chat_max: 50, mcp_used: 0, mcp_max: 500 } }).map((m) => [m.kind, m.percent]),
    [['chat', 100]]
  );
  assert.deepEqual(usageMeters({ quota: { unlimited: true, turns_today: 4 } }), []);
  assert.deepEqual(usageMeters({}), []);
});

test('the library card stamps First seen as a short date', () => {
  assert.equal(formatCardIssued('2026-09-02T20:14:03Z'), 'Sep 2, 2026');
  assert.equal(formatCardIssued(''), '');
  assert.equal(formatCardIssued('not a date'), '');
});

test('activity and span sentences keep their wording', () => {
  assert.equal(
    formatProfileActivity({ memory_turn_count: 1460, conversation_count: 23, conversation_turn_count: 131 }),
    'You and Thingy have traded 1,460 turns. 23 saved conversations holding 131 turns.'
  );
  assert.equal(formatProfileActivity({}, {}), 'No turns together yet. No saved conversations yet.');
  assert.equal(formatActiveSpan('2026-09-02T20:00:00Z', '2026-10-01T14:00:00Z'), '28 days, 18 hours');
  assert.equal(formatActiveSpan('', ''), 'Just getting started');
});

test('the AI model row names the premium tier for members', () => {
  const account = { chat_model: { label: 'Claude Opus', premium: true } };
  assert.equal(formatChatModel(account, true), 'Claude Opus — premium model, included with your membership');
  assert.equal(formatChatModel(account, false), 'Claude Opus — premium model');
  assert.equal(formatChatModel({ chat_model: { label: 'Claude Sonnet' } }), 'Claude Sonnet');
  assert.equal(formatChatModel({}), '');
});
