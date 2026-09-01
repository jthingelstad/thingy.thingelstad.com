import { extractPreferredNameFromMessage } from './thingy-account.ts';
import { chatState as state, createChatActions } from './thingy-chat-actions.ts';
import { errorMessage } from './thingy-errors.ts';
import { isAuthError } from './thingy-url.ts';
import { answerInFlight, chatMessages, interactionBusy, questionText, stoppable } from './stores/chat-store.ts';

interface ChatInteractionsOptions {
  actions: ReturnType<typeof createChatActions>;
  maxQuestionChars: number;
  currentScope: () => string;
  cancelWelcome: () => void;
  setQuestion: (value: string) => void;
  addUserMessage: (prompt: string, scope: string) => void;
  addAssistantMessage: (options?: AssistantMessageOptions) => { id: string; model: AssistantMessageModel };
  stopDictation: () => void;
  track: (name: string, value?: string) => void;
}

// Dotted event values keep failure classes separable in Tinylytics:
// server.401 (rejected), server.500 (failed), server (SSE error frame or a
// stream that died mid-answer with a request id), client (never reached).
function answerErrorClass(error: unknown) {
  if (!(error instanceof Error) || !error.requestId) return 'client';
  return error.status ? `server.${error.status}` : 'server';
}

function createChatInteractions(options: ChatInteractionsOptions) {
  const {
    actions,
    maxQuestionChars,
    currentScope,
    cancelWelcome,
    setQuestion,
    addUserMessage,
    addAssistantMessage,
    stopDictation,
    track
  } = options;

  async function submitQuestion() {
    if (interactionBusy.value) return;
    cancelWelcome();
    const message = questionText.value.trim();
    if (!message || message.length > maxQuestionChars || !currentScope()) return;
    if (!(await actions.ensureSession())) return;
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
        track('librarian.answer_stopped', String(data.answer || '').trim() ? 'partial' : 'empty');
      }
      if (data.conversation_id) actions.setActiveConversation(data.conversation_id);
      if (data.conversation) actions.upsertConversationSummary(data.conversation);
      await actions.refreshConversations();
      if (!data.stopped) track('librarian.answer_success', `${size}.${(data.citations || []).length}`);
    } catch (error) {
      pending.model.errorMessage.value = errorMessage(error, 'Thingy could not answer that question.');
      if (!isAuthError(error)) pending.model.retryPrompt.value = message;
      pending.model.status.value = 'error';
      track('librarian.answer_error', answerErrorClass(error));
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

  async function emailAnswer(input: { requestId: string }) {
    const conversationId = actions.savedActiveConversation();
    if (!conversationId || actions.isLocalConversationId(conversationId)) {
      throw new Error('This answer has not been saved to a conversation yet.');
    }
    const email = actions.storedEmail();
    if (!email) throw new Error('Sign in again to email answers.');
    if (!(await actions.ensureSession())) throw new Error('Sign in again to email answers.');
    return actions.conversationAction({
      action: 'email_answer',
      conversation_id: conversationId,
      request_id: input.requestId,
      email
    });
  }

  async function submitFeedback(input: { requestId: string; reaction: string; comment: string }) {
    return actions.postStreamJson(
      '/feedback',
      { request_id: input.requestId, reaction: input.reaction, comment: input.comment },
      actions.authHeaders()
    );
  }

  return { emailAnswer, retryAnswer, submitFeedback, submitQuestion };
}

export { createChatInteractions };
