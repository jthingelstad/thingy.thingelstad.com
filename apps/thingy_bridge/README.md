# thingy_bridge — Discord Supporting Member presence

Thingy's Discord bridge is a small connector for the Supporting Member server.
It does not run Thingy's brain locally and it is not a second web chat client.

## What It Does

1. **Member validation** — `/thingy verify` starts a web auth flow and
   `/thingy confirm <code>` links the Discord user to the authenticated Thingy
   profile, then grants the Supporting Member role.
2. **Mention presence** — in the configured `#general` channel, Thingy answers
   only when explicitly mentioned. Answers are concise, source-grounded, and
   include a link back to the web app for deeper work.

Studio/Librarian remains authoritative for identity, entitlements, profiles,
retrieval, generation, and operator visibility.

## Quick Start

```bash
python3 -m venv venv
venv/bin/pip install -r requirements.txt
cp .env.example .env
venv/bin/python -m apps.thingy_bridge.bot
```

In normal use, run under `caffeinate` so the Mac does not sleep and drop the
Discord gateway:

```bash
caffeinate -is venv/bin/python -m apps.thingy_bridge.bot
```

## Environment

| Variable | Required | Purpose |
|---|---|---|
| `DISCORD_TOKEN_THINGY` | yes | Bot token for the Thingy Discord application |
| `DISCORD_GUILD_ID` | yes | Supporting Member server id |
| `DISCORD_VALIDATION_CHANNEL_ID` | yes | Channel where `/thingy verify` and `/thingy confirm` are used |
| `DISCORD_GENERAL_CHANNEL_ID` | yes | `#general` channel where explicit mentions are answered |
| `DISCORD_SUPPORTER_ROLE_ID` | yes | Role granted after Supporting Member verification |
| `DISCORD_CHANNEL_CHATTER` | yes | Channel for startup notices |
| `LIBRARIAN_API_URL` | yes | Librarian auth/API base URL |
| `LIBRARIAN_STREAM_URL` | yes | Librarian streaming Lambda URL, including `/discord/mention` |
| `LIBRARIAN_BRIDGE_SECRET` | yes | Shared secret for bridge-to-Librarian calls |
| `THINGY_BRIDGE_DB_PATH` | optional | SQLite path for local job locks |
| `THINGY_BRIDGE_LOG_FILE` | optional | Log path |
| `THINGY_BRIDGE_LOG_LEVEL` | optional | Logging level |

The bot needs Discord member intent enabled, `Manage Roles`, and a bot role
above the Supporting Member role.

## Tests

```bash
apps/thingy_bridge/venv/bin/python -m unittest discover -s apps/thingy_bridge/tests -t .
```
