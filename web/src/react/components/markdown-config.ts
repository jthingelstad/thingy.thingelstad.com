// The Thingy markdown pipeline shared by the chat renderer and the share
// page (and importable from node tests - no JSX in this module): WT/#
// citation autolinks as a remark plugin, the safe-URL policy, and the
// base component overrides.

import { createElement } from 'react';
import type { Components } from 'react-markdown';
import { defaultUrlTransform } from 'react-markdown';

type MdastNode = {
  type: string;
  value?: string;
  url?: string;
  title?: string;
  children?: MdastNode[];
  data?: { hProperties?: Record<string, string> };
};

export function citationsByIssue(citations: ThingyCitation[]) {
  const map = new Map<string, ThingyCitation>();
  citations.forEach((citation) => {
    const issue = String(citation.issue_number || '').trim();
    if (issue && citation.url && !map.has(issue)) map.set(issue, citation);
  });
  return map;
}

// Which source a citation is, for the chip and card colours: Weekly
// cobalt, blog clay, Another Thing slate. Colours label sources only.
export type CitationKind = 'weekly' | 'blog' | 'podcast';

export function citationKind(citation: ThingyCitation): CitationKind {
  if (String(citation.issue_number || '').trim()) return 'weekly';
  const kind = String(citation.source_kind || '').toLowerCase();
  if (kind.startsWith('weekly')) return 'weekly';
  if (/podcast|episode/.test(kind)) return 'podcast';
  return 'blog';
}

// The comparable form of a link target: archive paths resolved, host
// without www, path without trailing slash, no scheme, query or hash.
export function citationUrlKey(url: string): string {
  const resolved = /^\/archive\//i.test(url) ? `https://weekly.thingelstad.com${url}` : url;
  try {
    const parsed = new URL(resolved);
    if (!/^https?:$/.test(parsed.protocol)) return '';
    return `${parsed.hostname.toLowerCase().replace(/^www\./, '')}${parsed.pathname.replace(/\/+$/, '')}`;
  } catch {
    return '';
  }
}

// Markdown links whose target is one of the answer's citations (the
// Librarian cites blog posts and episodes by title + permalink) render
// as source chips; this maps each cited URL to its kind.
export function citationKindsByUrl(citations: ThingyCitation[]) {
  const map = new Map<string, CitationKind>();
  citations.forEach((citation) => {
    const key = citationUrlKey(String(citation.url || ''));
    if (key && !map.has(key)) map.set(key, citationKind(citation));
  });
  return map;
}

export function citationTitle(citation: ThingyCitation): string {
  const parts = [`WT${citation.issue_number}: ${citation.subject || 'Weekly Thing'}`];
  if (citation.publish_date) parts.push(String(citation.publish_date).slice(0, 10));
  if (citation.section) parts.push(String(citation.section));
  return parts.join(' | ');
}

