import { networkLinks } from './thingy-config.js';

const links = networkLinks();

function buildFromMap() {
  const map = new Map();
  for (const link of links) {
    try {
      const host = new URL(link.href).hostname.toLowerCase().replace(/^www\./, '');
      map.set(host, { name: link.label, href: link.href });
      map.set(`www.${host}`, { name: link.label, href: link.href });
    } catch (error) {
      /* ignore */
    }
    (link.aliases || []).forEach((alias) => {
      const key = String(alias || '')
        .toLowerCase()
        .trim();
      if (key) map.set(key, { name: link.label, href: link.href });
    });
    if (link.key) map.set(String(link.key).toLowerCase(), { name: link.label, href: link.href });
  }
  return map;
}

function resolveFromValue(value) {
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

function applyReturnChip() {
  const params = new URLSearchParams(window.location.search);
  const returnChip = document.getElementById('return-chip');
  const returnChipLabel = document.getElementById('return-chip-label');
  if (!returnChip || !returnChipLabel) return;
  const resolved = resolveFromValue(params.get('from'));
  if (!resolved) return;
  returnChipLabel.textContent = resolved.name;
  returnChip.href = resolved.href;
  returnChip.hidden = false;
}

export { applyReturnChip };
