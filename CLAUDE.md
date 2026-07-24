# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

This file is about how the **website and its infrastructure** work: the GitHub Pages side, the Cloudflare Workers/D1/R2 side, and the build system that ties them together.

If you are working on any text-based content and `CONTEXT_DUMP.txt` is present in the repo root, ingest it first. This file stays focused on infra.

**Never store sensitive information in this file** (or anywhere committed): no API tokens, secrets, private keys, or unpublished credentials. Cloudflare Worker secrets are set with `wrangler secret put`, not in source. The identity hashes and Turnstile sitekeys that do appear in the repo are public by design.

**Keep this file current.** When infrastructure changes in an important way — a hosting or DNS pivot, a new or retired Worker, a change to how builds or deploys run, a plan or quota policy change — update this file in the same change.

## Hosting and delivery

- **GitHub Pages** serves the repo root directly. The site is static: every `*.html`, PDF, image, and built artifact is committed and served as-is. `CNAME` points Pages at the apex domain.
- **Cloudflare** fronts Pages as a proxy (DNS + CDN + edge features). Do not change the SSL mode to Full (strict); the working configuration is deliberate.
- Because the site is prebuilt static files, "deploying" the site is just committing and pushing built output. There is no site build step on the server.

## Build system

Builds are pinned to `SOURCE_DATE_EPOCH=1784160000` so rebuilds are byte-identical and git only churns when text actually changes. Built artifacts are committed.

- `./build-confession.sh` — book PDF (`Mere_Catholicity.pdf`) via pdflatex (run twice for refs/TOC).
- `make html` — HTML editions (`book.html`, `bishop-presbyter.html`) via pandoc, plus resources pages, then runs the link check.
- `make publish` — KDP paperback PDF (same `confession.tex`, `\PAPERBACK` flag, separate jobname).
- `make logos` — Logos/Verbum `.docx`.
- `make menu` — regenerate all site navigation from `nav.yml`, then rebuild html.
- `make check` — `python linkcheck.py`; verifies every internal href/src and `#fragment` on the site resolves. This is the only automated test.
- `make chart-pdfs` — print chart pages to PDF with headless `/usr/bin/chromium` (note: `~/bin/chromium` is an emacs wrapper, not a browser).
- `make serve` — local server on port 8000.
- `make comments-backup` — export the live D1 comments DB to `comments-backup.sql` (kept out of git).

**Navigation** is generated: `nav.yml` is the single source. `nav.py` renders `nav.html` and rewrites the inline nav block in every page listed in the `PAGES` array at the top of `nav.py`. A new site page must be added to that list or `make menu` will not touch it.

**Resources** (`resources/`) are public-domain texts rebuilt as our own LaTeX. `*2tex.py` scripts convert preserved sources into `*-body.tex`; the `WORKS` list in `resources/Makefile` maps each source to its published root PDF, and outputs land in the repo root so Pages serves them.

## Cloudflare Workers (dynamic backend)

The static site delegates its two dynamic features to Workers. Both are **free-tier only** — any new worker feature must stay within Cloudflare's free plan. Deploy each from its own directory with `deno run -A npm:wrangler deploy` (wrangler runs through deno; there is no npm/node setup). Config is in each directory's `wrangler.jsonc`.

- **`comments-worker/`** — the comments backend. Routed on the zone at `/api/comments*`, so it is same-origin with the pages (no CORS). Uses **D1** for storage, **Turnstile** as the spam gate, **Workers AI** (Llama Guard) for screening (`MODERATION_MODE` var), rate-limit bindings for per-IP throttles, Email Routing for moderation notices, and a monthly cron that dumps D1 to **R2** (`merecatholicity-backups`, 90-day retention). Client side is `comments.js`; a page opts in with `<section class="comments" data-comments>` plus the script (the book edition gets it via `book-tail.html`). Identity is a browser-generated key; the server stores only its SHA-256 and derives a pseudonym from the hash. NOTE: the pseudonym/reserved wordlists are duplicated in `comments.js` and `comments-worker/src/index.js` and must stay identical.
- **Direct messages** ride the same worker: strictly 1v1 threads in D1 (`dm_threads`/`dms`/`dm_blocks`, canonical-pair unique row, denormalized unread state), POST-with-key only (private; no admin visibility by design), Turnstile-gated sends, per-recipient blocks. Client: Inbox at `community.html?inbox=1`, threads at `?dm=<hash>`, unread badge by the Logout links throttled by a 90-second localStorage cache, and a member autocomplete fed by one cacheable `/dm/directory` fetch with all fuzzy matching done client-side.
- **Profiles and avatars** ride the same worker. Profiles (nick/bio/signature) live in the D1 `profiles` table, AI-screened like comments. Avatars are 400x400 JPEG only, 500 KB cap, magic-byte-sniffed server side, screened by a Workers AI vision model (LLaVA), and stored in R2 **`merecatholicity-avatars`** under one fixed key per identity (upload = overwrite, so no orphans). The monthly backup cron dumps the whole database schema-agnostically and mirrors the avatar objects into the backups bucket; **any new state store outside D1 must be added to `runBackup()`'s mirror or it is not backed up**. A mid-month snapshot can be forced through the admin-keyed `POST /api/comments/backup`. Cloudflare's CSAM Scanning Tool is enabled on the zone.
- **`contact-worker/`** — the contact form backend on custom domain `contact-api.merecatholicity.com`. Turnstile-gated, throttled, sends to a verified Email Routing destination address. Client side is `contact.js`.
