import assert from 'node:assert/strict';
import test from 'node:test';

const { activeDialog, cancelDialog, confirmDialog, promptDialog, settleDialog } =
  await import('../src/shared/stores/dialog-store.ts');

test('confirm resolves true on settle and false on cancel', async () => {
  const accepted = confirmDialog({ title: 'Delete?' });
  assert.equal(activeDialog.value?.request.title, 'Delete?');
  settleDialog(true);
  assert.equal(await accepted, true);
  assert.equal(activeDialog.value, null);

  const declined = confirmDialog({ title: 'Sure?' });
  cancelDialog();
  assert.equal(await declined, false);
});

test('prompt resolves the entered value, and null on cancel', async () => {
  const answered = promptDialog({ title: 'Rename', initialValue: 'Old' });
  settleDialog('New title');
  assert.equal(await answered, 'New title');

  const dismissed = promptDialog({ title: 'Rename' });
  cancelDialog();
  assert.equal(await dismissed, null);
});

test('opening a second dialog settles the first as cancelled', async () => {
  const first = confirmDialog({ title: 'First' });
  const second = promptDialog({ title: 'Second' });
  assert.equal(await first, false);
  assert.equal(activeDialog.value?.request.title, 'Second');
  settleDialog('done');
  assert.equal(await second, 'done');
});
