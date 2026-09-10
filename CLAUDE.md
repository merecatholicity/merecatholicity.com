# CLAUDE.md

Guidance for agents working in this repository: the website **merecatholicity.com**, its
Cloudflare backend, and the build/deploy system. This file is the **rulebook and the map**,
kept short on purpose. The long-form reference — every design decision and postmortem since
July 2026, ~270 KB — is **`docs/architecture/INFRASTRUCTURE.md`**: before changing a
subsystem, read its passage there (index at the end of this file; grep the bold lead-in).

- `docs/architecture/CICD.md` — **how work ships**: the workflows, the approval gate, every
  credential, the exceptions, the traps. Read before deploying, changing infra, or touching a secret.
- `docs/architecture/CODEBASE.md` — code architecture: PureScript kernel → `core.ts` membrane →
  Lit views; the worker's module split; a newcomer reading order.
- `README.md` — the human how-it-works: layout, hosting, build pipeline, cookbook.
- `comments-worker/API.md` (wire contract), `librarian/README.md` (the bot's mind),
  `tests/README.md`, `terraform/README.md`.
- If `CONTEXT_DUMP.txt` is present in the root and you work on text content, ingest it first.

**Keep the documents current in the same change**: this file for rules; INFRASTRUCTURE.md for
the why (append, dated, bold lead-in); CICD.md when a workflow, secret or make target it names
changes; CODEBASE.md when module structure changes; README when the human story changes.

## Standing authorization, and the only road

The owner has granted standing permission to ship — commit, push, deploy, apply migrations,
purge — as often as the work needs, **without asking each time**. Do not end a turn asking
"want me to push/deploy?". Two exceptions: commit attribution follows the harness's
instruction only; give a heads-up before destructive or irreversible acts beyond a normal
deploy (dropping a database, force-pushing history, deleting a bucket, revoking a credential).

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
7. **Workers ship on push** (`workers.yml`: gates → D1 ledger → `wrangler deploy`).
   `make worker-deploy` is the emergency road; `wrangler secret put` is the only home for
   worker secrets.
8. **Never hand-edit or commit the generated half of `docs/`**; never bump a `?v=` by hand
   (the build stamps them, preserving mtimes so a stamp never hides a source change from
   make); never fetch a freshly stamped `?v=N` URL mid-deploy — probe a throwaway query
   (`app.js?probe123`) instead. To force a cold site rebuild in CI, bump the cache
   generation (`site-2-`) in both workflows.
9. Every `uses:` is SHA-pinned — the repository requires it, nested references included;
   Dependabot bumps the pins by PR; secret scanning and push protection are on.
10. The manual exceptions are enumerated in CICD.md §10. A manual act not on that list is drift.
11. **Verify, don't assume**: `gh run list --limit 6`; `terraform -chdir=terraform plan` →
    *No changes*; `python3 scripts/publish_pdfs.py --check`;
    `curl -s "https://merecatholicity.com/version.json?probe=$RANDOM"`.

Credentials live in `~/.config/merecatholicity/ci.env` (mode 600, outside the repo) and in the
Actions secrets — never in any committed file. The identity hashes and Turnstile sitekeys in
the repo are public by design.

## Repository layout

The root holds only tool-convention files (`Makefile`, `eslint.config.js`, `package.json` +
lock, `tsconfig.json`, `globals.d.ts`, `.gitignore`, `README.md`, `CLAUDE.md`, `LICENSE*`).
**`docs/` is the served site and a MIXTURE**: hand-maintained source (nav.js, sw.js, the page
scripts, the vendored libraries, turnstile.html, every image, the 17 hand pages, CNAME,
.nojekyll) is tracked; everything the build writes is git-ignored and rebuilt;
`tests/py/test_docs_sources.py` enforces the split. A new hand page needs an `!docs/<name>.html`
line in `.gitignore` and an entry in `scripts/nav.py`'s `PAGES`. Elsewhere: `book/` (LaTeX +
`build-confession.sh`), `content/` (hand-page sources), `resources/` (corpus converters, the
committed `*-body.tex`, `docs-src/` preserved sources), `partials/` (pandoc includes — a
partial carrying a versioned asset is stamped too), `scripts/`, `styles/main.css` (the one
Tailwind v4 entry), `app/` (Lit shell + views, TS), `client/comments.ts` → `docs/comments.js`,
`purescript/src/Domain/*.purs` (the kernel, 27 modules), `comments-worker/`, `contact-worker/`,
`librarian/` (`librarian/private/` is a separate PRIVATE clone — never a submodule, never
committed), `webtest/`, `tests/`, `terraform/`, `.github/workflows/`.

