#!/usr/bin/env python3
"""Convert the CCEL HTML of St. Thomas Aquinas' Summa Theologica (the
Benziger Bros. 1947 English Dominican translation) to LaTeX bodies, one per
part.

The source (summa-src/, 625 files) is `<br>`-laid-out HTML, but every unit of
content carries a precise structural comment, e.g.

  <!--Aquin.: SMT FP Q[2] A[1] Obj. 1 Para. 1/1-->

so the parser keys on those (handle_comment) rather than on prose. Within a
question file: <H3 Align="Center"> holds the treatise heading (only where a
treatise opens) and the question title; <H3 Align="Left"> holds each article
title ("Whether ...?"); every non-nav <P> is a content paragraph whose role
(Out. = prologue, Obj./OTC = on the contrary/Body = I answer that/R.O. = reply)
comes from the most recent comment. Output uses the shared division macros:

  treatise -> \\xchapter   question -> \\xsection   article -> \\xsubsection

so the HTML build rewrites them with the same sed as the Bibles. One body per
part: summa-fp … summa-xp.

Run: python summatheologica2tex.py
"""
import glob
import html as htmlmod
import re
from html.parser import HTMLParser

from ccel2tex import esc
from catena2tex import finalize

PARTS = [
    ("summa-fp", "FP", "The First Part"),
    ("summa-fs", "FS", "The First Part of the Second Part"),
    ("summa-ss", "SS", "The Second Part of the Second Part"),
    ("summa-tp", "TP", "The Third Part"),
    ("summa-xp", "XP", "The Supplement"),
]

COMMENT_RE = re.compile(
    r"Aquin\.: SMT (\w+) Q\[(\d+)\](?: A\[(\d+)\])? ([A-Za-z.]+)")

LABEL_RE = re.compile(
    r"^(Objection \d+:|On the contrary,|I answer that,|Reply to Objection \d+:)")

_SMALL = {"of", "the", "and", "a", "an", "to", "in", "on", "or", "for",
          "is", "as", "by", "from"}


def titlecase(s):
    """ALL-CAPS Summa heading -> Title Case, keeping small words down."""
    s = re.sub(r"\s+", " ", s).strip()
    words = s.split(" ")
    out = []
    for i, w in enumerate(words):
        lw = w.lower()
        if i and lw in _SMALL:
            out.append(lw)
        elif re.fullmatch(r"[IVXLC]+", w):
            out.append(w)
        else:
            out.append(w[:1].upper() + w[1:].lower() if w.isupper() else w)
    return " ".join(out)


def _para(text):
    """Bold the leading scholastic label of a content paragraph."""
    text = re.sub(r"\s+", " ", text).strip()
    m = LABEL_RE.match(text)
    if m:
        return "\\textbf{%s}%s" % (esc(m.group(1)),
                                   _tex(text[m.end():]))
    return _tex(text)


_QOPEN = " \n\t(—-[{“‘"


def _tex(text):
    out = []
    for ch in text:
        if ch == '"':
            prev = out[-1][-1:] if out else " "
            out.append("``" if prev in _QOPEN else "''")
        else:
            out.append(esc(ch))
    return "".join(out)


