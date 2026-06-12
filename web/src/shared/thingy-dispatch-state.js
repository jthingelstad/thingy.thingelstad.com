// @ts-check
function dispatchEditable(stage) {
  return !['queued', 'generating', 'ready_to_send', 'sending', 'sent', 'failed'].includes(String(stage || ''));
}

export { dispatchEditable };
