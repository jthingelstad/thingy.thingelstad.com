import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HeaderTitle } from '../src/react/components/HeaderTitle.tsx';

afterEach(cleanup);

test('click to edit, Enter commits the trimmed title', async () => {
  const user = userEvent.setup();
  const onRename = vi.fn().mockResolvedValue(undefined);
  render(<HeaderTitle title="Old title" canRename onRename={onRename} />);
  await user.click(screen.getByRole('button', { name: 'Old title' }));
  const input = screen.getByRole('textbox');
  await user.clear(input);
  await user.type(input, '  New title  {Enter}');
  expect(onRename).toHaveBeenCalledWith('New title');
});

test('Escape cancels without renaming', async () => {
  const user = userEvent.setup();
  const onRename = vi.fn();
  render(<HeaderTitle title="Old title" canRename onRename={onRename} />);
  await user.click(screen.getByRole('button', { name: 'Old title' }));
  await user.type(screen.getByRole('textbox'), 'changed{Escape}');
  expect(onRename).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Old title' })).toBeTruthy();
});

test('unchanged or empty titles never commit', async () => {
  const user = userEvent.setup();
  const onRename = vi.fn();
  render(<HeaderTitle title="Same" canRename onRename={onRename} />);
  await user.click(screen.getByRole('button', { name: 'Same' }));
  await user.type(screen.getByRole('textbox'), '{Enter}');
  expect(onRename).not.toHaveBeenCalled();
});

test('New chat header is not editable', () => {
  render(<HeaderTitle title="New chat" canRename={false} onRename={async () => {}} />);
  expect(screen.queryByRole('button', { name: 'New chat' })).toBeNull();
  expect(screen.getByText('New chat')).toBeTruthy();
});
