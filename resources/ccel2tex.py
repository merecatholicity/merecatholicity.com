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

    def __init__(self, heading_fn, inner_heads=True, skip_titles=(),
                 safe_footnotes=False, table_cells=False,
                 verse_lines=False):
        super().__init__(convert_charrefs=True)
        self.heading_fn = heading_fn
        self.inner_heads = inner_heads
        self.skip_titles = set(skip_titles)
        # emit \footnote outside any open inline font group, so a note whose
        # body carries a \par (multi-paragraph or verse footnotes) cannot end
        # the argument of a non-\long \textsc/\textbf/\textsuperscript.
        self.safe_footnotes = safe_footnotes
        # treat each table cell as a paragraph. The creeds/history volumes
        # set parallel texts (Greek/Latin | English) in <table> rows whose
        # cells often hold bare text with no <p>; without this, that text
        # lands outside any open buffer and is dropped. Off by default so
        # the older curated bodies stay byte-stable.
        self.table_cells = table_cells
        # ThML verse: <l> lines joined with TeX line breaks (The
        # Christian Year); off by default
        self.verse_lines = verse_lines
        self.suppressed = 0
        self.chapter_depth = 0
        self.out = []
        self.buf = None
        self.note_buf = None
        self.note_depth = 0    # creeds3 mis-nests a <note> inside a <note>
        self.stack = []        # inline groups: (opener, closer) needing closer
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
            # a mis-nested inner note is flattened into the outer footnote
            self.note_depth += 1
            if self.note_depth == 1:
                self.note_buf = []
            else:
                self.note_buf.append(" ")
            return
        if tag == "sup":
            self.emit("\\textsuperscript{")
            self.stack.append(("\\textsuperscript{", "}"))
            return
        if tag == "p":
            if self.note_buf is not None:
                if self.note_buf:
                    # "\\par{}" — the empty group is load-bearing. A bare "\\par"
                    # followed by "[" makes pandoc read the bracket as an OPTIONAL
                    # ARGUMENT and swallow it, so an editorial note like
                    # "\\footnote{\\par [Or of St. James, so called.]}" renders EMPTY,
                    # and an unclosed "[" eats the rest of the file ("unexpected end
                    # of input"). The schaff/newman html loops were immune by accident
                    # — they sed every "[" to "{[}" — but the curated loop does not,
                    # so liturgies, trent and didache shipped blank notes. Fixing it
                    # here protects every work whatever loop builds it. The group is a
                    # no-op for pdflatex, so the PDFs are unaffected.
                    self.note_buf.append("\\par{} ")
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
            self.stack.append(("\\emph{", "}"))
            return
        if tag == "b":
            self.emit("\\textbf{")
            self.stack.append(("\\textbf{", "}"))
            return
        if tag == "span":
            cls = a.get("class", "")
            if cls == "sc":
                self.emit("\\textsc{")
                self.stack.append(("\\textsc{", "}"))
            elif cls == "Greek":
                self.emit("\\textgreek{")
                self.stack.append(("\\textgreek{", "}"))
            else:
                self.stack.append(("", ""))
            return
        if tag in ("td", "th") and self.table_cells:
            if self.note_buf is None:
                self.flush_paragraph()
                self.buf = []
            return
        if tag == "l" and self.verse_lines:
            if self.note_buf is None and self.buf is None:
                self.buf = []
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
            if self.note_depth > 1:      # closing a flattened inner note
                self.note_depth -= 1
                return
            if self.note_depth == 0:     # stray close, no note open
                return
            self.note_depth = 0
            note = "".join(self.note_buf).strip()
            self.note_buf = None
            fn = "\\footnote{%s}" % note
            if self.safe_footnotes and self.stack:
                # lift the note out of the open inline groups, then reopen
                # them, so a \par in the note can't break a non-\long \textXX
                closers = "".join(c for _o, c in reversed(self.stack))
                openers = "".join(o for o, _c in self.stack)
                self.emit(closers + fn + openers)
            else:
                self.emit(fn)
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
        if tag in ("td", "th") and self.table_cells:
            if self.note_buf is None:
                self.flush_paragraph()
            return
        if tag == "l" and self.verse_lines:
            if self.note_buf is None and self.buf is not None:
                self.buf.append("\\\\\n")
            return
        if tag in ("i", "b", "span", "sup"):
            if self.stack:
                self.emit(self.stack.pop()[1])
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


