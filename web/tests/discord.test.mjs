import assert from 'node:assert/strict';
import test from 'node:test';

function installDom() {
  global.document = {
    getElementById: () => null
  };
  global.window = {
    location: new URL('http://localhost:8080/discord/'),
    localStorage: {
      getItem: () => null,
      removeItem: () => {},
      setItem: () => {}
    }
  };
}

test('normalizeDiscordCode trims the code used for Discord confirmation', async () => {
  installDom();
  const { normalizeDiscordCode } = await import('../src/shared/thingy-discord.ts');

  assert.equal(normalizeDiscordCode('ABC123'), 'ABC123');
  assert.equal(normalizeDiscordCode('  ABC123  '), 'ABC123');
  assert.equal(normalizeDiscordCode(''), '');
});

test('discordSignInUrl preserves verification state in the return parameter', async () => {
  installDom();
  const { discordSignInUrl } = await import('../src/shared/thingy-discord.ts');
  const url = new URL(discordSignInUrl('state with symbols+/='));

  assert.equal(url.pathname, '/signin/');
  assert.equal(url.searchParams.get('return'), '/discord/?state=state%20with%20symbols%2B%2F%3D');
  assert.equal(url.searchParams.has('state'), false);
});
