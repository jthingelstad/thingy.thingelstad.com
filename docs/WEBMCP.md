# WebMCP For Thingy

A design proposal for exposing Thingy as a set of callable tools to AI agents
running inside the reader's browser, using the W3C WebMCP API.

Status: **proposal, not built.** Phase 1 is buildable in this repo alone.
Phase 2 changes the Librarian API contract and needs Jamie's sign-off first.

## Why This Is Interesting

Thingy is already an agent with a good tool surface. What it lacks is an
*agentic interface* — a way for someone else's agent to use Jamie's archive as
a capability rather than as a website to scrape.

Three things make Thingy an unusually good fit:

**The tools already exist.** `apps/librarian/lambda/shared/archive-tools.mts`
in Studio exports eighteen archive tools, thirteen of which are already
described in MCP-shaped JSON in `lambda/prompts/tool-specs.json`: name,
description, input schema. Today only Thingy's own Bedrock agent loop can call
them. They are one transport away from being usable by any agent.

**The auth problem is already solved — and WebMCP is the reason it stays
solved.** The standard way to publish an MCP server is a remote HTTP server
with OAuth, dynamic client registration, token storage, and scopes. Thingy has
none of that, and building it would mean building a real identity provider for
a newsletter archive. WebMCP removes the requirement entirely: tools execute
*inside the page*, so they run with whatever session the reader already
established. The magic link stays exactly as it is. There is no second auth
system, no API keys, no token handed to a third party.

**Jamie already asked for this.** Weekly Thing issue 321, on Anil Dash's "MCP
is the coming of Web 2.0 2.0":

> The idea that my website could have an MCP capability was what got me there.
> I have a human interface in HTML, a feed interface with RSS and JSON Feed.
> Why not an agentic interface with MCP?

That is precisely what this is. HTML for people, RSS for feed readers, WebMCP
for agents.

The honest counterweight: WebMCP is a W3C Community Group Draft Report, not a
standard, and it is moving. It ships natively in Edge 147, is in an open origin
trial in Chrome (149–156), and Firefox and Safari have not committed. The API
moved from `navigator.modelContext` to `document.modelContext` in the July 2026
draft, with the old location deprecated but still serving in the origin trial.
So this is an early bet. The mitigating factor is that the surface is tiny — a
feature-detected registration of tool descriptors — and it degrades to nothing
on browsers without support. The interesting work (deciding *which* tools to
expose and what an outside agent should be trusted with) is durable even if the
transport shifts.

## What The API Actually Looks Like

Feature detection has to cover both locations for now:

```js
const modelContext = document.modelContext ?? navigator.modelContext;
if (!modelContext) return; // no-op on unsupported browsers
```

A tool is an MCP tool with a JavaScript implementation:

```js
await modelContext.registerTool({
  name: 'thingy_ask',
  description: 'Ask Thingy a question about Jamie Thingelstad’s published archive…',
  inputSchema: {
    type: 'object',
    properties: { question: { type: 'string' }, scope: { type: 'string' } },
    required: ['question']
  },
  execute: async ({ question, scope }) => ({
    content: [{ type: 'text', text: JSON.stringify(result) }]
  })
});
```

`provideContext({ tools: [...] })` registers a whole set at once;
`unregisterTool()` removes one. The spec also provides
`agent.requestUserInteraction()`, which lets a tool hand control back to the
human before doing something consequential — that is the hook for sign-in and
for anything with side effects.

The browser owns transport and the data layer. The page only supplies the
primitives. That is what keeps this a small amount of code.

## Design

### Principle: The Session Is The Authorization

No new auth. Every WebMCP tool call is made by page JavaScript that reads the
existing bearer token from `thingy-session.ts` and calls the same Librarian
endpoints the UI calls, with the same `authHeaders()`, the same
`ensureFreshToken()` refresh, and the same
`x-librarian-contract-version` negotiation.

Consequences that fall out for free:

- Entitlements are already enforced server-side. Research Guide, Thought
  Partner, Trusted Circle, and Dispatch gating apply unchanged.
- The existing per-identity hourly rate limit in `rate-limit.mts` applies
  unchanged, because the calls carry the same subject hash.
- Conversations still land in the canonical server-side store, so the eval
  Lambda, operator report, and Discord cards keep working.
- Signing out clears the token, and every tool immediately starts failing
  closed.

When there is no valid session, tools must not fail with a bare error. They
should return a structured, agent-legible result and use
`requestUserInteraction()` to bring the human back:

