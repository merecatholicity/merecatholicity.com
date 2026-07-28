#!/usr/bin/env python3
"""Convert the Book of Concord (bookofconcord.org's Triglot English,
Bente-Dau 1921) to a LaTeX body.

The site is a Hugo build: one page per article/part, listed in reading
order by concord-src/boc-org-manifest.txt (family <tab> path, written
from the site's own nav). Each page's <main> carries the article as an
<h2> and numbered paragraphs whose Triglot paragraph numbers ride in
"bocanchor" spans; the numbers are kept as bold markers, the confessional
citation convention (AC I 2, Ap IV 48...). Each document family becomes
an \\xchapter, each page's h2 an \\xsection.

Run: python concord2tex.py   (sources fetched by concord-src fetch)
"""
import html as htmlmod
import os
import re

from dev2tex import blocks, finalize, inline
from docs2tex import esc_tex

SRC = "concord-src"
OUT = "concord-body.tex"

FAMILIES = {
    "preface": "Preface to the Christian Book of Concord",
    "ecumenical-creeds": "The Three Ecumenical Creeds",
    "augsburg-confession": "The Augsburg Confession",
    "defense": "The Apology of the Augsburg Confession",
    "smalcald-articles": "The Smalcald Articles",
    "power-and-primacy": "Treatise on the Power and Primacy of the Pope",
    "small-catechism": "The Small Catechism of Dr. Martin Luther",
    "large-catechism": "The Large Catechism of Dr. Martin Luther",
    "epitome": "The Formula of Concord: The Epitome",
    "solid-declaration": "The Formula of Concord: The Solid Declaration",
}


def page_body(path):
    raw = open(path, encoding="utf-8", errors="replace").read()
    m = re.search(r"<main>(.*?)</main>", raw, re.S)
    if not m:
        return None, None
    body = m.group(1)
    body = re.sub(r'<div class="next-previous-box">.*?</div>', "", body,
                  flags=re.S)
    hm = re.search(r"<h2[^>]*>(.*?)</h2>", body, re.S)
    title = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", hm.group(1))).strip() \
        if hm else None
    if hm:
        body = body[:hm.start()] + body[hm.end():]
    # Triglot paragraph numbers: keep as bold markers; drop the plain
    # anchor spans around them
    body = re.sub(r'<span[^>]*class="bocanchor-content"[^>]*>(\d+)</span>',
                  r"<b>\1</b>", body)
    body = re.sub(r'<span[^>]*class="bocanchor[^"]*"[^>]*>\s*</span>', "",
                  body)
    body = re.sub(r"<em(?=[\s>])[^>]*>", "<i>", body).replace("</em>", "</i>")
    body = re.sub(r"<strong(?=[\s>])[^>]*>", "<b>", body).replace("</strong>",
                                                                  "</b>")
    body = re.sub(r"</?(?:section|figure|figcaption|nav|aside|table|tbody|"
                  r"thead|tr|td|th|dl|dt|dd|ul|ol)[^>]*>", " ", body)
    body = re.sub(r"<li[^>]*>", "<p>", body).replace("</li>", "")
    # inner sub-heads (some pages carry several h2s): to engine levels
    body = re.sub(r"<h2[^>]*>", "<h3>", body).replace("</h2>", "</h3>")
    body = re.sub(r"<h5[^>]*>", "<h4>", body).replace("</h5>", "</h4>")
    return title, body


def main():
    rows = [ln.split("\t") for ln in
            open(os.path.join(SRC, "boc-org-manifest.txt")).read().split("\n")
            if "\t" in ln]
    parts, cur_fam, missing = [], None, []
    for fam, href in rows:
        slug = href.strip("/").replace("/", "__")
        path = os.path.join(SRC, "pages", slug + ".html")
        if not os.path.exists(path):
            missing.append(href)
            continue
        title, body = page_body(path)
        if body is None:
            missing.append(href)
            continue
        if fam != cur_fam:
            parts.append("\\xchapter{%s}" % FAMILIES[fam])
            cur_fam = fam
        tex = finalize(inline(blocks(body)))
        tex = (tex.replace("\\devchapter{", "\\xsection{")
                  .replace("\\devsection{", "\\xsection{")
                  .replace("\\devunit{", "\\xsubsection{"))
        if title:
            sec = "\\xsection{%s}" % esc_tex(htmlmod.unescape(title))
            tex = sec + "\n\n" + tex
        parts.append(tex.strip())
    body = "\n\n".join(p for p in parts if p) + "\n"
    body = re.sub(r"\n{3,}", "\n\n", body)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(body)
    leftovers = sorted(set(re.findall(r"<[a-zA-Z/][^>]*>", body)))
    print(f"wrote {OUT}: {body.count(chr(92) + 'xchapter')} chapters, "
          f"{body.count(chr(92) + 'xsection')} sections, "
          f"{len(body) // 1024} KB"
          + (f"  LEFTOVER {leftovers[:8]}" if leftovers else "")
          + (f"  MISSING {missing[:6]}" if missing else ""))


if __name__ == "__main__":
    main()
