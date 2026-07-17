import { render } from 'preact';
import { iconSvg } from '../thingy-icons.ts';
import { stageIcon, stageLabel } from '../thingy-dispatch-drafts.ts';
import { activeDraftId, drafts } from '../stores/dispatch-store.ts';

const EMPTY_LABEL = "Your Dispatches show up here. Start a new one and we'll keep track of it.";

function safeStateClass(value) {
  return String(value || '').replace(/[^a-z0-9_-]/gi, '');
}

function DispatchRow({ draft, isActive, onOpen, onDelete }) {
  const id = String(draft.id || '');
  const title = draft.title || 'New Dispatch';
  const stage = draft.stage || '';
  const stateClass = stage ? `is-${safeStateClass(stage)}` : '';
  const rowClass = ['rail-recent', 'dispatch-rail-item', 'has-mode', isActive ? 'is-active' : '', stateClass]
    .filter(Boolean)
    .join(' ');
  const metaText = stageLabel(stage);
  return (
    <div class={rowClass} role="listitem">
      <button
        type="button"
        class="rail-recent-open"
        title={title}
        aria-current={isActive ? 'true' : undefined}
        onClick={() => onOpen?.(id)}
      >
        <span class="rail-recent-title">{title}</span>
        <span
          class="dispatch-state-glyph"
          aria-label={metaText}
          title={metaText}
          dangerouslySetInnerHTML={{ __html: iconSvg(stageIcon(stage)) }}
        />
      </button>
      <button
        type="button"
        class="rail-recent-del"
        data-action="delete-dispatch"
        aria-label="Delete Dispatch"
        title="Delete Dispatch"
        onClick={() => onDelete?.(id)}
        dangerouslySetInnerHTML={{ __html: iconSvg('x') }}
      />
    </div>
  );
}

function DispatchRecents({ onOpen, onDelete, maxRecents = 24 }) {
  const list = drafts.value.filter((draft) => draft && draft.id).slice(0, maxRecents);
  const activeId = activeDraftId.value;
  if (!list.length) {
    return <p class="rail-empty">{EMPTY_LABEL}</p>;
  }
  return (
    <div class="rail-recents" role="list">
      {list.map((draft) => (
        <DispatchRow
          key={String(draft.id)}
          draft={draft}
          isActive={draft.id === activeId}
          onOpen={onOpen}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}

function mountDispatchRecents(host, props: Parameters<typeof DispatchRecents>[0]) {
  if (!host) return () => {};
  render(<DispatchRecents {...props} />, host);
  return () => render(null, host);
}

export { DispatchRecents, mountDispatchRecents };
