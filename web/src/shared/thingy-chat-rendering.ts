import { escapeHtml, renderMarkdown } from './thingy-markdown.ts';

interface ActivityRenderOptions {
  commentary?: string[];
  active?: boolean;
  label?: string;
  elapsedLabel?: string;
  collapsible?: boolean;
}

function renderAnswer(answer: unknown, citations: ThingyCitation[] = []) {
  return renderMarkdown(answer, citations);
}

// Display titles, mirroring the server's prompts/tool-titles.json - the
// activity summary should read "Checked Archive statistics", not a
// prettified identifier. Unknown names fall back to de-snaked text.
const TOOL_TITLES: Record<string, string> = {
  search_archive: 'Search the archive',
  get_source: 'Read a source',
  archive_lens: 'Topic history',
  entity_lens: 'Entity history',
  latest_content: 'Latest content',
  corpus_stats: 'Archive statistics',
  search_faq: 'Thingy FAQ',
  quote_search: 'Find a quote',
  find_links: 'Find links',
  list_content: 'Browse the archive',
  source_neighborhood: 'Related sources',
  archive_gems: 'Hidden gems',
  claim_check: 'Check a claim',
  media_search: 'Search photos',
  currently_history: 'Reading, playing & watching',
  top_references: 'Top references',
  fetch_page: 'Fetch a web page',
  web_search: 'Search the web'
};

function humanToolName(value: unknown) {
  const key = String(value || '').trim();
  if (TOOL_TITLES[key]) return TOOL_TITLES[key];
  return key
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function activityMessageFromToolName(value: unknown) {
  const name = humanToolName(value);
  return name ? `Checked ${name}` : '';
}

function normalizeActivityCommentary(value: unknown) {
  return String(value || '')
    .replace(/\r\n?/g, '\n')
    .split(/\n+/)
    .map((line) =>
      line
        .replace(/[^\S\n]+/g, ' ')
        .replace(/([.!?])(?=\S)/g, '$1 ')
        .trim()
    )
    .filter(Boolean)
    .join('\n\n')
    .slice(0, 700)
    .trim();
}

function normalizeActivityStep(data: ThingyStreamData | string, fallback = 'Thingy is working...') {
  if (typeof data === 'string') return String(data || fallback).trim();
  const toolName = data?.tool_name || data?.toolName || '';
  if (toolName) return activityMessageFromToolName(toolName);
  return String(data?.message || fallback)
    .trim()
    .replace(/\.\.\.$/, '');
}

function appendActivityStep(
  steps: ThingyActivityStep[],
  data: ThingyStreamData | string,
  fallback: string
): ThingyActivityStep[] {
  const label = normalizeActivityStep(data, fallback).replace(/\s+/g, ' ').slice(0, 120);
  const note = normalizeActivityCommentary(
    typeof data === 'string' ? '' : data.commentary || data.detail || data.note || ''
  );
  if (!label) return steps;
  const last = steps[steps.length - 1];
  if (last && last.label.toLowerCase() === label.toLowerCase()) {
    if (
      note &&
      !String(last.note || '')
        .toLowerCase()
        .includes(note.toLowerCase())
    ) {
      last.note = [last.note, note].filter(Boolean).join('\n\n');
    }
    return steps;
  }
  steps.push({ label, note });
  return steps.slice(-8);
}

function appendActivityCommentary(items: string[], value: unknown): string[] {
  const text = normalizeActivityCommentary(value);
  if (!text) return items;
  const last = items[items.length - 1];
  if (last?.toLowerCase().includes(text.toLowerCase())) return items;
  return [...items, text].slice(-8);
}

function activityStepsFromToolNames(toolNames: unknown[] = []): ThingyActivityStep[] {
  return Array.from(new Set((toolNames || []).map(activityMessageFromToolName).filter(Boolean))).map((label) => ({
    label,
    note: ''
  }));
}

function renderActivityLog(steps: Array<ThingyActivityStep | string> = [], options: ActivityRenderOptions = {}) {
  const commentary = (options.commentary || [])
    .filter(Boolean)
    .map((note) => ({ label: 'Thinking through the path', note, kind: 'note' }));
  const list = (steps || [])
    .filter(Boolean)
    .map((step) => {
      if (typeof step === 'string') return { label: step, note: '' };
      return {
        label: String(step.label || '').trim(),
        note: String(step.note || '').trim(),
        kind: step.kind || ''
      };
    })
    .filter((step) => step.label || step.note)
    .concat(commentary);
  if (!list.length && !commentary.length) return '';
  const activeIndex = options.active ? list.length - 1 : -1;
  const elapsed = String(options.elapsedLabel || '').trim();
  const stepCount = list.length;
  const latest: ThingyActivityStep | undefined = list[list.length - 1];
  const activityLabel = options.active
    ? String(options.label || 'Archive Work').trim()
    : String(latest?.label || latest?.note || options.label || 'Archive Work').trim();
  const items = list
    .map((step, index) => {
      const state = index === activeIndex ? ' is-active' : ' is-complete';
      const rawLabel = step.label || 'Thinking through the path';
      const label =
        index === activeIndex && rawLabel.startsWith('Checked ') ? `Checking ${rawLabel.slice(8)}` : rawLabel;
      const note = step.note ? `<div class="librarian-activity-note">${renderMarkdown(step.note)}</div>` : '';
      const stepElapsed =
        index === activeIndex && elapsed ? `<span class="librarian-elapsed">${escapeHtml(elapsed)}</span>` : '';
      return (
        `<li class="librarian-activity-step${state}">` +
        `<div class="librarian-activity-step-main"><span class="librarian-activity-dot" aria-hidden="true"></span><span>${escapeHtml(label)}</span>${stepElapsed}</div>` +
        note +
        `</li>`
      );
    })
    .join('');
  const body = items ? `<ol>${items}</ol>` : '';
  if (!options.active && options.collapsible) {
    return (
      `<details class="librarian-activity is-collapsed" aria-label="Thingy activity">` +
      `<summary><span class="librarian-activity-kicker">${escapeHtml(activityLabel)}</span> <span class="librarian-activity-summary">${stepCount} ${stepCount === 1 ? 'step' : 'steps'}</span></summary>` +
      body +
      `</details>`
    );
  }
  return (
    `<aside class="librarian-activity" aria-label="Thingy activity">` +
    `<div class="librarian-activity-kicker">${escapeHtml(activityLabel)}</div>` +
    body +
    `</aside>`
  );
}

function renderAssistantResponse(
  answer: unknown,
  citations: ThingyCitation[] = [],
  activitySteps: ThingyActivityStep[] = [],
  activityCommentary: string[] = [],
  options: ActivityRenderOptions = {}
) {
  const hasAnswer = String(answer || '').trim();
  const activity = renderActivityLog(activitySteps, {
    ...options,
    commentary: activityCommentary,
    collapsible: Boolean(hasAnswer)
  });
  if (!hasAnswer) return activity || renderAnswer(answer, citations);
  return `${activity}<div class="librarian-answer-content">${renderAnswer(answer, citations)}</div>`;
}

export { activityStepsFromToolNames, appendActivityCommentary, appendActivityStep, renderAssistantResponse };
