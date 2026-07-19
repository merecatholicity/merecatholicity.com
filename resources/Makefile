# Resources build tasks. Public-domain texts kept as LaTeX docs of our own.
# Outputs land in the site root so GitHub Pages serves them.

.PHONY: all pdf html body

all: pdf html

# Regenerate the LaTeX bodies from the preserved sources.
body:
	python thml2tex.py
	python dev2tex.py
	python consulting2tex.py
	python summa2tex.py
	python ccel2tex.py

# Fixed date + trailer id (set in each preamble) keep rebuilds
# byte-identical, so git only churns when the text really changes.
define LATEX2
	SOURCE_DATE_EPOCH=1784160000 pdflatex -interaction=nonstopmode -halt-on-error $(1).tex >/dev/null
	SOURCE_DATE_EPOCH=1784160000 pdflatex -interaction=nonstopmode -halt-on-error $(1).tex >/dev/null
endef

pdf:
	$(call LATEX2,commonitory)
	cp commonitory.pdf ../The_Commonitory.pdf
	@echo "built The_Commonitory.pdf ($$(pdfinfo commonitory.pdf | awk '/^Pages/{print $$2}') pages)"
	$(call LATEX2,development)
	cp development.pdf ../Development_of_Christian_Doctrine.pdf
	@echo "built Development_of_Christian_Doctrine.pdf ($$(pdfinfo development.pdf | awk '/^Pages/{print $$2}') pages)"
	$(call LATEX2,consulting)
	cp consulting.pdf ../On_Consulting_the_Faithful.pdf
	@echo "built On_Consulting_the_Faithful.pdf ($$(pdfinfo consulting.pdf | awk '/^Pages/{print $$2}') pages)"
	$(call LATEX2,law)
	cp law.pdf ../Treatise_on_Law.pdf
	@echo "built Treatise_on_Law.pdf ($$(pdfinfo law.pdf | awk '/^Pages/{print $$2}') pages)"
	$(call LATEX2,cyril)
	cp cyril.pdf ../Catechetical_Lectures.pdf
	@echo "built Catechetical_Lectures.pdf ($$(pdfinfo cyril.pdf | awk '/^Pages/{print $$2}') pages)"
	$(call LATEX2,gregory)
	cp gregory.pdf ../Great_Catechism.pdf
	@echo "built Great_Catechism.pdf ($$(pdfinfo gregory.pdf | awk '/^Pages/{print $$2}') pages)"
	$(call LATEX2,enchiridion)
	cp enchiridion.pdf ../Enchiridion.pdf
	@echo "built Enchiridion.pdf ($$(pdfinfo enchiridion.pdf | awk '/^Pages/{print $$2}') pages)"
	$(call LATEX2,councils)
	cp councils.pdf ../Seven_Ecumenical_Councils.pdf
	@echo "built Seven_Ecumenical_Councils.pdf ($$(pdfinfo councils.pdf | awk '/^Pages/{print $$2}') pages)"
	$(call LATEX2,ignatius)
	cp ignatius.pdf ../Epistles_of_Ignatius.pdf
	@echo "built Epistles_of_Ignatius.pdf ($$(pdfinfo ignatius.pdf | awk '/^Pages/{print $$2}') pages)"
	$(call LATEX2,irenaeus3)
	cp irenaeus3.pdf ../Against_Heresies_Book_III.pdf
	@echo "built Against_Heresies_Book_III.pdf ($$(pdfinfo irenaeus3.pdf | awk '/^Pages/{print $$2}') pages)"
	$(call LATEX2,baptism)
	cp baptism.pdf ../On_Baptism.pdf
	@echo "built On_Baptism.pdf ($$(pdfinfo baptism.pdf | awk '/^Pages/{print $$2}') pages)"
	$(call LATEX2,unity)
	cp unity.pdf ../On_the_Unity_of_the_Church.pdf
	@echo "built On_the_Unity_of_the_Church.pdf ($$(pdfinfo unity.pdf | awk '/^Pages/{print $$2}') pages)"
	$(call LATEX2,tome)
	cp tome.pdf ../Tome_of_St_Leo.pdf
	@echo "built Tome_of_St_Leo.pdf ($$(pdfinfo tome.pdf | awk '/^Pages/{print $$2}') pages)"
	$(call LATEX2,clement)
	cp clement.pdf ../First_Epistle_of_Clement.pdf
	@echo "built First_Epistle_of_Clement.pdf ($$(pdfinfo clement.pdf | awk '/^Pages/{print $$2}') pages)"
	$(call LATEX2,justin)
	cp justin.pdf ../First_Apology_of_Justin_Martyr.pdf
	@echo "built First_Apology_of_Justin_Martyr.pdf ($$(pdfinfo justin.pdf | awk '/^Pages/{print $$2}') pages)"
	$(call LATEX2,didache)
	cp didache.pdf ../Didache.pdf
	@echo "built Didache.pdf ($$(pdfinfo didache.pdf | awk '/^Pages/{print $$2}') pages)"
	$(call LATEX2,festal39)
	cp festal39.pdf ../Festal_Letter_39.pdf
	@echo "built Festal_Letter_39.pdf ($$(pdfinfo festal39.pdf | awk '/^Pages/{print $$2}') pages)"
	$(call LATEX2,gregory-letters)
	cp gregory-letters.pdf ../Letters_on_the_Title_Universal_Bishop.pdf
	@echo "built Letters_on_the_Title_Universal_Bishop.pdf ($$(pdfinfo gregory-letters.pdf | awk '/^Pages/{print $$2}') pages)"

