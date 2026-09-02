import { afterEach, expect, test } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DialogHost } from '../src/react/components/DialogHost.tsx';
import { confirmDialog, promptDialog } from '../src/shared/stores/dialog-store.ts';

afterEach(cleanup);

test('confirmDialog resolves true on confirm and renders via Radix with focus inside', async () => {
  const user = userEvent.setup();
  render(<DialogHost />);
  const result = confirmDialog({ title: 'Delete this?', confirmLabel: 'Delete', danger: true });
  const confirm = await screen.findByRole('button', { name: 'Delete' });
  // Radix's focus trap should place focus inside the dialog.
  await waitFor(() => {
    expect(document.activeElement && screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
  });
  await user.click(confirm);
  await expect(result).resolves.toBe(true);
});

test('Escape cancels a confirm as false', async () => {
  const user = userEvent.setup();
  render(<DialogHost />);
  const result = confirmDialog({ title: 'Sure?' });
  await screen.findByRole('dialog');
  await user.keyboard('{Escape}');
  await expect(result).resolves.toBe(false);
});

test('promptDialog returns the typed value and null on cancel', async () => {
  const user = userEvent.setup();
  render(<DialogHost />);
  const first = promptDialog({ title: 'Rename', initialValue: 'Old title' });
  const input = await screen.findByRole('textbox');
  await user.clear(input);
  await user.type(input, 'New title');
  await user.click(screen.getByRole('button', { name: 'OK' }));
  await expect(first).resolves.toBe('New title');

  const second = promptDialog({ title: 'Rename again' });
  await screen.findByRole('dialog');
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  await expect(second).resolves.toBeNull();
});

test('opening a new dialog settles the previous one as cancelled', async () => {
  render(<DialogHost />);
  const first = confirmDialog({ title: 'First' });
  await screen.findByRole('dialog');
  const second = confirmDialog({ title: 'Second' });
  await expect(first).resolves.toBe(false);
  await screen.findByText('Second');
  void second;
});
