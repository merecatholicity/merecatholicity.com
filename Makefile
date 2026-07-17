# Mere Catholicity build tasks. Add new actions as targets below.

.PHONY: all build pdf html

all: build

build: pdf html

pdf:
	./build-confession.sh

# HTML edition from the same .tex, with pandoc-friendly preprocessing:
#  - \unit{...} heads become \paragraph{...} so pandoc keeps them
#  - \color{...} stripped out of starred section headings
html:
	sed -e 's/\\unit{/\\paragraph{/g' \
	    -e 's/\\hrule height [0-9.]*pt//g' \
	    -e 's/\\section\*{\\color{heading}/\\section*{/g' \
	    confession.tex | \
	pandoc -f latex -t html5 --standalone --toc --toc-depth=2 \
	    --metadata title="Mere Catholicity" \
	    --css=style.css -H social.html -B nav.html -A footer.html \
	    -o book.html
	python toc-prune.py
	@echo "built book.html"

.PHONY: serve
serve:
	python -m http.server 8000
