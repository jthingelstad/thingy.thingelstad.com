import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { createChatMessageActions } from '../thingy-message-actions.ts';
import { iconSvg } from '../thingy-icons.ts';
import { renderMarkdown } from '../thingy-markdown.ts';
import { formatElapsedTime } from '../models/assistant-message.ts';
import { dispatchMessages } from '../stores/dispatch-store.ts';

interface DispatchMessagesProps {
  scrollContainer: () => HTMLElement | null;
  track?: (name: string, value?: string) => void;
}

function splitProgressHtml(html: unknown) {
  const value = String(html || '').trim();
  const match = value.match(/^(<p>[\s\S]*?<\/p>)([\s\S]*)$/);
  if (!match) return { lead: value, rest: '' };
  return { lead: match[1], rest: match[2] || '' };
}

function DispatchMessage({
  message,
  index,
  elapsedLabel = ''
}: {
  message: ThingyDispatchMessage;
  index: number;
  elapsedLabel?: string;
}) {
  const role = message.role === 'user' ? 'user' : message.role === 'system' ? 'system' : 'assistant';
  const html = renderMarkdown(message.text || '');
  const kind = message.kind ? ` is-${String(message.kind).replace(/[^a-z0-9_-]/gi, '')}` : '';
  const status = String(message.status || '').trim();
  const statusIcon =
    status === 'complete'
      ? 'check'
      : status === 'failed'
        ? 'triangle-alert'
        : status === 'waiting'
          ? 'circle-help'
          : 'loader-circle';
  if (message.kind === 'progress') {
    const parts = splitProgressHtml(html);
    return (
      <article
        class={`librarian-message librarian-message-${role} dispatch-message${kind}`}
        data-dispatch-message-index={index}
        data-dispatch-message-role={role}
        data-dispatch-message-kind={message.kind || ''}
        data-dispatch-message-status={status}
      >
        <span
          class="dispatch-message-progress-icon"
          aria-hidden="true"
          dangerouslySetInnerHTML={{ __html: iconSvg(statusIcon) }}
        />
        <div class="dispatch-message-progress-body">
          <div class="dispatch-message-progress-line">
            <div class="dispatch-message-progress-lead" dangerouslySetInnerHTML={{ __html: parts.lead }} />
            {elapsedLabel ? (
              <span class="librarian-elapsed dispatch-message-progress-elapsed">{elapsedLabel}</span>
            ) : null}
          </div>
          {parts.rest ? (
            <div class="dispatch-message-progress-detail" dangerouslySetInnerHTML={{ __html: parts.rest }} />
          ) : null}
        </div>
      </article>
    );
  }
  return (
    <article
      class={`librarian-message librarian-message-${role} dispatch-message${kind}`}
      data-dispatch-message-index={index}
      data-dispatch-message-role={role}
      data-dispatch-message-kind={message.kind || ''}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function DispatchMessages({ scrollContainer, track = (_name: string, _value?: string) => {} }: DispatchMessagesProps) {
  const messages = dispatchMessages.value;
  const ref = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<ReturnType<typeof createChatMessageActions> | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  if (!actionsRef.current) {
    actionsRef.current = createChatMessageActions({
      promptShareTitle: 'Thingy Dispatch',
      promptShareUrl: () => '',
      track
    });
  }

  useEffect(() => {
    const root = ref.current;
    const actions = actionsRef.current;
    if (root && actions) {
      root.querySelectorAll<HTMLElement>('[data-dispatch-message-index]').forEach((element) => {
        if (element.dataset.dispatchActionsAttached === 'true') return;
        const message = messages[Number(element.dataset.dispatchMessageIndex || -1)];
        if (!message) return;
        const role = element.dataset.dispatchMessageRole || '';
        const kind = element.dataset.dispatchMessageKind || '';
        if (role === 'user') {
          actions.addPromptActions(element, message.text || '', 'dispatch');
          element.dataset.dispatchActionsAttached = 'true';
        } else if (role === 'assistant' && kind !== 'progress') {
          actions.addResponseActions(element, '', { feedback: false });
          element.dataset.dispatchActionsAttached = 'true';
        }
      });
    }
    const scroll = scrollContainer && scrollContainer();
    if (scroll) scroll.scrollTop = scroll.scrollHeight;
  }, [messages, scrollContainer]);

  const activeProgressIndex = messages.reduce(
    (latest, message, index) =>
      message.kind === 'progress' && String(message.status || 'pending') === 'pending' ? index : latest,
    -1
  );

  useEffect(() => {
    if (activeProgressIndex < 0) return undefined;
    const tick = () => setNowMs(Date.now());
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [activeProgressIndex]);

  return (
    <div ref={ref} class="dispatch-messages-list">
      {messages.map((message, index) => {
        const startedAt = Number(message.startedAt || 0);
        const elapsedLabel =
          index === activeProgressIndex && startedAt ? formatElapsedTime((nowMs - startedAt) / 1000) : '';
        return (
          <DispatchMessage
            key={String(message.id || index)}
            message={message}
            index={index}
            elapsedLabel={elapsedLabel}
          />
        );
      })}
    </div>
  );
}

function mountDispatchMessages(host: HTMLElement | null, props: DispatchMessagesProps) {
  if (!host) return () => {};
  render(<DispatchMessages {...props} />, host);
  return () => render(null, host);
}

export { DispatchMessages, mountDispatchMessages, splitProgressHtml };
