// Build-time renderer for /connect/reference/: turns the vendored Librarian
// MCP surface (contracts/mcp-surface.json, synced by
// scripts/sync-mcp-surface.mjs) into static HTML, so the reference is real
// crawlable markup and can never claim a tool, parameter or limit the
// server does not declare. The page template carries the head, nav and
// footer; the plugin replaces its <!--mcp-reference--> marker.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

type Json = Record<string, unknown>;

interface Schema {
  type?: string | string[];
  description?: string;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  default?: unknown;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  items?: Schema;
  properties?: Record<string, Schema>;
  required?: string[];
}

interface Tool {
  name: string;
  title: string;
  description: string;
  inputSchema: Schema;
  outputSchema: Schema;
  annotations: { title?: string; readOnlyHint?: boolean; openWorldHint?: boolean };
  chat_description?: string;
  conditional?: string;
  paged_list?: string;
  doors: { mcp: boolean; webmcp: boolean; chat: boolean; guest_chat: boolean };
}

interface Door {
  path: string;
  url?: string;
  auth: string;
  runtime?: string;
  tools: string[];
  max_tool_turns?: number;
  daily_quota: Record<string, number | string>;
  hourly_rate_limit: number;
  result_cap_chars: number | null;
}

interface Prompt {
  name: string;
  title: string;
  description: string;
  arguments: { name: string; description: string; required: boolean }[];
  call_sequence: string;
}

export interface McpSurface {
  server: {
    name: string;
    title: string;
    version: string;
    version_format: string;
    endpoint: string;
    transport: string;
    protocol_versions: { default: string; supported: string[] };
    capabilities: Json;
    instructions: string;
  };
  doors: { mcp: Door; webmcp: Door; chat: Door; guest_chat: Door };
  quota_rules: { reset: string; supporting_member_multiplier: number; owner: string; pools: string };
  tools: Tool[];
  retired_tools: { name: string; replacement: string }[];
  retired_tool_result: Json;
  resources: {
    templates: { uriTemplate: string; name: string; title: string; description: string; mimeType: string }[];
    list: { tool: string; arguments: Json } | null;
    quota: string;
  };
  prompts: Prompt[];
  errors: {
    tool_error_codes: { code: string; next: string }[];
    invalid_arguments_example: Json;
    json_rpc: { key: string; when: string; http_status: number; code: number; message: string }[];
  };
  limits: {
    result_max_chars: number;
    paged_lists: Record<string, string>;
    view_photo: { max_images: number; max_image_bytes: number; byte_budget: number; resize_width: number };
  };
  oauth: {
    issuer: string;
    authorization_server_metadata: string;
    protected_resource_metadata: string;
    metadata: {
      authorization_endpoint: string;
      token_endpoint: string;
      registration_endpoint: string;
      grant_types_supported: string[];
      code_challenge_methods_supported: string[];
      token_endpoint_auth_methods_supported: string[];
      scopes_supported: string[];
    };
    sign_in: string;
    lifetimes_seconds: Record<string, number>;
    refresh_rotation: string;
    rate_limits: Record<string, number>;
  };
}

// How the reference groups the tools. A tool the server adds that is not
// listed here still renders, under "More tools", so the page never drops one.
const TOOL_GROUPS: { id: string; title: string; blurb: string; tools: string[] }[] = [
  {
    id: 'search-and-read',
    title: 'Search and read',
    blurb: 'Find passages by meaning or exact words, read a source whole, and gather evidence for claims.',
    tools: ['search_archive', 'get_source', 'quote_search', 'find_evidence']
  },
  {
    id: 'time',
    title: 'Time',
    blurb: 'How a topic moves across the years, then against now, this day in past years, and what is newest.',
    tools: ['archive_lens', 'compare_eras', 'on_this_day', 'latest_content']
  },
  {
    id: 'links-and-structure',
    title: 'Links and structure',
    blurb: 'The link graph, the topic catalogue, and browsing the archive as a list.',
    tools: ['find_links', 'top_references', 'source_neighborhood', 'list_content', 'list_topics']
  },
  {
    id: 'media',
    title: 'Media',
    blurb: 'Photos found by what they show, and vision over them.',
    tools: ['media_search', 'view_photo']
  },
  {
    id: 'discovery',
    title: 'Discovery',
    blurb: 'Serendipity and the week-by-week record of what Jamie was into.',
    tools: ['archive_gems', 'currently_history']
  },
  {
    id: 'meta',
    title: 'About the archive',
    blurb: 'What the archive holds, and answers about Thingy itself.',
    tools: ['corpus_stats', 'search_faq']
  },
  {
    id: 'live-web',
    title: 'Live web',
    blurb: 'The only tools that reach past the archive. Not offered on WebMCP or to guests.',
    tools: ['fetch_page', 'web_search']
  }
];

