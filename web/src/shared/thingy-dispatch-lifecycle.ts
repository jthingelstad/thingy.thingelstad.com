import * as defaultSession from './thingy-session.ts';
import { serverDispatchId } from './thingy-dispatch-drafts.ts';
import { generationContextText, statusProgressText } from './thingy-dispatch-presenters.ts';
import { errorMessage } from './thingy-errors.ts';

interface DispatchLifecycleOptions {
  session: typeof defaultSession;
  dispatchTestMode: boolean;
  redirectToSignIn: () => void;
  activeDraft: () => ThingyDispatchDraft;
  draftById: (id: string) => ThingyDispatchDraft | undefined;
  getActiveId: () => string;
  nextProgressScope: (kind: string) => string;
  progress: (
    scope: string,
    id: string,
    value: unknown,
    draft?: ThingyDispatchDraft,
    extra?: Partial<ThingyDispatchMessage>
  ) => ThingyDispatchMessage;
  scopedProgressId: (scope: string, id: string) => string;
  setBusy: (value: boolean, text?: string) => void;
  render: () => void;
  saveDraftToServer: (draft?: ThingyDispatchDraft, overrides?: { status?: string }) => Promise<ThingyDispatchDraft>;
  dispatchPost: (action: string, extra?: Record<string, unknown>) => Promise<ThingyApiResponse>;
  updateDraft: (patch: Partial<ThingyDispatchDraft>) => ThingyDispatchDraft;
  addMessage: (
    role: ThingyDispatchMessage['role'],
    text: unknown,
    extra?: Partial<ThingyDispatchMessage>
  ) => ThingyDispatchMessage;
  setStatus: (text: string, kind?: string) => void;
  saveDrafts: () => void;
  loadHistory: () => Promise<void>;
  nowIso: () => string;
}

