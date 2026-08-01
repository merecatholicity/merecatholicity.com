# PLAN-TODO — full TypeScript + our-own-ORM + MVC discipline (overnight, full send)

An autonomous agent executes this end to end in one night. New platform, real users are minimal, **risk is
acceptable — move fast and finish.** End state:

- **Every hand-written `.js` becomes `.ts`** (bundled and served), type-checked under a strict `tsc` gate.
  The PureScript `Domain` kernel stays PureScript; TypeScript imports its compiled ESM.
- **A lightweight typed repository ("our own ORM")** owns all worker SQL — no inline `prepare()` in
  handlers, no hand-counted bind indexes.
- **The worker gets real structure:** route table + middleware + services + repository, split by feature.
- **A real migrations system** (`wrangler d1 migrations`) with the three schema sources reconciled.
- **Client "Wave F":** the god-module `comments.js` dissolves into Lit components + the SDK.

Work the phases in order. At each phase end: `npm run tsc` green, `make tests` green, build succeeds,
deploy, `cd webtest && python3 test_interactive.py` green on prod. Commit + push per phase. The live
interactive suite is the behavioral truth — if it's green after a deploy, the platform works. Bump
`app.js?v=` / `comments.js?v=` whenever those served bytes change (edge caches them immutably by key).

---

## Toolchain facts (current)
- Build: `npm run build:js` = `build:ps` (spago → `purescript/output/`) then esbuild `app/shell.js` →
  `docs/app.js`. `npm run build:css` = tailwind. `make worker-deploy` = `jscheck` + `psbuild` +
  `cd comments-worker && wrangler deploy`. `make jscheck` = `npm run lint` (eslint). `make tests` = node
  unit tests (`tests/purescript/*.test.mjs` parity + `tests/worker/pure.test.mjs`).
- Served-raw client scripts (no build step today): `docs/comments.js` (~7.9k), `docs/nav.js`,
  `deeplink.js`, `flash.js`, `contact.js`, `bible-reader.js`, `away.js`, `index.js`, `sw.js`.
- Bundled client: `app/shell.js`, `store.js`, `core.js`, `api.js`, `live.js`, `richtext.js`,
  `appchrome.js`, `views/*.js` → `docs/app.js`.
- Workers: `comments-worker/src/index.js` (~6k, 89 handlers), `comments-worker/src/pure.js`,
  `contact-worker/src/index.js`.
- PureScript: `purescript/src/Domain/*.purs` (20 modules) — **do not port to TS**.
- DBs: D1 `merecatholicity-comments` (bind `DB`) + `merecat-library`/`-deep`/`-deep2`
  (`LIBDB`/`LIBDB2`/`LIBDB3`). Schemas: `comments-worker/schema.sql` (22 tables),
  `comments-worker/schema-librarian.sql` (8 tables ×3 DBs), `local/build_index.py` (divergent `chunks`).
- Live-write test path: `webtest/.testkeys` holds two identity keys + `MC_TEST_TOKEN` (worker
  `MC_TEST_BYPASS` secret). `webtest/live_kit.py` + `test_interactive.py` drive 2 real users on prod.

---

## PHASE 1 — Migrations + schema reconciliation

1. Snapshot prod schemas: for each of `merecatholicity-comments`, `merecat-library`, `merecat-library-deep`,
   `merecat-library-deep2` run
   `wrangler d1 execute <db> --remote --command "SELECT sql FROM sqlite_master WHERE type IN ('table','index','trigger') ORDER BY name;"`.
2. In `comments-worker/wrangler.jsonc` set `migrations_dir` (NOT the existing DO `migrations` key — leave
   that). Create `comments-worker/migrations/`.
3. Write `0000_baseline_comments.sql` = the reconciled current comments schema (all `CREATE … IF NOT
   EXISTS`, from `schema.sql`, merged with anything the prod snapshot has that the file lacks). Write
   `0000_baseline_library.sql` = the library schema (applied to all 3 lib DBs).
4. Apply: `wrangler d1 migrations apply <db> --remote` for each DB — must report 0 pending (or only
   reviewed drift). `wrangler d1 migrations list <db> --remote` shows the ledger.
5. Reconcile the 3rd schema: change `local/build_index.py`'s `chunks` DDL to the canonical D1 shape (or make
   it replay `0000_baseline_library.sql`). One origin for all schemas.