// Fields every registry tool's result carries; documented once, in the
// conventions, rather than on every tool.
const ENVELOPE_FIELDS = new Set(['applied', 'truncated', 'server_version']);

const number = (value: number) => value.toLocaleString('en-US');

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

const code = (value: unknown) => `<code>${escapeHtml(value)}</code>`;

function duration(seconds: number) {
  if (seconds % 86400 === 0) {
    const days = seconds / 86400;
    return days === 365 ? '1 year' : `${days} days`;
  }
  if (seconds % 3600 === 0) return seconds === 3600 ? '1 hour' : `${seconds / 3600} hours`;
  return `${seconds / 60} minutes`;
}

// Prose from the server (descriptions) with tool names linked to their
// entries. Escaped first; names are matched whole.
function linkTools(text: string, names: string[]) {
  const escaped = escapeHtml(text);
  if (!names.length) return escaped;
  const pattern = new RegExp(`\\b(${names.join('|')})\\b`, 'g');
  return escaped.replace(pattern, (name) => `<a href="#tool-${name}"><code>${name}</code></a>`);
}

function typeLabel(schema: Schema): string {
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : ['any'];
  return types
    .map((type) => {
      if (type !== 'array') return type;
      if (!schema.items) return 'array';
      const item = typeLabel(schema.items);
      const fixed = schema.minItems !== undefined && schema.minItems === schema.maxItems;
      return fixed ? `${item}[${schema.minItems}]` : `${item}[]`;
    })
    .join(' | ');
}

// Bounds print bare: most are years (1990 to 2100) or small counts.
function rangeText(min: number | undefined, max: number | undefined, unit = '') {
  if (min !== undefined && max !== undefined) return `${min} to ${max}${unit}`;
  if (min !== undefined) return `at least ${min}${unit}`;
  if (max !== undefined) return `at most ${max}${unit}`;
  return '';
}

function constraints(schema: Schema): string[] {
  const out: string[] = [];
  if (schema.enum) out.push(`one of ${schema.enum.map(code).join(', ')}`);
  const range = rangeText(schema.minimum, schema.maximum);
  if (range) out.push(range);
  if (schema.maxLength !== undefined) out.push(`up to ${number(schema.maxLength)} characters`);
  const fixed = schema.minItems !== undefined && schema.minItems === schema.maxItems;
  if (!fixed) {
    const items = rangeText(schema.minItems, schema.maxItems, ' items');
    if (items) out.push(items);
  }
  if (schema.items) {
    const inner = constraints(schema.items);
    if (inner.length) out.push(`each ${inner.join(', ')}`);
  }
  if (schema.default !== undefined) out.push(`default ${code(JSON.stringify(schema.default))}`);
  return out;
}

function parameterTable(tool: Tool, names: string[]) {
  const properties = Object.entries(tool.inputSchema.properties || {});
  if (!properties.length) return '<p class="muted">No parameters.</p>';
  const required = new Set(tool.inputSchema.required || []);
  const rows = properties
    .map(
      ([name, schema]) => `<tr>
          <td>${code(name)}${required.has(name) ? ' <span class="req">required</span>' : ''}</td>
          <td>${code(typeLabel(schema))}</td>
          <td>${constraints(schema).join('; ')}</td>
          <td>${linkTools(schema.description || '', names)}</td>
        </tr>`
    )
    .join('');
  return `<div class="table-scroll"><table class="params">
        <thead><tr><th>Parameter</th><th>Type</th><th>Constraints</th><th>Description</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`;
}

function outputList(tool: Tool, names: string[]) {
  const required = new Set(tool.outputSchema.required || []);
  const own = Object.entries(tool.outputSchema.properties || {}).filter(
    ([name]) => name !== 'server_version' && (tool.name === 'view_photo' || !ENVELOPE_FIELDS.has(name))
  );
  const items = own
    .map(
      ([name, schema]) =>
        `<li>${code(name)} <span class="type">${escapeHtml(typeLabel(schema))}${required.has(name) ? '' : ', optional'}</span>${
          schema.description ? `: ${linkTools(schema.description, names)}` : ''
        }</li>`
    )
    .join('');
  const envelope =
    tool.name === 'view_photo'
      ? 'The photos themselves come back as MCP <code>image</code> content blocks ahead of this summary.'
      : 'Plus the envelope every tool carries: <a href="#applied"><code>applied</code></a>, <a href="#truncation"><code>truncated</code></a> when something was cut, and <a href="#versioning"><code>server_version</code></a>.';
  return `<ul class="fields">${items}</ul><p class="muted">${envelope}</p>`;
}

