// Boot wiring for /chat/: DOM lookups, island mounts, event listeners, and
// view orchestration (message elements, scroll, composer sizing, prompts,
// the mode banner/select). All session/auth flows, conversation flows, and
// streaming POSTs live in thingy-chat-actions.js; this file connects them
// to the page.

import * as session from './thingy-session.js';
import {
  extractPreferredNameFromMessage,
  normalizePreferredName
} from './thingy-account.js';
import { createTinylyticsTracker } from './thingy-analytics.js';
import { createComposer } from './thingy-composer.js';
import { applyReturnChip } from './thingy-from.js';
import {
  modeClass,
  modeIcon,
  normalizeModeId,
  normalizeModes
} from './thingy-modes.js';
import { iconSvg } from './thingy-icons.js';
import {
  escapeHtml as escapeMarkup,
} from './thingy-markdown.js';
import {
  activityStepsFromToolNames,
  renderCuriosityMap
} from './thingy-chat-rendering.js';
import { createAssistantMessageModel } from './models/assistant-message.js';
import { mountAssistantMessage } from './components/AssistantMessage.jsx';
import { effect } from '@preact/signals';
import { normalizeScopeParam } from './thingy-scope.js';
import { createSourcePicker } from './thingy-source-picker.js';
import { attachRailState } from './thingy-rail-state.js';
import { createDictationController } from './thingy-voice.js';
import { createChatMessageActions } from './thingy-message-actions.js';
import {
  librarianStreamUrl,
  tinylyticsId
} from './thingy-config.js';
import { isAuthError } from './thingy-url.js';
import { updateChatComposerState } from './thingy-chat-composer-state.js';
import { chatState as state, createChatActions } from './thingy-chat-actions.js';
import {
  answerInFlight as answerInFlightSignal,
  authAction as authActionSignal,
  authEmail as authEmailSignal,
  hasSources as hasSourcesSignal,
  interactionBusy as interactionBusySignal,
  mapInFlight as mapInFlightSignal,
  questionText as questionTextSignal,
  stoppable as stoppableSignal,
  welcomeInFlight as welcomeInFlightSignal
} from './stores/chat-store.js';
import {
  accountMenuOpen as accountMenuOpenSignal,
  accountNameStatus as accountNameStatusSignal,
  showNotice,
  signedIn as signedInSignal
} from './stores/ui-store.js';
import { focusAuthEmail, mountAuthPanel } from './components/AuthPanel.jsx';
import { mountAccountMenu } from './components/AccountMenu.jsx';
import { mountComposerCount } from './components/ComposerCount.jsx';
import { mountComposerSubmit } from './components/ComposerSubmit.jsx';
import { mountNotice } from './components/Notice.jsx';
import { mountRailRecents } from './components/RailRecents.jsx';

