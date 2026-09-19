# CLAUDE.md

Guidance for agents working in this repository: the website **merecatholicity.com**, its
Cloudflare backend, and the build/deploy system. This file is the **rulebook and the map**, kept
short on purpose (`tests/py/test_claude_md.py` holds it to 280 lines and every bullet to six). The
long-form reference — every design decision and postmortem since July 2026 — is the dated log
under **`docs/architecture/log/`**, indexed by `docs/architecture/INFRASTRUCTURE.md`: before
changing a subsystem, read its passage. The other documents: `docs/architecture/CICD.md` (**how
work ships** — read before deploying, changing infra or touching a secret),
`docs/architecture/CODEBASE.md` (the code map and reading order), `README.md` (the operating
manual: prerequisites, targets, recipes), `comments-worker/API.md` (the wire contract), `librarian/README.md`,
`tests/README.md`, `terraform/README.md`. If `CONTEXT_DUMP.txt` is present in the root and you
work on text content, ingest it first.

**Keep the documents current in the same change**: this file for rules; the log for the why (a
dated passage with a bold lead-in appended to `docs/architecture/log/<this month>.md`, then
`scripts/infra_index.py --write`); CICD.md when a workflow, secret or make target it names
changes; CODEBASE.md when module structure changes; README when the human story changes.

## Standing authorization, and the only road

The owner has granted standing permission to ship — commit, push, deploy, apply migrations,
purge — as often as the work needs, **without asking each time**. Do not end a turn asking
"want me to push/deploy?". Two exceptions: commit attribution follows the harness's
instruction only; give a heads-up before destructive or irreversible acts beyond a normal
deploy (dropping a database, force-pushing history, deleting a bucket, revoking a credential).

**Two agents never share a checkout** (2026-09-16). The second works in its own worktree —
`scripts/agent_worktree.sh <name>` makes `local/wt/<name>` on `origin/main` (git-ignored,
`node_modules` shared, its own `purescript/output`) — commits and pushes FROM it, and the
shared checkout is only ever fast-forwarded. A migration ships in the same commit as the
worker that reads it; otherwise it goes on a branch.

**Since 2026-09-09 the push IS the deploy for everything.** The rules (procedure in CICD.md):

