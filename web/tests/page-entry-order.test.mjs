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

test('chat keeps signed-in invite links out of the sign-in redirect loop', async () => {
  const sourceText = await source('../src/shared/components/ChatApp.tsx');
  const tokenBranch = sourceText.indexOf('} else if (actions.hasSession()) {');
  const emailRedirectBranch = sourceText.indexOf("track('librarian.auth_auto_start')");
  const guestBranch = sourceText.indexOf("track('librarian.guest_visit'");

  assert.ok(tokenBranch > -1);
  assert.ok(emailRedirectBranch > -1);
  assert.ok(
    tokenBranch < emailRedirectBranch,
    'a valid stored session must take precedence over email= so signed-in prompt/from links do not bounce through /signin/'
  );
  // The guest lane must be the LAST resort: session first, explicit email
  // sign-in intent second, guest preview only when neither applies.
  assert.ok(guestBranch > emailRedirectBranch, 'guest preview must not swallow explicit email= sign-in links');
});
