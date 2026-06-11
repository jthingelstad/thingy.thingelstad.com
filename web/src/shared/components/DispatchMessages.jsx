import { render } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { createChatMessageActions } from '../thingy-message-actions.js';
import { iconSvg } from '../thingy-icons.js';
import { renderMarkdown } from '../thingy-markdown.js';
import { dispatchMessages } from '../stores/dispatch-store.js';

function DispatchMessage({ message, index }) {
  const role = message.role === 'user' ? 'user' : message.role === 'system' ? 'system' : 'assistant';
  const html = renderMarkdown(message.text || '');
  const kind = message.kind ? ` is-${String(message.kind).replace(/[^a-z0-9_-]/gi, '')}` : '';
  const status = String(message.status || '').trim();
  const statusIcon = status === 'complete' ? 'check' : status === 'failed' ? 'triangle-alert' : status === 'waiting' ? 'circle-help' : 'loader-circle';
  if (message.kind === 'progress') {
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
        <div class="dispatch-message-progress-body" dangerouslySetInnerHTML={{ __html: html }} />
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

function DispatchMessages({ scrollContainer, track = () => {} }) {
  const messages = dispatchMessages.value;
  const ref = useRef(null);
  const actionsRef = useRef(null);
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
      root.querySelectorAll('[data-dispatch-message-index]').forEach((element) => {
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

  return (
    <div ref={ref} class="dispatch-messages-list">
      {messages.map((message, index) => (
        <DispatchMessage key={String(message.id || index)} message={message} index={index} />
      ))}
    </div>
  );
}

function mountDispatchMessages(host, props = {}) {
  if (!host) return () => {};
  render(<DispatchMessages {...props} />, host);
  return () => render(null, host);
}

export { DispatchMessages, mountDispatchMessages };
