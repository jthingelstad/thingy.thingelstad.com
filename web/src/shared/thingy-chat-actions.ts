// The chat flow layer: session/auth flows, conversation summary + server
// flows, and the streaming POSTs. Extracted from bootChat so the logic has
// explicit dependencies and mirrors thingy-dispatch-actions.js. The factory
// writes chat-store / ui-store signals directly; DOM-facing concerns arrive
// as `ui` hooks so this module never builds or queries page structure.

import * as defaultSession from './thingy-session.ts';
import { postJsonRequest } from './thingy-http.ts';
import { createChatStreamActions } from './thingy-chat-stream-actions.ts';
import { createChatConversationActions } from './thingy-chat-conversation-actions.ts';
import { createChatAuthActions, type AuthFlowOptions, type ClearAuthOptions } from './thingy-chat-auth-actions.ts';
import {
  activeConversationId as activeConversationIdSignal,
  activeMode as activeModeSignal,
  answerInFlight as answerInFlightSignal,
  availableModes as availableModesSignal,
  conversationCreateInFlight as conversationCreateInFlightSignal,
  conversations as conversationsSignal,
  stoppable as stoppableSignal
} from './stores/chat-store.ts';
import { displayPreferredName as displayPreferredNameSignal } from './stores/ui-store.ts';

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
  let clearActiveConversation = () => {
    state.activeConversationId = null;
  };
  const authActions = createChatAuthActions({
    session,
    state,
    track,
    onModesChanged,
    onAuthenticated,
    onAuthCleared,
    clearActiveConversation: () => clearActiveConversation()
  });

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
    token: authActions.token,
    ensureFreshToken: authActions.ensureFreshToken,
    setUserProfile: authActions.setUserProfile,
    refreshStoredAuth: authActions.refreshStoredAuth,
    redirectToSignIn: authActions.redirectToSignIn,
    post: conversationAction,
    track,
    onActiveConversationChanged,
    onQuestionStateChanged,
    setCreateInFlight: (value) => (conversationCreateInFlightSignal.value = value)
  });
  clearActiveConversation = () => conversationActions.setActiveConversation('');

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
    token: authActions.token,
    getActiveConversationId: () => state.activeConversationId,
    isLocalConversationId: conversationActions.isLocalConversationId,
    currentConversationMode: conversationActions.currentConversationMode,
    readerProfileContext: authActions.readerProfileContext,
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
    clearAuthState: authActions.clearAuthState,
    conversationAction,
    createConversationShellForMode: conversationActions.createConversationShellForMode,
    createLocalConversationShell: conversationActions.createLocalConversationShell,
    currentConversationMode: conversationActions.currentConversationMode,
    currentConversationTitle: conversationActions.currentConversationTitle,
    deleteConversation: conversationActions.deleteConversation,
    ensureFreshToken: authActions.ensureFreshToken,
    fetchConversation: conversationActions.fetchConversation,
    isAwaitingName: authActions.isAwaitingName,
    isLocalConversationId: conversationActions.isLocalConversationId,
    isStoppable: streamActions.isStoppable,
    modeLabel: conversationActions.modeLabel,
    normalizeEmail: authActions.normalizeEmail,
    persistInferredPreferredName: authActions.persistInferredPreferredName,
    postStreamJson,
    postStreamingChat: streamActions.postStreamingChat,
    postStreamingWelcome: streamActions.postStreamingWelcome,
    readerProfileContext: authActions.readerProfileContext,
    redirectToSignIn: authActions.redirectToSignIn,
    refreshAccountIdentity: authActions.refreshAccountIdentity,
    refreshAccountProfile: authActions.refreshAccountProfile,
    refreshConversations: conversationActions.refreshConversations,
    refreshStoredAuth: authActions.refreshStoredAuth,
    rememberPreferredName: authActions.rememberPreferredName,
    renameConversation: conversationActions.renameConversation,
    savedActiveConversation: conversationActions.savedActiveConversation,
    setActiveConversation: conversationActions.setActiveConversation,
    setAwaitingName: authActions.setAwaitingName,
    setUserProfile: authActions.setUserProfile,
    stopActiveAnswer: streamActions.stopActiveAnswer,
    storedEmail: authActions.storedEmail,
    submitAuthAction: authActions.submitAuthAction,
    submitAuthCheck: authActions.submitAuthCheck,
    token: authActions.token,
    tokenExpired: authActions.tokenExpired,
    upsertConversationSummary: conversationActions.upsertConversationSummary,
    upsertPendingConversation: conversationActions.upsertPendingConversation,
    userProfile: authActions.userProfile,
    validateEmail: authActions.validateEmail
  };
}

export { chatState, createChatActions };
