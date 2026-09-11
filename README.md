# Mere Catholicity

Source and infrastructure for **[merecatholicity.com](https://merecatholicity.com)** — a
static theological site with a small dynamic backend on Cloudflare's free tier.

It hosts our own book (*Mere Catholicity*) in several editions, a large library of
public-domain Christian and classical texts we re-typeset from source, a community
forum with end-to-end-encrypted, self-destructing direct messages (with encrypted media) and notifications, and **merecat**, a retrieval-augmented
librarian chatbot that answers from the library.

The whole reading experience is a static site (fast, no-JS-readable, indexable) that a
Lit-based app shell progressively upgrades into a single-page app. Everything dynamic —
comments, the forum, DMs, the bot — is delegated to Cloudflare Workers so the site itself
stays free to serve.

> **New to the code?** Read
> **[`docs/architecture/CODEBASE.md`](docs/architecture/CODEBASE.md)** for the module
> map + measured modularity analysis. This README is *how it's built*; CODEBASE.md
> is *how it's structured*.

---

## Table of contents

- [Repository layout](#repository-layout)
- [How the site is hosted and served](#how-the-site-is-hosted-and-served)
- [The build system](#the-build-system) — how everything is generated
  - [Prerequisites](#prerequisites)
  - [Our book](#our-book)
  - [The content pages](#the-content-pages)
  - [The library (all the other books)](#the-library-all-the-other-books)
  - [Navigation, styles, and the app shell](#navigation-styles-and-the-app-shell)
  - [Verifying a build](#verifying-a-build)
  - [Continuous integration](#continuous-integration)
  - [`make` target reference](#make-target-reference)
- [The dynamic backend (Cloudflare, free tier)](#the-dynamic-backend-cloudflare-free-tier)
  - [Storage: D1, R2, Vectorize](#storage-d1-r2-vectorize)
  - [merecat, the librarian](#merecat-the-librarian)
  - [Deploying the workers](#deploying-the-workers)
  - [Infrastructure as code (Terraform)](#infrastructure-as-code-terraform)
- [Setup from a fresh clone](#setup-from-a-fresh-clone)
- [Cookbook](#cookbook) — common tasks, with examples
- [License](#license)

---

## Repository layout

The repo root holds only configuration, docs, and licenses. Everything else lives in a
directory that says what it is. **The served website is `docs/`** — see the next section.

```
docs/            THE SERVED SITE — what CI packages and deploys to GitHub Pages, so
                 docs/credo.html is https://merecatholicity.com/credo.html. It is a
                 MIXTURE, and the difference matters. MOST of it is BUILT OUTPUT and is
                 NOT in git: the ~250 corpus pages, app.js, comments.js, style.css,
                 version.json, sitemap.xml, kjv.json/dr.json. Never hand-edit those —
                 edit the source and rebuild. But ~297 files here are HAND-MAINTAINED
                 SOURCE that live nowhere else and stay committed: nav.js, sw.js,
                 deeplink.js and the other page scripts, the vendored libraries,
                 turnstile.html, every image, emoji/ and avatars/, CNAME, .nojekyll,
                 and the 17 hand-written pages (index, community, feed, profile,
                 messages, admin, merecat-ai, journal, contact, away, hours, the-book,
                 where-to-begin, turnstile, kjv, douay-rheims, the Google verification
                 file). .gitignore lists only the generated set and says why; a NEW
                 hand page must be added there or tests/py/test_docs_sources.py fails.
                 The PDFs are NOT here any more — they live in R2 (see Hosting).
                 A fresh clone has the sources but not the built pages: `make html`.

book/            Our book's LaTeX sources + its build script:
                 confession.tex (the book), memorandum-body.tex + bishop-presbyter*.tex
                 (the companion paper), build-confession.sh. Builds run in here.

content/         Source for the rarely-changing prose pages (credo, about, the prayer
                 pages, catalogs, …) as <slug>.md or <slug>.html with YAML frontmatter.
                 Built into docs/ by scripts/content.py.

resources/       The library engine. *2tex.py converters turn preserved public-domain
                 sources (*-src.html, *-thml.xml, docs-src/, catena-src/, …) into
                 *-body.tex, and its own Makefile renders ~200 works to docs/*.html and
                 docs/*.pdf. Has its own .gitignore (the fetched/generated churn).

scripts/         Site build tooling + its data: nav.py (menus) with nav.yml (the
                 site-menu source it reads), content.py (content pages), writings.py
                 (the detected own writings → the generated Domain.Writings),
                 stamp_versions.py (the ?v= keys), linkcheck.py (link/anchor checker),
                 gen_sitemap.py, publish_pdfs.py (the R2 PDFs), toc-prune.py (book TOC
                 trim), ci_approve.sh + tf_plan_summary.py (the Terraform gate).

partials/        Pandoc include-fragments shared across pages: nav.html (generated by
                 nav.py), footer.html, social.html + social-bishop.html (og/twitter meta),
                 book-tail.html (the tail every book target must include).

styles/          Tailwind CSS source — the single file main.css (the tailwind theme +
                 utilities imports, the design tokens as @theme, the reading `prose`
                 surface, and all the component CSS). Tailwind builds it into
                 docs/style.css. (The old styles/NN-*.css split was inlined into
                 main.css and retired 2026-07-31.)

app/             The Lit app shell (shell.ts + views/ + store.ts + api.ts + richtext.ts),
                 bundled by esbuild into docs/app.js. Lit is an npm dependency (imported
                 as 'lit'), bundled into app.js — same-origin, so the CSP is satisfied.

client/          The classic client: comments.ts (the boot — page state, the core helpers,
                 the router, the mcKit bridge) installs composer · profile · board · wall ·
                 dm · merecat · admin.ts per boot; esbuild bundles it all into docs/comments.js.

purescript/      The kernel: src/Domain/*.purs (29 modules — the rules the client and the
                 worker both import), spago.yaml; output/ is generated by `make psbuild`.

comments-worker/ Cloudflare Worker: comments, forum, DMs, notifications, profiles,
                 moderation, AND merecat. Routes /api/comments* and /api/merecat*.
contact-worker/  Cloudflare Worker: the contact form (contact-api.merecatholicity.com).

terraform/       Infrastructure as code for the DURABLE infrastructure only: DNS, zone
                 policy, the edge header/firewall/rate-limit rulesets, R2 buckets, D1
                 databases, Turnstile widgets, and both GitHub repos. Deliberately does
                 NOT touch anything wrangler deploys. State lives in R2, never in git.

librarian/       merecat's "mind": works.yml (the corpus manifest), persona.md,
                 config.yml, ingest.py (builds + pushes the RAG corpus). librarian/private/
                 is a SEPARATE private repo cloned into place (never committed here).


webtest/         Headless-Chromium verification harness (audit.py + flows.py + test_*.py).
tests/           The unit suite (`make tests`): PureScript + JS via `node --test`,
                 Python + CSS invariants via stdlib `unittest`. One file per concern.

Makefile         The build entrypoint (`make …`); scripts/nav.yml is the site-menu source.
eslint.config.js Lints what is still JS (the worker's pure.js/webpush.js, the served page
                 scripts); tsc covers every .ts (root by eslint convention).
package.json     npm project: the dev toolchain (Tailwind, esbuild, eslint, wrangler),
package-lock.json  the app's UI library (lit, bundled into app.js), and the build/lint
                 scripts. Restored per-project with `npm ci`; never global.
```

---

## How the site is hosted and served

- **GitHub Pages serves an ARTIFACT built by CI, not a branch** (since 2026-09-08; the
  Pages source is `build_type: workflow`). `.github/workflows/build.yml` builds `docs/`,
  gates it, packages it and deploys it, published at the folder's contents = the domain
  root. So `docs/index.html` is the homepage, `docs/kjv.html` is `/kjv.html`,
  `docs/emoji/…` is `/emoji/…`. There is still **no server-side build** — Pages serves the
  artifact as-is — but there is one in CI, and it is the only one. `docs/.nojekyll`
  disables Jekyll; `docs/CNAME` binds the custom domain, and the workflow refuses to
  package an artifact missing either, because losing CNAME from the served location once
  unbound the domain and 404'd the entire site.
- **Cloudflare** sits in front of Pages as DNS + CDN + edge proxy, and it also routes the
  Worker paths (`/api/*`) so the dynamic backend is **same-origin** with the site (no CORS).
  Leave the SSL mode as-is — the working configuration is deliberate.
- **The 244 published PDFs are served from R2, not Pages** (2026-09-08). `docs/` had
  reached **621 MB against a hard 1 GB Pages limit**, and 293 MB of it was PDFs; the site
  is 327 MB now. They live in the `merecatholicity-files` bucket behind
  `files.merecatholicity.com`, and a Cloudflare **dynamic redirect** 301s `/<name>.pdf`
  there — so pages still link plain `href="Mere_Catholicity.pdf"` and **every URL ever
  shared still works**. `docs/*.pdf` is git-ignored. `docs/pdfs.txt` (`make pdf-manifest`)
  lists what is published, and `scripts/linkcheck.py` checks every `.pdf` href against it,
  since the files are no longer on disk to look for. CI holds `docs/*.pdf` back from the
  Pages artifact — they had been riding along whenever a run rebuilt them (400 MB with,
  113 MB without), which re-inflated the artifact the move was meant to shrink.
  **Publishing is automated and verified** (`scripts/publish_pdfs.py`): `make publish-pdfs`
  uploads only the local PDFs whose MD5 differs from the bucket's copy (R2's ETag is the
  MD5) and purges the edge for exactly those URLs; `make check-pdfs` fails if any manifest
  name is missing from the bucket or any local PDF differs from it. CI runs both — it builds
  the corpus PDFs when LaTeX changed, the book/paperback/paper when `book/` changed, the
  three charts when their pages or the stylesheet changed, then publishes, and checks on
  every run. One PDF has no build at all: `The_Bishop_of_Rome.pdf` is a mirrored 2024
  document kept as a source in `resources/docs-src/` and copied in by `make mirrored-pdfs`.
  Both commands need `CLOUDFLARE_API_TOKEN` (R2 Storage:Edit + Cache Purge); without it the
  check can only see absence, and publishing refuses. The one-off road is still
  `npx wrangler r2 object put merecatholicity-files/<name> --file docs/<name> --remote`
  (the `--remote` is essential).
- **Publishing the site is still `git push`** — but the build happens in CI, not on your
  machine. A push to `main` runs the workflow: restore the previous `docs/` from cache,
  rebuild only what the diff touched, run `make tests`, `make jscheck` and `make check`,
  package `docs/`, deploy to Pages, purge the edge. A **pull request builds and is gated
  but never deploys**, so a fork's PR cannot touch production. Building locally still
  works and is useful for previewing, but nothing you build locally is what ships.
  The same is true of the **workers** (`.github/workflows/workers.yml`: gates, the D1
  migration ledger, `wrangler deploy`, on any push touching them) and of
  **Terraform** (`terraform.yml`: plan on every `terraform/**` change, apply from `main`
  behind an approval gate). See [Continuous integration](#continuous-integration).
- **The taxonomy is: root = config/docs; other dirs = sources and tooling; `docs/` = the
  served folder** — most of it written by the build, some of it hand-maintained source
  (see the layout box above). Never hand-edit the generated half.

### The `?v=N` cache law

**Nothing here is done by hand.** `scripts/stamp_versions.py` (run by `make bundle` and
again at the end of `make html`) gives every served asset a `?v=` key derived from its own
content hash — `app.js`, `comments.js`, `nav.js`, `style.css`, the page scripts, the
vendored lazy scripts, the Bible and emoji data. Unchanged content keeps its key, so
rebuilds stay byte-identical; changed content gets a new URL, which is the only thing that
reaches a phone's own cache (GitHub Pages serves everything `max-age=600`, and a Cloudflare
purge cannot touch a browser).

`docs/version.json` is the manifest of what the server currently serves —
`{build, assets}`, content-derived with no timestamp. `docs/nav.js` fetches it `no-store`
on the service-worker pump's schedule and compares it against **the keys the page is
actually running**; if the device is behind it offers a Reload. Settings → About shows the
same facts, in a dialog.

Two files deliberately carry no key: **`sw.js`** (its URL is its service-worker
registration identity; nav.js registers it `updateViaCache: 'none'`, which bypasses the
HTTP cache) and the HTML documents (Cloudflare answers them `cf-cache-status: DYNAMIC`, so
they are never edge-cached). `sw.js` and `version.json` are purged by the **last step of
build.yml's `deploy` job**, which is safe precisely there: `actions/deploy-pages` polls
until GitHub reports the deployment succeeded, so the content is published by definition
and the one real danger — purging BEFORE publish — cannot arise. (It used to be its own
workflow on the `page_build` event; that event is the BRANCH-build signal and stopped
firing when Pages moved to the artifact, so the purge went silently dead until it was
moved. `purge-cache.yml` survives as a manual button.) The purge needs
`CLOUDFLARE_API_TOKEN` repository secret and skips cleanly without it; since 2026-09-09 it
is set, and the purge runs on every deploy.

Still true and still load-bearing: **never fetch a freshly-bumped `?v=N` URL until Pages
has finished deploying** — a probe mid-deploy freezes the OLD bytes under the new key. To
test origin freshness, fetch a throwaway query (`app.js?probe123`), which always misses
cache. CI does not need to probe: it purges only after Pages has confirmed the deploy.

### Build reproducibility

LaTeX and pandoc builds are pinned to `SOURCE_DATE_EPOCH=1784160000`, and `app.js`/`style.css`
are byte-deterministic, so a rebuild only changes git when the *content* actually changed.
This is why `version.json` carries no build date: a timestamp would churn every rebuild and
break the double-build check that proves reproducibility.

---

## The build system

Everything served is generated from source, and CI builds what ships (the generated
half of `docs/` is not committed). This section is the whole pipeline, "from generation to our own book to all the other books and pages."

### Prerequisites

The toolchain is:

- **Node.js ≥ 22 + npm** — on Arch, `pacman -S nodejs npm`. **On Debian/Ubuntu, do NOT use
  the distro `nodejs` package**: its `+dfsg` build has Amaro (the TypeScript stripper)
  compiled out, so `node --test` fails with `ERR_UNKNOWN_FILE_EXTENSION ".ts"` on every
  test that imports a `.ts` source and `make tests` cannot pass. Install an official build
  from nodejs.org instead — unpacking the LTS tarball under `~/.local` and putting its
  `bin/` on PATH needs no root. Check with
  `node -e 'console.log(process.config.variables.node_use_amaro)'`, which must print `true`.
  The JavaScript build/lint tools — **Tailwind**, esbuild, eslint, wrangler — are
  per-project devDependencies, and **Lit** (the app shell's UI library, bundled into
  app.js) is a per-project dependency, all restored from the committed `package-lock.json`
  with `npm ci`. **Never `sudo npm`, never `npm install -g`**: everything lives in the project's
  own `node_modules/` (git-ignored), so builds are reproducible and nothing touches the
  system. `make` wraps the npm scripts, so `make css` / `make bundle` / `make jscheck`
  keep working as before.
- **pandoc** — LaTeX/Markdown/HTML/docx conversion (the book, content pages, the library).
- **pdflatex** (TeX Live) — the PDFs. LGR/textalpha for Greek, plus the usual packages.
- **python 3** + `pyyaml` — the build scripts and converters. Both Makefiles invoke bare
  **`python`**, so a distro that ships only `python3` needs a shim (Debian/Ubuntu:
  `python-is-python3`).
- **chromium** — the chart-page PDFs (`make chart-pdfs CHROMIUM=/path/to/chrome`); the headless
  harness (`webtest/`) uses its own matched chrome + chromedriver pair under `~/.cloakbrowser/`.

### The JavaScript toolchain (npm)

The repo is an npm project (`package.json` + a committed `package-lock.json`); `npm ci`
restores the exact toolchain into `node_modules/`.

```sh
npm ci             # restore Tailwind, esbuild, eslint, wrangler, tsc from the lockfile
npm run build      # lint + tsc, then bundle app.js + comments.js, then build style.css
npm run build:js   # esbuild  app/shell.ts -> docs/app.js  +  client/comments.ts (+ its feature modules) -> docs/comments.js
npm run build:css  # tailwindcss  styles/main.css -> docs/style.css   (= make css)
npm run tsc        # strict type-check: client + both workers (part of make jscheck)
npm run lint       # eslint over the still-JS worker/client files       (= make jscheck = lint + tsc)
```

**The whole hand-written surface is TypeScript** (2026-08-01): the app bundle
(`app/**`), the served client (`client/comments.ts`, the boot, plus the feature modules
`client/{composer,profile,board,wall,dm,merecat,admin}.ts`, bundled → `docs/comments.js`), and both
Cloudflare Workers (`comments-worker/`, `contact-worker/`). Three separate `tsconfig`
projects — the client one uses the browser DOM lib, each worker one uses the Cloudflare
Worker globals (`@cloudflare/workers-types`); the two lib sets conflict, so they can't
share a project. `tsc` type-checks; **esbuild does the transpile** (types erase to
nothing), which is why the JS→TS migration shipped byte-identical bundles. The pure
domain logic stays **PureScript** (see below), not TypeScript — TS is for the effectful
edges. `esbuild`, `typescript`, `purescript`, and `lit` are pinned to exact versions
(byte-stable, reproducible bundles); the rest float within the lockfile. Adding a JS
dependency is `npm install --save-dev <pkg>` (commit the lockfile); **never** install
globally or with `sudo`.

### The PureScript domain layer

The site's **application/domain logic is a PureScript kernel**, with Lit.js as the render
layer and JS as interop only (DOM, effects, crypto). `purescript/src/Domain/` is 29 modules (plus the generated `Domain.Writings`) —
`Rank`, `Scripture`, `Profile`, `Faith`, `Pseudonym`, `Dm`, `Access`, `Live`, `Board`,
`Emoji`, `Fts`, `Route`, `Auth`, `Mute`, `Blocked`, `Compose`, `Presence` among them — covering the meaningful logic
(constants, validation, permissions, parsing, routing, identity classification, FTS
sanitization), consumed by **both** the client bundle and the Cloudflare worker (one kernel,
so the constants the two used to duplicate can no longer drift). The compiler emits ESM into `purescript/output/`,
which a small barrel `app/core.ts` re-exports (the audited translation membrane that erases
PureScript types at the JS boundary) and `esbuild` inlines into `docs/app.js` (so no bundle
command changed); `comments-worker/src/index.ts` imports the same output. `app/shell.ts`
exposes the barrel as `window.mcCore`; the Lit views import `app/core.ts` directly, and the
classic client `docs/comments.js` (built from `client/`, reaching the kernel only through
`window.mcCore`) delegates via `if (window.mcCore) … else …classic…`, where each
classic branch is the no-bundle fallback (app disabled / storage blocked). What stays JS by
design: DOM/Lit rendering, the Turnstile/nacl/WebCrypto/fetch/WebSocket effects, the DM E2E
crypto, and the raw identity key/hash storage.

```sh
make psbuild   # rm -rf purescript/output; compile purescript/src -> purescript/output (ESM)
make pstest    # run the Node-native pure-unit tests over the compiled output
make bundle    # psbuild, then esbuild app/ -> docs/app.js and client/ -> docs/comments.js, then the version stamp
```

The `purs` compiler and `spago` are **npm devDependencies** restored by `npm ci`, like the
rest of the toolchain. npm-12 blocks the `purescript` package's install-script by default, so
its approval is committed in `package.json`'s `allowScripts`; `npm ci` then materializes the
pinned binary (`node_modules/.bin/purs`, `purescript@0.15.16`) that `spago` compiles with.
Codegen is deterministic (pinned `purs` + pinned package set in `purescript/spago.yaml` + the
`rm -rf output` guard), so a rebuild changes `docs/app.js` only when the content did, and
the version stamp then gives it a new `?v=` key by itself. `purescript/output/` and the
built `docs/app.js` are both git-ignored — CI builds what ships. eslint ignores
`purescript/output/`.

### Our book

*Mere Catholicity* is `book/confession.tex` (it `\input`s `book/memorandum-body.tex` as a
closing annex). All book builds run **inside `book/`** and copy the final artifact up into
`docs/`. The cover, `docs/cover.jpg`, is found via `\graphicspath{{../docs/}}`.

```sh
./book/build-confession.sh   # -> docs/Mere_Catholicity.pdf  (letter PDF, run twice for refs)
make html                    # -> docs/book.html             (web edition; also builds the library, then link-checks)
make publish                 # -> docs/Mere_Catholicity_Paperback.pdf  (KDP 6x9 interior, \PAPERBACK flag)
make logos                   # -> docs/Mere_Catholicity_Logos.docx     (Logos/Verbum edition)
make pdf                     # build-confession.sh + the companion paper PDF
```

The companion paper (*The Bishop and the Presbyter*) is `book/bishop-presbyter.tex` →
`make memorandum` → `docs/The_Bishop_and_the_Presbyter.pdf` and (via `make html`)
`docs/bishop-presbyter.html`.

### The content pages

Rarely-changing prose pages (credo, about, the prayer longforms, the catalogs, terms, …)
live as single source files under `content/` — `<slug>.md` (Markdown) or `<slug>.html`
(a verbatim body for the dense doctrinal pages) with YAML frontmatter (`title`, optional
`canon`, `description`, `comments`, `scripts`). All render through one shared skeleton in
`scripts/content.py`, which injects the generated nav and footer, so page chrome is
single-sourced. Every content page carries the comments widget's mount and is listed
automatically — by `scripts/writings.py`, into the generated `Domain.Writings` the kernel
reads — as one of the site's own writings the admin may open a section under (Platform
settings → *Comments on our own writings*, closed by default); `comments: false` opts a
utility page out (terms, privacy, the catalogs). The books the root Makefile builds are
detected the same way, so a new article or book brings its own switch.

```sh
make content        # content/*.{md,html} -> docs/<slug>.html
```

A migrated page is removed from `scripts/nav.py`'s `PAGES` list (content.py owns the whole
page, nav included). The few hand-maintained pages that content.py does *not* own — the
homepage, the contact form, the community/board SPA, the interstitial, the two Bible
readers — keep their nav rewritten in place by `nav.py`.

### The library (all the other books)

`resources/` turns preserved public-domain sources into ~200 re-typeset works — the
Ante-/Post-Nicene Fathers and the whole Schaff corpus, the Summa, the complete Newman,
the Douay-Rheims and King James Bibles, the Catena Aurea, the Greek and Latin classics,
the Second-Temple shelf, and more. Each work has a `*2tex.py` converter (or a shared
driver like `schaff.py` / `newman.py` / `classics2tex.py`) that emits a `*-body.tex`, a
`*.tex` wrapper, and Makefile stanzas. Sources are committed as flat files
(`*-src.html`, `*-thml.xml`, the `docs-src/` and `catena-src/` trees); large re-fetchable
trees are git-ignored (`make -C resources <name>-fetch` re-downloads them).

```sh
make -C resources body        # regenerate every *-body.tex from sources
make -C resources pdf         # build every root PDF into docs/
make -C resources html        # render every <id>.html into docs/  (also run by `make html`)
make -C resources schaff-fetch  # (example) re-download the CCEL Schaff XML
```

Outputs land in `docs/` and are listed on `docs/library.html` and `docs/credo.html`.

### Navigation, styles, and the app shell

```sh
make menu     # scripts/nav.yml -> partials/nav.html, rewrite nav in the hand pages, rebuild content + book
make css      # styles/main.css (Tailwind) -> docs/style.css
make bundle   # app/ -> docs/app.js, client/ -> docs/comments.js (esbuild, minified IIFEs, deterministic), then the stamp
```

- **Navigation** has one source, `scripts/nav.yml`. `scripts/nav.py` renders `partials/nav.html`
  and rewrites the inline nav block in the hand pages. A new hand page must be added to
  `nav.py`'s `PAGES`. A nav change means `make menu` (which reruns content + book).
- **Styles** are built by **Tailwind (v4, CSS-first)** from `styles/main.css`, the one entry
  (the theme + utilities imports, the design tokens, the reading surface, every component).
  The minified `docs/style.css` is build output (git-ignored) and carries its own stamped
  `?v=` key like every asset. Preflight is intentionally not imported — the site keeps its
  own base reset.
- **The app shell** (`app/`) makes the whole site a soft-navigating SPA over the static
  pages. `app/shell.ts` imports Lit from npm, and `make bundle` produces `docs/app.js` and
  `docs/comments.js` and stamps their `?v=` keys — nothing is bumped by hand.
- **Bible JSON** for the in-page Scripture picker/hover: `python resources/kjv-json.py`
  and `resources/dr-json.py` write `docs/kjv.json` / `docs/dr.json`.

### Verifying a build

```sh
make tests    # the unit suite (Layer 1): PureScript + JS + worker + Python + CSS, hermetic and fast
make jscheck  # eslint + tsc (after psbuild) — run after ANY worker or client edit
make check    # jscheck, then linkcheck over docs/
```

`make tests` is the fast, hermetic **unit** layer (`tests/`, one file per concern; see
`tests/README.md`). It exists to clarify what the code does and guard the rules that break
silently — not to chase coverage. `scripts/linkcheck.py` (via `make check`) scans `docs/`
and fails loudly if any internal href/src or `#fragment` doesn't resolve. Anything that
depends on client JS actually running (anchor jumps, board/DM rendering, the bot) is
verified with the **headless harness** (Layer 2):

```sh
python webtest/audit.py --pages           # page matrix: console errors, >=400s, dup loads
python webtest/audit.py --app --journey a,b,c   # soft-navigation ("SPA") proofs
python webtest/test_topic_search.py       # per-slice batteries (store, board, richtext, …)
```

### Continuous integration

**Everything ships through GitHub Actions, and `docs/architecture/CICD.md` is the
operating manual** — the golden path, each workflow step by step, the approval gate, the
credential inventory, the Terraform procedure, the exceptions and the traps. This section
is the overview.

**Push is the deploy.** `main` is production. A push runs the workflows the diff selects;
a pull request runs the same gates **with no credentials and no deploy of any kind**.

| Workflow | Fires on | Does |
| --- | --- | --- |
| `build.yml` | every push and PR | build the site incrementally, run the gates, build + publish + verify the PDFs, deploy Pages (`main` only), purge the edge |
| `workers.yml` | changes under `comments-worker/`, `contact-worker/`, `purescript/`, the npm lockfile and TS/eslint configs | `make jscheck` + `make tests` + `wrangler deploy --dry-run`; on `main`: apply the D1 migration ledger, `wrangler deploy` |
| `terraform.yml` | changes under `terraform/` | `plan` with a public-safe summary; on `main`: `apply` behind the `terraform-production` approval gate — refuses any destroy/replace, refuses if the plan changed since review; PRs get `fmt` + `validate` only |
| `purge-cache.yml` | a manual button | purge the two unkeyed files, or the whole zone |
| `merecat.yml` | changes under `librarian/`, `content/`, `resources/`, `book/`, `partials/`; daily; a dispatch (the private shelf's pushes) | wait for the Build, restore its `docs/`, clone the private shelf (deploy key), ingest only the works whose chunks changed (parse ledger + server hash), within the day's D1 row budget |

**Approving a Terraform apply:** open the run and press *Review deployments*, or from a
shell `scripts/ci_approve.sh` (list), `scripts/ci_approve.sh <run-id>` (summary + what is
pending), `scripts/ci_approve.sh <run-id> --approve "why"`. Because this repository is
public, the pipeline never prints a raw plan or uploads the plan file — reviewers see
`scripts/tf_plan_summary.py`'s rendering.

**Credentials** (set once by hand, mirrored in `~/.config/merecatholicity/ci.env` on the
dev box): three least-privilege Cloudflare tokens — `CLOUDFLARE_API_TOKEN` (Terraform),
`CLOUDFLARE_SITE_TOKEN` (publish + purge), `CLOUDFLARE_WORKERS_TOKEN` (worker deploys) —
their scopes in `terraform/README.md`; `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` (the
Terraform token's derived R2 pair); `TF_GITHUB_TOKEN`, a fine-grained PAT scoped to the two
repositories. Every action is pinned to a commit SHA (the repository requires it), Dependabot
keeps the pins current, secret scanning and push protection are on.

**Deliberately NOT in the pipeline** (the full list with reasons is the runbook's §10):
worker secrets (`wrangler secret put`); the librarian ingest; the bootstrap secrets and the
state bucket; the PAT and the org's PAT policy (GitHub has no API for them); Email Routing
settings, the R2 custom-domain bindings, the TURN key and Vectorize (provider limits); the
one-off audio and private-shelf uploads; headless verification against production; history
rewrites; branch protection on `main`.

**Why the build is practical in CI:** the repo is public (free minutes) and the build is
incremental (one target per work; an unchanged tree rebuilds nothing). Two traps the
workflow handles: git checks files out in no guaranteed order, so mtimes are flattened and
only the diffed files touched; TeX Live is installed only when LaTeX is involved.

### `make` target reference

| Target | What it does |
| --- | --- |
| `make html` | Book web edition + the whole library + link check |
| `make pdf` | Book letter PDF + companion paper PDF |
| `make publish` | KDP paperback interior PDF |
| `make logos` | Logos/Verbum `.docx` |
| `make content` | Content pages (`content/` → `docs/`) |
| `make menu` | Regenerate nav from `scripts/nav.yml`, then rebuild |
| `make css` | Build `styles/main.css` (Tailwind) → `docs/style.css` |
| `make psbuild` | Compile `purescript/src/` → `purescript/output/` (ESM) |
| `make tests` | Run the whole unit suite (PureScript + JS + Python + CSS) |
| `make pstest` | Run the PureScript unit tests (fast; the PS slice of `make tests`) |
| `make bundle` | Compile PureScript, bundle `app/` → `docs/app.js` and `client/` → `docs/comments.js` (esbuild), then stamp the `?v=` keys |
| `make jscheck` / `make check` | eslint + tsc over the client and both workers (after psbuild) / jscheck, then the link check |
| `make serve` | Local preview on 127.0.0.1:8000 over `docs/` |
| `make publish-pdfs` / `make check-pdfs` | Upload the local PDFs that differ from R2 and purge their URLs / prove the bucket matches `docs/pdfs.txt` (needs `CLOUDFLARE_API_TOKEN`) |
| `make mirrored-pdfs` | Copy the one PDF nothing builds (`resources/docs-src/The_Bishop_of_Rome.pdf`) into `docs/` (run inside `make html`) |
| `make worker-deploy` | The MANUAL road: lint, then deploy the comments worker (CI does this on push since 2026-09-09) |
| `make librarian` | Rebuild + push merecat's corpus/persona/config |
| `make comments-backup` | Export the live D1 comments DB (kept out of git) |
| `make clean` | Sweep LaTeX aux/log detritus and `__pycache__` |

---

## The dynamic backend (Cloudflare, free tier)

Everything dynamic is a **Cloudflare Worker**, deployed from its own directory with
wrangler (an npm devDependency). Both workers are constrained to the **free plan** — any new feature
must stay within it. Config is each directory's `wrangler.jsonc`; secrets are set with
`wrangler secret put` (never committed).

### Storage: D1, R2, Vectorize

| Kind | Resource | Use |
| --- | --- | --- |
| **D1** (edge SQLite) | `merecatholicity-comments` | Comments, forum, DMs (end-to-end encrypted, disappearing), notifications, profiles, DM public keys + media metadata, platform settings, moderation, FTS5 search index |
| **D1** | `merecat-library`, `merecat-library-deep`, `merecat-library-deep2` | merecat's chunked corpus + config/usage/chat threads |
| **R2** (S3-compatible) | `merecatholicity-avatars` | Member avatar JPEGs (one key per identity) |
| **R2** | `merecatholicity-dm-media` | End-to-end-encrypted DM attachments (client-encrypted ciphertext, random opaque keys, auto-expiring) |
| **R2** | `merecatholicity-backups` | Monthly D1 dump + avatar mirror (90-day retention) |
| **R2** | `merecatholicity-audio` | KJV Scourby audio, MP3 per chapter, at `audio.merecatholicity.com` |
| **R2** | `merecatholicity-wall-media` | Feed, member-wall and forum attachments (images, video, voice notes) |
| **R2** | `merecatholicity-files` | The 244 published PDFs, at `files.merecatholicity.com` — moved off Pages 2026-09-08 |
| **R2** | `merecatholicity-private-shelf` | Date-stamped tarballs of the private librarian shelf |
| **R2** | `merecatholicity-tfstate` | Terraform state. Deliberately unmanaged — a state store cannot bootstrap itself. **Contains secrets; never commit it** |
| **Vectorize** | `merecat-t1` | 1024-dim bge-m3 embeddings for merecat's semantic retrieval |
| **Workers AI** | (shared binding) | Llama Guard (moderation), LLaVA (avatar vision), bge-m3 (embed), bge-reranker, qwen3 (the bot's chat model) |
| **Turnstile** | — | Spam gate on every write (comments, posts, DMs, profiles) |

R2 is reached S3-style for bulk work (e.g. the audio upload script uses
`wrangler r2 object put … --remote` — the `--remote` is essential, or it writes to a local
simulated store). Identity is a browser-generated key; the server stores only its SHA-256.

### Watching the free tier

`admin.html?usage=1` (the **Platform usage** door in Administrative options) draws a live
health bar for every free-plan meter the platform rides — Workers requests, Workers AI
neurons, D1 rows and storage (per database, against the 500 MB free wall), R2 operations
and storage (per bucket), Durable Objects compute and SQLite storage, Vectorize
dimensions, Realtime TURN egress — banded green / amber / orange / red with over-the-line
shown honestly. The worker reads the account's own GraphQL Analytics with a **read-only**
API token: create one with the single permission *Account · Account Analytics · Read* and
install it with `cd comments-worker && npx wrangler secret put CF_USAGE_TOKEN` (the page
shows these steps itself until the token stands). A daily cron (23:30 UTC) runs the same
report and DMs every admin — as merecat, an automated notice — when any meter crosses 80%
or its ceiling: escalations at once, standing warnings weekly. The limits table lives in
`comments-worker/src/usagecalc.ts` (pure, unit-tested); when Cloudflare moves a free
limit, that one table is the edit. The librarian reads the same Workers AI meter before
every question and every `@merecat` mention (the **AI budget guard** on the merecat admin
page, on by default at 95% of the free day, admins included) and rests when the day's
spend reaches the line, telling the asker how many hours until midnight UTC — so merecat
is never the reason the account crosses its quota. Without the token the guard has no
meter and stands open, which the admin page says in words.

### merecat, the librarian

merecat is a members-open RAG chat (`community.html?merecat=1`) living in the comments
worker. Its corpus is **decoupled and rebuilt from `librarian/`**:

- `librarian/works.yml` — the manifest of ~200 works, each with a weight `tier`, a
  `vectorize` flag, and a `store:` room. A nine-band weighting policy (documented in the
  file's header) ranks the site's own voice and the catechetical core highest, then the
  Scriptures, the Fathers, Newman, the councils, and the deep shelf beneath.
- `librarian/persona.md` — the system prompt (also live-editable from the admin page).
- `librarian/config.yml` — model id, caps, top-k (the reasoning dials and the AI budget
  guard are set on the merecat admin page).
- `librarian/ingest.py` — parses every work into anchored chunks, pushes them to the D1
  rooms + Vectorize, and prunes removed works. Retrieval is five-legged (semantic +
  weighted BM25 + raw BM25 + phrase + verse), merged and reranked.

```sh
make librarian          # = cd librarian && python ingest.py --push --ledger .ledger.json   (incremental; daily-safe)
```

`librarian/private/` is a **separate private git repo** cloned into place — its texts are
never committed to this public repo. The bot answers from Cloudflare Workers AI only; the
offline GPU backend that once lived in `local/` was retired on 2026-09-10.

### Deploying the workers

**The push is the deploy** (`workers.yml`: gates → the D1 migration ledger → `wrangler deploy`,
on any push to `main` that touches a worker, the kernel or the toolchain config). The hand
road is for emergencies only:

```sh
make worker-deploy                        # comments worker (runs jscheck first)
cd contact-worker && npx wrangler deploy  # contact worker
```

Never `wrangler deploy` the comments worker without the gates — `make worker-deploy` runs
`jscheck` first, because an undefined identifier ships silently otherwise.

### Infrastructure as code (Terraform)

`terraform/` holds the infrastructure that outlives a deploy. It was adopted by import
from what already existed — Terraform did not create the site, and applying it changes
nothing.

**The boundary is the deploy.** `wrangler deploy` rewrites a worker's routes, cron
triggers, bindings, vars and secrets every time it runs. If Terraform also declared
those, the two tools would fight forever: every `make worker-deploy` would produce a
Terraform diff and every `terraform apply` would produce a wrangler diff. So Terraform
owns the zone, DNS, the three custom rulesets, bot management, the R2 buckets, the D1
databases *as records that they exist*, the Turnstile widgets and both GitHub repos —
forty resources — and wrangler keeps everything it deploys. Vectorize, the R2 custom
domain and the TURN key cannot be managed at all (no resource, or no import support);
`terraform/README.md` lists them and why.

```sh
. path/to/your/credentials            # CLOUDFLARE_API_TOKEN, GITHUB_TOKEN, AWS_* for R2
terraform -chdir=terraform plan       # expect: No changes
```

**Adopted 2026-09-09:** the three things the PDF move had made by hand — the
`merecatholicity-files` bucket, the `files.merecatholicity.com` record and the
dynamic-redirect ruleset — plus the GitHub environments, the two public-id Actions
variables, and GitHub Pages itself (`github_repository_pages`, `build_type = workflow`).
`plan` is expected to say `No changes` again. **Terraform runs from CI** (`terraform.yml`):
plan on every `terraform/**` change, apply from `main` behind the `terraform-production`
environment's approval — see [Continuous integration](#continuous-integration) for how a
plan is reviewed and approved. Locally the same four variables still work for a plan by
hand; the S3 pair can be derived from the Cloudflare token (access key = the token's id,
secret = its SHA-256), which is what CI does.

State lives in the R2 bucket `merecatholicity-tfstate`, which is deliberately not
managed by Terraform (a state store managed by its own state cannot be bootstrapped).
**State is secret** — it carries Turnstile secret keys, and this repository is public.
Never apply a plan that shows a destroy or a replace: a replaced D1 database destroys
the comments database. `prevent_destroy` guards every stateful resource, but reading
the plan is the real defence.

---

## Setup from a fresh clone

> **History was rewritten on 2026-09-09** (pack 554 MB → 153 MB): every generated artifact that
> ever sat at the root or under `docs/` was stripped from every commit, sources untouched, HEAD
> tree identical. A clone from before that day cannot `git pull` its way forward — re-clone.


```sh
git clone git@github.com:merecatholicity/merecatholicity.com.git
cd merecatholicity.com
npm ci             # restore the JS toolchain (Tailwind, esbuild, eslint, wrangler) from the lockfile
# The private librarian shelf is a separate private repo; clone it into place if you
# have access (anonymous clones simply won't have it, which is fine for the public build):
#   git clone git@github.com:merecatholicity/private-shelf.git librarian/private
make html          # build the book + library + content, then link-check
make serve         # preview at http://127.0.0.1:8000
```

Install the prerequisites listed above (**Node.js + npm**, pandoc, TeX Live, python +
pyyaml, chromium), then `npm ci` — never with `sudo` or `-g`. Worker development needs a
Cloudflare account with the D1/R2/Vectorize/Workers AI/Turnstile resources bound in each
`wrangler.jsonc`, and the secrets set via `wrangler secret put`.

---

## Cookbook

```sh
# Change the book, republish every edition:
$EDITOR book/confession.tex
make pdf html publish logos
git add -A && git commit -m "…" && git push        # push = deploy

# Add or edit a prose page:
$EDITOR content/about.md
make content && make check

# Change the site menu:
$EDITOR scripts/nav.yml
make menu                                            # rebuilds every page's nav

# Change the forum client (the feature module that owns it; client/comments.ts is the boot):
$EDITOR client/board.ts
make jscheck && make bundle                          # tsc + eslint, then the build stamps comments.js's key

# Change the app shell:
$EDITOR app/shell.ts
make bundle                                          # the stamp gives app.js its new key

# Change styles (Tailwind):
$EDITOR styles/main.css                              # the one Tailwind entry
make css                                             # tailwindcss -> docs/style.css

# Add a book to the library: write its converter + WORKS entry in resources/, then
make -C resources body pdf html
make check

# Add a work to merecat's knowledge: add it to librarian/works.yml, then
make librarian
```

---

### CI/CD tasks

```sh
gh run list --limit 6                                    # what the last pushes did
scripts/ci_approve.sh                                    # anything waiting on the Terraform gate?
scripts/ci_approve.sh <run-id> --approve "reviewed: …"   # approve it (or --reject)
gh workflow run workers.yml --ref main                   # redeploy both workers from CI
gh workflow run terraform.yml --ref main -f apply=false  # a plan by hand (no changes = nothing to approve)
terraform -chdir=terraform plan                          # drift check; expect: No changes.
python3 scripts/publish_pdfs.py --check                  # bucket vs manifest vs local PDFs
```

## License

This repository is under the [MIT License](LICENSE), copyright merecatholicity.com. That
covers the website, the build system, the menu and content pipelines, the Workers, and
anything else not called out below.

**Our book** — *Mere Catholicity* — is dedicated to the public domain under
[Creative Commons CC0 1.0](LICENSE-CC0). No rights reserved. This covers only:

- `book/confession.tex` (the book's source) and `book/memorandum-body.tex` /
  `book/bishop-presbyter*.tex` (the companion paper)
- `docs/Mere_Catholicity.pdf` and `docs/Mere_Catholicity_Paperback.pdf` (the PDF renders)
- `docs/book.html` and `docs/bishop-presbyter.html` (the web editions)
- `docs/Mere_Catholicity_Logos.docx` (the Logos/Verbum edition)
- `docs/cover.jpg` and `docs/book_cover.webp` (the cover images)

**Everything else in the library is already public domain.** The Fathers, the councils,
the Schaff corpus, Newman, the Summa, the Douay-Rheims and King James Bibles, the Catena
Aurea, the Greek and Latin classics, the Second-Temple texts, and the rest are ancient and
historical works, centuries to millennia old, long out of copyright. We only re-typeset
them from public-domain source transcriptions (Project Gutenberg, CCEL, Wikisource,
sacred-texts, and similar) into our own LaTeX and HTML. Those renders carry no new
copyright claim from us; the underlying texts belong to everyone.
