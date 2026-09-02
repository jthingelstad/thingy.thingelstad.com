// Promise-based in-app dialogs replacing window.confirm / window.prompt.
// One dialog at a time: opening a new one settles the previous as
// cancelled. The host component (components/DialogHost.tsx) renders whatever
// this store holds; call sites just await the helper.

interface DialogBase {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  hideCancel?: boolean;
  // Optional third action rendered as a destructive text button; a
  // confirm dialog then resolves 'alt' when it is chosen.
  altLabel?: string;
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
  resolve: (value: boolean | string | null | 'alt') => void;
}

// Minimal framework-free store with the {value, subscribe} shape the React
// host reads through useSyncExternalStore.
function createStore<T>(initial: T) {
  let current = initial;
  const listeners = new Set<() => void>();
  return {
    get value() {
      return current;
    },
    set value(next: T) {
      current = next;
      listeners.forEach((listener) => listener());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
}

const activeDialog = createStore<ActiveDialog | null>(null);
let nextDialogId = 1;

function cancelledValue(request: DialogRequest) {
  return request.kind === 'confirm' ? false : null;
}

function open(request: DialogRequest) {
  return new Promise<boolean | string | null | 'alt'>((resolve) => {
    const previous = activeDialog.value;
    if (previous) previous.resolve(cancelledValue(previous.request));
    activeDialog.value = { request, id: nextDialogId++, resolve };
  });
}

function settleDialog(value: boolean | string | null | 'alt') {
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

async function confirmDialog(request: Omit<ConfirmRequest, 'kind'>): Promise<boolean | 'alt'> {
  const value = await open({ kind: 'confirm', ...request });
  return value === 'alt' ? 'alt' : value === true;
}

async function promptDialog(request: Omit<PromptRequest, 'kind'>) {
  const value = await open({ kind: 'prompt', ...request });
  return typeof value === 'string' ? value : null;
}

export { activeDialog, cancelDialog, confirmDialog, promptDialog, settleDialog };
export type { DialogRequest };
