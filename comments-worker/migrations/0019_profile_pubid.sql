-- The public id, split from the secret's shadow (the 2026-09-17 review's P0,
-- layer three, 2026-09-18). Until now a member's PUBLIC identifier — on every
-- comment, feed post, profile URL and avatar — was `SHA-256(key)`, the very
-- digest the server stores to verify the key. One unsalted round, so a leaked
-- public id was a leaked account a wordlist away (layers one and two keyed the
-- roster and floored weak keys; this removes the exposure itself).
--
-- `pubid = SHA-256(PUBLIC_ID_PEPPER || hash)` — the pepper is a wrangler secret,
-- so inverting a pubid needs a secret the edge never serves. Same 64-hex shape
-- as a hash, so every client-side `[0-9a-f]{64}` check still matches and the
-- client keeps treating a member id opaquely. The account `hash` stays the
-- primary key here and NEVER leaves the worker; `pubid` is what crosses the wire.
--
-- Filled lazily by the worker (serveId): a SHA over the pepper cannot be done in
-- SQL, and the first time a member is served their pubid is computed and stored,
-- so the reverse map (resolveId, pubid -> hash) is filled for exactly the ids a
-- client could ever send back. A daily step backfills any gaps. UNIQUE so the
-- reverse lookup is one indexed row.
ALTER TABLE profiles ADD COLUMN pubid TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS profiles_pubid_idx ON profiles(pubid);
