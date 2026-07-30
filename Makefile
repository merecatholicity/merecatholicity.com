# Mere Catholicity build tasks. Add new actions as targets below.

.PHONY: all build pdf html check

all: build

build: pdf html logos publish check

# Fail loudly if any page links at a file or anchor that does not exist.
# Runs at the end of 'build' and 'html' so a missing output (a PDF stanza
# added but never built, a typo'd href) can never ship silently again.
# Static guard over the hand-maintained JS (worker + client): an undefined
# identifier once shipped in the worker and silenced @merecat mentions for
# days. eslint no-undef catches that class; deno runs it with no npm setup.
jscheck:
	deno run -A npm:eslint comments-worker/src/index.js docs/comments.js docs/nav.js docs/deeplink.js docs/flash.js docs/contact.js docs/bible-reader.js docs/away.js docs/index.js docs/sw.js 'app/**/*.js'

# The app shell bundle: Lit (vendored under vendor/, no npm anywhere) plus
# the app/ modules, esbuild pinned for byte-stable output, committed like
# every built artifact. Pages carrying it load app.js?v=N (see nav.js).
bundle: jscheck
	deno run -A npm:esbuild@0.24.2 app/shell.js --bundle --minify --format=iife --outfile=docs/app.js --log-level=warning

# The only sanctioned way to deploy the comments worker: the guard runs first.
worker-deploy: jscheck
	cd comments-worker && deno run -A npm:wrangler deploy

check: jscheck
	python scripts/linkcheck.py

pdf:
	./book/build-confession.sh
	$(MAKE) memorandum

# The companion papers. The Memorandum is no longer built standalone, it
# closes the book as an annex since version 1.2. Its dormant wrapper
# memorandum.tex remains for a future submission copy if ever needed.
.PHONY: memorandum
memorandum:
	cd book && SOURCE_DATE_EPOCH=1784160000 pdflatex -interaction=nonstopmode -halt-on-error bishop-presbyter.tex >/dev/null
	cd book && SOURCE_DATE_EPOCH=1784160000 pdflatex -interaction=nonstopmode -halt-on-error bishop-presbyter.tex >/dev/null
	cp book/bishop-presbyter.pdf docs/The_Bishop_and_the_Presbyter.pdf
	@echo "built The_Bishop_and_the_Presbyter.pdf ($$(pdfinfo book/bishop-presbyter.pdf | awk '/^Pages/{print $$2}') pages)"

# HTML edition from the same .tex, with pandoc-friendly preprocessing:
#  - \unit{...} heads become \paragraph{...} so pandoc keeps them
#  - \color{...} stripped out of starred section headings
html:
	cd book && sed -e 's/\\unit{/\\paragraph{/g' memorandum-body.tex > memorandum-body-html.tex
	cd book && sed -e 's/\\unit{/\\paragraph{/g' \
	    -e 's/\\hrule height [0-9.]*pt//g' \
	    -e 's/\\section\*{\\color{heading}/\\section*{/g' \
	    -e 's/{memorandum-body.tex}/{memorandum-body-html.tex}/' \
	    -e 's/\\begin{center}{\\large\\bfseries\\color{heading}The confession}\\end{center}/\\section*{The confession}/' \
	    confession.tex | \
	pandoc -f latex -t html5 --standalone --toc --toc-depth=2 \
	    --metadata title="Mere Catholicity" \
	    --css=style.css -H ../partials/social.html -B ../partials/nav.html -A ../partials/book-tail.html \
	    -o ../docs/book.html
	python scripts/toc-prune.py
	rm book/memorandum-body-html.tex
	cd book && sed -e 's/\\unit{/\\paragraph{/g' -e 's/\\hrule height [0-9.]*pt//g' bishop-presbyter.tex | \
	pandoc -f latex -t html5 --standalone \
	    --metadata title="The bishop and the presbyter, a question recorded" \
	    --css=style.css -B ../partials/nav.html -A ../partials/footer.html \
	    -o ../docs/bishop-presbyter.html
	$(MAKE) -C resources html
	@echo "built book.html"
	$(MAKE) check

# Logos/Verbum Personal Book edition: a .docx from the same .tex, using the
# same preprocessing as the html target. Word heading styles carry the
# structure; Logos builds its own TOC from them and auto-links Bible
# references at compile time, so no pandoc --toc and no HTML fragments.
.PHONY: logos
logos:
	cd book && sed -e 's/\\unit{/\\paragraph{/g' memorandum-body.tex > memorandum-body-html.tex
	cd book && sed -e 's/\\unit{/\\paragraph{/g' \
	    -e 's/\\hrule height [0-9.]*pt//g' \
	    -e 's/\\section\*{\\color{heading}/\\section*{/g' \
	    -e 's/{memorandum-body.tex}/{memorandum-body-html.tex}/' \
	    -e 's/\\begin{center}{\\large\\bfseries\\color{heading}The confession}\\end{center}/\\section*{The confession}/' \
	    confession.tex | \
	SOURCE_DATE_EPOCH=1784160000 pandoc -f latex -t docx \
	    --metadata title="Mere Catholicity" \
	    -o ../docs/Mere_Catholicity_Logos.docx
	rm book/memorandum-body-html.tex
	@echo "built docs/Mere_Catholicity_Logos.docx"