class SummaFile(HTMLParser):
    """Parse one question file into a list of body fragments."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out = []
        self.started = False
        self.qnum = None
        self.a = None
        self.cap = None      # 'center' | 'left' | 'p' | None
        self.buf = []

    def _flush(self):
        # <P> tags in this old HTML are mostly unclosed, so a block ends only
        # when the next block starts (or EOF); flush whatever was capturing.
        cap, self.cap = self.cap, None
        text = htmlmod.unescape("".join(self.buf))
        self.buf = []
        if cap == "p":
            text = text.strip()
            if text:
                self.out.append(_para(text))
        elif cap == "center":
            self._center(text)
        elif cap == "left":
            self._article(text)

    def handle_comment(self, data):
        m = COMMENT_RE.search(data)
        if not m:
            return
        self._flush()
        self.started = True
        self.qnum = m.group(2)
        self.a = m.group(3)   # None for question-level (Out.)

    def handle_starttag(self, tag, attrs):
        a = {k.lower(): (v or "") for k, v in attrs}
        if tag == "br":
            if self.cap in ("center", "left"):
                self.buf.append("\n")
            elif self.cap == "p":
                self.buf.append(" ")
            return
        if tag == "h3" and self.started:
            self._flush()
            self.cap = "center" if a.get("align", "").lower() == "center" else "left"
        elif tag == "p" and self.started:
            self._flush()
            self.cap = "nav" if a.get("align", "").lower() == "right" else "p"

    def handle_endtag(self, tag):
        if tag in ("h3", "p"):
            self._flush()

    def handle_data(self, data):
        if self.cap in ("center", "left", "p"):
            self.buf.append(data)

    def _center(self, text):
        # treatise line(s) (if any) then the question title, split on <br>
        segs = [s.strip() for s in text.split("\n") if s.strip()]
        title = segs[-1] if segs else ""
        for s in segs[:-1]:
            if "TREATISE" in s.upper() or "PROLOGUE" in s.upper():
                self.out.append("\\xchapter{%s}"
                                % esc(titlecase(re.sub(r"\s*\(.*?\)\s*", " ", s))))
        title = re.sub(r"\s*\((?:ONE|TWO|THREE|FOUR|FIVE|SIX|SEVEN|EIGHT|NINE|TEN|"
                       r"ELEVEN|TWELVE|\w+)\s+ARTICLES?\)\s*$", "", title, flags=re.I)
        self.out.append("\\xsection{Question %s. %s}"
                        % (self.qnum, esc(titlecase(title))))

    def _article(self, text):
        title = re.sub(r"\s+", " ", htmlmod.unescape(text)).strip()
        num = self.a or "?"
        self.out.append("\\xsubsection{Article %s. %s}" % (num, esc(title)))


def convert_part(code):
    files = sorted(glob.glob(f"summa-src/{code}/{code}[0-9]*.html"),
                   key=lambda p: int(re.search(r"(\d+)\.html$", p).group(1)))
    out = []
    for path in files:
        p = SummaFile()
        with open(path, encoding="utf-8") as f:
            p.feed(f.read())
        p._flush()   # emit the final unclosed block
        out.extend(p.out)
    return finalize("\n\n".join(out) + "\n")


WRAPPER = r"""% St. Thomas Aquinas, Summa Theologica -- @@NAME@@. The Benziger
% Bros. 1947 English Dominican translation, from CCEL (summa-src/, preserved),
% rebuilt as our own LaTeX by summatheologica2tex.py; this file owns the
% preamble, macros, and front matter. GENERATED -- edit the parser, not this.
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
\hypersetup{pdftitle={Summa Theologica -- @@NAME@@},pdfauthor={St. Thomas Aquinas}}
\linespread{1.06}
\setlength{\emergencystretch}{1.5em}

\definecolor{ink}{HTML}{2A2521}
\definecolor{heading}{HTML}{8C4A32}
\definecolor{subhead}{HTML}{6E5642}
\definecolor{accent}{HTML}{B0894C}
\definecolor{maroon}{HTML}{7B2E2E}

% Treatises: new page, TOC section level.
\newcommand{\xchapter}[1]{%
  \clearpage\phantomsection\addcontentsline{toc}{section}{#1}%
  {\normalfont\fontsize{15}{18}\selectfont\bfseries\color{heading}%
   \raggedright #1\par}%
  \vspace{2pt}{\color{accent}\hrule height 1pt}\medskip}

% Questions: TOC subsection level.
\newcommand{\xsection}[1]{%
  \par\vspace{1.2em}\phantomsection\addcontentsline{toc}{subsection}{#1}%
  \needspace{4\baselineskip}%
  {\normalfont\fontsize{13}{16}\selectfont\bfseries\color{heading}%
   \raggedright #1\par}%
  \vspace{2pt}{\color{accent}\hrule height 0.6pt}\smallskip}

% Articles: a bold heading, not in the TOC.
\newcommand{\xsubsection}[1]{%
  \needspace{3\baselineskip}\par\medskip
  {\normalfont\bfseries\color{subhead}\raggedright #1\par}%
  \nobreak\smallskip}

\begin{document}
\color{ink}

\begin{titlepage}
\centering
\vspace*{4em}
{\LARGE\bfseries\color{heading} Summa Theologica\par}
\vspace{1.5em}
{\Large\color{subhead} @@NAME@@\par}
\vspace{2.5em}
{\itshape\color{subhead} St. Thomas Aquinas, translated by the Fathers of
the English Dominican Province.\par}
\vfill
{\small From the Benziger Brothers edition of 1947. The translation is in
the public domain.\par}
\vspace{2em}
\end{titlepage}

\tableofcontents

\input{@@ID@@-body.tex}

\end{document}
"""


def write_wrapper(sid, name):
    text = WRAPPER.replace("@@ID@@", sid).replace("@@NAME@@", name)
    with open(f"{sid}.tex", "w", encoding="utf-8") as f:
        f.write(text)


def main():
    for sid, code, name in PARTS:
        body = convert_part(code)
        with open(f"{sid}-body.tex", "w", encoding="utf-8") as f:
            f.write(body)
        write_wrapper(sid, name)
        print(f"{sid}: {body.count(chr(92)+'xchapter{')} treatises, "
              f"{body.count(chr(92)+'xsection{')} questions, "
              f"{body.count(chr(92)+'xsubsection{')} articles  "
              f"({len(body)//1024} KB)")


if __name__ == "__main__":
    main()
