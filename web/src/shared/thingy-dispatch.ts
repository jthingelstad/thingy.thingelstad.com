// Boot wiring for /dispatch/: DOM lookups, island mounts, and event
// listeners. All draft/server/polling logic lives in
// thingy-dispatch-actions.js; this file only connects the actions to
// the page.

import * as session from './thingy-session.ts';
import { effect } from '@preact/signals';
import { normalizePreferredName } from './thingy-account.ts';
import { createComposer } from './thingy-composer.ts';
import { createTinylyticsTracker } from './thingy-analytics.ts';
import { tinylyticsId } from './thingy-config.ts';
import { attachRailState } from './thingy-rail-state.ts';
import { createDispatchActions, draftTitle } from './thingy-dispatch-actions.ts';
import {
  accountMenuOpen as accountMenuOpenSignal,
  accountNameStatus as accountNameStatusSignal,
  displayEmail as displayEmailSignal,
  displayPreferredName as displayPreferredNameSignal,
  displayProfile as displayProfileSignal,
  signedIn as signedInSignal
} from './stores/ui-store.ts';
import { mountAccountMenu } from './components/AccountMenu.tsx';
import { mountComposerCount } from './components/ComposerCount.tsx';
import { mountDispatchRecents } from './components/DispatchRecents.tsx';
import { mountDispatchStatus } from './components/DispatchStatus.tsx';
import { mountDispatchActions } from './components/DispatchActions.tsx';
import { mountDispatchMessages } from './components/DispatchMessages.tsx';
import {
  dispatchInputDisabled as dispatchInputDisabledSignal,
  dispatchInputPlaceholder as dispatchInputPlaceholderSignal,
  dispatchText as dispatchTextSignal
} from './stores/dispatch-store.ts';

