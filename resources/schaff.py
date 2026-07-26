#!/usr/bin/env python3
"""Render the complete Schaff corpus as our own LaTeX/HTML editions.

The Ante-Nicene Fathers (9 volumes) and the Nicene and Post-Nicene
Fathers, First and Second Series (14 volumes each), from CCEL's ThML
editions. Each whole volume becomes one <id>-body.tex (via the shared
ccel2tex.convert_work) and one self-contained wrapper <id>.tex, plus a
generated schaff.mk that drives the PDF and HTML builds in the Makefile.

Whole-volume mode differs from ccel2tex.py's curated WORKS only in the
heading function: every div1 becomes an \\xchapter (an author, or a work
in a single-author volume) EXCEPT the title/series pages, tables, and
indexes; nested div2 -> \\xsection, div3+ -> \\xsubsection, exactly as
the curated works do. NPNF Second Series Vol. 14 (the Seven Ecumenical
Councils) is already published as councils.html and is not rebuilt here.

Run: python schaff.py         (writes bodies, wrappers, and schaff.mk)
"""
import re
import sys

from ccel2tex import convert_work, esc

# --- whole-volume heading selection -----------------------------------
#
# The volumes are inconsistently structured. Two kinds of front/back
# matter must be handled differently:
#
#  * "skip-self": a title/series page whose OWN heading is furniture but
#    which sometimes *contains* real work (anf01's prefaces sit under
#    "Title Page"; the whole of Hilary of Poitiers is mis-nested under
#    "Title Page" in npnf209). We drop the heading but let the shared
#    Converter promote the real children beneath it — its normal
#    behaviour when a division is skipped.
#
#  * "exclude-subtree": an index or table whose children are page-number
#    junk, some of them named exactly like real works ("The City of God"
#    inside a Subject Index). We drop the heading AND everything under it,
#    tracked by div-id prefix in a per-volume closure.
#
# Word boundaries matter: a substring "table" would wrongly catch
# "Mutable"/"Suitable" chapter titles, so match whole words only.

_INDEXY = re.compile(r"\b(index|indexes|tables?|contents)\b", re.I)
_SKIP_SELF = {"title page", "title pages", "second title page",
              "series title", "series title page", "credits"}


def _exclude_subtree(title):
    t = title.strip().rstrip(".").strip()
    if t.lower().endswith("words and phrases"):
        return True
    return bool(_INDEXY.search(t))


def _skip_self(title):
    return title.strip().rstrip(".").strip().lower() in _SKIP_SELF


# A handful of non-Greek symbols in the transcriptions are math or
# foreign-script glyphs that pdflatex's text fonts cannot set (textcomp,
# loaded in the preamble, covers the typographic ones like the euro,
# trademark, daggers, bullet, and florin). Map the rest to safe text.
# Runs as the post_fn, after NFC and combining-mark cleanup.
_SYMBOLS = {
    "∴": "\\ensuremath{\\therefore}",  # THEREFORE
    "⟧": "]",                           # math right white square bracket
    "Р": "P",                           # stray Cyrillic ER (looks Latin)
    "‚": ",",                           # low-9 quote: LGR lacks \quotesinglbase
    "‹": "",                            # stray single guillemets in Greek words
    "›": "",                            # (LGR lacks \guilsingl*); transcription noise
}
# Coptic letters (U+03E2..U+03EF) sit in the Greek block but LGR/textalpha
# cannot set them; they appear only as rare manuscript sigla, so drop them.
_COPTIC = re.compile("[Ϣ-ϯ]")


def volume_post(body):
    for a, b in _SYMBOLS.items():
        body = body.replace(a, b)
    return _COPTIC.sub("", body)


