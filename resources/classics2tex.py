#!/usr/bin/env python3
"""Convert the Latin & Greek classics shelf to LaTeX bodies.

One driver for the whole classical wave (2026-07): the Greek foundations,
the Roman spine, the philosophy the Church argued with, the pagan-Christian
collision shelf, and the Indo-European texts. Reuses the dev2tex engine
(blocks/inline/finalize) like gutenberg2tex, plus the thayer2tex page
machinery for LacusCurtius and a MediaWiki cleaner for Wikisource renders.

Sources:
- Project Gutenberg books preserved as committed ``*-src.html`` flat files
  (fetched once from gutenberg.org/cache/epub/<n>/pg<n>-images.html).
- Wikisource action=render pages and the tertullian.org Julian, kept in the
  git-ignored ``classics-src/`` tree; Cicero's de Divinatione from
  LacusCurtius in ``thayer-src/cicero-div/``. Re-fetch everything with
  ``python classics2tex.py fetch``.

Run: python classics2tex.py [fetch]
"""
import glob
import os
import re
import sys
import unicodedata

from ccel2tex import _titlecase
from dev2tex import blocks, finalize, inline, strip_tags, FN_O, FN_C
from docs2tex import esc_tex
from newman import _map_symbols, _cap_quotes, _heal_emphasis

ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X",
         "XI", "XII", "XIII", "XIV", "XV", "XVI", "XVII", "XVIII", "XIX",
         "XX", "XXI", "XXII", "XXIII", "XXIV", "XXV", "XXVI", "XXVII",
         "XXVIII", "XXIX", "XXX"]

_LICENSE = re.compile(
    r'\*{3}\s*END OF|START:\s*FULL LICENSE|End of (?:the )?Project Gutenberg|'
    r'<h[12][^>]*>\s*(?:<[^>]+>\s*)*THE FULL PROJECT GUTENBERG', re.I)


# ---------------------------------------------------------------------------
# shared low-level passes

def basic_norm(raw):
    """Whitespace oddities, em/strong, page-number furniture."""
    raw = raw.replace("\r\n", "\n")
    raw = re.sub(r'<em(?=[\s>])[^>]*>', '<i>', raw).replace('</em>', '</i>')
    raw = re.sub(r'<strong(?=[\s>])[^>]*>', '<b>', raw).replace('</strong>',
                                                                '</b>')
    for cp, rep in ((0x2009, ' '), (0x200A, ' '), (0x2007, ' '),
                    (0x2002, ' '), (0x2003, ' '), (0x00AD, ''),
                    (0xFEFF, '')):
        raw = raw.replace(chr(cp), rep)
    raw = re.sub(r'<span[^>]*class="[^"]*(?:pagenum|pgnum)[^"]*"[^>]*>'
                 r'.*?</span>', '', raw, flags=re.S)
    raw = re.sub(r'<div[^>]*class="pagenum"[^>]*>.*?</div>', '', raw,
                 flags=re.S)
    return raw


def pre_to_lines(raw):
    """<pre> verse blocks -> a paragraph of <br>-separated lines."""
    def repl(m):
        text = m.group(1).strip("\n")
        if not text.strip():
            return " "
        lines = [ln.strip() for ln in text.split("\n")]
        return "<p>" + "<br>".join(ln for ln in lines) + "</p>"
    return re.sub(r'<pre[^>]*>(.*?)</pre>', repl, raw, flags=re.S)


def line_divs(raw):
    """Per-line verse divs (div.l, div.line*) -> line<br>; strip stanza and
    poetry wrappers, which dev2tex would drop anyway but whose line breaks
    we must keep."""
    raw = re.sub(r'<div class="l(?:ine[^"]*)?"[^>]*>(.*?)</div>',
                 r'\1<br>', raw, flags=re.S)
    return raw


def h1_sentinels(raw):
    """<h1> headings to SOH/STX chapter sentinels (gutenberg2tex idiom)."""
    def h1_repl(m):
        t = re.sub(r'\s+', ' ', strip_tags(m.group(1))).strip()
        return "\n\n\x01" + t + "\x02\n\n"
    return re.sub(r'<h1[^>]*>(.*?)</h1>', h1_repl, raw, flags=re.S)


def cut_from_first(raw, first_heading, src):
    start = None
    for hm in re.finditer("\x01([^\x01\x02]*)\x02", raw):
        if hm.group(1).strip().startswith(first_heading):
            start = hm.start()
            break
    if start is None:
        raise SystemExit(f"{src}: first heading {first_heading!r} not found")
    return raw[start:]


# ---------------------------------------------------------------------------
# footnote schemes.  Each returns (raw-with-FN-sentinels, notes dict).

def extract_divs(raw, classpat):
    """Remove every <div> whose class matches classpat and return
    (raw-without-them, list of inner bodies), nesting-aware."""
    out, bodies = [], []
    i, n = 0, len(raw)
    tag = re.compile(r'<(/?)div(?=[\s>])[^>]*>', re.S)
    opener = re.compile(r'<div(?=[\s>])[^>]*class="([^"]*)"[^>]*>', re.S)
    while i < n:
        m = tag.search(raw, i)
        if not m:
            out.append(raw[i:])
            break
        om = opener.match(raw, m.start())
        if m.group(1) == '' and om and re.search(classpat, om.group(1)):
            depth, j = 1, m.end()
            while depth and j < n:
                m2 = tag.search(raw, j)
                if not m2:
                    j = n
                    break
                depth += 1 if m2.group(1) == '' else -1
                j = m2.end()
            body_end = j - len(m2.group(0)) if depth == 0 else j
            bodies.append((m.group(0), raw[m.end():body_end]))
            out.append(raw[i:m.start()])
            i = j
        else:
            out.append(raw[i:m.end()])
            i = m.end()
    return "".join(out), bodies


def _split_block_notes(body, anchor_re, notes, key):
    """A container holding several notes: split at each note anchor; the
    text after each anchor up to the next is that note's body."""
    hits = list(re.finditer(anchor_re, body, re.S))
    for i, m in enumerate(hits):
        end = hits[i + 1].start() if i + 1 < len(hits) else len(body)
        notes[key + "x" + m.group(1)] = body[m.end():end]


