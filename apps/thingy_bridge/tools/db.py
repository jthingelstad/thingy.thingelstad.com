"""SQLite wrapper for thingy_bridge.

The bridge's local store: cached Lambda tokens, per-question request
mirror, the operator-side conversation mirror, and a small job_locks
table for serializing the watch job.

Connections are short-lived (per-call) — sqlite3 connections aren't
safe to share across asyncio tasks, and the workload is tiny enough
that the per-call overhead doesn't matter.

This is a trimmed-down sibling of workshop_bot/tools/db.py — same
shape, only the helpers the bridge actually uses. If a third consumer
needs SQLite plumbing, lift to a shared package.
"""

from __future__ import annotations

import json
import logging
import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator, Optional

REPO = Path(__file__).resolve().parents[3]
DEFAULT_DB_PATH = REPO / "apps" / "thingy_bridge" / "data" / "thingy_bridge.db"
SCHEMA_PATH = REPO / "apps" / "thingy_bridge" / "db" / "schema.sql"

logger = logging.getLogger("thingy_bridge.db")


def db_path() -> Path:
    raw = os.environ.get("THINGY_BRIDGE_DB_PATH")
    if raw:
        return Path(raw) if Path(raw).is_absolute() else REPO / raw
    return DEFAULT_DB_PATH


@contextmanager
def connect() -> Iterator[sqlite3.Connection]:
    path = db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, isolation_level=None)  # autocommit
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    try:
        yield conn
    finally:
        conn.close()


def run_migrations() -> None:
    schema = SCHEMA_PATH.read_text(encoding="utf-8")
    with connect() as conn:
        conn.executescript(schema)
        _apply_column_migrations(conn)
    logger.info("thingy_bridge.db ready at %s", db_path())


# SQLite has no "ADD COLUMN IF NOT EXISTS". For columns added after the
# initial table creation, run ALTER TABLE and tolerate the duplicate-
# column error so a fresh DB and a long-lived DB both end up identical.
_COLUMN_MIGRATIONS: tuple[tuple[str, str, str], ...] = (
    # (table, column, full ADD COLUMN clause)
    ("thingy_tokens", "profile", "ALTER TABLE thingy_tokens ADD COLUMN profile TEXT"),
    ("thingy_tokens", "last_welcomed_at",
     "ALTER TABLE thingy_tokens ADD COLUMN last_welcomed_at TEXT"),
    ("thingy_tokens", "session_reset_at",
     "ALTER TABLE thingy_tokens ADD COLUMN session_reset_at TEXT"),
)


def _apply_column_migrations(conn: sqlite3.Connection) -> None:
    for table, column, sql in _COLUMN_MIGRATIONS:
        try:
            existing = {
                row["name"]
                for row in conn.execute(f"PRAGMA table_info({table})")
            }
        except sqlite3.Error:
            continue
        if column in existing:
            continue
        try:
            conn.execute(sql)
        except sqlite3.OperationalError:
            # Column was added concurrently by another process; ignore.
            pass


# ---------- Thingy tokens (per-reader Lambda sessions) ----------

def get_thingy_token(discord_user_id: str) -> Optional[dict[str, Any]]:
    """Cached session token + profile for a Discord user, if any."""
    with connect() as conn:
        row = conn.execute(
            "SELECT discord_user_id, token, expires_at, issued_at, profile, "
            "       last_welcomed_at, session_reset_at "
            "FROM thingy_tokens WHERE discord_user_id = ?",
            (discord_user_id,),
        ).fetchone()
    if row is None:
        return None
    out = dict(row)
    raw_profile = out.get("profile")
    if isinstance(raw_profile, str) and raw_profile:
        try:
            out["profile"] = json.loads(raw_profile)
        except json.JSONDecodeError:
            out["profile"] = None
    return out


