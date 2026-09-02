// Syntax highlighting for fenced code blocks via shiki (2026-09-03),
// plugged into assistant-ui's SyntaxHighlighter slot. Uses shiki's
// JavaScript regex engine - the default oniguruma engine is WASM, which
// the site's script-src 'self' CSP blocks. Everything loads lazily so
// the chat bundle only pays when an answer contains a fenced block.
// Dual-theme output follows the site's data-theme pattern in CSS.

import { useEffect, useState } from 'react';
import type { SyntaxHighlighterProps } from '@assistant-ui/react-markdown';
import type { HighlighterCore } from 'shiki';

let highlighterPromise: Promise<HighlighterCore> | null = null;

function loadHighlighter(): Promise<HighlighterCore> {
  highlighterPromise ||= Promise.all([import('shiki'), import('shiki/engine/javascript')]).then(([shiki, engine]) =>
    shiki.createHighlighter({
      themes: ['github-light', 'github-dark'],
      langs: [],
      engine: engine.createJavaScriptRegexEngine({ forgiving: true })
    })
  );
  return highlighterPromise;
}

export function CodeHighlight({ components, language, code }: SyntaxHighlighterProps) {
  const [html, setHtml] = useState('');
  useEffect(() => {
    let cancelled = false;
    setHtml('');
    if (!language || !code) return undefined;
    void (async () => {
      try {
        const highlighter = await loadHighlighter();
        if (!highlighter.getLoadedLanguages().includes(language)) {
          await highlighter.loadLanguage(language as never);
        }
        const rendered = highlighter.codeToHtml(code, {
          lang: language,
          themes: { light: 'github-light', dark: 'github-dark' },
          defaultColor: false
        });
        if (!cancelled) setHtml(rendered);
      } catch {
        // Unknown language or load failure: the plain block below stands.
      }
    })();
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