def notes_divfoot(raw, key):
    """PG <div class="footnote"> keyed Footnote_X, refs FNanchor_X; a
    block may hold several notes (Livy I/IV, Polybius, Lucian IV, the
    Eddas, Boethius)."""
    notes = {}
    raw, bodies = extract_divs(raw, r'\bfootnote\b')
    for _, body in bodies:
        _split_block_notes(
            body,
            r'<a id="Footnote_([A-Za-z0-9_]+)"[^>]*>\s*</a>\s*'
            r'<a href="#FNanchor_[A-Za-z0-9_]+"[^>]*>.*?</a>',
            notes, key)
    raw = re.sub(r'<a id="FNanchor_([A-Za-z0-9_]+)"[^>]*>\s*</a>\s*'
                 r'<a[^>]*href="#Footnote_[A-Za-z0-9_]+"[^>]*>.*?</a>',
                 lambda m: FN_O + key + "x" + m.group(1) + FN_C, raw,
                 flags=re.S)
    raw = re.sub(r'<div class="footnotes"[^>]*>\s*(?:<h3[^>]*>FOOTNOTES:?'
                 r'</h3>)?', ' ', raw)
    raw = re.sub(r'<h3[^>]*>FOOTNOTES:?</h3>', ' ', raw)
    return raw, notes


def notes_linknote(raw, key, foot_class="footnote|foot"):
    """PG old-format endnote chapters: <a id="linknote-N"> anchors with a
    following <p class="foot(note)"> body; in-text refs are
    <a href="#linknote-N" id="linknoteref-N">N</a>, the number sometimes
    wrapped in <small> or <sup>[..]</sup>
    (Herodotus, Hesiod, the Odyssey, Pliny)."""
    notes = {}
    pat = (r'<p[^>]*>\s*<a id="linknote-(\d+)">.*?</a>\s*</p>\s*'
           r'<p class="(?:%s)"[^>]*>\s*(?:\d+\s*\(<a[^>]*>return</a>\)|'
           r'<a[^>]*href="#linknoteref-\d+"[^>]*>.*?</a>)'
           r'(?:<br[^>]*>)?(.*?)</p>' % foot_class)
    def grab(m):
        body = m.group(2).strip()
        body = re.sub(r'^\s*\[\s*', '', body)
        body = re.sub(r'\s*\]\s*$', '', body)
        notes[key + "x" + m.group(1)] = body
        return ""
    raw = re.sub(pat, grab, raw, flags=re.S)
    raw = re.sub(r'<a href="#linknote-(\d+)" id="linknoteref-\d+"[^>]*>'
                 r'\s*(?:<(?:sup|small)>\s*)*\[?\d+\]?'
                 r'\s*(?:</(?:sup|small)>\s*)*</a>',
                 lambda m: FN_O + key + "x" + m.group(1) + FN_C, raw,
                 flags=re.S)
    return raw, notes


def notes_fnp(raw, key):
    """PG notes chapter of <p class="footnote"><a id="fn-X"></a>
    <a href="#fnref-X">[n]</a> ... ; refs <a id="fnref-X" href="#fn-X">
    (the Nicomachean Ethics)."""
    notes = {}
    def grab(m):
        notes[key + "x" + m.group(1).replace(".", "_")] = m.group(2)
        return ""
    raw = re.sub(r'<p class="footnote">\s*<a id="fn-([0-9.]+)">\s*</a>\s*'
                 r'<a href="#fnref-[0-9.]+"[^>]*>.*?</a>(.*?)</p>',
                 grab, raw, flags=re.S)
    raw = re.sub(r'<a[^>]*id="fnref-([0-9.]+)"[^>]*>.*?</a>',
                 lambda m: FN_O + key + "x" + m.group(1).replace(".", "_")
                 + FN_C, raw, flags=re.S)
    return raw, notes


def notes_fn_dash(raw, key):
    """PG <div class="FN"><p><a id="FN-N"></a><a href="#FNA-N"><sup>N</sup>
    </a> ...</p></div>; refs <a id="FNA-N"></a><a href="#FN-N"><sup>N</sup>
    (the Cicero volume)."""
    notes = {}
    def grab(m):
        body = m.group(1)
        im = re.search(r'<a id="FN-(\d+)"[^>]*>\s*</a>\s*'
                       r'<a href="#FNA-\d+"[^>]*>.*?</a>', body, re.S)
        if not im:
            return ""
        notes[key + "x" + im.group(1)] = body[:im.start()] + body[im.end():]
        return ""
    raw = re.sub(r'<div class="FN">(.*?)</div>', grab, raw, flags=re.S)
    raw = re.sub(r'<a id="FNA-(\d+)"[^>]*>\s*</a>\s*<a href="#FN-\d+"'
                 r'[^>]*>.*?</a>',
                 lambda m: FN_O + key + "x" + m.group(1) + FN_C, raw,
                 flags=re.S)
    return raw, notes


def notes_fndef(raw, key):
    """Beowulf: <div class="footnote" id="X.FNDEF.N"> bodies (which may
    hold nested verse divs), in-text <sup><a ... id="X.FNREF.N">N</a>
    </sup> refs."""
    notes = {}
    raw, bodies = extract_divs(raw, r'\bfootnote\b')
    for opener, body in bodies:
        idm = re.search(r'id="([^"]+)"', opener)
        if not idm:
            continue
        body = re.sub(r'<a href="#[^"]*FNREF[^"]*"[^>]*>.*?</a>', '', body,
                      flags=re.S)
        notes[key + "x" + idm.group(1)] = body
    raw = re.sub(r'(?:<sup>\s*)?<a[^>]*id="([^"]+\.FNREF\.[^"]+)"[^>]*>'
                 r'.*?</a>(?:\s*</sup>)?',
                 lambda m: FN_O + key + "x"
                 + m.group(1).replace(".FNREF.", ".FNDEF.") + FN_C,
                 raw, flags=re.S)
    raw = re.sub(r'<div class="footnotes">\s*', ' ', raw)
    return raw, notes


def notes_livyfoots(raw, key):
    """Livy vols II-III: end block <div id="footnotes"><div class="foots">
    <div id="footN"><b>Footnote N</b>: ... ; refs [<a href="#footN">N</a>]."""
    notes = {}
    zone = re.search(r'<div id="footnotes">.*', raw, re.S)
    if zone:
        for m in re.finditer(r'<div id="foot(\d+)"><b>Footnote \d+</b>:?'
                             r'(.*?)</div>', zone.group(0), re.S):
            notes[key + "x" + m.group(1)] = m.group(2)
        raw = raw[:zone.start()]
    raw = re.sub(r'\[<a href="#foot(\d+)"[^>]*>\s*\d+\s*</a>\]',
                 lambda m: FN_O + key + "x" + m.group(1) + FN_C, raw)
    return raw, notes


