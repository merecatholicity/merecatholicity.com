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

**Why it is not yet deployed:** the account's D1 free-tier daily row-write limit (100k) was exhausted
on 2026-09-18 by a full merecat re-ingest (~109k actual writes, 99% the librarian's), so migration
`0019_profile_pubid.sql` could not apply and the Workers deploy failed at the migration step —
safely (neither migration nor worker landed; the pre-L3 worker still runs). Resets at 00:00 UTC.

## The activation runbook (do this, in order, after 00:00 UTC)

**Deploy MUST be the first D1 write of the day.** f5 has agreed to hold `merecat.yml` until this
lands (the ingest is tens of thousands of rows; the migration is one statement). Confirm with them
before starting.

1. **Deploy the inert code first.** Re-run the failed Workers job (or push a no-op) so `0019` applies
   and the valve-mode worker deploys. Verify it is healthy and UNCHANGED: `/api/comments/board`
   still serves raw `author_hash` (no pepper yet), DMs work, `/prefs` now carries `me` equal to the
   account hash. `curl` a board read and confirm no behaviour changed.
2. **Generate a STABLE pepper and set it.** `openssl rand -hex 32`. It is stable FOREVER — changing
   it reshuffles every member's pubid and displayed name. `cd comments-worker && npx wrangler secret
   put PUBLIC_ID_PEPPER` (workers token). This is the irreversible flip; it is reversible only by
   UNSETTING the secret (which returns to raw hashes).
3. **Back-fill the reverse map.** `serveId` fills `profiles.pubid` lazily on first serve, but run
   `backfillPubids` once so `resolveId` is complete from the first request (an old `?u=<hash>` link,
   a client mid-session). It is a daily-chain step; trigger it via a `workflow_dispatch` of the ops
   cron, or call it from a one-shot. Bounded by the member count (~dozens), well under budget.
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
