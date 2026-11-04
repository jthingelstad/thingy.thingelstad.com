// The face beside an answer (src/react/components/answer-mood.ts). Persona,
// 2026-11-03: found it only for a real find, oops only for a failure.
// A real find is an answer whose text cites one of the sources the
// Librarian returned for it.
import assert from 'node:assert/strict';
import test from 'node:test';

const { answerMood, citesASource } = await import('../src/react/components/answer-mood.ts');

const WT295 = { issue_number: 295, url: 'https://weekly.thingelstad.com/archive/295/', subject: 'Weekly Thing 295' };
const POST = { url: 'https://www.thingelstad.com/2024/05/01/a-post.html', source_kind: 'blog' };

function mood(text, citations = [], { running = false, failed = false } = {}) {
  return answerMood({ running, failed, text, citations });
}

test('a finished answer that cites a returned source is a find', () => {
  assert.equal(mood('Jamie first wrote about this in WT295.', [WT295]), 'found-it');
  assert.equal(mood('He came back to it in #295, a year later.', [WT295]), 'found-it');
  assert.equal(mood('See [A post](https://thingelstad.com/2024/05/01/a-post.html).', [POST]), 'found-it');
});

test('an answer that cites nothing it was given keeps the idle face', () => {
  assert.equal(mood('I could not find that in the archive.', [WT295]), 'idle');
  assert.equal(mood('Jamie wrote about it in WT12.', [WT295]), 'idle');
  assert.equal(mood('That one stays off my shelves.', []), 'idle');
  assert.equal(mood('', [WT295]), 'idle');
  assert.equal(mood('A link elsewhere: [x](https://example.com/295).', [WT295]), 'idle');
});

test('the WT reference needs a clean prefix, like the citation autolinks', () => {
  assert.equal(citesASource('item&#295 and WT-295-x', [WT295]), false);
  assert.equal(citesASource('(WT295)', [WT295]), true);
});

test('working and failed turns win over the text', () => {
  assert.equal(mood('WT295', [WT295], { running: true }), 'thinking');
  assert.equal(mood('WT295', [WT295], { failed: true }), 'oops');
  assert.equal(mood('', [], { failed: true }), 'oops');
});

test('citations without a URL or issue number do not count', () => {
  assert.equal(mood('WT295', [{ subject: 'no link' }]), 'idle');
});
