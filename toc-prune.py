#!/usr/bin/env python3
"""Prune body subsections from book.html's TOC so it matches the PDF:
sections plus the afterword's subsections only. Token-targeted, id-based."""
import re

DROP_PREFIXES = ("toc-held-as", "toc-staked-by", "toc-tier-")

h = open("book.html").read()
i = h.find('<nav id="TOC')
j = h.find("</nav>", i)
toc = h[i:j]
toc = re.sub(
    r'<li><a href="[^"]*"\s+id="(toc-[^"]*)"[^>]*>(?:(?!</a>).)*</a></li>\s*',
    lambda m: "" if m.group(1).startswith(DROP_PREFIXES) else m.group(0),
    toc, flags=re.S)
toc = re.sub(r"<ul>\s*</ul>", "", toc)
open("book.html", "w").write(h[:i] + toc + h[j:])
print("toc pruned")
