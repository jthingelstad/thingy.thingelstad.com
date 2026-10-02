// Profile > MCP connections, and the MCP request log dialog it opens.
// A connection is one OAuth grant from an MCP client (Claude, ChatGPT, ...);
// disconnecting revokes its tokens on the Librarian immediately. Apps that
// ask for a client ID instead of registering themselves are set up here too
// (Librarian 4.15.0): the reader pastes the app's callback URL and copies
// back the values its authorization form asks for. Deliberately generic -
// no per-app presets.
//
// Felt & Tangerine (phase 3): a toy-cream section of paper rows, each
// connection behind the same generic plug tile (no per-app branding, as
// above), outlined danger pills for the destructive actions, and the log as
// a bottom sheet on a phone.

const ROW = 'flex items-center gap-3.5 rounded-[14px] border-2 border-ink bg-paper px-3 py-2.5 max-sm:flex-wrap';
const OUTLINE_DANGER =
  'thingy-btn thingy-btn-outline-danger thingy-btn-compact min-h-11 shrink-0 px-4 text-[14px] max-sm:ml-auto';
const SECONDARY = 'thingy-btn thingy-btn-secondary thingy-btn-compact shrink-0 text-[14px]';
const ERROR = 'text-[15px] font-semibold text-danger';
const COPY = 'text-[15px] leading-[1.45] text-ink';

