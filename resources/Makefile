# Resources build tasks. Public-domain texts kept as LaTeX docs of our own.
# Outputs land in the site root so GitHub Pages serves them.

.PHONY: all pdf html body

all: pdf html

# Regenerate the LaTeX bodies from the preserved sources.
body:
	python thml2tex.py
	python docs2tex.py
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

# One line per work: source name = published root PDF. Each entry becomes
# a real file target below, rebuilt only when its .tex or -body.tex is
# newer, so 'make pdf' is incremental, an interrupted run resumes where it
# stopped, and a completed run can never omit a declared output. To add a
# work, add its line HERE (and its html stanza to the html target below).
WORKS = \
  commonitory=The_Commonitory.pdf \
  development=Development_of_Christian_Doctrine.pdf \
  consulting=On_Consulting_the_Faithful.pdf \
  law=Treatise_on_Law.pdf \
  cyril=Catechetical_Lectures.pdf \
  gregory=Great_Catechism.pdf \
  enchiridion=Enchiridion.pdf \
  councils=Seven_Ecumenical_Councils.pdf \
  ignatius=Epistles_of_Ignatius.pdf \
  irenaeus3=Against_Heresies_Book_III.pdf \
  baptism=On_Baptism.pdf \
  unity=On_the_Unity_of_the_Church.pdf \
  tome=Tome_of_St_Leo.pdf \
  clement=First_Epistle_of_Clement.pdf \
  justin=First_Apology_of_Justin_Martyr.pdf \
  didache=Didache.pdf \
  festal39=Festal_Letter_39.pdf \
  gregory-letters=Letters_on_the_Title_Universal_Bishop.pdf \
  soulres=On_the_Soul_and_the_Resurrection.pdf \
  onbaptism=On_Baptism_Against_the_Donatists.pdf \
  ravenna=The_Ravenna_Document.pdf \
  chieti=The_Chieti_Document.pdf \
  jddj=Joint_Declaration_on_Justification.pdf \
  encyclical1848=Encyclical_of_the_Eastern_Patriarchs.pdf \
  scranton=Declaration_of_Scranton.pdf \
  cassian-prayer=Conferences_on_Prayer.pdf \
  benedict-rule=Rule_of_St_Benedict.pdf

work_name = $(firstword $(subst =, ,$(1)))
work_out  = $(lastword  $(subst =, ,$(1)))

PDF_TARGETS = $(foreach w,$(WORKS),../$(call work_out,$(w)))

pdf: $(PDF_TARGETS)

define PDF_RULE
../$(call work_out,$(1)): $(call work_name,$(1)).tex $(call work_name,$(1))-body.tex
	$$(call LATEX2,$(call work_name,$(1)))
	cp $(call work_name,$(1)).pdf $$@
	@echo "built $(call work_out,$(1)) ($$$$(pdfinfo $(call work_name,$(1)).pdf | awk '/^Pages/{print $$$$2}') pages)"
endef

$(foreach w,$(WORKS),$(eval $(call PDF_RULE,$(w))))

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
	sed -e 's/\\hrule height [0-9.]*pt//g' consulting.tex | \
	pandoc -f latex -t html5 --standalone \
	    --metadata title="On Consulting the Faithful in Matters of Doctrine" \
	    --css=style.css -B ../nav.html -A ../footer.html \
	    -o ../consulting.html
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
	         soulres:1:"On the Soul and the Resurrection" \
	         onbaptism:1:"On Baptism, Against the Donatists" \
	         ravenna:2:"The Ravenna Document" \
	         chieti:2:"The Chieti Document" \
	         jddj:2:"Joint Declaration on the Doctrine of Justification" \
	         encyclical1848:1:"Encyclical of the Eastern Patriarchs, 1848" \
	         scranton:1:"The Declaration of Scranton" \
	         cassian-prayer:1:"The Conferences on Prayer, by St. John Cassian" \
	         benedict-rule:1:"The Holy Rule of St. Benedict" \
	         gregory-letters:1:"Letters of St. Gregory the Great on the Title Universal Bishop"; do \
	  n=$${w%%:*}; r=$${w#*:}; d=$${r%%:*}; t=$${r#*:}; \
	  sed -e 's/\\xchapter{/\\section*{/g' \
	      -e 's/\\xsection{/\\subsection*{/g' \
	      -e 's/\\xsubsection{/\\paragraph{/g' \
	      -e 's/\\textgreek{/{/g' \
	      -e 's/\\texthebrew{/{/g' \
	      $$n-body.tex > $$n-body-html.tex; \
	  sed -e "s/{$$n-body.tex}/{$$n-body-html.tex}/" \
	      -e 's/\\hrule height [0-9.]*pt//g' $$n.tex | \
	  pandoc -f latex -t html5 --standalone --toc --toc-depth=$$d \
	      --metadata title="$$t" \
	      --css=style.css -B ../nav.html -A ../footer.html \
	      -o ../$$n.html; \
	  rm $$n-body-html.tex; \
	  echo "built $$n.html"; \
	done
