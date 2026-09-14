-- The call log (2026-09-13): a call's outcome is recorded ONCE into the
-- conversation as a muted event line — missed, declined, or answered with its
-- length — the way every major chat app does it. `ended_at` is the lock: the
-- first report of an end (from either party, or the hourly sweep's backstop)
-- stamps it and writes the line; every later report changes nothing.
-- `outcome` names what was recorded ('missed' | 'declined' | 'answered' |
-- 'failed'); an answered call's length is ended_at - answered_at. missed_at
-- stays what it was (the miss's own stamp, and the pre-0017 rows' lock).
ALTER TABLE calls_pending ADD COLUMN ended_at INTEGER;
ALTER TABLE calls_pending ADD COLUMN outcome TEXT;
