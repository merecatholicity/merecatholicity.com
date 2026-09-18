# webtest — test policy

## Interactive features get interactive tests (standing policy)

**Every interactive or real-time feature ships with an interactive cloakbrowser
test.** If a change lets one user's action affect another user's screen — a post
that fans out, a reply that lands in an open thread, a DM, a notification, a
badge, a live count, a moderation event, a "someone is typing" — it MUST come
with a two-user scenario in `webtest/test_interactive.py` (or a sibling), driven
through `webtest/live_kit.py`, run against the LIVE site, asserting **both** the
WebSocket frame (the `mc-live` seam) **and** the DOM merge, with a clean
console + network (the DevTools gate).

Why: `curl` and single-page fixture renders (the older `webtest/test_*.py`)
cannot prove real-time delivery, recipient correctness, or cross-context updates.
Only two live browsers observing one write can. This is the regression net for
the whole community platform.

## The harness — `webtest/live_kit.py`

- `LiveUser(name, key, port)` — a logged-in cloakbrowser user (identity via
  `localStorage['mc-comment-key']`) with the `mc-live` event collector armed and
  the console/network capture on. Extends `webtest/flows.py`'s `Flow`.
- `Party(*users)` — N concurrent live users (each its own port + profile).
- `user.nav(view)` — hard-navigate to `community.html?<view>` and re-arm the
  collector; `clear_live()` / `drain()` reset the observation baseline.
- `user.wait_live(pred)` / `saw_live(pred)` — assert a WebSocket frame arrived
  (`{'t': 'new-topic'|'new-reply'|'topic-stats'|'notification'|'dm'|'dm-ttl'|…}`).
- `user.socket_open()` — the board WebSocket is genuinely OPEN.
- `user.devtools_findings()` — console SEVERE (minus the benign allowlist),
  same-origin ≥400 (429 on `/api/` exempt), duplicate asset loads, unexpected
  Document requests. `user.waterfall()` prints the network trace.
- Write triggers (server API): `write_post`, `write_dm`, `watch`,
  `notif_unread`, `dm_unread`, `delete_comment` — auto-retry on the per-IP rate
  limits, and clean up created rows.

## The write path — Turnstile

Every write (post / reply / topic / DM / profile / avatar) is Turnstile-gated
with a **real production managed sitekey**; cloakbrowser cannot obtain a token
(headless or headful — proven 2026-07-31, see `probe_turnstile.py`). So the kit
writes through the **server API as the two ESTABLISHED test identities, sending
no token at all**: the worker spares an established identity that offers none
(`Domain.Turnstile`, the `turnstile_skip_established` Platform setting, on by
default), and every other gate — rate limits, the AI screen, IP/identity
blocks — still applies. With the skip switched off, a write is refused and the
kit reports `BLOCKED` (observation still runs) rather than falsely passing.

Until 2026-09-17 the kit sent a secret-gated `TEST:` token that the worker
accepted for the identities in a `TEST_HASHES` secret. The env disclosure
published that secret; since the skip already covered the kit, the branch, both
secrets and the kit's `MC_TEST_TOKEN` were retired rather than rotated. A `TEST:`
token is now a token like any other — refused by siteverify.

**What makes the kit's identities established** (2026-09-17): `profiles.verified_at`,
the stamp a passed challenge leaves. It used to be any `profiles` row — which a
keyed READ leaves behind, so any key was established by reading and the challenge
asked nobody anything; migration 0018 replaced the rule with the stamp and wrote
one for every identity that had ever posted, plus the three `HIDDEN_HASHES`
identities by hash, because no scripted browser can earn one. **Rotating a test
key therefore needs its new hash stamped** — an admin road, or a row of SQL
(`UPDATE profiles SET verified_at = created_at WHERE hash = '<new>'`) — or every
write suite will report `BLOCKED`.

## Secrets

`webtest/.testkeys` (git-ignored, never committed) holds the two identity keys
(`alice`, `bob`). Their hashes are in the public `HIDDEN_HASHES` var, so the
member directory never lists them. Blast radius of a leak is the two
disposable accounts (deletable / bannable like any member).

## Running

```sh
python3 webtest/probe_turnstile.py     # write-path health precheck (fast)
python3 webtest/test_interactive.py    # the 2-user live regression suite
```

Both drive `https://merecatholicity.com` (override with `MC_BASE`). The suite is
paced for the per-IP rate limits, so a full run takes a few minutes.
