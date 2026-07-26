#!/usr/bin/env python3
"""Convert the Project Gutenberg Douay-Rheims Bible (ebook 1581) to a
LaTeX body.

The Gutenberg HTML (douay-rheims-src.html) is flat and regular:
  <h2>  THE OLD TESTAMENT / THE NEW TESTAMENT      -> \\xchapter (testament)
  <h3>  THE BOOK OF GENESIS                         -> \\xsection (book)
  <h4>  Genesis Chapter 1                           -> \\xsubsection (chapter)
  <p>   1:1. In the beginning God created ...       -> a verse
  <p class="sp2">  book/chapter argument, psalm titles -> \\drarg
  <p class="expl"> Challoner's explanatory notes     -> \\drnote

Everything before the first testament (the Gutenberg cover and table of
contents) and everything from the appendices / license onward is dropped.
The wrapper douay-rheims.tex owns the preamble and defines the macros.

Run: python dr2tex.py
"""
import html as htmlmod
import re
from html.parser import HTMLParser

from ccel2tex import esc

SRC = "douay-rheims-src.html"
OUT = "douay-rheims-body.tex"


class DR(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.active = False       # between the OT heading and the appendices
        self.out = []
        self.cap = None           # current heading/paragraph kind being captured
        self.buf = []

    def _flush(self):
        if self.cap is None:
            return
        text = re.sub(r"\s+", " ", "".join(self.buf)).strip()
        self.buf = []
        kind, self.cap = self.cap, None
        if not text:
            return
        raw = htmlmod.unescape(text)
        if kind == "h2":
            t = raw.strip().upper()
            if "OLD TESTAMENT" in t or "NEW TESTAMENT" in t:
                self.active = True
                self.out.append("\\xchapter{%s}" % esc(_book_title(raw)))
            else:
                # appendices, license, contents: leave the scripture body
                self.active = False
            return
        if not self.active:
            return
        if kind == "h3":
            self.out.append("\\xsection{%s}" % esc(_book_title(raw)))
        elif kind == "h4":
            self.out.append("\\xsubsection{%s}" % esc(raw))
        elif kind == "arg":
            self.out.append("\\drarg{%s}" % _tex(raw))
        elif kind == "note":
            self.out.append("\\drnote{%s}" % _tex(raw))
        elif kind == "verse":
            self.out.append(_verse(raw))

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag in ("h2", "h3", "h4"):
            self._flush()
            self.cap = tag
        elif tag == "p" and self.active:
            self._flush()
            cls = a.get("class", "")
            self.cap = {"sp2": "arg", "expl": "note"}.get(cls, "verse")
            if cls == "center":
                self.cap = "arg"

    def handle_endtag(self, tag):
        if tag in ("h2", "h3", "h4", "p"):
            self._flush()

    def handle_data(self, data):
        if self.cap is not None:
            self.buf.append(data)


def _book_title(s):
    """THE BOOK OF GENESIS -> The Book of Genesis (keep roman ordinals)."""
    small = {"OF", "THE", "AND"}
    out = []
    for w in s.split():
        if re.fullmatch(r"[IVX]+", w):
            out.append(w)
        elif w in small and out:
            out.append(w.lower())
        else:
            out.append(w.capitalize())
    return " ".join(out)


_QUOTE_OPEN = " \n\t(—[{"


def _tex(text):
    """Escape for LaTeX and turn straight double quotes into TeX quotes."""
    out = []
    for ch in text:
        if ch == '"':
            prev = out[-1] if out else " "
            out.append("``" if prev[-1:] in _QUOTE_OPEN else "''")
        else:
            out.append(esc(ch))
    return "".join(out)


def _verse(raw):
    """Bold the leading verse number 'N:M.' for a scripture look."""
    m = re.match(r"(\d+:\d+\.)\s*(.*)", raw, re.S)
    if m:
        return "\\textbf{%s}~%s" % (esc(m.group(1)), _tex(m.group(2)))
    return _tex(raw)


def main():
    dr = DR()
    with open(SRC, encoding="utf-8") as f:
        dr.feed(f.read())
    dr._flush()
    body = "\n\n".join(dr.out) + "\n"
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(body)
    print(f"wrote {OUT}: {body.count(chr(92) + 'xchapter{')} testaments, "
          f"{body.count(chr(92) + 'xsection{')} books, "
          f"{body.count(chr(92) + 'xsubsection{')} chapters, "
          f"{body.count(chr(92) + 'drarg{')} arguments, "
          f"{body.count(chr(92) + 'drnote{')} notes")


if __name__ == "__main__":
    main()
