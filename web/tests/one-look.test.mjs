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
      'family=Inter:wght@400;600'
    ]) {
      assert.ok(link[0].includes(family), `${shell} loads ${family}`);
    }
    // The CSP must allow exactly the Google Fonts hosts - no wider.
    assert.match(html, /style-src 'self' 'unsafe-inline' https:\/\/fonts\.googleapis\.com;/);
    assert.match(html, /font-src https:\/\/fonts\.gstatic\.com;/);
  }
});

// The Weekly citation chip and source card draw their W disc in Source
// Serif 4 italic 600, so every shell that renders answers must load it.
test('answer shells load the Weekly W face', async () => {
  for (const shell of ['chat/index.html', 'c/index.html']) {
    const html = await source(shell);
    const link = html.match(/https:\/\/fonts\.googleapis\.com\/css2\?[^"]+/);
    assert.ok(link[0].includes('family=Source+Serif+4:ital,opsz,wght@1,8..60,600'), `${shell} loads Source Serif 4`);
  }
});

// One favicon everywhere: the static mascot face (2026-10-21; it replaced
// the old clay W). The ?v= busts the browsers' week-long SVG cache, so bump
// it on every shell together when the artwork changes.
test('every shell links the same mascot favicon', async () => {
  const favicon = await source('public/favicon.svg');
  assert.ok(favicon.includes('stroke="#b9f0b1"'), 'the favicon is the mint screen face');
  assert.ok(!favicon.includes('<text'), 'the favicon carries no lettering');
  const hrefs = new Set();
  for (const shell of SHELLS) {
    const html = await source(shell);
    const icons = [...html.matchAll(/<link rel="icon" href="([^"]+)" type="image\/svg\+xml"\s*\/?>/g)];
    assert.equal(icons.length, 1, `${shell} links one SVG favicon`);
    assert.ok(!/<link rel="icon"[^>]*thingy\.png/.test(html), `${shell} no longer uses the robot PNG as its favicon`);
    hrefs.add(icons[0][1]);
    assert.match(html, /<link rel="apple-touch-icon"/, `${shell} keeps the apple-touch icon`);
  }
  assert.deepEqual([...hrefs], ['/favicon.svg?v=2'], 'every shell links the same cache-busted favicon');
});

// The strip and the source labels use every site's shared colour
// (thingelstad.com AGENTS.md "The sites strip", shared/tokens.css). Another
// Thing moved to crimson and Things I've built to green on 2026-10-22
// (Jamie: "Approved: phase 2 colours, Another Thing to crimson and
// thingelstad.xyz to green across their sites, favicons and the sites
// strip"); the blog stays ink.
test('the strip and the source labels carry the shared site colours', async () => {
  const marks = {};
  for (const match of (await source('src/styles/thingy-static.css')).matchAll(
    /\.sites-strip__item--([a-z]+) a,\s*\.sites-strip__item--\1 a:hover \{\s*color: (#[0-9a-f]{6});/g
  )) {
    marks[match[1]] = match[2];
  }
  assert.deepEqual(marks, { weekly: '#1a5eb6', another: '#b3123f', thingy: '#b5461a', xyz: '#1d7348' });
  const sites = JSON.parse(await source('contracts/sites.json')).sites;
  for (const id of Object.keys(marks)) {
    assert.ok(
      sites.some((site) => site.id === id && site.in_sites_strip),
      `${id} is a strip site`
    );
  }
  const base = await source('src/styles/thingy-base.css');
  assert.match(base, /--thingy-another: #b3123f;/, 'Another Thing is the shared crimson');
  assert.match(base, /--thingy-xyz: #1d7348;/, "Things I've built is the shared green");
  for (const file of await sourceFiles('src')) {
    assert.ok(!(await source(file)).toLowerCase().includes('#c63a20'), `${file} still has the old Another Thing red`);
  }
});
