#!/usr/bin/env python3
"""Convert the Commonitory ThML extract to a LaTeX body.

Reads commonitory-thml.xml (the div1 id="iii" slice of CCEL's npnf211.xml),
keeps Chapters I-XXXIII (div2 iii.ii through iii.xxxiv) with Heurtley's
footnotes, and writes commonitory-body.tex for \\input by commonitory.tex.
The editor's Introduction and the three appendix notes are left out.

Run: python thml2tex.py
"""
import re
import sys
from html.parser import HTMLParser

SRC = "commonitory-thml.xml"
OUT = "commonitory-body.tex"

CHAPTERS = {f"iii.{r}" for r in (
    "ii iii iv v vi vii viii ix x xi xii xiii xiv xv xvi xvii xviii xix xx "
    "xxi xxii xxiii xxiv xxv xxvi xxvii xxviii xxix xxx xxxi xxxii xxxiii "
    "xxxiv".split())}

TEX_SPECIALS = {
    "\\": r"\textbackslash{}", "&": r"\&", "%": r"\%", "$": r"\$",
    "#": r"\#", "_": r"\_", "{": r"\{", "}": r"\}",
    "~": r"\textasciitilde{}", "^": r"\textasciicircum{}",
    " ": "~",
}


def esc(text):
    return "".join(TEX_SPECIALS.get(c, c) for c in text)


class Converter(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out = []          # finished LaTeX pieces
        self.buf = None        # current paragraph buffer, or None
        self.skip_depth = 0    # inside h1/h3/hr title furniture
        self.in_chapter = False
        self.note_buf = None   # accumulating footnote text
        self.pending_h4 = None # "Chapter I." awaiting its subh title
        self.mode = None       # None | "h4" | "subh" | "p"
        self.stack = []        # open inline groups needing }

    # -- helpers ---------------------------------------------------------
    def emit(self, text):
        if self.note_buf is not None:
            self.note_buf.append(text)
        elif self.buf is not None:
            self.buf.append(text)

    def flush_paragraph(self):
        if self.buf is None:
            return
        text = "".join(self.buf).strip()
        self.buf = None
        if not text:
            return
        if self.mode == "h4":
            self.pending_h4 = text
        elif self.mode == "subh":
            head = f"{self.pending_h4} {text}" if self.pending_h4 else text
            self.pending_h4 = None
            self.out.append(
                "\\commchapter{%s}" % head)
        else:
            if self.pending_h4:
                self.out.append("\\commchapter{%s}" % self.pending_h4)
                self.pending_h4 = None
            self.out.append(text)
        self.mode = None

    # -- parser hooks ----------------------------------------------------
    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "div2":
            self.in_chapter = a.get("id") in CHAPTERS
            return
        if not self.in_chapter:
            return
        if tag in ("h1", "h3", "hr"):
            if tag != "hr":
                self.skip_depth += 1
            return
        if self.skip_depth:
            return
        if tag == "note":
            self.note_buf = []
            return
        if tag == "p":
            cls = a.get("class", "")
            if self.note_buf is not None:
                if self.note_buf:
                    self.note_buf.append("\\par ")
                return
            self.buf = []
            self.mode = {"subh": "subh"}.get(cls, "p")
            return
        if tag == "h4":
            self.buf = []
            self.mode = "h4"
            return
        if tag == "i":
            self.emit("\\emph{")
            self.stack.append("}")
            return
        if tag == "span":
            cls = a.get("class", "")
            if cls == "sc":
                self.emit("\\textsc{")
                self.stack.append("}")
            elif cls == "Greek":
                self.emit("\\textgreek{")
                self.stack.append("}")
            else:
                self.stack.append("")
            return
        if tag == "scripRef":
            return
        if tag == "pb":
            return

    def handle_endtag(self, tag):
        if not self.in_chapter:
            return
        if tag in ("h1", "h3"):
            if self.skip_depth:
                self.skip_depth -= 1
            return
        if self.skip_depth:
            return
        if tag == "note":
            note = "".join(self.note_buf).strip()
            self.note_buf = None
            self.emit("\\footnote{%s}" % note)
            return
        if tag in ("p", "h4"):
            if self.note_buf is not None:
                return
            self.flush_paragraph()
            return
        if tag in ("i", "span"):
            if self.stack:
                self.emit(self.stack.pop())
            return

    def handle_data(self, data):
        if not self.in_chapter or self.skip_depth:
            return
        self.emit(esc(re.sub(r"\s+", " ", data)))


def main():
    with open(SRC, encoding="utf-8") as f:
        conv = Converter()
        conv.feed(f.read())
        conv.flush_paragraph()
    body = "\n\n".join(conv.out) + "\n"
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(body)
    chapters = body.count("\\commchapter")
    notes = body.count("\\footnote")
    print(f"wrote {OUT}: {chapters} chapter heads, {notes} footnotes")


if __name__ == "__main__":
    main()
