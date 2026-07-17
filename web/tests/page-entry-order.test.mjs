import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function source(path) {
  return await readFile(new URL(path, import.meta.url), 'utf8');
}

test('chat reads URL params before Tinylytics strips them', async () => {
  const entry = await source('../src/pages/chat.ts');

  assert.ok(entry.indexOf('bootChat();') > -1);
  assert.ok(entry.indexOf('loadTinylytics();') > -1);
  assert.ok(
    entry.indexOf('bootChat();') < entry.indexOf('loadTinylytics();'),
    'bootChat must run before loadTinylytics so prompt/from/scope params are read before analytics scrubbing'
  );
});

test('dispatch reads URL params before Tinylytics strips them', async () => {
  const entry = await source('../src/pages/dispatch.ts');

  assert.ok(entry.indexOf('bootDispatch();') > -1);
  assert.ok(entry.indexOf('loadTinylytics();') > -1);
  assert.ok(
    entry.indexOf('bootDispatch();') < entry.indexOf('loadTinylytics();'),
    'bootDispatch must run before loadTinylytics so dispatch_test params are read before analytics scrubbing'
  );
});

test('chat keeps signed-in invite links out of the sign-in redirect loop', async () => {
  const sourceText = await source('../src/shared/thingy-chat.ts');
  const tokenBranch = sourceText.indexOf('} else if (actions.token()) {');
  const emailBranch = sourceText.indexOf('} else if (initialEmailFromUrl) {');

  assert.ok(tokenBranch > -1);
  assert.ok(emailBranch > -1);
  assert.ok(
    tokenBranch < emailBranch,
    'a valid stored session must take precedence over email= so signed-in prompt/from links do not bounce through /signin/'
  );
});
