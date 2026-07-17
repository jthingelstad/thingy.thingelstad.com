// The chat flow layer: session/auth flows, conversation summary + server
// flows, and the streaming POSTs. Extracted from bootChat so the logic has
// explicit dependencies and mirrors thingy-dispatch-actions.js. The factory
// writes chat-store / ui-store signals directly; DOM-facing concerns arrive
// as `ui` hooks so this module never builds or queries page structure.

import * as defaultSession from './thingy-session.ts';
import { normalizePreferredName, savePreferredName } from './thingy-account.ts';
import { postJsonRequest } from './thingy-http.ts';
import { postJsonStream, read as readStream } from './thingy-stream.ts';
import { AGENT_RESPONSE_TIMEOUT_MS, AGENT_SETUP_TIMEOUT_MS } from './thingy-timeouts.ts';
import { createAssistantStreamRenderer } from './thingy-chat-stream-renderer.ts';
import { normalizeModeId, normalizeModes } from './thingy-modes.ts';
import {
  conversationTitle,
  createLocalConversation,
  dedupeEmptyConversationDrafts as dedupeConversationDrafts,
  deleteConversationSummaryList,
  isEmptyConversationDraft as isEmptyConversationDraftEntry,
  isLocalConversationId as isLocalConversationIdValue,
  upsertConversationSummaryList
} from './thingy-conversations.ts';
import { userLocalContext } from './thingy-local-context.ts';
import { isAuthError, scrubUrlParams } from './thingy-url.ts';
import { handleAuthResponse as handleAuthResponseStatus } from './thingy-auth-response.ts';
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
  showNotice,
  signedIn as signedInSignal
} from './stores/ui-store.ts';

const EMAIL_RE =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

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

