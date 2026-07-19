#!/usr/bin/env python3
"""Convert the NewmanReader scrape of On Consulting the Faithful in
Matters of Doctrine (Rambler, July 1859) to a LaTeX body.

Reads newman-consulting.html (raw scrape preserved), keeps the article
in full with its two notes inlined as footnotes, and writes
consulting-body.tex for \\input by consulting.tex. The site's own
navigation and its "Link: later version" pointer are dropped.

Reuses the conversion passes from dev2tex.py.

Run: python consulting2tex.py
"""
import re
import sys

from dev2tex import blocks, finalize, inline, parse_notes, FN_O, FN_C, PAR

SRC = "newman-consulting.html"
OUT = "consulting-body.tex"


def main():
    raw = open(SRC, "rb").read().decode("cp1252").replace("\r\n", "\n")

    nm = re.search(r"<h3>(?:<[^>]+>)*<a name=\"note1\">.*", raw, flags=re.S)
    if not nm:
        sys.exit("notes section not found")
    notes = parse_notes(nm.group(0))

    start = re.search(r"<p class=\"MsoNormal\">", raw)
    body = raw[start.start():nm.start()]
    # the site's pointer to the later Arians version, not part of the text
    body = re.sub(r"<p class=\"MsoNormal\">Link:.*?</p>", "", body, flags=re.S)
    # the h2 title is typeset by consulting.tex, not the body
    body = re.sub(r"<h2[^>]*>.*?</h2>", "", body, flags=re.S)

    tex = finalize(inline(blocks(body)))

    def put_note(m):
        n = m.group(1)
        if n not in notes:
            sys.exit(f"reference to missing note {n}")
        content = re.sub(r"<p[^>]*>", PAR, notes[n]).replace("</p>", "")
        return "\\footnote{" + finalize(inline(content)).strip() + "}"
    tex = re.sub(FN_O + r"(\d+)" + FN_C, put_note, tex)

    tex = re.sub(r"\n{3,}", "\n\n", tex).strip() + "\n"
    leftovers = sorted(set(re.findall(r"<[a-zA-Z/][^>]*>", tex)))
    if leftovers:
        print("WARNING leftover tags:", leftovers[:10])
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(tex)
    print(f"wrote {OUT}: {tex.count(chr(92) + 'footnote{')} footnotes")


if __name__ == "__main__":
    main()
