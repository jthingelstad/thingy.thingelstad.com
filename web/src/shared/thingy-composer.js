function defaultBusy() {
    return false;
  }

function createComposer(options = {}) {
    const form = options.form || null;
    const input = options.input || null;
    const count = options.count || null;
    const maxChars = Number(options.maxChars || input?.getAttribute('maxlength') || 0);
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

    function updateCount() {
      if (!count || !input || !maxChars) return;
      count.textContent = `${input.value.length} / ${maxChars}`;
      count.classList.toggle('warning', input.value.length > maxChars * 0.9);
    }

    function sync() {
      updateCount();
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
    return { autoSize, sync, updateCount };
  }

export { createComposer };
