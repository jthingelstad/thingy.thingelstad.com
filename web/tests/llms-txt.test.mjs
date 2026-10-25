// /llms.txt is rendered at build time from the archive counts
// (content/archive-stats.json) and the vendored MCP surface
// (contracts/mcp-surface.json). These pin that it follows the llms.txt
// shape, quotes the same counts as the pages, names exactly the tools the
// /mcp door serves, and that every static page points to it.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const { firstSentence, llmsTxtPlugin, renderLlmsTxt } = await import('../vite.llms-txt.ts');
const { formatStat, loadArchiveStats } = await import('../vite.page-data.ts');
const { loadMcpSurface } = await import('../vite.mcp-reference.ts');

const webRoot = fileURLToPath(new URL('..', import.meta.url));
const stats = loadArchiveStats(webRoot);
const surface = loadMcpSurface(webRoot);
const text = renderLlmsTxt(stats, surface);
const STATIC_PAGES = ['index.html', 'about/index.html', 'connect/index.html', 'connect/reference/index.html'];

test('llms.txt opens with the H1 and a blockquote summary', () => {
  const lines = text.split('\n');
  assert.equal(lines[0], '# Thingy');
  assert.equal(lines[1], '');
  assert.match(lines[2], /^> Thingy is an AI librarian/);
  assert.ok(text.endsWith('\n') && !text.endsWith('\n\n'));
});

test('llms.txt quotes the archive counts the pages quote', () => {
  for (const path of ['blog.posts', 'weekly.issues', 'links_total', 'photos']) {
    const value = path.split('.').reduce((node, key) => node[key], stats);
    assert.ok(text.includes(formatStat(path, value)), `llms.txt carries ${path}`);
  }
  assert.ok(!text.includes('{{'), 'no unrendered token');
});

test('llms.txt names exactly the tools the /mcp door serves', () => {
  const named = [...text.matchAll(/^- `([a-z_]+)` \(/gm)].map((match) => match[1]);
  const tools = named.filter((name) => surface.tools.some((tool) => tool.name === name));
  assert.deepEqual(
    tools,
    surface.tools.filter((tool) => surface.doors.mcp.tools.includes(tool.name)).map((tool) => tool.name)
  );
  for (const prompt of surface.prompts) assert.ok(text.includes(`\`${prompt.name}\``), `llms.txt lists ${prompt.name}`);
  for (const template of surface.resources.templates) assert.ok(text.includes(`\`${template.uriTemplate}\``));
  assert.ok(text.includes(surface.server.endpoint));
});

test('llms.txt links only to absolute https URLs and is never HTML-escaped', () => {
  for (const [, url] of text.matchAll(/\]\(([^)]+)\)/g)) assert.match(url, /^https:\/\//);
  assert.ok(!/&(?:amp|lt|gt|quot|#39);/.test(text));
  assert.ok(text.includes("Jamie Thingelstad's public archive"));
});

test('firstSentence keeps one sentence and collapses whitespace', () => {
  assert.equal(firstSentence('Read one source.\nThen more.'), 'Read one source.');
  assert.equal(firstSentence('No full stop'), 'No full stop');
  assert.equal(firstSentence('By id. format outline gives facts.'), 'By id.');
  assert.equal(firstSentence('An issue, e.g. librarian://wt/351. Next one.'), 'An issue, e.g. librarian://wt/351.');
});

test('the plugin emits llms.txt as a build asset', () => {
  const emitted = [];
  llmsTxtPlugin(webRoot).generateBundle.call({ emitFile: (file) => emitted.push(file) });
  assert.deepEqual(emitted, [{ type: 'asset', fileName: 'llms.txt', source: text }]);
});

test('every static page points to llms.txt', async () => {
  for (const page of STATIC_PAGES) {
    const html = await readFile(new URL(`../${page}`, import.meta.url), 'utf8');
    assert.match(
      html,
      /<link rel="alternate" type="text\/markdown" title="LLM-friendly site index" href="\/llms\.txt"\s*\/?>/,
      `${page} links llms.txt`
    );
  }
});
