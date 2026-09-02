# Thingy Roadmap

Thingy is evolving from an archive search surface into an authenticated archive agent: a conversational
interface to Jamie's published work that can remember context and reason across corpora.

This document is the living roadmap for the public Thingy web surface and its relationship to the
Librarian API (`librarian-thing`). Historical build briefs belong under `docs/history/`; this file should reflect the current
product direction.

## Product Principles

- **Published archive first.** Thingy represents Jamie's published work and should not require a
  hidden private corpus.
- **Identity unlocks capability.** Magic-link authentication lets Thingy know who it is talking to,
  attach conversations to users, and grant capabilities by entitlement.
- **The web app is the experience.** Thingy is a focused, authenticated web client for nuanced,
  multi-conversation archive work.
- **The backend stays authoritative.** Auth, entitlements, conversation history, evaluation, tools, and
  corpus intelligence live in Librarian. This repo is the thin web surface.
- **Durable source metadata over prompt cleverness.** Retrieval quality comes from the corpus and its
  link graph, not from ever-longer prompts.
- **Server-side conversations are the canonical record.** The client never owns history.
- **Operator review is asynchronous.** Reports and logs stay outside the user request path.

## Shipped

### Standalone Thingy Web

- Moved Thingy to `thingy.thingelstad.com`.
- Reworked the UX from a publication-style page into a chat-client experience.
- Added responsive mobile navigation, conversation rail, conversation actions, cache-busted assets, and a
  dedicated sign-in page.
- Added richer message actions: copy, share, feedback, and prompt audio input.
  (The response audio playback button was removed in 2026-08; do not reintroduce browser TTS.
  Email-me-this-answer was retired in 2026-09 when share links shipped.)

### Real Authentication

- Replaced the old "does this email belong to a subscriber?" gate with magic-link authentication.
- Magic links are short-lived, single-use, and sent to the claimed email address.
- Auth email is sent through Fastmail JMAP as `thingy@thingelstad.com`.
- Sessions last 9 days and slide: any visit re-confirms the HttpOnly session cookie server-side
  and re-verifies entitlements, so an active reader rarely signs in again. Lapsed subscriptions
  are caught at refresh. (Cookie sessions since 2026-09-01; the page holds no credential.)
- Sign-in uses an emailed six-digit code (with OS autofill) alongside the magic link.
- The sign-in page makes clear that Weekly Thing readers can sign in, and new addresses can start the
  subscriber path directly.

### Server-Side Conversations

- Conversations are persisted in the Librarian API instead of local storage.
- The client no longer has to send the whole chat history on every turn.
- Conversations have metadata, generated titles, deletion, rename, feedback, and operator visibility.
- Prompt parameters can seed a new conversation directly.

### Corpus Richness

- Thingy now works across The Weekly Thing, thingelstad.com, and Another Thing.
- Corpus metadata is richer and more even across sources: dates, domains, source identity, internal links,
  external links, and podcast metadata.
- The API includes tools for archive search, corpus summaries, linked domains, source exploration,
  and timeline-like summaries.
- Markdown rendering supports richer answers, including tables and horizontal rules.

### Operator Loop

- Conversation activity and evaluator results are visible outside the user flow.
- A local operator report provides a more grounded view of recent conversations, evaluations, feedback,
  and system behavior.

### Delight Features

- Agentic welcome behavior uses local time, conversation history, and membership context. A deterministic
  greeting renders immediately, so personalization never blocks the composer or delays the first question.
- Thingy can remember the user's name. The earlier AI-synthesized reader memory was deliberately
  removed: server-side conversations cover continuity, and the profile is now basic account metadata
  (name and activity counts).
- Curiosity map created visual trails through the archive and could seed new conversations
  (removed 2026-08 in the chat streamline, along with Archive Sparks).
- Archive work/tool activity is visible in the chat, then collapses after completion.

### Runtime Contract

- Librarian (`librarian-thing`) owns one generated, versioned contract for successful Librarian JSON responses and SSE events.
- Thingy validates live payloads against that artifact and negotiates the supported major contract version
  on every request. Additive changes remain compatible within a major; breaking changes require a new
  major. The contract is currently 4.0.0.

### Public MCP + Archive Intelligence (2026-08)

