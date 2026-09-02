// Promise-based in-app dialogs replacing window.confirm / window.prompt.
// One dialog at a time: opening a new one settles the previous as
// cancelled. The host component (ThingyDialog.tsx) renders whatever this
// signal holds; call sites just await the helper.

import { signal } from '@preact/signals';

interface DialogBase {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  hideCancel?: boolean;
}

interface ConfirmRequest extends DialogBase {
  kind: 'confirm';
}

interface PromptRequest extends DialogBase {
  kind: 'prompt';
  initialValue?: string;
  placeholder?: string;
  maxLength?: number;
  multiline?: boolean;
}

type DialogRequest = ConfirmRequest | PromptRequest;

interface ActiveDialog {
  request: DialogRequest;
  // Monotonic id so the host can reset its input state per dialog.
  id: number;
  resolve: (value: boolean | string | null) => void;
}

const activeDialog = signal<ActiveDialog | null>(null);
let nextDialogId = 1;

function cancelledValue(request: DialogRequest) {
  return request.kind === 'confirm' ? false : null;
}

function open(request: DialogRequest) {
  return new Promise<boolean | string | null>((resolve) => {
    const previous = activeDialog.value;
    if (previous) previous.resolve(cancelledValue(previous.request));
    activeDialog.value = { request, id: nextDialogId++, resolve };
  });
}

function settleDialog(value: boolean | string | null) {
  const current = activeDialog.value;
  if (!current) return;
  activeDialog.value = null;
  current.resolve(value);
}

function cancelDialog() {
  const current = activeDialog.value;
  if (!current) return;
  settleDialog(cancelledValue(current.request));
}

async function confirmDialog(request: Omit<ConfirmRequest, 'kind'>) {
  return (await open({ kind: 'confirm', ...request })) === true;
}

async function promptDialog(request: Omit<PromptRequest, 'kind'>) {
  const value = await open({ kind: 'prompt', ...request });
  return typeof value === 'string' ? value : null;
}

export { activeDialog, cancelDialog, confirmDialog, promptDialog, settleDialog };
export type { DialogRequest };
