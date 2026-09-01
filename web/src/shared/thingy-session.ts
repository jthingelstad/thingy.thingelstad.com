// @ts-check
import { librarianApiUrl } from './thingy-config.ts';
import { postJsonRequest } from './thingy-http.ts';

const storageKey = 'weeklyThingLibrarianToken';
// Non-sensitive signed-in hint. The real session is an HttpOnly cookie the
// page cannot read; this only lets the shell render optimistically and lets
// tabs notice each other's sign-in state. Never treated as a credential.
const signedInHintKey = 'thingySignedIn';
const userEmailKey = 'thingyUserEmail';
const userProfileKey = 'thingyUserProfile';
const pendingReturnParamsKey = 'thingyPendingReturnParams';
const privateReturnParams = [
  'email',
  'prompt',
  'from',
  'explore',
  'issue',
  'scope',
  'corpus',
  'login_token',
  'magic_token'
];

function apiUrl() {
  return librarianApiUrl();
}

function normalizeEmail(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase();
}

// Legacy localStorage token accessor. Kept only for the migration shim and
// Bearer fallback while pre-cookie sessions roll through (remove after
// 2026-09-15: by then every 9-day session has either migrated or expired).
function token() {
  return window.localStorage.getItem(storageKey) || '';
}

function sessionActive(): boolean {
  if (window.localStorage.getItem(signedInHintKey)) return true;
  return Boolean(token()) && !legacyTokenExpired();
}

function tokenPayload(value?: string): ThingyTokenPayload | null {
  const encoded = String(value || token()).split('.')[0] || '';
  if (!encoded) return null;
  try {
    const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    return JSON.parse(window.atob(padded)) as ThingyTokenPayload;
  } catch (error) {
    return null;
  }
}

function legacyTokenExpired(value?: string, skewSeconds = 60): boolean {
  const payload = tokenPayload(value || token());
  const expiresAt = Number((payload && payload.exp) || 0);
  return !expiresAt || expiresAt <= Math.floor(Date.now() / 1000) + skewSeconds;
}

// The HttpOnly cookie hides exp from the page, so "expired" now means "no
// session": the server slides the cookie itself on session/refresh calls.
function tokenExpired(): boolean {
  return !sessionActive();
}

// Legacy Bearer attach: only meaningful while an un-migrated localStorage
// token exists. Cookie sessions send no auth header - the cookie rides along
// on every same-origin request.
function authHeaders(): Record<string, string> {
  const legacy = token();
  return legacy ? { authorization: `Bearer ${legacy}` } : {};
}

async function postJson(
  path: string,
  payload: unknown,
  headers: Record<string, string>,
  options: ThingyRequestOptions = {}
): Promise<ThingyApiResponse> {
  return postJsonRequest({
    baseUrl: apiUrl(),
    path,
    payload,
    headers,
    ...options,
    missingMessage: 'Thingy has not been connected to the archive API yet.'
  });
}

// Confirm (and slide) the session with the server. Handles the one-time
// legacy migration: a pre-cookie localStorage token is exchanged via
// refresh_session, the server answers with the HttpOnly cookie, and the
// stored token is deleted. Cookie sessions use the 'session' probe. The
// email rides along (self-bound server-side) so entitlements re-verify
// instead of silently decaying. Returns the parsed payload or null.
let sessionConfirmedAt = 0;
const sessionConfidenceMs = 10 * 60 * 1000;

async function refreshAuth() {
  const legacy = token();
  try {
    if (legacy && !legacyTokenExpired(legacy)) {
      const data = await postJson(
        '/auth',
        { action: 'refresh_session', email: storedEmail() || undefined },
        { authorization: `Bearer ${legacy}` }
      );
      if (!data || !data.token) return null;
      window.localStorage.removeItem(storageKey);
      persistAuth(data, storedEmail());
      return data;
    }
    if (legacy) window.localStorage.removeItem(storageKey);
    const data = await postJson('/auth', { action: 'session', email: storedEmail() || undefined }, {});
    if (!data || data.authenticated !== true) {
      window.localStorage.removeItem(signedInHintKey);
      sessionConfirmedAt = 0;
      return null;
    }
    persistAuth(data, storedEmail());
    return data;
  } catch (error) {
    return null;
  }
}

// Cheap gate used before every send: trust a recent server confirmation,
// otherwise probe (which also slides the cookie server-side).
async function ensureFreshToken() {
  if (!sessionActive()) return false;
  if (Date.now() - sessionConfirmedAt < sessionConfidenceMs) return true;
  return Boolean(await refreshAuth());
}

function normalizeModes(modes: unknown): ThingyMode[] {
  return Array.isArray(modes)
    ? modes.filter((mode): mode is ThingyMode => Boolean(mode && typeof mode === 'object' && 'id' in mode))
    : [];
}

