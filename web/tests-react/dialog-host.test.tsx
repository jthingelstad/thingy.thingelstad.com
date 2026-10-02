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

test('ThingyDialog wears the Felt & Tangerine pieces and keeps its hooks', async () => {
  render(<DialogHost />);
  const result = confirmDialog({ title: 'Delete this?', confirmLabel: 'Delete', danger: true, altLabel: 'Archive' });
  const dialog = await screen.findByRole('dialog');
  // Test hooks stay; the look comes from the component classes.
  expect(dialog.classList.contains('thingy-dialog')).toBe(true);
  expect(dialog.classList.contains('thingy-modal')).toBe(true);
  expect(dialog.parentElement?.classList.contains('thingy-dialog-scrim')).toBe(true);
  expect(dialog.parentElement?.classList.contains('thingy-scrim')).toBe(true);
  expect(screen.getByRole('heading', { name: 'Delete this?' }).classList.contains('thingy-modal-title')).toBe(true);
  expect(screen.getByRole('button', { name: 'Delete' }).className).toContain('thingy-btn-danger');
  expect(screen.getByRole('button', { name: 'Cancel' }).className).toContain('thingy-btn-secondary');
  expect(screen.getByRole('button', { name: 'Archive' }).className).toContain('thingy-btn-alt');
  void result;
});

test('a non-danger confirm is the tangerine primary, and the prompt input is named', async () => {
  render(<DialogHost />);
  const result = promptDialog({ title: 'Rename conversation', confirmLabel: 'Rename' });
  const input = await screen.findByRole('textbox', { name: 'Rename conversation' });
  expect(input.classList.contains('thingy-input')).toBe(true);
  expect(screen.getByRole('button', { name: 'Rename' }).className).toContain('thingy-btn-primary');
  void result;
});

test('a prompt can carry a visible label, and the share link is read-only', async () => {
  const user = userEvent.setup();
  render(<DialogHost />);
  const rename = promptDialog({
    title: 'Rename conversation',
    label: 'Conversation title',
    icon: 'pencil',
    initialValue: 'Bison',
    confirmLabel: 'Rename'
  });
  const input = await screen.findByRole('textbox', { name: 'Conversation title' });
  expect((input as HTMLInputElement).readOnly).toBe(false);
  // The icon tile is decoration; the title still names the dialog.
  expect(document.querySelector('.thingy-dialog .thingy-icon-tile')?.getAttribute('aria-hidden')).toBe('true');
  expect(screen.getByRole('dialog', { name: 'Rename conversation' })).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(await rename).toBeNull();

  const share = promptDialog({
    title: 'Share link copied',
    label: 'Share link',
    readOnly: true,
    face: 'found-it',
    initialValue: 'https://thingy.example/c/abc',
    confirmLabel: 'Done',
    hideCancel: true
  });
  const link = await screen.findByRole('textbox', { name: 'Share link' });
  expect((link as HTMLInputElement).readOnly).toBe(true);
  expect(document.querySelector('.thingy-dialog .thingy-face')?.getAttribute('data-mood')).toBe('found-it');
  await user.click(screen.getByRole('button', { name: 'Done' }));
  expect(await share).toBe('https://thingy.example/c/abc');
});