def soulres_heading(div_id, title):
    """Argument and the dialogue itself as the two divisions."""
    if div_id in ("x.iii.i", "x.iii.ii"):
        return title
    return None


def soulres_post(body):
    return body.replace("On the Soul and the Resurrection.\n\n", "", 1)


ONBAPTISM_BOOKS = {
    "v.iv.ii": "Preface.",
    "v.iv.iii": "Book I.", "v.iv.iv": "Book II.", "v.iv.v": "Book III.",
    "v.iv.vi": "Book IV.", "v.iv.vii": "Book V.", "v.iv.viii": "Book VI.",
    "v.iv.ix": "Book VII.",
}


def onbaptism_heading(div_id, title):
    """Preface and Books I-VII; the printed argument-titles join the
    book number in the heading."""
    if div_id not in ONBAPTISM_BOOKS:
        return None
    num = ONBAPTISM_BOOKS[div_id]
    if num.startswith("Book"):
        return num + " " + title
    return num


def onbaptism_post(body):
    half_title = ("The\n\nSeven Books of Augustin,\n\nBishop of Hippo\n\n"
                  "On Baptism, Against the Donatists\n\n"
                  "\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\n\n")
    assert half_title in body, "onbaptism half title not found"
    return body.replace(half_title, "", 1)


def cassian_heading(div_id, title):
    if div_id in ("iv.iv.x", "iv.iv.xi"):
        return title
    return None


def benedict_heading(div_id, title):
    """Prologue and Chapters I-LXXIII; skip title page and indexes."""
    if div_id in ("i", "lxxvi") or title == "Indexes":
        return None
    return title


# --- extractions from the whole Schaff/CCEL volumes -------------------
#
# These pull one work out of a volume file (npnf101.xml, npnf102.xml,
# npnf204.xml, creeds2.xml). The Converter consults the heading function
# for every division not inside a kept chapter, so each function must
# answer for the *whole* volume: activate under the work's own top
# division and return None everywhere else. A couple of transcription
# quirks force position over id: some book divisions carry glitched ids
# with no volume prefix (Confessions Books I-II are "I_1"/"II_1", On
# Christian Doctrine Book IV is "IV_1"), so the functions track which
# top-level division they are under as the ids stream past in document
# order.

def _tops_tracker(active_top):
    """Returns (fn) -> bool: whether the consulted id is inside
    `active_top`, tracking top-level ids (no dot) as they pass."""
    state = {"in": False}

    def inside(div_id):
        if "." not in div_id and re.fullmatch(r"[ivxlc]+", div_id):
            state["in"] = (div_id == active_top)
            return False               # the top division itself
        return state["in"]

    return inside


def make_cityofgod_heading():
    inside = _tops_tracker("iv")
    n = {"book": 0}

    def heading(div_id, title):
        if not inside(div_id):
            return None
        title = re.sub(r"\s+", " ", title).strip()
        if div_id == "iv.i":            # Translator's Preface
            return title
        n["book"] += 1
        return "Book %s. %s" % (ROMANS[n["book"] - 1], title)

    return heading


def make_ondoctrine_heading():
    inside = _tops_tracker("v")

    def heading(div_id, title):
        # Book IV carries a glitched id with no volume prefix
        if not inside(div_id) and div_id != "IV_1":
            return None
        title = re.sub(r"\s+", " ", title).strip()
        if "contents" in title.lower():
            return None
        if div_id == "v.iv":            # Book I, titled by its argument
            return "Book I. " + title
        return title

    return heading


def make_confessions_heading():
    inside = _tops_tracker("vi")
    n = {"book": 0}

    def heading(div_id, title):
        # Books I and II carry glitched ids with no volume prefix
        if not inside(div_id) and div_id not in ("I_1", "II_1"):
            return None
        title = re.sub(r"\s+", " ", title).strip()
        if div_id in ("vi.i", "vi.ii"):  # translator's front matter
            return title
        n["book"] += 1
        return "Book %s. %s" % (ROMANS[n["book"] - 1], title)

    return heading


