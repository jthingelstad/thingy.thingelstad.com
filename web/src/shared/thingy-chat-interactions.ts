import { extractPreferredNameFromMessage } from './thingy-account.ts';
import { chatState as state, createChatActions } from './thingy-chat-actions.ts';
import { renderCuriosityMap } from './thingy-chat-rendering.ts';
import { errorMessage } from './thingy-errors.ts';
import { isAuthError } from './thingy-url.ts';
import {
  answerInFlight,
  chatMessages,
  interactionBusy,
  mapInFlight,
  questionText,
  stoppable
} from './stores/chat-store.ts';
import { mobileRailOpen } from './stores/ui-store.ts';

interface ChatInteractionsOptions {
  actions: ReturnType<typeof createChatActions>;
  maxQuestionChars: number;
  currentScope: () => string;
  cancelWelcome: () => void;
  markWelcomeShown: () => void;
  resetMessages: () => void;
  setQuestion: (value: string) => void;
  addUserMessage: (prompt: string, scope: string) => void;
  addAssistantMessage: (options?: AssistantMessageOptions) => { id: string; model: AssistantMessageModel };
  stopDictation: () => void;
  focusInput: () => void;
  track: (name: string, value?: string) => void;
}

function createChatInteractions(options: ChatInteractionsOptions) {
  const {
    actions,
    maxQuestionChars,
    currentScope,
    cancelWelcome,
    markWelcomeShown,
    resetMessages,
    setQuestion,
    addUserMessage,
    addAssistantMessage,
    stopDictation,
    focusInput,
    track
  } = options;

  async function showCuriosityMap(center = '', attachToCurrent = false) {
    if (!actions.token() || interactionBusy.value || !(await actions.ensureFreshToken())) return;
    const scope = currentScope();
    if (!scope) return;
    const attach = Boolean(
      attachToCurrent && state.activeConversationId && !actions.isLocalConversationId(state.activeConversationId)
    );
    const conversationId = attach ? state.activeConversationId || '' : '';
    if (!attach) {
      markWelcomeShown();
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
    if (!message || message.length > maxQuestionChars || !currentScope()) return;
    if (!(await actions.ensureFreshToken())) return;
    stopDictation();
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
      return;
    }
    focusInput();
    track('librarian.experience_prompt', 'trail');
  }

  async function submitFeedback(input: { requestId: string; reaction: string; comment: string }) {
    return actions.postStreamJson(
      '/feedback',
      { request_id: input.requestId, reaction: input.reaction, comment: input.comment },
      { authorization: `Bearer ${actions.token()}` }
    );
  }

  return { embeddedPrompt, retryAnswer, showCuriosityMap, submitFeedback, submitQuestion };
}

export { createChatInteractions };
