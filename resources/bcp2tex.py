#!/usr/bin/env python3
"""Convert the Books of Common Prayer preserved from the Society of
Archbishop Justus transcriptions (justus.anglican.org) to LaTeX bodies.

Three books, three source shapes:

- 1928 American (bcp1928-src/*.htm, from the site's 1928html.zip): one
  clean HTML file per service, all content in <p> runs (the page-chrome
  tables are stripped whole); rubrics are <em>¶ ...</em> italics and
  keep their pilcrows; drop-cap spans unwrap. SERVICES_1928 lists the
  files in the book's own order with their display titles.

- 1662 English (bcp1662-src/*.pdf, the Baskerville reproduction): one
  born-digital PDF per section, extracted with pdftotext; the flow keeps
  print order. SERVICES_1662 lists them in the book's order.

- 1559 Elizabethan (bcp1559-src/*.htm): per-service files like the 1928.

Run: python bcp2tex.py
"""
import html as htmlmod
import os
import re
import subprocess

from dev2tex import blocks, finalize, inline
from newman import _heal_emphasis, _cap_quotes
from docs2tex import esc_tex

SERVICES_1928 = [
    ("MP.htm", "The Order for Daily Morning Prayer"),
    ("EP.htm", "The Order for Daily Evening Prayer"),
    ("Litany.htm", "The Litany"),
    ("Pray&Thanks.htm", "Prayers and Thanksgivings"),
    ("Readings_1928.htm", "The Collects, Epistles, and Gospels"),
    ("HC.htm", "The Order for the Holy Communion"),
    ("Baptism.htm", "The Ministration of Holy Baptism"),
    ("Catechism.htm", "The Offices of Instruction, with the Catechism"),
    ("Confirnation.htm", "The Order of Confirmation"),
    ("Marriage.htm", "The Solemnization of Matrimony"),
    ("Visitation_Sick.htm", "The Visitation of the Sick, and the Communion "
                            "of the Sick"),
    ("Burial.htm", "The Burial of the Dead"),
    ("Psalms1.htm", "The Psalter, Books I and II"),
    ("Psalms2.htm", "The Psalter, Books III and IV"),
    ("Psalms3.htm", "The Psalter, Book V"),
    ("Ordinal.htm", "The Form and Manner of Making, Ordaining, and "
                    "Consecrating Bishops, Priests, and Deacons"),
    ("Consecration.htm", "The Form of Consecration of a Church or Chapel"),
    ("Institution.htm", "An Office of Institution of Ministers"),
    ("Family_Prayer.htm", "Forms of Prayer to be Used in Families"),
    ("Articles.htm", "The Articles of Religion"),
]

SERVICES_1559 = [
    ("front_matter_1559.htm", "The Preface, and Of Ceremonies"),
    ("MP_1559.htm", "The Order for Morning Prayer"),
    ("EP_1559.htm", "The Order for Evening Prayer"),
    ("Litany_1559.htm", "The Litany"),
    ("Communion_1559.htm", "The Order of the Administration of the "
                           "Lord's Supper, or Holy Communion"),
    ("Baptism_1559.htm", "The Ministration of Baptism"),
    ("Confirmation_1559.htm", "Confirmation, with the Catechism"),
    ("Marriage_1559.htm", "The Form of Solemnization of Matrimony"),
    ("Visitation_Sick_1559.htm", "The Order for the Visitation of the Sick"),
    ("Burial_1559.htm", "The Order for the Burial of the Dead"),
    ("Churching_of_Women_1559.htm", "The Thanksgiving of Women after "
                                    "Child-birth"),
    ("Commination_1559.htm", "A Commination against Sinners"),
    ("Godly_Prayers.htm", "Certain Godly Prayers"),
]