6. Convert `schema.sql`/`schema-librarian.sql` into generated snapshots (header: "generated from
   migrations/; do not hand-edit"). Add `make migrate` (apply all DBs) + `make migrate-status` (list).
7. Update `CLAUDE.md`: new schema change = `wrangler d1 migrations create` → write `.sql` → `apply --remote`.

**Done when:** clean per-DB ledger, one schema origin, `make migrate`/`make migrate-status` work.
**Commit:** `D1: wrangler migrations + reconcile schema sources`.

---

## PHASE 2 — Full TypeScript

### 2A — Gate + config
1. `npm i -D --save-exact typescript` and `npm i -D @cloudflare/workers-types`.
2. `tsconfig.json` at root: `target:"ES2022"`, `module:"ESNext"`, `moduleResolution:"Bundler"`,
   `strict:true`, `noEmit:true`, `skipLibCheck:true`, `allowJs:true`, `checkJs:true`,
   `lib:["ES2022","DOM","DOM.Iterable","WebWorker"]`, `noUncheckedIndexedAccess:false`. `include` app/,
   the client script sources, both workers. `exclude` node_modules, `purescript/output`, `docs/*.js`
   (built outputs), minified/vendored.
3. `globals.d.ts`: declare the bridges (`window.mcCore`, `mcKit`, `mcLive`, `mcViews`, `mcStore`, `mcApi`,
   `mcRich`) and third-party globals (`turnstile`, `nacl`) with real interfaces (fill in as you type the
   sources).
4. `package.json`: add `"tsc":"tsc --noEmit"`. Make `lint` also run tsc, and point `make jscheck` at
   `npm run lint && npm run tsc`.

### 2B — Bundled client `app/**` → `.ts`
1. `git mv` each `app/**/*.js` → `.ts` (leaf views first, `shell.ts` last). Update `build:js` esbuild
   entry `app/shell.js` → `app/shell.ts`. esbuild resolves `.ts` transparently — keep import specifiers,
   drop `.js` extensions only if resolution complains.
2. Add real types: handler/param/return types, Lit `@property` types, the `mc*` bridge interfaces, the
   `core.ts` membrane signatures (this is the highest-value file — type the PS↔JS erasure). Fix every real
   type error `tsc` surfaces (these are genuine bugs — that's the point).
3. `npm run build:js` must succeed; `docs/app.js` rebuilds from the `.ts`. Bump `app.js?v=` in `nav.js`
   (its bytes may shift). `make tests` + `npm run tsc` green.

### 2C — Served-raw client scripts → `.ts` + a client build step
The raw scripts have no build step today; give them one so they become real `.ts`.
1. Move sources to `client/*.ts` (or `app/entries/*.ts`): `comments.ts` (from the 7.9k `comments.js`),
   `nav.ts`, `deeplink.ts`, `flash.ts`, `contact.ts`, `bible-reader.ts`, `away.ts`, `index.ts`, `sw.ts`.
2. Add `build:client` = esbuild each entry → `docs/<name>.js` (IIFE/classic to match how they're loaded;
   `sw.ts` stays a service worker). Fold into `npm run build:js`. Keep them separate files (comments.js is
   still the no-bundle fallback loaded independently).
3. Type them (comments.ts is huge — type in sections: crypto, DM, board/render, router, `mcKit` assembly).
   Fix real bugs `tsc` finds.
4. Bump `?v=` for the versioned ones (`comments.js`, `bible-reader.js`) in `nav.js` + every commented page
   (`comments.js?v=` appears in ~9 pages — one `sed`). `nav.js`/`style.css` unversioned (edge TTL).
5. `make html`/rebuild any page that references these if their `?v=` changed.

### 2D — Workers → `.ts`
1. `git mv comments-worker/src/index.js index.ts`, `pure.js` → `pure.ts`, `contact-worker/src/index.js`
   → `index.ts`. Set `main` in each `wrangler.jsonc` to `src/index.ts`.
2. Type the `Env` from the `wrangler.jsonc` bindings (D1 `D1Database`, R2 `R2Bucket`, `VectorizeIndex`,
   `Ai`, rate-limit `RateLimit`, DO `DurableObjectNamespace`), the handler signatures, D1 row shapes.
3. `cd comments-worker && wrangler deploy --dry-run` bundles clean; `make tests` green; `npm run tsc` green.
4. Update `eslint.config.js` globs `.js`→`.ts` and the `lint` script paths (add `typescript-eslint` only if
   needed to keep `no-undef`/`no-dupe-keys`/`no-unreachable` working over TS).
5. Deploy: `make worker-deploy`. Run `cd webtest && python3 test_interactive.py` — full green on prod.

**Done when:** `npm run tsc` strict-green over all app/client/worker TS; everything builds; workers deploy;
live suite green; every `?v=` bumped where bytes changed.
**Commit/push:** per section (2B, 2C, 2D). Deploy the worker at 2D.

---

## PHASE 3 — Repository layer ("our own ORM")

1. `comments-worker/src/db.ts` exports:
   - **Row interfaces** per table (from `schema.sql`): `CommentRow`, `ProfileRow`, `DmRow`,
     `NotificationRow`, `WallPostRow`, `WorkRow`, `ChunkRow`, etc.
   - **Column fragments**: single-source the repeated SELECT shapes (`COMMENT_COLS`, the
     `LEFT JOIN profiles` join, the merecat chunk shape) — retype-once, use everywhere.
   - **A tiny query builder** that accumulates `(fragment, ...binds)` and renumbers `?N` automatically —
     kills the `'?'+(binds.length+1)` bookkeeping. Plus `inList(vals)` for `IN(?,?…)`, and a
     `dmVisible(now)` helper returning fragment+binds together (retire the literal `dmLive` interpolation
     and the `DM_VIS`/`DM_CLEARED` positional-contract fragments).
   - **Mappers**: typed `withNames`/`rankFor` equivalents (row → domain object with `assigned`/`rank`/
     `posts`), exact same output shapes the client consumes. A `tx([...])` helper preserving `DB.batch`
     atomicity (e.g. the read-thread double write).
2. Single-source table/column names in `Domain.Schema` (PureScript) OR a `db-schema.ts` const module
   (pick the lighter; a TS const is fine). `db.ts` imports them.
3. Route ALL worker SQL through `db.ts`, table family by table family (start with `comments`/`profiles`
   joins, then DMs, notifications, wall, merecat lib). Grep goal: `grep -c "\.prepare(" src/index.ts` → 0
   outside `db.ts`.
4. After each family: `make tests` + deploy + `test_interactive.py` green (behavioral proof — SQL text may
   differ, behavior must not).

**Done when:** no inline SQL in handlers, no manual bind bookkeeping, all rows typed.
**Commit/push:** per family, deploy+live-suite between batches.

---

## PHASE 4 — Worker structure (MVC / 3-tier)

1. **Middleware:** extract the copy-pasted preamble (`withJson` parse+400, `withRateLimit`
   POST/READ_LIMIT, `withKey` → `authorHash`, `withBlockGate` `blockedReason`, `originOk`) into composable
   wrappers. Handlers become `route(withJson, withRateLimit, withBlockGate, body)`.
2. **Route table:** replace the ~90-line if-chain in `export default.fetch` with a declarative
   `[{method, path, mw, handler}]` table + a small matcher (respect exact/prefix order).
3. **Services:** pull business ops out of god-handlers into named services — `screen` (AI moderation),
   `deliverNotifications`, `broadcastBoard`/`publishLive`, the merecat retrieval/generation, the cron
   sweeps. Give `handleAdmin`/`handleMerecat*`/`handlePost` proper sub-route tables instead of hidden `op`
   dispatch.
4. **Split by feature:** `src/routes/`, `src/middleware/`, `src/services/`, `db.ts`, and the DOs
   `BoardHub`/`ChatRoom` in their own files. `index.ts` = thin composition root (`Env`, router,
   `export default { fetch, scheduled }`). Keep the DO exports wrangler expects (`wrangler deploy --dry-run`).
5. contact-worker: apply the same tiny shape for consistency (or leave — it's already clean).

**Done when:** thin `index.ts`, uniform small handlers, declarative routes, a services layer, feature-split.
**Verify:** `make tests` + `npm run tsc` + `wrangler deploy --dry-run` + deploy + full live suite +
`webtest/audit.py`. Deploy in coherent batches with the live suite between.

---

## PHASE 5 — Client Wave F + finish domain single-sourcing

1. Port the remaining write paths out of `comments.ts` into Lit components (`app/views/*`) + `app/api.ts`:
   the composer/`boardPost`, DM send, profile/identity editors, avatar upload, the three acting admin
   consoles. The read views already show the pattern.
2. Retire the inline `if (window.mcViews…) return … else …classic…` fallbacks and the duplicated inline
   constants (FAITH/CATS/NAMED_EMOJI) — use `window.mcCore`/`Domain.*`.
3. Componentize `app/appchrome.ts` into the view tree.
4. Finish `Domain.*` single-sourcing: delete the worker's remaining inline constant copies and the client
   fallbacks so each rule lives once (PureScript is the source).
5. Extend `webtest/test_interactive.py` with a scenario per ported write path (that's the proof). Bump
   `app.js?v=`/`comments.js?v=` as bytes change; rebuild pages.

**Done when:** `comments.ts` is a thin shim (or gone), writes are components, constants single-sourced.
**Verify:** full arsenal, heavy on the live interactive suite. Deploy + push.

---

## Final acceptance (end of the night)
- `npm run tsc` strict-green across app + client + workers; `make jscheck` green; `make tests` green.
- `npm run build:js` + `build:client` + `build:css` succeed; workers deploy; every `?v=` bumped correctly.
- `cd webtest && python3 test_interactive.py` **fully green on prod**; `python3 webtest/audit.py --pages` clean.
- `wrangler d1 migrations list` clean per DB; one schema origin.
- Branch pushed. Commits authored as the owner, no AI attribution.

## Progress checklist (append findings with file:line)
- [ ] P1 migrations + schema
- [ ] P2A TS gate · [ ] P2B app/** .ts · [ ] P2C client scripts .ts + build · [ ] P2D workers .ts + deploy
- [ ] P3 repository/ORM
- [ ] P4 worker structure
- [ ] P5 client Wave F + single-sourcing
