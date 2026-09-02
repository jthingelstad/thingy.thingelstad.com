import { Fragment, useEffect, useRef, useState } from 'react';
import { buildId } from '../shared/thingy-config.ts';
import { hasSupportingAccess, savePreferredName } from '../shared/thingy-account.ts';
import { errorMessage } from '../shared/thingy-errors.ts';
import { iconSvg } from '../shared/thingy-icons.ts';
import { confirmDialog } from '../shared/stores/dialog-store.ts';
import * as session from '../shared/thingy-session.ts';

// React port of the account trigger + menu + profile modal (the Preact
// versions retired with /chat-classic/). Same CSS classes, same /memory
// contract, same rows - including the entitlement-routed "AI model" row.

function Icon({ name }: { name: string }) {
  return <span aria-hidden="true" dangerouslySetInnerHTML={{ __html: iconSvg(name) }} />;
}

function formatProfileDate(value: unknown) {
  const text = String(value || '').trim();
  if (!text) return '';
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? text : date.toLocaleString();
}

function formatProfileCount(value: unknown, label: string) {
  const count = Number(value || 0);
  return `${count.toLocaleString()} ${label}${count === 1 ? '' : 's'}`;
}

function profileNumber(value: unknown) {
  const count = Number(value || 0);
  return Number.isFinite(count) ? count : 0;
}

