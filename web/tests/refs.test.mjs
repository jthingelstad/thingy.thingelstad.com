// Outbound ref tags: links Thingy renders to Jamie's other sites carry
// ?ref=thingy-<placement> (src/shared/thingy-refs.ts).
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const { SISTER_HOSTS, withRef } = await import('../src/shared/thingy-refs.ts');

test('the sister hosts are the strip sites, Thingy aside', async () => {
  const { sites } = JSON.parse(await readFile(new URL('../contracts/sites.json', import.meta.url), 'utf8'));
  const hosts = sites
    .filter((site) => site.in_sites_strip && site.id !== 'thingy')
    .map((site) => new URL(site.url).hostname.replace(/^www\./, ''));
  assert.deepEqual([...SISTER_HOSTS].sort(), hosts.sort());
});

test('withRef adds the ref before any fragment and after any query', () => {
  const ref = 'thingy-source';
  assert.equal(
    withRef('https://weekly.thingelstad.com/archive/127/', ref),
    'https://weekly.thingelstad.com/archive/127/?ref=thingy-source'
  );
  assert.equal(
    withRef('https://weekly.thingelstad.com/faq/#basics', ref),
    'https://weekly.thingelstad.com/faq/?ref=thingy-source#basics'
  );
  assert.equal(withRef('https://thingelstad.xyz/?a=1#x', ref), 'https://thingelstad.xyz/?a=1&ref=thingy-source#x');
  assert.equal(withRef('https://thingelstad.xyz/?', ref), 'https://thingelstad.xyz/?ref=thingy-source');
  assert.equal(
    withRef('https://www.thingelstad.com/2024/03/02/a.html?b=2&', ref),
    'https://www.thingelstad.com/2024/03/02/a.html?b=2&ref=thingy-source'
  );
  assert.equal(withRef('http://thingelstad.com/x.html', ref), 'http://thingelstad.com/x.html?ref=thingy-source');
  assert.equal(
    withRef('https://ANOTHER.thingelstad.com/12/', 'thingy-return'),
    'https://ANOTHER.thingelstad.com/12/?ref=thingy-return'
  );
});

test('withRef keeps a link that already names a ref, and leaves other links alone', () => {
  assert.equal(
    withRef('https://weekly.thingelstad.com/?ref=email', 'thingy-source'),
    'https://weekly.thingelstad.com/?ref=email'
  );
  for (const url of [
    '',
    '/archive/127/',
    'https://example.com/',
    'https://thingy.thingelstad.com/chat/',
    'https://escape.thingelstad.com/',
    'https://notthingelstad.com/',
    'mailto:jamie@thingelstad.com',
    'not a url'
  ]) {
    assert.equal(withRef(url, 'thingy-source'), url, `${url || '(empty)'} is unchanged`);
  }
});
