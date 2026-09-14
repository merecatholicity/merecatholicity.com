-- 0016_dm_members (2026-09-13): ONE member model for every conversation, the
-- per-member reaction ledger, the per-message sealed keys of envelope v2, and
-- the media reference ledger behind forwarding. A pair is a thread with two
-- member rows; a group is a thread with up to Domain.Dm.maxMembers. The six
-- pair columns of dm_threads are carried across NULLABLE and left behind
-- unread (0012's rule: the ledger is additive, a column is never dropped) —
-- only their NOT NULL forces the table-swap idiom 0008/0009/0014 used.
-- Order matters: every backfill that needs a_hash/b_hash runs BEFORE the drop.

-- 1. The thread, rebuilt. kind 0 = pair, 1 = group — deliberately without a
--    CHECK: the Notif kind lock reads the newest migration that constrains a
--    kind column, and this one is not about bells. pair_key = lower||'|'||higher,
--    NULL for a group (a UNIQUE index treats NULLs as distinct), which
--    replaces UNIQUE(a_hash, b_hash) as the one-thread-per-pair rule.
CREATE TABLE dm_threads_new (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  kind         INTEGER NOT NULL DEFAULT 0,
  pair_key     TEXT,
  name         TEXT,
  created_at   INTEGER NOT NULL,
  created_by   TEXT,
  last_at      INTEGER NOT NULL,
  last_sender  TEXT NOT NULL,
  msgs         INTEGER NOT NULL DEFAULT 0,
  ttl          INTEGER,
  a_hash       TEXT,      -- legacy, unread after 0016
  b_hash       TEXT,      -- legacy
  a_read_at    INTEGER,   -- legacy
  b_read_at    INTEGER,   -- legacy
  a_cleared_at INTEGER,   -- legacy
  b_cleared_at INTEGER    -- legacy
);
INSERT INTO dm_threads_new (id, kind, pair_key, name, created_at, created_by, last_at, last_sender, msgs, ttl,
                            a_hash, b_hash, a_read_at, b_read_at, a_cleared_at, b_cleared_at)
  SELECT id, 0, a_hash || '|' || b_hash, NULL, created_at, NULL, last_at, last_sender, msgs, ttl,
         a_hash, b_hash, a_read_at, b_read_at, a_cleared_at, b_cleared_at FROM dm_threads;
-- The AUTOINCREMENT high-water mark: a copy sets the new table's sequence to
-- the MAX id copied, not to the old seq, so a deleted thread's id would be
-- minted again (its stray messages and backfilled bells would re-attach to a
-- stranger's thread). A sentinel row at the old seq, then deleted, carries
-- the mark portably (no write to sqlite_sequence itself).
INSERT INTO dm_threads_new (id, kind, created_at, last_at, last_sender, msgs)
  SELECT seq, 0, 0, 0, '', 0 FROM sqlite_sequence
  WHERE name = 'dm_threads' AND seq > (SELECT COALESCE(MAX(id), 0) FROM dm_threads_new);
DELETE FROM dm_threads_new WHERE last_sender = '' AND created_at = 0;

-- 2. Members. left_at NULL = current; joined_at is what a member sees from
--    (>=, so the "X added Y" line written in the same second is theirs);
--    read_at / cleared_at are the per-member stamps a_/b_ used to carry.
CREATE TABLE IF NOT EXISTS dm_members (
  thread_id  INTEGER NOT NULL,
  hash       TEXT NOT NULL,
  joined_at  INTEGER NOT NULL,
  left_at    INTEGER,
  read_at    INTEGER,
  cleared_at INTEGER,
  added_by   TEXT,
  PRIMARY KEY (thread_id, hash)
);
CREATE INDEX IF NOT EXISTS dm_members_hash_idx ON dm_members(hash, left_at);
INSERT OR IGNORE INTO dm_members (thread_id, hash, joined_at, read_at, cleared_at)
  SELECT id, a_hash, created_at, a_read_at, a_cleared_at FROM dm_threads;
INSERT OR IGNORE INTO dm_members (thread_id, hash, joined_at, read_at, cleared_at)
  SELECT id, b_hash, created_at, b_read_at, b_cleared_at FROM dm_threads;

-- 3. Reactions: one per member per message; react_a/react_b carried across
--    (dated by the message — the columns never said when) and left unread.
CREATE TABLE IF NOT EXISTS dm_reactions (
  msg_id     INTEGER NOT NULL,
  hash       TEXT NOT NULL,
  emoji      TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (msg_id, hash)
);
INSERT OR IGNORE INTO dm_reactions (msg_id, hash, emoji, created_at)
  SELECT m.id, t.a_hash, m.react_a, m.created_at FROM dms m JOIN dm_threads t ON t.id = m.thread_id
  WHERE m.react_a IS NOT NULL AND m.react_a != '';
INSERT OR IGNORE INTO dm_reactions (msg_id, hash, emoji, created_at)
  SELECT m.id, t.b_hash, m.react_b, m.created_at FROM dms m JOIN dm_threads t ON t.id = m.thread_id
  WHERE m.react_b IS NOT NULL AND m.react_b != '';

-- 4. Envelope v2: the message's content key K, sealed once per member (a
--    nacl.box to the member's published key) and served to that member alone.
--    A member added later has no row for earlier words — no history. Dies
--    with the message.
CREATE TABLE IF NOT EXISTS dm_keys (
  msg_id  INTEGER NOT NULL,
  hash    TEXT NOT NULL,
  sealed  TEXT NOT NULL,
  PRIMARY KEY (msg_id, hash)
);

-- 5. Media references: a forwarded attachment is not re-uploaded, so one R2
--    object may be named by several messages in several threads and lives
--    until the LAST reference goes (releaseMediaRefs). dm_media.msg_id
--    retires, unread, never dropped.
CREATE TABLE IF NOT EXISTS dm_media_refs (
  key    TEXT NOT NULL,
  msg_id INTEGER NOT NULL,
  PRIMARY KEY (key, msg_id)
);
CREATE INDEX IF NOT EXISTS dm_media_refs_msg_idx ON dm_media_refs(msg_id);
INSERT OR IGNORE INTO dm_media_refs (key, msg_id) SELECT media_key, id FROM dms WHERE media_key IS NOT NULL;
INSERT OR IGNORE INTO dm_media_refs (key, msg_id) SELECT key, msg_id FROM dm_media WHERE msg_id IS NOT NULL;

-- 6. Who saved it (Snapchat names the saver).
ALTER TABLE dms ADD COLUMN saved_by TEXT;

-- 7. The swap, then the indexes the readers use.
DROP TABLE dm_threads;
ALTER TABLE dm_threads_new RENAME TO dm_threads;
CREATE UNIQUE INDEX IF NOT EXISTS dm_threads_pair_idx ON dm_threads(pair_key);
CREATE INDEX IF NOT EXISTS dm_threads_last_idx ON dm_threads(last_at);
-- The legacy pair uniqueness, kept one deploy: the worker built before this
-- migration upserts a pair with ON CONFLICT(a_hash, b_hash), and the ledger is
-- applied BEFORE the deploy — a failed deploy must leave it able to write.
-- NULLs are distinct here too, so groups (NULL a_hash/b_hash) never collide.
CREATE UNIQUE INDEX IF NOT EXISTS dm_threads_ab_idx ON dm_threads(a_hash, b_hash);

-- 8. Bells by thread: a DM bell names its conversation in topic_id now (0 =
--    unbackfilled legacy, still cleared by actor one deploy). A reaction's
--    bell takes its message's thread; the rest the pair's.
UPDATE notifications SET topic_id = (SELECT thread_id FROM dms WHERE dms.id = notifications.comment_id)
  WHERE kind = 'dm-react' AND topic_id = 0 AND EXISTS (SELECT 1 FROM dms WHERE dms.id = notifications.comment_id);
UPDATE notifications SET topic_id = (
    SELECT t.id FROM dm_threads t WHERE t.pair_key = CASE WHEN recipient_hash < actor_hash
      THEN recipient_hash || '|' || actor_hash ELSE actor_hash || '|' || recipient_hash END)
  WHERE kind IN ('dm','dm-react','call') AND topic_id = 0 AND actor_hash IS NOT NULL AND EXISTS (
    SELECT 1 FROM dm_threads t WHERE t.pair_key = CASE WHEN recipient_hash < actor_hash
      THEN recipient_hash || '|' || actor_hash ELSE actor_hash || '|' || recipient_hash END);
