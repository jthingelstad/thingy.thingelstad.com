import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Rail, type ConversationSummary } from '../src/react/components/Rail.tsx';
import { TipProvider } from '../src/react/components/Tip.tsx';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

afterEach(cleanup);

const noop = () => {};

function iso(daysAgo: number) {
  return new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
}

function renderRail(conversations: ConversationSummary[], onSearch?: (q: string) => Promise<never[]>) {
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
