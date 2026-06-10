import {
  escapeHtml,
  renderInlineMarkdown,
  renderMarkdown,
  safeMarkdownUrl
} from './thingy-markdown.js';

function sourceAccentClass(kind) {
  const normalized = String(kind || '').toLowerCase().replace(/[\s-]+/g, '_');
  if (normalized === 'weekly_thing' || normalized === 'newsletter' || normalized === 'issue' || normalized === 'chunk') return 'is-wt';
  if (normalized === 'blog') return 'is-blog';
  if (normalized === 'podcast' || normalized === 'another_thing') return 'is-podcast';
  return '';
}

function renderExperience(experience) {
  if (!experience || typeof experience !== 'object') return '';
  const items = Array.isArray(experience.items) ? experience.items.slice(0, 5) : [];
  if (!items.length && !experience.intro) return '';
  const kind = experience.kind === 'spark' ? 'spark' : 'trail';
  const title = experience.title || (kind === 'spark' ? 'Archive Spark' : 'Thingy Trail');
  const prompt = String(experience.prompt || '').trim();
  const itemHtml = items.map((item, index) => {
    const href = safeMarkdownUrl(item.url || '');
    const titleText = item.title || item.subject || 'Archive source';
    const meta = [item.label, item.publish_date ? String(item.publish_date).slice(0, 10) : ''].filter(Boolean).join(' · ');
    const reason = item.reason ? `<p>${escapeHtml(item.reason)}</p>` : '';
    const accent = sourceAccentClass(item.source_kind);
    const body = `
      <span class="thingy-exp-index">${index + 1}</span>
      <span class="thingy-exp-source-body">
        <strong>${escapeHtml(titleText)}</strong>
        ${meta ? `<small>${escapeHtml(meta)}</small>` : ''}
        ${reason}
      </span>`;
    if (href && href !== '#') {
      return `<a class="thingy-exp-source ${accent}" href="${href}">${body}</a>`;
    }
    return `<div class="thingy-exp-source ${accent}">${body}</div>`;
  }).join('');
  return `
    <aside class="thingy-experience thingy-experience-${kind}" aria-label="${escapeHtml(title)}">
      <div class="thingy-exp-head">
        <span class="thingy-exp-kicker">${kind === 'spark' ? 'Archive Spark' : 'Thingy Trail'}</span>
        <strong>${escapeHtml(title)}</strong>
      </div>
      ${experience.intro ? `<p class="thingy-exp-intro">${escapeHtml(experience.intro)}</p>` : ''}
      ${itemHtml ? `<div class="thingy-exp-sources">${itemHtml}</div>` : ''}
      ${prompt ? `<button type="button" class="thingy-exp-prompt" data-experience-prompt="${escapeHtml(prompt)}">${kind === 'spark' ? 'Follow this spark' : 'Continue this trail'}</button>` : ''}
    </aside>`;
}

function curiosityMapPositions(nodes) {
  const positioned = new Map();
  const total = Math.max(nodes.length - 1, 1);
  const compact = window.matchMedia && window.matchMedia('(max-width: 640px)').matches;
  nodes.forEach((node, index) => {
    if (index === 0 || node.kind === 'center') {
      positioned.set(node.id, { x: 50, y: 50, scale: 1.05 });
      return;
    }
    const angle = (-92 + ((index - 1) * 360 / total)) * Math.PI / 180;
    const isWide = total > 5 && index % 2 === 0;
    const radiusX = compact ? (isWide ? 30 : 26) : (isWide ? 40 : 34);
    const radiusY = compact ? (isWide ? 39 : 33) : (isWide ? 36 : 31);
    positioned.set(node.id, {
      x: Math.round((50 + Math.cos(angle) * radiusX) * 10) / 10,
      y: Math.round((50 + Math.sin(angle) * radiusY) * 10) / 10,
      scale: Math.max(0.84, Math.min(1, Number(node.weight || 0.7) * 0.18 + 0.84))
    });
  });
  return positioned;
}

