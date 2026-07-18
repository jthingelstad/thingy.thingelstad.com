import { render, type JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import * as session from '../thingy-session.ts';
import { hasOwnerAccess, normalizePreferredName } from '../thingy-account.ts';
import { createTinylyticsTracker } from '../thingy-analytics.ts';
import { tinylyticsId } from '../thingy-config.ts';
import { createDispatchActions } from '../thingy-dispatch-actions.ts';
import { dispatchBusy, dispatchInputDisabled, dispatchText, activeDraftId, drafts } from '../stores/dispatch-store.ts';
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
import { DispatchConversationView } from './DispatchConversationView.tsx';
import { DispatchRail } from './DispatchNavigation.tsx';
import { MobileRailScrim } from './MobileRailScrim.tsx';
import { useAutosizeTextarea, usePersistedBooleanSignal } from '../hooks/useThingyBrowserUi.ts';

const MAX_INPUT_CHARS = 1200;
const COLLAPSED_KEY = 'thingyRailCollapsed';

function dispatchTestMode() {
  const params = new URLSearchParams(window.location.search);
  const value = String(params.get('dispatch_test') || params.get('test') || '')
    .trim()
    .toLowerCase();
  return (value === 'template' || value === 'template_test') && hasOwnerAccess(session.storedProfile());
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

  usePersistedBooleanSignal(railCollapsed, COLLAPSED_KEY, collapsed);
  useAutosizeTextarea(inputRef, text);

  useEffect(() => {
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
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      accountMenuOpen.value = false;
      accountNameStatus.value = '';
      mobileRailOpen.value = false;
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

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
        <DispatchRail
          collapsed={collapsed}
          onToggleCollapsed={() => (railCollapsed.value = !collapsed)}
          onNewDispatch={newDispatch}
          onOpen={(id) => {
            if (actions.isBusy()) return;
            actions.setActiveDraft(id);
            dispatchText.value = '';
            mobileRailOpen.value = false;
          }}
          onDelete={(id) => void actions.deleteDispatch(id)}
          accountMenu={
            <AccountMenu
              session={session}
              signedIn={signedIn}
              returnTo="/dispatch/"
              normalizeName={normalizePreferredName}
              onSaved={() => refreshIdentity(actions)}
            />
          }
        />

        <MobileRailScrim open={mobileOpen} label="Close Dispatches" onClose={() => (mobileRailOpen.value = false)} />

        <DispatchConversationView
          scrollRef={scrollRef}
          inputRef={inputRef}
          title={title}
          mobileOpen={mobileOpen}
          ready={ready}
          text={text}
          inputDisabled={inputDisabled}
          editable={editable}
          submitDisabled={submitDisabled}
          maxInputChars={MAX_INPUT_CHARS}
          track={analytics.track}
          onToggleMobileRail={() => (mobileRailOpen.value = !mobileOpen)}
          onNewDispatch={newDispatch}
          onAction={handleAction}
          onSubmit={handleSubmit}
          onTextInput={(value) => (dispatchText.value = value)}
        />
      </div>
    </section>
  );
}

function mountDispatchApp(host: HTMLElement | null) {
  if (!host) return;
  render(<DispatchApp />, host);
}

export { mountDispatchApp };
