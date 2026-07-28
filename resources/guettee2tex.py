#!/usr/bin/env python3
"""Convert Guettée's The Papacy (orthodoxinfo.com re-typeset PDF,
preserved as docs-src/guettee_thepapacy.pdf) to a LaTeX body.

The PDF is born-digital, so pdftotext's text layer is exact. Chapters
are a lone roman numeral at a page top with the title in capitals on
the following lines (chapter I carries no title); the Editor's Preface,
the Author's Introduction, and the closing Biographical Notice are
named heads. The transcription carries the print's note *reference*
symbols but not the notes themselves, so the dangling daggers are
dropped (disclosed on the title page).

Run: python guettee2tex.py
"""
import re
import subprocess

from docs2tex import esc_tex

SRC = "docs-src/guettee_thepapacy.pdf"
OUT = "guettee-body.tex"

NAMED = ("EDITOR’S PREFACE", "EDITOR'S PREFACE", "AUTHOR’S INTRODUCTION",
         "AUTHOR'S INTRODUCTION", "BIOGRAPHICAL NOTICE OF THE AUTHOR")

ROMAN_TITLES = {
    "I": "",
    "II": "The Papal Authority Condemned by the Word of God",
    "III": "Of the Authority of the Bishops of Rome in the First Three "
           "Centuries",
    "IV": "Teachings of Various Church Fathers",
    "V": "Of the Authority of the Bishops of Rome During the Sixth, "
         "Seventh, and Eighth Centuries",
    "VI": "That the Papacy, by Her Novel and Ambitious Pretentions, Was "
          "the Cause of the Schism Between the Eastern and Western "
          "Churches",
    "VII": "The Papacy Which Caused the Division Has Perpetuated and "
           "Strengthened It by Innovations, and Made It a Schism",
}


def main():
    p = subprocess.run(["pdftotext", SRC, "-"], capture_output=True,
                       text=True)
    assert p.returncode == 0, p.stderr[:300]
    out = []
    order = ["I", "II", "III", "IV", "V", "VI", "VII"]
    nxt = 0                                  # chapters arrive in order
    for page in p.stdout.split("\f"):
        lines = page.split("\n")
        k = 0
        while k < len(lines):
            s = lines[k].strip()
            if re.fullmatch(r"\d{1,3}", s) or s in ("*", "∗"):
                k += 1                       # page number / orphan marker
                continue
            if s == "THE PAPACY." and out:   # the half-title page
                k += 1
                continue
            m = re.fullmatch(r"([IVX]{1,4})\.?", s)
            if m and nxt < len(order) and m.group(1) == order[nxt]:
                n = m.group(1)
                nxt += 1
                # consume following ALL-CAPS title lines
                k += 1
                caps = []
                while k < len(lines):
                    t = lines[k].strip()
                    if t and (t.isupper() or re.fullmatch(r"\(.*\)", t)):
                        caps.append(t)
                        k += 1
                    elif not t and not caps:
                        k += 1
                    else:
                        break
                title = ROMAN_TITLES[n] or " ".join(caps).title()
                head = ("Chapter %s." % n) + (" " + title if title else "")
                out.extend(["", "\x01" + head + "\x02", ""])
                continue
            hit = next((h for h in NAMED if s.startswith(h)), None)
            if hit:
                out.extend(["", "\x01" + s.title().replace("’S", "’s")
                            + "\x02", ""])
                k += 1
                continue
            out.append(lines[k])
            k += 1
        out.append("")
    text = "\n".join(out)
    # dangling note-reference symbols (this transcription has no notes)
    text = re.sub(r"[*∗†‡§¶‖]+", "", text)
    paras = [re.sub(r"\s+", " ", b).strip()
             for b in re.split(r"\n\s*\n", text) if b.strip()]
    tex_parts = []
    for b in paras:
        m = re.fullmatch("\x01(.*)\x02", b)
        if m:
            tex_parts.append("\\xchapter{%s}" % esc_tex(m.group(1)))
        else:
            tex_parts.append(esc_tex(b.replace("\x01", "").replace("\x02",
                                                                   "")))
    tex = "\n\n".join(tex_parts) + "\n"
    tex = re.sub(r"\n{3,}", "\n\n", tex)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(tex)
    print(f"wrote {OUT}: {tex.count(chr(92) + 'xchapter')} chapters, "
          f"{len(tex)} bytes")


if __name__ == "__main__":
    main()
