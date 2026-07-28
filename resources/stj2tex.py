#!/usr/bin/env python3
"""Convert the Second Temple and Hellenistic shelf sources to LaTeX bodies.

The shelf of the world the New Testament was written in: Josephus entire
in Whiston's translation, Philo entire in Yonge's, the Book of Enoch and
the Book of Jubilees in R. H. Charles's, the Testaments of the Twelve
Patriarchs in Sinker's (extracted from ANF VIII like the other curated
extractions), and the Greek mind the Fathers answered: Plato's Phaedo in
Jowett's translation. (Epictetus, first drafted here, was ceded to the
classics wave's converter, which carries the same Long translation.)

Sources:
- Committed PG cache HTML (fetched from gutenberg.org/cache/epub/<id>/):
  antiquities-src.html (2848), wars-src.html (2850), apion-src.html
  (2849), josephus-life-src.html (2846), hades-src.html (2847, the
  Discourse to the Greeks concerning Hades, Whiston's appendix, now
  attributed to Hippolytus -- the title page discloses it),
  enoch-src.html (77935, Charles's 1917 SPCK translation), and
  phaedo-src.html (1658, Jowett).
- philo-src/ (git-ignored): the complete Yonge translation from
  http://www.earlychristianwritings.com/yonge/ (index.html plus
  book1.html..book45.html; needs a browser User-Agent). Yonge's inline
  footnotes ride as {N}{text}; his original treatise titles ride as
  {**text} notes, kept as italic bracketed lines. The transcription's
  few U+FFFD replacement chars are printed as em dashes (they stand
  where the source lost a dash).
- jubilees-src/ (git-ignored): Charles's translation from
  https://www.sacred-texts.com/bib/jub/ (index.htm, jub00..jub87.htm;
  needs browser headers or the site 403s). Footnotes sit per-page under
  a Footnotes head and are re-inlined at their references, harvested
  globally since a note can land on the page after its reference. The
  Erratum page (jub10) corrects the abbreviations list and is dropped.

Run: python stj2tex.py [work ...]   (no args = all)
"""
import html as htmlmod
import re
import sys

from ccel2tex import _titlecase
from dev2tex import (blocks, finalize, inline, strip_tags,
                     FN_O, FN_C, CHAP, SECT, UNIT, GRP_C, PAR, BRK)


# ---------------------------------------------------------------- helpers

def read(path):
    return open(path, encoding="utf-8", errors="replace").read()


_MOJI = re.compile("[\u00c2-\u00c3][\u0080-\u00bf]")


def demojibake(raw):
    """Repair double-encoded utf-8 (PG 2848 prints Caesar as C-A-tilde-
    broken-bar): a two-char sequence that decodes as latin-1 bytes into
    one utf-8 char is folded back."""
    def fix(m):
        try:
            return m.group(0).encode("latin-1").decode("utf-8")
        except (UnicodeDecodeError, UnicodeEncodeError):
            return m.group(0)
    return _MOJI.sub(fix, raw)


def common_html(raw):
    """The shared HTML normalizations before the dev2tex engine."""
    raw = re.sub(r"<!--.*?-->", " ", raw, flags=re.S)
    raw = re.sub(r"<style[^>]*>.*?</style>", " ", raw, flags=re.S)
    raw = re.sub(r"<link[^>]*>", " ", raw)
    raw = re.sub(r'<span[^>]*class="[^"]*pagenum[^"]*"[^>]*>.*?</span>',
                 "", raw, flags=re.S)
    raw = re.sub(r"<em(?=[\s>])[^>]*>", "<i>", raw).replace("</em>", "</i>")
    raw = re.sub(r"<strong(?=[\s>])[^>]*>", "<b>", raw).replace("</strong>",
                                                                "</b>")
    for cp, rep in ((0x2009, " "), (0x200A, " "), (0x2007, " "),
                    (0x2002, " "), (0x2003, " "), (0x00AD, ""),
                    (0xFEFF, "")):
        raw = raw.replace(chr(cp), rep)
    raw = re.sub(r"</?(?:footer|header|section|nav|figure|figcaption|"
                 r"aside|abbr)[^>]*>", "", raw)
    raw = re.sub(r"</?pre[^>]*>", " ", raw)
    raw = re.sub(r"</?(?:small|big|sup|sub)[^>]*>", "", raw)
    raw = re.sub(r"</td>\s*<td[^>]*>", " — ", raw)
    raw = re.sub(r"</tr>\s*<tr[^>]*>", "<br>", raw)
    raw = re.sub(r"</?(?:table|tbody|thead|colgroup|col|tr|td|th|dl|dt|dd|"
                 r"ul|ol|li)[^>]*>", " ", raw)
    return raw