# Site HTML editions from the same .tex files, with the site nav and
# footer, like book.html. The heading macros become \section* and
# friends so pandoc keeps them. Rebuilt by the root 'make html' so menu
# changes reach them.
html:
	sed -e 's/\\commchapter{/\\section*{/g' \
	    -e 's/\\textgreek{/{/g' \
	    commonitory-body.tex > commonitory-body-html.tex
	sed -e 's/{commonitory-body.tex}/{commonitory-body-html.tex}/' \
	    commonitory.tex | \
	pandoc -f latex -t html5 --standalone --toc \
	    --metadata title="The Commonitory of Vincent of Lérins" \
	    --css=style.css -B ../nav.html -A ../footer.html \
	    -o ../commonitory.html
	rm commonitory-body-html.tex
	@echo "built commonitory.html"
	sed -e 's/\\devchapter{/\\section*{/g' \
	    -e 's/\\devsection{/\\subsection*{/g' \
	    -e 's/\\devunit{/\\paragraph{/g' \
	    development-body.tex > development-body-html.tex
	sed -e 's/{development-body.tex}/{development-body-html.tex}/' \
	    development.tex | \
	pandoc -f latex -t html5 --standalone --toc \
	    --metadata title="An Essay on the Development of Christian Doctrine" \
	    --css=style.css -B ../nav.html -A ../footer.html \
	    -o ../development.html
	rm development-body-html.tex
	@echo "built development.html"
	pandoc -f latex -t html5 --standalone \
	    --metadata title="On Consulting the Faithful in Matters of Doctrine" \
	    --css=style.css -B ../nav.html -A ../footer.html \
	    consulting.tex -o ../consulting.html
	@echo "built consulting.html"
	sed -e 's/\\lawpart{/\\section*{/g' \
	    -e 's/\\lawquestion{/\\subsection*{/g' \
	    -e 's/\\lawarticle{/\\subsubsection*{/g' \
	    -e 's/\\lawsummary{/\\emph{/g' \
	    law-body.tex > law-body-html.tex
	sed -e 's/{law-body.tex}/{law-body-html.tex}/' \
	    law.tex | \
	pandoc -f latex -t html5 --standalone --toc --toc-depth=2 \
	    --metadata title="The Treatise on Law" \
	    --css=style.css -B ../nav.html -A ../footer.html \
	    -o ../law.html
	rm law-body-html.tex
	@echo "built law.html"
	for w in cyril:2:"The Catechetical Lectures of S. Cyril of Jerusalem" \
	         gregory:2:"The Great Catechism of St. Gregory of Nyssa" \
	         enchiridion:2:"The Enchiridion on Faith, Hope, and Love" \
	         councils:2:"The Seven Ecumenical Councils of the Undivided Church" \
	         ignatius:1:"The Epistles of St. Ignatius of Antioch" \
	         irenaeus3:2:"Against Heresies, Book III" \
	         baptism:2:"On Baptism, by Tertullian" \
	         unity:1:"On the Unity of the Church" \
	         tome:1:"The Tome of St. Leo" \
	         clement:2:"The First Epistle of Clement to the Corinthians" \
	         justin:2:"The First Apology of St. Justin Martyr" \
	         didache:2:"The Didache" \
	         festal39:1:"The Thirty-Ninth Festal Letter of St. Athanasius" \
	         gregory-letters:1:"Letters of St. Gregory the Great on the Title Universal Bishop"; do \
	  n=$${w%%:*}; r=$${w#*:}; d=$${r%%:*}; t=$${r#*:}; \
	  sed -e 's/\\xchapter{/\\section*{/g' \
	      -e 's/\\xsection{/\\subsection*{/g' \
	      -e 's/\\xsubsection{/\\paragraph{/g' \
	      -e 's/\\textgreek{/{/g' \
	      -e 's/\\texthebrew{/{/g' \
	      $$n-body.tex > $$n-body-html.tex; \
	  sed -e "s/{$$n-body.tex}/{$$n-body-html.tex}/" $$n.tex | \
	  pandoc -f latex -t html5 --standalone --toc --toc-depth=$$d \
	      --metadata title="$$t" \
	      --css=style.css -B ../nav.html -A ../footer.html \
	      -o ../$$n.html; \
	  rm $$n-body-html.tex; \
	  echo "built $$n.html"; \
	done
