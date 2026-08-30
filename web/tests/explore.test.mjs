import assert from 'node:assert/strict';
import test from 'node:test';
import { composeExplorePrompt } from '../src/shared/thingy-explore.ts';

test('explore url composes a prompt containing the canonical url', () => {
  const url = 'https://www.thingelstad.com/2026/08/28/some-post.html';
  const result = composeExplorePrompt(url, null);
  assert.ok(result.prompt.includes(url));
  assert.equal(result.sourceUrl, url);
});

test('issue number composes a Weekly Thing prompt and archive return url', () => {
  const result = composeExplorePrompt(null, '348');
  assert.ok(result.prompt.includes('WT348'));
  assert.equal(result.sourceUrl, 'https://weekly.thingelstad.com/archive/348/');
});

test('issue wins for the prompt but keeps an explicit explore url for return', () => {
  const result = composeExplorePrompt('https://weekly.thingelstad.com/archive/348/', '348');
  assert.ok(result.prompt.includes('WT348'));
  assert.equal(result.sourceUrl, 'https://weekly.thingelstad.com/archive/348/');
});

test('issue values are sanitized to digits within a sane range', () => {
  assert.ok(composeExplorePrompt(null, ' WT120 ').prompt.includes('WT120'));
  assert.ok(composeExplorePrompt(null, '007').prompt.includes('WT7'));
  assert.equal(composeExplorePrompt(null, '00000').prompt, '');
  assert.equal(composeExplorePrompt(null, '123456').prompt, '');
  assert.equal(composeExplorePrompt(null, 'abc').prompt, '');
});

test('explore rejects non-https, injection-shaped, and malformed values', () => {
  for (const bad of [
    'http://thingelstad.com/post',
    'javascript:alert(1)',
    'https://x.com/a"onmouseover="x',
    'https://x.com/a<script>',
    'not a url',
    ''
  ]) {
    const result = composeExplorePrompt(bad, null);
    assert.equal(result.prompt, '', bad);
    assert.equal(result.sourceUrl, '', bad);
  }
});
