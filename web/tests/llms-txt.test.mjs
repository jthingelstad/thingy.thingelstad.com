// /llms.txt is rendered at build time from the archive counts
// (content/archive-stats.json) and the vendored MCP surface
// (contracts/mcp-surface.json). These pin that it follows the llms.txt
// shape, quotes the same counts as the pages, names exactly the tools the
// /mcp door serves, and that every static page points to it. The shape
// check mirrors the llms.txt reference parser (the llms-txt package's
// parse_llms_file): under a "##" heading every line must be one
// "- [name](url): notes" link, or the whole parse fails.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const { buildLlmsTxt, firstSentence, llmsTxtPlugin, llmsTxtShapeProblems, renderLlmsTxt } =
  await import('../vite.llms-txt.ts');
const { formatStat, loadArchiveStats } = await import('../vite.page-data.ts');
const { loadMcpSurface, renderMcpReference } = await import('../vite.mcp-reference.ts');

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

test('llms.txt has the shape the llms.txt reference parser reads', () => {
  assert.deepEqual(llmsTxtShapeProblems(text), []);
  const sections = text.split('\n').filter((line) => line.startsWith('## '));
  assert.deepEqual(sections, [
    '## Pages',
    '## MCP server',
    '## MCP tools',
    '## MCP prompts',
    '## MCP resources',
    '## Optional'
  ]);
});

test('the shape check refuses every line the reference parser cannot read', () => {
  const good =
    '# Site\n\n> Summary.\n\nProse, and\n- a plain list.\n\n## Links\n\n- [Name](https://example.com/): notes\n';
  assert.deepEqual(llmsTxtShapeProblems(good), []);
  const bad = [
    '- Endpoint: https://librarian.thingelstad.com/mcp (Streamable HTTP, stateless)',
    '- `search_faq` (Thingy FAQ): Search the Weekly Thing FAQ.',
    'A paragraph under a heading.',
    '- [One](https://example.com/) and [two](https://example.org/)',
    '- [Two](https://example.com/): see [the other](https://example.org/)',
    '- [Name [1]](https://example.com/)',
    '- [Relative](/about/)',
    '- [Name](https://example.com/):no space',
    '### Tools'
  ];
  for (const line of bad) {
    const problems = llmsTxtShapeProblems(`${good}${line}\n`);
    assert.equal(problems.length, 1, `refuses ${line}`);
    assert.match(problems[0], /^line 11: /);
  }
  assert.equal(llmsTxtShapeProblems('# Site\n\n> Summary.\n\n### Early\n\n## Links\n').length, 1);
  assert.equal(llmsTxtShapeProblems('Site\n\n## Links\n').length, 1);
});

test('the build refuses an llms.txt the reference parser cannot read', async () => {
  assert.equal(buildLlmsTxt(webRoot), text);
  // A tool description that grows a markdown link would put two links on
  // its line: the build must stop, not ship a file that parses lossily.
  const root = await mkdtemp(join(tmpdir(), 'thingy-llms-'));
  try {
    await cp(join(webRoot, 'content'), join(root, 'content'), { recursive: true });
    const broken = structuredClone(surface);
    broken.tools.find((tool) => tool.name === 'get_source').description = 'Read [one source](https://example.com/).';
    const json = JSON.stringify(broken);
    await cp(join(webRoot, 'contracts'), join(root, 'contracts'), { recursive: true });
    await writeFile(join(root, 'contracts/mcp-surface.json'), json);
    await writeFile(
      join(root, 'contracts/mcp-surface.sha256'),
      `${createHash('sha256').update(json).digest('hex')}  mcp-surface.json\n`
    );
    assert.throws(() => buildLlmsTxt(root), /would not parse as llms\.txt:\nline \d+: one link per line: .*get_source/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('llms.txt links each tool, prompt and fact to its place on the reference page', () => {
  const reference = renderMcpReference(surface);
  const fragments = [...text.matchAll(/\]\(https:\/\/thingy\.thingelstad\.com\/connect\/reference\/#([^)]+)\)/g)].map(
    (match) => match[1]
  );
  assert.ok(fragments.length > surface.doors.mcp.tools.length);
  for (const fragment of fragments)
    assert.ok(reference.includes(`id="${fragment}"`), `reference page has #${fragment}`);
  assert.ok(text.includes(`- [MCP endpoint](${surface.server.endpoint}): `));
});

test('llms.txt quotes the archive counts the pages quote', () => {
  for (const path of ['blog.posts', 'weekly.issues', 'links_total', 'photos']) {
    const value = path.split('.').reduce((node, key) => node[key], stats);
    assert.ok(text.includes(formatStat(path, value)), `llms.txt carries ${path}`);
  }
  assert.ok(!text.includes('{{'), 'no unrendered token');
});

test('llms.txt names exactly the tools the /mcp door serves', () => {
  const named = [...text.matchAll(/^- \[`([a-z_]+)` \(/gm)].map((match) => match[1]);
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
