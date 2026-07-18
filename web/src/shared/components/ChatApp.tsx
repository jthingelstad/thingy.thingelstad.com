import { render, type JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import * as session from '../thingy-session.ts';
import { normalizePreferredName } from '../thingy-account.ts';
import { createTinylyticsTracker } from '../thingy-analytics.ts';
import { chatState as state, createChatActions } from '../thingy-chat-actions.ts';
import { conversationViewMessages } from '../thingy-chat-history.ts';
import { createChatInteractions } from '../thingy-chat-interactions.ts';
import { librarianStreamUrl, tinylyticsId } from '../thingy-config.ts';
import { resolveFromValue } from '../thingy-from.ts';
import { normalizeModeId, normalizeModes } from '../thingy-modes.ts';
import { createAssistantMessageModel } from '../models/assistant-message.ts';
import { normalizeScopeParam, scopeForSources, sourcesForScope } from '../thingy-scope.ts';
import { createDictationController, speechInputSupported } from '../thingy-voice.ts';
import { DEFAULT_WELCOME, createChatWelcomeController } from '../thingy-chat-welcome.ts';
import {
  activeConversationId,
  activeMode,
  authAction,
  authEmail,
  availableModes,
  chatMessages,
  hasSources,
  interactionBusy,
  questionText,
  selectedSources,
  welcomeInFlight
} from '../stores/chat-store.ts';
import {
  accountMenuOpen,
  accountNameStatus,
  mobileRailOpen,
  railCollapsed,
  showNotice,
  signedIn
} from '../stores/ui-store.ts';
import { AccountMenu } from './AccountMenu.tsx';
import { focusAuthEmail } from './AuthPanel.tsx';
import { ChatConversationView } from './ChatConversationView.tsx';
import { ChatRail } from './ChatNavigation.tsx';
import { Notice } from './Notice.tsx';
import { MobileRailScrim } from './MobileRailScrim.tsx';
import { useMeasuredComposer, usePersistedBooleanSignal } from '../hooks/useThingyBrowserUi.ts';

const MAX_QUESTION_CHARS = 1200;
const MAX_RECENTS = 20;
const COLLAPSED_KEY = 'thingyRailCollapsed';
let messageCounter = 0;

function nextMessageId(prefix: string) {
  messageCounter += 1;
  return `${prefix}-${messageCounter}`;
}

function ChatApp() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const chatPanelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const actionsRef = useRef<ReturnType<typeof createChatActions> | null>(null);
  const dictationRef = useRef<ReturnType<typeof createDictationController> | null>(null);
  const welcomeControllerRef = useRef<ReturnType<typeof createChatWelcomeController> | null>(null);
  const initialPromptSubmittedRef = useRef(false);
  const autoFollowRef = useRef(true);
  const scrollFrameRef = useRef(0);
  const [booted, setBooted] = useState(false);
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [dictationListening, setDictationListening] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState('');
  const [, setViewVersion] = useState(0);
  const initialRef = useRef<{
    email: string;
    loginToken: string;
    prompt: string;
    hasPrompt: boolean;
    scope: string;
    from: ReturnType<typeof resolveFromValue>;
  } | null>(null);

  if (!initialRef.current) {
    const params = new URLSearchParams(window.location.search);
    const prompt = String(params.get('prompt') || '')
      .trim()
      .slice(0, MAX_QUESTION_CHARS);
    const scope = normalizeScopeParam(params.get('scope')) || normalizeScopeParam(params.get('corpus')) || 'all';
    initialRef.current = {
      email: session.normalizeEmail(params.get('email')),
      loginToken: String(params.get('login_token') || params.get('magic_token') || '').trim(),
      prompt,
      hasPrompt: Boolean(prompt),
      scope,
      from: resolveFromValue(params.get('from'))
    };
    selectedSources.value = sourcesForScope(scope);
    hasSources.value = selectedSources.value.length > 0;
    if (initialRef.current.email) authEmail.value = initialRef.current.email;
  }
  const initial = initialRef.current;
  const analytics = useMemo(() => createTinylyticsTracker({ enabled: Boolean(tinylyticsId()) }), []);

  function track(name: string, value = '') {
    analytics.track(name, value);
  }

  function currentScope() {
    return scopeForSources(selectedSources.value);
  }

  function nearBottom() {
    const scroll = scrollRef.current;
    return !scroll || scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 64;
  }

  function scheduleChatScroll(options: { force?: boolean } = {}) {
    const scroll = scrollRef.current;
    if (!scroll) return;
    if (!options.force && welcomeInFlight.value && window.matchMedia('(width <= 640px)').matches) return;
    if (!options.force && !autoFollowRef.current && !nearBottom()) return;
    autoFollowRef.current = true;
    if (scrollFrameRef.current) return;
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = 0;
      if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    });
  }

  function resetMessages() {
    chatMessages.value = [];
  }

  function addUserMessage(prompt: string, scope: string) {
    chatMessages.value = [...chatMessages.value, { id: nextMessageId('user'), role: 'user', prompt, scope }];
    scheduleChatScroll({ force: true });
  }

  function addAssistantMessage(options: AssistantMessageOptions = {}) {
    const model = createAssistantMessageModel(options);
    const id = model.id || nextMessageId('assistant');
    chatMessages.value = [...chatMessages.value, { id, role: 'assistant', model }];
    scheduleChatScroll({ force: true });
    return { id, model };
  }

  function setQuestion(value: string) {
    questionText.value = value.slice(0, MAX_QUESTION_CHARS);
  }

  function cancelWelcome() {
    welcomeControllerRef.current?.cancel();
  }

  if (!actionsRef.current) {
    actionsRef.current = createChatActions({
      session,
      streamBase: librarianStreamUrl(),
      maxRecents: MAX_RECENTS,
      ui: {
        currentScope,
        scheduleChatScroll,
        track,
        onModesChanged: () => setViewVersion((value) => value + 1),
        onActiveConversationChanged: () => setViewVersion((value) => value + 1),
        onQuestionStateChanged: () => setViewVersion((value) => value + 1),
        onAuthenticated: () => {
          resetMessages();
          actionsRef.current?.refreshConversations().then(() => {
            if (initial.hasPrompt) {
              actionsRef.current?.setActiveConversation('');
              void maybeSubmitInitialPrompt();
              return;
            }
            if (!state.activeConversationId) void startAgentWelcome();
          });
          inputRef.current?.focus();
        },
        onAuthCleared: () => {
          welcomeControllerRef.current?.reset();
          focusAuthEmail();
        }
      }
    });
  }
  const actions = actionsRef.current;
  if (!welcomeControllerRef.current) {
    welcomeControllerRef.current = createChatWelcomeController({
      canStart: () =>
        Boolean(actions.token() && !interactionBusy.value && !welcomeInFlight.value && !initial.hasPrompt),
      ensureFreshToken: () => actions.ensureFreshToken(),
      prepareProfile: () => actions.setAwaitingName(!state.preferredName),
      createMessage: () =>
        addAssistantMessage({
          content: DEFAULT_WELCOME,
          label: 'Session Setup',
          statusFallback: 'Thingy is finding a thread from the archive...'
        }),
      removeMessage: (id) => {
        chatMessages.value = chatMessages.value.filter((message) => message.id !== id);
      },
      stream: (model, controller) => actions.postStreamingWelcome(model, currentScope(), { controller }),
      setInFlight: (value) => (welcomeInFlight.value = value),
      track
    });
  }
  const isSignedIn = signedIn.value;
  const busy = interactionBusy.value;
  const currentText = questionText.value;
  const sourceValues = selectedSources.value;
  const sourcesAvailable = sourceValues.length > 0;
  const activeId = activeConversationId.value;
  const activeConversation = actions.activeConversation();
  const conversationTitle = actions.currentConversationTitle();
  const modes = availableModes.value;
  const selectedMode = modes.some((mode) => mode.id === activeMode.value) ? activeMode.value : 'thingy';
  const selectedModeLabel = actions.modeLabel(selectedMode);
  const currentMode = actions.currentConversationMode();
  const showModeUi = isSignedIn && modes.length > 1;
  const showModeBanner = showModeUi && currentMode !== 'thingy';
  const mobileOpen = mobileRailOpen.value;
  const collapsed = railCollapsed.value;
  const canMapDraft =
    Boolean(currentText.trim()) && currentText.length <= MAX_QUESTION_CHARS && sourcesAvailable && isSignedIn;
  const shellClass = [
    'thingy-app-shell',
    !booted ? 'is-booting' : '',
    !isSignedIn ? 'is-auth' : '',
    collapsed ? 'is-collapsed' : '',
    mobileOpen ? 'is-mobile-rail-open' : ''
  ]
    .filter(Boolean)
    .join(' ');

  usePersistedBooleanSignal(railCollapsed, COLLAPSED_KEY, collapsed);
  useMeasuredComposer(inputRef, composerRef, chatPanelRef, currentText, isSignedIn);

  useEffect(() => {
    signedIn.value = Boolean(actions.token()) && !actions.tokenExpired();
    const storedProfile = actions.userProfile();
    state.preferredName = String(storedProfile.preferred_name || '').trim();
    state.availableModes = normalizeModes(storedProfile.modes || []);
    if (!state.availableModes.length) state.availableModes = [{ id: 'thingy', label: 'Thingy' }];
    if (!state.availableModes.some((mode) => mode.id === state.activeMode)) state.activeMode = 'thingy';
    actions.refreshAccountIdentity();
    setBooted(true);

    if (initial.loginToken) {
      window.location.href = session.signInUrl();
      track('librarian.auth_magic_link_start');
    } else if (actions.token()) {
      if (actions.tokenExpired()) {
        actions.redirectToSignIn();
        track('librarian.session_expired_startup');
      } else {
        signedIn.value = true;
        void actions.refreshAccountProfile({ force: true });
        const savedActiveId = actions.savedActiveConversation();
        actions.refreshConversations().then((list) => {
          if (initial.hasPrompt) {
            startBlankConversation();
            void maybeSubmitInitialPrompt();
            return;
          }
          const saved = savedActiveId && list.some((entry) => entry.id === savedActiveId) ? savedActiveId : '';
          if (saved) void loadConversation(saved);
          else void startAgentWelcome();
        });
        track('librarian.session_resume');
      }
    } else {
      window.location.href = session.signInUrl();
      track(initial.email ? 'librarian.auth_auto_start' : 'librarian.auth_redirect');
    }
    // Route bootstrap must run once for the lifetime of this root.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isSignedIn) return undefined;
    dictationRef.current = createDictationController({
      maxChars: MAX_QUESTION_CHARS,
      isBusy: () => interactionBusy.value,
      getText: () => questionText.value,
      onText: setQuestion,
      onStatus: setVoiceStatus,
      onListeningChange: setDictationListening,
      onTrack: track
    });
    return () => {
      dictationRef.current?.dispose();
      dictationRef.current = null;
    };
    // Dictation owns a browser SpeechRecognition instance and is recreated
    // only when the authenticated composer mounts or unmounts.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn]);

  useEffect(() => {
    function closeMenus(event: MouseEvent) {
      const target = event.target instanceof Element ? event.target : null;
      if (!target?.closest('.rail-newchat-mode')) setModeMenuOpen(false);
      if (!target?.closest('.mobile-chatbar-actions')) setMobileMenuOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        void newConversation();
        return;
      }
      if (event.key !== 'Escape') return;
      setModeMenuOpen(false);
      setMobileMenuOpen(false);
      accountMenuOpen.value = false;
      accountNameStatus.value = '';
      mobileRailOpen.value = false;
    }
    function refreshProfile() {
      void actions.refreshAccountProfile();
    }
    function onVisibility() {
      if (!document.hidden) refreshProfile();
    }
    function onStorage(event: StorageEvent) {
      if (event.key !== null && event.key !== session.storageKey) return;
      const hasToken = Boolean(actions.token());
      if (!hasToken && signedIn.value) {
        actions.stopActiveAnswer();
        actions.clearAuthState({ message: 'You signed out of Thingy in another tab.' });
        track('librarian.session_synced_signout');
      } else if (hasToken && !signedIn.value) {
        window.location.reload();
      }
    }
    document.addEventListener('click', closeMenus);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', refreshProfile);
    window.addEventListener('storage', onStorage);
    return () => {
      document.removeEventListener('click', closeMenus);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', refreshProfile);
      window.removeEventListener('storage', onStorage);
      if (scrollFrameRef.current) window.cancelAnimationFrame(scrollFrameRef.current);
      welcomeControllerRef.current?.cancel();
      actions.stopActiveAnswer();
    };
    // Global lifecycle listeners are bound once to the route's stable action
    // service; signal reads inside the handlers remain current.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [actions]);

  async function startAgentWelcome() {
    await welcomeControllerRef.current?.start();
  }

  function startBlankConversation() {
    actions.setActiveConversation('');
    setQuestion('');
    resetMessages();
  }

  function startNewConversation(mode = state.activeMode) {
    state.activeMode = normalizeModeId(mode);
    const shell = actions.createLocalConversationShell(state.activeMode);
    setQuestion('');
    resetMessages();
    return shell;
  }

  async function newConversation() {
    if (interactionBusy.value) return;
    cancelWelcome();
    welcomeControllerRef.current?.markShown();
    const shell = startNewConversation(state.activeMode);
    await actions.createConversationShellForMode(state.activeMode, { replaceId: shell?.id });
    setMobileMenuOpen(false);
    mobileRailOpen.value = false;
    inputRef.current?.focus();
    track('librarian.clear');
  }

  async function chooseMode(value: string) {
    if (interactionBusy.value) return;
    const nextMode = normalizeModeId(value);
    if (!state.availableModes.some((mode) => mode.id === nextMode)) return;
    if (nextMode === state.activeMode && !state.activeConversationId) return;
    state.activeMode = nextMode;
    welcomeControllerRef.current?.reset();
    const shell = startNewConversation(nextMode);
    setModeMenuOpen(false);
    const conversation = await actions.createConversationShellForMode(nextMode, { replaceId: shell?.id });
    mobileRailOpen.value = false;
    if (nextMode === 'thingy' || conversation) void startAgentWelcome();
    track('librarian.mode_change', nextMode);
  }

  async function loadConversation(id: string) {
    if (interactionBusy.value || !id) return;
    cancelWelcome();
    if (actions.isLocalConversationId(id)) {
      actions.setActiveConversation(id);
      setQuestion('');
      resetMessages();
      inputRef.current?.focus();
      return;
    }
    try {
      const data = await actions.fetchConversation(id);
      actions.setActiveConversation(id);
      if (data.conversation) actions.upsertConversationSummary(data.conversation);
      if (data.conversation?.mode) state.activeMode = data.conversation.mode;
      chatMessages.value = conversationViewMessages({
        messages: data.messages || [],
        currentScope,
        nextMessageId
      });
      setQuestion('');
      scheduleChatScroll({ force: true });
      inputRef.current?.focus();
    } catch (_error) {
      showNotice('Could not load that conversation. Please try again.');
      track('librarian.conversations_error', 'get');
    }
  }

  async function deleteConversation(id: string) {
    if (interactionBusy.value || !id || !window.confirm('Delete this conversation?')) return;
    const wasLocal = actions.isLocalConversationId(id);
    const result = await actions.deleteConversation(id);
    if (!result.ok) return;
    if (result.wasActive) {
      if (wasLocal) startBlankConversation();
      else await newConversation();
    }
    track('librarian.conversation_delete');
  }

  async function renameActiveConversation() {
    const conversation = actions.activeConversation();
    if (!conversation || interactionBusy.value) return;
    setMobileMenuOpen(false);
    const current = conversation.title || 'Untitled chat';
    const title = window.prompt('Rename conversation', current)?.trim();
    if (!title || title === current) return;
    await actions.renameConversation(conversation.id, title);
  }

  async function deleteActiveConversation() {
    const conversation = actions.activeConversation();
    if (!conversation) return;
    setMobileMenuOpen(false);
    await deleteConversation(conversation.id);
    mobileRailOpen.value = false;
  }

  const interactions = createChatInteractions({
    actions,
    maxQuestionChars: MAX_QUESTION_CHARS,
    currentScope,
    cancelWelcome,
    markWelcomeShown: () => welcomeControllerRef.current?.markShown(),
    resetMessages,
    setQuestion,
    addUserMessage,
    addAssistantMessage,
    stopDictation: () => {
      if (dictationRef.current?.isListening()) dictationRef.current.stop();
    },
    focusInput: () => inputRef.current?.focus(),
    track
  });

  async function maybeSubmitInitialPrompt() {
    if (!initial.prompt || initialPromptSubmittedRef.current || interactionBusy.value || !actions.token()) return;
    initialPromptSubmittedRef.current = true;
    setQuestion(initial.prompt);
    await Promise.resolve();
    await interactions.submitQuestion();
  }

  function handleSubmit(event: JSX.TargetedSubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    void interactions.submitQuestion();
  }

  const speechSupported = speechInputSupported();
  const hasActiveConversation = Boolean(activeId && activeConversation);

  return (
    <>
      <section class="thingy-page">
        <div class={shellClass} id="thingy-app-shell">
          <ChatRail
            collapsed={collapsed}
            busy={busy}
            showModeUi={showModeUi}
            modeMenuOpen={modeMenuOpen}
            selectedMode={selectedMode}
            selectedModeLabel={selectedModeLabel}
            modes={modes}
            sourcesAvailable={isSignedIn && sourcesAvailable}
            onToggleCollapsed={() => (railCollapsed.value = !collapsed)}
            onNewConversation={() => void newConversation()}
            onToggleModeMenu={() => setModeMenuOpen(!modeMenuOpen)}
            onChooseMode={(mode) => void chooseMode(mode)}
            onCuriosityMap={() => void interactions.showCuriosityMap()}
            onOpenConversation={(id) => {
              void loadConversation(id);
              mobileRailOpen.value = false;
            }}
            onDeleteConversation={(id) => void deleteConversation(id)}
            accountMenu={
              <AccountMenu
                session={session}
                signedIn={signedIn}
                returnTo="/chat/"
                normalizeName={normalizePreferredName}
                onSignedOutClick={focusAuthEmail}
                onLogout={() => {
                  actions.clearAuthState({ scrubAuthParams: true });
                  track('librarian.logout');
                }}
                onSaved={(name) => {
                  actions.rememberPreferredName(name);
                  actions.refreshAccountIdentity();
                }}
                onOpen={() => void actions.refreshAccountProfile({ force: true })}
              />
            }
          />

          <MobileRailScrim
            open={mobileOpen}
            label="Close conversations"
            onClose={() => (mobileRailOpen.value = false)}
          />

          <ChatConversationView
            chatPanelRef={chatPanelRef}
            scrollRef={scrollRef}
            composerRef={composerRef}
            inputRef={inputRef}
            mobileOpen={mobileOpen}
            mobileMenuOpen={mobileMenuOpen}
            conversationTitle={conversationTitle}
            busy={busy}
            hasActiveConversation={hasActiveConversation}
            from={initial.from}
            signedIn={isSignedIn}
            showModeBanner={showModeBanner}
            currentMode={currentMode}
            modeLabel={actions.modeLabel}
            currentText={currentText}
            maxQuestionChars={MAX_QUESTION_CHARS}
            dictationListening={dictationListening}
            speechSupported={speechSupported}
            voiceStatus={voiceStatus}
            canMapDraft={canMapDraft}
            sourcesAvailable={sourcesAvailable}
            selectedSources={selectedSources}
            onToggleMobileRail={() => (mobileRailOpen.value = !mobileOpen)}
            onNewConversation={() => void newConversation()}
            onToggleMobileMenu={() => setMobileMenuOpen(!mobileMenuOpen)}
            onRename={() => void renameActiveConversation()}
            onDelete={() => void deleteActiveConversation()}
            onAuthSubmit={() => void actions.submitAuthCheck()}
            onAddSubscriber={() => void actions.submitAuthAction('subscribe')}
            onResendConfirmation={() => void actions.submitAuthAction('resend_confirmation')}
            onAuthEmailInput={() => {
              actions.validateEmail();
              authAction.value = 'none';
            }}
            onScroll={() => (autoFollowRef.current = nearBottom())}
            onRetry={interactions.retryAnswer}
            onEmbeddedPrompt={interactions.embeddedPrompt}
            submitFeedback={interactions.submitFeedback}
            track={track}
            onSubmit={handleSubmit}
            onQuestionInput={setQuestion}
            onDictation={() => dictationRef.current?.start()}
            onMapSeed={(seed) => {
              if (!seed) return;
              void interactions.showCuriosityMap(seed, true);
              track('librarian.curiosity_map_seed', seed.length < 20 ? 'short' : seed.length < 80 ? 'medium' : 'long');
            }}
            onScopeChange={(scope) => {
              hasSources.value = Boolean(scope);
              track('librarian.scope_change', scope || 'none');
            }}
            onStopAnswer={() => {
              actions.stopActiveAnswer();
              track('librarian.answer_stop_click');
            }}
          />
        </div>
      </section>
      <Notice />
    </>
  );
}

function mountChatApp(host: HTMLElement | null) {
  if (!host) return;
  render(<ChatApp />, host);
}

export { mountChatApp };
