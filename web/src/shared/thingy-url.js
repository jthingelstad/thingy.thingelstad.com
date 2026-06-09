function scrubUrlParams(names = []) {
  if (!names.length) return;
  const url = new URL(window.location.href);
  let changed = false;
  names.forEach((name) => {
    if (url.searchParams.has(name)) {
      url.searchParams.delete(name);
      changed = true;
    }
  });
  if (changed) {
    window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
  }
}

function isAuthError(error) {
  return error?.status === 401 || /validate|subscriber|unauthorized/i.test(String(error?.message || ''));
}

export {
  isAuthError,
  scrubUrlParams
};
