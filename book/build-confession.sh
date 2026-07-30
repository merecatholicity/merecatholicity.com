#!/bin/sh
# Build the working paper (single PDF with appendices and addendum) with pdflatex.
# This script and confession.tex live in book/; cd here so pdflatex resolves
# \input{memorandum-body.tex} and \graphicspath{{../docs/}} (cover.jpg) locally.
# The intermediates stay in book/ (git-ignored); only the final PDF is copied
# up into the served tree at ../docs/.
cd "$(dirname "$0")"
# Fixed UTC build date: no local timezone in PDF metadata (print version 1.0 date)
export SOURCE_DATE_EPOCH=1784160000
pdflatex -interaction=nonstopmode -halt-on-error confession.tex >/dev/null 2>&1
pdflatex -interaction=nonstopmode -halt-on-error confession.tex >/dev/null 2>&1
cp confession.pdf ../docs/Mere_Catholicity.pdf
echo "built Mere_Catholicity.pdf ($(pdfinfo confession.pdf 2>/dev/null | awk '/^Pages/{print $2}') pages)"
