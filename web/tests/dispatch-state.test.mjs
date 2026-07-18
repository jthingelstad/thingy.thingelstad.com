import assert from 'node:assert/strict';
import test from 'node:test';
import { draftFromServerRow } from '../src/shared/thingy-dispatch-drafts.ts';
import { dispatchEditable } from '../src/shared/thingy-dispatch-state.ts';

test('dispatch editability follows the client interaction model', () => {
  for (const stage of ['empty', 'draft', 'shaping', 'needs_clarification', 'ready', 'upgrade']) {
    assert.equal(dispatchEditable(stage), true, `${stage} should be editable`);
  }

  for (const stage of ['queued', 'generating', 'ready_to_send', 'sending', 'sent', 'failed']) {
    assert.equal(dispatchEditable(stage), false, `${stage} should be read-only`);
  }
});

test('terminal Dispatch state survives a history refresh with stored planner messages', () => {
  const sent = draftFromServerRow({
    id: 'dispatch-sent',
    status: 'sent',
    messages: [
      { role: 'assistant', text: 'The brief is ready.' },
      { role: 'assistant', text: 'Generating.', kind: 'progress', status: 'pending' }
    ]
  });
  const failed = draftFromServerRow({
    id: 'dispatch-failed',
    status: 'failed',
    error: 'Writer failed.',
    messages: [{ role: 'assistant', text: 'The brief is ready.' }]
  });

  assert.equal(sent.messages.find((message) => message.kind === 'progress').status, 'complete');
  assert.equal(sent.messages.at(-1).kind, 'sent');
  assert.equal(sent.messages.at(-1).text, 'Dispatch sent. Check your email.');
  assert.equal(failed.messages.at(-1).kind, 'failed');
  assert.equal(failed.messages.at(-1).text, 'Writer failed.');
});
