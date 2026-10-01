import assert from 'node:assert/strict';
import test from 'node:test';

import {
  WEB_SURFACE_FILTER,
  connectionLabel,
  connectionSummary,
  disconnectMcpConnection,
  fetchMcpConnections,
  fetchMcpLog,
  formatArguments,
  formatResultSize,
  formatWhen,
  logEntryConnectionLabel
} from '../src/shared/thingy-mcp-account.ts';

function fakeSession(response) {
  const calls = [];
  return {
    calls,
    authHeaders: () => ({ authorization: 'Bearer test' }),
    postJson: async (path, payload, headers) => {
      calls.push({ path, payload, headers });
      return response;
    }
  };
}

test('fetchMcpConnections asks /memory for the connection list', async () => {
  const session = fakeSession({
    connections: [{ id: 'fam_1234567890abcdef', client_name: 'Claude' }],
    retention_days: 45
  });
  const result = await fetchMcpConnections(session);
  assert.deepEqual(session.calls, [
    { path: '/memory', payload: { action: 'mcp_connections' }, headers: { authorization: 'Bearer test' } }
  ]);
  assert.equal(result.connections.length, 1);
  assert.equal(result.retentionDays, 45);
});

test('disconnectMcpConnection sends the connection id and returns the remaining list', async () => {
  const session = fakeSession({ ok: true, connections: [] });
  const remaining = await disconnectMcpConnection(session, 'fam_1234567890abcdef');
  assert.deepEqual(session.calls[0].payload, { action: 'mcp_disconnect', connection_id: 'fam_1234567890abcdef' });
  assert.deepEqual(remaining, []);
});

test('fetchMcpLog maps the filter to connection_id or surface and passes the cursor', async () => {
  const session = fakeSession({ entries: [], next_cursor: 'abc', retention_days: 45 });
  await fetchMcpLog(session);
  await fetchMcpLog(session, { filter: 'fam_1234567890abcdef', cursor: 'xyz' });
  await fetchMcpLog(session, { filter: WEB_SURFACE_FILTER });
  assert.deepEqual(
    session.calls.map((call) => call.payload),
    [
      { action: 'mcp_log', limit: 50 },
      { action: 'mcp_log', limit: 50, cursor: 'xyz', connection_id: 'fam_1234567890abcdef' },
      { action: 'mcp_log', limit: 50, surface: 'web' }
    ]
  );
  const page = await fetchMcpLog(session);
  assert.equal(page.nextCursor, 'abc');
});

test('labels fall back when a client registered no name', () => {
  assert.equal(connectionLabel({ client_name: ' Claude ' }), 'Claude');
  assert.equal(connectionLabel({ client_name: '' }), 'Unnamed MCP client');
  assert.equal(logEntryConnectionLabel({ surface: 'web', client_name: 'x' }), 'Thingy page (WebMCP)');
  assert.equal(logEntryConnectionLabel({ surface: 'mcp', client_name: 'ChatGPT' }), 'ChatGPT');
});

test('connectionSummary reads connected, last used, and call count', () => {
  const now = new Date('2026-10-01T12:00:00Z');
  assert.equal(
    connectionSummary(
      {
        id: 'a',
        client_id: 'c',
        client_name: 'Claude',
        connected_at: '2026-09-28T12:00:00Z',
        last_used_at: '2026-10-01T11:00:00Z',
        call_count: 12
      },
      now
    ),
    'Connected 3 days ago · last used 1 hour ago · 12 calls'
  );
  assert.equal(
    connectionSummary({ id: 'a', client_id: 'c', client_name: 'Claude', connected_at: '2026-10-01T11:59:30Z' }, now),
    'Connected just now · not used yet'
  );
  assert.equal(formatWhen('not a date', now), '');
});

test('formatArguments renders one compact line and clips long values', () => {
  assert.equal(formatArguments({ query: 'rss', year: 2014 }), 'query="rss" · year=2014');
  assert.equal(formatArguments(null), '');
  assert.equal(formatArguments(['a']), '');
  const long = formatArguments({ query: 'x'.repeat(200) });
  assert.ok(long.length < 100);
  assert.ok(long.endsWith('…"'));
});

test('formatResultSize abbreviates thousands', () => {
  assert.equal(formatResultSize(0), '');
  assert.equal(formatResultSize(812), '812 chars');
  assert.equal(formatResultSize(4210), '4.2k chars');
  assert.equal(formatResultSize(38000), '38k chars');
});