def make_volume_heading():
    """A fresh heading function per volume: keep every division as a
    chapter unless it is furniture, excluding whole index/table subtrees
    by div-id prefix."""
    excluded = []

    def heading(div_id, title):
        for pre in excluded:
            if div_id == pre or div_id.startswith(pre + "."):
                return None
        if not title.strip():
            return None
        if _exclude_subtree(title):
            excluded.append(div_id)
            return None
        if _skip_self(title):
            return None
        return title

    return heading


# --- volume metadata --------------------------------------------------
# One row per volume: (id, series, vol, title, contents-blurb).
# `series` keys into SERIES below. The blurbs follow the CCEL/Schaff
# volume descriptions.

ANTE = "ante"
NPNF1 = "npnf1"
NPNF2 = "npnf2"

VOLUMES = [
    # Ante-Nicene Fathers -------------------------------------------------
    ("anf01", ANTE, 1, "The Apostolic Fathers with Justin Martyr and Irenæus",
     "Clement of Rome, Mathetes, Polycarp, Ignatius, Barnabas, Papias, "
     "Justin Martyr, and Irenæus."),
    ("anf02", ANTE, 2, "Fathers of the Second Century",
     "Hermas, Tatian, Theophilus, Athenagoras, and Clement of Alexandria."),
    ("anf03", ANTE, 3, "Latin Christianity: Its Founder, Tertullian",
     "Three parts: Apologetic, Anti-Marcion, and Ethical."),
    ("anf04", ANTE, 4, "Fathers of the Third Century",
     "Tertullian (Part Fourth), Minucius Felix, Commodian, and Origen."),
    ("anf05", ANTE, 5, "Fathers of the Third Century",
     "Hippolytus, Cyprian, Caius, Novatian, and an Appendix."),
    ("anf06", ANTE, 6, "Fathers of the Third Century",
     "Gregory Thaumaturgus, Dionysius the Great, Julius Africanus, "
     "Anatolius and minor writers, Methodius, and Arnobius."),
    ("anf07", ANTE, 7, "Fathers of the Third and Fourth Centuries",
     "Lactantius, Venantius, Asterius, Victorinus, Dionysius, the "
     "Teaching and Constitutions of the Apostles, a homily, and the "
     "early liturgies."),
    ("anf08", ANTE, 8, "The Twelve Patriarchs, Excerpts and Epistles, and "
     "the Ancient Remains",
     "The Testaments of the Twelve Patriarchs, the Pseudo-Clementine "
     "literature, apocrypha, the decretals, the Syriac documents of "
     "Edessa, and the remains of the first ages."),
    ("anf09", ANTE, 9, "Recently Discovered Additions, with Origen's "
     "Commentaries",
     "The Gospel of Peter, the Diatessaron of Tatian, the apocalypses "
     "and testaments, the Apology of Aristides, the complete Epistles "
     "of Clement, and Origen's Commentaries on John and Matthew."),
    # Nicene and Post-Nicene Fathers, First Series -----------------------
    ("npnf101", NPNF1, 1, "Prolegomena: St. Augustine's Life and Work, the "
     "Confessions, and the Letters",
     "The prolegomena to St. Augustine, his Confessions, and his letters."),
    ("npnf102", NPNF1, 2, "St. Augustine: The City of God and On Christian "
     "Doctrine",
     "The City of God, and On Christian Doctrine."),
    ("npnf103", NPNF1, 3, "St. Augustine: On the Holy Trinity, and the "
     "Doctrinal and Moral Treatises",
     "On the Holy Trinity, with the doctrinal and moral treatises."),
    ("npnf104", NPNF1, 4, "St. Augustine: The Anti-Manichaean and "
     "Anti-Donatist Writings",
     "The anti-Manichaean writings, and the anti-Donatist writings."),
    ("npnf105", NPNF1, 5, "St. Augustine: The Anti-Pelagian Writings",
     "The anti-Pelagian writings on grace, sin, nature, and "
     "predestination."),
    ("npnf106", NPNF1, 6, "St. Augustine: Sermon on the Mount, Harmony of "
     "the Gospels, and Homilies on the Gospels",
     "Our Lord's Sermon on the Mount, the Harmony of the Gospels, and "
     "sermons on selected lessons of the New Testament."),
    ("npnf107", NPNF1, 7, "St. Augustine: Homilies on the Gospel of John, "
     "the First Epistle of John, and the Soliloquies",
     "The tractates on the Gospel of John, ten homilies on the First "
     "Epistle of John, and the Soliloquies."),
    ("npnf108", NPNF1, 8, "St. Augustine: Expositions on the Book of Psalms",
     "The expositions on the whole book of Psalms."),
    ("npnf109", NPNF1, 9, "St. Chrysostom: On the Priesthood, Ascetic "
     "Treatises, Select Homilies and Letters, and Homilies on the Statutes",
     "On the Priesthood, the ascetic treatises, select homilies and "
     "letters, and the homilies on the statues."),
    ("npnf110", NPNF1, 10, "St. Chrysostom: Homilies on the Gospel of St. "
     "Matthew",
     "The complete homilies on the Gospel of Matthew."),
    ("npnf111", NPNF1, 11, "St. Chrysostom: Homilies on the Acts of the "
     "Apostles and the Epistle to the Romans",
     "The homilies on the Acts of the Apostles, and on the Epistle to "
     "the Romans."),
    ("npnf112", NPNF1, 12, "St. Chrysostom: Homilies on First and Second "
     "Corinthians",
     "The homilies on the First and Second Epistles to the Corinthians."),
    ("npnf113", NPNF1, 13, "St. Chrysostom: Homilies on the Epistles to the "
     "Galatians through Philemon",
     "The homilies on Galatians, Ephesians, Philippians, Colossians, "
     "Thessalonians, Timothy, Titus, and Philemon."),
    ("npnf114", NPNF1, 14, "St. Chrysostom: Homilies on the Gospel of St. "
     "John and the Epistle to the Hebrews",
     "The homilies on the Gospel of John, and on the Epistle to the "
     "Hebrews."),
    # Nicene and Post-Nicene Fathers, Second Series ----------------------
    ("npnf201", NPNF2, 1, "Eusebius: Church History, Life of Constantine, "
     "and Oration in Praise of Constantine",
     "The Church History from the birth of Christ to A.D. 324, the Life "
     "of Constantine, and the Oration in his praise."),
    ("npnf202", NPNF2, 2, "Socrates and Sozomenus: Ecclesiastical Histories",
     "The Church History of Socrates Scholasticus, and the Church "
     "History of Sozomen."),
    ("npnf203", NPNF2, 3, "Theodoret, Jerome and Gennadius, Rufinus and "
     "Jerome",
     "The Ecclesiastical History and letters of Theodoret; Jerome and "
     "Gennadius on illustrious men; and the works of Rufinus with "
     "Jerome's apology against him."),
    ("npnf204", NPNF2, 4, "Athanasius: Select Works and Letters",
     "The select writings and letters of Athanasius, including Against "
     "the Heathen, On the Incarnation, and the Arian controversy."),
    ("npnf205", NPNF2, 5, "Gregory of Nyssa: Dogmatic Treatises, and Select "
     "Writings and Letters",
     "The dogmatic treatises, and the select writings and letters of "
     "Gregory of Nyssa."),
    ("npnf206", NPNF2, 6, "Jerome: Letters and Select Works",
     "The letters, treatises, and prefaces of St. Jerome."),
    ("npnf207", NPNF2, 7, "Cyril of Jerusalem and Gregory Nazianzen",
     "The catechetical lectures of Cyril of Jerusalem, and the select "
     "orations and letters of Gregory Nazianzen."),
    ("npnf208", NPNF2, 8, "Basil: Letters and Select Works",
     "On the Holy Spirit, the Hexaemeron, and the letters of St. Basil."),
    ("npnf209", NPNF2, 9, "Hilary of Poitiers, and John of Damascus",
     "The select works of Hilary of Poitiers, On the Councils, On the "
     "Trinity, and homilies on the Psalms; and John of Damascus, the "
     "Exposition of the Orthodox Faith."),
    ("npnf210", NPNF2, 10, "Ambrose: Select Works and Letters",
     "The dogmatic treatises, ethical works, and sermons of St. Ambrose, "
     "with a selection from his letters."),
    ("npnf211", NPNF2, 11, "Sulpitius Severus, Vincent of Lérins, and John "
     "Cassian",
     "The works of Sulpitius Severus, the Commonitory of Vincent of "
     "Lérins, and the works of John Cassian."),
    ("npnf212", NPNF2, 12, "Leo the Great and Gregory the Great",
     "The letters and sermons of Leo the Great, and the book of "
     "pastoral rule and selected epistles of Gregory the Great."),
    ("npnf213", NPNF2, 13, "Gregory the Great (Part II), Ephraim Syrus, and "
     "Aphrahat",
     "The selected epistles of Gregory the Great, and selections from "
     "Ephraim the Syrian and Aphrahat the Persian sage."),
    # NPNF Second Series Vol. 14 = the Seven Ecumenical Councils, already
    # published as councils.html; not rebuilt here.
]