- The Librarian tool registry is published as an MCP server at
  `librarian.thingelstad.com/mcp` with OAuth 2.1 sign-in - Claude, ChatGPT
  (Developer mode), Claude Code, and any MCP client get the same tools Thingy
  uses. `/connect/` documents setup; `/about/` tells the product story.
- Per-user daily budgets: separate chat and MCP pools, doubled for supporting
  members, visible in the account panel.
- Media answers: a photo index (~14,000 images) renders inline clickable
  thumbnails in chat; Currently entries and reference aggregation became
  first-class tools.
- Live-web reach: `fetch_page` (any public page) and `web_search` (Brave,
  key-gated) close the freshness gap.
- Matching semantics live in one canonical matcher with a written spec
  (`librarian-thing/apps/librarian/MATCHER.md`), hardened through eight
  adversarial MCP review rounds; a three-layer eval (fixtures, response
  invariants, known answers) runs on every deploy and blocks it on failure.
- Ongoing upkeep is owned by the AGENT-TEAM objective owners in
  `librarian-thing/AGENT-TEAM/` (run/archive/improve cadences).

### AWS Hosting, Same-Origin API, Cookie Sessions, and WebMCP (2026-09)

- The site moved off GitHub Pages to a private S3 bucket behind CloudFront
  (the `thingy-web` CloudFormation stack in `infra/`), deployed by CI through
  a least-privilege OIDC role.
- The Librarian became same-origin: the distribution routes `/api/*` to the
  Librarian's API Gateway and streaming Lambda, stripping the prefix at the
  edge. Production CSP `connect-src` tightened to `'self'`.
- The session moved from a localStorage token to the `__Host-thingy_session`
  HttpOnly cookie: the page holds no credential, sliding happens server-side,
  and CSRF is covered by SameSite=Lax plus the contract header plus the
  distribution's origin marker. Bearer remains the non-browser path.
- WebMCP (beta): while signed in, the chat page registers the 16 archive-read
  tools with the browser's model context (native `document.modelContext` or
  the bundled polyfill), proxying calls to the Librarian's `/tools` door with
  its own quota pool. Kill switch: `window.ThingyConfig.webmcp='off'`.
  The chat shell carries the Chrome WebMCP origin-trial token (registered
  for `https://thingy.thingelstad.com`, expires 2026-11-17), so Chrome
  serves the native `document.modelContext` under the trial; the polyfill
  remains the fallback elsewhere.

### Shareable Conversation Permalinks (2026-09)

- A signed-in reader can share a conversation from the conversation menu:
  the Librarian mints a revocable `shr_` token and the public page at
  `/c/<token>` renders the read-only snapshot - markdown, citations, photo
  thumbnails - with a sign-in CTA for new readers.
- Shares snapshot by cutoff: turns added after sharing stay private until
  the reader re-shares (same URL, cutoff advances). Stop sharing kills the
  link immediately (`cache-control: no-store` end to end).
- Sharing pins the conversation for a year (`ttl_floor`), so links outlive
  the 45-day conversation retention cadence.
- The email-me-this-answer feature was retired in the same change; share
  links replaced it. Contract 4.0.0 carries both halves.

### Guest Preview (2026-09)

- Anyone can ask a few questions without signing in: the chat page runs a
  guest lane when no session exists. Three questions per visitor per day, a
  100-answer global daily circuit breaker that fails closed, archive-read
  tools only, and no server-side persistence - history stays in the tab.
- This is what makes the ~350 "Tell me about issue #N" archive links and
  every shared conversation an actual demo instead of a sign-in wall.
- Sign-in stays the path to saved conversations, sharing, and full quotas.

### The assistant-ui Chat (2026-09-02)

- The chat surface moved to React + assistant-ui 0.15: a custom
  ThingyRuntime adapter speaks the existing Librarian contract (no Vercel
  AI SDK, no Next.js, no new infrastructure - still a static build on the
  same S3/CloudFront). Thingy's own markdown/citation renderer stays.
- New interaction mechanics readers never had: message editing, regenerate,
  and branch navigation, plus assistant-ui's scroll/keyboard/lifecycle
  handling. In-app dialogs, guest lane, seeded prompts, share, WebMCP all
  carried over.