def notes_tagnote(raw, key):
    """Riley's Metamorphoses: <div class="footnote"> blocks of many
    <p><a href="#tagX" id="noteX">N.</a> ...</p> notes after each fable;
    refs <a class="tag" href="#noteX" id="tagX">N</a>."""
    notes = {}
    raw, bodies = extract_divs(raw, r'\b(?:footnote|endnote)\b')
    for _, body in bodies:
        _split_block_notes(body,
                           r'<a href="#tag[^"]*" id="note([^"]+)"[^>]*>'
                           r'.*?</a>', notes, key)
    raw = re.sub(r'<a class="tag[^"]*" href="#note[^"]*" id="tag([^"]+)"'
                 r'[^>]*>\s*\d+\s*</a>',
                 lambda m: FN_O + key + "x" + m.group(1) + FN_C, raw)
    return raw, notes


def notes_bracket(raw, key):
    """Watson's Sallust: literal [N] refs in the text, a NOTES chapter of
    [N]-led paragraphs after each part. Numbering restarts per part, so
    each notes zone is keyed separately and applied to the text before
    it."""
    notes = {}
    out, pos, zi = [], 0, 0
    for zm in re.finditer(r'<h2[^>]*>\s*NOTES[^<]*</h2>(.*?)(?=<h2|$)',
                          raw, re.S):
        zkey = f"{key}z{zi}"
        for m in re.finditer(r'<p[^>]*>\s*\[(\d+)\](.*?)</p>',
                             zm.group(1), re.S):
            notes[zkey + "x" + m.group(1)] = m.group(2)
        seg = raw[pos:zm.start()]
        seg = re.sub(r'\[(\d+)\]',
                     lambda m: FN_O + zkey + "x" + m.group(1) + FN_C, seg)
        out.append(seg)
        pos = zm.end()
        zi += 1
    out.append(raw[pos:])
    return "".join(out), notes


SCHEMES = {"divfoot": notes_divfoot, "linknote": notes_linknote,
           "fnp": notes_fnp, "fndash": notes_fn_dash, "fndef": notes_fndef,
           "livyfoots": notes_livyfoots, "tagnote": notes_tagnote,
           "bracket": notes_bracket}


# ---------------------------------------------------------------------------
# per-work structural preps (run before note capture).  Each takes and
# returns the raw html of one source; heading canon afterwards: chapters at
# the level `htag` names, h3 -> section, h4 -> unit.

def _demote(raw, headpat, src="h2", dst="h3"):
    """Demote headings whose text matches headpat from src to dst level."""
    def repl(m):
        text = re.sub(r'\s+', ' ', strip_tags(m.group(1))).strip()
        if re.match(headpat, text):
            return "<%s>%s</%s>" % (dst, m.group(1), dst)
        return m.group(0)
    return re.sub(r'<%s[^>]*>(.*?)</%s>' % (src, src), repl, raw, flags=re.S)


def prep_thucydides(raw, i):
    return _demote(raw, r'CHAPTER\s')


def prep_boethius(raw, i):
    raw = re.sub(r'<h2>\s*INDEX\s*</h2>.*?(?=<h2><a id="Page_1")', ' ', raw,
                 flags=re.S)
    def book(m):
        inner = re.sub(r'\s+', ' ', strip_tags(m.group(1))).strip()
        if re.fullmatch(r'BOOK [IVX]+\.', inner):
            return ' '                       # bare repeat before content
        return m.group(0)
    raw = re.sub(r'<h2[^>]*>(.*?)</h2>', book, raw, flags=re.S)
    return raw


def prep_livy23(raw, i):
    raw = re.sub(r'<div class="book"[^>]*>(.*?)</div>'
                 r'(?:\s*<div class="date">(.*?)</div>)?',
                 lambda m: "<h2>%s</h2>" % m.group(1)
                 + ("<p><i>%s</i></p>" % m.group(2) if m.group(2) else ""),
                 raw, flags=re.S)
    raw = re.sub(r'<div class="pg_body_wrapper">.*?</div>', ' ', raw,
                 flags=re.S)
    raw = re.sub(r'<div class="chapmen">.*?</div>', ' ', raw, flags=re.S)
    raw = re.sub(r'<h3[^>]*>[\s*\xa0]*</h3>', ' ', raw)
    raw = re.sub(r'<div class="lsidenote">\s*(\d+)\s*</div>\s*<p>',
                 r'<p><b>\1.</b> ', raw, flags=re.S)
    raw = re.sub(r'<h2>\s*END OF VOL[^<]*</h2>', ' ', raw)
    return raw


def prep_livy1(raw, i):
    raw = re.sub(r'<div class="lsidenote">(?:<a[^>]*>\s*</a>)?\s*(\d+)\s*'
                 r'</div>\s*<p>', r'<p><b>\1.</b> ', raw, flags=re.S)
    raw = re.sub(r'<div class="lsidenote">.*?</div>', ' ', raw, flags=re.S)
    return raw


def prep_caesar(raw, i):
    cut = re.search(r'<h4[^>]*>THE CIVIL WAR</h4>', raw).start()
    a, b = raw[:cut], raw[cut:]
    a = re.sub(r'<h4[^>]*>THE WAR IN GAUL</h4>\s*<h5[^>]*>BOOK I</h5>',
               '<h2>THE WAR IN GAUL. BOOK I</h2>', a)
    a = re.sub(r'<h3[^>]*>BOOK ([IVX]+)</h3>',
               r'<h2>THE WAR IN GAUL. BOOK \1</h2>', a)
    b = re.sub(r'<h4[^>]*>THE CIVIL WAR</h4>\s*<h5[^>]*>BOOK I</h5>',
               '<h2>THE CIVIL WAR. BOOK I</h2>', b)
    b = re.sub(r'<h3[^>]*>BOOK ([IVX]+)</h3>',
               r'<h2>THE CIVIL WAR. BOOK \1</h2>', b)
    raw = a + b
    raw = re.sub(r'<h3[^>]*>INTRODUCTION</h3>', '<h2>INTRODUCTION</h2>', raw)
    raw = re.sub(r'<h4[^>]*>INDEX</h4>.*$', ' ', raw, flags=re.S)
    raw = re.sub(r'<h[345][^>]*>.*?</h[345]>', ' ', raw, flags=re.S)
    return raw


def prep_herodotus(raw, i):
    raw = re.sub(r"\{([A-Za-z'?!.,;: \-]+)\}", r'<i>\1</i>', raw)
    return raw


def prep_timaeus(raw, i):
    return _demote(raw, r'Section\s')


def prep_politics(raw, i):
    return _demote(raw, r'CHAPTER\s')


def prep_lucretius(raw, i):
    return _demote(raw, r'(?!BOOK\s)')


