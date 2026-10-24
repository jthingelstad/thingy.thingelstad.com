// Which referrers let a signed-in reader's seeded ?prompt= auto-send
// (src/shared/thingy-referrer.ts, audit W3), and the `from` map entry for
// Things I've built.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const { promptAutoSendFrom } = await import('../src/shared/thingy-referrer.ts');
const { SITE } = await import('../vite.shared-config.ts');

const OWN_HOST = 'thingy.thingelstad.com';

test("Jamie's sites and in-site navigation auto-send a seeded prompt", () => {
  for (const referrer of [
    'https://thingy.thingelstad.com/',
    'https://thingelstad.com/',
    'https://www.thingelstad.com/2024/03/02/espresso.html',
    'https://weekly.thingelstad.com/archive/353/',
    'https://another.thingelstad.com/12/',
    // Things I've built (Jamie, 2026-10-21: "Yes").
    'https://thingelstad.xyz/',
    'https://thingelstad.xyz/things/thingy/',
    'https://THINGELSTAD.XYZ/things/'
  ]) {
    assert.equal(promptAutoSendFrom(referrer, OWN_HOST), true, `${referrer} is trusted`);
  }
  assert.equal(promptAutoSendFrom('http://localhost:8080/chat/', 'localhost'), true, 'in-site navigation is trusted');
});

test('look-alikes and every other referrer only prefill', () => {
  for (const referrer of [
    '',
    'not a url',
    'https://example.com/',
    'https://thingelstad.xyz.evil.example/',
    'http://thingelstad.xyz/',
    'https://www.thingelstad.xyz/',
    'https://evil.thingelstad.xyz/',
    'https://thingelstad.xyz:8443/',
    'https://notthingelstad.xyz/',
    'https://thingelstad.com.evil.example/',
    'https://evilthingelstad.com/'
  ]) {
    assert.equal(promptAutoSendFrom(referrer, OWN_HOST), false, `${referrer || '(empty)'} is not trusted`);
  }
});

test("the from map names Things I've built from sites.json", async () => {
  const { sites } = JSON.parse(await readFile(new URL('../contracts/sites.json', import.meta.url), 'utf8'));
  const xyz = sites.find((site) => site.id === 'xyz');
  const entry = SITE.networkLinks.find((link) => link.href === xyz.url);
  assert.ok(entry, 'thingelstad.xyz has a from entry');
  assert.equal(entry.label, xyz.name);
  assert.equal(entry.label, 'Things I’ve built');

  // resolveFromValue reads the links from the page config.
  globalThis.window = { ThingyConfig: { networkLinks: SITE.networkLinks } };
  globalThis.document = { querySelector: () => null };
  const { resolveFromValue } = await import('../src/shared/thingy-from.ts');
  assert.deepEqual(resolveFromValue('https://thingelstad.xyz/things/thingy/'), {
    name: 'Things I’ve built',
    href: 'https://thingelstad.xyz/things/thingy/'
  });
  assert.deepEqual(resolveFromValue('projects'), { name: 'Things I’ve built', href: 'https://thingelstad.xyz/' });
  assert.equal(resolveFromValue('https://thingelstad.xyz.evil.example/'), null, 'a look-alike host is unknown');
  assert.equal(resolveFromValue('https://weekly.thingelstad.com/archive/353/').name, 'Weekly Thing');
});
