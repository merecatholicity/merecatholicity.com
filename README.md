# merecatholicity.com

A static site (`docs/`, served by GitHub Pages behind Cloudflare) plus two Cloudflare
Workers. `main` is production: **the push IS the deploy**.

**Read these first, in this order.** This file is the operating manual — prerequisites,
targets, recipes — and nothing else.

| Document | What it holds |
| --- | --- |
| `CLAUDE.md` | The rulebook: the standing rules, and the laws that break silently. Start here. |
| `docs/architecture/log/YYYY-MM.md` | The why: every design decision and postmortem, dated. Read a subsystem's passage before changing it. Indexed by `docs/architecture/INFRASTRUCTURE.md`. |
| `docs/architecture/CICD.md` | How work ships: the workflows, the gates, the credentials, the drills, the exceptions. |
| `docs/architecture/CODEBASE.md` | The code map and reading order. |
| `comments-worker/API.md` | The wire contract (held to the route table by `tests/py/test_api_parity.py`). |
| `tests/README.md` · `webtest/POLICY.md` | The test layers, and what a headless test may do against production. |
| `terraform/README.md` · `librarian/README.md` | Infrastructure as code; the librarian's shelf. |

## Prerequisites

- **Node.js ≥ 22 + npm.** On Debian/Ubuntu do **not** use the distro `nodejs`: its `+dfsg`
  build has Amaro (the TypeScript stripper) compiled out, so `node --test` fails with
  `ERR_UNKNOWN_FILE_EXTENSION ".ts"` and `make tests` cannot pass. Use an official build
  (unpacking the LTS tarball under `~/.local` needs no root). Check:
  `node -e 'console.log(process.config.variables.node_use_amaro)'` must print `true`.
- **pandoc** (book, content pages, library), **pdflatex** / TeX Live with LGR + textalpha
  (the PDFs), **python 3** + `pyyaml`, **chromium** (chart PDFs; `webtest/` brings its own).
- Everything else is a devDependency restored by `npm ci` — **never `sudo`, never `-g`**.
  The PureScript compiler is not an npm package: `make toolchain` fetches it by pinned
  sha256 (`tests/_support/toolchain.json`) into `local/bin/`.

## Setup from a fresh clone

> History was rewritten 2026-09-09 (554 MB → 153 MB). A clone from before that day cannot
> `git pull` forward — re-clone.

```sh
git clone git@github.com:merecatholicity/merecatholicity.com.git
cd merecatholicity.com
npm ci             # the JS toolchain, from the lockfile
make toolchain     # the PureScript compiler by pinned hash -> local/bin/purs
# The private librarian shelf is a SEPARATE private repo, never a submodule. With access:
#   git clone git@github.com:merecatholicity/private-shelf.git librarian/private
make html          # book + library + content, then link-check
make serve         # preview on 127.0.0.1:8000 (binds localhost only — load-bearing)
```

Worker development needs the Cloudflare resources bound in each `wrangler.jsonc` and the
secrets set with `wrangler secret put`. Credentials live in
`~/.config/merecatholicity/ci.env` (mode 600, outside the repo) — never in a committed file.

## `make` targets

