import * as defaultSession from './thingy-session.ts';
import { normalizePreferredName, savePreferredName } from './thingy-account.ts';
import { normalizeModes } from './thingy-modes.ts';
import {
  displayEmail as displayEmailSignal,
  displayProfile as displayProfileSignal,
  signedIn as signedInSignal
} from './stores/ui-store.ts';

interface AuthFlowOptions {
  track?: boolean;
}

interface ChatAuthActionsOptions {
  session?: typeof defaultSession;
  state: ThingyChatState;
  track: (name: string, value?: string) => void;
  onModesChanged: () => void;
}

function createChatAuthActions(options: ChatAuthActionsOptions) {
  const session = options.session || defaultSession;
  const { state, track, onModesChanged } = options;
  let awaitingName = false;
  let accountProfileRefreshAt = 0;
  let accountProfileRefreshPromise: Promise<boolean> | null = null;

  function normalizeEmail(value: unknown) {
    return session.normalizeEmail(value);
  }

  function hasSession() {
    return session.sessionActive();
  }

  function storedEmail() {
    return normalizeEmail(session.storedEmail());
  }

  function userProfile() {
    return session.storedProfile();
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
    displayEmailSignal.value = session.storedEmail();
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

  async function refreshStoredAuth(opts: AuthFlowOptions = {}) {
    if (!hasSession()) return false;
    const shouldTrack = opts.track !== false;
    const data = await session.refreshAuth();
    if (!data) {
      if (shouldTrack) track('librarian.auth_refresh_error');
      return false;
    }
    setUserProfile(data);
    refreshAccountIdentity();
    if (shouldTrack) track('librarian.auth_refresh_success');
    return true;
  }

  function redirectToSignIn(returnTo = '/chat/') {
    session.clearAuth();
    signedInSignal.value = false;
    window.location.href = session.signInUrl(returnTo);
  }

  async function refreshAccountProfile(opts: { force?: boolean } = {}) {
    if (!hasSession()) return false;
    const now = Date.now();
    if (!opts.force && now - accountProfileRefreshAt < 30000) return false;
    if (accountProfileRefreshPromise) return accountProfileRefreshPromise;
    accountProfileRefreshAt = now;
    accountProfileRefreshPromise = refreshStoredAuth({ track: false }).finally(() => {
      accountProfileRefreshPromise = null;
    });
    return accountProfileRefreshPromise;
  }

  async function ensureSession() {
    if (!hasSession()) return false;
    if (await session.ensureSession()) {
      return true;
    }
    redirectToSignIn();
    track('librarian.session_expired');
    return false;
  }

  return {
    ensureSession,
    hasSession,
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
    userProfile
  };
}

export { createChatAuthActions };
export type { AuthFlowOptions };
