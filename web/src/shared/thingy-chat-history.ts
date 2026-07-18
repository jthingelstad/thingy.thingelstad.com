import { createAssistantMessageModel } from './models/assistant-message.ts';
import { activityStepsFromToolNames, renderCuriosityMap } from './thingy-chat-rendering.ts';

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

interface ConversationHistoryOptions {
  messages?: unknown[];
  currentScope: () => string;
  nextMessageId: (prefix: string) => string;
}

function conversationViewMessages({
  messages = [],
  currentScope,
  nextMessageId
}: ConversationHistoryOptions): ThingyChatViewMessage[] {
  const next: ThingyChatViewMessage[] = [];
  let lastPrompt = '';
  for (const message of messages as ConversationMessage[]) {
    if (message.role === 'user') {
      lastPrompt = message.content || '';
      next.push({
        id: nextMessageId('user'),
        role: 'user',
        prompt: lastPrompt,
        scope: message.scope || currentScope()
      });
      continue;
    }
    if (message.role !== 'assistant') continue;
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
  return next;
}

export { conversationViewMessages };