## Build and verify

- **Gates**: `make tests` (unit suite: PureScript, JS, worker, Python, CSS; runs `psbuild`
  first); `make jscheck` (eslint + tsc + psbuild); `make check` (jscheck + linkcheck);
  `make check-pdfs` (bucket vs manifest vs local PDFs; CI runs it with the site token).
- **Build**: `make css` (Tailwind → `docs/style.css`), `make bundle` (purs + esbuild → `app.js`,
  `comments.js`, then the version stamp), `make content` (hand pages), `make html` (book +
  corpus + post-processing + stamp + manifest + check; incremental — one target per work),
  `make menu` (nav — `NAV_ENABLED = False`, the old menu is kept in code), `make -C resources pdf`,
  `make pdf` / `publish` / `chart-pdfs` (`CHROMIUM=…`) / `logos`, `make publish-pdfs` /
  `mirrored-pdfs` / `pdf-manifest`, `make migrate` / `migrate-status` / `schema-snapshot`,
  `make serve` (binds 127.0.0.1 only — load-bearing), `make comments-backup`, `make librarian`.
- Builds are pinned to `SOURCE_DATE_EPOCH=1784160000` and byte-deterministic: a double
  `make bundle` must leave `docs/app.js` unchanged.
- Toolchain is npm: `npm ci` only, never `sudo npm` or `-g`; esbuild and purs exact-pinned.
  This dev box is Ubuntu/WSL2, not the Arch machine older notes assume: official Node 24 in
  `~/.local`, a `python` shim (see the toolchain memory).
- Every pandoc call in a resources loop ends `|| exit 1`; a new loop must too.

## Laws that break silently

Each has a fuller passage in INFRASTRUCTURE.md — read it before touching the area.

- **`?v=` keys are stamped** (`scripts/stamp_versions.py`: nav.js, the pages, `partials/*`,
  content.py; keys are content hashes; runtime keys via `window.mcAsset`); only `sw.js` is
  unkeyed. Cloudflare treats a `?v=N` URL as immutable — a probe mid-deploy freezes old bytes
  under the new key for ever. The deploy job purges `sw.js` + `version.json`; HTML is never
  edge-cached.
- **Every page's client is a boot the shell drives**; `mcBoot()` (the whole classic client)
  re-runs on every soft navigation, so anything inside it that owns a resource leaks per hop —
  keep page-scoped state above it, and every document/window listener it installs carries
  the boot signal. Page-scoped state stamped on `<html>`/`<body>` must be cleared by the shell
  on navigation (only `<main>` is swapped).
