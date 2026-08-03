-- Mutes follow the member (like blocks): the client's device-local mute list
-- gains a server copy on the profiles row, merged by the client on load and
-- written through on every toggle. A JSON array of 64-hex hashes, capped
-- client-side and clamped server-side.
ALTER TABLE profiles ADD COLUMN muted TEXT;

-- Wall comments become editable by their author like posts (wall_posts carried
-- edited_at from the baseline; wall_comments lacked it).
ALTER TABLE wall_comments ADD COLUMN edited_at INTEGER;

-- Saved posts: the save-for-later idiom (DM save, merecat saved threads)
-- extended to the two main content surfaces. kind 'topic' refs a forum topic
-- id, kind 'wall' refs a wall post id. One row per member per item.
CREATE TABLE IF NOT EXISTS bookmarks (
  hash       TEXT    NOT NULL,
  kind       TEXT    NOT NULL CHECK (kind IN ('topic','wall')),
  ref        INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (hash, kind, ref)
);
