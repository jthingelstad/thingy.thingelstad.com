// @ts-check
function defaultBusy() {
  return false;
}

// Wires the dumb pieces of a composer: form submit / Enter key / autosize.
// The character count and the send button used to live here too; both moved
// to the ComposerCount and ComposerSubmit signal-backed islands and the
// `count` option was retired with them.
function createComposer(options: ThingyOptions = {}) {
  const form = options.form || null;
  const input = options.input || null;
  const isBusy = typeof options.isBusy === 'function' ? options.isBusy : defaultBusy;
  const onSubmit = typeof options.onSubmit === 'function' ? options.onSubmit : null;
  const onError = typeof options.onError === 'function' ? options.onError : null;
  const onInput = typeof options.onInput === 'function' ? options.onInput : null;
  const autoSizeEnabled = options.autoSize !== false;
  const maxHeight = Number(options.maxHeight || 240);
  const onAutoSize = typeof options.onAutoSize === 'function' ? options.onAutoSize : null;

  function autoSize() {
    if (!input || !autoSizeEnabled) return;
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, maxHeight)}px`;
    if (onAutoSize) onAutoSize();
  }

  function sync() {
    autoSize();
  }

  if (form) {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (isBusy()) return;
      if (!onSubmit) return;
      try {
        await onSubmit(event);
      } catch (error) {
        if (onError) {
          onError(error);
        } else {
          console.error(error);
        }
      }
    });
  }

  if (input) {
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      if (form && typeof form.requestSubmit === 'function') {
        form.requestSubmit();
      } else if (form) {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      }
    });
    input.addEventListener('input', (event) => {
      sync();
      if (onInput) onInput(event);
    });
  }

  sync();
  return { autoSize, sync };
}

export { createComposer };
