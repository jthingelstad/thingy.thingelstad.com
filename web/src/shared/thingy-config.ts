function publicConfig() {
  return window.ThingyConfig || {};
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

export { buildId, librarianApiUrl, librarianStreamUrl, networkLinks, publicConfig, tinylyticsId };
