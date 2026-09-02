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

// The attribute is ALWAYS set: 'system' resolves against the OS setting
// (and follows it live), so both the legacy token blocks and Tailwind's
// single [data-theme='dark'] variant see one source of truth.
function applyTheme(theme: ThingyTheme) {
  const root = document.documentElement;
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  root.dataset.theme = dark ? 'dark' : 'light';
}

function initTheme() {
  applyTheme(storedTheme());
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const onChange = () => {
    if (storedTheme() === 'system') applyTheme('system');
  };
  if (typeof media.addEventListener === 'function') media.addEventListener('change', onChange);
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
