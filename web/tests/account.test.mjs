import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractPreferredNameFromMessage,
  hasSupportingAccess,
  normalizePreferredName,
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

test('hasSupportingAccess recognises supporting members and owners', () => {
  assert.equal(hasSupportingAccess({ entitlements: ['reader'] }), false);
  assert.equal(hasSupportingAccess({ entitlements: ['reader', 'supporting_member'] }), true);
  assert.equal(hasSupportingAccess({ entitlements: ['reader', 'owner'] }), true);
  assert.equal(hasSupportingAccess({ supporting_member: true }), true);
  assert.equal(hasSupportingAccess({}), false);
});

test('normalizePreferredName trims, title-cases, and rejects blocked words', () => {
  assert.equal(normalizePreferredName(' jamie '), 'Jamie');
  assert.equal(normalizePreferredName('jamie thingelstad'), 'Jamie Thingelstad');
  assert.equal(normalizePreferredName('hi'), '');
  assert.equal(normalizePreferredName('thingy'), '');
  assert.equal(normalizePreferredName(''), '');
  assert.equal(normalizePreferredName('a'.repeat(120)), '');
});

test('extractPreferredNameFromMessage pulls names from natural phrasing', () => {
  assert.equal(extractPreferredNameFromMessage('my name is Jamie.'), 'Jamie');
  assert.equal(extractPreferredNameFromMessage("I'm Jamie Thingelstad"), 'Jamie Thingelstad');
  assert.equal(extractPreferredNameFromMessage('What about RSS?'), '');
  assert.equal(extractPreferredNameFromMessage('Jamie'), 'Jamie');
});