1. `main` is production. A branch or pull request gets the gates without the deploy.
2. Before any commit: `make tests` must pass; `make jscheck` after any worker/client JS/TS edit.
3. **CI is the build of record** — the site artifact, the worker bundle and the PDFs in R2 are
   what the runner built. Local builds preview and run gates; their bytes do not ship. A local
   PDF that reads "rebuilt but unpublished" is the dev box differing from CI, not a reason to upload.
   The restored site cache supplies ONLY build output: right after the restore the workflow
   re-asserts every tracked file under `docs/` from the commit and fails if one still differs
   (the cache once shipped the previous commit's hand files — 2026-09-09).
4. **No secret is ever present on a `pull_request` event**, in any workflow.
5. **Infrastructure is declared, never clicked.** Cloudflare and GitHub settings live in
   `terraform/`; a change is a push; the apply waits on the `terraform-production` gate.
   Review the plan summary, then `scripts/ci_approve.sh <run-id> --approve "why"` (a human
   presses *Review deployments*). Anything made by hand gets an `import` block in the same
   change, or a written exception.
6. **Never a destroy or replace from CI** — the plan fails on any delete; only a
   `workflow_dispatch` with `allow_destroy=true` gets past, deliberately.
7. **Workers ship on push** (`workers.yml`: gates → D1 ledger → `wrangler deploy`); so does the
   librarian's shelf (`merecat.yml`; `make librarian` is the hand road). `make worker-deploy` is
   the emergency road; `wrangler secret put` the only home for worker secrets. **Rollback** (`make
   worker-rollback`, then `git revert` + push) and **staged rollout** (`workflow_dispatch`
   `mode=stage|promote`) are CICD §12; `ops-watch.yml` asks the worker daily how it is.
8. **Never hand-edit or commit the generated half of `docs/`**; never bump a `?v=` by hand
   (the build stamps them, preserving mtimes so a stamp never hides a source change from
   make); never fetch a freshly stamped `?v=N` URL mid-deploy — probe a throwaway query
   (`app.js?probe123`) instead. To force a cold site rebuild in CI, bump the cache
   generation (`site-2-`) in both workflows.
9. Every `uses:` is SHA-pinned — the repository requires it, nested references included;
   Dependabot bumps the pins and the npm toolchain by PR; secret scanning and push protection are on.
10. The manual exceptions are enumerated in CICD.md §10. A manual act not on that list is drift.
11. **Verify, don't assume**: `gh run list --limit 6`; `terraform -chdir=terraform plan` → *No
    changes*; `python3 scripts/publish_pdfs.py --check`; `curl -s "…/version.json?probe=$RANDOM"`.

Credentials live in `~/.config/merecatholicity/ci.env` (mode 600, outside the repo) and in the
Actions secrets — never in any committed file. The identity hashes and Turnstile sitekeys in
the repo are public by design.

## Repository layout

The root holds only tool-convention files (`Makefile`, `eslint.config.js`, `package.json` + lock,
`tsconfig.json`, `globals.d.ts`, `.gitignore`, `README.md`, `CLAUDE.md`, `LICENSE*`); a review or a
hand-over note is a dated file under `docs/architecture/reviews/`; `local/` is the box's own and
ignored. **`docs/` is the served site and a MIXTURE**: hand-maintained source is tracked, everything
the build writes is git-ignored and rebuilt, `tests/py/test_docs_sources.py` enforces the split; a
new hand page needs an `!docs/<name>.html` line in `.gitignore` and an entry in `scripts/nav.py`'s
`PAGES`. The directory tour (book, content, resources, partials, scripts, styles, app and client —
four lazy view chunks and three feature ones — `pagejs/` the seven page scripts minified into
`docs/`, the kernel, the two workers, librarian, webtest, tests, terraform, workflows) is
CODEBASE.md's; `librarian/private/` is a separate PRIVATE clone, never a submodule, never committed.

## Build and verify

- **Gates**: `make tests` (the unit suite: PureScript, JS, worker, Python, CSS; runs `psbuild`
  first); `make jscheck` (eslint + tsc + psbuild); `make check` (jscheck + linkcheck);
  `make check-pdfs` (bucket vs manifest vs local PDFs; CI runs it with the site token).
- **Build**: `make css` · `bundle` (purs + esbuild + the version stamp) · `html` (a target per work; an oversized volume becomes an index over its parts) ·
  `pdf` · `migrate` · `serve` (binds 127.0.0.1 only — load-bearing) · the rest: README's target reference.
- Builds are pinned to `SOURCE_DATE_EPOCH=1784160000` and byte-deterministic: a double
  `make bundle` must leave `docs/app.js` unchanged. Toolchain is npm (`npm ci` only, never `sudo`
  or `-g`; esbuild exact-pinned, purs by pinned sha256 — `make toolchain`); this dev box is Ubuntu/WSL2 (Node 24 in `~/.local`, a
  `python` shim — the toolchain memory). Every pandoc call in a resources loop ends `|| exit 1`.

## Laws that break silently

Each has a fuller passage in INFRASTRUCTURE.md — read it before touching the area.

- **Nothing secret leaves the worker** (2026-09-17; `/recent` served the whole env for six weeks): every entry seals the env
  (`egress.ts`: copying, listing or serializing it throws) and every answer and hub frame is scanned for each non-`PUBLIC_VARS` env
  value, refused and told. The workers hold no `any` and the env's type brand is refused as an answer, a row or an event.
  `env_leak.test` sweeps every road as four identities above reach floors; a new route brings its `ROUTE_HINTS` and API.md shape
  in its own commit, is documented by CALLING it, and ships after `/security-review`.
- **A member has TWO identities, not interchangeable** (the P0 chain, 2026-09-18/19). The ACCOUNT hash (`sha256hex(key)`)
  is D1's and the hub's: it authenticates, shards, is the ONLY `user:` scope `sanitizeScopes` takes, and never rides a row.
  The PUBLIC id rides every row, and so does every NAME minted from an id (`publicName`, cloakIds' second pass — a
  pseudonym carries four hex of whatever minted it). The client cannot compute one: `/prefs` `me`, cached by `setMyId`,
  dropped by `setKey`. The BoardHub is the one egress `cloakIds` never sees: `#wireIn`/`#wireOut` translate at its edge.
  Either in the other's job throws NOTHING — it routes into space, in silence. No keyless roster; `weak` cannot write.
- **`?v=` keys are stamped** (`scripts/stamp_versions.py`: nav.js, the pages, `partials/*`,
  content.py; keys are content hashes; runtime keys via `window.mcAsset`); only `sw.js` is unkeyed.
  Cloudflare treats a `?v=N` URL as immutable — a probe mid-deploy freezes old bytes under the new
  key for ever. The deploy job purges `sw.js` + `version.json`; HTML is never edge-cached.
- **Every page's client is a boot the shell drives**; `mcBoot()` (the whole classic client)
  re-runs on every soft navigation, so anything inside it that owns a resource leaks per hop —
  keep page-scoped state above it, and every document/window listener it installs carries the boot
  signal. **A phone's FIRST paint is already the app**: before `body.mc-app` the bars' surfaces hold
  their places, no title or static footer shows (`html.mc-noapp` is the `?app=0` opt-out).
- **Turnstile**: an established identity is not challenged: `profiles.verified_at`, stamped where a challenge was PASSED, never by
  the row a keyed read leaves (`Domain.Turnstile`, `turnstile_skip_established`; `/prefs` answers for this identity); the widget
  runs in `docs/turnstile.html` (own context, `?v=` from `MC_ASSETS`). **Only `loadTurnstile()` mounts, only from a focus or a
  press, never because a view opened, never for a spared identity**; a token is single-use, so `spendToken()` spends it and
  RE-ARMS the widget (one `turnstile.reset(`) — all swept.
- **Limits are per MEMBER plus an address backstop** (`throttle`, the one `.limit(` caller); one
  `READ_LIMIT` for all reads, client-paced — no stray poller. **D1 replicas: `Domain.Consistency`'s list only**.
- **Comments sections are admin-switched and ship CLOSED** (`comments_pages`, `comments_journal`;
  the rules are `Domain.Comments`, whose polarity is the OPPOSITE of the social switch — only a
  literal `'1'` / a listed path opens anything).
- **D1 schema changes are a NEW `comments-worker/migrations/NNNN_*.sql`** (the next number is the
  last file's + 1 — `make migration NAME=<name>`), additive; `schema.sql` is a generated snapshot; the
  librarian D1s are derived data; a renamed applied migration renames its `d1_migrations` row too.
  **Additive is not forever**: a shim lives one deploy and at most 30 days, a column nothing reads for
  30 days is dropped by a `retire` migration (the one non-additive kind: a fresh backup, an owner
  heads-up); `tests/_support/retirements.json` names each with its due date and the test goes red then.
- **Shared constants, tables and validators live in `purescript/src/Domain/*`** and are read
  by both the client (`window.mcCore` / `app/core.ts`) and the worker. Never re-inline a copy.
- **A NEW state store must be added to `runBackup()`'s mirror** or it is not backed up
  (`MEDIA`/`WALLMEDIA` are outside it on purpose; LIBDB is derived). **The backup is daily (03:15
  UTC) and self-checked**: every cron is a `runChain` chain (`ops.ts`) — a failed step never skips
  the next, and each races a deadline so a HUNG one cannot take the heartbeat with it — and the
  findings alert through `sendAlert`: THREE channels, Platform settings → Alerts (email · Discord ·
  a DM to every admin), Health card the truth, `ops-watch.yml` the outside leg.
- **Every road that removes a message takes its media with it** — the object AND its accounting
  row (`purgeMediaKeys` for DMs, `purgeWallMedia` for the feed and board attachments), keys read
  BEFORE the row is dropped or its status flips, never a `media_key = NULL` without the purge;
  the hourly sweeps (expiry, retention, orphans) are backstops, never the road. A new delete or
  expiry path joins `tests/worker/media_hygiene.test.mjs`.
- The Cloudflare `bot_management` API is a **full replace** (Terraform sends the whole object); the
  edge 403s `Python-urllib` and CI runners (Bot Fight Mode) — a browser UA, and headless verification
  against prod runs from the dev box. **Its injections vary per response**: never compare page bytes.
- **Never a long generation inside a stateless invocation's `waitUntil`** — kick it into a
  Durable Object (the `ChatRoom` pattern).
- The back room (`board:adminsonly`) and the social kill switch (`social_enabled`) answer every public
  read as nonexistence — "no such page", never a hint.
- A symptom that moves with the code is the code's fault — stop relocating it (the Turnstile postmortem).
- **A touch on an overlay must never reach the page behind it**: `mc-sheet` contains its own
  overscroll, its scrim is `touch-action:none`, and it locks the document while open
  (`html.mc-sheet-open`, body fixed at the saved offset). A new overlay reuses the sheet or
  the same three layers.
- **A DM message's acts live on ONE surface**, the press-and-hold (right-click, the hover ⌄, or
  the reaction pill on desktop): react · reply · copy · edit · save · delete — never a link row or
  a ⋯ on the bubble.
- **Every unread number is WORDS, from one fragment** (`dmUnreadCount` in the worker's `lib.ts`):
  the inbox row's badge, `/dm/threads`'s `unread_total`, the thread's unread line and the tab bar's
  own `/dm/unread` all sum it — the tab and the rows it opens onto must add up, and both roads feed
  the one `mc-dm-unread` cache. Never re-inline the fragment, never let one road count threads. It
  counts from the viewer's OWN member row (`mb`, the `DM_MINE` join) — never a pair column.
- **One member model** (migration 0016, 2026-09-13): a conversation is a thread with member rows (`dm_members`): a pair is two,
  keyed once by `pair_key`; a group (`kind` 1) up to `Domain.Dm.maxMembers`, nobody owns it — and on EVERY road it is addressed by
  the client's one target (`ctx.target()`): `thread_id`, or `with` for a room its first word has yet to make. Every read runs from
  the viewer's seat: unheld or their own, after their clear stamp, no older than their joining (a newcomer gets no history), and
  in a group never from a sender they blocked (a PAIR keeps its stored shadow-hold; a blocked sender is never told).
- **Envelope v2** (`enc` 3, `E3.`): a random content key per message under `nacl.secretbox`, boxed once per current member (the
  sender included) to their published X25519 key and stored in `dm_keys` — the server serves each reader ONLY their own `sealed`;
  the key set must equal the roster (`Domain.Dm.membersEqual`) or the send is answered `409 roster` and sealed once more; an edit
  re-seals under the SAME key; a pair's `E1` words stay readable for ever (and are accepted on the wire one deploy longer).
- **An object dies with its LAST reference** (`dm_media_refs`): a forwarded attachment is never uploaded twice — the copy names
  the same object, allowed only to a member who can read it (the media GET's own rule, `dmMediaReadable`) — so every message road
  calls `releaseMediaRefs`, never `purgeMediaKeys` directly; the 30-day cap and the LRU valve take an object from under EVERY
  message naming it; the orphan sweep takes what nothing names; `dm_media.msg_id` is retired.
- **The bottom bar is SIX EQUAL TABS** — no raised hero (a six-item bar cannot centre one).
  Each is `flex: 1 1 0; min-width: 0` with a nowrap, viewport-scaled label: a tab left at
  the default `min-width: auto` lets its longest word refuse to shrink and eat its
  neighbours' width on a narrow phone. A tab carrying a badge says the count in its
  `aria-label` (`badgeLabel`) — a red disc reads as nothing.
- **ONE press-and-hold surface, ONE reaction grammar, ONE bell** (2026-09-12). The surface is
  `client/surface.ts` (`openActs` the overlay — bar · lit hole · acts — `armHold` the gestures);
  the DM, every board post (topic head, reply, article-page comment) and every feed post and
  comment open THAT one — a post through `postMenu` (the ⋯, and the hold it arms on `opts.hold`),
  never a menu of its own.
- **DMs are never AI-screened** — text, edits, media, system notices: none. A message is E2E
  ciphertext (the server could not read it) and privacy is the point; Turnstile on the send
  stays (a bot gate, not a reader). `tests/worker/dm_privacy.test.mjs` sweeps every DM
  handler for a screen call — a new DM road must pass it.
- **The keyboard shackle**: a field the reader types into is ALWAYS wholly visible, directly above
  the soft keyboard.
- **A call rings the phone, and only a missed call is a notification** (2026-09-12). The offer is
  STORED for the ring (`calls_pending`, 0015); a callee without a live socket is rung by a push
  whose URL carries the call's id, and the engine (`app/call.ts` `wake`) fetches the offer and
  rings an answerable panel — as far as a web app on a phone can go (no CallKit for the web; the
  notification is the swipe). A late answer re-sends the caller's ICE. The ring is 45 s.
- **Haptics are the shell's one engine** (`app/haptic.ts`, `window.mcHaptic`): a hold, a pick,
  an armed swipe or pull, the ring's pattern — the Vibration API where it exists (Android);
  iOS has none and no road around it; never before the first real tap, never elsewhere by
  hand. Tastefully: small numbers, no buzz on a send or a release.
- **Badges are the shell's, reading marks read, a count paints only while FRESH** (`Domain.Cache.badgeShows`:
  past its TTL it is last visit's number — the bar shows none, `app/badges.ts` asks at once). Both refresh on
  every page the socket reaches (a `dm` frame not for the thread shown, a `notification` unless its list is
  open, a stale cache on reconnect) — never in a boot, never a poller, never re-stamped.
- **Phones show no footer except on the home tab** (`body.mc-app:not([data-mc-tab="home"])
  mc-footer`; the shell stamps `data-mc-tab` on every navigation); the footer's information lives
  in Settings → About, a themed dialog (`mcDialog`: the overlay's three layers, Escape taken on
  the window so the sheet under it stays). `FOOTER_LINKS` is the one list — a new footer door goes
  there. Desktop keeps its footers. A chat screen scrolls to ITS foot (`endGap`), never the
  document's.
- **Presence is the hub's word alone, and the hub is SHARDED** (`Domain.Hub`, 2026-09-17): online is a live socket under mode
  "auto" (`Domain.Presence.isVisible`); `profiles.last_seen_at` is the BoardHub's alone (the last disconnect under "auto" stamps,
  an "off" auth clears; the mode rides the auth frame, never a column — served as-is, which IS the privacy rule). `HUB_SHARDS`
  instances, a member's every socket on the shard their hash names (`?h=`), reached only via `lib.ts` `hub*`.
- **The fixed chrome answers the finger, not the platform's click** (2026-09-13): a phone
  synthesizes the click after the finger lifts and withholds it at will (iOS: a tap that stops a
  decelerating page; a tap whose hover it judges to have changed content — live: Inbox pressed,
  the tab tinted, the page never moved, a second press worked).
- **Nothing scrolls sideways on a phone**: `body{overflow-x:clip}` is the net, not the fix. A
  new surface must fit 390px — a flex row wraps or its items may shrink, an edge-to-edge
  pull uses `var(--page-pad)`, and a JS-injected style block must agree with the
  stylesheet (it is injected later and wins). Sweep with `webtest/test_hscroll.py`.

## Architecture in brief

The PureScript kernel (`Domain.*`: ADTs, smart constructors, illegal states unrepresentable, pure) →
**`app/core.ts`, the one audited membrane where types are erased** → the Lit views (`app/views/*`,
presentational) and the classic client (`client/*.ts`: the write paths, the DM thread, merecat).
The worker imports the same compiled kernel. **New application logic goes in PureScript**; JS is
interop only (DOM, fetch, crypto, storage, Turnstile, WebSocket). Realtime: the `BoardHub` and
`ChatRoom` Durable Objects. The full map, the four gates a slice ships through (byte-deterministic
rebuild · parity · lint · headless render parity against `make serve`), the reading order: CODEBASE.md.

## Testing policy

Tests clarify what the code does and guard the rules that break silently — no coverage target, no
tests for trivial getters. Layer 1 `tests/` is hermetic (`make tests`, the standing gate; one file
per concern; a worker road is RUN against a real SQLite through `tests/_support/worker.mjs` — lock
source text only for a law that is textual). Layer 2 `webtest/` is headless Chromium against prod
(`audit.py`, the per-slice `test_*.py`; the nightly runs the read-only ones). A new or changed rule
brings its test in the same change; never delete a test to go green.

## Infrastructure at a glance

- **Hosting**: GitHub Pages serves the artifact `build.yml` deploys (`docs/` packaged; CNAME +
  .nojekyll asserted); Cloudflare fronts it — `ssl = full` (not strict: the origin is Pages),
  `browser_cache_ttl = 0` (what makes `?v=` work), the CSP ruleset, bot management — all Terraform.
  **The meter is the build's**: the beacon rides `nav.js`, never automation; `auto_install` stays FALSE, or every view counts twice.
- **PDFs**: the 244 published PDFs live in R2 `merecatholicity-files` at `files.merecatholicity.com`;
  `docs/pdfs.txt` is the manifest; `scripts/publish_pdfs.py` publishes and verifies.
- **Workers**: `comments-worker` (`/api/comments*`, `/api/merecat*`, `/@*`; D1 + three librarian
  rooms; R2 avatars/backups/dm-media/wall-media; Vectorize; Workers AI; two Durable Objects; four
  crons) and `contact-worker` (`contact-api.merecatholicity.com`). `wrangler.jsonc` is the truth.
- **merecat**, the librarian: a `ChatRoom` DO state machine, five-legged retrieval over three D1
  rooms + Vectorize, `librarian/` its mind, Workers AI its only backend, dials `Domain.Merecat`.
  **Band weighting and persona are the owner's standing law — read the merecat passage first.** The
  AI guard (`quota.ts`) stands OPEN when unread; the ingest takes a SLICE of D1's day, never the day.
- **Terraform** owns the zone settings, DNS, the five rulesets, bot management, the R2 buckets, the
  D1 records, the Turnstile widgets, both GitHub repos, Pages, the environments, the Actions policy
  and variables; state is in R2 (`merecatholicity-tfstate`, unmanaged, SECRET). It cannot hold
  Vectorize, the R2 custom domains, the TURN key, or Email Routing. wrangler owns what a deploy rewrites.
- **Credentials**: ONE Cloudflare account token, `CLOUDFLARE_ROOT_TOKEN`, and one GitHub PAT (CICD §4); the
  state backend's R2 pair DERIVES from the token (key = its id, secret = its SHA-256) and is never stored; every
  secret is blanked on a `pull_request`, swept. The pipeline holds none — OIDC (`oidc.ts`), merecat's dials from the reviewed `librarian-config` job. **History** rewritten 2026-09-09 — re-clone.

## The long-form reference

`docs/architecture/INFRASTRUCTURE.md`: the standing rules and, generated at its end, the index of
every passage by section (`scripts/infra_index.py --write`; the test keeps it current). The
passages live in `docs/architecture/log/YYYY-MM.md`, a bullet each with a **bold lead-in** and a
date — append yours to the current month under its `## section`, wrapped at 100 columns
(`scripts/infra_index.py --wrap <file>`), then regenerate the index.