def upsert_thingy_token(
    *,
    discord_user_id: str,
    token: str,
    expires_at: int,
    profile: Optional[dict[str, Any]] = None,
) -> None:
    """Insert/refresh a token row, optionally storing the auth response's
    `profile` snapshot. ``last_welcomed_at`` is preserved across upserts."""
    profile_json = json.dumps(profile) if profile is not None else None
    with connect() as conn:
        conn.execute(
            "INSERT INTO thingy_tokens "
            "(discord_user_id, token, expires_at, profile) "
            "VALUES (?, ?, ?, ?) "
            "ON CONFLICT(discord_user_id) DO UPDATE SET "
            "  token = excluded.token, "
            "  expires_at = excluded.expires_at, "
            "  issued_at = datetime('now'), "
            "  profile = COALESCE(excluded.profile, thingy_tokens.profile)",
            (discord_user_id, token, int(expires_at), profile_json),
        )


def mark_session_reset(discord_user_id: str) -> bool:
    """Stamp the user's row with `session_reset_at = now`. Returns True
    if a row was updated. Returns False if the user has no cached token
    yet — in which case there is no prior history to scope, so a reset
    is a no-op from the caller's perspective.
    """
    with connect() as conn:
        cur = conn.execute(
            "UPDATE thingy_tokens SET session_reset_at = datetime('now') "
            "WHERE discord_user_id = ?",
            (discord_user_id,),
        )
        return cur.rowcount > 0


def get_session_reset_at(discord_user_id: str) -> Optional[str]:
    """Return the ISO timestamp of the user's last `/thingy new`, or
    None if never reset. Cheap point read used by the history walker."""
    with connect() as conn:
        row = conn.execute(
            "SELECT session_reset_at FROM thingy_tokens WHERE discord_user_id = ?",
            (discord_user_id,),
        ).fetchone()
    if row is None:
        return None
    value = row["session_reset_at"]
    return value if value else None


# ---------- Thingy scope (per-reader source selection) ----------

# The source scopes a reader can set for Thingy. Mirrors the Lambda's
# shared/scope.mjs SCOPES/DEFAULT_SCOPE — keep these in sync. SCOPE_LABELS
# is the reader-facing name shown in the `/thingy scope` choices and the
# answer footer.
DEFAULT_SCOPE = "weekly_thing"
VALID_SCOPES = ("weekly_thing", "blog", "podcast", "both", "all")
SCOPE_LABELS = {
    "weekly_thing": "Weekly Thing",
    "blog": "Jamie's blog",
    "podcast": "Another Thing",
    "both": "Weekly Thing + blog",
    "all": "Weekly Thing + blog + Another Thing",
}


def set_thingy_scope(discord_user_id: str, scope: str) -> None:
    """Persist a reader's active source scope. UPSERT keyed by Discord
    user id and independent of token lifecycle, so a reader can set it
    before their first question ever mints a token row."""
    if scope not in VALID_SCOPES:
        scope = DEFAULT_SCOPE
    with connect() as conn:
        conn.execute(
            "INSERT INTO thingy_scopes (discord_user_id, scope) "
            "VALUES (?, ?) "
            "ON CONFLICT(discord_user_id) DO UPDATE SET "
            "  scope = excluded.scope, updated_at = datetime('now')",
            (discord_user_id, scope),
        )


def get_thingy_scope(discord_user_id: str) -> str:
    """Return the reader's stored scope, or the default if unset/invalid."""
    with connect() as conn:
        row = conn.execute(
            "SELECT scope FROM thingy_scopes WHERE discord_user_id = ?",
            (discord_user_id,),
        ).fetchone()
    if row is None:
        return DEFAULT_SCOPE
    value = row["scope"]
    return value if value in VALID_SCOPES else DEFAULT_SCOPE


# ---------- Thingy requests (per-question mirror) ----------

def insert_thingy_request(
    *,
    discord_user_id: str,
    discord_message_id: str,
    question: str,
    status: str = "pending",
) -> int:
    with connect() as conn:
        cur = conn.execute(
            "INSERT INTO thingy_requests "
            "(discord_user_id, discord_message_id, question, status) "
            "VALUES (?, ?, ?, ?)",
            (discord_user_id, discord_message_id, question, status),
        )
        return int(cur.lastrowid or 0)


