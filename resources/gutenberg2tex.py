#!/usr/bin/env python3
"""Convert preserved Project Gutenberg HTML books to LaTeX bodies.

The third flat-HTML converter beside dr2tex.py and kjv2tex.py, for PG
books kept as our own editions. Reuses the dev2tex engine (the same
blocks/inline/finalize passes behind the NewmanReader corpus); PG files
are utf-8 with curly quotes already typeset, so the smart-quote pass is
skipped and the license apparatus is cut instead.

Per work (see WORKS): several sources may bind as one volume; chapters
come from <h1> (or <h2> promoted to it), a bare "Chapter N." h1 merging
with the title h1 that follows it; an end-of-book footnote list
(<dl class="...footnotes">) is inlined at its noteref anchors; page-
number spans, print indexes, Contents lists, and the PG license drop.

Run: python gutenberg2tex.py
"""
import re

from ccel2tex import _titlecase
from dev2tex import blocks, finalize, inline, strip_tags, FN_O, FN_C

# One dict per work. `srcs` may list several PG files bound as one
# volume (the Luther primary works); `firsts` gives each source's first
# content heading (PG header and boilerplate before it drop, matched by
# prefix). `htag` is the heading level that becomes a chapter (Gibbons
# uses h1 pairs, the rest put chapters at h2); `skips` names sentinel
# chapters to drop with their content (a Contents list, an Index).
WORKS = [
    dict(srcs=["gibbons-src.html"], out="gibbons-body.tex",
         firsts=["Dedication."], htag=1),
    dict(srcs=["jewel-src.html"], out="jewel-body.tex",
         firsts=["INTRODUCTION."], htag=2),
    dict(srcs=["suetonius-src.html"], out="suetonius-body.tex",
         firsts=["PREFACE"], htag=2, skips=["Index"]),
    dict(srcs=["ammianus-src.html"], out="ammianus-body.tex",
         firsts=["BOOK XIV"], htag=3, skips=["Index"]),
    dict(srcs=["theses-src.html", "liberty-src.html"],
         out="luther-primary-body.tex", htag=2,
         firsts=["DISPUTATION OF DOCTOR MARTIN LUTHER",
                 "LETTER OF MARTIN LUTHER TO POPE LEO X."],
         skips=["Contents"]),
]

_LICENSE = re.compile(
    r'\*{3}\s*END OF|START:\s*FULL LICENSE|End of (?:the )?Project Gutenberg|'
    r'<h[12][^>]*>\s*(?:<[^>]+>\s*)*THE FULL PROJECT GUTENBERG', re.I)


def prepare(src, first_heading, htag, key):
    """One PG file to sentinel-marked, engine-ready markup plus its
    footnote dict (keys prefixed with `key` so bound sources cannot
    collide)."""
    raw = open(src, encoding="utf-8", errors="replace").read()
    raw = raw.replace("\r\n", "\n")

    m = _LICENSE.search(raw)
    if m:
        raw = raw[:m.start()]

    raw = re.sub(r'<!--.*?-->', ' ', raw, flags=re.S)
    # print page numbers ride in their own spans; pure furniture
    raw = re.sub(r'<span[^>]*class="[^"]*pagenum[^"]*"[^>]*>.*?</span>',
                 '', raw, flags=re.S)
    # normalizations dev2tex doesn't know, before the notes are captured
    raw = re.sub(r'<em(?=[\s>])[^>]*>', '<i>', raw).replace('</em>', '</i>')
    raw = re.sub(r'<strong(?=[\s>])[^>]*>', '<b>', raw).replace('</strong>',
                                                                '</b>')
    for cp, rep in ((0x2009, ' '), (0x200A, ' '), (0x2007, ' '),
                    (0x2002, ' '), (0x2003, ' '), (0x00AD, '')):
        raw = raw.replace(chr(cp), rep)

    # the end-of-book footnote list, inlined at its in-text references
    notes = {}
    dl = re.search(r'<dl class="[^"]*footnotes[^"]*">(.*?)</dl>', raw, re.S)
    if dl:
        for dm in re.finditer(r'<dt[^>]*>.*?id="note_(\d+)".*?</dt>\s*'
                              r'<dd[^>]*>(.*?)</dd>', dl.group(1), re.S):
            notes[key + "x" + dm.group(1)] = dm.group(2)
        raw = raw[:dl.start()] + raw[dl.end():]
    raw = re.sub(r'<a[^>]*id="noteref_(\d+)"[^>]*>.*?</a>',
                 lambda m: FN_O + key + "x" + m.group(1) + FN_C, raw,
                 flags=re.S)

    raw = re.sub(r'</?(?:footer|header|section|nav|figure|figcaption|aside)'
                 r'[^>]*>', ' ', raw)
    raw = re.sub(r'<h5[^>]*>(.*?)</h5>', r'<h4>\1</h4>', raw, flags=re.S)
    raw = re.sub(r'</?pre[^>]*>', ' ', raw)
    raw = re.sub(r'</?(?:small|big)[^>]*>', '', raw)

    # the small comparative tables, linearized
    raw = re.sub(r'</td>\s*<td[^>]*>', ' — ', raw)
    raw = re.sub(r'</tr>\s*<tr[^>]*>', '<br>', raw)
    raw = re.sub(r'</?(?:table|tbody|thead|colgroup|col|tr|td|th|dl|dt|dd)'
                 r'[^>]*>', ' ', raw)

    if htag == 2:                        # chapters live at h2
        raw = re.sub(r'<h1[^>]*>.*?</h1>', '', raw, flags=re.S)
        raw = re.sub(r'<h2([^>]*)>', r'<h1\1>', raw)
        raw = raw.replace('</h2>', '</h1>')
    elif htag == 3:                      # chapters live at h3 (Ammianus)
        raw = re.sub(r'<h[12][^>]*>.*?</h[12]>', '', raw, flags=re.S)
        raw = re.sub(r'<h3([^>]*)>', r'<h1\1>', raw)
        raw = raw.replace('</h3>', '</h1>')

    # h1s to SOH/STX-fenced titles that ride through the engine as plain
    # text; a bare "Chapter N." h1 merges with the title h1 after it
    def h1_repl(m):
        t = re.sub(r'\s+', ' ', strip_tags(m.group(1))).strip()
        return "\n\n\x01" + t + "\x02\n\n"
    raw = re.sub(r'<h1[^>]*>(.*?)</h1>', h1_repl, raw, flags=re.S)
    raw = re.sub("\x01(Chapter [IVXLC]+\\.)\x02\\s*(?:<[^>]+>\\s*)*"
                 "\x01([^\x01\x02]*)\x02",
                 lambda m: "\x01" + m.group(1) + " " + m.group(2) + "\x02",
                 raw)

    # start at the named first content heading
    start = None
    for hm in re.finditer("\x01([^\x01\x02]*)\x02", raw):
        if hm.group(1).strip().startswith(first_heading):
            start = hm.start()
            break
    if start is None:
        raise SystemExit(f"{src}: first heading {first_heading!r} not found")
    return raw[start:], notes


