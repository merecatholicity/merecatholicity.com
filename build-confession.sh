#!/bin/sh
# Build the working paper (single PDF with appendices and addendum) with pdflatex.
cd "$(dirname "$0")"
# Fixed UTC build date: no local timezone in PDF metadata (print version 1.0 date)
export SOURCE_DATE_EPOCH=1784160000
pdflatex -interaction=nonstopmode -halt-on-error confession.tex >/dev/null 2>&1
pdflatex -interaction=nonstopmode -halt-on-error confession.tex >/dev/null 2>&1
cp confession.pdf Mere_Catholicity.pdf
echo "built Mere_Catholicity.pdf ($(pdfinfo confession.pdf 2>/dev/null | awk '/^Pages/{print $2}') pages)"
