// The reader's MCP connections and request log (Librarian contract 4.13.0,
// /memory actions mcp_connections, mcp_disconnect, mcp_log). The account
// panel renders these; the formatting lives here so it can be unit-tested.
// Each call takes the session module as an argument (as savePreferredName
// does) so node:test can drive it with a fake.
type Session = Pick<typeof import('./thingy-session.ts'), 'postJson' | 'authHeaders'>;
type McpConnection = LibrarianMcpConnection;
type McpLogEntry = LibrarianMcpLogEntry;

export interface McpLogPage {
  entries: McpLogEntry[];
  nextCursor: string;
  retentionDays: number;
}

// Filter value for the WebMCP page tools, which have no OAuth connection.
export const WEB_SURFACE_FILTER = 'surface:web';

export async function fetchMcpConnections(
  session: Session
): Promise<{ connections: McpConnection[]; retentionDays: number }> {
  const data = await session.postJson('/memory', { action: 'mcp_connections' }, session.authHeaders());
  return {
    connections: (data.connections as McpConnection[] | undefined) || [],
    retentionDays: Number(data.retention_days || 0)
  };
}

export async function disconnectMcpConnection(session: Session, connectionId: string): Promise<McpConnection[]> {
  const data = await session.postJson(
    '/memory',
    { action: 'mcp_disconnect', connection_id: connectionId },
    session.authHeaders()
  );
  return (data.connections as McpConnection[] | undefined) || [];
}

export async function fetchMcpLog(
  session: Session,
  { cursor = '', filter = '' }: { cursor?: string; filter?: string } = {}
): Promise<McpLogPage> {
  const payload: Record<string, unknown> = { action: 'mcp_log', limit: 50 };
  if (cursor) payload.cursor = cursor;
  if (filter === WEB_SURFACE_FILTER) payload.surface = 'web';
  else if (filter) payload.connection_id = filter;
  const data = await session.postJson('/memory', payload, session.authHeaders());
  return {
    entries: (data.entries as McpLogEntry[] | undefined) || [],
    nextCursor: String(data.next_cursor || ''),
    retentionDays: Number(data.retention_days || 0)
  };
}

export function connectionLabel(connection: Pick<McpConnection, 'client_name'>) {
  return String(connection.client_name || '').trim() || 'Unnamed MCP client';
}

export function logEntryConnectionLabel(entry: McpLogEntry) {
  if (entry.surface === 'web') return 'Thingy page (WebMCP)';
  return String(entry.client_name || '').trim() || 'Unnamed MCP client';
}

export function formatWhen(value: unknown, now = new Date()) {
  const date = new Date(String(value || ''));
  if (Number.isNaN(date.getTime())) return '';
  const seconds = Math.round((now.getTime() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days} day${days === 1 ? '' : 's'} ago`;
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatLogTime(value: unknown) {
  const date = new Date(String(value || ''));
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function connectionSummary(connection: McpConnection, now = new Date()) {
  const parts: string[] = [];
  const connected = formatWhen(connection.connected_at, now);
  if (connected) parts.push(`Connected ${connected}`);
  const used = formatWhen(connection.last_used_at, now);
  parts.push(used ? `last used ${used}` : 'not used yet');
  const calls = Number(connection.call_count || 0);
  if (calls) parts.push(`${calls.toLocaleString()} call${calls === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

function argumentValue(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value.length > 80 ? `${value.slice(0, 79)}…` : value);
  const text = JSON.stringify(value);
  return text && text.length > 80 ? `${text.slice(0, 79)}…` : String(text);
}

/** One line of a call's arguments: query="rss" · year=2014. */
export function formatArguments(args: unknown) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return '';
  return Object.entries(args as Record<string, unknown>)
    .map(([key, value]) => `${key}=${argumentValue(value)}`)
    .join(' · ');
}

export function formatResultSize(chars: unknown) {
  const count = Number(chars || 0);
  if (!count) return '';
  if (count >= 1000) return `${(count / 1000).toFixed(count >= 10_000 ? 0 : 1)}k chars`;
  return `${count} chars`;
}
