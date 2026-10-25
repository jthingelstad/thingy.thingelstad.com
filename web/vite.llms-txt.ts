// Build-time /llms.txt: the site for agents and LLMs, in the llms.txt
// format (https://llmstxt.org). Counts come from content/archive-stats.json
// and the MCP tools, prompts and resources from the vendored surface
// (contracts/mcp-surface.json), so the file can never name a tool the
// server does not declare or a count the pages do not show.

import type { Plugin } from 'vite';
import { loadMcpSurface, type McpSurface } from './vite.mcp-reference.ts';
import { formatStat, loadArchiveStats, type ArchiveStats } from './vite.page-data.ts';

const SITE_URL = 'https://thingy.thingelstad.com';
const REFERENCE_URL = `${SITE_URL}/connect/reference/`;

function stat(stats: ArchiveStats, path: string): string {
  let value: unknown = stats;
  for (const key of path.split('.')) {
    value = value !== null && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined;
  }
  if (typeof value !== 'number') throw new Error(`archive-stats.json has no number at ${path}`);
  return formatStat(path, value);
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

// The first sentence of a description; the reference page has the rest.
// Sentences here often start with a lowercase parameter name ("format
// outline gives..."), so any stop before a space ends one, except e.g./i.e.
export function firstSentence(text: string): string {
  const match = /^(.+?(?<!\be\.g|\bi\.e)[.!?])(?=\s|$)/s.exec(text.trim());
  return (match ? match[1] : text.trim()).replace(/\s+/g, ' ');
}

// The shape the llms.txt reference parser (the llms-txt package's
// parse_llms_file) reads. It splits the file at every line that starts
// "##" (so "###" starts a section too) and reads every non-empty line under
// one as "- [name](url): notes": a line with no link fails the whole parse,
// a line with two keeps only the first, and the name ends at the first "]".
// Prose belongs above the first "##", after "# Title" and the "> summary",
// with no headings of its own.
const LINK_LINE = /^- \[[^[\]]+\]\(https?:[^)\s]+\)(?:: \S.*)?$/;
const PREAMBLE = /^#\s*.+?$\n+(?:^>\s*.+?$)?\n+/m;

