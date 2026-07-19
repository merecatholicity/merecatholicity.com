#!/usr/bin/env python3
"""Republish two Fish Eaters pages as mobile-friendly site pages.

Reads the raw scrapes in docs-src/, unwraps the layout tables, converts
the content with pandoc, keeps the article images (downloaded to the
site root), turns relative links absolute so they still point at Fish
Eaters, and wraps the result in the site template with the nav and an
attribution note. Content is unmodified except formatting.

- docs-src/fisheaters-mary.html   -> ../mary.html
- docs-src/fisheaters-rosary.html -> ../rosary.html

Run from resources/: python fisheaters2html.py
"""
import re
import subprocess

NAV = open("../nav.html").read().strip()

HEAD = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>TITLE | Mere Catholicity</title>
<link rel="icon" href="favicon.ico">
<link rel="stylesheet" href="style.css">
</head>
<body>
"""

FOOT = """
<footer>
&copy; merecatholicity.com
</footer>
</body>
</html>
"""

NOTE = """
<p class="canon">Republished with formatting changes only, and with
gratitude, from <a href="ORIG">Fish Eaters</a>.</p>
"""


def convert(src, out, title, h1, start_probe, end_probe, orig):
    h = open(f"docs-src/{src}", encoding="utf-8", errors="replace").read()
    i = h.find(start_probe)
    assert i > 0, start_probe
    j = h.find(end_probe, i)
    assert j > 0, end_probe
    frag = h[i:j]

    # drop scripts and decorative images, keep article images
    frag = re.sub(r"<script.*?</script>", "", frag, flags=re.S)
    frag = re.sub(r"<img[^>]*(?:DOT\.gif|THERE4\.gif|BLACKDOT\.gif|apologia\.gif)[^>]*>",
                  "", frag)
    # unwrap the layout tables and divs
    frag = re.sub(r"</?(?:table|tbody|tr|td|div|center)[^>]*>", "\n", frag)
    # relative links keep pointing at Fish Eaters
    frag = re.sub(r'href="(?!https?://|#|mailto:)([^"]+)"',
                  r'href="https://www.fisheaters.com/\1"', frag)

    p = subprocess.run(["pandoc", "-f", "html", "-t", "html5"],
                       input=frag, capture_output=True, text=True)
    assert p.returncode == 0, p.stderr[:400]
    body = p.stdout
    # pandoc leaves the old inline sizes on images; the site css handles it
    body = re.sub(r'<img([^>]*?) style="[^"]*"', r"<img\1", body)
    body = re.sub(r'<p align="center">', "<p>", body)

    html = HEAD.replace("TITLE", title) + NAV + "\n\n"
    html += f'<h1 class="home-title">{h1}</h1>\n'
    html += NOTE.replace("ORIG", orig)
    html += body
    html += NOTE.replace("ORIG", orig)
    html += FOOT
    open(f"../{out}", "w").write(html)
    print("wrote", out, len(html))


convert("fisheaters-mary.html", "mary.html",
        "Mary", "Mary",
        '<p align="center"> <img style="width: 750px; height: 497px;"',
        '<a\n href="responses.html">Defense of Catholicism</a>',
        "https://www.fisheaters.com/mary.html")

convert("fisheaters-rosary.html", "rosary.html",
        "The Rosary: Mary&rsquo;s Psalter", "The Rosary: Mary&rsquo;s Psalter",
        '<p align="center"> <img style="width: 900px; height: 1146px;"',
        'Back to',
        "https://www.fisheaters.com/rosary.html")