def engine(raw):
    return finalize(inline(blocks(raw)))


def put_notes(tex, notes, out):
    """FN sentinels to \\footnote{...}; missing notes are dropped and
    named, as in gutenberg2tex."""
    missing = []

    def put(m):
        n = m.group(1)
        if n not in notes:
            missing.append(n)
            return ""
        body = engine(common_html(notes[n])).strip()
        # Whiston's PG notes ride in editorial brackets; unwrap them
        if body.startswith("["):
            body = body[1:].lstrip()
        if body.endswith("]"):
            body = body[:-1].rstrip()
        body = re.sub(r"(?:\\\\\s*)+$", "", body).rstrip()
        return "\\footnote{" + body + "}"
    tex = re.sub(FN_O + "([^" + FN_O + FN_C + "]+?)" + FN_C, put, tex)
    if missing:
        print(f"  {out}: missing notes {missing[:8]} "
              f"({len(missing)} in all)")
    return tex


def restore_headings(tex):
    tex = (tex.replace("\\devchapter{", "\\xchapter{")
              .replace("\\devsection{", "\\xsection{")
              .replace("\\devunit{", "\\xsubsection{"))
    tex = re.sub(r"\n\n(?:\\\\\s*\n)+\n?", "\n\n", tex)
    tex = re.sub(r"(?:\\\\\s*\n)+\s*\n", "\n\n", tex)
    tex = re.sub(r"(\\\\\s*)\[", r"\1{}[", tex)
    tex = re.sub(r"\n{3,}", "\n\n", tex).strip() + "\n"
    return polish(tex)


def polish(tex):
    """The corpus-standard cleanup: the newman LaTeX-safety passes (no
    \\par inside a text command, capped quote nesting, symbol map), then
    the character discipline (see ccel2tex): compose, drop orphaned
    combining marks LGR would die on, wrap Greek runs for the
    LGR/textalpha guard, and map the odd non-T1 Latin glyphs."""
    import unicodedata
    from newman import _heal_emphasis, _cap_quotes, _map_symbols
    tex = _map_symbols(_cap_quotes(_heal_emphasis(tex)))
    tex = unicodedata.normalize("NFC", tex)
    tex = "".join(c for c in tex if not 0x0300 <= ord(c) <= 0x036F)
    grk = "\\u0370-\\u03ff\\u1f00-\\u1fff"
    tex = re.sub("[" + grk + "](?:[" + grk + "\\s'\u2019]*[" + grk + "])?",
                 lambda m: "\\textgreek{" + m.group(0) + "}", tex)
    # transliteration letters from Latin Extended Additional (Charles
    # romanizes Hebrew with under-dots and breves): decompose each to a
    # T1-safe accent macro; an unmappable mark falls back to its base
    ACC = {0x0300: "\\`", 0x0301: "\\'", 0x0302: "\\^", 0x0303: "\\~",
           0x0304: "\\=", 0x0306: "\\u", 0x0307: "\\.", 0x0308: '\\"',
           0x030C: "\\v", 0x0323: "\\d", 0x0327: "\\c", 0x0331: "\\b"}

    def latinize(m):
        parts = unicodedata.normalize("NFD", m.group(0))
        out = parts[0]
        for mark in parts[1:]:
            acc = ACC.get(ord(mark))
            if acc:
                out = acc + "{" + out + "}"
        return out
    return re.sub("[\u1e00-\u1eff]", latinize, tex)


def report(out, tex):
    leftovers = sorted(set(re.findall(r"<[a-zA-Z/][^>]*>", tex)))
    stray = sorted(set(c for c in tex if 0xE000 <= ord(c) <= 0xF8FF
                       or ord(c) in (1, 2, 14, 15)))
    with open(out, "w", encoding="utf-8") as f:
        f.write(tex)
    print(f"wrote {out}: {tex.count(chr(92) + 'xchapter{')} chapters, "
          f"{tex.count(chr(92) + 'xsection{')} sections, "
          f"{tex.count(chr(92) + 'footnote{')} footnotes"
          + (f"  LEFTOVER {leftovers[:6]}" if leftovers else "")
          + (f"  STRAY {[hex(ord(c)) for c in stray]}" if stray else ""))


