import assert from 'node:assert/strict';
import test from 'node:test';

global.window = global.window || {};
global.window.ThingyConfig = { librarianApiUrl: '/api' };
global.document = global.document || { querySelector: () => null };

const { createWebMcpRuntime } = await import('../src/shared/thingy-webmcp.ts');

const DECLARATIONS = [
  { name: 'search_archive', title: 'Search the archive', description: 'Search.', inputSchema: { type: 'object' } },
  { name: 'get_source', title: 'Read a source', description: 'Fetch one source.', inputSchema: { type: 'object' } }
];

function fakeModelContext() {
  const tools = new Map();
  return {
    tools,
    registerTool(tool, options) {
      tools.set(tool.name, tool);
      options?.signal?.addEventListener('abort', () => tools.delete(tool.name));
    }
  };
}

function fakeFetch(responses) {
  const calls = [];
  const impl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body, headers: init.headers });
    const respond = responses[body.action];
    const { status = 200, data = {} } = typeof respond === 'function' ? respond(body) : respond;
    return { ok: status >= 200 && status < 300, status, json: async () => data };
  };
  return { impl, calls };
}

test('signed-in sync registers every listed tool against /api/tools', async () => {
  const modelContext = fakeModelContext();
  const { impl, calls } = fakeFetch({ list: { data: { tools: DECLARATIONS, server_version: '1.1.0+tools.x' } } });
  const runtime = createWebMcpRuntime({ modelContext, fetchImpl: impl, isSignedIn: () => true });
  const registered = await runtime.sync();
  assert.equal(registered, 2);
  assert.deepEqual([...modelContext.tools.keys()], ['search_archive', 'get_source']);
  assert.equal(calls[0].url, '/api/tools');
  assert.ok(calls[0].headers['x-librarian-contract-version'], 'contract header must ride every call');
  assert.equal(runtime.isRegistered(), true);
});

test('signed-out sync aborts and empties the registration', async () => {
  const modelContext = fakeModelContext();
  const { impl } = fakeFetch({ list: { data: { tools: DECLARATIONS } } });
  let signedIn = true;
  const runtime = createWebMcpRuntime({ modelContext, fetchImpl: impl, isSignedIn: () => signedIn });
  await runtime.sync();
  assert.equal(modelContext.tools.size, 2);
  signedIn = false;
  await runtime.sync();
  assert.equal(modelContext.tools.size, 0);
  assert.equal(runtime.isRegistered(), false);
});

test('an unauthenticated or empty list registers nothing', async () => {
  const modelContext = fakeModelContext();
  const { impl } = fakeFetch({ list: { status: 401, data: { error: 'Please sign in.' } } });
  const runtime = createWebMcpRuntime({ modelContext, fetchImpl: impl, isSignedIn: () => true });
  assert.equal(await runtime.sync(), 0);
  assert.equal(modelContext.tools.size, 0);
  assert.equal(runtime.isRegistered(), false);
});

test('execute proxies the call and passes MCP content through verbatim', async () => {
  const modelContext = fakeModelContext();
  const { impl, calls } = fakeFetch({
    list: { data: { tools: DECLARATIONS } },
    call: (body) => ({
      data: { content: [{ type: 'text', text: `result for ${body.tool}` }], is_error: false }
    })
  });
  const runtime = createWebMcpRuntime({ modelContext, fetchImpl: impl, isSignedIn: () => true });
  await runtime.sync();
  const tool = modelContext.tools.get('search_archive');
  const result = await tool.execute({ query: 'sabbatical' });
  assert.deepEqual(result.content, [{ type: 'text', text: 'result for search_archive' }]);
  assert.equal(result.isError, false);
  const call = calls.find((entry) => entry.body.action === 'call');
  assert.deepEqual(call.body, { action: 'call', tool: 'search_archive', arguments: { query: 'sabbatical' } });
});

test('a mid-session 401 comes back as polite error content, not a throw', async () => {
  const modelContext = fakeModelContext();
  const { impl } = fakeFetch({
    list: { data: { tools: DECLARATIONS } },
    call: { status: 401, data: { error: 'Please sign in.' } }
  });
  const runtime = createWebMcpRuntime({ modelContext, fetchImpl: impl, isSignedIn: () => true });
  await runtime.sync();
  const result = await modelContext.tools.get('get_source').execute({});
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /sign in again at thingy.thingelstad.com/);
});

test('concurrent syncs register the tool set exactly once', async () => {
  const modelContext = fakeModelContext();
  const { impl, calls } = fakeFetch({ list: { data: { tools: DECLARATIONS } } });
  const runtime = createWebMcpRuntime({ modelContext, fetchImpl: impl, isSignedIn: () => true });
  await Promise.all([runtime.sync(), runtime.sync(), runtime.sync()]);
  assert.equal(modelContext.tools.size, 2);
  assert.equal(calls.filter((entry) => entry.body.action === 'list').length, 1);
});
