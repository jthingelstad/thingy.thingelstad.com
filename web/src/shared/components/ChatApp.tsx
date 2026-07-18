import { render, type JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import * as session from '../thingy-session.ts';
import { extractPreferredNameFromMessage, normalizePreferredName } from '../thingy-account.ts';
import { createTinylyticsTracker } from '../thingy-analytics.ts';
import { activityStepsFromToolNames, renderCuriosityMap } from '../thingy-chat-rendering.ts';
import { chatState as state, createChatActions } from '../thingy-chat-actions.ts';
import { librarianStreamUrl, tinylyticsId } from '../thingy-config.ts';
import { resolveFromValue } from '../thingy-from.ts';
import { modeClass, modeIcon, normalizeModeId, normalizeModes } from '../thingy-modes.ts';
import { createAssistantMessageModel } from '../models/assistant-message.ts';
import { normalizeScopeParam, scopeForSources, sourcesForScope } from '../thingy-scope.ts';
import { createDictationController, speechInputSupported } from '../thingy-voice.ts';
import { errorMessage } from '../thingy-errors.ts';
import { isAuthError } from '../thingy-url.ts';
import {
  activeConversationId,
  activeMode,
  answerInFlight,
  authAction,
  authEmail,
  availableModes,
  chatMessages,
  hasSources,
  interactionBusy,
  mapInFlight,
  questionText,
  selectedSources,
  stoppable,
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
import { AuthPanel, focusAuthEmail } from './AuthPanel.tsx';
import { ChatMessages } from './ChatMessages.tsx';
import { ComposerCount } from './ComposerCount.tsx';
import { ComposerSubmit } from './ComposerSubmit.tsx';
import { Notice } from './Notice.tsx';
import { RailRecents } from './RailRecents.tsx';
import { SourcePicker } from './SourcePicker.tsx';
import { ThingyIcon } from './ThingyIcon.tsx';

const MAX_QUESTION_CHARS = 1200;
const MAX_RECENTS = 20;
const COLLAPSED_KEY = 'thingyRailCollapsed';
let messageCounter = 0;

interface ConversationMessage {
  role?: string;
  content?: string;
  scope?: string;
  artifact?: ThingyCuriosityMap & { kind?: string };
  tool_names?: string[];
  toolNames?: string[];
  request_id?: string;
  requestId?: string;
  citations?: ThingyCitation[];
}

function nextMessageId(prefix: string) {
  messageCounter += 1;
  return `${prefix}-${messageCounter}`;
}

function restoreCollapsedRail() {
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) === '1';
  } catch (_error) {
    return false;
  }
}

