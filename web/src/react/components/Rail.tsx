import { AccountPanel } from '../AccountPanel.tsx';
import { Icon } from './Icon.tsx';

export interface ConversationSummary {
  id: string;
  title: string;
  shared_at?: string;
  updated_at?: string;
}

export function Rail({
  collapsed,
  onToggleCollapsed,
  conversations,
  activeId,
  onSelect,
  onNew,
  onShare,
  onRename,
  onDelete
}: {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  conversations: ConversationSummary[];
  activeId: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  onShare: (id: string, shared: boolean) => void;
  onRename: (id: string, current: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <nav className="rail thingy-aui-rail" aria-label="Conversations">
      <div className="thingy-aui-rail-head">
        <button
          type="button"
          className="thingy-aui-collapse"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          onClick={onToggleCollapsed}
        >
          <Icon name="panel-left" />
        </button>
        <img className="rail-mark" src="/img/thingy.png" alt="" width="1022" height="1022" />
        <button type="button" className="rail-newchat thingy-aui-newchat" onClick={onNew}>
          <Icon name="pencil" /> {collapsed ? '' : 'New chat'}
        </button>
      </div>
      <div className="rail-body">
        <p className="thingy-aui-rail-label">Recents</p>
        <ul className="thingy-aui-recents">
          {conversations.map((entry) => (
            <li key={entry.id} className={entry.id === activeId ? 'is-active' : ''}>
              <button type="button" className="thingy-aui-recent" onClick={() => onSelect(entry.id)}>
                {entry.title}
                {entry.shared_at ? (
                  <span className="thingy-aui-shared-dot" title="Shared" aria-label="Shared">
                    <Icon name="share" />
                  </span>
                ) : null}
              </button>
              <span className="thingy-aui-recent-actions">
                <button
                  type="button"
                  title={entry.shared_at ? 'Refresh share link' : 'Share'}
                  aria-label="Share"
                  onClick={() => onShare(entry.id, Boolean(entry.shared_at))}
                >
                  <Icon name="share" />
                </button>
                <button
                  type="button"
                  title="Rename"
                  aria-label="Rename"
                  onClick={() => onRename(entry.id, entry.title)}
                >
                  <Icon name="pencil" />
                </button>
                <button type="button" title="Delete" aria-label="Delete" onClick={() => onDelete(entry.id)}>
                  <Icon name="trash" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div className="thingy-aui-rail-foot">
        <AccountPanel />
      </div>
    </nav>
  );
}