```json
{
  "status": "sign_in_required",
  "message": "Thingy needs a signed-in reader. Ask the person to sign in on this page.",
  "sign_in_url": "https://thingy.thingelstad.com/signin/?return=%2Fchat%2F"
}
```

The reader completes the magic link in the same tab. Because the token lands in
`localStorage` on the same origin, the next tool call just works. No
cross-agent token handoff ever happens.

### Principle: Read-Only By Default

An agent embedded in the reader's browser is a confused-deputy risk: it acts
with the reader's identity but not always with the reader's intent. So the
exposed surface is split hard:

- **Read tools** — no confirmation. Worst case is a wasted archive query.
- **Write / spend tools** — either not exposed at all, or gated behind
  `requestUserInteraction()`. Sending a Dispatch costs real generation money
  and sends real email; deleting a conversation is destructive. Neither should
  be silently callable.

Phase 1 exposes read tools only. Dispatch and conversation deletion stay out.

### Phase 1 — Page Tools, No Backend Change

Everything here uses endpoints that already exist. Zero Studio changes, zero
contract risk. This is the phase worth building first.

| Tool | Backing call | Notes |
|---|---|---|
| `thingy_ask` | `POST /chat` (SSE) | The headline tool. Full grounded answer with citations, in Thingy's persona, in the reader's entitled mode. Returns text plus a citation array. |
| `thingy_session_status` | local + `POST /auth` | Reports signed-in state, entitlements, available modes, active scope. Lets an agent orient before calling anything else. |
| `thingy_list_conversations` | `POST /conversations` | Recent conversation summaries: id, title, mode, updated_at. |
| `thingy_open_conversation` | `POST /conversations` | Fetch one conversation's messages, so an agent can pick up where the reader left off. |
| `thingy_set_scope` | local store | Narrow to `weekly_thing`, `blog`, `podcast`, or a combination, using `thingy-scope.ts`. Visible in the UI when it changes. |

`thingy_ask` deserves a note. It is a *slow* tool — a full Sonnet agent loop
with tool use, several seconds at minimum. That is the right trade for Phase 1:
the outside agent gets Thingy's grounding discipline, citation footer, mode
enforcement, and evaluator coverage rather than raw passages it might
misattribute. The SSE stream is consumed internally and the tool resolves once;
WebMCP tools return a single result, not a stream.

Scope handling: `thingy_ask` should accept an optional `scope` argument and
otherwise inherit the UI's current selection, so an agent asking three
questions in a row does not silently drift across corpora.

### Phase 2 — Direct Archive Tools (Needs Sign-Off)

Phase 1 alone under-uses WebMCP. If the only tool is "ask a question," an agent
could nearly as well read the page. The real unlock is letting an outside agent
do *its own* multi-step archive research at data speed, paying for retrieval
rather than for a Sonnet turn per hop.

That needs something Studio does not have today: an HTTP route that runs one
archive tool with arguments. `/retrieve` is close but wrong for this — it is
operator-only, gated on `DISCORD_BRIDGE_SECRET` rather than a reader session,
and it returns passages rather than the full tool surface.

Proposed additive route on the Stream Lambda:

```
POST /tools        → { tools: [ …MCP tool specs… ], contract_version }
POST /tools/call   → { name, arguments, scope } → { result, citations, request_id }
```

Rules:

- Session-token auth, identical to `/chat`. No new credential.
- An explicit allowlist of *public* tool names, not all of `ARCHIVE_TOOLS`.
  Start with `search_archive`, `get_source`, `list_content`, `corpus_stats`,
  `latest_content`, `quote_search`, `archive_lens`, `entity_lens`,
  `source_neighborhood`, `find_links`, `archive_gems`, `search_faq`. Explicitly
  **not** the Dispatch planner tools.
- `normalizeScope()` applied to every call, defaulting to the conversation's
  scope, so corpus boundaries hold.
- Its own rate limit, higher than the chat limit (these are cheap) but bounded.
- Additive contract change: new `$defs` and a new endpoint entry in
  `librarian-contract.mts`, regenerated into
  `contracts/librarian-api.v1.json` via `scripts/export-contract.mjs`.
  Additive keeps it inside v1; nothing existing changes shape.

Once that route exists, the WebMCP layer in this repo becomes a thin projection
of it: fetch `/tools`, register each returned spec with `registerTool()`,
implement `execute` as a `/tools/call` POST. The tool descriptions are already
written — they live in `tool-specs.json` and were authored for an agent
audience.

Also worth adding in Phase 2: an optional `client_surface` field on
conversation and eval records so the operator report can distinguish a WebMCP
turn from a web-UI turn. Without it, Jamie cannot see whether this is being
used.

