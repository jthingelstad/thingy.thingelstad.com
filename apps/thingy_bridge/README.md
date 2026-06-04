# thingy_bridge — Discord ↔ Librarian Lambda bridge

> The public Q&A surface for *The Weekly Thing* archive. Runs the Thingy
> Discord bot in `#ask-thingy` and mirrors reader conversations from the
> Librarian Lambda into a local SQLite so Jamie can see what's being
> asked. Reader-facing only; everything author-facing lives in the
> `studio-thing` repo.

> **Status: transitional.** The current shape (reader Q&A bot +
> operator-side conversation mirror) is **Phase 1** in
> [`../../THINGY_ROADMAP.md`](../../THINGY_ROADMAP.md). Phase A3 plans
> to **retire the request/response relay + mirror** and repurpose this
> process as a one-way members broadcast that deep-links to authenticated
> web Thingy. Read the roadmap before investing in extensions to the
> current shape.

## Quick start

```bash
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env  # then fill in the Discord token + bridge secret
python -m apps.thingy_bridge.bot
```

In normal use, run under `caffeinate` so the Mac doesn't sleep and drop
the Discord gateway:

```bash
caffeinate -is python -m apps.thingy_bridge.bot
```

## What it does

Two surfaces, one process:

1. **Reader-facing answering bot** — listens in `#ask-thingy`, forwards
   each message to the Lambda's `/chat` SSE endpoint, streams the answer
   back, rewrites `#NNN` issue citations into clickable Discord links,
   and adds 👍/👎 feedback reactions that POST to the Lambda's
   `/feedback` endpoint.
2. **Operator-side conversation mirror** — hourly `thingy-watch` job
   pulls newly-logged conversation turns from the Lambda's
   `list_conversations` auth endpoint, groups them into conversations,
   has Sonnet write a two-sided assessment of each new one, mirrors
   into the local `thingy_conversations` SQLite table (a stable local
   id that outlives the Lambda's ~60-day DynamoDB TTL), and posts a
   card to `#chatter`. Operator commands `/thingy {recent,show,sync}`
   browse the mirror; reader commands `/thingy {new,scope}` manage the
   caller's session boundary and corpus scope (Weekly Thing, blog, Another
   Thing, or all sources).

## Architecture

Why this lives in its own repo/process (separate from Studio's `workshop_bot`):

- The reader-facing answering bot has different availability needs from
  the author-facing personas. A workshop_bot restart (Marky/Patty/Eddy
  code change) should not interrupt `#ask-thingy`.
- The bridge has minimal dependencies — no BM25 corpus, no Stripe /
  Buttondown / Tinylytics clients, no S3 workspace access. Faster
  startup, smaller memory footprint.
- The bridge could move off Jamie's Mac to a small cloud host later if
  reader-facing availability matters; workshop_bot is local-by-design.

The actual Q&A intelligence (corpus retrieval, Bedrock embeddings,
Claude tool-use loop) lives in the Librarian Lambda in `studio-thing` —
this bridge is the thin connector between Discord and the Lambda's HTTP API.

## Environment

| Variable | Required | Purpose |
|---|---|---|
| `DISCORD_TOKEN_THINGY` | yes | Bot token for the Thingy Discord application |
| `DISCORD_CHANNEL_ASK_THINGY` | yes | Reader-facing channel id |
| `DISCORD_CHANNEL_CHATTER` | yes | Operator channel for `thingy-watch` cards |
| `DISCORD_OWNER_USER_ID` | yes | Discord user id authorized to use `/thingy` slash commands |
| `LIBRARIAN_API_URL` | optional | Lambda auth/list_conversations base URL (has a sane default) |
| `LIBRARIAN_STREAM_URL` | optional | Lambda /chat SSE base URL (has a sane default) |
| `LIBRARIAN_BRIDGE_SECRET` | yes | Shared secret for the `list_conversations` auth action |
| `ANTHROPIC_API_KEY` | yes | For the conversation-assessment LLM call in `thingy-watch` |
| `WEEKLY_THING_SITE_URL` | optional | For citation-link rewriting (defaults to `https://weekly.thingelstad.com`) |
| `THINGY_BRIDGE_DB_PATH` | optional | SQLite path (defaults to `apps/thingy_bridge/data/thingy_bridge.db`) |
| `THINGY_BRIDGE_LOG_FILE` | optional | Log path (defaults to `apps/thingy_bridge/logs/bridge.log`) |
| `THINGY_BRIDGE_LOG_LEVEL` | optional | Logging level (default `INFO`) |
| `THINGY_BRIDGE_SCHEDULER_ENABLED` | optional | Set to `0` to disable the hourly watch job |

See `.env.example` for the template.

## Tests

```bash
python -m unittest discover -s apps/thingy_bridge/tests -t .
```
