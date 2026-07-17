import assert from 'node:assert/strict';
import test from 'node:test';
import { dispatchEditable } from '../src/shared/thingy-dispatch-state.ts';

test('dispatch editability follows the client interaction model', () => {
  for (const stage of ['empty', 'draft', 'shaping', 'needs_clarification', 'ready', 'upgrade']) {
    assert.equal(dispatchEditable(stage), true, `${stage} should be editable`);
  }

  for (const stage of ['queued', 'generating', 'ready_to_send', 'sending', 'sent', 'failed']) {
    assert.equal(dispatchEditable(stage), false, `${stage} should be read-only`);
  }
});
