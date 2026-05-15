# scripts/

Operational utilities for `apps/thingy_bridge/`. Mirrors the layout under
`apps/workshop_bot/scripts/` — same shapes, separate launchd label,
separate database, separate backup directory, so a workshop_bot restart
doesn't drop `#ask-thingy` and vice versa.

## `admin.sh`

Service control for the launchd agent (`com.weeklything.thingy-bridge`).

```bash
apps/thingy_bridge/scripts/admin.sh install   # write ~/Library/LaunchAgents/com.weeklything.thingy-bridge.plist
apps/thingy_bridge/scripts/admin.sh start     # launchctl bootstrap
apps/thingy_bridge/scripts/admin.sh stop      # launchctl bootout
apps/thingy_bridge/scripts/admin.sh restart
apps/thingy_bridge/scripts/admin.sh status
apps/thingy_bridge/scripts/admin.sh upgrade   # stop → git pull → pip install -r → start
apps/thingy_bridge/scripts/admin.sh backup    # invokes backup_db.py
apps/thingy_bridge/scripts/admin.sh tail      # tail -F logs/bridge.{log,err}
```

The plist runs `python -m apps.thingy_bridge.bot` with the repo root as working directory.

**Venv resolution** — `admin.sh` looks (in order) at `$THINGY_BRIDGE_VENV`, `<repo>/venv`, `apps/thingy_bridge/venv`. If none exists, `install` and `upgrade` print the create-venv command and exit.

**Logs** land at `apps/thingy_bridge/logs/bridge.log` and `bridge.err` (gitignored).

## `backup_db.py`

Safe online SQLite backup of `apps/thingy_bridge/data/thingy_bridge.db` (uses `sqlite3.Connection.backup()` — no need to stop the bridge) plus tiered retention pruning.

```bash
python apps/thingy_bridge/scripts/backup_db.py
```

- Output: `~/thingy-bridge-backups/thingy_bridge-YYYY-MM-DD-HHMMSS.db.gz` (gzip level 6)
- Integrity-checks the snapshot before compressing
- Retention: keep-all ≤28d · monthly 29–90d · quarterly 91–365d · delete >365d

Override via env:

- `THINGY_BRIDGE_DB_PATH` — source database (default: `<repo>/apps/thingy_bridge/data/thingy_bridge.db`)
- `THINGY_BRIDGE_BACKUP_DIR` — destination dir (default: `~/thingy-bridge-backups`)

## `clean.py`

Remove local cache cruft under `apps/thingy_bridge/`.

```bash
python apps/thingy_bridge/scripts/clean.py        # __pycache__, .pytest_cache, .mypy_cache, .ruff_cache
python apps/thingy_bridge/scripts/clean.py --db   # also remove apps/thingy_bridge/data/thingy_bridge.db (destructive)
```

## First-time setup on a new server

```bash
# from the repo root
python3 -m venv venv
venv/bin/pip install -r requirements.txt

# apps/thingy_bridge/.env should already carry the Thingy Discord token
# (DISCORD_BOT_TOKEN_THINGY) and Lambda credentials before starting.
apps/thingy_bridge/scripts/admin.sh install
apps/thingy_bridge/scripts/admin.sh start
apps/thingy_bridge/scripts/admin.sh status
apps/thingy_bridge/scripts/admin.sh tail
```