function mergeProfile(data: ThingyAuthData = {}, email = ''): LibrarianProfile {
  const emailValue = normalizeEmail(data.email || email);
  if (emailValue) window.localStorage.setItem(userEmailKey, emailValue);
  const existingProfile = storedProfile();
  const incomingProfile = data.profile && typeof data.profile === 'object' ? data.profile : {};
  const hasIncomingEntitlements = Array.isArray(data.entitlements) || Array.isArray(incomingProfile.entitlements);
  const incomingEntitlements = Array.isArray(data.entitlements) ? data.entitlements : incomingProfile.entitlements;
  const entitlements = Array.isArray(incomingEntitlements) ? incomingEntitlements : existingProfile.entitlements;
  const profile = {
    ...existingProfile,
    ...incomingProfile,
    preferred_name: String(incomingProfile.preferred_name || existingProfile.preferred_name || '').trim(),
    status: data.status || incomingProfile.status || existingProfile.status || '',
    supporting_member: hasIncomingEntitlements
      ? Boolean(
          data.status === 'premium' ||
          incomingProfile.supporting_member ||
          (Array.isArray(entitlements) && entitlements.includes('supporting_member'))
        )
      : Boolean(incomingProfile.supporting_member || existingProfile.supporting_member),
    entitlements,
    modes: normalizeModes(data.modes || incomingProfile.modes || existingProfile.modes)
  };
  window.localStorage.setItem(userProfileKey, JSON.stringify(profile));
  return profile;
}

function updateStoredProfile(patch: Partial<LibrarianProfile> = {}): LibrarianProfile {
  const existingProfile = storedProfile();
  const profile = { ...existingProfile, ...(patch || {}) };
  window.localStorage.setItem(userProfileKey, JSON.stringify(profile));
  return profile;
}

// The session credential is the HttpOnly cookie the server just set; the
// page records only the non-sensitive hint and profile. The body token is
// deliberately NOT stored (cookie-era clients never persist a credential).
function persistAuth(data: ThingyAuthData, email: string): LibrarianProfile | null {
  if (!data) return null;
  window.localStorage.setItem(signedInHintKey, '1');
  sessionConfirmedAt = Date.now();
  return mergeProfile(data, email);
}

function clearAuth() {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  try {
    // Best-effort server-side cookie clear that survives the sign-out
    // navigation. Failure is harmless: the 9-day TTL bounds the cookie.
    void window.fetch(`${apiUrl()}/auth`, {
      method: 'POST',
      keepalive: true,
      headers,
      body: JSON.stringify({ action: 'sign_out' })
    });
  } catch (error) {
    /* ignored */
  }
  window.localStorage.removeItem(storageKey);
  window.localStorage.removeItem(signedInHintKey);
  window.localStorage.removeItem(userProfileKey);
  sessionConfirmedAt = 0;
}

function storedEmail() {
  return normalizeEmail(window.localStorage.getItem(userEmailKey) || '');
}

function storedProfile(): LibrarianProfile {
  try {
    return (JSON.parse(window.localStorage.getItem(userProfileKey) || '{}') || {}) as LibrarianProfile;
  } catch (error) {
    return {};
  }
}

function hasEntitlement(name: string): boolean {
  const entitlements = storedProfile().entitlements || [];
  return Array.isArray(entitlements) && entitlements.includes(name);
}

function relativeUrl(value: unknown, defaultPath = '/'): URL {
  const raw = String(value || defaultPath || '/').trim();
  if (!raw.startsWith('/') || raw.startsWith('//')) return new URL(defaultPath || '/', window.location.origin);
  return new URL(raw, window.location.origin);
}

function pathFromUrl(url: URL): string {
  return `${url.pathname}${url.search}${url.hash}`;
}

function stashPrivateReturnParams(url: URL) {
  const moved: Array<[string, string]> = [];
  privateReturnParams.forEach((name) => {
    const values = url.searchParams.getAll(name);
    if (!values.length) return;
    values.forEach((value) => moved.push([name, value]));
    url.searchParams.delete(name);
  });
  if (!moved.length) return;
  try {
    window.sessionStorage.setItem(
      pendingReturnParamsKey,
      JSON.stringify({
        path: url.pathname,
        params: moved
      })
    );
  } catch (error) {
    // If sessionStorage is unavailable, prefer a clean sign-in URL over leaking private params.
  }
}

function returnPath(defaultPath = '/'): string {
  const params = new URLSearchParams(window.location.search);
  return pathFromUrl(relativeUrl(params.get('return'), defaultPath || '/'));
}

function restorePendingReturnParams(returnTo: string): string {
  const url = relativeUrl(returnTo, '/chat/');
  try {
    const pending = (JSON.parse(window.sessionStorage.getItem(pendingReturnParamsKey) || '{}') || {}) as {
      path?: string;
      params?: Array<[string, string]>;
    };
    if (pending.path === url.pathname && Array.isArray(pending.params)) {
      pending.params.forEach(([name, value]) => {
        if (name && !url.searchParams.has(name)) url.searchParams.append(name, value);
      });
      window.sessionStorage.removeItem(pendingReturnParamsKey);
    }
  } catch (error) {
    window.sessionStorage.removeItem(pendingReturnParamsKey);
  }
  return pathFromUrl(url);
}

function signInUrl(returnTo = ''): string {
  const url = new URL('/signin/', window.location.origin);
  const destination = relativeUrl(
    returnTo || `${window.location.pathname}${window.location.search}${window.location.hash}`,
    '/chat/'
  );
  stashPrivateReturnParams(destination);
  url.searchParams.set('return', pathFromUrl(destination));
  return url.toString();
}

export {
  storageKey,
  signedInHintKey,
  userEmailKey,
  userProfileKey,
  pendingReturnParamsKey,
  apiUrl,
  normalizeEmail,
  token,
  sessionActive,
  tokenPayload,
  tokenExpired,
  authHeaders,
  postJson,
  refreshAuth,
  ensureFreshToken,
  mergeProfile,
  updateStoredProfile,
  persistAuth,
  clearAuth,
  storedEmail,
  storedProfile,
  hasEntitlement,
  returnPath,
  restorePendingReturnParams,
  signInUrl
};
