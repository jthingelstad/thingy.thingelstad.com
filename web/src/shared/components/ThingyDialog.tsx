import { useEffect, useRef, useState } from 'preact/hooks';
import { activeDialog, cancelDialog, settleDialog } from '../stores/dialog-store.ts';

// In-app modal for confirmations and small text inputs, styled with the
// site tokens (window.confirm/window.prompt were the last visibly
// unthemed UI in the app). Mounted once per page root; driven entirely by
// the dialog store's signal.
function ThingyDialogHost() {
  const dialog = activeDialog.value;
  const inputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const [value, setValue] = useState('');
  const [renderedId, setRenderedId] = useState(0);

  if (dialog && dialog.id !== renderedId) {
    setRenderedId(dialog.id);
    setValue(dialog.request.kind === 'prompt' ? String(dialog.request.initialValue || '') : '');
  }

  useEffect(() => {
    if (!dialog) {
      restoreFocusRef.current?.focus?.();
      restoreFocusRef.current = null;
      return;
    }
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    (inputRef.current || textareaRef.current || confirmRef.current)?.focus();
    inputRef.current?.select();
    // Focus management keys off the dialog id alone: a new id means a new
    // dialog to focus, and null means restore.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [dialog?.id]);

  if (!dialog) return null;
  const { request } = dialog;
  const isPrompt = request.kind === 'prompt';

  function submit() {
    settleDialog(isPrompt ? value : true);
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      cancelDialog();
    }
  }

  return (
    <div class="thingy-dialog-scrim" onClick={cancelDialog} onKeyDown={onKeyDown}>
      <div
        class="thingy-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="thingy-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="thingy-dialog-title">{request.title}</h2>
        {request.body ? <p class="thingy-dialog-body">{request.body}</p> : null}
        {isPrompt ? (
          <form
            class="thingy-dialog-form"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            {request.multiline ? (
              <textarea
                ref={textareaRef}
                value={value}
                rows={4}
                maxLength={request.maxLength}
                placeholder={request.placeholder}
                onInput={(event) => setValue((event.target as HTMLTextAreaElement).value)}
              />
            ) : (
              <input
                ref={inputRef}
                type="text"
                value={value}
                maxLength={request.maxLength}
                placeholder={request.placeholder}
                onInput={(event) => setValue((event.target as HTMLInputElement).value)}
              />
            )}
          </form>
        ) : null}
        <div class="thingy-dialog-actions">
          {request.hideCancel ? null : (
            <button type="button" class="thingy-dialog-cancel" onClick={cancelDialog}>
              {request.cancelLabel || 'Cancel'}
            </button>
          )}
          <button
            ref={confirmRef}
            type="button"
            class={`thingy-dialog-confirm${request.danger ? ' danger' : ''}`}
            onClick={submit}
          >
            {request.confirmLabel || 'OK'}
          </button>
        </div>
      </div>
    </div>
  );
}

export { ThingyDialogHost };
