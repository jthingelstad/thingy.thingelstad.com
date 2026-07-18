const DEFAULT_WELCOME = "Hi. I'm Thingy. Ask me what you're curious about and I'll help you explore the archive.";

interface WelcomeControllerOptions {
  canStart: () => boolean;
  ensureFreshToken: () => Promise<boolean>;
  prepareProfile: () => void;
  createMessage: () => { id: string; model: AssistantMessageModel };
  removeMessage: (id: string) => void;
  stream: (model: AssistantMessageModel, controller: AbortController) => Promise<unknown>;
  setInFlight: (value: boolean) => void;
  track: (name: string, value?: string) => void;
}

function createChatWelcomeController(options: WelcomeControllerOptions) {
  let shown = false;
  let abortController: AbortController | null = null;
  let messageId = '';

  function markShown() {
    shown = true;
  }

  function reset() {
    shown = false;
  }

  function cancel() {
    options.setInFlight(false);
    abortController?.abort();
    abortController = null;
    if (messageId) options.removeMessage(messageId);
    messageId = '';
  }

  async function start() {
    if (shown || !options.canStart()) return;
    if (!(await options.ensureFreshToken()) || shown || !options.canStart()) return;
    options.prepareProfile();
    shown = true;
    options.setInFlight(true);
    const controller = new AbortController();
    abortController = controller;
    const pending = options.createMessage();
    messageId = pending.id;
    try {
      await options.stream(pending.model, controller);
      options.track('librarian.welcome_success');
    } catch (error) {
      if (abortController !== controller || messageId !== pending.id) return;
      pending.model.activity.value = [];
      pending.model.commentary.value = [];
      pending.model.content.value = DEFAULT_WELCOME;
      pending.model.status.value = 'done';
      options.track('librarian.welcome_error', error instanceof Error && error.requestId ? 'server' : 'client');
    } finally {
      if (abortController === controller && messageId === pending.id) {
        options.setInFlight(false);
        abortController = null;
        messageId = '';
      }
    }
  }

  return { cancel, markShown, reset, start };
}

export { DEFAULT_WELCOME, createChatWelcomeController };
