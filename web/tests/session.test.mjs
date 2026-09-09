import assert from 'node:assert/strict';
import test from 'node:test';

function storage() {
  const values = new Map();
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
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
  const win = installWindow(
    'http://localhost:8080/chat/?email=reader@example.com&prompt=What%20about%20RSS%3F&from=https%3A%2F%2Fweekly.thingelstad.com%2Farchive%2F123%2F&corpus=blog&mode=thingy'
  );
  const session = await import('../src/shared/thingy-session.ts');

  const url = new URL(session.signInUrl(), win.location.origin);
  const returnTo = url.searchParams.get('return');

  assert.equal(url.pathname, '/signin/');
  assert.equal(returnTo, '/chat/?mode=thingy');
  assert.doesNotMatch(url.href, /reader@example\.com|What%20about%20RSS|weekly\.thingelstad\.com|corpus=blog/);

  const restored = session.restorePendingReturnParams(returnTo);
  assert.equal(
    restored,
    '/chat/?mode=thingy&email=reader%40example.com&prompt=What+about+RSS%3F&from=https%3A%2F%2Fweekly.thingelstad.com%2Farchive%2F123%2F&corpus=blog'
  );
  assert.equal(win.sessionStorage.getItem(session.pendingReturnParamsKey), null);
});

test('returnPath rejects external and protocol-relative return targets', async () => {
  installWindow('http://localhost:8080/signin/?return=https%3A%2F%2Fevil.example%2F');
  const session = await import('../src/shared/thingy-session.ts');

  assert.equal(session.returnPath('/chat/'), '/chat/');

  installWindow('http://localhost:8080/signin/?return=%2F%2Fevil.example%2F');
  assert.equal(session.returnPath('/chat/'), '/chat/');
});

function legacyToken(secondsFromNow) {
  return `${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + secondsFromNow })).toString('base64url')}.test-signature`;
}

test('fresh sign-in removes a stale Bearer token that would override the new cookie', async () => {
  const win = installWindow();
  const session = await import('../src/shared/thingy-session.ts');
  for (const lifetime of [-3600, 3600]) {
    win.localStorage.setItem(session.storageKey, legacyToken(lifetime));
    session.persistAuth({ token: 'new-session-response', profile: {} }, 'reader@example.com');
    assert.equal(session.sessionActive(), true);
    assert.equal(win.localStorage.getItem(session.storageKey), null);
    assert.deepEqual(session.authHeaders(), {});
  }
});

test('expired legacy credentials are never attached to requests', async () => {
  const win = installWindow();
  const session = await import('../src/shared/thingy-session.ts');
  win.localStorage.setItem(session.storageKey, legacyToken(-3600));
  assert.deepEqual(session.authHeaders(), {});
  assert.equal(win.localStorage.getItem(session.storageKey), null);
  const valid = legacyToken(3600);
  win.localStorage.setItem(session.storageKey, valid);
  assert.deepEqual(session.authHeaders(), { authorization: `Bearer ${valid}` });
});

test('conversation requests migrate the session before reading authorization headers', async () => {
  const win = installWindow();
  win.ThingyConfig = { librarianApiUrl: '/api' };
  global.document = { querySelector: () => null };
  const session = await import('../src/shared/thingy-session.ts?migration');
  win.localStorage.setItem(session.storageKey, legacyToken(3600));
  const calls = [];
  win.fetch = async (url, options) => {
    calls.push({ url, headers: options.headers, body: JSON.parse(options.body) });
    return new Response(
      JSON.stringify(
        url.endsWith('/auth') ? { token: 'migrated', authenticated: true } : { conversations: [], total: 0 }
      )
    );
  };
  await session.postSessionJson('/conversations', { action: 'list' });
  assert.equal(calls[0].body.action, 'refresh_session');
  assert.ok(calls[0].headers.authorization);
  assert.equal(calls[1].url, '/api/conversations');
  assert.equal(calls[1].headers.authorization, undefined);
});

test('a rejected cookie session prevents a signed-in history request', async () => {
  const win = installWindow();
  win.ThingyConfig = { librarianApiUrl: '/api' };
  global.document = { querySelector: () => null };
  const session = await import('../src/shared/thingy-session.ts?rejected');
  win.localStorage.setItem(session.signedInHintKey, '1');
  const calls = [];
  win.fetch = async (url) => {
    calls.push(url);
    return new Response(JSON.stringify({ authenticated: false }));
  };
  await assert.rejects(session.postSessionJson('/conversations', { action: 'list' }), { status: 401 });
  assert.deepEqual(calls, ['/api/auth']);
  assert.equal(session.sessionActive(), false);
});
