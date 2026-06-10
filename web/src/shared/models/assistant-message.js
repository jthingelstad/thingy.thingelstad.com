// One assistant message's reactive state. Each running answer has its own
// model; the stream renderer writes deltas into the model's signals, and the
// AssistantMessage component subscribes to render. Activity, citations, and
// the experience artifact are separate signals so changes to one don't force
// a re-parse of the rendered markdown answer.

import { signal } from '@preact/signals';

let counter = 0;

function createAssistantMessageModel(options = {}) {
  counter += 1;
  return {
    id: `assistant-${counter}`,
    content: signal(String(options.content || '')),
    citations: signal(Array.isArray(options.citations) ? options.citations : []),
    activity: signal(Array.isArray(options.activity) ? options.activity : []),
    commentary: signal(Array.isArray(options.commentary) ? options.commentary : []),
    experience: signal(options.experience || null),
    artifactHtml: signal(String(options.artifactHtml || '')),
    // status mirrors the lifecycle:
    //   'pending'   — request in flight, no content yet (status line shown)
    //   'streaming' — content is arriving
    //   'done'      — request completed normally
    //   'stopped'   — user-aborted; partial content preserved
    //   'error'     — request failed; partial content preserved if any
    //   'static'    — a loaded message, no streaming, no notes
    status: signal(options.status || 'pending'),
    statusFallback: signal(options.statusFallback || 'Thingy is working...'),
    label: signal(options.label || ''),
    errorMessage: signal(''),
    retryPrompt: signal(''),
    requestId: signal(String(options.requestId || ''))
  };
}

export { createAssistantMessageModel };
