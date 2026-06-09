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

test('discordConfirmCommand formats the exact Discord slash command', async () => {
  installDom();
  const { discordConfirmCommand } = await import('../src/shared/thingy-discord.js');

  assert.equal(discordConfirmCommand('ABC123'), '/thingy confirm ABC123');
  assert.equal(discordConfirmCommand('  ABC123  '), '/thingy confirm ABC123');
  assert.equal(discordConfirmCommand(''), '');
});

test('discordSignInUrl preserves verification state in the return parameter', async () => {
  installDom();
  const { discordSignInUrl } = await import('../src/shared/thingy-discord.js');
  const url = new URL(discordSignInUrl('state with symbols+/='));

  assert.equal(url.pathname, '/signin/');
  assert.equal(url.searchParams.get('return'), '/discord/?state=state%20with%20symbols%2B%2F%3D');
  assert.equal(url.searchParams.has('state'), false);
});