def make_incarnation_heading():
    inside = _tops_tracker("vii")
    n = {"sec": 0}

    def heading(div_id, title):
        if not inside(div_id):
            return None
        title = re.sub(r"\s+", " ", title).strip()
        if div_id == "vii.i":
            return title                 # the editor's introduction
        if div_id == "vii.ii":
            return None                  # container: promote its sections
        n["sec"] += 1
        return "§ %d. %s" % (n["sec"], title)

    return heading


def trent_heading(div_id, title):
    """The dogmatic canons and decrees of Trent (creeds2), session by
    session, with the Profession of the Tridentine Faith appended."""
    if re.fullmatch(r"v\.i\.i\.[ivxlc]+", div_id):
        return re.sub(r"\s+", " ", title).strip()
    if div_id == "v.i.ii":
        return re.sub(r"\s+", " ", title).strip()
    return None


def make_damascus_heading():
    """An Exact Exposition of the Orthodox Faith (npnf209): the Prologue
    and the four Books as chapters; their chapters become sections."""
    inside = _tops_tracker("iii")

    def heading(div_id, title):
        if not inside(div_id):
            return None
        title = re.sub(r"\s+", " ", title).strip()
        if div_id == "iii.iii":
            return title                 # Prologue
        if div_id == "iii.iv":
            return None                  # container: promote the Books
        if re.fullmatch(r"iii\.iv\.[ivxlc]+", div_id):
            return title
        return None

    return heading


def make_liturgies_heading():
    """The Early Liturgies division of ANF VII: the introductory notice,
    the three liturgies, and the elucidations as chapters."""
    inside = _tops_tracker("xii")

    def heading(div_id, title):
        if not inside(div_id):
            return None
        if re.fullmatch(r"xii\.[ivxlc]+", div_id):
            return re.sub(r"\s+", " ", title).strip()
        return None

    return heading


def make_articles_heading():
    """The Thirty-Nine Articles of Religion (creeds3, div iv.xi): one
    flat division, English and Latin in parallel, with the American
    revision of 1801 as printed by Schaff."""
    inside = _tops_tracker("iv")

    def heading(div_id, title):
        if not inside(div_id):
            return None
        if div_id == "iv.xi":
            return ("The Thirty-Nine Articles of Religion, A.D. 1571")
        return None

    return heading


def liturgies_post(body):
    """Close Coxe's editorial bracket in the Lavabo note of St. James.

    The ANF transcription opens "[A Lavabo: ..." and never closes it; every
    sibling elucidation in the work closes its bracket, so this is a slip in
    the source, not a style. It mattered far out of proportion: an unmatched
    "[" straight after \\par sends pandoc's LaTeX reader hunting an optional
    argument to the end of the file ("unexpected end of input"), so the whole
    work failed to convert — silently, because the curated html loop echoed
    "built liturgies.html" whatever pandoc's exit status was. docs/liturgies.html
    therefore sat frozen at an older build while every rebuild reported success.
    """
    broken = "[A Lavabo: he prepares himself by the prayer for purification.}"
    assert broken in body, "liturgies: the Lavabo note moved or was repaired upstream"
    return body.replace(broken, broken[:-1] + "]}", 1)


def articles_post(body):
    """The Articles print three parallel columns (Latin, the 1571
    English, the 1801 American revision), so each article arrives as a
    triple numeral run and three title lines. Promote each to a section
    headed by the modern-English title; the three texts follow. The
    print-furniture headings drop; then the shared symbol map."""
    from schaff import volume_post

    def art(m):
        n, latin, t71, t01 = m.groups()
        return ("\\xsection{Article %s. %s}\n\n" % (n, t01.strip()))
    body = re.sub(
        r"([IVXL]+)\.\n\n\1\.\n\n(?:\[?[IVXL]+\.\]?\n\n)?"
        r"(?:\\emph\{)?([^\n{}]{2,110}?)\.?\}?\n\n"
        r"(?:\\emph\{)?([^\n{}]{2,110}?)\.?\}?\n\n"
        r"(?:\\emph\{)?([^\n{}]{2,110}?)\.?\}?\n\n",
        art, body)
    # three articles are set irregularly (a numeral missing, or the
    # English pair renumbered); key them by their unique opening lines
    for n, title in (
            ("XXIX", "Of the Wicked, which eat not the Body of Christ "
                     "in the use of the Lord's Supper"),
            ("XXXIII", "Of excommunicate Persons, how they are to be "
                       "avoided"),
            ("XXXVI", "Of Consecration of Bishops and Ministers")):
        body = re.sub(
            r"(?m)^%s\.\n\n(?:\[?[IVXL]+\.\]?\n\n)?"
            r"(?:(?:\\emph\{)?[^\n{}]{2,110}?\.?\}?\n\n){1,3}" % n,
            "\\\\xsection{Article %s. %s}\n\n" % (n, title),
            body, count=1)
    body = re.sub(r"\\xsection\{ARTICULI [^}]*\}\n*", "", body)
    body = re.sub(r"\\xsection\{T\\textsc\{he[^\n]*\n*", "", body)
    body = re.sub(r"\\xsection\{\\textsc\{a\.d\.[^\n]*\n*", "", body)
    return volume_post(body)


