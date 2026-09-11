-- Per-message DM reactions (2026-09-10): one emoji per side of the canonical
-- pair (a = lower hash, b = higher — the dm_threads ordering), the WhatsApp
-- press-and-hold picker in place of the 2026-08-03 heart. Metadata only, like
-- opened_at and liked_a/liked_b before it: the server never sees the message
-- plaintext, and the value is validated by the kernel (Domain.Dm.normalizeReaction
-- — exactly one emoji, or one of our own custom-pack :tokens:). Every old like
-- is carried forward as the ❤️ reaction (the same bytes as the quick bar's heart,
-- U+2764 U+FE0F); liked_a/liked_b are then left behind unread — the ledger is
-- additive and a column is never dropped. Dies with the row; no new sweeps.
ALTER TABLE dms ADD COLUMN react_a TEXT;
ALTER TABLE dms ADD COLUMN react_b TEXT;
UPDATE dms SET react_a = '❤️' WHERE COALESCE(liked_a, 0) = 1;
UPDATE dms SET react_b = '❤️' WHERE COALESCE(liked_b, 0) = 1;
