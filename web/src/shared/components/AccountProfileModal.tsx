import { Fragment, type JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { discordConnectionName } from '../thingy-account.ts';
import { errorMessage } from '../thingy-errors.ts';
import { displayPreferredName, displayProfile } from '../stores/ui-store.ts';
import { ThingyIcon } from './ThingyIcon.tsx';

type SessionApi = typeof import('../thingy-session.ts');

interface AccountProfileModalProps {
  open: boolean;
  onClose: () => void;
  onProfileDeleted: () => void;
  session: SessionApi;
  profile: LibrarianProfile;
  email: string;
  preferredName: string;
  connectedName: string;
  supporting: boolean;
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

function AccountProfileModal({
  open,
  onClose,
  onProfileDeleted,
  session,
  profile,
  email,
  preferredName,
  connectedName,
  supporting
}: AccountProfileModalProps) {
  const [viewProfile, setViewProfile] = useState<LibrarianProfile>(profile || {});
  const [accountOverview, setAccountOverview] = useState<LibrarianAccountOverview>({});
  const [busyAction, setBusyAction] = useState('');
  const [profileError, setProfileError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const onCloseRef = useRef(onClose);
  const viewConnectedName = discordConnectionName(viewProfile) || connectedName;
  const viewPreferredName = String(preferredName || viewProfile.preferred_name || '').trim();
  const firstSeen = accountOverview.first_seen_at || viewProfile.first_seen_at;
  const lastActivity = accountOverview.last_seen_at || viewProfile.last_seen_at;
  const profileRows = (
    [
      viewPreferredName ? ['Name', viewPreferredName] : ['Name', 'Not set'],
      email ? ['Email', email] : null,
      ['Access', supporting ? 'Supporting Member' : 'Weekly Thing reader'],
      viewConnectedName ? ['Discord', viewConnectedName] : ['Discord', 'Not connected in Thingy profile'],
      ['First seen', formatProfileDate(firstSeen) || 'Not recorded'],
      ['Last activity', formatProfileDate(lastActivity) || 'Not recorded'],
      ['Active span', formatActiveSpan(firstSeen, lastActivity)],
      ['Thingy activity', formatProfileActivity(accountOverview, viewProfile)]
    ] as Array<[string, string] | null>
  ).filter((row): row is [string, string] => row !== null);

  function applyProfileData(data: ThingyApiResponse) {
    if (!data.profile) return;
    const nextProfile = session.mergeProfile(data, email);
    displayProfile.value = nextProfile;
    displayPreferredName.value = String(nextProfile.preferred_name || displayPreferredName.value || '').trim();
    setViewProfile(nextProfile);
    setAccountOverview(data.account || {});
  }

  async function loadProfile() {
    setBusyAction('load');
    setProfileError('');
    try {
      applyProfileData(await session.postJson('/memory', { action: 'get' }, session.authHeaders()));
    } catch (error) {
      setProfileError(errorMessage(error, 'Thingy could not load this profile right now.'));
    } finally {
      setBusyAction('');
    }
  }

  async function handleDeleteProfile() {
    setBusyAction('delete_profile');
    setProfileError('');
    try {
      await session.postJson('/memory', { action: 'delete_profile' }, session.authHeaders());
      setConfirmDelete(false);
      onProfileDeleted();
    } catch (error) {
      setProfileError(errorMessage(error, 'Thingy could not delete this profile right now.'));
    } finally {
      setBusyAction('');
    }
  }

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return undefined;
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onCloseRef.current();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setViewProfile(profile || {});
    setAccountOverview({});
    setProfileError('');
    setConfirmDelete(false);
    void loadProfile();
    // Reset-and-reload must run only on open/close transitions.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  function handleBackdropClick(event: JSX.TargetedMouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) onClose();
  }

  return (
    <div class="thingy-memory-modal-backdrop" onClick={handleBackdropClick}>
      <section class="thingy-memory-modal" role="dialog" aria-modal="true" aria-labelledby="thingy-memory-title">
        <header class="thingy-memory-header">
          <span class="thingy-memory-header-icon" aria-hidden="true">
            <ThingyIcon name="users-round" />
          </span>
          <div>
            <h2 id="thingy-memory-title">Profile</h2>
            <p>Account details and Thingy activity.</p>
          </div>
          <button type="button" class="thingy-memory-close" aria-label="Close Profile" onClick={onClose}>
            <ThingyIcon name="x" />
          </button>
        </header>
        <section class="thingy-memory-status" aria-live="polite">
          <span>{busyAction === 'load' ? 'Loading profile...' : ''}</span>
          {profileError ? <small>{profileError}</small> : null}
        </section>
        <div class="thingy-memory-panel">
          <dl class="thingy-memory-dl">
            {profileRows.map(([label, value]) => (
              <Fragment key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </Fragment>
            ))}
          </dl>
          <section class="thingy-memory-danger-zone" aria-label="Delete Thingy Profile">
            <h3>Delete Thingy Profile</h3>
            <p>
              This deletes your Thingy profile, conversations, Dispatch history, and Discord link. It does not
              unsubscribe you from Weekly Thing.
            </p>
            {confirmDelete ? (
              <div class="thingy-memory-danger-actions">
                <p class="thingy-memory-confirm-copy">Are you sure? This cannot be undone from Thingy.</p>
                <button
                  type="button"
                  class="thingy-memory-danger"
                  disabled={busyAction === 'delete_profile'}
                  onClick={handleDeleteProfile}
                >
                  {busyAction === 'delete_profile' ? 'Deleting...' : 'Confirm Delete Thingy Profile'}
                </button>
                <button
                  type="button"
                  disabled={busyAction === 'delete_profile'}
                  onClick={() => setConfirmDelete(false)}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                class="thingy-memory-danger"
                disabled={Boolean(busyAction)}
                onClick={() => setConfirmDelete(true)}
              >
                Delete Thingy Profile
              </button>
            )}
          </section>
        </div>
      </section>
    </div>
  );
}

export { AccountProfileModal };
