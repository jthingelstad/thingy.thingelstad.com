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
  const maxInputChars = Number(input && input.getAttribute('maxlength') || 1200);
  let drafts = loadDrafts();
  let remoteDispatches = [];
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
        text: "What should this Dispatch explore? Give me a topic, question, or thread from Jamie's archive and I'll help shape it before you send it."
      }]
    });
    drafts.unshift(draft);
    if (options.activate !== false) setActiveDraft(draft.id, { render: false });
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
    if (railScrim) railScrim.hidden = false;
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
      actions.push(`<button type="button" class="dispatch-action-primary" data-action="generate">Generate Dispatch</button>`);
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
    const localRows = drafts.map((draft) => ({
      id: draft.id,
      title: draftTitle(draft),
      status: draft.stage,
      local: true
    }));
    const remoteRows = remoteDispatches
      .filter((row) => !drafts.some((draft) => draft.dispatchId && draft.dispatchId === (row.id || row.dispatch_id)))
      .map((row) => ({
        id: `remote-${row.id || row.dispatch_id}`,
        title: row.title || row.subject || row.topic || 'Dispatch',
        status: row.status,
        local: false
      }));
    const rows = [...localRows, ...remoteRows].slice(0, 24);
    if (emptyEl) emptyEl.hidden = Boolean(rows.length);
    if (!recentsEl) return;
    recentsEl.hidden = !rows.length;
    recentsEl.innerHTML = rows.map((row) => `
      <div class="rail-recent dispatch-rail-item ${row.id === activeId ? 'is-active' : ''} is-${escapeHtml(row.status)}" role="listitem">
        <button class="rail-recent-open" type="button" data-id="${escapeHtml(row.id)}" ${row.local ? '' : 'disabled'}>
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
        text: "What should this Dispatch explore? Give me a topic, question, or thread from Jamie's archive and I'll help shape it before you send it."
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

  async function loadHistory() {
    try {
      const data = await dispatchPost('list', { limit: 12 });
      remoteDispatches = data.dispatches || [];
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
    const prompt = draft.prompt || text;
    const answer = draft.stage === 'needs_clarification' ? text : '';
    setBusy(true, 'Thingy is shaping this Dispatch...');
    updateDraft({
      stage: 'shaping',
      prompt,
      title: titleFromPrompt(prompt),
      clarificationAnswer: answer || draft.clarificationAnswer
    });
    try {
      const data = await dispatchPost('clarify', {
        prompt,
        clarification_question: draft.currentQuestion,
        clarification_answer: answer
      });
      const direction = data.direction || prompt;
      if (data.needs_clarification) {
        updateDraft({
          stage: 'needs_clarification',
          direction,
          currentQuestion: data.question || ''
        });
        addMessage('assistant', data.question || 'What angle should I use for this Dispatch?');
      } else {
        updateDraft({
          stage: 'ready',
          direction,
          currentQuestion: ''
        });
        addMessage('assistant', `Here is the Dispatch I am ready to generate:\n\n${direction}\n\nIf this is right, use Generate Dispatch. If you want to steer it, send me the adjustment.`);
      }
      setStatus('');
    } catch (error) {
      updateDraft({ stage: draft.stage === 'needs_clarification' ? 'needs_clarification' : 'empty' });
      addMessage('assistant', error.message || 'I could not shape that Dispatch right now.');
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
    setBusy(true, 'Queueing Dispatch...');
    try {
      const data = await dispatchPost('create', {
        prompt: draft.prompt,
        topic: draft.prompt,
        direction: draft.direction || draft.prompt,
        clarification_question: draft.currentQuestion,
        clarification_answer: draft.clarificationAnswer,
        email
      });
      const row = data.dispatch || {};
      updateDraft({
        stage: row.status || 'queued',
        dispatchId: row.id || row.dispatch_id || '',
        statusText: 'Dispatch queued.'
      });
      addMessage('assistant', 'Done. I queued this Dispatch and will email it when it is ready.');
      await loadHistory();
      startPolling();
    } catch (error) {
      if (error.status === 403 && error.data && error.data.status === 'supporting_member_required') {
        updateDraft({ stage: 'upgrade' });
        addMessage('assistant', [
          'This Dispatch is shaped and ready.',
          'Sending Dispatches is a Supporting Member feature. Supporting Membership helps sustain The Weekly Thing and Jamie directs the membership proceeds as a charitable giving pool rather than treating this as a paywall for Thingy.',
          'You can become a Supporting Member, come back here, sign in again so I can see the updated membership, and generate this same Dispatch.'
        ].join('\n\n'));
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
  if (!drafts.length) createDraft({ activate: true });
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
      const draft = activeDraft();
      if (draft.stage === 'ready' || draft.stage === 'upgrade') {
        updateDraft({
          stage: 'shaping',
          prompt: `${draft.prompt}\n\nAdjustment from reader: ${text}`,
          direction: `${draft.direction}\n\nAdjustment from reader: ${text}`
        });
      }
      clarifyWithThingy(text);
      render();
    });
  }

  if (input) {
    input.addEventListener('input', updateCount);
  }

  newButtons.forEach((button) => button.addEventListener('click', () => {
    const draft = createDraft({ activate: true });
    setActiveDraft(draft.id);
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
