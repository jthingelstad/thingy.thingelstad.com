// @ts-check
function scrubUrlParams(names: string[] = []) {
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

// Structured auth error codes from the Librarian API. Anything outside this
// set is NOT an auth error, even if its message happens to mention "subscriber"
// or "validate" — those words can appear in normal product errors and used to
// silently sign users out.
const AUTH_ERROR_CODES = new Set([
  'auth_required',
  'invalid_token',
  'magic_link_required',
  'session_expired',
  'subscriber_required',
  'unauthorized'
]);

function isAuthError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as Error & { code?: string; data?: { code?: string } };
  if (candidate.status === 401) return true;
  const code = String(candidate.code || candidate.data?.code || '').trim();
  return code ? AUTH_ERROR_CODES.has(code) : false;
}

export { AUTH_ERROR_CODES, isAuthError, scrubUrlParams };
