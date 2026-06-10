// The Dispatch action layer: draft lifecycle, server calls, and polling.
// Extracted from bootDispatch so the logic has explicit dependencies and is
// testable without a DOM. The factory writes to dispatch-store signals; the
// caller supplies DOM-facing callbacks (onRender) and environment hooks
// (confirmDelete, redirectToSignIn) so this module never touches
// document/window beyond localStorage and timers.

import * as defaultSession from './thingy-session.js';
import {
  activeDraftId as activeDraftIdSignal,
  dispatchActions as dispatchActionsSignal,
  dispatchBusy as dispatchBusySignal,
  dispatchInputDisabled as dispatchInputDisabledSignal,
  dispatchInputPlaceholder as dispatchInputPlaceholderSignal,
  dispatchMessages as dispatchMessagesSignal,
  dispatchStatusKind as dispatchStatusKindSignal,
  dispatchStatusMessage as dispatchStatusMessageSignal,
  drafts as draftsSignal
} from './stores/dispatch-store.js';
import {
  draftFromServerRow,
  hasDraftContent,
  normalizeDraft,
  serverDispatchId
} from './thingy-dispatch-drafts.js';
import { dispatchEditable } from './thingy-dispatch-state.js';

const DEFAULT_WELCOME = "Alright, let's make your first Dispatch. Give me the topic, question, or archive thread you want to shape, and I'll help turn it into a clear direction before you generate it.";
const MAX_DRAFTS = 24;

// --- Pure helpers (exported for tests) --------------------------------------

function draftTitle(draft) {
  return draft.title || draft.prompt || draft.direction || 'New Dispatch';
}

function titleFromPrompt(value) {
  return String(value || 'Dispatch').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Dispatch';
}

