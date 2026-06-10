import { render } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { useComputed } from '@preact/signals';
import { iconSvg } from '../thingy-icons.js';
import { hasSupportingAccess, savePreferredName } from '../thingy-account.js';
import {
  accountMenuOpen,
  accountNameStatus,
  displayEmail,
  displayPreferredName,
  displayProfile
} from '../stores/ui-store.js';
import { signedIn as chatSignedIn } from '../stores/chat-store.js';

const LOG_OUT_ICON = iconSvg('log-out');

function AccountMenu({
  session,
  signedIn = chatSignedIn,
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
    if (typeof onLogout === 'function') {
      onLogout();
      return;
    }
    session.clearAuth();
    window.location.href = session.signInUrl(returnTo);
  }

  const connection = (profile && profile.discord_connection && typeof profile.discord_connection === 'object')
    ? profile.discord_connection
    : null;
  const connectedName = String(connection?.display_name || connection?.global_name || connection?.username || '').trim();

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
        <span class="rail-avatar" aria-hidden="true">{initial.value}</span>
        <span class="rail-account-meta">
          <span class="rail-account-email">{isSignedIn ? (display || 'Signed in') : signedOutEmailLabel}</span>
          <span class="rail-account-sub">{isSignedIn ? (supporting ? 'Supporting Member' : 'Weekly Thing reader') : signedOutSubLabel}</span>
        </span>
        <span class="rail-account-caret" hidden={!isSignedIn} aria-hidden="true" dangerouslySetInnerHTML={{ __html: iconSvg('chevron-down') }} />
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
            <p>{connectedName ? `Connected as ${connectedName}` : 'Supporting Members can connect Discord.'}</p>
            <a class="rail-menu-link" href="/discord/">{connectedName ? 'Refresh Discord Connection' : 'Link to Discord'}</a>
          </div>
        ) : null}
        <div class="rail-menu-sep" role="separator" />
        <button
          type="button"
          role="menuitem"
          class="danger"
          onClick={handleLogout}
        >
          <span aria-hidden="true" dangerouslySetInnerHTML={{ __html: LOG_OUT_ICON }} />Logout
        </button>
      </div>
    </>
  );
}

function mountAccountMenu(host, props = {}) {
  if (!host) return () => {};
  render(<AccountMenu {...props} />, host);
  return () => render(null, host);
}

export { AccountMenu, mountAccountMenu };
