# The codebase, mapped — modularity analysis & the human's reading order

*A newcomer's first document. It answers six questions honestly, with measured
numbers, and lays out where every piece of logic lives (and is moving). If you
read one file before touching the code, read this one, then `CLAUDE.md` (the
rulebook), `docs/architecture/INFRASTRUCTURE.md` (the infra reference) and `README.md` (how
the site is built).*

Status: this is a living document. It was written mid-refactor (the "full TypeScript
+ ORM + MVC" pass). Each metric below is tagged **[now]** (measured against the
current tree) or **[target]** (where the refactor lands). The roadmap section says
which phases have shipped.

---

## The 30-second map

The site is a **static front-end** (`docs/`, served by GitHub Pages) plus **two
Cloudflare Workers** (a comments/forum/DM/bot backend and a contact form). One
idea holds the whole thing together and is the key to reading it:

> **The application's *rules* live in a PureScript kernel. Everything else is a
> thin edge around that kernel.** Rendering is Lit. Effects (DOM, fetch, crypto,
> WebSocket, storage) are typed FFI. The worker and the browser client both
> import the *same* compiled kernel, so a rule is written once and can't drift.

```
            ┌─────────────────────────────────────────────┐
            │  PureScript kernel  purescript/src/Domain/*   │  38 modules
            │  (validation, permissions, parsing, routing,  │  — the rulebook,
            │   ranks, FTS-safety, identity, …) ADTs +      │    pure, tested
            │   smart constructors, illegal states unrep.   │    1:1 in tests/
            └───────────────┬───────────────┬───────────────┘
          compiled ESM      │               │   compiled ESM
                            ▼               ▼
      browser: app/core.ts (membrane,   worker: import the same
      88 exports, erases Maybe/Either)   purescript/output/ directly
                            │               │
              ┌─────────────┴──────┐        └──────► comments-worker/src/*
              ▼                    ▼                  (D1, R2, Durable Objects,
        app/**  (Lit views,   client/*.ts →            Vectorize, Workers AI)
        the bundle app.js)    docs/comments.js (the
                              classic client, same
                              rules via window.mcCore)
```

**`pagejs/` (2026-09-18)** is the third source tree beside `app/` and `client/`:
the seven scripts a page loads directly rather than through a bundle — `nav.js`
(the shell injector and SW update pump), `deeplink.js`, `bible-reader.js`,
`contact.js`, `flash.js`, `away.js`, `index.js`. `npm run build:pagejs` minifies
each into `docs/` under the same name, so `docs/<name>.js` is build output and
`pagejs/<name>.js` is the file to edit. They stay OUT of the bundle on purpose:
a page running a stale `app.js` must still be able to pump its own update.
`docs/sw.js` is the one exception — hand-maintained in `docs/`, never rewritten
by a build, because it is the file that decides whether that update can happen.

The two "how is this one file 6,000 lines?" cases were **`docs/comments.js`**
(the browser client) and **`comments-worker/src/index.js`** (the backend). Both
have been dissolved into feature files — the worker in Phase 4, the client in
Wave F (2026-09-11: `client/comments.ts` is the boot, `client/<feature>.ts` the
modules it installs); the rest of this document explains why they grew, what's
duplicated, and the shape they moved toward.

---

## Census — every hand-written source, by size **[now]**

