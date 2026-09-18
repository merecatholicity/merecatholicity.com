-- Turnstile's record, made real (2026-09-17). `isEstablished` — the rule that
-- spares an identity the challenge (Domain.Turnstile), and the gate on uploads,
-- calls and the first DM — read "has a profiles row, a comment or a wall post".
-- But since 2026-09-16 a profiles row is what ANY keyed read leaves behind
-- (registerMember), so a fresh key became "established" by reading the board
-- once, and the challenge asked nothing of anyone: 54 rows stood where 8
-- identities had ever posted or saved a profile.
--
-- `verified_at` is the record the rule always meant: the second an identity
-- passed a Cloudflare challenge (verifyTurnstile stamps it on siteverify's yes).
-- NULL = never passed one.
ALTER TABLE profiles ADD COLUMN verified_at INTEGER;

-- The backfill keeps every existing member exempt: a challenge stands behind
-- each of these acts already (a post, a feed post, a DM send and the profile
-- save are all Turnstile-gated), so nobody who has ever written here is asked
-- again. A bare row — "has read something" — is deliberately NOT covered, nor
-- is a published DM key (the client publishes one on every hop).
UPDATE profiles SET verified_at = created_at
WHERE verified_at IS NULL AND (
  nick IS NOT NULL OR bio IS NOT NULL OR signature IS NOT NULL
  OR avatar IS NOT NULL OR handle IS NOT NULL OR links IS NOT NULL
  OR EXISTS (SELECT 1 FROM comments   c WHERE c.author_hash = profiles.hash)
  OR EXISTS (SELECT 1 FROM wall_posts w WHERE w.author_hash = profiles.hash)
  OR EXISTS (SELECT 1 FROM dms        m WHERE m.sender_hash = profiles.hash)
);

-- The headless kit's own identities (webtest/.testkeys), whose hashes are the
-- public HIDDEN_HASHES var: no browser driven by a script can solve a
-- challenge, so the write suites would stop dead. Stamping them is a fact
-- about them, not a rule — nothing in the worker reads a list of hashes to
-- decide this, and each still needs its KEY, which lives only on the owner's
-- box. Rotating a test key means stamping the new hash (webtest/POLICY.md).
UPDATE profiles SET verified_at = created_at
WHERE verified_at IS NULL AND hash IN (
  '2a2f97abc4dd1649ef31bb815f6181dcee63b76963cb73cd8fe15b77bf53a681',
  '431230bb0b4e1fab7e2299b612b21bbcc7cf54016b56389d9ac30d1ef70dabf8',
  'ff116db3c9e37db220330232046fddff87119e0339d668469ee911597536ddb0'
);
