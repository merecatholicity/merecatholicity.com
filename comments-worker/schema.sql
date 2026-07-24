-- Comments storage for merecatholicity.com. Applied with:
--   deno run -A npm:wrangler d1 execute merecatholicity-comments --remote --file schema.sql
CREATE TABLE IF NOT EXISTS comments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  page        TEXT NOT NULL,
  parent_id   INTEGER,
  title       TEXT,
  author_hash TEXT,
  body        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'live' CHECK (status IN ('live','pending','deleted')),
  created_at  INTEGER NOT NULL,
  ip_hash     TEXT,
  edited_at   INTEGER,
  ai_verdict  TEXT,
  ip          TEXT,
  ua          TEXT,
  os          TEXT,
  tz          TEXT,
  lang        TEXT,
  locked      INTEGER,
  replies     INTEGER,
  last_at     INTEGER
);
CREATE INDEX IF NOT EXISTS comments_page_idx ON comments(page, status, id);

CREATE TABLE IF NOT EXISTS bans (
  hash       TEXT PRIMARY KEY,
  kind       TEXT NOT NULL CHECK (kind IN ('author','ip')),
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS comments_parent_idx ON comments(parent_id, status, id);

CREATE TABLE IF NOT EXISTS trusted (
  hash       TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);

-- Direct messages: strictly 1v1, the pair stored in canonical order (a_hash is
-- the lexicographically lower of the two) so one UNIQUE row holds each pair.
-- last_sender keeps your own message from ever reading as unread to you, and
-- the per-side read_at stamps carry the unread state without a per-message flag.
CREATE TABLE IF NOT EXISTS dm_threads (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  a_hash      TEXT NOT NULL,
  b_hash      TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  last_at     INTEGER NOT NULL,
  last_sender TEXT NOT NULL,
  msgs        INTEGER NOT NULL DEFAULT 0,
  a_read_at   INTEGER,
  b_read_at   INTEGER,
  UNIQUE(a_hash, b_hash)
);
CREATE INDEX IF NOT EXISTS dm_threads_a_idx ON dm_threads(a_hash, last_at);
CREATE INDEX IF NOT EXISTS dm_threads_b_idx ON dm_threads(b_hash, last_at);

-- held = 1 is the shadow hold: a message sent while its sender stood blocked
-- by the recipient. The sender sees it as delivered in their own view; the
-- recipient never does, until an unblock releases it with its original time.
CREATE TABLE IF NOT EXISTS dms (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id   INTEGER NOT NULL,
  sender_hash TEXT NOT NULL,
  body        TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  held        INTEGER
);
CREATE INDEX IF NOT EXISTS dms_thread_idx ON dms(thread_id, id);

-- A block silently holds the blocked party's future messages to the owner.
-- The blocked party is never told; their sends read as delivered to them.
CREATE TABLE IF NOT EXISTS dm_blocks (
  owner_hash   TEXT NOT NULL,
  blocked_hash TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  PRIMARY KEY (owner_hash, blocked_hash)
);

-- Optional profile layer over the pseudonymous identity. The hash is the same
-- author_hash used everywhere else; a custom nick, when set, becomes the
-- primary display name while the assigned pseudonym stays the authoritative
-- identifier. Signature, when set, is appended under the author's posts.
CREATE TABLE IF NOT EXISTS profiles (
  hash       TEXT PRIMARY KEY,
  nick       TEXT,
  bio        TEXT,
  signature  TEXT,
  avatar     TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER
);
