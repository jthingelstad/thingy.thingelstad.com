import { hasDraftContent, normalizeDraft, serverDispatchId } from './thingy-dispatch-drafts.ts';
import { MAX_DRAFTS, defaultWelcomeText } from './thingy-dispatch-presenters.ts';

interface DispatchDraftStoreOptions {
  activeKey: string;
  welcomeText?: string | ((dispatchNumber: number) => string);
  onSelect: () => void;
}

interface DraftCreateOptions {
  activate?: boolean;
  render?: boolean;
}

interface DraftSelectionOptions {
  render?: boolean;
}

function createDispatchDraftStore({ activeKey, welcomeText = '', onSelect }: DispatchDraftStoreOptions) {
  let drafts: ThingyDispatchDraft[] = [];
  let activeId = '';
  let progressRunCounter = 0;
  try {
    activeId = window.localStorage.getItem(activeKey) || '';
  } catch (_error) {
    /* private browsing */
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function welcomeForDraft(dispatchNumber = drafts.length + 1) {
    if (typeof welcomeText === 'function')
      return String(welcomeText(dispatchNumber) || defaultWelcomeText(dispatchNumber));
    return welcomeText ? String(welcomeText) : defaultWelcomeText(dispatchNumber);
  }

  function saveDrafts() {
    drafts.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    drafts = drafts.slice(0, MAX_DRAFTS);
  }

  function setActiveDraft(id: string, opts: DraftSelectionOptions = {}) {
    activeId = String(id || '');
    if (activeId) {
      try {
        window.localStorage.setItem(activeKey, activeId);
      } catch (_error) {
        /* private browsing */
      }
    }
    if (opts.render !== false) onSelect();
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

  function ensureActiveDraft() {
    if (!activeId && drafts[0]) setActiveDraft(drafts[0].id, { render: false });
  }

  function createDraft(opts: DraftCreateOptions = {}) {
    const nextDispatchNumber = drafts.filter((entry) => hasDraftContent(entry)).length + 1;
    const draft = normalizeDraft({
      stage: 'empty',
      messages: [{ role: 'assistant', text: welcomeForDraft(nextDispatchNumber), kind: 'welcome' }]
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
    draft.messages.push({ role, text: String(text || ''), time: nowIso(), ...extra });
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

  function upsertScopedProgressMessage(
    scope: string,
    id: string,
    text: unknown,
    targetDraft = activeDraft(),
    extra: Partial<ThingyDispatchMessage> = {}
  ) {
    const key = scopedProgressId(scope, id);
    const existing = targetDraft.messages.find((message) => message.kind === 'progress' && message.id === key);
    const nowMs = Date.now();
    const status = extra.status || 'pending';
    const startedAt = Number(
      extra.startedAt ||
        (existing && (existing.status === 'pending' || status !== 'pending') ? existing.startedAt : 0) ||
        nowMs
    );
    const next: ThingyDispatchMessage = {
      id: key,
      baseId: String(extra.baseId || existing?.baseId || id).trim(),
      scope: String(extra.scope || existing?.scope || scope).trim(),
      role: 'assistant',
      text: String(text || ''),
      time: nowIso(),
      kind: 'progress',
      status,
      startedAt,
      completedAt: status !== 'pending' ? Number(extra.completedAt || existing?.completedAt || nowMs) : ''
    };
    if (existing) Object.assign(existing, next);
    else targetDraft.messages.push(next);
    targetDraft.updatedAt = nowIso();
    saveDrafts();
    return targetDraft;
  }

  function mergeServerDrafts(serverDrafts: ThingyDispatchDraft[]) {
    const activeLocal = draftById(activeId);
    const keepActiveLocal = activeLocal && !serverDispatchId(activeLocal) && hasDraftContent(activeLocal);
    drafts = [...(keepActiveLocal ? [activeLocal] : []), ...serverDrafts]
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
      .slice(0, MAX_DRAFTS);
    if (!drafts.some((draft) => draft.id === activeId)) {
      activeId = drafts[0]?.id || '';
      if (activeId) setActiveDraft(activeId, { render: false });
    }
    saveDrafts();
  }

  function removeDraft(id: string) {
    const wasActive = activeId === id;
    drafts = drafts.filter((entry) => entry.id !== id);
    if (wasActive) {
      if (drafts[0]) setActiveDraft(drafts[0].id, { render: false });
      else createDraft({ activate: true, render: false });
    }
    saveDrafts();
  }

  function summaries() {
    return drafts.slice(0, MAX_DRAFTS);
  }

  function getActiveId() {
    return activeId;
  }

  return {
    activeDraft,
    addMessage,
    createDraft,
    draftById,
    ensureActiveDraft,
    getActiveId,
    hasDrafts,
    mergeServerDrafts,
    nextProgressScope,
    nowIso,
    removeDraft,
    saveDrafts,
    scopedProgressId,
    setActiveDraft,
    summaries,
    updateDraft,
    upsertScopedProgressMessage,
    welcomeForDraft
  };
}

export { createDispatchDraftStore };