_LICENSE = re.compile(
    r"\*{3}\s*END OF|START:\s*FULL LICENSE|End of (?:the )?Project Gutenberg|"
    r"<h[12][^>]*>\s*(?:<[^>]+>\s*)*THE FULL PROJECT GUTENBERG", re.I)


# ------------------------------------------------- the Josephus PG format
#
# Whiston's Josephus in the PG cache format: headings at one level (h3 in
# the Antiquities, h2 elsewhere) carrying BOOK / CHAPTER / PREFACE /
# FOOTNOTES heads; footnotes as <a id="link...note-N"> anchors whose
# multi-paragraph <p class="foot"> bodies sit under the FOOTNOTES heads,
# referenced in-text by <a href="#link...note-N" id="link...noteref-N">.

def pg_prepare(src, key, htags):
    raw = demojibake(read(src)).replace("\r\n", "\n")
    m = re.search(r"\*{3}\s*START OF[^*]*\*{3}", raw)
    if m:
        raw = raw[m.end():]
    m = _LICENSE.search(raw)
    if m:
        raw = raw[:m.start()]

    # harvest the footnote bodies: from each note anchor to the next
    # anchor, heading, or rule; several id namespaces per file
    # (linknote-, linkprenote-, ...), so the id rides whole in the key
    notes = {}
    anchors = list(re.finditer(r'<a id="(link\w*?note-\d+)">', raw))
    for i, am in enumerate(anchors):
        end = len(raw)
        nm = re.search(r'<a id="link\w*?note-\d+">|<h\d|<hr',
                       raw[am.end():], re.I)
        if nm:
            end = am.end() + nm.start()
        body = raw[am.end():end]
        body = re.sub(r'<p class="foot">\s*\d+\s*\(<a[^>]*>return</a>\)'
                      r'\s*(?:<br[^>]*>)?', "<p>", body)
        body = re.sub(r"^\s*\[\s*", "", strip_edges(body))
        body = re.sub(r"\s*\]\s*$", "", body)
        notes[key + am.group(1)] = body
    # in-text references (the id= side); TOC links carry no id
    raw = re.sub(r'<a href="#(link\w*?note-\d+)" id="link\w*?noteref-\d+"'
                 r'[^>]*>.*?</a>',
                 lambda m: FN_O + key + m.group(1) + FN_C, raw, flags=re.S)
    # the remaining pginternal links are TOC/return furniture
    raw = re.sub(r'<a[^>]*class="pginternal"[^>]*>.*?</a>', " ", raw,
                 flags=re.S)

    # headings to fenced titles; TOC pseudo-headings died with their
    # links. A <pre> block directly after a heading is its argument
    # (the Wars sets every book and chapter argument that way) and
    # merges into the head; a note ref inside a heading moves out to
    # just after it (the Antiquities preface carries one).
    fnre = FN_O + "[^" + FN_O + FN_C + "]+?" + FN_C

    def fence(text, arg=""):
        t = re.sub(r"\s+", " ", strip_tags(text)).strip()
        a = re.sub(r"\s+", " ", strip_tags(arg)).strip()
        t = (t + " " + a).strip() if a else t
        moved = "".join(re.findall(fnre, t))
        t = re.sub(fnre, "", t).strip()
        if not t:
            return "\n\n"
        return "\n\n\x01" + t + "\x02\n\n" + moved

    gap = (r"(?:\s|<br[^>]*>|</?p[^>]*>|</?div[^>]*>|<hr[^>]*>|"
           r"<a[^>]*>|</a>|<!--.*?-->)*")
    for lvl in htags:
        # tempered dot: a heading match may never cross its own close
        # tag, or a failed pre-lookup backtracks across the next heading
        h = r"<h%d[^>]*>((?:(?!</h%d>).)*)</h%d>" % (lvl, lvl, lvl)
        raw = re.sub(h + gap + r"<pre[^>]*>((?:(?!</pre>).)*)</pre>",
                     lambda m: fence(m.group(1), m.group(2)), raw,
                     flags=re.S)
        raw = re.sub(h, lambda m: fence(m.group(1)), raw, flags=re.S)
    raw = re.sub(r"<h\d[^>]*>.*?</h\d>", " ", raw, flags=re.S)
    return raw, notes