function badges(tool: Tool) {
  const out = [
    tool.annotations.readOnlyHint ? '<span class="badge">read-only</span>' : '',
    tool.annotations.openWorldHint
      ? '<span class="badge is-warn">open world: reaches the live web</span>'
      : '<span class="badge">closed world: archive only</span>',
    tool.doors.mcp ? '<span class="badge is-door">MCP</span>' : '',
    tool.doors.webmcp ? '<span class="badge is-door">WebMCP</span>' : '',
    tool.doors.chat ? '<span class="badge is-door">Thingy chat</span>' : '',
    tool.doors.guest_chat ? '<span class="badge is-door">guest chat</span>' : ''
  ];
  return `<p class="badges">${out.filter(Boolean).join(' ')}</p>`;
}

function toolDeclaration(tool: Tool) {
  const { name, title, description, inputSchema, outputSchema, annotations } = tool;
  return JSON.stringify({ name, title, description, inputSchema, outputSchema, annotations }, null, 2);
}

function toolSection(tool: Tool, names: string[]) {
  const paged = tool.paged_list
    ? `<p>Pages ${code(tool.paged_list)} with <code>limit</code> and <code>offset</code>; a cut page says where the next starts in <code>truncated.next_offset</code>.</p>`
    : '';
  const conditional = tool.conditional ? `<p class="note">${escapeHtml(tool.conditional)}</p>` : '';
  const chat = tool.chat_description
    ? `<details><summary>What Thingy&rsquo;s own agent is told</summary><p>The chat loop binds the same schema with the description written for Thingy&rsquo;s app:</p><blockquote>${linkTools(tool.chat_description, names)}</blockquote></details>`
    : '';
  return `<section class="tool" id="tool-${escapeHtml(tool.name)}">
      <h3><a class="anchor" href="#tool-${escapeHtml(tool.name)}">${escapeHtml(tool.title)}</a> <code class="tool-name">${escapeHtml(tool.name)}</code></h3>
      ${badges(tool)}
      ${conditional}
      <p>${linkTools(tool.description, names)}</p>
      <h4>Parameters</h4>
      ${parameterTable(tool, names)}
      <h4>Returns</h4>
      ${outputList(tool, names)}
      ${paged}
      ${chat}
      <details><summary>The declaration, as <code>tools/list</code> sends it</summary><pre>${escapeHtml(toolDeclaration(tool))}</pre></details>
    </section>`;
}

function groupedTools(surface: McpSurface) {
  const placed = new Set<string>();
  const groups = TOOL_GROUPS.map((group) => {
    const tools = group.tools
      .map((name) => surface.tools.find((tool) => tool.name === name))
      .filter((tool): tool is Tool => Boolean(tool));
    tools.forEach((tool) => placed.add(tool.name));
    return { ...group, tools };
  }).filter((group) => group.tools.length);
  const rest = surface.tools.filter((tool) => !placed.has(tool.name));
  if (rest.length) {
    groups.push({ id: 'more', title: 'More tools', blurb: 'Newer tools on the server.', tools: rest });
  }
  return groups;
}

// A door's tool count as a deployment without optional configuration
// serves it, plus the tools that need configuration (web_search).
function toolCount(surface: McpSurface, door: Door) {
  const conditional = door.tools.filter((name) => surface.tools.find((tool) => tool.name === name)?.conditional);
  const base = door.tools.length - conditional.length;
  return conditional.length
    ? `${base} (+${conditional.map((name) => code(name)).join(', ')} where configured)`
    : `${base}`;
}

function quotaText(door: Door) {
  const quota = door.daily_quota;
  if ('global' in quota) return `${number(Number(quota.visitor))} per visitor, ${number(Number(quota.global))} overall`;
  return `${number(Number(quota.reader))} (${number(Number(quota.supporting_member))} for Supporting Members)`;
}

function doorsTable(surface: McpSurface) {
  const rows: [string, Door, string][] = [
    ['Thingy chat', surface.doors.chat, '/chat/ on this site'],
    ['Thingy chat, guest', surface.doors.guest_chat, '/chat/ without signing in'],
    ['MCP', surface.doors.mcp, surface.doors.mcp.url || ''],
    ['WebMCP', surface.doors.webmcp, surface.doors.webmcp.url || '']
  ];
  const body = rows
    .map(
      ([label, door, where]) => `<tr>
        <td><b>${escapeHtml(label)}</b><br><span class="muted">${escapeHtml(where)}</span></td>
        <td>${escapeHtml(door.auth)}</td>
        <td>${toolCount(surface, door)}</td>
        <td>${quotaText(door)} ${escapeHtml(String(door.daily_quota.unit))}s</td>
        <td>${number(door.hourly_rate_limit)}</td>
        <td>${door.result_cap_chars ? `${number(door.result_cap_chars)} characters` : 'none (in-process)'}</td>
      </tr>`
    )
    .join('');
  return `<div class="table-scroll"><table>
      <thead><tr><th>Door</th><th>Who</th><th>Tools</th><th>Daily budget</th><th>Per hour</th><th>Result cap</th></tr></thead>
      <tbody>${body}</tbody>
    </table></div>`;
}

