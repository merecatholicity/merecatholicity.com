-- retire_legacy_writes (2026-10-19). The second half of 0019: the three
-- legacy columns that 0019 stopped writing but could not drop, because the
-- worker it replaced still wrote them while the ledger ran ahead of `wrangler
-- deploy`. 0019's worker is the one deployed now and names none of them
-- (tests/worker/migration_0019.test.ts), so nothing serving reads or writes
-- what goes here, before this deploy or after it. The owner chose to drop them
-- (the 2026-10-15 nightly thread).
--
-- Nothing is lost: a pair's two hashes are its pair_key ('a|b', backfilled by
-- 0016 and written on every first word since), and every media object's
-- message is a dm_media_refs row (0016 copied each msg_id there). The indexes
-- on all three went in 0019.

-- 1. A pair's two sides: dm_members holds the members, pair_key the pair.
ALTER TABLE dm_threads DROP COLUMN a_hash;
ALTER TABLE dm_threads DROP COLUMN b_hash;

-- 2. An object's messages: dm_media_refs names every message an object
--    serves (forwards included); the object dies with its last reference.
ALTER TABLE dm_media DROP COLUMN msg_id;
