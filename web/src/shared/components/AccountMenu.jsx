import { render } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { useComputed } from '@preact/signals';
import { iconSvg } from '../thingy-icons.js';
import { buildId } from '../thingy-config.js';
import {
  discordConnection,
  discordConnectionName,
  hasSupportingAccess,
  savePreferredName
} from '../thingy-account.js';
import {
  accountMenuOpen,
  accountNameStatus,
  displayEmail,
  displayPreferredName,
  displayProfile,
  signedIn as sharedSignedIn
} from '../stores/ui-store.js';

const LOG_OUT_ICON = iconSvg('log-out');

function cleanText(value, max = 180) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function profileList(value, mapper) {
  return Array.isArray(value) ? value.map(mapper).filter(Boolean) : [];
}

function memoryFacts(profile) {
  return profileList(profile.remembered_facts, (item) => {
    const category = cleanText(item?.category || 'detail', 40);
    const value = cleanText(item?.value || item, 160);
    return value ? { category, value } : null;
  }).slice(-6);
}

function memoryInterests(profile) {
  return profileList(profile.interests, (item) => cleanText(item, 80)).slice(-8);
}

function memoryQuestions(profile) {
  return profileList(profile.current_session_questions, (item) => cleanText(item?.question || item, 140)).slice(-4);
}

function memorySummaries(profile) {
  return profileList(profile.prior_session_summaries, (item) => cleanText(item?.summary || item, 180)).slice(-3);
}

function MemoryPanel({ profile, preferredName, connectedName, supporting }) {
  const facts = memoryFacts(profile);
  const interests = memoryInterests(profile);
  const questions = memoryQuestions(profile);
  const summaries = memorySummaries(profile);
  const hasProfile = Boolean(preferredName || connectedName || supporting);
  const hasMemory = Boolean(facts.length || interests.length || questions.length || summaries.length);
  if (!hasProfile && !hasMemory) return null;

  return (
    <section class="rail-account-memory" aria-label="Thingy memory">
      <div class="rail-account-memory-head">
        <span aria-hidden="true" dangerouslySetInnerHTML={{ __html: iconSvg('brain-circuit') }} />
        <div>
          <strong>Thingy Memory</strong>
          <small>Profile and context Thingy can use</small>
        </div>
      </div>
      {hasProfile ? (
        <dl class="rail-account-memory-list">
          {preferredName ? (
            <>
              <dt>Name</dt>
              <dd>{preferredName}</dd>
            </>
          ) : null}
          {connectedName ? (
            <>
              <dt>Discord</dt>
              <dd>{connectedName}</dd>
            </>
          ) : null}
          {supporting ? (
            <>
              <dt>Access</dt>
              <dd>Supporting Member</dd>
            </>
          ) : null}
        </dl>
      ) : null}
      {interests.length ? (
        <div class="rail-account-memory-block">
          <span>Interests</span>
          <div class="rail-account-memory-tags">
            {interests.map((item) => <i key={item}>{item}</i>)}
          </div>
        </div>
      ) : null}
      {facts.length ? (
        <div class="rail-account-memory-block">
          <span>Remembered Details</span>
          <ul>
            {facts.map((item) => (
              <li key={`${item.category}:${item.value}`}>
                <b>{item.category}</b>
                <em>{item.value}</em>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {summaries.length ? (
        <div class="rail-account-memory-block">
          <span>Prior Threads</span>
          <ul>
            {summaries.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </div>
      ) : null}
      {questions.length ? (
        <div class="rail-account-memory-block">
          <span>Recent Questions</span>
          <ul>
            {questions.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </div>
      ) : null}
    </section>
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
            <p>{connection ? (connectedName ? `Connected as ${connectedName}` : 'Connected to Discord.') : 'Supporting Members can connect Discord.'}</p>
            <a class="rail-menu-link" href="/discord/">{connection ? 'Refresh Discord Connection' : 'Link to Discord'}</a>
          </div>
        ) : null}
        <MemoryPanel
          profile={profile}
          preferredName={preferredName}
          connectedName={connectedName}
          supporting={supporting}
        />
        <div class="rail-menu-sep" role="separator" />
        <button
          type="button"
          role="menuitem"
          class="danger"
          onClick={handleLogout}
        >
          <span aria-hidden="true" dangerouslySetInnerHTML={{ __html: LOG_OUT_ICON }} />Logout
        </button>
        <p class="rail-menu-build" title="Thingy build">Build {buildId()}</p>
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
