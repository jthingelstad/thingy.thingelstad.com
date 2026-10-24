// Links from Thingy to Jamie's other sites carry ?ref=thingy-<placement>
// (thingelstad.com AGENTS.md, "Links between the sites"), so Tinylytics'
// Sources report on the destination shows which connections people use.
// Only links Thingy itself renders get one: source cards, citation chips
// and template links. Identity links (the h-card, rel=me) never do.

// The strip's sister sites, by host without www (tests/refs.test.mjs pins
// this to contracts/sites.json). The blog's posts live on both
// thingelstad.com and www.thingelstad.com.
const SISTER_HOSTS = new Set([
  'thingelstad.com',
  'weekly.thingelstad.com',
  'another.thingelstad.com',
  'thingelstad.xyz',
  'links.thingelstad.xyz'
]);

function sisterHost(url: string): string {
  try {
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol)) return '';
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    return SISTER_HOSTS.has(host) ? host : '';
  } catch {
    return '';
  }
}

// Adds ref=<value> to an absolute link to a sister site: before any
// #fragment, after any query the link already has. A link that already
// names a ref keeps it; every other link comes back unchanged.
export function withRef(url: string, ref: string): string {
  if (!url || !sisterHost(url)) return url;
  const hashAt = url.indexOf('#');
  const base = hashAt === -1 ? url : url.slice(0, hashAt);
  const hash = hashAt === -1 ? '' : url.slice(hashAt);
  const queryAt = base.indexOf('?');
  const query = queryAt === -1 ? '' : base.slice(queryAt + 1);
  if (new URLSearchParams(query).has('ref')) return url;
  const joiner = queryAt === -1 ? '?' : query === '' || query.endsWith('&') ? '' : '&';
  return `${base}${joiner}ref=${encodeURIComponent(ref)}${hash}`;
}

export { SISTER_HOSTS };
