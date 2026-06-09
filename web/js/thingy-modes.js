(function () {
  function normalizeModeId(value) {
    const key = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
    return key || 'thingy';
  }

  function normalizeModes(value) {
    const raw = Array.isArray(value) ? value : [];
    const modes = [];
    const seen = new Set();
    for (const entry of raw) {
      const id = normalizeModeId(typeof entry === 'string' ? entry : entry?.id);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      modes.push({
        id,
        label: String(entry?.label || id.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())).trim()
      });
    }
    if (!seen.has('thingy')) modes.unshift({ id: 'thingy', label: 'Thingy' });
    return modes;
  }

  function modeGlyph(id) {
    return {
      thingy: '•',
      thought_partner: '◐',
      research_guide: '⌕',
      trusted_circle: '◎'
    }[normalizeModeId(id)] || '•';
  }

  function modeClass(id) {
    return normalizeModeId(id).replace(/[^a-z0-9_]/g, '_');
  }

  window.ThingyModes = {
    normalizeModeId,
    normalizeModes,
    modeGlyph,
    modeClass
  };
}());