def fix_romans(t):
    """_titlecase folds BOOK VIII to Book Viii; restore tokens that are
    valid roman numerals (two letters or more, so words stay words)."""
    def fix(m):
        tok = m.group(0)
        if re.fullmatch(r"(?i)(?=[ivxlc]{2,})C{0,3}(XC|XL|L?X{0,3})"
                        r"(IX|IV|V?I{0,3})", tok):
            return tok.upper()
        return tok
    return re.sub(r"[A-Za-z]+", fix, t)


def strip_edges(body):
    body = re.sub(r"<p[^>]*>", "<p>", body)
    return body.strip()


def josephus_convert(srcs, out, title_chaps, htag_by_src):
    """srcs: list of (file, kind) where kind is 'books' (BOOK/CHAPTER
    heads) or a literal chapter title for headless flows (the Life, the
    Hades discourse)."""
    pieces, notes = [], {}
    for k, (src, kind) in enumerate(srcs):
        raw, nts = pg_prepare(src, str(k), htag_by_src[src])
        notes.update(nts)
        if kind != "books":
            # headless: content = from after the PG title block to the
            # Footnotes head; one synthetic chapter
            fm = re.search("\x01\\s*Footnotes?\\s*\x02", raw, re.I)
            if fm:
                raw = raw[:fm.start()]
            raw = re.sub("\x01[^\x01\x02]*\x02", " ", raw)  # stray heads
            raw = "\n\n\x01" + kind + "\x02\n\n" + raw
        else:
            # start at the first real BOOK/PREFACE head
            sm = re.search("\x01(?:PREFACE|BOOK)", raw)
            if not sm:
                raise SystemExit(f"{src}: no content start found")
            raw = raw[sm.start():]
        pieces.append(raw)
    raw = "\n\n".join(pieces)

    # FOOTNOTES sections drop whole (their notes are harvested);
    # so does any Contents remnant
    raw = re.sub("\x01[^\x01\x02]*FOOTNOTES[^\x01\x02]*\x02.*?(?=\x01|$)",
                 "", raw, flags=re.S)
    raw = re.sub("\x01\\s*Footnotes?\\s*\x02.*?(?=\x01|$)", "", raw,
                 flags=re.S)
    # a bare "CHAPTER N" head merges with the title head that follows it
    raw = re.sub("\x01(CHAPTER \\d+\\.?)\\s*\x02\\s*\x01([^\x01\x02]*)\x02",
                 lambda m: "\x01" + m.group(1) + " " + m.group(2) + "\x02",
                 raw)
    # consecutive duplicate heads (Antiquities repeats BOOK VIII)
    raw = re.sub("\x01([^\x01\x02]*)\x02(\\s*)\x01\\1\x02", "\x01\\1\x02",
                 raw)

    raw = common_html(raw)
    tex = engine(raw)
    tex = put_notes(tex, notes, out)

    def head(m):
        t = re.sub(r"\s+", " ", m.group(1)).strip().rstrip("\\")
        up = t.upper()
        if up.startswith("PREFACE"):
            return "\\xchapter{The Preface of Josephus}"
        if up.startswith("BOOK"):
            return "\\xchapter{" + fix_romans(_titlecase(t)) + "}"
        if up.startswith("CHAPTER"):
            return "\\xsection{" + fix_romans(_titlecase(t)) + "}"
        return "\\xchapter{" + t + "}"
    tex = re.sub("\x01\\s*([^\x01\x02]*?)\\s*\x02", head, tex, flags=re.S)
    for t in title_chaps:                     # headless synthetic chapters
        tex = tex.replace("\\xchapter{" + _titlecase(t) + "}",
                          "\\xchapter{" + t + "}")
    tex = restore_headings(tex)
    report(out, tex)


# ------------------------------------------------------ the Book of Enoch

