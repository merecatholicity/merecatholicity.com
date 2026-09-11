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
            │  PureScript kernel  purescript/src/Domain/*   │  29 modules
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
| `client/dm.ts` | 2,304 | E2E crypto + media, the bubbles, the message surface, the chat screen, the inbox, presence, the live DM frames, calls. |
| `client/merecat.ts` | 1,924 | The librarian's chat client. |
| `client/board.ts` | 1,718 | The forum views, the comment renderer, quoting/editing, the board form, the journal, search, the post menu. |
| `client/admin.ts` | 1,628 | The acting consoles. |
| `client/composer.ts` | 1,607 | The markdown editor, emoji, Scripture, drafts, the media gate + compression + voice, mentions, the stash. |
| `client/profile.ts` | 1,449 | Identity, faith, mute/block, prefs, the profile card and editor, avatars, notifications. |
| `client/wall.ts` | 844 | Feed + walls. |
| `client/boot.ts` | 6 | The `Boot` bag type the factories take. (All of `client/` bundles to `docs/comments.js`, 349 KB.) |
| `comments-worker/src/index.ts` | 5,093 | The handlers + the declarative `ROUTES` dispatch + cron. |
| `comments-worker/src/lib.ts` | 2,789 | The shared core: constants, crypto, auth/validation, DB/notification/broadcast helpers. A leaf — it references no handler. |
| `app/appchrome.ts` | 1,763 | Desktop+mobile chrome: sidebar, deskbar, home launcher, settings, footer (Lit). |
| `app/shell.ts` | 868 | The SPA shell: soft-navigation (latest-wins, instant nav), per-page boot registry, audio dock, PWA. |
| `docs/nav.js` | 830 | Injects the shell + deeplink on every page, and owns the SW update pump, `?debug=1` overlay and crumb ring (served raw, unversioned). |
| `comments-worker/src/durable.ts` | 590 | The two Durable Objects (`BoardHub`, `ChatRoom`). |
| `app/call.ts` | 521 | The 1v1 voice-call engine (shell-owned, so a call rings on any page). |
| `docs/bible-reader.js` | 439 | KJV/DR reader boot (served raw). |
| `app/views/board.ts` / `topic.ts` | 435 / 433 | Lit views: board index+category / topic+search. |
| `app/richtext.ts` | 432 | The one living body renderer (`window.mcRich`): markdown, scripture autolink, emoji. |
| `comments-worker/src/usagecalc.ts` | 327 | Pure free-tier limit maths for the usage monitor (`usage.ts`, 106, does the fetch through `analytics.ts`, the GraphQL glue; `quota.ts`, 90, is the librarian's AI budget guard over the same neurons select — no lib import, Node-tested with a stubbed fetch). |
| `app/live.ts` | 304 | WebSocket lifecycle (board + merecat chat conns). |
| `app/core.ts` | 286 | The membrane — the one audited place PureScript types are erased. |
| `comments-worker/src/{pure,webpush}.js` | 268 / 138 | Extracted pure helpers (tested) / VAPID push crypto. |
| `app/views/{admin,library,member,post,profile}.ts` | 186–321 ea. | One Lit view per feature (`util.ts` 67). |
| `app/{store,ptr,api}.ts` | 218 / 194 / 101 | Request cache + persisted SWR / pull-to-refresh / typed API client. |
| `contact-worker/src/index.ts` | 138 | The contact form worker. |
| `comments-worker/src/db.ts` | 83 | The repository layer: typed row mappers, `inList`, the `Query` builder. |
| `docs/{deeplink,sw,away,contact,flash,index}.js` | 8–161 ea. | Small served-raw scripts. |
| `purescript/src/Domain/*.purs` | 29 files | The kernel (see the map); plus the generated `Domain.Writings` (`scripts/writings.py`, git-ignored). |

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
module that owns it (the mechanism is the Wave F passage in INFRASTRUCTURE.md) —
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
- Everything else (`pure.js`, `webpush.js`, the contact worker, every small
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

- The **PureScript `Domain/*` kernel — 29 modules**, each a single rule family
  (`Rank`, `Fts`, `Route`, `Auth`, `Access`, `Pager`, `Scripture`, `Profile`, …),
  each with a **1:1 unit-test spec** (`tests/purescript/*.test.mjs`, 29 of them).
  Illegal states are unrepresentable (an un-sanitized FTS match *cannot exist*;
  an auth state can't hold a hash without a key). This is the most modular part
  of the codebase and it is shared by both the client and the worker.
- **`app/core.ts`** — the one audited membrane, **88 exports** (2026-09-11), the single place
  PureScript types are erased for JS.
- **`app/**`** — 17 files, one Lit component per view, over `app/store.ts` (cache)
  and `app/api.ts` (typed client). Median ~150 lines. Already modular.
- **`comments-worker/src/pure.js`** — the pure worker helpers, extracted so they
  can be unit-tested in plain Node (the stepping-stone toward the ORM).

What is **not** yet modular: the worker's SQL and request-handling (**~90%**
still inline in `index.ts`, the `db.ts` foundation notwithstanding), and the
client's **42** classic fallbacks beside the Lit components — the client is
feature files now (Wave F), but each feature file still carries its classic
render path. Test layers are already modular and
tiered: **Layer 1** unit (`tests/`, 29 PS + 15 js + 16 worker node specs, 12 py + 1 css unittest files — 2026-09-11), **Layer 2**
headless (`webtest/`).

### 3. Why do we have 6,000+-line files?

Honest history, not excuse:

- **`comments.js` (8,245)** grew as *one boot function* on purpose — "booting is
  exactly what a page load always did," which gave the SPA shell reload-parity for
  free. Every feature (identity, board, DM + E2E crypto, composer, emoji, admin
  consoles, the merecat chat client) was added into that one IIFE. Then the Lit
  migration ("the interior campaign") re-implemented each *read* view as a
  component **but deliberately kept the classic body in `comments.js` as the
  no-bundle fallback** — so for the migrated views the logic exists twice, behind
  a `if (window.mcViews…) … else classic…` switch. That fallback is a real
  feature (the site works with storage/JS-bundle disabled), but it doubled the
  file. The remaining *write* paths (composer, DM send, profile/avatar editors,
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

- **Worker →** `routes/{comments,dm,wall,notifications,merecat,admin}.ts`
  (each a small sub-route table), `services/*` (the business ops above), `db.ts`
  (all SQL), `middleware/*`, and the two Durable Objects (`BoardHub`, `ChatRoom`)
  in their own files. `index.ts` becomes a thin composition root: build the env,
  compose middleware, mount the route tables.
- **Client →** one Lit component per view under `app/views/*` (already true for
  reads), `app/api.ts` (all endpoints), `app/core.ts` (the membrane); the write
  paths live in `client/<feature>.ts` now (Wave F), each a per-boot factory over
  the boot object `B` — the further step is moving them into their Lit views
  until the classic render paths dissolve.
- **Rules →** already one `Domain/*` module per rule family.

### 6. Is there a natural division for human approachability?

Yes. **Target tree [target]** — every file named for its feature, none over
~400 lines:

```
purescript/src/Domain/*.purs        the rulebook (29 modules) — unchanged, it's the model
app/
  core.ts        membrane (PS → JS)          api.ts     typed endpoints
  store.ts       request cache               shell.ts   SPA shell
  richtext.ts    THE body renderer           live.ts    WebSocket lifecycle
  appchrome/     sidebar · deskbar · home · settings · footer (split from appchrome.ts)
  views/         board · topic · post · member · profile · admin · library
client/                              the classic client (Wave F, shipped 2026-09-11)
  comments.ts    the boot: page state · core helpers · router · start() · the kit
  boot.ts        the Boot bag type
  composer.ts · profile.ts · board.ts · wall.ts · dm.ts · merecat.ts · admin.ts
                 install<Feature>(B) factories: bind() · run() · exports
comments-worker/src/
  index.ts       thin composition root  (~150 lines)
  middleware/    withJson · withRateLimit · withKey · withBlockGate · originOk
  db.ts          every SQL statement + typed rows + the query builder
  routes/        comments · dm · wall · notifications · merecat · admin
  services/      screen · notify · push · broadcast · backup · merecat(retrieval/gen)
  durable/       board-hub.ts · chat-room.ts
  pure.ts        pure helpers (already extracted)
```

**Newcomer reading order** (the worker's `routes/` · `services/` · `durable/`
split above is the target shape; today its write path is `index.ts` → `lib.ts` → `db.ts`):

1. **This file**, then `README.md` (build), `CLAUDE.md` (rules) and `docs/architecture/INFRASTRUCTURE.md` (infra, long form).
2. `purescript/src/Domain/Route.purs` + `Auth.purs` + `Access.purs` — the rules
   that decide what a URL shows and who may do what. Small, pure, readable.
3. `app/core.ts` — how those rules cross into JS.
4. `app/shell.ts` → `app/views/board.ts` → `topic.ts` — one full read path.
5. `client/comments.ts` (`mcBoot`: the boot object `B`, the install list, `start()`)
   → `client/board.ts` (the board form → `/api/comments`) — one classic write path,
   and how a feature module binds its names.
6. Worker `index.ts` (the `ROUTES` table + the handlers) → `lib.ts` → `db.ts` — one
   full write path, from HTTP to SQL.
7. `durable.ts` (`BoardHub`) — how live updates fan out.

---

## Roadmap & before/after

| Phase | Move | Duplication removed | Shipped? |
|---|---|---|---|
| 1 | D1 `wrangler migrations` — one schema origin | — | ✅ |
| 2A | Strict `tsc` gate (`tsconfig`, `globals.d.ts`, `McCore` contract) | — | ✅ |
| 2B | `app/**` → TypeScript, strict-green; byte-identical bundle | — | ✅ |
| 2C | `comments.js` → `client/comments.ts` + client build step | (enables Wave F) | ✅ |
| 2D | Both workers → TypeScript (`Env`, typed rows) | — | ✅ |
| F | **Wave F: the classic client is feature modules** — `client/comments.ts` (12,584 lines, one boot function) → the root + seven `install<Feature>(B)` factories, every statement moved verbatim, names bound from the boot object after install, top-level effects in `run()`; `build:client` bundles; source-rule tests read `tests/_support/client.mjs` | — (lines moved, not deduplicated; the classic-vs-Lit clone is the remaining target) | ✅ |
| 3 | **`db.ts` repository** — foundation shipped (`inList` retires the 13 hand-rolled `?N` loops, the `Query` builder, the `rankFor`/`withNames`/`postCountsFor` mappers moved in, unit-tested); routing the remaining trivial one-off `.prepare()` sites + the profile-join/DM-fragment consolidation is a further slice | −13 `?N` loops; mappers single-sourced | ◑ |
| 4 | **Middleware + declarative routes + file-split** — the 91-branch chain is a declarative `ROUTES` table (route-parity diff = identical); `keyed`/`keyedGated` middleware on the byte-exact handlers; and the 6,359-line worker monolith is **split into 4 modules**: `index.ts` (handlers + dispatch, 3,708), `lib.ts` (shared core — constants/crypto/auth/DB/notification/broadcast, 2,388), `durable.ts` (the two Durable Objects, 486), + the existing `db.ts`/`pure.js`/`webpush.js`. Each split behavior-proven: tsc-clean, the wrangler bundle's function set + code line-set unchanged bar cosmetic esbuild renames, live suites green. **Handler-group route files** (`routes/merecat` etc.) were attempted and reverted: extracting a group whose helpers are reached only through a Durable-Object re-export triggers an esbuild cross-module tree-shake that drops live code, and merecat generation isn't covered by the regression suite — so it isn't safely verifiable and is left for a pass that first extends coverage. | monolith → 4 modules; declarative dispatch; core/handler/DO seams | ◑ |
| 5 | **Finish single-sourcing** — the owner ruled the bundle required, so `client/comments.ts` drops its no-bundle-fallback constant copies (FAITH/RANKS/NAMED_EMOJI/EMOJI_PACKS/CATS/pseudonym wordlists) and reads them UNCONDITIONALLY from the kernel via `window.mcCore` — drift now impossible. (The larger read-view component-vs-classic fallback deletion is the remaining Wave-F surgery.) | client↔kernel constant duplication removed | ◑ |

**Target:** every hand-written file ≤ ~400 lines; duplication < 2%; one schema
origin; `tsc` strict-green over client + workers; the kernel still the single
source of every rule. The measurements here are the before; this table is how the
after gets checked.

*Metrics captured by `scratchpad/clonescan.py` (window=6) and direct `grep`/`wc`
over the tree; re-run them after each phase to refresh the before/after.*
