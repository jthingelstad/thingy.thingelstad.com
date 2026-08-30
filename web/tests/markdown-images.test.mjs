import assert from 'node:assert/strict';
import test from 'node:test';
import { renderMarkdown } from '../src/shared/thingy-markdown.ts';

test('a bare markdown image renders as a clickable thumbnail of itself', () => {
  const html = renderMarkdown('Here it is: ![Creek ride](https://cdn.thingelstad.com/img/creek.jpg)');
  assert.match(html, /<a class="thingy-answer-media" href="https:\/\/cdn\.thingelstad\.com\/img\/creek\.jpg"/);
  assert.match(html, /<img src="https:\/\/cdn\.thingelstad\.com\/img\/creek\.jpg" alt="Creek ride" loading="lazy">/);
  assert.match(html, /target="_blank" rel="noopener"/);
  assert.ok(!html.includes('!['));
});

test('a linked image opens its source page, not the image', () => {
  const html = renderMarkdown(
    '[![Creek ride](https://cdn.thingelstad.com/img/creek.jpg)](https://www.thingelstad.com/2026/05/09/creek-ride.html)'
  );
  assert.match(html, /href="https:\/\/www\.thingelstad\.com\/2026\/05\/09\/creek-ride\.html"/);
  assert.match(html, /img src="https:\/\/cdn\.thingelstad\.com\/img\/creek\.jpg"/);
});

test('non-http image urls do not render as images or live links', () => {
  const html = renderMarkdown('![x](javascript:alert(1))');
  // The media rule declines; the remaining link falls through to
  // safeMarkdownUrl, which neuters the scheme.
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes('href="javascript:'));
});

test('regular links still render and text links are untouched by media rule', () => {
  const html = renderMarkdown('See [the post](https://www.thingelstad.com/post.html) for more.');
  assert.match(html, /<a href="https:\/\/www\.thingelstad\.com\/post\.html">the post<\/a>/);
  assert.ok(!html.includes('thingy-answer-media'));
});

test('ordered lists continue across blank lines instead of restarting at 1', () => {
  const html = renderMarkdown('1. First thing\n\n2. Second thing\n\n3. Third thing');
  assert.equal((html.match(/<ol>/g) || []).length, 1, 'one list, not three');
  assert.equal((html.match(/<li>/g) || []).length, 3);
});
