import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const postJson = vi.fn();
vi.mock('../src/shared/thingy-session.ts', () => ({
  postJson: (...args: unknown[]) => postJson(...args),
  authHeaders: () => ({})
}));
const confirmDialog = vi.fn();
vi.mock('../src/shared/stores/dialog-store.ts', () => ({
  confirmDialog: (...args: unknown[]) => confirmDialog(...args)
}));

const { McpConnectionsSection, McpLogDialog } = await import('../src/react/McpConnections.tsx');

afterEach(() => {
  cleanup();
  postJson.mockReset();
  confirmDialog.mockReset();
});

const claude = {
  id: 'fam_claude_1234567890',
  client_id: 'client-claude',
  client_name: 'Claude',
  connected_at: '2026-09-28T12:00:00Z',
  call_count: 3
};

test('lists connections and disconnects one after confirmation', async () => {
  const user = userEvent.setup();
  postJson.mockResolvedValueOnce({ connections: [claude], retention_days: 45 });
  render(<McpConnectionsSection disabled={false} onOpenLog={() => {}} />);
  await screen.findByText('Claude');

  confirmDialog.mockResolvedValueOnce(true);
  postJson.mockResolvedValueOnce({ ok: true, connections: [] });
  await user.click(screen.getByRole('button', { name: 'Disconnect' }));
  await waitFor(() => expect(screen.queryByText('Claude')).toBeNull());
  expect(postJson).toHaveBeenLastCalledWith('/memory', { action: 'mcp_disconnect', connection_id: claude.id }, {});
  expect(screen.getByText(/No apps are connected/)).toBeTruthy();
});

test('a cancelled confirmation leaves the connection alone', async () => {
  const user = userEvent.setup();
  postJson.mockResolvedValueOnce({ connections: [claude], retention_days: 45 });
  render(<McpConnectionsSection disabled={false} onOpenLog={() => {}} />);
  await screen.findByText('Claude');
  confirmDialog.mockResolvedValueOnce(false);
  await user.click(screen.getByRole('button', { name: 'Disconnect' }));
  expect(postJson).toHaveBeenCalledTimes(1);
  expect(screen.getByText('Claude')).toBeTruthy();
});

test('the request log shows entries, filters by connection, and loads more', async () => {
  const user = userEvent.setup();
  postJson.mockResolvedValueOnce({
    entries: [
      {
        request_id: 'r1',
        created_at: '2026-10-01T15:00:00Z',
        tool_name: 'search_archive',
        status: 'ok',
        surface: 'mcp',
        client_name: 'Claude',
        connection_id: claude.id,
        duration_ms: 812,
        result_chars: 4210,
        arguments: { query: 'rss' }
      }
    ],
    next_cursor: 'cursor-2',
    retention_days: 45
  });
  render(<McpLogDialog connections={[claude]} onClose={() => {}} />);
  await screen.findByText('search_archive');
  expect(screen.getByText(/Kept for 45 days/)).toBeTruthy();
  expect(screen.getByText('query="rss"')).toBeTruthy();
  expect(screen.getByText('Claude · 812 ms · 4.2k chars')).toBeTruthy();

  postJson.mockResolvedValueOnce({
    entries: [
      {
        request_id: 'r0',
        created_at: '2026-09-30T15:00:00Z',
        tool_name: 'get_source',
        status: 'tool_error',
        surface: 'mcp',
        client_name: 'Claude'
      }
    ],
    next_cursor: '',
    retention_days: 45
  });
  await user.click(screen.getByRole('button', { name: 'Load more' }));
  await screen.findByText('get_source');
  expect(screen.getByText('search_archive')).toBeTruthy();
  expect(screen.getByText('tool_error')).toBeTruthy();
  expect(postJson.mock.calls[1][1]).toEqual({ action: 'mcp_log', limit: 50, cursor: 'cursor-2' });

  postJson.mockResolvedValueOnce({ entries: [], next_cursor: '', retention_days: 45 });
  await user.selectOptions(screen.getByRole('combobox'), claude.id);
  await screen.findByText('No MCP requests in this window.');
  expect(postJson.mock.calls[2][1]).toEqual({ action: 'mcp_log', limit: 50, connection_id: claude.id });
});
