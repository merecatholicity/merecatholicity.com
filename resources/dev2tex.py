#!/usr/bin/env python3
"""Convert the NewmanReader scrape of An Essay on the Development of
Christian Doctrine (1878 text) to a LaTeX body.

Reads the raw pages in newman-development/, keeps the Dedication,
Preface, Advertisement, Introduction, and Chapters 1-12, inlines each
chapter's endnotes as LaTeX footnotes at their reference points, and
writes development-body.tex for \\input by development.tex. Site
navigation, mini-TOCs, page-number markers, and the NewmanReader footer
are dropped.

Conversion runs in three passes: structural markup becomes private-use
sentinel characters, then entities are decoded and TeX specials escaped
in the plain text, then sentinels become LaTeX commands. That way the
escaping pass cannot mangle the commands.

Run: python dev2tex.py
"""
import html as htmlmod
import re
import sys

SRCDIR = "newman-development"
OUT = "development-body.tex"

# (file, chapter heading): None = take from the file's h2,
# SKIP = continuation file, no heading of its own.
FILES = [
    ("introduction.html", "Introduction."),
    ("chapter1.html", None), ("chapter2.html", None), ("chapter3.html", None),
    ("chapter4.html", None), ("chapter5.html", None),
    ("chapter6-1.html", None), ("chapter6-2.html", "SKIP"),
    ("chapter6-3.html", "SKIP"),
    ("chapter7.html", None), ("chapter8.html", None), ("chapter9.html", None),
    ("chapter10.html", None), ("chapter11.html", None), ("chapter12.html", None),
]

TEX_SPECIALS = {
    "&": r"\&", "%": r"\%", "$": r"\$", "#": r"\#", "_": r"\_",
    "~": r"\textasciitilde{}", "^": r"\textasciicircum{}",
    "\\": r"\textbackslash{}", "{": r"\{", "}": r"\}",
}

# private-use sentinels
GRP_C = ""   # closing brace of any group
EMPH = ""
BOLD = ""
SC = ""
QUO, QUC = "", ""
SECT = ""
UNIT = ""
CHAP = ""
PAR = ""
BRK = ""
FN_O, FN_C = "", ""   # wrap an endnote number
MAC_O = ""                  # macron on next letter

RESTORE = [
    (EMPH, r"\emph{"), (BOLD, r"\textbf{"), (SC, r"\textsc{"),
    (QUO, "\\begin{quote}\n"), (QUC, "\n\\end{quote}"),
    (SECT, r"\devsection{"), (UNIT, r"\devunit{"), (CHAP, r"\devchapter{"),
    (GRP_C, "}"), (PAR, "\n\n"), (BRK, "\\\\\n"),
]


def strip_tags(t):
    return re.sub(r"<[^>]+>", "", t)


OPENERS = " \n\t(—[" + PAR + QUO + BRK + SECT + UNIT + CHAP + EMPH + BOLD + SC


def smart_quotes(text):
    out = []
    for ch in text:
        if ch == '"':
            prev = out[-1] if out else "\n"
            out.append("``" if prev in OPENERS else "''")
        else:
            out.append(ch)
    return "".join(out)


def inline(t):
    """Inline markup to sentinels; text stays raw."""
    # endnote references: [Note N] with its return anchor, order-tolerant
    t = re.sub(
        r"\[\s*(?:</?a[^>]*>\s*)*(?:Note|Name)\s+(\d+)\s*(?:</?a[^>]*>\s*)*\]",
        lambda m: FN_O + m.group(1) + FN_C, t)
    # transliteration macrons: <u>e</u>
    t = re.sub(r"<u>([a-zA-Z])</u>", lambda m: MAC_O + m.group(1), t)
    # small caps: uppercase-transform spans and X<font size="2">YZ</font>
    t = re.sub(r"<span[^>]*text-transform:\s*uppercase[^>]*>(.*?)</span>",
               lambda m: SC + strip_tags(m.group(1)) + GRP_C, t, flags=re.S)
    t = re.sub(r"([A-Z])<font size=\"2\">([A-Z']+)</font>",
               lambda m: m.group(1) + SC + m.group(2).lower() + GRP_C, t)
    t = re.sub(r"</?font[^>]*>", "", t)
    t = re.sub(r"<br[^>]*>", BRK, t)
    t = re.sub(r"<i(?=[\s>])[^>]*>", EMPH, t).replace("</i>", GRP_C)
    t = re.sub(r"<b(?=[\s>])[^>]*>", BOLD, t).replace("</b>", GRP_C)
    t = re.sub(r"</?a[^>]*>", "", t)
    t = re.sub(r"<img[^>]*>", "", t)
    t = re.sub(r"</?span[^>]*>", "", t)
    # a line break directly before a group close belongs outside the group
    t = re.sub(BRK + r"\s*(" + GRP_C + "+)", r"\1" + BRK, t)
    return t


