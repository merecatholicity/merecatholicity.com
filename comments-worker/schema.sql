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
-- Author-scoped lookups: the post-history list and the per-member post count
-- (the rank ladder) both filter live board posts by author_hash.
CREATE INDEX IF NOT EXISTS comments_author_idx ON comments(author_hash, page, status);

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
  -- ttl: disappearing-message lifetime in SECONDS for this conversation. The
  -- clock starts when the RECIPIENT opens a message. NULL = the app default
  -- (7 days). The per-conversation toggle sets 86400 (24h) / 604800 (7d) /
  -- 2592000 (30d); either party may change it and the last write wins for both.
  ttl          INTEGER,
  UNIQUE(a_hash, b_hash)
);
CREATE INDEX IF NOT EXISTS dm_threads_a_idx ON dm_threads(a_hash, last_at);
CREATE INDEX IF NOT EXISTS dm_threads_b_idx ON dm_threads(b_hash, last_at);

-- held = 1 is the shadow hold: a message sent while its sender stood blocked
-- by the recipient. The sender sees it as delivered in their own view; the
-- recipient never does, until an unblock releases it with its original time.
-- enc marks how body is encoded, so the server stays blind and the client knows
-- whether to decrypt: NULL/0 = legacy pre-E2E plaintext (render as-is); 1 = an
-- end-to-end-encrypted member message (body is an opaque "E1.<nonce>.<ct>" blob
-- the client decrypts with the pair's shared X25519 secret); 2 = a system /
-- automated plaintext notice, e.g. a topic-move notice authored by the server
-- (render as-is, labelled). Only enc = 1 is ciphertext; the server never reads
-- any of it. (Existing DBs: ALTER TABLE dms ADD COLUMN enc INTEGER;)
CREATE TABLE IF NOT EXISTS dms (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id   INTEGER NOT NULL,
  sender_hash TEXT NOT NULL,
  body        TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  held        INTEGER,
  enc         INTEGER,
  -- Disappearing-message lifecycle. opened_at = when the RECIPIENT first opened
  -- this message (NULL until then). expires_at = the single shared instant the
  -- row is swept, identical for both sides so a message vanishes for both at
  -- once: created_at + backstop (30d) while unopened, then opened_at + thread
  -- ttl once opened. saved = 1 exempts it from expiry for BOTH (either party may
  -- save; a saved row carries expires_at NULL). media_key = the opaque random R2
  -- object id for a media message (the ciphertext blob; the AES key lives only
  -- inside the E2E body), media_size its ciphertext byte length. media_expired = 1
  -- once the 30-day HARD media cap (Domain.Dm.mediaMaxSeconds) has swept the media
  -- away even though the message itself survives (a saved text/caption keeps
  -- standing; the client renders a "media expired" placeholder in its place).
  -- (Existing DBs: ALTER TABLE dms ADD COLUMN media_expired INTEGER;)
  opened_at    INTEGER,
  expires_at   INTEGER,
  saved        INTEGER,
  media_key    TEXT,
  media_size   INTEGER,
  media_expired INTEGER
);
CREATE INDEX IF NOT EXISTS dms_thread_idx ON dms(thread_id, id);
CREATE INDEX IF NOT EXISTS dms_expires_idx ON dms(expires_at);

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
  updated_at INTEGER,
  -- Settings-gear preferences (Privacy & safety + Notifications). All keyed +
  -- private (never exposed on the public profile read). receipts_mode 'auto'/'off'
  -- gates read receipts reciprocally (off = send none AND see none). notify_reply/
  -- notify_mention/notify_dm are 1 (on, the default) / 0 (off), checked at delivery
  -- (dm off silences only the bell; the message + inbox badge still arrive). NULL =
  -- the default (receipts auto, all notifies on). See Domain.Prefs.
  -- (Existing DBs: ALTER TABLE profiles ADD COLUMN receipts_mode TEXT; +
  --  notify_reply/notify_mention/notify_dm INTEGER.)
  receipts_mode  TEXT,
  notify_reply   INTEGER,
  notify_mention INTEGER,
  notify_dm      INTEGER,
  -- Custom profile @handle: the public URL name (merecatholicity.com/@handle →
  -- profile.html?u=handle), stored lower-cased and unique, distinct from the
  -- free-form display `nick`. NULL = none (the URL falls back to ?u=<hash>). The
  -- format rules live in Domain.Handle; uniqueness is the index below.
  -- (Existing DBs: ALTER TABLE profiles ADD COLUMN handle TEXT;)
  handle         TEXT
);
-- One holder per handle (case-insensitive: handles are stored already-lowered).
CREATE UNIQUE INDEX IF NOT EXISTS profiles_handle ON profiles(handle);

