// Syntax highlighting for fenced code blocks, plugged into assistant-ui's
// SyntaxHighlighter slot. Built from shiki/core with an explicit language
// set - the full shiki bundle shipped ~320 grammar chunks plus a WASM
// engine the CSP blocks anyway. Uses the JavaScript regex engine (no
// WASM); everything loads lazily so the chat bundle only pays when an
// answer actually contains a fenced block. Languages outside the set fall
// back to the plain monospace block. Dual-theme output follows the site's
// data-theme pattern in answer.css.

import { useEffect, useState } from 'react';
import type { SyntaxHighlighterProps } from '@assistant-ui/react-markdown';
import type { HighlighterCore } from 'shiki/core';

// The languages Jamie's archive plausibly quotes. Aliases (js, ts, py,
// sh...) come registered with each grammar.
const LANGS = () => [
  import('@shikijs/langs/javascript'),
  import('@shikijs/langs/typescript'),
  import('@shikijs/langs/jsx'),
  import('@shikijs/langs/tsx'),
  import('@shikijs/langs/python'),
  import('@shikijs/langs/ruby'),
  import('@shikijs/langs/go'),
  import('@shikijs/langs/rust'),
  import('@shikijs/langs/swift'),
  import('@shikijs/langs/shellscript'),
  import('@shikijs/langs/json'),
  import('@shikijs/langs/yaml'),
  import('@shikijs/langs/toml'),
  import('@shikijs/langs/html'),
  import('@shikijs/langs/css'),
  import('@shikijs/langs/xml'),
  import('@shikijs/langs/sql'),
  import('@shikijs/langs/markdown'),
  import('@shikijs/langs/diff')
];

let highlighterPromise: Promise<HighlighterCore> | null = null;

function loadHighlighter(): Promise<HighlighterCore> {
  highlighterPromise ||= Promise.all([import('shiki/core'), import('shiki/engine/javascript')]).then(([core, engine]) =>
    core.createHighlighterCore({
      themes: [import('@shikijs/themes/github-light'), import('@shikijs/themes/github-dark')],
      langs: LANGS(),
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
        const rendered = highlighter.codeToHtml(code, {
          lang: language,
          themes: { light: 'github-light', dark: 'github-dark' },
          defaultColor: false
        });
        if (!cancelled) setHtml(rendered);
      } catch {
        // Language outside the curated set (or load failure): the plain
        // block below stands.
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
