#!/usr/bin/env python3
"""Whole-corpus driver for John Henry Newman's works from NewmanReader.

Modeled on schaff.py: a WORKS table drives fetch -> convert -> wrapper ->
newman.mk, reusing the NewmanReader HTML->LaTeX engine from dev2tex.py
(the same engine already behind development.html and consulting.html).

Per work it writes <id>-body.tex (the text, with Newman's notes inlined
as LaTeX footnotes at their reference points, and any back-of-book
notes.html appended as a Notes appendix) and a self-contained wrapper
<id>.tex, and after all works a newman.mk that lists NEWMAN_PDFS
(id=Output.pdf) and NEWMAN_HTML (id:tocdepth:"Title") for
resources/Makefile.

NewmanReader is one FrontPage/"arctic"-theme transcription, so every page
shares the dialect dev2tex handles (h2 chapters, h3 sections, {page}
markers, <font size=2> small caps, iso-8859-1). Two things vary across
the corpus and are generalized here:

  * Note references are keyed on the #noteN *anchor*, not the visible
    "[Note N]" text -- some works write a bare "[Note]" with the number
    only in the link (Grammar ch. 7), others "[Note N]" (Grammar ch. 9).
  * A chapter split across files (chapterN-1/-2/-3, part1/part2, ...) is
    detected by the absence of its own <h2>, so no hand-kept continuation
    list is needed; the split file's text simply continues the chapter.

A work's file set is whatever its index.html links in the same directory
(fragments dropped, order preserved), minus any `exclude`d extras (e.g.
appended reviews) and the `notes_appendix` file, which is rendered as a
trailing Notes chapter instead of as inline footnotes.

Run:  python newman.py                 build every work
      python newman.py grammar ...     build only these ids
      python newman.py fetch grammar   (re)download these ids' sources
      python newman.py fetch all       download every work's sources
"""
import os
import re
import sys
import urllib.request

from dev2tex import (blocks, finalize, inline as dev_inline, strip_tags,
                     CHAP, GRP_C, PAR, FN_O, FN_C)

SRCROOT = "newman-src"
BASE = "https://www.newmanreader.org/works/"
UA = "Mozilla/5.0 (compatible; merecatholicity build)"


# --- works table ------------------------------------------------------
# One dict per work. `path` is the NewmanReader directory under works/;
# `id` names our outputs (<id>-body.tex, <id>.tex, <id>.html, the PDF).
# `exclude` drops files the index links but that are not Newman's text
# (appended reviews, etc.); `notes_appendix` names a back-of-book notes
# file rendered as a trailing Notes chapter. `front` pulls the Dedication
# from index.html.

def W(**k):
    k.setdefault("byline", "John Henry Cardinal Newman")
    k.setdefault("author", "John Henry Newman")
    k.setdefault("exclude", [])
    k.setdefault("notes_appendix", None)
    k.setdefault("tocdepth", 2)
    k.setdefault("front", True)
    k.setdefault("blurb", "")
    return k


WORKS = [
    W(id="grammar", path="grammar", section="Catholic",
      title="An Essay in Aid of a Grammar of Assent",
      pdf="Grammar_of_Assent.pdf",
      provenance="Text first published in 1870.",
      blurb="Newman's mature account of how the mind reaches real assent "
            "and certitude, and of the illative sense by which it reasons "
            "its way to belief.",
      exclude=["review1.html", "review2.html"],
      notes_appendix="notes.html"),
]


# --- NewmanReader HTML -> LaTeX, generalized from dev2tex --------------

# A note reference: any [...] bracket carrying a link to #noteN. Keys on
# the anchor so a bare "[Note]" (number only in the href) is caught too.
NOTE_REF = re.compile(r'\[[^\[\]]*?href="#note(\d+)"[^\[\]]*?\]')
NOTE_ANCHOR = re.compile(r'<a\s+name="note(\d+)"[^>]*>\s*(?:</a>)?')


def inline(t):
    """dev2tex.inline, but note references are found by their #noteN
    anchor first (before dev2tex strips the <a> tags)."""
    t = NOTE_REF.sub(lambda m: FN_O + m.group(1) + FN_C, t)
    return dev_inline(t)