function ordinal(value) {
  const number = Math.max(1, Number(value || 1));
  const words = {
    1: 'first',
    2: 'second',
    3: 'third',
    4: 'fourth',
    5: 'fifth',
    6: 'sixth',
    7: 'seventh',
    8: 'eighth',
    9: 'ninth',
    10: 'tenth'
  };
  if (words[number]) return words[number];
  const mod100 = number % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${number}th`;
  return `${number}${{ 1: 'st', 2: 'nd', 3: 'rd' }[number % 10] || 'th'}`;
}

function defaultWelcomeText(dispatchNumber = 1) {
  return `Alright, let's make your ${ordinal(dispatchNumber)} Dispatch. Give me the topic, question, or archive thread you want to shape, and I'll help turn it into a clear direction before you generate it.`;
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

// Builds the clarify request payload from the draft's stage and the new
// reader text. Each stage frames the prompt differently so Thingy sees the
// full context (seed, confirmed direction, adjustment) in one string.
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

function inputPlaceholderForDraft(draft, editable) {
  if (!editable) return 'Start a new Dispatch to shape another request...';
  if (draft.stage === 'needs_clarification') return 'Answer Thingy’s clarification question...';
  if (draft.stage === 'ready' || draft.stage === 'upgrade') return 'Adjust the direction, or generate when ready...';
  return 'Tell Thingy what this Dispatch should explore...';
}

// --- Stateful action layer ---------------------------------------------------

function createDispatchActions(options = {}) {
  const session = options.session || defaultSession;
  const welcomeTextOption = options.welcomeText || '';
  const dispatchTestMode = Boolean(options.dispatchTestMode);
  const activeKey = options.activeKey || 'thingyActiveDispatchDraft';
  const onRender = typeof options.onRender === 'function' ? options.onRender : () => {};
  const confirmDelete = typeof options.confirmDelete === 'function'
    ? options.confirmDelete
    : () => window.confirm('Delete this Dispatch?');
  const redirectToSignIn = typeof options.redirectToSignIn === 'function'
    ? options.redirectToSignIn
    : () => { window.location.href = session.signInUrl('/dispatch/'); };

  let drafts = [];
  let activeId = '';
  try {
    activeId = window.localStorage.getItem(activeKey) || '';
  } catch (error) { /* private mode */ }
  let pollTimer = 0;
  let pollingDraftId = '';

  function nowIso() {
    return new Date().toISOString();
  }

  function isBusy() {
    return dispatchBusySignal.value;
  }

  function draftEditable(draft) {
    return dispatchEditable(draft?.stage);
  }

  function welcomeForDraft(dispatchNumber = drafts.length + 1) {
    if (typeof welcomeTextOption === 'function') return String(welcomeTextOption(dispatchNumber) || DEFAULT_WELCOME);
    if (welcomeTextOption) return String(welcomeTextOption);
    return defaultWelcomeText(dispatchNumber);
  }

  function saveDrafts() {
    drafts.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    drafts = drafts.slice(0, MAX_DRAFTS);
  }

  function activeDraft() {
    let draft = drafts.find((entry) => entry.id === activeId);
    if (!draft) draft = createDraft({ activate: true });
    return draft;
  }

  function draftById(id) {
    return drafts.find((entry) => entry.id === id);
  }

  function hasDrafts() {
    return drafts.length > 0;
  }

  // Boot helper: when no persisted active id survives, select the newest
  // draft without triggering a render (boot renders once at the end).
  function ensureActiveDraft() {
    if (!activeId && drafts[0]) setActiveDraft(drafts[0].id, { render: false });
  }

  function createDraft(opts = {}) {
    const nextDispatchNumber = drafts.filter((entry) => hasDraftContent(entry)).length + 1;
    const draft = normalizeDraft({
      stage: 'empty',
      messages: [{
        role: 'assistant',
        text: welcomeForDraft(nextDispatchNumber),
        kind: 'welcome'
      }]
    });
    drafts = drafts.filter((entry) => serverDispatchId(entry) || hasDraftContent(entry));
    drafts.unshift(draft);
    if (opts.activate !== false) setActiveDraft(draft.id, { render: Boolean(opts.render) });
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

  function upsertProgressMessage(id, text, targetDraft = activeDraft()) {
    const draft = targetDraft;
    const key = String(id || '').trim();
    const existing = key ? draft.messages.find((message) => message.kind === 'progress' && message.id === key) : null;
    const next = {
      id: key || `progress-${Date.now()}`,
      role: 'assistant',
      text: String(text || ''),
      time: nowIso(),
      kind: 'progress'
    };
    if (existing) {
      Object.assign(existing, next);
    } else {
      draft.messages.push(next);
    }
    draft.updatedAt = nowIso();
    saveDrafts();
    return draft;
  }

  function setActiveDraft(id, opts = {}) {
    activeId = String(id || '');
    if (activeId) {
      try { window.localStorage.setItem(activeKey, activeId); } catch (error) { /* ignore */ }
    }
    if (opts.render !== false) render();
  }

  function signedIn() {
    return session.token() && !session.tokenExpired();
  }

  function requireAuth() {
    if (signedIn()) return true;
    redirectToSignIn();
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
    if (!signedIn() || !hasDraftContent(draft)) return draft;
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
    dispatchBusySignal.value = Boolean(value);
    setStatus(text || '');
    onRender();
  }

  function setStatus(text, kind = '') {
    dispatchStatusMessageSignal.value = text || '';
    dispatchStatusKindSignal.value = kind || '';
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

  function render() {
    const draft = activeDraft();
    if (!draft.messages.length) {
      draft.messages.push({
        role: 'assistant',
        text: welcomeForDraft(1),
        kind: 'welcome'
      });
    }
    dispatchMessagesSignal.value = draft.messages.slice();
    const editable = draftEditable(draft);
    dispatchInputDisabledSignal.value = dispatchBusySignal.value || !editable;
    dispatchInputPlaceholderSignal.value = inputPlaceholderForDraft(draft, editable);
    renderActions(draft);
    draftsSignal.value = drafts.slice(0, MAX_DRAFTS).map((entry) => ({
      id: entry.id,
      title: draftTitle(entry),
      stage: entry.stage
    }));
    activeDraftIdSignal.value = activeId || null;
    onRender();
  }

  async function loadHistory() {
    try {
      const data = await dispatchPost('list', { limit: 12 });
      const serverDrafts = (data.dispatches || []).map((row, index) => draftFromServerRow(row, welcomeForDraft(index + 1)));
      const activeLocal = draftById(activeId);
      const keepActiveLocal = activeLocal && !serverDispatchId(activeLocal) && hasDraftContent(activeLocal);
      drafts = [
        ...(keepActiveLocal ? [activeLocal] : []),
        ...serverDrafts
      ].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, MAX_DRAFTS);
      if (!drafts.some((draft) => draft.id === activeId)) {
        activeId = drafts[0]?.id || '';
        if (activeId) {
          try { window.localStorage.setItem(activeKey, activeId); } catch (error) { /* ignore */ }
        }
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
      redirectToSignIn();
      return;
    }
    setBusy(true, dispatchTestMode ? 'Queueing template test...' : 'Queueing Dispatch...');
    upsertProgressMessage('generate-start', dispatchTestMode
      ? 'Preparing the template test and saving the current Dispatch direction.'
      : 'Preparing this Dispatch and saving the current direction.');
    render();
    try {
      await saveDraftToServer(draft, { status: draft.stage === 'upgrade' ? 'ready' : draft.stage });
      upsertProgressMessage('generate-save', 'Saved the Dispatch direction. Sending the generation request now.');
      render();
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
      upsertProgressMessage('generate-queue', dispatchTestMode
        ? 'Template test queued. I am checking the generation status now.'
        : 'Dispatch queued. I am checking the generation status now.');
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

  function stopPollingFor(draftId) {
    if (pollingDraftId === draftId) {
      window.clearInterval(pollTimer);
      pollTimer = 0;
      pollingDraftId = '';
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
          upsertProgressMessage('generate-status', 'Generation finished and the email handoff completed.', draft);
          draft.messages.push({
            role: 'assistant',
            text: 'Dispatch sent. Check your email.',
            time: nowIso(),
            kind: 'sent'
          });
          saveDrafts();
        }
        stopPollingFor(draft.id);
        await loadHistory();
      } else if (row.status === 'failed') {
        Object.assign(draft, {
          stage: 'failed',
          statusText: row.error || 'Failed',
          updatedAt: nowIso()
        });
        upsertProgressMessage('generate-status', 'Generation failed before the email could be sent.', draft);
        draft.messages.push({
          role: 'assistant',
          text: row.error || 'Dispatch failed while generating.',
          time: nowIso()
        });
        saveDrafts();
        stopPollingFor(draft.id);
        await loadHistory();
      } else if (row.status) {
        Object.assign(draft, {
          stage: row.status,
          updatedAt: nowIso()
        });
        upsertProgressMessage('generate-status', `Thingy is ${String(row.status).replace(/_/g, ' ')} this Dispatch. I will keep checking until it is sent.`, draft);
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

  async function deleteDispatch(id) {
    const dispatchId = String(id || '').trim();
    if (!dispatchId || isBusy()) return;
    const draft = draftById(dispatchId);
    if (!draft) return;
    if (!confirmDelete()) return;
    try {
      const serverId = serverDispatchId(draft);
      if (serverId) await dispatchPost('delete', { dispatch_id: serverId });
      stopPollingFor(draft.id);
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
      setStatus(error.message || 'Could not delete that Dispatch.', 'error');
    }
  }

  return {
    activeDraft,
    addMessage,
    clarifyWithThingy,
    createDraft,
    deleteDispatch,
    draftById,
    draftEditable,
    draftTitle,
    ensureActiveDraft,
    generateDispatch,
    hasDrafts,
    isBusy,
    loadHistory,
    pollStatus,
    render,
    requireAuth,
    setActiveDraft,
    setStatus,
    signedIn,
    startPolling
  };
}

export {
  assistantClarificationText,
  clarifyRequest,
  createDispatchActions,
  draftTitle,
  inputPlaceholderForDraft,
  readyDispatchText,
  titleFromPrompt
};
