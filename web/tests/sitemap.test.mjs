// /sitemap.xml is built from git history (vite.sitemap.ts): every <url>
// carries a W3C datetime <lastmod>, the date its page's sources last
// changed, never the build time.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const { SITEMAP_PAGES, buildSitemap, lastChanged, sitemapPlugin } = await import('../vite.sitemap.ts');

const webRoot = fileURLToPath(new URL('..', import.meta.url));
const W3C_DATETIME = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2}))?$/;

test('every url has a valid lastmod', () => {
  const xml = buildSitemap(webRoot);
  const urls = [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((match) => match[1]);
  assert.equal(urls.length, SITEMAP_PAGES.length);
  for (const url of urls) {
    const lastmod = /<lastmod>([^<]+)<\/lastmod>/.exec(url)?.[1];
    assert.ok(lastmod, `no lastmod in ${url}`);
    assert.match(lastmod, W3C_DATETIME);
    assert.ok(!Number.isNaN(Date.parse(lastmod)));
  }
  assert.ok(
    xml.startsWith(
      '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
    )
  );
});

test('lastmod is the last commit touching the page sources', () => {
  for (const page of SITEMAP_PAGES) {
    for (const source of page.sources) assert.ok(existsSync(new URL(`../${source}`, import.meta.url)), source);
    const expected = execFileSync('git', ['log', '-1', '--format=%cI', '--', ...page.sources], {
      cwd: webRoot,
      encoding: 'utf8'
    }).trim();
    assert.equal(lastChanged(webRoot, page.sources), expected);
    assert.ok(
      buildSitemap(webRoot).includes(
        `<loc>https://thingy.thingelstad.com${page.path}</loc>\n    <lastmod>${expected}</lastmod>`
      )
    );
  }
});

test('the sitemap lists the four indexable pages and is built, not static', () => {
  assert.deepEqual(
    SITEMAP_PAGES.map((page) => page.path),
    ['/', '/about/', '/connect/', '/connect/reference/']
  );
  assert.ok(!existsSync(new URL('../public/sitemap.xml', import.meta.url)));
  assert.equal(sitemapPlugin(webRoot).name, 'thingy-sitemap');
});