def prep_pliny(raw, i):
    raw = _demote(raw, r'(?!LETTERS GAIUS|CORRESPONDENCE WITH|FOOTNOTES TO)')
    return raw


def prep_cicero(raw, i):
    raw = re.sub(r'<h2>\s*THE END\.\s*</h2>', ' ', raw)
    raw = re.sub(r'<h2[^>]*>\s*FOOTNOTES:\s*</h2>', ' ', raw)
    return raw


def prep_metam1(raw, i):
    raw = re.sub(r'<h2[^>]*>\s*THE METAMORPHOSES[^<]*</h2>', ' ', raw)
    raw = re.sub(r'<div class="(?:advert|contents|mynote[^"]*)"[^>]*>.*?'
                 r'</div>', ' ', raw, flags=re.S)
    raw = re.sub(r'<h3[^>]*>.*?</h3>', ' ', raw, flags=re.S)
    raw = re.sub(r'<h4[^>]*>(\s*(?:<[^>]+>\s*)*(?:BOOK THE|INTRODUCTION)'
                 r'.*?)</h4>', r'<h2>\1</h2>', raw, flags=re.S)
    raw = re.sub(r'<h5[^>]*>(.*?)</h5>', r'<h4>\1</h4>', raw, flags=re.S)
    return raw


def prep_metam2(raw, i):
    raw = re.sub(r'<div class="(?:titlepage|contents|intro|mynote[^"]*)"'
                 r'[^>]*>.*?</div>', ' ', raw, flags=re.S)
    raw = re.sub(r'<h4[^>]*>(\s*(?:<[^>]+>\s*)*BOOK THE.*?)</h4>',
                 r'<h2>\1</h2>', raw, flags=re.S)
    raw = re.sub(r'<h4[^>]*>\s*THE END\.\s*</h4>', ' ', raw)
    raw = re.sub(r'<h5[^>]*>(.*?)</h5>', r'<h4>\1</h4>', raw, flags=re.S)
    return raw


def prep_sallust(raw, i):
    raw = re.sub(r'<h1[^>]*>\s*THE JUGURTHINE WAR\s*</h1>',
                 '<h2>THE JUGURTHINE WAR.</h2>', raw)
    raw = re.sub(r'<h1[^>]*>.*?</h1>', ' ', raw, flags=re.S)
    raw = _demote(raw, r'THE ARGUMENT')
    return raw


def prep_beowulf(raw, i):
    raw = re.sub(r'<span class="sidenote">(.*?)</span>',
                 r'<p><i>\1</i></p>', raw, flags=re.S)
    raw = re.sub(r'<div class="fit"[^>]*>', '<div>', raw)
    return raw


def prep_frazer(raw, i):
    raw = re.sub(r'<div class="TOC">.*?</div>', ' ', raw, flags=re.S)
    raw = re.sub(r'<h4[^>]*>\s*by\s*</h4>', ' ', raw)
    return raw


def prep_eddas(raw, i):
    raw = re.sub(r'<h2[^>]*>\s*(?:LIST OF PHOTOGRAVURES|CONTENTS)\.?'
                 r'\s*</h2>', ' ', raw)
    raw = re.sub(r'<h3[^>]*>\s*\(ELDER AND YOUNGER EDDAS\.\)\s*</h3>', ' ',
                 raw)
    return raw


def prep_marcus(raw, i):
    return _demote(raw, r'BOOKS$')


def prep_polybius(raw, i):
    raw = re.sub(r'<h2[^>]*>\s*FOOTNOTES:?\s*</h2>', ' ', raw)
    raw = re.sub(r'<h2[^>]*>\s*INDEX\.?\s*</h2>.*$', ' ', raw, flags=re.S)
    return raw


# ---------------------------------------------------------------------------
# the Gutenberg WORKS table

