-- Per-message DM likes: one flag per side of the canonical pair (a = lower
-- hash, b = higher — the dm_threads ordering). Metadata only, like opened_at:
-- the server never sees message plaintext. Dies with the row; no new sweeps.
ALTER TABLE dms ADD COLUMN liked_a INTEGER;
ALTER TABLE dms ADD COLUMN liked_b INTEGER;
