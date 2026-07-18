import * as defaultSession from './thingy-session.ts';
import { dispatchBriefMarkdown, titleFromPrompt } from './thingy-dispatch-presenters.ts';
import { errorMessage } from './thingy-errors.ts';
import { AGENT_RESPONSE_TIMEOUT_MS } from './thingy-timeouts.ts';

interface DispatchPlannerOptions {
  session: typeof defaultSession;
  streamBase: () => string;
  postStream: (options: ThingyRequestOptions) => Promise<Response>;
  readEvents: (
    response: Response,
    onEvent: (eventName: string, data: ThingyStreamData) => void | Promise<void>
  ) => Promise<void>;
  activeDraft: () => ThingyDispatchDraft;
  nextProgressScope: (kind: string) => string;
  progress: (
    scope: string,
    id: string,
    value: unknown,
    draft?: ThingyDispatchDraft,
    extra?: Partial<ThingyDispatchMessage>
  ) => ThingyDispatchMessage;
  setBusy: (value: boolean, text?: string) => void;
  updateDraft: (patch: Partial<ThingyDispatchDraft>) => ThingyDispatchDraft;
  render: () => void;
  requireAuth: () => boolean;
  nowIso: () => string;
  upsertBriefMessage: (text: unknown, draft?: ThingyDispatchDraft) => ThingyDispatchDraft;
  saveDraftToServer: (draft?: ThingyDispatchDraft, overrides?: { status?: string }) => Promise<ThingyDispatchDraft>;
  setStatus: (text: string, kind?: string) => void;
  addMessage: (
    role: ThingyDispatchMessage['role'],
    text: unknown,
    extra?: Partial<ThingyDispatchMessage>
  ) => ThingyDispatchMessage;
}

function createDispatchPlanner(options: DispatchPlannerOptions) {
  return async function planWithThingy(text: string) {
    const draft = options.activeDraft();
    const progressScope = options.nextProgressScope('plan');
    const progress = (
      id: string,
      value: unknown,
      targetDraft = options.activeDraft(),
      extra: Partial<ThingyDispatchMessage> = {}
    ) => options.progress(progressScope, id, value, targetDraft, extra);
    const previous = {
      stage: draft.stage,
      prompt: draft.prompt,
      direction: draft.direction,
      title: draft.title,
      brief: draft.brief
    };
    options.setBusy(true, 'Thingy is planning this Dispatch...');
    options.updateDraft({
      stage: 'shaping',
      prompt: draft.prompt || text,
      title: draft.prompt ? draft.title : titleFromPrompt(text)
    });
    options.render();
    let briefStatus = '';
    let answerMessage: ThingyDispatchMessage | null = null;
    let answerHasContent = false;
    const ensureAnswerMessage = (): ThingyDispatchMessage => {
      if (!answerMessage) {
        const target = options.activeDraft();
        answerMessage = { role: 'assistant', text: '', time: options.nowIso() };
        target.messages.push(answerMessage);
        target.updatedAt = options.nowIso();
      }
      return answerMessage;
    };
    try {
      if (!(await options.session.ensureFreshToken())) {
        options.session.clearAuth();
        options.requireAuth();
        throw new Error('Sign in again to continue.');
      }
      const response = await options.postStream({
        baseUrl: options.streamBase(),
        path: '/chat',
        timeoutMs: AGENT_RESPONSE_TIMEOUT_MS,
        abortMessage: 'Thingy spent too long planning this Dispatch. Please try again with a narrower angle.',
        headers: { authorization: `Bearer ${options.session.token()}` },
        payload: {
          message: text,
          scope: 'all',
          mode: 'dispatch',
          conversation_id: options.activeDraft().conversationId || undefined
        }
      });
      progress('planning', 'Thingy is planning against the archive...', options.activeDraft(), { status: 'pending' });
      options.render();
      await options.readEvents(response, (eventName, data) => {
        if (eventName === 'meta') {
          if (data.conversation_id) options.updateDraft({ conversationId: data.conversation_id });
        } else if (eventName === 'status') {
          const message = String(data.commentary || data.message || '').trim();
          if (message) {
            progress('planning', message, options.activeDraft(), { status: 'pending' });
            options.render();
          }
        } else if (eventName === 'answer_delta') {
          ensureAnswerMessage().text += String(data.delta || '');
          answerHasContent = Boolean(String(ensureAnswerMessage().text || '').trim());
          options.render();
        } else if (eventName === 'answer') {
          if (String(data.answer || '').trim()) {
            ensureAnswerMessage().text = String(data.answer || '');
            answerHasContent = true;
            options.render();
          }
        } else if (eventName === 'dispatch_brief') {
          const brief = data.brief && typeof data.brief === 'object' ? data.brief : {};
          briefStatus = String(data.status || brief.status || 'draft');
          options.updateDraft({ brief });
          const briefText = dispatchBriefMarkdown(brief);
          if (briefText) options.upsertBriefMessage(briefText);
          options.render();
        } else if (eventName === 'error') {
          throw new Error(data.error || 'Thingy is unavailable.');
        }
      });
      progress('planning', 'Finished this planning pass.', options.activeDraft(), { status: 'complete' });
      const current = options.activeDraft();
      const brief = current.brief && typeof current.brief === 'object' ? current.brief : {};
      const ready = briefStatus === 'ready' || String(brief.status || '') === 'ready';
      options.updateDraft({
        stage: ready ? 'ready' : 'needs_clarification',
        direction: String(
          brief.working_angle || brief.generation_instructions || current.direction || current.prompt || ''
        ).trim()
      });
      await options.saveDraftToServer(options.activeDraft(), {
        status: ready ? 'ready' : 'needs_clarification'
      });
      options.setStatus('');
    } catch (error) {
      const failureMessage = errorMessage(error, 'I could not plan that Dispatch right now.');
      options.updateDraft(previous);
      progress('planning', 'Planning stopped before Thingy could finish this pass.', options.activeDraft(), {
        status: 'failed'
      });
      if (!answerHasContent) options.addMessage('assistant', failureMessage);
      options
        .saveDraftToServer(options.activeDraft(), {
          status: options.activeDraft().stage === 'empty' ? 'draft' : options.activeDraft().stage
        })
        .catch(() => {});
      options.setStatus(failureMessage, 'error');
    } finally {
      options.setBusy(false);
      options.render();
    }
  };
}

export { createDispatchPlanner };
