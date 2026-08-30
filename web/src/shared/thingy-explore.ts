/**
 * Explore deep links. Source surfaces (blog posts, Weekly Thing issues,
 * Another Thing episodes) link to Thingy saying only WHAT they are:
 * `?explore=<canonical-url>` or `?issue=<n>`. Thingy composes the actual
 * question here, so the ask can improve over time without regenerating
 * thousands of static pages. An explicit `?prompt=` always wins upstream.
 */

function exploreIssueNumber(value: unknown): string {
  const digits = String(value || '')
    .trim()
    .replace(/[^0-9]/g, '');
  if (!digits || digits.length > 4 || digits === '0'.repeat(digits.length)) return '';
  return String(Number(digits));
}

function exploreSourceUrl(value: unknown): string {
  const raw = String(value || '').trim();
  if (!/^https:\/\/[^\s<>"']+$/.test(raw)) return '';
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'https:' ? parsed.href : '';
  } catch {
    return '';
  }
}

function composeExplorePrompt(exploreParam: unknown, issueParam: unknown): { prompt: string; sourceUrl: string } {
  const issue = exploreIssueNumber(issueParam);
  if (issue) {
    return {
      prompt: `Give me a guided look at Weekly Thing issue WT${issue} - what is in it, the standout links, and what elsewhere in the archive connects to it.`,
      sourceUrl: exploreSourceUrl(exploreParam) || `https://weekly.thingelstad.com/archive/${issue}/`
    };
  }
  const sourceUrl = exploreSourceUrl(exploreParam);
  if (sourceUrl) {
    return {
      prompt: `Tell me about this from Jamie's archive, and what connects it to the rest of his writing: ${sourceUrl}`,
      sourceUrl
    };
  }
  return { prompt: '', sourceUrl: '' };
}

export { composeExplorePrompt };