# KDP paperback interior: 6x9 trim, mirrored margins with gutter, black ink,
# plain links. Same confession.tex, switched by the \PAPERBACK flag. Separate
# jobname keeps its aux/toc files apart from the letter edition's.
.PHONY: publish
publish:
	cd book && SOURCE_DATE_EPOCH=1784160000 pdflatex -interaction=nonstopmode -halt-on-error \
	    -jobname=confession-paperback "\def\PAPERBACK{1}\input{confession.tex}" >/dev/null
	cd book && SOURCE_DATE_EPOCH=1784160000 pdflatex -interaction=nonstopmode -halt-on-error \
	    -jobname=confession-paperback "\def\PAPERBACK{1}\input{confession.tex}" >/dev/null
	cp book/confession-paperback.pdf docs/Mere_Catholicity_Paperback.pdf
	@echo "built Mere_Catholicity_Paperback.pdf ($$(pdfinfo book/confession-paperback.pdf | awk '/^Pages/{print $$2}') pages)"

# The stylesheet is modular source under styles/, concatenated in filename
# order (the NN- prefixes fix it) into the committed style.css that every
# page links. Plain cat is deterministic and byte-stable; style.css stays
# unversioned (cache-TTL), so a change propagates on Cloudflare's TTL.
.PHONY: css
css:
	cat styles/*.css > docs/style.css
	@echo "built style.css ($$(wc -l < docs/style.css) lines from styles/)"

# Build the decoupled content pages (content/*.md|*.html) into committed
# static HTML through the one shared skeleton. Runs after nav.py so it reads
# the freshly generated nav.html; a page under content/ is NOT in nav.py's
# PAGES (content.py owns the whole page, nav included). See content.py.
.PHONY: content
content:
	python scripts/content.py

# Rebuild the site menus from nav.yml: regenerates nav.html, rewrites the
# nav block in the hand pages, rebuilds the content pages from the fresh nav,
# then rebuilds book.html.
.PHONY: menu
menu:
	python scripts/nav.py
	python scripts/content.py
	$(MAKE) html

.PHONY: chart-pdfs
chart-pdfs:
	/usr/bin/chromium --headless --disable-gpu --no-pdf-header-footer --print-to-pdf=docs/Charting_Historic_Communions.pdf "file://$$(pwd)/docs/charting-communions.html"
	/usr/bin/chromium --headless --disable-gpu --no-pdf-header-footer --print-to-pdf=docs/Charting_Free_Churches.pdf "file://$$(pwd)/docs/free-churches.html"
	/usr/bin/chromium --headless --disable-gpu --no-pdf-header-footer --print-to-pdf=docs/Fifty_Objections.pdf "file://$$(pwd)/docs/objections.html"

.PHONY: serve
# Local preview only. --bind 127.0.0.1 is LOAD-BEARING SECURITY: without it
# http.server binds 0.0.0.0 (every interface) and serves this whole working
# tree — including the git-ignored secrets local/serve.key and librarian/.key
# and the private shelf — to anyone on the LAN or tailnet. A stray one ran
# open for two days once (2026-07-29). Never remove the bind.
serve:
	python -m http.server 8000 --bind 127.0.0.1 --directory docs

# Export the live comments database to a local .sql file. The file stays out
# of git: commenters' text belongs on the site, not in the repo history.
.PHONY: comments-backup
comments-backup:
	cd comments-worker && deno run -A npm:wrangler d1 export merecatholicity-comments --remote --output ../comments-backup.sql
	@echo "exported comments-backup.sql (kept out of git)"

# Rebuild and push everything merecat (the librarian bot) knows: the corpus
# chunks, the persona, and the config, all from librarian/. Incremental, so
# it is cheap to run after any content edit; see librarian/README.md.
.PHONY: librarian
librarian:
	cd librarian && python ingest.py --push

# Sweep local build detritus: the LaTeX aux/log churn in book/ and resources/,
# the temp html-tex, and Python bytecode. Never touches committed sources, the
# reproducible intermediate PDFs, or the built site in docs/. Safe anytime.
.PHONY: clean
clean:
	rm -f book/*.aux book/*.log book/*.out book/*.toc book/*.dvi book/memorandum-body-html.tex
	rm -f resources/*.aux resources/*.log resources/*.out resources/*.toc resources/*build.log
	find . -name '__pycache__' -type d -prune -exec rm -rf {} + 2>/dev/null || true
	@echo "swept LaTeX aux/log detritus and __pycache__ (docs/, PDFs, and sources untouched)"
