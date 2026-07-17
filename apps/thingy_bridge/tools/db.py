"""Small SQLite store for bridge-local job locks.

Reader identity, Discord linkage, role validation, conversations, and mention
logging are all canonical in Studio's Librarian API. The bridge keeps only the
generic scheduler lock table so local maintenance jobs can serialize if they
are added later.
"""

from __future__ import annotations

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
    conn = sqlite3.connect(path, isolation_level=None)
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
    logger.info("thingy_bridge.db ready at %s", db_path())


def _pid_alive(pid: int) -> bool:
    try:
        pid = int(pid)
    except TypeError, ValueError:
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
    """Acquire a job lock, stealing it when the recorded pid is dead."""
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
                "INSERT INTO job_locks (asset, job, started_at, pid) VALUES (?, ?, datetime('now'), ?)",
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