function renderCuriosityMap(map) {
  if (!map || typeof map !== 'object') return '';
  const rawNodes = Array.isArray(map.nodes) ? map.nodes.filter((node) => node && node.id && node.label).slice(0, 8) : [];
  if (!rawNodes.length) return '';
  const nodes = rawNodes.some((node) => node.kind === 'center') ? rawNodes : [{ ...rawNodes[0], kind: 'center' }, ...rawNodes.slice(1)];
  const positions = curiosityMapPositions(nodes);
  const edges = (Array.isArray(map.edges) ? map.edges : []).filter((edge) => positions.has(edge.from) && positions.has(edge.to)).slice(0, 10);
  const edgeHtml = edges.map((edge) => {
    const from = positions.get(edge.from);
    const to = positions.get(edge.to);
    return `<line x1="${from.x}%" y1="${from.y}%" x2="${to.x}%" y2="${to.y}%"></line>`;
  }).join('');
  const nodeHtml = nodes.map((node) => {
    const pos = positions.get(node.id) || { x: 50, y: 50, scale: 1 };
    const kind = node.kind === 'center' ? 'center' : node.kind === 'domain' ? 'domain' : node.kind === 'recent' ? 'recent' : 'archive';
    const prompt = escapeHtml(String(node.prompt || '').trim());
    const title = escapeHtml(node.why || node.label);
    return `<button type="button" class="thingy-map-node is-${kind}" data-map-prompt="${prompt}" style="--x:${pos.x}%;--y:${pos.y}%;--scale:${pos.scale}" title="${title}"><span>${escapeHtml(node.label)}</span></button>`;
  }).join('');
  const sources = (Array.isArray(map.sources) ? map.sources : []).slice(0, 3);
  const sourceHtml = sources.map((source) => {
    const href = safeMarkdownUrl(source.url || '');
    const title = escapeHtml(source.title || source.subject || 'Archive source');
    const meta = escapeHtml([source.label, source.publish_date ? String(source.publish_date).slice(0, 10) : ''].filter(Boolean).join(' · '));
    const body = `<strong>${title}</strong>${meta ? `<small>${meta}</small>` : ''}`;
    return href && href !== '#'
      ? `<a class="thingy-map-source ${sourceAccentClass(source.source_kind)}" href="${href}">${body}</a>`
      : `<span class="thingy-map-source ${sourceAccentClass(source.source_kind)}">${body}</span>`;
  }).join('');
  const prompt = String(map.prompt || '').trim();
  return `
    <aside class="thingy-curiosity-map" aria-label="${escapeHtml(map.title || 'Curiosity map')}">
      <div class="thingy-map-head">
        <span class="thingy-exp-kicker">Curiosity Map</span>
        <strong>${escapeHtml(map.title || 'Curiosity Map')}</strong>
      </div>
      <div class="thingy-map-canvas">
        <svg class="thingy-map-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${edgeHtml}</svg>
        ${nodeHtml}
      </div>
      ${sourceHtml ? `<div class="thingy-map-sources">${sourceHtml}</div>` : ''}
      ${prompt ? `<button type="button" class="thingy-exp-prompt" data-map-prompt="${escapeHtml(prompt)}">Follow the surprising branch</button>` : ''}
    </aside>`;
}

function renderAnswer(answer, citations = [], experience = null) {
  return renderMarkdown(answer, citations) + renderExperience(experience);
}

function humanToolName(value) {
  return String(value || '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function activityMessageFromToolName(value) {
  const name = humanToolName(value);
  return name ? `Checked ${name}` : '';
}

function normalizeActivityCommentary(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/([.!?])(?=\S)/g, '$1 ')
    .trim()
    .slice(0, 700);
}

function normalizeActivityStep(data, fallback = 'Thingy is working...') {
  if (typeof data === 'string') return String(data || fallback).trim();
  const toolName = data?.tool_name || data?.toolName || '';
  if (toolName) return activityMessageFromToolName(toolName);
  return String(data?.message || fallback).trim().replace(/\.\.\.$/, '');
}

