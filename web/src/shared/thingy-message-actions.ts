interface FeedbackInput {
  requestId: string;
  reaction: string;
  comment: string;
}

interface FeedbackResult {
  reaction?: string;
}

interface ChatMessageActionOptions {
  submitFeedback?: (input: FeedbackInput) => Promise<FeedbackResult>;
  track?: (name: string, value?: string) => void;
  promptShareUrl?: (prompt: string, scope: string) => string;
  promptShareTitle?: string;
  onSpeechStateChange?: (playing: boolean) => void;
}

async function copyToClipboard(value: string) {
  if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') return false;
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch (_error) {
    return false;
  }
}

function buildSharePromptUrl(prompt: string, scope: string) {
  const url = new URL('/chat/', window.location.origin);
  url.searchParams.set('prompt', prompt);
  url.searchParams.set('scope', scope || 'all');
  return url.toString();
}

// Rich clipboard APIs require a detached DOM representation. This is a
// browser-capability adapter, not view rendering: Preact still owns every
// visible node and listener.
function answerClipboardPayload(messageElement: HTMLElement) {
  const clone = messageElement.cloneNode(true) as HTMLElement;
  clone
    .querySelectorAll('.librarian-feedback, .librarian-prompt-actions, .librarian-activity')
    .forEach((node) => node.remove());
  clone.querySelectorAll('[aria-hidden="true"]').forEach((node) => node.remove());
  clone.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((link) => {
    try {
      const href = link.getAttribute('href');
      if (href) link.setAttribute('href', new URL(href, window.location.origin).toString());
    } catch (_error) {
      /* leave original href */
    }
  });
  const scratch = document.createElement('div');
  scratch.setAttribute('aria-hidden', 'true');
  scratch.style.cssText = 'position:fixed;left:-9999px;top:0;width:720px';
  scratch.appendChild(clone);
  document.body.appendChild(scratch);
  const payload = { html: clone.innerHTML.trim(), text: (clone.innerText || clone.textContent || '').trim() };
  scratch.remove();
  return payload;
}

function speechOutputSupported() {
  return 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance === 'function';
}

function legacyCopyRichHtml(html: string, text: string) {
  if (typeof document.execCommand !== 'function') return false;
  const scratch = document.createElement('div');
  scratch.contentEditable = 'true';
  scratch.setAttribute('aria-hidden', 'true');
  scratch.style.cssText = 'position:fixed;left:-9999px;top:0';
  scratch.innerHTML = html;
  document.body.appendChild(scratch);
  const selection = window.getSelection();
  if (!selection) {
    scratch.remove();
    return false;
  }
  const previousRange = selection.rangeCount ? selection.getRangeAt(0) : null;
  const range = document.createRange();
  range.selectNodeContents(scratch);
  selection.removeAllRanges();
  selection.addRange(range);
  const onCopy = (event: ClipboardEvent) => {
    event.clipboardData?.setData('text/html', html);
    event.clipboardData?.setData('text/plain', text);
    event.preventDefault();
  };
  document.addEventListener('copy', onCopy);
  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch (_error) {
    copied = false;
  } finally {
    document.removeEventListener('copy', onCopy);
    selection.removeAllRanges();
    if (previousRange) selection.addRange(previousRange);
    scratch.remove();
  }
  return copied;
}

async function copyRichHtmlToClipboard(html: unknown, text: unknown) {
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
    } catch (_error) {
      /* fall through to the compatibility paths */
    }
  }
  if (legacyCopyRichHtml(normalizedHtml, normalizedText)) return 'rich';
  if (await copyToClipboard(normalizedText)) return 'plain';
  return 'failed';
}

function createChatMessageActions(options: ChatMessageActionOptions = {}) {
  const submitFeedback: (input: FeedbackInput) => Promise<FeedbackResult> =
    options.submitFeedback || (async () => ({}));
  const track = options.track || (() => {});
  const promptShareUrl = options.promptShareUrl || buildSharePromptUrl;
  const promptShareTitle = String(options.promptShareTitle || 'Ask Thingy');
  const onSpeechStateChange = options.onSpeechStateChange || (() => {});
  let speechUtterance: SpeechSynthesisUtterance | null = null;

  function stopSpeaking() {
    if (speechOutputSupported()) window.speechSynthesis.cancel();
    speechUtterance = null;
    onSpeechStateChange(false);
  }

  async function saveFeedback(requestId: string, reaction: string, comment = '') {
    try {
      const data = await submitFeedback({ requestId, reaction, comment });
      track('librarian.feedback_submit', data.reaction || reaction);
      if (comment) track('librarian.feedback_comment', reaction);
      return data;
    } catch (error) {
      track('librarian.feedback_error', error instanceof Error && error.requestId ? 'server' : 'client');
      throw error;
    }
  }

  function toggleSpeakAnswer(messageElement: HTMLElement) {
    if (!speechOutputSupported()) return 'Speech playback not supported';
    if (speechUtterance) {
      stopSpeaking();
      return 'Stopped';
    }
    const payload = answerClipboardPayload(messageElement);
    if (!payload.text) return 'Nothing to read';
    const utterance = new window.SpeechSynthesisUtterance(payload.text);
    utterance.lang = document.documentElement.lang || navigator.language || 'en-US';
    utterance.onend = () => {
      if (speechUtterance === utterance) stopSpeaking();
    };
    utterance.onerror = () => {
      if (speechUtterance === utterance) stopSpeaking();
    };
    speechUtterance = utterance;
    onSpeechStateChange(true);
    window.speechSynthesis.speak(utterance);
    return 'Reading';
  }

  async function copyAnswerRichText(messageElement: HTMLElement) {
    const payload = answerClipboardPayload(messageElement);
    const result = await copyRichHtmlToClipboard(payload.html, payload.text);
    if (result === 'rich') return 'Rich text copied';
    if (result === 'plain') return 'Text copied';
    if (result === 'empty') return 'Nothing to copy';
    return 'Could not copy';
  }

  async function shareAnswer(messageElement: HTMLElement) {
    const payload = answerClipboardPayload(messageElement);
    if (!payload.text && !payload.html) return 'Nothing to share';
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: 'Thingy answer', text: payload.text });
        track('librarian.answer_share_native');
        return 'Shared';
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') return '';
      }
    }
    const result = await copyRichHtmlToClipboard(payload.html, payload.text);
    if (result === 'rich') return 'Rich text copied';
    if (result === 'plain') return 'Text copied';
    return 'Could not share';
  }

  async function sharePrompt(prompt: string, scope: string) {
    const shareUrl = promptShareUrl(prompt, scope);
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: promptShareTitle, text: prompt, ...(shareUrl ? { url: shareUrl } : {}) });
        track('librarian.share_native');
        return 'Shared';
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') return '';
      }
    }
    const copied = await copyToClipboard(shareUrl || prompt);
    if (copied) {
      track('librarian.share_copy');
      return shareUrl ? 'Link copied' : 'Text copied';
    }
    return 'Could not copy';
  }

  async function copyPrompt(prompt: string) {
    const copied = await copyToClipboard(prompt);
    if (copied) {
      track('librarian.prompt_copy');
      return 'Prompt copied';
    }
    return 'Could not copy';
  }

  return {
    copyAnswerRichText,
    copyPrompt,
    saveFeedback,
    shareAnswer,
    sharePrompt,
    stopSpeaking,
    toggleSpeakAnswer
  };
}

export { createChatMessageActions };
