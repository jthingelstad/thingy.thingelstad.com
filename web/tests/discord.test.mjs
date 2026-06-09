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
