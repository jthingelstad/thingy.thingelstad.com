import { type RefObject } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { type Signal } from '@preact/signals';

function readBooleanPreference(key: string) {
  try {
    return window.localStorage.getItem(key) === '1';
  } catch (_error) {
    return false;
  }
}

function usePersistedBooleanSignal(signal: Signal<boolean>, key: string, value: boolean) {
  const restoredRef = useRef(false);
  useEffect(() => {
    signal.value = readBooleanPreference(key);
  }, [key, signal]);

  useEffect(() => {
    if (!restoredRef.current) {
      restoredRef.current = true;
      return;
    }
    try {
      window.localStorage.setItem(key, value ? '1' : '0');
    } catch (_error) {
      /* private browsing */
    }
  }, [key, value]);
}

function resizeTextarea(input: HTMLTextAreaElement | null) {
  if (!input) return;
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 240)}px`;
}

function useAutosizeTextarea(inputRef: RefObject<HTMLTextAreaElement>, value: string) {
  useEffect(() => resizeTextarea(inputRef.current), [inputRef, value]);
}

function useMeasuredComposer(
  inputRef: RefObject<HTMLTextAreaElement>,
  composerRef: RefObject<HTMLDivElement>,
  panelRef: RefObject<HTMLDivElement>,
  value: string,
  mounted: boolean
) {
  useEffect(() => {
    function update() {
      resizeTextarea(inputRef.current);
      const composer = composerRef.current;
      if (composer && panelRef.current) {
        panelRef.current.style.setProperty(
          '--composer-reserve',
          `${Math.ceil(composer.getBoundingClientRect().height)}px`
        );
      }
    }

    update();
    const composer = composerRef.current;
    if (!composer || !('ResizeObserver' in window)) return undefined;
    const observer = new ResizeObserver(update);
    observer.observe(composer);
    window.addEventListener('resize', update);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [composerRef, inputRef, mounted, panelRef, value]);
}

export { readBooleanPreference, resizeTextarea, useAutosizeTextarea, useMeasuredComposer, usePersistedBooleanSignal };
