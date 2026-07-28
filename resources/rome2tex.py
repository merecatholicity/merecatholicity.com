#!/usr/bin/env python3
"""Convert the Roman historians' preserved sources to LaTeX bodies.

- Zosimus, New History (rome-src/zosimus{1..6}.htm): Roger Pearse's
  transcriptions of the 1814 Green and Chaplin translation
  (tertullian.org), one clean <p>-flow file per book; the page header
  and the transcriber's colophon drop.

- Tacitus, The Annals (books 1-6, 11-16) and The Histories (books 1-5)
  (rome-src/annals*.html, histories*.html): Wikisource's Church and
  Brodribb translations fetched with action=render (content-only
  MediaWiki HTML); navigation spans, edit links, and license furniture
  drop, chapter heads ride through as sections.

Run: python rome2tex.py
"""
import re

from dev2tex import blocks, finalize, inline
from docs2tex import esc_tex
from newman import _map_symbols, _cap_quotes, _heal_emphasis

ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X",
         "XI", "XII", "XIII", "XIV", "XV", "XVI"]


def clean_common(tex):
    tex = re.sub(r"\n\n(?:\\\\\s*\n)+", "\n\n", tex)
    tex = re.sub(r"(?:\\\\\s*\n)+\n", "\n\n", tex)
    tex = re.sub(r"(\\\\\s*)\[", r"\1{}[", tex)
    tex = (tex.replace("\\devchapter{", "\\xsection{")
              .replace("\\devsection{", "\\xsection{")
              .replace("\\devunit{", "\\xsubsection{"))
    tex = _heal_emphasis(tex)
    tex = _cap_quotes(tex)
    return _map_symbols(tex)


def zosimus():
    parts = []
    for b in range(1, 7):
        raw = open(f"rome-src/zosimus{b}.htm", encoding="utf-8",
                   errors="replace").read()
        h = re.search(r"</head\s*>", raw, re.I)
        raw = raw[h.end():] if h else raw
        # 1990s uppercase tags to lowercase for the engine
        raw = re.sub(r"<(/?)([A-Za-z]+)([^>]*)>",
                     lambda m: "<" + m.group(1) + m.group(2).lower()
                     + m.group(3) + ">", raw)
        # from the book's own centered title to the transcriber colophon
        m = re.search(r"<p align=\"center\">\s*<i><b>BOOK.*?</p>", raw,
                      re.I | re.S)
        if m:
            raw = raw[m.end():]
        for endmark in ("This text was transcribed", "Early Church Fathers"):
            k = raw.find(endmark)
            if k > 0:
                raw = raw[:raw.rfind("<", 0, k)]
                break
        raw = re.sub(r"<!--.*?-->", " ", raw, flags=re.S)
        raw = re.sub(r"</?(?:hr|center|table|tbody|tr|td|span|font|small|"
                     r"sub|sup|body|html)[^>]*>", " ", raw, flags=re.I)
        raw = re.sub(r"\[\s*(?:continued|Note to the online text)[^\]]*\]",
                     "", raw, flags=re.I | re.S)
        tex = clean_common(finalize(inline(blocks(raw))))
        parts.append("\\xchapter{Book %s}\n\n%s" % (ROMAN[b], tex.strip()))
    body = re.sub(r"\n{3,}", "\n\n", "\n\n".join(parts)) + "\n"
    open("zosimus-body.tex", "w", encoding="utf-8").write(body)
    left = sorted(set(re.findall(r"<[a-zA-Z/][^>]*>", body)))
    print(f"wrote zosimus-body.tex: 6 chapters, {len(body)//1024} KB"
          + (f"  LEFTOVER {left[:6]}" if left else ""))


def wikisource(kind, books, out, title):
    parts = []
    for b in books:
        raw = open(f"rome-src/{kind}{b}.html", encoding="utf-8",
                   errors="replace").read()
        # mediawiki chrome: navigation header table, edit sections,
        # license and header templates
        raw = re.sub(r"<table[^>]*>.*?</table>", " ", raw, flags=re.S)
        raw = re.sub(r"<ul class=\"plainSister\">.*?</ul>", " ", raw,
                     flags=re.S)
        raw = re.sub(r"<ol class=\"references\">.*?</ol>", " ", raw,
                     flags=re.S)
        raw = re.sub(r"</?(?:ul|ol)[^>]*>", " ", raw)
        raw = re.sub(r"<li[^>]*>", "<p>", raw).replace("</li>", "")
        raw = re.sub(r"<sup[^>]*class=\"reference\"[^>]*>.*?</sup>", "",
                     raw, flags=re.S)
        raw = re.sub(r"<span[^>]*class=\"mw-editsection[^>]*>.*?</span>",
                     " ", raw, flags=re.S)
        raw = re.sub(r"</?(?:span|section|div|figure|figcaption|aside|"
                     r"style|link|meta|small|sup|sub)[^>]*>", "", raw,
                     flags=re.S)
        raw = re.sub(r"<h2[^>]*>", "<h3>", raw).replace("</h2>", "</h3>")
        tex = clean_common(finalize(inline(blocks(raw))))
        parts.append("\\xchapter{Book %s}\n\n%s" % (ROMAN[b], tex.strip()))
    body = re.sub(r"\n{3,}", "\n\n", "\n\n".join(parts)) + "\n"
    open(out, "w", encoding="utf-8").write(body)
    left = sorted(set(re.findall(r"<[a-zA-Z/][^>]*>", body)))
    print(f"wrote {out}: {len(books)} chapters, {len(body)//1024} KB"
          + (f"  LEFTOVER {left[:6]}" if left else ""))


def main():
    zosimus()
    wikisource("annals", [1, 2, 3, 4, 5, 6, 11, 12, 13, 14, 15, 16],
               "annals-body.tex", "The Annals")
    wikisource("histories", [1, 2, 3, 4, 5],
               "histories-body.tex", "The Histories")


if __name__ == "__main__":
    main()
