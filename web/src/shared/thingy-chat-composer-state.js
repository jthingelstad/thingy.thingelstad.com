function updateChatComposerState(options = {}) {
  const input = options.input;
  const length = input ? input.value.length : 0;
  const hasText = Boolean(input?.value.trim());
  const maxChars = Number(options.maxChars || 0);
  const hasSources = Boolean(options.hasSources);
  const busy = Boolean(options.busy);
  const signedIn = Boolean(options.signedIn);

  if (options.count) {
    options.count.textContent = `${length} / ${maxChars}`;
    options.count.classList.toggle('warning', length > maxChars * 0.9);
  }
  if (options.sourceError) {
    options.sourceError.textContent = hasSources ? '' : 'Switch on at least one source.';
  }
  if (options.form) {
    options.form.classList.toggle('is-busy', busy);
  }
  if (options.submitButton) {
    options.submitButton.disabled = busy || !hasSources || !hasText || length > maxChars;
    options.submitButton.setAttribute('aria-label', busy ? 'Thingy is answering' : 'Ask Thingy');
    options.submitButton.title = busy ? 'Thingy is answering' : 'Ask Thingy';
  }
  if (options.mapDraftButton) {
    const canMapDraft = hasText && length <= maxChars && hasSources && signedIn;
    options.mapDraftButton.disabled = busy || !canMapDraft;
    options.mapDraftButton.title = canMapDraft ? 'Seed curiosity map with this text' : 'Type a topic to seed a map';
    options.mapDraftButton.setAttribute('aria-label', canMapDraft ? 'Seed curiosity map with this text' : 'Type a topic to seed a map');
  }
  if (options.newChatButton) options.newChatButton.disabled = busy;
  if (options.curiosityMapButton) options.curiosityMapButton.disabled = busy || !signedIn || !hasSources;
  if (options.modeSelect) options.modeSelect.disabled = busy;
  options.sourceControls?.setDisabled?.(busy);
  options.onVoiceUpdate?.();
  options.onConversationTitleUpdate?.();
  options.onAutoSize?.();
}

export { updateChatComposerState };
