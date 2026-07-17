import { iconSvg } from './thingy-icons.ts';

function actionIcon(name) {
  const iconNames = {
    copy: 'copy',
    play: 'play',
    pause: 'pause',
    retry: 'rotate-ccw',
    up: 'thumbs-up',
    down: 'thumbs-down',
    share: 'share'
  };
  return iconSvg(iconNames[name]);
}

function escapeAttribute(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

async function copyToClipboard(value) {
  if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') return false;
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch (error) {
    return false;
  }
}

function buildSharePromptUrl(prompt, scope) {
  const url = new URL('/chat/', window.location.origin);
  url.searchParams.set('prompt', prompt);
  url.searchParams.set('scope', scope || 'all');
  return url.toString();
}

function answerClipboardPayload(messageElement) {
  const clone = messageElement.cloneNode(true);
  clone
    .querySelectorAll('.librarian-feedback, .librarian-prompt-actions, .librarian-activity')
    .forEach((node) => node.remove());
  clone.querySelectorAll('[aria-hidden="true"]').forEach((node) => node.remove());
  clone.querySelectorAll('a[href]').forEach((link) => {
    try {
      link.setAttribute('href', new URL(link.getAttribute('href'), window.location.origin).toString());
    } catch (error) {
      /* leave original href */
    }
  });
  const scratch = document.createElement('div');
  scratch.setAttribute('aria-hidden', 'true');
  scratch.style.position = 'fixed';
  scratch.style.left = '-9999px';
  scratch.style.top = '0';
  scratch.style.width = '720px';
  scratch.appendChild(clone);
  document.body.appendChild(scratch);
  const html = clone.innerHTML.trim();
  const text = (clone.innerText || clone.textContent || '').trim();
  scratch.remove();
  return { html, text };
}

function speechOutputSupported() {
  return 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance === 'function';
}

function setSpeechButtonState(button, playing) {
  if (!button) return;
  button.classList.toggle('selected', playing);
  button.setAttribute('aria-label', playing ? 'Stop reading answer' : 'Read answer aloud');
  button.title = playing ? 'Stop reading answer' : 'Read answer aloud';
  button.innerHTML = actionIcon(playing ? 'pause' : 'play');
}

function legacyCopyRichHtml(html, text) {
  if (typeof document.execCommand !== 'function') return false;
  const scratch = document.createElement('div');
  scratch.contentEditable = 'true';
  scratch.setAttribute('aria-hidden', 'true');
  scratch.style.position = 'fixed';
  scratch.style.left = '-9999px';
  scratch.style.top = '0';
  scratch.innerHTML = html;
  document.body.appendChild(scratch);

  const selection = window.getSelection();
  const previousRange = selection && selection.rangeCount ? selection.getRangeAt(0) : null;
  const range = document.createRange();
  range.selectNodeContents(scratch);
  selection.removeAllRanges();
  selection.addRange(range);

  const onCopy = (event) => {
    event.clipboardData.setData('text/html', html);
    event.clipboardData.setData('text/plain', text);
    event.preventDefault();
  };

  document.addEventListener('copy', onCopy);
  let copied;
  try {
    copied = document.execCommand('copy');
  } catch (error) {
    copied = false;
  } finally {
    document.removeEventListener('copy', onCopy);
    selection.removeAllRanges();
    if (previousRange) selection.addRange(previousRange);
    scratch.remove();
  }
  return copied;
}

async function copyRichHtmlToClipboard(html, text) {
  const normalizedHtml = String(html || '').trim();
  const normalizedText = String(text || '').trim();
  if (!normalizedHtml && !normalizedText) return 'empty';
  if (navigator.clipboard && typeof navigator.clipboard.write === 'function' && typeof ClipboardItem === 'function') {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([normalizedHtml], { type: 'text/html' }),
          'text/plain': new Blob([normalizedText], { type: 'text/plain' })
        })
      ]);
      return 'rich';
    } catch (error) {
      /* fall through */
    }
  }
  if (legacyCopyRichHtml(normalizedHtml, normalizedText)) return 'rich';
  if (await copyToClipboard(normalizedText)) return 'plain';
  return 'failed';
}

