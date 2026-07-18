import {
  conversationTitle,
  createLocalConversation,
  dedupeEmptyConversationDrafts as dedupeConversationDrafts,
  deleteConversationSummaryList,
  isEmptyConversationDraft as isEmptyConversationDraftEntry,
  isLocalConversationId as isLocalConversationIdValue,
  upsertConversationSummaryList
} from './thingy-conversations.ts';
import { normalizeModeId } from './thingy-modes.ts';
import { isAuthError } from './thingy-url.ts';
import { showNotice } from './stores/ui-store.ts';

interface ChatConversationActionsOptions {
  state: ThingyChatState;
  maxRecents: number;
  localConversationPrefix: string;
  activeConvKey: string;
  currentScope: () => string;
  token: () => string;
  ensureFreshToken: () => Promise<boolean>;
  setUserProfile: (data: ThingyApiResponse) => unknown;
  refreshStoredAuth: () => Promise<boolean>;
  redirectToSignIn: () => void;
  post: (payload: Record<string, unknown>) => Promise<ThingyApiResponse>;
  track: (name: string, value?: string) => void;
  onActiveConversationChanged: () => void;
  onQuestionStateChanged: () => void;
  setCreateInFlight: (value: boolean) => void;
}

function createChatConversationActions(options: ChatConversationActionsOptions) {
  const { state } = options;

  function isLocalConversationId(id: unknown) {
    return isLocalConversationIdValue(id, options.localConversationPrefix);
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
    return activeConversation()?.title || 'Current chat';
  }

  function setActiveConversation(id: unknown) {
    state.activeConversationId = String(id || '').trim() || null;
    try {
      if (state.activeConversationId) window.localStorage.setItem(options.activeConvKey, state.activeConversationId);
      else window.localStorage.removeItem(options.activeConvKey);
    } catch (_error) {
      /* private browsing */
    }
    options.onActiveConversationChanged();
    return state.activeConversationId;
  }

  function savedActiveConversation() {
    try {
      return window.localStorage.getItem(options.activeConvKey) || '';
    } catch (_error) {
      return '';
    }
  }

  function isEmptyConversationDraft(entry: ThingyConversationSummary, mode = '') {
    return isEmptyConversationDraftEntry(entry, mode, modeLabel);
  }

  function dedupeEmptyConversationDrafts(
    list: ThingyConversationSummary[] = [],
    config: { activeConversationId?: string | null } = {}
  ) {
    return dedupeConversationDrafts(list, {
      activeConversationId: config.activeConversationId || state.activeConversationId,
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
      scope: options.currentScope(),
      prefix: options.localConversationPrefix,
      labelForMode: modeLabel
    });
    const withoutDrafts = state.conversations.filter((entry) => !isEmptyConversationDraft(entry, normalized));
    state.conversations = dedupeEmptyConversationDrafts([shell, ...withoutDrafts], {
      activeConversationId: shell.id
    }).slice(0, options.maxRecents);
    setActiveConversation(shell.id);
    return shell;
  }

  function upsertConversationSummary(conversation: ThingyConversationSummary, config: { replaceId?: string } = {}) {
    if (!conversation || !(conversation.id || conversation.conversation_id)) return;
    const result = upsertConversationSummaryList(state.conversations, conversation, {
      activeConversationId: state.activeConversationId,
      labelForMode: modeLabel,
      maxRecents: options.maxRecents,
      replaceId: String(config.replaceId || '').trim()
    });
    state.conversations = result.conversations;
    if (result.activeConversationId && result.activeConversationId !== state.activeConversationId) {
      state.activeConversationId = result.activeConversationId;
      try {
        window.localStorage.setItem(options.activeConvKey, state.activeConversationId);
      } catch (_error) {
        /* private browsing */
      }
    }
    options.onActiveConversationChanged();
  }

  function upsertPendingConversation({
    conversationId,
    title,
    scope,
    mode
  }: {
    conversationId: string;
    title?: string;
    scope?: string;
    mode?: string;
  }) {
    const id = String(conversationId || '').trim();
    if (!id) return;
    const replaceId = isLocalConversationId(state.activeConversationId) ? state.activeConversationId || '' : '';
    const now = new Date().toISOString();
    const existing = state.conversations.find((entry) => entry.id === id || entry.conversation_id === id);
    if (!replaceId && existing) {
      upsertConversationSummary({
        ...existing,
        id,
        conversation_id: id,
        title: existing.title || title || 'New chat',
        scope: existing.scope || scope || options.currentScope(),
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
        scope: scope || options.currentScope(),
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

  async function createConversationShellForMode(mode: unknown, config: { replaceId?: string } = {}) {
    const normalized = normalizeModeId(mode);
    if (!options.token() || normalized === 'thingy') return activeConversation();
    if (!state.availableModes.some((entry) => entry.id === normalized)) return null;
    if (!(await options.ensureFreshToken())) return null;
    const replaceId = String(config.replaceId || state.activeConversationId || '').trim();
    options.setCreateInFlight(true);
    options.onQuestionStateChanged();
    try {
      const data = await options.post({
        action: 'create',
        mode: normalized,
        title: newConversationTitle(normalized),
        scope: options.currentScope()
      });
      if (data.conversation) {
        upsertConversationSummary(
          { ...data.conversation, draft: true },
          { replaceId: isLocalConversationId(replaceId) ? replaceId : '' }
        );
        setActiveConversation(data.conversation.id || data.conversation.conversation_id);
        return data.conversation;
      }
    } catch (error) {
      if (isAuthError(error)) options.redirectToSignIn();
      else showNotice(`Could not start a ${modeLabel(normalized)} chat. Please try again.`);
      options.track('librarian.conversations_error', 'create');
    } finally {
      options.setCreateInFlight(false);
      options.onQuestionStateChanged();
    }
    return null;
  }

  async function refreshConversations(config: { retryAuth?: boolean } = {}): Promise<ThingyConversationSummary[]> {
    if (!options.token()) {
      state.conversations = [];
      options.onActiveConversationChanged();
      return [];
    }
    if (!(await options.ensureFreshToken())) return [];
    try {
      const data = await options.post({ action: 'list', limit: options.maxRecents });
      if (data.modes || data.entitlements) options.setUserProfile(data);
      const clientActiveShells = state.conversations.filter(
        (entry) => entry?.id && (isLocalConversationId(entry.id) || entry.id === state.activeConversationId)
      );
      const serverConversations = (data.conversations || [])
        .map((entry) => ({ ...entry, id: String(entry.id || entry.conversation_id || ''), local: false }))
        .filter((entry) => entry.id)
        .filter((entry) => String(entry.mode || '') !== 'dispatch');
      const serverIds = new Set(serverConversations.map((entry) => entry.id));
      const keptClientShells = clientActiveShells.filter(
        (entry) => entry.id === state.activeConversationId && !serverIds.has(entry.id)
      );
      state.conversations = dedupeEmptyConversationDrafts(
        [...keptClientShells, ...serverConversations].sort((a, b) =>
          String(b.updated_at || '').localeCompare(String(a.updated_at || ''))
        )
      ).slice(0, options.maxRecents);
      if (state.activeConversationId && !state.conversations.some((entry) => entry.id === state.activeConversationId)) {
        setActiveConversation('');
      }
      options.onActiveConversationChanged();
      return state.conversations;
    } catch (error) {
      if (config.retryAuth !== false && isAuthError(error) && (await options.refreshStoredAuth())) {
        return refreshConversations({ retryAuth: false });
      }
      options.track('librarian.conversations_error', 'list');
      if (isAuthError(error)) {
        options.redirectToSignIn();
        return [];
      }
      options.onActiveConversationChanged();
      return state.conversations;
    }
  }

  async function renameConversation(id: string, title: unknown) {
    const trimmed = String(title || '').trim();
    if (!trimmed) return false;
    if (isLocalConversationId(id)) {
      state.conversations = state.conversations.map((entry) =>
        entry.id === id ? { ...entry, title: trimmed, draft: false, updated_at: new Date().toISOString() } : entry
      );
      options.onActiveConversationChanged();
      return true;
    }
    try {
      const data = await options.post({ action: 'rename', conversation_id: id, title: trimmed });
      if (data.conversation) upsertConversationSummary({ ...data.conversation, draft: false });
      options.track('librarian.conversation_rename');
      return true;
    } catch (_error) {
      showNotice('Could not rename the conversation. Please try again.');
      options.track('librarian.conversations_error', 'rename');
      return false;
    }
  }

  async function deleteConversation(id: unknown) {
    const conversationId = String(id || '').trim();
    if (!conversationId) return { ok: false, wasActive: false };
    const wasActive = conversationId === state.activeConversationId;
    if (!isLocalConversationId(conversationId)) {
      try {
        await options.post({ action: 'delete', conversation_id: conversationId });
      } catch (_error) {
        showNotice('Could not delete the conversation. Please try again.');
        options.track('librarian.conversations_error', 'delete');
        return { ok: false, wasActive };
      }
    }
    ({ conversations: state.conversations, activeConversationId: state.activeConversationId } =
      deleteConversationSummaryList(state.conversations, conversationId, {
        activeConversationId: state.activeConversationId
      }));
    options.onActiveConversationChanged();
    return { ok: true, wasActive };
  }

  async function fetchConversation(id: string) {
    return options.post({ action: 'get', conversation_id: id });
  }

  return {
    activeConversation,
    createConversationShellForMode,
    createLocalConversationShell,
    currentConversationMode,
    currentConversationTitle,
    deleteConversation,
    fetchConversation,
    isLocalConversationId,
    modeLabel,
    refreshConversations,
    renameConversation,
    savedActiveConversation,
    setActiveConversation,
    upsertConversationSummary,
    upsertPendingConversation
  };
}

export { createChatConversationActions };