-- In-app notifications: one row per event for one recipient. kind 'reply' is a
-- new reply in a thread the recipient watches; 'mention' is an @mention; 'dm' is
-- a direct message (so a DM shows in the notifications list, not only the inbox
-- badge — coalesced to one unread row per sender, carrying topic_id/comment_id 0
-- and jumping to the conversation); 'wall' is a public-post mention or a comment
-- on your post (comment_id = the wall_posts id, jumps to ?post=<id>). The read
-- watermark is a single stamp (read_at NULL = unread), same idiom as the DM read
-- stamps; opening the notifications list stamps them all read. For reply/mention,
-- topic_id is the thread to open and comment_id the exact post to jump to.
-- (Adding a kind — 'wall', 'wall-like' — on an existing DB is a table rebuild:
-- SQLite cannot ALTER a CHECK, so create a new table with the widened CHECK, copy
-- rows, swap. 'wall'/'wall-like' carry comment_id = the wall post id.)
CREATE TABLE IF NOT EXISTS notifications (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  recipient_hash TEXT NOT NULL,
  kind           TEXT NOT NULL CHECK (kind IN ('reply','mention','dm','wall','wall-like')),
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

-- Community reports of a post: one per member per post (UNIQUE). A report never
-- hides the post; it only surfaces it, with its count and reasons, in the
-- Activity audit's Reported queue for an admin to dismiss or delete. Orphan rows
-- (the reported comment gone) are swept by the monthly cron.
CREATE TABLE IF NOT EXISTS reports (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  comment_id    INTEGER NOT NULL,
  reporter_hash TEXT NOT NULL,
  reason        TEXT,
  created_at    INTEGER NOT NULL,
  UNIQUE(comment_id, reporter_hash)
);
CREATE INDEX IF NOT EXISTS reports_comment_idx ON reports(comment_id);

-- The admin roster, the single source of truth for who is an admin. Every row is
-- an equal admin, each removable from the console (owners included). The
-- ADMIN_HASHES env var is only a bootstrap: it seeds this table on first use and
-- re-enables its hashes if the table is ever emptied, so the board can never lock
-- itself out. isAdminHash() reads this table; env counts only while it is empty.
CREATE TABLE IF NOT EXISTS admins (
  hash       TEXT PRIMARY KEY,
  added_by   TEXT,
  created_at INTEGER NOT NULL
);

-- Device push tokens for the mobile-notification landing pad. One row per token
-- (a member may have several devices); re-registering a token refreshes it.
-- deliverPush() reads these only when PUSH_ENABLED is on — until an app and a
-- provider (APNs/FCM/Web Push) exist, the table simply fills and is unused.
CREATE TABLE IF NOT EXISTS push_tokens (
  hash       TEXT NOT NULL,
  platform   TEXT NOT NULL,
  token      TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (hash, token)
);
CREATE INDEX IF NOT EXISTS push_tokens_hash_idx ON push_tokens(hash);

-- Published X25519 public keys for the end-to-end-encrypted inbox. Each member
-- derives a keypair deterministically from the secret behind their identity
-- hash and publishes only the PUBLIC half here (POST /dm/pubkey, keyed). To send
-- a DM the client fetches the recipient's pubkey (served in /dm/thread) and
-- encrypts to it; the server never sees a private key and cannot derive one from
-- the hash it stores. pubkey is base64url of 32 bytes. Re-publishing is a no-op
-- (keygen is deterministic), so this upserts. Derived, not backed up.
CREATE TABLE IF NOT EXISTS dm_pubkeys (
  hash       TEXT PRIMARY KEY,
  pubkey     TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER
);

-- End-to-end-encrypted DM media objects in the R2 bucket merecatholicity-dm-media
-- (binding MEDIA). key is a random opaque object id — no uploader/recipient in it
-- or in R2 metadata, so the bucket cannot be traced to who uploaded what — and the
-- stored bytes are client-encrypted ciphertext (AES-256-GCM, the key living only
-- inside the E2E message body). size is the ciphertext byte length (for the 10 GB
-- accounting). msg_id links the object to its dms row once the media message is
-- sent (NULL = uploaded-but-unsent, pruned as an orphan after an hour). The
-- object's lifetime follows its message: deleted on expiry / conversation-delete.
CREATE TABLE IF NOT EXISTS dm_media (
  key        TEXT PRIMARY KEY,
  size       INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  msg_id     INTEGER
);
CREATE INDEX IF NOT EXISTS dm_media_msg_idx ON dm_media(msg_id);

-- Admin-tunable global platform settings: a growing key/value store the admin
-- console edits at runtime (mirroring the librarian's config table). Known keys:
-- media_enabled ('1'/'0'), media_max_bytes (per-upload cap), dm_default_ttl
-- (seconds), dm_backstop_days (unopened-message backstop), dm_media_bytes (the
-- sweep-maintained total R2 usage, display-only). A missing key = coded default.
CREATE TABLE IF NOT EXISTS app_settings (
  k          TEXT PRIMARY KEY,
  v          TEXT NOT NULL,
  updated_at INTEGER,
  updated_by TEXT
);

-- ---- Public posting: walls + the global feed ----------------------------------
-- A "wall" is a member's own stream of PUBLIC posts. You post only to your own
-- wall (author_hash IS the wall owner); a post shows on the author's wall AND in
-- the global feed. Unlike DMs these are public and UNencrypted, and they persist
-- INDEFINITELY unless the admin enables auto-prune (see app_settings wall_prune_*).
-- status mirrors comments: 'live' | 'pending' (held by the AI screen) | 'deleted'.
-- media_key/media_size point at an optional attachment in the WALLMEDIA bucket
-- (served publicly, same-origin). comments is a denormalized live-comment count.
CREATE TABLE IF NOT EXISTS wall_posts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  author_hash TEXT NOT NULL,
  body        TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  edited_at   INTEGER,
  status      TEXT NOT NULL DEFAULT 'live' CHECK (status IN ('live','pending','deleted')),
  media_key   TEXT,
  media_size  INTEGER,
  comments    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS wall_posts_feed_idx ON wall_posts(created_at);
CREATE INDEX IF NOT EXISTS wall_posts_author_idx ON wall_posts(author_hash, created_at);

-- A comment on a public post (text + optional media). Any member may comment on
-- any post. Swept with its post by the prune / delete paths (no FK cascade in D1,
-- so deletes are explicit).
CREATE TABLE IF NOT EXISTS wall_comments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id     INTEGER NOT NULL,
  author_hash TEXT NOT NULL,
  body        TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  status      TEXT NOT NULL DEFAULT 'live' CHECK (status IN ('live','pending','deleted')),
  media_key   TEXT,
  media_size  INTEGER
);
CREATE INDEX IF NOT EXISTS wall_comments_post_idx ON wall_comments(post_id, id);

-- R2 accounting for public post/comment media (mirrors dm_media). key = the
-- opaque 'wall/<hex>' object id; ref_type 'post'|'comment' + ref_id link it (NULL
-- until the post/comment that carries it is saved; orphan-pruned after an hour).
CREATE TABLE IF NOT EXISTS wall_media (
  key        TEXT PRIMARY KEY,
  size       INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  ref_type   TEXT,
  ref_id     INTEGER
);
CREATE INDEX IF NOT EXISTS wall_media_ref_idx ON wall_media(ref_type, ref_id);

-- A "like" on a public wall post: one per member per post. The composite PK makes
-- the toggle idempotent (like = INSERT OR IGNORE, unlike = DELETE on the full key)
-- and already indexes both hot paths — the per-post count (WHERE post_id=?) and the
-- "did I like it" point lookup — so no extra index is needed. Public and
-- unencrypted like the posts; the count is computed from this table, not stored.
-- Swept with its post (no FK cascade in D1 — deletes are explicit / orphan-pruned).
CREATE TABLE IF NOT EXISTS wall_likes (
  post_id     INTEGER NOT NULL,
  author_hash TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (post_id, author_hash)
);
