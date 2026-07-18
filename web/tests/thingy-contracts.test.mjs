import assert from 'node:assert/strict';
import test from 'node:test';

const { validateApiResponse, validateStreamData } = await import('../src/shared/thingy-contracts.ts');

test('endpoint contracts accept additive Librarian fields while preserving typed records', () => {
  const response = validateApiResponse(
    {
      conversations: [{ id: 'conversation-1', title: 'A thread', mode: 'thingy' }],
      modes: [{ id: 'thingy', label: 'Thingy' }],
      future_field: { additive: true }
    },
    '/conversations'
  );

  assert.equal(response.conversations?.[0]?.id, 'conversation-1');
  assert.deepEqual(response.future_field, { additive: true });
});

test('endpoint contracts reject malformed successful JSON', () => {
  assert.throws(
    () => validateApiResponse({ dispatches: [{ id: 42, status: [] }] }, '/dispatch'),
    /invalid \/dispatch response/
  );
  assert.throws(() => validateApiResponse({ profile: { modes: 'thingy' } }, '/auth'), /invalid \/auth response/);
});

test('stream contracts validate event-specific payloads', () => {
  assert.deepEqual(validateStreamData('answer_delta', { delta: 'Hello' }), { delta: 'Hello' });
  assert.deepEqual(validateStreamData('citations', { citations: [{ issue_number: null, source_kind: 'blog' }] }), {
    citations: [{ issue_number: null, source_kind: 'blog' }]
  });
  assert.throws(() => validateStreamData('answer_delta', { answer: 'wrong field' }), /invalid answer_delta event/);
  assert.throws(() => validateStreamData('citations', { citations: [{ url: 7 }] }), /invalid citations event/);
});
