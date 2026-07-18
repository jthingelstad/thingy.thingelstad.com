import { type JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useComputed, type Signal } from '@preact/signals';
import { buildId } from '../thingy-config.ts';
import { discordConnection, discordConnectionName, hasSupportingAccess, savePreferredName } from '../thingy-account.ts';
import { errorMessage } from '../thingy-errors.ts';
import {
  accountMenuOpen,
  accountNameStatus,
  displayEmail,
  displayPreferredName,
  displayProfile,
  signedIn as sharedSignedIn
} from '../stores/ui-store.ts';
import { AccountProfileModal } from './AccountProfileModal.tsx';
import { ThingyIcon } from './ThingyIcon.tsx';

type SessionApi = typeof import('../thingy-session.ts');

interface AccountMenuProps {
  session: SessionApi;
  signedIn?: Signal<boolean>;
  returnTo?: string;
  signedOutEmailLabel?: string;
  signedOutSubLabel?: string;
  normalizeName?: (value: unknown) => string;
  onOpen?: () => void;
  onSignedOutClick?: () => void;
  onLogout?: () => void;
  onSaved?: (savedName: string, data: ThingyApiResponse) => void;
}

function ProfileTrigger({ onOpen }: { onOpen: JSX.MouseEventHandler<HTMLButtonElement> }) {
  return (
    <button type="button" class="rail-memory-trigger" onClick={onOpen}>
      <span class="rail-memory-trigger-icon" aria-hidden="true">
        <ThingyIcon name="users-round" />
      </span>
      <span class="rail-memory-trigger-copy">
        <strong>Show Profile</strong>
        <small>Account details and activity</small>
      </span>
    </button>
  );
}

function AccountMenu({
  session,
  signedIn = sharedSignedIn,
  returnTo = '/chat/',
  signedOutEmailLabel = 'Sign in',
  signedOutSubLabel = 'Weekly Thing readers',
  normalizeName = (value: unknown) => String(value || '').trim(),
  onOpen = () => {},
  onSignedOutClick = () => {},
  onLogout,
  onSaved = (_savedName: string, _data: ThingyApiResponse) => {}
}: AccountMenuProps) {
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
  const buttonRef = useRef<HTMLButtonElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [profileOpen, setProfileOpen] = useState(false);

  useEffect(() => {
    function onDocClick(event: MouseEvent) {
      const button = buttonRef.current;
      const menu = button?.parentElement?.querySelector('.rail-menu');
      if (!button || !menu) return;
      if (event.target instanceof Element && (button.contains(event.target) || menu.contains(event.target))) return;
      accountMenuOpen.value = false;
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') accountMenuOpen.value = false;
    }
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  useEffect(() => {
    if (inputRef.current) inputRef.current.value = preferredName;
    if (open) onOpen();
  }, [preferredName, open, onOpen]);

  function handleButtonClick(event: JSX.TargetedMouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    if (!isSignedIn) {
      accountMenuOpen.value = false;
      onSignedOutClick();
      return;
    }
    accountMenuOpen.value = !open;
  }

  async function handleNameSubmit(event: JSX.TargetedSubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isSignedIn) return;
    accountNameStatus.value = 'Saving...';
    try {
      const { data, savedName } = await savePreferredName(session, inputRef.current?.value || '', normalizeName);
      displayPreferredName.value = savedName;
      onSaved(savedName, data);
      accountNameStatus.value = 'Saved.';
    } catch (error) {
      accountNameStatus.value = errorMessage(error, 'Could not save that right now.');
    }
  }

  function handleLogout() {
    accountMenuOpen.value = false;
    setProfileOpen(false);
    if (onLogout) {
      onLogout();
      return;
    }
    session.clearAuth();
    window.location.href = session.signInUrl(returnTo);
  }

  const connection = discordConnection(profile);
  const connectedName = discordConnectionName(profile);

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
        <span class="rail-account-caret" hidden={!isSignedIn} aria-hidden="true">
          <ThingyIcon name="chevron-down" />
        </span>
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
        <ProfileTrigger
          onOpen={(event) => {
            event.stopPropagation();
            setProfileOpen(true);
            accountMenuOpen.value = false;
          }}
        />
        <div class="rail-menu-sep" role="separator" />
        <button type="button" role="menuitem" class="danger" onClick={handleLogout}>
          <ThingyIcon name="log-out" />
          Logout
        </button>
        <p class="rail-menu-build" title="Thingy build">
          Build {buildId()}
        </p>
      </div>
      <AccountProfileModal
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
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

export { AccountMenu };
