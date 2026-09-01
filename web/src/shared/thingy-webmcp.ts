// WebMCP: register Thingy's archive tools with the browser's model context
// so an in-page agent (Gemini in Chrome, or the WebMCP Bridge extension
// feeding a desktop MCP client) can query the archive with the reader's own
// session. The tools proxy to POST /api/tools; the HttpOnly session cookie
// rides the same-origin fetch, so this module never touches a credential.
// Design: the "Thingy WebMCP" spec, revision 2 (2026-09-01).
import { trackEvent } from './thingy-analytics.ts';
import { librarianApiUrl } from './thingy-config.ts';
import { contractRequestHeaders } from './thingy-contracts.ts';
import { sessionActive, signedInHintKey } from './thingy-session.ts';

interface WebMcpToolDeclaration {
  name: string;
  title?: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

interface WebMcpContent {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

interface WebMcpRuntimeOptions {
  modelContext: ModelContextLike;
  fetchImpl?: typeof fetch;
  isSignedIn?: () => boolean;
}

function textResult(text: string, isError = false): WebMcpContent {
  return { content: [{ type: 'text', text }], isError };
}

export function createWebMcpRuntime(options: WebMcpRuntimeOptions) {
  const fetchImpl = options.fetchImpl || ((input, init) => window.fetch(input, init));
  const isSignedIn = options.isSignedIn || sessionActive;
  let controller: AbortController | null = null;
  let registering: Promise<number> | null = null;

  async function postTools(payload: Record<string, unknown>) {
    const response = await fetchImpl(`${librarianApiUrl()}/tools`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...contractRequestHeaders() },
      body: JSON.stringify(payload)
    });
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: response.ok, status: response.status, data };
  }

  async function callTool(name: string, args: Record<string, unknown>): Promise<WebMcpContent> {
    try {
      const { ok, status, data } = await postTools({ action: 'call', tool: name, arguments: args });
      if (!ok) {
        // Stays silent toward the agent's reader, but not toward us: the
        // Lambda only logs calls that reach it, so HTTP-level failures are
        // invisible without this counter.
        trackEvent('librarian.webmcp_error', `status.${status}`);
        const message =
          status === 401
            ? 'The Thingy session ended. Ask the reader to sign in again at thingy.thingelstad.com.'
            : String(data.error || `Tool call failed (${status}).`);
        return textResult(message, true);
      }
      const content = Array.isArray(data.content) ? (data.content as WebMcpContent['content']) : null;
      if (!content) return textResult('The archive returned an unexpected response.', true);
      return { content, isError: Boolean(data.is_error) };
    } catch (error) {
      trackEvent('librarian.webmcp_error', 'unreachable');
      return textResult('The archive could not be reached. Please try again.', true);
    }
  }

  async function register(): Promise<number> {
    if (controller) return 0;
    if (registering) return registering;
    registering = (async () => {
      const { ok, data } = await postTools({ action: 'list' });
      const tools = ok && Array.isArray(data.tools) ? (data.tools as WebMcpToolDeclaration[]) : [];
      if (!tools.length) return 0;
      controller = new AbortController();
      const registrations = tools.map((tool) =>
        Promise.resolve(
          options.modelContext.registerTool(
            {
              name: tool.name,
              title: tool.title,
              description: tool.description,
              inputSchema: tool.inputSchema,
              execute: (args: Record<string, unknown>) => callTool(tool.name, args || {})
            },
            controller ? { signal: controller.signal } : undefined
          )
        )
      );
      const settled = await Promise.allSettled(registrations);
      const registered = settled.filter((entry) => entry.status === 'fulfilled').length;
      trackEvent('librarian.webmcp_register', `${registered}.of.${tools.length}`);
      return registered;
    })().finally(() => {
      registering = null;
    });
    return registering;
  }

  function unregister() {
    controller?.abort();
    controller = null;
  }

  // Tools exist exactly while the reader is signed in.
  async function sync() {
    if (isSignedIn()) return register();
    unregister();
    return 0;
  }

  return { callTool, register, sync, unregister, isRegistered: () => Boolean(controller) };
}

async function resolveModelContext(): Promise<ModelContextLike | null> {
  const native = document.modelContext ?? navigator.modelContext;
  if (native) return native;
  try {
    // Bundled polyfill: installs document.modelContext so the WebMCP Bridge
    // extension (and other polyfill-aware consumers) can see the tools in
    // browsers without the native API. Loaded lazily - visitors without an
    // agent in play never parse it.
    const { initializeWebMCPPolyfill } = await import('@mcp-b/webmcp-polyfill');
    initializeWebMCPPolyfill();
    return document.modelContext ?? null;
  } catch (error) {
    return null;
  }
}

// Boot from the chat page entry. Silent by design: agent tooling must never
// affect the reading experience. Kill switch: window.ThingyConfig.webmcp='off'.
export async function bootWebMcp() {
  try {
    if (window.ThingyConfig?.webmcp === 'off') return;
    const modelContext = await resolveModelContext();
    if (!modelContext) return;
    const runtime = createWebMcpRuntime({ modelContext });
    window.addEventListener('storage', (event) => {
      if (event.key === null || event.key === signedInHintKey) void runtime.sync();
    });
    await runtime.sync();
  } catch (error) {
    /* never let agent plumbing break the page */
  }
}
