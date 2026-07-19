#!/usr/bin/env python3
"""Build the site HTML edition of The Bishop of Rome (2024) from the
official PDF, mirrored at the site root as The_Bishop_of_Rome.pdf.

The document has no footnotes, citing inline, so the conversion is
text extraction, page-furniture removal, paragraph rejoining, and
heading detection from the document's own numbering. Content is
unmodified except formatting.

Run from resources/: python bor2html.py
"""
import re
import subprocess

subprocess.run(["pdftotext", "../The_Bishop_of_Rome.pdf", "docs-src/bor.txt"],
               check=True, capture_output=True)
raw = open("docs-src/bor.txt", encoding="utf-8").read()
pages = raw.split("\f")

start = next(i for i, p in enumerate(pages) if p.strip().startswith("PREFACE"))
lines = []
for p in pages[start:]:
    ls = [l.rstrip() for l in p.split("\n")]
    while ls and not ls[-1].strip():
        ls.pop()
    if ls and re.fullmatch(r"\d+", ls[-1].strip()):
        ls.pop()
    lines.extend(ls)
    lines.append("")

ALLCAPS = r"[A-Z][A-Z ,–’':&.-]*"
H2_WORDS = {"PREFACE", "INTRODUCTION", "CONCLUSION", "ABBREVIATIONS"}


def is_h2_start(s):
    return (s in H2_WORDS
            or re.fullmatch(r"\d+\. " + ALLCAPS, s) is not None)


def is_allcaps(s):
    return re.fullmatch(ALLCAPS, s) is not None and len(s) > 3


out = []
i = 0
abbrev_mode = False

# main pass: headings split out line-wise, paragraphs joined between
# blank lines
buf = []


def flush_par():
    if buf:
        text = " ".join(x.strip() for x in buf if x.strip())
        if text:
            out.append(("p", text))
        buf.clear()


while i < len(lines):
    s = lines[i].strip()
    if abbrev_mode:
        i += 1
        continue
    if not s:
        flush_par()
        i += 1
        continue
    prev_done = not buf or buf[-1].strip().endswith((".", "\u201d", ")", "?", "!", ":"))
    if is_h2_start(s) and prev_done:
        head = s
        # numbered part heads may wrap onto further all-caps lines
        j = i + 1
        if s not in H2_WORDS:
            while j < len(lines) and is_allcaps(lines[j].strip()):
                head += " " + lines[j].strip()
                j += 1
        flush_par()
        out.append(("h2", head))
        if s == "ABBREVIATIONS":
            abbrev_start = j
            abbrev_mode = True
        i = j
        continue
    m = re.match(r"^(\d+\.\d+(?:\.\d+)?)\. \S", s)
    if m and prev_done:
        head = s
        j = i + 1
        # a wrapped sub-heading continues on a short next line that
        # does not itself start a paragraph or heading
        while (j < len(lines) and lines[j].strip()
               and not head.endswith((".", "”", ")", "?"))
               and not re.match(r"^\d", lines[j].strip())
               and len(lines[j].strip()) < 60):
            head += " " + lines[j].strip()
            j += 1
        level = "h4" if head.count(".", 0, 8) >= 3 else "h3"
        flush_par()
        out.append((level, head))
        i = j
        continue
    buf.append(s)
    i += 1
flush_par()

# abbreviations: blank-separated blocks alternate short codes and their
# expansions
if abbrev_mode:
    blocks = []
    cur = []
    for l in lines[abbrev_start:]:
        if l.strip():
            cur.append(l.strip())
        elif cur:
            blocks.append(" ".join(cur))
            cur = []
    if cur:
        blocks.append(" ".join(cur))
    k = 0
    while k < len(blocks):
        code = blocks[k]
        expansion = blocks[k + 1] if k + 1 < len(blocks) else ""
        out.append(("abbr", (code, expansion)))
        k += 2


def esc(t):
    return t.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


rendered = []
for kind, val in out:
    if kind == "abbr":
        code, exp = val
        rendered.append(f"<p><strong>{esc(code)}</strong><br>{esc(exp)}</p>")
    else:
        rendered.append(f"<{kind}>{esc(val)}</{kind}>")

NAV = open("../nav.html").read().strip()
NOTE = """<p class="canon">A study document of the Dicastery for Promoting
Christian Unity, 2024. Republished with formatting changes only. The
original is at
<a href="https://www.christianunity.va/content/dam/unitacristiani/Collana_Ut_unum_sint/The_Bishop_of_Rome/The%20Bishop%20of%20Rome.pdf">christianunity.va</a>,
and the official PDF is mirrored
<a href="The_Bishop_of_Rome.pdf">here</a>.</p>"""

html = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>The Bishop of Rome | Mere Catholicity</title>
<link rel="icon" href="favicon.ico">
<link rel="stylesheet" href="style.css">
</head>
<body>
""" + NAV + """

<h1 class="home-title">The Bishop of Rome</h1>
<p class="canon">Primacy and synodality in the ecumenical dialogues and in
the responses to the encyclical Ut unum sint.</p>
""" + NOTE + "\n\n" + "\n\n".join(rendered) + "\n\n" + NOTE + """

<footer>
&copy; merecatholicity.com
</footer>
</body>
</html>
"""
open("../bishop-of-rome.html", "w").write(html)
h2 = sum(1 for k, _ in out if k == "h2")
h3 = sum(1 for k, _ in out if k == "h3")
h4 = sum(1 for k, _ in out if k == "h4")
ab = sum(1 for k, _ in out if k == "abbr")
print(f"wrote bishop-of-rome.html: {len(out)} blocks, {h2} h2, {h3} h3, {h4} h4, {ab} abbrevs")
