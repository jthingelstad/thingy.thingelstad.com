import { networkLinks } from './thingy-config.ts';

const links = networkLinks();

function buildFromMap() {
  const map = new Map<string, { name: string; href: string }>();
  for (const link of links) {
    if (!link.href || !link.label) continue;
    const name = link.label;
    const href = link.href;
    try {
      const host = new URL(href).hostname.toLowerCase().replace(/^www\./, '');
      map.set(host, { name, href });
      map.set(`www.${host}`, { name, href });
    } catch (error) {
      /* ignore */
    }
    (link.aliases || []).forEach((alias) => {
      const key = String(alias || '')
        .toLowerCase()
        .trim();
      if (key) map.set(key, { name, href });
    });
    if (link.key) map.set(String(link.key).toLowerCase(), { name, href });
  }
  return map;
}

function resolveFromValue(value: unknown): { name: string; href: string } | null {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const map = buildFromMap();
  let host = raw.toLowerCase();
  let href = '';
  try {
    if (/^https?:/i.test(raw)) {
      const parsed = new URL(raw);
      host = parsed.hostname.toLowerCase().replace(/^www\./, '');
      href = parsed.href;
    }
  } catch (error) {
    /* ignore */
  }
  const match = map.get(host) || map.get(raw.toLowerCase());
  if (!match) return null;
  return { name: match.name, href: href || match.href };
}

export { resolveFromValue };
