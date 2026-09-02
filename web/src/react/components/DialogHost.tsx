// React host for ThingyDialog (same store + CSS as the rest of the app).

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
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
    if (dialog) (inputRef.current || textareaRef.current)?.focus();
    // Focus keys off the dialog id alone.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [dialog?.id]);
  if (!dialog) return null;
  const { request } = dialog;
  const isPrompt = request.kind === 'prompt';
  const settle = (v: boolean | string | null) => settleDialog(v);
  const cancel = () => settle(isPrompt ? null : false);
  return (
    <div className="thingy-dialog-scrim" onClick={cancel}>
      <div className="thingy-dialog" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h2>{request.title}</h2>
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
      </div>
    </div>
  );
}