const WT_REF = /(?:WT|#)(\d{1,4})(?![\w-])/g;

// remark plugin: turn bare WT123 / #123 references in text into archive
// links, using the answer's citation metadata for URL and hover title.
// Skips text already inside links or code. With a kinds map it also
// tags authored links that point at a cited source, so they render as
// that source's chip.
export function remarkWtCitations(map: Map<string, ThingyCitation>, kinds: Map<string, CitationKind> = new Map()) {
  return () => (tree: MdastNode) => {
    if (!map.size && !kinds.size) return;
    const visit = (node: MdastNode, insideLink: boolean) => {
      if (node.type === 'link' && !insideLink && node.url) {
        const kind = kinds.get(citationUrlKey(node.url));
        if (kind) {
          node.data = {
            ...node.data,
            hProperties: { ...node.data?.hProperties, className: `thingy-cite thingy-cite-${kind}` }
          };
        }
      }
      if (node.type === 'link' || node.type === 'linkReference') insideLink = true;
      const children = node.children;
      if (!children) return;
      for (let i = children.length - 1; i >= 0; i--) {
        const child = children[i];
        if (child.type === 'text' && !insideLink && child.value) {
          const value = child.value;
          const parts: MdastNode[] = [];
          let last = 0;
          for (const match of value.matchAll(WT_REF)) {
            const index = match.index ?? 0;
            // Guard: no letter/&/word char immediately before (mirrors the
            // old renderer's prefix rule, keeps &#39; and WT-123-x intact).
            const before = value[index - 1];
            const citation = map.size ? map.get(match[1]) : undefined;
            if (!citation || (before && /[\w&-]/.test(before))) continue;
            if (index > last) parts.push({ type: 'text', value: value.slice(last, index) });
            parts.push({
              type: 'link',
              url: String(citation.url || ''),
              title: citationTitle(citation),
              data: {
                hProperties: {
                  className: 'thingy-cite thingy-cite-weekly',
                  'data-tinylytics-event': 'librarian.source_click',
                  'data-tinylytics-event-value': match[1]
                }
              },
              children: [{ type: 'text', value: `WT${match[1]}` }]
            });
            last = index + match[0].length;
          }
          if (parts.length) {
            if (last < value.length) parts.push({ type: 'text', value: value.slice(last) });
            children.splice(i, 1, ...parts);
          }
        } else if (child.type !== 'code' && child.type !== 'inlineCode') {
          visit(child, insideLink);
        }
      }
    };
    visit(tree, false);
  };
}

// Same policy as the retired hand-rolled parser: http(s)/mailto pass,
// /archive/ paths resolve against the newsletter site, other relatives
// stay, the rest die.
export function thingyUrlTransform(url: string) {
  if (/^\/archive\//i.test(url)) return `https://weekly.thingelstad.com${url}`;
  const safe = defaultUrlTransform(url);
  return safe || '';
}

// Images auto-fetch for every viewer with zero clicks - including every
// visitor to a shared conversation - so a prompt-injected answer could
// exfiltrate via image URLs to attacker hosts (audit W1). Only the
// archive's own properties may serve inline images; links stay broad
// because they require a click.
// The archive's real image hosts, from a corpus-wide inventory
// (2026-09-03): thingelstad.com domains (~7,000), the micro.blog CDN
// (~1,600 - most pre-2023 photos), and Buttondown's asset hosts (~140).
// The first allowlist stopped at *.thingelstad.com and silently dropped
// the micro.blog-hosted photos (Jamie's Iceland report).
const IMAGE_HOSTS = new Set([
  'cdn.uploads.micro.blog',
  'assets.buttondown.email',
  'buttondown-attachments.s3.us-west-2.amazonaws.com'
]);

function allowedImageSrc(src: unknown): string | undefined {
  const value = typeof src === 'string' ? src : '';
  if (!value) return undefined;
  if (value.startsWith('/') && !value.startsWith('//')) return value;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return undefined;
    const host = url.hostname.toLowerCase();
    if (host === 'thingelstad.com' || host.endsWith('.thingelstad.com') || IMAGE_HOSTS.has(host)) return value;
  } catch {
    return undefined;
  }
  return undefined;
}

export const BASE_COMPONENTS: Components = {
  img: ({ src, alt }) => {
    const safeSrc = allowedImageSrc(src);
    if (!safeSrc) return createElement('span', {}, alt || '');
    return createElement('img', { src: safeSrc, alt: alt || '', loading: 'lazy' });
  },
  // A Weekly chip reads "WT127" to everyone: the WT stays in the text
  // (visually hidden) and the chip draws a W disc in its place. The
  // explicit name keeps "WT127" whole wherever an accessibility engine
  // would read the hidden prefix as a separate word. The hast node
  // react-markdown passes is dropped (it used to land in the DOM as
  // node="[object Object]").
  a: ({ href, title, children, node: _node, ...rest }) => {
    const weekly = String(rest.className || '').includes('thingy-cite-weekly');
    const issue = typeof children === 'string' ? /^WT(\d{1,4})$/.exec(children) : null;
    if (weekly && issue) {
      return createElement(
        'a',
        { href, title, target: '_blank', rel: 'noopener', ...rest, 'aria-label': children },
        createElement('span', { className: 'thingy-cite-prefix' }, 'WT'),
        issue[1]
      );
    }
    return createElement('a', { href, title, target: '_blank', rel: 'noopener', ...rest }, children);
  }
};
