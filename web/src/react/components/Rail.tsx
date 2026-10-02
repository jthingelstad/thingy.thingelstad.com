import { useEffect, useMemo, useState, type RefObject } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { AccountPanel } from '../AccountPanel.tsx';
import { Icon } from './Icon.tsx';
import { Tip } from './Tip.tsx';
import { RowActions } from './RowActions.tsx';
import { HistoryStatus } from './HistoryStatus.tsx';
import { ThingyFace } from './ThingyFace.tsx';

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

// The navy rail (Felt & Tangerine): cream text on ink, mono group
// eyebrows, 44px rows, the tangerine New chat pill. Row actions
// (RowActions.tsx) reveal on hover/focus, or behind "More actions" on touch.
// Colours ride the --thingy-rail-* tokens (contrast notes in
// thingy-base.css); .thingy-rail scopes the light focus ring.
const RAIL_ICON_BUTTON =
  'grid size-11 shrink-0 place-items-center rounded-xl text-rail-icon transition-colors hover:bg-rail-raised hover:text-white [&_svg]:size-5';

const RAIL_EYEBROW = 'px-3 font-mono text-[11px] font-semibold tracking-[0.14em] text-rail-muted uppercase';

export function Rail({
  collapsed,
  onToggleCollapsed,
  conversations,
  loading = false,
  error = null,
  onRetry = () => {},
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
  loading?: boolean;
  error?: Error | null;
  onRetry?: () => void;
  activeId: string;
  onSelect: (id: string, title?: string) => void;
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
  const searchQuery = useQuery({
    queryKey: ['conversation-search', needle],
    enabled: needle.length >= 2 && Boolean(onSearch),
    placeholderData: keepPreviousData,
    queryFn: () => onSearch!(needle)
  });
  const { data: searchMatches = [] } = searchQuery;
  const searching = filter.trim().length >= 2 && Boolean(onSearch);
  const searchPending = searching && (needle !== filter.trim() || searchQuery.isPending);
  const historyError = error || (searching ? searchQuery.error : null);
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
      className="rail thingy-aui-rail thingy-rail flex h-full min-h-0 w-[288px] flex-col gap-3 overflow-hidden border-r-2 border-rail-deep bg-rail px-3 pt-3 pb-3.5 text-bg md:w-[280px] md:px-4 md:pt-5"
      aria-label="Conversations"
    >
      <div className="flex items-center gap-3 pl-1">
        <ThingyFace className="rail-mark" size={40} />
        <span className="thingy-display flex-1 text-[22px] leading-none">Thingy</span>
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
      <button
        type="button"
        className="thingy-aui-newchat thingy-btn thingy-btn-primary thingy-btn-on-rail w-full shrink-0 [&_svg]:size-[18px]"
        onClick={onNew}
      >
        <Icon name="square-pen" /> New chat
      </button>
      {conversations.length > 0 ? (
        <label className="thingy-rail-search flex min-h-11 shrink-0 items-center gap-2.5 rounded-xl border-2 border-rail-field-border bg-rail-raised px-3.5 text-rail-field [&_svg]:size-4 [&_svg]:shrink-0">
          <Icon name="search" />
          <input
            ref={filterInputRef}
            className="min-h-10 w-full min-w-0 bg-transparent font-sans text-base text-bg outline-none placeholder:text-rail-field"
            type="search"
            placeholder="Search chats"
            aria-label="Search conversations"
            value={filter}
            onChange={(event) => setFilter(event.currentTarget.value)}
          />
        </label>
      ) : null}
      <div className="rail-body -mx-1 min-h-0 flex-1 overflow-y-auto px-1">
        {historyError ? (
          <HistoryStatus error={historyError} retry={error ? onRetry : () => void searchQuery.refetch()} onRail />
        ) : loading || searchPending ? (
          <p role="status" className={`${RAIL_EYEBROW} pt-2.5`}>
            Loading chats…
          </p>
        ) : groups.length === 0 && historyMatches.length === 0 ? (
          <p className={`${RAIL_EYEBROW} pt-2.5`}>{filter.trim() ? 'No matching chats' : 'No conversations yet.'}</p>
        ) : null}
        {historyMatches.length ? (
          <div>
            <p className={`${RAIL_EYEBROW} mt-2.5 mb-1`}>From your history</p>
            <ul className="grid min-w-0 gap-0.5">
              {historyMatches.map((match) => (
                <li
                  key={match.conversation_id}
                  className="min-w-0 overflow-hidden rounded-xl text-rail-text transition-colors hover:bg-rail-raised hover:text-white"
                >
                  <button
                    type="button"
                    className="block min-h-11 w-full truncate px-3 py-2 text-left font-sans text-[15px]"
                    onClick={() => onSelect(match.conversation_id, match.title)}
                  >
                    <span className="block truncate">{match.title}</span>
                    <span className="mt-0.5 block truncate text-[12px] text-rail-field">{match.snippet}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {groups.map((group) => (
          <div key={group.label}>
            <p className={`${RAIL_EYEBROW} mt-2.5 mb-1`}>{group.label}</p>
            <ul className="thingy-aui-recents grid min-w-0 gap-0.5">
              {group.entries.map((entry) => {
                const active = entry.id === activeId;
                return (
                  <li
                    key={entry.id}
                    className={`thingy-row relative flex min-w-0 items-center overflow-hidden rounded-xl transition-colors ${
                      active
                        ? 'bg-rail-active font-bold text-white'
                        : 'text-rail-text hover:bg-rail-raised hover:text-white'
                    }`}
                  >
                    <button
                      type="button"
                      className="thingy-aui-recent block min-h-11 min-w-0 flex-1 truncate px-3 py-2.5 text-left font-sans text-[15px]"
                      aria-current={active ? 'true' : undefined}
                      onClick={() => onSelect(entry.id, entry.title)}
                    >
                      <span className="flex items-center gap-2.5">
                        {active ? (
                          <span className="size-2 shrink-0 rounded-full bg-tangerine" aria-hidden="true" />
                        ) : null}
                        <span className="min-w-0 flex-1 truncate">{entry.title}</span>
                        {entry.shared_at ? (
                          <span
                            className="shrink-0 text-[#f2a27a] [&_svg]:size-3.5"
                            role="img"
                            title="Shared"
                            aria-label="Shared"
                          >
                            <Icon name="share" />
                          </span>
                        ) : null}
                      </span>
                      {filter.trim() && contentMatches.has(entry.id) ? (
                        <span className="mt-0.5 block truncate text-[12px] font-normal text-rail-field">
                          {contentMatches.get(entry.id)}
                        </span>
                      ) : null}
                    </button>
                    <RowActions
                      variant="rail"
                      title={entry.title}
                      updatedAt={entry.updated_at}
                      shared={Boolean(entry.shared_at)}
                      onShare={() => onShare(entry.id, Boolean(entry.shared_at))}
                      onRename={() => onRename(entry.id, entry.title)}
                      onDelete={() => onDelete(entry.id)}
                    />
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      {onOpenHistory ? (
        <button
          type="button"
          className="flex min-h-11 w-full shrink-0 items-center gap-2.5 rounded-xl px-3 text-left font-sans text-[15px] font-bold text-rail-icon transition-colors hover:bg-rail-raised hover:text-white [&_svg]:size-[18px]"
          onClick={onOpenHistory}
        >
          <Icon name="messages-square" />
          All chats{total ? ` · ${total}` : ''}
        </button>
      ) : null}
      <div className="shrink-0 border-t-2 border-dashed border-rail-rule pt-2.5">
        <AccountPanel />
      </div>
    </nav>
  );
}
