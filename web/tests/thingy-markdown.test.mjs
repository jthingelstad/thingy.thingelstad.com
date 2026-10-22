import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  BASE_COMPONENTS,
  citationKindsByUrl,
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
        remarkPlugins: [remarkGfm, remarkWtCitations(citationsByIssue(citations), citationKindsByUrl(citations))],
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
  // Citation links to the sister sites carry ?ref=thingy-source.
  assert.match(html, /href="https:\/\/weekly\.thingelstad\.com\/archive\/127\/\?ref=thingy-source"/);
  assert.match(html, /data-tinylytics-event="librarian\.source_click"/);
  assert.match(html, /title="WT127: Bison \| 2019-11-23"/);
  // The Weekly chip draws a W disc in place of the prefix, but the link's
  // text is still exactly "WT127" (the prefix is visually hidden only).
  const anchor = html.match(/<a [^>]*class="thingy-cite thingy-cite-weekly"[^>]*>(.*?)<\/a>/);
  assert.ok(anchor, 'the autolink is a Weekly citation chip');
  assert.equal(anchor[1].replace(/<[^>]+>/g, ''), 'WT127');
  assert.match(anchor[1], /<span class="thingy-cite-prefix">WT<\/span>127/);
});

test('links to cited blog posts and episodes render as their source chips', () => {
  const citations = [
    { source_kind: 'blog', url: 'https://www.thingelstad.com/2024/03/02/espresso.html', subject: 'Espresso' },
    { source_kind: 'podcast', url: 'https://another.thingelstad.com/12/', subject: 'Coffee' },
    { issue_number: 127, url: '/archive/127/', subject: 'Bison' }
  ];
  const html = render(
    'Read [the espresso post](http://thingelstad.com/2024/03/02/espresso.html), hear ' +
      '[Coffee](https://another.thingelstad.com/12), see [WT127](https://weekly.thingelstad.com/archive/127/) ' +
      'and [elsewhere](https://example.com/12/).',
    citations
  );
  assert.match(
    html,
    /<a href="http:\/\/thingelstad\.com\/2024\/03\/02\/espresso\.html\?ref=thingy-source"[^>]*class="thingy-cite thingy-cite-blog"[^>]*>the espresso post<\/a>/
  );
  assert.match(
    html,
    /<a href="https:\/\/another\.thingelstad\.com\/12\?ref=thingy-source"[^>]*class="thingy-cite thingy-cite-podcast"[^>]*>Coffee<\/a>/
  );
  assert.match(html, /class="thingy-cite thingy-cite-weekly"[^>]*><span class="thingy-cite-prefix">WT<\/span>127<\/a>/);
  assert.match(html, /<a href="https:\/\/example\.com\/12\/" target="_blank" rel="noopener">elsewhere<\/a>/);
});

test('Things I have built citations render as the neutral thing chip', () => {
  const citations = [
    { source_kind: 'thing', id: 'thing-thingy', url: 'https://thingelstad.xyz/things/thingy/', subject: 'Thingy' },
    { id: 'thing-kubb', url: 'https://thingelstad.xyz/things/kubb/', subject: 'Kubb scores' },
    { url: 'https://www.thingelstad.xyz/things/escape/?tab=story', subject: 'Escape' }
  ];
  const kinds = citationKindsByUrl(citations);
  assert.deepEqual([...new Set(kinds.values())], ['thing'], 'kind, id prefix and host each mark a thing');
  const html = render(
    'Built [Thingy](https://thingelstad.xyz/things/thingy/), [scores](https://thingelstad.xyz/things/kubb/#log) ' +
      'and [Escape](https://www.thingelstad.xyz/things/escape/?tab=story).',
    citations
  );
  assert.match(
    html,
    /<a href="https:\/\/thingelstad\.xyz\/things\/thingy\/\?ref=thingy-source"[^>]*class="thingy-cite thingy-cite-thing"[^>]*>Thingy<\/a>/
  );
  // The ref goes before the #fragment and joins a query the link already has.
  assert.match(
    html,
    /href="https:\/\/thingelstad\.xyz\/things\/kubb\/\?ref=thingy-source#log"[^>]*class="thingy-cite thingy-cite-thing"/
  );
  assert.match(
    html,
    /href="https:\/\/www\.thingelstad\.xyz\/things\/escape\/\?tab=story&amp;ref=thingy-source"[^>]*class="thingy-cite thingy-cite-thing"/
  );
});

test('references without a matching citation stay plain text', () => {
  const html = render('See WT999 for nothing.', [{ issue_number: 127, url: '/archive/127/' }]);
  assert.doesNotMatch(html, /<a[^>]*>WT999/);
});

test('archive-relative links resolve to the newsletter site', () => {
  const html = render('A [link](/archive/153/).');
  assert.match(html, /href="https:\/\/weekly\.thingelstad\.com\/archive\/153\/"/);
});

test('FAQ citations link to the newsletter and use its source label', () => {
  assert.equal(thingyUrlTransform('/faq/'), 'https://weekly.thingelstad.com/faq/');
  const html = render('[The Basics](/faq/#the-basics)', [{ source_kind: 'faq', url: '/faq/', subject: 'The Basics' }]);
  assert.match(html, /href="https:\/\/weekly\.thingelstad\.com\/faq\/\?ref=thingy-source#the-basics"/);
  assert.match(html, /thingy-cite-weekly/);
  assert.equal(thingyUrlTransform('/faq-other/'), '/faq-other/');
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

test('images render lazily from the archive properties only', () => {
  const html = render('![photo](https://www.thingelstad.com/uploads/p.jpg)');
  assert.match(html, /<img[^>]*loading="lazy"/);
  // The micro.blog CDN hosts most pre-2023 photos - blocking it dropped
  // real archive images (Iceland report, 2026-09-03).
  assert.match(render('![church](https://cdn.uploads.micro.blog/x/p.jpg)'), /<img[^>]*loading="lazy"/);
  // Non-property hosts are a zero-click exfiltration channel (an injected
  // answer's image URL auto-fetches for every viewer) - blocked, with the
  // alt text kept so content is not silently lost (audit W1).
  const blocked = render('![offsite photo](https://evil.example.com/p.jpg)');
  assert.ok(!blocked.includes('<img'), 'offsite images do not render');
  assert.ok(blocked.includes('offsite photo'), 'alt text survives as prose');
});
