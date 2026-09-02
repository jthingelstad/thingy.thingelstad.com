// The All-chats browser (contract 4.6): full conversation history with
// search, paged 50 at a time. Deliberate UX split: the RAIL stays a
// bounded working set (recent 50 + filter), THIS dialog owns depth -
// pagination and full-history search - and the profile modal stays
// account facts. Opened from the rail's "All chats" row.

import { useEffect, useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Icon } from './Icon.tsx';
import { Tip } from './Tip.tsx';
import type { ConversationSummary } from './Rail.tsx';

const ROW_ACTION =
  'grid size-7 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-ink [&_svg]:size-3.5';

function shortDate(value?: string) {
  const time = Date.parse(String(value || ''));
  if (!Number.isFinite(time)) return '';
  return new Date(time).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

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
  const { data: matches = [] } = useQuery({
    queryKey: ['conversation-search', needle],
    enabled: open && searching,
    placeholderData: keepPreviousData,
    queryFn: () => search(needle)
  });

  const rows = useMemo(() => {
    if (searching) {
      return matches.map((match) => ({
        id: match.conversation_id,
        title: match.title || 'Untitled chat',
        updated_at: match.updated_at,
        snippet: match.snippet,
        shared_at: ''
      }));
    }
    return (pages.data?.pages || []).flatMap((page) => page.conversations.map((entry) => ({ ...entry, snippet: '' })));
  }, [searching, matches, pages.data]);
  const total = pages.data?.pages[0]?.total ?? 0;

  if (!open) return null;
  return (
    <Dialog.Root open onOpenChange={(next) => (next ? undefined : onClose())}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-5 backdrop-blur-[3px]">
          <Dialog.Content
            className="flex max-h-[min(680px,calc(100vh-40px))] w-[min(38rem,100%)] flex-col rounded-2xl border border-line bg-surface font-sans text-ink shadow-2xl"
            aria-describedby={undefined}
          >
            <div className="flex items-center gap-3 border-b border-line-soft px-5 py-4">
              <Dialog.Title asChild>
                <h2 className="text-[17px] font-extrabold">All chats</h2>
              </Dialog.Title>
              <span className="text-[13px] text-muted">{total ? `${total} total` : ''}</span>
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="ml-auto grid size-8 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink [&_svg]:size-4"
                  aria-label="Close"
                >
                  <Icon name="x" />
                </button>
              </Dialog.Close>
            </div>
            <div className="px-5 pt-3 pb-1">
              <div className="flex items-center gap-2 rounded-xl border border-line bg-bg px-3 py-2 text-muted focus-within:border-accent [&_svg]:size-4 [&_svg]:shrink-0">
                <Icon name="search" />
                <input
                  className="w-full min-w-0 bg-transparent text-[14px] text-ink outline-none placeholder:text-muted"
                  type="search"
                  placeholder="Search all conversations"
                  aria-label="Search all conversations"
                  autoFocus
                  value={filter}
                  onChange={(event) => setFilter(event.currentTarget.value)}
                />
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 pt-1 pb-3">
              {rows.length === 0 ? (
                <p className="px-2 py-6 text-center text-[13.5px] text-muted">
                  {searching ? 'No conversations match.' : pages.isLoading ? 'Loading…' : 'No conversations yet.'}
                </p>
              ) : null}
              <ul className="grid gap-0.5">
                {rows.map((entry) => (
                  <li
                    key={entry.id}
                    className="group/row relative min-w-0 overflow-hidden rounded-lg transition-colors hover:bg-surface-2"
                  >
                    <button
                      type="button"
                      className="block w-full px-2.5 py-2 text-left"
                      onClick={() => {
                        onSelect(entry.id, entry.title);
                        onClose();
                      }}
                    >
                      <span className="flex items-baseline gap-2">
                        <span className="min-w-0 flex-1 truncate text-[14px] text-ink">{entry.title}</span>
                        <span className="shrink-0 font-mono text-[11px] text-muted tabular-nums">
                          {shortDate(entry.updated_at)}
                        </span>
                      </span>
                      {entry.snippet ? (
                        <span className="mt-0.5 block truncate text-[12px] text-muted">{entry.snippet}</span>
                      ) : null}
                    </button>
                    <span className="absolute top-1/2 right-1 hidden -translate-y-1/2 items-center rounded-md bg-inherit group-focus-within/row:flex group-hover/row:flex">
                      <Tip label={entry.shared_at ? 'Refresh share link' : 'Share'}>
                        <button
                          type="button"
                          className={ROW_ACTION}
                          aria-label="Share"
                          onClick={() => onShare(entry.id, Boolean(entry.shared_at))}
                        >
                          <Icon name="share" />
                        </button>
                      </Tip>
                      <Tip label="Rename">
                        <button
                          type="button"
                          className={ROW_ACTION}
                          aria-label="Rename"
                          onClick={() => onRename(entry.id, entry.title)}
                        >
                          <Icon name="pencil" />
                        </button>
                      </Tip>
                      <Tip label="Delete">
                        <button
                          type="button"
                          className={`${ROW_ACTION} hover:text-error`}
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
              {!searching && pages.hasNextPage ? (
                <button
                  type="button"
                  className="mx-auto mt-2 block rounded-lg border border-line bg-bg px-4 py-1.5 text-[13px] font-bold text-ink hover:border-accent hover:bg-accent-soft"
                  disabled={pages.isFetchingNextPage}
                  onClick={() => void pages.fetchNextPage()}
                >
                  {pages.isFetchingNextPage ? 'Loading…' : 'Load more'}
                </button>
              ) : null}
            </div>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
