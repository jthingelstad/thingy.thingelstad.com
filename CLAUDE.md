# CLAUDE.md — thingy.thingelstad.com

Orientation for Claude Code working in this repo. Human overview lives in
`README.md` (when present); general agent instructions live in `AGENTS.md`;
the strategic roadmap is in `ROADMAP.md`.

## What this repo is

The **query surface** for Thingy — Jamie's agent over his published content.
Two apps share the repo, but they're independent processes with separate
concerns:

- **`web/`** — the standalone Thingy app at `thingy.thingelstad.com`. A
  Vite-built static app served by GitHub Pages. Thin client: handles auth UI,
  streams `/chat` SSE from the Librarian Lambda, shapes Dispatch drafts,
  renders citations, and collects feedback. No server beyond GitHub Pages.
- **`apps/thingy_bridge/`** — the Discord side of Thingy. A standalone Python
  process running one discord.py client + APScheduler support: answers
  questions in the configured member channel and provides member session/source commands.
  Conversation eval cards are posted by the API-side webhook, not by polling
  in the bridge. See `apps/thingy_bridge/CLAUDE.md`.

Both apps are **live clients of the Librarian API in `studio-thing`**. The
intelligence (corpus retrieval, Bedrock embeddings, the Claude tool-use loop)
lives in the Lambda, not here.

## Architecture context

This repo is one of four that work together (see `studio-thing/ALIGNMENT.md`
for the full map). The short version:

- **Studio (`studio-thing`)** is the brain: authoring agents (Eddy/Linky/
  Marky/Patty), production pipeline, editorial source of truth, the Librarian
  Lambda, the corpus.
- **Weekly (`weekly.thingelstad.com`)** renders the newsletter site from
  inputs Studio commits in.
- **Another (`another.thingelstad.com`)** publishes the podcast; Studio
  imports its episode transcripts for the podcast corpus.
- **Thingy (this repo)** is the query surface — web + Discord — that talks to
  Studio's Librarian Lambda at runtime.

The repo boundary matters: because Thingy is a live client across a repo
boundary, the Librarian API `/chat`, `/retrieve`, and `/feedback` are a
**versioned contract**, not internal functions. Casual changes to the API
schema break this repo. Version before changing.

## Hard constraints

- **`web/` is a static site.** No server-side runtime, no secrets in the
  client. Anything that needs a secret goes through the Lambda, not the page.
- **CORS is configured in Studio**, not here. The
  `apps/librarian/infra/cloudformation.yaml` `AllowedOrigin` parameter must
  include `https://thingy.thingelstad.com` (it does, today).
- **Don't grow a second backend here.** If a feature needs server logic, add
  it to the Librarian Lambda in Studio. This repo stays "front-ends only."

## Planning context — both apps are evolving

- **`web/`** shipped as the standalone Thingy surface (the as-built brief is
  preserved in `docs/history/STANDALONE_BUILD.md`). Magic-link auth, server-side
  conversations, conversation modes, curiosity maps, source controls, audio
  input/playback, and richer chat UX have since shipped.
- **`apps/thingy_bridge/`** is no longer the primary user surface. Discord is
  useful for member presence, lightweight chat, and API-posted notices, while
  nuanced multi-conversation UX belongs in the authenticated web app.

Conversation modes are backend-enforced and conversation-scoped. Current modes
are default Thingy, Research Guide, Thought Partner, and Trusted Circle. Start
with the published archive only; do not introduce a hidden private corpus unless
Jamie explicitly makes that a separate product decision.

## When in doubt

Start at `ROADMAP.md` for direction and `studio-thing/ALIGNMENT.md`
for the cross-repo map. If a task would alter the Librarian API contract,
add a new conversation mode, or change entitlement behavior, make sure the
backend remains authoritative and the API-side reports can see what happened.