export function llmsTxtShapeProblems(text: string): string[] {
  const problems: string[] = [];
  const lines = text.split('\n');
  const firstSection = lines.findIndex((line) => line.startsWith('##'));
  const preamble = lines.slice(0, firstSection < 0 ? lines.length : firstSection).join('\n');
  if (!/^# \S/.test(lines[0]) || !PREAMBLE.test(preamble.trim())) {
    problems.push('line 1: open with "# Title", a blank line, "> summary", a blank line, then any prose');
  }
  lines.forEach((line, index) => {
    const where = `line ${index + 1}`;
    if (index === 0 || line.trim() === '') return;
    if (firstSection < 0 || index < firstSection) {
      if (line.startsWith('#')) problems.push(`${where}: no heading between "# Title" and the first "##": ${line}`);
    } else if (line.startsWith('##')) {
      if (!/^## \S/.test(line)) problems.push(`${where}: a section heading is "## Name", never deeper: ${line}`);
    } else if (!LINK_LINE.test(line)) {
      problems.push(`${where}: every line under a "##" is one "- [name](https://...): notes": ${line}`);
    } else if (line.split('](').length !== 2) {
      problems.push(`${where}: one link per line: ${line}`);
    }
  });
  return problems;
}

export function renderLlmsTxt(stats: ArchiveStats, surface: McpSurface): string {
  const door = surface.doors.mcp;
  const tools = surface.tools.filter((tool) => door.tools.includes(tool.name));
  const lines: string[] = [];

  lines.push('# Thingy', '');
  lines.push(
    `> Thingy is an AI librarian for Jamie Thingelstad's public archive: ${stat(stats, 'blog.posts')} thingelstad.com blog posts since ${stat(stats, 'blog.since')}, ${stat(stats, 'weekly.issues')} issues of The Weekly Thing newsletter since ${stat(stats, 'weekly.since')}, and the Another Thing podcast since ${stat(stats, 'podcast.since')}. It answers questions with citations back to the original posts and issues, in chat on this site or inside your own AI through the Librarian MCP server.`,
    ''
  );
  lines.push(
    `The archive also carries ${stat(stats, 'links_total')} links Jamie shared, ${stat(stats, 'photos')} photos searchable by what they show, and ${stat(stats, 'currently_entries')} Currently entries (what Jamie was reading, watching and playing). It is Jamie's published writing only; nothing private is in it. Weekly Thing subscribers sign in with their email; there is no password.`,
    ''
  );

  // Every line from here down is one "- [name](url): notes" link under a
  // "##" heading (see llmsTxtShapeProblems).
  lines.push('## Pages', '');
  lines.push(`- [Home](${SITE_URL}/): what Thingy is and what to ask it`);
  lines.push(
    `- [Chat](${SITE_URL}/chat/): ask Thingy about the archive; guests get a short daily preview, subscribers sign in`
  );
  lines.push(`- [About](${SITE_URL}/about/): what is in the archive and how Thingy works`);
  lines.push(
    `- [Connect your AI](${SITE_URL}/connect/): add the archive to Claude, ChatGPT, Claude Code or any MCP client`
  );
  lines.push(
    `- [Librarian MCP reference](${REFERENCE_URL}): every tool with its parameters and results, OAuth 2.1, budgets and protocol conventions`
  );
  lines.push('');

  lines.push('## MCP server', '');
  lines.push(`- [MCP endpoint](${surface.server.endpoint}): ${surface.server.transport.split(':')[0]}`);
  lines.push(
    `- [Auth](${REFERENCE_URL}#oauth): ${door.auth}, issued by ${surface.oauth.issuer}. ${oneLine(surface.oauth.sign_in)}`
  );
  lines.push(
    `- [Budget](${REFERENCE_URL}#quotas): ${door.daily_quota.reader} calls a day for a reader, ${door.hourly_rate_limit} an hour`
  );
  lines.push('');

  lines.push('## MCP tools', '');
  for (const tool of tools) {
    lines.push(
      `- [\`${tool.name}\` (${tool.title})](${REFERENCE_URL}#tool-${tool.name}): ${firstSentence(tool.description)}`
    );
  }
  lines.push('');

  if (surface.prompts.length > 0) {
    lines.push('## MCP prompts', '');
    for (const prompt of surface.prompts) {
      const args = prompt.arguments.map((arg) => arg.name).join(', ');
      lines.push(
        `- [\`${prompt.name}\`${args ? ` (${args})` : ''}](${REFERENCE_URL}#prompt-${prompt.name}): ${firstSentence(prompt.description)}`
      );
    }
    lines.push('');
  }

  // The reference page lists the templates in one table, so each links to
  // the table.
  if (surface.resources.templates.length > 0) {
    lines.push('## MCP resources', '');
    for (const template of surface.resources.templates) {
      lines.push(`- [\`${template.uriTemplate}\`](${REFERENCE_URL}#resources): ${oneLine(template.description)}`);
    }
    lines.push('');
  }

  lines.push('## Optional', '');
  lines.push(
    '- [librarian-thing](https://github.com/jthingelstad/librarian-thing): the open-source corpus pipeline, API and MCP server'
  );
  lines.push(
    '- [thingy.thingelstad.com](https://github.com/jthingelstad/thingy.thingelstad.com): the open-source source of this site'
  );
  lines.push(`- [Sitemap](${SITE_URL}/sitemap.xml)`);

  return `${lines.join('\n')}\n`;
}

// Renders the file and refuses one the reference parser cannot read, so a
// new tool description or a hand edit fails the build rather than the
// parse.
export function buildLlmsTxt(root: string): string {
  const text = renderLlmsTxt(loadArchiveStats(root), loadMcpSurface(root));
  const problems = llmsTxtShapeProblems(text);
  if (problems.length > 0) {
    throw new Error(`llms.txt would not parse as llms.txt:\n${problems.join('\n')}`);
  }
  return text;
}

export function llmsTxtPlugin(root: string): Plugin {
  const build = () => buildLlmsTxt(root);
  return {
    name: 'thingy-llms-txt',
    configureServer(server) {
      server.middlewares.use('/llms.txt', (_req, res) => {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end(build());
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'llms.txt', source: build() });
    }
  };
}
