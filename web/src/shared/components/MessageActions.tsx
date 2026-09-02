import { useEffect, useRef, useState } from 'preact/hooks';
import { createChatMessageActions } from '../thingy-message-actions.ts';
import { promptDialog } from '../stores/dialog-store.ts';
import { iconSvg } from '../thingy-icons.ts';

type MessageActionKind = 'copy' | 'retry' | 'share' | 'up' | 'down';

interface FeedbackInput {
  requestId: string;
  reaction: string;
  comment: string;
}

interface FeedbackResult {
  reaction?: string;
}

interface MessageActionsProps {
  role: 'prompt' | 'response';
  prompt?: string;
  requestId?: string;
  feedback?: boolean;
  retryPrompt?: string;
  onRetry?: (prompt: string) => void;
  submitFeedback?: (input: FeedbackInput) => Promise<FeedbackResult>;
  track?: (name: string, value?: string) => void;
}

function ActionIcon({ name }: { name: MessageActionKind }) {
  const iconName = {
    copy: 'copy',
    retry: 'rotate-ccw',
    share: 'share',
    up: 'thumbs-up',
    down: 'thumbs-down'
  }[name];
  return <span aria-hidden="true" dangerouslySetInnerHTML={{ __html: iconSvg(iconName) }} />;
}

function MessageActions({
  role,
  prompt = '',
  requestId = '',
  feedback = true,
  retryPrompt = '',
  onRetry,
  submitFeedback,
  track = (_name: string, _value?: string) => {}
}: MessageActionsProps) {
  const controlsRef = useRef<HTMLDivElement>(null);
  const serviceRef = useRef<ReturnType<typeof createChatMessageActions> | null>(null);
  const statusTimerRef = useRef(0);
  const [status, setStatus] = useState('');
  const [reaction, setReaction] = useState('');
  const [saving, setSaving] = useState(false);

  if (!serviceRef.current) {
    serviceRef.current = createChatMessageActions({
      submitFeedback,
      track
    });
  }

  function messageElement() {
    return controlsRef.current?.closest<HTMLElement>('.librarian-message') || null;
  }

  function flash(message: string) {
    if (!message) return;
    setStatus(message);
    window.clearTimeout(statusTimerRef.current);
    statusTimerRef.current = window.setTimeout(() => setStatus(''), 1800);
  }

  useEffect(
    () => () => {
      window.clearTimeout(statusTimerRef.current);
    },
    []
  );

  async function handlePromptAction(action: 'copy' | 'share') {
    const service = serviceRef.current;
    if (!service) return;
    flash(action === 'copy' ? await service.copyPrompt(prompt) : await service.sharePrompt(prompt));
  }

  async function handleResponseAction(action: 'copy' | 'share') {
    const service = serviceRef.current;
    const element = messageElement();
    if (!service || !element) return;
    if (action === 'copy') {
      const message = await service.copyAnswerRichText(element);
      flash(message);
      track(
        'librarian.answer_copy',
        message === 'Rich text copied' ? 'rich' : message === 'Text copied' ? 'plain' : 'error'
      );
      return;
    }
    if (action === 'share') {
      const message = await service.shareAnswer(element);
      flash(message);
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
      return;
    }
  }

  async function handleReaction(nextReaction: 'up' | 'down') {
    if (!requestId || saving || reaction === nextReaction) return;
    let comment = '';
    if (nextReaction === 'down') {
      const value = await promptDialog({
        title: 'What went wrong?',
        body: 'Optional, but it helps Jamie tune Thingy.',
        multiline: true,
        maxLength: 1000,
        confirmLabel: 'Send feedback'
      });
      if (value === null) return;
      comment = value.trim().slice(0, 1000);
    }
    const service = serviceRef.current;
    if (!service) return;
    setSaving(true);
    setStatus('Saving...');
    try {
      const data = await service.saveFeedback(requestId, nextReaction, comment);
      setReaction(data?.reaction || nextReaction);
      flash('Saved');
    } catch (_error) {
      setStatus('Could not save');
    } finally {
      setSaving(false);
    }
  }

  if (role === 'prompt') {
    if (!prompt) return null;
    return (
      <div ref={controlsRef} class="librarian-prompt-actions">
        <button type="button" aria-label="Copy prompt" title="Copy prompt" onClick={() => handlePromptAction('copy')}>
          <ActionIcon name="copy" />
        </button>
        <button
          type="button"
          aria-label="Share prompt"
          title="Share prompt"
          onClick={() => handlePromptAction('share')}
        >
          <ActionIcon name="share" />
        </button>
        <span class="librarian-feedback-status" aria-live="polite">
          {status}
        </span>
      </div>
    );
  }

  const includeFeedback = feedback && Boolean(requestId);
  return (
    <div ref={controlsRef} class="librarian-feedback">
      <button type="button" aria-label="Copy answer" title="Copy answer" onClick={() => handleResponseAction('copy')}>
        <ActionIcon name="copy" />
      </button>
      {includeFeedback ? (
        <button
          type="button"
          class={reaction === 'up' ? 'selected' : undefined}
          disabled={saving}
          aria-label="Good response"
          aria-pressed={reaction === 'up'}
          title="Good response"
          onClick={() => handleReaction('up')}
        >
          <ActionIcon name="up" />
        </button>
      ) : null}
      {includeFeedback ? (
        <button
          type="button"
          class={reaction === 'down' ? 'selected' : undefined}
          disabled={saving}
          aria-label="Bad response"
          aria-pressed={reaction === 'down'}
          title="Bad response"
          onClick={() => handleReaction('down')}
        >
          <ActionIcon name="down" />
        </button>
      ) : null}
      <button
        type="button"
        aria-label="Share answer"
        title="Share answer"
        onClick={() => handleResponseAction('share')}
      >
        <ActionIcon name="share" />
      </button>
      {retryPrompt ? (
        <button type="button" aria-label="Retry answer" title="Retry answer" onClick={() => onRetry?.(retryPrompt)}>
          <ActionIcon name="retry" />
        </button>
      ) : null}
      <span class="librarian-feedback-status" aria-live="polite">
        {status}
      </span>
    </div>
  );
}

export { MessageActions };
