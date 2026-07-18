// The chat flow layer: session/auth flows, conversation summary + server
// flows, and the streaming POSTs. Extracted from bootChat so the logic has
// explicit dependencies and mirrors thingy-dispatch-actions.js. The factory
// writes chat-store / ui-store signals directly; DOM-facing concerns arrive
// as `ui` hooks so this module never builds or queries page structure.

import * as defaultSession from './thingy-session.ts';
import { normalizePreferredName, savePreferredName } from './thingy-account.ts';
import { postJsonRequest } from './thingy-http.ts';
import { createChatStreamActions } from './thingy-chat-stream-actions.ts';
import { normalizeModes } from './thingy-modes.ts';
import { createChatConversationActions } from './thingy-chat-conversation-actions.ts';
import { scrubUrlParams } from './thingy-url.ts';
import { handleAuthResponse as handleAuthResponseStatus } from './thingy-auth-response.ts';
import { errorMessage } from './thingy-errors.ts';
import {
  activeConversationId as activeConversationIdSignal,
  activeMode as activeModeSignal,
  answerInFlight as answerInFlightSignal,
  authAction as authActionSignal,
  authBusy as authBusySignal,
  authEmail as authEmailSignal,
  authEmailError as authEmailErrorSignal,
  authMessage as authMessageSignal,
  availableModes as availableModesSignal,
  conversationCreateInFlight as conversationCreateInFlightSignal,
  conversations as conversationsSignal,
  stoppable as stoppableSignal
} from './stores/chat-store.ts';
import {
  displayEmail as displayEmailSignal,
  displayPreferredName as displayPreferredNameSignal,
  displayProfile as displayProfileSignal,
  signedIn as signedInSignal
} from './stores/ui-store.ts';

const EMAIL_RE =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

interface ChatUiHooks {
  currentScope?: () => string;
  scheduleChatScroll?: (options?: { force?: boolean }) => void;
  track?: (name: string, value?: string) => void;
  onModesChanged?: () => void;
  onActiveConversationChanged?: () => void;
  onQuestionStateChanged?: () => void;
  onAuthenticated?: (data: ThingyAuthData, options: AuthFlowOptions) => void;
  onAuthCleared?: (options: ClearAuthOptions) => void;
}

interface ChatActionsOptions {
  session?: typeof defaultSession;
  streamBase?: string;
  maxRecents?: number;
  localConversationPrefix?: string;
  activeConvKey?: string;
  ui?: ChatUiHooks;
}

interface AuthFlowOptions {
  track?: boolean;
  scrubEmailParam?: boolean;
}

interface ClearAuthOptions {
  message?: string;
  preserveEmail?: boolean;
  scrubAuthParams?: boolean;
}

// Signals are the source of truth for chat state. `chatState` is a
// setter-backed proxy: writing `chatState.conversations = [...]` notifies
// the corresponding signal immediately, and reads return the signal's
// current value. Entries held by the conversations signal are treated as
// immutable — updating one means reassigning with a new array and a new
// entry object, otherwise subscribers never re-render.
const chatState: ThingyChatState = {
  get conversations() {
    return conversationsSignal.value;
  },
  set conversations(value) {
    conversationsSignal.value = value;
  },
  get activeConversationId() {
    return activeConversationIdSignal.value;
  },
  set activeConversationId(value) {
    activeConversationIdSignal.value = value;
  },
  get availableModes() {
    return availableModesSignal.value;
  },
  set availableModes(value) {
    availableModesSignal.value = value;
  },
  get activeMode() {
    return activeModeSignal.value;
  },
  set activeMode(value) {
    activeModeSignal.value = value;
  },
  get preferredName() {
    return displayPreferredNameSignal.value;
  },
  set preferredName(value) {
    displayPreferredNameSignal.value = value;
  }
};