function ChatApp() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const chatPanelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const actionsRef = useRef<ReturnType<typeof createChatActions> | null>(null);
  const dictationRef = useRef<ReturnType<typeof createDictationController> | null>(null);
  const welcomeShownRef = useRef(false);
  const welcomeAbortRef = useRef<AbortController | null>(null);
  const welcomeMessageIdRef = useRef('');
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
    welcomeInFlight.value = false;
    welcomeAbortRef.current?.abort();
    welcomeAbortRef.current = null;
    if (welcomeMessageIdRef.current) {
      chatMessages.value = chatMessages.value.filter((message) => message.id !== welcomeMessageIdRef.current);
    }
    welcomeMessageIdRef.current = '';
  }

  function updateComposerMeasurements() {
    const input = inputRef.current;
    if (input) {
      input.style.height = 'auto';
      input.style.height = `${Math.min(input.scrollHeight, 240)}px`;
    }
    const composer = composerRef.current;
    if (composer && chatPanelRef.current) {
      chatPanelRef.current.style.setProperty(
        '--composer-reserve',
        `${Math.ceil(composer.getBoundingClientRect().height)}px`
      );
    }
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
          welcomeShownRef.current = false;
          focusAuthEmail();
        }
      }
    });
  }
  const actions = actionsRef.current;
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

  useEffect(() => {
    railCollapsed.value = restoreCollapsedRail();
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
    try {
      window.localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0');
    } catch (_error) {
      /* private browsing */
    }
  }, [collapsed]);

  useEffect(() => {
    updateComposerMeasurements();
  }, [currentText, isSignedIn]);

  useEffect(() => {
    const composer = composerRef.current;
    if (!composer || !('ResizeObserver' in window)) return undefined;
    const observer = new ResizeObserver(updateComposerMeasurements);
    observer.observe(composer);
    window.addEventListener('resize', updateComposerMeasurements);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateComposerMeasurements);
    };
  }, [isSignedIn]);

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
      welcomeAbortRef.current?.abort();
      actions.stopActiveAnswer();
    };
    // Global lifecycle listeners are bound once to the route's stable action
    // service; signal reads inside the handlers remain current.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [actions]);

  async function startAgentWelcome() {
    if (
      !actions.token() ||
      interactionBusy.value ||
      welcomeInFlight.value ||
      welcomeShownRef.current ||
      initial.hasPrompt
    )
      return;
    if (!(await actions.ensureFreshToken())) return;
    actions.setAwaitingName(!state.preferredName);
    welcomeShownRef.current = true;
    welcomeInFlight.value = true;
    const controller = new AbortController();
    welcomeAbortRef.current = controller;
    const pending = addAssistantMessage({ label: 'Session Setup', statusFallback: 'Thingy is getting oriented...' });
    welcomeMessageIdRef.current = pending.id;
    try {
      await actions.postStreamingWelcome(pending.model, currentScope(), { controller });
      track('librarian.welcome_success');
    } catch (error) {
      if (!welcomeInFlight.value || welcomeMessageIdRef.current !== pending.id) return;
      pending.model.activity.value = [];
      pending.model.commentary.value = [];
      pending.model.content.value =
        "Hi. I'm Thingy. Ask me what you're curious about and I'll help you explore the archive.";
      pending.model.status.value = 'done';
      track('librarian.welcome_error', error instanceof Error && error.requestId ? 'server' : 'client');
    } finally {
      if (welcomeMessageIdRef.current === pending.id) {
        welcomeInFlight.value = false;
        welcomeAbortRef.current = null;
        welcomeMessageIdRef.current = '';
      }
    }
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
    welcomeShownRef.current = true;
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
    welcomeShownRef.current = false;
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
      const next: ThingyChatViewMessage[] = [];
      let lastPrompt = '';
      for (const message of (data.messages || []) as ConversationMessage[]) {
        if (message.role === 'user') {
          lastPrompt = message.content || '';
          next.push({
            id: nextMessageId('user'),
            role: 'user',
            prompt: lastPrompt,
            scope: message.scope || currentScope()
          });
        } else if (message.role === 'assistant') {
          const artifact = message.artifact?.kind === 'curiosity_map' ? renderCuriosityMap(message.artifact) : '';
          const model = createAssistantMessageModel({
            content: message.content || '',
            citations: message.citations || [],
            activity: activityStepsFromToolNames(message.tool_names || message.toolNames || []),
            artifactHtml: artifact,
            status: 'done',
            requestId: message.request_id || message.requestId || ''
          });
          next.push({ id: model.id, role: 'assistant', model, prompt: lastPrompt });
        }
      }
      chatMessages.value = next;
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

  async function showCuriosityMap(center = '', attachToCurrent = false) {
    if (!actions.token() || interactionBusy.value || !(await actions.ensureFreshToken())) return;
    const scope = currentScope();
    if (!scope) return;
    const attach = Boolean(
      attachToCurrent && state.activeConversationId && !actions.isLocalConversationId(state.activeConversationId)
    );
    const conversationId = attach ? state.activeConversationId || '' : '';
    if (!attach) {
      welcomeShownRef.current = true;
      actions.setActiveConversation('');
      resetMessages();
    }
    setQuestion('');
    mapInFlight.value = true;
    mobileRailOpen.value = false;
    const pending = addAssistantMessage({ statusFallback: 'Thingy is drawing connections...' });
    try {
      const response = await actions.postStreamJson(
        '/curiosity-map',
        {
          scope,
          mode: actions.currentConversationMode(),
          center,
          conversation_id: conversationId || undefined,
          user_profile: actions.readerProfileContext()
        },
        actions.authHeaders()
      );
      if (response.conversation_id) actions.setActiveConversation(response.conversation_id);
      if (response.conversation) actions.upsertConversationSummary(response.conversation);
      const map = response as ThingyApiResponse & ThingyCuriosityMap;
      pending.model.artifactHtml.value =
        renderCuriosityMap(map) || '<p>Thingy could not find enough connected threads to draw a map yet.</p>';
      pending.model.status.value = 'done';
      await actions.refreshConversations();
      track('librarian.curiosity_map_success', `${(map.nodes || []).length}.${(map.sources || []).length}`);
    } catch (error) {
      pending.model.errorMessage.value = errorMessage(error, 'Thingy could not draw that map.');
      pending.model.status.value = 'error';
      track('librarian.curiosity_map_error', error instanceof Error && error.requestId ? 'server' : 'client');
      if (isAuthError(error)) actions.redirectToSignIn();
    } finally {
      mapInFlight.value = false;
    }
  }

  async function submitQuestion() {
    if (interactionBusy.value) return;
    cancelWelcome();
    const message = questionText.value.trim();
    if (!message || message.length > MAX_QUESTION_CHARS || !currentScope()) return;
    if (!(await actions.ensureFreshToken())) return;
    if (dictationRef.current?.isListening()) dictationRef.current.stop();
    answerInFlight.value = true;
    const wordCount = message.split(/\s+/).filter(Boolean).length;
    const size = wordCount < 6 ? 'short' : wordCount < 18 ? 'medium' : 'long';
    if (actions.isAwaitingName() && !state.preferredName) {
      const name = extractPreferredNameFromMessage(message);
      if (name) await actions.persistInferredPreferredName(name).catch(() => {});
      actions.setAwaitingName(false);
    }
    const scope = currentScope();
    addUserMessage(message, scope);
    setQuestion('');
    const pending = addAssistantMessage({ statusFallback: 'Thingy is thinking...' });
    const entry = chatMessages.value.find((item) => item.id === pending.id);
    if (entry) entry.prompt = message;
    try {
      const data = await actions.postStreamingChat(message, pending.model, scope);
      if (data.stopped) {
        track('librarian.answer_stopped', String(data.answer || '').trim() || data.experience ? 'partial' : 'empty');
      }
      if (data.conversation_id) actions.setActiveConversation(data.conversation_id);
      if (data.conversation) actions.upsertConversationSummary(data.conversation);
      await actions.refreshConversations();
      if (!data.stopped) track('librarian.answer_success', `${size}.${(data.citations || []).length}`);
    } catch (error) {
      pending.model.errorMessage.value = errorMessage(error, 'Thingy could not answer that question.');
      if (!isAuthError(error)) pending.model.retryPrompt.value = message;
      pending.model.status.value = 'error';
      track('librarian.answer_error', error instanceof Error && error.requestId ? 'server' : 'client');
      if (isAuthError(error)) actions.redirectToSignIn();
    } finally {
      answerInFlight.value = false;
      stoppable.value = false;
      actions.clearAnswerAbortState();
    }
  }

  async function maybeSubmitInitialPrompt() {
    if (!initial.prompt || initialPromptSubmittedRef.current || interactionBusy.value || !actions.token()) return;
    initialPromptSubmittedRef.current = true;
    setQuestion(initial.prompt);
    await Promise.resolve();
    await submitQuestion();
  }

  function retryAnswer(messageId: string, prompt: string) {
    if (interactionBusy.value || !prompt) return;
    const index = chatMessages.value.findIndex((message) => message.id === messageId);
    chatMessages.value = chatMessages.value.filter(
      (_message, messageIndex) => messageIndex !== index && messageIndex !== index - 1
    );
    setQuestion(prompt);
    track('librarian.answer_retry');
    window.setTimeout(() => void submitQuestion(), 0);
  }

  function embeddedPrompt(prompt: string, kind: 'map' | 'experience') {
    if (!prompt || interactionBusy.value) return;
    setQuestion(prompt);
    if (kind === 'map') {
      track('librarian.curiosity_map_prompt', 'map');
      window.setTimeout(() => void submitQuestion(), 0);
    } else {
      inputRef.current?.focus();
      track('librarian.experience_prompt', 'trail');
    }
  }

  async function submitFeedback(input: { requestId: string; reaction: string; comment: string }) {
    return actions.postStreamJson(
      '/feedback',
      { request_id: input.requestId, reaction: input.reaction, comment: input.comment },
      { authorization: `Bearer ${actions.token()}` }
    );
  }

  function handleSubmit(event: JSX.TargetedSubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    void submitQuestion();
  }

  const speechSupported = speechInputSupported();
  const hasActiveConversation = Boolean(activeId && activeConversation);

  return (
    <>
      <section class="thingy-page">
        <div class={shellClass} id="thingy-app-shell">
          <aside class="rail" aria-label="Thingy">
            <div class="rail-top">
              <a
                class="rail-brand"
                href="/"
                aria-label="Thingy home"
                data-tinylytics-event="network.home"
                data-tinylytics-event-value="thingy"
              >
                <img class="rail-mark" src="/img/thingy.png" alt="" width="1022" height="1022" loading="eager" />
              </a>
              <button
                class="rail-iconbtn rail-collapse"
                type="button"
                aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                aria-pressed={collapsed}
                title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                onClick={() => (railCollapsed.value = !collapsed)}
              >
                <ThingyIcon name="panel-left" />
              </button>
            </div>

            <nav class="rail-surface-switch" aria-label="Thingy surfaces">
              <a class="is-active" href="/chat/" aria-current="page">
                <ThingyIcon name="message-square" />
                <span>Chat</span>
              </a>
              <a href="/dispatch/">
                <ThingyIcon name="newspaper" />
                <span>Dispatch</span>
              </a>
            </nav>

            <div class="rail-newchat-combo">
              <button
                class="rail-newchat"
                type="button"
                disabled={busy}
                title="New chat"
                onClick={() => void newConversation()}
              >
                <ThingyIcon name="plus" />
                <span class="label">New chat</span>
                <span class="kbd">⌘K</span>
              </button>
              <div class="rail-newchat-mode" hidden={!showModeUi}>
                <button
                  class="rail-newchat-mode-button"
                  type="button"
                  disabled={busy}
                  aria-haspopup="listbox"
                  aria-expanded={modeMenuOpen}
                  aria-controls="thingy-mode-menu"
                  aria-label={`New chat mode: ${selectedModeLabel}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    setModeMenuOpen(!modeMenuOpen);
                  }}
                >
                  <span class="rail-newchat-mode-icon">
                    <ThingyIcon name={modeIcon(selectedMode)} />
                  </span>
                  <span class="rail-newchat-mode-label">{selectedModeLabel}</span>
                  <span class="rail-newchat-mode-caret">
                    <ThingyIcon name="chevron-down" />
                  </span>
                </button>
                <div
                  class="rail-newchat-mode-menu"
                  id="thingy-mode-menu"
                  hidden={!modeMenuOpen}
                  role="listbox"
                  aria-label="New chat mode"
                >
                  {modes.map((mode) => (
                    <button
                      key={mode.id}
                      type="button"
                      role="option"
                      class="rail-newchat-mode-option"
                      aria-selected={mode.id === selectedMode}
                      onClick={() => void chooseMode(mode.id)}
                    >
                      <span class="rail-newchat-mode-option-icon">
                        <ThingyIcon name={modeIcon(mode.id)} />
                      </span>
                      <span>{mode.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <button
              class="rail-newchat rail-map"
              type="button"
              disabled={busy || !isSignedIn || !sourcesAvailable}
              title="Curiosity map"
              onClick={() => void showCuriosityMap()}
            >
              <ThingyIcon name="network" />
              <span class="label">Curiosity map</span>
            </button>

            <div class="rail-body">
              <p class="rail-recents-label">Recents</p>
              <RailRecents
                maxRecents={MAX_RECENTS}
                onOpen={(id) => {
                  void loadConversation(id);
                  mobileRailOpen.value = false;
                }}
                onDelete={(id) => void deleteConversation(id)}
              />
            </div>

            <div class="rail-account">
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
            </div>
          </aside>

          <button
            type="button"
            class="rail-scrim"
            hidden={!mobileOpen}
            aria-label="Close conversations"
            onClick={() => (mobileRailOpen.value = false)}
          />

          <section class="thingy-conversation" aria-label="Thingy chat">
            <h1 class="sr-only">Thingy chat</h1>
            <div class="mobile-chatbar" aria-label="Conversation">
              <button
                class="mobile-chatbar-circle"
                type="button"
                aria-label={mobileOpen ? 'Hide conversations' : 'Show conversations'}
                aria-expanded={mobileOpen}
                title={mobileOpen ? 'Hide conversations' : 'Show conversations'}
                onClick={() => (mobileRailOpen.value = !mobileOpen)}
              >
                <ThingyIcon name="chevron-left" />
              </button>
              <div class="mobile-chatbar-title">
                <span>{conversationTitle}</span>
              </div>
              <div class="mobile-chatbar-actions">
                <button
                  class="mobile-chatbar-action"
                  type="button"
                  disabled={busy}
                  aria-label="New chat"
                  title="New chat"
                  onClick={() => void newConversation()}
                >
                  <ThingyIcon name="pencil" />
                </button>
                <button
                  class="mobile-chatbar-menu-button"
                  type="button"
                  disabled={!hasActiveConversation || busy}
                  aria-label="Conversation actions"
                  aria-expanded={mobileMenuOpen}
                  aria-controls="mobile-conversation-menu"
                  title={hasActiveConversation ? 'Conversation actions' : 'No conversation actions'}
                  onClick={(event) => {
                    event.stopPropagation();
                    setMobileMenuOpen(!mobileMenuOpen);
                  }}
                >
                  <ThingyIcon name="more-horizontal" />
                </button>
                <div
                  class="mobile-conversation-menu"
                  id="mobile-conversation-menu"
                  hidden={!mobileMenuOpen}
                  role="menu"
                >
                  <button type="button" role="menuitem" onClick={() => void renameActiveConversation()}>
                    Rename
                  </button>
                  <button type="button" role="menuitem" class="danger" onClick={() => void deleteActiveConversation()}>
                    Delete
                  </button>
                </div>
              </div>
            </div>

            {initial.from ? (
              <a class="return-chip" href={initial.from.href} data-tinylytics-event="network.return">
                <ThingyIcon name="arrow-left" />
                <span>
                  Return to <strong>{initial.from.name}</strong>
                </span>
              </a>
            ) : null}

            <div class="librarian-auth thingy-auth" hidden={isSignedIn}>
              <AuthPanel
                onSubmit={() => void actions.submitAuthCheck()}
                onAddSubscriber={() => void actions.submitAuthAction('subscribe')}
                onResendConfirmation={() => void actions.submitAuthAction('resend_confirmation')}
                onEmailInput={() => {
                  actions.validateEmail();
                  authAction.value = 'none';
                }}
              />
            </div>

            <div ref={chatPanelRef} class="librarian-chat thingy-chat" hidden={!isSignedIn}>
              <div ref={scrollRef} class="thingy-chat-scroll" onScroll={() => (autoFollowRef.current = nearBottom())}>
                {showModeBanner ? (
                  <div
                    class="thingy-mode-banner"
                    data-mode={modeClass(currentMode)}
                    aria-live="polite"
                    aria-label={`${actions.modeLabel(currentMode)} mode`}
                  >
                    <span class="thingy-mode-banner-icon">
                      <ThingyIcon name={modeIcon(currentMode)} />
                    </span>
                    <span>{actions.modeLabel(currentMode)}</span>
                  </div>
                ) : null}
                <div class="librarian-messages" aria-live="polite">
                  <ChatMessages
                    scrollContainer={() => scrollRef.current}
                    onRetry={retryAnswer}
                    onEmbeddedPrompt={embeddedPrompt}
                    submitFeedback={submitFeedback}
                    track={track}
                  />
                </div>
              </div>

              <div ref={composerRef} class="thingy-composer-zone">
                <form
                  class={`librarian-form librarian-question-form thingy-input composer-box${busy ? ' is-busy' : ''}`}
                  onSubmit={handleSubmit}
                >
                  <label for="librarian-question" class="sr-only">
                    Ask Thingy
                  </label>
                  <textarea
                    ref={inputRef}
                    id="librarian-question"
                    name="message"
                    rows={1}
                    required
                    maxLength={MAX_QUESTION_CHARS}
                    value={currentText}
                    placeholder="Ask Thingy, or seed a map…"
                    aria-describedby="librarian-question-count librarian-source-error thingy-ai-note"
                    onInput={(event) => setQuestion(event.currentTarget.value)}
                  />
                  <div class="composer-toolbar">
                    <button
                      class={`composer-voice${dictationListening ? ' is-listening' : ''}`}
                      type="button"
                      disabled={!speechSupported || (busy && !dictationListening)}
                      aria-pressed={dictationListening}
                      aria-label={
                        !speechSupported
                          ? 'Speech input not supported'
                          : dictationListening
                            ? 'Stop dictation'
                            : 'Dictate prompt'
                      }
                      title={
                        !speechSupported
                          ? 'Speech input not supported in this browser'
                          : dictationListening
                            ? 'Stop dictation'
                            : 'Dictate prompt'
                      }
                      onClick={() => dictationRef.current?.start()}
                    >
                      <ThingyIcon name="mic" />
                    </button>
                    <button
                      class="composer-map"
                      type="button"
                      disabled={busy || !canMapDraft}
                      aria-label={canMapDraft ? 'Seed curiosity map with this text' : 'Type a topic to seed a map'}
                      title={canMapDraft ? 'Seed curiosity map with this text' : 'Type a topic to seed a map'}
                      onClick={() => {
                        const seed = questionText.value.trim();
                        if (!seed) return;
                        void showCuriosityMap(seed, true);
                        track(
                          'librarian.curiosity_map_seed',
                          seed.length < 20 ? 'short' : seed.length < 80 ? 'medium' : 'long'
                        );
                      }}
                    >
                      <ThingyIcon name="network" />
                      <span>Map</span>
                    </button>
                    <span class="composer-voice-status" aria-live="polite">
                      {voiceStatus}
                    </span>
                    <SourcePicker
                      selected={selectedSources}
                      disabled={busy}
                      scrollContainer={scrollRef.current}
                      onChange={(scope) => {
                        hasSources.value = Boolean(scope);
                        track('librarian.scope_change', scope || 'none');
                      }}
                    />
                    <span class="composer-spacer" />
                    <span id="librarian-question-count">
                      <ComposerCount maxChars={MAX_QUESTION_CHARS} />
                    </span>
                    <ComposerSubmit
                      maxChars={MAX_QUESTION_CHARS}
                      onStop={() => {
                        actions.stopActiveAnswer();
                        track('librarian.answer_stop_click');
                      }}
                    />
                  </div>
                  <span class="sr-only" id="librarian-source-error" aria-live="polite">
                    {sourcesAvailable ? '' : 'Switch on at least one source.'}
                  </span>
                </form>
                <p class="thingy-ai-note" id="thingy-ai-note">
                  Thingy is AI and can make mistakes. Please double-check responses.
                </p>
              </div>
            </div>
          </section>
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
