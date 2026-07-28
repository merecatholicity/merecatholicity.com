#!/usr/bin/env python3
"""Convert Gibbon's Decline and Fall (Bury's edition) to LaTeX bodies.

Source: the Online Library of Liberty ePubs of J. B. Bury's edition of
The History of the Decline and Fall of the Roman Empire, 12 volumes
(gibbon-src/vol{1..12}.epub, unzipped beside them; each volume is one
large XHTML, the same OLL shape as the Hooker Works). Everything is
kept, including Bury's introduction, notes, and appendices -- his
apparatus is the reason this edition is hosted -- except the tables of
contents and lists of illustrations.

Same OLL machinery as hooker2tex: <div class="type-footnote note">
blocks inlined as \\footnotes at their <a class="footnote-link">
anchors, marginal dates dropped, and the Schaff-style Greek/Hebrew
endgame for Gibbon's learned notes.

Run: python gibbon2tex.py [vol ...]
"""
import re
import sys
import unicodedata

from dev2tex import blocks, finalize, inline, FN_O, FN_C
from docs2tex import esc_tex

FURNITURE = re.compile(
    r"^(THE WORKS OF EDWARD GIBBON|CONTENTS OF|LIST OF ILLUSTRATIONS)", re.I)


def prenorm(body):
    body = re.sub(r'<span class="type-margin">.*?</span>\s*</span>', " ",
                  body, flags=re.S)
    body = re.sub(r"<em(?=[\s>])[^>]*>", "<i>", body).replace("</em>",
                                                              "</i>")
    body = re.sub(r"<strong(?=[\s>])[^>]*>", "<b>", body).replace(
        "</strong>", "</b>")
    body = re.sub(r"</?(?:ul|ol|dl|dt|dd|table|tbody|tfoot|caption|oc|tr|td|th|"
                  r"colgroup|col|body|html)[^>]*>", " ", body)
    body = re.sub(r"<li[^>]*>", "<p>", body).replace("</li>", "")
    body = re.sub(r"</?(?:sub|sup|small)[^>]*>", "", body)
    return body


def convert_volume(v):
    raw = open(f"gibbon-src/vol{v}/Gibbon_0214-{v:02d}.html",
               encoding="utf-8", errors="replace").read()

    notes = {}

    def grab(m):
        body = re.sub(r"<a[^>]*>\s*\d+\s*</a>", "", m.group(2), count=1)
        notes[m.group(1)] = body
        return " "
    raw = re.sub(r'<div id="(lf0214[^"]*_footnote_nt[^"]*)" '
                 r'class="type-footnote note">(.*?)</div>', grab, raw,
                 flags=re.S)

    # chapters at every h2, minus the furniture
    h2s = []
    for m in re.finditer(r"<h2[^>]*>(.*?)</h2>", raw, re.S):
        t = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", m.group(1))).strip()
        t = t.replace("&#x2019;", "’").replace("&#x2014;", "—")
        t = re.sub(r"\d+$", "", t).strip()      # trailing note-ref digits
        h2s.append((m.start(), m.end(), t))
    parts = []
    for i, (s, e, t) in enumerate(h2s):
        if FURNITURE.match(t):
            continue
        end = h2s[i + 1][0] if i + 1 < len(h2s) else len(raw)
        body = prenorm(raw[e:end])
        body = re.sub(
            r'<a href="#(lf0214[^"]*_footnote_nt[^"]*)"[^>]*>\s*\d+\s*</a>',
            lambda m: FN_O + m.group(1) + FN_C, body)
        tex = finalize(inline(blocks(body)))

        def put_note(m):
            nid = m.group(1).replace("\\_", "_")
            content = notes.get(nid)
            if content is None:
                return ""
            content = prenorm(content)
            return ("\\footnote{"
                    + finalize(inline(blocks(content))).strip() + "}")
        tex = re.sub(FN_O + r"(lf0214[^\x0f]*?)" + FN_C, put_note, tex)
        tex = (tex.replace("\\devchapter{", "\\xsection{")
                  .replace("\\devsection{", "\\xsection{")
                  .replace("\\devunit{", "\\xsubsection{"))
        if t.isupper():
            from ccel2tex import _titlecase
            t = _titlecase(t)
        parts.append("\\xchapter{%s}\n\n%s" % (esc_tex(t), tex.strip()))
    return "\n\n".join(parts)


def endgame(body):
    # OLL sets a few Greek letters with lookalike Latin/symbol codepoints
    for a, b in (("ɩ", "ι"), ("ϒ", "Υ"), ("ȩ", "e"), ("ϲ", "σ"),
                 ("Ϲ", "Σ")):
        body = body.replace(a, b)
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
    from newman import _map_symbols
    from schaff import _SYMBOLS as SS
    body = _map_symbols(body)
    for a, b in SS.items():
        body = body.replace(a, b)
    return body


def main():
    vols = [int(x) for x in sys.argv[1:]] or list(range(1, 13))
    for v in vols:
        body = convert_volume(v)
        body = re.sub(r"\n{3,}", "\n\n", body) + "\n"
        body = endgame(body)
        body = body.replace("<oc>", " ")
        body = re.sub(r"(\\\\\s*)\[", r"\1{}[", body)
        out = f"gibbon{v}-body.tex"
        with open(out, "w", encoding="utf-8") as f:
            f.write(body)
        leftovers = sorted(set(re.findall(r"<[a-zA-Z/][^>]*>", body)))
        print(f"wrote {out}: {body.count(chr(92) + 'xchapter')} chapters, "
              f"{body.count(chr(92) + 'footnote')} footnotes, "
              f"{len(body) // 1024} KB"
              + (f"  LEFTOVER {leftovers[:6]}" if leftovers else ""))


if __name__ == "__main__":
    main()
