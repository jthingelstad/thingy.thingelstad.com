// The Tinylytics tag (src/shared/thingy-tinylytics-loader.ts): one script for
// every site, https://tinylytics.app/js/script.js with data-site and no query
// parameters (2026-11-02). Widgets and options live in the site's Tinylytics
// settings. The old /embed/<id>/min.js?events&beacon... URL must not return,
// in the loader or in any shipped page.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const loader = await readFile(new URL('../src/shared/thingy-tinylytics-loader.ts', import.meta.url), 'utf8');

test('the loader adds the new script with data-site and no query', () => {
  assert.match(loader, /script\.defer = true;/);
  assert.match(loader, /script\.src = 'https:\/\/tinylytics\.app\/js\/script\.js';/);
  assert.match(loader, /script\.dataset\.site = tinylyticsSiteId;/);
});

test('no old embed URL in the loader or the page shells', async () => {
  const files = [
    '../src/shared/thingy-tinylytics-loader.ts',
    '../index.html',
    '../about/index.html',
    '../c/index.html',
    '../chat/index.html',
    '../connect/index.html',
    '../connect/reference/index.html',
    '../signin/index.html',
    '../public/404.html'
  ];
  for (const file of files) {
    const text = await readFile(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(text, /tinylytics\.app\/embed\//, `${file} carries the old embed`);
    assert.doesNotMatch(text, /tinylytics\.app\/js\/script\.js\?/, `${file} adds a query to the new script`);
  }
});

test('the loader never listens for route changes to re-inject the script', () => {
  // The script counts pushState/replaceState/popstate itself; re-adding it
  // per route would double count.
  assert.doesNotMatch(loader, /addEventListener\('popstate'/);
});
