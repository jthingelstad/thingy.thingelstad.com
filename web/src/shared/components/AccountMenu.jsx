import { Fragment, render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useComputed } from '@preact/signals';
import { iconSvg } from '../thingy-icons.js';
import { buildId } from '../thingy-config.js';
import { discordConnection, discordConnectionName, hasSupportingAccess, savePreferredName } from '../thingy-account.js';
import {
  accountMenuOpen,
  accountNameStatus,
  displayEmail,
  displayPreferredName,
  displayProfile,
  signedIn as sharedSignedIn
} from '../stores/ui-store.js';

const LOG_OUT_ICON = iconSvg('log-out');
const PROFILE_ICON = iconSvg('users-round');
const CLOSE_ICON = iconSvg('x');

function ProfileTrigger({ onOpen }) {
  return (
    <button type="button" class="rail-memory-trigger" onClick={onOpen}>
      <span class="rail-memory-trigger-icon" aria-hidden="true" dangerouslySetInnerHTML={{ __html: PROFILE_ICON }} />
      <span class="rail-memory-trigger-copy">
        <strong>Show Profile</strong>
        <small>Account details and activity</small>
      </span>
    </button>
  );
}

function formatProfileDate(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? text : date.toLocaleString();
}

function formatProfileCount(value, label) {
  const count = Number(value || 0);
  return `${count.toLocaleString()} ${label}${count === 1 ? '' : 's'}`;
}

function profileNumber(value) {
  const count = Number(value || 0);
  return Number.isFinite(count) ? count : 0;
}