| Target | What it does |
| --- | --- |
| `make tests` | The whole unit suite (PureScript + JS + Python + CSS). **The standing gate.** |
| `make jscheck` / `make check` | eslint + tsc (after psbuild) / jscheck, then the link check |
| `make bundle` | psbuild, then esbuild `app/` → `docs/app.js` and `client/` → `docs/comments.js`, then the `?v=` stamp |
| `make css` | Tailwind: `styles/main.css` → `docs/style.css` (NOT rebuilt by `make bundle`) |
| `make toolchain` / `make psbuild` | Fetch `purs` by pinned hash / compile `purescript/src` → `purescript/output` |
| `make pstest` | The PureScript unit tests alone (fast) |
| `make html` / `make content` / `make menu` | Book + library + link check / content pages / regenerate nav from `scripts/nav.yml` |
| `make page-meta` | The metadata sweep `make html` ends with: `lang`, `rel=canonical`, the skip link, one `<h1>` |
| `make pdf` / `make publish` / `make logos` | Book letter PDF + companion / KDP paperback interior / Logos `.docx` |
| `make publish-pdfs` / `make check-pdfs` | Upload changed PDFs to R2 and purge them / prove bucket = manifest = local |
| `make mirrored-pdfs` | Copy the one PDF nothing builds into `docs/` |
| `make serve` | Local preview over `docs/` on 127.0.0.1 only |
| `make migrate` / `make migration NAME=…` / `make schema-snapshot` | Apply the D1 ledger / new migration / regenerate the snapshot |
| `make worker-deploy` | The EMERGENCY road (CI deploys on push) |
| `make worker-rollback` / `make worker-stage` / `make worker-promote` / `make worker-status` | The rollback and staged-rollout drills (CICD §12) |
| `make comments-backup` | Fetch the latest daily D1 backup from R2 and replay it locally |
| `make librarian` | The hand road: push merecat's changed works, persona and dials |
| `make nightly-run` / `make nightly-baseline` | The nightly headless run against production, and its baseline |
| `make clean` | Sweep LaTeX detritus and `__pycache__` |

## Cookbook

```sh
# Before ANY commit: the gate. Both builds first — make bundle does not build style.css,
# and the stamp test reads both off disk. Read the EXIT CODE, not just the test tally.
make css && make bundle && make tests

# The book, every edition:
$EDITOR book/confession.tex && make pdf html publish logos

# A prose page / the site menu:
$EDITOR content/about.md && make content && make check
$EDITOR scripts/nav.yml   && make menu

# The client, the shell, the styles:
$EDITOR client/board.ts && make jscheck && make bundle
$EDITOR app/shell.ts    && make bundle
$EDITOR styles/main.css && make css

# A schema change is a NEW migration, additive, shipped with the worker that reads it:
make migration NAME=add_thing && $EDITOR comments-worker/migrations/*_add_thing.sql
make migrate && make schema-snapshot

# The restore drill:
make comments-backup
make comments-backup-check FILE=~/.config/merecatholicity/backups/comments-YYYY-MM-DD.sql.gz

# A book into the library / a work into merecat's knowledge:
make -C resources body pdf html && make check
$EDITOR librarian/works.yml && make librarian
```

## CI/CD

```sh
gh run list --limit 6                                    # what the last pushes did
scripts/ci_approve.sh                                    # anything waiting on the Terraform gate?
scripts/ci_approve.sh <run-id> --approve "reviewed: …"   # approve it (or --reject)
gh workflow run workers.yml --ref main                   # redeploy both workers from CI
terraform -chdir=terraform plan                          # drift check; expect: No changes.
python3 scripts/publish_pdfs.py --check                  # bucket vs manifest vs local PDFs
curl -s "https://merecatholicity.com/version.json?probe=$RANDOM"   # what is actually live
```

## License

This repository is under the [MIT License](LICENSE), copyright merecatholicity.com — the
website, the build system, the content and menu pipelines, the Workers, and anything not
called out below.

**Our book**, *Mere Catholicity*, is dedicated to the public domain under
[Creative Commons CC0 1.0](LICENSE-CC0). No rights reserved. This covers only:

- `book/confession.tex`, `book/memorandum-body.tex`, `book/bishop-presbyter*.tex`
- `docs/Mere_Catholicity.pdf`, `docs/Mere_Catholicity_Paperback.pdf`
- `docs/book.html`, `docs/bishop-presbyter.html`, `docs/Mere_Catholicity_Logos.docx`
- `docs/cover.jpg`, `docs/book_cover.webp`

**Everything else in the library is already public domain** — the Fathers, the councils,
the Schaff corpus, Newman, the Summa, the Douay-Rheims and King James Bibles, the Catena
Aurea, the classics, the Second-Temple texts. We re-typeset them from public-domain
transcriptions (Project Gutenberg, CCEL, Wikisource, sacred-texts) into our own LaTeX and
HTML; those renders carry no new copyright claim, and the underlying texts belong to
everyone. Sound files under `docs/sounds/` carry their own attribution in that directory.
