(function () {
  const session = window.ThingySession;
  const gate = document.getElementById('dispatch-gate');
  const app = document.getElementById('dispatch-app');
  const form = document.getElementById('dispatch-form');
  const promptInput = document.getElementById('dispatch-prompt');
  const clarifyButton = document.getElementById('dispatch-clarify');
  const generateButton = document.getElementById('dispatch-generate');
  const status = document.getElementById('dispatch-status');
  const clarification = document.getElementById('dispatch-clarification');
  const clarificationQuestion = document.getElementById('dispatch-clarification-question');
  const clarificationAnswer = document.getElementById('dispatch-clarification-answer');
  const directionBox = document.getElementById('dispatch-direction');
  const history = document.getElementById('dispatch-history');
  const emailTarget = document.getElementById('dispatch-email-target');
  const upgrade = document.getElementById('dispatch-upgrade');
  let currentDirection = '';
  let currentQuestion = '';
  let activeDispatchId = '';
  let pollTimer = 0;

  function setStatus(message, kind) {
    if (!status) return;
    status.textContent = message || '';
    status.dataset.kind = kind || '';
  }

  function setBusy(busy) {
    if (clarifyButton) clarifyButton.disabled = Boolean(busy);
    if (generateButton) generateButton.disabled = Boolean(busy);
    if (promptInput) promptInput.disabled = Boolean(busy);
    if (clarificationAnswer) clarificationAnswer.disabled = Boolean(busy);
  }

  function signedIn() {
    return session.token() && !session.tokenExpired();
  }

  function requireAuth() {
    if (signedIn()) return true;
    if (gate) gate.hidden = false;
    if (app) app.hidden = true;
    window.location.href = session.signInUrl('/dispatch/');
    return false;
  }

  function dispatchPayload(action, extra) {
    return {
      action,
      ...(extra || {})
    };
  }

  async function dispatchPost(action, extra) {
    if (!(await session.ensureFreshToken())) {
      session.clearAuth();
      requireAuth();
      throw new Error('Sign in again to continue.');
    }
    return await session.postJson('/dispatch', dispatchPayload(action, extra), session.authHeaders());
  }

  function renderDispatch(row) {
    const date = row.sent_at || row.started_at || row.queued_at || row.created_at || '';
    const label = row.status === 'sent' ? 'Sent' : row.status === 'failed' ? 'Failed' : row.status === 'generating' ? 'Generating' : 'Queued';
    const title = row.title || row.topic || row.direction || 'Dispatch';
    return `<li class="dispatch-log-item is-${escapeHtml(row.status || 'unknown')}">
      <span class="dispatch-log-state">${escapeHtml(label)}</span>
      <strong>${escapeHtml(title)}</strong>
      <small>${escapeHtml(date ? new Date(date).toLocaleString() : '')}</small>
      ${row.error ? `<p>${escapeHtml(row.error)}</p>` : ''}
    </li>`;
  }

  function escapeHtml(value) {
    return String(value || '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');
  }

  function renderHistory(rows) {
    if (!history) return;
    if (!rows || !rows.length) {
      history.innerHTML = '<p class="dispatch-empty">No Dispatches yet.</p>';
      return;
    }
    history.innerHTML = `<ul class="dispatch-log">${rows.map(renderDispatch).join('')}</ul>`;
  }

  function showUpgrade(show, message) {
    if (!upgrade) return;
    upgrade.hidden = !show;
    if (message) upgrade.querySelector('p').textContent = message;
  }

  async function loadHistory() {
    try {
      const data = await dispatchPost('list', { limit: 8 });
      renderHistory(data.dispatches || []);
      const email = session.storedEmail();
      if (emailTarget) emailTarget.textContent = email ? `Dispatch will be sent to ${email}.` : 'Dispatch will be sent to your signed-in email.';
      showUpgrade(false);
      const availability = data.availability || {};
      if (!availability.allowed && availability.reason === 'cooldown') {
        const hours = Math.ceil(Number(availability.retry_after_seconds || 0) / 3600);
        setStatus(`Your next Dispatch opens in about ${hours} hour${hours === 1 ? '' : 's'}.`, 'notice');
      }
    } catch (error) {
      if (error.status === 401) {
        session.clearAuth();
        requireAuth();
        return;
      }
      setStatus(error.message || 'Could not load Dispatch history.', 'error');
    }
  }

  async function clarify() {
    const prompt = String(promptInput && promptInput.value || '').trim();
    if (prompt.length < 8) {
      setStatus('Give Thingy a topic, question, or thread to work from.', 'error');
      return;
    }
    setBusy(true);
    setStatus('Thingy is shaping the Dispatch...', 'pending');
    try {
      const data = await dispatchPost('clarify', {
        prompt,
        clarification_question: currentQuestion,
        clarification_answer: clarificationAnswer && clarificationAnswer.value
      });
      currentDirection = data.direction || prompt;
      if (directionBox) {
        directionBox.hidden = false;
        directionBox.textContent = currentDirection;
      }
      if (data.needs_clarification) {
        currentQuestion = data.question || '';
        if (clarificationQuestion) clarificationQuestion.textContent = currentQuestion;
        if (clarification) clarification.hidden = false;
        setStatus('Thingy has one question before generating.', 'notice');
      } else {
        if (clarification) clarification.hidden = true;
        setStatus('Direction is clear. Generate when you are ready.', 'success');
      }
      if (generateButton) generateButton.hidden = false;
      showUpgrade(false);
    } catch (error) {
      setStatus(error.message || 'Thingy could not clarify that right now.', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function generate() {
    const prompt = String(promptInput && promptInput.value || '').trim();
    const email = session.storedEmail();
    if (!email) {
      setStatus('Sign in again so Thingy knows where to send the Dispatch.', 'error');
      window.location.href = session.signInUrl('/dispatch/');
      return;
    }
    setBusy(true);
    setStatus('Queueing your Dispatch...', 'pending');
    try {
      const data = await dispatchPost('create', {
        prompt,
        topic: prompt,
        direction: currentDirection || prompt,
        clarification_question: currentQuestion,
        clarification_answer: clarificationAnswer && clarificationAnswer.value,
        email
      });
      activeDispatchId = data.dispatch && (data.dispatch.id || data.dispatch.dispatch_id) || '';
      setStatus('Dispatch queued. Thingy will email it when it is ready.', 'success');
      await loadHistory();
      startPolling();
    } catch (error) {
      if (error.status === 403 && error.data && error.data.status === 'supporting_member_required') {
        showUpgrade(true, error.data.message || 'Sending a Dispatch requires a Supporting Membership.');
        setStatus('This Dispatch is shaped and ready. Sending is a supporting-member feature.', 'notice');
      } else if (error.status === 429) {
        setStatus(error.message || 'Dispatch is rate limited right now.', 'notice');
      } else {
        setStatus(error.message || 'Could not queue this Dispatch.', 'error');
      }
    } finally {
      setBusy(false);
    }
  }

  async function pollStatus() {
    if (!activeDispatchId) return;
    try {
      const data = await dispatchPost('status', { dispatch_id: activeDispatchId });
      const row = data.dispatch || {};
      if (row.status === 'sent') {
        setStatus('Dispatch sent. Check your email.', 'success');
        window.clearInterval(pollTimer);
        pollTimer = 0;
        await loadHistory();
      } else if (row.status === 'failed') {
        setStatus(row.error || 'Dispatch failed while generating.', 'error');
        window.clearInterval(pollTimer);
        pollTimer = 0;
        await loadHistory();
      } else if (row.status) {
        setStatus(`Dispatch is ${row.status}.`, 'pending');
      }
    } catch (error) {
      // Polling is best-effort; leave the queued status visible.
    }
  }

  function startPolling() {
    if (!activeDispatchId || pollTimer) return;
    pollTimer = window.setInterval(pollStatus, 6000);
    pollStatus();
  }

  if (!requireAuth()) return;
  if (gate) gate.hidden = true;
  if (app) app.hidden = false;
  loadHistory();
  if (form) {
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      clarify();
    });
  }
  if (generateButton) generateButton.addEventListener('click', generate);
}());
