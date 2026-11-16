-- 0021: read the DM bells from before 0016 (2026-11-16).
-- Since 0016 every DM bell (a message, a reaction, a missed call) names its
-- conversation in topic_id. A bell from before carries 0 and was matched by its
-- sender, a legacy clause the retirement ledger set for 2026-11-16. Two such
-- bells still stood unread in October. Reading them here lets the clause go:
-- after this, opening a conversation reads its bells by the thread alone.
UPDATE notifications SET read_at = CAST(strftime('%s', 'now') AS INTEGER)
 WHERE kind IN ('dm', 'dm-react', 'call') AND topic_id = 0 AND read_at IS NULL;
