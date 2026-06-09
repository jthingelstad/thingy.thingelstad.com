function publicConfig() {
  return window.ThingyConfig || {};
}

function librarianApiUrl() {
  const config = publicConfig();
  const source = window.WEEKLY_THING_LIBRARIAN_API === undefined
    ? config.librarianApiUrl
    : window.WEEKLY_THING_LIBRARIAN_API;
  return String(source || '').replace(/\/$/, '');
}

function librarianStreamUrl() {
  const config = publicConfig();
  const source = window.WEEKLY_THING_LIBRARIAN_STREAM_API === undefined
    ? config.librarianStreamUrl
    : window.WEEKLY_THING_LIBRARIAN_STREAM_API;
  return String(source || '').replace(/\/$/, '');
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
