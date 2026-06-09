import { normalizeModeId } from './thingy-modes.js';

function isLocalConversationId(id, prefix = 'local-chat-') {
  return String(id || '').startsWith(prefix);
}

function conversationId(entry) {
  return String(entry?.id || entry?.conversation_id || '').trim();
}

function conversationTitle(mode = 'thingy', labelForMode = () => 'Thingy') {
  const normalized = normalizeModeId(mode);
  return normalized === 'thingy' ? 'New chat' : `${labelForMode(normalized)} chat`;
}

function emptyConversationDraftKey(entry, labelForMode = () => 'Thingy') {
  if (!entry?.id) return '';
  const normalized = normalizeModeId(entry.mode || 'thingy');
  const title = String(entry.title || '');
  return title === conversationTitle(normalized, labelForMode) ? `${normalized}:${title}` : '';
}

function isEmptyConversationDraft(entry, mode = '', labelForMode = () => 'Thingy') {
  if (!entry?.id) return false;
  const normalized = normalizeModeId(mode || entry.mode || 'thingy');
  return normalizeModeId(entry.mode || 'thingy') === normalized
    && Number(entry.turn_count || 0) === 0
    && String(entry.title || '') === conversationTitle(normalized, labelForMode);
}

function dedupeEmptyConversationDrafts(list = [], options = {}) {
  const activeConversationId = String(options.activeConversationId || '');
  const labelForMode = typeof options.labelForMode === 'function' ? options.labelForMode : () => 'Thingy';
  const nonEmptyDraftKeys = new Set(
    list
      .filter((entry) => Number(entry?.turn_count || 0) > 0)
      .map((entry) => emptyConversationDraftKey(entry, labelForMode))
      .filter(Boolean)
  );
  const seen = new Map();
  const out = [];
  for (const entry of list) {
    if (!isEmptyConversationDraft(entry, '', labelForMode)) {
      out.push(entry);
      continue;
    }
    const key = emptyConversationDraftKey(entry, labelForMode);
    if (nonEmptyDraftKeys.has(key)) continue;
    const existingIndex = seen.get(key);
    if (existingIndex === undefined) {
      seen.set(key, out.length);
      out.push(entry);
      continue;
    }
    if (entry.id === activeConversationId && out[existingIndex]?.id !== activeConversationId) {
      out[existingIndex] = entry;
    }
  }
  return out;
}

function sortConversationSummaries(list = []) {
  return [...list].sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
}

function trimConversationSummaries(list = [], options = {}) {
  const maxRecents = Number(options.maxRecents || 20);
  return dedupeEmptyConversationDrafts(list, {
    activeConversationId: options.activeConversationId,
    labelForMode: options.labelForMode
  }).slice(0, maxRecents);
}

function upsertConversationSummaryList(list = [], conversation, options = {}) {
  const id = conversationId(conversation);
  if (!id) return { conversations: list, activeConversationId: options.activeConversationId || '' };
  const replaceId = String(options.replaceId || '').trim();
  const next = list.filter((entry) => {
    const entryId = conversationId(entry);
    return entryId !== id && (!replaceId || entryId !== replaceId);
  });
  next.unshift({ ...conversation, id, conversation_id: id, local: false });
  const conversations = trimConversationSummaries(sortConversationSummaries(next), options);
  return {
    conversations,
    activeConversationId: replaceId && options.activeConversationId === replaceId ? id : options.activeConversationId
  };
}

function deleteConversationSummaryList(list = [], id, options = {}) {
  const removedId = String(id || '').trim();
  const conversations = list.filter((entry) => conversationId(entry) !== removedId);
  const activeConversationId = options.activeConversationId === removedId ? '' : options.activeConversationId;
  return { conversations, activeConversationId };
}

function createLocalConversation(options = {}) {
  const now = new Date().toISOString();
  const prefix = options.prefix || 'local-chat-';
  const mode = normalizeModeId(options.mode || 'thingy');
  const id = `${prefix}${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return {
    id,
    conversation_id: id,
    title: conversationTitle(mode, options.labelForMode),
    preview: '',
    scope: options.scope || 'all',
    mode,
    created_at: now,
    updated_at: now,
    last_message_at: now,
    turn_count: 0,
    local: true
  };
}

export {
  conversationId,
  conversationTitle,
  createLocalConversation,
  dedupeEmptyConversationDrafts,
  deleteConversationSummaryList,
  isEmptyConversationDraft,
  isLocalConversationId,
  sortConversationSummaries,
  trimConversationSummaries,
  upsertConversationSummaryList
};
