function nowIso() {
  return new Date().toISOString();
}

function stageLabel(value) {
  return {
    empty: 'Draft',
    shaping: 'Shaping',
    needs_clarification: 'Clarify',
    ready: 'Ready',
    upgrade: 'Ready',
    queued: 'Queued',
    generating: 'Generating',
    ready_to_send: 'Sending',
    sending: 'Sending',
    sent: 'Sent',
    failed: 'Failed'
  }[value] || 'Draft';
}

function stageGlyph(value) {
  return {
    empty: '•',
    shaping: '…',
    needs_clarification: '?',
    ready: '✓',
    upgrade: '✓',
    queued: '◷',
    generating: '◌',
    ready_to_send: '◷',
    sending: '◷',
    sent: '✓',
    failed: '!'
  }[value] || '•';
}

function normalizeDraft(raw) {
  const draft = raw && typeof raw === 'object' ? raw : {};
  return {
    id: String(draft.id || `draft-${Date.now()}-${Math.random().toString(16).slice(2)}`),
    stage: String(draft.stage || 'empty'),
    prompt: String(draft.prompt || ''),
    direction: String(draft.direction || ''),
    currentQuestion: String(draft.currentQuestion || ''),
    clarificationAnswer: String(draft.clarificationAnswer || ''),
    dispatchId: String(draft.dispatchId || ''),
    title: String(draft.title || ''),
    statusText: String(draft.statusText || ''),
    updatedAt: String(draft.updatedAt || nowIso()),
    messages: Array.isArray(draft.messages) ? draft.messages : []
  };
}

function isServerDispatchId(value) {
  const id = String(value || '');
  return Boolean(id && !id.startsWith('draft-'));
}

function serverDispatchId(draft) {
  if (isServerDispatchId(draft.dispatchId)) return draft.dispatchId;
  if (isServerDispatchId(draft.id)) return draft.id;
  return '';
}

function hasDraftContent(draft, welcomeText = '') {
  if (!draft) return false;
  if (draft.prompt || draft.direction || draft.currentQuestion || draft.clarificationAnswer) return true;
  return (draft.messages || []).some((message) => String(message.text || '') && message.text !== welcomeText);
}

function draftStageFromRow(row) {
  const status = String(row.status || 'draft');
  return status === 'draft' ? 'empty' : status;
}

function fallbackMessagesForRow(row, welcomeText = '') {
  if (Array.isArray(row.messages) && row.messages.length) return row.messages;
  if (['queued', 'generating', 'ready_to_send', 'sending'].includes(row.status)) {
    return [{ role: 'assistant', text: 'This Dispatch is queued and I am preparing it now.' }];
  }
  if (row.status === 'sent') {
    return [{ role: 'assistant', text: 'Dispatch sent. Check your email.', kind: 'sent' }];
  }
  if (row.status === 'failed') {
    return [{ role: 'assistant', text: row.error || 'Dispatch failed while generating.' }];
  }
  if (row.direction) {
    return [{ role: 'assistant', text: `Here is the Dispatch I am ready to generate:\n\n${row.direction}\n\nIf this is right, use Generate Dispatch. If you want to steer it, send me the adjustment.` }];
  }
  return [{ role: 'assistant', text: welcomeText }];
}

function draftFromServerRow(row, welcomeText = '') {
  const id = String(row.id || row.dispatch_id || '');
  return normalizeDraft({
    id,
    dispatchId: id,
    stage: draftStageFromRow(row),
    prompt: row.prompt || row.topic || '',
    direction: row.direction || '',
    currentQuestion: row.clarification_question || '',
    clarificationAnswer: row.clarification_answer || '',
    title: row.title || row.subject || row.topic || '',
    statusText: row.preview || row.error || '',
    updatedAt: row.updated_at || row.created_at || nowIso(),
    messages: fallbackMessagesForRow(row, welcomeText)
  });
}

export {
  draftFromServerRow,
  hasDraftContent,
  normalizeDraft,
  serverDispatchId,
  stageGlyph,
  stageLabel
};
