// Assistant answer rendering on react-markdown (via assistant-ui's
// MarkdownTextPrimitive: per-block memoization + smooth streaming). This
// replaced the hand-rolled parser on 2026-09-03 - Jamie's call. Thingy's
// own behaviors ride on top as a remark plugin and component overrides:
// WT/# citation autolinks with archive titles, the safe-URL policy,
// thumbnail images, and Tinylytics source-click attributes.

import { useMemo, useState } from 'react';
import { useAuiState } from '@assistant-ui/react';
import { MarkdownTextPrimitive, type MarkdownTextPrimitiveProps } from '@assistant-ui/react-markdown';
import { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Icon } from './Icon.tsx';

type MdastNode = {
  type: string;
  value?: string;
  url?: string;
  title?: string;
  children?: MdastNode[];
  data?: { hProperties?: Record<string, string> };
};

function citationsByIssue(citations: ThingyCitation[]) {
  const map = new Map<string, ThingyCitation>();
  citations.forEach((citation) => {
    const issue = String(citation.issue_number || '').trim();
    if (issue && citation.url && !map.has(issue)) map.set(issue, citation);
  });
  return map;
}

function citationTitle(citation: ThingyCitation): string {
  const parts = [`WT${citation.issue_number}: ${citation.subject || 'Weekly Thing'}`];
  if (citation.publish_date) parts.push(String(citation.publish_date).slice(0, 10));
  if (citation.section) parts.push(String(citation.section));
  return parts.join(' | ');
}

const WT_REF = /(?:WT|#)(\d{1,4})(?![\w-])/g;

// remark plugin: turn bare WT123 / #123 references in text into archive
// links, using the answer's citation metadata for URL and hover title.
// Skips text already inside links or code.
function remarkWtCitations(map: Map<string, ThingyCitation>) {
  return () => (tree: MdastNode) => {
    if (!map.size) return;
    const visit = (node: MdastNode, insideLink: boolean) => {
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
            const citation = map.get(match[1]);
            if (!citation || (before && /[\w&-]/.test(before))) continue;
            if (index > last) parts.push({ type: 'text', value: value.slice(last, index) });
            parts.push({
              type: 'link',
              url: String(citation.url || ''),
              title: citationTitle(citation),
              data: {
                hProperties: {
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

// Same policy as the retired parser: http(s)/mailto pass, /archive/ paths
// resolve against the newsletter site, other relatives stay, the rest die.
function thingyUrlTransform(url: string) {
  if (/^\/archive\//i.test(url)) return `https://weekly.thingelstad.com${url}`;
  const safe = defaultUrlTransform(url);
  return safe || '';
}

function CodeHeader({ language, code }: { language: string | undefined; code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="thingy-aui-codeheader">
      <span className="thingy-aui-codelang">{language || 'text'}</span>
      <button
        type="button"
        aria-label="Copy code"
        title="Copy code"
        onClick={() => {
          void navigator.clipboard.writeText(code).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1600);
          });
        }}
      >
        <Icon name={copied ? 'check' : 'copy'} />
      </button>
    </div>
  );
}

const STATIC_COMPONENTS: MarkdownTextPrimitiveProps['components'] = {
  CodeHeader,
  img: ({ src, alt }) => <img src={typeof src === 'string' ? src : undefined} alt={alt || ''} loading="lazy" />,
  a: ({ href, title, children, ...rest }) => (
    <a href={href} title={title} target="_blank" rel="noopener" {...rest}>
      {children}
    </a>
  )
};

export function AssistantMarkdown() {
  const metadata = useAuiState((state) => state.message.metadata);
  const citations = ((metadata?.custom as { citations?: ThingyCitation[] } | undefined)?.citations ||
    []) as ThingyCitation[];
  const remarkPlugins = useMemo(
    () => [remarkGfm, remarkWtCitations(citationsByIssue(citations))],
    // The citation list is stable per message once the answer completes;
    // key the memo on its rendered identity, not array identity.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [citations.map((c) => `${c.issue_number}:${c.url}`).join('|')]
  );
  return (
    <MarkdownTextPrimitive
      className="librarian-answer-content"
      remarkPlugins={remarkPlugins}
      urlTransform={thingyUrlTransform}
      components={STATIC_COMPONENTS}
    />
  );
}
