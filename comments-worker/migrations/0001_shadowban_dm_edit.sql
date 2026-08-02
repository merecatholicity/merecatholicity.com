-- 0001_shadowban_dm_edit — two moderation/UX additions.
--
-- 1) shadowbans: an admin "global mute" on an identity. A shadowbanned author
--    keeps posting normally (their posts store status='live', their submits
--    succeed) but their public content — forum topics/replies, page comments,
--    and wall posts/comments — is excluded from every OTHER reader's view, never
--    broadcast live, never notifies anyone, never reaches Discord or @merecat.
--    It is NOT a blockedReason (they are not logged out or refused), so they are
--    not really aware of it. Reversible: DELETE the row to un-mute. Separate from
--    `locks` (a visible account disable) and `dm_blocks` (a per-user DM hold).
CREATE TABLE IF NOT EXISTS shadowbans (
  hash       TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  added_by   TEXT
);

-- 2) DM per-message edit + delete(redact). DMs are end-to-end encrypted, so the
--    server stays blind: an EDIT simply replaces the opaque ciphertext body and
--    stamps edited_at (the client shows an "(edited)" marker). A DELETE is a
--    REDACT, not a hard delete: the body/media are cleared, redacted is set to 1,
--    and the row is KEPT with its original expires_at — so a "<redacted>" note
--    stands where the message was until the moment it would have expired anyway,
--    then the ordinary disappearing-message sweep removes it.
ALTER TABLE dms ADD COLUMN edited_at INTEGER;
ALTER TABLE dms ADD COLUMN redacted INTEGER;
