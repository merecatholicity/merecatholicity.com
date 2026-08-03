-- Likes on public feed/wall COMMENTS (Facebook-style), the twin of wall_likes on
-- posts: one row per member per comment, composite PK makes the toggle idempotent
-- and indexes both hot paths (per-comment count, "did I like it"). Public and
-- unencrypted; the count is computed, not stored. Swept with its comment/post by
-- the delete/prune paths (no FK cascade in D1 — deletes are explicit).
CREATE TABLE IF NOT EXISTS wall_comment_likes (
  comment_id  INTEGER NOT NULL,
  author_hash TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (comment_id, author_hash)
);
