import { librarianApiUrl } from './thingy-config.js';
import { postJsonRequest } from './thingy-http.js';

const storageKey = 'weeklyThingLibrarianToken';
const userEmailKey = 'thingyUserEmail';
const userProfileKey = 'thingyUserProfile';
const pendingReturnParamsKey = 'thingyPendingReturnParams';
const refreshWindowSeconds = 60 * 60 * 24 * 3;
const privateReturnParams = ['email', 'prompt', 'from', 'scope', 'corpus', 'dispatch_test', 'test', 'login_token', 'magic_token', 'state', 'code'];

function apiUrl() {
  return librarianApiUrl();
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function token() {
  return window.localStorage.getItem(storageKey) || '';
}

function tokenPayload(value) {
  const encoded = String(value || token()).split('.')[0] || '';
  if (!encoded) return null;
  try {
    const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    return JSON.parse(window.atob(padded));
  } catch (error) {
    return null;
  }
}

function tokenExpired(value, skewSeconds = 60) {
  const payload = tokenPayload(value || token());
  const expiresAt = Number(payload && payload.exp || 0);
  return !expiresAt || expiresAt <= Math.floor(Date.now() / 1000) + skewSeconds;
}

function tokenNeedsRefresh(value) {
  const payload = tokenPayload(value || token());
  const expiresAt = Number(payload && payload.exp || 0);
  return Boolean(expiresAt) && expiresAt <= Math.floor(Date.now() / 1000) + refreshWindowSeconds;
}

function authHeaders() {
  return token() ? { authorization: `Bearer ${token()}` } : {};
}

async function postJson(path, payload, headers) {
  return postJsonRequest({
    baseUrl: apiUrl(),
    path,
    payload,
    headers,
    missingMessage: 'Thingy has not been connected to the archive API yet.'
  });
}

// Returns the parsed /auth payload on success (so callers can update UI
// state from it), or null on any failure.
async function refreshAuth() {
  if (!token() || tokenExpired()) return null;
  try {
    const data = await postJson('/auth', { action: 'refresh_session' }, authHeaders());
    if (!data || !data.token) return null;
    persistAuth(data, storedEmail());
    return data;
  } catch (error) {
    return null;
  }
}

async function ensureFreshToken() {
  if (!token()) return false;
  if (tokenExpired()) return false;
  if (!tokenNeedsRefresh()) return true;
  return Boolean(await refreshAuth());
}

function normalizeModes(modes) {
  return Array.isArray(modes) ? modes.filter((mode) => mode && mode.id) : [];
}

function firstPresentObjectValue(source = {}, keys = []) {
  if (!source || typeof source !== 'object') return undefined;
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(source, key)) return source[key];
  }
  return undefined;
}

function incomingDiscordConnection(data = {}, profile = {}) {
  const keys = ['discord_connection', 'discordConnection', 'discord_user', 'discordUser'];
  const topLevelValue = firstPresentObjectValue(data, keys);
  if (topLevelValue !== undefined) return topLevelValue;
  return firstPresentObjectValue(profile, keys);
}

function mergeProfile(data = {}, email = '') {
  const emailValue = normalizeEmail(data.email || email);
  if (emailValue) window.localStorage.setItem(userEmailKey, emailValue);
  const existingProfile = storedProfile();
  const incomingProfile = data.profile && typeof data.profile === 'object' ? data.profile : {};
  const nextDiscordConnection = incomingDiscordConnection(data, incomingProfile);
  const hasIncomingEntitlements = Array.isArray(data.entitlements) || Array.isArray(incomingProfile.entitlements);
  const incomingEntitlements = Array.isArray(data.entitlements) ? data.entitlements : incomingProfile.entitlements;
  const entitlements = Array.isArray(incomingEntitlements) ? incomingEntitlements : existingProfile.entitlements;
  const profile = {
    ...existingProfile,
    ...incomingProfile,
    preferred_name: String(incomingProfile.preferred_name || existingProfile.preferred_name || '').trim(),
    status: data.status || incomingProfile.status || existingProfile.status || '',
    supporting_member: hasIncomingEntitlements
      ? Boolean(data.status === 'premium' || incomingProfile.supporting_member || (Array.isArray(entitlements) && entitlements.includes('supporting_member')))
      : Boolean(incomingProfile.supporting_member || existingProfile.supporting_member),
    entitlements,
    discord_connection: nextDiscordConnection === undefined ? existingProfile.discord_connection : nextDiscordConnection,
    modes: normalizeModes(data.modes || incomingProfile.modes || existingProfile.modes)
  };
  window.localStorage.setItem(userProfileKey, JSON.stringify(profile));
  return profile;
}

function updateStoredProfile(patch = {}) {
  const existingProfile = storedProfile();
  const profile = { ...existingProfile, ...(patch || {}) };
  window.localStorage.setItem(userProfileKey, JSON.stringify(profile));
  return profile;
}

function persistAuth(data, email) {
  if (!data || !data.token) return null;
  window.localStorage.setItem(storageKey, data.token);
  return mergeProfile(data, email);
}

function clearAuth() {
  window.localStorage.removeItem(storageKey);
  window.localStorage.removeItem(userProfileKey);
}

function storedEmail() {
  return normalizeEmail(window.localStorage.getItem(userEmailKey) || '');
}

function storedProfile() {
  try {
    return JSON.parse(window.localStorage.getItem(userProfileKey) || '{}') || {};
  } catch (error) {
    return {};
  }
}

function hasEntitlement(name) {
  const entitlements = storedProfile().entitlements || [];
  return Array.isArray(entitlements) && entitlements.includes(name);
}

function relativeUrl(value, defaultPath = '/') {
  const raw = String(value || defaultPath || '/').trim();
  if (!raw.startsWith('/') || raw.startsWith('//')) return new URL(defaultPath || '/', window.location.origin);
  return new URL(raw, window.location.origin);
}

function pathFromUrl(url) {
  return `${url.pathname}${url.search}${url.hash}`;
}

function stashPrivateReturnParams(url) {
  const moved = [];
  privateReturnParams.forEach((name) => {
    const values = url.searchParams.getAll(name);
    if (!values.length) return;
    values.forEach((value) => moved.push([name, value]));
    url.searchParams.delete(name);
  });
  if (!moved.length) return;
  try {
    window.sessionStorage.setItem(pendingReturnParamsKey, JSON.stringify({
      path: url.pathname,
      params: moved
    }));
  } catch (error) {
    // If sessionStorage is unavailable, prefer a clean sign-in URL over leaking private params.
  }
}

function returnPath(defaultPath) {
  const params = new URLSearchParams(window.location.search);
  return pathFromUrl(relativeUrl(params.get('return'), defaultPath || '/'));
}

function restorePendingReturnParams(returnTo) {
  const url = relativeUrl(returnTo, '/chat/');
  try {
    const pending = JSON.parse(window.sessionStorage.getItem(pendingReturnParamsKey) || '{}') || {};
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

function signInUrl(returnTo) {
  const url = new URL('/signin/', window.location.origin);
  const destination = relativeUrl(returnTo || `${window.location.pathname}${window.location.search}${window.location.hash}`, '/chat/');
  stashPrivateReturnParams(destination);
  url.searchParams.set('return', pathFromUrl(destination));
  return url.toString();
}

export {
  storageKey,
  userEmailKey,
  userProfileKey,
  pendingReturnParamsKey,
  apiUrl,
  normalizeEmail,
  token,
  tokenPayload,
  tokenExpired,
  tokenNeedsRefresh,
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
