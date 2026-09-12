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
7. **Workers ship on push** (`workers.yml`: gates → D1 ledger → `wrangler deploy`). **So does the
   librarian's shelf** (`merecat.yml`: waits for the Build, ingests against its `docs/` and the
   private shelf, incrementally, daily resume; `make librarian` is the hand road).
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
Tailwind v4 entry), `app/` (Lit shell + views, TS), `client/` (the classic client: `comments.ts` is the boot — core helpers,
the router, the kit — and `composer.ts` · `profile.ts` · `board.ts` · `wall.ts` · `surface.ts` · `dm.ts` ·
`merecat.ts` · `admin.ts` are feature modules installed per boot; bundled to `docs/comments.js`),
`purescript/src/Domain/*.purs` (the kernel, 31 modules), `comments-worker/`, `contact-worker/`,
`librarian/` (`librarian/private/` is a separate PRIVATE clone — never a submodule, never
committed), `webtest/`, `tests/`, `terraform/`, `.github/workflows/`.

## Build and verify

- **Gates**: `make tests` (unit suite: PureScript, JS, worker, Python, CSS; runs `psbuild`
  first); `make jscheck` (eslint + tsc + psbuild); `make check` (jscheck + linkcheck);
  `make check-pdfs` (bucket vs manifest vs local PDFs; CI runs it with the site token).
- **Build**: `make css` (Tailwind → `docs/style.css`), `make bundle` (purs + esbuild → `app.js`,
  `comments.js`, then the version stamp), `make content` (hand pages), `make writings` (detect the own writings → the generated
  `Domain.Writings`; every psbuild runs it), `make html` (book +
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
  the boot signal. Since 2026-09-11 the boot installs the feature modules (`client/*.ts`, each
  an `install<Feature>(B)` factory) per boot: a module's body is boot-scoped exactly as before,
  its cross-module names are bound from the boot object `B` after every module is installed
  (`bind()`), and what ran at the boot's top level runs in its `run()` — so a module-level
  `var` may not call another module's or a page-scoped helper in its initializer (it is not
  bound yet; the generator deferred such initializers to `run()`), and state more than one
  module writes lives on `B` (`B.quotedSelection` and friends), never in a copied binding. A
  new feature is a new `client/<feature>.ts` factory wired in the root's install list. Page-scoped state stamped on `<html>`/`<body>` must be cleared by the shell
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
- **Comments sections are admin-switched and ship CLOSED** (`comments_pages`, `comments_journal`;
  the rules are `Domain.Comments`, whose polarity is the OPPOSITE of the social switch — only a
  literal `'1'` / a listed path opens anything). A section may stand only under the site's own
  writings, and that list is DETECTED, never kept: `scripts/writings.py` reads every `content/`
  page (unless its frontmatter opts out with `comments: false`) and every book the root Makefile
  builds, and writes the generated, git-ignored `Domain.Writings` on every `psbuild` — a new
  article or book brings its own switch; a library work never; a book target must use
  `book-tail.html` (the detector refuses one without); a path is a storage key, never rename one.
  A closed section answers exactly as an unknown page; a deleted journal article retires its
  comments (`sweepJournalComments`); a switch deletes nothing.
- **D1 schema changes are a NEW `comments-worker/migrations/NNNN_*.sql`** (next: 0015),
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
- **A DM message's acts live on ONE surface**, the press-and-hold (right-click, the hover ⌄, or
  the reaction pill on desktop): react · reply · copy · edit · save · delete — never a link row
  or a ⋯ on the bubble. A reaction is ONE emoji per side per message, validated by
  `Domain.Reaction.normalizeReaction` (re-exported by `Domain.Dm`) on both ends (never
  re-inlined; a custom `:token:` is ours); a
  quoted reply rides INSIDE the E2E plaintext behind `Domain.Dm.replySentinel` — the server
  never learns what answers what, and no `reply_to` column may appear. The surface keeps the
  overlay's three layers through `mcSheet.lock()` and releases only a lock it took. **The
  thread is a chat screen**: a sticky header (avatar · presence · 📞 · ⓘ) and a FIXED
  composer (+ · field · 😊 · mic-or-Send) always in view — fixed, never sticky: a sticky bar
  floats above the tab bar at the document's end, where a thread opens; everything that is not a message
  lives in the ⓘ sheet; the saved mark is a gold ★ and a gold-tinted border, never a ring;
  on a phone the emoji picker and the keyboard never share the screen (opening the picker
  blurs the field; a pick hands the keyboard back). An element toggled by `hidden` needs
  a `[hidden]{display:none}` rule if it carries its own `display`. **A hold picks a
  message, never a word**: under `(hover:none)` the whole chat screen (`section.dm-screen`)
  and the phone chrome are not selectable text, only the fields are; the surface never is;
  opening it drops any selection — iOS anchors a long-press selection in the NEAREST
  selectable text, so a rule on the bubble alone is not enough. **Reading back is never
  interrupted and never blind**: a word that lands while the foot is out of view stays put
  under an "N unread messages" line, the jump button above the composer carries the count,
  and "seen" goes out only for words the reader reached (at the foot as they arrived, or
  when they come down); on open the server names what was unread BEFORE the open
  (`unread`, `unread_from`) and the landing is WhatsApp's (the line under the header when
  the unread words do not fit); typing shows in the header, as a three-dot bubble at the
  foot, and on the inbox row — never for a member who appears offline (the hub's gate,
  `Domain.Presence.isVisible`); the inbox badge is the count.
