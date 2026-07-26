#!/usr/bin/env python3
"""Convert the Project Gutenberg King James Version (ebook 10) to a LaTeX
body.

The Gutenberg HTML (kjv-src.html) is flat and regular:
  <h2> The Old Testament ... / The New Testament ...  -> \\xchapter (testament)
  <h2> The First Book of Moses: Called Genesis        -> \\xsection (book)
  <p>  1:1 In the beginning God created ...            -> a verse

Chapters are not marked; the chapter number lives in each verse's C:V
reference, so a chapter heading (\\xsubsection) is emitted whenever that
number advances. This edition is the 66-book canon (Gutenberg's KJV carries
no Apocrypha), which matches the Scourby audio exactly. The wrapper kjv.tex
owns the preamble, macros, and front matter.

Run: python kjv2tex.py
"""
import html as htmlmod
import re
from html.parser import HTMLParser

from ccel2tex import esc

SRC = "kjv-src.html"
OUT = "kjv-body.tex"

VERSE_RE = re.compile(r"(\d+):(\d+)\s+")


class KJV(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.active = False    # between the OT heading and the license
        self.out = []
        self.cap = None        # 'h2' | 'verse'
        self.buf = []
        self.chap = None       # current chapter number within a book

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
            t = raw.upper()
            if "OLD TESTAMENT" in t or "NEW TESTAMENT" in t:
                self.active = True
                self.chap = None
                self.out.append("\\xchapter{%s}" % esc(raw))
            elif self.active and "GUTENBERG" not in t and "LICENSE" not in t:
                self.chap = None
                self.out.append("\\xsection{%s}" % esc(raw))
            else:
                # the eBook title, or the license: outside the scripture body
                self.active = False
            return
        if not self.active or kind != "verse":
            return
        # a paragraph often packs several verses ("1:14 ... 1:15 ... 1:16 ...")
        # so split on every C:V reference and emit each verse on its own.
        marks = list(VERSE_RE.finditer(raw))
        if not marks:
            self.out.append(_tex(raw))
            return
        for i, m in enumerate(marks):
            ch, vs = m.group(1), m.group(2)
            end = marks[i + 1].start() if i + 1 < len(marks) else len(raw)
            body = raw[m.end():end].strip()
            if ch != self.chap:
                self.chap = ch
                self.out.append("\\xsubsection{Chapter %s}" % ch)
            self.out.append("\\textbf{%s:%s}~%s" % (esc(ch), esc(vs), _tex(body)))

    def handle_starttag(self, tag, attrs):
        if tag == "h2":
            self._flush()
            self.cap = "h2"
        elif tag == "p" and self.active:
            self._flush()
            self.cap = "verse"

    def handle_endtag(self, tag):
        if tag in ("h2", "p"):
            self._flush()

    def handle_data(self, data):
        if self.cap is not None:
            self.buf.append(data)


_QOPEN = " \n\t(—-[{“‘"


def _tex(text):
    """LaTeX-escape and turn straight double quotes into TeX quotes."""
    out = []
    for ch in text:
        if ch == '"':
            prev = out[-1][-1:] if out else " "
            out.append("``" if prev in _QOPEN else "''")
        else:
            out.append(esc(ch))
    return "".join(out)


def main():
    kjv = KJV()
    with open(SRC, encoding="utf-8") as f:
        kjv.feed(f.read())
    kjv._flush()
    body = "\n\n".join(kjv.out) + "\n"
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(body)
    print(f"wrote {OUT}: {body.count(chr(92)+'xchapter{')} testaments, "
          f"{body.count(chr(92)+'xsection{')} books, "
          f"{body.count(chr(92)+'xsubsection{')} chapters, "
          f"{body.count(chr(92)+'textbf{')} verses")


if __name__ == "__main__":
    main()
