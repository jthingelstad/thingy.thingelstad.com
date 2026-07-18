let cachedConfig: ThingyPublicConfig | null = null;

function decodeConfig(value: string) {
  if (!value) return {};
  try {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    return JSON.parse(window.atob(padded)) as ThingyPublicConfig;
  } catch (error) {
    return {};
  }
}

function publicConfig() {
  if (cachedConfig) return cachedConfig;
  const encoded = document.querySelector<HTMLMetaElement>('meta[name="thingy-config"]')?.content || '';
  cachedConfig = Object.freeze({ ...decodeConfig(encoded), ...(window.ThingyConfig || {}) });
  return cachedConfig;
}

function librarianApiUrl() {
  const config = publicConfig();
  return String(config.librarianApiUrl || '').replace(/\/$/, '');
}

function librarianStreamUrl() {
  const config = publicConfig();
  return String(config.librarianStreamUrl || '').replace(/\/$/, '');
}

function tinylyticsId() {
  return String(publicConfig().tinylyticsId || '');
}

function networkLinks() {
  const links = publicConfig().networkLinks;
  return Array.isArray(links) ? links : [];
}

// Build stamp injected by vite.config.ts: "<git short hash> · <date>",
// or 'dev' when serving locally without git metadata.
function buildId() {
  return String(publicConfig().buildId || 'dev');
}

export { buildId, librarianApiUrl, librarianStreamUrl, networkLinks, tinylyticsId };
