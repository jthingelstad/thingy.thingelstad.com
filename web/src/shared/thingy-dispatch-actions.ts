// The Dispatch action layer: draft lifecycle, server calls, and polling.
// Extracted from bootDispatch so the logic has explicit dependencies and is
// testable without a DOM. The factory writes to dispatch-store signals; the
// caller supplies DOM-facing callbacks (onRender) and environment hooks
// (confirmDelete, redirectToSignIn) so this module never touches
// document/window beyond localStorage and timers.
//
// Planning runs as a streaming conversation on the Librarian /chat endpoint
// in the dispatch mode: the planner streams answer deltas, real tool status,
// and dispatch_brief events that this layer mirrors into the draft. Queueing
// and send status stay on the request/response /dispatch route.

import * as defaultSession from './thingy-session.ts';
import { librarianStreamUrl } from './thingy-config.ts';
import { postJsonStream, read as readStream } from './thingy-stream.ts';
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
} from './stores/dispatch-store.ts';
import { draftFromServerRow, hasDraftContent, normalizeDraft, serverDispatchId } from './thingy-dispatch-drafts.ts';
import { dispatchEditable } from './thingy-dispatch-state.ts';
import { errorMessage } from './thingy-errors.ts';
import { createDispatchPlanner } from './thingy-dispatch-planner.ts';
import { createDispatchLifecycle } from './thingy-dispatch-lifecycle.ts';
import {
  MAX_DRAFTS,
  defaultWelcomeText,
  dispatchBriefMarkdown,
  draftTitle,
  inputPlaceholderForDraft,
  titleFromPrompt
} from './thingy-dispatch-presenters.ts';

interface DispatchActionsOptions {
  session?: typeof defaultSession;
  streamBase?: string;
  postStream?: typeof postJsonStream;
  readEvents?: typeof readStream;
  welcomeText?: string | ((dispatchNumber: number) => string);
  dispatchTestMode?: boolean;
  activeKey?: string;
  onRender?: () => void;
  confirmDelete?: () => boolean;
  redirectToSignIn?: () => void;
}

interface DraftCreateOptions {
  activate?: boolean;
  render?: boolean;
}

interface DraftSelectionOptions {
  render?: boolean;
}

interface DraftSaveOverrides {
  status?: string;
}

type DispatchPayload = Record<string, unknown>;

// --- Stateful action layer ---------------------------------------------------

