# The codebase, mapped — modularity analysis & the human's reading order

*A newcomer's first document. It answers six questions honestly, with measured
numbers, and lays out where every piece of logic lives (and is moving). If you
read one file before touching the code, read this one, then `CLAUDE.md` (the
infra bible) and `README.md` (how the site is built).*

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
            │  PureScript kernel  purescript/src/Domain/*   │  22 modules
            │  (validation, permissions, parsing, routing,  │  — the rulebook,
            │   ranks, FTS-safety, identity, …) ADTs +      │    pure, tested
            │   smart constructors, illegal states unrep.   │    1:1 in tests/
            └───────────────┬───────────────┬───────────────┘
          compiled ESM      │               │   compiled ESM
                            ▼               ▼
      browser: app/core.ts (membrane,   worker: import the same
      35 exports, erases Maybe/Either)   purescript/output/ directly
                            │               │
              ┌─────────────┴──────┐        └──────► comments-worker/src/*
              ▼                    ▼                  (D1, R2, Durable Objects,
        app/**  (Lit views,   docs/comments.js         Vectorize, Workers AI)
        the bundle app.js)    (no-bundle fallback
                              client, same rules
                              via window.mcCore)
```

The two "how is this one file 6,000 lines?" cases are **`docs/comments.js`**
(the browser client) and **`comments-worker/src/index.js`** (the backend). Both
are being dissolved into feature files; the rest of this document explains why
they grew, what's duplicated, and the exact shape they're moving toward.

---

## Census — every hand-written source, by size **[now]**

| File | Lines | Role |
|---|---:|---|
| `docs/comments.js` → `client/comments.ts` | 8,245 | The whole browser client (forum, DM+E2E crypto, composer, admin, merecat chat) + the `mcKit` bridge. The no-bundle fallback. |
| `comments-worker/src/index.js` | 6,381 | The entire backend: 94 handlers, the route dispatch, 2 Durable Objects, cron, 329 inline SQL statements. |
| `app/appchrome.ts` | ~1,160 | Desktop+mobile chrome: sidebar, deskbar, home launcher, settings, footer (Lit). |
| `app/shell.ts` | 565 | The SPA shell: soft-navigation, per-page boot registry, audio dock, PWA. |
| `app/richtext.ts` | 431 | The one living body renderer (`window.mcRich`): markdown, scripture autolink, emoji. |
| `app/views/board.ts` / `topic.ts` | 381 / 379 | Lit views: board index+category / topic+search. |
| `app/live.ts` | 270 | WebSocket lifecycle (board + merecat chat conns). |
| `docs/nav.js` | 245 | Injects the shell + deeplink on every page (served raw). |
| `docs/bible-reader.js` | 240 | KJV/DR reader boot (served raw). |
| `app/views/{admin,member,post,profile,library}.ts` | 137–188 ea. | One Lit view per feature. |
| `app/{core,api,store}.ts` | 139 / 73 / 48 | Membrane / typed API client / request cache. |
| `docs/{deeplink,sw,away,contact,flash,index}.js` | 8–161 ea. | Small served-raw scripts. |
| `comments-worker/src/{pure,webpush}.js` | 105 / 98 | Extracted pure helpers (tested) / VAPID push crypto. |
| `contact-worker/src/index.js` | 124 | The contact form worker. |
| `purescript/src/Domain/*.purs` | 22 files | The kernel (see the map). |

Median hand-written file (excluding the kernel): **~180 lines.** The distribution
is bimodal — a long tail of small, single-purpose files, and **two monoliths that
hold 60% of all the hand-written lines between them.** That bimodality *is* the
finding. The small files are already modular; the two big ones are the work.

---

## Duplication — measured **[now]**

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

- The **PureScript `Domain/*` kernel — 22 modules**, each a single rule family
  (`Rank`, `Fts`, `Route`, `Auth`, `Access`, `Pager`, `Scripture`, `Profile`, …),
  each with a **1:1 unit-test spec** (`tests/purescript/*.test.mjs`, 22 of them).
  Illegal states are unrepresentable (an un-sanitized FTS match *cannot exist*;
  an auth state can't hold a hash without a key). This is the most modular part
  of the codebase and it is shared by both the client and the worker.
- **`app/core.ts`** — the one audited membrane, **35 exports**, the single place
  PureScript types are erased for JS.
- **`app/**`** — 15 files, one Lit component per view, over `app/store.ts` (cache)
  and `app/api.ts` (typed client). Median ~150 lines. Already modular.
- **`comments-worker/src/pure.js`** — the pure worker helpers, extracted so they
  can be unit-tested in plain Node (the stepping-stone toward the ORM).

What is **not** yet modular: the two monoliths. **~90%** of the worker's SQL and
request-handling still lives inline in one file; the client still carries **42**
classic fallbacks beside the Lit components. Test layers are already modular and
tiered: **Layer 1** unit (`tests/`, 27 node + 7 py + 22 PS specs), **Layer 2**
headless (`webtest/`), backend (`local/tests/`).

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
  paths move out of `comments.ts` into their views until `comments.ts` dissolves.
- **Rules →** already one `Domain/*` module per rule family.

### 6. Is there a natural division for human approachability?

Yes. **Target tree [target]** — every file named for its feature, none over
~400 lines:

```
purescript/src/Domain/*.purs        the rulebook (22 modules) — unchanged, it's the model
app/
  core.ts        membrane (PS → JS)          api.ts     typed endpoints
  store.ts       request cache               shell.ts   SPA shell
  richtext.ts    THE body renderer           live.ts    WebSocket lifecycle
  appchrome/     sidebar · deskbar · home · settings · footer (split from appchrome.ts)
  views/         board · topic · post · member · profile · admin · library
                 + composer · dm · avatar · admin-consoles (Wave F: moved out of comments.ts)
comments-worker/src/
  index.ts       thin composition root  (~150 lines)
  middleware/    withJson · withRateLimit · withKey · withBlockGate · originOk
  db.ts          every SQL statement + typed rows + the query builder
  routes/        comments · dm · wall · notifications · merecat · admin
  services/      screen · notify · push · broadcast · backup · merecat(retrieval/gen)
  durable/       board-hub.ts · chat-room.ts
  pure.ts        pure helpers (already extracted)
```

**Newcomer reading order** (once the split lands; today, start at the two
monoliths' section headers):

1. **This file**, then `README.md` (build) and `CLAUDE.md` (infra).
2. `purescript/src/Domain/Route.purs` + `Auth.purs` + `Access.purs` — the rules
   that decide what a URL shows and who may do what. Small, pure, readable.
3. `app/core.ts` — how those rules cross into JS.
4. `app/shell.ts` → `app/views/board.ts` → `topic.ts` — one full read path.
5. Worker `index.ts` (composition root) → `routes/comments.ts` → `db.ts` — one
   full write path, from HTTP to SQL.
6. `durable/board-hub.ts` — how live updates fan out.

---

## Roadmap & before/after

| Phase | Move | Duplication removed | Shipped? |
|---|---|---|---|
| 1 | D1 `wrangler migrations` — one schema origin | — | ✅ |
| 2A | Strict `tsc` gate (`tsconfig`, `globals.d.ts`, `McCore` contract) | — | ✅ |
| 2B | `app/**` → TypeScript, strict-green; byte-identical bundle | — | ✅ |
| 2C | `comments.js` → `client/comments.ts` + client build step | (enables Wave F) | ✅ |
| 2D | Both workers → TypeScript (`Env`, typed rows) | — | ✅ |
| 3 | **`db.ts` repository** — foundation shipped (`inList` retires the 13 hand-rolled `?N` loops, the `Query` builder, the `rankFor`/`withNames`/`postCountsFor` mappers moved in, unit-tested); routing the remaining trivial one-off `.prepare()` sites + the profile-join/DM-fragment consolidation is a further slice | −13 `?N` loops; mappers single-sourced | ◑ |
| 4 | **Middleware + declarative routes** — the 91-branch chain is now a declarative `ROUTES` table (behavior-proven by an independent route-parity diff); `keyed`/`keyedGated` middleware extracted and applied to the 7 handlers whose preamble is a byte-exact match (the ~30 variant preambles + the file-split into `routes/`·`services/`·`durable/` remain) | −7 exact preamble copies; declarative dispatch | ◑ |
| 5 | **Client Wave F** — write paths → components; delete the fallbacks | −42 dual paths, −the renderer clone | ☐ |

**Target:** every hand-written file ≤ ~400 lines; duplication < 2%; one schema
origin; `tsc` strict-green over client + workers; the kernel still the single
source of every rule. The measurements here are the before; this table is how the
after gets checked.

*Metrics captured by `scratchpad/clonescan.py` (window=6) and direct `grep`/`wc`
over the tree; re-run them after each phase to refresh the before/after.*
