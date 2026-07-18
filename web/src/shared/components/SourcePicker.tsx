import { type JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { type Signal } from '@preact/signals';
import { scopeForSources } from '../thingy-scope.ts';
import { ThingyIcon } from './ThingyIcon.tsx';

const SOURCES = [
  { id: 'weekly_thing', name: 'Weekly Thing', detail: 'Issues, links, FAQ', dot: 'dot-wt' },
  { id: 'blog', name: 'Blog', detail: 'thingelstad.com', dot: 'dot-blog' },
  { id: 'podcast', name: 'Another Thing', detail: 'Podcast transcripts', dot: 'dot-podcast' }
];

interface SourcePickerProps {
  selected: Signal<string[]>;
  disabled?: boolean;
  scrollContainer?: HTMLElement | null;
  onChange?: (scope: string) => void;
}

function selectionCopy(selected: string[]) {
  const active = SOURCES.filter((source) => selected.includes(source.id));
  if (active.length === SOURCES.length) {
    return { label: 'All sources', note: 'Thingy can draw from all three sources.' };
  }
  if (active.length === 1) {
    return { label: active[0].name, note: `Thingy will only draw from ${active[0].name}.` };
  }
  return {
    label: active.map((source) => source.name).join(' + '),
    note: `Thingy can draw from ${active.length} of ${SOURCES.length} sources.`
  };
}

function SourcePicker({ selected, disabled = false, scrollContainer = null, onChange }: SourcePickerProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const values = selected.value;
  const copy = selectionCopy(values);

  function positionPopover() {
    const button = buttonRef.current;
    const popover = popoverRef.current;
    if (!button || !popover || !open) return;
    const margin = 12;
    const gap = 8;
    const buttonRect = button.getBoundingClientRect();
    const popRect = popover.getBoundingClientRect();
    const width = Math.min(264, Math.max(220, window.innerWidth - margin * 2));
    const left = Math.min(Math.max(buttonRect.left, margin), window.innerWidth - width - margin);
    const above = buttonRect.top - popRect.height - gap;
    const below = buttonRect.bottom + gap;
    const top = above >= margin ? above : Math.min(below, window.innerHeight - popRect.height - margin);
    popover.style.setProperty('--srcpick-pop-width', `${width}px`);
    popover.style.setProperty('--srcpick-pop-left', `${Math.round(left)}px`);
    popover.style.setProperty('--srcpick-pop-top', `${Math.round(Math.max(margin, top))}px`);
  }

  useEffect(() => {
    if (!open) return undefined;
    const frame = window.requestAnimationFrame(positionPopover);
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('resize', positionPopover);
    scrollContainer?.addEventListener('scroll', positionPopover, { passive: true });
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('resize', positionPopover);
      scrollContainer?.removeEventListener('scroll', positionPopover);
    };
    // Positioning is an imperative layout edge; the current render's helper
    // is intentionally installed only when the popover opens or its scroll
    // container changes.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [open, scrollContainer]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  function handleChange(event: JSX.TargetedEvent<HTMLInputElement, Event>) {
    const id = event.currentTarget.value;
    const next = event.currentTarget.checked ? [...values, id] : values.filter((value) => value !== id);
    const ordered = SOURCES.map((source) => source.id).filter((value) => next.includes(value));
    if (!ordered.length) {
      setMessage('Keep at least one source selected.');
      return;
    }
    setMessage('');
    selected.value = ordered;
    onChange?.(scopeForSources(ordered));
  }

  return (
    <div ref={rootRef} class="srcpick">
      <button
        ref={buttonRef}
        class="srcpick-btn"
        type="button"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="srcpick-pop"
        onClick={() => setOpen(!open)}
      >
        <ThingyIcon name="layers" />
        <span class="srcpick-label">{copy.label}</span>
        <span class="srcpick-dots" aria-hidden="true">
          {SOURCES.filter((source) => values.includes(source.id)).map((source) => (
            <i key={source.id} class={source.dot} />
          ))}
        </span>
        <span class="chev">
          <ThingyIcon name="chevron-down" />
        </span>
      </button>
      <div
        ref={popoverRef}
        class="srcpick-pop"
        id="srcpick-pop"
        hidden={!open}
        role="dialog"
        aria-label="Active sources"
      >
        <div class="srcpick-pop-head">
          <span class="srcpick-pop-title">Active sources</span>
        </div>
        {SOURCES.map((source) => (
          <label key={source.id} class="srcpick-row">
            <input
              type="checkbox"
              name="scope"
              value={source.id}
              checked={values.includes(source.id)}
              disabled={disabled}
              onChange={handleChange}
            />
            <span class={`rdot ${source.dot}`} aria-hidden="true" />
            <span class="meta">
              <strong>{source.name}</strong>
              <small>{source.detail}</small>
            </span>
            <span class="tick" aria-hidden="true">
              <ThingyIcon name="check" />
            </span>
          </label>
        ))}
        <p class="srcpick-pop-note">{message || copy.note}</p>
      </div>
    </div>
  );
}

export { SourcePicker };
