# thingy_bridge — project memory

> Discord ↔ Librarian Lambda bridge. Reader-facing answering bot in
> `#ask-thingy` + operator-side `thingy-watch` mirror of logged
> conversations into local SQLite. Standalone Python process,
> single Discord client, single APScheduler instance.
> See [`README.md`](README.md) for the user-facing overview.

## Architecture: one process, two surfaces

The bridge runs **one** discord.py Client (the Thingy bot) on its own
asyncio loop with an APScheduler instance. Unlike `workshop_bot`, it
has no agent_tools registry, no in-memory corpus, no per-persona team
— Thingy is the only persona and the Q&A intelligence lives in the
Lambda.

The bridge's two surfaces:

- **Live answering** (`personas/thingy.py`) — on every message in
  `#ask-thingy`, forwards to the Lambda's `/chat` SSE stream and posts
  the answer with rewritten citations. Adds 👍/👎 reactions for
  per-answer feedback that POSTs to the Lambda's `/feedback` endpoint.
  No agent loop in this process — the Lambda owns retrieval +
  reasoning.
- **Hourly conversation mirror** (`jobs/watch.py`) — pulls newly-logged
  turns from the Lambda's `list_conversations` auth endpoint, groups
  them into conversations (same `subscriber_hash`, turns within ~30
  min / a fresh browser history), runs a one-shot Sonnet assessment
  (`prompts/review-conversation.md`), mirrors into
  `thingy_conversations`, and posts a card to `#chatter`. Dedupes on
  turn `request_id`; PASSes silently when nothing new; drains a
  backlog ≤25 convos/run, ≤6 cards/run (the rest land next run).

The slash surface is small: `/thingy recent [count]` (last N mirrored
convos), `/thingy show <id>` (full assessment + transcript attachment),
`/thingy sync` (manual re-fire of the watch job).

## Storage

`apps/thingy_bridge/data/thingy_bridge.db` (path overridable via
`THINGY_BRIDGE_DB_PATH`). Three tables, all migrated idempotently
from `db/schema.sql` on every boot:

- `thingy_tokens` — minted/refreshed Lambda auth tokens keyed by Discord
  user id; tokens refresh ~10 min before expiry.
- `thingy_requests` — one row per reader question + bot answer, with the
  Discord message ids for reaction routing and the request_id for
  feedback wiring.
- `thingy_conversations` — operator-side mirror of grouped conversations
  with assessment text. Stable local id that outlives the Lambda's
  ~60-day DynamoDB TTL.

## Relationship to other apps

```
                    apps/librarian/  ← serverless Q&A intelligence
                          ↑↓ HTTP/SSE
                   apps/thingy_bridge/  ← THIS APP (reader bridge + mirror)
                          ↕ Discord
                       #ask-thingy
                       #chatter (cards posted here, read by everyone)

                   apps/workshop_bot/  ← author-facing personas (Eddy/Linky/Marky/Patty)
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
- **Assessment call is a raw Anthropic SDK call**, not an agent loop —
  `jobs/watch._sync_assess()` uses `client.messages.create()` directly.
  No tool use; the prompt asks for a fixed JSON shape.
- **Citation rewriting** — `tools/thingy_render.format_for_discord()`
  rewrites `#NNN` references in the Lambda's answer to clickable
  Discord links (`[#NNN](https://weekly.thingelstad.com/archive/NNN/)`).
- **Reader hashing** — readers are shown to the operator as
  `reader·<hash6>` (the first 6 chars of the SHA256 hash of their
  email — never the email itself). Stable per person, not reversible.

## Known follow-ups

- `agent_runs`-style logging in the local DB (today the assessment call
  is logged only to `bridge.log`); add if the analytics shape is
  useful.
- A second host option: the bridge is small enough to run on a Fly.io
  micro-vm or a `t4g.nano` EC2 if reader-facing availability ever
  matters more than the Mac-and-caffeinate story.