| File | Lines | Role |
|---|---:|---|
| `client/comments.ts` | 2,049 | The client's ROOT: pre-boot page state, the core helpers (fetch/read pacing, formatting, `el`, Turnstile, identity), the router, `start()`, the `mcKit` assembly; installs the modules below per boot. |
| `client/dm-thread.ts` | 1,307 | The chat screen by thread id (`viewDm`: the header, the ⓘ sheet — members, add, leave, name — the composer, reading back) and the 1v1 call button. Split out of `dm.ts` with the five below on 2026-09-16, every declaration verbatim. |
| `client/dm-message.ts` | 856 | One message: expiry, reactions and the saved mark, the press-and-hold acts and Message info, bubbles and quotes, the reply envelope inside the plaintext, E2E media, render/edit/copy/redact/delete. |
| `client/dm-inbox.ts` | 385 | The unread cache and badge, the live DM frame handlers and their dispatcher, the conversation labels and search box, the inbox door. |
| `client/dm-pickers.ts` | 284 | Forward (the conversations sheet, the re-seal per target) and Members (the directory multi-pick), the avatar cells and collage. |
| `client/dm-crypto.ts` | 244 | The nacl loader, base64url, the identity's X25519 pair, the pair's box (E1) and envelope v2's sealed content key (E3), safety numbers, the E2E badge. |
| `client/dm-styles.ts` | 238 | The DM stylesheet, injected once (it wins over main.css by design). |
| `client/surface.ts` | 621 | The SHARED press-and-hold surface (2026-09-12): the overlay (`openActs`), the gestures (`armHold`), the public reactions' ledger and its pills (`reactPillInto`, which a DM group paints with its own pick), the wire to `/react`. The DM, every board post and every feed post/comment open this one. |
| `client/merecat.ts` | 1,826 | The librarian's chat client. |
| `client/board.ts` | 1,052 | The forum views, the comment renderer, quoting/editing, the board form, the journal, search, the post menu. |
| `client/admin.ts` | 1,526 | The acting consoles. |
| `client/composer.ts` | 1,607 | The markdown editor, emoji, Scripture, drafts, the media gate + compression + voice, mentions, the stash. |
| `client/profile.ts` | 1,368 | Identity, faith, mute/block, prefs, the profile card and editor, avatars, notifications. |
| `client/wall.ts` | 844 | Feed + walls. |
| `client/boot.ts` | 6 | The `Boot` bag type the factories take. (All of `client/` bundles to `docs/comments.js`, 349 KB.) |
| `comments-worker/src/index.ts` | 654 | The composition root: imports · `Env` · `handleConfig`/`handleLive` · the `ROUTES` table · `fetch`/`scheduled`. |
| `comments-worker/src/routes/*.ts` | 5,427 | The handlers, one file per feature (2026-09-16): board 1,402 · dm 1,265 · merecat 730 · wall 540 · admin 483 · profile 430 · media 254 · calls 179 · notify 144 — each moved verbatim from `index.ts` behind the table. Since 2026-09-17 `seo.ts` too: the thread page, the site feed and the thread sitemap, the three roads outside the table (with `/@handle`) that answer a document instead of an envelope. |
| `comments-worker/src/lib.ts` | 3,648 | The shared core: constants, crypto, auth/validation, the settings, DB/notification/broadcast helpers, the DM primitives, the media purges, the social gate and the Discord fan-out. A leaf — it references no handler. |
| `app/appchrome.ts` | 1930 | Desktop+mobile chrome: sidebar, deskbar, home launcher, settings, footer (Lit). |
| `app/shell.ts` | 868 | The SPA shell: soft-navigation (latest-wins, instant nav), per-page boot registry, audio dock, PWA. |
| `pagejs/nav.js` | 830 | Injects the shell + deeplink on every page, and owns the SW update pump, `?debug=1` overlay and crumb ring. Source since 2026-09-18: `npm run build:pagejs` minifies it into `docs/nav.js` (46,058 → 15,392 B; 16.4 → 5.4 KB gzipped, on EVERY page), and `stamp_versions.py` then writes its `?v=` keys and the `MC_ASSETS` map into that output. |
| `comments-worker/src/durable.ts` | 875 | The two Durable Objects (`BoardHub` — `HUB_SHARDS` instances, sockets indexed in memory, `Domain.Hub` the placing, a `watch` table naming the siblings that watch each member — and `ChatRoom`). |
| `comments-worker/src/dbsession.ts` | 88 | The D1 session every routed request runs against: replicas for `Domain.Consistency`'s read routes, the primary for the rest, the `mc-d1` bookmark cookie after a write. |
| `comments-worker/src/egress.ts` | 180 | The egress guard (2026-09-17): `sealEnv` (the env reads by name and refuses to be copied, listed, serialized or written), `deriveEnv`, and `guardResponse` (a textual answer carrying any non-public env value is refused). Dependency-free; contact-worker imports it too. |
| `comments-worker/src/serve.ts` | 64 | `default.fetch`: seal the env, run the router, guard the answer, report what the seal refused. |
| `comments-worker/src/oidc.ts` | 188 | Who is at a pipeline door (2026-09-17): a GitHub Actions job's OIDC token, its RS256 signature checked against GitHub's published keys and its claims against `Domain.Pipeline`; an admin key; for the ops door, the nightly's `OPS_REPORT_KEY`. `pipelineGated` is the three librarian endpoints' preamble. |
| `app/call.ts` | 521 | The 1v1 voice-call engine (shell-owned, so a call rings on any page). |
| `pagejs/bible-reader.js` | 439 | KJV/DR reader boot. Minified into `docs/` with the other six page scripts. |
| `app/views/board.ts` / `topic.ts` | 435 / 433 | Lit views: board index+category / topic+search. |
| `app/richtext.ts` | 432 | The one living body renderer (`window.mcRich`): markdown, scripture autolink, emoji. |
| `comments-worker/src/usagecalc.ts` | 327 | Pure free-tier limit maths for the usage monitor (`usage.ts`, 106, does the fetch through `analytics.ts`, the GraphQL glue; `quota.ts`, 90, is the librarian's AI budget guard over the same neurons select — no lib import, Node-tested with a stubbed fetch). |
| `app/live.ts` | 322 | WebSocket lifecycle (board + merecat chat conns; the `?h=` shard hint). |
| `app/chromebits.ts` | 228 | The two fixed bars (`mc-appbar`, `mc-tabbar`), their icons, tabs and badge readers — the EARLY bundle's module: Lit and nothing else. |
| `app/chrome.ts` / `app/app.ts` | 26 / 5 | The two esbuild entries: the bars (docs/chrome.js, ~22 KB with its chunk, loaded first) and the shell (docs/app.js). |
| `app/core.ts` | 286 | The membrane — the one audited place PureScript types are erased. |
| `app/push.ts` | 166 | Keeps a member's push subscription on the worker's current VAPID key, once per app open (shell) and from Settings; a move a browser will not make without a gesture finishes on the next tap. |
| `app/artwarm.ts` | 142 | The nineteen art pages' background paintings, walked into the browser's cache once the page in hand has loaded and the main thread is idle (2026-09-18) — the six tabs first, one at a time, at `fetchPriority: 'low'`, and only the -m or -d half this viewport will use. The lazy load in `styles/main.css` is untouched and still does the showing; the art switched off, Save-Data or a 2g link downloads nothing. `tests/js/art_warm.test.mjs` sweeps the stylesheet both ways so the two lists cannot drift. |
| `comments-worker/src/{pure,webpush}.js` | 268 / 138 | Extracted pure helpers (tested) / VAPID push crypto. |
| `app/views/{admin,library,member,post,profile}.ts` | 186–321 ea. | One Lit view per feature (`util.ts` 67). |
| `app/{store,ptr,api}.ts` | 218 / 194 / 101 | Request cache + persisted SWR / pull-to-refresh / typed API client. |
| `app/wirecheck.ts` | 49 | The shell's `fetch` wrapper (2026-09-17): an `/api/` answer whose listed field (`Domain.Wire`) is neither a list nor null makes `json()` reject, so a view says "could not be loaded", never "nothing here". |
| `app/transport.ts` | 118 | The read transport, out of the classic boot (P1, 2026-09-18): `fetchRetry` (the bounded network retry with its per-attempt timeout), the fresh-bypass pair `freshOpts`/`stampFresh`, `freshParam`, and the two store-backed reads `cachedJson`/`peekJson`. The Lit views and `app/api.ts` import it; the classic client reaches it at `window.mcTransport` — never by import, because `client/` is a separate esbuild graph and a value import would bundle a SECOND `app/store.ts` (`tests/js/transport.test.mjs` sweeps for both that and a captured `fetch`). |
| `contact-worker/src/index.ts` | 138 | The contact form worker. |
| `comments-worker/src/db.ts` | 83 | The repository layer: typed row mappers, `inList`, the `Query` builder. |
| `docs/{deeplink,sw,away,contact,flash,index}.js` | 8–161 ea. | Small served-raw scripts. |
| `purescript/src/Domain/*.purs` | 38 files | The kernel (see the map); plus the generated `Domain.Writings` (`scripts/writings.py`, git-ignored). |

Re-measured 2026-09-08 over 35 hand-written files, **29,968 lines**: the median is
**286 lines**, and the distribution is still bimodal — a long tail of small,
single-purpose files against a few very large ones. **`client/comments.ts` alone was
38% of all hand-written lines; the top two were 55% and the top three 65%.** That
bimodality *was* the finding: the worker monolith was split (Phase 4), but the
client was not, and it had grown from 8,245 lines to 12,584 as the platform gained
calls, media, feed, DM and readability work.

**Re-measured 2026-09-11, after Wave F**: the client is nine files (the census
above), the largest 2,304 lines; no hand-written file is over 5,100 lines now and
the largest three are the worker's `index.ts`, `lib.ts` and the DM module. The
split was mechanical — every statement of the old boot moved verbatim into the
module that owns it (the mechanism is the Wave F passage in the infrastructure log, `docs/architecture/log/`) —
so the *lines* moved but the *duplication* did not; the classic-vs-Lit dual
paths measured below are unchanged and remain the next target.

---

## Duplication — measured **[2026-08-01]**

> *Not re-run since. The worker split (Phase 4) and the growth of `client/comments.ts`
> have both moved these numbers; treat the figures below as the shape of the problem,
> not today's count. The scan is the script described in the next paragraph.*

No `jscpd` on this box, so this is a conservative homegrown clone scan: normalize
each file to code lines (drop blanks/comments/brace-only), slide a 6-line window,
flag any window that recurs. It *under*-counts (misses near-dupes), so treat these
as floors.

- **Overall: 8.0%** of normalized code lines (1,360 / 16,956) sit inside a
  duplicated block.
- **Worker `index.js`: 10.2%** (524 lines) — the single biggest cluster. The top
  recurring windows are all the **per-handler preamble**: `let data; try { data =
  await request.json(); } catch { return json({ ok:false … }, 400) }`, then the
  rate-limit block (`const { success } = await env.READ_LIMIT.limit({ key: ip });
  if (!success) return json({ … 'Too many requests' … })`), then `const key =
  String(data.key || '')`. Concretely: **74** `request.json()` parses, **77**
  rate-limit calls, **68** "Too many requests" returns, **76** `String(data.key…)`
  reads, **362** `json({ ok:false … })` error returns, **25** identical
  `LEFT JOIN profiles` SELECT joins, **37** `blockedReason()` gates — all
  copy-pasted across the 94 handlers.
- **`comments.js`: 6.6%** — the classic-vs-Lit dual paths (see Q3) and repeated
  DOM-builder patterns.
- **`app/richtext.ts`: 78.8%** — not internal repetition; the body renderer is
  **duplicated across the bundle (`richtext.ts`) and the `comments.js` fallback**.
  This is the single largest cross-file clone and the clearest Wave-F target.
- Everything else (`pure.ts`, `webpush.ts`, the contact worker, every small
  served script, `api.ts`/`core.ts`/`store.ts`/`shell.ts`/most views): **0%**.
  The already-modular files are already clean.

**Where the duplication is tells you exactly where the refactor goes:** middleware
(the worker preamble), an ORM (the `LEFT JOIN profiles` and the 329 `.prepare()`s),
and Wave-F component extraction (the renderer clone). Nothing is duplicated in the
files that already went through those seams.

---

## The six questions

### 1. How much of the code is duplicated?

**8.0% overall [now]**, concentrated in the two monoliths — **10.2% of the worker**
and **6.6% of the client** — plus one big cross-file renderer clone (`richtext.ts`
↔ `comments.js`, 78.8% of `richtext.ts`). The duplication is **structural, not
incidental**: ~90 copies of the same request preamble, 25 copies of one SQL join,
42 `if (window.mc…) … else classic…` dual paths. It is exactly the kind that a
middleware layer, a repository layer, and finishing the component migration
*delete*, not the kind that needs a formatter. **[target] < 2%.**

### 2. How much is modular?

More than the two big files suggest. The **modular seams already exist and are
proven**:

- The **PureScript `Domain/*` kernel — 38 modules**, each a single rule family
  (`Rank`, `Fts`, `Route`, `Auth`, `Access`, `Pager`, `Scripture`, `Profile`, …),
  each with a **1:1 unit-test spec** (`tests/purescript/*.test.mjs`, 32 of them).
  Illegal states are unrepresentable (an un-sanitized FTS match *cannot exist*;
  an auth state can't hold a hash without a key). This is the most modular part
  of the codebase and it is shared by both the client and the worker.
- **`app/core.ts`** — the one audited membrane, **88 exports** (2026-09-11), the single place
  PureScript types are erased for JS.
- **`app/**`** — 17 files, one Lit component per view, over `app/store.ts` (cache)
  and `app/api.ts` (typed client). Median ~150 lines. Already modular.
- **`comments-worker/src/pure.ts`** — the pure worker helpers, extracted so they
  can be unit-tested in plain Node (the stepping-stone toward the ORM).

What is **not** yet modular: the worker's SQL (inline in the route files, the
`db.ts` foundation notwithstanding — testable where it sits since the handlers
run in the unit suite). The client's classic twins of the 13 Lit screens are
gone (2026-09-16): a `viewX` with a Lit view is a one-line door to it, and the
classic modules keep only what has no Lit view — the write paths, the DM
thread, merecat, the acting consoles. Test layers are already modular and
tiered: **Layer 1** unit (`tests/`, 32 PS + 26 js + 28 worker node specs, 12 py + 1 css unittest files — 2026-09-16; the worker specs run handlers through `tests/_support/worker.mjs`), **Layer 2**
headless (`webtest/`).

### 3. Why do we have 6,000+-line files?

Honest history, not excuse:

- **`comments.js` (8,245)** grew as *one boot function* on purpose — "booting is
  exactly what a page load always did," which gave the SPA shell reload-parity for
  free. Every feature (identity, board, DM + E2E crypto, composer, emoji, admin
  consoles, the merecat chat client) was added into that one IIFE. Then the Lit
  migration ("the interior campaign") re-implemented each *read* view as a
  component **but deliberately kept the classic body in `comments.js` as the
  no-bundle fallback** — so for the migrated views the logic existed twice, behind
  a `if (window.mcViews…) … else classic…` switch. That fallback was retired on
  2026-09-16: the bundle always stands (`docs/nav.js` injects it on every page and
  the boot waits for it), so the twin bodies rendered for nobody; the 13 are gone
  and each door delegates unconditionally. The remaining *write* paths (composer, DM send, profile/avatar editors,
  the acting admin consoles) were never componentized — they're Turnstile-gated
  round-trips that are awkward to test headless, so they stayed inline.
- **`index.js` (6,381)** is a single Worker module because that is the unit
  Cloudflare deploys, and it started small. It accreted **94 handlers**, a flat
  **93-branch** route dispatch, two Durable Objects, the cron, and **329 inline
  `.prepare()` SQL** statements — every handler re-inlining the same parse +
  rate-limit + auth preamble and the same profile join.

Root cause in one line: **organic growth into the deployment unit, with no
enforced middle layer** (no middleware, no repository) — so cross-cutting concerns
were copy-pasted instead of factored. The kernel migration fixed this for *rules*;
the current pass fixes it for *plumbing*.

### 4. Wouldn't smaller reusable functions make sense?

Yes, and they are named and quantified. Concrete extractions:

- **Worker middleware** (kills the ~90× preamble): `withJson` (parse-or-400),
  `withRateLimit(bucket)`, `withKey` (→ author hash), `withBlockGate`
  (`blockedReason`), `originOk`. A handler becomes `route(withKey, withRateLimit,
  body)` instead of 8 copy-pasted lines.
- **A repository layer** `comments-worker/src/db.ts` (kills the 329 `.prepare()`s
  and 25 join copies): typed row interfaces per table, single-sourced column
  fragments (one `COMMENT_COLS` + the `LEFT JOIN profiles`), a tiny query builder
  that **auto-renumbers `?N`** (retiring the hand-rolled `'?'+(len+1)` bookkeeping
  at ~14 sites), an `inList()`, and a `dmVisible(now)` fragment (retiring the
  `dmLive`/`DM_VIS`/`DM_CLEARED` positional contracts). Typed `withNames` /
  `rankFor` / `postCountsFor` mappers with identical output shapes.
- **Named services** (already half-there — `deliverNotifications`, `deliverPush`,
  `screen`, `runBackup`, `merecatRetrieve`, `merecatPrompt`, `postCountsFor`
  exist as functions; the target pulls them into `src/services/*`).
- **Client**: the duplicated renderer collapses to the single `app/richtext.ts`
  (`window.mcRich`); the composer / DM-crypto / media-upload / Turnstile blocks
  become shared helpers in `app/api.ts` + view files.

### 5. Wouldn't files-per-topic/scope make sense?

Yes — the natural division is **by feature**, and it maps cleanly:

- **Worker →** `routes/{calls,notify,media,wall,profile,dm,merecat,board,admin}.ts`,
  each handler moved verbatim behind the one `ROUTES` table `index.ts` keeps
  (the composition root: imports · `Env` · the table · `fetch`/`scheduled`);
  `lib.ts` the shared core every route file imports and that references no
  handler; `db.ts` the row mappers; `durable.ts` the two Durable Objects.
  The split landed on 2026-09-16 in nine commits, each proven
  behaviour-neutral by `scripts/worker_bundle_set.sh` (the dry-run bundle's
  function-name set and code-line set identical before and after) and by
  the unit suite running the handlers (`tests/_support/worker.mjs`).
- **Client →** one Lit component per view under `app/views/*` (already true for
  reads), `app/api.ts` (all endpoints), `app/core.ts` (the membrane); the write
  paths live in `client/<feature>.ts` now (Wave F), each a per-boot factory over
  the boot object `B` — the further step is moving them into their Lit views
  until the classic render paths dissolve.
- **Rules →** already one `Domain/*` module per rule family.

### 6. Is there a natural division for human approachability?

Yes. **The tree** — every file named for its feature:

```
purescript/src/Domain/*.purs        the rulebook (38 modules) — unchanged, it's the model
app/
  core.ts        membrane (PS → JS)          api.ts     typed endpoints (the DM reads return their wire shapes)
  wire.ts        the DM wire shapes, types only — the worker's routes/dm.ts builds them, the views read them (2026-09-16)
  transport.ts   fetchRetry · freshOpts/stampFresh · freshParam · cachedJson/peekJson — the read transport (P1, 2026-09-18)
  store.ts       request cache               shell.ts   SPA shell
  richtext.ts    THE body renderer           live.ts    WebSocket lifecycle
  appchrome/     sidebar · deskbar · home · settings · footer (split from appchrome.ts)
  views/         board · topic · post · member · profile · admin · library
client/                              the classic client (Wave F, shipped 2026-09-11)
  comments.ts    the boot: page state · core helpers · router · start() · the kit
  boot.ts        the Boot bag type
  composer.ts · profile.ts · board.ts · wall.ts · surface.ts · merecat.ts · admin.ts
  dm-crypto.ts · dm-message.ts · dm-pickers.ts · dm-inbox.ts · dm-thread.ts · dm-styles.ts   (the DM family, 2026-09-16)
  admin-core.ts  the admin core every page needs (ADMIN_HASHES, isAdmin, adminGate, the moderation lines, the
                 profile fingerprint and editor) — eager; the board, wall and profile bind it (P2-5, 2026-09-16)
  LAZY (own chunks under docs/chunks/, fetched by import() the first time a route needs them, installed by
  B.ensure(name); nothing eager binds their exports — tests/js/client_modules holds the seam):
  admin.ts (the admin views) · merecat.ts (the librarian's screens) · dm-thread.ts (the chat screen)
                 install<Feature>(B) factories: bind() · run() · exports
comments-worker/src/
  index.ts       the composition root: imports · handleConfig/handleLive · the ROUTES table · route() · fetch/scheduled
  serve.ts       default.fetch (2026-09-17): seal the env → route → guard the answer (egress.ts) → note a refusal
  egress.ts      the egress guard: sealEnv/deriveEnv (the env reads by name, refuses to be copied or serialized),
                 secretValues (every env string not in env.ts PUBLIC_VARS), guardResponse — no imports, shared with contact-worker
  env.ts         the bindings as wrangler.jsonc declares them, typed (2026-09-16) — a route file that takes `env: Env` gets D1's first<Row>() for free;
                 PUBLIC_VARS, the names the egress scan skips (2026-09-17)
  oidc.ts        the pipeline's doors (2026-09-17): a GitHub job's OIDC token (signature, then Domain.Pipeline),
                 an admin key, the nightly's report key — pipelineCaller / pipelineGated
  alerts.ts      the worker's voice (2026-09-16): sendAlert — email through the send_email binding EMAIL, Discord through
                 sendDiscord, the channels Domain.Ops.channelsFrom opens from the four alert_* Platform settings
  ops.ts         the cron chains (runChain: every step in its own try/catch, a heartbeat per chain, failures and the
                 self-check's findings folded into alerts), runSelfCheck, readOps (the health object) — 2026-09-16;
                 noteLeak, the egress guard's tally and alert (2026-09-17)
  routes/        the handlers, one file per feature (2026-09-16): calls · notify · media · wall · profile · dm · merecat · board · admin · ops (the report door)
                 seo (2026-09-17: /t/<id>-<slug>, the five feed addresses, /sitemap-threads.xml — HTML and XML, not JSON)
  lib.ts         the shared core — constants · crypto/auth · the preambles (keyed/keyedGated, and since
                 2026-09-16 gated/adminGated/readLimited with the variance as options) · settings ·
                 notifications/push · DM primitives · media purges · Discord · merecat · publish — references no handler
  db.ts          the row mappers (rankFor · withNames · postCountsFor) and inList
  durable.ts     BoardHub · ChatRoom (the only importer of cloudflare:workers)
  quota.ts · usage.ts · usagecalc.ts · analytics.ts   the AI budget guard, the usage monitor and the TURN guard
  pure.ts · webpush.ts   pure helpers and the Web Push crypto (TypeScript since 2026-09-17)
```

**Newcomer reading order** (a handler's home is `routes/<feature>.ts`; `index.ts` is the table):

1. **This file**, then `README.md` (build), `CLAUDE.md` (rules) and `docs/architecture/INFRASTRUCTURE.md` (the standing rules and the index of the dated log under `docs/architecture/log/`).
2. `purescript/src/Domain/Route.purs` + `Auth.purs` + `Access.purs` — the rules
   that decide what a URL shows and who may do what. Small, pure, readable.
3. `app/core.ts` — how those rules cross into JS.
4. `app/shell.ts` → `app/views/board.ts` → `topic.ts` — one full read path.
5. `client/comments.ts` (`mcBoot`: the boot object `B`, the install list, `start()`)
   → `client/board.ts` (the board form → `/api/comments`) — one classic write path,
   and how a feature module binds its names.
6. Worker `index.ts` (the `ROUTES` table) → `routes/<feature>.ts` (the handler) → `lib.ts` → `db.ts` —
   one full write path, from HTTP to SQL.
7. `durable.ts` (`BoardHub`) — how live updates fan out.

---

## Roadmap & before/after

| Phase | Move | Duplication removed | Shipped? |
|---|---|---|---|
| 1 | D1 `wrangler migrations` — one schema origin | — | ✅ |
| 2A | Strict `tsc` gate (`tsconfig`, `globals.d.ts`, `McCore` contract — since 2026-09-16 `McCore` is `typeof import('./app/core')`, so the contract cannot drift from the membrane) | — | ✅ |
| 2B | `app/**` → TypeScript, strict-green; byte-identical bundle | — | ✅ |
| 2C | `comments.js` → `client/comments.ts` + client build step | (enables Wave F) | ✅ |
| 2D | Both workers → TypeScript (`Env`, typed rows) — and since 2026-09-16 `Env` is REAL (`comments-worker/src/env.ts`: every binding wrangler.jsonc declares, the vars and secrets optional strings), taken by `index.ts`, the Durable Objects and `routes/calls.ts` (the worked example: `first<Row>()` per query). **Since 2026-09-17 EVERY handler takes it** — the nine small modules, then admin, board, dm, merecat and `lib.ts`'s 100 signatures — with row shapes at the query and `Body` for a parsed request; worker `: any` 799 → 388 under the ratchet, and **to zero** the same day (a hard gate since; `pure.ts`/`webpush.ts`; the env's type brand refuses to be an answer, a row or an event — `comments-worker/types/env_brand.check.ts`). The pass paid for itself on its first file: typing `handleRecent`'s env is what found the six-week secret disclosure (`docs/architecture/log/2026-09.md`, and `tests/worker/env_leak.test.mjs` sweeps for its class) | — | ✅ |
| F | **Wave F: the classic client is feature modules** — `client/comments.ts` (12,584 lines, one boot function) → the root + seven `install<Feature>(B)` factories, every statement moved verbatim, names bound from the boot object after install, top-level effects in `run()`; `build:client` bundles; source-rule tests read `tests/_support/client.mjs` | — (lines moved, not deduplicated; the classic-vs-Lit clone is the remaining target) **2026-09-16: `dm.ts` (3,015 lines) became six factories** — `dm-{crypto,message,pickers,inbox,thread,styles}.ts` — every declaration verbatim, cross-module names bound through `B` like any other, the wiring law extended by `tests/_support/client.mjs`'s list. | ✅ |
| 3 | **`db.ts` repository** — foundation shipped (`inList` retires the 13 hand-rolled `?N` loops, the `Query` builder, the `rankFor`/`withNames`/`postCountsFor` mappers moved in, unit-tested). The fuller repository layer `PLAN-TODO.md` proposed (no inline `prepare()` in handlers, typed rows, a builder everywhere) is **not pursued** (2026-09-16): with the handlers running in the unit suite against a real SQLite, inline SQL is testable where it sits — and the plan file is retired. | −13 `?N` loops; mappers single-sourced | ✅ |
| 4 | **Middleware + declarative routes + file-split** — the 91-branch chain is a declarative `ROUTES` table (route-parity diff = identical); `keyed`/`keyedGated` middleware on the byte-exact handlers; the monolith split into `lib.ts` / `durable.ts` / `db.ts` (2026-08-01); and — **2026-09-16 — the handlers into `routes/{calls,notify,media,wall,profile,dm,merecat,board,admin}.ts`**, every one moved verbatim (its declaration line and comment intact) behind the table `index.ts` keeps, which is now the composition root (654 lines). The 2026-08-01 attempt was reverted because an esbuild tree-shake around the Durable Object re-export dropped live code with no coverage to catch it; this pass first made the handlers runnable in the unit suite (`tests/_support/worker.mjs`, `tests/worker/routes.test.mjs` holding the table to its snapshot and dispatching every entry) and proved each commit with `scripts/worker_bundle_set.sh` — function-name set and code-line set identical before and after. | monolith → composition root + 9 route files, core/DO seams | ✅ |
| 5 | **Finish single-sourcing** — the owner ruled the bundle required, so `client/comments.ts` drops its no-bundle-fallback constant copies (FAITH/RANKS/NAMED_EMOJI/EMOJI_PACKS/CATS/pseudonym wordlists) and reads them UNCONDITIONALLY from the kernel via `window.mcCore` — drift now impossible. **2026-09-16: the read-view twins are gone** — the 13 classic bodies behind `window.mcViews` delegations (board index and category, topic, search, the post renderer, profile, inbox, users, notifications, admin home, the two merecat views, usage) deleted, ~1,150 lines, each door now `return window.mcViews!.X(…)`; the Lit views are the read UI and the webtests cover them. | client↔kernel constant duplication removed; the Lit/classic clone of the read screens removed | ✅ |
| P0–P7 | **The write-path port** (planned 2026-09-17, `docs/architecture/reviews/2026-09-17-port-plan.md`; re-sequenced 2026-09-18 — P1 pulled forward, merecat and the DM thread pushed behind the phases that have readers). **P1's first two slices shipped 2026-09-18** — the transport, then the frozen twins (the guarded `else` copies of the body renderer, the scripture hover, `classicRoute` and fourteen smaller helpers: ~330 lines, `comments.js` 237.0 → 226.9 KB). The transport slice: `app/transport.ts` holds the five the boot owned, `app/api.ts` imports its transport instead of waiting for `window.mcKit` (the shell's 500 ms × 8 s poll is deleted), the 27 view call sites import directly, and the kit fell 71 → 65. The rest: the shell bundle splits (P0), the services leave the boot (P1), then the admin consoles (P2), board writes + feed + journal (P3), the profile editors (P4), merecat (P5), the DM thread (P6) become Lit elements in lazy chunks, and `client/`, `mcBoot`, `mcKit`, `mcViews` dissolve (P7). Invariants: app.js never grows, every law's sweep moves with its code, a screen ships only with its headless suite green on prod. | the classic write half (14.4k lines), the 77-line kit bridge | ☐ planned, not begun |

**Target:** every hand-written file ≤ ~400 lines; duplication < 2%; one schema
origin; `tsc` strict-green over client + workers; the kernel still the single
source of every rule. The measurements here are the before; this table is how the
after gets checked.

**Toolchain note — TypeScript 7 (2026-09-16).** The pinned `typescript` 7.0.2 is the native
(Go) compiler: exact-pinned in `package.json`, leading-edge, and without a JavaScript compiler
API (its package exports only `version`/`versionMajorMinor`), which is why typescript-eslint
cannot run here and the `: any` ratchet is a stdlib test instead. Expect churn between
minors; the gate is `npm run tsc` (`make jscheck`) staying green. The re-check that a JS API
is back — `node -e "console.log(Object.keys(require('typescript')).length)"` reading more than
2 — sits in `tests/js/any_ratchet.test.mjs`'s header.

*Metrics captured by `scratchpad/clonescan.py` (window=6) and direct `grep`/`wc`
over the tree; re-run them after each phase to refresh the before/after.*
