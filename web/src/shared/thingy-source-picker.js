// @ts-check
import {
  scopeForSources as defaultScopeForSources,
  sourcesForScope as defaultSourcesForScope
} from './thingy-scope.js';

const sourceMeta = {
  weekly_thing: { name: 'Weekly Thing', cls: 'dot-wt' },
  blog: { name: 'Blog', cls: 'dot-blog' },
  podcast: { name: 'Another Thing', cls: 'dot-podcast' }
};

function createSourcePicker(options = {}) {
  const scopeForSources = options.scopeForSources || defaultScopeForSources;
  const sourcesForScope = options.sourcesForScope || defaultSourcesForScope;
  const inputs = Array.isArray(options.inputs) ? options.inputs : [];
  const button = options.button || null;
  const popover = options.popover || null;
  const label = options.label || null;
  const dots = options.dots || null;
  const note = options.note || null;
  const error = options.error || null;
  const scrollContainer = options.scrollContainer || null;
  const onChange = typeof options.onChange === 'function' ? options.onChange : () => {};
  let positionFrame = 0;
  let disabled = false;

  function selectedSources() {
    return inputs.filter((input) => input.checked).map((input) => input.value);
  }

  function sourceCount() {
    return selectedSources().length;
  }

  function currentScope() {
    return scopeForSources(selectedSources());
  }

  function setSourceMessage(message) {
    if (error) error.textContent = message || '';
    if (note && message) note.textContent = message;
  }

  function ensureOneSourceSelected(changedInput = null) {
    if (sourceCount() > 0) return true;
    const fallback = changedInput || inputs[0];
    if (fallback) fallback.checked = true;
    return false;
  }

  function position() {
    positionFrame = 0;
    if (!popover || !button || popover.hidden) return;
    const margin = 12;
    const gap = 8;
    const buttonRect = button.getBoundingClientRect();
    const popRect = popover.getBoundingClientRect();
    const width = Math.min(264, Math.max(220, window.innerWidth - margin * 2));
    const left = Math.min(Math.max(buttonRect.left, margin), window.innerWidth - width - margin);
    const openAboveTop = buttonRect.top - popRect.height - gap;
    const openBelowTop = buttonRect.bottom + gap;
    const top =
      openAboveTop >= margin ? openAboveTop : Math.min(openBelowTop, window.innerHeight - popRect.height - margin);
    popover.style.setProperty('--srcpick-pop-width', `${width}px`);
    popover.style.setProperty('--srcpick-pop-left', `${Math.round(left)}px`);
    popover.style.setProperty('--srcpick-pop-top', `${Math.round(Math.max(margin, top))}px`);
  }

  function schedulePosition() {
    if (positionFrame) return;
    positionFrame = window.requestAnimationFrame(position);
  }

  function syncPosition() {
    if (positionFrame) {
      window.cancelAnimationFrame(positionFrame);
      positionFrame = 0;
    }
    position();
  }

  function open() {
    if (!popover || !button) return;
    popover.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    syncPosition();
  }

  function close() {
    if (!popover || !button) return;
    popover.hidden = true;
    button.setAttribute('aria-expanded', 'false');
  }

  function toggle(force) {
    if (!popover || !button || disabled) return;
    const openNext = force === undefined ? popover.hasAttribute('hidden') : force;
    if (!openNext && !ensureOneSourceSelected()) {
      setSourceMessage('Keep at least one source selected.');
      open();
      return;
    }
    if (openNext) open();
    else close();
  }

  function refresh() {
    if (!label || !dots || !note) return;
    const on = selectedSources();
    dots.innerHTML = on
      .map((value) => sourceMeta[value])
      .filter(Boolean)
      .map((meta) => `<i class="${meta.cls}"></i>`)
      .join('');
    if (on.length === 0) {
      label.textContent = 'No sources';
      note.textContent = 'Switch on at least one source for Thingy to use.';
    } else if (on.length === inputs.length) {
      label.textContent = 'All sources';
      note.textContent = 'Thingy can draw from all three sources.';
    } else if (on.length === 1) {
      label.textContent = sourceMeta[on[0]]?.name || 'Selected source';
      note.textContent = `Thingy will only draw from ${sourceMeta[on[0]]?.name || 'that source'}.`;
    } else {
      label.textContent = on
        .map((value) => sourceMeta[value]?.name)
        .filter(Boolean)
        .join(' + ');
      note.textContent = `Thingy can draw from ${on.length} of ${inputs.length} sources.`;
    }
    if (popover) {
      popover.querySelectorAll('.srcpick-row').forEach((row) => {
        const input = row.querySelector('input[name="scope"]');
        row.setAttribute('aria-checked', input?.checked ? 'true' : 'false');
      });
    }
    schedulePosition();
  }

  function notifyChange(changedInput = null) {
    const keptSelection = ensureOneSourceSelected(changedInput);
    if (!keptSelection) setSourceMessage('Keep at least one source selected.');
    refresh();
    onChange(currentScope() || 'none', { keptSelection });
  }

  function toggleInput(input) {
    if (!input || input.disabled || disabled) return;
    if (input.checked && sourceCount() <= 1) {
      setSourceMessage('Keep at least one source selected.');
      input.checked = true;
      return;
    }
    input.checked = !input.checked;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function keepOpen() {
    open();
    window.setTimeout(open, 0);
  }

  function setScope(value) {
    const sources = sourcesForScope(value);
    inputs.forEach((input) => {
      input.checked = sources.includes(input.value);
    });
    ensureOneSourceSelected();
    refresh();
    return currentScope();
  }

  function setDisabled(value) {
    disabled = Boolean(value);
    inputs.forEach((input) => {
      input.disabled = disabled;
    });
    if (button) button.disabled = disabled;
    if (disabled) close();
  }

  function contains(target) {
    return Boolean(target && (button?.contains(target) || popover?.contains(target)));
  }

  inputs.forEach((input) => {
    input.addEventListener('change', () => notifyChange(input));
  });

  if (button) {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      toggle();
    });
  }

  if (popover) {
    ['pointerdown', 'mousedown', 'click'].forEach((eventName) => {
      popover.addEventListener(eventName, (event) => event.stopPropagation());
    });
    popover.querySelectorAll('.srcpick-row').forEach((row) => {
      const input = row.querySelector('input[name="scope"]');
      row.setAttribute('role', 'checkbox');
      row.setAttribute('tabindex', '0');
      row.setAttribute('aria-checked', input?.checked ? 'true' : 'false');
      row.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        toggleInput(input);
        keepOpen();
      });
      row.addEventListener('keydown', (event) => {
        if (event.key !== ' ' && event.key !== 'Enter') return;
        event.preventDefault();
        event.stopPropagation();
        toggleInput(input);
        keepOpen();
      });
    });
  }

  refresh();
  window.addEventListener('resize', schedulePosition);
  if (scrollContainer) scrollContainer.addEventListener('scroll', schedulePosition, { passive: true });

  return {
    close,
    contains,
    currentScope,
    selectedSources,
    setDisabled,
    setScope,
    sourceCount,
    refresh
  };
}

export { createSourcePicker };