# series display name, editor byline, and years for the source note
SERIES = {
    ANTE: ("Ante-Nicene Fathers",
           "Ante-Nicene Fathers",
           "Edited by Alexander Roberts and James Donaldson; American "
           "reprint arranged by A. Cleveland Coxe",
           "The Ante-Nicene Fathers: Translations of the Writings of the "
           "Fathers down to A.D. 325"),
    NPNF1: ("Nicene and Post-Nicene Fathers, First Series",
            "Nicene \\& Post-Nicene Fathers, First Series",
            "Edited by Philip Schaff",
            "A Select Library of the Nicene and Post-Nicene Fathers of the "
            "Christian Church, First Series"),
    NPNF2: ("Nicene and Post-Nicene Fathers, Second Series",
            "Nicene \\& Post-Nicene Fathers, Second Series",
            "Edited by Philip Schaff and Henry Wace",
            "A Select Library of the Nicene and Post-Nicene Fathers of the "
            "Christian Church, Second Series"),
}


def pdf_name(series, vol):
    if series == ANTE:
        return f"Ante-Nicene_Fathers_Vol_{vol}.pdf"
    n = "1" if series == NPNF1 else "2"
    return f"Nicene_and_Post-Nicene_Fathers_Series_{n}_Vol_{vol}.pdf"


ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X",
         "XI", "XII", "XIII", "XIV"]


