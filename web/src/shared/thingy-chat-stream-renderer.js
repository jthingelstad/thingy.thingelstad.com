import {
  appendActivityCommentary,
  appendActivityStep
} from './thingy-chat-rendering.js';
import { batch } from '@preact/signals';

// Drives a streaming assistant message into a signal-backed model. Deltas
// accumulate in local buffers and are flushed into the model once per
// animation frame, so a fast stream doesn't re-render the message every
// microtask.
function createAssistantStreamRenderer(options = {}) {
  const model = options.model;
  if (!model) throw new Error('createAssistantStreamRenderer requires a model');
  const scroll = typeof options.scroll === 'function' ? options.scroll : () => {};
  const fallback = options.statusFallback || 'Thingy is working...';
  let bufferedContent = String(model.content.peek() || '');
  let bufferedFrame = 0;

  if (options.label) model.label.value = options.label;
  if (options.statusFallback) model.statusFallback.value = options.statusFallback;
  if (model.status.peek() === 'pending') {
    // first content/status/citation event will flip it to streaming
  }

  function flush() {
    bufferedFrame = 0;
    if (model.content.peek() !== bufferedContent) {
      model.content.value = bufferedContent;
    }
    scroll();
  }

  function schedule() {
    if (bufferedFrame) return;
    bufferedFrame = window.requestAnimationFrame(flush);
  }

  function ensureStreaming() {
    if (model.status.peek() === 'pending') model.status.value = 'streaming';
  }

  function appendDelta(delta) {
    if (!delta) return;
    bufferedContent = (bufferedContent + delta).replace(/^\s+/, '');
    ensureStreaming();
    schedule();
  }

  function setAnswer(value) {
    bufferedContent = String(value || '');
    ensureStreaming();
    schedule();
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
    if (bufferedFrame) {
      window.cancelAnimationFrame(bufferedFrame);
      bufferedFrame = 0;
    }
    batch(() => {
      if (model.content.peek() !== bufferedContent) model.content.value = bufferedContent;
      model.status.value = nextStatus;
    });
    return {
      answer: model.content.peek(),
      citations: model.citations.peek(),
      experience: model.experience.peek()
    };
  }

  function fail(message, retryPrompt) {
    if (bufferedFrame) {
      window.cancelAnimationFrame(bufferedFrame);
      bufferedFrame = 0;
    }
    batch(() => {
      if (model.content.peek() !== bufferedContent) model.content.value = bufferedContent;
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
