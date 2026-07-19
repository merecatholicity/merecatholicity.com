# Mere Catholicity build tasks. Add new actions as targets below.

.PHONY: all build pdf html

all: build

build: pdf html logos

pdf:
	./build-confession.sh

# HTML edition from the same .tex, with pandoc-friendly preprocessing:
#  - \unit{...} heads become \paragraph{...} so pandoc keeps them
#  - \color{...} stripped out of starred section headings
html:
	sed -e 's/\\unit{/\\paragraph{/g' \
	    -e 's/\\hrule height [0-9.]*pt//g' \
	    -e 's/\\section\*{\\color{heading}/\\section*{/g' \
	    -e 's/\\begin{center}{\\large\\bfseries\\color{heading}The confession}\\end{center}/\\section*{The confession}/' \
	    confession.tex | \
	pandoc -f latex -t html5 --standalone --toc --toc-depth=2 \
	    --metadata title="Mere Catholicity" \
	    --css=style.css -H social.html -B nav.html -A footer.html \
	    -o book.html
	python toc-prune.py
	$(MAKE) -C resources html
	@echo "built book.html"

# Logos/Verbum Personal Book edition: a .docx from the same .tex, using the
# same preprocessing as the html target. Word heading styles carry the
# structure; Logos builds its own TOC from them and auto-links Bible
# references at compile time, so no pandoc --toc and no HTML fragments.
.PHONY: logos
logos:
	sed -e 's/\\unit{/\\paragraph{/g' \
	    -e 's/\\hrule height [0-9.]*pt//g' \
	    -e 's/\\section\*{\\color{heading}/\\section*{/g' \
	    -e 's/\\begin{center}{\\large\\bfseries\\color{heading}The confession}\\end{center}/\\section*{The confession}/' \
	    confession.tex | \
	pandoc -f latex -t docx \
	    --metadata title="Mere Catholicity" \
	    -o Mere_Catholicity_Logos.docx
	@echo "built Mere_Catholicity_Logos.docx"

# KDP paperback interior: 6x9 trim, mirrored margins with gutter, black ink,
# plain links. Same confession.tex, switched by the \PAPERBACK flag. Separate
# jobname keeps its aux/toc files apart from the letter edition's.
.PHONY: publish
publish:
	SOURCE_DATE_EPOCH=1784160000 pdflatex -interaction=nonstopmode -halt-on-error \
	    -jobname=confession-paperback "\def\PAPERBACK{1}\input{confession.tex}" >/dev/null
	SOURCE_DATE_EPOCH=1784160000 pdflatex -interaction=nonstopmode -halt-on-error \
	    -jobname=confession-paperback "\def\PAPERBACK{1}\input{confession.tex}" >/dev/null
	cp confession-paperback.pdf Mere_Catholicity_Paperback.pdf
	@echo "built Mere_Catholicity_Paperback.pdf ($$(pdfinfo confession-paperback.pdf | awk '/^Pages/{print $$2}') pages)"

# Rebuild the site menus from nav.yml: regenerates nav.html, rewrites the
# nav block in index.html and resources.html, then rebuilds book.html.
.PHONY: menu
menu:
	python nav.py
	$(MAKE) html

.PHONY: serve
serve:
	python -m http.server 8000
