import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function source(path) {
  return await readFile(new URL(path, import.meta.url), 'utf8');
}

test('the app boot reads URL params before Tinylytics strips them', async () => {
  const boot = await source('../src/app/boot.ts');
  const entry = await source('../src/app/main.tsx');

  assert.ok(boot.indexOf('new URLSearchParams(window.location.search)') > -1, 'boot.ts captures the params');
  assert.ok(entry.indexOf("import { bootParams } from './boot.ts';") > -1, 'main.tsx reads via boot.ts');
  assert.ok(entry.indexOf('loadTinylytics();') > -1);
  assert.ok(
    entry.indexOf('bootParams.get(') < entry.indexOf('loadTinylytics();'),
    'params must be consumed before loadTinylytics so prompt/from/explore are seen before analytics scrubbing'
  );
  assert.ok(
    entry.indexOf('window.location.search') === -1,
    'route code must read bootParams, never the live (scrubbed) URL'
  );
});

test('explicit sign-in intents route to /signin/ before the app renders', async () => {
  const entry = await source('../src/app/main.tsx');
  const redirect = entry.indexOf('session.signInUrl');
  const renderCall = entry.indexOf('createRoot(host).render');

  assert.ok(redirect > -1 && renderCall > -1);
  assert.ok(redirect < renderCall, 'login_token/email params must divert to sign-in before the chat app mounts');
});
