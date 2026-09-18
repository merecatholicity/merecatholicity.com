# Activating the public id (P0 layer three), and the rotation road that follows

A hand-over note (CLAUDE.md's "a review or a hand-over note is a dated file under
`docs/architecture/reviews/`"). The pubid flip is CODE-COMPLETE and shipped INERT behind a valve;
this is how it is turned on, and why key rotation is left for a focused follow-up.

## Where it stands (2026-09-18)

Three commits landed the P0 chain's layer three, all inert until `PUBLIC_ID_PEPPER` is set:

- `f198fe0` — the EGRESS half. `serveId`/`cloakIds` replace every account hash on the wire (and in
  every hub frame) with `pubid = SHA-256(PEPPER‖hash)`. `tests/worker/hash_leak.test.mjs` proves it.
- `76d235b` — the INGRESS half + the client. `resolveId` inverts a pubid at every member-id
  ingress; `state.myHash` is sourced from `/prefs`'s `me`. `tests/worker/pubid_roundtrip.test.mjs`
  proves a pubid sent back finds the right member, DM crypto included.

**The valve:** with no `PUBLIC_ID_PEPPER` set, `serveId`/`resolveId`/`cloakIds` return the raw hash
and the worker behaves EXACTLY as before. The whole suite is green with the pepper unset. So the
code deploys safe and does nothing until the secret is set — and unsetting it rolls straight back.

**No migration, no D1 write — the flip runs on reads (revised 2026-09-18).** The first cut stored
`pubid` in a `profiles` column filled by a migration + a backfill; the account's D1 free-tier daily
WRITE cap (100k) was exhausted by a full merecat re-ingest, so that migration could not apply. So
the design was changed to need NO write: `pubid = SHA-256(PEPPER‖hash)` is deterministic, `serveId`
just computes it, and `resolveId` rebuilds the reverse map from READS of the identity columns
(reads have a separate, unexhausted 5M/day budget). Migration `0019` was removed. The worker now
deploys with the write budget spent — nothing about activation writes to D1. (Site WRITES — posting,
DMs — remain capped account-wide until 00:00 UTC regardless; that is the ingest's doing, not the
flip's, and unrelated to it.)

## The activation runbook (do this, in order)

1. **Deploy the inert code.** A push deploys it — there is no pending migration, so the Workers job's
   D1 ledger step is a no-op and `wrangler deploy` runs even with the write budget spent. Verify the
   worker is healthy and UNCHANGED: `/api/comments/board` still serves raw `author_hash` (no pepper
   yet), DMs work, `/prefs` now carries `me` equal to the account hash. `curl` a board read and
   confirm no behaviour changed.
2. **Generate a STABLE pepper and set it — THE OWNER'S ACT, not an agent's.** `openssl rand -hex
   32`. It is stable FOREVER — changing it reshuffles every member's pubid and displayed name. `cd
   comments-worker && npx wrangler secret put PUBLIC_ID_PEPPER` (workers token). This is a Cloudflare
   secret write, NOT a D1 write, so the budget does not touch it. This is the irreversible flip.
   "Reversible by unsetting" is only half true: unsetting returns future reads to raw hashes, but
   anything that read a member's pubid while it was set has already read it, and a member's displayed
   pseudonym changed the moment it went live. Setting a secret that changes what the site PUBLISHES
   ABOUT ITS MEMBERS is a decision for the owner, made deliberately (f5 drew this line and it is the
   right one). An agent may deploy + verify the inert worker; a human owner (or an agent with the
   owner's EXPLICIT consent for this act) sets the pepper.
3. **No backfill.** `resolveId` builds its reverse map from reads on the first request, so it is
   complete at once — there is nothing to fill and no write to make.
4. **Verify the flip.** Anonymous `curl` a board read → `author_hash` is now a pubid, and NONE of the
   known account hashes appear. Sign in on a phone: your posts still read as yours (state.myHash =
   your pubid from `/prefs`), a DM sends and opens, presence and the tab badges still work. Every
   nickless member's displayed pseudonym has changed once, permanently — this is expected and
   unavoidable (the pseudonym derives from the id, which is now the pubid).
5. **If anything is wrong, unset the secret** — `wrangler secret delete PUBLIC_ID_PEPPER` — and the
   worker returns to raw hashes at once. Then diagnose from the valve.

After a clean deploy, retire the `resolveId` tolerance (`OR hash = ?1`) on its due date
(`tests/_support/retirements.json`, 2026-10-18) once old `?u=<hash>` links have aged out.

## Key rotation — the road, and why it is deferred

The owner asked for rotation alongside the flip. It is deliberately NOT built here, for reasons the
2026-09-17 audit made concrete: `scripts/key_audit.py` found **0 of 15** member keys guessable, so
nobody needs rotating today, and the weak-key floor's 2026-10-18 tolerance risks locking nobody out
(if it comes due with no rotation road, move its ledger date — the entry says so). Rotation is a
separate, higher-risk feature that deserves its own focused change:

- **The server** (`POST /api/comments/profile/rekey`): prove the old key, present a new generated
  one, and move `profiles.hash` + EVERY foreign key (comments.author_hash, wall_posts.author_hash,
  dms.sender_hash, dm_members.hash, dm_keys.hash, dm_pubkeys.hash, dm_blocks, admins, locks,
  identity_ips, notifications.actor_hash, reactions.author_hash, calls_pending.from/to_hash, …) in
  ONE D1 batch. This is bounded and hermetically testable.
- **The pubid changes.** With the deterministic `pubid = SHA-256(PEPPER‖hash)`, a new hash yields a
  new pubid and a new displayed pseudonym. That is acceptable — arguably right — for a DELIBERATE
  security rotation: your content follows you (the FK move), but the identity a leaked key was
  attached to is genuinely retired. A design that keeps the pubid stable across rotation would need
  an INDEPENDENT stored pubid (random, not derived), which is a larger change; do that only if
  "keep my public name across a rotation" is judged a requirement.
- **The hard part is the client re-seal.** The X25519 keypair derives from the KEY, so after a
  rotation the member cannot decrypt any `dm_keys` envelope sealed to their old public key. The
  client MUST, before the swap: fetch every one of its sealed envelopes, unseal each with the OLD
  key, re-seal to the NEW key's public half, and upload them — then the server swaps atomically. Get
  this wrong and the member loses their entire message history. This is why rotation is its own
  change with its own test surface, not a rider on the flip.
