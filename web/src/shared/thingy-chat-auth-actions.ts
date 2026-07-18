import * as defaultSession from './thingy-session.ts';
import { normalizePreferredName, savePreferredName } from './thingy-account.ts';
import { normalizeModes } from './thingy-modes.ts';
import { scrubUrlParams } from './thingy-url.ts';
import { handleAuthResponse as handleAuthResponseStatus } from './thingy-auth-response.ts';
import { errorMessage } from './thingy-errors.ts';
import {
  authAction as authActionSignal,
  authBusy as authBusySignal,
  authEmail as authEmailSignal,
  authEmailError as authEmailErrorSignal,
  authMessage as authMessageSignal
} from './stores/chat-store.ts';
import {
  displayEmail as displayEmailSignal,
  displayProfile as displayProfileSignal,
  signedIn as signedInSignal
} from './stores/ui-store.ts';

const EMAIL_RE =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

interface AuthFlowOptions {
  track?: boolean;
  scrubEmailParam?: boolean;
}

interface ClearAuthOptions {
  message?: string;
  preserveEmail?: boolean;
  scrubAuthParams?: boolean;
}

interface ChatAuthActionsOptions {
  session?: typeof defaultSession;
  state: ThingyChatState;
  track: (name: string, value?: string) => void;
  onModesChanged: () => void;
  onAuthenticated: (data: ThingyAuthData, options: AuthFlowOptions) => void;
  onAuthCleared: (options: ClearAuthOptions) => void;
  clearActiveConversation: () => void;
}