def _tex(s):
    """Escape LaTeX specials in a metadata string (& % # _ $)."""
    for a, b in (("\\", r"\textbackslash{}"), ("&", r"\&"), ("%", r"\%"),
                 ("#", r"\#"), ("_", r"\_"), ("$", r"\$")):
        s = s.replace(a, b)
    return s


WRAPPER = r"""% @@SERIESLINE@@, Volume @@ROMAN@@: @@TITLE@@.
% Text from CCEL's ThML edition (@@ID@@.xml), rebuilt as our own LaTeX.
% GENERATED by schaff.py from the VOLUMES table -- do not edit by hand;
% the preamble mirrors councils.tex so pdflatex and pandoc both build it.
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
\usepackage{amssymb}% \therefore and friends used in a few argument texts
\usepackage{textcomp}% euro, trademark, dagger, bullet, florin, low quotes
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

% Divisions (an author, or a work): new page, TOC section level.
\newcommand{\xchapter}[1]{%
  \clearpage\phantomsection\addcontentsline{toc}{section}{#1}%
  {\normalfont\fontsize{14}{17}\selectfont\bfseries\color{heading}%
   \raggedright\emergencystretch=1.5em #1\par}%
  \vspace{2pt}{\color{accent}\hrule height 1pt}\medskip}

% Works or books within a division: TOC subsection level.
\newcommand{\xsection}[1]{%
  \par\vspace{1.2em}\phantomsection\addcontentsline{toc}{subsection}{#1}%
  \needspace{4\baselineskip}%
  {\normalfont\fontsize{12.5}{15.5}\selectfont\bfseries\color{heading}%
   \raggedright\emergencystretch=1.5em #1\par}%
  \vspace{2pt}{\color{accent}\hrule height 0.6pt}\smallskip}

% Chapters within a work, not in the TOC.
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
\vspace{1.5em}
{\large @@SERIESLINE@@\par}
\vspace{0.4em}
{\large\color{subhead} Volume @@ROMAN@@\par}
\vspace{2em}
{\itshape\color{subhead} @@CONTENTS@@\par}
\vspace{3em}
{@@EDITOR@@.\par}
\vfill
{\small From \emph{@@SOURCE@@}, Volume @@ROMAN@@. The translation is in
the public domain.\par}
\vspace{2em}
\end{titlepage}

\tableofcontents

\input{@@ID@@-body.tex}

\end{document}
"""


