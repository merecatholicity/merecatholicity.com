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
import unicodedata
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

    def __init__(self, heading_fn, inner_heads=True, skip_titles=()):
        super().__init__(convert_charrefs=True)
        self.heading_fn = heading_fn
        self.inner_heads = inner_heads
        self.skip_titles = set(skip_titles)
        self.suppressed = 0
        self.chapter_depth = 0
        self.out = []
        self.buf = None
        self.note_buf = None
        self.stack = []        # inline groups needing }
        self.divstack = []     # (tag, is_chapter)
        self.in_chapter = False
        self.skip_h = 0
        self.head_variants = set()
        self.section_variants = set()

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
        # or of the most recent section head, with or without a leading
        # numeral
        if re.fullmatch(r"[—\s]+", text):
            return
        norm = text.strip().strip("()").rstrip(".").strip()
        bare = re.sub(r"^[IVXLC0-9]+\.\s*", "", norm)
        if {norm, bare} & (self.head_variants | self.section_variants):
            return
        self.out.append(text)

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag in ("div1", "div2", "div3", "div4"):
            title = re.sub(r"\s+", " ", a.get("title", "")).strip()
            if self.in_chapter:
                suppress = title in self.skip_titles
                self.divstack.append((tag, False, suppress))
                if suppress:
                    self.suppressed += 1
                elif title and not self.suppressed:
                    self.flush_paragraph()
                    depth = len(self.divstack) - self.chapter_depth
                    macro = "xsection" if depth <= 1 else "xsubsection"
                    self.section_variants = {title.rstrip(".").strip()}
                    self.out.append("\\%s{%s}" % (macro, esc(htmlmod.unescape(title))))
                return
            head = self.heading_fn(a.get("id", ""), title)
            self.divstack.append((tag, head is not None, False))
            self.chapter_depth = len(self.divstack)
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
        if not self.in_chapter or self.suppressed:
            return
        if tag == "note":
            self.note_buf = []
            return
        if tag == "sup":
            self.emit("\\textsuperscript{")
            self.stack.append("}")
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
                _t, was_chapter, was_suppressed = self.divstack.pop()
                if was_suppressed:
                    self.suppressed -= 1
                if was_chapter:
                    self.flush_paragraph()
                    self.in_chapter = False
            return
        if not self.in_chapter or self.suppressed:
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
        if tag in ("i", "b", "span", "sup"):
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
        if not self.in_chapter or self.skip_h or self.suppressed:
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


COUNCILS_IDS = set("ii iii iv v vi vii viii ix x xi xii xiii xiv xv xvi "
                   "xvii".split())


def councils_heading(div_id, title):
    if div_id in COUNCILS_IDS:
        return title
    return None


def ignatius_heading(div_id, title):
    """The seven epistles, shorter and longer versions as printed."""
    if re.fullmatch(r"v\.(ii|iii|iv|v|vi|vii|viii)", div_id):
        return title.replace(": Shorter and Longer Versions", "")
    return None


def ignatius_post(body):
    """Restore the print's column labels: where a chapter (or the
    greeting) carries two versions of the text, the first is the
    shorter recension and the second the longer."""
    blocks = re.split(r"\n\n(?=\\x)", body)
    out = []
    for block in blocks:
        lines = block.split("\n\n")
        head, pars = lines[0], lines[1:]
        if len(pars) == 2:
            pars[0] = "\\textsc{Shorter.}~" + pars[0]
            pars[1] = "\\textsc{Longer.}~" + pars[1]
        out.append("\n\n".join([head] + pars))
    return "\n\n".join(out)


def irenaeus3_heading(div_id, title):
    if div_id == "ix.iv":
        return title
    return None


def baptism_heading(div_id, title):
    if div_id == "vi.iii":
        return title
    return None


def unity_heading(div_id, title):
    if div_id == "iv.v.i":
        return title
    return None


def unity_post(body):
    return (body.replace("The Treatises of Cyprian.\n\n", "", 1)
                .replace("Treatise I.\n\n", "", 1))


def tome_heading(div_id, title):
    if div_id == "ii.iv.xxviii":
        return title
    return None


def clement_heading(div_id, title):
    if div_id == "ii.ii":
        return title
    return None


def justin_heading(div_id, title):
    if div_id == "viii.ii":
        return title
    return None


