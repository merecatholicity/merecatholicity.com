-- The pending-call store (2026-09-12): a call's offer, kept for the ring so a
-- callee whose app was closed can still answer it — the push that rang their
-- phone opens the app with the call's id, the app asks for the offer, rings,
-- and answers; before this the offer lived only on the live socket, and a
-- callee without one could only ever be told of a missed call. One row per
-- call (the caller mints the id): who called whom, the SDP offer (≤32 KB,
-- transient — a call is answered or missed within the minute), when; stamped
-- answered_at by /call/answer and missed_at by the miss (the caller's
-- /call/end on no answer, or the hourly sweep's backstop), which is what
-- makes recording a miss idempotent. Rows go a day later. Not a call log:
-- the missed call's record is the thread's own line and the bell.
CREATE TABLE IF NOT EXISTS calls_pending (
  call        TEXT PRIMARY KEY,
  from_hash   TEXT NOT NULL,
  to_hash     TEXT NOT NULL,
  sdp         TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  answered_at INTEGER,
  missed_at   INTEGER
);
CREATE INDEX IF NOT EXISTS calls_pending_to_idx ON calls_pending(to_hash, created_at);