function appendActivityStep(steps, data, fallback) {
  const label = normalizeActivityStep(data, fallback).replace(/\s+/g, ' ').slice(0, 120);
  const note = normalizeActivityCommentary(data?.commentary || data?.detail || data?.note || '');
  if (!label) return steps;
  const last = steps[steps.length - 1] || {};
  if (String(last.label || last).toLowerCase() === label.toLowerCase()) {
    if (note && !String(last.note || '').toLowerCase().includes(note.toLowerCase())) {
      last.note = [last.note, note].filter(Boolean).join(' ');
    }
    return steps;
  }
  steps.push({ label, note });
  return steps.slice(-8);
}

function appendActivityCommentary(items, value) {
  const text = normalizeActivityCommentary(value);
  if (!text) return items;
  const last = items[items.length - 1];
  if (!last) return [{ label: 'Thinking through the path', note: text, kind: 'note' }];
  if (String(last.note || '').toLowerCase().includes(text.toLowerCase())) return items;
  last.note = [last.note, text].filter(Boolean).join(' ');
  return items;
}

function activityStepsFromToolNames(toolNames = []) {
  return Array.from(new Set((toolNames || []).map(activityMessageFromToolName).filter(Boolean)))
    .map((label) => ({ label, note: '' }));
}

function renderActivityLog(steps = [], options = {}) {
  const commentary = (options.commentary || []).filter(Boolean).map((note) => ({ label: 'Thinking through the path', note, kind: 'note' }));
  const list = (steps || []).filter(Boolean).map((step) => {
    if (typeof step === 'string') return { label: step, note: '' };
    return {
      label: String(step.label || step.text || '').trim(),
      note: String(step.note || '').trim(),
      kind: step.kind || ''
    };
  }).filter((step) => step.label || step.note).concat(commentary);
  if (!list.length && !commentary.length) return '';
  const activeIndex = options.active ? list.length - 1 : -1;
  const activityLabel = options.label || 'Archive Work';
  const elapsed = String(options.elapsedLabel || '').trim();
  const stepCount = list.length;
  const items = list.map((step, index) => {
    const state = index === activeIndex ? ' is-active' : ' is-complete';
    const rawLabel = step.label || 'Thinking through the path';
    const label = index === activeIndex && rawLabel.startsWith('Checked ') ? `Checking ${rawLabel.slice(8)}` : rawLabel;
    const note = step.note ? `<p class="librarian-activity-note">${renderInlineMarkdown(step.note, new Map())}</p>` : '';
    return `<li class="librarian-activity-step${state}">`
      + `<div class="librarian-activity-step-main"><span class="librarian-activity-dot" aria-hidden="true"></span><span>${escapeHtml(label)}</span></div>`
      + note
      + `</li>`;
  }).join('');
  const body = (items ? `<ol>${items}</ol>` : '');
  if (!options.active && options.collapsible) {
    const summary = `${stepCount} ${stepCount === 1 ? 'step' : 'steps'} completed`;
    return `<details class="librarian-activity is-collapsed" aria-label="Thingy activity">`
      + `<summary><span class="librarian-activity-kicker">${escapeHtml(activityLabel)}</span><span class="librarian-activity-summary">${escapeHtml(summary)}</span></summary>`
      + body
      + `</details>`;
  }
  return `<aside class="librarian-activity" aria-label="Thingy activity">`
    + `<div class="librarian-activity-kicker">${escapeHtml(activityLabel)}${elapsed ? `<span class="librarian-elapsed">${escapeHtml(elapsed)}</span>` : ''}</div>`
    + body
    + `</aside>`;
}

function renderAssistantResponse(answer, citations = [], experience = null, activitySteps = [], activityCommentary = [], options = {}) {
  const hasAnswer = String(answer || '').trim() || experience;
  const activity = renderActivityLog(activitySteps, { ...options, commentary: activityCommentary, collapsible: Boolean(hasAnswer) });
  if (!hasAnswer) return activity || renderAnswer(answer, citations, experience);
  return `${activity}<div class="librarian-answer-content">${renderAnswer(answer, citations, experience)}</div>`;
}

export {
  activityStepsFromToolNames,
  appendActivityCommentary,
  appendActivityStep,
  renderAssistantResponse,
  renderCuriosityMap
};
