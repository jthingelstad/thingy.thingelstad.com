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
  const redirect = entry.indexOf("new URL('/signin/'");
  const renderCall = entry.indexOf('createRoot(host).render');

  assert.ok(redirect > -1 && renderCall > -1);
  assert.ok(redirect < renderCall, 'login_token/email params must divert to sign-in before the chat app mounts');
  // The credentials must ride along - signInUrl('/chat/') built a clean
  // URL and silently dropped the magic token and email prefill.
  assert.ok(entry.includes("searchParams.set('login_token', loginToken)"));
  assert.ok(entry.includes("searchParams.set('email', emailParam)"));
});

test('magic links landing on the home page forward the token to /signin/', async () => {
  const entry = await source('../src/pages/home.ts');
  const redirect = entry.indexOf('/signin/?login_token=');
  const analytics = entry.indexOf('loadTinylytics()');
  assert.ok(redirect > -1, 'home boot must consume login_token (emailed links land on the site root)');
  assert.ok(redirect < analytics, 'forward before analytics scrubs the param');
});
