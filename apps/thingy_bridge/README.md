# thingy_bridge — Discord ↔ Thingy API bridge

> Runs the Thingy Discord bot in `#ask-thingy` and posts startup notices
> to `#chatter`. Conversations, transcripts, summaries, evals, Dispatches,
> and posting state are canonical in the Thingy/Librarian API; this bridge
> is only a Discord connector.

## Quick start

```bash
python3 -m venv venv
venv/bin/pip install -r requirements.txt
cp .env.example .env  # then fill in the Discord token + bridge secret
venv/bin/python -m apps.thingy_bridge.bot
```

In normal use, run under `caffeinate` so the Mac doesn't sleep and drop
the Discord gateway:

```bash
caffeinate -is venv/bin/python -m apps.thingy_bridge.bot
```

## What it does

Two surfaces, one process:

1. **Reader-facing answering bot** — listens in `#ask-thingy`, forwards
   each message to the Lambda's `/chat` SSE endpoint, streams the answer
   back, rewrites `#NNN` issue citations into clickable Discord links,
   and adds 👍/👎 feedback reactions that POST to the Lambda's
   `/feedback` endpoint.
2. **Member controls** — reader commands `/thingy {new,scope}` manage the
   caller's session boundary and corpus scope (Weekly Thing, blog, Another
   Thing, or all sources). Operator review and Dispatch visibility are
   posted directly by the API through Discord webhooks and Operator Reports;
   the bridge does not read or display other readers' conversations.

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
| `DISCORD_CHANNEL_CHATTER` | yes | Channel for startup notices and API-posted cards |
| `LIBRARIAN_API_URL` | yes | Lambda auth API base URL |
| `LIBRARIAN_STREAM_URL` | yes | Lambda `/chat` SSE base URL |
| `LIBRARIAN_BRIDGE_SECRET` | yes | Shared secret for Discord token minting |
| `WEEKLY_THING_SITE_URL` | optional | For citation-link rewriting (defaults to `https://weekly.thingelstad.com`) |
| `THINGY_BRIDGE_DB_PATH` | optional | SQLite path (defaults to `apps/thingy_bridge/data/thingy_bridge.db`) |
| `THINGY_BRIDGE_LOG_FILE` | optional | Log path (defaults to `apps/thingy_bridge/logs/bridge.log`) |
| `THINGY_BRIDGE_LOG_LEVEL` | optional | Logging level (default `INFO`) |
| `THINGY_BRIDGE_SCHEDULER_ENABLED` | optional | Reserved for future bridge jobs; no Thingy polling job is registered today |

See `.env.example` for the template.

## Tests

```bash
apps/thingy_bridge/venv/bin/python -m unittest discover -s apps/thingy_bridge/tests -t .
```