- Known v1 notes: branches are client-side (server history stays linear);
  voice dictation and the agentic welcome are not yet ported to the React
  surface (classic still has them); the account panel modal is reachable
  from /chat-classic/ until ported.

## Conversation Modes (retired 2026-09)

The mode system - Research Guide, Thought Partner, Trusted Circle alongside
default Thingy - was designed, partially built, and then retired as a
user-facing feature: the mode picker went in the 2026-08 chat streamline and
Jamie confirmed the retirement on 2026-09-01. Every conversation is default
Thingy.

What remains, deliberately:

- Conversations store a `mode` and the backend still entitlement-checks it,
  so reopening an old non-thingy conversation keeps its stored mode.
- The earlier decision stands that Thingy never gets a hidden private
  corpus as an implementation detail. If private material is ever
  introduced, it is a separate product decision with explicit visibility
  guarantees, tests, and operator reporting.

Do not build new modes or mode UI without an explicit product decision.

## Near-Term Direction

- **Better operator dashboard**: keep review in a local/web operator interface grounded in server-side
  conversations.
- **Corpus freshness observability**: make it obvious when the API corpus was last built from each
  source and whether new blog/podcast content has landed.
- **Citation discipline**: keep improving evaluator checks for citation-footer mismatches,
  retrospective evidence mislabeled as contemporaneous, and title-only recommendations.
- **Runtime resilience**: continue improving timeout handling, partial-answer handling, and evaluator
  interpretation of runtime exhaustion.
- **Browser QA discipline**: keep mobile/tablet/desktop interaction tests for rail, conversations,
  and input controls.
- **Corpus coverage dashboard** (idea): show source counts, freshness, link graph health, missing
  transcript/post metadata, and source-specific search quality checks.
- **Deeper feedback loop** (idea): let downvote comments and eval notes become a structured
  improvement queue, not just passive metadata.

Backend/API follow-ups implementing these live in the Librarian repo's (`librarian-thing`) `docs/librarian-tasks.md`.

## Intelligence Roadmap

### Temporal Layer

The temporal layer is still one of the highest-leverage ideas. It should know not only when something was
published, but what season of life, work, travel, family, and world context surrounded it.

Recommended shape:

- Publishable blog pages, not posts, owned and edited by Jamie on thingelstad.com.
- The first version should read like something Jamie is comfortable putting on the public site, not like a
  private structured database.
- Thingy should ingest those pages as part of the published blog corpus and use them as context for
  answers and richer temporal reasoning.
- Keep the shape loose at first: prose, headings, dates, and links are enough. Avoid schema until the
  product need is obvious.

This does not need to become a private corpus. The timeline can be context metadata. Some entries may be
personal, but the safer initial version should only include pages Jamie is comfortable letting Thingy
reference directly.

### Cross-Corpus Thematic Threading

Thingy should continue improving its ability to connect without flattening:

- Blog posts as exploratory thinking.
- Weekly Thing as curated public framing.
- Another Thing as spoken reflection.

The goal is to answer questions such as "how did this idea move from a blog observation into a newsletter
theme and then into podcast discussion?"

### Durable Theme Clusters

The retired curiosity map was a user-facing expression of this; the backend should eventually maintain
durable clusters for recurring themes.

Potential clusters:

- IndieWeb and ownership.
- Privacy and surveillance.
- Leadership and management.
- Automation and agentic systems.
- Community, family, and rituals.
- Reading, media, and culture.

Durable clusters would help with conversation titles, related questions, operator reporting, and
temporal reasoning.

### Source Selection

The corpus selector UI was removed in the 2026-08 chat streamline; every request now searches the
whole archive. The long-term behavior should be:

- Thingy chooses the right sources by default.
- Explicit user constraints are honored: "only the blog", "in the newsletter", "on the podcast".
- Source distinction remains in the index and citations.
- Advanced users can still inspect or influence source scope when useful.

## Open Decisions

1. Should the temporal layer include personal entries that Thingy may use but not quote?
2. Should corpus/source selectors eventually disappear entirely, or remain as an advanced control?

## Suggested Next Build Sequence

1. Use real conversations and evaluator notes to keep tuning answer quality.
2. Prototype one publishable timeline page and verify that Thingy can use it without over-structuring it.
