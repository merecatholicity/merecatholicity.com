#!/usr/bin/env python3
"""Convert the LacusCurtius transcriptions (Bill Thayer's site) to
LaTeX bodies: Cassius Dio's Roman History (Cary's Loeb translation,
1914-27) and J. B. Bury's History of the Later Roman Empire (1923).

Sources in thayer-src/dio/<book>.html and thayer-src/burlat/<part>.html
(fetch URLs in the fetch script of the session log; pages named
"N*.html" on the site). Thayer's pages are uppercase-tag HTML: the
Loeb/author text flows in <p>s, editor's notes sit in a CLASS="endnotes"
block as <A CLASS="note" ID="noteN"> runs referenced by
<A CLASS="ref" ID="refN"> anchors (the JavaScript is only the hover),
and Dio's chapter.section citation numbers ride in <A CLASS="sec">
anchors, kept here as bold markers. Greek is UTF-8 polytonic, wrapped
for LGR like the Schaff volumes.

The Roman History is published in three site volumes along the text's
own survival: the fragments (Books I-XXXV), the full books
(XXXVI-LX), and the epitomes (LXI-LXXX).

Run: python thayer2tex.py
"""
import os
import re
import unicodedata

from dev2tex import blocks, finalize, inline, FN_O, FN_C
from docs2tex import esc_tex

ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X",
         "XI", "XII", "XIII", "XIV", "XV", "XVI", "XVII", "XVIII", "XIX",
         "XX", "XXI", "XXII", "XXIII", "XXIV", "XXV", "XXVI", "XXVII",
         "XXVIII", "XXIX", "XXX", "XXXI", "XXXII", "XXXIII", "XXXIV",
         "XXXV", "XXXVI", "XXXVII", "XXXVIII", "XXXIX", "XL", "XLI",
         "XLII", "XLIII", "XLIV", "XLV", "XLVI", "XLVII", "XLVIII",
         "XLIX", "L", "LI", "LII", "LIII", "LIV", "LV", "LVI", "LVII",
         "LVIII", "LIX", "LX", "LXI", "LXII", "LXIII", "LXIV", "LXV",
         "LXVI", "LXVII", "LXVIII", "LXIX", "LXX", "LXXI", "LXXII",
         "LXXIII", "LXXIV", "LXXV", "LXXVI", "LXXVII", "LXXVIII",
         "LXXIX", "LXXX"]


def page(path, key):
    """One Thayer page -> (engine-ready body html, notes dict)."""
    raw = open(path, encoding="utf-8", errors="replace").read()
    h = re.search(r"</head\s*>", raw, re.I)
    raw = raw[h.end():] if h else raw
    raw = re.sub(r"<(/?)([A-Za-z]+)([^>]*)>",
                 lambda m: "<" + m.group(1) + m.group(2).lower()
                 + m.group(3) + ">", raw)
    raw = re.sub(r"<script.*?</script>", " ", raw, flags=re.S | re.I)
    # Thayer's hover inserts (metric conversions, slips) carry quoted
    # ">" inside attributes; unwrap them to their visible text before
    # any naive tag handling
    raw = re.sub(r"(?is)<ins\b(?:[^>\"']|\"[^\"]*\"|'[^']*')*>(.*?)</ins>",
                 r"\1", raw)
    raw = re.sub(r"<!--.*?-->", " ", raw, flags=re.S)

    # the endnotes block: <a class="note" id="noteN">N</a> text ...
    notes = {}
    em = re.search(r'(?i)<hr class="endnotes">(.*)', raw, re.S)
    if em:
        zone = em.group(1)
        raw = raw[:em.start()]
        # the page footer (search form, credits) follows the notes
        zone = re.split(r"(?i)<form\b|<hr\b|Page updated", zone)[0]
        bits = re.split(r'(?i)<a class="note" id="note(\w+)"[^>]*>\s*\w+\s*</a>',
                        zone)
        for i in range(1, len(bits) - 1, 2):
            body = bits[i + 1]
            body = re.sub(r"<h2[^>]*>.*?</h2>", " ", body, flags=re.S)
            body = re.sub(r"(?is)<a\b(?:[^>\"']|\"[^\"]*\"|'[^']*')*>",
                          " ", body)
            body = re.sub(r"(?i)</a>", " ", body)
            notes[key + "x" + bits[i]] = body
    raw = re.sub(r'(?i)<a class="ref" id="ref(\w+)"[^>]*>\s*\w+\s*</a>',
                 lambda m: FN_O + key + "x" + m.group(1) + FN_C, raw)

    # Dio's chapter.section anchors become bold citation numbers
    raw = re.sub(r'(?i)<a class="sec" name="[\d.]+"[^>]*>\s*(\d+)\s*</a>',
                 r"<b>\1</b>", raw)
    # Thayer's dictionary-lookup anchors build their hrefs in JS and can
    # carry ">" inside quoted attributes; strip all remaining <a> tags
    # with a quote-aware matcher, keeping their visible text
    raw = re.sub(r"(?is)<a\b(?:[^>\"']|\"[^\"]*\"|'[^']*')*>", " ", raw)
    raw = re.sub(r"(?i)</a>", " ", raw)
    raw = re.sub(r"<table.*?</table>", " ", raw, flags=re.S)
    raw = re.sub(r"<h[12][^>]*>.*?</h[12]>", " ", raw, flags=re.S)
    raw = re.sub(r"<h[345][^>]*>", "<h4>", raw)
    raw = re.sub(r"</h[345]>", "</h4>", raw)
    raw = re.sub(r"<em(?=[\s>])[^>]*>", "<i>", raw).replace("</em>", "</i>")
    raw = re.sub(r"<strong(?=[\s>])[^>]*>", "<b>", raw).replace("</strong>",
                                                                "</b>")
    raw = re.sub(r"</?(?:span|div|ul|ol|dl|dt|dd|sub|sup|small|form|input|"
                 r"img|hr|center|font|body|html)[^>]*>", " ", raw)
    raw = re.sub(r"<li[^>]*>", "<p>", raw).replace("</li>", "")
    raw = re.sub(r"(?i)</?(?:span|form|input|body|html)[^>]*>", " ", raw)
    return raw, notes


