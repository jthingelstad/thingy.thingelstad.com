import { iconSvg } from '../thingy-icons.ts';
import { modeClass, modeIcon } from '../thingy-modes.ts';
import { activeConversationId, availableModes, conversations } from '../stores/chat-store.ts';

const DEFAULT_MAX_RECENTS = 20;
const EMPTY_LABEL = 'Your conversations sync with Thingy. Start one and it’ll show up here.';

interface RailRecentsProps {
  maxRecents?: number;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}

interface RecentRowProps extends Pick<RailRecentsProps, 'onOpen' | 'onDelete'> {
  entry: ThingyConversationSummary;
  modes: ThingyMode[];
  isActive: boolean;
}

function labelForMode(modes: ThingyMode[], id: string) {
  return modes.find((mode) => mode.id === id)?.label || 'Thingy';
}

function RecentRow({ entry, modes, isActive, onOpen, onDelete }: RecentRowProps) {
  const id = String(entry.id || '');
  const title = entry.title || 'Untitled chat';
  const showMode = Boolean(entry.mode && entry.mode !== 'thingy');
  const modeText = showMode ? labelForMode(modes, entry.mode || 'thingy') : '';
  const rowClass = ['rail-recent', isActive ? 'is-active' : '', showMode ? 'has-mode' : ''].filter(Boolean).join(' ');
  const buttonTitle = showMode ? `${title} - ${modeText}` : title;
  return (
    <div class={rowClass} data-mode={showMode ? modeClass(entry.mode) : undefined} role="listitem">
      <button
        type="button"
        class="rail-recent-open"
        title={buttonTitle}
        aria-current={isActive ? 'true' : undefined}
        onClick={() => onOpen?.(id)}
      >
        <span class="rail-recent-title">{title}</span>
        {showMode ? (
          <small
            class="rail-recent-mode"
            aria-label={modeText}
            title={modeText}
            dangerouslySetInnerHTML={{ __html: iconSvg(modeIcon(entry.mode)) }}
          />
        ) : null}
      </button>
      <button
        type="button"
        class="rail-recent-del"
        aria-label="Delete conversation"
        title="Delete conversation"
        onClick={() => onDelete?.(id)}
        dangerouslySetInnerHTML={{ __html: iconSvg('x') }}
      />
    </div>
  );
}

function RailRecents({ maxRecents = DEFAULT_MAX_RECENTS, onOpen, onDelete }: RailRecentsProps) {
  const list = conversations.value.filter((entry) => entry && entry.id).slice(0, maxRecents);
  const modes = availableModes.value;
  const activeId = activeConversationId.value;

  if (!list.length) {
    return <p class="rail-empty">{EMPTY_LABEL}</p>;
  }

  return (
    <div class="rail-recents" role="list">
      {list.map((entry) => (
        <RecentRow
          key={String(entry.id)}
          entry={entry}
          modes={modes}
          isActive={entry.id === activeId}
          onOpen={onOpen}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}

export { RailRecents };
