import { useCallback, useSyncExternalStore } from 'react';

// Phone width: below Tailwind's md breakpoint, where the rail is a drawer
// and dialogs become bottom sheets (thingy-app-ui.css uses the same edge).
export const PHONE_QUERY = '(max-width: 767.98px)';

export function useMediaQuery(query: string) {
  const subscribe = useCallback(
    (notify: () => void) => {
      const list = window.matchMedia?.(query);
      if (!list) return () => {};
      list.addEventListener('change', notify);
      return () => list.removeEventListener('change', notify);
    },
    [query]
  );
  return useSyncExternalStore(
    subscribe,
    () => Boolean(window.matchMedia?.(query).matches),
    () => false
  );
}