def enoch_convert():
    raw = read("enoch-src.html").replace("\r\n", "\n")
    m = _LICENSE.search(raw)
    if m:
        raw = raw[:m.start()]

    # footnotes: <div class="footnote" id="fN"> bodies, <a href="#fN"> refs
    notes = {}
    for fm in re.finditer(r'<div class="footnote" id="f(\d+)">(.*?)</div>',
                          raw, re.S):
        body = re.sub(r'<span class="label">.*?</span>', "", fm.group(2),
                      flags=re.S)
        notes[fm.group(1)] = body
    raw = re.sub(r'<div class="footnote" id="f\d+">.*?</div>', "", raw,
                 flags=re.S)
    raw = re.sub(r'<a[^>]*href="#f(\d+)"[^>]*>.*?</a>',
                 lambda m: FN_O + m.group(1) + FN_C, raw, flags=re.S)

    raw = re.sub(r'<span class="pageno"[^>]*>.*?</span>', "", raw, flags=re.S)
    raw = re.sub(r'<abbr[^>]*>(.*?)</abbr>', r"\1", raw, flags=re.S)
    raw = re.sub(r'<span class="sc"[^>]*>(.*?)</span>',
                 r"\1", raw, flags=re.S)
    raw = re.sub(r'<span[^>]*>', "", raw).replace("</span>", "")
    # Charles sets much of the book as verse: line divs become broken
    # lines within one paragraph block
    raw = re.sub(r'<div class="line[^"]*">\s*(.*?)\s*</div>',
                 r"\1<br>", raw, flags=re.S)
    raw = re.sub(r"<p[^>]*>\s*Printed in Great Britain.*?</p>", "", raw,
                 flags=re.S)

    # content from the Editors' Preface; the h2 TOC entries carry links
    # and died in common_html -- here just cut the PG header block
    start = re.search(r"<h2[^>]*>\s*EDITORS", raw)
    if not start:
        raise SystemExit("enoch: no EDITORS' PREFACE found")
    raw = raw[start.start():]
    fm = re.search(r'<div class="nf-center-c1">\s*<div class="nf-center">'
                   r'\s*<div>\s*Footnotes', raw)
    if fm:
        raw = raw[:fm.start()]

    raw = re.sub(r"<h2[^>]*>(.*?)</h2>",
                 lambda m: "\n\n\x01" + re.sub(
                     r"\s+", " ", strip_tags(m.group(1))).strip()
                 + "\x02\n\n", raw, flags=re.S)
    raw = common_html(raw)
    tex = engine(raw)
    tex = put_notes(tex, notes, "enoch-body.tex")

    def chap(m):
        t = re.sub(r"\s+", " ", m.group(1)).strip()
        if t.isupper():
            t = fix_romans(_titlecase(t))
        return "\\xchapter{" + t + "}"
    tex = re.sub("\x01\\s*([^\x01\x02]*?)\\s*\x02", chap, tex, flags=re.S)
    # Charles's critical symbols: the corner brackets (emended text) go
    # to amssymb's corners, the white brackets (interpolations) to
    # doubled square brackets; the single angle quotes ride T1 as-is
    for ch, rep in (("⌜", "$\\ulcorner$"), ("⌝", "$\\urcorner$"),
                    ("〚", "[["), ("〛", "]]")):
        tex = tex.replace(ch, rep)
    tex = restore_headings(tex)
    report("enoch-body.tex", tex)


# ---------------------------------------------------- the Philo of Yonge
#
# 45 treatise pages; the text is near-plain with stray <p> tags, Yonge's
# footnotes inline as {N}{text}, and editorial notes as {**text} (kept as
# italic bracketed lines). The four site volumes follow the classic
# corpus divisions.

PHILO_VOLS = [
    ("philo1-body.tex", range(1, 22)),    # Creation + Allegorical Commentary
    ("philo2-body.tex", range(22, 33)),   # The Exposition of the Law
    ("philo3-body.tex", range(33, 41)),   # Philosophical and historical
    ("philo4-body.tex", range(41, 46)),   # Questions on Genesis, fragments
]


def philo_titles():
    raw = read("philo-src/index.html")
    titles = {}
    for m in re.finditer(r'<a href="book(\d+)\.html"[^>]*>(.*?)</a>',
                         raw, re.S | re.I):
        n = int(m.group(1))
        if n not in titles:
            titles[n] = re.sub(r"\s+", " ", strip_tags(m.group(2))).strip()
    return titles