function createChatAuthActions(options: ChatAuthActionsOptions) {
  const session = options.session || defaultSession;
  const { state, track, onModesChanged, onAuthenticated, onAuthCleared, clearActiveConversation } = options;
  let awaitingName = false;
  let authRequestGeneration = 0;
  let accountProfileRefreshAt = 0;
  let accountProfileRefreshPromise: Promise<boolean> | null = null;

  function normalizeEmail(value: unknown) {
    return session.normalizeEmail(value);
  }

  function token() {
    return session.token();
  }

  function tokenExpired(value = token(), skewSeconds = 60) {
    return session.tokenExpired(value, skewSeconds);
  }

  function tokenNeedsRefresh(value = token()) {
    return session.tokenNeedsRefresh(value);
  }

  function storedEmail() {
    const stored = session.storedEmail();
    const entered = String(authEmailSignal.value || '').trim();
    return normalizeEmail(entered || stored);
  }

  function userProfile() {
    return session.storedProfile();
  }

  function validateEmail() {
    const value = String(authEmailSignal.value || '').trim();
    if (!value || EMAIL_RE.test(value)) {
      authEmailErrorSignal.value = '';
      return true;
    }
    authEmailErrorSignal.value = 'Please enter a valid email address';
    return false;
  }

  function setUserProfile(data: ThingyApiResponse | ThingyAuthData) {
    const profile = session.mergeProfile(data || {}, storedEmail());
    const modes = normalizeModes(profile.modes || data?.modes || data?.profile?.modes || []);
    state.availableModes = modes.length ? modes : [{ id: 'thingy', label: 'Thingy' }];
    if (!state.availableModes.some((mode) => mode.id === state.activeMode)) state.activeMode = 'thingy';
    state.preferredName = String(profile.preferred_name || '').trim();
    session.updateStoredProfile({ ...profile, modes: state.availableModes });
    onModesChanged();
    return profile;
  }

  function refreshAccountIdentity() {
    const stored = session.storedEmail();
    displayEmailSignal.value = String(authEmailSignal.value || '').trim() || stored;
    displayProfileSignal.value = userProfile() || {};
    onModesChanged();
  }

  function rememberPreferredName(name: unknown) {
    const cleanName = String(name || '').trim();
    if (!cleanName) return;
    state.preferredName = cleanName;
    session.updateStoredProfile({ preferred_name: cleanName });
  }

  async function persistInferredPreferredName(name: unknown) {
    const { savedName } = await savePreferredName(session, name, normalizePreferredName);
    rememberPreferredName(savedName);
    refreshAccountIdentity();
    return savedName;
  }

  function readerProfileContext() {
    return { ...userProfile(), preferred_name: state.preferredName, awaiting_name: awaitingName };
  }

  function isAwaitingName() {
    return awaitingName;
  }

  function setAwaitingName(value: boolean) {
    awaitingName = Boolean(value);
  }

  function persistToken(value: string, data: ThingyAuthData = {}) {
    session.persistAuth({ ...data, token: value }, data.email || storedEmail());
    setUserProfile(data);
    if (data.email) authEmailSignal.value = normalizeEmail(data.email);
    signedInSignal.value = Boolean(token());
    refreshAccountIdentity();
  }

  async function refreshStoredAuth(opts: AuthFlowOptions = {}) {
    if (!token() || tokenExpired()) return false;
    const shouldTrack = opts.track !== false;
    const data = await session.refreshAuth();
    if (!data) {
      if (shouldTrack) track('librarian.auth_refresh_error');
      return false;
    }
    setUserProfile(data);
    if (data.email) authEmailSignal.value = normalizeEmail(data.email);
    refreshAccountIdentity();
    if (shouldTrack) track('librarian.auth_refresh_success');
    return true;
  }

  function redirectToSignIn(returnTo = '/chat/') {
    const emailValue = storedEmail();
    session.clearAuth();
    signedInSignal.value = false;
    if (emailValue) authEmailSignal.value = emailValue;
    window.location.href = session.signInUrl(returnTo);
  }

  async function refreshAccountProfile(opts: { force?: boolean } = {}) {
    if (!token() || tokenExpired()) return false;
    const now = Date.now();
    if (!opts.force && now - accountProfileRefreshAt < 30000) return false;
    if (accountProfileRefreshPromise) return accountProfileRefreshPromise;
    accountProfileRefreshAt = now;
    accountProfileRefreshPromise = refreshStoredAuth({ track: false }).finally(() => {
      accountProfileRefreshPromise = null;
    });
    return accountProfileRefreshPromise;
  }

  async function ensureFreshToken() {
    if (!token()) return false;
    if (!tokenExpired() && !tokenNeedsRefresh()) return true;
    const refreshable = tokenNeedsRefresh();
    if (refreshable && (await refreshStoredAuth())) return true;
    redirectToSignIn();
    track(refreshable ? 'librarian.auth_refresh_error' : 'librarian.session_expired');
    return false;
  }

  function clearAuthState(config: ClearAuthOptions = {}) {
    authRequestGeneration += 1;
    const message = String(config.message || '').trim();
    const existingMessage = authMessageSignal.value;
    const emailValue = storedEmail();
    session.clearAuth();
    signedInSignal.value = false;
    if (config.preserveEmail && emailValue) authEmailSignal.value = emailValue;
    if (config.scrubAuthParams) scrubUrlParams(['login_token', 'magic_token', 'email']);
    state.conversations = [];
    state.availableModes = [{ id: 'thingy', label: 'Thingy' }];
    state.activeMode = 'thingy';
    clearActiveConversation();
    authActionSignal.value = 'none';
    authMessageSignal.value = message || existingMessage || '';
    refreshAccountIdentity();
    onAuthCleared(config);
  }

  function handleAuthResponse(data: ThingyAuthData, opts: AuthFlowOptions = {}) {
    return handleAuthResponseStatus(data, {
      hideActions: () => (authActionSignal.value = 'none'),
      onToken: (authData: ThingyAuthData) => {
        persistToken(authData.token || '', authData);
        authActionSignal.value = 'none';
        onAuthenticated(authData, opts);
      },
      setMessage: (message: string) => (authMessageSignal.value = message || ''),
      showAction: (action: 'subscribe' | 'resend_confirmation') => (authActionSignal.value = action),
      track
    });
  }

  async function submitAuthAction(action: string) {
    if (!validateEmail()) return;
    const generation = authRequestGeneration;
    authBusySignal.value = true;
    authActionSignal.value = 'none';
    authMessageSignal.value =
      action === 'subscribe' ? 'Adding you to the Weekly Thing...' : 'Sending the confirmation email...';
    try {
      const data = await session.postJson(
        '/auth',
        { email: String(authEmailSignal.value || ''), action, source: 'thingy' },
        {}
      );
      if (generation !== authRequestGeneration) return;
      handleAuthResponse(data);
    } catch (error) {
      if (generation !== authRequestGeneration) return;
      authMessageSignal.value = errorMessage(error, 'Thingy could not complete that request.');
      track('librarian.auth_error', error instanceof Error && error.requestId ? 'server' : 'client');
    } finally {
      authBusySignal.value = false;
    }
  }

  async function submitAuthCheck(opts: AuthFlowOptions = {}) {
    if (!validateEmail()) return false;
    const generation = authRequestGeneration;
    authBusySignal.value = true;
    authActionSignal.value = 'none';
    authMessageSignal.value = 'Sending a sign-in link...';
    try {
      const data = await session.postJson(
        '/auth',
        { email: String(authEmailSignal.value || '').trim(), action: 'check', source: 'thingy' },
        {}
      );
      if (generation !== authRequestGeneration) return false;
      handleAuthResponse(data, opts);
      if (opts.scrubEmailParam) scrubUrlParams(['email']);
      return true;
    } catch (error) {
      if (generation !== authRequestGeneration) return false;
      authMessageSignal.value = errorMessage(error, 'Thingy could not send a sign-in link.');
      track('librarian.auth_error', error instanceof Error && error.requestId ? 'server' : 'client');
      return false;
    } finally {
      authBusySignal.value = false;
      validateEmail();
    }
  }

  return {
    clearAuthState,
    ensureFreshToken,
    isAwaitingName,
    normalizeEmail,
    persistInferredPreferredName,
    readerProfileContext,
    redirectToSignIn,
    refreshAccountIdentity,
    refreshAccountProfile,
    refreshStoredAuth,
    rememberPreferredName,
    setAwaitingName,
    setUserProfile,
    storedEmail,
    submitAuthAction,
    submitAuthCheck,
    token,
    tokenExpired,
    userProfile,
    validateEmail
  };
}

export { createChatAuthActions };
export type { AuthFlowOptions, ClearAuthOptions };
