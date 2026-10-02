// Felt & Tangerine (Jamie, 2026-10-01): one look, no dark mode, no theme
// switch. These guards keep the retired theme plumbing from creeping back
// and keep every shell on the same palette and fonts.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const SHELLS = [
  'index.html',
  'chat/index.html',
  'signin/index.html',
  'c/index.html',
  'about/index.html',
  'connect/index.html',
  'connect/reference/index.html',
  'public/404.html'
];

const CREAM = '#f6eedc';
const WEB_ROOT = fileURLToPath(new URL('..', import.meta.url));

async function source(path) {
  return await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

async function sourceFiles(dir) {
  const entries = await readdir(new URL(`../${dir}/`, import.meta.url), { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && /\.(ts|tsx|css)$/.test(entry.name))
    .map((entry) => relative(WEB_ROOT, join(entry.parentPath, entry.name)));
}

test('every shell has one light theme-color and no dark variant', async () => {
  for (const shell of SHELLS) {
    const html = await source(shell);
    const colors = [...html.matchAll(/<meta name="theme-color" content="([^"]+)"([^>]*)>/g)];
    assert.equal(colors.length, 1, `${shell} declares exactly one theme-color`);
    assert.equal(colors[0][1].toLowerCase(), CREAM, `${shell} theme-color is the cream ground`);
    assert.ok(!colors[0][2].includes('media'), `${shell} theme-color is unconditional`);
    assert.ok(!html.includes('prefers-color-scheme'), `${shell} has no prefers-color-scheme`);
    assert.ok(!/color-scheme[^>]*dark/.test(html), `${shell} does not opt into dark form controls`);
  }
});

test('the manifest uses the cream ground', async () => {
  const manifest = JSON.parse(await source('public/manifest.webmanifest'));
  assert.equal(manifest.theme_color.toLowerCase(), CREAM);
  assert.equal(manifest.background_color.toLowerCase(), CREAM);
});

test('no theme switch, theme store or dark palette remains in the app source', async () => {
  const files = await sourceFiles('src');
  assert.ok(files.includes('src/styles/thingy-base.css'), 'the scan reaches the token sheet');
  for (const file of files) {
    if (file.includes('/generated/')) continue;
    const text = await source(file);
    assert.ok(!text.includes('data-theme'), `${file} references data-theme`);
    assert.ok(!text.includes('prefers-color-scheme'), `${file} references prefers-color-scheme`);
    assert.ok(!text.includes('thingy-theme'), `${file} imports the retired theme module`);
    assert.ok(!/github-dark/.test(text), `${file} loads a dark code theme`);
  }
  const account = await source('src/react/AccountPanel.tsx');
  assert.ok(!/radiogroup/.test(account), 'the account menu has no System/Light/Dark control');
});

test('every shell loads the Felt & Tangerine fonts', async () => {
  for (const shell of SHELLS) {
    const html = await source(shell);
    const link = html.match(/https:\/\/fonts\.googleapis\.com\/css2\?[^"]+/);
    assert.ok(link, `${shell} links Google Fonts`);
    for (const family of [
      'family=Archivo:ital,wdth,wght',
      'family=Figtree',
      'family=JetBrains+Mono',
      'family=Source+Sans+3'
    ]) {
      assert.ok(link[0].includes(family), `${shell} loads ${family}`);
    }
    // The CSP must allow exactly the Google Fonts hosts - no wider.
    assert.match(html, /style-src 'self' 'unsafe-inline' https:\/\/fonts\.googleapis\.com;/);
    assert.match(html, /font-src https:\/\/fonts\.gstatic\.com;/);
  }
});
