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

// Felt & Tangerine pieces from thingy-components.css: paper modal with a
// 2px ink border, radius 24 and a hard 8px offset shadow over the
// ink-tinted scrim; clay pill buttons (tangerine primary with navy text,
// paper cancel, danger red); the 48px ink-bordered input, named by the
// dialog title (Radix owns the title's id, so no aria-labelledby).
const BUTTON = 'thingy-btn';

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
  const settle = (v: boolean | string | null | 'alt') => settleDialog(v);
  const cancel = () => settle(isPrompt ? null : false);
  return (
    <Dialog.Root open onOpenChange={(open) => (open ? undefined : cancel())}>
      <Dialog.Portal>
        <Dialog.Overlay className="thingy-dialog-scrim thingy-scrim fixed inset-0 z-50 grid place-items-center p-5">
          <Dialog.Content
            className="thingy-dialog thingy-modal w-[min(29rem,100%)] px-5.5 pt-5 pb-5.5 font-sans"
            aria-describedby={undefined}
            onOpenAutoFocus={(event) => {
              // The prompt input (or the confirm button) takes focus instead
              // of Radix's default first-tabbable pick.
              if (isPrompt) event.preventDefault();
            }}
          >
            <Dialog.Title asChild>
              <h2 className="thingy-modal-title">{request.title}</h2>
            </Dialog.Title>
            {request.body ? <p className="mt-3 text-[15px] leading-normal text-ink-soft">{request.body}</p> : null}
            {isPrompt ? (
              <form
                className="mt-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  settle(value);
                }}
              >
                {request.multiline ? (
                  <textarea
                    ref={textareaRef}
                    className="thingy-input"
                    aria-label={request.title}
                    value={value}
                    rows={4}
                    maxLength={request.maxLength}
                    onInput={(e) => setValue((e.target as HTMLTextAreaElement).value)}
                  />
                ) : (
                  <input
                    ref={inputRef}
                    className="thingy-input"
                    aria-label={request.title}
                    type="text"
                    value={value}
                    maxLength={request.maxLength}
                    onInput={(e) => setValue((e.target as HTMLInputElement).value)}
                  />
                )}
              </form>
            ) : null}
            <div className="mt-4.5 flex flex-wrap items-center justify-end gap-2.5">
              {request.altLabel ? (
                <button type="button" className={`${BUTTON} thingy-btn-alt mr-auto`} onClick={() => settle('alt')}>
                  {request.altLabel}
                </button>
              ) : null}
              {request.hideCancel ? null : (
                <button type="button" className={`${BUTTON} thingy-btn-secondary`} onClick={cancel}>
                  {request.cancelLabel || 'Cancel'}
                </button>
              )}
              <button
                type="button"
                className={`${BUTTON} ${request.danger ? 'thingy-btn-danger' : 'thingy-btn-primary'}`}
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