- **Turnstile**: an established identity is not challenged (`Domain.Turnstile`, app_settings
  `turnstile_skip_established`); the widget runs in `docs/turnstile.html` (own browsing
  context; its `?v=` is stamped into nav.js's `MC_ASSETS`, never by hand). **Only
  `loadTurnstile()` mounts, only from the focus net or a press, never because a view
  opened, never for a spared identity** — the test sweeps every call site. The host is the
  document's own (`tsHost()`, `body > .mc-ts-host[data-mc-app]`), never inside `<main>`,
  never off-screen, never without its stylesheet. The contact form (`docs/contact.js`, its
  own sitekey, nobody to spare) mounts on the first focus only, and `contact.html` is a
  **document page** in the shell (`DOCUMENT_PAGES`): every door reaches it by a full load,
  because the challenge completes on a hard-loaded document and killed soft-navigated ones.
- **`READ_LIMIT` is one per-IP bucket shared by every read endpoint**; the client's read-budget
  coordinator paces every poller — never add a poller outside it.
- **D1 schema changes are a NEW `comments-worker/migrations/NNNN_*.sql`** (next: 0012),
  additive; `schema.sql` is a generated snapshot; the three librarian D1s are derived data.
  Renaming an applied migration file requires renaming its `d1_migrations` row too.
- **Shared constants, tables and validators live in `purescript/src/Domain/*`** and are read
  by both the client (`window.mcCore` / `app/core.ts`) and the worker. Never re-inline a copy.
- **A NEW state store must be added to `runBackup()`'s mirror** or it is not backed up
  (`MEDIA`/`WALLMEDIA` are outside it on purpose; LIBDB is derived).
- The Cloudflare `bot_management` API is a **full replace** (Terraform sends the whole object).
- The edge 403s `Python-urllib` and CI runners (Bot Fight Mode): use a browser UA; headless
  verification against prod runs from the dev box.
- **Never a long generation inside a stateless invocation's `waitUntil`** — kick it into a
  Durable Object (the `ChatRoom` pattern).
- The back room (`board:adminsonly`) must be indistinguishable from nonexistence on every
  public read; the social kill switch (`social_enabled`) likewise answers as "no such page".
- A symptom that moves when you move the code is evidence the code is the cause — stop
  relocating it (the Turnstile postmortem).
- **A touch on an overlay must never reach the page behind it**: `mc-sheet` contains its own
  overscroll, its scrim is `touch-action:none`, and it locks the document while open
  (`html.mc-sheet-open`, body fixed at the saved offset). A new overlay reuses the sheet or
  the same three layers.
- **Nothing scrolls sideways on a phone**: `body{overflow-x:clip}` is the net, not the fix. A
  new surface must fit 390px — a flex row wraps or its items may shrink, an edge-to-edge
  pull uses `var(--page-pad)`, and a JS-injected style block must agree with the
  stylesheet (it is injected later and wins). Sweep with `webtest/test_hscroll.py`.

## Architecture in brief

The PureScript kernel (`Domain.*`: ADTs, smart constructors, `Maybe`/`Either`, illegal states
unrepresentable, pure) → **`app/core.ts`, the one audited membrane where types are erased** →
Lit views (`app/views/*`, light-DOM, presentational) and the classic no-bundle fallback
`client/comments.ts` (kept on purpose; delegates through `window.mcCore` / `mcKit` /
`mcRich`). The worker (`comments-worker/src/{index,lib,durable,db}.ts` + `pure.js`,
`webpush.js`) imports the same compiled kernel. **New application logic goes in PureScript**;
JS is interop only (DOM, fetch, crypto, storage, Turnstile, WebSocket). A slice ships through
four gates: byte-deterministic rebuild; parity (`make pstest` + headless delegate-vs-classic);
`npm run lint` green; headless render parity against a **local** serve (`make serve`,
`MC_BASE=http://127.0.0.1:8000`). Realtime: the `BoardHub` DO (forum fan-out over WebSockets)
and the `ChatRoom` DO (merecat generation and @mentions). Full map: CODEBASE.md.

## Testing policy

Tests exist to clarify what the code does and to guard the rules that break silently — no
coverage target, no tests for trivial getters. Layer 1 `tests/` is hermetic (`make tests`,
the standing gate; one file per concern; `tests/README.md`). Layer 2 `webtest/` is headless
Chromium against prod (`webtest/audit.py --pages …`, `--app --journey …`, the per-slice
`test_*.py`; a matched chrome + chromedriver pair lives in `~/.cloakbrowser/chromium-<ver>/`).
When you add or change a rule, add or adjust
its test in the same change; never delete a test to go green.

## Infrastructure at a glance

- **Hosting**: GitHub Pages serves the artifact `build.yml` deploys (`build_type: workflow`;
  `docs/` is the packaged folder; CNAME + .nojekyll are asserted before packaging). Cloudflare
  fronts it: `ssl = full` (NOT strict — the origin is Pages), `browser_cache_ttl = 0` (what
  makes `?v=` work), the response-header/CSP ruleset, bot management — all in Terraform.
- **PDFs**: the 244 published PDFs live in R2 `merecatholicity-files` at
  `files.merecatholicity.com`, reached by a dynamic redirect from `/<name>.pdf`; `docs/pdfs.txt`
  is the manifest; `scripts/publish_pdfs.py` publishes and verifies; one PDF has no build
  (`resources/docs-src/The_Bishop_of_Rome.pdf`, a mirrored source).
- **Workers**: `comments-worker` (routes `/api/comments*`, `/api/merecat*`, `/@*`; D1
  `merecatholicity-comments` + three librarian rooms; R2 avatars/backups/dm-media/wall-media;
  Vectorize; Workers AI; two Durable Objects; three crons) and `contact-worker`
  (`contact-api.merecatholicity.com`). Both TypeScript; `wrangler.jsonc` is the config truth.
- **merecat**, the librarian bot: a WebSocket state machine in the `ChatRoom` DO, five-legged
  retrieval over three D1 rooms + Vectorize, `librarian/` is its mind; Cloudflare Workers AI is its only backend (the GPU twin retired 2026-09-10).
  The band weighting and persona are the owner's standing law — read the merecat passage in
  INFRASTRUCTURE.md before touching anything there.
- **Terraform** owns the zone settings, DNS, the four rulesets, bot management, the R2 buckets,
  the D1 databases (as records), the Turnstile widgets, both GitHub repos, Pages, the two
  environments, the Actions policy and variables; state is in R2 (`merecatholicity-tfstate`,
  unmanaged, SECRET). wrangler owns everything a deploy rewrites. It cannot hold Vectorize,
  the R2 custom-domain bindings, the TURN key, or Email Routing settings.
- **Credentials**: three Cloudflare account tokens (terraform / site / workers), their R2 pair,
  and one fine-grained GitHub PAT — inventory and rotation in CICD.md §4.
- **History** was rewritten 2026-09-09 (554 → 153 MB); every earlier sha is gone — re-clone.

## INFRASTRUCTURE.md — index of the long-form reference

Each entry is the bold lead-in of a passage, by section; grep it verbatim to land there.

- **Preamble**: Deploy authorization · Never store sensitive information in this file · Keep this file current · History was REWRITTEN on 2026-09-09 · Repository layout

- **Hosting and delivery**: GitHub Pages serves what `.github/workflows/build.yml` deploys · Cloudflare · THE PUBLISHED PDFs LIVE IN R2, NOT ON PAGES · Deploying the site is a push to `main` · `comments.js` is BUILT from TypeScript now · Cache-busting is AUTOMATIC

- **Build system**: The JS toolchain is npm · Silent build failures are impossible in the resources loops now · The stylesheet is Tailwind · The Lit interior campaign is COMPLETE · The app shell · The sheet owns the scroll while it is open · Nothing scrolls sideways on a phone · Navigation robustness + PWA hardening · The discovery + retention wave · The partials are load-bearing here · Feed/Wall · The readability makeover · DM per-message likes, the quiet bell, and UI sounds · CI builds the site · public · What made CI practical · `make html` with nothing changed went 362 s → 0.08 s · Two CI-specific traps, both silent, both handled in the workflow · Four real bugs the first CI runs surfaced, none of them CI's fault · private shelf · Navigation · Resources · The complete Schaff corpus · Curated extractions from the Schaff volumes · The schism documents · The high-church and Roman-history shelves · Project Gutenberg books · The Latin & Greek classics and Indo-European shelf · The Second Temple shelf · The Douay-Rheims Bible · The Catena Aurea · The King James Bible · The Summa Theologica · The Newman corpus · KJV Scourby audio · The Library page · Deep-linking

- **The PureScript application layer**: The site's application/domain logic IS a PureScript kernel; Lit.js is… · The seam · `app/core.js` is the TRANSLATION MEMBRANE · Toolchain · The `purs` compiler is an npm devDependency · `spago` · `make psbuild` · eslint · `?v=N` law applies to PS exactly as to any bundle change · A slice ships only when all FOUR gates pass · Lit stays presentational · The worker shares the kernel

- **Testing policy**: Tests here exist to CLARIFY what the code does for a human reading the… · `make tests` · Three layers, so a new test has an obvious home · `make tests` must pass before any commit or push · WHEN to add a test

- **Infrastructure as code (Terraform, 2026-09-08)**: THE BOUNDARY IS THE DEPLOY, and it is the whole design · Codifying `bot_management` closes a real trap · The drift the PDF move left is ADOPTED · TERRAFORM RUNS FROM CI NOW · Four things CANNOT be managed, and the reason is the provider, not a… · State lives in R2 · Blast radius

- **Cloudflare Workers (dynamic backend)**: D1 schema changes · Both workers are TypeScript now · The comments worker is a MODULE SET now, not a monolith · `comments-worker/` · Moderation is all in-platform · Direct messages · The member media platform · Perceived speed · The eighth Turnstile finding · The social layer's global kill switch · 1v1 voice calls · In-app notifications · Unread threads, mute, and profile post-history · Post count and rank · Profiles and avatars · Forum full-text search · Post preview and local drafts · merecat, the librarian bot · merecat-local, the GPU backend (retired 2026-09-10) · The Cloudflare free-tier usage monitor · `contact-worker/`
