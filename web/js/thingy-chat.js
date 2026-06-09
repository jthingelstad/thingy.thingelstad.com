(() => {
    const session = window.ThingySession;
    const config = window.ThingyConfig || {};
    const modeTools = window.ThingyModes || {};
    const scopeTools = window.ThingyScope || {};
    const normalizeModeId = modeTools.normalizeModeId || ((value) => String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_') || 'thingy');
    const normalizeModes = modeTools.normalizeModes || ((value) => Array.isArray(value) ? value : []);
    const modeGlyph = modeTools.modeGlyph || (() => '•');
    const modeClass = modeTools.modeClass || normalizeModeId;
    const normalizeScopeParam = scopeTools.normalizeScopeParam || (() => '');
    const apiBaseSource = window.WEEKLY_THING_LIBRARIAN_API === undefined ? config.librarianApiUrl : window.WEEKLY_THING_LIBRARIAN_API;
    const streamBaseSource = window.WEEKLY_THING_LIBRARIAN_STREAM_API === undefined ? config.librarianStreamUrl : window.WEEKLY_THING_LIBRARIAN_STREAM_API;
    const apiBase = String(apiBaseSource || '').replace(/\/$/, '');
    const streamBase = String(streamBaseSource || '').replace(/\/$/, '');
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
    const railControls = window.ThingyRail.createRailController({
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
    const analytics = window.ThingyAnalytics.createTinylyticsTracker({
      enabled: Boolean(config.tinylyticsId)
    });
    let answerInFlight = false;
    let autoFollowChat = true;
    let scrollFrame = 0;
    let composerReserveFrame = 0;
    let composerControls = null;
    let feedbackStatusTimer = 0;
    let welcomeInFlight = false;
    let welcomeShownThisVisit = false;
    let welcomeAbortController = null;
    let mapInFlight = false;
    let conversationCreateInFlight = false;
    let dictationControls = null;
    let speechUtterance = null;
    let speechButton = null;
    let authRequestGeneration = 0;
    const emailRe = /^[a-zA-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

    const params = new URLSearchParams(window.location.search);
    const email = normalizeEmail(params.get('email'));
    const loginToken = String(params.get('login_token') || params.get('magic_token') || '').trim();
    const initialPrompt = normalizeInitialPrompt(params.get('prompt'));
    const hasInitialPrompt = Boolean(initialPrompt);
    const initialScope = normalizeScopeParam(params.get('scope')) || normalizeScopeParam(params.get('corpus'));
    let activeScope = initialScope || 'all';
    const sourceControls = window.ThingySourcePicker.createSourcePicker({
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

    function scrubUrlParams(names = []) {
      if (!names.length) return;
      const url = new URL(window.location.href);
      let changed = false;
      names.forEach((name) => {
        if (url.searchParams.has(name)) {
          url.searchParams.delete(name);
          changed = true;
        }
      });
      if (changed) {
        window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
      }
    }

    function signInReturnUrl() {
      const url = new URL('/signin/', window.location.origin);
      url.searchParams.set('return', `${window.location.pathname}${window.location.search}${window.location.hash}` || '/chat/');
      return url.toString();
    }

    function userLocalContext() {
      const now = new Date();
      const locale = navigator.language || 'en-US';
      let timeZone = '';
      try {
        timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
      } catch (error) {
        timeZone = '';
      }
      const offsetMinutes = -now.getTimezoneOffset();
      const offsetSign = offsetMinutes >= 0 ? '+' : '-';
      const offsetAbs = Math.abs(offsetMinutes);
      const offset = `${offsetSign}${String(Math.floor(offsetAbs / 60)).padStart(2, '0')}:${String(offsetAbs % 60).padStart(2, '0')}`;
      const localIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}T${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}${offset}`;
      const hour = now.getHours();
      const dayPeriod = hour < 5 ? 'night' : hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : hour < 21 ? 'evening' : 'night';
      const localDate = new Intl.DateTimeFormat(locale, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric'
      }).format(now);
      const localTime = new Intl.DateTimeFormat(locale, {
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short'
      }).format(now);
      return {
        locale,
        time_zone: timeZone,
        utc_offset_minutes: offsetMinutes,
        local_iso: localIso,
        local_date: localDate,
        local_time: localTime,
        day_period: dayPeriod
      };
    }

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

    function tokenPayload(value = token()) {
      return session.tokenPayload(value);
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

    function isAuthError(error) {
      return error?.status === 401 || /validate|subscriber|unauthorized/i.test(String(error?.message || ''));
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
      return window.ThingyAccount.hasSupportingAccess(userProfile());
    }

    function modeLabel(id = activeMode) {
      return availableModes.find((mode) => mode.id === id)?.label || 'Thingy';
    }

    function currentConversationMode() {
      return activeConversation()?.mode || activeMode || 'thingy';
    }

    function isLocalConversationId(id) {
      return String(id || '').startsWith(localConversationPrefix);
    }

    function newConversationTitle(mode = activeMode) {
      const normalized = normalizeModeId(mode);
      return normalized === 'thingy' ? 'New chat' : `${modeLabel(normalized)} chat`;
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

    function extractPreferredName(message) {
      const text = String(message || '').trim();
      if (!text || text.length > 60 || /[?]/.test(text)) return '';
      const direct = text.match(/^(?:my name is|i am|i'm|call me)\s+([a-z][a-z .'’-]{0,38})[.!]?$/i);
      const candidate = (direct ? direct[1] : text).trim().replace(/[.!]+$/, '');
      if (!/^[a-z][a-z .'’-]{0,38}$/i.test(candidate)) return '';
      const words = candidate.split(/\s+/).filter(Boolean);
      if (words.length < 1 || words.length > 3) return '';
      const blocked = new Set(['hello', 'hi', 'hey', 'there', 'thingy', 'thanks', 'thank', 'yes', 'no', 'ok', 'okay']);
      if (words.some((word) => blocked.has(word.toLowerCase()))) return '';
      return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
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

    function selectedSources() {
      return sourceControls.selectedSources();
    }

    function sourceCount() {
      return sourceControls.sourceCount();
    }

    function speechInputSupported() {
      return window.ThingyVoice?.speechInputSupported?.() || false;
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
      window.ThingyAccount.renderAccountIdentity({
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
      const length = questionInput.value.length;
      const hasSources = sourceCount() > 0;
      const busy = interactionBusy();
      questionCount.textContent = `${length} / ${maxQuestionChars}`;
      questionCount.classList.toggle('warning', length > maxQuestionChars * 0.9);
      if (sourceError) sourceError.textContent = hasSources ? '' : 'Switch on at least one source.';
      questionForm.classList.toggle('is-busy', busy);
      questionButton.disabled = busy || !hasSources || !questionInput.value.trim() || length > maxQuestionChars;
      questionButton.setAttribute('aria-label', busy ? 'Thingy is answering' : 'Ask Thingy');
      questionButton.title = busy ? 'Thingy is answering' : 'Ask Thingy';
      if (composerMapButton) {
        const canMapDraft = Boolean(questionInput.value.trim()) && length <= maxQuestionChars && hasSources && token();
        composerMapButton.disabled = busy || !canMapDraft;
        composerMapButton.title = canMapDraft ? 'Seed curiosity map with this text' : 'Type a topic to seed a map';
        composerMapButton.setAttribute('aria-label', canMapDraft ? 'Seed curiosity map with this text' : 'Type a topic to seed a map');
      }
      clearChatButton.disabled = busy;
      if (curiosityMapButton) curiosityMapButton.disabled = busy || !token() || !hasSources;
      if (modeSelect) modeSelect.disabled = busy;
      sourceControls.setDisabled(busy);
      updateVoiceButtonState();
      updateMobileConversationTitle();
      autoSizeQuestionInput();
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
      return window.ThingyMarkdown.escapeHtml(value);
    }

    function safeMarkdownUrl(url) {
      return window.ThingyMarkdown.safeMarkdownUrl(url);
    }

    function renderInlineMarkdown(text, citationsByIssue) {
      return window.ThingyMarkdown.renderInlineMarkdown(text, citationsByIssue);
    }

    function renderMarkdown(markdown, citations = []) {
      return window.ThingyMarkdown.renderMarkdown(markdown, citations);
    }

    function sourceAccentClass(kind) {
      const normalized = String(kind || '').toLowerCase().replace(/[\s-]+/g, '_');
      if (normalized === 'weekly_thing' || normalized === 'newsletter' || normalized === 'issue' || normalized === 'chunk') return 'is-wt';
      if (normalized === 'blog') return 'is-blog';
      if (normalized === 'podcast' || normalized === 'another_thing') return 'is-podcast';
      return '';
    }

    function renderExperience(experience) {
      if (!experience || typeof experience !== 'object') return '';
      const items = Array.isArray(experience.items) ? experience.items.slice(0, 5) : [];
      if (!items.length && !experience.intro) return '';
      const kind = experience.kind === 'spark' ? 'spark' : 'trail';
      const title = experience.title || (kind === 'spark' ? 'Archive Spark' : 'Thingy Trail');
      const prompt = String(experience.prompt || '').trim();
      const itemHtml = items.map((item, index) => {
        const href = safeMarkdownUrl(item.url || '');
        const titleText = item.title || item.subject || 'Archive source';
        const meta = [item.label, item.publish_date ? String(item.publish_date).slice(0, 10) : ''].filter(Boolean).join(' · ');
        const reason = item.reason ? `<p>${escapeHtml(item.reason)}</p>` : '';
        const accent = sourceAccentClass(item.source_kind);
        const body = `
          <span class="thingy-exp-index">${index + 1}</span>
          <span class="thingy-exp-source-body">
            <strong>${escapeHtml(titleText)}</strong>
            ${meta ? `<small>${escapeHtml(meta)}</small>` : ''}
            ${reason}
          </span>`;
        if (href && href !== '#') {
          return `<a class="thingy-exp-source ${accent}" href="${href}">${body}</a>`;
        }
        return `<div class="thingy-exp-source ${accent}">${body}</div>`;
      }).join('');
      return `
        <aside class="thingy-experience thingy-experience-${kind}" aria-label="${escapeHtml(title)}">
          <div class="thingy-exp-head">
            <span class="thingy-exp-kicker">${kind === 'spark' ? 'Archive Spark' : 'Thingy Trail'}</span>
            <strong>${escapeHtml(title)}</strong>
          </div>
          ${experience.intro ? `<p class="thingy-exp-intro">${escapeHtml(experience.intro)}</p>` : ''}
          ${itemHtml ? `<div class="thingy-exp-sources">${itemHtml}</div>` : ''}
          ${prompt ? `<button type="button" class="thingy-exp-prompt" data-experience-prompt="${escapeHtml(prompt)}">${kind === 'spark' ? 'Follow this spark' : 'Continue this trail'}</button>` : ''}
        </aside>`;
    }

    function curiosityMapPositions(nodes) {
      const positioned = new Map();
      const total = Math.max(nodes.length - 1, 1);
      const compact = window.matchMedia && window.matchMedia('(max-width: 640px)').matches;
      nodes.forEach((node, index) => {
        if (index === 0 || node.kind === 'center') {
          positioned.set(node.id, { x: 50, y: 50, scale: 1.05 });
          return;
        }
        const angle = (-92 + ((index - 1) * 360 / total)) * Math.PI / 180;
        const isWide = total > 5 && index % 2 === 0;
        const radiusX = compact ? (isWide ? 30 : 26) : (isWide ? 40 : 34);
        const radiusY = compact ? (isWide ? 39 : 33) : (isWide ? 36 : 31);
        positioned.set(node.id, {
          x: Math.round((50 + Math.cos(angle) * radiusX) * 10) / 10,
          y: Math.round((50 + Math.sin(angle) * radiusY) * 10) / 10,
          scale: Math.max(0.84, Math.min(1, Number(node.weight || 0.7) * 0.18 + 0.84))
        });
      });
      return positioned;
    }

    function renderCuriosityMap(map) {
      if (!map || typeof map !== 'object') return '';
      const rawNodes = Array.isArray(map.nodes) ? map.nodes.filter((node) => node && node.id && node.label).slice(0, 8) : [];
      if (!rawNodes.length) return '';
      const nodes = rawNodes.some((node) => node.kind === 'center') ? rawNodes : [{ ...rawNodes[0], kind: 'center' }, ...rawNodes.slice(1)];
      const positions = curiosityMapPositions(nodes);
      const edges = (Array.isArray(map.edges) ? map.edges : []).filter((edge) => positions.has(edge.from) && positions.has(edge.to)).slice(0, 10);
      const edgeHtml = edges.map((edge) => {
        const from = positions.get(edge.from);
        const to = positions.get(edge.to);
        return `<line x1="${from.x}%" y1="${from.y}%" x2="${to.x}%" y2="${to.y}%"></line>`;
      }).join('');
      const nodeHtml = nodes.map((node) => {
        const pos = positions.get(node.id) || { x: 50, y: 50, scale: 1 };
        const kind = node.kind === 'center' ? 'center' : node.kind === 'domain' ? 'domain' : node.kind === 'recent' ? 'recent' : 'archive';
        const prompt = escapeHtml(String(node.prompt || '').trim());
        const title = escapeHtml(node.why || node.label);
        return `<button type="button" class="thingy-map-node is-${kind}" data-map-prompt="${prompt}" style="--x:${pos.x}%;--y:${pos.y}%;--scale:${pos.scale}" title="${title}"><span>${escapeHtml(node.label)}</span></button>`;
      }).join('');
      const sources = (Array.isArray(map.sources) ? map.sources : []).slice(0, 3);
      const sourceHtml = sources.map((source) => {
        const href = safeMarkdownUrl(source.url || '');
        const title = escapeHtml(source.title || source.subject || 'Archive source');
        const meta = escapeHtml([source.label, source.publish_date ? String(source.publish_date).slice(0, 10) : ''].filter(Boolean).join(' · '));
        const body = `<strong>${title}</strong>${meta ? `<small>${meta}</small>` : ''}`;
        return href && href !== '#'
          ? `<a class="thingy-map-source ${sourceAccentClass(source.source_kind)}" href="${href}">${body}</a>`
          : `<span class="thingy-map-source ${sourceAccentClass(source.source_kind)}">${body}</span>`;
      }).join('');
      const prompt = String(map.prompt || '').trim();
      return `
        <aside class="thingy-curiosity-map" aria-label="${escapeHtml(map.title || 'Curiosity map')}">
          <div class="thingy-map-head">
            <span class="thingy-exp-kicker">Curiosity Map</span>
            <strong>${escapeHtml(map.title || 'Curiosity Map')}</strong>
          </div>
          <div class="thingy-map-canvas">
            <svg class="thingy-map-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${edgeHtml}</svg>
            ${nodeHtml}
          </div>
          ${sourceHtml ? `<div class="thingy-map-sources">${sourceHtml}</div>` : ''}
          ${prompt ? `<button type="button" class="thingy-exp-prompt" data-map-prompt="${escapeHtml(prompt)}">Follow the surprising branch</button>` : ''}
        </aside>`;
    }

    function renderAnswer(answer, citations = [], experience = null) {
      return renderMarkdown(answer, citations) + renderExperience(experience);
    }

    function humanToolName(value) {
      return String(value || '')
        .replace(/_/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/\b\w/g, (letter) => letter.toUpperCase());
    }

    function activityMessageFromToolName(value) {
      const name = humanToolName(value);
      return name ? `Checked ${name}` : '';
    }

    function normalizeActivityStep(data, fallback = 'Thingy is working...') {
      if (typeof data === 'string') return String(data || fallback).trim();
      const toolName = data?.tool_name || data?.toolName || '';
      if (toolName) return activityMessageFromToolName(toolName);
      return String(data?.message || fallback).trim().replace(/\.\.\.$/, '');
    }

    function appendActivityStep(steps, data, fallback) {
      const label = normalizeActivityStep(data, fallback).replace(/\s+/g, ' ').slice(0, 120);
      const note = normalizeActivityCommentary(data?.commentary || data?.detail || data?.note || '');
      if (!label) return steps;
      const last = steps[steps.length - 1] || {};
      if (String(last.label || last).toLowerCase() === label.toLowerCase()) {
        if (note && !String(last.note || '').toLowerCase().includes(note.toLowerCase())) {
          last.note = [last.note, note].filter(Boolean).join(' ');
        }
        return steps;
      }
      steps.push({ label, note });
      return steps.slice(-8);
    }

    function normalizeActivityCommentary(value) {
      return String(value || '')
        .replace(/\s+/g, ' ')
        .replace(/([.!?])(?=\S)/g, '$1 ')
        .trim()
        .slice(0, 700);
    }

    function appendActivityCommentary(items, value) {
      const text = normalizeActivityCommentary(value);
      if (!text) return items;
      const last = items[items.length - 1];
      if (!last) return [{ label: 'Thinking through the path', note: text, kind: 'note' }];
      if (String(last.note || '').toLowerCase().includes(text.toLowerCase())) return items;
      last.note = [last.note, text].filter(Boolean).join(' ');
      return items;
    }

    function activityStepsFromToolNames(toolNames = []) {
      return Array.from(new Set((toolNames || []).map(activityMessageFromToolName).filter(Boolean)))
        .map((label) => ({ label, note: '' }));
    }

    function renderActivityLog(steps = [], options = {}) {
      const commentary = (options.commentary || []).filter(Boolean).map((note) => ({ label: 'Thinking through the path', note, kind: 'note' }));
      const list = (steps || []).filter(Boolean).map((step) => {
        if (typeof step === 'string') return { label: step, note: '' };
        return {
          label: String(step.label || step.text || '').trim(),
          note: String(step.note || '').trim(),
          kind: step.kind || ''
        };
      }).filter((step) => step.label || step.note).concat(commentary);
      if (!list.length && !commentary.length) return '';
      const activeIndex = options.active ? list.length - 1 : -1;
      const activityLabel = options.label || 'Archive Work';
      const stepCount = list.length;
      const items = list.map((step, index) => {
        const state = index === activeIndex ? ' is-active' : ' is-complete';
        const rawLabel = step.label || 'Thinking through the path';
        const label = index === activeIndex && rawLabel.startsWith('Checked ') ? `Checking ${rawLabel.slice(8)}` : rawLabel;
        const note = step.note ? `<p class="librarian-activity-note">${renderInlineMarkdown(step.note, new Map())}</p>` : '';
        return `<li class="librarian-activity-step${state}">`
          + `<div class="librarian-activity-step-main"><span class="librarian-activity-dot" aria-hidden="true"></span><span>${escapeHtml(label)}</span></div>`
          + note
          + `</li>`;
      }).join('');
      const body = (items ? `<ol>${items}</ol>` : '');
      if (!options.active && options.collapsible) {
        const summary = `${stepCount} ${stepCount === 1 ? 'step' : 'steps'} completed`;
        return `<details class="librarian-activity is-collapsed" aria-label="Thingy activity">`
          + `<summary><span class="librarian-activity-kicker">${escapeHtml(activityLabel)}</span><span class="librarian-activity-summary">${escapeHtml(summary)}</span></summary>`
          + body
          + `</details>`;
      }
      return `<aside class="librarian-activity" aria-label="Thingy activity">`
        + `<div class="librarian-activity-kicker">${escapeHtml(activityLabel)}</div>`
        + body
        + `</aside>`;
    }

    function renderAssistantResponse(answer, citations = [], experience = null, activitySteps = [], activityCommentary = [], options = {}) {
      const hasAnswer = String(answer || '').trim() || experience;
      const activity = renderActivityLog(activitySteps, { ...options, commentary: activityCommentary, collapsible: Boolean(hasAnswer) });
      if (!hasAnswer) return activity || renderAnswer(answer, citations, experience);
      return `${activity}<div class="librarian-answer-content">${renderAnswer(answer, citations, experience)}</div>`;
    }

    function setFeedbackState(container, reaction) {
      container.querySelectorAll('button[data-reaction]').forEach((button) => {
        const selected = button.dataset.reaction === reaction;
        button.classList.toggle('selected', selected);
        button.setAttribute('aria-pressed', selected ? 'true' : 'false');
      });
    }

    async function submitFeedback(requestId, reaction, container, comment = '') {
      const status = container.querySelector('.librarian-feedback-status');
      container.querySelectorAll('button[data-reaction]').forEach((button) => {
        button.disabled = true;
      });
      if (status) status.textContent = 'Saving...';
      try {
        const data = await postStreamJson('/feedback', {
          request_id: requestId,
          reaction,
          comment
        }, { authorization: `Bearer ${token()}` });
        setFeedbackState(container, data.reaction || reaction);
        if (status) status.textContent = 'Saved';
        window.clearTimeout(feedbackStatusTimer);
        feedbackStatusTimer = window.setTimeout(() => {
          if (status && status.textContent === 'Saved') status.textContent = '';
        }, 1800);
        trackTinylyticsEvent('librarian.feedback_submit', data.reaction || reaction);
        if (comment) trackTinylyticsEvent('librarian.feedback_comment', reaction);
      } catch (error) {
        if (status) status.textContent = 'Could not save';
        trackTinylyticsEvent('librarian.feedback_error', error.requestId ? 'server' : 'client');
      } finally {
        container.querySelectorAll('button[data-reaction]').forEach((button) => {
          button.disabled = false;
        });
      }
    }

    function buildSharePromptUrl(prompt, scope) {
      const url = new URL('/chat/', window.location.origin);
      url.searchParams.set('prompt', prompt);
      // Always encode the scope so a shared link reproduces the exact corpus
      // boundary used for this turn.
      url.searchParams.set('scope', scope || 'all');
      return url.toString();
    }

    function actionIcon(name) {
      const icons = {
        copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>',
        play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7-11-7z"></path></svg>',
        pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14"></path><path d="M16 5v14"></path></svg>',
        up: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10v11"></path><path d="M15 5.5 14 10h5.7a2 2 0 0 1 2 2.3l-1.2 7a2 2 0 0 1-2 1.7H7"></path><path d="M7 10H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3"></path><path d="M14 10V5.5a2.5 2.5 0 0 0-5 0L7 10"></path></svg>',
        down: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 14V3"></path><path d="M15 18.5 14 14h5.7a2 2 0 0 0 2-2.3l-1.2-7A2 2 0 0 0 18.5 3H7"></path><path d="M7 14H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3"></path><path d="M14 14v4.5a2.5 2.5 0 0 1-5 0L7 14"></path></svg>',
        share: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7"></path><path d="M12 16V3"></path><path d="m7 8 5-5 5 5"></path></svg>'
      };
      return icons[name] || '';
    }

    async function copyToClipboard(value) {
      if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') return false;
      try {
        await navigator.clipboard.writeText(value);
        return true;
      } catch (error) {
        return false;
      }
    }

    function answerClipboardPayload(messageElement) {
      const clone = messageElement.cloneNode(true);
      clone.querySelectorAll('.librarian-feedback, .librarian-prompt-actions, .librarian-activity').forEach((node) => node.remove());
      clone.querySelectorAll('[aria-hidden="true"]').forEach((node) => node.remove());
      clone.querySelectorAll('a[href]').forEach((link) => {
        try {
          link.setAttribute('href', new URL(link.getAttribute('href'), window.location.origin).toString());
        } catch (error) { /* leave original href */ }
      });
      const scratch = document.createElement('div');
      scratch.setAttribute('aria-hidden', 'true');
      scratch.style.position = 'fixed';
      scratch.style.left = '-9999px';
      scratch.style.top = '0';
      scratch.style.width = '720px';
      scratch.appendChild(clone);
      document.body.appendChild(scratch);
      const html = clone.innerHTML.trim();
      const text = (clone.innerText || clone.textContent || '').trim();
      scratch.remove();
      return { html, text };
    }

    function speechOutputSupported() {
      return 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance === 'function';
    }

    function setSpeechButtonState(button, playing) {
      if (!button) return;
      button.classList.toggle('selected', playing);
      button.setAttribute('aria-label', playing ? 'Stop reading answer' : 'Read answer aloud');
      button.title = playing ? 'Stop reading answer' : 'Read answer aloud';
      button.innerHTML = actionIcon(playing ? 'pause' : 'play');
    }

    function stopSpeaking() {
      if (speechOutputSupported()) window.speechSynthesis.cancel();
      setSpeechButtonState(speechButton, false);
      speechUtterance = null;
      speechButton = null;
    }

    function toggleSpeakAnswer(messageElement, button) {
      if (!speechOutputSupported()) return 'Speech playback not supported';
      if (speechButton === button && speechUtterance) {
        stopSpeaking();
        return 'Stopped';
      }
      stopSpeaking();
      const payload = answerClipboardPayload(messageElement);
      if (!payload.text) return 'Nothing to read';
      const utterance = new window.SpeechSynthesisUtterance(payload.text);
      utterance.lang = document.documentElement.lang || navigator.language || 'en-US';
      utterance.rate = 1;
      utterance.pitch = 1;
      utterance.onend = () => {
        if (speechUtterance === utterance) stopSpeaking();
      };
      utterance.onerror = () => {
        if (speechUtterance === utterance) stopSpeaking();
      };
      speechUtterance = utterance;
      speechButton = button;
      setSpeechButtonState(button, true);
      window.speechSynthesis.speak(utterance);
      return 'Reading';
    }

    function legacyCopyRichHtml(html, text) {
      if (typeof document.execCommand !== 'function') return false;
      const scratch = document.createElement('div');
      scratch.contentEditable = 'true';
      scratch.setAttribute('aria-hidden', 'true');
      scratch.style.position = 'fixed';
      scratch.style.left = '-9999px';
      scratch.style.top = '0';
      scratch.innerHTML = html;
      document.body.appendChild(scratch);

      const selection = window.getSelection();
      const previousRange = selection && selection.rangeCount ? selection.getRangeAt(0) : null;
      const range = document.createRange();
      range.selectNodeContents(scratch);
      selection.removeAllRanges();
      selection.addRange(range);

      const onCopy = (event) => {
        event.clipboardData.setData('text/html', html);
        event.clipboardData.setData('text/plain', text);
        event.preventDefault();
      };

      document.addEventListener('copy', onCopy);
      let copied = false;
      try {
        copied = document.execCommand('copy');
      } catch (error) {
        copied = false;
      } finally {
        document.removeEventListener('copy', onCopy);
        selection.removeAllRanges();
        if (previousRange) selection.addRange(previousRange);
        scratch.remove();
      }
      return copied;
    }

    async function copyRichHtmlToClipboard(html, text) {
      const normalizedHtml = String(html || '').trim();
      const normalizedText = String(text || '').trim();
      if (!normalizedHtml && !normalizedText) return 'empty';
      if (navigator.clipboard && typeof navigator.clipboard.write === 'function' && typeof ClipboardItem === 'function') {
        try {
          await navigator.clipboard.write([
            new ClipboardItem({
              'text/html': new Blob([normalizedHtml], { type: 'text/html' }),
              'text/plain': new Blob([normalizedText], { type: 'text/plain' })
            })
          ]);
          return 'rich';
        } catch (error) { /* fall through */ }
      }
      if (legacyCopyRichHtml(normalizedHtml, normalizedText)) return 'rich';
      if (await copyToClipboard(normalizedText)) return 'plain';
      return 'failed';
    }

    function flashActionStatus(container, message) {
      const status = container.querySelector('.librarian-feedback-status');
      if (!status) return;
      status.textContent = message;
      window.clearTimeout(feedbackStatusTimer);
      feedbackStatusTimer = window.setTimeout(() => {
        if (status.textContent === message) status.textContent = '';
      }, 1800);
    }

    async function copyAnswerRichText(messageElement) {
      const payload = answerClipboardPayload(messageElement);
      const result = await copyRichHtmlToClipboard(payload.html, payload.text);
      if (result === 'rich') return 'Rich text copied';
      if (result === 'plain') return 'Text copied';
      if (result === 'empty') return 'Nothing to copy';
      return 'Could not copy';
    }

    async function shareAnswer(messageElement) {
      const payload = answerClipboardPayload(messageElement);
      if (!payload.text && !payload.html) return 'Nothing to share';
      if (typeof navigator.share === 'function') {
        try {
          await navigator.share({ title: 'Thingy answer', text: payload.text });
          trackTinylyticsEvent('librarian.answer_share_native');
          return 'Shared';
        } catch (error) {
          if (error && error.name === 'AbortError') return '';
        }
      }
      const result = await copyRichHtmlToClipboard(payload.html, payload.text);
      if (result === 'rich') return 'Rich text copied';
      if (result === 'plain') return 'Text copied';
      return 'Could not share';
    }

    async function sharePrompt(prompt, scope) {
      const shareUrl = buildSharePromptUrl(prompt, scope);
      if (typeof navigator.share === 'function') {
        try {
          await navigator.share({ title: 'Ask Thingy', text: prompt, url: shareUrl });
          trackTinylyticsEvent('librarian.share_native');
          return 'Shared';
        } catch (error) {
          if (error && error.name === 'AbortError') return '';
        }
      }
      const copied = await copyToClipboard(shareUrl);
      if (copied) {
        trackTinylyticsEvent('librarian.share_copy');
        return 'Link copied';
      }
      return 'Could not copy';
    }

    async function copyPrompt(prompt) {
      const copied = await copyToClipboard(prompt);
      if (copied) {
        trackTinylyticsEvent('librarian.prompt_copy');
        return 'Prompt copied';
      }
      return 'Could not copy';
    }

    function addPromptActions(messageElement, prompt, scope) {
      if (!prompt) return;
      const controls = document.createElement('div');
      controls.className = 'librarian-prompt-actions';
      controls.innerHTML = `
        <button type="button" data-action="copy" aria-label="Copy prompt" title="Copy prompt">${actionIcon('copy')}</button>
        <button type="button" data-action="share" aria-label="Share prompt" title="Share prompt">${actionIcon('share')}</button>
        <span class="librarian-feedback-status" aria-live="polite"></span>
      `;
      controls.addEventListener('click', async (event) => {
        const target = event.target instanceof Element ? event.target : event.target.parentElement;
        const button = target ? target.closest('button[data-action]') : null;
        if (!button || !controls.contains(button)) return;
        if (button.dataset.action === 'copy') {
          const message = await copyPrompt(prompt);
          flashActionStatus(controls, message);
          return;
        }
        if (button.dataset.action === 'share') {
          const message = await sharePrompt(prompt, scope);
          if (message) flashActionStatus(controls, message);
        }
      });
      messageElement.appendChild(controls);
    }

    function addResponseActions(messageElement, requestId) {
      if (!requestId) return;
      const controls = document.createElement('div');
      controls.className = 'librarian-feedback';
      const playDisabled = speechOutputSupported() ? '' : ' disabled';
      const playTitle = speechOutputSupported() ? 'Read answer aloud' : 'Speech playback not supported';
      controls.innerHTML = `
        <button type="button" data-action="copy" aria-label="Copy answer" title="Copy answer">${actionIcon('copy')}</button>
        <button type="button" data-action="speak" aria-label="${playTitle}" title="${playTitle}"${playDisabled}>${actionIcon('play')}</button>
        <button type="button" data-reaction="up" aria-label="Good response" aria-pressed="false" title="Good response">${actionIcon('up')}</button>
        <button type="button" data-reaction="down" aria-label="Bad response" aria-pressed="false" title="Bad response">${actionIcon('down')}</button>
        <button type="button" data-action="share" aria-label="Share answer" title="Share answer">${actionIcon('share')}</button>
        <span class="librarian-feedback-status" aria-live="polite"></span>
      `;
      controls.addEventListener('click', async (event) => {
        const target = event.target instanceof Element ? event.target : event.target.parentElement;
        const button = target ? target.closest('button') : null;
        if (!button || !controls.contains(button)) return;
        if (button.dataset.reaction) {
          if (button.classList.contains('selected')) return;
          let comment = '';
          if (button.dataset.reaction === 'down') {
            const value = window.prompt('What went wrong?');
            if (value === null) return;
            comment = value.trim().slice(0, 1000);
          }
          submitFeedback(requestId, button.dataset.reaction, controls, comment);
          return;
        }
        if (button.dataset.action === 'copy') {
          const message = await copyAnswerRichText(messageElement);
          flashActionStatus(controls, message);
          trackTinylyticsEvent('librarian.answer_copy', message === 'Rich text copied' ? 'rich' : message === 'Text copied' ? 'plain' : 'error');
          return;
        }
        if (button.dataset.action === 'speak') {
          const message = toggleSpeakAnswer(messageElement, button);
          if (message && message !== 'Reading' && message !== 'Stopped') flashActionStatus(controls, message);
          trackTinylyticsEvent('librarian.answer_speak', message === 'Reading' ? 'start' : message === 'Stopped' ? 'stop' : 'error');
          return;
        }
        if (button.dataset.action === 'share') {
          const message = await shareAnswer(messageElement);
          if (message) flashActionStatus(controls, message);
          trackTinylyticsEvent('librarian.answer_share', message === 'Shared' ? 'native' : message === 'Rich text copied' ? 'rich' : message === 'Text copied' ? 'plain' : message ? 'error' : 'cancel');
        }
      });
      messageElement.appendChild(controls);
    }

    async function postJson(path, payload, headers = {}) {
      return session.postJson(path, payload, headers);
    }

    async function postStreamJson(path, payload, headers = {}) {
      if (!streamBase) throw new Error('Thingy has not been connected to the archive stream API yet.');
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 60000);
      const response = await fetch(`${streamBase}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(payload),
        signal: controller.signal
      }).catch((error) => {
        if (error.name === 'AbortError') {
          throw new Error('Thingy took too long to respond. Please try again.');
        }
        throw error;
      }).finally(() => {
        window.clearTimeout(timeout);
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = data.error || 'Thingy is unavailable.';
        const error = new Error(data.request_id ? `${message} Reference: ${data.request_id}` : message);
        error.requestId = data.request_id;
        error.status = response.status;
        throw error;
      }
      return data;
    }

    function authHeaders() {
      return session.authHeaders();
    }

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
      if (!entry?.id) return false;
      const normalized = normalizeModeId(mode || entry.mode || 'thingy');
      return normalizeModeId(entry.mode || 'thingy') === normalized
        && Number(entry.turn_count || 0) === 0
        && String(entry.title || '') === newConversationTitle(normalized);
    }

    function emptyConversationDraftKey(entry) {
      if (!entry?.id) return '';
      const normalized = normalizeModeId(entry.mode || 'thingy');
      const title = String(entry.title || '');
      return title === newConversationTitle(normalized) ? `${normalized}:${title}` : '';
    }

    function dedupeEmptyConversationDrafts(list = []) {
      const nonEmptyDraftKeys = new Set(
        list
          .filter((entry) => Number(entry?.turn_count || 0) > 0)
          .map(emptyConversationDraftKey)
          .filter(Boolean)
      );
      const seen = new Map();
      const out = [];
      for (const entry of list) {
        if (!isEmptyConversationDraft(entry)) {
          out.push(entry);
          continue;
        }
        const key = emptyConversationDraftKey(entry);
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
      const now = new Date().toISOString();
      const id = `${localConversationPrefix}${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const shell = {
        id,
        conversation_id: id,
        title: newConversationTitle(normalized),
        preview: '',
        scope: currentScope(),
        mode: normalized,
        created_at: now,
        updated_at: now,
        last_message_at: now,
        turn_count: 0,
        local: true
      };
      conversations = conversations.filter((entry) => !isEmptyConversationDraft(entry, normalized));
      conversations.unshift(shell);
      conversations = dedupeEmptyConversationDrafts(conversations).slice(0, maxRecents);
      setActiveConversation(id);
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
        const row = document.createElement('div');
        row.className = `rail-recent${entry.id === activeConversationId ? ' is-active' : ''}${mode ? ' has-mode' : ''}`;
        row.setAttribute('role', 'listitem');
        if (mode) row.dataset.mode = mode;

        const openButton = document.createElement('button');
        openButton.type = 'button';
        openButton.className = 'rail-recent-open';
        openButton.dataset.id = id;
        openButton.title = modeTitle;
        if (entry.id === activeConversationId) openButton.setAttribute('aria-current', 'true');

        const titleEl = document.createElement('span');
        titleEl.className = 'rail-recent-title';
        titleEl.textContent = title;
        openButton.appendChild(titleEl);
        if (mode) {
          const modeEl = document.createElement('small');
          modeEl.className = 'rail-recent-mode';
          modeEl.setAttribute('aria-label', modeLabelText);
          modeEl.title = modeLabelText;
          modeEl.textContent = modeGlyph(entry.mode);
          openButton.appendChild(modeEl);
        }

        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.className = 'rail-recent-del';
        deleteButton.dataset.action = 'delete-conv';
        deleteButton.dataset.id = id;
        deleteButton.setAttribute('aria-label', 'Delete conversation');
        deleteButton.title = 'Delete conversation';
        deleteButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"></path></svg>';

        row.append(openButton, deleteButton);
        return row;
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
      if (data.token) {
        setToken(data.token, data, options);
        setAuthMessage('');
        trackTinylyticsEvent('librarian.auth_success', data.status || 'active');
        return;
      }
      if (data.status === 'not_found') {
        setAuthMessage(data.message || 'That email is not subscribed. Would you like to be added?');
        showAuthAction('subscribe');
        trackTinylyticsEvent('librarian.auth_not_found');
        return;
      }
      if (data.status === 'unconfirmed') {
        setAuthMessage(data.message || 'Please confirm your email before using Thingy.');
        showAuthAction('resend_confirmation');
        trackTinylyticsEvent('librarian.auth_unconfirmed');
        return;
      }
      if (data.status === 'subscribed') {
        setAuthMessage(data.message || 'Check your inbox to confirm your subscription before using Thingy.');
        hideAuthActions();
        trackTinylyticsEvent('librarian.auth_subscribe_success');
        return;
      }
      if (data.status === 'reminder_sent') {
        setAuthMessage(data.message || 'Confirmation email sent. Check your inbox.');
        hideAuthActions();
        trackTinylyticsEvent('librarian.auth_reminder_success');
        return;
      }
      if (data.status === 'magic_link_sent') {
        setAuthMessage(data.message || 'Check your email for a sign-in link to Thingy.');
        hideAuthActions();
        trackTinylyticsEvent('librarian.auth_magic_link_sent');
        return;
      }
      if (data.status === 'magic_link_invalid') {
        setAuthMessage(data.error || data.message || 'That sign-in link is invalid or expired. Enter your email to get a fresh link.');
        hideAuthActions();
        trackTinylyticsEvent('librarian.auth_magic_link_invalid');
        return;
      }
      setAuthMessage(data.message || 'I could not verify active subscriber access for that email.');
      hideAuthActions();
      trackTinylyticsEvent('librarian.auth_inactive');
    }

    function readAttribution() {
      try {
        if (typeof window.weeklyThingAttribution === 'function') {
          return window.weeklyThingAttribution() || undefined;
        }
      } catch (err) { /* ignore */ }
      return undefined;
    }

    async function submitAuthAction(action, button) {
      if (!validateEmail()) return;
      const generation = authRequestGeneration;
      button.disabled = true;
      hideAuthActions();
      setAuthMessage(action === 'subscribe' ? 'Adding you to the Weekly Thing...' : 'Sending the confirmation email...');
      try {
        const payload = { email: emailInput.value, action, source: 'thingy' };
        if (action === 'subscribe' || action === 'resend_confirmation') {
          const attribution = readAttribution();
          if (attribution) payload.attribution = attribution;
        }
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

      let answer = '';
      let citations = [];
      let experience = null;
      let requestId = '';
      let conversationId = isLocalConversationId(activeConversationId) ? '' : (activeConversationId || '');
      let conversation = null;
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 190000);
      const response = await fetch(`${streamBase}/chat`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token()}`
        },
        body: JSON.stringify({
          message,
          scope,
          mode: currentConversationMode(),
          conversation_id: conversationId || undefined,
          client_context: userLocalContext(),
          user_profile: readerProfileContext()
        }),
        signal: controller.signal
      }).catch((error) => {
        if (error.name === 'AbortError') {
          throw new Error('Thingy spent too long in the archive. Please try again with a narrower angle.');
        }
        throw error;
      }).finally(() => {
        window.clearTimeout(timeout);
      });
      if (!response.ok || !response.body) {
        const requestId = response.headers.get('x-request-id') || '';
        const data = await response.json().catch(() => ({}));
        const message = data.error || 'Thingy is unavailable.';
        const error = new Error(requestId ? `${message} Reference: ${requestId}` : message);
        error.requestId = requestId;
        error.status = response.status;
        throw error;
      }

      let renderFrame = 0;
      let activitySteps = [];
      let activityCommentary = [];

      function renderPendingAnswer() {
        renderFrame = 0;
        pending.classList.remove('librarian-message-pending');
        pending.innerHTML = renderAssistantResponse(answer, citations, experience, activitySteps, activityCommentary);
        scheduleChatScroll();
      }

      function schedulePendingRender() {
        if (renderFrame) return;
        renderFrame = window.requestAnimationFrame(renderPendingAnswer);
      }

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
          activitySteps = appendActivityStep(activitySteps, data, 'Thingy is working...');
          pending.classList.add('librarian-message-pending');
          pending.innerHTML = renderAssistantResponse(answer, citations, experience, activitySteps, activityCommentary, { active: true });
          scheduleChatScroll({ force: true });
        } else if (eventName === 'commentary') {
          activityCommentary = appendActivityCommentary(activityCommentary, data.message || data.delta || '');
          pending.classList.add('librarian-message-pending');
          pending.innerHTML = renderAssistantResponse(answer, citations, experience, activitySteps, activityCommentary, { active: true });
          scheduleChatScroll({ force: true });
        } else if (eventName === 'answer_delta') {
          answer += data.delta || '';
          answer = answer.replace(/^\s+/, '');
          schedulePendingRender();
        } else if (eventName === 'answer') {
          answer = data.answer || '';
          schedulePendingRender();
        } else if (eventName === 'citations') {
          citations = data.citations || [];
          schedulePendingRender();
        } else if (eventName === 'experience') {
          experience = data.experience || null;
          schedulePendingRender();
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

      await window.ThingyStream.read(response, applyEvent);
      if (renderFrame) {
        window.cancelAnimationFrame(renderFrame);
        renderPendingAnswer();
      }
      return { answer, citations, experience, request_id: requestId, conversation_id: conversationId, conversation };
    }

    async function postStreamingWelcome(pending, scope, options = {}) {
      if (!streamBase) {
        throw new Error('Thingy has not been connected to the archive stream API yet.');
      }

      let answer = '';
      let experience = null;
      let requestId = '';
      const controller = options.controller || new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 45000);
      const response = await fetch(`${streamBase}/welcome`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token()}`
        },
        body: JSON.stringify({
          scope,
          mode: currentConversationMode(),
          client_context: userLocalContext(),
          user_profile: readerProfileContext()
        }),
        signal: controller.signal
      }).catch((error) => {
        if (error.name === 'AbortError') {
          throw new Error('Thingy took too long to get oriented. Please try asking a question.');
        }
        throw error;
      }).finally(() => {
        window.clearTimeout(timeout);
      });
      if (!response.ok || !response.body) {
        const requestId = response.headers.get('x-request-id') || '';
        const data = await response.json().catch(() => ({}));
        const message = data.error || 'Thingy is unavailable.';
        const error = new Error(requestId ? `${message} Reference: ${requestId}` : message);
        error.requestId = requestId;
        error.status = response.status;
        throw error;
      }

      let renderFrame = 0;
      let activitySteps = [];
      let activityCommentary = [];

      function renderPendingWelcome() {
        renderFrame = 0;
        pending.classList.remove('librarian-message-pending');
        pending.innerHTML = renderAssistantResponse(answer, [], experience, activitySteps, activityCommentary, { label: 'Session Setup' });
        scheduleChatScroll();
      }

      function scheduleWelcomeRender() {
        if (renderFrame) return;
        renderFrame = window.requestAnimationFrame(renderPendingWelcome);
      }

      function applyEvent(eventName, data) {
        if (eventName === 'meta') {
          requestId = data.request_id || requestId;
          if (data.mode) {
            activeMode = data.mode;
            renderModeControl();
          }
        } else if (eventName === 'status') {
          activitySteps = appendActivityStep(activitySteps, data, 'Thingy is getting oriented...');
          pending.classList.add('librarian-message-pending');
          pending.innerHTML = renderAssistantResponse(answer, [], experience, activitySteps, activityCommentary, { active: true, label: 'Session Setup' });
          scheduleChatScroll({ force: true });
        } else if (eventName === 'commentary') {
          activityCommentary = appendActivityCommentary(activityCommentary, data.message || data.delta || '');
          pending.classList.add('librarian-message-pending');
          pending.innerHTML = renderAssistantResponse(answer, [], experience, activitySteps, activityCommentary, { active: true, label: 'Session Setup' });
          scheduleChatScroll({ force: true });
        } else if (eventName === 'answer_delta') {
          answer += data.delta || '';
          answer = answer.replace(/^\s+/, '');
          scheduleWelcomeRender();
        } else if (eventName === 'answer') {
          answer = data.answer || '';
          scheduleWelcomeRender();
        } else if (eventName === 'experience') {
          experience = data.experience || null;
          scheduleWelcomeRender();
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

      await window.ThingyStream.read(response, applyEvent);
      if (renderFrame) {
        window.cancelAnimationFrame(renderFrame);
        renderPendingWelcome();
      }
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
        const suppliedName = extractPreferredName(message);
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

    composerControls = window.ThingyComposer?.createComposer({
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

    dictationControls = window.ThingyVoice?.createDictationController({
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
    const accountControls = window.ThingyAccount.createAccountMenu({
      session,
      button: accountBtn,
      menu: accountMenu,
      nameForm: accountNameForm,
      nameInput: accountNameInput,
      nameStatus: accountNameStatus,
      logoutButton,
      normalizeName: window.ThingyAccount.normalizePreferredName,
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
