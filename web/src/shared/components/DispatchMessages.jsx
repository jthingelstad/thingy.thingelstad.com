import { render } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { renderMarkdown } from '../thingy-markdown.js';
import { dispatchMessages } from '../stores/chat-store.js';

function DispatchMessage({ message }) {
  const role = message.role === 'user' ? 'user' : message.role === 'system' ? 'system' : 'assistant';
  const html = renderMarkdown(message.text || '');
  return (
    <article
      class={`librarian-message librarian-message-${role} dispatch-message`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function DispatchMessages({ scrollContainer }) {
  const messages = dispatchMessages.value;
  const ref = useRef(null);

  useEffect(() => {
    const scroll = scrollContainer && scrollContainer();
    if (scroll) scroll.scrollTop = scroll.scrollHeight;
  });

  return (
    <div ref={ref} class="dispatch-messages-list">
      {messages.map((message, index) => (
        <DispatchMessage key={String(message.id || index)} message={message} />
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
