import * as session from './thingy-session.js';
import {
  normalizePreferredName,
} from './thingy-account.js';
import { createComposer } from './thingy-composer.js';
import { createThingyShell } from './thingy-shell.js';
import { mountComposerCount } from './components/ComposerCount.jsx';
import { mountDispatchRecents } from './components/DispatchRecents.jsx';
import { mountDispatchStatus } from './components/DispatchStatus.jsx';
import { mountDispatchActions } from './components/DispatchActions.jsx';
import { mountDispatchMessages } from './components/DispatchMessages.jsx';
import {
  activeDraftId as activeDraftIdSignal,
  dispatchActions as dispatchActionsSignal,
  dispatchMessages as dispatchMessagesSignal,
  dispatchStatusKind as dispatchStatusKindSignal,
  dispatchStatusMessage as dispatchStatusMessageSignal,
  dispatchText as dispatchTextSignal,
  drafts as draftsSignal
} from './stores/chat-store.js';
import {
  draftFromServerRow,
  hasDraftContent,
  normalizeDraft,
  serverDispatchId
} from './thingy-dispatch-drafts.js';
import { dispatchEditable } from './thingy-dispatch-state.js';

function bootDispatch() {
  const shell = document.getElementById('dispatch-shell');
  const app = document.getElementById('dispatch-app');
  const messagesMount = document.getElementById('dispatch-messages-mount');
  const recentsMount = document.getElementById('dispatch-recents-mount');
  const statusMount = document.getElementById('dispatch-status-mount');
  const actionsMount = document.getElementById('dispatch-actions-mount');
  const form = document.getElementById('dispatch-form');
  const input = document.getElementById('dispatch-input');
  const countEl = document.getElementById('dispatch-count');
  const newButtons = [document.getElementById('dispatch-new'), document.getElementById('dispatch-mobile-new')].filter(Boolean);
  const accountEmail = document.getElementById('dispatch-account-email');
  const accountSub = document.getElementById('dispatch-account-sub');
  const accountAvatar = document.getElementById('dispatch-account-avatar');
  const accountBtn = document.getElementById('dispatch-account-btn');
  const accountMenu = document.getElementById('dispatch-account-menu');
  const accountNameForm = document.getElementById('dispatch-account-name-form');
  const accountNameInput = document.getElementById('dispatch-account-name-input');
  const accountNameStatus = document.getElementById('dispatch-account-name-status');
  const logoutButton = document.getElementById('dispatch-logout');
  const accountElements = {
    email: accountEmail,
    avatar: accountAvatar,
    sub: accountSub,
    button: accountBtn,
    caret: document.querySelector('#dispatch-account-btn .rail-account-caret'),
    nameInput: accountNameInput,
    discordRow: document.getElementById('dispatch-account-discord-row'),
    discordLink: document.getElementById('dispatch-account-discord-link'),
    discordStatus: document.getElementById('dispatch-account-discord-status')
  };
  const mobileTitle = document.getElementById('dispatch-mobile-title');
  const mobileToggle = document.getElementById('dispatch-mobile-toggle');
  const railScrim = document.getElementById('dispatch-rail-scrim');
  const railCollapseBtn = document.getElementById('dispatch-rail-collapse');
  const activeKey = 'thingyActiveDispatchDraft';
  const shellControls = createThingyShell({
    rail: {
      shell,
      mobileToggle,
      scrim: railScrim,
      collapseButton: railCollapseBtn,
      collapsedKey: 'thingyRailCollapsed',
      showLabel: 'Show Dispatches',
      hideLabel: 'Hide Dispatches'
    },
    account: {
      session,
      button: accountBtn,
      menu: accountMenu,
      nameForm: accountNameForm,
      nameInput: accountNameInput,
      nameStatus: accountNameStatus,
      logoutButton,
      normalizeName: normalizePreferredName,
      signedIn,
      returnTo: '/dispatch/',
      elements: accountElements,
      onSaved: () => refreshIdentity()
    }
  });
  const railControls = shellControls.rail;
  const accountControls = shellControls.account;
  const welcomeText = "What should this Dispatch explore? Give me a topic, question, or thread from Jamie's archive and I'll help shape it before you send it.";
  const maxInputChars = Number(input && input.getAttribute('maxlength') || 1200);
  const dispatchTestMode = (() => {
    const params = new URLSearchParams(window.location.search);
    const value = String(params.get('dispatch_test') || params.get('test') || '').trim().toLowerCase();
    return value === 'template' || value === 'template_test';
  })();
  let drafts = [];
  let activeId = window.localStorage.getItem(activeKey) || '';
  let busy = false;
  let pollTimer = 0;
  let pollingDraftId = '';
  let composerControls = null;

  function nowIso() {
    return new Date().toISOString();
  }

  function draftTitle(draft) {
    return draft.title || draft.prompt || draft.direction || 'New Dispatch';
  }

  function draftEditable(draft) {
    return dispatchEditable(draft?.stage);
  }

  function saveDrafts() {
    drafts.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    drafts = drafts.slice(0, 24);
  }

  function activeDraft() {
    let draft = drafts.find((entry) => entry.id === activeId);
    if (!draft) draft = createDraft({ activate: true });
    return draft;
  }

  function draftById(id) {
    return drafts.find((entry) => entry.id === id);
  }

  function createDraft(options = {}) {
    const draft = normalizeDraft({
      stage: 'empty',
      messages: [{
        role: 'assistant',
        text: welcomeText
      }]
    });
    drafts = drafts.filter((entry) => serverDispatchId(entry) || hasDraftContent(entry, welcomeText));
    drafts.unshift(draft);
    if (options.activate !== false) setActiveDraft(draft.id, { render: Boolean(options.render) });
    saveDrafts();
    return draft;
  }

  function updateDraft(patch = {}) {
    const draft = activeDraft();
    Object.assign(draft, patch, { updatedAt: nowIso() });
    saveDrafts();
    return draft;
  }

  function addMessage(role, text, extra = {}) {
    const draft = activeDraft();
    draft.messages.push({
      role,
      text: String(text || ''),
      time: nowIso(),
      ...extra
    });
    draft.updatedAt = nowIso();
    saveDrafts();
    return draft;
  }

  function setActiveDraft(id, options = {}) {
    activeId = String(id || '');
    if (activeId) window.localStorage.setItem(activeKey, activeId);
    if (options.render !== false) render();
  }

  function signedIn() {
    return session.token() && !session.tokenExpired();
  }

  function requireAuth() {
    if (signedIn()) return true;
    window.location.href = session.signInUrl('/dispatch/');
    return false;
  }

  async function dispatchPost(action, extra) {
    if (!(await session.ensureFreshToken())) {
      session.clearAuth();
      requireAuth();
      throw new Error('Sign in again to continue.');
    }
    return await session.postJson('/dispatch', { action, ...(extra || {}) }, session.authHeaders());
  }

  async function saveDraftToServer(draft = activeDraft(), overrides = {}) {
    if (!signedIn() || !hasDraftContent(draft, welcomeText)) return draft;
    const serverId = serverDispatchId(draft);
    const data = await dispatchPost('save_draft', {
      dispatch_id: serverId,
      status: overrides.status || draft.stage || 'draft',
      topic: draft.prompt || draft.title,
      prompt: draft.prompt,
      direction: draft.direction,
      clarification_question: draft.currentQuestion,
      clarification_answer: draft.clarificationAnswer,
      title: draftTitle(draft),
      messages: draft.messages || []
    });
    const row = data.dispatch || {};
    const newId = String(row.id || row.dispatch_id || '');
    if (newId && draft.id !== newId) {
      const oldId = draft.id;
      draft.id = newId;
      draft.dispatchId = newId;
      if (activeId === oldId) setActiveDraft(newId, { render: false });
    } else if (newId) {
      draft.dispatchId = newId;
    }
    draft.updatedAt = row.updated_at || draft.updatedAt || nowIso();
    saveDrafts();
    return draft;
  }

  function setBusy(value, text = '') {
    busy = Boolean(value);
    updateComposerState();
    setStatus(text || '');
  }

  function setStatus(text, kind = '') {
    dispatchStatusMessageSignal.value = text || '';
    dispatchStatusKindSignal.value = kind || '';
  }

  function updateComposerState() {
    const draft = activeDraft();
    const editable = draftEditable(draft);
    if (input) input.disabled = busy || !editable;
    const submit = form && form.querySelector('button[type="submit"]');
    if (submit) {
      submit.disabled = busy || !editable || !input?.value.trim();
      submit.title = editable ? 'Send to Thingy' : 'Start a new Dispatch to continue';
    }
  }

  function refreshIdentity() {
    accountControls?.refresh({
      signedIn: signedIn(),
      email: session.storedEmail(),
      profile: session.storedProfile()
    });
    if (mobileTitle) mobileTitle.textContent = draftTitle(activeDraft());
  }

  function setMobileRailOpen(open) {
    railControls.setMobileOpen(open);
  }

  function renderActions(draft) {
    const items = [];
    if (draft.stage === 'ready' || draft.stage === 'upgrade') {
      items.push({
        id: 'generate',
        label: dispatchTestMode ? 'Send Template Test' : 'Generate Dispatch',
        kind: 'primary'
      });
    }
    if (draft.stage === 'upgrade') {
      items.push({
        id: 'supporting',
        label: 'Supporting Membership',
        kind: 'link',
        href: 'https://www.thingelstad.com/2024/11/17/weekly-thing-supporting.html'
      });
      items.push({
        id: 'signin',
        label: 'I joined, sign in again',
        kind: 'secondary'
      });
    }
    if (draft.stage === 'queued' || draft.stage === 'generating') {
      items.push({
        id: 'check',
        label: 'Check Status',
        kind: 'secondary'
      });
    }
    dispatchActionsSignal.value = items;
  }

  function renderRecents() {
    draftsSignal.value = drafts.slice(0, 24).map((draft) => ({
      id: draft.id,
      title: draftTitle(draft),
      stage: draft.stage
    }));
    activeDraftIdSignal.value = activeId || null;
  }

  function render() {
    const draft = activeDraft();
    if (!draft.messages.length) {
      draft.messages.push({
        role: 'assistant',
        text: welcomeText
      });
    }
    dispatchMessagesSignal.value = draft.messages.slice();
    if (input) {
      const editable = draftEditable(draft);
      input.disabled = !editable;
      input.placeholder = !editable
        ? 'Start a new Dispatch to shape another request...'
        : draft.stage === 'needs_clarification'
        ? 'Answer Thingy’s clarification question...'
        : draft.stage === 'ready' || draft.stage === 'upgrade'
          ? 'Adjust the direction, or generate when ready...'
          : 'Tell Thingy what this Dispatch should explore...';
      updateComposerState();
    }
    renderActions(draft);
    renderRecents();
    refreshIdentity();
    updateCount();
  }

  function updateCount() {
    if (input) dispatchTextSignal.value = input.value;
    if (composerControls) composerControls.sync();
  }

  function titleFromPrompt(value) {
    return String(value || 'Dispatch').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Dispatch';
  }

  function assistantClarificationText(data) {
    const message = String(data.message || '').trim();
    const question = String(data.question || '').trim();
    if (message && question && !message.includes(question)) return `${message}\n\n${question}`;
    return message || question || 'What angle should I use for this Dispatch?';
  }

  function readyDispatchText(data, direction) {
    const message = String(data.message || '').trim();
    const claimsStarted = /\b(?:generating now|generate now|drafting now|sending now|emailing now)\b/i.test(message);
    if (message && !message.includes('?') && !claimsStarted) return message;
    return `I have shaped this Dispatch direction:\n\n${direction}\n\nIf this is right, use Generate Dispatch. If you want to steer it, send me the adjustment.`;
  }

  function clarifyRequest(draft, text) {
    const seed = draft.prompt || text;
    if (draft.stage === 'needs_clarification') {
      return {
        prompt: seed,
        answer: text,
        nextPrompt: seed,
        nextDirection: draft.direction,
        nextQuestion: draft.currentQuestion
      };
    }
    if (draft.stage === 'ready' || draft.stage === 'upgrade') {
      return {
        prompt: [
          seed ? `Original Dispatch seed: ${seed}` : '',
          draft.direction ? `Current confirmed direction: ${draft.direction}` : '',
          `Reader adjustment: ${text}`
        ].filter(Boolean).join('\n'),
        answer: '',
        nextPrompt: seed,
        nextDirection: draft.direction,
        nextQuestion: ''
      };
    }
    if (draft.prompt && draft.prompt !== text) {
      return {
        prompt: [
          `Original Dispatch seed: ${draft.prompt}`,
          draft.direction ? `Current working direction: ${draft.direction}` : '',
          `Reader follow-up: ${text}`
        ].filter(Boolean).join('\n'),
        answer: '',
        nextPrompt: draft.prompt,
        nextDirection: draft.direction,
        nextQuestion: draft.currentQuestion
      };
    }
    return {
      prompt: text,
      answer: '',
      nextPrompt: text,
      nextDirection: draft.direction,
      nextQuestion: ''
    };
  }

  async function loadHistory() {
    try {
      const data = await dispatchPost('list', { limit: 12 });
      const serverDrafts = (data.dispatches || []).map((row) => draftFromServerRow(row, welcomeText));
      const activeLocal = draftById(activeId);
      const keepActiveLocal = activeLocal && !serverDispatchId(activeLocal) && hasDraftContent(activeLocal, welcomeText);
      drafts = [
        ...(keepActiveLocal ? [activeLocal] : []),
        ...serverDrafts
      ].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, 24);
      if (!drafts.some((draft) => draft.id === activeId)) {
        activeId = drafts[0]?.id || '';
        if (activeId) window.localStorage.setItem(activeKey, activeId);
      }
      saveDrafts();
      if (data.entitlements || data.supporting_member) {
        const profile = session.storedProfile();
        session.persistAuth({
          token: session.token(),
          email: session.storedEmail(),
          profile: {
            ...profile,
            supporting_member: Boolean(data.supporting_member || profile.supporting_member),
            entitlements: data.entitlements || profile.entitlements
          }
        }, session.storedEmail());
      }
      render();
    } catch (error) {
      setStatus(error.message || 'Could not load Dispatch history.', 'error');
    }
  }

  async function clarifyWithThingy(text) {
    const draft = activeDraft();
    const previous = {
      stage: draft.stage,
      prompt: draft.prompt,
      direction: draft.direction,
      currentQuestion: draft.currentQuestion,
      clarificationAnswer: draft.clarificationAnswer,
      title: draft.title
    };
    const request = clarifyRequest(draft, text);
    setBusy(true, 'Thingy is shaping this Dispatch...');
    updateDraft({
      stage: 'shaping',
      prompt: request.nextPrompt,
      direction: request.nextDirection,
      currentQuestion: request.nextQuestion,
      title: titleFromPrompt(request.nextPrompt),
      clarificationAnswer: request.answer || draft.clarificationAnswer
    });
    try {
      await saveDraftToServer(activeDraft(), { status: 'shaping' });
      const data = await dispatchPost('clarify', {
        prompt: request.prompt,
        clarification_question: draft.currentQuestion,
        clarification_answer: request.answer,
        messages: activeDraft().messages || []
      });
      const direction = data.direction || request.prompt;
      if (data.needs_clarification) {
        updateDraft({
          stage: 'needs_clarification',
          direction,
          currentQuestion: data.question || ''
        });
        addMessage('assistant', assistantClarificationText(data));
        await saveDraftToServer(activeDraft(), { status: 'needs_clarification' });
      } else {
        updateDraft({
          stage: 'ready',
          direction,
          currentQuestion: ''
        });
        addMessage('assistant', readyDispatchText(data, direction));
        await saveDraftToServer(activeDraft(), { status: 'ready' });
      }
      setStatus('');
    } catch (error) {
      updateDraft(previous);
      addMessage('assistant', error.message || 'I could not shape that Dispatch right now.');
      saveDraftToServer(activeDraft(), { status: activeDraft().stage === 'empty' ? 'draft' : activeDraft().stage }).catch(() => {});
      setStatus('Thingy could not shape that right now.', 'error');
    } finally {
      setBusy(false);
      render();
    }
  }

  async function generateDispatch() {
    const draft = activeDraft();
    const email = session.storedEmail();
    if (!email) {
      window.location.href = session.signInUrl('/dispatch/');
      return;
    }
    setBusy(true, dispatchTestMode ? 'Queueing template test...' : 'Queueing Dispatch...');
    try {
      await saveDraftToServer(draft, { status: draft.stage === 'upgrade' ? 'ready' : draft.stage });
      const data = await dispatchPost('create', {
        dispatch_id: serverDispatchId(draft),
        prompt: draft.prompt,
        topic: draft.prompt,
        direction: draft.direction || draft.prompt,
        clarification_question: draft.currentQuestion,
        clarification_answer: draft.clarificationAnswer,
        template_test: dispatchTestMode,
        email
      });
      const row = data.dispatch || {};
      updateDraft({
        stage: row.status || 'queued',
        dispatchId: row.id || row.dispatch_id || '',
        statusText: dispatchTestMode ? 'Template test queued.' : 'Dispatch queued.'
      });
      addMessage('assistant', dispatchTestMode
        ? 'Done. I queued a Dispatch template test and will email it when it is ready.'
        : 'Done. I queued this Dispatch and will email it when it is ready.');
      startPolling();
    } catch (error) {
      if (error.status === 403 && error.data && error.data.status === 'supporting_member_required') {
        updateDraft({ stage: 'upgrade' });
        addMessage('assistant', [
          'This Dispatch is shaped and ready.',
          'Sending Dispatches is a Supporting Member feature. Supporting Membership helps sustain The Weekly Thing and Jamie directs the membership proceeds as a charitable giving pool rather than treating this as a paywall for Thingy.',
          'You can become a Supporting Member, come back here, sign in again so I can see the updated membership, and generate this same Dispatch.'
        ].join('\n\n'));
        saveDraftToServer(activeDraft(), { status: 'ready' }).catch(() => {});
        setStatus('Ready to send after Supporting Membership.', 'notice');
      } else if (error.status === 429) {
        addMessage('assistant', error.message || 'Dispatch is rate limited right now.');
        setStatus('Dispatch is rate limited right now.', 'notice');
      } else {
        addMessage('assistant', error.message || 'I could not queue this Dispatch.');
        setStatus('Could not queue this Dispatch.', 'error');
      }
    } finally {
      setBusy(false);
      render();
    }
  }

  async function pollStatus(draftId = activeId) {
    const draft = draftById(draftId) || activeDraft();
    if (!draft.dispatchId) return;
    try {
      const data = await dispatchPost('status', { dispatch_id: draft.dispatchId });
      const row = data.dispatch || {};
      if (row.status === 'sent') {
        Object.assign(draft, {
          stage: 'sent',
          title: row.title || row.subject || draft.title,
          statusText: 'Sent',
          updatedAt: nowIso()
        });
        if (!draft.messages.some((message) => message.kind === 'sent')) {
          draft.messages.push({
            role: 'assistant',
            text: 'Dispatch sent. Check your email.',
            time: nowIso(),
            kind: 'sent'
          });
          saveDrafts();
        }
        if (pollingDraftId === draft.id) {
          window.clearInterval(pollTimer);
          pollTimer = 0;
          pollingDraftId = '';
        }
        await loadHistory();
      } else if (row.status === 'failed') {
        Object.assign(draft, {
          stage: 'failed',
          statusText: row.error || 'Failed',
          updatedAt: nowIso()
        });
        draft.messages.push({
          role: 'assistant',
          text: row.error || 'Dispatch failed while generating.',
          time: nowIso()
        });
        saveDrafts();
        if (pollingDraftId === draft.id) {
          window.clearInterval(pollTimer);
          pollTimer = 0;
          pollingDraftId = '';
        }
        await loadHistory();
      } else if (row.status) {
        Object.assign(draft, {
          stage: row.status,
          updatedAt: nowIso()
        });
        saveDrafts();
        render();
      }
    } catch (error) {
      // Polling is best-effort.
    }
  }

  function startPolling(draftId = activeId) {
    const draft = draftById(draftId) || activeDraft();
    if (!draft.dispatchId) return;
    if (pollTimer && pollingDraftId === draft.id) return;
    if (pollTimer) window.clearInterval(pollTimer);
    pollingDraftId = draft.id;
    pollTimer = window.setInterval(() => pollStatus(pollingDraftId), 6000);
    pollStatus(pollingDraftId);
  }

  async function deleteDispatch(id, button) {
    const dispatchId = String(id || '').trim();
    if (!dispatchId || busy) return;
    const draft = draftById(dispatchId);
    if (!draft) return;
    if (!window.confirm('Delete this Dispatch?')) return;
    if (button) button.disabled = true;
    try {
      const serverId = serverDispatchId(draft);
      if (serverId) await dispatchPost('delete', { dispatch_id: serverId });
      if (pollingDraftId === draft.id) {
        window.clearInterval(pollTimer);
        pollTimer = 0;
        pollingDraftId = '';
      }
      drafts = drafts.filter((entry) => entry.id !== draft.id);
      if (activeId === draft.id) {
        const next = drafts[0];
        if (next) {
          setActiveDraft(next.id, { render: false });
        } else {
          createDraft({ activate: true, render: false });
        }
      }
      saveDrafts();
      render();
    } catch (error) {
      if (button) button.disabled = false;
      setStatus(error.message || 'Could not delete that Dispatch.', 'error');
    }
  }

  if (!requireAuth()) return;
  if (!drafts.length) createDraft({ activate: true, render: false });
  if (!activeId) setActiveDraft(drafts[0].id, { render: false });
  if (shell) shell.classList.remove('is-booting', 'is-auth');
  if (app) app.hidden = false;

  function handleAction(actionId) {
    if (busy) return;
    if (actionId === 'generate') generateDispatch();
    if (actionId === 'check') pollStatus();
    if (actionId === 'signin') {
      session.clearAuth();
      window.location.href = session.signInUrl('/dispatch/');
    }
  }

  mountDispatchRecents(recentsMount, {
    onOpen: (id) => {
      setActiveDraft(id);
      setMobileRailOpen(false);
    },
    onDelete: (id) => deleteDispatch(id)
  });
  mountDispatchStatus(statusMount);
  mountDispatchActions(actionsMount, { onAction: handleAction });
  mountDispatchMessages(messagesMount, {
    scrollContainer: () => document.querySelector('.dispatch-scroll')
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
      isBusy: () => busy,
      autoSize: true,
      maxHeight: 240,
      onSubmit: async () => {
        if (busy || !input) return;
        if (!draftEditable(activeDraft())) {
          setStatus('Start a new Dispatch to shape another request.', 'notice');
          render();
          return;
        }
        const text = input.value.trim();
        if (!text) return;
        input.value = '';
        updateCount();
        updateComposerState();
        addMessage('user', text);
        await clarifyWithThingy(text);
        render();
      },
      onInput: () => {
        updateCount();
        updateComposerState();
      }
    });
  }

  newButtons.forEach((button) => button.addEventListener('click', () => {
    createDraft({ activate: true, render: true });
    setMobileRailOpen(false);
  }));

  document.addEventListener('click', () => accountControls.close());
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      accountControls.close();
      setMobileRailOpen(false);
    }
  });

  render();
  loadHistory().then(() => {
    const draft = activeDraft();
    if (draft.dispatchId && ['queued', 'generating', 'ready_to_send', 'sending'].includes(draft.stage)) startPolling();
  });
}

export { bootDispatch };
