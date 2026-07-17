// @ts-check
function normalizeModeId(value: unknown): string {
  const key = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  return key || 'thingy';
}

function normalizeModes(value: unknown): ThingyMode[] {
  const raw: Array<string | Partial<ThingyMode>> = Array.isArray(value) ? value : [];
  const modes: ThingyMode[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const id = normalizeModeId(typeof entry === 'string' ? entry : entry?.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    modes.push({
      id,
      label: String(
        (typeof entry === 'string' ? '' : entry.label) ||
          id.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
      ).trim()
    });
  }
  if (!seen.has('thingy')) modes.unshift({ id: 'thingy', label: 'Thingy' });
  return modes;
}

function modeIcon(id: unknown): string {
  return (
    {
      thingy: 'sparkles',
      thought_partner: 'brain-circuit',
      research_guide: 'search',
      trusted_circle: 'users-round'
    }[normalizeModeId(id)] || 'sparkles'
  );
}

function modeClass(id: unknown): string {
  return normalizeModeId(id).replace(/[^a-z0-9_]/g, '_');
}

export { modeClass, modeIcon, normalizeModeId, normalizeModes };