def philo_convert():
    titles = philo_titles()
    fncount = 0
    for out, nums in PHILO_VOLS:
        parts = []
        notes = {}
        for n in nums:
            raw = read(f"philo-src/book{n}.html").replace("\r\n", "\n")
            raw = re.sub(r"<(/?)([A-Za-z]+)([^>]*)>",
                         lambda m: "<" + m.group(1) + m.group(2).lower()
                         + m.group(3) + ">", raw)
            # content: from the treatise's own all-caps title line (the
            # chrome differs page to page) to the footer nav
            t = titles.get(n, f"Book {n}")
            idx = raw.find(htmlmod.unescape(t).upper()[:24])
            if idx < 0:
                am = re.search(r'<p style="position: relative[^"]*">\s*</p>',
                               raw)
                if not am:
                    raise SystemExit(f"philo book{n}: no content start")
                idx = am.end()
            raw = raw[idx:]
            raw = re.sub(r"^[A-Z][^a-z<\n]*", "", raw)
            for endmark in ("Go to the", "<!-- #include", "symboltab"):
                k = raw.find(endmark)
                if k > 0:
                    raw = raw[:raw.rfind("<", 0, k)]
                    break
            raw = raw.replace("�", "—")
            # Yonge's inline notes; then his original-title notes
            def note(m):
                nonlocal fncount
                fncount += 1
                key = f"{n}x{m.group(1)}x{fncount}"
                notes[key] = m.group(2)
                return FN_O + key + FN_C
            raw = re.sub(r"\{(\d+)\}\{([^{}]*)\}", note, raw, flags=re.S)
            raw = re.sub(r"\{\*+\}", "", raw)
            raw = re.sub(r"\{\*\*\s*([^{}]*)\}",
                         r"<p><i>[\1]</i></p>", raw, flags=re.S)
            raw = re.sub(r"\{([^{}]{0,400}?)\}", r"<p><i>[\1]</i></p>", raw,
                         flags=re.S)
            parts.append("\n\n\x01" + t + "\x02\n\n" + raw)
        raw = common_html("\n\n".join(parts))
        tex = engine(raw)
        tex = put_notes(tex, notes, out)
        tex = re.sub("\x01\\s*([^\x01\x02]*?)\\s*\x02",
                     lambda m: "\\xchapter{"
                     + re.sub(r"\s+", " ", m.group(1)).strip() + "}",
                     tex, flags=re.S)
        tex = restore_headings(tex)
        report(out, tex)


# ------------------------------------------------- the Book of Jubilees

