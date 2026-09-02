import { useEffect, useMemo, useState, type RefObject } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { AccountPanel } from '../AccountPanel.tsx';
import { Icon } from './Icon.tsx';
import { Tip } from './Tip.tsx';

export interface ConversationSummary {
  id: string;
  title: string;
  shared_at?: string;
  updated_at?: string;
}

// Claude-style time buckets for the recents list. Buckets are computed
// from updated_at against local midnight boundaries.
function timeGroups(conversations: ConversationSummary[]) {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterdayStart = todayStart - 24 * 60 * 60 * 1000;
  const weekStart = todayStart - 7 * 24 * 60 * 60 * 1000;
  const groups: Array<{ label: string; entries: ConversationSummary[] }> = [
    { label: 'Today', entries: [] },
    { label: 'Yesterday', entries: [] },
    { label: 'Previous 7 days', entries: [] },
    { label: 'Older', entries: [] }
  ];
  for (const entry of conversations) {
    const time = Date.parse(String(entry.updated_at || ''));
    const bucket = !Number.isFinite(time)
      ? 3
      : time >= todayStart
        ? 0
        : time >= yesterdayStart
          ? 1
          : time >= weekStart
            ? 2
            : 3;
    groups[bucket].entries.push(entry);
  }
  return groups.filter((group) => group.entries.length);
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
  onDelete,
  filterInputRef,
  onSearch
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
  filterInputRef?: RefObject<HTMLInputElement | null>;
  onSearch?: (query: string) => Promise<Array<{ conversation_id: string; snippet: string }>>;
}) {
  const [filter, setFilter] = useState('');
  // Full-content matches from the server (contract 4.5) as a query keyed
  // on the debounced needle: caching, stale-response handling, and
  // previous-results-while-typing come from TanStack Query.
  const [needle, setNeedle] = useState('');
  useEffect(() => {
    const timer = window.setTimeout(() => setNeedle(filter.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [filter]);
  const { data: searchMatches = [] } = useQuery({
    queryKey: ['conversation-search', needle],
    enabled: needle.length >= 2 && Boolean(onSearch),
    placeholderData: keepPreviousData,
    queryFn: () => onSearch!(needle)
  });
  const contentMatches = useMemo(() => {
    if (filter.trim().length < 2) return new Map<string, string>();
    return new Map(searchMatches.map((match) => [match.conversation_id, match.snippet]));
  }, [searchMatches, filter]);
  const groups = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const visible = needle
      ? conversations.filter((entry) => entry.title.toLowerCase().includes(needle) || contentMatches.has(entry.id))
      : conversations;
    return timeGroups(visible);
  }, [conversations, filter, contentMatches]);
  return (
    <nav className="rail thingy-aui-rail" aria-label="Conversations">
      <div className="thingy-aui-rail-head">
        <Tip label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          <button
            type="button"
            className="thingy-aui-collapse"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            onClick={onToggleCollapsed}
          >
            <Icon name="panel-left" />
          </button>
        </Tip>
        <img className="rail-mark" src="/img/thingy.png" alt="" width="1022" height="1022" />
        <button type="button" className="rail-newchat thingy-aui-newchat" onClick={onNew}>
          <Icon name="square-pen" /> {collapsed ? '' : 'New chat'}
        </button>
      </div>
      <div className="rail-body">
        {conversations.length > 0 ? (
          <div className="thingy-aui-rail-filter">
            <Icon name="search" />
            <input
              ref={filterInputRef}
              type="search"
              placeholder="Filter chats"
              aria-label="Filter conversations"
              value={filter}
              onChange={(event) => setFilter(event.currentTarget.value)}
            />
          </div>
        ) : null}
        {groups.length === 0 ? <p className="thingy-aui-rail-label">No matching chats</p> : null}
        {groups.map((group) => (
          <div key={group.label}>
            <p className="thingy-aui-rail-label">{group.label}</p>
            <ul className="thingy-aui-recents">
              {group.entries.map((entry) => (
                <li key={entry.id} className={entry.id === activeId ? 'is-active' : ''}>
                  <button type="button" className="thingy-aui-recent" onClick={() => onSelect(entry.id)}>
                    {entry.title}
                    {entry.shared_at ? (
                      <span className="thingy-aui-shared-dot" title="Shared" aria-label="Shared">
                        <Icon name="share" />
                      </span>
                    ) : null}
                    {filter.trim() && contentMatches.has(entry.id) ? (
                      <span className="thingy-aui-recent-snippet">{contentMatches.get(entry.id)}</span>
                    ) : null}
                  </button>
                  <span className="thingy-aui-recent-actions">
                    <Tip label={entry.shared_at ? 'Refresh share link' : 'Share'}>
                      <button
                        type="button"
                        aria-label="Share"
                        onClick={() => onShare(entry.id, Boolean(entry.shared_at))}
                      >
                        <Icon name="share" />
                      </button>
                    </Tip>
                    <Tip label="Rename">
                      <button type="button" aria-label="Rename" onClick={() => onRename(entry.id, entry.title)}>
                        <Icon name="pencil" />
                      </button>
                    </Tip>
                    <Tip label="Delete">
                      <button type="button" aria-label="Delete" onClick={() => onDelete(entry.id)}>
                        <Icon name="trash" />
                      </button>
                    </Tip>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="thingy-aui-rail-foot">
        <AccountPanel />
      </div>
    </nav>
  );
}
