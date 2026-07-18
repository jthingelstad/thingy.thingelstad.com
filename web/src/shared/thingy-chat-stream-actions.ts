import { createAssistantStreamRenderer } from './thingy-chat-stream-renderer.ts';
import { postJsonStream, read as readStream } from './thingy-stream.ts';
import { AGENT_RESPONSE_TIMEOUT_MS, AGENT_SETUP_TIMEOUT_MS } from './thingy-timeouts.ts';
import { userLocalContext } from './thingy-local-context.ts';

interface ChatStreamActionsOptions {
  streamBase: string;
  token: () => string;
  getActiveConversationId: () => string | null;
  isLocalConversationId: (id: unknown) => boolean;
  currentConversationMode: () => string;
  readerProfileContext: () => Record<string, unknown>;
  upsertPendingConversation: (input: {
    conversationId: string;
    title?: string;
    scope?: string;
    mode?: string;
  }) => unknown;
  setActiveConversation: (id: unknown) => void;
  onMode: (mode: string) => void;
  onQuestionStateChanged: () => void;
  scheduleChatScroll: (options?: { force?: boolean }) => void;
  answerInFlight: () => boolean;
  setStoppable: (value: boolean) => void;
}

interface WelcomeStreamOptions {
  controller?: AbortController;
}

function createChatStreamActions(options: ChatStreamActionsOptions) {
  let chatAbortController: AbortController | null = null;
  let chatStopRequested = false;

  function stopActiveAnswer() {
    if (!chatAbortController) return;
    chatStopRequested = true;
    chatAbortController.abort();
  }

  function clearAnswerAbortState() {
    chatAbortController = null;
    chatStopRequested = false;
  }

  function isStoppable() {
    return Boolean(chatAbortController);
  }

  async function postStreamingChat(message: string, model: AssistantMessageModel, scope: string) {
    if (!options.streamBase) throw new Error('Thingy has not been connected to the archive stream API yet.');

    let requestId = '';
    let conversationId = options.isLocalConversationId(options.getActiveConversationId())
      ? ''
      : options.getActiveConversationId() || '';
    let conversation: ThingyConversationSummary | null = null;
    chatStopRequested = false;
    chatAbortController = new AbortController();
    options.setStoppable(options.answerInFlight());
    options.onQuestionStateChanged();
    let response;
    try {
      response = await postJsonStream({
        baseUrl: options.streamBase,
        path: '/chat',
        controller: chatAbortController,
        timeoutMs: AGENT_RESPONSE_TIMEOUT_MS,
        abortMessage: 'Thingy spent too long in the archive. Please try again with a narrower angle.',
        headers: { authorization: `Bearer ${options.token()}` },
        payload: {
          message,
          scope,
          mode: options.currentConversationMode(),
          conversation_id: conversationId || undefined,
          client_context: userLocalContext(),
          user_profile: options.readerProfileContext()
        }
      });
    } catch (error) {
      if (chatStopRequested) {
        model.status.value = 'stopped';
        return {
          answer: '',
          citations: [],
          experience: null,
          stopped: true,
          request_id: '',
          conversation_id: conversationId,
          conversation: null
        };
      }
      throw error;
    }

    const renderer = createAssistantStreamRenderer({ model, scroll: options.scheduleChatScroll });

    function applyEvent(eventName: string, data: ThingyStreamData) {
      if (eventName === 'meta') {
        requestId = data.request_id || requestId;
        if (data.mode) options.onMode(data.mode);
        if (data.conversation_id) {
          conversationId = data.conversation_id;
          options.upsertPendingConversation({
            conversationId,
            title: message,
            scope,
            mode: data.mode || options.currentConversationMode()
          });
          options.setActiveConversation(conversationId);
        }
      } else if (eventName === 'status') {
        renderer.status(data);
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
        if (data.mode) options.onMode(data.mode);
        if (data.conversation_id) {
          conversationId = data.conversation_id;
          options.setActiveConversation(conversationId);
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

  async function postStreamingWelcome(model: AssistantMessageModel, scope: string, opts: WelcomeStreamOptions = {}) {
    if (!options.streamBase) throw new Error('Thingy has not been connected to the archive stream API yet.');

    let requestId = '';
    const response = await postJsonStream({
      baseUrl: options.streamBase,
      path: '/welcome',
      controller: opts.controller,
      timeoutMs: AGENT_SETUP_TIMEOUT_MS,
      abortMessage: 'Thingy took too long to get oriented. Please try asking a question.',
      headers: { authorization: `Bearer ${options.token()}` },
      payload: {
        scope,
        mode: options.currentConversationMode(),
        client_context: userLocalContext(),
        user_profile: options.readerProfileContext()
      }
    });

    const renderer = createAssistantStreamRenderer({
      model,
      scroll: options.scheduleChatScroll,
      label: 'Session Setup',
      statusFallback: 'Thingy is getting oriented...'
    });
    let receivedAnswer = false;

    function applyEvent(eventName: string, data: ThingyStreamData) {
      if (eventName === 'meta') {
        requestId = data.request_id || requestId;
        if (data.mode) options.onMode(data.mode);
      } else if (eventName === 'status') {
        renderer.status(data);
      } else if (eventName === 'commentary') {
        renderer.commentary(data.message || data.delta || '');
      } else if (eventName === 'answer_delta') {
        if (receivedAnswer) renderer.appendDelta(data.delta);
        else renderer.setAnswer(data.delta);
        receivedAnswer = true;
      } else if (eventName === 'answer') {
        renderer.setAnswer(data.answer);
        receivedAnswer = true;
      } else if (eventName === 'experience') {
        renderer.setExperience(data.experience);
      } else if (eventName === 'done') {
        requestId = data.request_id || requestId;
        if (data.mode) options.onMode(data.mode);
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

  return { clearAnswerAbortState, isStoppable, postStreamingChat, postStreamingWelcome, stopActiveAnswer };
}

export { createChatStreamActions };
