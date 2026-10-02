import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Rail, type ConversationSummary } from '../src/react/components/Rail.tsx';
import { TipProvider } from '../src/react/components/Tip.tsx';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

afterEach(cleanup);

const noop = () => {};

function iso(daysAgo: number) {
  return new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
}

function renderRail(
  conversations: ConversationSummary[],
  onSearch?: (q: string) => Promise<never[]>,
  overrides: Partial<Parameters<typeof Rail>[0]> = {}
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <TipProvider>
        <Rail
          collapsed={false}
          onToggleCollapsed={noop}
          conversations={conversations}
          activeId=""
          onSelect={noop}
          onNew={noop}
          onShare={noop}
          onRename={noop}
          onDelete={noop}
          onSearch={onSearch}
          {...overrides}
        />
      </TipProvider>
    </QueryClientProvider>
  );
}

test('recents group into Claude-style time buckets', () => {
  renderRail([
    { id: 'a', title: 'Fresh chat', updated_at: iso(0) },
    { id: 'b', title: 'Last week chat', updated_at: iso(3) },
    { id: 'c', title: 'Ancient chat', updated_at: iso(30) }
  ]);
  expect(screen.getByText('Today')).toBeTruthy();
  expect(screen.getByText('Previous 7 days')).toBeTruthy();
  expect(screen.getByText('Older')).toBeTruthy();
  expect(screen.queryByText('Yesterday')).toBeNull();
});

test('typing filters by title and merges server content matches with snippets', async () => {
  const user = userEvent.setup();
  const onSearch = vi.fn().mockResolvedValue([{ conversation_id: 'c', snippet: '…the bison thread from WT127…' }]);
  renderRail(
    [
      { id: 'a', title: 'Ethereum history', updated_at: iso(0) },
      { id: 'b', title: 'Bike rides', updated_at: iso(0) },
      { id: 'c', title: 'Unrelated title', updated_at: iso(0) }
    ],
    onSearch as never
  );
  await user.type(screen.getByRole('searchbox'), 'bison');
  // Title match: none. Content match arrives from the (debounced) search.
  await waitFor(() => expect(onSearch).toHaveBeenCalledWith('bison'), { timeout: 2000 });
  await screen.findByText('Unrelated title');
  expect(screen.getByText('…the bison thread from WT127…')).toBeTruthy();
  expect(screen.queryByText('Ethereum history')).toBeNull();
});

test('no matches shows the empty label', async () => {
  const user = userEvent.setup();
  renderRail([{ id: 'a', title: 'Ethereum history', updated_at: iso(0) }]);
  await user.type(screen.getByRole('searchbox'), 'zzz');
  await screen.findByText('No matching chats');
});

test('a failed list offers recovery instead of saying the archive is empty', async () => {
  const retry = vi.fn();
  renderRail([], undefined, { error: new Error('offline'), onRetry: retry });
  expect(screen.getByRole('alert')).toBeTruthy();
  expect(screen.queryByText('No conversations yet.')).toBeNull();
  await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
  expect(retry).toHaveBeenCalledOnce();
});

test('a failed rail search does not claim there are no matching chats', async () => {
  renderRail([{ id: 'a', title: 'Existing chat' }], vi.fn().mockRejectedValue(new Error('offline')));
  await userEvent.setup().type(screen.getByRole('searchbox'), 'bison');
  await screen.findByRole('alert');
  expect(screen.queryByText('No matching chats')).toBeNull();
});

// Touch (Jamie 2026-10-01): nothing can hover on a phone, so every row
// carries a "More actions" button that opens an action sheet. These drive
// it by keyboard and click only - no hover anywhere - to prove Delete,
// Rename and Share are reachable without it.
test('Delete is reachable without hover through the More actions sheet', async () => {
  const user = userEvent.setup();
  const onDelete = vi.fn();
  renderRail([{ id: 'a', title: 'Bison thread', updated_at: iso(0) }], undefined, { onDelete });
  const more = screen.getByRole('button', { name: 'More actions for Bison thread' });
  expect(more.getAttribute('aria-haspopup')).toBe('dialog');
  await user.click(more);
  const sheet = await screen.findByRole('dialog', { name: 'Actions for Bison thread' });
  await user.click(within(sheet).getByRole('button', { name: 'Delete' }));
  await waitFor(() => expect(onDelete).toHaveBeenCalledWith('a'));
  expect(screen.queryByRole('dialog')).toBeNull();
  // Focus is back on the button that opened the sheet.
  expect(document.activeElement).toBe(more);
});

test('the action sheet names a shared row Refresh share link and closes on Escape', async () => {
  const user = userEvent.setup();
  const onShare = vi.fn();
  const onRename = vi.fn();
  renderRail([{ id: 's', title: 'Shared chat', updated_at: iso(0), shared_at: iso(0) }], undefined, {
    onShare,
    onRename
  });
  const more = screen.getByRole('button', { name: 'More actions for Shared chat' });
  more.focus();
  await user.keyboard('{Enter}');
  const sheet = await screen.findByRole('dialog', { name: 'Actions for Shared chat' });
  expect(within(sheet).getByRole('button', { name: 'Refresh share link' })).toBeTruthy();
  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(document.activeElement).toBe(more);
  expect(onShare).not.toHaveBeenCalled();

  await user.keyboard('{Enter}');
  await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Refresh share link' }));
  await waitFor(() => expect(onShare).toHaveBeenCalledWith('s', true));
  await user.keyboard('{Enter}');
  await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Rename' }));
  await waitFor(() => expect(onRename).toHaveBeenCalledWith('s', 'Shared chat'));
});
