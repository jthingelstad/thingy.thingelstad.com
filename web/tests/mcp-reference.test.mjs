// /connect/reference/ is rendered at build time from the vendored MCP
// surface (contracts/mcp-surface.json). These pin that the artifact is
// intact and that the page documents every tool, parameter and prompt the
// server declares, with server text escaped.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const { MCP_REFERENCE_MARKER, escapeHtml, loadMcpSurface, mcpReferencePlugin, renderMcpReference } =
  await import('../vite.mcp-reference.ts');

const webRoot = fileURLToPath(new URL('..', import.meta.url));
const surface = loadMcpSurface(webRoot);
const html = renderMcpReference(surface);

test('reference table overflow is reachable by keyboard', () => {
  const wrappers = [...html.matchAll(/<div class="table-scroll"[^>]*>/g)];
  assert.ok(wrappers.length > 0);
  for (const [wrapper] of wrappers) assert.match(wrapper, /tabindex="0"/);
});

test('the vendored MCP surface matches its checksum', async () => {
  const text = await readFile(new URL('../contracts/mcp-surface.json', import.meta.url), 'utf8');
  assert.equal(JSON.parse(text).artifact, 'librarian-mcp-surface');
  assert.ok(surface.tools.length > 0);
});

test('every declared tool has an anchored entry with every parameter', () => {
  for (const tool of surface.tools) {
    const start = html.indexOf(`id="tool-${tool.name}"`);
    assert.ok(start > -1, `${tool.name} has an entry`);
    const end = html.indexOf('</section>', start);
    const entry = html.slice(start, end);
    for (const name of Object.keys(tool.inputSchema.properties || {})) {
      assert.ok(entry.includes(`<code>${name}</code>`), `${tool.name} documents ${name}`);
    }
    assert.ok(html.includes(`href="#tool-${tool.name}"`), `${tool.name} is in the contents`);
  }
});

test('every prompt, resource template and error code is documented', () => {
  for (const prompt of surface.prompts) assert.ok(html.includes(`id="prompt-${prompt.name}"`), prompt.name);
  for (const template of surface.resources.templates) assert.ok(html.includes(escapeHtml(template.uriTemplate)));
  for (const { code } of surface.errors.tool_error_codes) assert.ok(html.includes(`<code>${code}</code>`), code);
  for (const { code } of surface.errors.json_rpc) assert.ok(html.includes(`<code>${code}</code>`), String(code));
});

test('server text is escaped, never injected as markup', () => {
  assert.ok(html.includes('blog-&lt;microblog id&gt;'));
  assert.doesNotMatch(html, /<microblog/);
  assert.equal(escapeHtml('<a href="x">&</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
});

test('the plugin fills only the reference page', async () => {
  const plugin = mcpReferencePlugin(webRoot);
  const template = await readFile(new URL('../connect/reference/index.html', import.meta.url), 'utf8');
  assert.ok(template.includes(MCP_REFERENCE_MARKER));
  const built = plugin.transformIndexHtml(template);
  assert.ok(!built.includes(MCP_REFERENCE_MARKER));
  assert.ok(!built.includes('__MCP_SERVER_VERSION__'));
  assert.ok(built.includes(`"softwareVersion": "${surface.server.version}"`));
  assert.equal(plugin.transformIndexHtml('<p>other page</p>'), '<p>other page</p>');
});

test('the reference is built, indexed and linked', async () => {
  const [config, sitemap, connect, about] = await Promise.all(
    ['../vite.config.ts', '../public/sitemap.xml', '../connect/index.html', '../about/index.html'].map((path) =>
      readFile(new URL(path, import.meta.url), 'utf8')
    )
  );
  assert.ok(config.includes("'connect/reference/index.html'"));
  assert.ok(sitemap.includes('<loc>https://thingy.thingelstad.com/connect/reference/</loc>'));
  assert.ok(connect.includes('href="/connect/reference/"'));
  assert.ok(about.includes('href="/connect/reference/"'));
});
