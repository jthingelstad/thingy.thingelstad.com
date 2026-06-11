import assert from 'node:assert/strict';
import test from 'node:test';

import {
  discordConnection,
  discordConnectionName,
  extractPreferredNameFromMessage,
  normalizePreferredName,
  savePreferredName,
  hasSupportingAccess
} from '../src/shared/thingy-account.js';
import {
  memoryLearnedItems,
  memoryQuestionItems,
  memoryQuestions,
  memorySignalCount,
  memorySummaryItems,
  memorySummaries,
  usefulMemoryText
} from '../src/shared/thingy-memory-profile.js';

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

test('discordConnectionName accepts canonical Discord connection profile shape', () => {
  assert.equal(discordConnectionName({
    discord_connection: {
      connected: true,
      username: 'thingyuser',
      global_name: 'Thingy User',
      display_name: 'Thingy Display'
    }
  }), 'Thingy Display');
});

test('discordConnectionName accepts camelCase fallback profile shape', () => {
  assert.equal(discordConnectionName({
    discordConnection: {
      connected: true,
      username: 'thingyuser',
      globalName: 'Thingy User'
    }
  }), 'Thingy User');
});

test('discordConnection accepts linked records without a Discord display name', () => {
  assert.deepEqual(discordConnection({
    discord_connection: {
      connected: true,
      connected_at: '2026-06-10T19:30:00Z'
    }
  }), {
    connected: true,
    connected_at: '2026-06-10T19:30:00Z',
    username: '',
    global_name: '',
    display_name: ''
  });
});

test('discordConnection ignores disconnected or empty Discord connection values', () => {
  assert.equal(discordConnection({ discord_connection: { connected: false, display_name: 'Nope' } }), null);
  assert.equal(discordConnection({ discord_connection: {} }), null);
});

test('hasSupportingAccess recognises supporting members and owners', () => {
  assert.equal(hasSupportingAccess({ entitlements: ['reader'] }), false);
  assert.equal(hasSupportingAccess({ entitlements: ['reader', 'supporting_member'] }), true);
  assert.equal(hasSupportingAccess({ entitlements: ['reader', 'owner'] }), true);
  assert.equal(hasSupportingAccess({ supporting_member: true }), true);
  assert.equal(hasSupportingAccess({}), false);
  assert.equal(hasSupportingAccess({ entitlements: [] }), false);
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

test('memory profile helpers hide generic non-memory summaries', () => {
  assert.equal(usefulMemoryText("I don't have any previous context about that topic."), '');
  assert.equal(usefulMemoryText("Could you provide more details about the chat session you'd like me to summarize?"), '');
  assert.equal(usefulMemoryText('Trace Privacy Philosophy And Toolkit through the archive.'), 'Trace Privacy Philosophy And Toolkit through the archive.');

  const profile = {
    learned_profile: [
      { id: 'learned-1', label: 'RSS workflows', summary: 'Often explores RSS and OPML.' }
    ],
    current_session_questions: [
      { question: 'What did Jamie write about OPML?' }
    ],
    prior_session_summaries: [
      { summary: "I don't have any previous context about Jamie's archive." },
      { summary: 'They explored Jamie writing about RSS, OPML, and reader workflows.' }
    ]
  };

  assert.deepEqual(memorySummaries(profile), ['They explored Jamie writing about RSS, OPML, and reader workflows.']);
  assert.equal(memoryLearnedItems(profile).length, 1);
  assert.deepEqual(memoryQuestions(profile), ['What did Jamie write about OPML?']);
  assert.equal(memorySignalCount(profile), 3);
});

test('memory profile item helpers preserve ids for user controls', () => {
  const profile = {
    current_session_questions: [{ id: 'recent-1', question: 'What did Jamie say about RSS?' }],
    prior_session_summaries: [{ id: 'thread-1', summary: 'They explored RSS workflows.' }],
    learned_profile: [{ id: 'learned-1', label: 'RSS workflows', summary: 'Often explores RSS and OPML.', confidence: 0.8 }]
  };

  assert.equal(memoryQuestionItems(profile)[0].id, 'recent-1');
  assert.equal(memorySummaryItems(profile)[0].id, 'thread-1');
  assert.equal(memoryLearnedItems(profile)[0].id, 'learned-1');
});
