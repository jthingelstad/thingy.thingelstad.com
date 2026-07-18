const MAX_DRAFTS = 24;

function draftTitle(draft: Partial<ThingyDispatchDraft>) {
  return draft.title || draft.prompt || draft.direction || 'New Dispatch';
}

function titleFromPrompt(value: unknown) {
  return (
    String(value || 'Dispatch')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || 'Dispatch'
  );
}

function ordinal(value: unknown) {
  const number = Math.max(1, Number(value || 1));
  const words: Record<number, string> = {
    1: 'first',
    2: 'second',
    3: 'third',
    4: 'fourth',
    5: 'fifth',
    6: 'sixth',
    7: 'seventh',
    8: 'eighth',
    9: 'ninth',
    10: 'tenth'
  };
  if (words[number]) return words[number];
  const mod100 = number % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${number}th`;
  const suffixes: Record<number, string> = { 1: 'st', 2: 'nd', 3: 'rd' };
  return `${number}${suffixes[number % 10] || 'th'}`;
}

function defaultWelcomeText(dispatchNumber = 1) {
  return `Alright, let's make your ${ordinal(dispatchNumber)} Dispatch. Give me the topic, question, or archive thread you want to shape, and I'll help turn it into a clear direction before you generate it.`;
}

function coverageLabel(value: unknown) {
  const labels: Record<string, string> = {
    thin: 'Thin',
    focused: 'Focused',
    broad: 'Broad',
    ambiguous: 'Needs steering'
  };
  return labels[String(value || '').toLowerCase()] || 'Checked';
}

function briefSourceLine(source: DispatchBriefSource = {}) {
  const title = String(source.title || '').trim();
  const label = String(source.label || '').trim();
  const why = String(source.why || '').trim();
  const url = String(source.url || '').trim();
  const name = [label, title].filter(Boolean).join(' - ') || url || 'Archive source';
  return `${name}${why ? `: ${why}` : ''}`;
}

function dispatchBriefMarkdown(brief: DispatchBrief = {}) {
  if (!brief || typeof brief !== 'object' || Array.isArray(brief)) return '';
  const angle = String(brief.working_angle || brief.generation_instructions || '').trim();
  const goal = String(brief.user_goal || '').trim();
  const sources = Array.isArray(brief.selected_sources)
    ? brief.selected_sources.map(briefSourceLine).filter(Boolean).slice(0, 6)
    : [];
  const excluded = Array.isArray(brief.excluded_scope)
    ? brief.excluded_scope
        .map((item) => String(item || '').trim())
        .filter(Boolean)
        .slice(0, 5)
    : [];
  if (!angle && !goal && !sources.length) return '';
  return [
    '**Dispatch brief**',
    goal ? `- **Goal:** ${goal}` : '',
    angle ? `- **Angle:** ${angle}` : '',
    `- **Archive fit:** ${coverageLabel(brief.coverage_status)}`,
    sources.length ? `- **Planned sources:**\n${sources.map((source) => `  - ${source}`).join('\n')}` : '',
    excluded.length ? `- **Keep out:** ${excluded.join('; ')}` : ''
  ]
    .filter(Boolean)
    .join('\n');
}

function generationContextText(draft: Partial<ThingyDispatchDraft> = {}, dispatchTestMode = false) {
  const brief = draft.brief && typeof draft.brief === 'object' ? draft.brief : {};
  const sources = Array.isArray(brief.selected_sources) ? brief.selected_sources : [];
  return [
    dispatchTestMode
      ? 'I am preparing the template test with the current Dispatch brief.'
      : 'I am preparing this Dispatch with the brief we shaped together.',
    brief.coverage_status ? `Archive fit: ${coverageLabel(brief.coverage_status)}.` : '',
    sources.length
      ? `Planned sources: ${sources
          .slice(0, 4)
          .map((source) => source.label || source.title)
          .filter(Boolean)
          .join(', ')}.`
      : ''
  ]
    .filter(Boolean)
    .join('\n\n');
}

function statusProgressText(status: string) {
  const normalized = String(status || '').replace(/_/g, ' ');
  if (status === 'queued') return 'The Dispatch is queued. I am watching for the worker to pick it up.';
  if (status === 'generating') return 'The worker has the request. I am writing from the planned archive packet now.';
  if (status === 'ready_to_send') return 'The Dispatch draft is written. I am handing it to the email sender.';
  if (status === 'sending') return 'The email sender has the Dispatch. I am waiting for delivery confirmation.';
  return `Thingy is ${normalized} this Dispatch. I will keep checking until it is sent.`;
}

function inputPlaceholderForDraft(draft: Partial<ThingyDispatchDraft>, editable: boolean) {
  if (!editable) return 'Start a new Dispatch to shape another request...';
  if (draft.stage === 'needs_clarification') return 'Answer Thingy, or steer the plan another way...';
  if (draft.stage === 'ready' || draft.stage === 'upgrade') return 'Adjust the direction, or generate when ready...';
  return 'Tell Thingy what this Dispatch should explore...';
}

export {
  MAX_DRAFTS,
  defaultWelcomeText,
  dispatchBriefMarkdown,
  draftTitle,
  generationContextText,
  inputPlaceholderForDraft,
  statusProgressText,
  titleFromPrompt
};
