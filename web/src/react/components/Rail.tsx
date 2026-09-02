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

const RAIL_ICON_BUTTON =
  'grid size-8 shrink-0 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-ink [&_svg]:size-4';

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
  onSearch,
  total = 0,
  onOpenHistory
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
  onSearch?: (query: string) => Promise<Array<{ conversation_id: string; snippet: string; title?: string }>>;
  total?: number;
  onOpenHistory?: () => void;
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
  // Matches beyond the rail's loaded window (contract 4.6 carries their
  // titles) render as their own group so deep history stays reachable.
  const historyMatches = useMemo(() => {
    if (filter.trim().length < 2) return [];
    const loaded = new Set(conversations.map((entry) => entry.id));
    return searchMatches.filter((match) => !loaded.has(match.conversation_id) && match.title);
  }, [searchMatches, filter, conversations]);
  const groups = useMemo(() => {
    const needleNow = filter.trim().toLowerCase();
    const visible = needleNow
      ? conversations.filter((entry) => entry.title.toLowerCase().includes(needleNow) || contentMatches.has(entry.id))
      : conversations;
    return timeGroups(visible);
  }, [conversations, filter, contentMatches]);
  return (
    <nav
      className="rail thingy-aui-rail flex h-full min-h-0 w-[280px] flex-col overflow-hidden border-r border-line-soft bg-surface"
      aria-label="Conversations"
    >
      <div className="flex items-center gap-2 px-3 pt-3 pb-2">
        <img className="rail-mark size-9 rounded-xl" src="/img/thingy.png" alt="" width="1022" height="1022" />
        <span className="flex-1 font-sans text-[15px] font-extrabold text-ink">Thingy</span>
        <Tip label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          <button
            type="button"
            className={RAIL_ICON_BUTTON}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            onClick={onToggleCollapsed}
          >
            <Icon name="panel-left" />
          </button>
        </Tip>
      </div>
      <div className="px-3 pb-1.5">
        <button
          type="button"
          className="thingy-aui-newchat flex w-full items-center gap-2 rounded-xl border border-line bg-bg px-3 py-2 font-sans text-sm font-bold text-ink transition-colors hover:border-accent hover:bg-accent-soft [&_svg]:size-4"
          onClick={onNew}
        >
          <Icon name="square-pen" /> New chat
        </button>
      </div>
      <div className="rail-body min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {conversations.length > 0 ? (
          <div className="mx-1 mt-1 mb-2 flex items-center gap-1.5 rounded-lg border border-line-soft bg-bg px-2.5 py-1.5 text-muted focus-within:border-accent [&_svg]:size-3.5 [&_svg]:shrink-0">
            <Icon name="search" />
            <input
              ref={filterInputRef}
              className="w-full min-w-0 bg-transparent font-sans text-[13px] text-ink outline-none placeholder:text-muted"
              type="search"
              placeholder="Filter chats"
              aria-label="Filter conversations"
              value={filter}
              onChange={(event) => setFilter(event.currentTarget.value)}
            />
          </div>
        ) : null}
        {groups.length === 0 ? (
          <p className="px-2 pt-2 font-sans text-xs font-semibold tracking-wide text-muted uppercase">
            No matching chats
          </p>
        ) : null}
        {historyMatches.length ? (
          <div>
            <p className="px-2 pt-3 pb-1 font-sans text-[11px] font-bold tracking-wider text-muted uppercase">
              From your history
            </p>
            <ul className="grid min-w-0 gap-0.5">
              {historyMatches.map((match) => (
                <li key={match.conversation_id} className="min-w-0 overflow-hidden rounded-lg hover:bg-surface-2">
                  <button
                    type="button"
                    className="block w-full truncate px-2.5 py-2 text-left font-sans text-[13.5px] text-ink"
                    onClick={() => onSelect(match.conversation_id)}
                  >
                    <span className="block truncate">{match.title}</span>
                    <span className="mt-0.5 block truncate text-[11.5px] text-muted">{match.snippet}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {groups.map((group) => (
          <div key={group.label}>
            <p className="px-2 pt-3 pb-1 font-sans text-[11px] font-bold tracking-wider text-muted uppercase">
              {group.label}
            </p>
            <ul className="thingy-aui-recents grid min-w-0 gap-0.5">
              {group.entries.map((entry) => (
                <li
                  key={entry.id}
                  className={`group/row relative min-w-0 overflow-hidden rounded-lg transition-colors ${
                    entry.id === activeId ? 'bg-accent-soft' : 'hover:bg-surface-2'
                  }`}
                >
                  <button
                    type="button"
                    className="thingy-aui-recent block w-full truncate px-2.5 py-2 text-left font-sans text-[13.5px] text-ink"
                    onClick={() => onSelect(entry.id)}
                  >
                    <span className="flex items-center gap-1.5">
                      <span className="min-w-0 flex-1 truncate">{entry.title}</span>
                      {entry.shared_at ? (
                        <span className="text-accent-deep [&_svg]:size-3" title="Shared" aria-label="Shared">
                          <Icon name="share" />
                        </span>
                      ) : null}
                    </span>
                    {filter.trim() && contentMatches.has(entry.id) ? (
                      <span className="mt-0.5 block truncate text-[11.5px] text-muted">
                        {contentMatches.get(entry.id)}
                      </span>
                    ) : null}
                  </button>
                  <span className="absolute top-1/2 right-1 hidden -translate-y-1/2 items-center gap-0 rounded-md bg-inherit group-focus-within/row:flex group-hover/row:flex">
                    <Tip label={entry.shared_at ? 'Refresh share link' : 'Share'}>
                      <button
                        type="button"
                        className="grid size-7 place-items-center rounded-md text-muted hover:bg-surface hover:text-ink [&_svg]:size-3.5"
                        aria-label="Share"
                        onClick={() => onShare(entry.id, Boolean(entry.shared_at))}
                      >
                        <Icon name="share" />
                      </button>
                    </Tip>
                    <Tip label="Rename">
                      <button
                        type="button"
                        className="grid size-7 place-items-center rounded-md text-muted hover:bg-surface hover:text-ink [&_svg]:size-3.5"
                        aria-label="Rename"
                        onClick={() => onRename(entry.id, entry.title)}
                      >
                        <Icon name="pencil" />
                      </button>
                    </Tip>
                    <Tip label="Delete">
                      <button
                        type="button"
                        className="grid size-7 place-items-center rounded-md text-muted hover:bg-surface hover:text-error [&_svg]:size-3.5"
                        aria-label="Delete"
                        onClick={() => onDelete(entry.id)}
                      >
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
      {onOpenHistory ? (
        <div className="px-2 pb-1">
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left font-sans text-[13px] font-bold text-muted transition-colors hover:bg-surface-2 hover:text-ink [&_svg]:size-4"
            onClick={onOpenHistory}
          >
            <Icon name="messages-square" />
            All chats{total ? ` · ${total}` : ''}
          </button>
        </div>
      ) : null}
      <div className="border-t border-line-soft p-2">
        <AccountPanel />
      </div>
    </nav>
  );
}