def parse_notes(html):
    """Endnotes of one file, keyed on the <a name="noteN"> anchors that
    bound them. Tolerates the two NewmanReader shapes: a numbered "N. ...
    Return to text" note, and a bare note with neither number nor
    backlink (the anchor sits inside a "Note"/"Notes" <h3> header)."""
    notes = {}
    anchors = list(NOTE_ANCHOR.finditer(html))
    for i, a in enumerate(anchors):
        n = a.group(1)
        end = anchors[i + 1].start() if i + 1 < len(anchors) else len(html)
        seg = html[a.end():end]
        # a header remnant the anchor lived in: "Note"/"Notes" text, then
        # the closing </font></h3> of that heading
        seg = re.sub(r'^\s*(?:Notes?\b[^<]*)?(?:</font>)?\s*(?:</h[1-6]>)?',
                     '', seg, count=1, flags=re.I)
        # leading structural tags, page markers, and spacing
        seg = re.sub(r'^\s*(?:<(?:p|br|font)[^>]*>|\{[^}]{0,7}\}|&nbsp;|\s)+',
                     '', seg, flags=re.I)
        # a redundant leading "N." / "Note N." label (we number by anchor)
        seg = re.sub(r'^(?:Note\s+)?%s\.\s*' % n, '', seg)
        # the trailing "Return to text" backlink and anything after it
        seg = re.split(r'<a[^>]*href="#return\d+"', seg)[0]
        seg = re.sub(r'(?:<br[^>]*>|\s)+$', '', seg)
        notes[n] = seg.strip()
    return notes


def _strip_head(raw):
    h = re.search(r'</head\s*>', raw, re.I)
    raw = raw[h.end():] if h else raw
    return re.sub(r'</?(?:body|html)[^>]*>', '', raw, flags=re.I)


def _notes_start(raw):
    """Offset of the heading that opens the endnotes (the <h3> carrying
    <a name="note1">), or None."""
    a1 = re.search(r'<a\s+name="note1"', raw)
    if not a1:
        return None
    heads = list(re.finditer(r'<h[234][^>]*>', raw[:a1.start()]))
    return heads[-1].start() if heads else a1.start()


def convert_file(path, heading=None):
    """One chapter/part file to LaTeX. A file with its own <h2> opens a
    chapter; a split-continuation file (no <h2>) just continues. Its
    endnotes are inlined as \\footnote at their reference points."""
    raw = _strip_head(open(path, "rb").read().decode("cp1252")
                      .replace("\r\n", "\n"))

    m2 = re.search(r'<h2[^>]*>(.*?)</h2>', raw, re.S)
    if heading is None and m2:
        heading = re.sub(r'\s+', ' ', strip_tags(m2.group(1))).strip()
    if m2:
        raw = raw[:m2.start()] + raw[m2.end():]

    nstart = _notes_start(raw)
    footer = raw.find("Newman Reader")
    ends = [x for x in (nstart, footer if footer >= 0 else None)
            if x is not None]
    body = raw[:min(ends)] if ends else raw
    notes = parse_notes(raw[nstart: footer if footer >= 0 else len(raw)]) \
        if nstart is not None else {}

    tex = finalize(inline(blocks(body)))
    if heading:
        tex = finalize(CHAP + heading + GRP_C) + "\n\n" + tex

    missing = []

    def put_note(m):
        n = m.group(1)
        if n not in notes:
            missing.append(n)
            return ""
        content = re.sub(r'<p[^>]*>', PAR, notes[n]).replace("</p>", "")
        return "\\footnote{" + finalize(inline(content)).strip() + "}"

    tex = re.sub(FN_O + r"(\d+)" + FN_C, put_note, tex)
    if missing:
        print(f"  {os.path.basename(path)}: missing notes {missing}")
    return re.sub(r'\n{3,}', '\n\n', tex).strip()


