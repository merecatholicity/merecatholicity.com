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