function doorsFigure(surface: McpSurface) {
  const { chat, mcp, webmcp } = surface.doors;
  return `<figure class="doors-figure" aria-label="One tool registry, three doors">
      <div class="doors">
        <div class="door"><b>Thingy&rsquo;s chat</b><span>Bedrock Converse agent loop, up to ${chat.max_tool_turns} tool turns</span><span>${toolCount(surface, chat)} tools, called in-process</span></div>
        <div class="door"><b>MCP</b><span>Claude, ChatGPT, Claude Code, any client</span><span>${toolCount(surface, mcp)} tools over OAuth 2.1</span></div>
        <div class="door"><b>WebMCP</b><span>an agent in your browser</span><span>${toolCount(surface, webmcp)} tools through your Thingy session</span></div>
      </div>
      <div class="flow-step">argument validation &rarr; quota &rarr; audited invoker &rarr; result renderer</div>
      <div class="flow-step is-core"><b>One tool registry</b><span>one handler and one published spec per tool</span></div>
      <div class="flow-step">Weekly Thing, blog and podcast corpora, the link graph, the photo index</div>
      <figcaption>Every door calls the same handlers with the same schemas; the doors differ only in who may call, how much, and how results are sized.</figcaption>
    </figure>`;
}

function howItWorks(surface: McpSurface) {
  const { chat, mcp, webmcp } = surface.doors;
  const notOnWeb = mcp.tools.filter((name) => !webmcp.tools.includes(name));
  return `<section id="how-it-works">
    <h2>How it works</h2>
    <p>Thingy is not a chatbot with private powers. Its agent answers from one registry of archive tools in the Librarian (the open-source <a href="https://github.com/jthingelstad/librarian-thing">librarian-thing</a>), each declared once in a published spec. The same registry is open through three doors, so an outside agent gets exactly the tools Thingy uses.</p>
    ${doorsFigure(surface)}
    <ul>
      <li><b>Thingy&rsquo;s chat.</b> Claude on Amazon Bedrock runs a Converse agent loop with ${toolCount(surface, chat)} tools bound as Converse tool specs. Tool results stay whole there, since model context in the loop is cheap, but the loop holds itself to the same argument checks and error records as the outside doors. Guests get the ${toolCount(surface, surface.doors.guest_chat)} archive-only tools.</li>
      <li><b>MCP.</b> <code>${escapeHtml(mcp.url || '')}</code> serves the registry over MCP to any client, behind OAuth 2.1. Results are sized for clients that pay for every byte: compact JSON, cut structurally under ${number(surface.limits.result_max_chars)} characters.</li>
      <li><b>WebMCP.</b> While you are signed in, the <a href="/chat/">chat page</a> registers the tools with your browser&rsquo;s model context and proxies calls to <code>/api/tools</code> with your session. It leaves out ${notOnWeb.map(code).join(', ')}: a page agent has its own web access and renders archive images natively.</li>
    </ul>
    <p>The parity is structural, not a promise: the doors bind one spec file, run one argument validator, share one audited invoker and one result renderer, and the tests hold Thingy&rsquo;s system prompt to the bound schemas. Each tool carries two descriptions. The chat binds the one written for Thingy&rsquo;s app; MCP and WebMCP clients get one written for an agent with no app around it. Each tool entry below shows both.</p>
    ${doorsTable(surface)}
  </section>`;
}