function createDispatchLifecycle(options: DispatchLifecycleOptions) {
  let pollTimer = 0;
  let pollingDraftId = '';

  async function generateDispatch() {
    const draft = options.activeDraft();
    const progressScope = options.nextProgressScope('generate');
    const progress = (
      id: string,
      value: unknown,
      targetDraft = options.activeDraft(),
      extra: Partial<ThingyDispatchMessage> = {}
    ) => options.progress(progressScope, id, value, targetDraft, extra);
    const email = options.session.storedEmail();
    if (!email) {
      options.redirectToSignIn();
      return;
    }
    options.setBusy(true, options.dispatchTestMode ? 'Queueing template test...' : 'Queueing Dispatch...');
    draft.generationProgressScope = progressScope;
    progress('generate-start', generationContextText(draft, options.dispatchTestMode), draft, { status: 'pending' });
    options.render();
    try {
      await options.saveDraftToServer(draft, { status: draft.stage === 'upgrade' ? 'ready' : draft.stage });
      progress('generate-start', generationContextText(draft, options.dispatchTestMode), draft, { status: 'complete' });
      progress(
        'generate-save',
        'Saved the Dispatch direction and brief.\n\nSending the generation request now.',
        draft,
        { status: 'pending' }
      );
      options.render();
      const data = await options.dispatchPost('create', {
        dispatch_id: serverDispatchId(draft),
        prompt: draft.prompt,
        topic: draft.prompt,
        direction: draft.direction || draft.prompt,
        clarification_question: draft.currentQuestion,
        clarification_answer: draft.clarificationAnswer,
        brief: draft.brief || {},
        template_test: options.dispatchTestMode,
        email
      });
      progress(
        'generate-save',
        'Saved the Dispatch direction and brief.\n\nSending the generation request now.',
        options.activeDraft(),
        { status: 'complete' }
      );
      const row = data.dispatch || {};
      options.updateDraft({
        stage: row.status || 'queued',
        dispatchId: row.id || row.dispatch_id || '',
        statusText: options.dispatchTestMode ? 'Template test queued.' : 'Dispatch queued.'
      });
      options.activeDraft().generationProgressScope = progressScope;
      progress(
        'generate-queue',
        options.dispatchTestMode
          ? 'Template test queued. I am checking the generation status now.'
          : 'Dispatch queued. I am checking the generation status now.',
        options.activeDraft(),
        { status: 'complete' }
      );
      startPolling();
    } catch (error) {
      const requestError = error instanceof Error ? error : null;
      const responseData =
        requestError?.data && typeof requestError.data === 'object' ? (requestError.data as { status?: string }) : null;
      if (requestError?.status === 403 && responseData?.status === 'supporting_member_required') {
        options.updateDraft({ stage: 'upgrade' });
        options.addMessage(
          'assistant',
          [
            'This Dispatch is shaped and ready.',
            'Sending Dispatches is a Supporting Member feature. Supporting Membership helps sustain The Weekly Thing and Jamie directs the membership proceeds as a charitable giving pool rather than treating this as a paywall for Thingy.',
            'You can become a Supporting Member, come back here, sign in again so I can see the updated membership, and generate this same Dispatch.'
          ].join('\n\n')
        );
        options.saveDraftToServer(options.activeDraft(), { status: 'ready' }).catch(() => {});
        options.setStatus('Ready to send after Supporting Membership.', 'notice');
      } else if (requestError?.status === 429) {
        options.addMessage('assistant', errorMessage(error, 'Dispatch is rate limited right now.'));
        options.setStatus('Dispatch is rate limited right now.', 'notice');
      } else {
        options.addMessage('assistant', errorMessage(error, 'I could not queue this Dispatch.'));
        options.setStatus('Could not queue this Dispatch.', 'error');
      }
      if (
        options
          .activeDraft()
          .messages.some(
            (message) =>
              message.kind === 'progress' &&
              message.id === options.scopedProgressId(progressScope, 'generate-start') &&
              message.status === 'pending'
          )
      ) {
        progress(
          'generate-start',
          'Dispatch preparation stopped before the request could be queued.',
          options.activeDraft(),
          {
            status: 'failed'
          }
        );
      }
      progress(
        'generate-save',
        'The Dispatch generation request stopped before it could be queued.',
        options.activeDraft(),
        { status: 'failed' }
      );
    } finally {
      options.setBusy(false);
      options.render();
    }
  }

  function stopPollingFor(draftId: string) {
    if (pollingDraftId !== draftId) return;
    window.clearInterval(pollTimer);
    pollTimer = 0;
    pollingDraftId = '';
  }

  async function pollStatus(draftId = options.getActiveId()) {
    const draft = options.draftById(draftId) || options.activeDraft();
    if (!draft.dispatchId) return;
    if (!draft.generationProgressScope) draft.generationProgressScope = options.nextProgressScope('generate');
    const progressScope = draft.generationProgressScope;
    const progress = (id: string, value: unknown, targetDraft = draft, extra: Partial<ThingyDispatchMessage> = {}) =>
      options.progress(progressScope, id, value, targetDraft, extra);
    try {
      const data = await options.dispatchPost('status', { dispatch_id: draft.dispatchId });
      const row = data.dispatch || {};
      if (row.status === 'sent') {
        Object.assign(draft, {
          stage: 'sent',
          title: row.title || row.subject || draft.title,
          statusText: 'Sent',
          updatedAt: options.nowIso()
        });
        if (!draft.messages.some((message) => message.kind === 'sent')) {
          progress('generate-status', 'Generation finished and the email handoff completed.', draft, {
            status: 'complete'
          });
          draft.messages.push({
            role: 'assistant',
            text: 'Dispatch sent. Check your email.',
            time: options.nowIso(),
            kind: 'sent'
          });
          options.saveDrafts();
        }
        stopPollingFor(draft.id);
        await options.loadHistory();
      } else if (row.status === 'failed') {
        Object.assign(draft, {
          stage: 'failed',
          statusText: row.error || 'Failed',
          updatedAt: options.nowIso()
        });
        progress('generate-status', 'Generation failed before the email could be sent.', draft, { status: 'failed' });
        draft.messages.push({
          role: 'assistant',
          text: row.error || 'Dispatch failed while generating.',
          time: options.nowIso()
        });
        options.saveDrafts();
        stopPollingFor(draft.id);
        await options.loadHistory();
      } else if (row.status) {
        Object.assign(draft, { stage: row.status, updatedAt: options.nowIso() });
        progress('generate-status', statusProgressText(row.status), draft, { status: 'pending' });
        options.saveDrafts();
        options.render();
      }
    } catch (_error) {
      // Polling is best-effort.
    }
  }

  function startPolling(draftId = options.getActiveId()) {
    const draft = options.draftById(draftId) || options.activeDraft();
    if (!draft.dispatchId || (pollTimer && pollingDraftId === draft.id)) return;
    if (pollTimer) window.clearInterval(pollTimer);
    pollingDraftId = draft.id;
    pollTimer = window.setInterval(() => pollStatus(pollingDraftId), 6000);
    void pollStatus(pollingDraftId);
  }

  return { generateDispatch, pollStatus, startPolling, stopPollingFor };
}

export { createDispatchLifecycle };
