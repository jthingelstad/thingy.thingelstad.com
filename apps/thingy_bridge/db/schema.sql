-- thingy_bridge SQLite schema. Idempotent — safe to re-run.

-- Job locks — single-asset serialization for future local bridge jobs.
-- A lock whose pid is no longer a live process is treated as stale and stolen.
CREATE TABLE IF NOT EXISTS job_locks (
  asset TEXT PRIMARY KEY,
  job TEXT NOT NULL,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  pid INTEGER NOT NULL
);