function connecting(surface: McpSurface) {
  const { oauth, doors, quota_rules: rules } = surface;
  const life = oauth.lifetimes_seconds;
  const quotaError = surface.errors.json_rpc.find((entry) => entry.key === 'quota_exhausted');
  return `<section id="connecting">
    <h2>Connecting</h2>
    <p>Step-by-step setup for Claude, ChatGPT and Claude Code is on <a href="/connect/">Connect your AI</a>. This is what happens underneath.</p>
    <pre>${escapeHtml(surface.server.endpoint)}</pre>
    <p><b>Transport.</b> ${escapeHtml(surface.server.transport)}. There are no sessions, no server-sent events and no <code>Mcp-Session-Id</code>; every request stands alone, which is what lets the server run on Lambda.</p>
    <h3 id="oauth">OAuth 2.1</h3>
    <ol>
      <li>A request without a token answers <code>401</code> with <code>WWW-Authenticate: Bearer resource_metadata="${escapeHtml(oauth.protected_resource_metadata)}"</code>.</li>
      <li>The protected resource metadata (RFC 9728) names the authorization server, <code>${escapeHtml(oauth.issuer)}</code>, whose metadata (RFC 8414) is at <code>${escapeHtml(oauth.authorization_server_metadata)}</code>.</li>
      <li>The client registers itself at <code>${escapeHtml(oauth.metadata.registration_endpoint)}</code> (dynamic client registration, RFC 7591). Clients are public: token endpoint auth ${oauth.metadata.token_endpoint_auth_methods_supported.map(code).join(', ')}, no client secret.</li>
      <li>The client opens <code>${escapeHtml(oauth.metadata.authorization_endpoint)}</code> with PKCE (${oauth.metadata.code_challenge_methods_supported.map(code).join(', ')} only). ${escapeHtml(oauth.sign_in)} Then the reader approves the ${oauth.metadata.scopes_supported.map(code).join(', ')} scope, and the redirect carries the RFC 9207 <code>iss</code> parameter.</li>
      <li>The client trades the code at <code>${escapeHtml(oauth.metadata.token_endpoint)}</code> (grants ${oauth.metadata.grant_types_supported.map(code).join(', ')}) and sends the access token as <code>Authorization: Bearer</code> on every <code>/mcp</code> request.</li>
    </ol>
    <div class="table-scroll"><table>
      <thead><tr><th>Credential</th><th>Lifetime</th></tr></thead>
      <tbody>
        <tr><td>Access token</td><td>${duration(life.access_token)}</td></tr>
        <tr><td>Refresh token</td><td>${duration(life.refresh_token)}, rotated on every use</td></tr>
        <tr><td>Refresh token family</td><td>${duration(life.refresh_family_max)} from first consent, then sign in again</td></tr>
        <tr><td>Authorization code</td><td>${duration(life.authorization_code)}</td></tr>
        <tr><td>Sign-in in progress</td><td>${duration(life.pending_authorization)}</td></tr>
        <tr><td>Registered client</td><td>${duration(life.registered_client)}</td></tr>
      </tbody>
    </table></div>
    <p>${escapeHtml(oauth.refresh_rotation.replace('refresh_family_max', duration(life.refresh_family_max)))} Tokens are stored only as hashes.</p>
    <h3 id="connections">Connections and the request log</h3>
    <p>Each approved client is one <em>connection</em>: one refresh token family, named by the client's registered name. Signed in to Thingy, <b>Profile &gt; MCP connections</b> lists them with when each was connected and last used. <b>Disconnect</b> revokes the family, and the access token stops working on its next request rather than when it expires. Every tool call through <code>/mcp</code> or the WebMCP page tools is recorded against the reader with the connection that made it, its arguments, status, duration and result size; <b>View MCP request log</b> shows the reader's own calls for as long as they are kept.</p>
    <h3 id="quotas">Budgets and rate limits</h3>
    <p>Each reader has a daily budget per door, and an hourly rate limit that smooths bursts. ${escapeHtml(rules.pools)} ${escapeHtml(rules.reset)} Supporting Members get ${rules.supporting_member_multiplier}&times; the daily budget.</p>
    <div class="table-scroll"><table>
      <thead><tr><th>Door</th><th>Daily budget</th><th>Per hour</th></tr></thead>
      <tbody>
        <tr><td>MCP (tool calls and resource reads)</td><td>${quotaText(doors.mcp)}</td><td>${number(doors.mcp.hourly_rate_limit)}</td></tr>
        <tr><td>WebMCP (tool calls)</td><td>${quotaText(doors.webmcp)}</td><td>${number(doors.webmcp.hourly_rate_limit)}</td></tr>
        <tr><td>Thingy chat (turns)</td><td>${quotaText(doors.chat)}</td><td>${number(doors.chat.hourly_rate_limit)}</td></tr>
        <tr><td>OAuth registration</td><td>${number(oauth.rate_limits.register_per_day_global)} new clients a day, all clients</td><td>${number(oauth.rate_limits.register_per_hour_per_client_ip)} per address</td></tr>
        <tr><td>OAuth token requests</td><td>&nbsp;</td><td>${number(oauth.rate_limits.token_per_hour_per_client_ip)} per address</td></tr>
      </tbody>
    </table></div>
    <p>Arguments are checked before any budget is spent, so a malformed call costs nothing. A spent budget is the JSON-RPC error <code>${quotaError?.code ?? ''}</code>: <q>${escapeHtml(quotaError?.message ?? '')}</q> An exceeded hourly limit is HTTP <code>429</code>.</p>
  </section>`;
}