PG_WORKS = [
    dict(id="iliad", srcs=["iliad-src.html"], firsts=["BOOK I."], htag=2),
    dict(id="odyssey", srcs=["odyssey-src.html"],
         firsts=["PREFACE TO FIRST EDITION"], htag=2, notes="linknote",
         skips=["THE ODYSSEY"]),
    dict(id="hesiod", srcs=["hesiod-src.html"], firsts=["PREFACE"], htag=2,
         notes="linknote", skips=["ENDNOTES"]),
    dict(id="herodotus", srcs=["herodotus1-src.html", "herodotus2-src.html"],
         firsts=["PREFACE", "BOOK V."], htag=2, notes="linknote",
         prep=prep_herodotus,
         skips=["THE HISTORY OF HERODOTUS", "NOTES TO PREFACE"],
         skip_pat=r'NOTES TO BOOK [IVX]+\.?'),
    dict(id="thucydides", srcs=["thucydides-src.html"], firsts=["BOOK I"],
         htag=2, prep=prep_thucydides),
    dict(id="republic", srcs=["republic-src.html"],
         firsts=["INTRODUCTION AND ANALYSIS."], htag=2,
         skips=["THE REPUBLIC."]),
    dict(id="timaeus", srcs=["timaeus-src.html"],
         firsts=["INTRODUCTION AND ANALYSIS."], htag=2, prep=prep_timaeus),
    dict(id="ethics", srcs=["ethics-src.html"], firsts=["INTRODUCTION"],
         htag=2, notes="fnp", skips=["NOTES", "ARISTOTLE’S ETHICS"]),
    dict(id="politics", srcs=["politics-src.html"], firsts=["INTRODUCTION"],
         htag=2, prep=prep_politics,
         skips=["A TREATISE ON GOVERNMENT", "BIBLIOGRAPHY", "INDEX"]),
    dict(id="livy1", srcs=["livy1-src.html"], firsts=["PREFACE."], htag=2,
         notes="divfoot", prep=prep_livy1, skips=["THE"]),
    dict(id="livy2", srcs=["livy2-src.html"], firsts=["BOOK IX."], htag=2,
         notes="livyfoots", prep=prep_livy23),
    dict(id="livy3", srcs=["livy3-src.html"], firsts=["BOOK XXVII."],
         htag=2, notes="livyfoots", prep=prep_livy23),
    dict(id="livy4", srcs=["livy4-src.html"], firsts=["BOOK XXXVII."],
         htag=2, notes="divfoot", skips=["FOOTNOTES", "INDEX."]),
    dict(id="caesar", srcs=["caesar-src.html"], firsts=["INTRODUCTION"],
         htag=2, prep=prep_caesar),
    dict(id="sallust", srcs=["sallust-src.html"],
         firsts=["CONSPIRACY OF CATILINE."], htag=2, notes="bracket",
         prep=prep_sallust),
    dict(id="plutarch", srcs=["plutarch-src.html"], firsts=["THESEUS"],
         htag=2),
    dict(id="polybius", srcs=["polybius1-src.html", "polybius2-src.html"],
         firsts=["PREFACE", "BOOK X"], htag=2, notes="divfoot",
         prep=prep_polybius,
         skips=["CONTENTS", "THE HISTORIES OF POLYBIUS"]),
    dict(id="cicero", srcs=["cicero-vol-src.html"],
         firsts=["THE TUSCULAN DISPUTATIONS."], htag=2, notes="fndash",
         prep=prep_cicero),
    dict(id="lucretius", srcs=["lucretius-src.html"], firsts=["BOOK I"],
         htag=2, prep=prep_lucretius),
    dict(id="aeneid", srcs=["aeneid-src.html"], firsts=["BOOK I"], htag=2),
    dict(id="metam", srcs=["metam1-src.html", "metam2-src.html"],
         firsts=["INTRODUCTION.", "BOOK THE EIGHTH."], htag=2,
         notes="tagnote", preps=[prep_metam1, prep_metam2]),
    dict(id="marcus", srcs=["marcus-src.html"], firsts=["INTRODUCTION"],
         htag=2, prep=prep_marcus),
    dict(id="pliny", srcs=["pliny-src.html"],
         firsts=["LETTERS GAIUS PLINIUS CAECILIUS SECUNDUS"], htag=2,
         notes="linknote", prep=prep_pliny,
         skip_pat=r'FOOTNOTES TO [A-Z .\]]+'),
    dict(id="lucian", srcs=["lucian1-src.html", "lucian2-src.html",
                            "lucian3-src.html", "lucian4-src.html"],
         firsts=["PREFACE", "THE DEPENDENT SCHOLAR", "LIFE OF DEMONAX",
                 "SLANDER, A WARNING"],
         htags=[3, 2, 2, 2], notes="divfoot",
         skips=["CONTENTS of VOL. I", "CONTENTS OF VOL. II",
                "CONTENTS OF VOL. III", "CONTENTS OF VOL. IV",
                "ALPHABETICAL TABLE OF CONTENTS", "Transcriber's Notes:"]),
    dict(id="apuleius", srcs=["apuleius-src.html"], firsts=["Dedication"],
         htag=2),
    dict(id="boethius", srcs=["boethius-src.html"], firsts=["PREFACE."],
         htag=2, notes="divfoot", prep=prep_boethius),
    dict(id="eddas", srcs=["eddas-src.html"],
         firsts=["THE ELDER EDDAS OF SAEMUND."], htag=2, notes="divfoot",
         prep=prep_eddas),
    dict(id="beowulf", srcs=["beowulf-src.html"], firsts=["PREFACE."],
         htag=2, notes="fndef", prep=prep_beowulf,
         skips=["ABBREVIATIONS USED IN THE NOTES.",
                "BIBLIOGRAPHY OF TRANSLATIONS.",
                "GLOSSARY OF PROPER NAMES.", "ADDENDA."]),
    dict(id="frazer", srcs=["frazer-src.html"], firsts=["Preface"], htag=3,
         prep=prep_frazer),
]


def pg_prepare(work, src, first, htag, key):
    raw = open(src, encoding="utf-8", errors="replace").read()
    m = _LICENSE.search(raw)
    if m:
        raw = raw[:m.start()]
    raw = basic_norm(raw)
    raw = re.sub(r'<!--.*?-->', ' ', raw, flags=re.S)
    raw = re.sub(r"(?is)<ins\b(?:[^>\"']|\"[^\"]*\"|'[^']*')*>(.*?)</ins>",
                 r"\1", raw)
    raw = re.sub(r'<h6[^>]*>(.*?)</h6>', r'<h4>\1</h4>', raw, flags=re.S)

    preps = work.get("preps")
    prep = preps[work["srcs"].index(src)] if preps else work.get("prep")
    if prep:
        raw = prep(raw, work["srcs"].index(src))

    notes = {}
    if work.get("notes"):
        raw, notes = SCHEMES[work["notes"]](raw, key)
    # a note referenced from inside a heading cannot ride into the
    # heading macro; keep the heading, move the note marker after it
    def head_defer(m):
        marks = re.findall(FN_O + r"[^" + FN_C + r"]*" + FN_C, m.group(2))
        if not marks:
            return m.group(0)
        inner = re.sub(FN_O + r"[^" + FN_C + r"]*" + FN_C, "", m.group(2))
        return ("<h%s>%s</h%s>" % (m.group(1), inner, m.group(1))
                + "<p>" + "".join(marks) + "</p>")
    raw = re.sub(r'<h([1-6])[^>]*>(.*?)</h\1>', head_defer, raw, flags=re.S)

    raw = pre_to_lines(raw)
    raw = line_divs(raw)
    raw = re.sub(r'</?(?:footer|header|section|nav|figure|figcaption|aside)'
                 r'[^>]*>', ' ', raw)
    raw = re.sub(r'<h5[^>]*>.*?</h5>', ' ', raw, flags=re.S)
    raw = re.sub(r'</?pre[^>]*>', ' ', raw)
    raw = re.sub(r'</?(?:small|big|sup|sub)[^>]*>', '', raw)
    raw = re.sub(r'</td>\s*<td[^>]*>', ' — ', raw)
    raw = re.sub(r'</tr>\s*<tr[^>]*>', '<br>', raw)
    raw = re.sub(r'</?(?:table|tbody|thead|colgroup|col|tr|td|th|dl|dt|dd|'
                 r'ul|ol)[^>]*>', ' ', raw)
    raw = re.sub(r'<li[^>]*>', '<p>', raw).replace('</li>', '')

    if htag == 2:
        raw = re.sub(r'<h1[^>]*>.*?</h1>', '', raw, flags=re.S)
        raw = re.sub(r'<h2([^>]*)>', r'<h1\1>', raw)
        raw = raw.replace('</h2>', '</h1>')
    elif htag == 3:
        raw = re.sub(r'<h[12][^>]*>.*?</h[12]>', '', raw, flags=re.S)
        raw = re.sub(r'<h3([^>]*)>', r'<h1\1>', raw)
        raw = raw.replace('</h3>', '</h1>')

    raw = h1_sentinels(raw)
    raw = cut_from_first(raw, first, src)
    return raw, notes


