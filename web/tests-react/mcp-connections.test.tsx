import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';

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

// Answer each /memory action from its own queue: the apps block and the
// connection list load in whichever order React runs their effects.
function answer(queues: Record<string, unknown[]>) {
  postJson.mockImplementation(async (_path: string, payload: { action: string }) => {
    const queue = queues[payload.action];
    if (!queue?.length) throw new Error(`unexpected ${payload.action}`);
    return queue.length > 1 ? queue.shift() : queue[0];
  });
}
const calls = (action: string) =>
  postJson.mock.calls.filter((call) => (call[1] as { action: string }).action === action);

const claude = {
  id: 'fam_claude_1234567890',
  client_id: 'client-claude',
  client_name: 'Claude',
  connected_at: '2026-09-28T12:00:00Z',
  call_count: 3
};

test('closing the request log returns keyboard focus to its opening control', async () => {
  const user = userEvent.setup();
  postJson.mockResolvedValue({ entries: [], retention_days: 45 });
  function LogHarness() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button onClick={() => setOpen(true)}>View MCP request log</button>
        {open ? <McpLogDialog connections={[]} onClose={() => setOpen(false)} /> : null}
      </>
    );
  }
  render(<LogHarness />);
  const opener = screen.getByRole('button', { name: 'View MCP request log' });
  await user.click(opener);
  await screen.findByText('No MCP requests in this window.');
  await user.click(screen.getByRole('button', { name: 'Close MCP request log' }));
  await waitFor(() => expect(document.activeElement).toBe(opener));
});

test('lists connections and disconnects one after confirmation', async () => {
  const user = userEvent.setup();
  answer({
    mcp_connections: [{ connections: [claude], retention_days: 45 }],
    mcp_clients: [{ clients: [] }],
    mcp_disconnect: [{ ok: true, connections: [] }]
  });
  render(<McpConnectionsSection disabled={false} onOpenLog={() => {}} />);
  await screen.findByText('Claude');

  confirmDialog.mockResolvedValueOnce(true);
  await user.click(screen.getByRole('button', { name: 'Disconnect' }));
  await waitFor(() => expect(screen.queryByText('Claude')).toBeNull());
  expect(postJson).toHaveBeenLastCalledWith('/memory', { action: 'mcp_disconnect', connection_id: claude.id }, {});
  expect(screen.getByText(/No apps are connected/)).toBeTruthy();
});

test('a cancelled confirmation leaves the connection alone', async () => {
  const user = userEvent.setup();
  answer({ mcp_connections: [{ connections: [claude], retention_days: 45 }], mcp_clients: [{ clients: [] }] });
  render(<McpConnectionsSection disabled={false} onOpenLog={() => {}} />);
  await screen.findByText('Claude');
  confirmDialog.mockResolvedValueOnce(false);
  await user.click(screen.getByRole('button', { name: 'Disconnect' }));
  expect(calls('mcp_disconnect')).toHaveLength(0);
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

const settings = {
  client_id: 'ReaderClientIdForTestsAb',
  client_secret: '',
  authorization_url: 'https://librarian.thingelstad.com/authorize',
  token_url: 'https://librarian.thingelstad.com/token',
  mcp_url: 'https://librarian.thingelstad.com/mcp',
  scope: 'archive:read',
  pkce: true
};
const app = {
  client_id: settings.client_id,
  client_name: 'My agent',
  redirect_uri: 'https://agent.example.com/callback',
  created_at: '2026-10-01T21:00:00Z',
  connection_count: 0,
  settings
};

test('setting up an app sends the name and callback and opens the values to copy', async () => {
  const user = userEvent.setup();
  answer({
    mcp_connections: [{ connections: [], retention_days: 45 }],
    mcp_clients: [{ clients: [] }],
    mcp_register_client: [{ client: app, clients: [app] }]
  });
  render(<McpConnectionsSection disabled={false} onOpenLog={() => {}} />);
  await user.click(await screen.findByRole('button', { name: 'Set up an app' }));
  await user.type(screen.getByLabelText('App name'), 'My agent');
  await user.type(screen.getByLabelText('Callback URL from the app'), app.redirect_uri);
  await user.click(screen.getByRole('button', { name: 'Create client ID' }));

  await screen.findByText(settings.client_id);
  expect(calls('mcp_register_client')[0][1]).toEqual({
    action: 'mcp_register_client',
    client_name: 'My agent',
    redirect_uri: app.redirect_uri
  });
  expect(screen.getByText('Not connected yet')).toBeTruthy();
  expect(screen.getByText('Leave blank')).toBeTruthy();
  expect(screen.getByText('On (S256)')).toBeTruthy();
  expect(screen.getByText(settings.token_url)).toBeTruthy();
  expect(screen.getByText(settings.mcp_url)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Copy Client ID' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Copy Client secret' })).toBeNull();
});

test('a refused callback shows the Librarian message and keeps the form', async () => {
  const user = userEvent.setup();
  answer({ mcp_connections: [{ connections: [], retention_days: 45 }], mcp_clients: [{ clients: [] }] });
  render(<McpConnectionsSection disabled={false} onOpenLog={() => {}} />);
  await user.click(await screen.findByRole('button', { name: 'Set up an app' }));
  postJson.mockImplementationOnce(async () => {
    throw new Error('The callback URL must be a full https:// address.');
  });
  await user.type(screen.getByLabelText('App name'), 'My agent');
  await user.type(screen.getByLabelText('Callback URL from the app'), 'https://x.example/cb');
  await user.click(screen.getByRole('button', { name: 'Create client ID' }));
  await screen.findByText('The callback URL must be a full https:// address.');
  expect(screen.getByLabelText('App name')).toBeTruthy();
});

test('deleting an app confirms first and refreshes both lists', async () => {
  const user = userEvent.setup();
  const viaApp = { ...claude, id: 'fam_app_1234567890ab', client_id: app.client_id, client_name: 'My agent' };
  answer({
    mcp_connections: [{ connections: [viaApp], retention_days: 45 }],
    mcp_clients: [{ clients: [{ ...app, connection_count: 1 }] }],
    mcp_delete_client: [{ ok: true, clients: [], connections: [] }]
  });
  render(<McpConnectionsSection disabled={false} onOpenLog={() => {}} />);
  await screen.findByText('1 live connection');
  confirmDialog.mockResolvedValueOnce(true);
  await user.click(screen.getByRole('button', { name: 'Delete' }));
  await waitFor(() => expect(screen.queryByText('1 live connection')).toBeNull());
  expect(confirmDialog.mock.calls[0][0].body).toMatch(/disconnected right away/);
  expect(calls('mcp_delete_client')[0][1]).toEqual({ action: 'mcp_delete_client', client_id: app.client_id });
  expect(screen.getByText(/No apps are connected/)).toBeTruthy();
});
