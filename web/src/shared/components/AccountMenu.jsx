import { Fragment, render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
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
import {
  memoryFacts,
  memoryInterestItems,
  memoryLearnedItems,
  memoryQuestionItems,
  memorySignalCount,
  memorySummaryItems
} from '../thingy-memory-profile.js';

const LOG_OUT_ICON = iconSvg('log-out');
const BRAIN_ICON = iconSvg('brain-circuit');
const CLOSE_ICON = iconSvg('x');

function MemoryTrigger({ profile, onOpen }) {
  const count = memorySignalCount(profile);
  const detail = count > 0
    ? `${count} remembered signal${count === 1 ? '' : 's'}`
    : 'Profile, interests, and prior context';
  return (
    <button type="button" class="rail-memory-trigger" onClick={onOpen}>
      <span class="rail-memory-trigger-icon" aria-hidden="true" dangerouslySetInnerHTML={{ __html: BRAIN_ICON }} />
      <span class="rail-memory-trigger-copy">
        <strong>View Thingy Memory</strong>
        <small>{detail}</small>
      </span>
    </button>
  );
}

function synthesisStatusText(status = {}) {
  const pending = Number(status.pending_event_count || 0);
  if (pending > 0) return `${pending} new interaction${pending === 1 ? '' : 's'} pending synthesis`;
  if (status.last_synthesized_at) return `Memory current · Last synthesized ${new Date(status.last_synthesized_at).toLocaleString()}`;
  return 'Memory current';
}

function MemoryModal({ open, onClose, session, profile, email, preferredName, connectedName, supporting }) {
  const [activeTab, setActiveTab] = useState('profile');
  const [viewProfile, setViewProfile] = useState(profile || {});
  const [busyAction, setBusyAction] = useState('');
  const [memoryError, setMemoryError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState('');
  const onCloseRef = useRef(onClose);
  const facts = memoryFacts(viewProfile);
  const interests = memoryInterestItems(viewProfile);
  const learned = memoryLearnedItems(viewProfile);
  const questions = memoryQuestionItems(viewProfile);
  const summaries = memorySummaryItems(viewProfile);
  const synthesis = viewProfile.memory_synthesis || {};
  const profileRows = [
    preferredName ? ['Name', preferredName] : null,
    email ? ['Email', email] : null,
    connectedName ? ['Discord', connectedName] : null,
    supporting ? ['Access', 'Supporting Member'] : null
  ].filter(Boolean);
  const tabs = [
    { id: 'profile', label: 'Profile', count: profileRows.length },
    { id: 'details', label: 'Remembered', count: facts.length },
    { id: 'learned', label: 'Learned', count: learned.length },
    { id: 'interests', label: 'Interests', count: interests.length },
    { id: 'threads', label: 'Threads', count: summaries.length },
    { id: 'recent', label: 'Recent', count: questions.length }
  ];

  async function applyMemoryData(data) {
    if (!data?.profile) return;
    const nextProfile = typeof session?.updateStoredProfile === 'function'
      ? session.updateStoredProfile(data.profile)
      : data.profile;
    displayProfile.value = nextProfile;
    displayPreferredName.value = String(nextProfile.preferred_name || displayPreferredName.value || '').trim();
    setViewProfile(nextProfile);
  }

  async function runMemoryAction(payload, actionName) {
    if (!session?.postJson || !session?.authHeaders) return;
    setBusyAction(actionName);
    setMemoryError('');
    try {
      const data = await session.postJson('/memory', payload, session.authHeaders());
      await applyMemoryData(data);
      setConfirmDelete('');
    } catch (error) {
      setMemoryError(error.message || 'Thingy could not update memory right now.');
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
    setMemoryError('');
    setConfirmDelete('');
    runMemoryAction({ action: 'get' }, 'load');
  }, [open]);

  if (!open) return null;

  function handleBackdropClick(event) {
    if (event.target === event.currentTarget) onClose();
  }

  function deleteControl(type, item, label = 'Forget') {
    const key = `${type}:${item.id || item.value || item.label}`;
    const payload = {
      action: 'delete',
      type,
      id: item.id || '',
      value: item.value || item.summary || item.label || ''
    };
    if (confirmDelete === key) {
      return (
        <span class="thingy-memory-delete-confirm">
          <button type="button" onClick={() => runMemoryAction(payload, 'delete')}>Confirm</button>
          <button type="button" onClick={() => setConfirmDelete('')}>Cancel</button>
        </span>
      );
    }
    return (
      <button type="button" class="thingy-memory-delete" onClick={() => setConfirmDelete(key)}>
        {label}
      </button>
    );
  }

  function renderPanel() {
    if (activeTab === 'profile') {
      return profileRows.length ? (
        <dl class="thingy-memory-dl">
          {profileRows.map(([label, value]) => (
            <Fragment key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </Fragment>
          ))}
        </dl>
      ) : (
        <p class="thingy-memory-empty">Thingy does not have profile metadata for this account yet.</p>
      );
    }
    if (activeTab === 'details') {
      return facts.length ? (
        <ul class="thingy-memory-list">
          {facts.map((item) => (
            <li key={`${item.category}:${item.value}`}>
              <div class="thingy-memory-row-head">
                <b>{item.category}</b>
                {deleteControl('remembered_fact', item)}
              </div>
              <span>{item.value}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p class="thingy-memory-empty">Thingy has not saved any explicit remembered details yet.</p>
      );
    }
    if (activeTab === 'interests') {
      return interests.length ? (
        <ul class="thingy-memory-list">
          {interests.map((item) => (
            <li key={item.value}>
              <div class="thingy-memory-row-head">
                <span>{item.value}</span>
                {deleteControl('interest', item)}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p class="thingy-memory-empty">Thingy has not saved any explicit interests yet.</p>
      );
    }
    if (activeTab === 'learned') {
      return learned.length ? (
        <ul class="thingy-memory-list">
          {learned.map((item) => (
            <li key={`${item.id}:${item.label}`}>
              <div class="thingy-memory-row-head">
                <b>{item.label}</b>
                {deleteControl('learned', item, 'Remove')}
              </div>
              {item.summary ? <span>{item.summary}</span> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p class="thingy-memory-empty">Thingy has not synthesized learned memory from engagement yet.</p>
      );
    }
    if (activeTab === 'threads') {
      return summaries.length ? (
        <ul class="thingy-memory-list">
          {summaries.map((item) => (
            <li key={`${item.id}:${item.value}`}>
              <div class="thingy-memory-row-head">
                <span>{item.value}</span>
                {deleteControl('thread', item, 'Remove')}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p class="thingy-memory-empty">No useful prior thread summaries are available yet.</p>
      );
    }
    return questions.length ? (
      <ul class="thingy-memory-list">
        {questions.map((item) => (
          <li key={`${item.id}:${item.value}`}>
            <div class="thingy-memory-row-head">
              <span>{item.value}</span>
              {deleteControl('recent', item, 'Remove')}
            </div>
          </li>
        ))}
      </ul>
    ) : (
      <p class="thingy-memory-empty">No recent questions are available in this session yet.</p>
    );
  }

  return (
    <div class="thingy-memory-modal-backdrop" onClick={handleBackdropClick}>
      <section class="thingy-memory-modal" role="dialog" aria-modal="true" aria-labelledby="thingy-memory-title">
        <header class="thingy-memory-header">
          <span class="thingy-memory-header-icon" aria-hidden="true" dangerouslySetInnerHTML={{ __html: BRAIN_ICON }} />
          <div>
            <h2 id="thingy-memory-title">Thingy Memory</h2>
            <p>Profile metadata and bounded context Thingy can use.</p>
          </div>
          <button type="button" class="thingy-memory-close" aria-label="Close Thingy Memory" onClick={onClose} dangerouslySetInnerHTML={{ __html: CLOSE_ICON }} />
        </header>
        <section class="thingy-memory-status" aria-live="polite">
          <span>{busyAction === 'load' ? 'Loading memory...' : synthesisStatusText(synthesis)}</span>
          <div>
            <button type="button" disabled={Boolean(busyAction)} onClick={() => runMemoryAction({ action: 'synthesize' }, 'synthesize')}>
              {busyAction === 'synthesize' ? 'Updating...' : 'Update Thingy Memory'}
            </button>
            <button type="button" disabled={Boolean(busyAction)} onClick={() => runMemoryAction({ action: 'resynthesize' }, 'resynthesize')}>
              {busyAction === 'resynthesize' ? 'Resynthesizing...' : 'Resynthesize'}
            </button>
          </div>
          {memoryError ? <small>{memoryError}</small> : null}
        </section>
        <nav class="thingy-memory-tabs" role="tablist" aria-label="Thingy memory categories">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id ? 'true' : 'false'}
              aria-controls={`thingy-memory-${tab.id}`}
              id={`thingy-memory-tab-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
            >
              <span>{tab.label}</span>
              {tab.count ? <i>{tab.count}</i> : null}
            </button>
          ))}
        </nav>
        <div
          class="thingy-memory-panel"
          id={`thingy-memory-${activeTab}`}
          role="tabpanel"
          aria-labelledby={`thingy-memory-tab-${activeTab}`}
        >
          {renderPanel()}
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
  const [memoryOpen, setMemoryOpen] = useState(false);

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
    setMemoryOpen(false);
    if (typeof onLogout === 'function') {
      onLogout();
      return;
    }
    session.clearAuth();
    window.location.href = session.signInUrl(returnTo);
  }

  const connection = discordConnection(profile);
  const connectedName = discordConnectionName(profile);

  function handleMemoryOpen(event) {
    event.stopPropagation();
    setMemoryOpen(true);
    accountMenuOpen.value = false;
  }

  function handleMemoryClose() {
    setMemoryOpen(false);
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
        <MemoryTrigger profile={profile} onOpen={handleMemoryOpen} />
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
      <MemoryModal
        open={memoryOpen}
        onClose={handleMemoryClose}
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