def write_wrapper(vid, series, vol, title, contents):
    disp, _mkname, editor, source = SERIES[series]
    text = WRAPPER
    subs = {
        "@@ID@@": vid,
        "@@ROMAN@@": ROMAN[vol],
        "@@TITLE@@": _tex(title),
        "@@AUTHOR@@": _tex(editor),
        "@@SERIESLINE@@": _tex(disp),
        "@@CONTENTS@@": _tex(contents),
        "@@EDITOR@@": _tex(editor),
        "@@SOURCE@@": _tex(source),
    }
    for k, v in subs.items():
        text = text.replace(k, v)
    with open(f"{vid}.tex", "w", encoding="utf-8") as f:
        f.write(text)


def write_makefile():
    """Emit schaff.mk: the id=Output.pdf list and the id:depth:"Title"
    HTML list, both consumed by resources/Makefile."""
    pdfs, htmls = [], []
    for vid, series, vol, title, _contents in VOLUMES:
        pdfs.append(f"  {vid}={pdf_name(series, vol)}")
        disp = SERIES[series][0]  # long form, no ampersand, for the tab title
        html_title = f"{disp}, Vol. {ROMAN[vol]}: {title}"
        htmls.append(f'  {vid}:2:"{html_title}"')

    def block(var, items):
        # a line-continued make variable; no trailing backslash on the last
        body = " \\\n".join(items)
        return f"{var} = \\\n{body}\n"

    text = "\n".join([
        "# GENERATED by schaff.py -- do not edit by hand.",
        '# The complete Schaff corpus: id=Output.pdf and id:tocdepth:"HTML title".',
        "",
        block("SCHAFF_PDFS", pdfs),
        block("SCHAFF_HTML", htmls),
    ])
    with open("schaff.mk", "w", encoding="utf-8") as f:
        f.write(text)


def main():
    only = set(sys.argv[1:])  # optional list of ids to (re)build
    for vid, series, vol, title, contents in VOLUMES:
        if only and vid not in only:
            continue
        stats = convert_work(f"{vid}.xml", f"{vid}-body.tex",
                             make_volume_heading(), inner_heads=False,
                             post_fn=volume_post,
                             skip_titles=("Contents", "Contents."),
                             safe_footnotes=True, quiet=True)
        write_wrapper(vid, series, vol, title, contents)
        ch = stats.count("\\xchapter{")
        se = stats.count("\\xsection{")
        su = stats.count("\\xsubsection{")
        fn = stats.count("\\footnote{")
        print(f"{vid}: {ch} chapters, {se} sections, {su} subsections, "
              f"{fn} footnotes  ({len(stats)//1024} KB)")
    write_makefile()
    print("wrote schaff.mk")


if __name__ == "__main__":
    main()
