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
  sticky      INTEGER,
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

-- Locked identities: a reversible account disable. A locked hash is logged out
-- and refused every keyed interaction until unlocked.
CREATE TABLE IF NOT EXISTS locks (
  hash       TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);

-- Banned IP keys, normalized: a v4 address verbatim, a v6 address as its /64
-- prefix (e.g. 2605:59ca:39db:4308::/64), because a client's v6 interface id
-- rotates daily while the delegated /64 does not. Enforced by the worker for
-- logged-in/keyed requests only, never for cached anonymous reads.
CREATE TABLE IF NOT EXISTS ip_bans (
  ip         TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);

-- Every IP seen behind a posting identity, so the fingerprint drawer can show
-- and ban both families of a dual-stack user at once. source 'seen' is the
-- verified CF-Connecting-IP (unspoofable); 'claimed' is the other-family
-- address the browser reported from a single-family echo at post time. ip_key
-- is the normalized ban unit (matches ip_bans.ip); ip_display is a real
-- address actually seen, for the admin to read. Not a ledger: the drawer shows
-- only rows seen inside IP_SHOW_DAYS (14), the monthly cron deletes rows idle
-- past IP_KEEP_DAYS (30), and banned keys are exempt from both.
CREATE TABLE IF NOT EXISTS identity_ips (
  hash       TEXT NOT NULL,
  ip_key     TEXT NOT NULL,
  ip_display TEXT NOT NULL,
  family     INTEGER NOT NULL,
  source     TEXT NOT NULL CHECK (source IN ('seen','claimed')),
  first_seen INTEGER NOT NULL,
  last_seen  INTEGER NOT NULL,
  PRIMARY KEY (hash, ip_key)
);
CREATE INDEX IF NOT EXISTS identity_ips_hash_idx ON identity_ips(hash);

-- Direct messages: strictly 1v1, the pair stored in canonical order (a_hash is
-- the lexicographically lower of the two) so one UNIQUE row holds each pair.
-- last_sender keeps your own message from ever reading as unread to you, and
-- the per-side read_at stamps carry the unread state without a per-message flag.
-- a_cleared_at/b_cleared_at are the per-side "delete conversation" stamps: that
-- side sees only messages newer than its stamp (a fresh start), and when both
-- are set with no message past them the whole thread is purged. NULL = never
-- cleared = full history, so every preexisting thread is untouched.
CREATE TABLE IF NOT EXISTS dm_threads (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  a_hash       TEXT NOT NULL,
  b_hash       TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  last_at      INTEGER NOT NULL,
  last_sender  TEXT NOT NULL,
  msgs         INTEGER NOT NULL DEFAULT 0,
  a_read_at    INTEGER,
  b_read_at    INTEGER,
  a_cleared_at INTEGER,
  b_cleared_at INTEGER,
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
  faith      TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER
);

-- In-app notifications: one row per event for one recipient. kind 'reply' is a
-- new reply in a thread the recipient watches; 'mention' is an @mention. The
-- read watermark is a single stamp (read_at NULL = unread), same idiom as the
-- DM read stamps; opening the notifications list stamps them all read. topic_id
-- is the thread to open, comment_id the exact post to jump to.
CREATE TABLE IF NOT EXISTS notifications (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  recipient_hash TEXT NOT NULL,
  kind           TEXT NOT NULL CHECK (kind IN ('reply','mention')),
  topic_id       INTEGER NOT NULL,
  comment_id     INTEGER NOT NULL,
  actor_hash     TEXT,
  created_at     INTEGER NOT NULL,
  read_at        INTEGER
);
CREATE INDEX IF NOT EXISTS notifications_recipient_idx ON notifications(recipient_hash, id);

-- Threads a member follows. A member auto-watches any thread they post in (topic
-- or reply) and may Watch/Unwatch by hand; every reply fans a 'reply'
-- notification to each watcher but the replier. One row per (member, thread).
CREATE TABLE IF NOT EXISTS watches (
  hash       TEXT NOT NULL,
  topic_id   INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (hash, topic_id)
);
CREATE INDEX IF NOT EXISTS watches_topic_idx ON watches(topic_id);

-- Full-text search over forum posts. An external-content FTS5 index over the
-- comments table's title/body: it stores only the search index, reading the
-- text back from comments by rowid, and the three triggers keep it in lockstep
-- with every insert, edit, and delete. porter stemming lets "conclude" find
-- "concluded"; unicode61 folds diacritics. The index mirrors ALL comments;
-- restricting to live forum rows is done at query time (handleSearch), so no
-- conditional triggers are needed. After creating this on an existing database,
-- run once to index the rows that predate the triggers:
--   INSERT INTO comments_fts(comments_fts) VALUES('rebuild');
CREATE VIRTUAL TABLE IF NOT EXISTS comments_fts USING fts5(
  title, body, content='comments', content_rowid='id', tokenize='porter unicode61'
);
CREATE TRIGGER IF NOT EXISTS comments_ai AFTER INSERT ON comments BEGIN
  INSERT INTO comments_fts(rowid, title, body) VALUES (new.id, new.title, new.body);
END;
CREATE TRIGGER IF NOT EXISTS comments_ad AFTER DELETE ON comments BEGIN
  INSERT INTO comments_fts(comments_fts, rowid, title, body) VALUES ('delete', old.id, old.title, old.body);
END;
CREATE TRIGGER IF NOT EXISTS comments_au AFTER UPDATE ON comments BEGIN
  INSERT INTO comments_fts(comments_fts, rowid, title, body) VALUES ('delete', old.id, old.title, old.body);
  INSERT INTO comments_fts(rowid, title, body) VALUES (new.id, new.title, new.body);
END;

-- Per-user board read state for "new since last visit". One row per thread the
-- member has read; topic_id = 0 is the "read everything up to read_at" floor,
-- set on a member's first arrival so a newcomer sees no wall of new, and reset
-- by "Mark all read". A thread reads as new when its last_at exceeds the reader's
-- read_at for it (or the floor). Mirrors the watches shape and the DM read_at
-- idiom. Orphan rows (vanished topics) are swept by the monthly cron.
CREATE TABLE IF NOT EXISTS thread_reads (
  hash     TEXT NOT NULL,
  topic_id INTEGER NOT NULL,
  read_at  INTEGER NOT NULL,
  PRIMARY KEY (hash, topic_id)
);
CREATE INDEX IF NOT EXISTS thread_reads_hash_idx ON thread_reads(hash);