def blocks(t):
    """Block markup to sentinels."""
    # site-nav paragraphs
    t = re.sub(r"<p[^>]*>\s*(?:<a href=\"#top\">Top</a>\s*\|\s*)?"
               r"<a href=\"index.html\">Contents</a>.*?</p>", "", t, flags=re.S)
    t = re.sub(r"<p[^>]*>\s*<a href=\"#top\">Top</a>.*?</p>", "", t, flags=re.S)
    t = re.sub(r"<hr[^>]*>", "", t)
    t = re.sub(r"<h3[^>]*>(.*?)</h3>",
               lambda m: PAR + SECT + re.sub(r"\s+", " ", strip_tags(m.group(1))).strip() + GRP_C + PAR,
               t, flags=re.S)
    t = re.sub(r"<h4[^>]*>(.*?)</h4>",
               lambda m: PAR + UNIT + re.sub(r"\s+", " ", strip_tags(m.group(1))).strip() + GRP_C + PAR,
               t, flags=re.S)
    t = re.sub(r"<blockquote[^>]*>", PAR + QUO, t)
    t = re.sub(r"</blockquote>", QUC + PAR, t)
    t = re.sub(r"<p[^>]*>", PAR, t)
    t = t.replace("</p>", "")
    t = re.sub(r"</?(?:div|center|table|tr|td)[^>]*>", "", t)
    return t


def finalize(t):
    """Decode entities, strip page markers, escape TeX, restore sentinels."""
    t = htmlmod.unescape(t)
    t = t.replace(" ", " ")
    t = re.sub(r"\{(?:\d+|[ivxlc]+)\}\s*", "", t)   # 1878 page markers
    t = smart_quotes(t)
    t = "".join(TEX_SPECIALS.get(c, c) for c in t)
    t = re.sub(MAC_O + r"([a-zA-Z])", r"\\={\1}", t)
    for mark, tex in RESTORE:
        t = t.replace(mark, tex)
    t = re.sub(r"[ \t]+", " ", t)
    t = re.sub(r" ?\n ?", "\n", t)
    # a line break at paragraph end is a LaTeX error; the break is implied
    t = re.sub(r"\\\\\s*\n(\s*\n)+", "\n\n", t)
    return t


def parse_notes(notes_html):
    notes = {}
    for m in re.finditer(
            r"(\d+)\.\s*(.*?)<a href=\"#return\1\">(?:<br[^>]*>|\s)*Return to text",
            notes_html, flags=re.S):
        content = re.sub(r"(?:<br[^>]*>|\s)+$", "", m.group(2))
        notes[m.group(1)] = content.strip()
    return notes


def convert_file(path, heading):
    raw = open(path, "rb").read().decode("cp1252").replace("\r\n", "\n")

    pieces = []
    if heading != "SKIP":
        if heading is None:
            m = re.search(r"<h2>(.*?)</h2>", raw, flags=re.S)
            if not m:
                sys.exit(f"{path}: no h2 chapter heading found")
            heading = re.sub(r"\s+", " ", strip_tags(m.group(1))).strip()
        pieces.append(CHAP + heading + GRP_C)

    nm = re.search(r"<h3>(?:<[^>]+>)*<a name=\"note1\">.*", raw, flags=re.S)
    notes = parse_notes(nm.group(0)) if nm else {}

    start = re.search(r"<a href=\"index.html\">Contents</a>.*?</p>", raw, flags=re.S)
    body = raw[start.end() if start else 0:nm.start() if nm else len(raw)]
    body = re.split(r"<p align=\"left\"><font size=\"2\">Newman Reader",
                    body)[0]   # NR copyright footer

    tex = finalize(inline(blocks(body)))
    if pieces:
        tex = finalize(pieces[0]) + "\n\n" + tex

    used = set()

    def put_note(m):
        n = m.group(1)
        if n not in notes:
            sys.exit(f"{path}: reference to missing note {n}")
        used.add(n)
        content = re.sub(r"<p[^>]*>", PAR, notes[n]).replace("</p>", "")
        return "\\footnote{" + finalize(inline(content)).strip() + "}"
    tex = re.sub(FN_O + r"(\d+)" + FN_C, put_note, tex)
    unused = set(notes) - used
    if unused:
        print(f"  {path}: unreferenced notes dropped: "
              + ", ".join(sorted(unused, key=int)))

    tex = re.sub(r"\n{3,}", "\n\n", tex)
    return tex.strip()


def front_matter(path):
    """Dedication, Preface, Advertisement from index.html."""
    raw = open(path, "rb").read().decode("cp1252").replace("\r\n", "\n")
    m = re.search(r"<h3><a name=\"dedication\">.*?(?=<h3><a name=\"titlepage\">)",
                  raw, flags=re.S)
    if not m:
        sys.exit(f"{path}: front matter anchors not found")
    tex = finalize(inline(blocks(m.group(0))))
    tex = tex.replace(r"\devsection{", r"\devchapter{")
    return tex.strip()


def main():
    parts = [front_matter(f"{SRCDIR}/index.html")]
    for fname, heading in FILES:
        parts.append(convert_file(f"{SRCDIR}/{fname}", heading))
    body = "\n\n".join(parts) + "\n"
    leftovers = sorted(set(re.findall(r"<[a-zA-Z/][^>]*>", body)))
    if leftovers:
        print("WARNING leftover tags:", leftovers[:10])
    stray = sorted(set(re.findall(r"[-]", body)))
    if stray:
        print("WARNING stray sentinels:", [hex(ord(c)) for c in stray])
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(body)
    print(f"wrote {OUT}: {body.count(chr(92) + 'devchapter{')} chapters, "
          f"{body.count(chr(92) + 'devsection{')} sections, "
          f"{body.count(chr(92) + 'footnote{')} footnotes")


if __name__ == "__main__":
    main()