def make_westminster_heading():
    """The Westminster Confession (with the American amendments as
    printed by Schaff) and the Shorter Catechism, from creeds3. Each is
    one flat division whose chapter heads are inline h3/h4 (converted
    with inner_heads=True); the facsimile plates are furniture."""
    inside = _tops_tracker("iv")

    def heading(div_id, title):
        if not inside(div_id):
            return None
        title = re.sub(r"\s+", " ", title).strip()
        if div_id == "iv.xvii.ii":
            return "The Westminster Confession of Faith, A.D. 1647"
        if div_id == "iv.xviii":
            return "The Westminster Shorter Catechism, A.D. 1647"
        return None

    return heading


def westminster_post(body):
    """The Confession is set as one English|Latin parallel table whose
    chapter heads are table rows: linearized they arrive as the run
    "Chapter N. / Cap. N. / <English title> / <Latin title>". Promote
    each to a section heading carrying the English title, drop the Latin
    half and the print-furniture subtitles, then the shared symbol map."""
    from schaff import volume_post
    # Ch. XXXII's title is split across two \emph runs by an American-
    # edition footnote; rejoin it by hand before the general pattern
    body = re.sub(
        r"Chapter XXXII\.\n\nCap\. XXXII\.\n\n"
        r"\\emph\{Of the State of Men\}"
        r"(\\footnote\{(?:[^{}]|\{[^{}]*\})*\})"
        r"\\emph\{ after Death, and of the Resurrection of the Dead\}\.\n\n"
        r"[^\n]+\n\n",
        lambda m: ("\\xsection{Chapter XXXII. Of the State of Men after "
                   "Death, and of the Resurrection of the Dead}%s\n\n"
                   % m.group(1)),
        body)

    def chap(m):
        title = (m.group(2) or m.group(3) or "").strip().rstrip(".")
        return ("\\xsection{Chapter %s. %s}%s\n\n"
                % (m.group(1), title, m.group(4) or ""))
    body = re.sub(
        r"Chapter ([IVXLC]+)\.\n\n"
        r"Cap\. [IVXLC]+\.\n\n"
        r"(?:\\emph\{([^\n{}]+?)\.?\}|([^\n{}\\][^\n{}]*?))\.?"
        r"((?:\\footnote\{(?:[^{}]|\{[^{}]*\})*\})?)\n\n"
        r"[^\n]+\n\n",
        chap, body)
    body = re.sub(r"\\xsection\{THE WESTMINSTER [^}]*\}\n*", "", body)
    body = re.sub(r"\\xsection\{C\\textsc\{onfessio[^\n]*\n*", "", body)
    body = re.sub(r"\\xsection\{Catechismus [^}]*\}\n*", "", body)
    return volume_post(body)


_SMALL_WORDS = {"a", "an", "and", "as", "at", "but", "by", "for", "in",
                "of", "on", "or", "the", "to", "with"}


def _titlecase(t):
    words = t.lower().split()
    out = []
    for i, w in enumerate(words):
        out.append(w if w in _SMALL_WORDS and i > 0 else w.capitalize())
    return " ".join(out)


def institutes_post(body):
    """Two transcription fossils: one Greek word set in the legacy
    Symbol-font private-use range (Tertullian's oikonomias, quoted in a
    footnote), and a French où whose grave arrived as a small tilde."""
    from schaff import volume_post
    body = body.replace(
        ""
        "", "\\textgreek{οἰκονομίας}")
    body = body.replace("o˜", "où").replace("˜",
                                                 "\\textasciitilde{}")
    return volume_post(body)


