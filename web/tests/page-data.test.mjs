// The static pages' build-time data: the sites strip (vendored
// contracts/sites.json) and the archive counts (content/archive-stats.json).
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const {
  SITES_STRIP_MARKER,
  formatStat,
  loadArchiveStats,
  loadSites,
  pageDataPlugin,
  renderArchiveStats,
  renderSitesStrip,
  stripSites
} = await import('../vite.page-data.ts');

const WEB_ROOT = fileURLToPath(new URL('..', import.meta.url));
const STRIP_PAGES = ['index.html', 'about/index.html', 'connect/index.html'];
const NO_STRIP_PAGES = [
  'chat/index.html',
  'signin/index.html',
  'c/index.html',
  'connect/reference/index.html',
  'public/404.html'
];

async function source(path) {
  return await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

function decode(text) {
  return text
    .replaceAll('&#39;', "'")
    .replaceAll('&quot;', '"')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

test('the sites strip matches the vendored sites.json', () => {
  const sites = loadSites(WEB_ROOT);
  const expected = sites.filter((site) => site.in_publishing_system);
  assert.ok(expected.length > 0, 'at least one site is in the publishing system');
  assert.ok(
    sites.some((site) => !site.in_publishing_system),
    'the fixture still exercises the exclusion'
  );

  const html = renderSitesStrip(sites);
  assert.match(html, /^<nav class="thingy-sites-strip" aria-label="Jamie's sites"><ul>/);
  const links = [...html.matchAll(/<a href="([^"]+)"( aria-current="true")? title="([^"]+)">([^<]+)<\/a>/g)];
  assert.deepEqual(
    links.map(([, href, current, title, text]) => ({
      href,
      current: Boolean(current),
      title: decode(title),
      text: decode(text)
    })),
    expected.map((site) => ({
      href: site.url,
      current: site.id === 'thingy',
      title: site.description,
      text: site.short_name
    }))
  );
  assert.equal(links.filter((link) => link[2]).length, 1, 'exactly one site is current');
  assert.deepEqual(stripSites(sites), expected);
});

test('the strip sits on /, /about/ and /connect/ only', async () => {
  for (const page of STRIP_PAGES) {
    const html = await source(page);
    assert.equal(html.split(SITES_STRIP_MARKER).length, 2, `${page} has one sites-strip marker`);
  }
  for (const page of NO_STRIP_PAGES) {
    assert.ok(!(await source(page)).includes(SITES_STRIP_MARKER), `${page} has no sites strip`);
  }
});

test('every archive count on the static pages comes from archive-stats.json', async () => {
  const stats = loadArchiveStats(WEB_ROOT);
  assert.equal(stats.links_total, stats.weekly.links + stats.blog.links, 'links_total is the two corpora summed');
  const plugin = pageDataPlugin(WEB_ROOT);
  for (const page of STRIP_PAGES) {
    const html = await source(page);
    assert.ok(html.includes('{{archive.'), `${page} quotes the shared counts`);
    const out = plugin.transformIndexHtml(html);
    assert.ok(!out.includes('{{'), `${page} renders every token`);
    assert.ok(!out.includes(SITES_STRIP_MARKER), `${page} renders the strip`);
  }
  // The counts Connect and About used to hand-type separately.
  const about = plugin.transformIndexHtml(await source('about/index.html'));
  const connect = plugin.transformIndexHtml(await source('connect/index.html'));
  for (const count of [stats.blog.posts, stats.weekly.issues, stats.photos]) {
    const text = count.toLocaleString('en-US');
    assert.ok(about.includes(text), `/about/ shows ${text}`);
    assert.ok(connect.includes(text), `/connect/ shows ${text}`);
  }
});

test('archive tokens format counts, keep years bare and fail loud', () => {
  const stats = { weekly: { issues: 352, since: 2017 }, blog: { posts: 10444 } };
  assert.equal(
    renderArchiveStats('{{archive.blog.posts}} posts; issues since {{archive.weekly.since}}', stats),
    '10,444 posts; issues since 2017'
  );
  assert.throws(() => renderArchiveStats('{{archive.blog.photos}}', stats), /no value at blog\.photos/);
  assert.throws(() => formatStat('weekly', stats.weekly), /no value at weekly/);
  assert.equal(formatStat('as_of', '2026-10-01'), '2026-10-01');
  const plugin = pageDataPlugin(WEB_ROOT);
  assert.throws(() => plugin.transformIndexHtml('{{archive.Bad}}'), /left unrendered/);
  assert.equal(plugin.transformIndexHtml('<p>plain</p>'), '<p>plain</p>');
});