def endgame(body):
    for a, b in (("ɩ", "ι"), ("ϲ", "σ"), ("Ϲ", "Σ"), ("ϒ", "Υ")):
        body = body.replace(a, b)
    body = re.sub("[\U0001F000-\U0001FAFF\u2600-\u27BF\uFE0F]", "", body)
    body = body.replace("̑", "͂")
    body = unicodedata.normalize("NFC", body)
    body = "".join(c for c in body if not 0x0300 <= ord(c) <= 0x036F)

    def wrap(rx, macro, s):
        def repl(m):
            core = m.group(0).rstrip(" \t.,;:·'’”)")
            tail = m.group(0)[len(core):]
            return "\\%s{%s}%s" % (macro, core, tail)
        return re.sub(rx, repl, s)
    body = wrap(r"[Ͱ-Ͽἀ-῿][Ͱ-Ͽἀ-῿\s.,;:·'’]*", "textgreek", body)
    body = wrap(r"[֐-׿יִ-ﭏ][֐-׿יִ-ﭏ\s]*", "texthebrew", body)
    from newman import _map_symbols, _cap_quotes, _heal_emphasis
    from schaff import _SYMBOLS as SS
    body = _heal_emphasis(body)
    body = _cap_quotes(body)
    body = _map_symbols(body)
    for a, b in SS.items():
        body = body.replace(a, b)
    body = re.sub(r"(\\\\\s*)\[", r"\1{}[", body)
    return body


def build(chapters, out):
    """chapters: list of (title, path, key). Notes inlined per page."""
    parts = []
    for title, path, key in chapters:
        if not os.path.exists(path):
            print(f"  missing {path}")
            continue
        body, notes = page(path, key)
        tex = finalize(inline(blocks(body)))

        def put_note(m):
            nid = m.group(1).replace("\\_", "_")
            content = notes.get(nid)
            if content is None:
                return ""
            return ("\\footnote{"
                    + finalize(inline(blocks(content))).strip() + "}")
        tex = re.sub(FN_O + r"([0-9A-Za-z_x\\]+?)" + FN_C, put_note, tex)
        tex = (tex.replace("\\devchapter{", "\\xsection{")
                  .replace("\\devsection{", "\\xsection{")
                  .replace("\\devunit{", "\\xsubsection{"))
        parts.append("\\xchapter{%s}\n\n%s" % (esc_tex(title), tex.strip()))
    body = "\n\n".join(parts) + "\n"
    body = re.sub(r"\n{3,}", "\n\n", body)
    body = endgame(body)
    with open(out, "w", encoding="utf-8") as f:
        f.write(body)
    left = sorted(set(re.findall(r"<[a-zA-Z/][^>]*>", body)))
    print(f"wrote {out}: {body.count(chr(92) + 'xchapter')} chapters, "
          f"{body.count(chr(92) + 'footnote')} footnotes, "
          f"{len(body) // 1024} KB"
          + (f"  LEFTOVER {left[:6]}" if left else ""))


def dio_books():
    files = sorted((int(f[:-5]) for f in os.listdir("thayer-src/dio")
                    if f[:-5].isdigit()))
    return files


def main():
    files = dio_books()
    groups = [("dio1", [b for b in files if b <= 35]),
              ("dio2", [b for b in files if 36 <= b <= 60]),
              ("dio3", [b for b in files if b >= 61])]
    for out_id, books in groups:
        chapters = [("Book %s" % ROMAN[b],
                     f"thayer-src/dio/{b}.html", "d%d" % b) for b in books]
        build(chapters, f"{out_id}-body.tex")

    # Bury LRE: chapters 1-24, split parts merged in order
    order = ["1", "2", "3", "4", "5A", "5B", "5C", "6", "7", "8", "9",
             "10", "11", "12", "13A", "13B", "13_Appendix", "14", "15A",
             "15B", "15C", "16", "17", "18A", "18B", "18C", "18D", "18E",
             "19A", "19B", "19C", "19D", "20", "21", "22", "23", "24"]
    chapters = []
    for p in order:
        n = re.match(r"\d+", p).group(0)
        if p == n:                       # a whole chapter in one file
            title = "Chapter %s" % ROMAN[int(n)]
        elif p.endswith("Appendix"):
            title = "Chapter %s, Appendix" % ROMAN[int(n)]
        else:
            title = "Chapter %s, Part %s" % (ROMAN[int(n)], p[len(n):])
        chapters.append((title, f"thayer-src/burlat/{p}.html", "b" + p))
    build(chapters, "burlat-body.tex")


if __name__ == "__main__":
    main()