def convert_appendix(path, title="Notes"):
    """A back-of-book notes file (its own <a name="noteN"> anchors are
    discursive endnotes, not footnote targets) as a plain Notes chapter;
    each note's <h3> title becomes a section."""
    raw = _strip_head(open(path, "rb").read().decode("cp1252")
                      .replace("\r\n", "\n"))
    a1 = re.search(r'<a\s+name="note1"', raw)
    if a1:
        heads = list(re.finditer(r'<h[234][^>]*>', raw[:a1.start()]))
        start = heads[-1].start() if heads else a1.start()
    else:
        start = 0
    footer = raw.find("Newman Reader")
    body = raw[start: footer if footer >= 0 else len(raw)]
    return finalize(CHAP + title + GRP_C) + "\n\n" + \
        finalize(inline(blocks(body))).strip()


def front_matter(index_path):
    """The Dedication, carried in index.html between its front anchors.
    Bounded on the enclosing <h3> at each end so the block is balanced,
    then set as a centered front chapter."""
    raw = open(index_path, "rb").read().decode("cp1252").replace("\r\n", "\n")
    ded = re.search(r'<a\s+name="dedication"', raw)
    if not ded:
        return ""

    def enclosing_h3(anchor_pos):
        pre = list(re.finditer(r'<h3[^>]*>', raw[:anchor_pos]))
        return pre[-1].start() if pre else anchor_pos

    start = enclosing_h3(ded.start())
    tp = re.search(r'<a\s+name="titlepage"', raw)
    end = enclosing_h3(tp.start()) if tp else len(raw)
    seg = raw[start:end]
    # drop the leading "Dedication" heading -- we supply the chapter title
    seg = re.sub(r'^\s*<h3[^>]*>.*?</h3>', '', seg, count=1, flags=re.S)
    body = finalize(inline(blocks(seg))).strip()
    if not body:
        return ""
    return (finalize(CHAP + "Dedication" + GRP_C)
            + "\n\n\\begin{center}\n" + body + "\n\\end{center}")


def content_files(index_path, work):
    """Same-directory .html links from index.html, fragments dropped,
    first-appearance order, minus index/excluded/appendix files."""
    raw = open(index_path, "rb").read().decode("cp1252")
    excl = {"index.html", *work["exclude"]}
    if work["notes_appendix"]:
        excl.add(work["notes_appendix"])
    seen = []
    for m in re.finditer(r'href="([a-z0-9][a-z0-9-]*\.html)(?:#[^"]*)?"',
                         raw, re.I):
        f = m.group(1)
        if f not in excl and f not in seen:
            seen.append(f)
    return seen


# --- assembly ---------------------------------------------------------

_TEXTCMDS = ("\\emph{", "\\textbf{", "\\textsc{", "\\textit{", "\\textsl{",
             "\\textgreek{", "\\texthebrew{")


def _heal_emphasis(s):
    """An inline text command may not contain a paragraph break, but the
    transcriptions sometimes wrap a <p> boundary in <i>/<b> (a runaway
    \\emph{ ... \\par ... }). Collapse any paragraph break inside such a
    command's braces to a space; \\footnote (which may hold paragraphs)
    is left alone."""
    out, i, n = [], 0, len(s)
    while i < n:
        hits = [s.find(c, i) for c in _TEXTCMDS]
        hits = [h for h in hits if h != -1]
        if not hits:
            out.append(s[i:])
            break
        j = min(hits)
        out.append(s[i:j])
        cmd = next(c for c in _TEXTCMDS if s.startswith(c, j))
        k, depth, buf = j + len(cmd), 1, []
        while k < n and depth > 0:
            ch = s[k]
            depth += (ch == "{") - (ch == "}")
            if depth > 0:
                buf.append(ch)
            k += 1
        inner = re.sub(r'\s*\n\s*\n\s*', ' ', "".join(buf)).strip()
        out.append(cmd + inner + "}")
        i = k
    return "".join(out)


