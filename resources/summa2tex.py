#!/usr/bin/env python3
"""Convert the New Advent scrape of the Treatise on Law (Summa
Theologiae I-II, qq. 90-108) to a LaTeX body.

Reads summa-law/2090.htm through 2108.htm (raw scrape preserved),
arranges the questions under the treatise's six divisions, and writes
law-body.tex for \\input by law.tex. Site chrome, ads, and hyperlinks
are dropped; the text keeps each question's points-of-inquiry list and
every article in full.

Reuses the conversion passes from dev2tex.py.

Run: python summa2tex.py
"""
import re
import sys

from dev2tex import blocks, finalize, inline, PAR

SRCDIR = "summa-law"
OUT = "law-body.tex"

# local sentinels, outside dev2tex's range
ART_O, ART_C = "", ""
OL_O, OL_C, LI = "", "", ""
UL_O, UL_C = "", ""

# Part divisions, inserted before the named question.
PARTS = {
    2090: ("General",
           "The essence (90), various kinds (91), and effects (92) of law."),
    2093: ("The Eternal Law", "The eternal law (93)."),
    2094: ("The Natural Law", "The natural law (94)."),
    2095: ("Human Law",
           "Human law (95) and its power (96) and mutability (97)."),
    2098: ("The Old Law",
           "The old law (98) and its precepts (99): moral (100), ceremonial "
           "(101) and judicial (104). The causes (102) and duration (103) of "
           "the ceremonial precepts. The reason (105) for the judicial "
           "precepts."),
    2106: ("The New Law",
           "The law of the Gospel (106) or new law and its comparison with "
           "the old (107). What (108) the new law contains."),
}


def convert_question(path):
    raw = open(path, "rb").read().decode("utf-8", errors="replace")
    m = re.search(r"<h1>(.*?)</h1>(.*?)<div class='catholicadnet-728x90' "
                  r"id='summa-728x90-bottom'", raw, flags=re.S)
    if not m:
        sys.exit(f"{path}: content region not found")
    title = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", m.group(1))).strip()
    body = m.group(2)

    # articles and the points-of-inquiry list
    body = re.sub(r"<h2[^>]*>(.*?)</h2>",
                  lambda h: PAR + ART_O
                  + re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", h.group(1))).strip()
                  + ART_C + PAR,
                  body, flags=re.S)
    body = re.sub(r"<ol>", PAR + OL_O, body)
    body = re.sub(r"</ol>", OL_C + PAR, body)
    body = re.sub(r"<ul>", PAR + UL_O, body)
    body = re.sub(r"</ul>", UL_C + PAR, body)
    body = re.sub(r"<li[^>]*>", LI, body)
    body = re.sub(r"</li>", "", body)
    body = body.replace("<strong>", "<b>").replace("</strong>", "</b>")
    body = body.replace("<em>", "<i>").replace("</em>", "</i>")

    tex = finalize(inline(blocks(body)))
    tex = tex.replace(ART_O, r"\lawarticle{").replace(ART_C, "}")
    tex = tex.replace(OL_O, "\\begin{enumerate}\n")
    tex = tex.replace(OL_C, "\n\\end{enumerate}")
    tex = tex.replace(UL_O, "\\begin{itemize}\n")
    tex = tex.replace(UL_C, "\n\\end{itemize}")
    tex = tex.replace(LI, "\n\\item ")
    tex = re.sub(r"\n{3,}", "\n\n", tex).strip()
    return "\\lawquestion{" + finalize(title) + "}\n\n" + tex


def main():
    parts = []
    for n in range(2090, 2109):
        if n in PARTS:
            head, summary = PARTS[n]
            parts.append("\\lawpart{%s}\n\n\\lawsummary{%s}" % (head, summary))
        parts.append(convert_question(f"{SRCDIR}/{n}.htm"))
    body = "\n\n".join(parts) + "\n"
    leftovers = sorted(set(re.findall(r"<[a-zA-Z/][^>]*>", body)))
    if leftovers:
        print("WARNING leftover tags:", leftovers[:10])
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(body)
    print(f"wrote {OUT}: {body.count(chr(92) + 'lawpart{')} parts, "
          f"{body.count(chr(92) + 'lawquestion{')} questions, "
          f"{body.count(chr(92) + 'lawarticle{')} articles")


if __name__ == "__main__":
    main()
