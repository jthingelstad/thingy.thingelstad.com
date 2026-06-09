(function () {
  const storageKey = 'weeklyThingLibrarianToken';
  const userEmailKey = 'thingyUserEmail';
  const userProfileKey = 'thingyUserProfile';
  const refreshWindowSeconds = 60 * 60 * 24 * 3;

  function config() {
    return window.ThingyConfig || {};
  }

  function apiUrl() {
    return String(config().librarianApiUrl || '').replace(/\/$/, '');
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
    if (!apiUrl()) throw new Error('Thingy has not been connected to the archive API yet.');
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 60000);
    const response = await window.fetch(`${apiUrl()}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(headers || {})
      },
      body: JSON.stringify(payload || {}),
      signal: controller.signal
    }).catch((error) => {
      if (error.name === 'AbortError') {
        throw new Error('Thingy took too long to respond. Please try again.');
      }
      throw error;
    }).finally(() => {
      window.clearTimeout(timeout);
    });
    const requestId = response.headers.get('x-request-id');
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = data.error || data.message || `Request failed (${response.status})`;
      const error = new Error(requestId ? `${message} Reference: ${requestId}` : message);
      error.status = response.status;
      error.requestId = requestId;
      error.data = data;
      throw error;
    }
    return data;
  }

  async function refreshAuth() {
    if (!token() || tokenExpired()) return false;
    try {
      const data = await postJson('/auth', { action: 'refresh_session' }, authHeaders());
      persistAuth(data, storedEmail());
      return Boolean(data.token);
    } catch (error) {
      return false;
    }
  }

  async function ensureFreshToken() {
    if (!token()) return false;
    if (tokenExpired()) return false;
    if (!tokenNeedsRefresh()) return true;
    return await refreshAuth();
  }

  function normalizeModes(modes) {
    return Array.isArray(modes) ? modes.filter((mode) => mode && mode.id) : [];
  }

  function mergeProfile(data = {}, email = '') {
    const emailValue = normalizeEmail(data.email || email);
    if (emailValue) window.localStorage.setItem(userEmailKey, emailValue);
    const existingProfile = storedProfile();
    const incomingProfile = data.profile && typeof data.profile === 'object' ? data.profile : {};
    const incomingEntitlements = Array.isArray(data.entitlements) ? data.entitlements : incomingProfile.entitlements;
    const profile = {
      ...existingProfile,
      ...incomingProfile,
      preferred_name: String(incomingProfile.preferred_name || existingProfile.preferred_name || '').trim(),
      status: data.status || incomingProfile.status || existingProfile.status || '',
      supporting_member: data.status === 'premium'
        || Boolean(incomingProfile.supporting_member || existingProfile.supporting_member)
        || (Array.isArray(incomingEntitlements) && incomingEntitlements.includes('supporting_member')),
      entitlements: Array.isArray(incomingEntitlements) ? incomingEntitlements : existingProfile.entitlements,
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

  function returnPath(defaultPath) {
    const params = new URLSearchParams(window.location.search);
    const value = String(params.get('return') || defaultPath || '/').trim();
    return value.startsWith('/') && !value.startsWith('//') ? value : '/';
  }

  function signInUrl(returnTo) {
    const url = new URL('/signin/', window.location.origin);
    url.searchParams.set('return', returnTo || `${window.location.pathname}${window.location.search}${window.location.hash}`);
    return url.toString();
  }

  window.ThingySession = {
    storageKey,
    userEmailKey,
    userProfileKey,
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
    signInUrl
  };
}());
