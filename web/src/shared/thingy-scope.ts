// @ts-check
const sourceOrder: string[] = ['weekly_thing', 'blog', 'podcast'];

function normalizeScopeParam(value) {
  const raw = String(value || '')
    .trim()
    .toLowerCase();
  if (!raw) return '';
  const normalized = raw.replace(/[\s-]+/g, '_').replace(/^_+|_+$/g, '');
  if (normalized === 'all' || normalized === 'everything') return 'all';
  if (normalized === 'both') return 'both';
  if (normalized === 'weekly_thing_podcast' || normalized === 'wt_podcast') return 'weekly_thing_podcast';
  if (normalized === 'blog_podcast' || normalized === 'podcast_blog') return 'blog_podcast';

  const tokens = raw
    .split(/[,+|]/)
    .map((part) =>
      part
        .trim()
        .replace(/[\s-]+/g, '_')
        .replace(/^_+|_+$/g, '')
    )
    .filter(Boolean);
  const mapped = new Set<string>();
  for (const token of tokens.length ? tokens : [normalized]) {
    if (token === 'blog' || token === 'thingelstad' || token === 'thingelstad_com') mapped.add('blog');
    if (
      token === 'podcast' ||
      token === 'podcasts' ||
      token === 'another_thing' ||
      token === 'anotherthing' ||
      token === 'another'
    )
      mapped.add('podcast');
    if (
      token === 'weekly_thing' ||
      token === 'wt' ||
      token === 'weeklything' ||
      token === 'issues' ||
      token === 'archive' ||
      token === 'newsletter'
    )
      mapped.add('weekly_thing');
  }
  if (mapped.size === 3) return 'all';
  if (mapped.has('weekly_thing') && mapped.has('blog') && mapped.size === 2) return 'both';
  if (mapped.has('weekly_thing') && mapped.has('podcast') && mapped.size === 2) return 'weekly_thing_podcast';
  if (mapped.has('blog') && mapped.has('podcast') && mapped.size === 2) return 'blog_podcast';
  if (mapped.size === 1) return Array.from(mapped)[0];
  return '';
}

function scopeForSources(sources) {
  const selected = sourceOrder.filter((source) => sources.includes(source));
  if (selected.length === 3) return 'all';
  if (selected.length === 1) return selected[0];
  if (selected.includes('weekly_thing') && selected.includes('blog') && selected.length === 2) return 'both';
  if (selected.includes('weekly_thing') && selected.includes('podcast') && selected.length === 2)
    return 'weekly_thing_podcast';
  if (selected.includes('blog') && selected.includes('podcast') && selected.length === 2) return 'blog_podcast';
  return '';
}

function sourcesForScope(scope) {
  switch (normalizeScopeParam(scope) || 'all') {
    case 'weekly_thing':
      return ['weekly_thing'];
    case 'blog':
      return ['blog'];
    case 'podcast':
      return ['podcast'];
    case 'both':
      return ['weekly_thing', 'blog'];
    case 'weekly_thing_podcast':
      return ['weekly_thing', 'podcast'];
    case 'blog_podcast':
      return ['blog', 'podcast'];
    case 'all':
    default:
      return [...sourceOrder];
  }
}

export { normalizeScopeParam, scopeForSources, sourcesForScope };
