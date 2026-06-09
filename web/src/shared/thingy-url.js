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

function signInReturnUrl(defaultPath = '/chat/') {
  const url = new URL('/signin/', window.location.origin);
  url.searchParams.set('return', `${window.location.pathname}${window.location.search}${window.location.hash}` || defaultPath);
  return url.toString();
}

function isAuthError(error) {
  return error?.status === 401 || /validate|subscriber|unauthorized/i.test(String(error?.message || ''));
}

export {
  isAuthError,
  scrubUrlParams,
  signInReturnUrl
};
