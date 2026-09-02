// Assistant answer rendering on react-markdown (via assistant-ui's
// MarkdownTextPrimitive: per-block memoization + smooth streaming). This
// replaced the hand-rolled parser on 2026-09-03 - Jamie's call. Thingy's
// own behaviors ride on top as a remark plugin and component overrides:
// WT/# citation autolinks with archive titles, the safe-URL policy,
// thumbnail images, and Tinylytics source-click attributes.

import { useMemo, useState } from 'react';
import { useAuiState } from '@assistant-ui/react';
import { MarkdownTextPrimitive, type MarkdownTextPrimitiveProps } from '@assistant-ui/react-markdown';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Icon } from './Icon.tsx';
import { BASE_COMPONENTS, citationsByIssue, remarkWtCitations, thingyUrlTransform } from './markdown-config.ts';
import { CodeHighlight } from './CodeHighlight.tsx';

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
  ...BASE_COMPONENTS,
  CodeHeader,
  SyntaxHighlighter: CodeHighlight
};

// Standalone renderer for surfaces outside an assistant-ui message part
// (the shared-conversation page). Same plugins, same URL policy, same
// component overrides - minus the aui-only code header.
export function ThingyMarkdown({ text, citations = [] }: { text: string; citations?: ThingyCitation[] }) {
  const remarkPlugins = useMemo(
    () => [remarkGfm, remarkWtCitations(citationsByIssue(citations))],
    // Stable per rendered content.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [citations.map((c) => `${c.issue_number}:${c.url}`).join('|')]
  );
  return (
    <ReactMarkdown remarkPlugins={remarkPlugins} urlTransform={thingyUrlTransform} components={STATIC_COMPONENTS}>
      {text}
    </ReactMarkdown>
  );
}

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
