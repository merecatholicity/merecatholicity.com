#!/usr/bin/env python3
"""Convert the fisheaters PDFs of St. Thomas Aquinas' Catena Aurea (the
Golden Chain) to LaTeX bodies, one per Gospel.

The source PDFs (catena-src/xaquinas-<gospel>.pdf, the Oxford translation,
1841) extract cleanly with pdftotext: no running heads, only standalone
page-number lines to drop, and text that reflows across lines and pages.
The structure of the commentary is:

  PREFACE TO THE GOSPEL ...        -> \\cachapter{Preface}
  CHAP. 1                          -> \\cachapter{Chapter 1}
  1:1                              -> a lemma group, its reference
  Ver. 1. The book of the ...      -> the Gospel text of that group -> \\calemma
  JEROME. (Prolog...) 'The face... -> a Father's comment -> \\cacomment{Jerome}{...}
  RABANUS. By this exordium ...    -> the next comment, and so on

A comment runs until the next Father attribution, lemma reference, or
chapter. Attributions are detected against the fixed roster of Fathers the
Catena draws on (KNOWN below), so a stray capitalized word never splits a
paragraph. The wrapper catena-<gospel>.tex owns the preamble and macros.

Run: python catena2tex.py
"""
import re
import subprocess
import unicodedata

from ccel2tex import esc

# Runs of Greek (or Hebrew) letters, with their intra-run spacing and
# punctuation, so a whole cited phrase is wrapped in one macro.
_GK = "Ͱ-Ͽἀ-῿"
_HB = "֐-׿"
GREEK_RUN = re.compile("[%s]([%s\\s.,·;:'’‘’‘()\\-]*[%s])?" % (_GK, _GK, _GK))
HEBREW_RUN = re.compile("[%s]([%s\\s.,;:'’‘()\\-]*[%s])?" % (_HB, _HB, _HB))


def finalize(body):
    """Compose, drop orphan combining marks pdflatex's LGR path can't set,
    and wrap Greek and Hebrew citations in their macros (same treatment the
    Schaff volumes get)."""
    body = unicodedata.normalize("NFC", body)
    body = body.replace("ʼ", "'")       # modifier apostrophe
    body = re.sub("[‎‏‪-‮]", "", body)  # bidi controls
    body = "".join(c for c in body if not 0x0300 <= ord(c) <= 0x036F)
    body = GREEK_RUN.sub(lambda m: "\\textgreek{%s}" % m.group(0), body)
    body = HEBREW_RUN.sub(lambda m: "\\texthebrew{%s}" % m.group(0), body)
    return body

GOSPELS = [
    ("matthew", "St. Matthew"),
    ("mark", "St. Mark"),
    ("luke", "St. Luke"),
    ("john", "St. John"),
]

# The Fathers and sources the Catena quotes; an attribution line begins
# with one of these (optionally prefixed "PSEUDO-") in capitals. Kept as a
# fixed roster so noise like "THE.", "ST.", "AMEN.", "LXX." never matches.
KNOWN = {
    "CHRYSOSTOM", "AUGUSTINE", "BEDE", "THEOPHYLACT", "JEROME", "ORIGEN",
    "AMBROSE", "GREGORY", "GLOSS", "HILARY", "REMIGIUS", "RABANUS", "ALCUIN",
    "BASIL", "EUSEBIUS", "ATHANASIUS", "LEO", "CHRYSOLOGUS", "CYPRIAN",
    "DAMASCENE", "MAXIMUS", "HAYMO", "DIDYMUS", "SEVERIANUS", "EPIPHANIUS",
    "CASSIAN", "ISIDORE", "AMBROSIASTER", "THEODOTUS", "PASCHASIUS",
    "NEMESIUS", "LANFRANC", "JOSEPHUS", "GENNADIUS", "ANSELM", "CYRIL",
    "NAZIANZEN", "NYSSA", "DIONYSIUS", "GLOSSA", "AUSTIN",
}