### Phase 3 — Remote MCP Server (Out Of Scope, Noted)

The thing people usually mean by "an MCP server for my site" is a remote
server at, say, `mcp.thingy.thingelstad.com`, addable to Claude Desktop or
Claude Code, usable without a browser. That is a genuinely different product
with a genuinely harder auth story: magic links do not translate to a headless
client, so it means OAuth or long-lived personal access tokens, plus per-token
entitlement resolution and revocation.

Phase 2's `/tools/call` route is the correct foundation for it — the transport
would be new, the capability would not. But it should be a separate decision.
The point of doing WebMCP first is that it delivers most of the value while
deferring that entire question.

## Files This Would Touch

**Thingy (Phase 1):**

- `web/src/shared/thingy-webmcp.ts` *(new)* — feature detection, registration
  lifecycle, `requestUserInteraction` wrapper, result envelope helpers.
- `web/src/shared/thingy-webmcp-tools.ts` *(new)* — the tool definitions.
- `web/src/shared/components/ChatApp.tsx` — register on mount, unregister on
  unmount, re-register when auth state changes.
- `web/src/types/globals.d.ts` — ambient types for `document.modelContext` and
  `navigator.modelContext`.
- `web/src/shared/thingy-analytics.ts` — Tinylytics events for tool
  registration and per-tool calls, so usage is observable.
- `web/tests/webmcp.test.mjs` *(new)* — a fake `modelContext` plus a stubbed
  fetch; assert registration is skipped when unsupported, that tools fail
  closed when signed out, and that the sign-in envelope is returned rather than
  thrown.
- `README.md` and `docs/ROADMAP.md` — document the surface.
- `docs/THINGY_SURFACES.md` — WebMCP is a new surface and belongs in the map.

**Studio (Phase 2):**

- `apps/librarian/lambda/chat/runtime.mts` — the `/tools` and `/tools/call`
  routes.
- `apps/librarian/lambda/shared/archive-tools.mts` — a `PUBLIC_ARCHIVE_TOOLS`
  allowlist and argument validation at the boundary.
- `apps/librarian/lambda/shared/librarian-contract.mts` +
  `contracts/librarian-api.v1.json` — additive contract.
- `apps/librarian/lambda/tests/` — route and allowlist tests.
- `apps/librarian/README.md` endpoint table.

No CloudFormation change is needed for Phase 2; the Stream Lambda's Function
URL already fronts these paths, and CORS already allows
`https://thingy.thingelstad.com`.

## Effort

- **Phase 1:** roughly one focused session. Two new modules of a few hundred
  lines, a mount-point change, a test file, docs. Nothing deploys to AWS.
- **Phase 2:** larger. The route itself is small, but the allowlist, argument
  validation, rate-limit design, contract regeneration, tests, and a Librarian
  deploy make it a real change to a live contract.
- **Phase 3:** a project, not a task.

## Risks And Open Questions

- **Spec churn.** `navigator` → `document` already happened. Keep all spec
  contact inside `thingy-webmcp.ts` so a future move is a one-file change.
- **Browser reach.** Chrome origin trial plus Edge. Small audience today. This
  is an early-adopter bet, consistent with Thingy's posture, but it should not
  displace roadmap work that serves all readers.
- **Prompt injection.** Archive content is Jamie's own, so the corpus is
  low-risk. Still: tool results returned to a third-party agent should be
  data-shaped, never instruction-shaped. Keep the answer sanitizer in the path.
- **Cost.** `thingy_ask` costs a full agent turn. An agent in a loop can burn
  budget fast. The existing hourly rate limit is the backstop; consider a
  tighter per-surface limit if usage warrants.
- **Attribution.** If an outside agent relays Thingy's answer, the citations
  may not survive into what the reader finally sees. Worth returning citations
  as structured data with URLs so a well-behaved agent can carry them.
- **Does the origin trial need a token?** Chrome origin trials normally require
  a per-origin token in a meta tag. Confirm whether
  `thingy.thingelstad.com` needs registration, and note that origin-trial
  tokens expire.

## Questions For Jamie

1. Phase 1 only, or is the Phase 2 `/tools/call` route worth the contract
   change up front?
2. Should WebMCP tools be available to all signed-in readers, or gated to
   supporting members like Dispatch?
3. Is `thingy_ask` alone the right opening move, or is the direct-tool surface
   the actual point?
4. Does the eventual remote MCP server change the answer — i.e. is WebMCP the
   destination, or the cheap first step toward one?
