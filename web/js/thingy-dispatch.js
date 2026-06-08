(function () {
  const session = window.ThingySession;
  const shell = document.getElementById('dispatch-shell');
  const app = document.getElementById('dispatch-app');
  const messagesEl = document.getElementById('dispatch-messages');
  const recentsEl = document.getElementById('dispatch-recents');
  const emptyEl = document.getElementById('dispatch-empty');
  const form = document.getElementById('dispatch-form');
  const input = document.getElementById('dispatch-input');
  const statusEl = document.getElementById('dispatch-status');
  const actionsEl = document.getElementById('dispatch-actions');
  const countEl = document.getElementById('dispatch-count');
  const newButtons = [document.getElementById('dispatch-new'), document.getElementById('dispatch-mobile-new')].filter(Boolean);
  const accountEmail = document.getElementById('dispatch-account-email');
  const accountSub = document.getElementById('dispatch-account-sub');
  const accountAvatar = document.getElementById('dispatch-account-avatar');
  const mobileTitle = document.getElementById('dispatch-mobile-title');
  const mobileToggle = document.getElementById('dispatch-mobile-toggle');
  const railScrim = document.getElementById('dispatch-rail-scrim');
  const draftKey = 'thingyDispatchDrafts';
  const activeKey = 'thingyActiveDispatchDraft';
  const welcomeText = "What should this Dispatch explore? Give me a topic, question, or thread from Jamie's archive and I'll help shape it before you send it.";
  const maxInputChars = Number(input && input.getAttribute('maxlength') || 1200);
  const dispatchTestMode = (() => {
    const params = new URLSearchParams(window.location.search);
    const value = String(params.get('dispatch_test') || params.get('test') || '').trim().toLowerCase();
    return value === 'template' || value === 'template_test';
  })();
  let drafts = loadDrafts();
  let activeId = window.localStorage.getItem(activeKey) || '';
  let busy = false;
  let pollTimer = 0;

  function escapeHtml(value) {
    return String(value || '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function draftTitle(draft) {
    return draft.title || draft.prompt || draft.direction || 'New Dispatch';
  }

  function stageLabel(value) {
    return {
      empty: 'Draft',
      shaping: 'Shaping',
      needs_clarification: 'Clarify',
      ready: 'Ready',
      upgrade: 'Ready',
      queued: 'Queued',
      generating: 'Generating',
      sent: 'Sent',
      failed: 'Failed'
    }[value] || 'Draft';
  }

  function normalizeDraft(raw) {
    const draft = raw && typeof raw === 'object' ? raw : {};
    return {
      id: String(draft.id || `draft-${Date.now()}-${Math.random().toString(16).slice(2)}`),
      stage: String(draft.stage || 'empty'),
      prompt: String(draft.prompt || ''),
      direction: String(draft.direction || ''),
      currentQuestion: String(draft.currentQuestion || ''),
      clarificationAnswer: String(draft.clarificationAnswer || ''),
      dispatchId: String(draft.dispatchId || ''),
      title: String(draft.title || ''),
      statusText: String(draft.statusText || ''),
      updatedAt: String(draft.updatedAt || nowIso()),
      messages: Array.isArray(draft.messages) ? draft.messages : []
    };
  }

  function isServerDispatchId(value) {
    const id = String(value || '');
    return Boolean(id && !id.startsWith('draft-'));
  }

  function serverDispatchId(draft) {
    if (isServerDispatchId(draft.dispatchId)) return draft.dispatchId;
    if (isServerDispatchId(draft.id)) return draft.id;
    return '';
  }

  function draftIdentity(draft) {
    return serverDispatchId(draft) || String(draft?.id || '');
  }

  function hasDraftContent(draft) {
    if (!draft) return false;
    if (draft.prompt || draft.direction || draft.currentQuestion || draft.clarificationAnswer) return true;
    return (draft.messages || []).some((message) => String(message.text || '') && message.text !== welcomeText);
  }

  function isInFlightStage(stage) {
    return ['shaping', 'needs_clarification', 'ready', 'upgrade', 'queued', 'generating', 'sent', 'failed'].includes(stage);
  }

  function draftTime(draft) {
    const time = Date.parse(draft?.updatedAt || '');
    return Number.isFinite(time) ? time : 0;
  }

  function shouldPreferLocalDraft(localDraft, serverDraft) {
    if (!localDraft || !hasDraftContent(localDraft) || !isInFlightStage(localDraft.stage)) return false;
    return draftTime(localDraft) >= draftTime(serverDraft);
  }

  function keepLocalDraftWhenMissingFromServer(draft, serverIds) {
    if (draft?.id && draft.id === activeId && !serverDispatchId(draft)) return true;
    if (!hasDraftContent(draft)) return false;
    const id = draftIdentity(draft);
    if (!id) return true;
    if (serverIds.has(id)) return false;
    return isInFlightStage(draft.stage);
  }

  function draftStageFromRow(row) {
    const status = String(row.status || 'draft');
    return status === 'draft' ? 'empty' : status;
  }

  function fallbackMessagesForRow(row) {
    if (Array.isArray(row.messages) && row.messages.length) return row.messages;
    if (row.status === 'queued' || row.status === 'generating') {
      return [{ role: 'assistant', text: 'This Dispatch is queued and I am preparing it now.' }];
    }
    if (row.status === 'sent') {
      return [{ role: 'assistant', text: 'Dispatch sent. Check your email.', kind: 'sent' }];
    }
    if (row.status === 'failed') {
      return [{ role: 'assistant', text: row.error || 'Dispatch failed while generating.' }];
    }
    if (row.direction) {
      return [{ role: 'assistant', text: `Here is the Dispatch I am ready to generate:\n\n${row.direction}\n\nIf this is right, use Generate Dispatch. If you want to steer it, send me the adjustment.` }];
    }
    return [{ role: 'assistant', text: welcomeText }];
  }

  function draftFromServerRow(row) {
    const id = String(row.id || row.dispatch_id || '');
    return normalizeDraft({
      id,
      dispatchId: id,
      stage: draftStageFromRow(row),
      prompt: row.prompt || row.topic || '',
      direction: row.direction || '',
      currentQuestion: row.clarification_question || '',
      clarificationAnswer: row.clarification_answer || '',
      title: row.title || row.subject || row.topic || '',
      statusText: row.preview || row.error || '',
      updatedAt: row.updated_at || row.created_at || nowIso(),
      messages: fallbackMessagesForRow(row)
    });
  }

  function loadDrafts() {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(draftKey) || '[]');
      return Array.isArray(parsed) ? parsed.map(normalizeDraft) : [];
    } catch (error) {
      return [];
    }
  }

  function saveDrafts() {
    drafts.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    window.localStorage.setItem(draftKey, JSON.stringify(drafts.slice(0, 20)));
  }

  function activeDraft() {
    let draft = drafts.find((entry) => entry.id === activeId);
    if (!draft) draft = createDraft({ activate: true });
    return draft;
  }

  function createDraft(options = {}) {
    const draft = normalizeDraft({
      stage: 'empty',
      messages: [{
        role: 'assistant',
        text: welcomeText
      }]
    });
    drafts = drafts.filter((entry) => serverDispatchId(entry) || hasDraftContent(entry));
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

  function hasSupportingAccess() {
    const profile = session.storedProfile();
    const entitlements = Array.isArray(profile.entitlements) ? profile.entitlements : [];
    return Boolean(profile.supporting_member || entitlements.includes('supporting_member') || entitlements.includes('owner'));
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
    busy = Boolean(value);
    if (input) input.disabled = busy;
    const button = form && form.querySelector('button[type="submit"]');
    if (button) button.disabled = busy;
    setStatus(text || '');
  }

  function setStatus(text, kind = '') {
    if (!statusEl) return;
    statusEl.textContent = text || '';
    statusEl.dataset.kind = kind || '';
  }

  function refreshIdentity() {
    const email = session.storedEmail();
    const profile = session.storedProfile();
    if (accountEmail) accountEmail.textContent = email || 'Signed in';
    if (accountSub) accountSub.textContent = hasSupportingAccess() ? 'Supporting Member' : 'Weekly Thing reader';
    if (accountAvatar) accountAvatar.textContent = email ? email[0].toUpperCase() : 'T';
    if (mobileTitle) mobileTitle.textContent = draftTitle(activeDraft());
    if (profile && profile.preferred_name && accountEmail && !email) accountEmail.textContent = profile.preferred_name;
  }

  function setMobileRailOpen(open) {
    if (!shell) return;
    shell.classList.toggle('is-mobile-rail-open', Boolean(open));
    if (mobileToggle) {
      mobileToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      mobileToggle.setAttribute('aria-label', open ? 'Hide Dispatches' : 'Show Dispatches');
      mobileToggle.title = open ? 'Hide Dispatches' : 'Show Dispatches';
    }
    if (railScrim) railScrim.hidden = !open;
  }

  function renderMessage(message) {
    const role = message.role === 'user' ? 'user' : message.role === 'system' ? 'system' : 'assistant';
    const paragraphs = String(message.text || '').split(/\n{2,}/).map((part) => `<p>${escapeHtml(part)}</p>`).join('');
    return `<article class="librarian-message librarian-message-${role} dispatch-message">${paragraphs}</article>`;
  }

  function renderActions(draft) {
    if (!actionsEl) return;
    const actions = [];
    if (draft.stage === 'ready' || draft.stage === 'upgrade') {
      actions.push(`<button type="button" class="dispatch-action-primary" data-action="generate">${dispatchTestMode ? 'Send Template Test' : 'Generate Dispatch'}</button>`);
    }
    if (draft.stage === 'upgrade') {
      actions.push(`<a class="dispatch-action-secondary" href="https://www.thingelstad.com/2024/11/17/weekly-thing-supporting.html" target="_blank" rel="noopener">Supporting Membership</a>`);
      actions.push(`<button type="button" class="dispatch-action-secondary" data-action="signin">I joined, sign in again</button>`);
    }
    if (draft.stage === 'queued' || draft.stage === 'generating') {
      actions.push(`<button type="button" class="dispatch-action-secondary" data-action="check">Check Status</button>`);
    }
    actionsEl.innerHTML = actions.join('');
    actionsEl.hidden = !actions.length;
  }

  function renderRecents() {
    const rows = drafts.map((draft) => ({
      id: draft.id,
      title: draftTitle(draft),
      status: draft.stage
    })).slice(0, 24);
    if (emptyEl) emptyEl.hidden = Boolean(rows.length);
    if (!recentsEl) return;
    recentsEl.hidden = !rows.length;
    recentsEl.innerHTML = rows.map((row) => `
      <div class="rail-recent dispatch-rail-item ${row.id === activeId ? 'is-active' : ''} is-${escapeHtml(row.status)}" role="listitem">
        <button class="rail-recent-open" type="button" data-id="${escapeHtml(row.id)}">
          <span class="rail-recent-title">${escapeHtml(row.title)}</span>
          <small>${escapeHtml(stageLabel(row.status))}</small>
        </button>
      </div>
    `).join('');
  }

  function render() {
    const draft = activeDraft();
    if (!draft.messages.length) {
      draft.messages.push({
        role: 'assistant',
        text: welcomeText
      });
    }
    if (messagesEl) {
      messagesEl.innerHTML = draft.messages.map(renderMessage).join('');
      const scroll = document.querySelector('.dispatch-scroll');
      if (scroll) scroll.scrollTop = scroll.scrollHeight;
    }
    if (input) {
      input.placeholder = draft.stage === 'needs_clarification'
        ? 'Answer Thingy’s clarification question...'
        : draft.stage === 'ready' || draft.stage === 'upgrade'
          ? 'Adjust the direction, or generate when ready...'
          : 'Tell Thingy what this Dispatch should explore...';
    }
    renderActions(draft);
    renderRecents();
    refreshIdentity();
    updateCount();
  }

  function updateCount() {
    if (!countEl || !input) return;
    countEl.textContent = `${input.value.length} / ${maxInputChars}`;
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
    if (message) return message;
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
      const serverDrafts = (data.dispatches || []).map(draftFromServerRow);
      const localById = new Map(drafts.map((draft) => [draftIdentity(draft), draft]).filter(([id]) => id));
      const mergedServerDrafts = serverDrafts.map((serverDraft) => {
        const localDraft = localById.get(draftIdentity(serverDraft));
        return shouldPreferLocalDraft(localDraft, serverDraft) ? localDraft : serverDraft;
      });
      const serverIds = new Set(mergedServerDrafts.map((draft) => draftIdentity(draft)));
      const localUnsynced = drafts.filter((draft) => !serverDispatchId(draft) && hasDraftContent(draft));
      const localFallbacks = drafts.filter((draft) => keepLocalDraftWhenMissingFromServer(draft, serverIds));
      drafts = [
        ...mergedServerDrafts,
        ...localFallbacks.filter((draft) => !serverIds.has(draftIdentity(draft)))
      ].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, 24);
      if (!drafts.some((draft) => draft.id === activeId)) {
        activeId = drafts[0]?.id || '';
        if (activeId) window.localStorage.setItem(activeKey, activeId);
      }
      saveDrafts();
      for (const draft of localUnsynced) {
        try {
          await saveDraftToServer(draft, { status: draft.stage === 'empty' ? 'draft' : draft.stage });
        } catch (error) {
          // Local cache remains as a best-effort fallback if migration fails.
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

  async function pollStatus() {
    const draft = activeDraft();
    if (!draft.dispatchId) return;
    try {
      const data = await dispatchPost('status', { dispatch_id: draft.dispatchId });
      const row = data.dispatch || {};
      if (row.status === 'sent') {
        updateDraft({
          stage: 'sent',
          title: row.title || row.subject || draft.title,
          statusText: 'Sent'
        });
        if (!draft.messages.some((message) => message.kind === 'sent')) {
          addMessage('assistant', 'Dispatch sent. Check your email.', { kind: 'sent' });
        }
        window.clearInterval(pollTimer);
        pollTimer = 0;
        await loadHistory();
      } else if (row.status === 'failed') {
        updateDraft({ stage: 'failed', statusText: row.error || 'Failed' });
        addMessage('assistant', row.error || 'Dispatch failed while generating.');
        window.clearInterval(pollTimer);
        pollTimer = 0;
        await loadHistory();
      } else if (row.status) {
        updateDraft({ stage: row.status });
        render();
      }
    } catch (error) {
      // Polling is best-effort.
    }
  }

  function startPolling() {
    const draft = activeDraft();
    if (!draft.dispatchId || pollTimer) return;
    pollTimer = window.setInterval(pollStatus, 6000);
    pollStatus();
  }

  if (!requireAuth()) return;
  if (!drafts.length) createDraft({ activate: true, render: false });
  if (!activeId) setActiveDraft(drafts[0].id, { render: false });
  if (shell) shell.classList.remove('is-booting', 'is-auth');
  if (app) app.hidden = false;

  if (form) {
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (busy || !input) return;
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      updateCount();
      addMessage('user', text);
      clarifyWithThingy(text);
      render();
    });
  }

  if (input) {
    input.addEventListener('input', updateCount);
  }

  newButtons.forEach((button) => button.addEventListener('click', () => {
    createDraft({ activate: true, render: true });
    setMobileRailOpen(false);
  }));

  if (recentsEl) {
    recentsEl.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-id]');
      if (!button || button.disabled) return;
      setActiveDraft(button.dataset.id);
      setMobileRailOpen(false);
    });
  }

  if (mobileToggle) {
    mobileToggle.addEventListener('click', (event) => {
      event.preventDefault();
      setMobileRailOpen(!shell?.classList.contains('is-mobile-rail-open'));
    });
  }

  if (railScrim) {
    railScrim.addEventListener('click', () => setMobileRailOpen(false));
  }

  if (actionsEl) {
    actionsEl.addEventListener('click', (event) => {
      const target = event.target.closest('[data-action]');
      if (!target || busy) return;
      const action = target.dataset.action;
      if (action === 'generate') generateDispatch();
      if (action === 'check') pollStatus();
      if (action === 'signin') {
        session.clearAuth();
        window.location.href = session.signInUrl('/dispatch/');
      }
    });
  }

  render();
  loadHistory().then(() => {
    const draft = activeDraft();
    if (draft.dispatchId && (draft.stage === 'queued' || draft.stage === 'generating')) startPolling();
  });
}());
