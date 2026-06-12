import { render } from 'preact';
import { dispatchActions } from '../stores/dispatch-store.js';

function DispatchActions({ onAction }) {
  const items = dispatchActions.value;
  if (!items.length) return null;
  return (
    <div class="dispatch-actions">
      {items.map((item) => {
        if (item.kind === 'link') {
          return (
            <a key={item.id} class="dispatch-action-secondary" href={item.href} target="_blank" rel="noopener">
              {item.label}
            </a>
          );
        }
        const cls = item.kind === 'secondary' ? 'dispatch-action-secondary' : 'dispatch-action-primary';
        return (
          <button key={item.id} type="button" class={cls} onClick={() => onAction?.(item.id)}>
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

function mountDispatchActions(host, props = {}) {
  if (!host) return () => {};
  render(<DispatchActions {...props} />, host);
  return () => render(null, host);
}

export { DispatchActions, mountDispatchActions };