def convert(srcs, out, firsts, htag=1, skips=()):
    pieces, notes = [], {}
    for k, (s, f) in enumerate(zip(srcs, firsts)):
        raw, nts = prepare(s, f, htag, str(k))
        notes.update(nts)
        pieces.append(raw)
    raw = "\n\n".join(pieces)

    # drop furniture chapters with their content: print indexes, the PG
    # footnote list's own heading, and any named skips (a Contents list)
    for name in ("Index", "Footnotes") + tuple(skips):
        raw = re.sub("\x01" + re.escape(name) + "\\.?\x02.*?(?=\x01|$)",
                     "", raw, flags=re.S)

    raw = re.sub(r'<h2[^>]*>(.*?)</h2>',
                 lambda m: "<h3>" + m.group(1) + "</h3>", raw, flags=re.S)
    # dev2tex.blocks maps <h3> -> \devsection and <h4> -> \devunit

    tex = finalize(inline(blocks(raw)))

    missing = []

    def put_note(m):
        n = m.group(1)
        if n not in notes:
            missing.append(n)
            return ""
        return ("\\footnote{"
                + finalize(inline(blocks(notes[n]))).strip() + "}")
    tex = re.sub(FN_O + r"([0-9x]+)" + FN_C, put_note, tex)
    if missing:
        print(f"  {out}: missing notes {missing[:8]}")

    def chapter(m):
        t = m.group(1).strip()
        if t.isupper():
            t = _titlecase(t)
        return "\\xchapter{" + t + "}"
    tex = re.sub("\x01\\s*([^\x01\x02]*?)\\s*\x02", chapter, tex, flags=re.S)
    tex = (tex.replace("\\devchapter{", "\\xchapter{")
              .replace("\\devsection{", "\\xsection{")
              .replace("\\devunit{", "\\xsubsection{"))
    tex = re.sub(r"\\xsection\{([A-Z][A-Z .,'’-]+)\}",
                 lambda m: "\\xsection{" + _titlecase(m.group(1)) + "}", tex)
    tex = re.sub(r'\n\n(?:\\\\\s*\n)+\n?', '\n\n', tex)
    tex = re.sub(r'(\\\\\s*)\[', r'\1{}[', tex)
    tex = re.sub(r'\n{3,}', '\n\n', tex).strip() + "\n"

    leftovers = sorted(set(re.findall(r'<[a-zA-Z/][^>]*>', tex)))
    with open(out, "w", encoding="utf-8") as f:
        f.write(tex)
    print(f"wrote {out}: {tex.count(chr(92) + 'xchapter{')} chapters, "
          f"{tex.count(chr(92) + 'xsection{')} sections, "
          f"{tex.count(chr(92) + 'footnote{')} footnotes"
          + (f"  LEFTOVER {leftovers[:6]}" if leftovers else ""))


def main():
    for w in WORKS:
        convert(**w)


if __name__ == "__main__":
    main()