function formatDurationParts(milliseconds) {
  const minutes = Math.max(0, Math.floor(milliseconds / 60000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const remainingMinutes = minutes % 60;
  const parts = [];
  if (days) parts.push(`${days.toLocaleString()} day${days === 1 ? '' : 's'}`);
  if (hours && parts.length < 2) parts.push(`${hours} hour${hours === 1 ? '' : 's'}`);
  if (!parts.length && remainingMinutes) parts.push(`${remainingMinutes} minute${remainingMinutes === 1 ? '' : 's'}`);
  return parts.length ? parts.join(', ') : 'Less than a minute';
}

function formatActiveSpan(startValue, endValue) {
  const start = new Date(String(startValue || '').trim());
  const end = new Date(String(endValue || '').trim());
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 'Not enough activity yet';
  const diff = Math.max(0, end.getTime() - start.getTime());
  return formatDurationParts(diff);
}

function formatProfileActivity(accountOverview = {}, profile = {}) {
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

function ProfileModal({
  open,
  onClose,
  onProfileDeleted,
  session,
  profile,
  email,
  preferredName,
  connectedName,
  supporting
}) {
  const [viewProfile, setViewProfile] = useState(profile || {});
  const [accountOverview, setAccountOverview] = useState({});
  const [busyAction, setBusyAction] = useState('');
  const [profileError, setProfileError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const onCloseRef = useRef(onClose);
  const viewConnectedName = discordConnectionName(viewProfile) || connectedName;
  const viewPreferredName = String(preferredName || viewProfile.preferred_name || '').trim();
  const firstSeen = accountOverview.first_seen_at || viewProfile.first_seen_at;
  const lastActivity = accountOverview.last_seen_at || viewProfile.last_seen_at;
  const profileRows = [
    viewPreferredName ? ['Name', viewPreferredName] : ['Name', 'Not set'],
    email ? ['Email', email] : null,
    ['Access', supporting ? 'Supporting Member' : 'Weekly Thing reader'],
    viewConnectedName ? ['Discord', viewConnectedName] : ['Discord', 'Not connected in Thingy profile'],
    ['First seen', formatProfileDate(firstSeen) || 'Not recorded'],
    ['Last activity', formatProfileDate(lastActivity) || 'Not recorded'],
    ['Active span', formatActiveSpan(firstSeen, lastActivity)],
    ['Thingy activity', formatProfileActivity(accountOverview, viewProfile)]
  ].filter(Boolean);

  function applyProfileData(data) {
    if (!data?.profile) return;
    const nextProfile =
      typeof session?.mergeProfile === 'function'
        ? session.mergeProfile(data, email)
        : typeof session?.updateStoredProfile === 'function'
          ? session.updateStoredProfile(data.profile)
          : data.profile;
    displayProfile.value = nextProfile;
    displayPreferredName.value = String(nextProfile.preferred_name || displayPreferredName.value || '').trim();
    setViewProfile(nextProfile);
    setAccountOverview(data.account || {});
  }

  async function loadProfile() {
    if (!session?.postJson || !session?.authHeaders) return;
    setBusyAction('load');
    setProfileError('');
    try {
      const data = await session.postJson('/memory', { action: 'get' }, session.authHeaders());
      applyProfileData(data);
    } catch (error) {
      setProfileError(error.message || 'Thingy could not load this profile right now.');
    } finally {
      setBusyAction('');
    }
  }

  async function handleDeleteProfile() {
    if (!session?.postJson || !session?.authHeaders) return;
    setBusyAction('delete_profile');
    setProfileError('');
    try {
      await session.postJson('/memory', { action: 'delete_profile' }, session.authHeaders());
      setConfirmDelete(false);
      if (typeof onProfileDeleted === 'function') onProfileDeleted();
    } catch (error) {
      setProfileError(error.message || 'Thingy could not delete this profile right now.');
    } finally {
      setBusyAction('');
    }
  }

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return undefined;
    function onKey(event) {
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
    loadProfile();
    // Reset-and-reload must run only on open/close transitions, not on
    // every profile identity change while the modal is already open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  function handleBackdropClick(event) {
    if (event.target === event.currentTarget) onClose();
  }

  return (
    <div class="thingy-memory-modal-backdrop" onClick={handleBackdropClick}>
      <section class="thingy-memory-modal" role="dialog" aria-modal="true" aria-labelledby="thingy-memory-title">
        <header class="thingy-memory-header">
          <span
            class="thingy-memory-header-icon"
            aria-hidden="true"
            dangerouslySetInnerHTML={{ __html: PROFILE_ICON }}
          />
          <div>
            <h2 id="thingy-memory-title">Profile</h2>
            <p>Account details and Thingy activity.</p>
          </div>
          <button
            type="button"
            class="thingy-memory-close"
            aria-label="Close Profile"
            onClick={onClose}
            dangerouslySetInnerHTML={{ __html: CLOSE_ICON }}
          />
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

function AccountMenu({
  session,
  signedIn = sharedSignedIn,
  returnTo = '/chat/',
  signedOutEmailLabel = 'Sign in',
  signedOutSubLabel = 'Weekly Thing readers',
  normalizeName = (value) => String(value || '').trim(),
  onOpen,
  onSignedOutClick,
  onLogout,
  onSaved
}) {
  const isSignedIn = signedIn.value;
  const open = accountMenuOpen.value;
  const email = displayEmail.value.trim();
  const profile = displayProfile.value;
  const preferredName = displayPreferredName.value;
  const nameStatus = accountNameStatus.value;
  const display = email || preferredName;
  const supporting = isSignedIn && hasSupportingAccess(profile);

  const initial = useComputed(() => {
    const value = displayEmail.value || displayPreferredName.value;
    return value ? value[0].toUpperCase() : 'T';
  });

  const buttonRef = useRef(null);
  const formRef = useRef(null);
  const inputRef = useRef(null);
  const [profileOpen, setProfileOpen] = useState(false);

  // Close on document click outside the menu, and on Escape.
  useEffect(() => {
    function onDocClick(event) {
      const button = buttonRef.current;
      const menu = button?.parentElement?.querySelector('.rail-menu');
      if (!button || !menu) return;
      if (event.target instanceof Element && (button.contains(event.target) || menu.contains(event.target))) return;
      accountMenuOpen.value = false;
    }
    function onKey(event) {
      if (event.key === 'Escape') accountMenuOpen.value = false;
    }
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  // Keep the name input's value in sync with the preferred-name signal so
  // the form starts from the right state every time the menu opens.
  useEffect(() => {
    if (inputRef.current) inputRef.current.value = preferredName;
    if (open && typeof onOpen === 'function') onOpen();
  }, [preferredName, open, onOpen]);

  function handleButtonClick(event) {
    event.stopPropagation();
    if (!isSignedIn) {
      accountMenuOpen.value = false;
      if (typeof onSignedOutClick === 'function') onSignedOutClick();
      return;
    }
    accountMenuOpen.value = !open;
  }

  async function handleNameSubmit(event) {
    event.preventDefault();
    if (!isSignedIn) return;
    const proposed = inputRef.current?.value || '';
    accountNameStatus.value = 'Saving...';
    try {
      const { data, savedName } = await savePreferredName(session, proposed, normalizeName);
      displayPreferredName.value = savedName;
      if (typeof onSaved === 'function') onSaved(savedName, data);
      accountNameStatus.value = 'Saved.';
    } catch (error) {
      accountNameStatus.value = error.message || 'Could not save that right now.';
    }
  }

  function handleLogout() {
    accountMenuOpen.value = false;
    setProfileOpen(false);
    if (typeof onLogout === 'function') {
      onLogout();
      return;
    }
    session.clearAuth();
    window.location.href = session.signInUrl(returnTo);
  }

  const connection = discordConnection(profile);
  const connectedName = discordConnectionName(profile);

  function handleProfileOpen(event) {
    event.stopPropagation();
    setProfileOpen(true);
    accountMenuOpen.value = false;
  }

  function handleProfileClose() {
    setProfileOpen(false);
  }

  return (
    <>
      <button
        ref={buttonRef}
        class="rail-account-btn"
        type="button"
        aria-haspopup={isSignedIn ? 'true' : 'false'}
        aria-expanded={open ? 'true' : 'false'}
        title={isSignedIn ? 'Account' : 'Sign in'}
        onClick={handleButtonClick}
      >
        <span class="rail-avatar" aria-hidden="true">
          {initial.value}
        </span>
        <span class="rail-account-meta">
          <span class="rail-account-email">{isSignedIn ? display || 'Signed in' : signedOutEmailLabel}</span>
          <span class="rail-account-sub">
            {isSignedIn ? (supporting ? 'Supporting Member' : 'Weekly Thing reader') : signedOutSubLabel}
          </span>
        </span>
        <span
          class="rail-account-caret"
          hidden={!isSignedIn}
          aria-hidden="true"
          dangerouslySetInnerHTML={{ __html: iconSvg('chevron-down') }}
        />
      </button>
      <div class="rail-menu" hidden={!open} role="menu">
        <form ref={formRef} class="rail-account-setting" onSubmit={handleNameSubmit}>
          <label>Name</label>
          <div class="rail-account-setting-row">
            <input
              ref={inputRef}
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
        {supporting ? (
          <div class="rail-account-setting rail-account-discord">
            <span>Discord</span>
            <p>
              {connection
                ? connectedName
                  ? `Connected as ${connectedName}`
                  : 'Connected to Discord.'
                : 'Supporting Members can connect Discord.'}
            </p>
            <a class="rail-menu-link" href="/discord/">
              {connection ? 'Refresh Discord Connection' : 'Link to Discord'}
            </a>
          </div>
        ) : null}
        <ProfileTrigger onOpen={handleProfileOpen} />
        <div class="rail-menu-sep" role="separator" />
        <button type="button" role="menuitem" class="danger" onClick={handleLogout}>
          <span aria-hidden="true" dangerouslySetInnerHTML={{ __html: LOG_OUT_ICON }} />
          Logout
        </button>
        <p class="rail-menu-build" title="Thingy build">
          Build {buildId()}
        </p>
      </div>
      <ProfileModal
        open={profileOpen}
        onClose={handleProfileClose}
        onProfileDeleted={handleLogout}
        session={session}
        profile={profile}
        email={email}
        preferredName={preferredName}
        connectedName={connectedName}
        supporting={supporting}
      />
    </>
  );
}

function mountAccountMenu(host, props = {}) {
  if (!host) return () => {};
  render(<AccountMenu {...props} />, host);
  return () => render(null, host);
}

export { AccountMenu, mountAccountMenu };
