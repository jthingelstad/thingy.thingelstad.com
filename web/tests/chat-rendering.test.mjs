import assert from 'node:assert/strict';
import test from 'node:test';

import {
  appendActivityStep,
  renderAssistantResponse
} from '../src/shared/thingy-chat-rendering.js';

test('activity notes preserve newline-separated status updates', () => {
  const steps = appendActivityStep([], {
    message: 'Checked Search FAQ',
    note: [
      'Checking the FAQ for “Trusted Circle membership tiers Research Guide Thingy”.',
      'Checking the FAQ for “Trusted Circle conversation mode Research Guide”.',
      'Checking the FAQ for “Thingy conversation modes access levels”.'
    ].join('\n')
  }, 'Thingy is working...');

  const html = renderAssistantResponse('', [], null, steps, [], { active: true });

  assert.match(html, /<div class="librarian-activity-note">/);
  assert.equal((html.match(/<p>/g) || []).length, 3);
  assert.match(html, /Trusted Circle membership tiers/);
  assert.match(html, /Thingy conversation modes access levels/);
});
