# Infrastructure reference — the long form

*This is the project's infrastructure memory in full: every design decision and postmortem since July 2026, written as it happened. It was `CLAUDE.md` until 2026-09-09, when the agent rulebook was condensed and this became the reference it points at. Append here, dated, with a **bold lead-in** on each paragraph — `CLAUDE.md` indexes those lead-ins — when a subsystem changes in a way the rules alone would not explain. Where a passage narrates an older state of the pipeline (manual deploys, hand-bumped `?v=` keys, a branch-served Pages site), the rules in `CLAUDE.md` and the procedure in `CICD.md` prevail.*

This file is about how the **website and its infrastructure** work: the GitHub Pages side, the Cloudflare Workers/D1/R2 side, and the build system that ties them together.

If you are working on any text-based content and `CONTEXT_DUMP.txt` is present in the repo root, ingest it first. This file stays focused on infra.

For the **code architecture** — the module map (PureScript kernel → `core.ts` membrane → Lit views; the worker's routes/services/db split), a measured duplication/modularity analysis, the target file tree, and a newcomer reading order — see **`docs/architecture/CODEBASE.md`**. Keep it current when the module structure changes (a monolith split, a new seam), the same way you keep this file current for infra. For **how work ships** — the four workflows, the approval gate, every credential, the exceptions and the traps — see **`docs/architecture/CICD.md`**, kept current the same way whenever a workflow, secret or make target it names changes.

**Deploy authorization (standing).** For this repo the owner has granted standing, unconditional permission to ship: commit, `git push`, deploy the comments/contact Workers (`make worker-deploy`), apply D1 migrations, and purge the Cloudflare edge — as many production pushes per session as the work needs, **without asking each time.** When a task is done and verified, ship it (**run `make tests` — it must pass — and `make jscheck` after any worker/client JS edit**, commit, push, then report what shipped). **Since 2026-09-09 the push IS the deploy for everything**: `build.yml` builds and deploys the site, publishes rebuilt PDFs to R2 and purges the edge; `workers.yml` applies the D1 ledger and deploys the workers when their sources change; `terraform.yml` plans every `terraform/**` change and applies from `main` behind the `terraform-production` approval gate — **approve it yourself with `scripts/ci_approve.sh <run-id> --approve`** after reading the plan summary it prints (that is the standing review-and-approve capability; a human presses *Review deployments* on the run instead). `?v=` keys are stamped by the build, never bumped by hand. `make worker-deploy` and `make publish-pdfs` survive as the manual/emergency roads; procedure, inventory and traps: `docs/architecture/CICD.md`. Do NOT end a turn asking "want me to push/deploy?" — just do it. The only standing exceptions: **never** add Claude/AI attribution to commit messages (commits are authored solely as the owner), and give a heads-up before genuinely destructive or irreversible acts beyond a normal deploy (dropping a database, force-pushing history, deleting a bucket).

**CI/CD IS THE ROAD — standing rules (2026-09-09). The full runbook is `docs/architecture/CICD.md`: read it before deploying, changing infrastructure, or touching a credential, and keep it current in the same change that alters a workflow, a secret or a make target it names.** The rules, compressed: (1) **push is the deploy** — `main` is production; a branch or PR gets the gates without the deploy. (2) **CI is the build of record** — the site artifact, the worker bundle and the PDFs in R2 are what the runner built; a local build previews and runs gates, its bytes do not ship (a local PDF will read as "differs" — that is the dev box, not a reason to upload). (3) **No secret is ever present on a `pull_request` event**, in any workflow — a PR's code and HCL are executed by the gates. (4) **Infrastructure is declared, never clicked**: Cloudflare and GitHub settings live in `terraform/`; a change is a push, the apply waits on the `terraform-production` gate — review the plan summary and approve with `scripts/ci_approve.sh <run-id> --approve "why"` (a human presses *Review deployments*). Something made by hand gets an `import` block in the same change, or a written exception. (5) **Never a destroy or replace from CI** — the plan fails on any delete; only a `workflow_dispatch` with `allow_destroy=true` gets past. (6) **Workers ship on push** (`workers.yml`: gates → D1 ledger → `wrangler deploy`); `make worker-deploy` is the emergency road; `wrangler secret put` is the only home for worker secrets. (7) **Never hand-edit or commit the generated half of `docs/`**, never bump a `?v=` by hand, never fetch a fresh `?v=N` mid-deploy. (8) **Every `uses:` is SHA-pinned** (the repo requires it; Dependabot bumps by PR); scanning + push protection are on. (9) **The exceptions are enumerated** (runbook §10) — if a manual act is not on that list, it is drift. (10) **Verify, don't assume**: `gh run list`, `terraform plan` → *No changes*, `publish_pdfs.py --check`, `version.json?probe=…`.

**Never store sensitive information in this file** (or anywhere committed): no API tokens, secrets, private keys, or unpublished credentials. Cloudflare Worker secrets are set with `wrangler secret put`, not in source. The identity hashes and Turnstile sitekeys that do appear in the repo are public by design.

**Keep this file current.** When infrastructure changes in an important way — a hosting or DNS pivot, a new or retired Worker, a change to how builds or deploys run, a plan or quota policy change — update this file in the same change. **Keep `README.md` current too:** it is the human-facing "how it all works" (repo layout, hosting, the full build pipeline with usage examples, the Cloudflare free-tier resources, the license). When a change here would make the README wrong — a moved directory, a new/renamed build target, a hosting or resource change — update the README in the same change.

**History was REWRITTEN on 2026-09-09** (owner-authorised; full backup at `/home/grok/repos/merecatholicity.com-backup`): every generated artifact that ever sat at the repo root or under `docs/` — the ~263 corpus/content pages, all published PDFs, the bundles, `style.css`, the Bible JSON, `version.json`, the manifests and the Logos docx — was stripped from every commit with `git filter-repo` (1,038 exact paths: each of the 263 generated page names and 246 PDF names at both the old root and `docs/`, plus the bundles/CSS/JSON/manifest names), leaving sources, hand pages and images untouched and the HEAD tree byte-identical (verified by tree sha before and after). **The pack went 553.9 MB → 153.1 MB**, and 637 commits became 587 — the fifty that vanished had touched nothing but generated output and were empty once it was gone. **Every commit sha from before that day is gone**; any clone from before it must be re-cloned (`git pull` will not converge). Nothing at HEAD changed. The strip list, the analysis and the commit map are in the backup's `.git/filter-repo/`. Do not do this casually: it is a deliberate, backed-up, owner-authorised act, and the reason the generated half of `docs/` must never re-enter git.

**Repository layout (2026-07-30 reorg).** The repo root holds ONLY the tool-convention files that MUST sit at root: `Makefile`, `eslint.config.js` (eslint auto-discovers flat config at root), **`package.json` + `package-lock.json`** (the npm project — restored with `npm ci`; `node_modules/` is git-ignored), `.gitignore`, `README.md`, `CLAUDE.md`, `LICENSE*`. Everything else is in a directory that names it: **`docs/` is the served site** (GitHub Pages serves this folder at the domain root — see Hosting); `book/` = our book's LaTeX sources + `build-confession.sh` (builds run inside `book/`); `scripts/` = the Python build tooling + its data (`nav.py`, `content.py`, `linkcheck.py`, `toc-prune.py`, and **`nav.yml`** — the site-menu source, read by nav.py from beside itself); `partials/` = the pandoc include-fragments (`nav.html` [generated], `footer.html`, `social.html`, `book-tail.html`); `content/`, `styles/`, `app/`, `vendor/`, `resources/`, `comments-worker/`, `contact-worker/`, `librarian/`, `webtest/` as before; **`terraform/`** = infrastructure as code (see the Terraform section under Cloudflare Workers). `resources/` has its own `.gitignore` for its converted-corpus churn. **`docs/` is the served folder, and it is a MIXTURE — the distinction is load-bearing (2026-09-08).** Most of it is BUILT OUTPUT that no longer lives in git: the ~250 corpus pages, `app.js`, `comments.js`, `style.css`, `version.json`, `sitemap.xml`, `kjv.json`/`dr.json`, `library-order.json`, `pdfs.txt`. Never hand-edit any of those — edit the source and rebuild. But `docs/` ALSO holds ~297 files of HAND-MAINTAINED SOURCE that live nowhere else and stay committed: `nav.js`, `sw.js`, `deeplink.js`, `index.js`, `flash.js`, `contact.js`, `away.js`, `bible-reader.js`, the vendored `tweetnacl.min.js`/`lamejs.min.js`/`qr.min.js`, `turnstile.html`, `CNAME`, `.nojekyll`, every image, `emoji/emoji-data.json` and `avatars/presets/index.json`, and the **fifteen hand-written pages** (`index`, `community`, `messages`, `profile`, `feed`, `admin`, `merecat-ai`, `journal`, `contact`, `away`, `hours`, `the-book`, `where-to-begin`, `turnstile`, the Google verification file) plus the two Bible landing pages (`kjv.html`, `douay-rheims.html`). A blanket `docs/` ignore deleted those and broke the build twice; the `.gitignore` lists only the generated set and explains why, and **`tests/py/test_docs_sources.py` fails if a new hand page is not added to it.** A clean clone therefore has the sources but not the built pages — `make html` builds them, and CI caches the result between runs.

The passages themselves live in `docs/architecture/log/YYYY-MM.md`, one file per month, each opening with a
**bold lead-in** — grep it there. The index below is generated (`scripts/infra_index.py --write`); a new
passage is appended to the current month's file under its section heading, wrapped at 100 columns.

## Hosting and delivery

## Build system

Builds are pinned to `SOURCE_DATE_EPOCH=1784160000` so rebuilds are byte-identical and git only
churns when text actually changes. Built artifacts are committed **into `docs/`** (the served
folder); the build tools read sources from `book/`, `content/`, `resources/`, `partials/`,
`styles/`, `app/` and write into `docs/`. The book PDFs/HTML/docx build **inside `book/`** (the
Makefile `cd book &&`s, so `\input` and `\graphicspath{{../docs/}}` resolve locally) and only the
final artifact is copied up into `docs/`.

## The PureScript application layer

## Testing policy

## Verifying the live site (headless browser)

`make check` (linkcheck) is the static-file gate, and **`make tests`** is the hermetic unit gate
(see the Testing policy above). Anything that depends on **client JS actually running** — anchor
jumps, pagination-aware scroll-to-comment, board/DM rendering — cannot be verified with either, only
with a real browser. A headless Chromium is preinstalled at `~/.cloakbrowser`: several
`chromium-<version>/` dirs, each holding a matching `chrome` and `chromedriver`. There is no
node/npm, so drive it through chromedriver's WebDriver HTTP API using Python stdlib only:

- Launch `~/.cloakbrowser/chromium-<ver>/chromedriver --port=N` in the background; poll `GET
  /status` until ready.
- `POST /session` with `capabilities.alwaysMatch.goog:chromeOptions.binary` set to the sibling
  `chrome`, args `--headless=new --no-sandbox --disable-gpu --disable-dev-shm-usage
  --window-size=1200,800 --user-data-dir=<scratchpad>`. Pair `chrome` and `chromedriver` from the
  **same** version dir or the session refuses to start.
- `POST /session/<id>/url` to navigate (full URL including the `#comment-N` hash), then poll `POST
  /session/<id>/execute/sync` running a JS probe until the async board fetch has rendered, and read
  back DOM facts (element presence, `.board-pages strong` = active page, `window.scrollY`,
  `getBoundingClientRect().top`).
- Always `DELETE /session/<id>` and SIGTERM chromedriver when done.

This catches what curl cannot: e.g. that `community.html?topic=<t>#comment-<id>` resolves to the
correct page and scrolls to the comment. (The client sends `&find=<id>` only when there is no
explicit `&p`; the worker then counts prior live replies to compute the page. A bare `Math.max(1,
…)` default for the page number silently disables this — the page defaults to 1 and the jump strands
on page one.)

## Infrastructure as code (Terraform, 2026-09-08)

## Cloudflare Workers (dynamic backend)

<!-- infra-index:start (generated by scripts/infra_index.py --write; do not edit by hand) -->

## Index of the passages (by section; each names its month's file — grep the bold lead-in there)

### Hosting and delivery

- **GitHub Pages serves what `.github/workflows/build.yml` deploys — an ARTIFACT, not a branch (since 2026-09-08).** — `log/2026-09.md`
- **The platform reviewed whole, and the finding is the gap between the machine and its use (2026-09-17).** — `log/2026-09.md`
- **The app reloaded itself because the edge rewrites every page it serves (2026-09-17).** — `log/2026-09.md`
- **An article page asks before it pays: the comments client is fetched only where a section is actually open (2026-09-18).** — `log/2026-09.md`
- **The paintings are in the cache before the finger arrives, and the lazy load that put them there is untouched (2026-09-18).** — `log/2026-09.md`
- **The meter was installed in July and measured nothing, because the thing that installs it had been deleted (2026-09-18).** — `log/2026-09.md`
- **A volume is a shelf now: ninety-one pages over a megabyte become an index and ten thousand readable ones (2026-09-18).** — `log/2026-09.md`
- **A reading page waits for the shell; it does not wait on it (2026-09-18).** — `log/2026-09.md`
- **Two changes of the same day meet on two pages, and a scroll is what settles it (2026-09-18).** — `log/2026-09.md`

### Build system

- **The JS toolchain is npm (2026-07-31) — deno is GONE.** — `log/2026-07.md`
- **The stylesheet is Tailwind (v4, CSS-first) since 2026-07-31 — single-sourced from `styles/main.css`.** — `log/2026-07.md`
- **The Lit interior campaign is COMPLETE (2026-07-30): every READ view on the site is a reactive Lit component.** — `log/2026-07.md`
- **The app shell (Lit) — THE DEFAULT EXPERIENCE since 2026-07-30.** — `log/2026-07.md`
- **The high-church and Roman-history shelves** — `log/2026-07.md`
- **The Latin & Greek classics and Indo-European shelf** — `log/2026-07.md`
- **The Second Temple shelf** — `log/2026-07.md`
- **Navigation robustness + PWA hardening (2026-08-02).** — `log/2026-08.md`
- **The discovery + retention wave (2026-08-02, owner-approved H1–H3 + all mediums from the platform review).** — `log/2026-08.md`
- **The PWA self-update architecture (2026-08-02, sw VERSION v4 — born of a live report: an installed iOS app ran days-old code with no path to healing, and a freshly re-added one rendered tab skeletons with no content).** — `log/2026-08.md`
- **Feed/Wall — Facebook-style overhaul (2026-08-02, shipped with the robustness wave above; verified via headless synthetic-fixture tests, API mocked).** — `log/2026-08.md`
- **The readability makeover (P0–P4, 2026-08-03) — the merecat standard applied to the whole platform.** — `log/2026-08.md`
- **DM per-message likes, the quiet bell, and UI sounds (2026-08-03).** — `log/2026-08.md`
- **The sheet owns the scroll while it is open (2026-09-09).** — `log/2026-09.md`
- **Nothing scrolls sideways on a phone (2026-09-09).** — `log/2026-09.md`
- **The partials are load-bearing here (added 2026-09-05):** — `log/2026-09.md`
- **CI builds the site (2026-09-08) — `.github/workflows/build.yml`.** — `log/2026-09.md`
- **What made CI practical: the build is incremental now.** — `log/2026-09.md`
- **Two CI-specific traps, both silent, both handled in the workflow:** — `log/2026-09.md`
- **WHAT CI/CD OWNS, AND THE EXCEPTIONS (the owner's standing rule since 2026-09-09: everything through the pipeline as far as is sane, every exception written down).** — `log/2026-09.md`
- **Four real bugs the first CI runs surfaced, none of them CI's fault:** — `log/2026-09.md`
- **Navigation** — `log/2026-09.md`
- **Resources** — `log/2026-09.md`
- **The complete Schaff corpus** — `log/2026-09.md`
- **Curated extractions from the Schaff volumes** — `log/2026-09.md`
- **The schism documents** — `log/2026-09.md`
- **Project Gutenberg books** — `log/2026-09.md`
- **The Douay-Rheims Bible** — `log/2026-09.md`
- **The Catena Aurea** — `log/2026-09.md`
- **The King James Bible** — `log/2026-09.md`
- **The Summa Theologica** — `log/2026-09.md`
- **The Newman corpus** — `log/2026-09.md`
- **KJV Scourby audio** — `log/2026-09.md`
- **The Library page** — `log/2026-09.md`
- **Deep-linking (`deeplink.js`).** — `log/2026-09.md`
- **The long-form reference is a monthly log with a generated index (2026-09-16)** — `log/2026-09.md`
- **CLAUDE.md compacted: the laws in full (2026-09-16)** — `log/2026-09.md`
- **The corpus sources ride a GitHub Release, not git (2026-09-16)** — `log/2026-09.md`
- **The compiler comes by pinned hash, and the npm toolchain is watched (2026-09-17)** — `log/2026-09.md`
- **One owner for every share card, and a card that says which page it is (2026-09-17)** — `log/2026-09.md`
- **The metadata every page owes a reader who is not us (2026-09-18).** — `log/2026-09.md`
- **The runner's pandoc calls the footnotes something else, and the split shipped 358,049 dead marks to the link checker (2026-09-18).** — `log/2026-09.md`
- **The seven page scripts were shipping as hand-written source, and now ship minified (2026-09-18).** — `log/2026-09.md`
- **Key rotation: the P0 chain's last piece, and the escape hatch the weak-key floor needed (2026-09-18)** — `log/2026-09.md`

### The PureScript application layer

- **The site's application/domain logic IS a PureScript kernel; Lit.js is strictly the render layer, and JS is interop only (DOM, effects, crypto).** — `log/2026-09.md`
- **The seam.** — `log/2026-09.md`
- **`app/core.js` is the TRANSLATION MEMBRANE — the ONE audited place types are erased.** — `log/2026-09.md`
- **Toolchain (npm-12 + byte-determinism + no-globals safe).** — `log/2026-09.md`
- **A slice ships only when all FOUR gates pass:** — `log/2026-09.md`
- **Lit stays presentational.** — `log/2026-09.md`
- **The worker shares the kernel — DONE.** — `log/2026-09.md`
- **The review's "two UIs" was stale; nine comments still said "no-bundle fallback" (2026-09-17)** — `log/2026-09.md`
- **The read transport leaves the boot, and the shell stops waiting for the client it serves (2026-09-18).** — `log/2026-09.md`
- **The edge injects a DIFFERENT token into a browser's copy, and the first fix met only half of it (2026-09-18).** — `log/2026-09.md`
- **The frozen twins are deleted, and the kernel is the only copy that runs (2026-09-18).** — `log/2026-09.md`
- **Every dark theme's small print failed AA, and the surface to measure against is the card, not the page (2026-09-18).** — `log/2026-09.md`
- **Four view modules leave the shell, and the budget that should have noticed learns to add (2026-09-18).** — `log/2026-09.md`

### Testing policy

- **Tests here exist to CLARIFY what the code does for a human reading the repo, and to GUARD the rules that would break silently — not to chase coverage.** — `log/2026-09.md`
- **`make tests`** — `log/2026-09.md`
- **Three layers, so a new test has an obvious home.** — `log/2026-09.md`
- **`make tests` must pass before any commit or push (standing gate).** — `log/2026-09.md`
- **WHEN to add a test (the standing rule for future work).** — `log/2026-09.md`
- **The nightly report goes out as a browser (2026-09-17)** — `log/2026-09.md`
- **A sweep that asserts absence must prove its reach (2026-09-17)** — `log/2026-09.md`
- **Every answer keeps its committed shape, and the lists the wire promises are kept at both ends (2026-09-17)** — `log/2026-09.md`
- **The nightly's browsers filled a RAM-backed /tmp, and every tab crashed (2026-09-17)** — `log/2026-09.md`
- **A route ships alone, is documented by calling it, and is read by a security review first (2026-09-17)** — `log/2026-09.md`
- **A fresh open painted last visit's unread count, and now paints none (2026-09-17)** — `log/2026-09.md`
- **A phone's first paint is already the app, so a cold open stops looking like a reload (2026-09-17)** — `log/2026-09.md`
- **The two fixed bars ride their own bundle, ahead of the shell (2026-09-17)** — `log/2026-09.md`
- **The hop is the one leg of the split that only a browser can check (2026-09-18).** — `log/2026-09.md`

### Infrastructure as code (Terraform, 2026-09-08)

- **`terraform/` holds the DURABLE infrastructure, adopted by import from what already existed — Terraform did not create any of it, and the adopting apply changed nothing (`40 to import, 0 to add, 0 to change, 0 to destroy`).** — `log/2026-09.md`
- **THE BOUNDARY IS THE DEPLOY, and it is the whole design.** — `log/2026-09.md`
- **Codifying `bot_management` closes a real trap** — `log/2026-09.md`
- **The drift the PDF move left is ADOPTED (2026-09-09)** — `log/2026-09.md`
- **TERRAFORM RUNS FROM CI NOW — `.github/workflows/terraform.yml` (2026-09-09).** — `log/2026-09.md`
- **Four things CANNOT be managed, and the reason is the provider, not a preference:** — `log/2026-09.md`
- **State lives in R2** — `log/2026-09.md`
- **Blast radius:** — `log/2026-09.md`
- **Every bucket's r2.dev URL is off, and declared (2026-09-17)** — `log/2026-09.md`
- **An adoption that plans an update every run is a red gate for everybody, not an open item for somebody (2026-09-18).** — `log/2026-09.md`
- **The browser was re-fetching 641 KiB of unchanged bytes every ten minutes, and the fix is one day, not one year (2026-09-18).** — `log/2026-09.md`

### Cloudflare Workers (dynamic backend)

- **Both workers are TypeScript now (Phase 2D, 2026-08-01).** — `log/2026-08.md`
- **The comments worker is a MODULE SET now, not a monolith (Phase 3–4, 2026-08-01).** — `log/2026-08.md`
- **Two of the six leaked credentials are deliberately not rotated, on measured grounds (2026-09-18)** — `log/2026-09.md`
- **The Turnstile meter asked for a month of a dataset Cloudflare serves a week at a time (2026-09-17)** — `log/2026-09.md`
- **D1 schema changes (comments DB) go through `wrangler d1 migrations` now — NOT a hand-edited `schema.sql`.** — `log/2026-09.md`
- **The worker's sibling imports name `.ts` files, and only `durable.ts` imports `cloudflare:workers` (2026-09-16).** — `log/2026-09.md`
- **Worker handlers run in the unit suite (2026-09-16).** — `log/2026-09.md`
- **The handlers live in `routes/*` now (2026-09-16).** — `log/2026-09.md`
- **One UI: the classic twins of the Lit screens are gone (2026-09-16).** — `log/2026-09.md`
- **The DM client is six factories (2026-09-16).** — `log/2026-09.md`
- **The bindings are typed and the DM wire shapes have a home (2026-09-16).** — `log/2026-09.md`
- **`comments-worker/`** — `log/2026-09.md`
- **Every post opens the one surface: reactions on the board and the feed, and the bell that says "reacted" (2026-09-12).** — `log/2026-09.md`
- **Admins edit any post (2026-09-12).** — `log/2026-09.md`
- **DMs are never AI-screened (2026-09-12, locked).** — `log/2026-09.md`
- **A profile picture pops out full size (2026-09-12).** — `log/2026-09.md`
- **The keyboard shackle (2026-09-12).** — `log/2026-09.md`
- **The keyboard shackle, second look: the region minus the site's own chrome, and the browser's late scroll answered (2026-09-12).** — `log/2026-09.md`
- **The keyboard shackle, third look: the editor is what is placed, and a DM is edited in the composer (2026-09-12).** — `log/2026-09.md`
- **The ring that reaches a closed app, and the miss recorded once (2026-09-12).** — `log/2026-09.md`
- **The call log: every call leaves one event line (2026-09-13).** — `log/2026-09.md`
- **Haptics (2026-09-12).** — `log/2026-09.md`
- **Badges everywhere, and reading marks read (2026-09-12).** — `log/2026-09.md`
- **The hole above the chat header (2026-09-12).** — `log/2026-09.md`
- **Media hygiene: every delete takes its media (2026-09-12).** — `log/2026-09.md`
- **The fixed chrome answers the finger, not the platform's click (2026-09-13).** — `log/2026-09.md`
- **One member model, envelope v2, and the object that outlives its message (2026-09-13).** — `log/2026-09.md`
- **Multi-member conversations and forwarding (2026-09-13).** — `log/2026-09.md`
- **Who has read, in a group (2026-09-15).** — `log/2026-09.md`
- **`contact-worker/`** — `log/2026-09.md`
- **The worker can speak: alerts by email and Discord, both from Platform settings (2026-09-16)** — `log/2026-09.md`
- **Backups are daily and verified, and every cron is a chain that cannot lose a step (2026-09-16)** — `log/2026-09.md`
- **Rollback is a drilled road, a staged rollout is a switch, and the watchdog has an outside leg (2026-09-16)** — `log/2026-09.md`
- **The four nits (2026-09-16)** — `log/2026-09.md`
- **The handler preambles are one function with the variance as options (2026-09-16)** — `log/2026-09.md`
- **One road registers a member, and the directory lists members (2026-09-16)** — `log/2026-09.md`
- **Additive is not forever: the retirement cadence and its tripwire (2026-09-16)** — `log/2026-09.md`
- **The CSP has somewhere to report (2026-09-16)** — `log/2026-09.md`
- **The key is the account, said plainly; and the bundles have a budget (2026-09-16)** — `log/2026-09.md`
- **The classic client is split: three lazy chunks, and a reader of a KJV chapter no longer downloads the admin console (2026-09-16)** — `log/2026-09.md`
- **A declared count is shown, never told (2026-09-16)** — `log/2026-09.md`
- **The live hub is sharded, and every operation inside a shard is the size of its audience (2026-09-17)** — `log/2026-09.md`
- **A rotated push key is followed on the next app OPEN, not the next Settings visit (2026-09-17)** — `log/2026-09.md`
- **The rotation after the disclosure: four of six done by the agent, two need the owner (2026-09-17)** — `log/2026-09.md`
- **The shell is an ES module: the port's frame, half of P0 (2026-09-17)** — `log/2026-09.md`
- **The worker's handlers take the real `Env` (2026-09-17)** — `log/2026-09.md`
- **A public endpoint served the worker's whole env for six weeks (2026-09-17)** — `log/2026-09.md`
- **Four ceilings lifted in one change: replicas for the reads, presence only where it is watched, limits per member, and a librarian that stops counting its shelf (2026-09-17)** — `log/2026-09.md`
- **Nothing the worker holds in secret leaves it: the env is sealed and every answer is scanned (2026-09-17)** — `log/2026-09.md`
- **The category and page feeds answered 500 whenever they held a reply (2026-09-17)** — `log/2026-09.md`
- **The Turnstile test bypass is retired, not rotated (2026-09-17)** — `log/2026-09.md`
- **The pipeline holds no key (2026-09-17)** — `log/2026-09.md`
- **The TURN relay switches itself off near the end of its free pool (2026-09-17)** — `log/2026-09.md`
- **The workers hold no `any`, and the env's type refuses to be an answer (2026-09-17)** — `log/2026-09.md`
- **The challenge was asking nobody anything: established now means a challenge was passed (2026-09-17)** — `log/2026-09.md`
- **Somewhere to go: a thread is a page now (2026-09-17)** — `log/2026-09.md`
- **The roster stops being an anonymous read: the first of the P0's three layers (2026-09-18)** — `log/2026-09.md`
- **A real floor under the key, refused server-side: the P0's second layer (2026-09-18)** — `log/2026-09.md`
- **The public id, egress-complete behind a valve: layer three begins (2026-09-18)** — `log/2026-09.md`
- **The librarian spent the account's whole day of D1 writes in six minutes, and a worker deploy died wearing somebody else's name (2026-09-18).** — `log/2026-09.md`
- **The pubid flip, ingress and client — the round trip closes (2026-09-18)** — `log/2026-09.md`
- **The pubid needs no D1 write: the stored column becomes a read-built map, so the flip deploys with the write budget spent (2026-09-18)** — `log/2026-09.md`
- **The public id is LIVE: layer three activated and verified in production (2026-09-18)** — `log/2026-09.md`
- **The scheduled activation fired stale and was a safe no-op — the pepper was NOT re-set (2026-09-18)** — `log/2026-09.md`
- **The shelf now asks how much of the day is left before it spends it (2026-09-19)** — `log/2026-09.md`
- **The reader became a stranger to their own conversation: one variable doing two jobs after the L3 flip (2026-09-19)** — `log/2026-09.md`
- **The pseudonym is minted from an id too, and key ORDER decided which one (2026-09-19)** — `log/2026-09.md`
- **Two rings on one screen: the placeholder was never singular, only assumed to be (2026-09-19)** — `log/2026-09.md`
- **The hub routed into space: the one egress `cloakIds` never sees (2026-09-19)** — `log/2026-09.md`
- **A rule kept in one half is not a rule (2026-09-19)** — `log/2026-09.md`
- **The server says which member is you, and which words are yours (2026-09-19)** — `log/2026-09.md`

<!-- infra-index:end -->
