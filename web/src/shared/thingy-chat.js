import * as session from './thingy-session.js';
import {
  createAccountMenu,
  extractPreferredNameFromMessage,
  hasSupportingAccess as profileHasSupportingAccess,
  normalizePreferredName,
  renderAccountIdentity
} from './thingy-account.js';
import { createTinylyticsTracker } from './thingy-analytics.js';
import { createComposer } from './thingy-composer.js';
import { applyReturnChip } from './thingy-from.js';
import { postJsonRequest } from './thingy-http.js';
import {
  modeClass,
  modeGlyph,
  normalizeModeId,
  normalizeModes
} from './thingy-modes.js';
import {
  escapeHtml as escapeMarkup,
} from './thingy-markdown.js';
import {
  activityStepsFromToolNames,
  renderAssistantResponse,
  renderCuriosityMap
} from './thingy-chat-rendering.js';
import { createAssistantStreamRenderer } from './thingy-chat-stream-renderer.js';
import { createRailController } from './thingy-rail.js';
import { createRailRecentItem } from './thingy-rail-recents.js';
import { normalizeScopeParam } from './thingy-scope.js';
import { createSourcePicker } from './thingy-source-picker.js';
import { postJsonStream, read as readStream } from './thingy-stream.js';
import {
  createDictationController,
  speechInputSupported as browserSpeechInputSupported
} from './thingy-voice.js';
import { createChatMessageActions } from './thingy-chat-actions.js';
import {
  librarianApiUrl,
  librarianStreamUrl,
  tinylyticsId
} from './thingy-config.js';
import {
  conversationTitle,
  createLocalConversation,
  dedupeEmptyConversationDrafts as dedupeConversationDrafts,
  isEmptyConversationDraft as isEmptyConversationDraftEntry,
  isLocalConversationId as isLocalConversationIdValue
} from './thingy-conversations.js';
import { userLocalContext } from './thingy-local-context.js';
import {
  isAuthError,
  scrubUrlParams,
  signInReturnUrl
} from './thingy-url.js';
import { updateChatComposerState } from './thingy-chat-composer-state.js';
import { handleAuthResponse as handleAuthResponseStatus } from './thingy-auth-response.js';

