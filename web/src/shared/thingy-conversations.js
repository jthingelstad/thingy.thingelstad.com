import { normalizeModeId } from './thingy-modes.js';

function isLocalConversationId(id, prefix = 'local-chat-') {
  return String(id || '').startsWith(prefix);
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
  conversationTitle,
  createLocalConversation,
  dedupeEmptyConversationDrafts,
  isEmptyConversationDraft,
  isLocalConversationId
};