def update_thingy_request(
    request_row_id: int,
    *,
    status: Optional[str] = None,
    error: Optional[str] = None,
    duration_ms: Optional[int] = None,
    request_id: Optional[str] = None,
    bot_response_message_id: Optional[str] = None,
) -> None:
    fields: list[str] = []
    params: list[Any] = []
    if status is not None:
        fields.append("status = ?")
        params.append(status)
    if error is not None:
        fields.append("error = ?")
        params.append(error)
    if duration_ms is not None:
        fields.append("duration_ms = ?")
        params.append(int(duration_ms))
    if request_id is not None:
        fields.append("request_id = ?")
        params.append(request_id)
    if bot_response_message_id is not None:
        fields.append("bot_response_message_id = ?")
        params.append(bot_response_message_id)
    if not fields:
        return
    params.append(request_row_id)
    with connect() as conn:
        conn.execute(
            f"UPDATE thingy_requests SET {', '.join(fields)} WHERE id = ?",
            params,
        )


def lookup_thingy_request_by_response(
    bot_response_message_id: str,
) -> Optional[dict[str, Any]]:
    with connect() as conn:
        row = conn.execute(
            "SELECT id, discord_user_id, discord_message_id, "
            "       bot_response_message_id, request_id, question, status "
            "FROM thingy_requests "
            "WHERE bot_response_message_id = ? "
            "ORDER BY id DESC LIMIT 1",
            (bot_response_message_id,),
        ).fetchone()
    return dict(row) if row else None


# ---------- Thingy conversations (operator's view into reader Q&A) ----------

def insert_thingy_conversation(
    *,
    subscriber_hash: str,
    started_at: str,
    ended_at: str,
    turn_count: int,
    transcript: list[dict[str, Any]],
    turn_request_ids: list[str],
    source_issues: list[str],
    feedback: Optional[str],
    topic: Optional[str],
    assessment_md: Optional[str],
    posted_to_chatter_at: Optional[str] = None,
) -> int:
    """Insert one mirrored conversation; returns its local id."""
    with connect() as conn:
        cur = conn.execute(
            "INSERT INTO thingy_conversations "
            "(subscriber_hash, started_at, ended_at, turn_count, transcript_json, "
            " turn_request_ids_json, source_issues_json, feedback, topic, assessment_md, "
            " posted_to_chatter_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                subscriber_hash, started_at, ended_at, int(turn_count),
                json.dumps(transcript), json.dumps(list(turn_request_ids)),
                json.dumps(list(source_issues)), feedback, topic, assessment_md,
                posted_to_chatter_at,
            ),
        )
        return int(cur.lastrowid)


def mark_thingy_conversation_posted(conv_id: int) -> None:
    with connect() as conn:
        conn.execute(
            "UPDATE thingy_conversations SET posted_to_chatter_at = datetime('now') "
            "WHERE id = ? AND posted_to_chatter_at IS NULL",
            (conv_id,),
        )


def _hydrate_thingy_conversation(row: sqlite3.Row) -> dict[str, Any]:
    d = dict(row)
    for col, key in (("transcript_json", "transcript"),
                     ("turn_request_ids_json", "turn_request_ids"),
                     ("source_issues_json", "source_issues")):
        raw = d.pop(col, None)
        try:
            d[key] = json.loads(raw) if raw else []
        except (ValueError, TypeError):
            d[key] = []
    return d


def get_thingy_conversation(conv_id: int) -> Optional[dict[str, Any]]:
    with connect() as conn:
        row = conn.execute(
            "SELECT * FROM thingy_conversations WHERE id = ?", (conv_id,)
        ).fetchone()
    return _hydrate_thingy_conversation(row) if row else None


def recent_thingy_conversations(limit: int = 8) -> list[dict[str, Any]]:
    with connect() as conn:
        rows = conn.execute(
            "SELECT * FROM thingy_conversations ORDER BY ended_at DESC, id DESC LIMIT ?",
            (int(limit),),
        ).fetchall()
    return [_hydrate_thingy_conversation(r) for r in rows]


