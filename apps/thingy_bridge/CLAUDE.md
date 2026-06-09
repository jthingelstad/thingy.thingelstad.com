# thingy_bridge — project memory

> Discord ↔ Librarian Lambda bridge. Reader-facing answering bot in
> `#ask-thingy` plus member commands for session reset and source scope.
> The Librarian eval and Dispatch Lambdas post cards directly to Discord
> via webhook. Standalone Python process, single Discord client, scheduler
> support but no registered Thingy poller.
> See [`README.md`](README.md) for the user-facing overview.

## Architecture: one process, two surfaces

The bridge runs **one** discord.py Client (the Thingy bot) on its own
asyncio loop. Unlike `workshop_bot`, it
has no agent_tools registry, no in-memory corpus, no per-persona team
— Thingy is the only persona and the Q&A intelligence lives in the
Lambda.

**Sibling Lambda endpoint, not used here:** the Lambda also exposes `POST /retrieve` (semantic archive retrieval, bridge-secret auth, no chat framing). That's called by Studio's `workshop_bot` for its `archive__retrieve` tool and various pre-injection helpers — see `studio-thing/apps/workshop_bot/tools/thingy_retrieve.py`. The bridge process doesn't need it; reader-facing answering goes through `/chat` directly.

The bridge's two surfaces:

- **Live answering** (`personas/thingy.py`) — on every message in
  `#ask-thingy`, forwards to the Lambda's `/chat` SSE stream and posts
  the answer with rewritten citations. Adds 👍/👎 reactions for
  per-answer feedback that POSTs to the Lambda's `/feedback` endpoint.
  No agent loop in this process — the Lambda owns retrieval +
  reasoning.
- **Member commands** (`commands.py`) — lets a Discord member start a fresh
  Thingy session with `/thingy new` or set their preferred source scope with
  `/thingy scope`. It does not expose other readers' conversations.

The slash surface is small and reader-facing: `/thingy new`
(clear the caller's session boundary) and `/thingy scope <weekly_thing|blog|podcast|both|all>`
(pick which corpus Thingy searches for the caller — persisted in the
`thingy_scopes` table, threaded into the `/chat` body, disclosed in a
non-default answer footer).

## Storage

`apps/thingy_bridge/data/thingy_bridge.db` (path overridable via
`THINGY_BRIDGE_DB_PATH`). Four tables, all migrated idempotently
from `db/schema.sql` on every boot:

- `thingy_tokens` — minted/refreshed Lambda auth tokens keyed by Discord
  user id; tokens refresh ~10 min before expiry.
- `thingy_requests` — one row per reader question + bot answer, with the
  Discord message ids for reaction routing and the request_id for
  feedback wiring.
- `thingy_scopes` — per-Discord-user source scope for reader-facing chat.
- `job_locks` — retained scheduler lock table for future local bridge jobs.

## Relationship to other apps

```
               studio-thing/apps/librarian/  ← serverless Q&A intelligence
                          ↑↓ HTTP/SSE
                   apps/thingy_bridge/  ← THIS APP (reader bridge + notifications)
                          ↕ Discord
                       #ask-thingy
                       #chatter (cards posted here, read by everyone)

          studio-thing/apps/workshop_bot/  ← author-facing personas (Eddy/Linky/Marky/Patty)
                                             (no Thingy code, no bridge code)
```

`workshop_bot` and `thingy_bridge` are independent processes — they
share only the Discord server and the `#chatter` channel (both can
post there; neither depends on the other being up). The split lets the
reader-facing surface stay online when workshop_bot is being restarted
for author-flow code changes.

## Conventions

- **Pure-bridge persona** — Thingy doesn't run an agent loop in this
  process. `personas/thingy.py` overrides `on_message` to skip the
  team-mention/peer-reaction shape that the workshop_bot `PersonaBot`
  base assumes, and stubs `core()` as NotImplementedError. The
  reasoning agent lives in the Lambda.
- **Operator visibility is API-owned** — the Librarian eval and Dispatch
  Lambdas read canonical records from DynamoDB, write summaries/quality flags
  back to the relevant rows, and post cards to Discord via webhook. The bridge
  never assesses conversations locally and never reads other readers' private
  transcripts.
- **Citation rewriting** — `tools/thingy_render.format_for_discord()`
  rewrites `#NNN` references in the Lambda's answer to clickable
  Discord links (`[#NNN](https://weekly.thingelstad.com/archive/NNN/)`).
- **Reader hashing** — API-posted cards identify readers as `reader·<hash6>`
  (the first 6 chars of the SHA256 hash of their email — never the email
  itself). Stable per person, not reversible.

## Known follow-ups

- A second host option: the bridge is small enough to run on a Fly.io
  micro-vm or a `t4g.nano` EC2 if reader-facing availability ever
  matters more than the Mac-and-caffeinate story.