def convert(work):
    d = os.path.join(SRCROOT, work["id"])
    idx = os.path.join(d, "index.html")
    parts = []
    if work["front"] and os.path.exists(idx):
        fm = front_matter(idx)
        if fm:
            parts.append(fm)
    for f in content_files(idx, work):
        parts.append(convert_file(os.path.join(d, f)))
    if work["notes_appendix"]:
        parts.append(convert_appendix(os.path.join(d, work["notes_appendix"])))

    body = "\n\n".join(p for p in parts if p) + "\n"
    body = (body.replace("\\devchapter{", "\\xchapter{")
                .replace("\\devsection{", "\\xsection{")
                .replace("\\devunit{", "\\xsubsection{"))
    body = _heal_emphasis(body)
    with open(f'{work["id"]}-body.tex', "w", encoding="utf-8") as fh:
        fh.write(body)

    leftover = sorted(set(re.findall(r'<[a-zA-Z/][^>]*>', body)))
    print(f'{work["id"]}: {body.count(chr(92) + "xchapter{")} chapters, '
          f'{body.count(chr(92) + "xsection{")} sections, '
          f'{body.count(chr(92) + "footnote{")} footnotes '
          f'({len(body) // 1024} KB)'
          + (f'  LEFTOVER {leftover[:6]}' if leftover else ''))


def _tex(s):
    for a, b in (("\\", r"\textbackslash{}"), ("&", r"\&"), ("%", r"\%"),
                 ("#", r"\#"), ("_", r"\_"), ("$", r"\$")):
        s = s.replace(a, b)
    return s


WRAPPER = r"""% @@TITLE@@, John Henry Newman.
% Text from the NewmanReader transcription (newman-src/@@ID@@/, raw
% scrape; re-fetch with `make newman-fetch`). GENERATED by newman.py --
% do not edit by hand. Newman's notes are set as footnotes at their
% points of reference. Preamble mirrors the curated-works house style
% with the LGR/textalpha Greek guard so pdflatex and pandoc both build.
\documentclass[11pt,letterpaper]{article}
\ifdefined\pdfsuppressptexinfo\pdfsuppressptexinfo=-1 \fi
\ifdefined\pdftrailerid\pdftrailerid{}\fi
\usepackage[margin=1in]{geometry}
\IfFileExists{textalpha.sty}{%
  \usepackage[LGR,T1]{fontenc}%
  \usepackage[utf8]{inputenc}%
  \usepackage{textalpha}%
}{%
  \usepackage[T1]{fontenc}%
  \usepackage[utf8]{inputenc}%
}
\ifdefined\ensuregreek
  \newcommand{\textgreek}[1]{\ensuregreek{#1}}
\else
  \newcommand{\textgreek}[1]{\emph{[Greek]}}
\fi
\newcommand{\texthebrew}[1]{{\emph{[Hebrew]}}}
\usepackage{mathpazo}
\usepackage{amssymb}
\usepackage{textcomp}
\usepackage{microtype}
\usepackage{xcolor}
\usepackage{needspace}
\usepackage[colorlinks=true,linkcolor=ink,urlcolor=maroon,citecolor=ink,filecolor=ink]{hyperref}
\urlstyle{same}
\hypersetup{pdftitle={@@TITLE@@},pdfauthor={@@AUTHOR@@}}
\linespread{1.06}
\setlength{\emergencystretch}{1.5em}

\definecolor{ink}{HTML}{2A2521}
\definecolor{heading}{HTML}{8C4A32}
\definecolor{subhead}{HTML}{6E5642}
\definecolor{accent}{HTML}{B0894C}
\definecolor{maroon}{HTML}{7B2E2E}

% Chapters: new page, TOC section level.
\newcommand{\xchapter}[1]{%
  \clearpage\phantomsection\addcontentsline{toc}{section}{#1}%
  {\normalfont\fontsize{14}{17}\selectfont\bfseries\color{heading}%
   \raggedright\emergencystretch=1.5em #1\par}%
  \vspace{2pt}{\color{accent}\hrule height 1pt}\medskip}

% Sections within a chapter: TOC subsection level.
\newcommand{\xsection}[1]{%
  \par\vspace{1.2em}\phantomsection\addcontentsline{toc}{subsection}{#1}%
  \needspace{4\baselineskip}%
  {\normalfont\fontsize{12.5}{15.5}\selectfont\bfseries\color{heading}%
   \raggedright\emergencystretch=1.5em #1\par}%
  \vspace{2pt}{\color{accent}\hrule height 0.6pt}\smallskip}

% Numbered subheads within a section, not in the TOC.
\newcommand{\xsubsection}[1]{%
  \needspace{3\baselineskip}\par\medskip
  {\normalfont\bfseries\color{subhead}\raggedright\emergencystretch=1.5em #1\par}%
  \nobreak\smallskip}

\begin{document}
\color{ink}

\begin{titlepage}
\centering
\vspace*{4em}
{\LARGE\bfseries\color{heading} @@TITLE@@\par}
\vspace{2em}
{\large\bfseries\color{heading} @@BYLINE@@\par}
\vspace{2.5em}
{\itshape\color{subhead}\parbox{0.8\linewidth}{\centering @@BLURB@@\par}}
\vspace{2.5em}
{@@PROVENANCE@@\par}
\vfill
{\small The text is in the public domain. Newman's notes are set as
footnotes at their points of reference.\par}
\vspace{2em}
\end{titlepage}

\tableofcontents

\input{@@ID@@-body.tex}

\end{document}
"""


