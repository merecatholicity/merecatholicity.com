-- retire_pair_columns (2026-10-17). Additive is not forever: four entries of
-- tests/_support/retirements.json fell due on 2026-10-14, each a column or a
-- table nothing has read since the member model (0016) and the reactions
-- ledgers (0012, 0014) replaced it. The owner chose to retire them (the
-- 2026-10-15 nightly thread); the daily backup of 2026-10-16 stands behind it.
--
-- What goes is what NO worker touches, this one or the one it replaces: the
-- ledger is applied BEFORE `wrangler deploy`, so for those seconds the old
-- worker is still serving, and a column it still writes must outlive it. The
-- three it writes (dm_threads.a_hash / b_hash on a pair's first word and on a
-- rekey; dm_media.msg_id, NULL on every upload) stop being written by this
-- deploy and are dropped by the NEXT migration — their own ledger entry.
--
-- SQLite refuses to drop an indexed column, so each index goes first.

-- 1. A pair's per-side stamps: dm_members holds read_at / cleared_at per member.
--    The legacy pair uniqueness goes too: its one reader was the pre-0016
--    worker's ON CONFLICT(a_hash, b_hash), and pair_key's own unique index is
--    the one-room-per-pair rule.
DROP INDEX IF EXISTS dm_threads_ab_idx;
ALTER TABLE dm_threads DROP COLUMN a_read_at;
ALTER TABLE dm_threads DROP COLUMN b_read_at;
ALTER TABLE dm_threads DROP COLUMN a_cleared_at;
ALTER TABLE dm_threads DROP COLUMN b_cleared_at;

-- 2. A pair's per-side reaction and heart: dm_reactions holds one per member.
ALTER TABLE dms DROP COLUMN react_a;
ALTER TABLE dms DROP COLUMN react_b;
ALTER TABLE dms DROP COLUMN liked_a;
ALTER TABLE dms DROP COLUMN liked_b;

-- 3. The message an object belonged to: dm_media_refs names every message that
--    shares it. The index goes now (nothing reads by msg_id); the column next.
DROP INDEX IF EXISTS dm_media_msg_idx;

-- 4. The feed's likes, frozen since 0014 carried each across as a ❤️ reaction.
DROP TABLE IF EXISTS wall_likes;
DROP TABLE IF EXISTS wall_comment_likes;
