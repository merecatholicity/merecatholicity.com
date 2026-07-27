#!/usr/bin/env python3
"""Convert preserved Project Gutenberg HTML books to LaTeX bodies.

The third flat-HTML converter beside dr2tex.py and kjv2tex.py, for PG
books kept as our own editions. Reuses the dev2tex engine (the same
blocks/inline/finalize passes behind the NewmanReader corpus); PG files
are utf-8 with curly quotes already typeset, so the smart-quote pass is
skipped and the license apparatus is cut instead.

Structure handling per the WORKS table: consecutive <h1> pairs of the
form "Chapter N." + "Title" merge into one \\xchapter{Chapter N. Title};
a lone <h1> becomes a chapter on its own; <h2>/<h3> become
\\xsection/\\xsubsection. The PG boilerplate before the first content
heading and from the license block onward is dropped.

Run: python gutenberg2tex.py
"""
import re

from dev2tex import blocks, finalize, inline, strip_tags, FN_O, FN_C

# (src, out, first_heading) -- conversion starts at the <h1> whose text
# equals first_heading (the Contents list and PG header before it drop).
WORKS = [
    ("gibbons-src.html", "gibbons-body.tex", "Dedication."),
]

_LICENSE = re.compile(
    r'\*{3}\s*END OF|START:\s*FULL LICENSE|'
    r'<h[12][^>]*>\s*(?:<[^>]+>\s*)*THE FULL PROJECT GUTENBERG', re.I)


def convert(src, out, first_heading):
    raw = open(src, encoding="utf-8", errors="replace").read()
    raw = raw.replace("\r\n", "\n")

    m = _LICENSE.search(raw)
    if m:
        raw = raw[:m.start()]

    # normalizations dev2tex doesn't know, applied before the notes are
    # captured so they reach the footnotes too
    raw = re.sub(r'<em(?=[\s>])[^>]*>', '<i>', raw).replace('</em>', '</i>')
    raw = re.sub(r'<strong(?=[\s>])[^>]*>', '<b>', raw).replace('</strong>',
                                                                '</b>')
    for a, b in ((" ", " "), (" ", " "), (" ", " "),
                 (" ", " "), (" ", " "), ("­", "")):
        raw = raw.replace(a, b)

    # the end-of-book footnote list: <dl class="...footnotes"> of
    # <dt><a id="note_N">N.</a></dt><dd>text</dd>; inline each at its
    # in-text reference, Newman-style
    notes = {}
    dl = re.search(r'<dl class="[^"]*footnotes[^"]*">(.*?)</dl>', raw, re.S)
    if dl:
        for dm in re.finditer(r'<dt[^>]*>.*?id="note_(\d+)".*?</dt>\s*'
                              r'<dd[^>]*>(.*?)</dd>', dl.group(1), re.S):
            notes[dm.group(1)] = dm.group(2)
        raw = raw[:dl.start()] + raw[dl.end():]
    raw = re.sub(r'<a[^>]*id="noteref_(\d+)"[^>]*>.*?</a>',
                 lambda m: FN_O + m.group(1) + FN_C, raw, flags=re.S)

    # the small comparative tables, linearized (cells joined with an em
    # dash, one row per line)
    raw = re.sub(r'</td>\s*<td[^>]*>', ' — ', raw)
    raw = re.sub(r'</tr>\s*<tr[^>]*>', '<br>', raw)
    raw = re.sub(r'</?(?:table|tbody|thead|colgroup|col|tr|td|th|dl|dt|dd)'
                 r'[^>]*>', ' ', raw)

    # start at the named first heading
    start = None
    for h in re.finditer(r'<h1[^>]*>(.*?)</h1>', raw, re.S):
        if re.sub(r'\s+', ' ', strip_tags(h.group(1))).strip() == first_heading:
            start = h.start()
            break
    if start is None:
        raise SystemExit(f"{src}: first heading {first_heading!r} not found")
    raw = raw[start:]

    # h1s to SOH/STX-fenced titles that ride through the engine as plain
    # text (so their TeX specials get escaped), then become \xchapter
    # afterward. A bare "Chapter N." h1 merges with the title h1 that
    # follows it; any other h1 is a chapter of its own.
    def h1_repl(m):
        t = re.sub(r'\s+', ' ', strip_tags(m.group(1))).strip()
        return "\n\n\x01" + t + "\x02\n\n"
    raw = re.sub(r'<h1[^>]*>(.*?)</h1>', h1_repl, raw, flags=re.S)
    raw = re.sub("\x01(Chapter [IVXLC]+\\.)\x02\\s*(?:<[^>]+>\\s*)*"
                 "\x01([^\x01\x02]*)\x02",
                 lambda m: "\x01" + m.group(1) + " " + m.group(2) + "\x02",
                 raw)

    raw = re.sub(r'<h2[^>]*>(.*?)</h2>',
                 lambda m: "<h3>" + m.group(1) + "</h3>", raw, flags=re.S)
    # dev2tex.blocks maps <h3> -> \devsection and <h4> -> \devunit

    # a page-number index is print furniture: drop from its heading to
    # the next chapter heading (or the end)
    raw = re.sub("\x01Index\\.?\x02.*?(?=\x01|$)", "", raw, flags=re.S)
    raw = re.sub("\x01Footnotes?\\.?\x02.*?(?=\x01|$)", "", raw, flags=re.S)

    tex = finalize(inline(blocks(raw)))

    missing = []

    def put_note(m):
        n = m.group(1)
        if n not in notes:
            missing.append(n)
            return ""
        return ("\\footnote{"
                + finalize(inline(blocks(notes[n]))).strip() + "}")
    tex = re.sub(FN_O + r"(\d+)" + FN_C, put_note, tex)
    if missing:
        print(f"  {src}: missing notes {missing[:8]}")

    tex = re.sub("\x01\\s*([^\x01\x02]*?)\\s*\x02",
                 lambda m: "\\xchapter{" + m.group(1) + "}", tex, flags=re.S)
    tex = (tex.replace("\\devchapter{", "\\xchapter{")
              .replace("\\devsection{", "\\xsection{")
              .replace("\\devunit{", "\\xsubsection{"))
    tex = re.sub(r'\n{3,}', '\n\n', tex).strip() + "\n"

    leftovers = sorted(set(re.findall(r'<[a-zA-Z/][^>]*>', tex)))
    with open(out, "w", encoding="utf-8") as f:
        f.write(tex)
    print(f"wrote {out}: {tex.count(chr(92) + 'xchapter{')} chapters, "
          f"{tex.count(chr(92) + 'xsection{')} sections"
          + (f"  LEFTOVER {leftovers[:6]}" if leftovers else ""))


def main():
    for src, out, first in WORKS:
        convert(src, out, first)


if __name__ == "__main__":
    main()