function conventions(surface: McpSurface, names: string[]) {
  const voiceTools = surface.tools.filter((tool) => tool.inputSchema.properties?.voice).map((tool) => tool.name);
  const yearTools = surface.tools.filter((tool) => tool.inputSchema.properties?.year_range).map((tool) => tool.name);
  const openWorld = surface.tools.filter((tool) => tool.annotations.openWorldHint).map((tool) => tool.name);
  const link = (name: string) => `<a href="#tool-${name}"><code>${name}</code></a>`;
  const paged = Object.entries(surface.limits.paged_lists)
    .map(([tool, list]) => `<tr><td>${link(tool)}</td><td>${code(list)}</td></tr>`)
    .join('');
  const codes = surface.errors.tool_error_codes
    .map((entry) => `<tr><td>${code(entry.code)}</td><td>${linkTools(entry.next, names)}</td></tr>`)
    .join('');
  const rpc = surface.errors.json_rpc
    .map(
      (entry) =>
        `<tr><td>${code(entry.code)}</td><td>${entry.http_status}</td><td>${escapeHtml(entry.when)}</td><td>${escapeHtml(entry.message)}</td></tr>`
    )
    .join('');
  const retired = surface.retired_tools
    .map((entry) => `<tr><td>${code(entry.name)}</td><td>${linkTools(entry.replacement, names)}</td></tr>`)
    .join('');
  const protocol = surface.server.protocol_versions;
  return `<section id="conventions">
    <h2>Protocol conventions</h2>
    <h3 id="versioning">Versions and capabilities</h3>
    <p><code>initialize</code> answers protocol ${code(protocol.default)} and also accepts ${protocol.supported
      .filter((version) => version !== protocol.default)
      .map(code)
      .join(', ')}; any other requested version gets the default. The server declares:</p>
    <pre>${escapeHtml(JSON.stringify(surface.server.capabilities, null, 2))}</pre>
    <p>The server is stateless, so it can never deliver a <code>list_changed</code> notification. Instead <code>serverInfo.version</code> is <code>${escapeHtml(surface.server.version_format)}</code>, and every tool result repeats it as <code>server_version</code>. When it differs from the version a client cached, re-fetch <code>tools/list</code> before trusting cached parameter schemas. This page documents server ${code(surface.server.version)}.</p>
    <p>The server&rsquo;s <code>instructions</code>, sent with <code>initialize</code>:</p>
    <blockquote>${linkTools(surface.server.instructions, names)}</blockquote>

    <h3 id="ids">One id everywhere</h3>
    <p>Every source has one id, the same in every tool: ${code('wt-351')} for a Weekly Thing issue, ${code('blog-<microblog id>')} for a blog post, ${code('ep-<n>')} for a podcast episode. Whatever a tool returns, ${link('get_source')} and ${link('source_neighborhood')} accept. Every <code>url</code> in a result is absolute, so a client can cite with a markdown link: <code>[WT351](url)</code> for an issue, the title for a post or episode.</p>

    <h3 id="applied">The applied echo</h3>
    <p>Every result starts with <code>applied</code>: the arguments the server actually used after defaults and normalisation (the window, the limit, the voice, the offset). An agent can check it rather than assume its arguments landed as meant.</p>

    <h3 id="truncation">Paging and truncation</h3>
    <p>A tool that lists takes <code>limit</code> (each has its own range and default, below) and <code>offset</code>, returns one fixed order named in its description, and reports <code>total_count</code> for the whole list. Anything left out is described in one <code>truncated</code> block, never in inline markers. For example:</p>
    <pre>"truncated": {
  "omitted": { "results": 12 },
  "clipped": ["results[].passages[].text"],
  "max_chars": ${surface.limits.result_max_chars},
  "next_offset": 20,
  "hint": "Cut to fit ${surface.limits.result_max_chars} characters at 20 results; call again with offset 20 for the rest."
}</pre>
    <p>The outside doors cap a result at ${number(surface.limits.result_max_chars)} characters. The cut is structural, so the JSON always parses: whole items come off the end of the largest list first (results are ranked, so the weakest go), then the longest text is clipped. When the paged list is the one cut, <code>next_offset</code> moves back to the first item cut, so paging stays exact. A result that cannot fit even then is a <code>too_large</code> error naming the arguments to narrow.</p>
    <div class="table-scroll"><table><thead><tr><th>Tool</th><th>Paged list</th></tr></thead><tbody>${paged}</tbody></table></div>

    <h3 id="structured">Typed results</h3>
    <p>Every tool declares an <code>outputSchema</code>, and a successful call carries the result twice: as <code>structuredContent</code> for clients that read it, and as compact JSON text in <code>content</code> for those that do not. Every tool is annotated <code>readOnlyHint: true</code>; <code>openWorldHint</code> is true only for ${openWorld.map(link).join(' and ')}, the tools that reach the live web.</p>

    <h3 id="errors">Errors</h3>
    <p>A tool that cannot answer returns a normal result with <code>isError: true</code>, one <code>code</code> from a closed set, and one <code>next</code> step the agent can act on. Error results carry no <code>structuredContent</code>.</p>
    <div class="table-scroll"><table><thead><tr><th>code</th><th>next</th></tr></thead><tbody>${codes}</tbody></table></div>
    <p id="validation">Arguments are validated against the declared schema before any budget is spent. Every schema says <code>additionalProperties: false</code>, and the validator means it: an undeclared argument, a value outside its enum or range, text past its length, an inverted <code>year_range</code>, or <code>year</code> and <code>year_range</code> together is a <code>bad_request</code> that names every problem and lists the accepted arguments. Scalars are accepted in either spelling a client might send (<code>"12"</code> for <code>12</code>).</p>
    <pre>${escapeHtml(JSON.stringify(surface.errors.invalid_arguments_example, null, 2))}</pre>
    <p>Protocol-level failures are JSON-RPC errors:</p>
    <div class="table-scroll"><table><thead><tr><th>code</th><th>HTTP</th><th>When</th><th>Message</th></tr></thead><tbody>${rpc}</tbody></table></div>

    <h3 id="voice">Voice</h3>
    <p>A Weekly Thing passage mixes Jamie&rsquo;s commentary with quotations from the linked author and link titles. Every passage is tagged by voice, and ${voiceTools.map(link).join(', ')} take <code>voice</code>: ${code('jamie')} keeps only Jamie&rsquo;s own words, ${code('quoted')} the passages Jamie quoted, ${code('link')} the headline link titles. Passages are cut to that voice before ranking. Thingy&rsquo;s own bylined blocks in recent issues never enter the archive at all.</p>

    <h3 id="years">Years</h3>
    <p>Windows are <code>year_range: [start, end]</code> everywhere; <code>year</code> is shorthand for <code>[year, year]</code>. Pass one or the other. Tools that take a window: ${yearTools.map(link).join(', ')}.</p>

    <h3 id="retired">Retired tools</h3>
    <p>A client holding an old <code>tools/list</code> may still call a tool that was folded into another. It gets an error result that names the replacement, not <code>Unknown tool</code>:</p>
    <div class="table-scroll"><table><thead><tr><th>Retired</th><th>Answer</th></tr></thead><tbody>${retired}</tbody></table></div>
  </section>`;
}

