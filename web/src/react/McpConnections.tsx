// Profile > MCP connections, and the MCP request log dialog it opens.
// A connection is one OAuth grant from an MCP client (Claude, ChatGPT, ...);
// disconnecting revokes its tokens on the Librarian immediately. Apps that
// ask for a client ID instead of registering themselves are set up here too
// (Librarian 4.15.0): the reader pastes the app's callback URL and copies
// back the values its authorization form asks for. Deliberately generic -
// no per-app presets.
import { useEffect, useId, useState } from 'react';
import type { FormEvent } from 'react';
import { Icon } from './components/Icon.tsx';
import { confirmDialog } from '../shared/stores/dialog-store.ts';
import { errorMessage } from '../shared/thingy-errors.ts';
import {
  WEB_SURFACE_FILTER,
  clientSettingRows,
  clientStatus,
  connectionLabel,
  connectionSummary,
  deleteMcpClient,
  disconnectMcpConnection,
  fetchMcpClients,
  fetchMcpConnections,
  fetchMcpLog,
  registerMcpClient,
  formatArguments,
  formatLogTime,
  formatResultSize,
  logEntryConnectionLabel
} from '../shared/thingy-mcp-account.ts';
import * as session from '../shared/thingy-session.ts';

export function McpConnectionsSection({
  disabled,
  onOpenLog
}: {
  disabled: boolean;
  onOpenLog: (connections: LibrarianMcpConnection[]) => void;
}) {
  const [connections, setConnections] = useState<LibrarianMcpConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const data = await fetchMcpConnections(session);
        if (live) setConnections(data.connections);
      } catch (loadError) {
        if (live) setError(errorMessage(loadError, 'Thingy could not load your MCP connections right now.'));
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  async function handleDisconnect(connection: LibrarianMcpConnection) {
    const label = connectionLabel(connection);
    const confirmed = await confirmDialog({
      title: `Disconnect ${label}?`,
      body: `${label} loses access to the Librarian right away. To use it again you will sign in from that app and approve it again.`,
      confirmLabel: 'Disconnect',
      danger: true
    });
    if (!confirmed) return;
    setBusyId(connection.id);
    setError('');
    try {
      setConnections(await disconnectMcpConnection(session, connection.id));
    } catch (disconnectError) {
      setError(errorMessage(disconnectError, 'Thingy could not disconnect that right now.'));
    } finally {
      setBusyId('');
    }
  }

  return (
    <section className="thingy-mcp-connections mt-5 rounded-xl border border-line p-3.5" aria-label="MCP connections">
      <h3 className="text-[14px] font-extrabold">MCP connections</h3>
      <p className="mt-0.5 text-[13px] text-ink-soft">
        Apps you have signed in to the Librarian MCP server. Each one searches the archive as you.
      </p>
      {loading ? <p className="mt-2 text-[13px] text-muted">Loading connections...</p> : null}
      {error ? <p className="mt-2 text-[13px] text-error">{error}</p> : null}
      {!loading && !error && connections.length === 0 ? (
        <p className="mt-2 text-[13px] text-muted">
          No apps are connected.{' '}
          <a className="font-bold text-accent-deep underline" href="/connect/">
            Connect Claude, ChatGPT, or another MCP client
          </a>
          .
        </p>
      ) : null}
      {connections.length ? (
        <ul className="mt-2.5 grid gap-2">
          {connections.map((connection) => (
            <li
              key={connection.id}
              className="thingy-mcp-connection flex items-center gap-3 rounded-lg bg-surface-2 px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] font-bold">{connectionLabel(connection)}</div>
                <div className="text-[12px] text-muted">{connectionSummary(connection)}</div>
              </div>
              <button
                type="button"
                className="shrink-0 rounded-lg border border-error/40 px-2.5 py-1 text-[12.5px] font-bold text-error hover:bg-error/8 disabled:opacity-50"
                disabled={disabled || Boolean(busyId)}
                onClick={() => void handleDisconnect(connection)}
              >
                {busyId === connection.id ? 'Disconnecting...' : 'Disconnect'}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <McpAppsBlock disabled={disabled} onConnectionsChanged={setConnections} />
      <button
        type="button"
        className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-[13px] font-bold hover:bg-surface-2 [&_svg]:size-4"
        onClick={() => onOpenLog(connections)}
      >
        <Icon name="search" />
        View MCP request log
      </button>
    </section>
  );
}

function McpAppsBlock({
  disabled,
  onConnectionsChanged
}: {
  disabled: boolean;
  onConnectionsChanged: (connections: LibrarianMcpConnection[]) => void;
}) {
  const [clients, setClients] = useState<LibrarianMcpRegisteredClient[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState('');
  const [callbackUrl, setCallbackUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [openId, setOpenId] = useState('');
  const [error, setError] = useState('');
  const nameId = useId();
  const callbackId = useId();

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const list = await fetchMcpClients(session);
        if (live) setClients(list);
      } catch (loadError) {
        if (live) setError(errorMessage(loadError, 'Thingy could not load your apps right now.'));
      } finally {
        if (live) setLoaded(true);
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const result = await registerMcpClient(session, { name, callbackUrl });
      setClients(result.clients);
      setOpenId(result.client.client_id);
      setFormOpen(false);
      setName('');
      setCallbackUrl('');
    } catch (createError) {
      setError(errorMessage(createError, 'Thingy could not set up that app right now.'));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(client: LibrarianMcpRegisteredClient) {
    const label = client.client_name || 'this app';
    const confirmed = await confirmDialog({
      title: `Delete ${label}?`,
      body: `Its client ID stops working and any connection made with it is disconnected right away. To use ${label} again you would set it up again and paste the new client ID into it.`,
      confirmLabel: 'Delete',
      danger: true
    });
    if (!confirmed) return;
    setBusyId(client.client_id);
    setError('');
    try {
      const result = await deleteMcpClient(session, client.client_id);
      setClients(result.clients);
      onConnectionsChanged(result.connections);
    } catch (deleteError) {
      setError(errorMessage(deleteError, 'Thingy could not delete that app right now.'));
    } finally {
      setBusyId('');
    }
  }

  return (
    <div className="thingy-mcp-apps mt-4 border-t border-line pt-3">
      <h4 className="text-[13px] font-extrabold">Apps that ask for a client ID</h4>
      <p className="mt-0.5 text-[12.5px] text-ink-soft">
        Some apps don&apos;t sign up on their own. They show you a callback (redirect) URL and ask for a client ID. Set
        one up here, then copy the values into the app.
      </p>
      {error ? <p className="mt-2 text-[13px] text-error">{error}</p> : null}
      {clients.length ? (
        <ul className="mt-2.5 grid gap-2">
          {clients.map((client) => (
            <li key={client.client_id} className="thingy-mcp-app rounded-lg bg-surface-2 px-3 py-2">
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-bold">{client.client_name}</div>
                  <div className="text-[12px] text-muted">{clientStatus(client)}</div>
                </div>
                <button
                  type="button"
                  className="shrink-0 rounded-lg border border-line px-2.5 py-1 text-[12.5px] font-bold hover:bg-surface"
                  aria-expanded={openId === client.client_id}
                  onClick={() => setOpenId(openId === client.client_id ? '' : client.client_id)}
                >
                  {openId === client.client_id ? 'Hide settings' : 'Settings'}
                </button>
                <button
                  type="button"
                  className="shrink-0 rounded-lg border border-error/40 px-2.5 py-1 text-[12.5px] font-bold text-error hover:bg-error/8 disabled:opacity-50"
                  disabled={disabled || Boolean(busyId)}
                  onClick={() => void handleDelete(client)}
                >
                  {busyId === client.client_id ? 'Deleting...' : 'Delete'}
                </button>
              </div>
              {openId === client.client_id ? <McpClientSettingsCard client={client} /> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {formOpen ? (
        <form
          className="thingy-mcp-app-form mt-2.5 grid gap-2 rounded-lg border border-line p-3"
          onSubmit={handleCreate}
        >
          <label className="grid gap-1 text-[12.5px] font-bold" htmlFor={nameId}>
            App name
            <input
              id={nameId}
              className="rounded-lg border border-line bg-bg px-2 py-1.5 text-[13px] font-normal text-ink"
              value={name}
              maxLength={100}
              required
              autoComplete="off"
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="grid gap-1 text-[12.5px] font-bold" htmlFor={callbackId}>
            Callback URL from the app
            <input
              id={callbackId}
              className="rounded-lg border border-line bg-bg px-2 py-1.5 font-mono text-[12.5px] font-normal text-ink"
              type="url"
              value={callbackUrl}
              required
              placeholder="https://"
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setCallbackUrl(event.target.value)}
            />
          </label>
          <div className="flex gap-2">
            <button
              type="submit"
              className="rounded-lg bg-accent-deep px-3 py-1.5 text-[13px] font-bold text-bg hover:brightness-110 disabled:opacity-50"
              disabled={disabled || saving}
            >
              {saving ? 'Creating...' : 'Create client ID'}
            </button>
            <button
              type="button"
              className="rounded-lg border border-line px-3 py-1.5 text-[13px] font-bold hover:bg-surface-2"
              onClick={() => setFormOpen(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : loaded ? (
        <button
          type="button"
          className="mt-2.5 rounded-lg border border-line px-3 py-1.5 text-[13px] font-bold hover:bg-surface-2 disabled:opacity-50"
          disabled={disabled}
          onClick={() => {
            setError('');
            setFormOpen(true);
          }}
        >
          Set up an app
        </button>
      ) : null}
    </div>
  );
}

function McpClientSettingsCard({ client }: { client: LibrarianMcpRegisteredClient }) {
  const [copied, setCopied] = useState('');

  async function copy(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
    } catch {
      // The value is on screen and selectable; nothing else to do.
    }
  }

  return (
    <div className="thingy-mcp-app-settings mt-2 rounded-lg border border-line bg-surface p-2.5">
      <p className="mb-2 text-[12px] text-ink-soft">
        Enter these in the app&apos;s authorization settings. Then start the sign-in from the app: you confirm your
        email with a code, approve it, and it shows up under your connections.
      </p>
      <dl className="grid gap-2">
        {clientSettingRows(client.settings).map((row) => (
          <div key={row.label}>
            <dt className="text-[11.5px] font-bold text-muted">{row.label}</dt>
            <dd className="flex items-center gap-1.5">
              <span className={`min-w-0 flex-1 text-[12.5px] break-all ${row.copy ? 'font-mono select-all' : ''}`}>
                {row.value}
              </span>
              {row.copy ? (
                <button
                  type="button"
                  className="grid size-7 shrink-0 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-ink [&_svg]:size-3.5"
                  aria-label={`Copy ${row.label}`}
                  onClick={() => void copy(row.label, row.value)}
                >
                  <Icon name={copied === row.label ? 'check' : 'copy'} />
                </button>
              ) : null}
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-[11.5px] text-muted">Callback URL: {client.redirect_uri}</p>
    </div>
  );
}

export function McpLogDialog({ connections, onClose }: { connections: LibrarianMcpConnection[]; onClose: () => void }) {
  const [filter, setFilter] = useState('');
  const [entries, setEntries] = useState<LibrarianMcpLogEntry[]>([]);
  const [nextCursor, setNextCursor] = useState('');
  const [retentionDays, setRetentionDays] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load(cursor: string, append: boolean) {
    setLoading(true);
    setError('');
    try {
      const page = await fetchMcpLog(session, { cursor, filter });
      setEntries((current) => (append ? [...current, ...page.entries] : page.entries));
      setNextCursor(page.nextCursor);
      if (page.retentionDays) setRetentionDays(page.retentionDays);
    } catch (loadError) {
      setError(errorMessage(loadError, 'Thingy could not load the MCP request log right now.'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load('', false);
    // Reload from the top whenever the filter changes.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  return (
    <div
      className="thingy-scrim fixed inset-0 z-[60] grid place-items-center p-5"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="thingy-mcp-log thingy-modal flex max-h-[min(760px,calc(100vh-40px))] w-[min(44rem,100%)] flex-col p-5 font-sans"
        role="dialog"
        aria-modal="true"
        aria-labelledby="thingy-mcp-log-title"
      >
        <header className="mb-3 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 id="thingy-mcp-log-title" className="thingy-modal-title">
              MCP request log
            </h2>
            <p className="text-[13px] text-muted">
              Every archive tool call made as you, newest first
              {retentionDays ? `. Kept for ${retentionDays} days.` : '.'}
            </p>
          </div>
          <button
            type="button"
            className="-my-1.5 -mr-1.5 grid size-11 shrink-0 place-items-center rounded-xl text-ink hover:bg-surface-2 [&_svg]:size-5"
            aria-label="Close MCP request log"
            onClick={onClose}
          >
            <Icon name="x" />
          </button>
        </header>
        <label className="mb-3 flex items-center gap-2 text-[13px]">
          <span className="font-bold text-muted">Show</span>
          <select
            className="min-w-0 flex-1 rounded-lg border border-line bg-bg px-2 py-1.5 text-[13px] text-ink"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          >
            <option value="">All requests</option>
            {connections.map((connection) => (
              <option key={connection.id} value={connection.id}>
                {connectionLabel(connection)}
              </option>
            ))}
            <option value={WEB_SURFACE_FILTER}>Thingy page (WebMCP)</option>
          </select>
        </label>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {error ? <p className="text-[13px] text-error">{error}</p> : null}
          {!loading && !error && entries.length === 0 ? (
            <p className="text-[13px] text-muted">No MCP requests in this window.</p>
          ) : null}
          <ol className="grid gap-1.5">
            {entries.map((entry) => (
              <McpLogRow key={`${entry.created_at}-${entry.request_id}`} entry={entry} />
            ))}
          </ol>
          {loading ? <p className="mt-2 text-[13px] text-muted">Loading requests...</p> : null}
          {!loading && nextCursor ? (
            <button
              type="button"
              className="mt-3 rounded-lg border border-line px-3 py-1.5 text-[13px] font-bold hover:bg-surface-2"
              onClick={() => void load(nextCursor, true)}
            >
              Load more
            </button>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function McpLogRow({ entry }: { entry: LibrarianMcpLogEntry }) {
  const args = formatArguments(entry.arguments);
  const failed = entry.status !== 'ok';
  const details = [
    logEntryConnectionLabel(entry),
    typeof entry.duration_ms === 'number' ? `${entry.duration_ms.toLocaleString()} ms` : '',
    formatResultSize(entry.result_chars),
    entry.response_truncated ? 'truncated' : ''
  ].filter(Boolean);
  return (
    <li className="thingy-mcp-log-entry rounded-lg bg-surface-2 px-3 py-2">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <code className="font-mono text-[13px] font-bold">{entry.tool_name}</code>
        {failed ? (
          <span className="rounded bg-error/12 px-1.5 text-[11px] font-bold text-error">{entry.status}</span>
        ) : null}
        <time className="ml-auto text-[12px] text-muted" dateTime={entry.created_at}>
          {formatLogTime(entry.created_at)}
        </time>
      </div>
      <div className="text-[12px] text-muted">{details.join(' · ')}</div>
      {args ? <div className="mt-0.5 font-mono text-[11.5px] break-all text-ink-soft">{args}</div> : null}
    </li>
  );
}
