import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AGENT_RESPONSE_TIMEOUT_MS,
  AGENT_SETUP_TIMEOUT_MS,
  DEFAULT_API_TIMEOUT_MS
} from '../src/shared/thingy-timeouts.js';

test('shared timeout constants keep chat and dispatch in sync', () => {
  assert.equal(DEFAULT_API_TIMEOUT_MS, 60000);
  assert.equal(AGENT_SETUP_TIMEOUT_MS, 45000);
  assert.equal(AGENT_RESPONSE_TIMEOUT_MS, 190000);
});
