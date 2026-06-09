-- thingy_bridge SQLite schema. Idempotent — safe to re-run.

-- Cached Lambda session tokens, one per Discord user. The bridge mints
-- a token via /auth?action=discord_bridge, stores it here, and reuses
-- it until expires_at approaches.
CREATE TABLE IF NOT EXISTS thingy_tokens (
  discord_user_id TEXT PRIMARY KEY,
  token TEXT NOT NULL,
  expires_at INTEGER NOT NULL,                 -- epoch seconds (matches Lambda payload.exp)
  issued_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- Profile snapshot returned by the Lambda's /auth response. JSON of
  -- { returning, last_seen_at, turn_count, prior_session_summaries,
  --   current_session_questions }. Updated whenever a new token is minted.
  profile TEXT,
  -- When we last greeted this user with a "welcome back" blurb. Lets
  -- the bridge avoid re-greeting on every fresh-token mint.
  last_welcomed_at TEXT,
  -- When the user last fired `/thingy new`. The history walker stops
  -- walking member-channel history backward as soon as it crosses this timestamp,
  -- so a fresh question after a reset is not contaminated with the
  -- prior session's context. NULL = never reset.
  session_reset_at TEXT
);

-- Per-reader source scope for Thingy's Discord channel. Which body of writing Thingy
-- searches for this user: 'weekly_thing' (the issue archive, default),
-- 'blog' (thingelstad.com), 'podcast' (Another Thing), 'both'
-- (weekly_thing + blog), or 'all'. Kept in its own table rather than on
-- thingy_tokens so a reader can set it via `/thingy scope` before ever asking
-- a question (the token row only exists once a question mints one).
CREATE TABLE IF NOT EXISTS thingy_scopes (
  discord_user_id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One row per question forwarded to the Lambda. Lets the reaction
-- handler look up which Lambda request_id corresponds to a given
-- Discord bot reply when the reader reacts 👍/👎 to it.
CREATE TABLE IF NOT EXISTS thingy_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  discord_user_id TEXT NOT NULL,
  discord_message_id TEXT NOT NULL,
  bot_response_message_id TEXT,
  request_id TEXT,
  question TEXT NOT NULL,
  status TEXT NOT NULL,                        -- 'pending' / 'ok' / 'error'
  error TEXT,
  duration_ms INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_thingy_requests_bot_msg
  ON thingy_requests(bot_response_message_id);

-- Job locks — single-asset serialization for future local bridge jobs.
-- A lock whose pid is no longer a live process is treated as stale and stolen.
CREATE TABLE IF NOT EXISTS job_locks (
  asset TEXT PRIMARY KEY,                        -- e.g. 'job:future-task'
  job TEXT NOT NULL,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  pid INTEGER NOT NULL
);