- **Every unread number is WORDS, from one fragment** (`dmUnreadCount` in the worker's
  `lib.ts`): the inbox row's badge, `/dm/threads`'s `unread_total`, the thread's unread line
  and the tab bar's own `/dm/unread` all sum it — the tab and the rows it opens onto must
  add up, and both roads feed the one `mc-dm-unread` cache. Never re-inline the fragment,
  never let one road count threads.
- **The bottom bar is SIX EQUAL TABS** — no raised hero (a six-item bar cannot centre one).
  Each is `flex: 1 1 0; min-width: 0` with a nowrap, viewport-scaled label: a tab left at
  the default `min-width: auto` lets its longest word refuse to shrink and eat its
  neighbours' width on a narrow phone. A tab carrying a badge says the count in its
  `aria-label` (`badgeLabel`) — a red disc reads as nothing.
- **ONE press-and-hold surface, ONE reaction grammar, ONE bell** (2026-09-12). The surface
  is `client/surface.ts` (`openActs` the overlay — bar · lit hole · acts — `armHold` the
  gestures); the DM, every board post (topic head, reply, article-page comment) and every
  feed post and comment open THAT one — a post through `postMenu` (the ⋯, and the hold it
  arms on `opts.hold`), never a menu of its own. The public reactions are the `reactions`
  ledger (one per member per `post`/`wall`/`wallc` target — a like is the ❤️ reaction, the
  like tables are frozen); tallies ride every served post row (`reacts`), the viewer's own
  ride the keyed `/reacts` after a cached board read; the client's ledger
  (`reactRegister`/`reactSend`) is the one painter, and a reaction goes to the wire only
  through `mcCore.reaction`. A reaction rings `react`/`wall-react`/`dm-react` — coalesced,
  never for your own post, withdrawn with the reaction, and the word is always "reacted".
  The notification list's sentences and doors are `Domain.Notif` (`mcCore.notifLabel` /
  `notifHref`) — never an inline label map again (three had drifted). Under `(hover:none)`
  `.comment` is not selectable text, its fields are: a hold picks a post, never a word.
- **Phones show no footer except on the home tab** (`body.mc-app:not([data-mc-tab="home"]) mc-footer`;
  the shell stamps `data-mc-tab` on every navigation); the footer's information lives in
  Settings → About, a themed dialog (`mcDialog`: the overlay's three layers, Escape taken on the
  window so the sheet under it stays). `FOOTER_LINKS` is the one list — a new footer door goes there.
  Desktop keeps its footers. A chat screen scrolls to ITS foot (`endGap`), never the document's.
  The merecat ask row is the same composer shape; a FIXED bar's `bottom` places its MARGIN edge,
  so a fixed composer carries `margin: 0` in main.css AND in any injected block (which wins).
- **Presence is the hub's word alone**: online is a live socket under mode "auto"
  (`Domain.Presence.isVisible`), and `profiles.last_seen_at` is written by the BoardHub only —
  stamped at a member's last disconnect under "auto", cleared by an auth under "off"
  (`recordsLastSeen`); the mode rides the auth frame, never a column, so no worker handler may
  write the stamp or second-guess it — serving the column as-is IS the privacy rule.
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
  retrieval over three D1 rooms + Vectorize, `librarian/` is its mind; Cloudflare Workers AI is
  its only backend (the GPU twin retired 2026-09-10). Its dials are `Domain.Merecat` (the
  reasoning ladder, temperature, the nine band weights) stored in the librarian D1 `config`
  table: the file-owned ones ride `librarian/config.yml`, the reasoning ones the merecat admin
  page. The band weighting and persona are the owner's standing law — read the merecat passage
  in INFRASTRUCTURE.md before touching anything there. The **AI budget guard**
  (`quota_guard_on`/`_pct`, default on at 95% of the Workers AI day, `comments-worker/src/quota.ts`)
  reads the account's meter through `CF_USAGE_TOKEN` before every ask and mention, admins
  included, rests merecat with the hours until midnight UTC, and stands OPEN when the meter
  cannot be read — a margin, never the wall.
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

- **Cloudflare Workers (dynamic backend)**: D1 schema changes · Both workers are TypeScript now · The comments worker is a MODULE SET now, not a monolith · `comments-worker/` · Moderation is all in-platform · Direct messages · The member media platform · Perceived speed · The eighth Turnstile finding · The social layer's global kill switch · 1v1 voice calls · In-app notifications · Unread threads, mute, and profile post-history · Post count and rank · Profiles and avatars · Forum full-text search · Post preview and local drafts · merecat, the librarian bot · merecat-local, the GPU backend (retired 2026-09-10) · The reasoning dials · merecat is built by the pipeline · The Cloudflare free-tier usage monitor · The AI budget guard · Comments sections are admin-switched, per page and per journal article · The DM press-and-hold surface · The conversation is a chat screen · Phones show no footer except on the home tab · The merecat ask row is the DM composer's shape · About pared to ✕; a swipe dismisses the keyboard; Online/Offline in the thread and on profiles · Sent and received bubbles read apart in every palette · "Last seen …" beside Offline · An unread inbox row draws the eye · Wave F: the classic client is feature modules · A hold picks a message, never a word · Reading back is never interrupted, and never blind · The tab badge counts words, and the bar has no hero · Every post opens the one surface · Admins edit any post · `contact-worker/`
