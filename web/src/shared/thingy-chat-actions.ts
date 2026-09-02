// The chat flow layer: session/auth flows, conversation summary + server
// flows, and the streaming POSTs. Extracted from bootChat so the logic has
// explicit dependencies. The factory
// writes chat-store / ui-store signals directly; DOM-facing concerns arrive
// as `ui` hooks so this module never builds or queries page structure.

import * as defaultSession from './thingy-session.ts';
import { postJsonRequest } from './thingy-http.ts';
import { createChatStreamActions } from './thingy-chat-stream-actions.ts';
import { createChatConversationActions } from './thingy-chat-conversation-actions.ts';
import { createChatAuthActions } from './thingy-chat-auth-actions.ts';
import {
  activeConversationId as activeConversationIdSignal,
  activeMode as activeModeSignal,
  answerInFlight as answerInFlightSignal,
  availableModes as availableModesSignal,
  chatMessages as chatMessagesSignal,
  conversationCreateInFlight as conversationCreateInFlightSignal,
  conversations as conversationsSignal,
  guestMode as guestModeSignal,
  guestRemaining as guestRemainingSignal,
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

  const state = chatState;
  const authActions = createChatAuthActions({
    session,
    state,
    track,
    onModesChanged
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
    hasSession: authActions.hasSession,
    ensureSession: authActions.ensureSession,
    setUserProfile: authActions.setUserProfile,
    refreshStoredAuth: authActions.refreshStoredAuth,
    redirectToSignIn: authActions.redirectToSignIn,
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

  // Guest lane: the server holds no history for guests, so the transcript
  // travels with each question, rebuilt from the rendered messages.
  function guestHistory() {
    const history: Array<{ role: string; content: string }> = [];
    for (const message of chatMessagesSignal.value) {
      if (message.role === 'user' && message.prompt) {
        history.push({ role: 'user', content: String(message.prompt) });
      } else if (message.role === 'assistant' && message.model?.status.value === 'done') {
        const content = String(message.model.content.value || '').trim();
        if (content) history.push({ role: 'assistant', content });
      }
    }
    return history;
  }

  const streamActions = createChatStreamActions({
    streamBase,
    isGuest: () => guestModeSignal.value,
    guestHistory,
    onGuestRemaining: (remaining) => (guestRemainingSignal.value = remaining),
    authHeaders,
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
    conversationAction,
    createConversationShellForMode: conversationActions.createConversationShellForMode,
    createLocalConversationShell: conversationActions.createLocalConversationShell,
    currentConversationMode: conversationActions.currentConversationMode,
    currentConversationTitle: conversationActions.currentConversationTitle,
    deleteConversation: conversationActions.deleteConversation,
    ensureSession: authActions.ensureSession,
    fetchConversation: conversationActions.fetchConversation,
    isAwaitingName: authActions.isAwaitingName,
    isGuestMode: () => guestModeSignal.value,
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
    shareConversation: conversationActions.shareConversation,
    unshareConversation: conversationActions.unshareConversation,
    setAwaitingName: authActions.setAwaitingName,
    setUserProfile: authActions.setUserProfile,
    stopActiveAnswer: streamActions.stopActiveAnswer,
    storedEmail: authActions.storedEmail,
    hasSession: authActions.hasSession,
    upsertConversationSummary: conversationActions.upsertConversationSummary,
    upsertPendingConversation: conversationActions.upsertPendingConversation,
    userProfile: authActions.userProfile
  };
}

export { chatState, createChatActions };
