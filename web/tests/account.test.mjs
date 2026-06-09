import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createAccountMenu,
  normalizePreferredName,
  renderAccountIdentity,
  savePreferredName
} from '../src/shared/thingy-account.js';

test('savePreferredName persists through the auth API before updating cached profile', async () => {
  const calls = [];
  let cachedProfile = {};
  const fakeSession = {
    authHeaders: () => ({ authorization: 'Bearer test' }),
    postJson: async (path, payload, headers) => {
      calls.push({ path, payload, headers });
      return { profile: { preferred_name: 'Jamie' } };
    },
    updateStoredProfile: (patch) => {
      cachedProfile = { ...cachedProfile, ...patch };
      return cachedProfile;
    }
  };

  const result = await savePreferredName(fakeSession, ' jamie ', normalizePreferredName);

  assert.equal(result.savedName, 'Jamie');
  assert.deepEqual(calls, [{
    path: '/auth',
    payload: { action: 'update_profile', preferred_name: 'Jamie' },
    headers: { authorization: 'Bearer test' }
  }]);
  assert.equal(cachedProfile.preferred_name, 'Jamie');
});

test('savePreferredName rejects names the API does not confirm', async () => {
  const fakeSession = {
    authHeaders: () => ({}),
    postJson: async () => ({ profile: { preferred_name: 'Someone Else' } }),
    updateStoredProfile: () => {
      throw new Error('should not update cached profile');
    }
  };

  await assert.rejects(
    savePreferredName(fakeSession, 'Jamie', normalizePreferredName),
    /could not confirm/i
  );
});

test('account panel hides Discord linking for normal subscribers', () => {
  const elements = {
    discordRow: { hidden: false },
    discordLink: { href: '', textContent: '' },
    discordStatus: { textContent: '' }
  };

  renderAccountIdentity({
    signedIn: true,
    profile: { entitlements: ['reader'] },
    elements
  });

  assert.equal(elements.discordRow.hidden, true);
});

test('account panel shows Discord linking for supporting members', () => {
  const elements = {
    discordRow: { hidden: true },
    discordLink: { href: '', textContent: '' },
    discordStatus: { textContent: '' }
  };

  renderAccountIdentity({
    signedIn: true,
    profile: {
      entitlements: ['reader', 'supporting_member'],
      discord_connection: { display_name: 'thingy_user' }
    },
    elements
  });

  assert.equal(elements.discordRow.hidden, false);
  assert.equal(elements.discordLink.href, '/discord/');
  assert.equal(elements.discordLink.textContent, 'Refresh Discord Connection');
  assert.match(elements.discordStatus.textContent, /thingy_user/);
});

test('account menu refresh hook runs when a signed-in account opens', () => {
  let clickHandler = null;
  let isHidden = true;
  let openCalls = 0;
  const button = {
    addEventListener: (event, handler) => {
      if (event === 'click') clickHandler = handler;
    },
    setAttribute: () => {}
  };
  const menu = {
    addEventListener: () => {},
    hasAttribute: (name) => name === 'hidden' && isHidden,
    toggleAttribute: (name, force) => {
      if (name === 'hidden') isHidden = Boolean(force);
    }
  };

  createAccountMenu({
    button,
    menu,
    signedIn: () => true,
    onOpen: () => {
      openCalls += 1;
    }
  });

  clickHandler({ stopPropagation: () => {} });
  assert.equal(isHidden, false);
  assert.equal(openCalls, 1);

  clickHandler({ stopPropagation: () => {} });
  assert.equal(isHidden, true);
  assert.equal(openCalls, 1);
});
