import {
  appendActivityCommentary,
  appendActivityStep,
  renderAssistantResponse
} from './thingy-chat-rendering.js';

function createAssistantStreamRenderer(options = {}) {
  const pending = options.pending;
  const scroll = typeof options.scroll === 'function' ? options.scroll : () => {};
  const label = options.label || '';
  const statusFallback = options.statusFallback || 'Thingy is working...';
  let answer = '';
  let citations = Array.isArray(options.citations) ? options.citations : [];
  let experience = null;
  let activitySteps = [];
  let activityCommentary = [];
  let renderFrame = 0;

  function render(active = false) {
    renderFrame = 0;
    if (!pending) return;
    pending.classList.toggle('librarian-message-pending', Boolean(active));
    pending.innerHTML = renderAssistantResponse(answer, citations, experience, activitySteps, activityCommentary, { active, label });
    scroll(active ? { force: true } : undefined);
  }

  function schedule() {
    if (renderFrame) return;
    renderFrame = window.requestAnimationFrame(() => render(false));
  }

  function status(data, fallback = statusFallback) {
    activitySteps = appendActivityStep(activitySteps, data, fallback);
    render(true);
  }

  function commentary(value) {
    activityCommentary = appendActivityCommentary(activityCommentary, value);
    render(true);
  }

  function appendDelta(delta) {
    answer += delta || '';
    answer = answer.replace(/^\s+/, '');
    schedule();
  }

  function setAnswer(value) {
    answer = value || '';
    schedule();
  }

  function setCitations(value) {
    citations = value || [];
    schedule();
  }

  function setExperience(value) {
    experience = value || null;
    schedule();
  }

  function finish() {
    if (renderFrame) {
      window.cancelAnimationFrame(renderFrame);
      renderFrame = 0;
    }
    render(false);
    return { answer, citations, experience };
  }

  return {
    appendDelta,
    commentary,
    finish,
    setAnswer,
    setCitations,
    setExperience,
    status
  };
}

export { createAssistantStreamRenderer };