def calvin_heading(div_id, title):
    """The Institutes: the four Books (all-caps in the source, restored
    to title case), the prefatory material, and the Aphorisms."""
    title = re.sub(r"\s+", " ", title).strip().rstrip(",")
    if not title or title.lower() == "title page" or \
            re.search(r"\bindex(es)?\b", title, re.I):
        return None
    if title.isupper():
        title = _titlecase(title)
    return title


# --- Chesterton (CCEL ThML editions) -----------------------------------

ORTHODOXY_TITLES = {
    "iv": "I. Introduction in Defence of Everything Else",
    "v": "II. The Maniac",
    "vi": "III. The Suicide of Thought",
    "vii": "IV. The Ethics of Elfland",
    "viii": "V. The Flag of the World",
    "ix": "VI. The Paradoxes of Christianity",
    "x": "VII. The Eternal Revolution",
    "xi": "VIII. The Romance of Orthodoxy",
    "xii": "IX. Authority and the Adventurer",
}


def orthodoxy_heading(div_id, title):
    """The chapter divisions are titled with bare roman numerals; restore
    the book's own chapter titles."""
    if div_id in ORTHODOXY_TITLES:
        return ORTHODOXY_TITLES[div_id]
    if div_id == "ii":
        return "Preface"
    return None


def chesterton_heading(div_id, title):
    """Heretics and The Everlasting Man carry real division titles; keep
    everything except the title page and indexes."""
    title = re.sub(r"\s+", " ", title).strip()
    if not title or title.lower() in ("title page",) or \
            re.search(r"\bindex(es)?\b", title, re.I):
        return None
    if title.isupper():                  # "PREPATORY NOTE" (sic)
        title = title.title().replace("Prepatory", "Prefatory")
    return title


# Extractions and whole ThML books added with the library expansion.
# kwargs go straight to convert_work; heading factories are re-called
# per run so their counters reset.
EXTRA_WORKS = [
    dict(src="npnf102.xml", out="cityofgod-body.tex",
         heading_fn=make_cityofgod_heading, safe_footnotes=True),
    dict(src="npnf102.xml", out="ondoctrine-body.tex",
         heading_fn=make_ondoctrine_heading, safe_footnotes=True),
    dict(src="npnf101.xml", out="confessions-body.tex",
         heading_fn=make_confessions_heading, safe_footnotes=True),
    dict(src="npnf204.xml", out="incarnation-body.tex",
         heading_fn=make_incarnation_heading, safe_footnotes=True),
    dict(src="creeds2.xml", out="trent-body.tex",
         heading_fn=lambda: trent_heading, safe_footnotes=True,
         table_cells=True),
    dict(src="orthodoxy-thml.xml", out="orthodoxy-body.tex",
         heading_fn=lambda: orthodoxy_heading),
    dict(src="heretics-thml.xml", out="heretics-body.tex",
         heading_fn=lambda: chesterton_heading),
    dict(src="everlasting-thml.xml", out="everlasting-body.tex",
         heading_fn=lambda: chesterton_heading),
    dict(src="npnf209.xml", out="damascus-body.tex",
         heading_fn=make_damascus_heading, safe_footnotes=True),
    dict(src="anf07.xml", out="liturgies-body.tex",
         heading_fn=make_liturgies_heading, safe_footnotes=True,
         post_fn=liturgies_post),
    dict(src="creeds3.xml", out="articles1571-body.tex",
         heading_fn=make_articles_heading, safe_footnotes=True,
         table_cells=True, inner_heads=True, post_fn=articles_post),
    dict(src="creeds3.xml", out="westminster-body.tex",
         heading_fn=make_westminster_heading, safe_footnotes=True,
         table_cells=True, inner_heads=True, post_fn=westminster_post),
    dict(src="institutes-thml.xml", out="institutes-body.tex",
         heading_fn=lambda: calvin_heading, safe_footnotes=True,
         post_fn=institutes_post),
    dict(src="bondage-thml.xml", out="bondage-body.tex",
         heading_fn=lambda: chesterton_heading, safe_footnotes=True),
    dict(src="luther-galatians-thml.xml", out="luther-galatians-body.tex",
         heading_fn=lambda: chesterton_heading, safe_footnotes=True),
    dict(src="keble-year-thml.xml", out="keble-year-body.tex",
         heading_fn=lambda: chesterton_heading, safe_footnotes=True,
         verse_lines=True),
    dict(src="andrewes-devotions-thml.xml", out="andrewes-devotions-body.tex",
         heading_fn=lambda: chesterton_heading, safe_footnotes=True),
]


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
    ("soulres-thml.xml", "soulres-body.tex", soulres_heading, False,
     soulres_post, ("Title Page.",)),
    ("onbaptism-thml.xml", "onbaptism-body.tex", onbaptism_heading, False,
     onbaptism_post, ("Title Page.",)),
    ("cassian-prayer-thml.xml", "cassian-prayer-body.tex", cassian_heading,
     False, None, ()),
    ("benedict-rule.xml", "benedict-rule-body.tex", benedict_heading,
     False, None, ()),
]


