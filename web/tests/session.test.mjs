import assert from 'node:assert/strict';
import test from 'node:test';

function storage() {
  const values = new Map();
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, String(value))
  };
}

function installWindow(url = 'http://localhost:8080/chat/') {
  const location = new URL(url);
  global.window = {
    atob: (value) => Buffer.from(value, 'base64').toString('binary'),
    clearTimeout,
    localStorage: storage(),
    location,
    sessionStorage: storage(),
    setTimeout
  };
  return global.window;
}

test('signInUrl keeps private app params out of the visible sign-in return URL', async () => {
  const win = installWindow('http://localhost:8080/chat/?email=reader@example.com&prompt=What%20about%20RSS%3F&from=https%3A%2F%2Fweekly.thingelstad.com%2Farchive%2F123%2F&corpus=blog&mode=thingy');
  const session = await import('../src/shared/thingy-session.js');

  const url = new URL(session.signInUrl(), win.location.origin);
  const returnTo = url.searchParams.get('return');

  assert.equal(url.pathname, '/signin/');
  assert.equal(returnTo, '/chat/?mode=thingy');
  assert.doesNotMatch(url.href, /reader@example\.com|What%20about%20RSS|weekly\.thingelstad\.com|corpus=blog/);

  const restored = session.restorePendingReturnParams(returnTo);
  assert.equal(restored, '/chat/?mode=thingy&email=reader%40example.com&prompt=What+about+RSS%3F&from=https%3A%2F%2Fweekly.thingelstad.com%2Farchive%2F123%2F&corpus=blog');
  assert.equal(win.sessionStorage.getItem(session.pendingReturnParamsKey), null);
});

test('returnPath rejects external and protocol-relative return targets', async () => {
  installWindow('http://localhost:8080/signin/?return=https%3A%2F%2Fevil.example%2F');
  const session = await import('../src/shared/thingy-session.js');

  assert.equal(session.returnPath('/chat/'), '/chat/');

  installWindow('http://localhost:8080/signin/?return=%2F%2Fevil.example%2F');
  assert.equal(session.returnPath('/dispatch/'), '/dispatch/');
});