function createChatMessageActions(options: ThingyOptions = {}) {
  const submitFeedback = typeof options.submitFeedback === 'function' ? options.submitFeedback : async () => ({});
  const track = typeof options.track === 'function' ? options.track : () => {};
  const promptShareUrl =
    typeof options.promptShareUrl === 'function'
      ? options.promptShareUrl
      : (prompt, scope) => buildSharePromptUrl(prompt, scope);
  const promptShareTitle = String(options.promptShareTitle || 'Ask Thingy');
  let feedbackStatusTimer = 0;
  let speechUtterance = null;
  let speechButton = null;

  function stopSpeaking() {
    if (speechOutputSupported()) window.speechSynthesis.cancel();
    setSpeechButtonState(speechButton, false);
    speechUtterance = null;
    speechButton = null;
  }

  function setFeedbackState(container, reaction) {
    container.querySelectorAll('button[data-reaction]').forEach((button) => {
      const selected = button.dataset.reaction === reaction;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-pressed', selected ? 'true' : 'false');
    });
  }

  function flashActionStatus(container, message) {
    const status = container.querySelector('.librarian-feedback-status');
    if (!status) return;
    status.textContent = message;
    window.clearTimeout(feedbackStatusTimer);
    feedbackStatusTimer = window.setTimeout(() => {
      if (status.textContent === message) status.textContent = '';
    }, 1800);
  }

  async function saveFeedback(requestId, reaction, container, comment = '') {
    const status = container.querySelector('.librarian-feedback-status');
    container.querySelectorAll('button[data-reaction]').forEach((button) => {
      button.disabled = true;
    });
    if (status) status.textContent = 'Saving...';
    try {
      const data = await submitFeedback({ requestId, reaction, comment });
      setFeedbackState(container, data.reaction || reaction);
      if (status) status.textContent = 'Saved';
      window.clearTimeout(feedbackStatusTimer);
      feedbackStatusTimer = window.setTimeout(() => {
        if (status && status.textContent === 'Saved') status.textContent = '';
      }, 1800);
      track('librarian.feedback_submit', data.reaction || reaction);
      if (comment) track('librarian.feedback_comment', reaction);
    } catch (error) {
      if (status) status.textContent = 'Could not save';
      track('librarian.feedback_error', error.requestId ? 'server' : 'client');
    } finally {
      container.querySelectorAll('button[data-reaction]').forEach((button) => {
        button.disabled = false;
      });
    }
  }

  function toggleSpeakAnswer(messageElement, button) {
    if (!speechOutputSupported()) return 'Speech playback not supported';
    if (speechButton === button && speechUtterance) {
      stopSpeaking();
      return 'Stopped';
    }
    stopSpeaking();
    const payload = answerClipboardPayload(messageElement);
    if (!payload.text) return 'Nothing to read';
    const utterance = new window.SpeechSynthesisUtterance(payload.text);
    utterance.lang = document.documentElement.lang || navigator.language || 'en-US';
    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.onend = () => {
      if (speechUtterance === utterance) stopSpeaking();
    };
    utterance.onerror = () => {
      if (speechUtterance === utterance) stopSpeaking();
    };
    speechUtterance = utterance;
    speechButton = button;
    setSpeechButtonState(button, true);
    window.speechSynthesis.speak(utterance);
    return 'Reading';
  }

  async function copyAnswerRichText(messageElement) {
    const payload = answerClipboardPayload(messageElement);
    const result = await copyRichHtmlToClipboard(payload.html, payload.text);
    if (result === 'rich') return 'Rich text copied';
    if (result === 'plain') return 'Text copied';
    if (result === 'empty') return 'Nothing to copy';
    return 'Could not copy';
  }

  async function shareAnswer(messageElement) {
    const payload = answerClipboardPayload(messageElement);
    if (!payload.text && !payload.html) return 'Nothing to share';
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: 'Thingy answer', text: payload.text });
        track('librarian.answer_share_native');
        return 'Shared';
      } catch (error) {
        if (error && error.name === 'AbortError') return '';
      }
    }
    const result = await copyRichHtmlToClipboard(payload.html, payload.text);
    if (result === 'rich') return 'Rich text copied';
    if (result === 'plain') return 'Text copied';
    return 'Could not share';
  }

  async function sharePrompt(prompt, scope) {
    const shareUrl = promptShareUrl(prompt, scope);
    if (typeof navigator.share === 'function') {
      try {
        const payload: ShareData = { title: promptShareTitle, text: prompt };
        if (shareUrl) payload.url = shareUrl;
        await navigator.share(payload);
        track('librarian.share_native');
        return 'Shared';
      } catch (error) {
        if (error && error.name === 'AbortError') return '';
      }
    }
    const copied = await copyToClipboard(shareUrl || prompt);
    if (copied) {
      track('librarian.share_copy');
      return shareUrl ? 'Link copied' : 'Text copied';
    }
    return 'Could not copy';
  }

  async function copyPrompt(prompt) {
    const copied = await copyToClipboard(prompt);
    if (copied) {
      track('librarian.prompt_copy');
      return 'Prompt copied';
    }
    return 'Could not copy';
  }

  function addPromptActions(messageElement, prompt, scope) {
    if (!prompt) return;
    const controls = document.createElement('div');
    controls.className = 'librarian-prompt-actions';
    controls.innerHTML = `
      <button type="button" data-action="copy" aria-label="Copy prompt" title="Copy prompt">${actionIcon('copy')}</button>
      <button type="button" data-action="share" aria-label="Share prompt" title="Share prompt">${actionIcon('share')}</button>
      <span class="librarian-feedback-status" aria-live="polite"></span>
    `;
    controls.addEventListener('click', async (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const button = target ? target.closest<HTMLButtonElement>('button[data-action]') : null;
      if (!button || !controls.contains(button)) return;
      if (button.dataset.action === 'copy') {
        const message = await copyPrompt(prompt);
        flashActionStatus(controls, message);
        return;
      }
      if (button.dataset.action === 'share') {
        const message = await sharePrompt(prompt, scope);
        if (message) flashActionStatus(controls, message);
      }
    });
    messageElement.appendChild(controls);
  }

  function addResponseActions(messageElement, requestId, actionOptions: ThingyOptions = {}) {
    const includeFeedback = actionOptions.feedback !== false && Boolean(requestId);
    const retryPrompt = String(actionOptions.retryPrompt || '').trim();
    if (!requestId && includeFeedback) return;
    const controls = document.createElement('div');
    controls.className = 'librarian-feedback';
    const playDisabled = speechOutputSupported() ? '' : ' disabled';
    const playTitle = speechOutputSupported() ? 'Read answer aloud' : 'Speech playback not supported';
    controls.innerHTML = `
      <button type="button" data-action="copy" aria-label="Copy answer" title="Copy answer">${actionIcon('copy')}</button>
      <button type="button" data-action="speak" aria-label="${playTitle}" title="${playTitle}"${playDisabled}>${actionIcon('play')}</button>
      ${includeFeedback ? `<button type="button" data-reaction="up" aria-label="Good response" aria-pressed="false" title="Good response">${actionIcon('up')}</button>` : ''}
      ${includeFeedback ? `<button type="button" data-reaction="down" aria-label="Bad response" aria-pressed="false" title="Bad response">${actionIcon('down')}</button>` : ''}
      <button type="button" data-action="share" aria-label="Share answer" title="Share answer">${actionIcon('share')}</button>
      ${retryPrompt ? `<button type="button" data-action="retry" data-retry-prompt="${escapeAttribute(retryPrompt)}" aria-label="Retry answer" title="Retry answer">${actionIcon('retry')}</button>` : ''}
      <span class="librarian-feedback-status" aria-live="polite"></span>
    `;
    controls.addEventListener('click', async (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const button = target ? target.closest<HTMLButtonElement>('button') : null;
      if (!button || !controls.contains(button)) return;
      if (button.dataset.reaction) {
        if (button.classList.contains('selected')) return;
        let comment = '';
        if (button.dataset.reaction === 'down') {
          const value = window.prompt('What went wrong?');
          if (value === null) return;
          comment = value.trim().slice(0, 1000);
        }
        saveFeedback(requestId, button.dataset.reaction, controls, comment);
        return;
      }
      if (button.dataset.action === 'copy') {
        const message = await copyAnswerRichText(messageElement);
        flashActionStatus(controls, message);
        track(
          'librarian.answer_copy',
          message === 'Rich text copied' ? 'rich' : message === 'Text copied' ? 'plain' : 'error'
        );
        return;
      }
      if (button.dataset.action === 'speak') {
        const message = toggleSpeakAnswer(messageElement, button);
        if (message && message !== 'Reading' && message !== 'Stopped') flashActionStatus(controls, message);
        track('librarian.answer_speak', message === 'Reading' ? 'start' : message === 'Stopped' ? 'stop' : 'error');
        return;
      }
      if (button.dataset.action === 'share') {
        const message = await shareAnswer(messageElement);
        if (message) flashActionStatus(controls, message);
        track(
          'librarian.answer_share',
          message === 'Shared'
            ? 'native'
            : message === 'Rich text copied'
              ? 'rich'
              : message === 'Text copied'
                ? 'plain'
                : message
                  ? 'error'
                  : 'cancel'
        );
      }
    });
    messageElement.appendChild(controls);
  }

  return {
    addPromptActions,
    addResponseActions,
    stopSpeaking
  };
}

export { createChatMessageActions };
