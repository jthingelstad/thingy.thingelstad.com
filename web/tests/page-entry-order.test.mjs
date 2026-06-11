import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function source(path) {
  return await readFile(new URL(path, import.meta.url), 'utf8');
}

test('chat reads URL params before Tinylytics strips them', async () => {
  const entry = await source('../src/pages/chat.js');

  assert.ok(entry.indexOf('bootChat();') > -1);
  assert.ok(entry.indexOf('loadTinylytics();') > -1);
  assert.ok(
    entry.indexOf('bootChat();') < entry.indexOf('loadTinylytics();'),
    'bootChat must run before loadTinylytics so prompt/from/scope params are read before analytics scrubbing'
  );
});

test('dispatch reads URL params before Tinylytics strips them', async () => {
  const entry = await source('../src/pages/dispatch.js');

  assert.ok(entry.indexOf('bootDispatch();') > -1);
  assert.ok(entry.indexOf('loadTinylytics();') > -1);
  assert.ok(
    entry.indexOf('bootDispatch();') < entry.indexOf('loadTinylytics();'),
    'bootDispatch must run before loadTinylytics so dispatch_test params are read before analytics scrubbing'
  );
});