SERVICES_1662 = [
    ("intro.pdf", "The Preface, and Concerning the Service of the Church"),
    ("mp.pdf", "The Order for Morning Prayer"),
    ("ep.pdf", "The Order for Evening Prayer"),
    ("Athanasius.pdf", "The Creed of St. Athanasius"),
    ("litany.pdf", "The Litany"),
    ("pray&thanks.pdf", "Prayers and Thanksgivings"),
    ("collects.pdf", "The Collects, Epistles, and Gospels"),
    ("HC.pdf", "The Order of the Administration of the Lord's Supper, "
               "or Holy Communion"),
    ("baptism.pdf", "The Ministration of Baptism"),
    ("catechism&conf.pdf", "A Catechism, with the Order of Confirmation"),
    ("marriage.pdf", "The Form of Solemnization of Matrimony"),
    ("visit_sick.pdf", "The Order for the Visitation of the Sick"),
    ("burial.pdf", "The Order for the Burial of the Dead"),
    ("churching_women.pdf", "The Thanksgiving of Women after Child-birth"),
    ("commination.pdf", "A Commination"),
    ("psalms.pdf", "The Psalter"),
    ("prayer_sea.pdf", "Forms of Prayer to be Used at Sea"),
    ("articles.pdf", "The Articles of Religion"),
]


def html_service(path):
    """One justus per-service HTML file to engine-ready markup."""
    raw = open(path, encoding="cp1252", errors="replace").read()
    raw = raw.replace("\r\n", "\n")
    h = re.search(r"</head\s*>", raw, re.I)
    if h:
        raw = raw[h.end():]

    # tables serve two masters here: the site chrome (header/footer nav,
    # recognizable by its grey bars and site links) is dropped whole,
    # while content tables (the Psalter's verses, the Litany's suffrages,
    # the lectionary) are linearized row by row
    def table(m):
        t = m.group(0)
        # chrome tables are small; a big table matching these markers is
        # the page's layout wrapper, whose content must be kept
        if len(t) < 6000 and re.search(
                r'bgcolor="#666666"|Society of Archbishop Justus|'
                r'href="\.\./|charter\.html|bcp\.htm', t, re.I):
            return " "
        t = re.sub(r"</td>\s*<td[^>]*>", " ", t, flags=re.S | re.I)
        t = re.sub(r"</tr>\s*", "<br>", t, flags=re.S | re.I)
        t = re.sub(r"</?(?:table|tbody|tr|td|th|colgroup|col)[^>]*>", " ",
                   t, flags=re.I)
        return "<p>" + t + "</p>"
    # innermost-out so nested chrome inside chrome resolves
    for _ in range(4):
        new = re.sub(r"<table(?:(?!<table).)*?</table>", table, raw,
                     flags=re.S | re.I)
        if new == raw:
            break
        raw = new
    raw = re.sub(r"<!--.*?-->", " ", raw, flags=re.S)
    raw = re.sub(r"<em(?=[\s>])[^>]*>", "<i>", raw, flags=re.I)
    raw = re.sub(r"</em>", "</i>", raw, flags=re.I)
    raw = re.sub(r"<strong(?=[\s>])[^>]*>", "<b>", raw, flags=re.I)
    raw = re.sub(r"</strong>", "</b>", raw, flags=re.I)
    # drop-cap and style spans unwrap; headings normalize to engine levels
    raw = re.sub(r"</?span[^>]*>", "", raw, flags=re.I)
    raw = re.sub(r"</?(?:sub|sup|small|big|body|html)[^>]*>", "", raw, flags=re.I)
    raw = re.sub(r"<h[12][^>]*>", "<h3>", raw, flags=re.I)
    raw = re.sub(r"</h[12]>", "</h3>", raw, flags=re.I)
    raw = re.sub(r"<h[56][^>]*>", "<h4>", raw, flags=re.I)
    raw = re.sub(r"</h[56]>", "</h4>", raw, flags=re.I)
    body = re.search(r"<body[^>]*>(.*)", raw, re.S | re.I)
    return body.group(1) if body else raw


