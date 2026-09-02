import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TipProvider } from '../src/react/components/Tip.tsx';
import { HistoryDialog } from '../src/react/components/HistoryDialog.tsx';

afterEach(cleanup);

const noop = () => {};

function entry(id: string, title: string) {
  return { id, title, updated_at: new Date().toISOString(), shared_at: '' };
}

function renderDialog(overrides: Partial<Parameters<typeof HistoryDialog>[0]> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const listPage = vi.fn(async (offset: number) => ({
    conversations:
      offset === 0 ? [entry('a', 'First page chat'), entry('b', 'Another chat')] : [entry('c', 'Second page chat')],
    total: 3
  }));
  const search = vi.fn(async () => [
    {
      conversation_id: 'z',
      snippet: '…the bison thread…',
      title: 'Deep history chat',
      updated_at: new Date().toISOString()
    }
  ]);
  const onSelect = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <TipProvider>
        <HistoryDialog
          open
          onClose={noop}
          onSelect={onSelect}
          onShare={noop}
          onRename={noop}
          onDelete={noop}
          listPage={listPage}
          search={search}
          {...overrides}
        />
      </TipProvider>
    </QueryClientProvider>
  );
  return { listPage, search, onSelect };
}

test('lists the first page with total and loads more on demand', async () => {
  const user = userEvent.setup();
  const { listPage } = renderDialog();
  await screen.findByText('First page chat');
  expect(screen.getByText('3 total')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Load more' }));
  await screen.findByText('Second page chat');
  expect(listPage).toHaveBeenCalledWith(2);
  // All three loaded: the Load more button goes away.
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull());
});

test('typing a query swaps the list for search results with snippets', async () => {
  const user = userEvent.setup();
  const { search } = renderDialog();
  await screen.findByText('First page chat');
  await user.type(screen.getByRole('searchbox'), 'bison');
  await screen.findByText('Deep history chat', undefined, { timeout: 2000 });
  expect(screen.getByText('…the bison thread…')).toBeTruthy();
  expect(search).toHaveBeenCalledWith('bison');
  expect(screen.queryByText('First page chat')).toBeNull();
});

test('selecting a row reports id and title', async () => {
  const user = userEvent.setup();
  const { onSelect } = renderDialog();
  await screen.findByText('First page chat');
  await user.click(screen.getByText('First page chat'));
  expect(onSelect).toHaveBeenCalledWith('a', 'First page chat');
});