def jubilees_convert():
    # global note harvest first: a reference can point at the next page
    notes = {}
    pages = [f"jubilees-src/jub{i:02d}.htm" for i in range(0, 88)]
    raws = {}
    for p in pages:
        try:
            raw = read(p)
        except FileNotFoundError:
            continue
        raw = re.sub(r"<(/?)([A-Za-z]+)([^>]*)>",
                     lambda m: "<" + m.group(1) + m.group(2).lower()
                     + m.group(3) + ">", raw)
        raws[p] = raw
        for m in re.finditer(
                r'<a name="fn_(\d+)">\s*</a>\s*<a href="[^"]*#fr_\d+"[^>]*>'
                r"[^<]*</a>(.*?)(?=<p>\s*<a name=\"fn_|</body|<hr|<script)",
                raw, re.S | re.I):
            notes[m.group(1)] = m.group(2)

    def page_body(raw):
        # content sits between the nav's closing <hr> and whichever
        # arrives first of the Footnotes block, the footer rule, or the
        # page scripts
        m = re.search(r"<hr>", raw)
        raw = raw[m.end():] if m else raw
        ends = [em.start() for endpat in
                (r"<h3[^>]*>\s*Footnotes\s*</h3>", r"<p>\s*<hr>",
                 r"<hr>\s*<center>\s*<a href=\"jub", r"<script",
                 r"</body")
                for em in [re.search(endpat, raw, re.I)] if em]
        if ends:
            raw = raw[:min(ends)]
        raw = re.sub(r'<a name="page_[^"]*">.*?</a>', "", raw,
                     flags=re.S | re.I)
        raw = re.sub(r"<font[^>]*>\s*\[paragraph continues\]\s*</font>\s*",
                     "\x0bJOIN\x0b", raw, flags=re.I)
        # the fr_/fn_ anchor numbers drift apart from jub40 on, so the
        # href's fn number is the authoritative note key
        raw = re.sub(r'<a name="fr_\d+">\s*(?:</a>)?\s*'
                     r'<a href="[^"]*#fn_(\d+)"[^>]*>.*?</a>',
                     lambda m: FN_O + m.group(1) + FN_C, raw,
                     flags=re.S | re.I)
        raw = re.sub(r"</?(?:center|font|a|img|nav)[^>]*>", "", raw,
                     flags=re.S)
        return raw

    def head_of(raw):
        m = re.search(r"<h[123][^>]*>(.*?)</h[123]>", raw, re.S | re.I)
        return (re.sub(r"\s+", " ", strip_tags(m.group(1))).strip()
                if m else None)

    parts = []
    for i in range(0, 88):
        p = f"jubilees-src/jub{i:02d}.htm"
        if p not in raws or i in (0, 10):     # title page, erratum
            continue
        raw = raws[p]
        title = head_of(raw) or "Untitled"
        body = page_body(raw)
        body = re.sub(r"<h\d[^>]*>.*?</h\d>", "", body, flags=re.S | re.I)
        if i == 1:
            mark = "\x01" + title + "\x02"
        elif i == 2:
            mark = "\x01Introduction\x02\n\n\x03" + title + "\x04"
        elif i < 10:
            mark = "\x03" + title + "\x04"
        elif i == 11:
            mark = "\x01The Book of Jubilees\x02\n\n\x03" + title + "\x04"
        else:
            mark = "\x03" + title + "\x04"
        parts.append("\n\n" + mark + "\n\n" + body)

    raw = common_html("\n\n".join(parts))
    tex = engine(raw)
    # join the pages the transcription split mid-paragraph
    tex = re.sub(r"\s*\x0bJOIN\x0b\s*", " ", tex)
    tex = put_notes(tex, notes, "jubilees-body.tex")
    tex = re.sub("\x01\\s*([^\x01\x02]*?)\\s*\x02",
                 lambda m: "\\xchapter{" + m.group(1).strip() + "}", tex,
                 flags=re.S)
    tex = re.sub("\x03\\s*([^\x03\x04]*?)\\s*\x04",
                 lambda m: "\\xsection{" + m.group(1).strip() + "}", tex,
                 flags=re.S)
    tex = restore_headings(tex)
    report("jubilees-body.tex", tex)


# ------------------------- the Testaments of the Twelve Patriarchs

def testaments_convert():
    from ccel2tex import convert_work, _tops_tracker

    def make_heading():
        inside = _tops_tracker("iii")

        def heading(div_id, title):
            if not inside(div_id):
                return None
            if div_id == "iii.i":            # title page
                return None
            return re.sub(r"\s+", " ", title).strip()
        return heading

    convert_work("anf08.xml", "testaments-body.tex", make_heading(),
                 safe_footnotes=True)


# ----------------------------------------------------------- Phaedo

def phaedo_convert():
    from gutenberg2tex import convert
    convert(srcs=["phaedo-src.html"], out="phaedo-body.tex",
            firsts=["INTRODUCTION."], htag=2)


# ------------------------------------------------------------- main

JOSEPHUS = [
    dict(srcs=[("antiquities-src.html", "books")],
         out="antiquities-body.tex", title_chaps=[],
         htag_by_src={"antiquities-src.html": [2, 3]}),
    dict(srcs=[("wars-src.html", "books")],
         out="wars-body.tex", title_chaps=[],
         htag_by_src={"wars-src.html": [1, 2]}),
    dict(srcs=[("josephus-life-src.html",
                "The Life of Flavius Josephus"),
               ("apion-src.html", "books"),
               ("hades-src.html",
                "An Extract out of Josephus's Discourse to the Greeks"
                " concerning Hades")],
         out="josephus-minor-body.tex",
         title_chaps=["The Life of Flavius Josephus",
                      "An Extract out of Josephus's Discourse to the"
                      " Greeks concerning Hades"],
         htag_by_src={"josephus-life-src.html": [2], "apion-src.html": [2],
                      "hades-src.html": [2]}),
]


def main():
    which = set(sys.argv[1:])

    def want(name):
        return not which or name in which
    if want("josephus"):
        for w in JOSEPHUS:
            josephus_convert(**w)
    if want("enoch"):
        enoch_convert()
    if want("philo"):
        philo_convert()
    if want("jubilees"):
        jubilees_convert()
    if want("testaments"):
        testaments_convert()
    if want("phaedo"):
        phaedo_convert()


if __name__ == "__main__":
    main()
