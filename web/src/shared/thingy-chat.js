import * as session from './thingy-session.js';
import {
  extractPreferredNameFromMessage,
  normalizePreferredName,
  savePreferredName
} from './thingy-account.js';
import { createTinylyticsTracker } from './thingy-analytics.js';
import { createComposer } from './thingy-composer.js';
import { applyReturnChip } from './thingy-from.js';
import { postJsonRequest } from './thingy-http.js';
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
import { createAssistantStreamRenderer } from './thingy-chat-stream-renderer.js';
import { createAssistantMessageModel } from './models/assistant-message.js';
import { mountAssistantMessage } from './components/AssistantMessage.jsx';
import { effect } from '@preact/signals';
import { normalizeScopeParam } from './thingy-scope.js';
import { createSourcePicker } from './thingy-source-picker.js';
import { attachRailState } from './thingy-rail-state.js';
import { postJsonStream, read as readStream } from './thingy-stream.js';
import { createDictationController } from './thingy-voice.js';
import { createChatMessageActions } from './thingy-message-actions.js';
import {
  librarianStreamUrl,
  tinylyticsId
} from './thingy-config.js';
import {
  conversationTitle,
  createLocalConversation,
  dedupeEmptyConversationDrafts as dedupeConversationDrafts,
  deleteConversationSummaryList,
  isEmptyConversationDraft as isEmptyConversationDraftEntry,
  isLocalConversationId as isLocalConversationIdValue,
  upsertConversationSummaryList
} from './thingy-conversations.js';
import { userLocalContext } from './thingy-local-context.js';
import {
  isAuthError,
  scrubUrlParams
} from './thingy-url.js';
import { updateChatComposerState } from './thingy-chat-composer-state.js';
import { handleAuthResponse as handleAuthResponseStatus } from './thingy-auth-response.js';
import {
  activeConversationId as activeConversationIdSignal,
  activeMode as activeModeSignal,
  answerInFlight as answerInFlightSignal,
  authAction as authActionSignal,
  authBusy as authBusySignal,
  authEmail as authEmailSignal,
  authEmailError as authEmailErrorSignal,
  authMessage as authMessageSignal,
  availableModes as availableModesSignal,
  conversationCreateInFlight as conversationCreateInFlightSignal,
  conversations as conversationsSignal,
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
  displayEmail as displayEmailSignal,
  displayPreferredName as displayPreferredNameSignal,
  displayProfile as displayProfileSignal,
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
    const railControls = attachRailState({
      shell: appShell,
      mobileToggle: mobileConversationsToggle,
      scrim: railScrim,
      collapseButton: document.getElementById('rail-collapse'),
      collapsedKey: 'thingyRailCollapsed',
      showLabel: 'Show conversations',
      hideLabel: 'Hide conversations'
    });
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
        rememberPreferredName(nextName);
        refreshAccountIdentity();
      },
      onOpen: () => {
        refreshAccountProfile({ force: true });
      }
    });
    const maxRecents = 20;

    // The mirror that used to live in renderRecents() is gone. `state` is a
    // setter-backed proxy: writing `state.conversations = [...]` notifies
    // the corresponding signal immediately, and reads return the signal's
    // current value. That removes the bug class where a mutation could
    // land without a matching renderRecents() call.
    const state = new Proxy({}, {
      get(_, prop) {
        if (prop === 'conversations') return conversationsSignal.value;
        if (prop === 'activeConversationId') return activeConversationIdSignal.value;
        if (prop === 'availableModes') return availableModesSignal.value;
        if (prop === 'activeMode') return activeModeSignal.value;
        if (prop === 'preferredName') return displayPreferredNameSignal.value;
        return undefined;
      },
      set(_, prop, value) {
        if (prop === 'conversations') conversationsSignal.value = value;
        else if (prop === 'activeConversationId') activeConversationIdSignal.value = value;
        else if (prop === 'availableModes') availableModesSignal.value = value;
        else if (prop === 'activeMode') activeModeSignal.value = value;
        else if (prop === 'preferredName') displayPreferredNameSignal.value = value;
        return true;
      }
    });
    let awaitingName = false;
    const maxQuestionChars = Number(questionInput.getAttribute('maxlength') || '1200');
    const analytics = createTinylyticsTracker({ enabled: Boolean(tinylyticsId()) });
    let chatAbortController = null;
    let chatStopRequested = false;
    let autoFollowChat = true;
    let scrollFrame = 0;
    let composerReserveFrame = 0;
    let composerControls = null;
    let welcomeShownThisVisit = false;
    let welcomeAbortController = null;
    let welcomePendingMessage = null;
    let dictationControls = null;
    let authRequestGeneration = 0;
    let accountProfileRefreshAt = 0;
    let accountProfileRefreshPromise = null;
    const emailRe = /^[a-zA-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

    const params = new URLSearchParams(window.location.search);
    const initialEmailFromUrl = normalizeEmail(params.get('email'));
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

    function resetMessages() {
      unmountChildren(messages);
      messages.innerHTML = '';
    }

    function normalizeEmail(value) {
      return session.normalizeEmail(value);
    }

    function normalizeInitialPrompt(value) {
      return String(value || '').trim().slice(0, maxQuestionChars);
    }

    function validateEmail() {
      const value = String(authEmailSignal.value || '').trim();
      if (!value || emailRe.test(value)) {
        authEmailErrorSignal.value = '';
        return true;
      }
      authEmailErrorSignal.value = 'Please enter a valid email address';
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

    // Initialize the auth signal from localStorage before any effect runs
    // so the first paint shows the right panel without a flash of auth.
    signedInSignal.value = Boolean(token()) && !tokenExpired();

    function storedEmail() {
      const stored = session.storedEmail();
      const entered = String(authEmailSignal.value || '').trim();
      return normalizeEmail(entered || stored);
    }

    function setUserProfile(data) {
      const profile = session.mergeProfile(data || {}, storedEmail());
      const modes = normalizeModes(profile.modes || data?.modes || data?.profile?.modes || []);
      state.availableModes = modes.length ? modes : [{ id: 'thingy', label: 'Thingy' }];
      if (!state.availableModes.some((mode) => mode.id === state.activeMode)) state.activeMode = 'thingy';
      state.preferredName = String(profile.preferred_name || '').trim();
      session.updateStoredProfile({ ...profile, modes: state.availableModes });
      renderModeControl();
      return profile;
    }

    function userProfile() {
      return session.storedProfile();
    }

    function modeLabel(id = state.activeMode) {
      return state.availableModes.find((mode) => mode.id === id)?.label || 'Thingy';
    }

    function currentConversationMode() {
      return activeConversation()?.mode || state.activeMode || 'thingy';
    }

    function isLocalConversationId(id) {
      return isLocalConversationIdValue(id, localConversationPrefix);
    }

    function newConversationTitle(mode = state.activeMode) {
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
      modeBanner.innerHTML = `${iconSvg(modeIcon(mode), { className: 'thingy-mode-banner-icon' })}<span class="thingy-mode-banner-kicker">Mode</span><strong>${escapeHtml(label)}</strong>`;
    }

    function renderModeControl() {
      if (!modeControl || !modeSelect) return;
      const show = token() && state.availableModes.length > 1;
      modeControl.hidden = !show;
      modeSelect.innerHTML = state.availableModes.map((mode) => `<option value="${escapeHtml(mode.id)}">${escapeHtml(mode.label)}</option>`).join('');
      modeSelect.value = state.availableModes.some((mode) => mode.id === state.activeMode) ? state.activeMode : 'thingy';
      if (modeIconEl) modeIconEl.innerHTML = iconSvg(modeIcon(modeSelect.value));
      renderModeBanner();
    }

    function rememberPreferredName(name) {
      const cleanName = String(name || '').trim();
      if (!cleanName) return;
      // state.preferredName mirrors to displayPreferredNameSignal via the
      // setter proxy, which is what the AccountMenu component subscribes to.
      state.preferredName = cleanName;
      session.updateStoredProfile({ preferred_name: cleanName });
    }

    async function persistInferredPreferredName(name) {
      const { savedName } = await savePreferredName(session, name, normalizePreferredName);
      rememberPreferredName(savedName);
      refreshAccountIdentity();
      return savedName;
    }

    function readerProfileContext() {
      return {
        ...userProfile(),
        preferred_name: state.preferredName,
        awaiting_name: awaitingName
      };
    }

    function currentScope() {
      return sourceControls.currentScope();
    }

    function sourceCount() {
      return sourceControls.sourceCount();
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

    function persistToken(value, data = {}) {
      session.persistAuth({ ...data, token: value }, data.email || storedEmail());
      setUserProfile(data);
      if (data.email) authEmailSignal.value = normalizeEmail(data.email);
      signedInSignal.value = Boolean(token());
      refreshAccountIdentity();
    }

    async function refreshStoredAuth(options = {}) {
      if (!token() || tokenExpired()) return false;
      const shouldTrack = options.track !== false;
      const data = await session.refreshAuth();
      if (!data) {
        if (shouldTrack) trackTinylyticsEvent('librarian.auth_refresh_error');
        return false;
      }
      setUserProfile(data);
      if (data.email) authEmailSignal.value = normalizeEmail(data.email);
      refreshAccountIdentity();
      if (shouldTrack) trackTinylyticsEvent('librarian.auth_refresh_success');
      return true;
    }

    function redirectToSignIn(returnTo = '/chat/') {
      const emailValue = storedEmail();
      session.clearAuth();
      signedInSignal.value = false;
      if (emailValue) authEmailSignal.value = emailValue;
      window.location.href = session.signInUrl(returnTo);
    }

    async function refreshAccountProfile(options = {}) {
      if (!token() || tokenExpired()) return false;
      const now = Date.now();
      if (!options.force && now - accountProfileRefreshAt < 30000) return false;
      if (accountProfileRefreshPromise) return accountProfileRefreshPromise;
      accountProfileRefreshAt = now;
      accountProfileRefreshPromise = refreshStoredAuth({ track: false })
        .finally(() => {
          accountProfileRefreshPromise = null;
        });
      return accountProfileRefreshPromise;
    }

    async function ensureFreshToken() {
      if (!token()) return false;
      if (!tokenExpired() && !tokenNeedsRefresh()) return true;
      const refreshable = tokenNeedsRefresh();
      if (refreshable && await refreshStoredAuth()) return true;
      redirectToSignIn();
      trackTinylyticsEvent(refreshable ? 'librarian.auth_refresh_error' : 'librarian.session_expired');
      return false;
    }

    function setToken(value, data = {}) {
      persistToken(value, data);
      authActionSignal.value = 'none';
      resetMessages();
      refreshConversations().then(() => {
        if (hasInitialPrompt) {
          setActiveConversation('');
          maybeSubmitInitialPrompt();
          return;
        }
        if (!state.activeConversationId) startAgentWelcome();
      });
      scheduleComposerReserveUpdate();
      questionInput.focus();
    }

    function clearToken(options = {}) {
      const config = typeof options === 'string' ? { message: options } : (options || {});
      authRequestGeneration += 1;
      const message = String(config.message || '').trim();
      const existingMessage = authMessageSignal.value;
      const emailValue = storedEmail();
      session.clearAuth();
      signedInSignal.value = false;
      if (config.preserveEmail && emailValue) authEmailSignal.value = emailValue;
      if (config.scrubAuthParams) scrubUrlParams(['login_token', 'magic_token', 'email']);
      state.conversations = [];
      state.availableModes = [{ id: 'thingy', label: 'Thingy' }];
      state.activeMode = 'thingy';
      setActiveConversation('');
      welcomeShownThisVisit = false;
      prompts.hidden = true;
      prompts.innerHTML = '';
      authActionSignal.value = 'none';
      authMessageSignal.value = message || existingMessage || '';
      refreshAccountIdentity();
      renderModeControl();
      renderRecents();
      focusAuthEmail();
    }

    function refreshAccountIdentity() {
      // displayEmail and displayProfile are owned by the controller (they
      // mirror values derived from session.storedX()). state.preferredName
      // is the source of truth for the name signal and already up-to-date.
      const stored = session.storedEmail();
      const value = String(authEmailSignal.value || '').trim() || stored;
      displayEmailSignal.value = value;
      displayProfileSignal.value = userProfile() || {};
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

    // Creates an assistant message backed by a reactive model. The DOM root
    // is returned so other helpers (addResponseActions, scroll bookkeeping)
    // keep working; the model is what stream code writes into. Pass
    // `static: true` for a loaded (non-streaming) message — content/
    // citations/etc. should be passed in modelOptions and won't change.
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

    function stopActiveAnswer() {
      if (!chatAbortController) return;
      chatStopRequested = true;
      chatAbortController.abort();
    }

    function updateQuestionState() {
      const sourcesPicked = sourceCount() > 0;
      hasSourcesSignal.value = sourcesPicked;
      // Authoritative mirror — covers dictation and any code path that
      // writes questionInput.value directly without going through setQuestionInputValue.
      questionTextSignal.value = questionInput.value;
      updateChatComposerState({
        input: questionInput,
        maxChars: maxQuestionChars,
        hasSources: sourcesPicked,
        busy: interactionBusy(),
        signedIn: Boolean(token()),
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

    function setAuthMessage(message) {
      authMessageSignal.value = message || '';
    }

    function hideAuthActions() {
      authActionSignal.value = 'none';
    }

    function showAuthAction(action) {
      authActionSignal.value = action || 'none';
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
      state.activeConversationId = String(id || '').trim() || null;
      try {
        if (state.activeConversationId) {
          window.localStorage.setItem(activeConvKey, state.activeConversationId);
        } else {
          window.localStorage.removeItem(activeConvKey);
        }
      } catch (error) { /* ignore */ }
      renderRecents();
      updateMobileConversationTitle();
      renderModeBanner();
      return state.activeConversationId;
    }

    function resetConversationView() {
      setQuestionInputValue('');
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
        activeConversationId: options.activeConversationId || state.activeConversationId,
        labelForMode: modeLabel
      });
    }

    // Entries held by the conversations signal are treated as immutable:
    // updating one means reassigning state.conversations with a new array
    // and a new entry object, otherwise the signal never notifies and the
    // rail renders stale data.
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
        scope: currentScope(),
        prefix: localConversationPrefix,
        labelForMode: modeLabel
      });
      const withoutDrafts = state.conversations.filter((entry) => !isEmptyConversationDraft(entry, normalized));
      state.conversations = dedupeEmptyConversationDrafts([shell, ...withoutDrafts], { activeConversationId: shell.id }).slice(0, maxRecents);
      setActiveConversation(shell.id);
      return shell;
    }

    function startNewConversationView(mode = state.activeMode) {
      state.activeMode = normalizeModeId(mode);
      const shell = createLocalConversationShell(state.activeMode);
      resetConversationView();
      return shell;
    }

    function activeConversation() {
      if (!state.activeConversationId) return null;
      return state.conversations.find((entry) => entry.id === state.activeConversationId || entry.conversation_id === state.activeConversationId) || null;
    }

    function currentConversationTitle() {
      if (!state.activeConversationId) return 'New chat';
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
      const hasActive = Boolean(state.activeConversationId && activeConversation());
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
        const updated = {
          ...active,
          title: trimmed,
          draft: false,
          updated_at: new Date().toISOString()
        };
        state.conversations = state.conversations.map((entry) => (entry.id === active.id ? updated : entry));
        updateMobileConversationTitle();
        return;
      }
      try {
        const data = await conversationAction({ action: 'rename', conversation_id: active.id, title: trimmed });
        if (data.conversation) upsertConversationSummary({ ...data.conversation, draft: false });
        trackTinylyticsEvent('librarian.conversation_rename');
      } catch (error) {
        showNotice('Could not rename the conversation. Please try again.');
        trackTinylyticsEvent('librarian.conversations_error', 'rename');
      }
    }

    async function deleteActiveConversation() {
      const active = activeConversation();
      if (!active || interactionBusy()) return;
      toggleMobileConversationMenu(false);
      if (!window.confirm('Delete this conversation?')) return;
      if (isLocalConversationId(active.id)) {
        ({ conversations: state.conversations, activeConversationId: state.activeConversationId } = deleteConversationSummaryList(state.conversations, active.id, { activeConversationId: state.activeConversationId }));
        startBlankConversationView();
        setMobileRailOpen(false);
        return;
      }
      try {
        await conversationAction({ action: 'delete', conversation_id: active.id });
        ({ conversations: state.conversations, activeConversationId: state.activeConversationId } = deleteConversationSummaryList(state.conversations, active.id, { activeConversationId: state.activeConversationId }));
        clearConversation();
        setMobileRailOpen(false);
        trackTinylyticsEvent('librarian.conversation_delete');
      } catch (error) {
        showNotice('Could not delete the conversation. Please try again.');
        trackTinylyticsEvent('librarian.conversations_error', 'delete');
      }
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
      if (!token() || interactionBusy()) return;
      if (!(await ensureFreshToken())) {
        return;
      }
      const scope = currentScope();
      if (!scope) {
        updateQuestionState();
        return;
      }
      const attachToCurrent = Boolean(options.attachToCurrent && state.activeConversationId && !isLocalConversationId(state.activeConversationId));
      const existingConversationId = attachToCurrent ? state.activeConversationId : '';
      if (!attachToCurrent) welcomeShownThisVisit = true;
      hidePrompts();
      if (window.matchMedia('(max-width: 640px)').matches) setMobileRailOpen(false);
      stopSpeaking();
      if (!attachToCurrent) {
        setActiveConversation('');
        unmountChildren(messages);
        messages.innerHTML = '';
      }
      setQuestionInputValue('');
      mapInFlightSignal.value = true;
      updateQuestionState();
      autoFollowChat = true;
      const { model } = addAssistantMessage({
        statusFallback: 'Thingy is drawing connections...'
      });
      try {
        const map = await postStreamJson('/curiosity-map', {
          scope,
          mode: currentConversationMode(),
          center,
          conversation_id: existingConversationId || undefined,
          user_profile: readerProfileContext()
        }, authHeaders());
        if (map.conversation_id) {
          setActiveConversation(map.conversation_id);
        }
        if (map.conversation) upsertConversationSummary(map.conversation);
        const mapHtml = renderCuriosityMap(map) || '<p>Thingy could not find enough connected threads to draw a map yet.</p>';
        model.artifactHtml.value = mapHtml;
        model.status.value = 'done';
        scheduleChatScroll({ force: true });
        await refreshConversations();
        trackTinylyticsEvent('librarian.curiosity_map_success', `${(map.nodes || []).length}.${(map.sources || []).length}`);
      } catch (error) {
        model.errorMessage.value = error.message;
        model.status.value = 'error';
        trackTinylyticsEvent('librarian.curiosity_map_error', error.requestId ? 'server' : 'client');
        if (isAuthError(error)) redirectToSignIn();
      } finally {
        mapInFlightSignal.value = false;
        updateQuestionState();
      }
    }

    function upsertConversationSummary(conversation, options = {}) {
      if (!conversation || !(conversation.id || conversation.conversation_id)) return;
      const replaceId = String(options.replaceId || '').trim();
      const result = upsertConversationSummaryList(state.conversations, conversation, {
        activeConversationId: state.activeConversationId,
        labelForMode: modeLabel,
        maxRecents,
        replaceId
      });
      state.conversations = result.conversations;
      if (result.activeConversationId && result.activeConversationId !== state.activeConversationId) {
        state.activeConversationId = result.activeConversationId;
        try { window.localStorage.setItem(activeConvKey, state.activeConversationId); } catch (error) { /* ignore */ }
      }
      renderRecents();
      updateMobileConversationTitle();
      renderModeBanner();
    }

    function upsertPendingConversation({ conversationId, title, scope, mode }) {
      const id = String(conversationId || '').trim();
      if (!id) return;
      const replaceId = isLocalConversationId(state.activeConversationId) ? state.activeConversationId : '';
      const now = new Date().toISOString();
      const existing = state.conversations.find((entry) => entry.id === id || entry.conversation_id === id);
      if (!replaceId && existing) {
        upsertConversationSummary({
          ...existing,
          id,
          conversation_id: id,
          title: existing.title || title || 'New chat',
          scope: existing.scope || scope || currentScope(),
          mode: normalizeModeId(existing.mode || mode || currentConversationMode()),
          updated_at: now,
          last_message_at: now,
          draft: false
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
        turn_count: 0,
        draft: false
      }, { replaceId });
    }

    async function createConversationShellForMode(mode, options = {}) {
      const normalized = normalizeModeId(mode);
      if (!token() || normalized === 'thingy') return activeConversation();
      if (!state.availableModes.some((entry) => entry.id === normalized)) return null;
      if (!(await ensureFreshToken())) {
        return null;
      }
      const replaceId = String(options.replaceId || state.activeConversationId || '').trim();
      conversationCreateInFlightSignal.value = true;
      updateQuestionState();
      try {
        const data = await conversationAction({
          action: 'create',
          mode: normalized,
          title: newConversationTitle(normalized),
          scope: currentScope()
        });
        if (data.conversation) {
          upsertConversationSummary({ ...data.conversation, draft: true }, {
            replaceId: isLocalConversationId(replaceId) ? replaceId : ''
          });
          setActiveConversation(data.conversation.id || data.conversation.conversation_id);
          return data.conversation;
        }
      } catch (error) {
        if (isAuthError(error)) {
          redirectToSignIn();
        } else {
          showNotice(`Could not start a ${modeLabel(normalized)} chat. Please try again.`);
        }
        trackTinylyticsEvent('librarian.conversations_error', 'create');
      } finally {
        conversationCreateInFlightSignal.value = false;
        updateQuestionState();
      }
      return null;
    }

    async function refreshConversations(options = {}) {
      if (!token()) {
        state.conversations = [];
        renderRecents();
        return [];
      }
      if (!(await ensureFreshToken())) {
        return [];
      }
      try {
        const data = await conversationAction({ action: 'list', limit: maxRecents });
        if (data.modes || data.entitlements) setUserProfile(data);
        const clientActiveShells = state.conversations.filter((entry) => {
          if (!entry?.id) return false;
          return isLocalConversationId(entry.id) || entry.id === state.activeConversationId;
        });
        const serverConversations = (data.conversations || []).map((entry) => ({
          ...entry,
          id: entry.id || entry.conversation_id,
          local: false
        })).filter((entry) => entry.id);
        const serverIds = new Set(serverConversations.map((entry) => entry.id));
        const keptClientShells = clientActiveShells.filter((entry) => entry.id === state.activeConversationId && !serverIds.has(entry.id));
        state.conversations = dedupeEmptyConversationDrafts(
          [...keptClientShells, ...serverConversations]
            .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')))
        ).slice(0, maxRecents);
        if (state.activeConversationId && !state.conversations.some((entry) => entry.id === state.activeConversationId)) {
          setActiveConversation('');
        }
        renderRecents();
        return state.conversations;
      } catch (error) {
        if (options.retryAuth !== false && isAuthError(error) && await refreshStoredAuth()) {
          return refreshConversations({ retryAuth: false });
        }
        trackTinylyticsEvent('librarian.conversations_error', 'list');
        if (isAuthError(error)) {
          redirectToSignIn();
          return [];
        }
        renderRecents();
        return state.conversations;
      }
    }

    // Updates the mobile chatbar's title text from the active conversation.
    // Mutations to state.conversations / state.activeConversationId already
    // notify the RailRecents island; this only handles the imperative
    // mobile title that hasn't been migrated to a component yet.
    function renderRecents() {
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
          state.activeMode = data.conversation.mode;
          renderModeControl();
        }
        unmountChildren(messages);
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
        renderRecents();
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
      if (!initialPrompt || initialPromptSubmitted || interactionBusy() || !token()) return;
      initialPromptSubmitted = true;
      hidePrompts();
      setQuestionInputValue(initialPrompt);
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

    async function submitAuthAction(action) {
      if (!validateEmail()) return;
      const generation = authRequestGeneration;
      authBusySignal.value = true;
      hideAuthActions();
      setAuthMessage(action === 'subscribe' ? 'Adding you to the Weekly Thing...' : 'Sending the confirmation email...');
      try {
        const payload = { email: String(authEmailSignal.value || ''), action, source: 'thingy' };
        const data = await postJson('/auth', payload);
        if (generation !== authRequestGeneration) return;
        handleAuthResponse(data);
      } catch (error) {
        if (generation !== authRequestGeneration) return;
        setAuthMessage(error.message);
        trackTinylyticsEvent('librarian.auth_error', error.requestId ? 'server' : 'client');
      } finally {
        authBusySignal.value = false;
      }
    }

    async function submitAuthCheck(options = {}) {
      if (!validateEmail()) return false;
      const generation = authRequestGeneration;
      authBusySignal.value = true;
      hideAuthActions();
      setAuthMessage('Sending a sign-in link...');
      try {
        const data = await postJson('/auth', { email: String(authEmailSignal.value || '').trim(), action: 'check', source: 'thingy' });
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
        authBusySignal.value = false;
        validateEmail();
      }
    }

    async function postStreamingChat(message, model, scope) {
      if (!streamBase) {
        throw new Error('Thingy has not been connected to the archive stream API yet.');
      }

      let requestId = '';
      let conversationId = isLocalConversationId(state.activeConversationId) ? '' : (state.activeConversationId || '');
      let conversation = null;
      chatStopRequested = false;
      chatAbortController = new AbortController();
      stoppableSignal.value = answerInFlightSignal.value;
      updateQuestionState();
      let response;
      try {
        response = await postJsonStream({
          baseUrl: streamBase,
          path: '/chat',
          controller: chatAbortController,
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
      } catch (error) {
        if (chatStopRequested) {
          model.status.value = 'stopped';
          return { answer: '', citations: [], experience: null, stopped: true, request_id: '', conversation_id: conversationId, conversation: null };
        }
        throw error;
      }

      const renderer = createAssistantStreamRenderer({ model, scroll: scheduleChatScroll });

      function applyEvent(eventName, data) {
        if (eventName === 'meta') {
          requestId = data.request_id || requestId;
          if (data.mode) {
            state.activeMode = data.mode;
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
            state.activeMode = data.mode;
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

      let stopped = false;
      try {
        await readStream(response, applyEvent);
      } catch (error) {
        if (!chatStopRequested) throw error;
        stopped = true;
      }
      const result = renderer.finish(stopped ? 'stopped' : 'done');
      if (model.requestId.peek() !== requestId) model.requestId.value = requestId;
      if (!stopped && !String(result.answer || '').trim() && !result.experience) {
        throw new Error('Thingy did not return an answer. Please try again.');
      }
      return { ...result, stopped, request_id: requestId, conversation_id: conversationId, conversation };
    }

    async function postStreamingWelcome(model, scope, options = {}) {
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
        model,
        scroll: scheduleChatScroll,
        label: 'Session Setup',
        statusFallback: 'Thingy is getting oriented...'
      });

      function applyEvent(eventName, data) {
        if (eventName === 'meta') {
          requestId = data.request_id || requestId;
          if (data.mode) {
            state.activeMode = data.mode;
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
            state.activeMode = data.mode;
            renderModeControl();
          }
        } else if (eventName === 'error') {
          const error = new Error(data.error || 'Thingy is unavailable.');
          error.requestId = data.request_id || requestId;
          throw error;
        }
      }

      await readStream(response, applyEvent);
      const { answer, experience } = renderer.finish('done');
      return { answer, experience, request_id: requestId };
    }

    async function startAgentWelcome() {
      if (!token() || interactionBusy() || welcomeInFlightSignal.value || welcomeShownThisVisit || hasInitialPrompt) return;
      if (!(await ensureFreshToken())) {
        return;
      }
      hidePrompts();
      awaitingName = !state.preferredName;
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
        await postStreamingWelcome(model, currentScope(), { controller: welcomeAbortController });
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
      onSubmit: () => { submitAuthCheck(); },
      onAddSubscriber: () => submitAuthAction('subscribe'),
      onResendConfirmation: () => submitAuthAction('resend_confirmation'),
      onEmailInput: () => {
        validateEmail();
        hideAuthActions();
      }
    });

    // Drive panel visibility and the booting/auth shell modifier classes
    // off the signedIn signal. The IIFE's startup paths set signedIn before
    // calling this for the first time.
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
      await createConversationShellForMode(state.activeMode, { replaceId: shell?.id });
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
        return;
      }
      if (dictationControls?.isListening?.()) stopDictation();
      stopSpeaking();
      answerInFlightSignal.value = true;
      updateQuestionState();
      hidePrompts();
      const questionWordCount = message.split(/\s+/).filter(Boolean).length;
      const questionSize = questionWordCount < 6 ? 'short' : questionWordCount < 18 ? 'medium' : 'long';
      if (awaitingName && !state.preferredName) {
        const suppliedName = extractPreferredNameFromMessage(message);
        if (suppliedName) {
          await persistInferredPreferredName(suppliedName).catch(() => {});
        }
        awaitingName = false;
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
        const data = await postStreamingChat(message, model, scope);
        if (data.stopped) {
          const hasPartial = Boolean(String(data.answer || '').trim() || data.experience);
          trackTinylyticsEvent('librarian.answer_stopped', hasPartial ? 'partial' : 'empty');
        } else {
          addResponseActions(pending, data.request_id);
        }
        if (data.conversation_id) {
          setActiveConversation(data.conversation_id);
        }
        if (data.conversation) upsertConversationSummary(data.conversation);
        await refreshConversations();
        if (!data.stopped) trackTinylyticsEvent('librarian.answer_success', `${questionSize}.${(data.citations || []).length}`);
      } catch (error) {
        model.errorMessage.value = error.message;
        if (!isAuthError(error)) model.retryPrompt.value = message;
        model.status.value = 'error';
        trackTinylyticsEvent('librarian.answer_error', error.requestId ? 'server' : 'client');
        if (isAuthError(error)) {
          redirectToSignIn();
        }
      } finally {
        answerInFlightSignal.value = false;
        stoppableSignal.value = false;
        chatAbortController = null;
        chatStopRequested = false;
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
        stopActiveAnswer();
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
        await createConversationShellForMode(state.activeMode, { replaceId: shell?.id });
        setMobileRailOpen(false);
      });
    }
    if (modeSelect) {
      modeSelect.addEventListener('change', async () => {
        if (interactionBusy()) {
          modeSelect.value = state.activeMode;
          return;
        }
        const nextMode = normalizeModeId(modeSelect.value);
        if (!state.availableModes.some((mode) => mode.id === nextMode)) {
          modeSelect.value = state.activeMode;
          return;
        }
        if (nextMode === state.activeMode && !state.activeConversationId) return;
        state.activeMode = nextMode;
        welcomeShownThisVisit = false;
        const shell = startNewConversationView(state.activeMode);
        renderModeControl();
        const conversation = await createConversationShellForMode(state.activeMode, { replaceId: shell?.id });
        if (window.matchMedia('(max-width: 640px)').matches) setMobileRailOpen(false);
        if (state.activeMode === 'thingy' || conversation) startAgentWelcome();
        trackTinylyticsEvent('librarian.mode_change', state.activeMode);
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
      if (target && sourceControls.contains?.(target)) return;
      sourceControls.close();
      toggleMobileConversationMenu(false);
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        sourceControls.close();
        accountMenuOpenSignal.value = false;
        accountNameStatusSignal.value = '';
        toggleMobileConversationMenu(false);
        setMobileRailOpen(false);
      }
    });
    window.addEventListener('focus', () => {
      refreshAccountProfile();
    });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) refreshAccountProfile();
    });
    window.addEventListener('storage', (event) => {
      // null key means storage was cleared wholesale.
      if (event.key !== null && event.key !== session.storageKey) return;
      const hasToken = Boolean(token());
      const chatVisible = signedInSignal.value;
      if (!hasToken && chatVisible) {
        stopActiveAnswer();
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
      if (isLocalConversationId(id)) {
        const wasActive = id === state.activeConversationId;
        ({ conversations: state.conversations, activeConversationId: state.activeConversationId } = deleteConversationSummaryList(state.conversations, id, { activeConversationId: state.activeConversationId }));
        if (wasActive) {
          startBlankConversationView();
        } else {
          renderRecents();
        }
        trackTinylyticsEvent('librarian.conversation_delete');
        return;
      }
      try {
        await conversationAction({ action: 'delete', conversation_id: id });
        const wasActive = id === state.activeConversationId;
        ({ conversations: state.conversations, activeConversationId: state.activeConversationId } = deleteConversationSummaryList(state.conversations, id, { activeConversationId: state.activeConversationId }));
        if (wasActive) {
          clearConversation();
        } else {
          renderRecents();
        }
        trackTinylyticsEvent('librarian.conversation_delete');
      } catch (error) {
        showNotice('Could not delete the conversation. Please try again.');
        trackTinylyticsEvent('librarian.conversations_error', 'delete');
      }
    }

    mountRailRecents(document.getElementById('rail-recents-mount'), {
      maxRecents,
      onOpen: handleRecentOpen,
      onDelete: handleRecentDelete
    });

    /* Conversation bootstrap. */
    resetMessages();
    const storedProfile = userProfile();
    state.preferredName = String(storedProfile.preferred_name || '').trim();
    state.availableModes = normalizeModes(storedProfile.modes || []);
    if (!state.availableModes.length) state.availableModes = [{ id: 'thingy', label: 'Thingy' }];
    if (!state.availableModes.some((mode) => mode.id === state.activeMode)) state.activeMode = 'thingy';
    refreshAccountIdentity();
    renderRecents();

    if (loginToken) {
      window.location.href = session.signInUrl();
      trackTinylyticsEvent('librarian.auth_magic_link_start');
    } else if (initialEmailFromUrl) {
      window.location.href = session.signInUrl();
      trackTinylyticsEvent('librarian.auth_auto_start');
    } else if (token()) {
      if (tokenExpired()) {
        redirectToSignIn();
        trackTinylyticsEvent('librarian.session_expired_startup');
      } else {
        signedInSignal.value = true;
        scheduleComposerReserveUpdate();
        refreshAccountProfile({ force: true });
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
      window.location.href = session.signInUrl();
    }
}

export { bootChat };
