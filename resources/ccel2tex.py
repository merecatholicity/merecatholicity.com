#!/usr/bin/env python3
"""Convert CCEL ThML extracts to LaTeX bodies.

General successor to thml2tex.py for works whose division titles live in
the ThML title attributes. Driven by the WORKS table at the bottom:

- cyril-thml.xml      -> cyril-body.tex       (Catechetical Lectures)
- gregory-thml.xml    -> gregory-body.tex     (The Great Catechism)
- enchiridion.xml     -> enchiridion-body.tex (Enchiridion, tr. Outler)

Each kept division becomes \\xchapter{...}; divisions nested inside a
kept one, and h2-h5 heads, become \\xsection{...}. Footnotes are inlined
at their reference points. The wrapper .tex files define the macros.

Run: python ccel2tex.py
"""
import html as htmlmod
import re
import sys
from html.parser import HTMLParser

TEX_SPECIALS = {
    "\\": r"\textbackslash{}", "&": r"\&", "%": r"\%", "$": r"\$",
    "#": r"\#", "_": r"\_", "{": r"\{", "}": r"\}",
    "~": r"\textasciitilde{}", "^": r"\textasciicircum{}",
    " ": "~",
}


def esc(text):
    return "".join(TEX_SPECIALS.get(c, c) for c in text)


class Converter(HTMLParser):
    """heading_fn(div_id, title) returns the chapter heading, or None to
    skip that division entirely."""

    def __init__(self, heading_fn, inner_heads=True):
        super().__init__(convert_charrefs=True)
        self.heading_fn = heading_fn
        self.inner_heads = inner_heads
        self.out = []
        self.buf = None
        self.note_buf = None
        self.stack = []        # inline groups needing }
        self.divstack = []     # (tag, is_chapter)
        self.in_chapter = False
        self.skip_h = 0
        self.head_variants = set()

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
        # print furniture: dash rules, and repeats of the chapter head
        if re.fullmatch(r"[—\s]+", text):
            return
        if text.strip().strip("()").rstrip(".").strip() in self.head_variants:
            return
        self.out.append(text)

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag in ("div1", "div2", "div3", "div4"):
            title = re.sub(r"\s+", " ", a.get("title", "")).strip()
            if self.in_chapter:
                self.divstack.append((tag, False))
                if title:
                    self.flush_paragraph()
                    self.out.append("\\xsection{%s}" % esc(htmlmod.unescape(title)))
                return
            head = self.heading_fn(a.get("id", ""), title)
            self.divstack.append((tag, head is not None))
            if head is not None:
                self.in_chapter = True
                # repeats of the head, or of its "Lecture N." / title
                # halves, are print furniture to drop from the body
                norm = lambda s: s.strip().strip("()").rstrip(".").strip()
                self.head_variants = {norm(head)}
                m2 = re.match(r"(Lecture [IVX]+\.)\s*(.*)", head)
                if m2:
                    self.head_variants.add(norm(m2.group(1)))
                    rest = m2.group(2)
                    self.head_variants.add(norm(rest))
                    for part in rest.split(":"):
                        self.head_variants.add(norm(part))
                self.out.append("\\xchapter{%s}" % esc(htmlmod.unescape(head)))
            return
        if not self.in_chapter:
            return
        if tag == "note":
            self.note_buf = []
            return
        if tag == "p":
            if self.note_buf is not None:
                if self.note_buf:
                    self.note_buf.append("\\par ")
                return
            self.flush_paragraph()
            self.buf = []
            return
        if tag in ("h2", "h3", "h4", "h5"):
            if not self.inner_heads:
                self.skip_h += 1
                return
            self.flush_paragraph()
            self.buf = []
            return
        if tag == "h1":
            self.skip_h += 1
            return
        if tag == "blockquote":
            self.flush_paragraph()
            self.out.append("\\begin{quote}")
            return
        if tag == "i":
            self.emit("\\emph{")
            self.stack.append("}")
            return
        if tag == "b":
            self.emit("\\textbf{")
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

    def handle_endtag(self, tag):
        if tag in ("div1", "div2", "div3", "div4"):
            if self.divstack:
                _t, was_chapter = self.divstack.pop()
                if was_chapter:
                    self.flush_paragraph()
                    self.in_chapter = False
            return
        if not self.in_chapter:
            return
        if tag == "h1":
            if self.skip_h:
                self.skip_h -= 1
            return
        if tag == "note":
            note = "".join(self.note_buf).strip()
            self.note_buf = None
            self.emit("\\footnote{%s}" % note)
            return
        if tag == "p":
            if self.note_buf is not None:
                return
            self.flush_paragraph()
            return
        if tag in ("h2", "h3", "h4", "h5"):
            if not self.inner_heads:
                if self.skip_h:
                    self.skip_h -= 1
                return
            text = "".join(self.buf or []).strip()
            self.buf = None
            if text:
                self.out.append("\\xsection{%s}" % text)
            return
        if tag == "blockquote":
            self.flush_paragraph()
            self.out.append("\\end{quote}")
            return
        if tag in ("i", "b", "span"):
            if self.stack:
                self.emit(self.stack.pop())
            return

    def last_char(self):
        buf = self.note_buf if self.note_buf is not None else self.buf
        for piece in reversed(buf or []):
            if piece:
                return piece[-1]
        return "\n"

    def handle_data(self, data):
        if not self.in_chapter or self.skip_h:
            return
        text = re.sub(r"\s+", " ", data)
        # straight double quotes to TeX quotes by context
        out = []
        for ch in text:
            if ch == '"':
                prev = out[-1] if out else self.last_char()
                out.append("``" if prev in " \n\t(—[{" else "''")
            else:
                out.append(ch)
        self.emit(esc("".join(out)))


