// The static pages' build-time data: the sites strip, Jamie's h-card and
// rel=me links, and the family tiles (vendored contracts/sites.json), and
// the archive counts (content/archive-stats.json).
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const {
  OWNER_HCARD_MARKER,
  REL_ME_MARKER,
  SITES_STRIP_MARKER,
  formatStat,
  loadArchiveStats,
  loadOwner,
  loadSites,
  pageDataPlugin,
  renderArchiveStats,
  renderOwnerHcard,
  renderRelMe,
  renderSiteTokens,
  renderSitesStrip,
  stripSites
} = await import('../vite.page-data.ts');

const WEB_ROOT = fileURLToPath(new URL('..', import.meta.url));
// Every public static page opens with the strip; chat, sign-in, share and
// 404 never carry it (Jamie, 2026-10-01: "Chat should NOT get the bar.").
const STRIP_PAGES = ['index.html', 'about/index.html', 'connect/index.html', 'connect/reference/index.html'];
const NO_STRIP_PAGES = ['chat/index.html', 'signin/index.html', 'c/index.html', 'public/404.html'];
// The pages that quote archive counts.
const ARCHIVE_PAGES = ['index.html', 'about/index.html', 'connect/index.html'];

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

const ITEM =
  /<li class="sites-strip__item sites-strip__item--([a-z0-9-]+)( sites-strip__item--current)?"><a href="([^"]+)" title="([^"]+)"( aria-current="true")?>([^<]+)<\/a><\/li>/g;

test('the sites strip renders the shared contract from the vendored sites.json', () => {
  const sites = loadSites(WEB_ROOT);
  const expected = sites.filter((site) => site.in_sites_strip);
  assert.ok(expected.length > 1, 'more than one site is in the strip');
  assert.ok(
    sites.some((site) => !site.in_sites_strip),
    'the fixture still exercises the exclusion'
  );
  assert.ok(
    expected.some((site) => site.id === 'xyz' && !site.in_publishing_system),
    'thingelstad.xyz is in the strip though it is outside the publishing system'
  );
  assert.ok(!expected.some((site) => site.id === 'escape'), 'Escaping Things stays out');

  const html = renderSitesStrip(sites);
  assert.match(
    html,
    /^<nav class="sites-strip" aria-label="Jamie Thingelstad"><div class="sites-strip__inner"><span class="sites-strip__label">Jamie Thingelstad<\/span><ul class="sites-strip__list"><li /
  );
  assert.match(html, /<\/li><\/ul><\/div><\/nav>$/);
  const items = [...html.matchAll(ITEM)];
  assert.equal(html.match(/<li /g).length, items.length, 'every item matches the contract markup');
  assert.deepEqual(
    items.map(([, id, currentClass, href, title, currentAria, text]) => ({
      id,
      currentClass: Boolean(currentClass),
      currentAria: Boolean(currentAria),
      href,
      title: decode(title),
      text: decode(text)
    })),
    expected.map((site) => ({
      id: site.id,
      currentClass: site.id === 'thingy',
      currentAria: site.id === 'thingy',
      href: `${site.url}?ref=sites-strip-thingy`,
      title: site.description,
      text: site.strip_label
    }))
  );
  assert.equal(items.filter((item) => item[2]).length, 1, 'exactly one site is current');
  assert.ok(html.includes('>Ask Thingy</a>') && !html.includes('>Thingy</a>'), 'Thingy reads as on every other site');
  assert.ok(html.includes('>Blog</a>') && !html.includes('>Jamie Thingelstad</a>'), 'the blog shows its strip label');
  assert.ok(
    html.includes('>Projects</a>') && !html.includes('>Things I’ve built</a>'),
    'thingelstad.xyz shows its strip label'
  );
  assert.deepEqual(stripSites(sites), expected);
});

test('the sites strip escapes every value', () => {
  const html = renderSitesStrip([
    {
      id: 'a"b',
      name: 'Name',
      short_name: 'Short',
      strip_label: '<b>Bold</b> & "quoted"',
      url: 'https://example.com/?a=1&b="2"',
      description: 'Tag <i> & "quote"',
      in_sites_strip: true
    }
  ]);
  assert.ok(!html.includes('<b>') && !html.includes('<i>'), 'no markup leaks from the data');
  assert.ok(html.includes('sites-strip__item--a&quot;b"'));
  assert.ok(html.includes('href="https://example.com/?a=1&amp;b=&quot;2&quot;&amp;ref=sites-strip-thingy"'));
  assert.ok(html.includes('title="Tag &lt;i&gt; &amp; &quot;quote&quot;"'));
  assert.ok(html.includes('>&lt;b&gt;Bold&lt;/b&gt; &amp; &quot;quoted&quot;</a>'));
  assert.ok(!html.includes('aria-current'), 'no current site when Thingy is not listed');
});

test('the strip sits on the static pages and never on chat, sign-in, share or 404', async () => {
  const plugin = pageDataPlugin(WEB_ROOT);
  for (const page of STRIP_PAGES) {
    const html = await source(page);
    assert.equal(html.split(SITES_STRIP_MARKER).length, 2, `${page} has one sites-strip marker`);
    const out = plugin.transformIndexHtml(html);
    assert.equal(out.split('<nav class="sites-strip"').length, 2, `${page} renders one strip`);
    assert.ok(
      out.indexOf('<nav class="sites-strip"') < out.indexOf('<header class="thingy-page-nav is-site">'),
      `${page} opens with the strip, above the header`
    );
  }
  for (const page of NO_STRIP_PAGES) {
    const html = await source(page);
    assert.ok(!html.includes(SITES_STRIP_MARKER), `${page} has no sites-strip marker`);
    assert.ok(!html.includes('sites-strip'), `${page} has no hand-written strip`);
    assert.ok(!plugin.transformIndexHtml(html).includes('sites-strip'), `${page} builds without the strip`);
  }
});

test('every archive count on the static pages comes from archive-stats.json', async () => {
  const stats = loadArchiveStats(WEB_ROOT);
  assert.equal(stats.links_total, stats.weekly.links + stats.blog.links, 'links_total is the two corpora summed');
  const plugin = pageDataPlugin(WEB_ROOT);
  for (const page of ARCHIVE_PAGES) {
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

test('the archive years are derived from the blog start year, never typed', () => {
  const stats = loadArchiveStats(WEB_ROOT);
  assert.equal(stats.blog.since, 2004, 'the blog started in 2004');
  assert.equal(stats.years, Number(stats.as_of.slice(0, 4)) - stats.blog.since);
  assert.equal(
    formatStat('weekly.latest', stats.weekly.latest),
    String(stats.weekly.latest),
    'issue numbers print bare'
  );
});

test('site tokens print sites.json values and fail loud on an unknown one', () => {
  const sites = loadSites(WEB_ROOT);
  assert.equal(renderSiteTokens('{{site.xyz.url}}', sites), 'https://thingelstad.xyz/');
  assert.equal(renderSiteTokens('{{site.xyz.name}}', sites), 'Things I’ve built');
  assert.throws(() => renderSiteTokens('{{site.nope.url}}', sites), /no url for site nope/);
  assert.throws(() => renderSiteTokens('{{site.xyz.colour}}', sites), /no colour for site xyz/);
  assert.throws(() => pageDataPlugin(WEB_ROOT).transformIndexHtml('{{site.Bad}}'), /left unrendered/);
});

test('the h-card and rel=me links render the shared owner block', () => {
  const owner = loadOwner(WEB_ROOT);
  assert.equal(
    renderOwnerHcard(owner),
    `<a class="h-card" href="${owner.url}" rel="me author"><img class="u-photo" src="${owner.avatar}" alt="" width="28" height="28">` +
      `<span class="p-name">${owner.name}</span><data class="u-url" value="${owner.url}"></data>` +
      `<data class="p-note" value="${owner.note}"></data></a>`
  );
  assert.ok(owner.rel_me.length > 0, 'the owner has rel=me links');
  assert.equal(renderRelMe(owner), owner.rel_me.map((url) => `<link rel="me" href="${url}">`).join(''));
  const html = renderOwnerHcard({ ...owner, name: '<b>J</b>', note: 'a "note"' });
  assert.ok(!html.includes('<b>') && html.includes('value="a &quot;note&quot;"'), 'owner values are escaped');
});

test('the static pages carry the h-card and rel=me; chat, sign-in, share and 404 do not', async () => {
  const owner = loadOwner(WEB_ROOT);
  const plugin = pageDataPlugin(WEB_ROOT);
  for (const page of STRIP_PAGES) {
    const html = await source(page);
    assert.equal(html.split(OWNER_HCARD_MARKER).length, 2, `${page} has one h-card marker`);
    assert.equal(html.split(REL_ME_MARKER).length, 2, `${page} has one rel-me marker`);
    const out = plugin.transformIndexHtml(html);
    const footer = out.slice(out.indexOf('<footer'));
    assert.ok(footer.includes(renderOwnerHcard(owner)), `${page} has the h-card in its footer`);
    const head = out.slice(0, out.indexOf('</head>'));
    for (const url of owner.rel_me)
      assert.ok(head.includes(`<link rel="me" href="${url}">`), `${page} links rel=me ${url}`);
    assert.match(head, /img-src[^;"]*https:\/\/avatars\.micro\.blog/, `${page} lets the avatar load under its CSP`);
    assert.ok(!/href="[^"]*ref=[^"]*" rel="me/.test(out), `${page} identity links carry no ref`);
  }
  for (const page of NO_STRIP_PAGES) {
    const out = plugin.transformIndexHtml(await source(page));
    assert.ok(!out.includes('h-card') && !out.includes('rel="me"'), `${page} carries no h-card or rel=me`);
  }
});

// Linking Things joined the strip on 2026-10-23, but Thingy does not read it
// yet, so it has no tile under "Thingy reads them all" until the Librarian
// ingests it. A tile before then is Jamie's call.
const NOT_READ_BY_THINGY = new Set(['links']);

test('the home family tiles list every sister site Thingy reads, with ?ref=thingy-family', async () => {
  const sites = loadSites(WEB_ROOT);
  const out = pageDataPlugin(WEB_ROOT).transformIndexHtml(await source('index.html'));
  const family = out.slice(
    out.indexOf('<ul class="thingy-family">'),
    out.indexOf('</ul>', out.indexOf('<ul class="thingy-family">'))
  );
  const hrefs = [...family.matchAll(/<a class="thingy-family-tile" href="([^"]+)"/g)].map(([, href]) => href);
  const sisters = stripSites(sites).filter((site) => site.id !== 'thingy');
  assert.deepEqual(
    hrefs.filter((href) => href !== '/').sort(),
    sisters
      .filter((site) => !NOT_READ_BY_THINGY.has(site.id))
      .map((site) => `${site.url}?ref=thingy-family`)
      .sort()
  );
  assert.ok(
    family.includes('<a class="thingy-family-tile" href="/" aria-current="page">'),
    'the Thingy tile is home, with no ref'
  );
  assert.ok(
    family.includes('class="thingy-family-face is-xyz"') && family.includes('>Things I’ve built<'),
    'Things I’ve built has a tile'
  );
  assert.ok(out.includes('Thingy reads them all'), 'the kicker states no count');
  // The home JSON-LD Person names every site and identity Jamie has.
  const ld = JSON.parse(out.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  const person = findPerson(ld);
  assert.ok(person, 'the home JSON-LD has a Person');
  const owner = loadOwner(WEB_ROOT);
  for (const url of [owner.url, ...sisters.map((site) => site.url), ...owner.rel_me]) {
    assert.ok(person.sameAs.includes(url) || person.url === url, `the Person names ${url}`);
  }
});

function findPerson(node) {
  if (Array.isArray(node)) return node.map(findPerson).find(Boolean) || null;
  if (!node || typeof node !== 'object') return null;
  if (node['@type'] === 'Person') return node;
  return Object.values(node).map(findPerson).find(Boolean) || null;
}

test('no page says the blog began in 2000 or is twenty-five years old', async () => {
  const plugin = pageDataPlugin(WEB_ROOT);
  for (const page of [...STRIP_PAGES, ...NO_STRIP_PAGES]) {
    const out = plugin.transformIndexHtml(await source(page)).replace(/<svg[\s\S]*?<\/svg>/g, '');
    assert.ok(
      !/twenty-five|quarter century|back to 2000|since 2000|25 years/i.test(out),
      `${page} keeps the blog at 2004`
    );
  }
  for (const file of ['src/shared/thingy-say-hi.ts', 'src/react/hooks/useAgentWelcome.ts', 'src/react/ShareApp.tsx']) {
    const text = await source(file);
    assert.ok(
      !/twenty-five|quarter century|back to 2000|since 2000|25 years/i.test(text),
      `${file} keeps the blog at 2004`
    );
  }
});
