import { render, type JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import * as session from '../thingy-session.ts';
import { normalizePreferredName } from '../thingy-account.ts';
import { createTinylyticsTracker } from '../thingy-analytics.ts';
import { tinylyticsId } from '../thingy-config.ts';
import { createDispatchActions } from '../thingy-dispatch-actions.ts';
import {
  dispatchBusy,
  dispatchInputDisabled,
  dispatchInputPlaceholder,
  dispatchText,
  activeDraftId,
  drafts
} from '../stores/dispatch-store.ts';
import {
  accountMenuOpen,
  accountNameStatus,
  displayEmail,
  displayPreferredName,
  displayProfile,
  mobileRailOpen,
  railCollapsed,
  signedIn
} from '../stores/ui-store.ts';
import { AccountMenu } from './AccountMenu.tsx';
import { ComposerCount } from './ComposerCount.tsx';
import { DispatchActions } from './DispatchActions.tsx';
import { DispatchMessages } from './DispatchMessages.tsx';
import { DispatchRecents } from './DispatchRecents.tsx';
import { DispatchStatus } from './DispatchStatus.tsx';
import { ThingyIcon } from './ThingyIcon.tsx';

const MAX_INPUT_CHARS = 1200;
const COLLAPSED_KEY = 'thingyRailCollapsed';

function dispatchTestMode() {
  const params = new URLSearchParams(window.location.search);
  const value = String(params.get('dispatch_test') || params.get('test') || '')
    .trim()
    .toLowerCase();
  return value === 'template' || value === 'template_test';
}

function restoreCollapsedRail() {
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) === '1';
  } catch (_error) {
    return false;
  }
}

function refreshIdentity(actions: ReturnType<typeof createDispatchActions>) {
  const profile = session.storedProfile() || {};
  signedIn.value = actions.signedIn();
  displayEmail.value = session.storedEmail() || '';
  displayProfile.value = profile;
  displayPreferredName.value = String(profile.preferred_name || '').trim();
}

