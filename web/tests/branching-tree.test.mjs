import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveParentRequestId, historyItemsFromStored } from '../src/react/thingy-runtime.ts';

function user(text) {
  return { role: 'user', content: [{ type: 'text', text }] };
}
function assistant(requestId) {
  return {
    role: 'assistant',
    content: [{ type: 'text', text: 'answer' }],
    metadata: { custom: { request_id: requestId } }
  };
}

test('first turn derives no parent', () => {
  assert.equal(deriveParentRequestId([user('hi')]), '');
});

test('follow-up derives the preceding assistant request id', () => {
  assert.equal(deriveParentRequestId([user('q1'), assistant('r1'), user('q2')]), 'r1');
});

test('edited root message derives no parent even with later context', () => {
  // Editing message 1 hands the adapter only the edited user message.
  assert.equal(deriveParentRequestId([user('edited q1')]), '');
});

test('branch edit deeper in the tree anchors to its own branch', () => {
  assert.equal(deriveParentRequestId([user('q1'), assistant('r1'), user('q2-edited')]), 'r1');
});

test('linear history without parent ids chains sequentially', () => {
  const items = historyItemsFromStored([
    { role: 'user', content: 'q1', request_id: 'r1' },
    { role: 'assistant', content: 'a1', request_id: 'r1' },
    { role: 'user', content: 'q2', request_id: 'r2' },
    { role: 'assistant', content: 'a2', request_id: 'r2' }
  ]);
  assert.deepEqual(
    items.map((item) => [item.message.id, item.parentId]),
    [
      ['u-r1', null],
      ['a-r1', 'u-r1'],
      ['u-r2', 'a-r1'],
      ['a-r2', 'u-r2']
    ]
  );
});

test('parent ids build the real branch tree', () => {
  const items = historyItemsFromStored([
    { role: 'user', content: 'q1', request_id: 'r1' },
    { role: 'assistant', content: 'a1', request_id: 'r1' },
    { role: 'user', content: 'q2 branch A', request_id: 'r2', parent_request_id: 'r1' },
    { role: 'assistant', content: 'a2', request_id: 'r2' },
    { role: 'user', content: 'q2 branch B', request_id: 'r3', parent_request_id: 'r1' },
    { role: 'assistant', content: 'a3', request_id: 'r3' }
  ]);
  const byId = new Map(items.map((item) => [item.message.id, item.parentId]));
  // Both branches share the same assistant parent - that IS the branch point.
  assert.equal(byId.get('u-r2'), 'a-r1');
  assert.equal(byId.get('u-r3'), 'a-r1');
});

test("the 'root' sentinel makes a top-level branch", () => {
  const items = historyItemsFromStored([
    { role: 'user', content: 'q1', request_id: 'r1' },
    { role: 'assistant', content: 'a1', request_id: 'r1' },
    { role: 'user', content: 'q1 edited', request_id: 'r2', parent_request_id: 'root' },
    { role: 'assistant', content: 'a2', request_id: 'r2' }
  ]);
  const byId = new Map(items.map((item) => [item.message.id, item.parentId]));
  assert.equal(byId.get('u-r1'), null);
  assert.equal(byId.get('u-r2'), null);
});

test('assistant messages carry request id and citations metadata', () => {
  const items = historyItemsFromStored([
    { role: 'user', content: 'q', request_id: 'r1' },
    { role: 'assistant', content: 'a', request_id: 'r1', citations: [{ issue_number: 5 }] }
  ]);
  const meta = items[1].message.metadata;
  assert.equal(meta.custom.request_id, 'r1');
  assert.deepEqual(meta.custom.citations, [{ issue_number: 5 }]);
});

test('empty rows are skipped without breaking the chain', () => {
  const items = historyItemsFromStored([
    { role: 'user', content: 'q1', request_id: 'r1' },
    { role: 'assistant', content: '', request_id: 'r1' },
    { role: 'user', content: 'q2', request_id: 'r2' }
  ]);
  assert.deepEqual(
    items.map((item) => item.message.id),
    ['u-r1', 'u-r2']
  );
});
