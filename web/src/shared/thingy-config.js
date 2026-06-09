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

export {
  librarianApiUrl,
  librarianStreamUrl,
  networkLinks,
  publicConfig,
  tinylyticsId
};