def convert_pg(work):
    pieces, notes = [], {}
    htags = work.get("htags") or [work.get("htag", 2)] * len(work["srcs"])
    for k, (s, f, h) in enumerate(zip(work["srcs"], work["firsts"], htags)):
        raw, nts = pg_prepare(work, s, f, h, str(k))
        notes.update(nts)
        pieces.append(raw)
    raw = "\n\n".join(pieces)

    for name in ("Index", "Footnotes") + tuple(work.get("skips", ())):
        raw = re.sub("\x01" + re.escape(name) + "\\.?:?\x02.*?(?=\x01|$)",
                     "", raw, flags=re.S | re.I)
    if work.get("skip_pat"):
        raw = re.sub("\x01" + work["skip_pat"] + "\x02.*?(?=\x01|$)",
                     "", raw, flags=re.S)

    raw = re.sub(r'<h2[^>]*>(.*?)</h2>',
                 lambda m: "<h3>" + m.group(1) + "</h3>", raw, flags=re.S)

    tex = finalize(inline(blocks(raw)))

    def chapter(m):
        t = m.group(1).strip()
        t = re.sub(FN_O + r"[^" + FN_C + r"]*" + FN_C, "", t).strip()
        if t.isupper():
            t = _fix_roman(_titlecase(t))
            t = re.sub(r'(\.\s+)([a-z])',
                       lambda m2: m2.group(1) + m2.group(2).upper(), t)
        return "\\xchapter{" + t + "}"
    tex = re.sub("\x01\\s*([^\x01\x02]*?)\\s*\x02", chapter, tex, flags=re.S)

    missing = []

    def note_tex(body):
        body = re.sub(r'<h[456][^>]*>(.*?)</h[456]>', r'<b>\1</b><br>',
                      body, flags=re.S)
        body = re.sub(r'</td>\s*<td[^>]*>', ' — ', body)
        body = re.sub(r'</tr>\s*<tr[^>]*>', '<br>', body)
        body = re.sub(r'</?(?:table|tbody|thead|tr|td|th|dl|dt|dd|ul|ol|'
                      r'small|big|sup|sub)[^>]*>', ' ', body)
        body = re.sub(r'<li[^>]*>', '<br>', body).replace('</li>', '')
        return finalize(inline(blocks(body))).strip()

    def put_note(m):
        n = m.group(1).replace("\\_", "_")
        if n not in notes:
            missing.append(n)
            return ""
        return "\\footnote{" + note_tex(notes[n]) + "}"
    tex = re.sub(FN_O + r"([0-9A-Za-z_.x\\]+?)" + FN_C, put_note, tex)
    if missing:
        print(f"  {work['id']}: missing notes {missing[:8]} "
              f"({len(missing)} total)")
    tex = (tex.replace("\\devchapter{", "\\xchapter{")
              .replace("\\devsection{", "\\xsection{")
              .replace("\\devunit{", "\\xsubsection{"))
    tex = re.sub(r"\\xsection\{([A-Z][A-Z .,;:'’\-—0-9]+)\}",
                 lambda m: "\\xsection{"
                 + _fix_roman(_titlecase(m.group(1))) + "}", tex)
    tex = polish(tex)
    write_body(work["id"] + "-body.tex", tex)


_ROMAN_OK = re.compile(r'M{0,4}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})'
                       r'(IX|IV|V?I{0,3})')
_ROMAN_RISK = {"MIX", "DIX", "MI", "DI", "LI", "CD"}


def _fix_roman(t):
    """_titlecase turns BOOK II into Book Ii; restore words that are
    strictly-valid roman numerals (Civil, Did, Ill stay words)."""
    def fix(m):
        u = m.group(0).upper()
        if u in _ROMAN_RISK or not _ROMAN_OK.fullmatch(u):
            return m.group(0)
        return u
    return re.sub(r'\b[IVXLCDM][ivxlcdm]+\b', fix, t)


# characters the T1/LGR toolchain cannot set, normalized per body: OCR
# stand-ins, box-drawing camp diagrams (Polybius), transliteration
# diacritics as core TeX accents, stray joiners.
_CLASSICS_SYMBOLS = {
    "\x97": "—", "⁠": "", " ": " ", "​": "",
    "€": "e", "⟨": "‹", "⟩": "›",
    "エ": "\\rotatebox[origin=c]{90}{H}",
    "─": "--", "│": "|", "┌": "+", "┐": "+", "┬": "+",
    "к": "k", "ȳ": "\\={y}",
    "ṛ": "\\d{r}", "Ṛ": "\\d{R}", "ṣ": "\\d{s}", "Ṣ": "\\d{S}",
    "ṇ": "\\d{n}", "ḍ": "\\d{d}", "ṭ": "\\d{t}", "ḥ": "\\d{h}",
    "ǎ": "\\v{a}", "ǔ": "\\v{u}", "←": "", "→": "",
}


def polish(tex):
    tex = unicodedata.normalize("NFC", tex)
    tex = "".join(c for c in tex if not 0x0300 <= ord(c) <= 0x036F)
    tex = _heal_emphasis(tex)
    tex = _cap_quotes(tex)
    tex = _map_symbols(tex)
    for a, b in _CLASSICS_SYMBOLS.items():
        tex = tex.replace(a, b)
    tex = re.sub(r'\n\n(?:\\\\\s*\n)+\n?', '\n\n', tex)
    tex = re.sub(r'(?:\\\\\s*\n)+\n', '\n\n', tex)
    tex = re.sub(r'(\\\\\s*)\[', r'\1{}[', tex)
    tex = re.sub(r'\n{3,}', '\n\n', tex)
    return tex.strip() + "\n"


def write_body(out, tex):
    left = sorted(set(re.findall(r'<[a-zA-Z/][^>]*>', tex)))
    stray = sorted(set(c for c in tex if 0x01 <= ord(c) <= 0x08))
    with open(out, "w", encoding="utf-8") as f:
        f.write(tex)
    print(f"wrote {out}: {tex.count(chr(92) + 'xchapter{')} chapters, "
          f"{tex.count(chr(92) + 'xsection{')} sections, "
          f"{tex.count(chr(92) + 'footnote{')} footnotes, "
          f"{len(tex)//1024} KB"
          + (f"  LEFTOVER {left[:6]}" if left else "")
          + (f"  STRAY {[hex(ord(c)) for c in stray]}" if stray else ""))


# ---------------------------------------------------------------------------
# Wikisource machinery

