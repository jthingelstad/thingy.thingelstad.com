# CLAUDE.md — thingy.thingelstad.com

Orientation for Claude Code working in this repo. Human overview lives in
`README.md` (when present); general agent instructions live in `AGENTS.md`;
the strategic roadmap is in `THINGY_ROADMAP.md`.

## What this repo is

The **query surface** for Thingy — Jamie's agent over his published content.
Two apps share the repo, but they're independent processes with separate
concerns:

- **`web/`** — the standalone Thingy chat at `thingy.thingelstad.com`. An 11ty
  static site (consistent with `weekly` and `another`). Thin client: handles
  auth UI, streams `/chat` SSE from the Librarian Lambda, renders citations,
  collects 👍/👎 feedback. No server beyond GitHub Pages.
- **`apps/thingy_bridge/`** — the Discord side of Thingy. A standalone Python
  process running one discord.py client + APScheduler instance: answers
  questions in `#ask-thingy`, mirrors logged conversations into a local
  SQLite, posts cards to `#chatter`. See `apps/thingy_bridge/CLAUDE.md`.

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

- **`web/`** shipped as Phase A1 of `THINGY_ROADMAP.md` (the as-built brief is
  preserved in `docs/history/STANDALONE_BUILD.md`). The next track is **Phase A2 — magic-
  link auth + SES + identity-aware modes**, which is backend-led (work happens
  in Studio's Lambda); this repo gets a two-step auth UI and a magic-link
  landing route.
- **`apps/thingy_bridge/`** runs the current request/response shape, but
  `THINGY_ROADMAP.md` Phase A3 plans to **retire that shape** and repurpose
  the bridge as a one-way members broadcast tied to the temporal layer.
  Treat existing bridge surfaces as transitional, not the destination — and
  read `THINGY_ROADMAP.md` before starting non-trivial bridge work.

The **private sparring mode** (the deeper, more challenging Thingy for Jamie
himself) lives in **Studio's Discord**, not here. It's owner-gated, sits next
to the staff and the drafts, and reads private corpus content via a
visibility partition in the index. This repo is the **public docent only**.

## When in doubt

Start at `THINGY_ROADMAP.md` for direction and `studio-thing/ALIGNMENT.md`
for the cross-repo map. If a task would alter the Librarian API contract,
expand the public surface beyond docent scope, or touch private/draft
visibility rules, stop and confirm with Jamie first.