function DispatchApp() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const actionsRef = useRef<ReturnType<typeof createDispatchActions> | null>(null);
  const [ready, setReady] = useState(false);
  const analytics = useMemo(() => createTinylyticsTracker({ enabled: Boolean(tinylyticsId()) }), []);

  if (!actionsRef.current) {
    actionsRef.current = createDispatchActions({
      session,
      dispatchTestMode: dispatchTestMode(),
      onRender: () => {
        if (actionsRef.current) refreshIdentity(actionsRef.current);
      }
    });
  }
  const actions = actionsRef.current;
  const activeId = activeDraftId.value;
  const draftList = drafts.value;
  const activeSummary = draftList.find((draft) => draft.id === activeId);
  const title = activeSummary?.title || 'Dispatch';
  const mobileOpen = mobileRailOpen.value;
  const collapsed = railCollapsed.value;
  const text = dispatchText.value;
  const inputDisabled = dispatchInputDisabled.value;
  const busy = dispatchBusy.value;
  const editable = ready ? actions.draftEditable(actions.activeDraft()) : false;
  const submitDisabled = busy || !editable || !text.trim();
  const shellClass = [
    'thingy-app-shell',
    'dispatch-shell',
    ready ? '' : 'is-booting',
    collapsed ? 'is-collapsed' : '',
    mobileOpen ? 'is-mobile-rail-open' : ''
  ]
    .filter(Boolean)
    .join(' ');

  useEffect(() => {
    railCollapsed.value = restoreCollapsedRail();
    if (!actions.requireAuth()) return;
    signedIn.value = true;
    if (!actions.hasDrafts()) actions.createDraft({ activate: true, render: false });
    actions.ensureActiveDraft();
    actions.render();
    setReady(true);
    actions.loadHistory().then(() => {
      const draft = actions.activeDraft();
      if (draft.dispatchId && ['queued', 'generating', 'ready_to_send', 'sending'].includes(draft.stage)) {
        actions.startPolling();
      }
    });
    // The action service is intentionally created once for this route root.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0');
    } catch (_error) {
      /* private browsing */
    }
  }, [collapsed]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      accountMenuOpen.value = false;
      accountNameStatus.value = '';
      mobileRailOpen.value = false;
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 240)}px`;
  }, [text]);

  function newDispatch() {
    if (actions.isBusy()) return;
    actions.createDraft({ activate: true, render: true });
    dispatchText.value = '';
    mobileRailOpen.value = false;
  }

  function handleAction(actionId: string) {
    if (actions.isBusy()) return;
    if (actionId === 'generate') void actions.generateDispatch();
    if (actionId === 'check') void actions.pollStatus();
    if (actionId === 'signin') {
      session.clearAuth();
      window.location.href = session.signInUrl('/dispatch/');
    }
  }

  async function handleSubmit(event: JSX.TargetedSubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (actions.isBusy()) return;
    if (!actions.draftEditable(actions.activeDraft())) {
      actions.setStatus('Start a new Dispatch to shape another request.', 'notice');
      actions.render();
      return;
    }
    const message = dispatchText.value.trim();
    if (!message) return;
    dispatchText.value = '';
    actions.addMessage('user', message);
    await actions.planWithThingy(message);
    actions.render();
  }

  return (
    <section class="thingy-page dispatch-shell-page">
      <div class={shellClass} id="dispatch-shell">
        <aside class="rail" aria-label="Thingy Dispatch">
          <div class="rail-top">
            <a
              class="rail-brand"
              href="/"
              aria-label="Thingy home"
              data-tinylytics-event="network.home"
              data-tinylytics-event-value="thingy"
            >
              <img class="rail-mark" src="/img/thingy.png" alt="" width="1022" height="1022" loading="eager" />
            </a>
            <button
              class="rail-iconbtn rail-collapse"
              type="button"
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              aria-pressed={collapsed}
              title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              onClick={() => (railCollapsed.value = !collapsed)}
            >
              <ThingyIcon name="panel-left" />
            </button>
          </div>

          <nav class="rail-surface-switch" aria-label="Thingy surfaces">
            <a href="/chat/">
              <ThingyIcon name="message-square" />
              <span>Chat</span>
            </a>
            <a class="is-active" href="/dispatch/" aria-current="page">
              <ThingyIcon name="newspaper" />
              <span>Dispatch</span>
            </a>
          </nav>

          <button
            class="rail-newchat dispatch-new"
            type="button"
            data-tinylytics-event="dispatch.new"
            title="New Dispatch"
            onClick={newDispatch}
          >
            <ThingyIcon name="plus" />
            <span class="label">New Dispatch</span>
          </button>

          <div class="rail-body">
            <p class="rail-recents-label">Dispatches</p>
            <DispatchRecents
              onOpen={(id) => {
                if (actions.isBusy()) return;
                actions.setActiveDraft(id);
                dispatchText.value = '';
                mobileRailOpen.value = false;
              }}
              onDelete={(id) => void actions.deleteDispatch(id)}
            />
          </div>

          <div class="rail-account">
            <AccountMenu
              session={session}
              signedIn={signedIn}
              returnTo="/dispatch/"
              normalizeName={normalizePreferredName}
              onSaved={() => refreshIdentity(actions)}
            />
          </div>
        </aside>

        <button
          type="button"
          class="rail-scrim"
          hidden={!mobileOpen}
          aria-label="Close Dispatches"
          onClick={() => (mobileRailOpen.value = false)}
        />

        <section class="thingy-conversation dispatch-conversation" aria-label="Thingy Dispatch">
          <h1 class="sr-only">Thingy Dispatch</h1>
          <div class="mobile-chatbar" aria-label="Dispatch">
            <button
              class="mobile-chatbar-circle"
              type="button"
              aria-label={mobileOpen ? 'Hide Dispatches' : 'Show Dispatches'}
              aria-expanded={mobileOpen}
              title={mobileOpen ? 'Hide Dispatches' : 'Show Dispatches'}
              onClick={() => (mobileRailOpen.value = !mobileOpen)}
            >
              <ThingyIcon name="chevron-left" />
            </button>
            <div class="mobile-chatbar-title">
              <span>{title}</span>
            </div>
            <div class="mobile-chatbar-actions">
              <button
                class="mobile-chatbar-action"
                type="button"
                aria-label="New Dispatch"
                title="New Dispatch"
                onClick={newDispatch}
              >
                <ThingyIcon name="plus" />
              </button>
            </div>
          </div>

          <div class="dispatch-chat" id="dispatch-app" hidden={!ready}>
            <div ref={scrollRef} class="thingy-chat-scroll dispatch-scroll">
              <div class="librarian-messages dispatch-messages" aria-live="polite">
                <DispatchMessages scrollContainer={() => scrollRef.current} track={analytics.track} />
              </div>
            </div>

            <div class="thingy-composer-zone dispatch-composer-zone">
              <DispatchActions onAction={handleAction} />
              <form
                class="librarian-form librarian-question-form thingy-input composer-box dispatch-composer"
                onSubmit={handleSubmit}
              >
                <label for="dispatch-input" class="sr-only">
                  Message Thingy about this Dispatch
                </label>
                <textarea
                  ref={inputRef}
                  id="dispatch-input"
                  rows={1}
                  maxLength={MAX_INPUT_CHARS}
                  required
                  value={text}
                  disabled={inputDisabled}
                  placeholder={dispatchInputPlaceholder.value}
                  onInput={(event) => (dispatchText.value = event.currentTarget.value)}
                />
                <div class="composer-toolbar">
                  <DispatchStatus />
                  <span class="composer-spacer" />
                  <ComposerCount maxChars={MAX_INPUT_CHARS} text={dispatchText} />
                  <button
                    type="submit"
                    class="composer-send"
                    disabled={submitDisabled}
                    aria-label="Send to Thingy"
                    title={editable ? 'Send to Thingy' : 'Start a new Dispatch to continue'}
                    data-tinylytics-event="dispatch.message"
                  >
                    <ThingyIcon name="arrow-up" />
                  </button>
                </div>
              </form>
              <p class="thingy-ai-note">
                Dispatches are written by Thingy from Jamie&rsquo;s public archive, then sent by email when you generate
                them.
              </p>
            </div>
          </div>
        </section>
      </div>
    </section>
  );
}

function mountDispatchApp(host: HTMLElement | null) {
  if (!host) return;
  render(<DispatchApp />, host);
}

export { mountDispatchApp };
