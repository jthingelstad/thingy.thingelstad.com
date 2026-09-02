// Syntax highlighting for fenced code blocks via shiki (2026-09-03),
// plugged into assistant-ui's SyntaxHighlighter slot. shiki is imported
// lazily so the chat bundle only pays for it when an answer actually
// contains a fenced block; grammars and themes load on demand inside it.
// Dual-theme output follows the site's data-theme pattern in CSS.

import { useEffect, useState } from 'react';
import type { SyntaxHighlighterProps } from '@assistant-ui/react-markdown';

type CodeToHtml = (code: string, options: object) => Promise<string>;

let shikiPromise: Promise<CodeToHtml> | null = null;

function loadShiki(): Promise<CodeToHtml> {
  shikiPromise ||= import('shiki').then((mod) => mod.codeToHtml as CodeToHtml);
  return shikiPromise;
}

export function CodeHighlight({ components, language, code }: SyntaxHighlighterProps) {
  const [html, setHtml] = useState('');
  useEffect(() => {
    let cancelled = false;
    setHtml('');
    if (!language || !code) return undefined;
    loadShiki()
      .then((codeToHtml) =>
        codeToHtml(code, {
          lang: language,
          themes: { light: 'github-light', dark: 'github-dark' },
          defaultColor: false
        })
      )
      .then((rendered) => {
        if (!cancelled) setHtml(rendered);
      })
      .catch(() => {
        // Unknown language or load failure: the plain block below stands.
      });
    return () => {
      cancelled = true;
    };
  }, [language, code]);
  if (html) {
    // shiki's output is a full <pre class="shiki"> tree built from the
    // code text it was given - the same trust level as rendering it raw.
    return <div className="thingy-shiki" dangerouslySetInnerHTML={{ __html: html }} />;
  }
  const { Pre, Code } = components;
  return (
    <Pre>
      <Code>{code}</Code>
    </Pre>
  );
}
