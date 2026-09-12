-- Reactions on public posts (2026-09-12): the board's posts (topic heads,
-- replies and article-page comments — every row of `comments`), the feed's
-- posts and the feed's comments, in ONE ledger. One reaction per member per
-- target — any single emoji or one of our custom-pack tokens, validated by
-- Domain.Reaction.normalizeReaction exactly as a DM reaction is — so the
-- press-and-hold that a message answers to answers on every post too.
--
-- The feed's ❤️ likes are carried forward as the ❤️ reaction (U+2764 U+FE0F,
-- the quick bar's own bytes — the way 0012 carried the DM heart), and
-- wall_likes / wall_comment_likes are then left behind unread: the ledger
-- never drops a table. The composite key makes the toggle idempotent and
-- indexes both hot paths (the per-target tally and "what did I put"); the
-- author index serves the viewer's batched "mine" lookup.
CREATE TABLE IF NOT EXISTS reactions (
  target      TEXT NOT NULL CHECK (target IN ('post','wall','wallc')),
  target_id   INTEGER NOT NULL,
  author_hash TEXT NOT NULL,
  emoji       TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (target, target_id, author_hash)
);
CREATE INDEX IF NOT EXISTS reactions_author_idx ON reactions(author_hash, target, target_id);
INSERT OR IGNORE INTO reactions (target, target_id, author_hash, emoji, created_at)
  SELECT 'wall', post_id, author_hash, '❤️', created_at FROM wall_likes;
INSERT OR IGNORE INTO reactions (target, target_id, author_hash, emoji, created_at)
  SELECT 'wallc', comment_id, author_hash, '❤️', created_at FROM wall_comment_likes;

-- A reaction is a notification too: 'react' (a board post — topic_id the
-- thread, comment_id the post), 'wall-react' (comment_id the feed post,
-- topic_id the feed comment, or 0 for the post itself) and 'dm-react'
-- (comment_id the message; jumps to the conversation, landing on it). The
-- word is always "reacted" — never the emoji, never "liked". SQLite cannot
-- ALTER a CHECK, so this is the table-swap idiom 'dm', 'merecat' and 'call'
-- used, all rows preserved; the kind list is Domain.Notif.kinds.
CREATE TABLE notifications_new (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  recipient_hash TEXT NOT NULL,
  kind           TEXT NOT NULL CHECK (kind IN ('reply','mention','dm','wall','wall-like','merecat','call','react','wall-react','dm-react')),
  topic_id       INTEGER NOT NULL,
  comment_id     INTEGER NOT NULL,
  actor_hash     TEXT,
  created_at     INTEGER NOT NULL,
  read_at        INTEGER
);
INSERT INTO notifications_new (id, recipient_hash, kind, topic_id, comment_id, actor_hash, created_at, read_at)
  SELECT id, recipient_hash, kind, topic_id, comment_id, actor_hash, created_at, read_at FROM notifications;
DROP TABLE notifications;
ALTER TABLE notifications_new RENAME TO notifications;
CREATE INDEX IF NOT EXISTS notifications_recipient_idx ON notifications(recipient_hash, id);