function createChatActions(options: ChatActionsOptions = {}) {
  const session = options.session || defaultSession;
  const streamBase = String(options.streamBase || '');
  const maxRecents = Number(options.maxRecents || 20);
  const localConversationPrefix = options.localConversationPrefix || 'local-chat-';
  const activeConvKey = options.activeConvKey || 'thingyActiveConversation';
  const ui = options.ui || {};
  const currentScope = typeof ui.currentScope === 'function' ? ui.currentScope : () => 'all';
  const scheduleChatScroll = typeof ui.scheduleChatScroll === 'function' ? ui.scheduleChatScroll : () => {};
  const track = typeof ui.track === 'function' ? ui.track : () => {};
  const onModesChanged = typeof ui.onModesChanged === 'function' ? ui.onModesChanged : () => {};
  const onActiveConversationChanged =
    typeof ui.onActiveConversationChanged === 'function' ? ui.onActiveConversationChanged : () => {};
  const onQuestionStateChanged = typeof ui.onQuestionStateChanged === 'function' ? ui.onQuestionStateChanged : () => {};
  const onAuthenticated = typeof ui.onAuthenticated === 'function' ? ui.onAuthenticated : () => {};
  const onAuthCleared = typeof ui.onAuthCleared === 'function' ? ui.onAuthCleared : () => {};

  const state = chatState;
  let awaitingName = false;
  let authRequestGeneration = 0;
  let accountProfileRefreshAt = 0;
  let accountProfileRefreshPromise: Promise<boolean> | null = null;

  // --- Session / identity ----------------------------------------------------

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
    const value = String(authEmailSignal.value || '').trim() || stored;
    displayEmailSignal.value = value;
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
    return {
      ...userProfile(),
      preferred_name: state.preferredName,
      awaiting_name: awaitingName
    };
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

  // Tears down the authenticated state in the stores. The DOM-side cleanup
  // (prompts, focus, welcome bookkeeping) runs through the onAuthCleared hook.
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
    conversationActions.setActiveConversation('');
    authActionSignal.value = 'none';
    authMessageSignal.value = message || existingMessage || '';
    refreshAccountIdentity();
    onAuthCleared(config);
  }

  function handleAuthResponse(data: ThingyAuthData, opts: AuthFlowOptions = {}) {
    return handleAuthResponseStatus(data, {
      hideActions: () => {
        authActionSignal.value = 'none';
      },
      onToken: (authData: ThingyAuthData) => {
        persistToken(authData.token || '', authData);
        authActionSignal.value = 'none';
        onAuthenticated(authData, opts);
      },
      setMessage: (message: string) => {
        authMessageSignal.value = message || '';
      },
      showAction: (action: 'subscribe' | 'resend_confirmation') => {
        authActionSignal.value = action;
      },
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
      const payload = { email: String(authEmailSignal.value || ''), action, source: 'thingy' };
      const data = await session.postJson('/auth', payload, {});
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
        {
          email: String(authEmailSignal.value || '').trim(),
          action: 'check',
          source: 'thingy'
        },
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

  // --- Conversations -----------------------------------------------------------

  function authHeaders() {
    return session.authHeaders();
  }

  async function conversationAction(payload: Record<string, unknown>) {
    return session.postJson('/conversations', payload, authHeaders());
  }

  const conversationActions = createChatConversationActions({
    state,
    maxRecents,
    localConversationPrefix,
    activeConvKey,
    currentScope,
    token,
    ensureFreshToken,
    setUserProfile,
    refreshStoredAuth,
    redirectToSignIn,
    post: conversationAction,
    track,
    onActiveConversationChanged,
    onQuestionStateChanged,
    setCreateInFlight: (value) => (conversationCreateInFlightSignal.value = value)
  });

  // --- Streaming ----------------------------------------------------------------

  async function postStreamJson(path: string, payload: unknown, headers: Record<string, string> = {}) {
    return postJsonRequest({
      baseUrl: streamBase,
      path,
      payload,
      headers,
      missingMessage: 'Thingy has not been connected to the archive stream API yet.',
      defaultErrorMessage: 'Thingy is unavailable.',
      requestIdSource: 'data'
    });
  }

  const streamActions = createChatStreamActions({
    streamBase,
    token,
    getActiveConversationId: () => state.activeConversationId,
    isLocalConversationId: conversationActions.isLocalConversationId,
    currentConversationMode: conversationActions.currentConversationMode,
    readerProfileContext,
    upsertPendingConversation: conversationActions.upsertPendingConversation,
    setActiveConversation: conversationActions.setActiveConversation,
    onMode: (mode) => {
      state.activeMode = mode;
      onModesChanged();
    },
    onQuestionStateChanged,
    scheduleChatScroll,
    answerInFlight: () => answerInFlightSignal.value,
    setStoppable: (value) => (stoppableSignal.value = value)
  });

  return {
    activeConversation: conversationActions.activeConversation,
    authHeaders,
    clearAnswerAbortState: streamActions.clearAnswerAbortState,
    clearAuthState,
    conversationAction,
    createConversationShellForMode: conversationActions.createConversationShellForMode,
    createLocalConversationShell: conversationActions.createLocalConversationShell,
    currentConversationMode: conversationActions.currentConversationMode,
    currentConversationTitle: conversationActions.currentConversationTitle,
    deleteConversation: conversationActions.deleteConversation,
    ensureFreshToken,
    fetchConversation: conversationActions.fetchConversation,
    isAwaitingName,
    isLocalConversationId: conversationActions.isLocalConversationId,
    isStoppable: streamActions.isStoppable,
    modeLabel: conversationActions.modeLabel,
    normalizeEmail,
    persistInferredPreferredName,
    postStreamJson,
    postStreamingChat: streamActions.postStreamingChat,
    postStreamingWelcome: streamActions.postStreamingWelcome,
    readerProfileContext,
    redirectToSignIn,
    refreshAccountIdentity,
    refreshAccountProfile,
    refreshConversations: conversationActions.refreshConversations,
    refreshStoredAuth,
    rememberPreferredName,
    renameConversation: conversationActions.renameConversation,
    savedActiveConversation: conversationActions.savedActiveConversation,
    setActiveConversation: conversationActions.setActiveConversation,
    setAwaitingName,
    setUserProfile,
    stopActiveAnswer: streamActions.stopActiveAnswer,
    storedEmail,
    submitAuthAction,
    submitAuthCheck,
    token,
    tokenExpired,
    upsertConversationSummary: conversationActions.upsertConversationSummary,
    upsertPendingConversation: conversationActions.upsertPendingConversation,
    userProfile,
    validateEmail
  };
}

export { chatState, createChatActions };