def drop_subtrees(raw, classpat):
    """Remove every <div>/<table> subtree whose class matches classpat,
    nesting-aware."""
    out, i, n = [], 0, len(raw)
    tag = re.compile(r'<(/?)(div|table)(?=[\s>])[^>]*>', re.S)
    opener = re.compile(r'<(?:div|table)(?=[\s>])[^>]*class="([^"]*)"[^>]*>',
                        re.S)
    while i < n:
        m = tag.search(raw, i)
        if not m:
            out.append(raw[i:])
            break
        om = opener.match(raw, m.start())
        if m.group(1) == '' and om and re.search(classpat, om.group(1)):
            depth, j = 1, m.end()
            while depth and j < n:
                m2 = tag.search(raw, j)
                if not m2:
                    j = n
                    break
                depth += 1 if m2.group(1) == '' else -1
                j = m2.end()
            out.append(raw[i:m.start()])
            i = j
        else:
            out.append(raw[i:m.end()])
            i = m.end()
    return "".join(out)


def ws_clean(raw):
    """A Wikisource action=render page to engine-ready markup."""
    raw = re.sub(r'<!--\s*NewPP.*$', ' ', raw, flags=re.S)
    raw = re.sub(r'<!--.*?-->', ' ', raw, flags=re.S)
    raw = raw.replace('Digitized by VjOOQIC', ' ')
    raw = re.sub(r'&lt;/?A\b[^&]*?&gt;', ' ', raw)
    raw = re.sub(r'<style[^>]*>.*?</style>', ' ', raw, flags=re.S)
    raw = re.sub(r'<link[^>]*>|<meta[^>]*>', ' ', raw)
    raw = drop_subtrees(raw, r'ws-noexport|wst-header|ambox|noprint|'
                        r'authority-control|licenseContainer|navbox')
    raw = re.sub(r'<table[^>]*>.*?</table>', ' ', raw, flags=re.S)
    raw = re.sub(r'<ol class="references">.*?</ol>', ' ', raw, flags=re.S)
    raw = re.sub(r'<sup[^>]*class="reference"[^>]*>.*?</sup>', '', raw,
                 flags=re.S)
    raw = re.sub(r'<span[^>]*class="mw-editsection[^>]*>.*?</span>', ' ',
                 raw, flags=re.S)
    raw = re.sub(r'<figure[^>]*>.*?</figure>', ' ', raw, flags=re.S)
    raw = basic_norm(raw)
    return raw


def ws_anchor_heads(raw, dst="h3"):
    """<span class="wst-anchor">CHAPTER I</span> markers -> headings."""
    return re.sub(r'<p>\s*(?:<[^>]+>\s*)*<span[^>]*class="wst-anchor"[^>]*>'
                  r'([^<]+)</span>\s*(?:<[^>]+>\s*)*</p>',
                  r'<%s>\1</%s>' % (dst, dst), raw, flags=re.S)


def ws_body(path):
    raw = open(path, encoding="utf-8", errors="replace").read()
    raw = ws_clean(raw)
    raw = ws_anchor_heads(raw)
    raw = re.sub(r'<span[^>]*class="wst-anchor"[^>]*>([^<]*)</span>', '',
                 raw)
    raw = re.sub(r'</?a[^>]*>', '', raw, flags=re.I)
    raw = pre_to_lines(raw)
    raw = re.sub(r'<hr[^>]*>', ' ', raw)
    raw = re.sub(r'<h2[^>]*>', '<h3>', raw).replace('</h2>', '</h3>')
    raw = re.sub(r'</?(?:ul|ol|dl)[^>]*>', ' ', raw)
    raw = re.sub(r'<(?:li|dd|dt)[^>]*>', '<p>', raw)
    raw = re.sub(r'</(?:li|dd|dt)>', '', raw)
    raw = re.sub(r'</?(?:span|section|div|aside|small|sup|sub|abbr|time)'
                 r'[^>]*>', '', raw)
    tex = finalize(inline(blocks(raw)))
    tex = (tex.replace("\\devchapter{", "\\xsection{")
              .replace("\\devsection{", "\\xsection{")
              .replace("\\devunit{", "\\xsubsection{"))
    return tex.strip()


def ws_header_title(path):
    """The 'section' line of the wst-header (e.g. the letter's title)."""
    raw = open(path, encoding="utf-8", errors="replace").read()
    m = re.search(r'id="header_section_text"[^>]*>(.*?)</span>', raw, re.S)
    if not m:
        return None
    return re.sub(r'\s+', ' ', strip_tags(m.group(1))).strip()


def convert_seneca():
    parts = ["\\xchapter{Moral Letters to Lucilius}"]
    for n in range(1, 125):
        path = f"classics-src/seneca/letter{n}.html"
        body = ws_body(path)
        body = re.sub(r'^THE EPISTLES OF SENECA\s*\n+', '', body)
        title = ""
        tm = re.match(r'([IVXLC]+\.\s+[A-Z][A-Z \'’,\-]+?)\s*\n+', body)
        if tm:
            title = " " + _titlecase(re.sub(r'^[IVXLC]+\.\s+', '',
                                            tm.group(1))).strip()
            body = body[tm.end():]
        head = f"Letter {n}.{title}"
        parts.append("\\xsection{%s}\n\n%s" % (head, body))
    write_body("seneca-body.tex", polish("\n\n".join(parts) + "\n"))


def convert_epictetus():
    parts = []
    counts = {1: 30, 2: 26, 3: 26, 4: 13}
    for b, cmax in counts.items():
        parts.append("\\xchapter{Book %s}" % ROMAN[b])
        for c in range(1, cmax + 1):
            path = f"classics-src/epictetus/b{b}c{c:02d}.html"
            title = ws_header_title(path) or ""
            title = re.sub(r'^(?:Book \d+/)?Chapter \d+\.?\s*', '', title)
            head = f"Chapter {c}." + (f" {title}" if title else "")
            parts.append("\\xsection{%s}\n\n%s"
                         % (esc_tex(head), ws_body(path)))
    parts.append("\\xchapter{The Manual (Encheiridion)}\n\n"
                 + ws_body("classics-src/epictetus/manual.html"))
    parts.append("\\xchapter{Fragments}\n\n"
                 + ws_body("classics-src/epictetus/fragments.html"))
    write_body("epictetus-body.tex", polish("\n\n".join(parts) + "\n"))


def convert_metaphysics():
    parts = []
    for b in range(1, 15):
        body = ws_body(f"classics-src/metaphysics/book{b}.html")
        parts.append("\\xchapter{Book %s}\n\n%s" % (ROMAN[b], body))
    write_body("metaphysics-body.tex", polish("\n\n".join(parts) + "\n"))


