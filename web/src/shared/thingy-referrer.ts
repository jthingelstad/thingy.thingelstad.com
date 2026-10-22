// A seeded ?prompt= AUTO-SENDS for a signed-in reader only when the visit
// came from one of Jamie's own sites (or in-site navigation): any page on
// the web can link ?prompt=<attacker text>, and auto-submitting it would
// spend the reader's quota and plant attacker words as their own turn
// (audit W3). Everyone else gets the composer prefilled.
//
// Trusted: this site's own host, thingelstad.com and its subdomains (by
// host, as since W3), and Things I've built at exactly
// https://thingelstad.xyz (Jamie, 2026-10-21: "Yes") - by origin, so no
// http, no www, no subdomains and no other port. tests/referrer.test.mjs
// pins both lists.
const TRUSTED_ORIGINS = new Set(['https://thingelstad.xyz']);

export function promptAutoSendFrom(referrer: string, ownHost: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(referrer);
  } catch {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  return (
    host === ownHost.toLowerCase() ||
    host === 'thingelstad.com' ||
    host.endsWith('.thingelstad.com') ||
    TRUSTED_ORIGINS.has(parsed.origin)
  );
}
