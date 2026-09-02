import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function source(path) {
  return await readFile(new URL(path, import.meta.url), 'utf8');
}

test('chat reads URL params before Tinylytics strips them', async () => {
  const entry = await source('../src/react/chat.tsx');

  assert.ok(entry.indexOf('new URLSearchParams(window.location.search)') > -1);
  assert.ok(entry.indexOf('loadTinylytics();') > -1);
  assert.ok(
    entry.indexOf('new URLSearchParams(window.location.search)') < entry.indexOf('loadTinylytics();'),
    'params must be read before loadTinylytics so prompt/from/explore are seen before analytics scrubbing'
  );
});

test('explicit sign-in intents route to /signin/ before the app renders', async () => {
  const entry = await source('../src/react/chat.tsx');
  const redirect = entry.indexOf('session.signInUrl');
  const renderCall = entry.indexOf('createRoot(host).render');

  assert.ok(redirect > -1 && renderCall > -1);
  assert.ok(redirect < renderCall, 'login_token/email params must divert to sign-in before the chat app mounts');
});