ROMANS = ("I II III IV V VI VII VIII IX X XI XII XIII XIV XV XVI XVII "
          "XVIII XIX XX XXI XXII XXIII").split()
CYRIL_LECTURES = ("v vi vii viii ix x xi xii xiii xiv xv xvi xvii xviii "
                  "xix xx xxi xxii").split()
CYRIL_MYSTAGOGIC = "xxiii xxiv xxv xxvi xxvii".split()


def cyril_heading(div_id, title):
    if div_id == "ii.iv":
        return title
    m = re.fullmatch(r"ii\.([ivx]+)", div_id)
    if not m:
        return None
    r = m.group(1)
    if r in CYRIL_LECTURES:
        return f"Lecture {ROMANS[CYRIL_LECTURES.index(r)]}. {title}"
    if r in CYRIL_MYSTAGOGIC:
        # the mystagogic lectures continue the numbering: XIX-XXIII
        return f"Lecture {ROMANS[18 + CYRIL_MYSTAGOGIC.index(r)]}. {title}"
    return None


def gregory_heading(div_id, title):
    if re.fullmatch(r"xi\.ii\.[ivxl]+", div_id):
        return title
    return None


def ench_heading(div_id, title):
    if re.fullmatch(r"chapter\d+", div_id):
        return title
    return None


CYRIL_FURNITURE = [
    # half-title block of the whole work, before the Procatechesis
    ("The\n\nCatechetical Lectures\n\nof\n\nS. Cyril,\n\n"
     "Archbishop of Jerusalem.\n\n"),
    # half-title block at the head of the Procatechesis
    ("PROCATECHESIS,\n\nOR,\n\n"
     "\\textsc{PROLOGUE TO THE CATECHETICAL LECTURES OF OUR HOLY FATHER,}\n\n"
     "\\textsc{CYRIL, ARCHBISHOP OF JERUSALEM.}\n\n"),
    # half-title block at the head of Lecture I
    ("FIRST CATECHETICAL LECTURE\n\nof\n\nOur Holy Father Cyril,\n\n"
     "Archbishop of Jerusalem,\n\n"),
]


def cyril_post(body):
    for block in CYRIL_FURNITURE:
        assert block in body, "cyril furniture block not found"
        body = body.replace(block, "", 1)
    # the general title of the mystagogic lectures, case-mangled in the
    # source transcription; keep it (it carries the authenticity note)
    mangled = ("fIVE Catechetical Lectures\n\nof\n\nTHE saME aUTHOR,\n\n"
               "TO THE nEWLY bAPTIZED")
    clean = ("Five Catechetical Lectures of the Same Author, "
             "to the Newly Baptized")
    assert mangled in body, "cyril mystagogic title not found"
    return body.replace(mangled, clean, 1)


# (src, out, heading_fn, inner_heads, post_fn)
WORKS = [
    ("cyril-thml.xml", "cyril-body.tex", cyril_heading, True, cyril_post),
    ("gregory-thml.xml", "gregory-body.tex", gregory_heading, True, None),
    ("enchiridion.xml", "enchiridion-body.tex", ench_heading, False, None),
]


def main():
    for src, out, heading_fn, inner_heads, post_fn in WORKS:
        conv = Converter(heading_fn, inner_heads)
        with open(src, encoding="utf-8") as f:
            conv.feed(f.read())
        conv.flush_paragraph()
        body = "\n\n".join(conv.out) + "\n"
        if post_fn:
            body = post_fn(body)
        # Hebrew word-citations (tagged Greek in the source) cannot be
        # set by pdflatex's LGR path; give them their own macro. The
        # HTML build unwraps it, the PDF renders a marker.
        body = re.sub(r"\\textgreek\{([^{}]*[\u0590-\u05FF][^{}]*)\}",
                      "\u203a\\1\u2039", body)
        body = re.sub(r"(?<![\u203a])([\u0590-\u05FF][\u0590-\u05FF\s]*)",
                      "\u203a\\1\u2039", body)
        body = body.replace("\u203a", "\\texthebrew{").replace("\u2039", "}")
        with open(out, "w", encoding="utf-8") as f:
            f.write(body)
        print(f"wrote {out}: {body.count(chr(92) + 'xchapter{')} chapters, "
              f"{body.count(chr(92) + 'xsection{')} sections, "
              f"{body.count(chr(92) + 'footnote{')} footnotes")


if __name__ == "__main__":
    main()