function bootChat() {
    applyReturnChip();
    const streamBase = librarianStreamUrl();
    const authPanel = document.getElementById('librarian-auth');
    const chatPanel = document.getElementById('librarian-chat');
    const appShell = document.getElementById('thingy-app-shell');
    const questionForm = document.getElementById('librarian-question-form');
    const accountMount = document.getElementById('rail-account-mount');
    const clearChatButton = document.getElementById('librarian-clear-chat');
    const curiosityMapButton = document.getElementById('thingy-curiosity-map');
    const modeControl = document.getElementById('thingy-mode-control');
    const modeIconEl = document.getElementById('thingy-mode-icon');
    const modeSelect = document.getElementById('thingy-mode-select');
    const modeLabelEl = document.getElementById('thingy-mode-label');
    const modeMenu = document.getElementById('thingy-mode-menu');
    const modeBanner = document.getElementById('thingy-mode-banner');
    const questionInput = document.getElementById('librarian-question');
    const questionButton = questionForm.querySelector('button[type="submit"]');
    const voiceButton = document.getElementById('composer-voice');
    const composerMapButton = document.getElementById('composer-map');
    const voiceStatus = document.getElementById('composer-voice-status');
    const sourceError = document.getElementById('librarian-source-error');
    const scopeInputs = Array.from(document.querySelectorAll('input[name="scope"]'));
    const questionCount = document.getElementById('librarian-question-count');
    const messages = document.getElementById('librarian-messages');
    const chatScroll = document.querySelector('.thingy-chat-scroll');
    const composerZone = document.querySelector('.thingy-composer-zone');
    const prompts = document.getElementById('librarian-prompts');
    const mobileConversationTitle = document.getElementById('mobile-conversation-title');
    const mobileConversationsToggle = document.getElementById('mobile-conversations-toggle');
    const mobileNewChatButton = document.getElementById('mobile-new-chat');
    const mobileConversationMenuButton = document.getElementById('mobile-conversation-menu-button');
    const mobileConversationMenu = document.getElementById('mobile-conversation-menu');
    const mobileRenameConversation = document.getElementById('mobile-rename-conversation');
    const mobileDeleteConversation = document.getElementById('mobile-delete-conversation');
    const railScrim = document.getElementById('rail-scrim');
    const railControls = attachRailState({
      shell: appShell,
      mobileToggle: mobileConversationsToggle,
      scrim: railScrim,
      collapseButton: document.getElementById('rail-collapse'),
      collapsedKey: 'thingyRailCollapsed',
      showLabel: 'Show conversations',
      hideLabel: 'Hide conversations'
    });
    const maxRecents = 20;
    const maxQuestionChars = Number(questionInput.getAttribute('maxlength') || '1200');
    const analytics = createTinylyticsTracker({ enabled: Boolean(tinylyticsId()) });
    let autoFollowChat = true;
    let scrollFrame = 0;
    let composerReserveFrame = 0;
    let keyboardFrame = 0;
    let keyboardInset = 0;
    let composerControls = null;
    let welcomeShownThisVisit = false;
    let welcomeAbortController = null;
    let welcomePendingMessage = null;
    let dictationControls = null;

    const params = new URLSearchParams(window.location.search);
    const initialEmailFromUrl = session.normalizeEmail(params.get('email'));
    const loginToken = String(params.get('login_token') || params.get('magic_token') || '').trim();
    const initialPrompt = normalizeInitialPrompt(params.get('prompt'));
    const hasInitialPrompt = Boolean(initialPrompt);
    const initialScope = normalizeScopeParam(params.get('scope')) || normalizeScopeParam(params.get('corpus'));
    let activeScope = initialScope || 'all';
    const sourceControls = createSourcePicker({
      inputs: scopeInputs,
      button: document.getElementById('srcpick-btn'),
      popover: document.getElementById('srcpick-pop'),
      label: document.getElementById('srcpick-label'),
      dots: document.getElementById('srcpick-dots'),
      note: document.getElementById('srcpick-note'),
      error: sourceError,
      scrollContainer: chatScroll,
      onChange: (nextScope) => {
        activeScope = nextScope;
        trackTinylyticsEvent('librarian.scope_change', activeScope || 'none');
        updateQuestionState();
      }
    });
    let initialPromptSubmitted = false;
    if (initialEmailFromUrl) authEmailSignal.value = initialEmailFromUrl;

    // The flow layer. Function declarations referenced by the hooks are
    // hoisted within bootChat, so wiring them here is safe.
    const actions = createChatActions({
      session,
      streamBase,
      maxRecents,
      ui: {
        currentScope: () => sourceControls.currentScope(),
        scheduleChatScroll,
        track: trackTinylyticsEvent,
        onModesChanged: renderModeControl,
        onActiveConversationChanged: () => {
          updateMobileConversationTitle();
          renderModeBanner();
        },
        onQuestionStateChanged: updateQuestionState,
        onAuthenticated: () => {
          resetMessages();
          actions.refreshConversations().then(() => {
            if (hasInitialPrompt) {
              actions.setActiveConversation('');
              maybeSubmitInitialPrompt();
              return;
            }
            if (!state.activeConversationId) startAgentWelcome();
          });
          scheduleComposerReserveUpdate();
          questionInput.focus();
        },
        onAuthCleared: () => {
          welcomeShownThisVisit = false;
          prompts.hidden = true;
          prompts.innerHTML = '';
          focusAuthEmail();
        }
      }
    });

    // Initialize the auth signal from localStorage before any effect runs
    // so the first paint shows the right panel without a flash of auth.
    signedInSignal.value = Boolean(actions.token()) && !actions.tokenExpired();

    mountAccountMenu(accountMount, {
      session,
      signedIn: signedInSignal,
      returnTo: '/chat/',
      normalizeName: normalizePreferredName,
      onSignedOutClick: () => focusAuthEmail(),
      onLogout: () => {
        clearToken({ scrubAuthParams: true });
        trackTinylyticsEvent('librarian.logout');
      },
      onSaved: (nextName) => {
        actions.rememberPreferredName(nextName);
        actions.refreshAccountIdentity();
      },
      onOpen: () => {
        actions.refreshAccountProfile({ force: true });
      }
    });

    function resetMessages() {
      unmountChildren(messages);
      messages.innerHTML = '';
    }

    function normalizeInitialPrompt(value) {
      return String(value || '').trim().slice(0, maxQuestionChars);
    }

    function renderModeBanner() {
      if (!modeBanner) return;
      const mode = actions.currentConversationMode();
      const show = actions.token() && mode && mode !== 'thingy' && state.availableModes.length > 1;
      modeBanner.hidden = !show;
      if (!show) {
        modeBanner.innerHTML = '';
        modeBanner.removeAttribute('data-mode');
        modeBanner.removeAttribute('aria-label');
        return;
      }
      const label = actions.modeLabel(mode);
      modeBanner.dataset.mode = modeClass(mode);
      modeBanner.setAttribute('aria-label', `${label} mode`);
      modeBanner.innerHTML = `${iconSvg(modeIcon(mode), { className: 'thingy-mode-banner-icon' })}<span>${escapeHtml(label)}</span>`;
    }

    function renderModeControl() {
      if (!modeControl || !modeSelect) return;
      const show = actions.token() && state.availableModes.length > 1;
      modeControl.hidden = !show;
      const selectedMode = state.availableModes.some((mode) => mode.id === state.activeMode) ? state.activeMode : 'thingy';
      const selectedLabel = actions.modeLabel(selectedMode);
      modeSelect.dataset.value = selectedMode;
      modeSelect.setAttribute('aria-label', `New chat mode: ${selectedLabel}`);
      if (modeLabelEl) modeLabelEl.textContent = selectedLabel;
      if (modeIconEl) modeIconEl.innerHTML = iconSvg(modeIcon(selectedMode));
      if (modeMenu) {
        modeMenu.innerHTML = state.availableModes.map((mode) => {
          const selected = mode.id === selectedMode;
          return `<button type="button" role="option" class="rail-newchat-mode-option" data-mode="${escapeHtml(mode.id)}" aria-selected="${selected ? 'true' : 'false'}">${iconSvg(modeIcon(mode.id), { className: 'rail-newchat-mode-option-icon' })}<span>${escapeHtml(mode.label)}</span></button>`;
        }).join('');
      }
      closeModeMenu();
      renderModeBanner();
    }

    function openModeMenu() {
      if (!modeMenu || !modeSelect || modeSelect.disabled) return;
      modeMenu.hidden = false;
      modeSelect.setAttribute('aria-expanded', 'true');
    }

    function closeModeMenu() {
      if (!modeMenu || !modeSelect) return;
      modeMenu.hidden = true;
      modeSelect.setAttribute('aria-expanded', 'false');
    }

    function modeMenuOpen() {
      return Boolean(modeMenu && !modeMenu.hidden);
    }

    function updateVoiceButtonState() {
      dictationControls?.updateButtonState?.();
    }

    function stopDictation() {
      dictationControls?.stop?.();
    }

    function setActiveScope(value, options = {}) {
      activeScope = sourceControls.setScope(value);
      if (options.track !== false) trackTinylyticsEvent('librarian.scope_change', activeScope);
      updateQuestionState();
    }

    setActiveScope(activeScope, { track: false });

    // Wraps the store-level teardown with the chat view's DOM cleanup.
    function clearToken(options = {}) {
      const config = typeof options === 'string' ? { message: options } : (options || {});
      actions.clearAuthState(config);
    }

    function nearChatBottom() {
      if (!chatScroll) return true;
      return chatScroll.scrollHeight - chatScroll.scrollTop - chatScroll.clientHeight < 64;
    }

    function scrollChatToBottom(options = {}) {
      if (!chatScroll) return;
      if (!options.force && !autoFollowChat && !nearChatBottom()) return;
      chatScroll.scrollTop = chatScroll.scrollHeight;
    }

    function scheduleChatScroll(options = {}) {
      if (!chatScroll) return;
      if (!options.force && !nearChatBottom()) {
        autoFollowChat = false;
        return;
      }
      autoFollowChat = true;
      if (scrollFrame) return;
      scrollFrame = window.requestAnimationFrame(() => {
        scrollFrame = 0;
        scrollChatToBottom(options);
      });
    }

    function addMessage(kind, html) {
      const item = document.createElement('div');
      item.className = `librarian-message librarian-message-${kind}`;
      item.innerHTML = html;
      messages.appendChild(item);
      scheduleChatScroll({ force: true });
      return item;
    }

    // Creates an assistant message backed by a reactive model. The DOM root
    // is returned so other helpers (addResponseActions, scroll bookkeeping)
    // keep working; the model is what stream code writes into.
    function addAssistantMessage(modelOptions = {}) {
      const item = document.createElement('div');
      item.className = 'librarian-message librarian-message-assistant';
      messages.appendChild(item);
      const model = createAssistantMessageModel(modelOptions);
      const unmount = mountAssistantMessage(item, model);
      const disposePending = effect(() => {
        const s = model.status.value;
        item.classList.toggle('librarian-message-pending', s === 'pending' || s === 'streaming');
      });
      item._thingyUnmount = () => {
        disposePending();
        unmount();
      };
      scheduleChatScroll({ force: true });
      return { element: item, model };
    }

    function unmountChildren(parent) {
      Array.from(parent.children).forEach((child) => {
        if (typeof child._thingyUnmount === 'function') child._thingyUnmount();
      });
    }

    function removeMessageElement(item) {
      if (!item) return;
      if (typeof item._thingyUnmount === 'function') item._thingyUnmount();
      item.remove();
    }

    if (chatScroll) {
      chatScroll.addEventListener('scroll', () => {
        autoFollowChat = nearChatBottom();
      }, { passive: true });
    }

    function autoSizeQuestionInput() {
      if (composerControls) {
        composerControls.autoSize();
      } else {
        questionInput.style.height = 'auto';
        questionInput.style.height = `${Math.min(questionInput.scrollHeight, 240)}px`;
        updateComposerReserve();
      }
    }

    function updateComposerReserve() {
      composerReserveFrame = 0;
      if (!composerZone || !chatPanel) return;
      const height = Math.ceil(composerZone.getBoundingClientRect().height);
      chatPanel.style.setProperty('--composer-reserve', `${height + keyboardInset}px`);
    }

    function scheduleComposerReserveUpdate() {
      if (composerReserveFrame) return;
      composerReserveFrame = window.requestAnimationFrame(updateComposerReserve);
    }

    if (composerZone && 'ResizeObserver' in window) {
      const composerObserver = new ResizeObserver(updateComposerReserve);
      composerObserver.observe(composerZone);
    }
    function updateKeyboardInset() {
      keyboardFrame = 0;
      const viewport = window.visualViewport;
      const nextInset = viewport
        ? Math.max(0, Math.ceil(window.innerHeight - viewport.height - viewport.offsetTop))
        : 0;
      keyboardInset = nextInset;
      document.documentElement.style.setProperty('--thingy-keyboard-inset', `${nextInset}px`);
      document.documentElement.classList.toggle('is-thingy-keyboard-open', nextInset > 0);
      scheduleComposerReserveUpdate();
      if (nextInset > 0 && questionForm?.contains(document.activeElement)) {
        scheduleChatScroll({ force: true });
      }
    }

    function scheduleKeyboardInsetUpdate() {
      if (keyboardFrame) return;
      keyboardFrame = window.requestAnimationFrame(updateKeyboardInset);
    }

    window.addEventListener('resize', () => {
      scheduleKeyboardInsetUpdate();
      updateComposerReserve();
    });
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', scheduleKeyboardInsetUpdate);
      window.visualViewport.addEventListener('scroll', scheduleKeyboardInsetUpdate);
    }
    updateKeyboardInset();

    // Thin wrapper around the store signal so the legacy createComposer /
    // createDictationController APIs (which expect an `isBusy()` function)
    // keep working without changes. Components read interactionBusy directly.
    function interactionBusy() {
      return interactionBusySignal.value;
    }

    function setQuestionInputValue(value) {
      questionInput.value = value;
      questionTextSignal.value = value;
    }

    function cancelWelcomeSetup() {
      welcomeInFlightSignal.value = false;
      if (welcomeAbortController) welcomeAbortController.abort();
      welcomeAbortController = null;
      if (welcomePendingMessage && welcomePendingMessage.isConnected) {
        removeMessageElement(welcomePendingMessage);
      }
      welcomePendingMessage = null;
      updateQuestionState();
    }

    function updateQuestionState() {
      const sourcesPicked = sourceControls.sourceCount() > 0;
      hasSourcesSignal.value = sourcesPicked;
      // Authoritative mirror — covers dictation and any code path that
      // writes questionInput.value directly without going through setQuestionInputValue.
      questionTextSignal.value = questionInput.value;
      updateChatComposerState({
        input: questionInput,
        maxChars: maxQuestionChars,
        hasSources: sourcesPicked,
        busy: interactionBusy(),
        signedIn: Boolean(actions.token()),
        sourceError,
        form: questionForm,
        mapDraftButton: composerMapButton,
        newChatButton: clearChatButton,
        curiosityMapButton,
        modeSelect,
        sourceControls,
        onVoiceUpdate: updateVoiceButtonState,
        onConversationTitleUpdate: updateMobileConversationTitle,
        onAutoSize: autoSizeQuestionInput
      });
    }

    function trackTinylyticsEvent(name, value) {
      analytics.track(name, value);
    }

    const noticeHost = document.createElement('div');
    document.body.appendChild(noticeHost);
    mountNotice(noticeHost);

    function escapeHtml(value) {
      return escapeMarkup(value);
    }

    const {
      addPromptActions,
      addResponseActions,
      stopSpeaking
    } = createChatMessageActions({
      submitFeedback: ({ requestId, reaction, comment }) => actions.postStreamJson('/feedback', {
        request_id: requestId,
        reaction,
        comment
      }, { authorization: `Bearer ${actions.token()}` }),
      track: trackTinylyticsEvent
    });

    function resetConversationView() {
      setQuestionInputValue('');
      resetMessages();
      updateQuestionState();
    }

    function startBlankConversationView() {
      actions.setActiveConversation('');
      resetConversationView();
    }

    function startNewConversationView(mode = state.activeMode) {
      state.activeMode = normalizeModeId(mode);
      const shell = actions.createLocalConversationShell(state.activeMode);
      resetConversationView();
      return shell;
    }

    function toggleMobileConversationMenu(force) {
      if (!mobileConversationMenu || !mobileConversationMenuButton) return;
      const open = force === undefined ? mobileConversationMenu.hasAttribute('hidden') : force;
      mobileConversationMenu.toggleAttribute('hidden', !open);
      mobileConversationMenuButton.setAttribute('aria-expanded', open ? 'true' : 'false');
    }

    function updateMobileConversationTitle() {
      if (mobileConversationTitle) mobileConversationTitle.textContent = actions.currentConversationTitle();
      const hasActive = Boolean(state.activeConversationId && actions.activeConversation());
      if (mobileConversationMenuButton) {
        mobileConversationMenuButton.disabled = !hasActive || interactionBusy();
        mobileConversationMenuButton.title = hasActive ? 'Conversation actions' : 'No conversation actions';
      }
      if (!hasActive) toggleMobileConversationMenu(false);
    }

    function setMobileRailOpen(open) {
      railControls.setMobileOpen(open);
    }

    async function renameActiveConversation() {
      const active = actions.activeConversation();
      if (!active || interactionBusy()) return;
      toggleMobileConversationMenu(false);
      const current = active.title || 'Untitled chat';
      const title = window.prompt('Rename conversation', current);
      if (title == null) return;
      const trimmed = title.trim();
      if (!trimmed || trimmed === current) return;
      await actions.renameConversation(active.id, trimmed);
      updateMobileConversationTitle();
    }

    async function deleteActiveConversation() {
      const active = actions.activeConversation();
      if (!active || interactionBusy()) return;
      toggleMobileConversationMenu(false);
      if (!window.confirm('Delete this conversation?')) return;
      const wasLocal = actions.isLocalConversationId(active.id);
      const result = await actions.deleteConversation(active.id);
      if (!result.ok) return;
      if (wasLocal) {
        startBlankConversationView();
        setMobileRailOpen(false);
        return;
      }
      clearConversation();
      setMobileRailOpen(false);
      trackTinylyticsEvent('librarian.conversation_delete');
    }

    function clearConversation() {
      if (interactionBusy()) return null;
      cancelWelcomeSetup();
      stopSpeaking();
      if (dictationControls?.isListening?.()) stopDictation();
      welcomeShownThisVisit = true;
      state.activeMode = normalizeModeId(modeSelect?.value || state.activeMode);
      const shell = startNewConversationView(state.activeMode);
      questionInput.focus();
      trackTinylyticsEvent('librarian.clear');
      return shell;
    }

    async function showCuriosityMap(center = '', options = {}) {
      if (!actions.token() || interactionBusy()) return;
      if (!(await actions.ensureFreshToken())) {
        return;
      }
      const scope = sourceControls.currentScope();
      if (!scope) {
        updateQuestionState();
        return;
      }
      const attachToCurrent = Boolean(options.attachToCurrent && state.activeConversationId && !actions.isLocalConversationId(state.activeConversationId));
      const existingConversationId = attachToCurrent ? state.activeConversationId : '';
      if (!attachToCurrent) welcomeShownThisVisit = true;
      hidePrompts();
      if (window.matchMedia('(max-width: 640px)').matches) setMobileRailOpen(false);
      stopSpeaking();
      if (!attachToCurrent) {
        actions.setActiveConversation('');
        resetMessages();
      }
      setQuestionInputValue('');
      mapInFlightSignal.value = true;
      updateQuestionState();
      autoFollowChat = true;
      const { model } = addAssistantMessage({
        statusFallback: 'Thingy is drawing connections...'
      });
      try {
        const map = await actions.postStreamJson('/curiosity-map', {
          scope,
          mode: actions.currentConversationMode(),
          center,
          conversation_id: existingConversationId || undefined,
          user_profile: actions.readerProfileContext()
        }, actions.authHeaders());
        if (map.conversation_id) {
          actions.setActiveConversation(map.conversation_id);
        }
        if (map.conversation) actions.upsertConversationSummary(map.conversation);
        const mapHtml = renderCuriosityMap(map) || '<p>Thingy could not find enough connected threads to draw a map yet.</p>';
        model.artifactHtml.value = mapHtml;
        model.status.value = 'done';
        scheduleChatScroll({ force: true });
        await actions.refreshConversations();
        trackTinylyticsEvent('librarian.curiosity_map_success', `${(map.nodes || []).length}.${(map.sources || []).length}`);
      } catch (error) {
        model.errorMessage.value = error.message;
        model.status.value = 'error';
        trackTinylyticsEvent('librarian.curiosity_map_error', error.requestId ? 'server' : 'client');
        if (isAuthError(error)) actions.redirectToSignIn();
      } finally {
        mapInFlightSignal.value = false;
        updateQuestionState();
      }
    }

    async function loadConversationIntoChat(id) {
      if (interactionBusy()) return;
      const conversationId = String(id || '').trim();
      if (!conversationId) return;
      cancelWelcomeSetup();
      if (actions.isLocalConversationId(conversationId)) {
        actions.setActiveConversation(conversationId);
        resetConversationView();
        hidePrompts();
        questionInput.focus();
        return;
      }
      try {
        const data = await actions.fetchConversation(conversationId);
        actions.setActiveConversation(conversationId);
        if (data.conversation) actions.upsertConversationSummary(data.conversation);
        if (data.conversation?.mode) {
          state.activeMode = data.conversation.mode;
          renderModeControl();
        }
        resetMessages();
        hidePrompts();
        const scopeFallback = sourceControls.currentScope();
        for (const msg of data.messages || []) {
          if (msg.role === 'user') {
            const el = addMessage('user', `<p>${escapeHtml(msg.content || '')}</p>`);
            addPromptActions(el, msg.content || '', msg.scope || scopeFallback);
          } else if (msg.role === 'assistant') {
            const artifactHtml = msg.artifact?.kind === 'curiosity_map' ? renderCuriosityMap(msg.artifact) : '';
            const activitySteps = activityStepsFromToolNames(msg.tool_names || msg.toolNames || []);
            const requestId = msg.request_id || msg.requestId || '';
            const { element } = addAssistantMessage({
              content: msg.content || '',
              citations: msg.citations || [],
              activity: activitySteps,
              artifactHtml,
              status: 'done',
              requestId
            });
            if (!artifactHtml && requestId) addResponseActions(element, requestId);
          }
        }
        setQuestionInputValue('');
        updateQuestionState();
        updateMobileConversationTitle();
        scheduleComposerReserveUpdate();
        scrollChatToBottom({ force: true });
        questionInput.focus();
      } catch (error) {
        showNotice('Could not load that conversation. Please try again.');
        trackTinylyticsEvent('librarian.conversations_error', 'get');
      }
    }

    function hidePrompts() {
      prompts.classList.remove('librarian-prompts-loading');
      prompts.hidden = true;
      prompts.innerHTML = '';
      scheduleComposerReserveUpdate();
    }

    function maybeSubmitInitialPrompt() {
      if (!initialPrompt || initialPromptSubmitted || interactionBusy() || !actions.token()) return;
      initialPromptSubmitted = true;
      hidePrompts();
      setQuestionInputValue(initialPrompt);
      updateQuestionState();
      questionForm.requestSubmit();
    }

    async function startAgentWelcome() {
      if (!actions.token() || interactionBusy() || welcomeInFlightSignal.value || welcomeShownThisVisit || hasInitialPrompt) return;
      if (!(await actions.ensureFreshToken())) {
        return;
      }
      hidePrompts();
      actions.setAwaitingName(!state.preferredName);
      welcomeShownThisVisit = true;
      welcomeInFlightSignal.value = true;
      welcomeAbortController = new AbortController();
      updateQuestionState();
      const { element: pending, model } = addAssistantMessage({
        label: 'Session Setup',
        statusFallback: 'Thingy is getting oriented...'
      });
      welcomePendingMessage = pending;
      try {
        await actions.postStreamingWelcome(model, sourceControls.currentScope(), { controller: welcomeAbortController });
        trackTinylyticsEvent('librarian.welcome_success');
      } catch (error) {
        if (!welcomeInFlightSignal.value || !pending.isConnected) return;
        model.activity.value = [];
        model.commentary.value = [];
        model.content.value = "Hi. I'm Thingy. Ask me what you're curious about and I'll help you explore the archive.";
        model.status.value = 'done';
        trackTinylyticsEvent('librarian.welcome_error', error.requestId ? 'server' : 'client');
      } finally {
        if (pending.isConnected) {
          welcomeInFlightSignal.value = false;
          welcomeAbortController = null;
          welcomePendingMessage = null;
          updateQuestionState();
        }
      }
    }

    mountAuthPanel(authPanel, {
      onSubmit: () => { actions.submitAuthCheck(); },
      onAddSubscriber: () => actions.submitAuthAction('subscribe'),
      onResendConfirmation: () => actions.submitAuthAction('resend_confirmation'),
      onEmailInput: () => {
        actions.validateEmail();
        authActionSignal.value = 'none';
      }
    });

    // Drive panel visibility and the booting/auth shell modifier classes
    // off the signedIn signal. The bootstrap paths set signedIn before
    // this runs for the first time.
    effect(() => {
      const isSignedIn = signedInSignal.value;
      authPanel.hidden = isSignedIn;
      chatPanel.hidden = !isSignedIn;
      if (appShell) {
        appShell.classList.remove('is-booting');
        appShell.classList.toggle('is-auth', !isSignedIn);
        if (!isSignedIn) setMobileRailOpen(false);
      }
    });
    clearChatButton.addEventListener('click', async () => {
      if (interactionBusy()) return;
      const shell = clearConversation();
      await actions.createConversationShellForMode(state.activeMode, { replaceId: shell?.id });
      if (window.matchMedia('(max-width: 640px)').matches) setMobileRailOpen(false);
    });
    if (curiosityMapButton) {
      curiosityMapButton.addEventListener('click', () => {
        showCuriosityMap('', { attachToCurrent: false });
      });
    }
    if (composerMapButton) {
      composerMapButton.addEventListener('click', () => {
        const seed = questionInput.value.trim();
        if (!seed || composerMapButton.disabled) return;
        showCuriosityMap(seed, { attachToCurrent: true });
        trackTinylyticsEvent('librarian.curiosity_map_seed', seed.length < 20 ? 'short' : seed.length < 80 ? 'medium' : 'long');
      });
    }

    async function submitQuestion() {
      if (interactionBusy()) return;
      cancelWelcomeSetup();
      const message = questionInput.value.trim();
      if (!message) return;
      if (message.length > maxQuestionChars) return;
      const scope = sourceControls.currentScope();
      if (!scope) {
        updateQuestionState();
        return;
      }
      if (!(await actions.ensureFreshToken())) {
        return;
      }
      if (dictationControls?.isListening?.()) stopDictation();
      stopSpeaking();
      answerInFlightSignal.value = true;
      updateQuestionState();
      hidePrompts();
      const questionWordCount = message.split(/\s+/).filter(Boolean).length;
      const questionSize = questionWordCount < 6 ? 'short' : questionWordCount < 18 ? 'medium' : 'long';
      if (actions.isAwaitingName() && !state.preferredName) {
        const suppliedName = extractPreferredNameFromMessage(message);
        if (suppliedName) {
          await actions.persistInferredPreferredName(suppliedName).catch(() => {});
        }
        actions.setAwaitingName(false);
      }
      autoFollowChat = true;
      const userMessage = addMessage('user', `<p>${escapeHtml(message)}</p>`);
      addPromptActions(userMessage, message, scope);
      setQuestionInputValue('');
      updateQuestionState();
      const { element: pending, model } = addAssistantMessage({
        statusFallback: 'Thingy is thinking...'
      });
      try {
        const data = await actions.postStreamingChat(message, model, scope);
        if (data.stopped) {
          const hasPartial = Boolean(String(data.answer || '').trim() || data.experience);
          trackTinylyticsEvent('librarian.answer_stopped', hasPartial ? 'partial' : 'empty');
        } else {
          addResponseActions(pending, data.request_id);
        }
        if (data.conversation_id) {
          actions.setActiveConversation(data.conversation_id);
        }
        if (data.conversation) actions.upsertConversationSummary(data.conversation);
        await actions.refreshConversations();
        if (!data.stopped) trackTinylyticsEvent('librarian.answer_success', `${questionSize}.${(data.citations || []).length}`);
      } catch (error) {
        model.errorMessage.value = error.message;
        if (!isAuthError(error)) model.retryPrompt.value = message;
        model.status.value = 'error';
        trackTinylyticsEvent('librarian.answer_error', error.requestId ? 'server' : 'client');
        if (isAuthError(error)) {
          actions.redirectToSignIn();
        }
      } finally {
        answerInFlightSignal.value = false;
        stoppableSignal.value = false;
        actions.clearAnswerAbortState();
        updateQuestionState();
      }
    }

    // Mount the composer islands. ComposerCount subscribes to questionText
    // for character counting; ComposerSubmit subscribes to interactionBusy
    // and stoppable for the morphing send/stop button.
    questionCount.replaceChildren();
    mountComposerCount(questionCount, { maxChars: maxQuestionChars });
    const submitMount = document.createElement('span');
    questionButton.parentElement.insertBefore(submitMount, questionButton);
    mountComposerSubmit(submitMount, {
      maxChars: maxQuestionChars,
      onStop: () => {
        actions.stopActiveAnswer();
        trackTinylyticsEvent('librarian.answer_stop_click');
      }
    });
    // ComposerSubmit renders the real submit button; the placeholder in HTML
    // is now redundant.
    questionButton.remove();

    composerControls = createComposer({
      form: questionForm,
      input: questionInput,
      maxChars: maxQuestionChars,
      isBusy: interactionBusy,
      onSubmit: submitQuestion,
      onInput: updateQuestionState,
      autoSize: true,
      maxHeight: 240,
      onAutoSize: updateComposerReserve
    });

    dictationControls = createDictationController({
      input: questionInput,
      button: voiceButton,
      status: voiceStatus,
      maxChars: maxQuestionChars,
      isBusy: interactionBusy,
      onInput: updateQuestionState,
      onTrack: trackTinylyticsEvent
    }) || null;

    messages.addEventListener('click', (event) => {
      const target = event.target instanceof Element ? event.target : event.target.parentElement;
      const retryButton = target ? target.closest('button[data-retry-prompt]') : null;
      if (retryButton && !interactionBusy()) {
        const failed = retryButton.closest('.librarian-message');
        const previous = failed ? failed.previousElementSibling : null;
        setQuestionInputValue(retryButton.dataset.retryPrompt || '');
        if (failed) removeMessageElement(failed);
        if (previous && previous.classList.contains('librarian-message-user')) previous.remove();
        updateQuestionState();
        trackTinylyticsEvent('librarian.answer_retry');
        questionForm.requestSubmit();
        return;
      }
      const button = target ? target.closest('button[data-experience-prompt], button[data-map-prompt]') : null;
      if (!button || interactionBusy()) return;
      setQuestionInputValue(button.dataset.experiencePrompt || button.dataset.mapPrompt || '');
      updateQuestionState();
      if (button.dataset.mapPrompt) {
        trackTinylyticsEvent('librarian.curiosity_map_prompt', 'map');
        questionForm.requestSubmit();
        return;
      }
      questionInput.focus();
      trackTinylyticsEvent(
        'librarian.experience_prompt',
        button.closest('.thingy-experience-spark') ? 'spark' : 'trail'
      );
    });

    updateQuestionState();

    /* Rail actions. */
    if (mobileNewChatButton) {
      mobileNewChatButton.addEventListener('click', async (event) => {
        event.stopPropagation();
        if (interactionBusy()) return;
        toggleMobileConversationMenu(false);
        const shell = clearConversation();
        await actions.createConversationShellForMode(state.activeMode, { replaceId: shell?.id });
        setMobileRailOpen(false);
      });
    }
    async function chooseMode(value) {
      if (!modeSelect) return;
        if (interactionBusy()) {
          modeSelect.dataset.value = state.activeMode;
          return;
        }
        const nextMode = normalizeModeId(value);
        if (!state.availableModes.some((mode) => mode.id === nextMode)) {
          modeSelect.dataset.value = state.activeMode;
          return;
        }
        if (nextMode === state.activeMode && !state.activeConversationId) return;
        state.activeMode = nextMode;
        welcomeShownThisVisit = false;
        const shell = startNewConversationView(state.activeMode);
        renderModeControl();
        const conversation = await actions.createConversationShellForMode(state.activeMode, { replaceId: shell?.id });
        if (window.matchMedia('(max-width: 640px)').matches) setMobileRailOpen(false);
        if (state.activeMode === 'thingy' || conversation) startAgentWelcome();
        trackTinylyticsEvent('librarian.mode_change', state.activeMode);
    }
    if (modeSelect) {
      modeSelect.addEventListener('click', (event) => {
        event.stopPropagation();
        if (modeMenuOpen()) closeModeMenu();
        else openModeMenu();
      });
      modeSelect.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          closeModeMenu();
          return;
        }
        if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openModeMenu();
          modeMenu?.querySelector('[aria-selected="true"]')?.focus();
        }
      });
    }
    if (modeMenu) {
      modeMenu.addEventListener('click', async (event) => {
        const option = event.target instanceof Element ? event.target.closest('[data-mode]') : null;
        if (!option) return;
        event.stopPropagation();
        closeModeMenu();
        await chooseMode(option.getAttribute('data-mode') || '');
      });
      modeMenu.addEventListener('keydown', async (event) => {
        if (event.key === 'Escape') {
          closeModeMenu();
          modeSelect?.focus();
          return;
        }
        if (event.key !== 'Enter' && event.key !== ' ') return;
        const option = event.target instanceof Element ? event.target.closest('[data-mode]') : null;
        if (!option) return;
        event.preventDefault();
        closeModeMenu();
        await chooseMode(option.getAttribute('data-mode') || '');
        modeSelect?.focus();
      });
    }
    if (mobileConversationMenuButton) {
      mobileConversationMenuButton.addEventListener('click', (event) => {
        event.stopPropagation();
        if (mobileConversationMenuButton.disabled) return;
        toggleMobileConversationMenu();
      });
    }
    if (mobileConversationMenu) {
      mobileConversationMenu.addEventListener('click', (event) => event.stopPropagation());
    }
    if (mobileRenameConversation) {
      mobileRenameConversation.addEventListener('click', renameActiveConversation);
    }
    if (mobileDeleteConversation) {
      mobileDeleteConversation.addEventListener('click', deleteActiveConversation);
    }

    /* Source picker and conversation menu close on outside click / Escape.
       Account menu close is owned by AccountMenu's internal listener. */
    document.addEventListener('click', (event) => {
      const target = event.target instanceof Element ? event.target : event.target?.parentElement;
      if (!target || !sourceControls.contains?.(target)) sourceControls.close();
      if (!target || !target.closest('.rail-newchat-mode')) closeModeMenu();
      toggleMobileConversationMenu(false);
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        sourceControls.close();
        closeModeMenu();
        accountMenuOpenSignal.value = false;
        accountNameStatusSignal.value = '';
        toggleMobileConversationMenu(false);
        setMobileRailOpen(false);
      }
    });
    window.addEventListener('focus', () => {
      actions.refreshAccountProfile();
    });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) actions.refreshAccountProfile();
    });
    window.addEventListener('storage', (event) => {
      // null key means storage was cleared wholesale.
      if (event.key !== null && event.key !== session.storageKey) return;
      const hasToken = Boolean(actions.token());
      const chatVisible = signedInSignal.value;
      if (!hasToken && chatVisible) {
        actions.stopActiveAnswer();
        clearToken({ message: 'You signed out of Thingy in another tab.' });
        trackTinylyticsEvent('librarian.session_synced_signout');
      } else if (hasToken && !chatVisible) {
        window.location.reload();
      }
    });

    /* Recents list interactions, wired into the Preact island. */
    async function handleRecentOpen(id) {
      if (interactionBusy()) return;
      toggleMobileConversationMenu(false);
      await loadConversationIntoChat(id);
      setMobileRailOpen(false);
    }

    async function handleRecentDelete(id) {
      if (interactionBusy()) return;
      if (!id) return;
      if (!window.confirm('Delete this conversation?')) return;
      const wasLocal = actions.isLocalConversationId(id);
      const result = await actions.deleteConversation(id);
      if (!result.ok) return;
      if (result.wasActive) {
        if (wasLocal) {
          startBlankConversationView();
        } else {
          clearConversation();
        }
      } else {
        updateMobileConversationTitle();
      }
      trackTinylyticsEvent('librarian.conversation_delete');
    }

    mountRailRecents(document.getElementById('rail-recents-mount'), {
      maxRecents,
      onOpen: handleRecentOpen,
      onDelete: handleRecentDelete
    });

    /* Conversation bootstrap. */
    resetMessages();
    const storedProfile = actions.userProfile();
    state.preferredName = String(storedProfile.preferred_name || '').trim();
    state.availableModes = normalizeModes(storedProfile.modes || []);
    if (!state.availableModes.length) state.availableModes = [{ id: 'thingy', label: 'Thingy' }];
    if (!state.availableModes.some((mode) => mode.id === state.activeMode)) state.activeMode = 'thingy';
    actions.refreshAccountIdentity();
    updateMobileConversationTitle();

    if (loginToken) {
      window.location.href = session.signInUrl();
      trackTinylyticsEvent('librarian.auth_magic_link_start');
    } else if (initialEmailFromUrl) {
      window.location.href = session.signInUrl();
      trackTinylyticsEvent('librarian.auth_auto_start');
    } else if (actions.token()) {
      if (actions.tokenExpired()) {
        actions.redirectToSignIn();
        trackTinylyticsEvent('librarian.session_expired_startup');
      } else {
        signedInSignal.value = true;
        scheduleComposerReserveUpdate();
        actions.refreshAccountProfile({ force: true });
        const savedActiveId = actions.savedActiveConversation();
        actions.refreshConversations().then((list) => {
          if (hasInitialPrompt) {
            startBlankConversationView();
            maybeSubmitInitialPrompt();
            return;
          }
          const active = savedActiveId && list.some((entry) => entry.id === savedActiveId) ? savedActiveId : '';
          if (active) {
            loadConversationIntoChat(active);
          } else {
            startAgentWelcome();
          }
        });
        trackTinylyticsEvent('librarian.session_resume');
      }
    } else {
      window.location.href = session.signInUrl();
    }
}

export { bootChat };
