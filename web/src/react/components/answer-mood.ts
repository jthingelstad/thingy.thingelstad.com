// Which face sits beside an answer. Persona (thingy.thingelstad.xyz
// persona/THINGY.md, 2026-11-03): thinking while he works, found it only
// when he found something real, oops only when something went wrong on
// his side, idle otherwise. "Found something real" has no flag of its own
// in the stream, so the rule is the simplest honest one the answer
// already carries: the finished text cites one of the sources the
// Librarian returned for it, as a WT/# issue reference or a link to a
// cited URL. A reply that cites nothing (a found-nothing answer, a
// decline, a clarifying question) keeps the idle face.

import { citationUrlKey, citationsByIssue } from './markdown-config.ts';

export type AnswerMood = 'thinking' | 'found-it' | 'oops' | 'idle';

// Same shape as the remark plugin's WT_REF, with its prefix guard.
const WT_REF = /(?:WT|#)(\d{1,4})(?![\w-])/g;
const URL_IN_TEXT = /https?:\/\/[^\s)\]>"'<]+/g;

export function citesASource(text: string, citations: ThingyCitation[]): boolean {
  const usable = citations.filter((citation) => citation && (citation.url || citation.issue_number));
  if (!text.trim() || !usable.length) return false;
  const issues = citationsByIssue(usable);
  for (const match of text.matchAll(WT_REF)) {
    const before = text[(match.index ?? 0) - 1];
    if (before && /[\w&-]/.test(before)) continue;
    if (issues.has(match[1])) return true;
  }
  const cited = new Set(usable.map((citation) => citationUrlKey(String(citation.url || ''))).filter(Boolean));
  for (const match of text.matchAll(URL_IN_TEXT)) {
    if (cited.has(citationUrlKey(match[0]))) return true;
  }
  return false;
}

export function answerMood({
  running,
  failed,
  text,
  citations
}: {
  running: boolean;
  failed: boolean;
  text: string;
  citations: ThingyCitation[];
}): AnswerMood {
  if (running) return 'thinking';
  if (failed) return 'oops';
  return citesASource(text, citations) ? 'found-it' : 'idle';
}