def convert_rigveda():
    HYMNS = [191, 43, 62, 58, 87, 75, 104, 103, 114, 191]
    parts = []
    for b, hmax in enumerate(HYMNS, 1):
        parts.append("\\xchapter{Book %s}" % ROMAN[b])
        for h in range(1, hmax + 1):
            path = f"classics-src/rigveda/b{b:02d}h{h:03d}.html"
            if not os.path.exists(path):
                print(f"  rigveda: missing {path}")
                continue
            body = ws_body(path)
            m = re.search(r'HYMN [IVXLCD]+\.?\s*([^\n\\]*)', body)
            deity = (" " + m.group(1).strip().rstrip('.') + ".") if m and \
                m.group(1).strip() else ""
            body = re.sub(r'^.*?HYMN [IVXLCD]+\.[^\n]*\n', '', body, count=1,
                          flags=re.S)
            parts.append("\\xsection{Hymn %d.%s}\n\n%s"
                         % (h, esc_tex(deity), body.strip()))
    write_body("rigveda-body.tex", polish("\n\n".join(parts) + "\n"))


def convert_agricola():
    parts = []
    for f, title in (("agricola", "The Agricola"),
                     ("germania", "The Germania")):
        body = ws_body(f"classics-src/tacitus/{f}.html")
        parts.append("\\xchapter{%s}\n\n%s" % (title, body))
    write_body("agricola-body.tex", polish("\n\n".join(parts) + "\n"))


# ---------------------------------------------------------------------------
# Julian (tertullian.org, zosimus-style page)

def convert_julian():
    raw = open("classics-src/julian/galileans.htm", encoding="utf-8",
               errors="replace").read()
    h = re.search(r"</head\s*>", raw, re.I)
    raw = raw[h.end():] if h else raw
    raw = re.sub(r"<(/?)([A-Za-z]+)([^>]*)>",
                 lambda m: "<" + m.group(1) + m.group(2).lower()
                 + m.group(3) + ">", raw)
    m = re.search(r"<p[^>]*>\s*(?:<[^>]+>\s*)*BOOK I\.", raw)
    if m:
        raw = raw[m.start():]
    for endmark in ("This text was transcribed", "Early Church Fathers",
                    "Greek text is rendered"):
        k = raw.find(endmark)
        if k > 0:
            raw = raw[:raw.rfind("<", 0, k)]
            break
    raw = re.sub(r"<!--.*?-->", " ", raw, flags=re.S)
    raw = re.sub(r"<h1[^>]*>.*?</h1>", " ", raw, flags=re.S)
    raw = re.sub(r"</?(?:hr|center|table|tbody|tr|td|span|font|small|sub|"
                 r"sup|a|img|body|html|div)[^>]*>", " ", raw, flags=re.I)
    raw = basic_norm(raw)
    tex = finalize(inline(blocks(raw)))
    tex = (tex.replace("\\devchapter{", "\\xsection{")
              .replace("\\devsection{", "\\xsection{")
              .replace("\\devunit{", "\\xsubsection{"))
    body = "\\xchapter{Against the Galileans}\n\n" + tex.strip()
    write_body("julian-body.tex", polish(body + "\n"))


# ---------------------------------------------------------------------------
# Cicero, de Divinatione (LacusCurtius, via the thayer2tex machinery)

def convert_cicero_div():
    from thayer2tex import build
    chapters = [("Book I", "thayer-src/cicero-div/1.html", "c1"),
                ("Book II", "thayer-src/cicero-div/2.html", "c2")]
    build(chapters, "cicero-div-body.tex")
    tex = open("cicero-div-body.tex", encoding="utf-8").read()
    for a, b in _CLASSICS_SYMBOLS.items():
        tex = tex.replace(a, b)
    open("cicero-div-body.tex", "w", encoding="utf-8").write(tex)


# ---------------------------------------------------------------------------
# fetch mode: re-download the git-ignored source trees

def fetch():
    import time
    import urllib.parse
    import urllib.request
    UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) "
          "merecatholicity-library/1.0"}

    def get(url, out):
        if os.path.exists(out) and os.path.getsize(out) > 500:
            return
        os.makedirs(os.path.dirname(out), exist_ok=True)
        req = urllib.request.Request(url, headers=UA)
        with urllib.request.urlopen(req, timeout=60) as r:
            open(out, "wb").write(r.read())
        time.sleep(0.35)
        print("fetched", out)

    def ws(title, out):
        get("https://en.wikisource.org/w/index.php?title="
            + urllib.parse.quote(title) + "&action=render", out)

    ws("Agricola", "classics-src/tacitus/agricola.html")
    ws("Germania (Church & Brodribb)", "classics-src/tacitus/germania.html")
    get("https://www.tertullian.org/fathers/"
        "julian_apostate_galileans_1_text.htm",
        "classics-src/julian/galileans.htm")
    for b in (1, 2):
        get("https://penelope.uchicago.edu/Thayer/E/Roman/Texts/Cicero/"
            f"de_Divinatione/{b}*.html", f"thayer-src/cicero-div/{b}.html")
    for b in range(1, 15):
        ws(f"Metaphysics (Ross, 1908)/Book {b}",
           f"classics-src/metaphysics/book{b}.html")
    for n in range(1, 125):
        ws(f"Moral letters to Lucilius/Letter {n}",
           f"classics-src/seneca/letter{n}.html")
    E = ("Epictetus, the Discourses as reported by Arrian, the Manual, "
         "and Fragments")
    for b, cmax in {1: 30, 2: 26, 3: 26, 4: 13}.items():
        for c in range(1, cmax + 1):
            ws(f"{E}/Book {b}/Chapter {c}",
               f"classics-src/epictetus/b{b}c{c:02d}.html")
    ws(f"{E}/Manual", "classics-src/epictetus/manual.html")
    ws(f"{E}/Fragments", "classics-src/epictetus/fragments.html")
    HYMNS = [191, 43, 62, 58, 87, 75, 104, 103, 114, 191]
    for b, hmax in enumerate(HYMNS, 1):
        for h in range(1, hmax + 1):
            ws(f"The Hymns of the Rigveda/Book {b}/Hymn {h}",
               f"classics-src/rigveda/b{b:02d}h{h:03d}.html")


# ---------------------------------------------------------------------------

def main():
    if len(sys.argv) > 1 and sys.argv[1] == "fetch":
        fetch()
        return
    only = sys.argv[1:] if len(sys.argv) > 1 else None
    for w in PG_WORKS:
        if only and w["id"] not in only:
            continue
        convert_pg(w)
    for name, fn in (("seneca", convert_seneca),
                     ("epictetus", convert_epictetus),
                     ("metaphysics", convert_metaphysics),
                     ("rigveda", convert_rigveda),
                     ("agricola", convert_agricola),
                     ("julian", convert_julian),
                     ("cicero-div", convert_cicero_div)):
        if only and name not in only:
            continue
        fn()


if __name__ == "__main__":
    main()