function bootDispatch() {
  const shell = document.getElementById('dispatch-shell');
  const app = document.getElementById('dispatch-app');
  const messagesMount = document.getElementById('dispatch-messages-mount');
  const recentsMount = document.getElementById('dispatch-recents-mount');
  const statusMount = document.getElementById('dispatch-status-mount');
  const actionsMount = document.getElementById('dispatch-actions-mount');
  const form = document.getElementById('dispatch-form') as HTMLFormElement;
  const input = document.getElementById('dispatch-input') as HTMLTextAreaElement;
  const countEl = document.getElementById('dispatch-count');
  const newButtons = [
    document.getElementById('dispatch-new') as HTMLButtonElement,
    document.getElementById('dispatch-mobile-new') as HTMLButtonElement
  ].filter(Boolean);
  const accountMount = document.getElementById('dispatch-rail-account-mount');
  const mobileTitle = document.getElementById('dispatch-mobile-title');
  const mobileToggle = document.getElementById('dispatch-mobile-toggle');
  const railScrim = document.getElementById('dispatch-rail-scrim');
  const railCollapseBtn = document.getElementById('dispatch-rail-collapse');
  const maxInputChars = Number((input && input.getAttribute('maxlength')) || 1200);
  const dispatchTestMode = (() => {
    const params = new URLSearchParams(window.location.search);
    const value = String(params.get('dispatch_test') || params.get('test') || '')
      .trim()
      .toLowerCase();
    return value === 'template' || value === 'template_test';
  })();
  const analytics = createTinylyticsTracker({ enabled: Boolean(tinylyticsId()) });

  const railControls = attachRailState({
    shell,
    mobileToggle,
    scrim: railScrim,
    collapseButton: railCollapseBtn,
    collapsedKey: 'thingyRailCollapsed',
    showLabel: 'Show Dispatches',
    hideLabel: 'Hide Dispatches'
  });

  let composerControls: ReturnType<typeof createComposer> | null = null;

  function updateCount() {
    if (input) dispatchTextSignal.value = input.value;
    if (composerControls) composerControls.sync();
  }

  function updateComposerState() {
    const submit = form && form.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (!submit) return;
    const editable = actions.draftEditable(actions.activeDraft());
    submit.disabled = actions.isBusy() || !editable || !input?.value.trim();
    submit.title = editable ? 'Send to Thingy' : 'Start a new Dispatch to continue';
  }

  function refreshIdentity() {
    // AccountMenu reads these signals; bootstrap and post-save flows push
    // the latest stored identity into them.
    const profile = session.storedProfile() || {};
    signedInSignal.value = actions.signedIn();
    displayEmailSignal.value = session.storedEmail() || '';
    displayProfileSignal.value = profile;
    displayPreferredNameSignal.value = String(profile.preferred_name || '').trim();
    if (mobileTitle) mobileTitle.textContent = draftTitle(actions.activeDraft());
  }

  const actions = createDispatchActions({
    session,
    dispatchTestMode,
    onRender: () => {
      refreshIdentity();
      updateCount();
      updateComposerState();
    }
  });

  // Mirror the input enablement signals onto the textarea.
  effect(() => {
    if (!input) return;
    input.disabled = dispatchInputDisabledSignal.value;
    input.placeholder = dispatchInputPlaceholderSignal.value;
  });

  if (!actions.requireAuth()) return;
  signedInSignal.value = true;
  if (!actions.hasDrafts()) actions.createDraft({ activate: true, render: false });
  actions.ensureActiveDraft();
  if (shell) shell.classList.remove('is-booting', 'is-auth');
  if (app) app.hidden = false;

  mountAccountMenu(accountMount, {
    session,
    signedIn: signedInSignal,
    returnTo: '/dispatch/',
    normalizeName: normalizePreferredName,
    onSaved: () => refreshIdentity()
  });

  function handleAction(actionId: string) {
    if (actions.isBusy()) return;
    if (actionId === 'generate') actions.generateDispatch();
    if (actionId === 'check') actions.pollStatus();
    if (actionId === 'signin') {
      session.clearAuth();
      window.location.href = session.signInUrl('/dispatch/');
    }
  }

  mountDispatchRecents(recentsMount, {
    onOpen: (id) => {
      // Switching drafts while clarify/generate is in flight would make the
      // async flow save its result onto the wrong draft.
      if (actions.isBusy()) return;
      actions.setActiveDraft(id);
      railControls.setMobileOpen(false);
    },
    onDelete: (id) => actions.deleteDispatch(id)
  });
  mountDispatchStatus(statusMount);
  mountDispatchActions(actionsMount, { onAction: handleAction });
  mountDispatchMessages(messagesMount, {
    scrollContainer: () => document.querySelector('.dispatch-scroll'),
    track: (name, value) => analytics.track(name, value)
  });

  if (form) {
    if (countEl) {
      countEl.replaceChildren();
      mountComposerCount(countEl, { maxChars: maxInputChars, text: dispatchTextSignal });
    }
    composerControls = createComposer({
      form,
      input,
      maxChars: maxInputChars,
      isBusy: actions.isBusy,
      autoSize: true,
      maxHeight: 240,
      onSubmit: async () => {
        if (actions.isBusy() || !input) return;
        if (!actions.draftEditable(actions.activeDraft())) {
          actions.setStatus('Start a new Dispatch to shape another request.', 'notice');
          actions.render();
          return;
        }
        const text = input.value.trim();
        if (!text) return;
        input.value = '';
        updateCount();
        updateComposerState();
        actions.addMessage('user', text);
        await actions.planWithThingy(text);
        actions.render();
      },
      onInput: () => {
        updateCount();
        updateComposerState();
      }
    });
  }

  newButtons.forEach((button) =>
    button.addEventListener('click', () => {
      actions.createDraft({ activate: true, render: true });
      railControls.setMobileOpen(false);
    })
  );

  // AccountMenu owns its own outside-click + Escape close listeners. We
  // still close the mobile rail on Escape here.
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      accountMenuOpenSignal.value = false;
      accountNameStatusSignal.value = '';
      railControls.setMobileOpen(false);
    }
  });

  actions.render();
  actions.loadHistory().then(() => {
    const draft = actions.activeDraft();
    if (draft.dispatchId && ['queued', 'generating', 'ready_to_send', 'sending'].includes(draft.stage))
      actions.startPolling();
  });
}

export { bootDispatch };