ATTR_RE = re.compile(r"^(PSEUDO-)?([A-ZÆŒ][A-ZÆŒ-]*)\.(\s|$|\()")
VRANGE_RE = re.compile(r"^\d+:\d+(?:[–\-]\d+(?::\d+)?)?$")
CHAP_RE = re.compile(r"^CHAP\.\s*(\d+)$")
PAGENUM_RE = re.compile(r"^\d{1,4}$")


def is_attr(line):
    m = ATTR_RE.match(line)
    if not m:
        return None
    base = m.group(2)
    if base not in KNOWN:
        return None
    name = (m.group(1) or "") + base
    rest = line[m.end(2) + 1:].lstrip()   # everything after the "Name." period
    return name, rest


def father_name(upper):
    """PSEUDO-CHRYSOSTOM -> Pseudo-Chrysostom; GLOSS -> Gloss."""
    return "-".join(p.capitalize() for p in upper.split("-"))


_QOPEN = " \n\t(—-[{“‘"


def tex(text):
    """LaTeX-escape and turn straight double quotes into TeX quotes."""
    out = []
    for ch in text:
        if ch == '"':
            prev = out[-1][-1:] if out else " "
            out.append("``" if prev in _QOPEN else "''")
        else:
            out.append(esc(ch))
    return "".join(out)


def pdftext(gospel):
    pdf = f"catena-src/xaquinas-{gospel}.pdf"
    return subprocess.run(["pdftotext", "-eol", "unix", pdf, "-"],
                          capture_output=True, text=True, check=True).stdout


class Body:
    """Accumulates the reflowed blocks of one Gospel's catena."""

    def __init__(self):
        self.out = []
        self.kind = None      # 'pre' | 'lemma' | 'comment'
        self.buf = []
        self.ref = None
        self.name = None

    def flush(self):
        if self.kind is None:
            return
        text = re.sub(r"\s+", " ", " ".join(self.buf)).strip()
        kind, self.kind, self.buf = self.kind, None, []
        if not text:
            return
        # Single-argument macros only, so the HTML build can rewrite each
        # with one sed and no stray closing brace (the body text is already
        # escaped, so the only unescaped braces are the macro delimiters).
        if kind == "pre":
            self.out.append(tex(text))
        elif kind == "lemma":
            self.out.append("\\caref{%s} \\calemma{%s}"
                            % (esc(self.ref), tex(text)))
        elif kind == "comment":
            self.out.append("\\cafather{%s} %s"
                            % (esc(father_name(self.name)), tex(text)))

    def head(self, macro, title):
        self.flush()
        self.out.append("\\%s{%s}" % (macro, esc(title)))

    def start(self, kind, **kw):
        self.flush()
        self.kind = kind
        self.__dict__.update(kw)

    def add(self, line):
        if self.kind is None:
            return
        self.buf.append(line)


def convert(gospel):
    lines = pdftext(gospel).split("\n")
    b = Body()
    started = False
    for raw in lines:
        line = raw.replace("\x0c", "").strip()   # drop page-break form feeds
        if not started:
            # the body opens with a preface (Matthew, Mark, Luke) or, for
            # John, straight into Chapter 1; skip the title page and author
            # list before either.
            if line.startswith("PREFACE TO THE GOSPEL"):
                started = True
                b.head("cachapter", "Preface")
                b.start("pre")
                continue
            if CHAP_RE.match(line):
                started = True   # fall through to the chapter handler below
            else:
                continue
        if not line or PAGENUM_RE.match(line):
            # blank / page number: a paragraph break inside the preface,
            # otherwise just a reflow gap
            if b.kind == "pre" and b.buf:
                b.flush()
                b.start("pre")
            continue
        m = CHAP_RE.match(line)
        if m:
            b.head("cachapter", "Chapter %s" % m.group(1))
            continue
        if VRANGE_RE.match(line):
            b.start("lemma", ref=line)
            continue
        attr = is_attr(line)
        if attr:
            name, rest = attr
            b.start("comment", name=name)
            b.add(rest)
            continue
        b.add(line)
    b.flush()
    return finalize("\n\n".join(b.out) + "\n")