def convert_work(src, out, heading_fn, inner_heads=False, post_fn=None,
                 skip_titles=(), safe_footnotes=False, quiet=False,
                 table_cells=False, verse_lines=False):
    """Parse a CCEL ThML file to a LaTeX body and write it to `out`.

    Shared by the curated WORKS table below and by schaff.py, which
    reuses this exact normalization to render whole Schaff volumes.
    Returns the finished body string.
    """
    conv = Converter(heading_fn, inner_heads, skip_titles, safe_footnotes,
                     table_cells, verse_lines)
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
    # NFC has folded every real accent into a precomposed Greek letter, so
    # the only combining marks left standing (U+0300..U+036F) are ones that
    # did not compose: orphaned breathings, editorial ties (double tilde,
    # diaeresis-below), a perispomeni with no base. LGR/textalpha hard-errors
    # on those ("Unicode character not set up for use with LaTeX"), and a
    # single one kills a whole volume of Greek. They carry no reading value
    # once orphaned, so drop them all.
    body = "".join(c for c in body if not 0x0300 <= ord(c) <= 0x036F)
    if post_fn:
        body = post_fn(body)
    # Hebrew word-citations (tagged Greek in the source) cannot be
    # set by pdflatex's LGR path; give them their own macro. The
    # HTML build unwraps it, the PDF renders a marker. The sentinels
    # must be characters the transcription can never itself contain:
    # STX/ETX control chars, not the guillemets \u2039/\u203a, which do
    # appear in the source Greek and were turning into stray braces.
    _H0, _H1 = "\u0002", "\u0003"  # STX/ETX sentinels, never in source
    # the class includes the Hebrew presentation forms (U+FB1D-FB4F):
    # the History quotes pointed Hebrew with the alternative ayin
    # U+FB20, which must ride inside the wrap or inputenc dies on it
    _HEB = "\\u0590-\\u05FF\\uFB1D-\\uFB4F"
    body = re.sub(r"\\textgreek\{([^{}]*[" + _HEB + r"][^{}]*)\}",
                  _H0 + r"\1" + _H1, body)
    body = re.sub(r"(?<![\u0002])([" + _HEB + r"][" + _HEB + r"\s]*)",
                  _H0 + r"\1" + _H1, body)
    body = body.replace(_H0, "\\texthebrew{").replace(_H1, "}")
    with open(out, "w", encoding="utf-8") as f:
        f.write(body)
    if not quiet:
        print(f"wrote {out}: {body.count(chr(92) + 'xchapter{')} chapters, "
              f"{body.count(chr(92) + 'xsection{')} sections, "
              f"{body.count(chr(92) + 'xsubsection{')} subsections, "
              f"{body.count(chr(92) + 'footnote{')} footnotes")
    return body


def main():
    for src, out, heading_fn, inner_heads, post_fn, skip_titles in WORKS:
        convert_work(src, out, heading_fn, inner_heads, post_fn, skip_titles)
    from schaff import volume_post  # lazy: schaff imports this module
    for w in EXTRA_WORKS:
        kw = dict(w)
        kw["heading_fn"] = kw["heading_fn"]()   # fresh closure per run
        kw.setdefault("post_fn", volume_post)   # same symbol repertoire
        convert_work(**kw)


if __name__ == "__main__":
    main()
