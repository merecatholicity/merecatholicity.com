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
writes through the **server API with a secret-gated test token**, gated to the
two throwaway test identities:

- **Worker:** `verifyTurnstile()` skips Turnstile when
  `token === 'TEST:' + env.MC_TEST_BYPASS` **and** the author's hash is in
  `env.TEST_HASHES` (both are `wrangler secret`s). The branch is dead code unless
  both secrets are set. Everything else — rate-limit, AI screen, IP/identity
  blocks — still applies. Only the two disposable test accounts can use it.
- **Kit:** set `MC_TEST_TOKEN='TEST:<the MC_TEST_BYPASS value>'` in the
  environment or in `webtest/.testkeys`. With no token, write scenarios report
  `BLOCKED` (observation still runs) rather than falsely passing.

## Secrets

`webtest/.testkeys` (git-ignored, never committed) holds the two identity keys
and `MC_TEST_TOKEN`. To rotate: `wrangler secret put MC_TEST_BYPASS` (in
`comments-worker/`) and update `.testkeys`. Blast radius of a leak is the two
disposable accounts (deletable / bannable like any member).

## Running

```sh
python3 webtest/probe_turnstile.py     # write-path health precheck (fast)
python3 webtest/test_interactive.py    # the 2-user live regression suite
```

Both drive `https://merecatholicity.com` (override with `MC_BASE`). The suite is
paced for the per-IP rate limits, so a full run takes a few minutes.
