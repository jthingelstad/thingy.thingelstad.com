import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  BASE_COMPONENTS,
  citationsByIssue,
  remarkWtCitations,
  thingyUrlTransform
} from '../src/react/components/markdown-config.ts';

// Renders through the exact shared pipeline ThingyMarkdown/AssistantMarkdown
// use (react-markdown + the Thingy remark plugin, URL policy, components).
function render(text, citations = []) {
  return renderToStaticMarkup(
    createElement(
      ReactMarkdown,
      {
        remarkPlugins: [remarkGfm, remarkWtCitations(citationsByIssue(citations))],
        urlTransform: thingyUrlTransform,
        components: BASE_COMPONENTS
      },
      text
    )
  );
}

test('WT references autolink with citation title and analytics attributes', () => {
  const html = render('See WT127 for the bison thread.', [
    { issue_number: 127, url: '/archive/127/', subject: 'Bison', publish_date: '2019-11-23T13:00:47Z' }
  ]);
  assert.match(html, /href="https:\/\/weekly\.thingelstad\.com\/archive\/127\/"/);
  assert.match(html, /data-tinylytics-event="librarian\.source_click"/);
  assert.match(html, /title="WT127: Bison \| 2019-11-23"/);
  assert.match(html, />WT127<\/a>/);
});

test('references without a matching citation stay plain text', () => {
  const html = render('See WT999 for nothing.', [{ issue_number: 127, url: '/archive/127/' }]);
  assert.doesNotMatch(html, /<a[^>]*>WT999/);
});

test('archive-relative links resolve to the newsletter site', () => {
  const html = render('A [link](/archive/153/).');
  assert.match(html, /href="https:\/\/weekly\.thingelstad\.com\/archive\/153\/"/);
});

test('unsafe schemes are stripped', () => {
  // oxlint-disable-next-line no-script-url
  const html = render('A [link](javascript:alert(1)).');
  assert.doesNotMatch(html, /javascript:/);
});

test('fenced code renders a pre/code block', () => {
  const html = render('```js\nconst x = 1;\n```');
  assert.match(html, /<pre>[\s\S]*<code[^>]*>const x = 1;/);
});

test('WT references inside code are left alone', () => {
  const html = render('`WT127` inline and\n\n```\nWT127\n```', [{ issue_number: 127, url: '/archive/127/' }]);
  assert.doesNotMatch(html, /<a[^>]*>WT127/);
});

test('images render lazily', () => {
  const html = render('![photo](https://example.com/p.jpg)');
  assert.match(html, /<img[^>]*loading="lazy"/);
});
