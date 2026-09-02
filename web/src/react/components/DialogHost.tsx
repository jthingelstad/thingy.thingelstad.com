// React host for ThingyDialog on Radix Dialog, styled with Tailwind.
// Focus trap, Escape, outside-click, and aria wiring come from the
// primitive; the promise-based dialog-store API is unchanged.

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { activeDialog, settleDialog } from '../../shared/stores/dialog-store.ts';

function useStoreValue<T>(store: { value: T; subscribe: (fn: () => void) => () => void }): T {
  return useSyncExternalStore(
    useCallback((notify) => store.subscribe(notify), [store]),
    () => store.value
  );
}

const FIELD_CLASSES =
  'w-full rounded-lg border border-line bg-bg px-3 py-2 font-sans text-[15px] text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft';

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
        <Dialog.Overlay className="thingy-dialog-scrim fixed inset-0 z-50 grid place-items-center bg-black/45 p-5 backdrop-blur-[3px]">
          <Dialog.Content
            className="thingy-dialog w-[min(26rem,100%)] rounded-2xl border border-line bg-surface p-5 font-sans text-ink shadow-2xl"
            aria-describedby={undefined}
            onOpenAutoFocus={(event) => {
              // The prompt input (or the confirm button) takes focus instead
              // of Radix's default first-tabbable pick.
              if (isPrompt) event.preventDefault();
            }}
          >
            <Dialog.Title asChild>
              <h2 className="mb-1.5 text-[17px] leading-tight font-extrabold">{request.title}</h2>
            </Dialog.Title>
            {request.body ? <p className="mb-1 text-[14.5px] leading-normal text-ink-soft">{request.body}</p> : null}
            {isPrompt ? (
              <form
                className="mt-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  settle(value);
                }}
              >
                {request.multiline ? (
                  <textarea
                    ref={textareaRef}
                    className={`${FIELD_CLASSES} resize-none`}
                    value={value}
                    rows={4}
                    maxLength={request.maxLength}
                    onInput={(e) => setValue((e.target as HTMLTextAreaElement).value)}
                  />
                ) : (
                  <input
                    ref={inputRef}
                    className={FIELD_CLASSES}
                    type="text"
                    value={value}
                    maxLength={request.maxLength}
                    onInput={(e) => setValue((e.target as HTMLInputElement).value)}
                  />
                )}
              </form>
            ) : null}
            <div className="mt-4 flex justify-end gap-2">
              {request.hideCancel ? null : (
                <button
                  type="button"
                  className="rounded-lg border border-line bg-surface px-3.5 py-2 text-sm font-bold text-ink hover:bg-surface-2"
                  onClick={cancel}
                >
                  {request.cancelLabel || 'Cancel'}
                </button>
              )}
              <button
                type="button"
                className={`rounded-lg px-3.5 py-2 text-sm font-bold text-bg ${
                  request.danger ? 'bg-error hover:brightness-110' : 'bg-accent-deep hover:brightness-110'
                }`}
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