WRAPPER = r"""% St. Thomas Aquinas, Catena Aurea (the Golden Chain), on the
% Gospel of @@GOSPEL@@. Oxford translation, 1841, from the fisheaters PDF
% (catena-src/xaquinas-@@ID@@.pdf), rebuilt as our own LaTeX by
% catena2tex.py; this file owns the preamble, macros, and front matter.
% GENERATED -- edit catena2tex.py, not this file. Public domain.
\documentclass[11pt,letterpaper]{article}
\ifdefined\pdfsuppressptexinfo\pdfsuppressptexinfo=-1 \fi
\ifdefined\pdftrailerid\pdftrailerid{}\fi
\usepackage[margin=1in]{geometry}
% The Catena quotes Greek (and a little Hebrew); with texlive-langgreek the
% LGR path sets it, without it the build still succeeds.
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
\usepackage{textcomp}
\usepackage{microtype}
\usepackage{xcolor}
\usepackage{needspace}
\usepackage[colorlinks=true,linkcolor=ink,urlcolor=maroon,citecolor=ink,filecolor=ink]{hyperref}
\urlstyle{same}
\hypersetup{pdftitle={Catena Aurea on @@GOSPEL@@},pdfauthor={St. Thomas Aquinas}}
\linespread{1.06}
\setlength{\emergencystretch}{1.5em}

\definecolor{ink}{HTML}{2A2521}
\definecolor{heading}{HTML}{8C4A32}
\definecolor{subhead}{HTML}{6E5642}
\definecolor{accent}{HTML}{B0894C}
\definecolor{maroon}{HTML}{7B2E2E}

% Chapters (and the preface): new page, TOC section level.
\newcommand{\cachapter}[1]{%
  \clearpage\phantomsection\addcontentsline{toc}{section}{#1}%
  {\normalfont\fontsize{15}{18}\selectfont\bfseries\color{heading}%
   \raggedright #1\par}%
  \vspace{2pt}{\color{accent}\hrule height 1pt}\medskip}

% The verse reference standing at the head of a lemma, run in before it.
\newcommand{\caref}[1]{\par\medskip\needspace{3\baselineskip}%
  {\bfseries\color{accent}#1\quad}}

% The Gospel text being commented on: set apart in bold.
\newcommand{\calemma}[1]{{\bfseries\color{ink}#1}\par\smallskip}

% A Father's name opening his comment, in small capitals.
\newcommand{\cafather}[1]{\par{\scshape\color{subhead}#1.}~}

\begin{document}
\color{ink}

\begin{titlepage}
\centering
\vspace*{4em}
{\LARGE\bfseries\color{heading} Catena Aurea\par}
\vspace{1em}
{\large The Golden Chain\par}
\vspace{2em}
{\Large\color{subhead} A Commentary on the Gospel of @@GOSPEL@@\par}
\vspace{2.5em}
{\itshape\color{subhead} Gathered out of the works of the Fathers by
St. Thomas Aquinas.\par}
\vfill
{\small From the Oxford translation of 1841 (John Henry Parker). The
translation is in the public domain.\par}
\vspace{2em}
\end{titlepage}

\tableofcontents

\input{catena-@@ID@@-body.tex}

\end{document}
"""


def write_wrapper(gospel, title):
    text = (WRAPPER.replace("@@ID@@", gospel).replace("@@GOSPEL@@", title))
    with open(f"catena-{gospel}.tex", "w", encoding="utf-8") as f:
        f.write(text)


def main():
    for gospel, title in GOSPELS:
        body = convert(gospel)
        out = f"catena-{gospel}-body.tex"
        with open(out, "w", encoding="utf-8") as f:
            f.write(body)
        write_wrapper(gospel, title)
        print(f"wrote {out}: {body.count(chr(92)+'cachapter{')} divisions, "
              f"{body.count(chr(92)+'calemma{')} lemmata, "
              f"{body.count(chr(92)+'cafather{')} comments")


if __name__ == "__main__":
    main()