function PlugTile() {
  return (
    <span className="thingy-icon-tile size-11 rounded-xl [&_svg]:size-5" aria-hidden="true">
      <Icon name="plug" />
    </span>
  );
}
import { useEffect, useId, useState } from 'react';
import type { FormEvent } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Icon } from './components/Icon.tsx';
import { DialogHeader, SHEET_CONTENT, SHEET_OVERLAY, SheetGrab } from './components/Sheet.tsx';
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
      danger: true,
      face: 'oops'
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
    <section
      className="thingy-mcp-connections flex flex-col gap-3 rounded-[18px] border-2 border-ink bg-toy px-5 pt-[18px] pb-5 max-sm:px-3.5"
      aria-label="MCP connections"
    >
      <div className="grid gap-1">
        <h3 className="text-[18px] font-extrabold">MCP connections</h3>
        <p className={COPY}>
          Apps you have signed in to the Librarian MCP server. Each one searches the archive as you.
        </p>
      </div>
      {loading ? <p className="text-[15px] text-ink">Loading connections...</p> : null}
      {error ? <p className={ERROR}>{error}</p> : null}
      {!loading && !error && connections.length === 0 ? (
        <p className={COPY}>
          No apps are connected.{' '}
          <a className="font-bold text-clay-hover underline underline-offset-2" href="/connect/">
            Connect Claude, ChatGPT, or another MCP client
          </a>
          .
        </p>
      ) : null}
      {connections.length ? (
        <ul className="grid gap-2.5">
          {connections.map((connection) => (
            <li key={connection.id} className={`thingy-mcp-connection ${ROW}`}>
              <PlugTile />
              <div className="grid min-w-0 flex-1 gap-0.5">
                <span className="truncate text-base font-extrabold">{connectionLabel(connection)}</span>
                <span className="text-[13.5px] text-ink">{connectionSummary(connection)}</span>
              </div>
              <button
                type="button"
                className={OUTLINE_DANGER}
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
      <div>
        <button
          type="button"
          className="thingy-btn thingy-btn-secondary min-h-[46px] px-5 text-[15px] [&_svg]:size-[18px]"
          onClick={() => onOpenLog(connections)}
        >
          <Icon name="scroll-text" />
          View MCP request log
        </button>
      </div>
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
      danger: true,
      face: 'oops'
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
    <div className="thingy-mcp-apps grid gap-2.5 border-t-2 border-dashed border-rule pt-3.5">
      <div className="grid gap-1">
        <h4 className="text-base font-extrabold">Apps that ask for a client ID</h4>
        <p className={COPY}>
          Some apps don&apos;t sign up on their own. They show you a callback (redirect) URL and ask for a client ID.
          Set one up here, then copy the values into the app.
        </p>
      </div>
      {error ? <p className={ERROR}>{error}</p> : null}
      {clients.length ? (
        <ul className="grid gap-2.5">
          {clients.map((client) => (
            <li
              key={client.client_id}
              className="thingy-mcp-app rounded-[14px] border-2 border-ink bg-paper px-3 py-2.5"
            >
              <div className="flex items-center gap-3.5 max-sm:flex-wrap">
                <PlugTile />
                <div className="grid min-w-0 flex-1 gap-0.5">
                  <span className="truncate text-base font-extrabold">{client.client_name}</span>
                  <span className="text-[13.5px] text-ink">{clientStatus(client)}</span>
                </div>
                <div className="flex shrink-0 gap-2 max-sm:ml-auto">
                  <button
                    type="button"
                    className={SECONDARY}
                    aria-expanded={openId === client.client_id}
                    onClick={() => setOpenId(openId === client.client_id ? '' : client.client_id)}
                  >
                    {openId === client.client_id ? 'Hide settings' : 'Settings'}
                  </button>
                  <button
                    type="button"
                    className={OUTLINE_DANGER.replace(' max-sm:ml-auto', '')}
                    disabled={disabled || Boolean(busyId)}
                    onClick={() => void handleDelete(client)}
                  >
                    {busyId === client.client_id ? 'Deleting...' : 'Delete'}
                  </button>
                </div>
              </div>
              {openId === client.client_id ? <McpClientSettingsCard client={client} /> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {formOpen ? (
        <form
          className="thingy-mcp-app-form grid gap-3 rounded-[14px] border-2 border-ink bg-paper p-3.5"
          onSubmit={handleCreate}
        >
          <div>
            <label className="thingy-field-label" htmlFor={nameId}>
              App name
            </label>
            <input
              id={nameId}
              className="thingy-input"
              value={name}
              maxLength={100}
              required
              autoComplete="off"
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div>
            <label className="thingy-field-label" htmlFor={callbackId}>
              Callback URL from the app
            </label>
            <input
              id={callbackId}
              className="thingy-input font-mono text-[15px]"
              type="url"
              value={callbackUrl}
              required
              placeholder="https://"
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setCallbackUrl(event.target.value)}
            />
          </div>
          <div className="flex flex-wrap gap-2.5">
            <button
              type="submit"
              className="thingy-btn thingy-btn-primary thingy-btn-compact"
              disabled={disabled || saving}
            >
              {saving ? 'Creating...' : 'Create client ID'}
            </button>
            <button
              type="button"
              className="thingy-btn thingy-btn-secondary thingy-btn-compact"
              onClick={() => setFormOpen(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : loaded ? (
        <div>
          <button
            type="button"
            className={SECONDARY}
            disabled={disabled}
            onClick={() => {
              setError('');
              setFormOpen(true);
            }}
          >
            Set up an app
          </button>
        </div>
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
    <div className="thingy-mcp-app-settings mt-3 rounded-xl border-2 border-dashed border-rule bg-bg p-3">
      <p className="mb-2.5 text-[14px] leading-[1.45] text-ink">
        Enter these in the app&apos;s authorization settings. Then start the sign-in from the app: you confirm your
        email with a code, approve it, and it shows up under your connections.
      </p>
      <dl className="grid gap-2">
        {clientSettingRows(client.settings).map((row) => (
          <div key={row.label}>
            <dt className="font-mono text-[11.5px] font-semibold tracking-[0.1em] text-meta uppercase">{row.label}</dt>
            <dd className="flex items-center gap-1.5">
              <span className={`min-w-0 flex-1 text-[14px] break-all ${row.copy ? 'font-mono select-all' : ''}`}>
                {row.value}
              </span>
              {row.copy ? (
                <button
                  type="button"
                  className="grid size-11 shrink-0 place-items-center rounded-xl text-meta transition-colors hover:bg-toy hover:text-ink [&_svg]:size-[18px]"
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
      <p className="mt-2 text-[13px] break-all text-meta">Callback URL: {client.redirect_uri}</p>
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
    <Dialog.Root open onOpenChange={(next) => (next ? undefined : onClose())}>
      <Dialog.Portal>
        <Dialog.Overlay className={`${SHEET_OVERLAY} z-[60]`}>
          <Dialog.Content
            className={`thingy-mcp-log ${SHEET_CONTENT} max-h-[min(944px,calc(100vh-40px))] w-[min(45rem,100%)] gap-3 px-[26px] pt-[22px] pb-[22px] max-md:h-[calc(100dvh-1rem)] max-md:px-4 max-md:pb-0`}
            aria-describedby={undefined}
          >
            <SheetGrab />
            <DialogHeader
              title="MCP request log"
              titleClassName="text-[30px] leading-[1.05] max-md:text-[24px]"
              subtitle={`Every archive tool call made as you, newest first${retentionDays ? `. Kept for ${retentionDays} days.` : '.'}`}
              mark={{ icon: 'scroll-text' }}
              closeLabel="Close MCP request log"
            />
            <label className="flex items-center gap-3">
              <span className="font-mono text-[12px] font-semibold tracking-[0.14em] text-meta uppercase">Show</span>
              <span className="relative flex min-w-0 flex-1">
                <select
                  className="thingy-input thingy-select min-h-[46px] min-w-0 flex-1 text-[15px] font-semibold"
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
                <span
                  className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 text-ink [&_svg]:size-[18px]"
                  aria-hidden="true"
                >
                  <Icon name="chevron-down" />
                </span>
              </span>
            </label>
            <div className="min-h-0 flex-1 overflow-y-auto p-0.5 pb-2 max-md:pb-[calc(1rem+env(safe-area-inset-bottom))]">
              {error ? <p className={ERROR}>{error}</p> : null}
              {!loading && !error && entries.length === 0 ? (
                <p className="mt-2 text-[15px] text-ink">No MCP requests in this window.</p>
              ) : null}
              {entries.length ? (
                <ol className="thingy-mcp-log-list overflow-hidden rounded-[14px] border-2 border-ink bg-toy">
                  {entries.map((entry) => (
                    <McpLogRow key={`${entry.created_at}-${entry.request_id}`} entry={entry} />
                  ))}
                </ol>
              ) : null}
              {loading ? <p className="mt-2 text-[15px] text-ink">Loading requests...</p> : null}
              {!loading && nextCursor ? (
                <div className="flex justify-center pt-3">
                  <button
                    type="button"
                    className="thingy-btn thingy-btn-secondary min-h-[46px] px-6 text-[15px]"
                    onClick={() => void load(nextCursor, true)}
                  >
                    Load more
                  </button>
                </div>
              ) : null}
            </div>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function McpLogRow({ entry }: { entry: LibrarianMcpLogEntry }) {
  const args = formatArguments(entry.arguments);
  const failed = entry.status !== 'ok';
  const details = [
    logEntryConnectionLabel(entry),
    typeof entry.duration_ms === 'number' ? `${entry.duration_ms.toLocaleString('en-US')} ms` : '',
    formatResultSize(entry.result_chars)
  ].filter(Boolean);
  return (
    <li className="thingy-mcp-log-entry grid gap-1 px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <code className="font-mono text-[14px] font-semibold text-ink">{entry.tool_name}</code>
        {failed ? <span className="thingy-pill thingy-pill-danger">{entry.status}</span> : null}
        {entry.response_truncated ? <span className="thingy-pill">truncated</span> : null}
        <time className="ml-auto text-[13px] text-ink" dateTime={entry.created_at}>
          {formatLogTime(entry.created_at)}
        </time>
      </div>
      {details.length ? <div className="text-[13px] leading-[1.35] text-ink">{details.join(' · ')}</div> : null}
      {args ? <div className="font-mono text-[12px] leading-[1.4] break-all text-meta">{args}</div> : null}
    </li>
  );
}