function createChatActions(options: ThingyOptions = {}) {
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
  let accountProfileRefreshPromise = null;
  let chatAbortController = null;
  let chatStopRequested = false;

  // --- Session / identity ----------------------------------------------------

  function normalizeEmail(value) {
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

  function setUserProfile(data) {
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

  function rememberPreferredName(name) {
    const cleanName = String(name || '').trim();
    if (!cleanName) return;
    state.preferredName = cleanName;
    session.updateStoredProfile({ preferred_name: cleanName });
  }

  async function persistInferredPreferredName(name) {
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

  function setAwaitingName(value) {
    awaitingName = Boolean(value);
  }

  function persistToken(value, data: ThingyAuthData = {}) {
    session.persistAuth({ ...data, token: value }, data.email || storedEmail());
    setUserProfile(data);
    if (data.email) authEmailSignal.value = normalizeEmail(data.email);
    signedInSignal.value = Boolean(token());
    refreshAccountIdentity();
  }

  async function refreshStoredAuth(opts: ThingyOptions = {}) {
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

  async function refreshAccountProfile(opts: ThingyOptions = {}) {
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
  function clearAuthState(config: ThingyOptions = {}) {
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
    setActiveConversation('');
    authActionSignal.value = 'none';
    authMessageSignal.value = message || existingMessage || '';
    refreshAccountIdentity();
    onAuthCleared(config);
  }

  function handleAuthResponse(data, opts: ThingyOptions = {}) {
    return handleAuthResponseStatus(data, {
      hideActions: () => {
        authActionSignal.value = 'none';
      },
      onToken: (authData) => {
        persistToken(authData.token, authData);
        authActionSignal.value = 'none';
        onAuthenticated(authData, opts);
      },
      setMessage: (message) => {
        authMessageSignal.value = message || '';
      },
      showAction: (action) => {
        authActionSignal.value = action || 'none';
      },
      track
    });
  }

  async function submitAuthAction(action) {
    if (!validateEmail()) return;
    const generation = authRequestGeneration;
    authBusySignal.value = true;
    authActionSignal.value = 'none';
    authMessageSignal.value =
      action === 'subscribe' ? 'Adding you to the Weekly Thing...' : 'Sending the confirmation email...';
    try {
      const payload = { email: String(authEmailSignal.value || ''), action, source: 'thingy' };
      const data = await session.postJson('/auth', payload);
      if (generation !== authRequestGeneration) return;
      handleAuthResponse(data);
    } catch (error) {
      if (generation !== authRequestGeneration) return;
      authMessageSignal.value = error.message;
      track('librarian.auth_error', error.requestId ? 'server' : 'client');
    } finally {
      authBusySignal.value = false;
    }
  }

  async function submitAuthCheck(opts: ThingyOptions = {}) {
    if (!validateEmail()) return false;
    const generation = authRequestGeneration;
    authBusySignal.value = true;
    authActionSignal.value = 'none';
    authMessageSignal.value = 'Sending a sign-in link...';
    try {
      const data = await session.postJson('/auth', {
        email: String(authEmailSignal.value || '').trim(),
        action: 'check',
        source: 'thingy'
      });
      if (generation !== authRequestGeneration) return false;
      handleAuthResponse(data, opts);
      if (opts.scrubEmailParam) scrubUrlParams(['email']);
      return true;
    } catch (error) {
      if (generation !== authRequestGeneration) return false;
      authMessageSignal.value = error.message;
      track('librarian.auth_error', error.requestId ? 'server' : 'client');
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

  async function conversationAction(payload) {
    return session.postJson('/conversations', payload, authHeaders());
  }

  function isLocalConversationId(id) {
    return isLocalConversationIdValue(id, localConversationPrefix);
  }

  function modeLabel(id = state.activeMode) {
    return state.availableModes.find((mode) => mode.id === id)?.label || 'Thingy';
  }

  function newConversationTitle(mode = state.activeMode) {
    return conversationTitle(mode, modeLabel);
  }

  function activeConversation() {
    if (!state.activeConversationId) return null;
    return (
      state.conversations.find(
        (entry) => entry.id === state.activeConversationId || entry.conversation_id === state.activeConversationId
      ) || null
    );
  }

  function currentConversationMode() {
    return activeConversation()?.mode || state.activeMode || 'thingy';
  }

  function currentConversationTitle() {
    if (!state.activeConversationId) return 'New chat';
    const active = activeConversation();
    return active?.title || 'Current chat';
  }

  function setActiveConversation(id) {
    state.activeConversationId = String(id || '').trim() || null;
    try {
      if (state.activeConversationId) {
        window.localStorage.setItem(activeConvKey, state.activeConversationId);
      } else {
        window.localStorage.removeItem(activeConvKey);
      }
    } catch (error) {
      /* ignore */
    }
    onActiveConversationChanged();
    return state.activeConversationId;
  }

  function savedActiveConversation() {
    try {
      return window.localStorage.getItem(activeConvKey) || '';
    } catch (error) {
      return '';
    }
  }

  function isEmptyConversationDraft(entry, mode = '') {
    return isEmptyConversationDraftEntry(entry, mode, modeLabel);
  }

  function dedupeEmptyConversationDrafts(list = [], opts: ThingyOptions = {}) {
    return dedupeConversationDrafts(list, {
      activeConversationId: opts.activeConversationId || state.activeConversationId,
      labelForMode: modeLabel
    });
  }

  function createLocalConversationShell(mode = state.activeMode) {
    const normalized = normalizeModeId(mode);
    const existing = activeConversation();
    if (existing?.id && isLocalConversationId(existing.id)) {
      const updated = {
        ...existing,
        mode: normalized,
        title: existing.title || newConversationTitle(normalized),
        updated_at: new Date().toISOString()
      };
      state.conversations = state.conversations.map((entry) => (entry.id === existing.id ? updated : entry));
      setActiveConversation(updated.id);
      return updated;
    }
    const shell = createLocalConversation({
      mode: normalized,
      scope: currentScope(),
      prefix: localConversationPrefix,
      labelForMode: modeLabel
    });
    const withoutDrafts = state.conversations.filter((entry) => !isEmptyConversationDraft(entry, normalized));
    state.conversations = dedupeEmptyConversationDrafts([shell, ...withoutDrafts], {
      activeConversationId: shell.id
    }).slice(0, maxRecents);
    setActiveConversation(shell.id);
    return shell;
  }

  function upsertConversationSummary(conversation, opts: ThingyOptions = {}) {
    if (!conversation || !(conversation.id || conversation.conversation_id)) return;
    const replaceId = String(opts.replaceId || '').trim();
    const result = upsertConversationSummaryList(state.conversations, conversation, {
      activeConversationId: state.activeConversationId,
      labelForMode: modeLabel,
      maxRecents,
      replaceId
    });
    state.conversations = result.conversations;
    if (result.activeConversationId && result.activeConversationId !== state.activeConversationId) {
      state.activeConversationId = result.activeConversationId;
      try {
        window.localStorage.setItem(activeConvKey, state.activeConversationId);
      } catch (error) {
        /* ignore */
      }
    }
    onActiveConversationChanged();
  }

  function upsertPendingConversation({ conversationId, title, scope, mode }) {
    const id = String(conversationId || '').trim();
    if (!id) return;
    const replaceId = isLocalConversationId(state.activeConversationId) ? state.activeConversationId : '';
    const now = new Date().toISOString();
    const existing = state.conversations.find((entry) => entry.id === id || entry.conversation_id === id);
    if (!replaceId && existing) {
      upsertConversationSummary({
        ...existing,
        id,
        conversation_id: id,
        title: existing.title || title || 'New chat',
        scope: existing.scope || scope || currentScope(),
        mode: normalizeModeId(existing.mode || mode || currentConversationMode()),
        updated_at: now,
        last_message_at: now,
        draft: false
      });
      return;
    }
    upsertConversationSummary(
      {
        id,
        conversation_id: id,
        title: title || 'New chat',
        preview: title || '',
        scope: scope || currentScope(),
        mode: normalizeModeId(mode || currentConversationMode()),
        created_at: now,
        updated_at: now,
        last_message_at: now,
        turn_count: 0,
        draft: false
      },
      { replaceId }
    );
  }

  async function createConversationShellForMode(mode, opts: ThingyOptions = {}) {
    const normalized = normalizeModeId(mode);
    if (!token() || normalized === 'thingy') return activeConversation();
    if (!state.availableModes.some((entry) => entry.id === normalized)) return null;
    if (!(await ensureFreshToken())) {
      return null;
    }
    const replaceId = String(opts.replaceId || state.activeConversationId || '').trim();
    conversationCreateInFlightSignal.value = true;
    onQuestionStateChanged();
    try {
      const data = await conversationAction({
        action: 'create',
        mode: normalized,
        title: newConversationTitle(normalized),
        scope: currentScope()
      });
      if (data.conversation) {
        upsertConversationSummary(
          { ...data.conversation, draft: true },
          {
            replaceId: isLocalConversationId(replaceId) ? replaceId : ''
          }
        );
        setActiveConversation(data.conversation.id || data.conversation.conversation_id);
        return data.conversation;
      }
    } catch (error) {
      if (isAuthError(error)) {
        redirectToSignIn();
      } else {
        showNotice(`Could not start a ${modeLabel(normalized)} chat. Please try again.`);
      }
      track('librarian.conversations_error', 'create');
    } finally {
      conversationCreateInFlightSignal.value = false;
      onQuestionStateChanged();
    }
    return null;
  }

  async function refreshConversations(opts: ThingyOptions = {}) {
    if (!token()) {
      state.conversations = [];
      onActiveConversationChanged();
      return [];
    }
    if (!(await ensureFreshToken())) {
      return [];
    }
    try {
      const data = await conversationAction({ action: 'list', limit: maxRecents });
      if (data.modes || data.entitlements) setUserProfile(data);
      const clientActiveShells = state.conversations.filter((entry) => {
        if (!entry?.id) return false;
        return isLocalConversationId(entry.id) || entry.id === state.activeConversationId;
      });
      const serverConversations = (data.conversations || [])
        .map((entry) => ({
          ...entry,
          id: entry.id || entry.conversation_id,
          local: false
        }))
        .filter((entry) => entry.id)
        // Dispatch planning conversations belong to the /dispatch/ surface.
        .filter((entry) => String(entry.mode || '') !== 'dispatch');
      const serverIds = new Set(serverConversations.map((entry) => entry.id));
      const keptClientShells = clientActiveShells.filter(
        (entry) => entry.id === state.activeConversationId && !serverIds.has(entry.id)
      );
      state.conversations = dedupeEmptyConversationDrafts(
        [...keptClientShells, ...serverConversations].sort((a, b) =>
          String(b.updated_at || '').localeCompare(String(a.updated_at || ''))
        )
      ).slice(0, maxRecents);
      if (state.activeConversationId && !state.conversations.some((entry) => entry.id === state.activeConversationId)) {
        setActiveConversation('');
      }
      onActiveConversationChanged();
      return state.conversations;
    } catch (error) {
      if (opts.retryAuth !== false && isAuthError(error) && (await refreshStoredAuth())) {
        return refreshConversations({ retryAuth: false });
      }
      track('librarian.conversations_error', 'list');
      if (isAuthError(error)) {
        redirectToSignIn();
        return [];
      }
      onActiveConversationChanged();
      return state.conversations;
    }
  }

  // Renames a conversation. Local shells update in the store; server
  // conversations round-trip through the API. Returns true on success.
  async function renameConversation(id, title) {
    const trimmed = String(title || '').trim();
    if (!trimmed) return false;
    if (isLocalConversationId(id)) {
      state.conversations = state.conversations.map((entry) =>
        entry.id === id ? { ...entry, title: trimmed, draft: false, updated_at: new Date().toISOString() } : entry
      );
      onActiveConversationChanged();
      return true;
    }
    try {
      const data = await conversationAction({ action: 'rename', conversation_id: id, title: trimmed });
      if (data.conversation) upsertConversationSummary({ ...data.conversation, draft: false });
      track('librarian.conversation_rename');
      return true;
    } catch (error) {
      showNotice('Could not rename the conversation. Please try again.');
      track('librarian.conversations_error', 'rename');
      return false;
    }
  }

  // Deletes a conversation from the store (and the server for non-local
  // ids). Returns { ok, wasActive } so the caller can decide what view to
  // show next; returns { ok: false } when the server delete fails.
  async function deleteConversation(id) {
    const conversationId = String(id || '').trim();
    if (!conversationId) return { ok: false, wasActive: false };
    const wasActive = conversationId === state.activeConversationId;
    if (isLocalConversationId(conversationId)) {
      ({ conversations: state.conversations, activeConversationId: state.activeConversationId } =
        deleteConversationSummaryList(state.conversations, conversationId, {
          activeConversationId: state.activeConversationId
        }));
      onActiveConversationChanged();
      return { ok: true, wasActive };
    }
    try {
      await conversationAction({ action: 'delete', conversation_id: conversationId });
      ({ conversations: state.conversations, activeConversationId: state.activeConversationId } =
        deleteConversationSummaryList(state.conversations, conversationId, {
          activeConversationId: state.activeConversationId
        }));
      onActiveConversationChanged();
      return { ok: true, wasActive };
    } catch (error) {
      showNotice('Could not delete the conversation. Please try again.');
      track('librarian.conversations_error', 'delete');
      return { ok: false, wasActive };
    }
  }

  async function fetchConversation(id) {
    return conversationAction({ action: 'get', conversation_id: id });
  }

  // --- Streaming ----------------------------------------------------------------

  async function postStreamJson(path, payload, headers = {}) {
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

  function stopActiveAnswer() {
    if (!chatAbortController) return;
    chatStopRequested = true;
    chatAbortController.abort();
  }

  function clearAnswerAbortState() {
    chatAbortController = null;
    chatStopRequested = false;
  }

  function isStoppable() {
    return Boolean(chatAbortController);
  }

  async function postStreamingChat(message, model, scope) {
    if (!streamBase) {
      throw new Error('Thingy has not been connected to the archive stream API yet.');
    }

    let requestId = '';
    let conversationId = isLocalConversationId(state.activeConversationId) ? '' : state.activeConversationId || '';
    let conversation = null;
    chatStopRequested = false;
    chatAbortController = new AbortController();
    stoppableSignal.value = answerInFlightSignal.value;
    onQuestionStateChanged();
    let response;
    try {
      response = await postJsonStream({
        baseUrl: streamBase,
        path: '/chat',
        controller: chatAbortController,
        timeoutMs: AGENT_RESPONSE_TIMEOUT_MS,
        abortMessage: 'Thingy spent too long in the archive. Please try again with a narrower angle.',
        headers: {
          authorization: `Bearer ${token()}`
        },
        payload: {
          message,
          scope,
          mode: currentConversationMode(),
          conversation_id: conversationId || undefined,
          client_context: userLocalContext(),
          user_profile: readerProfileContext()
        }
      });
    } catch (error) {
      if (chatStopRequested) {
        model.status.value = 'stopped';
        return {
          answer: '',
          citations: [],
          experience: null,
          stopped: true,
          request_id: '',
          conversation_id: conversationId,
          conversation: null
        };
      }
      throw error;
    }

    const renderer = createAssistantStreamRenderer({ model, scroll: scheduleChatScroll });

    function applyEvent(eventName, data) {
      if (eventName === 'meta') {
        requestId = data.request_id || requestId;
        if (data.mode) {
          state.activeMode = data.mode;
          onModesChanged();
        }
        if (data.conversation_id) {
          conversationId = data.conversation_id;
          upsertPendingConversation({
            conversationId,
            title: message,
            scope,
            mode: data.mode || currentConversationMode()
          });
          setActiveConversation(conversationId);
        }
      } else if (eventName === 'status') {
        renderer.status(data);
      } else if (eventName === 'commentary') {
        renderer.commentary(data.message || data.delta || '');
      } else if (eventName === 'answer_delta') {
        renderer.appendDelta(data.delta);
      } else if (eventName === 'answer') {
        renderer.setAnswer(data.answer);
      } else if (eventName === 'citations') {
        renderer.setCitations(data.citations);
      } else if (eventName === 'experience') {
        renderer.setExperience(data.experience);
      } else if (eventName === 'done') {
        requestId = data.request_id || requestId;
        if (data.mode) {
          state.activeMode = data.mode;
          onModesChanged();
        }
        if (data.conversation_id) {
          conversationId = data.conversation_id;
          setActiveConversation(conversationId);
        }
        if (data.conversation) conversation = data.conversation;
      } else if (eventName === 'error') {
        const error = new Error(data.error || 'Thingy is unavailable.');
        error.requestId = data.request_id || requestId;
        throw error;
      }
    }

    let stopped = false;
    try {
      await readStream(response, applyEvent);
    } catch (error) {
      if (!chatStopRequested) throw error;
      stopped = true;
    }
    const result = renderer.finish(stopped ? 'stopped' : 'done');
    if (model.requestId.peek() !== requestId) model.requestId.value = requestId;
    if (!stopped && !String(result.answer || '').trim() && !result.experience) {
      throw new Error('Thingy did not return an answer. Please try again.');
    }
    return { ...result, stopped, request_id: requestId, conversation_id: conversationId, conversation };
  }

  async function postStreamingWelcome(model, scope, opts: ThingyOptions = {}) {
    if (!streamBase) {
      throw new Error('Thingy has not been connected to the archive stream API yet.');
    }

    let requestId = '';
    const response = await postJsonStream({
      baseUrl: streamBase,
      path: '/welcome',
      controller: opts.controller,
      timeoutMs: AGENT_SETUP_TIMEOUT_MS,
      abortMessage: 'Thingy took too long to get oriented. Please try asking a question.',
      headers: {
        authorization: `Bearer ${token()}`
      },
      payload: {
        scope,
        mode: currentConversationMode(),
        client_context: userLocalContext(),
        user_profile: readerProfileContext()
      }
    });

    const renderer = createAssistantStreamRenderer({
      model,
      scroll: scheduleChatScroll,
      label: 'Session Setup',
      statusFallback: 'Thingy is getting oriented...'
    });

    function applyEvent(eventName, data) {
      if (eventName === 'meta') {
        requestId = data.request_id || requestId;
        if (data.mode) {
          state.activeMode = data.mode;
          onModesChanged();
        }
      } else if (eventName === 'status') {
        renderer.status(data);
      } else if (eventName === 'commentary') {
        renderer.commentary(data.message || data.delta || '');
      } else if (eventName === 'answer_delta') {
        renderer.appendDelta(data.delta);
      } else if (eventName === 'answer') {
        renderer.setAnswer(data.answer);
      } else if (eventName === 'experience') {
        renderer.setExperience(data.experience);
      } else if (eventName === 'done') {
        requestId = data.request_id || requestId;
        if (data.mode) {
          state.activeMode = data.mode;
          onModesChanged();
        }
      } else if (eventName === 'error') {
        const error = new Error(data.error || 'Thingy is unavailable.');
        error.requestId = data.request_id || requestId;
        throw error;
      }
    }

    await readStream(response, applyEvent);
    const { answer, experience } = renderer.finish('done');
    return { answer, experience, request_id: requestId };
  }

  return {
    activeConversation,
    authHeaders,
    clearAnswerAbortState,
    clearAuthState,
    conversationAction,
    createConversationShellForMode,
    createLocalConversationShell,
    currentConversationMode,
    currentConversationTitle,
    deleteConversation,
    ensureFreshToken,
    fetchConversation,
    isAwaitingName,
    isLocalConversationId,
    isStoppable,
    modeLabel,
    normalizeEmail,
    persistInferredPreferredName,
    postStreamJson,
    postStreamingChat,
    postStreamingWelcome,
    readerProfileContext,
    redirectToSignIn,
    refreshAccountIdentity,
    refreshAccountProfile,
    refreshConversations,
    refreshStoredAuth,
    rememberPreferredName,
    renameConversation,
    savedActiveConversation,
    setActiveConversation,
    setAwaitingName,
    setUserProfile,
    stopActiveAnswer,
    storedEmail,
    submitAuthAction,
    submitAuthCheck,
    token,
    tokenExpired,
    upsertConversationSummary,
    upsertPendingConversation,
    userProfile,
    validateEmail
  };
}

export { chatState, createChatActions };