function createDispatchActions(options: DispatchActionsOptions = {}) {
  const session = options.session || defaultSession;
  const streamBase = () => String(options.streamBase ?? librarianStreamUrl() ?? '').replace(/\/$/, '');
  // Stream seams are injectable so tests can drive planner events without
  // a fetch/SSE stack.
  const postStream = options.postStream || postJsonStream;
  const readEvents = options.readEvents || readStream;
  const welcomeTextOption = options.welcomeText || '';
  const dispatchTestMode = Boolean(options.dispatchTestMode);
  const activeKey = options.activeKey || 'thingyActiveDispatchDraft';
  const onRender = typeof options.onRender === 'function' ? options.onRender : () => {};
  const confirmDelete =
    typeof options.confirmDelete === 'function' ? options.confirmDelete : () => window.confirm('Delete this Dispatch?');
  const redirectToSignIn =
    typeof options.redirectToSignIn === 'function'
      ? options.redirectToSignIn
      : () => {
          window.location.href = session.signInUrl('/dispatch/');
        };

  let drafts: ThingyDispatchDraft[] = [];
  let activeId = '';
  try {
    activeId = window.localStorage.getItem(activeKey) || '';
  } catch (error) {
    /* private mode */
  }
  let progressRunCounter = 0;

  function nowIso() {
    return new Date().toISOString();
  }

  function isBusy() {
    return dispatchBusySignal.value;
  }

  function draftEditable(draft: Partial<ThingyDispatchDraft>) {
    return dispatchEditable(draft?.stage);
  }

  function welcomeForDraft(dispatchNumber = drafts.length + 1) {
    if (typeof welcomeTextOption === 'function')
      return String(welcomeTextOption(dispatchNumber) || defaultWelcomeText(dispatchNumber));
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

  function draftById(id: string) {
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

  function createDraft(opts: DraftCreateOptions = {}) {
    const nextDispatchNumber = drafts.filter((entry) => hasDraftContent(entry)).length + 1;
    const draft = normalizeDraft({
      stage: 'empty',
      messages: [
        {
          role: 'assistant',
          text: welcomeForDraft(nextDispatchNumber),
          kind: 'welcome'
        }
      ]
    });
    drafts = drafts.filter((entry) => serverDispatchId(entry) || hasDraftContent(entry));
    drafts.unshift(draft);
    if (opts.activate !== false) setActiveDraft(draft.id, { render: Boolean(opts.render) });
    saveDrafts();
    return draft;
  }

  function updateDraft(patch: Partial<ThingyDispatchDraft> = {}) {
    const draft = activeDraft();
    Object.assign(draft, patch, { updatedAt: nowIso() });
    saveDrafts();
    return draft;
  }

  function addMessage(role: ThingyDispatchMessage['role'], text: unknown, extra: Partial<ThingyDispatchMessage> = {}) {
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

  function nextProgressScope(kind = 'progress') {
    progressRunCounter += 1;
    return `${kind}-${progressRunCounter}`;
  }

  function scopedProgressId(scope: string, id: string) {
    const base =
      String(id || 'progress')
        .trim()
        .replace(/[^a-z0-9_-]+/gi, '-') || 'progress';
    return scope ? `${scope}:${base}` : base;
  }

  function upsertProgressMessage(
    id: string,
    text: unknown,
    targetDraft = activeDraft(),
    extra: Partial<ThingyDispatchMessage> = {}
  ) {
    const draft = targetDraft;
    const key = String(id || '').trim();
    const existing = key ? draft.messages.find((message) => message.kind === 'progress' && message.id === key) : null;
    const nowMs = Date.now();
    const status = extra.status || 'pending';
    const baseId = String(extra.baseId || existing?.baseId || key).trim();
    const scope = String(extra.scope || existing?.scope || '').trim();
    const startedAt = Number(
      extra.startedAt ||
        (existing && (existing.status === 'pending' || status !== 'pending') ? existing.startedAt : 0) ||
        nowMs
    );
    const next: ThingyDispatchMessage = {
      id: key || `progress-${Date.now()}`,
      baseId,
      scope,
      role: 'assistant',
      text: String(text || ''),
      time: nowIso(),
      kind: 'progress',
      status,
      startedAt
    };
    if (status !== 'pending') next.completedAt = Number(extra.completedAt || existing?.completedAt || nowMs);
    else next.completedAt = '';
    if (existing) {
      Object.assign(existing, next);
    } else {
      draft.messages.push(next);
    }
    draft.updatedAt = nowIso();
    saveDrafts();
    return draft;
  }

  function upsertScopedProgressMessage(
    scope: string,
    id: string,
    text: unknown,
    targetDraft = activeDraft(),
    extra: Partial<ThingyDispatchMessage> = {}
  ) {
    return upsertProgressMessage(scopedProgressId(scope, id), text, targetDraft, {
      ...extra,
      baseId: id,
      scope
    });
  }

  function setActiveDraft(id: string, opts: DraftSelectionOptions = {}) {
    activeId = String(id || '');
    if (activeId) {
      try {
        window.localStorage.setItem(activeKey, activeId);
      } catch (error) {
        /* ignore */
      }
    }
    if (opts.render !== false) render();
  }

  function signedIn() {
    return Boolean(session.token()) && !session.tokenExpired();
  }

  function requireAuth() {
    if (signedIn()) return true;
    redirectToSignIn();
    return false;
  }

  async function dispatchPost(action: string, extra: DispatchPayload = {}, options: ThingyRequestOptions = {}) {
    if (!(await session.ensureFreshToken())) {
      session.clearAuth();
      requireAuth();
      throw new Error('Sign in again to continue.');
    }
    return await session.postJson('/dispatch', { action, ...(extra || {}) }, session.authHeaders(), options);
  }

  async function saveDraftToServer(draft = activeDraft(), overrides: DraftSaveOverrides = {}) {
    if (!signedIn() || !hasDraftContent(draft)) return draft;
    const serverId = serverDispatchId(draft);
    const data = await dispatchPost('save_draft', {
      dispatch_id: serverId,
      status: overrides.status || draft.stage || 'draft',
      topic: draft.prompt || draft.title,
      prompt: draft.prompt,
      direction: draft.direction,
      conversation_id: draft.conversationId || '',
      clarification_question: draft.currentQuestion,
      clarification_answer: draft.clarificationAnswer,
      brief: draft.brief || {},
      title: draftTitle(draft),
      messages: draft.messages || []
    });
    const row: DispatchRow = data.dispatch || {};
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

  function setBusy(value: boolean, text = '') {
    dispatchBusySignal.value = Boolean(value);
    if (text) setStatus(text);
    onRender();
  }

  function setStatus(text: string, kind = '') {
    dispatchStatusMessageSignal.value = text || '';
    dispatchStatusKindSignal.value = kind || '';
  }

  function renderActions(draft: ThingyDispatchDraft) {
    const items: ThingyDispatchAction[] = [];
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
      const serverDrafts = (data.dispatches || []).map((row, index) =>
        draftFromServerRow(row, welcomeForDraft(index + 1))
      );
      const activeLocal = draftById(activeId);
      const keepActiveLocal = activeLocal && !serverDispatchId(activeLocal) && hasDraftContent(activeLocal);
      drafts = [...(keepActiveLocal ? [activeLocal] : []), ...serverDrafts]
        .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
        .slice(0, MAX_DRAFTS);
      if (!drafts.some((draft) => draft.id === activeId)) {
        activeId = drafts[0]?.id || '';
        if (activeId) {
          try {
            window.localStorage.setItem(activeKey, activeId);
          } catch (error) {
            /* ignore */
          }
        }
      }
      saveDrafts();
      if (data.entitlements || data.supporting_member) {
        const profile = session.storedProfile();
        session.persistAuth(
          {
            token: session.token(),
            email: session.storedEmail(),
            profile: {
              ...profile,
              supporting_member: Boolean(data.supporting_member || profile.supporting_member),
              entitlements: data.entitlements || profile.entitlements
            }
          },
          session.storedEmail()
        );
      }
      render();
    } catch (error) {
      setStatus(errorMessage(error, 'Could not load Dispatch history.'), 'error');
    }
  }

  function upsertBriefMessage(text: unknown, targetDraft = activeDraft()) {
    const existing = targetDraft.messages.find((message) => message.kind === 'brief');
    if (existing) {
      existing.text = String(text || '');
      existing.time = nowIso();
    } else {
      targetDraft.messages.push({
        role: 'assistant',
        text: String(text || ''),
        time: nowIso(),
        kind: 'brief'
      });
    }
    targetDraft.updatedAt = nowIso();
    saveDrafts();
    return targetDraft;
  }

  const planWithThingy = createDispatchPlanner({
    session,
    streamBase,
    postStream,
    readEvents,
    activeDraft,
    nextProgressScope,
    progress: (scope, id, value, draft = activeDraft(), extra = {}) =>
      upsertScopedProgressMessage(scope, id, value, draft, extra),
    setBusy,
    updateDraft,
    render,
    requireAuth,
    nowIso,
    upsertBriefMessage,
    saveDraftToServer,
    setStatus,
    addMessage
  });

  const lifecycle = createDispatchLifecycle({
    session,
    dispatchTestMode,
    redirectToSignIn,
    activeDraft,
    draftById,
    getActiveId: () => activeId,
    nextProgressScope,
    progress: (scope, id, value, draft = activeDraft(), extra = {}) =>
      upsertScopedProgressMessage(scope, id, value, draft, extra),
    scopedProgressId,
    setBusy,
    render,
    saveDraftToServer,
    dispatchPost,
    updateDraft,
    addMessage,
    setStatus,
    saveDrafts,
    loadHistory,
    nowIso
  });

  async function deleteDispatch(id: string) {
    const dispatchId = String(id || '').trim();
    if (!dispatchId || isBusy()) return;
    const draft = draftById(dispatchId);
    if (!draft) return;
    if (!confirmDelete()) return;
    try {
      const serverId = serverDispatchId(draft);
      if (serverId) await dispatchPost('delete', { dispatch_id: serverId });
      lifecycle.stopPollingFor(draft.id);
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
      setStatus(errorMessage(error, 'Could not delete that Dispatch.'), 'error');
    }
  }

  return {
    activeDraft,
    addMessage,
    planWithThingy,
    createDraft,
    deleteDispatch,
    draftById,
    draftEditable,
    draftTitle,
    ensureActiveDraft,
    generateDispatch: lifecycle.generateDispatch,
    hasDrafts,
    isBusy,
    loadHistory,
    pollStatus: lifecycle.pollStatus,
    render,
    requireAuth,
    setActiveDraft,
    setStatus,
    signedIn,
    startPolling: lifecycle.startPolling
  };
}

export { createDispatchActions, dispatchBriefMarkdown, draftTitle, inputPlaceholderForDraft, titleFromPrompt };
