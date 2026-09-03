import { Fragment, useEffect, useState } from 'react';
import { buildId } from '../shared/thingy-config.ts';
import { hasSupportingAccess, savePreferredName } from '../shared/thingy-account.ts';
import { errorMessage } from '../shared/thingy-errors.ts';
import * as Popover from '@radix-ui/react-popover';
import { Icon } from './components/Icon.tsx';
import { confirmDialog } from '../shared/stores/dialog-store.ts';
import * as session from '../shared/thingy-session.ts';
import { setTheme, storedTheme, type ThingyTheme } from '../shared/thingy-theme.ts';

// React port of the account trigger + menu + profile modal (the Preact
// versions retired with the Preact chat). Same CSS classes, same /memory
// contract, same rows - including the entitlement-routed "AI model" row.

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

function formatTokensUsed(count: number) {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M tokens`;
  if (count >= 10_000) return `${Math.round(count / 1000)}k tokens`;
  if (count >= 1_000) return `${(count / 1000).toFixed(1)}k tokens`;
  return `${count} tokens`;
}

function formatDailyQuota(accountOverview: LibrarianAccountOverview = {}) {
  const quota = accountOverview.quota;
  if (!quota) return '';
  // Informational usage (contract 4.9) — counted for every account
  // including the owner; the enforcement quota stays turn-based.
  const turns = Number(quota.turns_today || 0);
  const tokens = Number(quota.tokens_today || 0);
  if (quota.unlimited) {
    if (!turns) return 'No usage yet today — no limit (owner account)';
    return `${turns} chat turn${turns === 1 ? '' : 's'} · ${formatTokensUsed(tokens)} today — no limit (owner account)`;
  }
  const used = Number(quota.chat_used || 0);
  const max = Number(quota.chat_max || 0);
  if (!max) return '';
  const parts = [`${used} of ${max} chat turns`];
  if (tokens > 0) parts.push(formatTokensUsed(tokens));
  const mcpUsed = Number(quota.mcp_used || 0);
  const mcpMax = Number(quota.mcp_max || 0);
  if (mcpUsed > 0 && mcpMax > 0) parts.push(`${mcpUsed} of ${mcpMax} MCP tool calls`);
  return `${parts.join(' · ')} used today. Resets at midnight UTC.`;
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
      className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-5 backdrop-blur-[3px]"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="max-h-[min(640px,calc(100vh-40px))] w-[min(30rem,100%)] overflow-y-auto rounded-2xl border border-line bg-surface p-5 font-sans text-ink shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="thingy-memory-title"
      >
        <header className="mb-3 flex items-start gap-3">
          <span
            className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent-deep [&_svg]:size-[18px]"
            aria-hidden="true"
          >
            <Icon name="users-round" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="thingy-memory-title" className="text-[17px] font-extrabold">
              Profile
            </h2>
            <p className="text-[13px] text-muted">Account details and Thingy activity.</p>
          </div>
          <button
            type="button"
            className="grid size-8 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink [&_svg]:size-4"
            aria-label="Close Profile"
            onClick={onClose}
          >
            <Icon name="x" />
          </button>
        </header>
        <section className="min-h-5 text-[13px] text-muted" aria-live="polite">
          <span>{busyAction === 'load' ? 'Loading profile...' : ''}</span>
          {profileError ? <small className="text-error">{profileError}</small> : null}
        </section>
        <div className="thingy-memory-panel">
          <dl className="thingy-memory-dl grid grid-cols-[auto_1fr] gap-x-5 gap-y-2 text-[14px]">
            {rows.map(([label, value]) => (
              <Fragment key={label}>
                <dt className="font-bold text-muted">{label}</dt>
                <dd className="min-w-0 break-words text-ink">{value}</dd>
              </Fragment>
            ))}
          </dl>
          <section
            className="mt-5 rounded-xl border border-error/35 bg-error/6 p-3.5"
            aria-label="Delete Thingy Profile"
          >
            <h3 className="text-[14px] font-extrabold text-error">Delete Thingy Profile</h3>
            <p className="mt-0.5 text-[13px] text-ink-soft">
              This deletes your Thingy profile and conversations. It does not unsubscribe you from Weekly Thing.
            </p>
            <button
              type="button"
              className="mt-2.5 rounded-lg bg-error px-3.5 py-2 text-sm font-bold text-bg hover:brightness-110 disabled:opacity-50"
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
  const [theme, setThemeState] = useState<ThingyTheme>(() => storedTheme());
  const [nameStatus, setNameStatus] = useState('');
  const supporting = hasSupportingAccess(profile);
  const display = email || preferredName;
  const initial = (email || preferredName || 'T')[0].toUpperCase();

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
    <div className="rail-account thingy-aui-account">
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button
            className="rail-account-btn flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-surface-2"
            type="button"
            title="Account"
          >
            <span
              className="grid size-8 shrink-0 place-items-center rounded-full bg-accent-deep font-sans text-sm font-extrabold text-bg"
              aria-hidden="true"
            >
              {initial}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-sans text-[13px] font-bold text-ink">{display || 'Signed in'}</span>
              <span className="block truncate font-sans text-[11.5px] text-muted">
                {supporting ? 'Supporting Member' : 'Weekly Thing reader'}
              </span>
            </span>
            <span className="text-muted [&_svg]:size-4" aria-hidden="true">
              <Icon name="chevron-down" />
            </span>
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            className="z-50 grid w-[var(--radix-popover-trigger-width)] min-w-64 gap-1 rounded-xl border border-line bg-surface p-2 font-sans text-ink shadow-xl"
            side="top"
            align="start"
            sideOffset={8}
          >
            <form className="px-1.5 pt-1" onSubmit={handleNameSubmit}>
              <label className="text-[11px] font-bold tracking-wider text-muted uppercase">Name</label>
              <div className="mt-1 flex gap-1.5">
                <input
                  className="w-full min-w-0 rounded-lg border border-line bg-bg px-2.5 py-1.5 text-[13px] text-ink outline-none placeholder:text-muted focus:border-accent"
                  name="preferred_name"
                  type="text"
                  maxLength={80}
                  autoComplete="name"
                  placeholder="What should Thingy call you?"
                  defaultValue={preferredName}
                />
                <button
                  type="submit"
                  className="shrink-0 rounded-lg bg-accent-deep px-3 py-1.5 text-[13px] font-bold text-bg hover:brightness-110"
                >
                  Save
                </button>
              </div>
              <p className="min-h-4 pt-0.5 text-[11.5px] text-muted" aria-live="polite">
                {nameStatus}
              </p>
            </form>
            <button
              type="button"
              className="flex items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left hover:bg-surface-2"
              onClick={() => {
                setProfileOpen(true);
                setOpen(false);
              }}
            >
              <span
                className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent-deep [&_svg]:size-4"
                aria-hidden="true"
              >
                <Icon name="users-round" />
              </span>
              <span className="min-w-0">
                <strong className="block text-[13px] font-bold text-ink">Show Profile</strong>
                <small className="block text-[11.5px] text-muted">Account details and activity</small>
              </span>
            </button>
            <div className="mx-1 my-0.5 border-t border-line-soft" role="separator" />
            <div className="px-1.5">
              <label id="thingy-theme-label" className="text-[11px] font-bold tracking-wider text-muted uppercase">
                Theme
              </label>
              <div className="mt-1 flex gap-1.5" role="radiogroup" aria-labelledby="thingy-theme-label">
                {(['system', 'light', 'dark'] as ThingyTheme[]).map((option) => (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={theme === option}
                    className={`flex-1 rounded-lg border px-0 py-1.5 text-[12px] font-bold transition-colors ${
                      theme === option
                        ? 'border-accent bg-accent-soft text-ink'
                        : 'border-line bg-bg text-ink-soft hover:bg-surface-2'
                    }`}
                    onClick={() => {
                      setTheme(option);
                      setThemeState(option);
                    }}
                  >
                    {option === 'system' ? 'System' : option === 'light' ? 'Light' : 'Dark'}
                  </button>
                ))}
              </div>
            </div>
            <div className="mx-1 my-0.5 border-t border-line-soft" role="separator" />
            <button
              type="button"
              role="menuitem"
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] font-bold text-error hover:bg-error/8 [&_svg]:size-4"
              onClick={handleLogout}
            >
              <Icon name="log-out" />
              Logout
            </button>
            <p className="rail-menu-build px-2 pb-1 font-mono text-[11px] text-muted" title="Thingy build">
              Build {buildId()}
            </p>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
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
