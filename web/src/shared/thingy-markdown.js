// @ts-check
function escapeHtml(value) {
  return String(value || '').replace(
    /[&<>"']/g,
    (char) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      })[char]
  );
}

function safeMarkdownUrl(url) {
  const value = String(url || '').trim();
  if (/^https?:/i.test(value) || /^mailto:/i.test(value)) return escapeHtml(value);
  if (/^\/archive\//i.test(value)) return escapeHtml(`https://weekly.thingelstad.com${value}`);
  if (/^\//.test(value)) return escapeHtml(value);
  return '#';
}

function citationMap(citations) {
  const map = new Map();
  (citations || []).forEach((citation) => {
    const issue = String(citation.issue_number || '').trim();
    if (issue && citation.url && !map.has(issue)) map.set(issue, citation);
  });
  return map;
}

function citationTitle(citation) {
  const parts = [`WT${citation.issue_number}: ${citation.subject || 'Weekly Thing'}`];
  if (citation.publish_date) parts.push(String(citation.publish_date).slice(0, 10));
  if (citation.section) parts.push(citation.section);
  return parts.join(' | ');
}

function linkIssueReferences(html, citationsByIssue) {
  if (!citationsByIssue || citationsByIssue.size === 0) return html;
  return html
    .split(/(<[^>]+>)/g)
    .map((part) => {
      if (part.startsWith('<')) return part;
      return part.replace(/(^|[^\w&])(?:WT|#)(\d{1,4})\b/g, (match, prefix, issue) => {
        const citation = citationsByIssue.get(issue);
        if (!citation) return match;
        return `${prefix}<a href="${safeMarkdownUrl(citation.url)}" title="${escapeHtml(citationTitle(citation))}" data-tinylytics-event="librarian.source_click" data-tinylytics-event-value="${escapeHtml(issue)}">WT${escapeHtml(issue)}</a>`;
      });
    })
    .join('');
}

function renderInlineMarkdown(text, citationsByIssue = new Map()) {
  let html = escapeHtml(text);
  const code = [];
  html = html.replace(/`([^`]+)`/g, (_, value) => {
    const token = `@@CODE${code.length}@@`;
    code.push(`<code>${value}</code>`);
    return token;
  });
  html = html.replace(
    /\[([^\]]+)\]\(([^)\s]+)\)/g,
    (_, label, url) => `<a href="${safeMarkdownUrl(url)}">${label}</a>`
  );
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  html = html.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  html = html.replace(/(^|[^_])_([^_\n]+)_/g, '$1<em>$2</em>');
  html = linkIssueReferences(html, citationsByIssue);
  code.forEach((value, index) => {
    html = html.replace(`@@CODE${index}@@`, value);
  });
  return html;
}

function renderMarkdown(markdown, citations = []) {
  const text = String(markdown || '').trim();
  if (!text) return '<p>Thingy is thinking...</p>';
  const citationsByIssue = citationMap(citations);
  const lines = text.split(/\r?\n/);
  const html = [];
  let paragraph = [];
  let listType = null;
  let blockquote = [];

  function flushParagraph() {
    if (!paragraph.length) return;
    html.push(`<p>${renderInlineMarkdown(paragraph.join(' '), citationsByIssue)}</p>`);
    paragraph = [];
  }

  function flushList() {
    if (!listType) return;
    html.push(`</${listType}>`);
    listType = null;
  }

  function flushBlockquote() {
    if (!blockquote.length) return;
    html.push(`<blockquote>${renderMarkdown(blockquote.join('\n'), citations)}</blockquote>`);
    blockquote = [];
  }

  function openList(type) {
    if (listType === type) return;
    flushParagraph();
    flushBlockquote();
    flushList();
    listType = type;
    html.push(`<${type}>`);
  }

  function isTableRow(value) {
    const trimmed = String(value || '').trim();
    return trimmed.startsWith('|') && trimmed.endsWith('|') && trimmed.slice(1, -1).includes('|');
  }

  function tableCells(value) {
    return String(value || '')
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((cell) => cell.trim());
  }

  function isTableSeparator(value) {
    if (!isTableRow(value)) return false;
    return tableCells(value).every((cell) => /^:?-{3,}:?$/.test(cell));
  }

  function renderTableCell(tag, value) {
    return `<${tag}>${renderInlineMarkdown(value, citationsByIssue)}</${tag}>`;
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph();
      flushBlockquote();
      flushList();
      continue;
    }

    if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushParagraph();
      flushBlockquote();
      flushList();
      html.push('<hr>');
      continue;
    }

    if (isTableRow(trimmed) && isTableSeparator(lines[index + 1])) {
      flushParagraph();
      flushBlockquote();
      flushList();
      const headers = tableCells(trimmed);
      index += 2;
      const rows = [];
      while (index < lines.length && isTableRow(lines[index])) {
        rows.push(tableCells(lines[index]));
        index += 1;
      }
      index -= 1;
      html.push('<div class="librarian-table-wrap"><table>');
      html.push(`<thead><tr>${headers.map((cell) => renderTableCell('th', cell)).join('')}</tr></thead>`);
      html.push('<tbody>');
      for (const row of rows) {
        const normalized = headers.map((_, cellIndex) => row[cellIndex] || '');
        html.push(`<tr>${normalized.map((cell) => renderTableCell('td', cell)).join('')}</tr>`);
      }
      html.push('</tbody></table></div>');
      continue;
    }

    const heading = /^(#{2,4})\s+(.+)$/.exec(trimmed);
    if (heading) {
      flushParagraph();
      flushBlockquote();
      flushList();
      const level = heading[1].length;
      html.push(`<h${level}>${renderInlineMarkdown(heading[2], citationsByIssue)}</h${level}>`);
      continue;
    }

    const unordered = /^[-*]\s+(.+)$/.exec(trimmed);
    if (unordered) {
      openList('ul');
      html.push(`<li>${renderInlineMarkdown(unordered[1], citationsByIssue)}</li>`);
      continue;
    }

    const ordered = /^\d+\.\s+(.+)$/.exec(trimmed);
    if (ordered) {
      openList('ol');
      html.push(`<li>${renderInlineMarkdown(ordered[1], citationsByIssue)}</li>`);
      continue;
    }

    const quote = /^>\s?(.+)$/.exec(trimmed);
    if (quote) {
      flushParagraph();
      flushList();
      blockquote.push(quote[1]);
      continue;
    }

    flushList();
    flushBlockquote();
    paragraph.push(trimmed);
  }

  flushParagraph();
  flushBlockquote();
  flushList();
  return html.join('');
}

export { citationMap, escapeHtml, renderInlineMarkdown, renderMarkdown, safeMarkdownUrl };