function toolsSection(surface: McpSurface, names: string[]) {
  const groups = groupedTools(surface);
  return `<section id="tools">
    <h2>Tools</h2>
    <p>${surface.tools.length} tools, as <code>tools/list</code> declares them. Every one reads; none writes.</p>
    ${groups
      .map(
        (group) => `<div class="tool-group" id="group-${group.id}">
        <h2 class="group-title">${escapeHtml(group.title)}</h2>
        <p class="muted">${escapeHtml(group.blurb)}</p>
        ${group.tools.map((tool) => toolSection(tool, names)).join('\n')}
      </div>`
      )
      .join('\n')}
  </section>`;
}

function resourcesSection(surface: McpSurface, names: string[]) {
  const rows = surface.resources.templates
    .map(
      (template) =>
        `<tr><td>${code(template.uriTemplate)}</td><td>${escapeHtml(template.title)}</td><td>${code(template.mimeType)}</td><td>${linkTools(template.description, names)}</td></tr>`
    )
    .join('');
  const list = surface.resources.list;
  return `<section id="resources">
    <h2>Resources</h2>
    <p>Clients that support resources can attach a source as context without a tool round trip. Every read goes through the same tools (so a resource and a tool call never disagree) and costs ${escapeHtml(surface.resources.quota)}. A resource is one fixed page; for more, its result names the tool call to make.</p>
    <div class="table-scroll"><table><thead><tr><th>URI template</th><th>Title</th><th>Type</th><th>Description</th></tr></thead><tbody>${rows}</tbody></table></div>
    ${
      list
        ? `<p><code>resources/list</code> offers the newest Weekly Thing issues, read through ${linkTools(list.tool, names)} with <code>${escapeHtml(JSON.stringify(list.arguments))}</code>. The catalogue changes weekly, and a stateless server cannot notify, so clients re-list on connect.</p>`
        : ''
    }
  </section>`;
}

function promptsSection(surface: McpSurface, names: string[]) {
  const prompts = surface.prompts
    .map((prompt) => {
      const args = prompt.arguments
        .map(
          (argument) =>
            `<li>${code(argument.name)}${argument.required ? ' <span class="req">required</span>' : ''}: ${escapeHtml(argument.description)}</li>`
        )
        .join('');
      return `<section class="tool" id="prompt-${escapeHtml(prompt.name)}">
        <h3><a class="anchor" href="#prompt-${escapeHtml(prompt.name)}">${escapeHtml(prompt.title)}</a> <code class="tool-name">${escapeHtml(prompt.name)}</code></h3>
        <p>${escapeHtml(prompt.description)}</p>
        <ul class="fields">${args}</ul>
        <details><summary>The call sequence it expands to</summary><pre>${linkTools(prompt.call_sequence, names)}</pre></details>
      </section>`;
    })
    .join('\n');
  return `<section id="prompts">
    <h2>Prompts</h2>
    <p>Prompts publish the good call sequences. The routing knowledge Thingy&rsquo;s own agent carries in its system prompt reaches MCP clients here: a client that offers prompts shows them as ready-made asks, and each expands into the tool sequence that answers it well. They instruct the calling model, and never speak as Jamie.</p>
    ${prompts}
  </section>`;
}