def unposted_thingy_conversations(limit: int = 50) -> list[dict[str, Any]]:
    """Conversations mirrored locally but whose ``#chatter`` card never
    landed (``posted_to_chatter_at IS NULL``).

    Returned oldest-first so the operator sees them in chronological
    order when the bridge backfills after a permission/access window.
    The watch job reads this at the top of each run and retries the
    posts — without it, a row whose post failed is trapped forever
    because :func:`seen_thingy_turn_request_ids` excludes its turns
    from re-forming a fresh conversation.
    """
    with connect() as conn:
        rows = conn.execute(
            "SELECT * FROM thingy_conversations "
            "WHERE posted_to_chatter_at IS NULL "
            "ORDER BY ended_at ASC, id ASC LIMIT ?",
            (int(limit),),
        ).fetchall()
    return [_hydrate_thingy_conversation(r) for r in rows]


def count_unposted_thingy_conversations() -> int:
    with connect() as conn:
        row = conn.execute(
            "SELECT COUNT(*) AS n FROM thingy_conversations "
            "WHERE posted_to_chatter_at IS NULL"
        ).fetchone()
    return int(row["n"]) if row else 0


def latest_thingy_conversation_end() -> Optional[str]:
    """ISO timestamp of the newest mirrored turn — the watch watermark."""
    with connect() as conn:
        row = conn.execute(
            "SELECT MAX(ended_at) AS m FROM thingy_conversations"
        ).fetchone()
    return row["m"] if row and row["m"] else None


def seen_thingy_turn_request_ids() -> set[str]:
    """Every turn request_id already folded into a mirrored conversation."""
    seen: set[str] = set()
    with connect() as conn:
        rows = conn.execute(
            "SELECT turn_request_ids_json FROM thingy_conversations"
        ).fetchall()
    for r in rows:
        try:
            for rid in json.loads(r["turn_request_ids_json"] or "[]"):
                if rid:
                    seen.add(str(rid))
        except (ValueError, TypeError):
            continue
    return seen


# ---------- Job locks (single-asset serialization for the watch job) ----------

def _pid_alive(pid: int) -> bool:
    """True if ``pid`` looks like a live process. A nonexistent pid is
    dead; a permission error means the process exists but isn't ours to
    signal (won't happen in a single-user deployment, but treat as live)."""
    try:
        pid = int(pid)
    except (TypeError, ValueError):
        return False
    if pid <= 0:
        return False
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except OSError:
        return False
    return True


def acquire_job_lock(*, asset: str, job: str, pid: int) -> Optional[dict[str, Any]]:
    """Try to lock ``asset`` for ``job``.

    Returns ``None`` on success. If the asset is already held by a
    *live* process, returns that lock row as a dict. A lock held by a
    dead pid is stale — deleted and re-acquired.
    """
    with connect() as conn:
        conn.execute("BEGIN IMMEDIATE")
        try:
            row = conn.execute(
                "SELECT asset, job, started_at, pid FROM job_locks WHERE asset = ?",
                (asset,),
            ).fetchone()
            if row is not None:
                if _pid_alive(row["pid"]):
                    conn.execute("ROLLBACK")
                    return dict(row)
                conn.execute("DELETE FROM job_locks WHERE asset = ?", (asset,))
            conn.execute(
                "INSERT INTO job_locks (asset, job, started_at, pid) "
                "VALUES (?, ?, datetime('now'), ?)",
                (asset, job, int(pid)),
            )
            conn.execute("COMMIT")
            return None
        except Exception:
            conn.execute("ROLLBACK")
            raise


def release_job_lock(asset: str) -> bool:
    with connect() as conn:
        cur = conn.execute("DELETE FROM job_locks WHERE asset = ?", (asset,))
        return cur.rowcount > 0


def list_job_locks() -> list[dict[str, Any]]:
    with connect() as conn:
        rows = conn.execute(
            "SELECT asset, job, started_at, pid FROM job_locks ORDER BY started_at"
        ).fetchall()
    return [dict(r) for r in rows]
