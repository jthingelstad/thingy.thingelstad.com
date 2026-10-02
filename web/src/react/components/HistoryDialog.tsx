// The All-chats browser (contract 4.6): full conversation history with
// search, paged 50 at a time. Deliberate UX split: the RAIL stays a
// bounded working set (recent 50 + filter), THIS dialog owns depth -
// pagination and full-history search - and the profile modal stays
// account facts. Opened from the rail's "All chats" row.
//
// Felt & Tangerine (phase 3): one flat list - no time groups, no shortcut
// hint (Jamie 2026-10-01) - a labelled search field, mono dates, face
// states, and row actions that reveal on hover or sit behind "More
// actions" on touch. Below md it is a bottom sheet.

import { useEffect, useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Icon } from './Icon.tsx';
import type { ConversationSummary } from './Rail.tsx';
import { HistoryStatus } from './HistoryStatus.tsx';
import { RowActions, shortDate } from './RowActions.tsx';
import { DialogHeader, SHEET_CONTENT, SHEET_OVERLAY, SheetGrab } from './Sheet.tsx';
import { ThingyFace } from './ThingyFace.tsx';

export interface HistoryMatch {
  conversation_id: string;
  snippet: string;
  title: string;
  updated_at: string;
}

export function HistoryDialog({
  open,
  onClose,
  onSelect,
  onShare,
  onRename,
  onDelete,
  listPage,
  search
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (id: string, title: string) => void;
  onShare: (id: string, shared: boolean) => void;
  onRename: (id: string, current: string) => void;
  onDelete: (id: string) => void;
  listPage: (offset: number) => Promise<{ conversations: ConversationSummary[]; total: number }>;
  search: (query: string) => Promise<HistoryMatch[]>;
}) {
  const [filter, setFilter] = useState('');
  const [needle, setNeedle] = useState('');
  useEffect(() => {
    const timer = window.setTimeout(() => setNeedle(filter.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [filter]);
  const searching = needle.length >= 2;

  const pages = useInfiniteQuery({
    queryKey: ['conversations-all'],
    enabled: open,
    initialPageParam: 0,
    queryFn: ({ pageParam }) => listPage(pageParam),
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((sum, page) => sum + page.conversations.length, 0);
      return loaded < lastPage.total ? loaded : undefined;
    }
  });
  const searchQuery = useQuery({
    queryKey: ['conversation-search', needle],
    enabled: open && searching,
    placeholderData: keepPreviousData,
    queryFn: () => search(needle)
  });
  const { data: matches = [] } = searchQuery;
  const historyError = searching ? searchQuery.error : pages.error;
  const pending = searching ? searchQuery.isPending : pages.isPending;

  const rows = useMemo(() => {
    if (searching) {
      // The search contract doesn't carry shared_at; cross-reference the
      // loaded pages so already-shared conversations don't present the
      // first-time "Share" affordance (refreshing a link is a different
      // act than creating a new exposure).
      const sharedById = new Map(
        (pages.data?.pages || []).flatMap((page) => page.conversations.map((entry) => [entry.id, entry.shared_at]))
      );
      return matches.map((match) => ({
        id: match.conversation_id,
        title: match.title || 'Untitled chat',
        updated_at: match.updated_at,
        snippet: match.snippet,
        shared_at: sharedById.get(match.conversation_id) || ''
      }));
    }
    return (pages.data?.pages || []).flatMap((page) => page.conversations.map((entry) => ({ ...entry, snippet: '' })));
  }, [searching, matches, pages.data]);
  const total = pages.data?.pages[0]?.total ?? 0;

  if (!open) return null;
  return (
    <Dialog.Root open onOpenChange={(next) => (next ? undefined : onClose())}>
      <Dialog.Portal>
        <Dialog.Overlay className={SHEET_OVERLAY}>
          <Dialog.Content
            className={`thingy-history ${SHEET_CONTENT} max-h-[min(720px,calc(100vh-40px))] w-[min(45rem,100%)] max-md:h-[calc(100dvh-1rem)]`}
            aria-describedby={undefined}
          >
            <div className="border-b-2 border-dashed border-rule px-5 pt-5 pb-4 max-md:px-4 max-md:pt-1">
              <SheetGrab />
              <DialogHeader
                title="All chats"
                titleClassName="text-[28px] max-md:text-[24px]"
                subtitle={total ? <span className="font-mono text-[13px]">{`${total} total`}</span> : null}
                mark={{ icon: 'history' }}
              />
              <label htmlFor="thingy-history-search" className="sr-only">
                Search all conversations
              </label>
              <div className="mt-4 flex min-h-12 items-center gap-2.5 rounded-[14px] border-2 border-ink bg-paper px-3.5 text-meta focus-within:outline-3 focus-within:outline-offset-2 focus-within:outline-weekly [&_svg]:size-[18px] [&_svg]:shrink-0">
                <Icon name="search" />
                <input
                  id="thingy-history-search"
                  className="min-h-11 w-full min-w-0 bg-transparent text-base text-ink outline-none placeholder:text-meta"
                  type="search"
                  placeholder="Search all conversations"
                  autoFocus
                  value={filter}
                  onChange={(event) => setFilter(event.currentTarget.value)}
                />
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 pt-2 pb-4 max-md:pb-[calc(1rem+env(safe-area-inset-bottom))]">
              {historyError ? (
                <HistoryStatus
                  error={historyError}
                  retry={() => void (searching ? searchQuery.refetch() : pages.refetch())}
                />
              ) : rows.length === 0 ? (
                <div className="thingy-history-empty grid justify-items-center gap-3 px-4 py-10 text-center">
                  <ThingyFace mood={pending ? 'thinking' : 'idle'} size={72} />
                  <p className="text-[15px] text-ink" role={pending ? 'status' : undefined}>
                    {pending ? 'Loading…' : searching ? 'No conversations match.' : 'No conversations yet.'}
                  </p>
                </div>
              ) : null}
              <ul className="grid gap-1">
                {rows.map((entry) => (
                  <li
                    key={entry.id}
                    className="thingy-row relative flex min-w-0 items-center overflow-hidden rounded-[14px] transition-colors hover:bg-toy focus-within:bg-toy"
                  >
                    <button
                      type="button"
                      className="block min-h-[52px] min-w-0 flex-1 px-3 py-2.5 text-left max-md:min-h-[60px]"
                      onClick={() => {
                        onSelect(entry.id, entry.title);
                        onClose();
                      }}
                    >
                      <span className="flex items-baseline gap-3 max-md:flex-col max-md:gap-0.5">
                        <span className="flex min-w-0 flex-1 items-center gap-2 max-md:w-full">
                          <span className="min-w-0 truncate text-base font-semibold text-ink">{entry.title}</span>
                          {entry.shared_at ? (
                            <span
                              className="shrink-0 text-clay-hover [&_svg]:size-3.5"
                              role="img"
                              title="Shared"
                              aria-label="Shared"
                            >
                              <Icon name="share" />
                            </span>
                          ) : null}
                        </span>
                        <span className="shrink-0 font-mono text-[12.5px] text-meta tabular-nums">
                          {shortDate(entry.updated_at)}
                        </span>
                      </span>
                      {entry.snippet ? (
                        <span className="mt-1 block truncate text-[14px] text-ink">{entry.snippet}</span>
                      ) : null}
                    </button>
                    <RowActions
                      variant="paper"
                      title={entry.title}
                      updatedAt={entry.updated_at}
                      shared={Boolean(entry.shared_at)}
                      onShare={() => onShare(entry.id, Boolean(entry.shared_at))}
                      onRename={() => onRename(entry.id, entry.title)}
                      onDelete={() => onDelete(entry.id)}
                    />
                  </li>
                ))}
              </ul>
              {!searching && pages.hasNextPage ? (
                <div className="mt-3 flex justify-center">
                  <button
                    type="button"
                    className="thingy-btn thingy-btn-secondary thingy-btn-compact"
                    disabled={pages.isFetchingNextPage}
                    onClick={() => void pages.fetchNextPage()}
                  >
                    {pages.isFetchingNextPage ? 'Loading…' : 'Load more'}
                  </button>
                </div>
              ) : null}
            </div>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
