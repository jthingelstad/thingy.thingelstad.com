// React host for ThingyDialog on Radix Dialog, styled with Tailwind.
// Focus trap, Escape, outside-click, and aria wiring come from the
// primitive; the promise-based dialog-store API is unchanged.

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { activeDialog, settleDialog } from '../../shared/stores/dialog-store.ts';
import { DialogMarkTile, SHEET_CONTENT, SHEET_FOOTER, SHEET_OVERLAY, SHEET_SAFE_BOTTOM, SheetGrab } from './Sheet.tsx';

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
// dialog title (Radix owns the title's id, so no aria-labelledby) unless
// the request gives the field its own visible label. An optional icon tile
// or face sits beside the title. Below md the dialog is a bottom sheet
// with its buttons stacked full width, the main action on top.
const BUTTON = 'thingy-btn';
const FIELD_ID = 'thingy-dialog-field';

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
  const mark = request.face
    ? { face: request.face }
    : request.icon
      ? { icon: request.icon, danger: request.iconDanger }
      : undefined;
  const field = isPrompt ? (request.label ? { id: FIELD_ID } : { 'aria-label': request.title }) : {};
  const readOnly = isPrompt && request.readOnly;
  const settle = (v: boolean | string | null | 'alt') => settleDialog(v);
  const cancel = () => settle(isPrompt ? null : false);
  return (
    <Dialog.Root open onOpenChange={(open) => (open ? undefined : cancel())}>
      <Dialog.Portal>
        <Dialog.Overlay className={`thingy-dialog-scrim ${SHEET_OVERLAY}`}>
          <Dialog.Content
            className={`thingy-dialog ${SHEET_CONTENT} w-[min(29rem,100%)] overflow-y-auto px-5.5 pt-5 pb-5.5 ${SHEET_SAFE_BOTTOM}`}
            aria-describedby={undefined}
            onOpenAutoFocus={(event) => {
              // The prompt input (or the confirm button) takes focus instead
              // of Radix's default first-tabbable pick.
              if (isPrompt) event.preventDefault();
            }}
          >
            <SheetGrab />
            <div className="flex items-center gap-3.5">
              {mark ? <DialogMarkTile mark={mark} /> : null}
              <Dialog.Title asChild>
                <h2 className="thingy-modal-title min-w-0">{request.title}</h2>
              </Dialog.Title>
            </div>
            {request.body ? <p className="mt-3 text-[15px] leading-normal text-ink-soft">{request.body}</p> : null}
            {isPrompt ? (
              <form
                className="mt-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  settle(value);
                }}
              >
                {request.label ? (
                  <label htmlFor={FIELD_ID} className="thingy-field-label">
                    {request.label}
                  </label>
                ) : null}
                {request.multiline ? (
                  <textarea
                    ref={textareaRef}
                    className="thingy-input"
                    {...field}
                    value={value}
                    rows={4}
                    maxLength={request.maxLength}
                    onInput={(e) => setValue((e.target as HTMLTextAreaElement).value)}
                  />
                ) : (
                  <input
                    ref={inputRef}
                    className={`thingy-input${readOnly ? ' bg-toy font-mono text-[14px] font-semibold' : ''}`}
                    {...field}
                    type="text"
                    readOnly={readOnly}
                    onFocus={readOnly ? (e) => e.currentTarget.select() : undefined}
                    value={value}
                    maxLength={request.maxLength}
                    onInput={(e) => setValue((e.target as HTMLInputElement).value)}
                  />
                )}
              </form>
            ) : null}
            <div className={`mt-4.5 ${SHEET_FOOTER}`}>
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