function lessons(surface: McpSurface) {
  return `<section id="what-it-shows">
    <h2>What this shows</h2>
    <p>Thingy is Jamie&rsquo;s librarian and also a working example of how an agent and an MCP server can share one surface. A few things that hold up:</p>
    <ul>
      <li><b>Build the tools once.</b> The in-house agent and every outside agent call the same ${surface.tools.length} handlers. A fix for one is a fix for all, and an outside agent is never a second-class user of the archive.</li>
      <li><b>Write for the reader of the schema.</b> The same tool carries one description for Thingy&rsquo;s app and another for an agent with no app around it. Schemas declare every limit, enum and length the server enforces.</li>
      <li><b>Make errors teach.</b> Every refusal names what was wrong and the one next step. A retired tool names its replacement.</li>
      <li><b>Say what was left out.</b> Results that are cut stay valid JSON and say exactly what went and how to get it.</li>
      <li><b>Stateless is enough.</b> A plain JSON-RPC request and reply on Lambda serves Claude, ChatGPT and Claude Code; versioning carries the change signal that notifications cannot.</li>
      <li><b>Generate the documentation.</b> This page is rendered at build time from the surface the server exports, and both repositories check it in CI, so it cannot describe a tool that does not exist.</li>
    </ul>
  </section>`;
}

function contents(surface: McpSurface) {
  const groups = groupedTools(surface);
  const toolLinks = groups
    .map(
      (group) =>
        `<li><a href="#group-${group.id}">${escapeHtml(group.title)}</a><ul>${group.tools
          .map((tool) => `<li><a href="#tool-${escapeHtml(tool.name)}"><code>${escapeHtml(tool.name)}</code></a></li>`)
          .join('')}</ul></li>`
    )
    .join('');
  return `<nav class="ref-toc" aria-label="Contents">
    <h2>Contents</h2>
    <ol>
      <li><a href="#how-it-works">How it works</a></li>
      <li><a href="#connecting">Connecting</a>: <a href="#oauth">OAuth 2.1</a>, <a href="#connections">connections</a>, <a href="#quotas">budgets</a></li>
      <li><a href="#conventions">Protocol conventions</a>: <a href="#versioning">versions</a>, <a href="#ids">ids</a>, <a href="#applied">applied</a>, <a href="#truncation">paging</a>, <a href="#errors">errors</a>, <a href="#voice">voice</a>, <a href="#retired">retired tools</a></li>
      <li><a href="#tools">Tools</a><ul class="toc-groups">${toolLinks}</ul></li>
      <li><a href="#resources">Resources</a></li>
      <li><a href="#prompts">Prompts</a></li>
      <li><a href="#what-it-shows">What this shows</a></li>
    </ol>
  </nav>`;
}

export function renderMcpReference(surface: McpSurface): string {
  const names = surface.tools.map((tool) => tool.name).sort((a, b) => b.length - a.length);
  const protocol = surface.server.protocol_versions;
  const conditionalCount = surface.tools.filter((tool) => tool.conditional).length;
  const summary = `<p class="ref-meta">Server ${code(surface.server.name)} ${escapeHtml(surface.server.version)} &middot; MCP ${escapeHtml(protocol.default)} &middot; ${surface.tools.length} tools${conditionalCount ? ` (${conditionalCount} conditional)` : ''} &middot; ${surface.resources.templates.length} resource templates &middot; ${surface.prompts.length} prompts</p>`;
  return [
    summary,
    contents(surface),
    howItWorks(surface),
    connecting(surface),
    conventions(surface, names),
    toolsSection(surface, names),
    resourcesSection(surface, names),
    promptsSection(surface, names),
    lessons(surface)
  ].join('\n');
}

// Reads the vendored artifact and refuses one that does not match its
// checksum, so a hand edit cannot ship.
export function loadMcpSurface(root: string): McpSurface {
  const text = readFileSync(resolve(root, 'contracts/mcp-surface.json'), 'utf8');
  const expected = readFileSync(resolve(root, 'contracts/mcp-surface.sha256'), 'utf8').trim().split(/\s+/)[0];
  if (createHash('sha256').update(text).digest('hex') !== expected) {
    throw new Error('contracts/mcp-surface.json does not match its checksum. Run npm run mcp-surface:sync.');
  }
  return JSON.parse(text) as McpSurface;
}

export const MCP_REFERENCE_MARKER = '<!--mcp-reference-->';

export function mcpReferencePlugin(root: string): Plugin {
  return {
    name: 'thingy-mcp-reference',
    transformIndexHtml(html: string) {
      if (!html.includes(MCP_REFERENCE_MARKER)) return html;
      const surface = loadMcpSurface(root);
      return html
        .replace(MCP_REFERENCE_MARKER, renderMcpReference(surface))
        .replaceAll('__MCP_SERVER_VERSION__', escapeHtml(surface.server.version));
    }
  };
}