def didache_heading(div_id, title):
    if div_id == "viii.iii":
        return title
    return None


def festal_heading(div_id, title):
    if div_id == "xxv.iii.iii.xxv":
        return ("Letter XXXIX. Of the particular books and their number, "
                "which are accepted by the Church.")
    return None


# Gregory's letters on the title "universal bishop": the six epistles in
# the NPNF selection that argue the question, with their book and number
# restored to the heading.
GREGORY_LETTERS = {
    "iii.v.v.viii":
        ("Book V, Epistle XVIII. To John, Bishop of Constantinople.",
         "Epistle XVIII.", "To John, Bishop."),
    "iii.v.v.x":
        ("Book V, Epistle XX. To Mauricius Augustus.",
         "Epistle XX.", "To Mauricius Augustus."),
    "iii.v.v.xi":
        ("Book V, Epistle XXI. To Constantina Augusta.",
         "Epistle XXI.", "To Constantina Augusta."),
    "iii.v.v.xxii":
        ("Book V, Epistle XLIII. To Eulogius and Anastasius, Bishops.",
         "Epistle XLIII.", "To Eulogius and Anastasius, Bishops."),
    "iii.v.vii.xvi":
        ("Book VII, Epistle XXVII. To Anastasius, Bishop.",
         "Epistle XXVII.", "To Anastasius, Bishop."),
    "iii.v.viii.xviii":
        ("Book VIII, Epistle XXX. To Eulogius, Bishop of Alexandria.",
         "Epistle XXX.", "To Eulogius, Bishop."),
}


def gregletters_heading(div_id, title):
    if div_id in GREGORY_LETTERS:
        return GREGORY_LETTERS[div_id][0]
    return None


def gregletters_post(body):
    """Drop the print's number and addressee lines, which the restored
    chapter headings now carry."""
    for _head, num, addr in GREGORY_LETTERS.values():
        body = body.replace(num + "\n\n", "", 1)
        body = body.replace(addr + "\n\n", "", 1)
    return body


# (src, out, heading_fn, inner_heads, post_fn, skip_titles)
WORKS = [
    ("cyril-thml.xml", "cyril-body.tex", cyril_heading, True, cyril_post, ()),
    ("gregory-thml.xml", "gregory-body.tex", gregory_heading, True, None, ()),
    ("enchiridion.xml", "enchiridion-body.tex", ench_heading, False, None, ()),
    ("councils-thml.xml", "councils-body.tex", councils_heading, True, None,
     ("Title Page.",)),
    ("ignatius-thml.xml", "ignatius-body.tex", ignatius_heading, False,
     ignatius_post, ()),
    ("irenaeus3-thml.xml", "irenaeus3-body.tex", irenaeus3_heading, False,
     None, ()),
    ("baptism-thml.xml", "baptism-body.tex", baptism_heading, False, None, ()),
    ("unity-thml.xml", "unity-body.tex", unity_heading, False, unity_post, ()),
    ("tome-thml.xml", "tome-body.tex", tome_heading, False, None, ()),
    ("clement-thml.xml", "clement-body.tex", clement_heading, False, None, ()),
    ("justin-thml.xml", "justin-body.tex", justin_heading, False, None, ()),
    ("didache-thml.xml", "didache-body.tex", didache_heading, False, None, ()),
    ("festal39-thml.xml", "festal39-body.tex", festal_heading, False, None, ()),
    ("gregory-letters-thml.xml", "gregory-letters-body.tex",
     gregletters_heading, False, gregletters_post, ()),
]


def main():
    for src, out, heading_fn, inner_heads, post_fn, skip_titles in WORKS:
        conv = Converter(heading_fn, inner_heads, skip_titles)
        with open(src, encoding="utf-8") as f:
            conv.feed(f.read())
        conv.flush_paragraph()
        body = "\n\n".join(conv.out) + "\n"
        # the transcription sometimes splits a combining accent into its
        # own Greek span; merge abutting spans, print the inverted breve
        # as the circumflex it stands for, then compose
        while "}\\textgreek{" in body:
            body = body.replace("}\\textgreek{", "")
        body = body.replace("\u0311", "\u0342")
        body = unicodedata.normalize("NFC", body)
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
              f"{body.count(chr(92) + 'xsubsection{')} subsections, "
              f"{body.count(chr(92) + 'footnote{')} footnotes")


if __name__ == "__main__":
    main()