def write_wrapper(work):
    text = WRAPPER
    subs = {
        "@@ID@@": work["id"],
        "@@TITLE@@": _tex(work["title"]),
        "@@AUTHOR@@": _tex(work["author"]),
        "@@BYLINE@@": _tex(work["byline"]),
        "@@BLURB@@": _tex(work["blurb"]),
        "@@PROVENANCE@@": _tex(work["provenance"]),
    }
    for k, v in subs.items():
        text = text.replace(k, v)
    with open(f'{work["id"]}.tex', "w", encoding="utf-8") as f:
        f.write(text)


def write_makefile():
    """Emit newman.mk: NEWMAN_PDFS (id=Output.pdf) and NEWMAN_HTML
    (id:tocdepth:"Title"), both consumed by resources/Makefile."""
    pdfs = [f'  {w["id"]}={w["pdf"]}' for w in WORKS]
    htmls = [f'  {w["id"]}:{w["tocdepth"]}:"{w["title"]}"' for w in WORKS]

    def block(var, items):
        return f"{var} = \\\n" + " \\\n".join(items) + "\n"

    text = "\n".join([
        "# GENERATED by newman.py -- do not edit by hand.",
        '# The Newman corpus: id=Output.pdf and id:tocdepth:"HTML title".',
        "",
        block("NEWMAN_PDFS", pdfs),
        block("NEWMAN_HTML", htmls),
    ])
    with open("newman.mk", "w", encoding="utf-8") as f:
        f.write(text)


# --- fetch ------------------------------------------------------------

def fetch(work):
    d = os.path.join(SRCROOT, work["id"])
    os.makedirs(d, exist_ok=True)

    def get(f):
        req = urllib.request.Request(BASE + work["path"] + "/" + f,
                                     headers={"User-Agent": UA})
        data = urllib.request.urlopen(req, timeout=60).read()
        with open(os.path.join(d, f), "wb") as fh:
            fh.write(data)

    get("index.html")
    files = content_files(os.path.join(d, "index.html"), work)
    if work["notes_appendix"]:
        files.append(work["notes_appendix"])
    for f in files:
        try:
            get(f)
            print(f'  {work["id"]}/{f}')
        except Exception as e:              # noqa: BLE001 -- report and go on
            print(f'  FAIL {work["id"]}/{f}: {e}')


def main():
    args = sys.argv[1:]
    if args and args[0] == "fetch":
        ids = set(args[1:]) - {"all"}
        for w in WORKS:
            if not ids or w["id"] in ids:
                print(f'fetching {w["id"]}...')
                fetch(w)
        return
    only = set(args)
    for w in WORKS:
        if only and w["id"] not in only:
            continue
        convert(w)
        write_wrapper(w)
    write_makefile()
    print("wrote newman.mk")


if __name__ == "__main__":
    main()
