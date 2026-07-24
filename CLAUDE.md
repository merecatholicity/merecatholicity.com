# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Read first

`CONTEXT_DUMP.txt` in the repo root is the full project briefing (who the authors are, what the book argues, the non-negotiable style rules, build hazards, git policy). Read it before touching `confession.tex`, any theological prose, or the site's written content. Its "Build workflow" section references the old `~/Desktop/greece` location; this repo is the current home, but everything else in it stands.

## Git policy (hard rules)

- Never add a Claude co-author trailer or any AI attribution to commits.
- Never commit or push on your own initiative. Permission must come in the user's current instruction; it does not carry over from earlier messages.

## Commands

- `./build-confession.sh` — build the book PDF (`Mere_Catholicity.pdf`) with pdflatex.
- `make html` — HTML editions: `book.html` and `bishop-presbyter.html` via pandoc, plus the resources pages, then runs the link check.
- `make publish` — KDP paperback interior (`Mere_Catholicity_Paperback.pdf`, same `confession.tex` switched by the `\PAPERBACK` flag).
- `make logos` — Logos/Verbum `.docx` edition.
- `make menu` — regenerate all site navigation from `nav.yml`, then rebuild html.
- `make check` — `python linkcheck.py`, verifies every internal href/src and #fragment on the site resolves. This is the only automated test; there is no lint suite.
- `make chart-pdfs` — print the chart pages to PDF with headless `/usr/bin/chromium` (note: `~/bin/chromium` is an emacs wrapper, not a browser).
- `make serve` — local server on port 8000.
- `make comments-backup` — export the live D1 comments database to `comments-backup.sql` (kept out of git).
- Workers deploy with `deno run -A npm:wrangler deploy` from `comments-worker/` or `contact-worker/` (no npm/node setup; wrangler runs through deno).

Built artifacts (PDFs, `book.html`, nav blocks) are committed; GitHub Pages serves the repo root directly (see `CNAME`), fronted by Cloudflare. Builds are pinned to `SOURCE_DATE_EPOCH=1784160000` so rebuilds are byte-identical and git only churns when text really changes.

## Architecture

**The book.** `confession.tex` is the single source for four editions: letter PDF, paperback PDF (`\PAPERBACK` flag, separate jobname), HTML, and docx. `memorandum-body.tex` (The Bishop and the Presbyter) is included as an annex and also built standalone from `bishop-presbyter.tex`. The HTML/docx targets sed-preprocess the LaTeX (unit→paragraph, strip colors/rules) before pandoc; pandoc stitches in the fragments `social.html`, `nav.html`, `book-tail.html`, `footer.html`, and `toc-prune.py` trims the generated TOC. HAZARD: the `\opensec` and `\partdiv` macro definitions in the preamble contain `\clearpage` and addcontentsline literals — never anchor a text insertion on those strings without bounding the search to the document body (a mis-anchored insert once made pdflatex loop to 22,000+ pages).

**Navigation.** `nav.yml` is the single source for every menu on the site. `nav.py` renders it to `nav.html` (consumed by pandoc builds) and rewrites the inline nav block in each page listed in `PAGES` at the top of `nav.py`. A new site page must be added to that `PAGES` list or `make menu` will not touch it.

**Resources.** `resources/` holds public-domain texts rebuilt as our own LaTeX docs. Preserved sources (ThML/XML/etc.) are converted by the `*2tex.py` scripts into `*-body.tex` files (`make body` in that directory); the `WORKS` list in `resources/Makefile` maps each source name to its published root PDF, and outputs land in the repo root so Pages serves them. To add a work: add its `WORKS` line and its html stanza in `resources/Makefile`.

**Comments system.** `comments.js` (client) + `comments-worker/` (Cloudflare Worker routed on the zone at `/api/comments*`, so same-origin, no CORS). Storage is D1, spam gate is Turnstile, screening is Workers AI Llama Guard (`MODERATION_MODE` var), per-IP throttles via rate-limit bindings, moderation by signed email links, monthly D1 dump to R2 via cron. Identity is a browser-generated key; the server stores only its SHA-256 and derives a pseudonym from the hash. A page opts in with `<section class="comments" data-comments>` plus the script; the book edition gets it through `book-tail.html`. CRITICAL: the pseudonym/reserved wordlists are duplicated in `comments.js` and `comments-worker/src/index.js` and must stay identical — edit both or names desync. The Turnstile sitekey and `ADMIN_HASHES` also appear in both places.

**Contact form.** `contact-worker/` on the custom domain `contact-api.merecatholicity.com`, Turnstile-gated, sends to a verified Email Routing destination address. Free tier only throughout: any new worker feature must stay within Cloudflare's free plan.

## Style rules for prose (summary; full list in CONTEXT_DUMP.txt §7)

- No em dashes, no semicolons, anywhere in the book's prose.
- Plain academic tone, no AI-flavored vocabulary ("load-bearing", "framework", "machinery", the verb "run" for applying the paper's tests are all banned).
- The grade is DECLINED/declinations. The eucharist happens at an ALTAR, never a "table". State the tradition-side doctrine at full strength before any qualifier.
