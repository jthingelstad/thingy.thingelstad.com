// @ts-check
import { appendActivityCommentary, appendActivityStep } from './thingy-chat-rendering.ts';
import { batch } from '@preact/signals';

// Drives a streaming assistant message into a signal-backed model.
//
// Each delta is written into the model immediately rather than buffered
// through requestAnimationFrame. The rAF approach was correct for the
// old innerHTML renderer (where every write forced a layout), but with
// signals Preact batches its own renders — rAF coalescing just means
// the macrotask never fires while readStream's microtask chain is hot,
// so every delta accumulates and the answer appears all at once.
function createAssistantStreamRenderer(options: ThingyOptions = {}) {
  const model = options.model;
  if (!model) throw new Error('createAssistantStreamRenderer requires a model');
  const scroll = typeof options.scroll === 'function' ? options.scroll : () => {};
  const fallback = options.statusFallback || 'Thingy is working...';

  if (options.label) model.label.value = options.label;
  if (options.statusFallback) model.statusFallback.value = options.statusFallback;

  function ensureStreaming() {
    if (model.status.peek() === 'pending') model.status.value = 'streaming';
  }

  function appendDelta(delta) {
    if (!delta) return;
    const next = (model.content.peek() + delta).replace(/^\s+/, '');
    model.content.value = next;
    ensureStreaming();
    scroll();
  }

  function setAnswer(value) {
    model.content.value = String(value || '');
    ensureStreaming();
    scroll();
  }

  function setCitations(citations) {
    model.citations.value = Array.isArray(citations) ? citations : [];
    scroll();
  }

  function setExperience(experience) {
    model.experience.value = experience || null;
    scroll();
  }

  function status(data) {
    const next = appendActivityStep(model.activity.peek().slice(), data, fallback);
    model.activity.value = next;
    ensureStreaming();
    scroll({ force: true });
  }

  function commentary(value) {
    const next = appendActivityCommentary(model.commentary.peek().slice(), value);
    model.commentary.value = next;
    ensureStreaming();
    scroll({ force: true });
  }

  function finish(nextStatus = 'done') {
    batch(() => {
      model.status.value = nextStatus;
    });
    return {
      answer: model.content.peek(),
      citations: model.citations.peek(),
      experience: model.experience.peek()
    };
  }

  function fail(message, retryPrompt) {
    batch(() => {
      model.errorMessage.value = String(message || 'Thingy is unavailable.');
      if (retryPrompt) model.retryPrompt.value = retryPrompt;
      model.status.value = 'error';
    });
  }

  return {
    appendDelta,
    commentary,
    fail,
    finish,
    setAnswer,
    setCitations,
    setExperience,
    status
  };
}

export { createAssistantStreamRenderer };