function formatDurationParts(milliseconds: number) {
  const minutes = Math.max(0, Math.floor(milliseconds / 60000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const remainingMinutes = minutes % 60;
  const parts: string[] = [];
  if (days) parts.push(`${days.toLocaleString()} day${days === 1 ? '' : 's'}`);
  if (hours && parts.length < 2) parts.push(`${hours} hour${hours === 1 ? '' : 's'}`);
  if (!parts.length && remainingMinutes) parts.push(`${remainingMinutes} minute${remainingMinutes === 1 ? '' : 's'}`);
  return parts.length ? parts.join(', ') : 'Less than a minute';
}

function formatActiveSpan(startValue: unknown, endValue: unknown) {
  const start = new Date(String(startValue || '').trim());
  const end = new Date(String(endValue || '').trim());
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 'Not enough activity yet';
  return formatDurationParts(Math.max(0, end.getTime() - start.getTime()));
}

function formatProfileActivity(accountOverview: LibrarianAccountOverview = {}, profile: LibrarianProfile = {}) {
  const totalTurns = profileNumber(accountOverview.memory_turn_count ?? profile.turn_count);
  const conversationCount = profileNumber(accountOverview.conversation_count);
  const conversationTurns = profileNumber(accountOverview.conversation_turn_count);
  const first = totalTurns
    ? `${formatProfileCount(totalTurns, 'total Thingy turn')} recorded.`
    : 'No Thingy turns have been recorded yet.';
  const second = conversationCount
    ? `${formatProfileCount(conversationCount, 'retained conversation')} with ${formatProfileCount(conversationTurns, 'retained turn')}.`
    : 'No retained conversations yet.';
  return `${first} ${second}`;
}

function formatDailyQuota(accountOverview: LibrarianAccountOverview = {}) {
  const quota = accountOverview.quota;
  if (!quota) return '';
  if (quota.unlimited) return 'Unlimited (owner account)';
  const used = Number(quota.chat_used || 0);
  const max = Number(quota.chat_max || 0);
  if (!max) return '';
  const parts = [`${used} of ${max} chat turns`];
  const mcpUsed = Number(quota.mcp_used || 0);
  const mcpMax = Number(quota.mcp_max || 0);
  if (mcpUsed > 0 && mcpMax > 0) parts.push(`${mcpUsed} of ${mcpMax} MCP tool calls`);
  return `${parts.join(' and ')} used today. Resets at midnight UTC.`;
}

function formatChatModel(accountOverview: LibrarianAccountOverview = {}, supporting = false) {
  const model = accountOverview.chat_model;
  const label = String(model?.label || '').trim();
  if (!label) return '';
  if (model?.premium && supporting) return `${label} — premium model, included with your membership`;
  if (model?.premium) return `${label} — premium model`;
  return label;
}

function ProfileModal({
  open,
  onClose,
  onProfileDeleted,
  profile,
  email,
  preferredName,
  supporting
}: {
  open: boolean;
  onClose: () => void;
  onProfileDeleted: () => void;
  profile: LibrarianProfile;
  email: string;
  preferredName: string;
  supporting: boolean;
}) {
  const [viewProfile, setViewProfile] = useState<LibrarianProfile>(profile || {});
  const [accountOverview, setAccountOverview] = useState<LibrarianAccountOverview>({});
  const [busyAction, setBusyAction] = useState('');
  const [profileError, setProfileError] = useState('');

  useEffect(() => {
    if (!open) return undefined;
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // Escape handling only while open.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setViewProfile(profile || {});
    setAccountOverview({});
    setProfileError('');
    void (async () => {
      setBusyAction('load');
      try {
        const data = await session.postJson('/memory', { action: 'get' }, session.authHeaders());
        if (data.profile) {
          setViewProfile(session.mergeProfile(data, email));
          setAccountOverview(data.account || {});
        }
      } catch (error) {
        setProfileError(errorMessage(error, 'Thingy could not load this profile right now.'));
      } finally {
        setBusyAction('');
      }
    })();
    // Reset-and-reload only on open/close transitions.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const viewPreferredName = String(preferredName || viewProfile.preferred_name || '').trim();
  const firstSeen = accountOverview.first_seen_at || viewProfile.first_seen_at;
  const lastActivity = accountOverview.last_seen_at || viewProfile.last_seen_at;
  const rows = (
    [
      ['Name', viewPreferredName || 'Not set'],
      email ? ['Email', email] : null,
      ['Access', supporting ? 'Supporting Member' : 'Weekly Thing reader'],
      formatChatModel(accountOverview, supporting) ? ['AI model', formatChatModel(accountOverview, supporting)] : null,
      ['First seen', formatProfileDate(firstSeen) || 'Not recorded'],
      ['Last activity', formatProfileDate(lastActivity) || 'Not recorded'],
      ['Active span', formatActiveSpan(firstSeen, lastActivity)],
      ['Thingy activity', formatProfileActivity(accountOverview, viewProfile)],
      formatDailyQuota(accountOverview) ? ["Today's usage", formatDailyQuota(accountOverview)] : null
    ] as Array<[string, string] | null>
  ).filter((row): row is [string, string] => row !== null);

  async function handleDeleteProfile() {
    const confirmed = await confirmDialog({
      title: 'Delete your Thingy profile?',
      body: 'Conversations, activity, and preferences are removed for good. Your Weekly Thing subscription is unaffected.',
      confirmLabel: 'Delete profile',
      danger: true
    });
    if (!confirmed) return;
    setBusyAction('delete_profile');
    setProfileError('');
    try {
      await session.postJson('/memory', { action: 'delete_profile' }, session.authHeaders());
      onProfileDeleted();
    } catch (error) {
      setProfileError(errorMessage(error, 'Thingy could not delete this profile right now.'));
    } finally {
      setBusyAction('');
    }
  }

  return (
    <div
      className="thingy-memory-modal-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="thingy-memory-modal" role="dialog" aria-modal="true" aria-labelledby="thingy-memory-title">
        <header className="thingy-memory-header">
          <span className="thingy-memory-header-icon" aria-hidden="true">
            <Icon name="users-round" />
          </span>
          <div>
            <h2 id="thingy-memory-title">Profile</h2>
            <p>Account details and Thingy activity.</p>
          </div>
          <button type="button" className="thingy-memory-close" aria-label="Close Profile" onClick={onClose}>
            <Icon name="x" />
          </button>
        </header>
        <section className="thingy-memory-status" aria-live="polite">
          <span>{busyAction === 'load' ? 'Loading profile...' : ''}</span>
          {profileError ? <small>{profileError}</small> : null}
        </section>
        <div className="thingy-memory-panel">
          <dl className="thingy-memory-dl">
            {rows.map(([label, value]) => (
              <Fragment key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </Fragment>
            ))}
          </dl>
          <section className="thingy-memory-danger-zone" aria-label="Delete Thingy Profile">
            <h3>Delete Thingy Profile</h3>
            <p>This deletes your Thingy profile and conversations. It does not unsubscribe you from Weekly Thing.</p>
            <button
              type="button"
              className="thingy-memory-danger"
              disabled={Boolean(busyAction)}
              onClick={() => void handleDeleteProfile()}
            >
              {busyAction === 'delete_profile' ? 'Deleting...' : 'Delete Thingy Profile'}
            </button>
          </section>
        </div>
      </section>
    </div>
  );
}

export function AccountPanel() {
  const [email] = useState(() => session.storedEmail());
  const [profile, setProfile] = useState<LibrarianProfile>(() => session.storedProfile());
  const [preferredName, setPreferredName] = useState(() => String(session.storedProfile().preferred_name || '').trim());
  const [open, setOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [nameStatus, setNameStatus] = useState('');
  const rootRef = useRef<HTMLDivElement | null>(null);
  const supporting = hasSupportingAccess(profile);
  const display = email || preferredName;
  const initial = (email || preferredName || 'T')[0].toUpperCase();

  useEffect(() => {
    function onDocClick(event: MouseEvent) {
      if (rootRef.current && event.target instanceof Element && rootRef.current.contains(event.target)) return;
      setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  async function handleNameSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = (event.currentTarget.elements.namedItem('preferred_name') as HTMLInputElement | null)?.value || '';
    setNameStatus('Saving...');
    try {
      const { data, savedName } = await savePreferredName(session, input, (value) => String(value || '').trim());
      setPreferredName(savedName);
      if (data.profile) setProfile(session.mergeProfile(data, email));
      setNameStatus('Saved.');
    } catch (error) {
      setNameStatus(errorMessage(error, 'Could not save that right now.'));
    }
  }

  function handleLogout() {
    setOpen(false);
    setProfileOpen(false);
    session.clearAuth();
    window.location.href = session.signInUrl('/chat/');
  }

  return (
    <div ref={rootRef} className="thingy-aui-account">
      <button
        className="rail-account-btn"
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        title="Account"
        onClick={() => setOpen(!open)}
      >
        <span className="rail-avatar" aria-hidden="true">
          {initial}
        </span>
        <span className="rail-account-meta">
          <span className="rail-account-email">{display || 'Signed in'}</span>
          <span className="rail-account-sub">{supporting ? 'Supporting Member' : 'Weekly Thing reader'}</span>
        </span>
        <span className="rail-account-caret" aria-hidden="true">
          <Icon name="chevron-down" />
        </span>
      </button>
      <div className="rail-menu" hidden={!open} role="menu">
        <form className="rail-account-setting" onSubmit={handleNameSubmit}>
          <label>Name</label>
          <div className="rail-account-setting-row">
            <input
              name="preferred_name"
              type="text"
              maxLength={80}
              autoComplete="name"
              placeholder="What should Thingy call you?"
              defaultValue={preferredName}
            />
            <button type="submit">Save</button>
          </div>
          <p aria-live="polite">{nameStatus}</p>
        </form>
        <button
          type="button"
          className="rail-memory-trigger"
          onClick={() => {
            setProfileOpen(true);
            setOpen(false);
          }}
        >
          <span className="rail-memory-trigger-icon" aria-hidden="true">
            <Icon name="users-round" />
          </span>
          <span className="rail-memory-trigger-copy">
            <strong>Show Profile</strong>
            <small>Account details and activity</small>
          </span>
        </button>
        <div className="rail-menu-sep" role="separator" />
        <button type="button" role="menuitem" className="danger" onClick={handleLogout}>
          <Icon name="log-out" />
          Logout
        </button>
        <p className="rail-menu-build" title="Thingy build">
          Build {buildId()}
        </p>
      </div>
      <ProfileModal
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
        onProfileDeleted={handleLogout}
        profile={profile}
        email={email}
        preferredName={preferredName}
        supporting={supporting}
      />
    </div>
  );
}
