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
  -- walking #ask-thingy backward as soon as it crosses this timestamp,
  -- so a fresh question after a reset is not contaminated with the
  -- prior session's context. NULL = never reset.
  session_reset_at TEXT
);

-- Per-reader source scope for #ask-thingy. Which body of writing Thingy
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

-- Job locks — single-asset serialization for the watch job. A lock
-- whose pid is no longer a live process is treated as stale and stolen.
CREATE TABLE IF NOT EXISTS job_locks (
  asset TEXT PRIMARY KEY,                        -- e.g. 'job:thingy-watch'
  job TEXT NOT NULL,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  pid INTEGER NOT NULL
);

-- Operator-side mirror of what readers ask the public archive agent.
-- The hourly thingy-watch job fetches logged turns from the Lambda
-- (/auth?action=list_conversations), groups them into conversations
-- (same subscriber, turns within ~30 min / a fresh browser history),
-- runs a Sonnet assessment, stores the whole thing here (so it
-- outlives the Lambda's ~60-day DynamoDB TTL and gets a stable local
-- id), and posts a card to #chatter. `/thingy recent` and `/thingy
-- show <id>` read straight from this table.
CREATE TABLE IF NOT EXISTS thingy_conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subscriber_hash TEXT NOT NULL,               -- SHA256 of the reader's email; never the email itself
  started_at TEXT NOT NULL,                    -- ISO; created_at of the first turn
  ended_at TEXT NOT NULL,                      -- ISO; created_at of the last turn (also the watch watermark)
  turn_count INTEGER NOT NULL,
  -- the conversation as JSON: [{request_id, created_at, question, answer,
  --   citations:[{issue_number,subject,publish_date,section,url}],
  --   source_issues:[...], feedback_reaction, feedback_at}]
  transcript_json TEXT NOT NULL,
  -- JSON array of the turn request_ids in this conversation — the dedup key
  -- (a turn already mirrored here is never re-formed into a new conversation)
  turn_request_ids_json TEXT NOT NULL,
  source_issues_json TEXT,                     -- JSON array of issue numbers cited across the conversation
  feedback TEXT,                               -- 'up' / 'down' / 'mixed' / NULL — rolled up from the turns
  topic TEXT,                                  -- one-line topic, from the assessment pass
  assessment_md TEXT,                          -- the assessment (markdown)
  posted_to_chatter_at TEXT,                   -- when thingy-watch posted the card; NULL until then
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_thingy_conversations_ended
  ON thingy_conversations(ended_at DESC, id DESC);
