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
  assert.equal(session.returnPath('/dispatch/'), '/dispatch/');
});

test('mergeProfile preserves top-level Discord connection from auth responses', async () => {
  installWindow();
  const session = await import('../src/shared/thingy-session.ts');

  const profile = session.mergeProfile({
    email: 'reader@example.com',
    status: 'premium',
    entitlements: ['supporting_member'],
    profile: { preferred_name: 'Reader' },
    discord_connection: {
      connected: true,
      username: 'reader',
      display_name: 'Reader Discord'
    }
  });

  assert.equal(profile.discord_connection.display_name, 'Reader Discord');
  assert.equal(session.storedProfile().discord_connection.username, 'reader');
});

test('mergeProfile preserves alternate top-level Discord connection shapes from auth responses', async () => {
  installWindow();
  const session = await import('../src/shared/thingy-session.ts');

  const profile = session.mergeProfile({
    email: 'reader@example.com',
    profile: { preferred_name: 'Reader' },
    discord_user: {
      connected: true,
      username: 'reader',
      global_name: 'Reader Global',
      display_name: 'Reader Discord'
    }
  });

  assert.equal(profile.discord_connection.display_name, 'Reader Discord');
  assert.equal(session.storedProfile().discord_connection.global_name, 'Reader Global');
});

test('mergeProfile treats server Discord null as authoritative', async () => {
  installWindow();
  const session = await import('../src/shared/thingy-session.ts');

  session.mergeProfile({
    email: 'reader@example.com',
    discord_connection: {
      connected: true,
      username: 'reader',
      display_name: 'Reader Discord'
    }
  });

  const profile = session.mergeProfile({
    email: 'reader@example.com',
    profile: { discord_connection: null }
  });

  assert.equal(profile.discord_connection, null);
  assert.equal(session.storedProfile().discord_connection, null);
});

test('mergeProfile treats top-level Discord null as authoritative', async () => {
  installWindow();
  const session = await import('../src/shared/thingy-session.ts');

  session.mergeProfile({
    email: 'reader@example.com',
    discordConnection: {
      connected: true,
      username: 'reader',
      display_name: 'Reader Discord'
    }
  });

  const profile = session.mergeProfile({
    email: 'reader@example.com',
    discord_connection: null,
    profile: { preferred_name: 'Reader' }
  });

  assert.equal(profile.discord_connection, null);
  assert.equal(session.storedProfile().discord_connection, null);
});
