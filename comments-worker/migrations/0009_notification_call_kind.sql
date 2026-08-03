-- Add 'call' to the notifications kind CHECK (the missed-call bell: someone
-- rang while the member was away — inserted coalesced by notifyCall, marked
-- read by the answer handler). SQLite cannot ALTER a CHECK, so this is the
-- table-swap idiom 'dm' and 'merecat' used, all rows preserved.
CREATE TABLE notifications_new (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  recipient_hash TEXT NOT NULL,
  kind           TEXT NOT NULL CHECK (kind IN ('reply','mention','dm','wall','wall-like','merecat','call')),
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