(() => {
    applyReturnChip();
    const apiBase = librarianApiUrl();
    const streamBase = librarianStreamUrl();
    const authPanel = document.getElementById('librarian-auth');
    const chatPanel = document.getElementById('librarian-chat');
    const appShell = document.getElementById('thingy-app-shell');
    const authForm = document.getElementById('librarian-auth-form');
    const questionForm = document.getElementById('librarian-question-form');
    const emailInput = document.getElementById('librarian-email');
    const emailError = document.getElementById('librarian-email-error');
    const authButton = document.getElementById('librarian-auth-submit');
    const authMessage = document.getElementById('librarian-auth-message');
    const authActions = document.getElementById('librarian-auth-actions');
    const addSubscriberButton = document.getElementById('librarian-add-subscriber');
    const resendConfirmationButton = document.getElementById('librarian-resend-confirmation');
    const logoutButton = document.getElementById('librarian-logout');
    const clearChatButton = document.getElementById('librarian-clear-chat');
    const curiosityMapButton = document.getElementById('thingy-curiosity-map');
    const modeControl = document.getElementById('thingy-mode-control');
    const modeSelect = document.getElementById('thingy-mode-select');
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
    const rail = document.querySelector('.rail');
    const prompts = document.getElementById('librarian-prompts');
    const activeConvKey = 'thingyActiveConversation';
    const localConversationPrefix = 'local-chat-';
    const mobileConversationTitle = document.getElementById('mobile-conversation-title');
    const mobileConversationsToggle = document.getElementById('mobile-conversations-toggle');
    const mobileNewChatButton = document.getElementById('mobile-new-chat');
    const mobileConversationMenuButton = document.getElementById('mobile-conversation-menu-button');
    const mobileConversationMenu = document.getElementById('mobile-conversation-menu');
    const mobileRenameConversation = document.getElementById('mobile-rename-conversation');
    const mobileDeleteConversation = document.getElementById('mobile-delete-conversation');
    const railScrim = document.getElementById('rail-scrim');
    const railControls = createRailController({
      shell: appShell,
      mobileToggle: mobileConversationsToggle,
      scrim: railScrim,
      collapseButton: document.getElementById('rail-collapse'),
      collapsedKey: 'thingyRailCollapsed',
      showLabel: 'Show conversations',
      hideLabel: 'Hide conversations'
    });
    const maxRecents = 20;
    let activeConversationId = null;
    let conversations = [];
    let preferredName = '';
    let awaitingName = false;
    let activeMode = 'thingy';
    let availableModes = [{ id: 'thingy', label: 'Thingy' }];
    const maxQuestionChars = Number(questionInput.getAttribute('maxlength') || '1200');
    const analytics = createTinylyticsTracker({ enabled: Boolean(tinylyticsId()) });
    let answerInFlight = false;
    let autoFollowChat = true;
    let scrollFrame = 0;
    let composerReserveFrame = 0;
    let composerControls = null;
    let welcomeInFlight = false;
    let welcomeShownThisVisit = false;
    let welcomeAbortController = null;
    let mapInFlight = false;
    let conversationCreateInFlight = false;
    let dictationControls = null;
    let authRequestGeneration = 0;
    const emailRe = /^[a-zA-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

    const params = new URLSearchParams(window.location.search);
    const email = normalizeEmail(params.get('email'));
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
    if (email) emailInput.value = email;

    function resetMessages() {
      messages.innerHTML = '';
    }

    function normalizeEmail(value) {
      return session.normalizeEmail(value);
    }

    function normalizeInitialPrompt(value) {
      return String(value || '').trim().slice(0, maxQuestionChars);
    }

    function validateEmail() {
      const value = emailInput.value.trim();
      if (!value) {
        emailError.textContent = '';
        emailInput.classList.remove('invalid');
        authButton.disabled = false;
        return true;
      }
      if (emailRe.test(value)) {
        emailError.textContent = '';
        emailInput.classList.remove('invalid');
        authButton.disabled = false;
        return true;
      }
      emailError.textContent = 'Please enter a valid email address';
      emailInput.classList.add('invalid');
      authButton.disabled = true;
      return false;
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
      const entered = emailInput && emailInput.value ? emailInput.value.trim() : '';
      return normalizeEmail(entered || stored);
    }

    function setUserProfile(data) {
      const profile = session.mergeProfile(data || {}, storedEmail());
      const modes = normalizeModes(profile.modes || data?.modes || data?.profile?.modes || []);
      availableModes = modes.length ? modes : [{ id: 'thingy', label: 'Thingy' }];
      if (!availableModes.some((mode) => mode.id === activeMode)) activeMode = 'thingy';
      preferredName = String(profile.preferred_name || '').trim();
      session.updateStoredProfile({ ...profile, modes: availableModes });
      renderModeControl();
      return profile;
    }

    function userProfile() {
      return session.storedProfile();
    }

    function hasSupportingAccess() {
      return profileHasSupportingAccess(userProfile());
    }

    function modeLabel(id = activeMode) {
      return availableModes.find((mode) => mode.id === id)?.label || 'Thingy';
    }

    function currentConversationMode() {
      return activeConversation()?.mode || activeMode || 'thingy';
    }

    function isLocalConversationId(id) {
      return isLocalConversationIdValue(id, localConversationPrefix);
    }

    function newConversationTitle(mode = activeMode) {
      return conversationTitle(mode, modeLabel);
    }

    function renderModeBanner() {
      if (!modeBanner) return;
      const mode = currentConversationMode();
      const show = token() && mode && mode !== 'thingy';
      modeBanner.hidden = !show;
      if (!show) {
        modeBanner.innerHTML = '';
        modeBanner.removeAttribute('data-mode');
        modeBanner.removeAttribute('aria-label');
        return;
      }
      const label = modeLabel(mode);
      modeBanner.dataset.mode = modeClass(mode);
      modeBanner.setAttribute('aria-label', `${label} mode`);
      modeBanner.innerHTML = `<span class="thingy-mode-banner-kicker">Mode</span><strong>${escapeHtml(label)}</strong>`;
    }

    function renderModeControl() {
      if (!modeControl || !modeSelect) return;
      const show = token() && availableModes.length > 1;
      modeControl.hidden = !show;
      modeSelect.innerHTML = availableModes.map((mode) => `<option value="${escapeHtml(mode.id)}">${escapeHtml(`${modeGlyph(mode.id)} ${mode.label}`)}</option>`).join('');
      modeSelect.value = availableModes.some((mode) => mode.id === activeMode) ? activeMode : 'thingy';
      renderModeBanner();
    }

    function rememberPreferredName(name) {
      const cleanName = String(name || '').trim();
      if (!cleanName) return;
      preferredName = cleanName;
      session.updateStoredProfile({ preferred_name: cleanName });
      const accountNameInput = document.getElementById('account-name-input');
      if (accountNameInput) accountNameInput.value = cleanName;
    }

    function readerProfileContext() {
      return {
        ...userProfile(),
        preferred_name: preferredName,
        awaiting_name: awaitingName
      };
    }

    function currentScope() {
      return sourceControls.currentScope();
    }

    function sourceCount() {
      return sourceControls.sourceCount();
    }

    function speechInputSupported() {
      return browserSpeechInputSupported() || false;
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

    function setAuthShellMode(isAuth) {
      if (!appShell) return;
      appShell.classList.remove('is-booting');
      appShell.classList.toggle('is-auth', Boolean(isAuth));
      if (isAuth) setMobileRailOpen(false);
    }

    function persistToken(value, data = {}) {
      session.persistAuth({ ...data, token: value }, data.email || storedEmail());
      setUserProfile(data);
      if (data.email && emailInput) emailInput.value = normalizeEmail(data.email);
      refreshAccountIdentity();
    }

    async function refreshStoredAuth() {
      if (!token() || tokenExpired()) return false;
      try {
        const data = await postJson('/auth', { action: 'refresh_session' }, authHeaders());
        if (!data.token) return false;
        persistToken(data.token, data);
        refreshAccountIdentity();
        trackTinylyticsEvent('librarian.auth_refresh_success');
        return true;
      } catch (error) {
        trackTinylyticsEvent('librarian.auth_refresh_error');
        return false;
      }
    }

    async function ensureFreshToken() {
      if (!token()) return false;
      if (!tokenExpired() && !tokenNeedsRefresh()) return true;
      if (tokenNeedsRefresh()) return await refreshStoredAuth();
      const emailValue = storedEmail();
      clearToken({
        message: "Your Thingy session expired. Enter your email and I'll send a fresh sign-in link.",
        preserveEmail: Boolean(emailValue)
      });
      trackTinylyticsEvent('librarian.session_expired');
      return false;
    }

    function setToken(value, data = {}) {
      persistToken(value, data);
      setAuthShellMode(false);
      authPanel.hidden = true;
      chatPanel.hidden = false;
      hideAuthActions();
      resetMessages();
      refreshConversations().then(() => {
        if (hasInitialPrompt) {
          setActiveConversation('');
          maybeSubmitInitialPrompt();
          return;
        }
        if (!activeConversationId) startAgentWelcome();
      });
      scheduleComposerReserveUpdate();
      questionInput.focus();
    }

    function clearToken(options = {}) {
      const config = typeof options === 'string' ? { message: options } : (options || {});
      authRequestGeneration += 1;
      const message = String(config.message || '').trim();
      const existingMessage = authMessage ? authMessage.textContent : '';
      const emailValue = storedEmail();
      session.clearAuth();
      if (config.preserveEmail && emailValue) {
        if (emailInput) emailInput.value = emailValue;
      }
      if (config.scrubAuthParams) scrubUrlParams(['login_token', 'magic_token', 'email']);
      conversations = [];
      availableModes = [{ id: 'thingy', label: 'Thingy' }];
      activeMode = 'thingy';
      setActiveConversation('');
      welcomeShownThisVisit = false;
      chatPanel.hidden = true;
      authPanel.hidden = false;
      setAuthShellMode(true);
      prompts.hidden = true;
      prompts.innerHTML = '';
      hideAuthActions();
      setAuthMessage(message || existingMessage || '');
      refreshAccountIdentity();
      renderModeControl();
      renderRecents();
      emailInput.focus();
    }

    function refreshAccountIdentity() {
      const accountEmailEl = document.getElementById('account-email');
      const accountAvatarEl = document.getElementById('account-avatar');
      const accountSubEl = document.getElementById('account-sub');
      const accountBtnEl = document.getElementById('account-btn');
      const accountCaretEl = document.querySelector('.rail-account-caret');
      const accountNameInputEl = document.getElementById('account-name-input');
      const stored = session.storedEmail();
      const value = (emailInput && emailInput.value ? emailInput.value.trim() : '') || stored;
      const signedIn = Boolean(token());
      renderAccountIdentity({
        signedIn,
        email: value,
        profile: userProfile(),
        preferredName,
        elements: {
          email: accountEmailEl,
          avatar: accountAvatarEl,
          sub: accountSubEl,
          button: accountBtnEl,
          caret: accountCaretEl,
          nameInput: accountNameInputEl
        }
      });
      renderModeControl();
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
      chatPanel.style.setProperty('--composer-reserve', `${height}px`);
    }

    function scheduleComposerReserveUpdate() {
      if (composerReserveFrame) return;
      composerReserveFrame = window.requestAnimationFrame(updateComposerReserve);
    }

    if (composerZone && 'ResizeObserver' in window) {
      const composerObserver = new ResizeObserver(updateComposerReserve);
      composerObserver.observe(composerZone);
    }
    window.addEventListener('resize', () => {
      updateComposerReserve();
    });

    function interactionBusy() {
      return answerInFlight || mapInFlight || conversationCreateInFlight;
    }

    function cancelWelcomeSetup() {
      if (!welcomeInFlight) return;
      welcomeInFlight = false;
      if (welcomeAbortController) welcomeAbortController.abort();
      welcomeAbortController = null;
      document.querySelectorAll('.librarian-message-pending').forEach((message) => {
        if (/Thingy is getting oriented/i.test(message.textContent || '')) message.remove();
      });
      updateQuestionState();
    }

    function updateQuestionState() {
      updateChatComposerState({
        input: questionInput,
        count: questionCount,
        maxChars: maxQuestionChars,
        hasSources: sourceCount() > 0,
        busy: interactionBusy(),
        signedIn: Boolean(token()),
        sourceError,
        form: questionForm,
        submitButton: questionButton,
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

    function setAuthMessage(message) {
      authMessage.textContent = message || '';
    }

    function hideAuthActions() {
      authActions.hidden = true;
      addSubscriberButton.hidden = true;
      resendConfirmationButton.hidden = true;
    }

    function showAuthAction(action) {
      authActions.hidden = false;
      addSubscriberButton.hidden = action !== 'subscribe';
      resendConfirmationButton.hidden = action !== 'resend_confirmation';
    }

    function trackTinylyticsEvent(name, value) {
      analytics.track(name, value);
    }

    function escapeHtml(value) {
      return escapeMarkup(value);
    }

    async function postJson(path, payload, headers = {}) {
      return session.postJson(path, payload, headers);
    }

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

    function authHeaders() {
      return session.authHeaders();
    }

    const {
      addPromptActions,
      addResponseActions,
      stopSpeaking
    } = createChatMessageActions({
      submitFeedback: ({ requestId, reaction, comment }) => postStreamJson('/feedback', {
        request_id: requestId,
        reaction,
        comment
      }, { authorization: `Bearer ${token()}` }),
      track: trackTinylyticsEvent
    });

    async function conversationAction(payload) {
      return postJson('/conversations', payload, authHeaders());
    }

    function setActiveConversation(id) {
      activeConversationId = String(id || '').trim() || null;
      try {
        if (activeConversationId) {
          window.localStorage.setItem(activeConvKey, activeConversationId);
        } else {
          window.localStorage.removeItem(activeConvKey);
        }
      } catch (error) { /* ignore */ }
      renderRecents();
      updateMobileConversationTitle();
      renderModeBanner();
      return activeConversationId;
    }

    function resetConversationView() {
      questionInput.value = '';
      resetMessages();
      updateQuestionState();
    }

    function savedActiveConversation() {
      try {
        return window.localStorage.getItem(activeConvKey) || '';
      } catch (error) {
        return '';
      }
    }

    function startBlankConversationView() {
      setActiveConversation('');
      resetConversationView();
    }

    function isEmptyConversationDraft(entry, mode = '') {
      return isEmptyConversationDraftEntry(entry, mode, modeLabel);
    }

    function dedupeEmptyConversationDrafts(list = [], options = {}) {
      return dedupeConversationDrafts(list, {
        activeConversationId: options.activeConversationId || activeConversationId,
        labelForMode: modeLabel
      });
    }

    function createLocalConversationShell(mode = activeMode) {
      const normalized = normalizeModeId(mode);
      const existing = activeConversation();
      if (existing?.id && isLocalConversationId(existing.id)) {
        existing.mode = normalized;
        existing.title = existing.title || newConversationTitle(normalized);
        existing.updated_at = new Date().toISOString();
        setActiveConversation(existing.id);
        return existing;
      }
      const shell = createLocalConversation({
        mode: normalized,
        scope: currentScope(),
        prefix: localConversationPrefix,
        labelForMode: modeLabel
      });
      conversations = conversations.filter((entry) => !isEmptyConversationDraft(entry, normalized));
      conversations.unshift(shell);
      conversations = dedupeEmptyConversationDrafts(conversations, { activeConversationId: shell.id }).slice(0, maxRecents);
      setActiveConversation(shell.id);
      return shell;
    }

    function startNewConversationView(mode = activeMode) {
      activeMode = normalizeModeId(mode);
      const shell = createLocalConversationShell(activeMode);
      resetConversationView();
      return shell;
    }

    function activeConversation() {
      if (!activeConversationId) return null;
      return conversations.find((entry) => entry.id === activeConversationId || entry.conversation_id === activeConversationId) || null;
    }

    function currentConversationTitle() {
      if (!activeConversationId) return 'New chat';
      const active = activeConversation();
      return active?.title || 'Current chat';
    }

    function toggleMobileConversationMenu(force) {
      if (!mobileConversationMenu || !mobileConversationMenuButton) return;
      const open = force === undefined ? mobileConversationMenu.hasAttribute('hidden') : force;
      mobileConversationMenu.toggleAttribute('hidden', !open);
      mobileConversationMenuButton.setAttribute('aria-expanded', open ? 'true' : 'false');
    }

    function updateMobileConversationTitle() {
      if (mobileConversationTitle) mobileConversationTitle.textContent = currentConversationTitle();
      const hasActive = Boolean(activeConversationId && activeConversation());
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
      const active = activeConversation();
      if (!active || interactionBusy()) return;
      toggleMobileConversationMenu(false);
      const current = active.title || 'Untitled chat';
      const title = window.prompt('Rename conversation', current);
      if (title == null) return;
      const trimmed = title.trim();
      if (!trimmed || trimmed === current) return;
      if (isLocalConversationId(active.id)) {
        active.title = trimmed;
        active.updated_at = new Date().toISOString();
        renderRecents();
        updateMobileConversationTitle();
        return;
      }
      try {
        const data = await conversationAction({ action: 'rename', conversation_id: active.id, title: trimmed });
        if (data.conversation) upsertConversationSummary(data.conversation);
        trackTinylyticsEvent('librarian.conversation_rename');
      } catch (error) {
        trackTinylyticsEvent('librarian.conversations_error', 'rename');
      }
    }

    async function deleteActiveConversation() {
      const active = activeConversation();
      if (!active || interactionBusy()) return;
      toggleMobileConversationMenu(false);
      if (!window.confirm('Delete this conversation?')) return;
      if (isLocalConversationId(active.id)) {
        conversations = conversations.filter((entry) => entry.id !== active.id);
        startBlankConversationView();
        setMobileRailOpen(false);
        return;
      }
      try {
        await conversationAction({ action: 'delete', conversation_id: active.id });
        conversations = conversations.filter((entry) => entry.id !== active.id);
        clearConversation();
        setMobileRailOpen(false);
        trackTinylyticsEvent('librarian.conversation_delete');
      } catch (error) {
        trackTinylyticsEvent('librarian.conversations_error', 'delete');
      }
    }

    function clearConversation() {
      if (interactionBusy()) return null;
      cancelWelcomeSetup();
      stopSpeaking();
      if (dictationControls?.isListening?.()) stopDictation();
      welcomeShownThisVisit = true;
      activeMode = normalizeModeId(modeSelect?.value || activeMode);
      const shell = startNewConversationView(activeMode);
      questionInput.focus();
      trackTinylyticsEvent('librarian.clear');
      return shell;
    }

    async function showCuriosityMap(center = '', options = {}) {
      if (!token() || interactionBusy()) return;
      if (!(await ensureFreshToken())) {
        clearToken();
        return;
      }
      const scope = currentScope();
      if (!scope) {
        updateQuestionState();
        return;
      }
      const attachToCurrent = Boolean(options.attachToCurrent && activeConversationId && !isLocalConversationId(activeConversationId));
      const existingConversationId = attachToCurrent ? activeConversationId : '';
      if (!attachToCurrent) welcomeShownThisVisit = true;
      hidePrompts();
      if (window.matchMedia('(max-width: 640px)').matches) setMobileRailOpen(false);
      stopSpeaking();
      if (!attachToCurrent) {
        setActiveConversation('');
        messages.innerHTML = '';
      }
      questionInput.value = '';
      mapInFlight = true;
      updateQuestionState();
      autoFollowChat = true;
      const pending = addMessage('assistant', '<p class="librarian-status-line"><span class="librarian-thinking-dot"></span>Thingy is drawing connections...</p>');
      pending.classList.add('librarian-message-pending');
      try {
        const map = await postStreamJson('/curiosity-map', {
          scope,
          mode: currentConversationMode(),
          center,
          conversation_id: existingConversationId || undefined,
          user_profile: readerProfileContext()
        }, authHeaders());
        pending.classList.remove('librarian-message-pending');
        if (map.conversation_id) {
          setActiveConversation(map.conversation_id);
        }
        if (map.conversation) upsertConversationSummary(map.conversation);
        pending.innerHTML = renderCuriosityMap(map) || '<p>Thingy could not find enough connected threads to draw a map yet.</p>';
        scheduleChatScroll({ force: true });
        await refreshConversations();
        trackTinylyticsEvent('librarian.curiosity_map_success', `${(map.nodes || []).length}.${(map.sources || []).length}`);
      } catch (error) {
        pending.innerHTML = `<p>${escapeHtml(error.message)}</p>`;
        trackTinylyticsEvent('librarian.curiosity_map_error', error.requestId ? 'server' : 'client');
        if (isAuthError(error)) clearToken();
      } finally {
        mapInFlight = false;
        updateQuestionState();
      }
    }

    function upsertConversationSummary(conversation, options = {}) {
      if (!conversation || !(conversation.id || conversation.conversation_id)) return;
      const id = conversation.id || conversation.conversation_id;
      const replaceId = String(options.replaceId || '').trim();
      conversations = conversations.filter((entry) => {
        const entryId = entry.id || entry.conversation_id;
        return entryId !== id && (!replaceId || entryId !== replaceId);
      });
      conversations.unshift({ ...conversation, id, conversation_id: id, local: false });
      conversations.sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
      conversations = dedupeEmptyConversationDrafts(conversations).slice(0, maxRecents);
      if (replaceId && activeConversationId === replaceId) {
        activeConversationId = id;
        try { window.localStorage.setItem(activeConvKey, id); } catch (error) { /* ignore */ }
      }
      renderRecents();
      updateMobileConversationTitle();
      renderModeBanner();
    }

    function upsertPendingConversation({ conversationId, title, scope, mode }) {
      const id = String(conversationId || '').trim();
      if (!id) return;
      const replaceId = isLocalConversationId(activeConversationId) ? activeConversationId : '';
      const now = new Date().toISOString();
      const existing = conversations.find((entry) => entry.id === id || entry.conversation_id === id);
      if (!replaceId && existing) {
        upsertConversationSummary({
          ...existing,
          id,
          conversation_id: id,
          title: existing.title || title || 'New chat',
          scope: existing.scope || scope || currentScope(),
          mode: normalizeModeId(existing.mode || mode || currentConversationMode()),
          updated_at: now,
          last_message_at: now
        });
        return;
      }
      upsertConversationSummary({
        id,
        conversation_id: id,
        title: title || 'New chat',
        preview: title || '',
        scope: scope || currentScope(),
        mode: normalizeModeId(mode || currentConversationMode()),
        created_at: now,
        updated_at: now,
        last_message_at: now,
        turn_count: 0
      }, { replaceId });
    }

    async function createConversationShellForMode(mode, options = {}) {
      const normalized = normalizeModeId(mode);
      if (!token() || normalized === 'thingy') return activeConversation();
      if (!availableModes.some((entry) => entry.id === normalized)) return null;
      if (!(await ensureFreshToken())) {
        clearToken();
        return null;
      }
      const replaceId = String(options.replaceId || activeConversationId || '').trim();
      conversationCreateInFlight = true;
      updateQuestionState();
      try {
        const data = await conversationAction({
          action: 'create',
          mode: normalized,
          title: newConversationTitle(normalized),
          scope: currentScope()
        });
        if (data.conversation) {
          upsertConversationSummary(data.conversation, {
            replaceId: isLocalConversationId(replaceId) ? replaceId : ''
          });
          setActiveConversation(data.conversation.id || data.conversation.conversation_id);
          return data.conversation;
        }
      } catch (error) {
        trackTinylyticsEvent('librarian.conversations_error', 'create');
        if (isAuthError(error)) clearToken();
      } finally {
        conversationCreateInFlight = false;
        updateQuestionState();
      }
      return null;
    }

    async function refreshConversations(options = {}) {
      if (!token()) {
        conversations = [];
        renderRecents();
        return [];
      }
      if (!(await ensureFreshToken())) {
        clearToken();
        return [];
      }
      try {
        const data = await conversationAction({ action: 'list', limit: maxRecents });
        if (data.modes || data.entitlements) setUserProfile(data);
        const clientActiveShells = conversations.filter((entry) => {
          if (!entry?.id) return false;
          return isLocalConversationId(entry.id) || entry.id === activeConversationId;
        });
        const serverConversations = (data.conversations || []).map((entry) => ({
          ...entry,
          id: entry.id || entry.conversation_id,
          local: false
        })).filter((entry) => entry.id);
        const serverIds = new Set(serverConversations.map((entry) => entry.id));
        const keptClientShells = clientActiveShells.filter((entry) => entry.id === activeConversationId && !serverIds.has(entry.id));
        conversations = dedupeEmptyConversationDrafts(
          [...keptClientShells, ...serverConversations]
            .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')))
        ).slice(0, maxRecents);
        if (activeConversationId && !conversations.some((entry) => entry.id === activeConversationId)) {
          setActiveConversation('');
        }
        renderRecents();
        return conversations;
      } catch (error) {
        if (options.retryAuth !== false && isAuthError(error) && await refreshStoredAuth()) {
          return refreshConversations({ retryAuth: false });
        }
        trackTinylyticsEvent('librarian.conversations_error', 'list');
        if (isAuthError(error)) {
          clearToken();
          return [];
        }
        renderRecents();
        return conversations;
      }
    }

    function renderRecents() {
      const railRecents = document.getElementById('rail-recents');
      const railRecentsEmpty = document.getElementById('rail-recents-empty');
      if (!railRecents || !railRecentsEmpty) return;
      const list = conversations.filter((entry) => entry && entry.id).slice(0, maxRecents);
      if (!list.length) {
        railRecents.replaceChildren();
        railRecents.hidden = true;
        railRecentsEmpty.hidden = false;
        updateMobileConversationTitle();
        return;
      }
      railRecentsEmpty.hidden = true;
      railRecents.hidden = false;
      const rows = list.map((entry) => {
        const title = entry.title || 'Untitled chat';
        const id = String(entry.id || '');
        const mode = entry.mode && entry.mode !== 'thingy' ? modeClass(entry.mode) : '';
        const modeLabelText = mode ? modeLabel(entry.mode) : '';
        const modeTitle = mode ? `${title} - ${modeLabelText}` : title;
        return createRailRecentItem({
          id,
          label: title,
          title: modeTitle,
          active: entry.id === activeConversationId,
          dataMode: mode,
          hasMeta: Boolean(mode),
          metaTag: 'small',
          metaClass: 'rail-recent-mode',
          metaLabel: modeLabelText,
          metaText: mode ? modeGlyph(entry.mode) : '',
          deleteAction: 'delete-conv',
          deleteLabel: 'Delete conversation'
        });
      });
      railRecents.replaceChildren(...rows);
      updateMobileConversationTitle();
    }

    async function loadConversationIntoChat(id) {
      if (interactionBusy()) return;
      const conversationId = String(id || '').trim();
      if (!conversationId) return;
      cancelWelcomeSetup();
      if (isLocalConversationId(conversationId)) {
        setActiveConversation(conversationId);
        resetConversationView();
        hidePrompts();
        questionInput.focus();
        return;
      }
      try {
        const data = await conversationAction({ action: 'get', conversation_id: conversationId });
        setActiveConversation(conversationId);
        if (data.conversation) upsertConversationSummary(data.conversation);
        if (data.conversation?.mode) {
          activeMode = data.conversation.mode;
          renderModeControl();
        }
        messages.innerHTML = '';
        hidePrompts();
        const scopeFallback = currentScope();
        for (const msg of data.messages || []) {
          if (msg.role === 'user') {
            const el = addMessage('user', `<p>${escapeHtml(msg.content || '')}</p>`);
            addPromptActions(el, msg.content || '', msg.scope || scopeFallback);
          } else if (msg.role === 'assistant') {
            const artifactHtml = msg.artifact?.kind === 'curiosity_map' ? renderCuriosityMap(msg.artifact) : '';
            const activitySteps = activityStepsFromToolNames(msg.tool_names || msg.toolNames || []);
            const el = addMessage('assistant', artifactHtml || renderAssistantResponse(msg.content || '', msg.citations || [], null, activitySteps, []));
            if (!artifactHtml && (msg.request_id || msg.requestId)) addResponseActions(el, msg.request_id || msg.requestId);
          }
        }
        questionInput.value = '';
        updateQuestionState();
        renderRecents();
        updateMobileConversationTitle();
        scheduleComposerReserveUpdate();
        scrollChatToBottom({ force: true });
        questionInput.focus();
      } catch (error) {
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
      if (!initialPrompt || initialPromptSubmitted || interactionBusy() || !token()) return;
      initialPromptSubmitted = true;
      hidePrompts();
      questionInput.value = initialPrompt;
      updateQuestionState();
      questionForm.requestSubmit();
    }

    function handleAuthResponse(data, options = {}) {
      return handleAuthResponseStatus(data, {
        hideActions: hideAuthActions,
        onToken: (authData) => setToken(authData.token, authData, options),
        setMessage: setAuthMessage,
        showAction: showAuthAction,
        track: trackTinylyticsEvent
      });
    }

    async function submitAuthAction(action, button) {
      if (!validateEmail()) return;
      const generation = authRequestGeneration;
      button.disabled = true;
      hideAuthActions();
      setAuthMessage(action === 'subscribe' ? 'Adding you to the Weekly Thing...' : 'Sending the confirmation email...');
      try {
        const payload = { email: emailInput.value, action, source: 'thingy' };
        const data = await postJson('/auth', payload);
        if (generation !== authRequestGeneration) return;
        handleAuthResponse(data);
      } catch (error) {
        if (generation !== authRequestGeneration) return;
        setAuthMessage(error.message);
        trackTinylyticsEvent('librarian.auth_error', error.requestId ? 'server' : 'client');
      } finally {
        button.disabled = false;
      }
    }

    async function submitAuthCheck(options = {}) {
      if (!validateEmail()) return false;
      const generation = authRequestGeneration;
      authButton.disabled = true;
      hideAuthActions();
      setAuthMessage('Sending a sign-in link...');
      try {
        const data = await postJson('/auth', { email: emailInput.value.trim(), action: 'check', source: 'thingy' });
        if (generation !== authRequestGeneration) return false;
        handleAuthResponse(data, options);
        if (options.scrubEmailParam) scrubUrlParams(['email']);
        return true;
      } catch (error) {
        if (generation !== authRequestGeneration) return false;
        setAuthMessage(error.message);
        trackTinylyticsEvent('librarian.auth_error', error.requestId ? 'server' : 'client');
        return false;
      } finally {
        authButton.disabled = false;
        validateEmail();
      }
    }

    async function completeMagicLogin(value) {
      const clean = String(value || '').trim();
      if (!clean) return false;
      const generation = authRequestGeneration;
      authButton.disabled = true;
      hideAuthActions();
      setAuthMessage('Signing you in...');
      try {
        const data = await postJson('/auth', { action: 'complete_magic_link', login_token: clean, source: 'thingy' });
        if (generation !== authRequestGeneration) return false;
        handleAuthResponse(data);
        scrubUrlParams(['login_token', 'magic_token']);
        trackTinylyticsEvent('librarian.auth_magic_link_success');
        return Boolean(data.token);
      } catch (error) {
        if (generation !== authRequestGeneration) return false;
        scrubUrlParams(['login_token', 'magic_token']);
        setAuthMessage(error.message || 'That sign-in link is invalid or expired. Enter your email to get a fresh link.');
        trackTinylyticsEvent('librarian.auth_magic_link_error', error.requestId ? 'server' : 'client');
        return false;
      } finally {
        authButton.disabled = false;
        validateEmail();
      }
    }

    async function postStreamingChat(message, pending, scope) {
      if (!streamBase) {
        throw new Error('Thingy has not been connected to the archive stream API yet.');
      }

      let requestId = '';
      let conversationId = isLocalConversationId(activeConversationId) ? '' : (activeConversationId || '');
      let conversation = null;
      const response = await postJsonStream({
        baseUrl: streamBase,
        path: '/chat',
        timeoutMs: 190000,
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

      const renderer = createAssistantStreamRenderer({ pending, scroll: scheduleChatScroll });

      function applyEvent(eventName, data) {
        if (eventName === 'meta') {
          requestId = data.request_id || requestId;
          if (data.mode) {
            activeMode = data.mode;
            renderModeControl();
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
          renderer.status(data, 'Thingy is working...');
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
            activeMode = data.mode;
            renderModeControl();
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

      await readStream(response, applyEvent);
      return { ...renderer.finish(), request_id: requestId, conversation_id: conversationId, conversation };
    }

    async function postStreamingWelcome(pending, scope, options = {}) {
      if (!streamBase) {
        throw new Error('Thingy has not been connected to the archive stream API yet.');
      }

      let requestId = '';
      const response = await postJsonStream({
        baseUrl: streamBase,
        path: '/welcome',
        controller: options.controller,
        timeoutMs: 45000,
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
        pending,
        scroll: scheduleChatScroll,
        label: 'Session Setup',
        statusFallback: 'Thingy is getting oriented...'
      });

      function applyEvent(eventName, data) {
        if (eventName === 'meta') {
          requestId = data.request_id || requestId;
          if (data.mode) {
            activeMode = data.mode;
            renderModeControl();
          }
        } else if (eventName === 'status') {
          renderer.status(data, 'Thingy is getting oriented...');
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
            activeMode = data.mode;
            renderModeControl();
          }
        } else if (eventName === 'error') {
          const error = new Error(data.error || 'Thingy is unavailable.');
          error.requestId = data.request_id || requestId;
          throw error;
        }
      }

      await readStream(response, applyEvent);
      const { answer, experience } = renderer.finish();
      return { answer, experience, request_id: requestId };
    }

    async function startAgentWelcome() {
      if (!token() || interactionBusy() || welcomeInFlight || welcomeShownThisVisit || hasInitialPrompt) return;
      if (!(await ensureFreshToken())) {
        clearToken();
        return;
      }
      hidePrompts();
      awaitingName = !preferredName;
      welcomeShownThisVisit = true;
      welcomeInFlight = true;
      welcomeAbortController = new AbortController();
      updateQuestionState();
      const pending = addMessage('assistant', '<p class="librarian-status-line"><span class="librarian-thinking-dot"></span>Thingy is getting oriented...</p>');
      pending.classList.add('librarian-message-pending');
      try {
        await postStreamingWelcome(pending, currentScope(), { controller: welcomeAbortController });
        trackTinylyticsEvent('librarian.welcome_success');
      } catch (error) {
        if (!welcomeInFlight || !pending.isConnected) return;
        pending.innerHTML = '<p>Hi. I&rsquo;m Thingy. Ask me what you&rsquo;re curious about and I&rsquo;ll help you explore the archive.</p>';
        trackTinylyticsEvent('librarian.welcome_error', error.requestId ? 'server' : 'client');
      } finally {
        if (pending.isConnected) {
          welcomeInFlight = false;
          welcomeAbortController = null;
          updateQuestionState();
        }
      }
    }

    authForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      await submitAuthCheck();
    });

    emailInput.addEventListener('input', () => {
      validateEmail();
      hideAuthActions();
    });

    addSubscriberButton.addEventListener('click', () => {
      submitAuthAction('subscribe', addSubscriberButton);
    });

    resendConfirmationButton.addEventListener('click', () => {
      submitAuthAction('resend_confirmation', resendConfirmationButton);
    });
    clearChatButton.addEventListener('click', async () => {
      if (interactionBusy()) return;
      const shell = clearConversation();
      await createConversationShellForMode(activeMode, { replaceId: shell?.id });
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
      const scope = currentScope();
      if (!scope) {
        updateQuestionState();
        return;
      }
      if (!(await ensureFreshToken())) {
        clearToken();
        return;
      }
      if (dictationControls?.isListening?.()) stopDictation();
      stopSpeaking();
      answerInFlight = true;
      updateQuestionState();
      hidePrompts();
      const questionWordCount = message.split(/\s+/).filter(Boolean).length;
      const questionSize = questionWordCount < 6 ? 'short' : questionWordCount < 18 ? 'medium' : 'long';
      if (awaitingName && !preferredName) {
        const suppliedName = extractPreferredNameFromMessage(message);
        if (suppliedName) rememberPreferredName(suppliedName);
        awaitingName = false;
      }
      autoFollowChat = true;
      const userMessage = addMessage('user', `<p>${escapeHtml(message)}</p>`);
      addPromptActions(userMessage, message, scope);
      questionInput.value = '';
      updateQuestionState();
      const pending = addMessage('assistant', '<p class="librarian-status-line"><span class="librarian-thinking-dot"></span>Thingy is thinking...</p>');
      pending.classList.add('librarian-message-pending');
      try {
        const data = await postStreamingChat(message, pending, scope);
        pending.classList.remove('librarian-message-pending');
        addResponseActions(pending, data.request_id);
        if (data.conversation_id) {
          setActiveConversation(data.conversation_id);
        }
        if (data.conversation) upsertConversationSummary(data.conversation);
        await refreshConversations();
        trackTinylyticsEvent('librarian.answer_success', `${questionSize}.${(data.citations || []).length}`);
      } catch (error) {
        pending.innerHTML = `<p>${escapeHtml(error.message)}</p>`;
        trackTinylyticsEvent('librarian.answer_error', error.requestId ? 'server' : 'client');
        if (isAuthError(error)) {
          clearToken();
        }
      } finally {
        answerInFlight = false;
        updateQuestionState();
      }
    }

    composerControls = createComposer({
      form: questionForm,
      input: questionInput,
      count: questionCount,
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
      const button = target ? target.closest('button[data-experience-prompt], button[data-map-prompt]') : null;
      if (!button || interactionBusy()) return;
      questionInput.value = button.dataset.experiencePrompt || button.dataset.mapPrompt || '';
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

    /* ---- Rail actions ---- */
    if (mobileNewChatButton) {
      mobileNewChatButton.addEventListener('click', async (event) => {
        event.stopPropagation();
        if (interactionBusy()) return;
        toggleMobileConversationMenu(false);
        const shell = clearConversation();
        await createConversationShellForMode(activeMode, { replaceId: shell?.id });
        setMobileRailOpen(false);
      });
    }
    if (modeSelect) {
      modeSelect.addEventListener('change', async () => {
        if (interactionBusy()) {
          modeSelect.value = activeMode;
          return;
        }
        const nextMode = normalizeModeId(modeSelect.value);
        if (!availableModes.some((mode) => mode.id === nextMode)) {
          modeSelect.value = activeMode;
          return;
        }
        if (nextMode === activeMode && !activeConversationId) return;
        activeMode = nextMode;
        welcomeShownThisVisit = false;
        const shell = startNewConversationView(activeMode);
        renderModeControl();
        const conversation = await createConversationShellForMode(activeMode, { replaceId: shell?.id });
        if (window.matchMedia('(max-width: 640px)').matches) setMobileRailOpen(false);
        if (activeMode === 'thingy' || conversation) startAgentWelcome();
        trackTinylyticsEvent('librarian.mode_change', activeMode);
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

    /* ---- Account menu ---- */
    const accountBtn = document.getElementById('account-btn');
    const accountMenu = document.getElementById('account-menu');
    const accountNameForm = document.getElementById('account-name-form');
    const accountNameInput = document.getElementById('account-name-input');
    const accountNameStatus = document.getElementById('account-name-status');
    if (accountNameInput) accountNameInput.value = preferredName;
    const accountControls = createAccountMenu({
      session,
      button: accountBtn,
      menu: accountMenu,
      nameForm: accountNameForm,
      nameInput: accountNameInput,
      nameStatus: accountNameStatus,
      logoutButton,
      normalizeName: normalizePreferredName,
      signedIn: () => Boolean(token()),
      returnTo: '/chat/',
      onSignedOutClick: () => {
        if (emailInput) emailInput.focus();
      },
      onLogout: () => {
        clearToken({ scrubAuthParams: true });
        trackTinylyticsEvent('librarian.logout');
      },
      onSaved: (nextName) => {
        rememberPreferredName(nextName);
        refreshAccountIdentity();
      }
    });

    document.addEventListener('click', (event) => {
      const target = event.target instanceof Element ? event.target : event.target?.parentElement;
      if (target && sourceControls.contains?.(target)) return;
      sourceControls.close();
      accountControls.close();
      toggleMobileConversationMenu(false);
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        sourceControls.close();
        accountControls.close();
        toggleMobileConversationMenu(false);
        setMobileRailOpen(false);
      }
    });

    /* ---- Recents list interactions ---- */
    const railRecentsEl = document.getElementById('rail-recents');
    if (railRecentsEl) {
      railRecentsEl.addEventListener('click', async (event) => {
        const deleteBtn = event.target instanceof Element ? event.target.closest('[data-action="delete-conv"]') : null;
        if (deleteBtn) {
          event.preventDefault();
          event.stopPropagation();
          const id = deleteBtn.dataset.id;
          if (!id) return;
          if (!window.confirm('Delete this conversation?')) return;
          deleteBtn.disabled = true;
          if (isLocalConversationId(id)) {
            conversations = conversations.filter((entry) => entry.id !== id);
            if (id === activeConversationId) {
              startBlankConversationView();
            } else {
              renderRecents();
            }
            trackTinylyticsEvent('librarian.conversation_delete');
            return;
          }
          try {
            await conversationAction({ action: 'delete', conversation_id: id });
            conversations = conversations.filter((entry) => entry.id !== id);
            if (id === activeConversationId) {
              clearConversation();
            } else {
              renderRecents();
            }
            trackTinylyticsEvent('librarian.conversation_delete');
          } catch (error) {
            deleteBtn.disabled = false;
            trackTinylyticsEvent('librarian.conversations_error', 'delete');
          }
          return;
        }
        const openBtn = event.target instanceof Element ? event.target.closest('button[data-id]') : null;
        if (openBtn) {
          toggleMobileConversationMenu(false);
          await loadConversationIntoChat(openBtn.dataset.id);
          setMobileRailOpen(false);
        }
      });
    }

    /* ---- Conversation bootstrap ---- */
    resetMessages();
    const storedProfile = userProfile();
    preferredName = String(storedProfile.preferred_name || '').trim();
    availableModes = normalizeModes(storedProfile.modes || []);
    if (!availableModes.length) availableModes = [{ id: 'thingy', label: 'Thingy' }];
    if (!availableModes.some((mode) => mode.id === activeMode)) activeMode = 'thingy';
    refreshAccountIdentity();
    renderRecents();

    if (loginToken) {
      window.location.href = signInReturnUrl();
      trackTinylyticsEvent('librarian.auth_magic_link_start');
    } else if (email) {
      window.location.href = signInReturnUrl();
      trackTinylyticsEvent('librarian.auth_auto_start');
    } else if (token()) {
      if (tokenExpired()) {
        clearToken({
          message: "Your Thingy session expired. Enter your email and I'll send a fresh sign-in link.",
          preserveEmail: true
        });
        trackTinylyticsEvent('librarian.session_expired_startup');
      } else {
        setAuthShellMode(false);
        authPanel.hidden = true;
        chatPanel.hidden = false;
        scheduleComposerReserveUpdate();
        const savedActiveId = savedActiveConversation();
        refreshConversations().then((list) => {
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
      window.location.href = signInReturnUrl();
    }
  })();