def convert_html_book(srcdir, services, out):
    parts, missing = [], []
    for fname, title in services:
        path = os.path.join(srcdir, fname)
        if not os.path.exists(path):
            missing.append(fname)
            continue
        tex = finalize(inline(blocks(html_service(path))))
        tex = _heal_emphasis(tex)
        tex = _cap_quotes(tex)
        tex = re.sub(r"\n\n(?:\\\\\s*\n)+", "\n\n", tex)
        tex = re.sub(r"(?:\\\\\s*\n)+\n", "\n\n", tex)
        tex = (tex.replace("\\devchapter{", "\\xsection{")
                  .replace("\\devsection{", "\\xsection{")
                  .replace("\\devunit{", "\\xsubsection{"))
        # a heading that arrived inside <b> leaves sections nested in
        # \textbf; unwrap, merging a split pair into one heading
        tex = re.sub(r"\\textbf\{\\xsection\{([^}]*)\}\s*"
                     r"\\xsection\{([^}]*)\}\}",
                     r"\\xsection{\1 \2}", tex)
        tex = re.sub(r"\\textbf\{(\\xsection\{[^}]*\})\}", r"\1", tex)
        parts.append("\\xchapter{%s}\n\n%s" % (esc_tex(title), tex.strip()))
    body = "\n\n".join(parts) + "\n"
    body = re.sub(r"\n{3,}", "\n\n", body)
    with open(out, "w", encoding="utf-8") as f:
        f.write(body)
    leftovers = sorted(set(re.findall(r"<[a-zA-Z/][^>]*>", body)))
    print(f"wrote {out}: {body.count(chr(92) + 'xchapter')} chapters, "
          f"{len(body) // 1024} KB"
          + (f"  LEFTOVER {leftovers[:6]}" if leftovers else "")
          + (f"  MISSING {missing}" if missing else ""))


def pdf_service(path):
    """One Baskerville PDF to paragraphs (born-digital text layer)."""
    p = subprocess.run(["pdftotext", path, "-"], capture_output=True,
                       text=True)
    assert p.returncode == 0, p.stderr[:200]
    # the Baskerville reproduction's period glyphs: long s, its st/ct
    # ligatures (roman and italic private-use forms)
    text = p.stdout
    for a, b in (("\u017f", "s"), ("\ufb05", "st"), ("\ue000", "ct"),
                 ("\ue001", "ct"), ("\ue002", "st")):
        text = text.replace(a, b)
    paras = []
    for page in text.split("\f"):
        page = re.sub(r"^\s*\d{1,3}\s*$", "", page, flags=re.M)
        paras.append(page)
    text = "\n".join(paras)
    blocks_ = [re.sub(r"\s+", " ", b).strip()
               for b in re.split(r"\n\s*\n", text) if b.strip()]
    return "\n\n".join(esc_tex(b) for b in blocks_)


def convert_1662(out="bcp1662-body.tex"):
    parts, missing = [], []
    for fname, title in SERVICES_1662:
        path = os.path.join("bcp1662-src", fname)
        if not os.path.exists(path):
            missing.append(fname)
            continue
        parts.append("\\xchapter{%s}\n\n%s" % (esc_tex(title),
                                               pdf_service(path)))
    body = "\n\n".join(parts) + "\n"
    body = re.sub(r"\n{3,}", "\n\n", body)
    with open(out, "w", encoding="utf-8") as f:
        f.write(body)
    print(f"wrote {out}: {body.count(chr(92) + 'xchapter')} chapters, "
          f"{len(body) // 1024} KB"
          + (f"  MISSING {missing}" if missing else ""))


def main():
    convert_html_book("bcp1928-src", SERVICES_1928, "bcp1928-body.tex")
    if os.path.exists("bcp1559-src/MP_1559.htm"):
        convert_html_book("bcp1559-src", SERVICES_1559, "bcp1559-body.tex")
    if os.path.exists("bcp1662-src/mp.pdf"):
        convert_1662()


if __name__ == "__main__":
    main()
