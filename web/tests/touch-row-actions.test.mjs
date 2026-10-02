import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// The touch contract for row actions (Jamie 2026-10-01): where nothing can
// hover, the hover-revealed Share / Rename / Delete can never appear, so
// "More actions" must be shown instead. The React tests prove the sheet
// works; this pins the CSS that decides which one a touch screen sees.
const css = readFileSync(new URL('../src/styles/thingy-app-ui.css', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/styles/app.css', import.meta.url), 'utf8');

function block(source, opener) {
  const start = source.indexOf(opener);
  assert.notEqual(start, -1, `missing ${opener}`);
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`unclosed ${opener}`);
}

test('the SPA loads the app UI sheet in the components layer', () => {
  assert.match(app, /@import '\.\/thingy-app-ui\.css' layer\(components\);/);
});

test('More actions is hidden by default and the hover actions reveal on hover or focus', () => {
  assert.match(css, /\.thingy-row-more \{\s*display: none;/);
  assert.match(css, /\.thingy-row-actions \{\s*display: none;/);
  assert.match(
    css,
    /\.thingy-row:hover \.thingy-row-actions,\s*\.thingy-row:focus-within \.thingy-row-actions \{\s*display: flex;/
  );
});

test('a touch screen always sees More actions and never the hover actions', () => {
  const touch = block(css, '@media (hover: none), (pointer: coarse)');
  assert.match(touch, /\.thingy-row-more \{\s*display: grid;/);
  assert.match(
    touch,
    /\.thingy-row:hover \.thingy-row-actions,\s*\.thingy-row:focus-within \.thingy-row-actions \{\s*display: none;/
  );
});

test('the display headline keeps its 800 weight over preflight', () => {
  assert.match(css, /\.thingy-display \{\s*font-weight: var\(--thingy-display-weight\);/);
});
