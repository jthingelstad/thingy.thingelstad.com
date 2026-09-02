// React host for ThingyDialog on Radix Dialog (2026-09-03): focus trap,
// Escape, outside-click, and aria wiring come from the primitive; the
// promise-based dialog-store API and the CSS are unchanged.

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { activeDialog, settleDialog } from '../../shared/stores/dialog-store.ts';

function useStoreValue<T>(store: { value: T; subscribe: (fn: () => void) => () => void }): T {
  return useSyncExternalStore(
    useCallback((notify) => store.subscribe(notify), [store]),
    () => store.value
  );
}

export function DialogHost() {
  const dialog = useStoreValue(activeDialog);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [value, setValue] = useState('');
  const [renderedId, setRenderedId] = useState(0);
  if (dialog && dialog.id !== renderedId) {
    setRenderedId(dialog.id);
    setValue(dialog.request.kind === 'prompt' ? String(dialog.request.initialValue || '') : '');
  }
  useEffect(() => {
    if (dialog) window.setTimeout(() => (inputRef.current || textareaRef.current)?.focus(), 0);
    // Focus keys off the dialog id alone.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [dialog?.id]);
  if (!dialog) return null;
  const { request } = dialog;
  const isPrompt = request.kind === 'prompt';
  const settle = (v: boolean | string | null) => settleDialog(v);
  const cancel = () => settle(isPrompt ? null : false);
  return (
    <Dialog.Root open onOpenChange={(open) => (open ? undefined : cancel())}>
      <Dialog.Portal>
        <Dialog.Overlay className="thingy-dialog-scrim">
          <Dialog.Content
            className="thingy-dialog"
            aria-describedby={undefined}
            onOpenAutoFocus={(event) => {
              // The prompt input (or the confirm button) takes focus instead
              // of Radix's default first-tabbable pick.
              if (isPrompt) event.preventDefault();
            }}
          >
            <Dialog.Title asChild>
              <h2>{request.title}</h2>
            </Dialog.Title>
            {request.body ? <p className="thingy-dialog-body">{request.body}</p> : null}
            {isPrompt ? (
              <form
                className="thingy-dialog-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  settle(value);
                }}
              >
                {request.multiline ? (
                  <textarea
                    ref={textareaRef}
                    value={value}
                    rows={4}
                    maxLength={request.maxLength}
                    onInput={(e) => setValue((e.target as HTMLTextAreaElement).value)}
                  />
                ) : (
                  <input
                    ref={inputRef}
                    type="text"
                    value={value}
                    maxLength={request.maxLength}
                    onInput={(e) => setValue((e.target as HTMLInputElement).value)}
                  />
                )}
              </form>
            ) : null}
            <div className="thingy-dialog-actions">
              {request.hideCancel ? null : (
                <button type="button" className="thingy-dialog-cancel" onClick={cancel}>
                  {request.cancelLabel || 'Cancel'}
                </button>
              )}
              <button
                type="button"
                className={`thingy-dialog-confirm${request.danger ? ' danger' : ''}`}
                onClick={() => settle(isPrompt ? value : true)}
              >
                {request.confirmLabel || 'OK'}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
