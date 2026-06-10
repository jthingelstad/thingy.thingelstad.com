import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clearNotice,
  noticeNonce,
  noticeText,
  showNotice
} from '../src/shared/stores/ui-store.js';

test('showNotice updates the visible text and advances the nonce', () => {
  clearNotice();
  const before = noticeNonce.value;
  showNotice('Could not load that conversation.');
  assert.equal(noticeText.value, 'Could not load that conversation.');
  assert.equal(noticeNonce.value, before + 1);
});

test('showNotice rearms when the same text is shown back to back', () => {
  clearNotice();
  showNotice('Try again.');
  const firstNonce = noticeNonce.value;
  showNotice('Try again.');
  assert.equal(noticeText.value, 'Try again.');
  assert.equal(noticeNonce.value, firstNonce + 1);
});

test('clearNotice empties the visible text', () => {
  showNotice('something');
  clearNotice();
  assert.equal(noticeText.value, '');
});
