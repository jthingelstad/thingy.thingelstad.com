// Reader theme preference: system (default, no attribute), light, or dark.
// The stored choice is stamped as data-theme on <html>; the token blocks in
// thingy-base.css resolve it (media query for system, attribute overrides
// for explicit choices). initTheme() runs at the top of every page entry so
// the attribute lands before first paint.

type ThingyTheme = 'system' | 'light' | 'dark';

const THEME_KEY = 'thingyTheme';

function storedTheme(): ThingyTheme {
  try {
    const value = window.localStorage.getItem(THEME_KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

function applyTheme(theme: ThingyTheme) {
  const root = document.documentElement;
  if (theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = theme;
}

function initTheme() {
  applyTheme(storedTheme());
}

function setTheme(theme: ThingyTheme) {
  try {
    if (theme === 'system') window.localStorage.removeItem(THEME_KEY);
    else window.localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* private browsing: applies for this page only */
  }
  applyTheme(theme);
}

export { initTheme, setTheme, storedTheme };
export type { ThingyTheme };
