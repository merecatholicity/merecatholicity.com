#!/usr/bin/env python3
"""Convert Hooker's Of the Laws of Ecclesiastical Polity to a LaTeX body.

Source: the Online Library of Liberty ePubs of Keble's Works of Richard
Hooker (hooker-src/vol{1,2,3}.epub, unzipped beside them; each volume is
one large XHTML file). The Laws entire is kept -- Hooker's To the
Reader, the Preface, the argument of the whole, and Books I-VIII with
the Book V dedication -- while Keble's editorial apparatus, Walton's
Life, the appendices, and the sermons are left aside.

OLL markup handled here: footnotes are <div class="type-footnote note">
blocks referenced by <a class="footnote-link"> anchors (inlined as real
\\footnotes at their reference points); Keble's marginal summaries ride
in <span class="type-margin"> and are dropped; argument lists are <ul>
runs. Chapter boundaries are the volume h2 headings, mapped by hand in
VOL_PLANS with the print's full book titles restored.

Run: python hooker2tex.py
"""
import re

from dev2tex import blocks, finalize, inline, FN_O, FN_C
from docs2tex import esc_tex

OUT = "hooker-body.tex"

BOOK_TITLES = {
    "I": "Concerning Laws and Their Several Kinds in General",
    "II": "Concerning Their First Position Who Urge Reformation in the "
          "Church of England: Namely, That Scripture is the Only Rule of "
          "All Things Which in This Life May Be Done by Men",
    "III": "Concerning Their Second Assertion, That in Scripture There "
           "Must Be of Necessity Contained a Form of Church Polity, the "
           "Laws Whereof May in No Wise Be Altered",
    "IV": "Concerning Their Third Assertion, That Our Form of Church "
          "Polity is Corrupted with Popish Orders, Rites, and Ceremonies",
    "V": "Of Their Fourth Assertion, That Touching the Several Public "
         "Duties of Christian Religion, There is Amongst Us Much "
         "Superstition Retained in Them",
    "VI": "Containing Their Fifth Assertion, That Our Laws Are Corrupt "
          "in the Matter of Jurisdiction Ecclesiastical",
    "VII": "Their Sixth Assertion, That There Ought Not to Be in the "
           "Church, Bishops",
    "VIII": "Their Seventh Assertion, That unto No Civil Prince or "
            "Governor There May Be Given Such Power of Ecclesiastical "
            "Dominion as Belongeth unto the Supreme Regent Thereof",
}

# per volume: (start-h2 prefix, end-h2 prefix or None) slices, and the
# chapter map of h2-title prefix -> display title within them
VOL_PLANS = {
    1: dict(
        slices=[("TO THE READER", None)],
        chapters=[
            ("TO THE READER", "To the Reader"),
            ("A PREFACE", "A Preface to Them That Seek (As They Term It) "
                          "the Reformation of Laws and Orders "
                          "Ecclesiastical in the Church of England"),
            ("What Things are handled",
             "What Things Are Handled in the Books Following"),
            ("THE FIRST BOOK", "Book I. " + BOOK_TITLES["I"]),
            ("THE SECOND BOOK", "Book II. " + BOOK_TITLES["II"]),
            ("THE THIRD BOOK", "Book III. " + BOOK_TITLES["III"]),
            ("THE FOURTH BOOK", "Book IV. " + BOOK_TITLES["IV"]),
        ],
        furniture=["OF THE LAWS OF ECCLESIASTICAL POLITY"]),
    2: dict(
        slices=[("TO THE MOST REVEREND", "APPENDIX TO BOOK V")],
        chapters=[
            ("TO THE MOST REVEREND", "The Epistle Dedicatory of Book V, "
                                     "to the Lord Archbishop of "
                                     "Canterbury"),
            ("THE FIFTH BOOK", "Book V. " + BOOK_TITLES["V"]),
        ],
        furniture=["OF THE LAWS OF ECCLESIASTICAL POLITY"]),
    3: dict(
        slices=[("BOOK VI.", "APPENDIX TO BOOK VI"),
                ("BOOK VII.", "APPENDIX, No. I")],
        chapters=[
            ("BOOK VI.", "Book VI. " + BOOK_TITLES["VI"]),
            ("BOOK VII.", "Book VII. " + BOOK_TITLES["VII"]),
            ("BOOK VIII.", "Book VIII. " + BOOK_TITLES["VIII"]),
        ],
        furniture=["OF THE LAWS OF ECCLESIASTICAL POLITY"]),
}


def h2_map(raw):
    out = []
    for m in re.finditer(r"<h2[^>]*>(.*?)</h2>", raw, re.S):
        t = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", m.group(1))).strip()
        t = t.replace("&#x2019;", "’").replace("&#x2014;", "—")
        out.append((m.start(), m.end(), t))
    return out


def convert_volume(v):
    raw = open(f"hooker-src/vol{v}/Hooker_0172-0{v}.html",
               encoding="utf-8", errors="replace").read()
    plan = VOL_PLANS[v]
    h2s = h2_map(raw)

    def find(prefix, frm=0):
        for s, e, t in h2s:
            if s >= frm and t.upper().startswith(prefix.upper()):
                return s, e, t
        return None

    # collect the footnotes of the whole volume, then remove their divs
    notes = {}
    def grab(m):
        nid = m.group(1)
        body = m.group(2)
        body = re.sub(r"<a[^>]*>\s*\d+\s*</a>", "", body, count=1)
        notes[nid] = body
        return " "
    raw2 = re.sub(r'<div id="(lf0172[^"]*_footnote_nt_[^"]*)" '
                  r'class="type-footnote note">(.*?)</div>', grab, raw,
                  flags=re.S)

    # re-locate the h2 map on the note-stripped text
    h2s = h2_map(raw2)

    chapters_out = []
    for start_pre, end_pre in plan["slices"]:
        s = find(start_pre)
        assert s, (v, start_pre)
        e = find(end_pre, s[1]) if end_pre else None
        seg = raw2[s[0]: e[0] if e else len(raw2)]

        # chapter boundaries inside the slice
        bounds = []
        for pre, title in plan["chapters"]:
            m = re.search(r"<h2[^>]*>", seg)
            pos = None
            for mm in re.finditer(r"<h2[^>]*>(.*?)</h2>", seg, re.S):
                t = re.sub(r"\s+", " ",
                           re.sub(r"<[^>]+>", "", mm.group(1))).strip()
                if t.upper().startswith(pre.upper()):
                    pos = (mm.start(), mm.end())
                    break
            if pos:
                bounds.append((pos[0], pos[1], title))
        bounds.sort()
        for i, (bs, be, title) in enumerate(bounds):
            bend = bounds[i + 1][0] if i + 1 < len(bounds) else len(seg)
            body = seg[be:bend]
            # furniture h2s inside a chapter drop with their heading only
            body = re.sub(r"<h2[^>]*>.*?</h2>", " ", body, flags=re.S)
            chapters_out.append((title, body))
    return chapters_out, notes


def prenorm(body):
    body = re.sub(r'<span class="type-margin">.*?</span>\s*</span>', " ",
                  body, flags=re.S)
    body = re.sub(r"<em(?=[\s>])[^>]*>", "<i>", body).replace("</em>",
                                                              "</i>")
    body = re.sub(r"<strong(?=[\s>])[^>]*>", "<b>", body).replace(
        "</strong>", "</b>")
    body = re.sub(r"</?(?:ul|ol|dl|dt|dd|table|tbody|tr|td|th)[^>]*>", " ",
                  body)
    body = re.sub(r"<li[^>]*>", "<p>", body).replace("</li>", "")
    body = re.sub(r"<h3[^>]*>", "<h3>", body)
    body = re.sub(r"<h4[^>]*>", "<h4>", body)
    body = re.sub(r"</?(?:sub|sup|small|body|html|colgroup|col)[^>]*>", "", body)
    return body


def main():
    parts = []
    all_notes = {}
    keyed = []
    for v in (1, 2, 3):
        chapters, notes = convert_volume(v)
        all_notes.update(notes)
        keyed.extend(chapters)

    for title, body in keyed:
        body = prenorm(body)
        # in-text references to the collected notes -> FN sentinels
        body = re.sub(
            r'<a href="#(lf0172[^"]*_footnote_nt_[^"]*)"[^>]*>\s*\d+\s*</a>',
            lambda m: FN_O + m.group(1) + FN_C, body)
        tex = finalize(inline(blocks(body)))

        def put_note(m):
            # finalize TeX-escaped the underscores riding in the sentinel
            nid = m.group(1).replace("\\_", "_")
            content = all_notes.get(nid)
            if content is None:
                return ""
            content = prenorm(content)
            return ("\\footnote{"
                    + finalize(inline(blocks(content))).strip() + "}")
        tex = re.sub(FN_O + r"(lf0172[^\x0f]*?)" + FN_C, put_note, tex)
        tex = (tex.replace("\\devchapter{", "\\xsection{")
                  .replace("\\devsection{", "\\xsection{")
                  .replace("\\devunit{", "\\xsubsection{"))
        parts.append("\\xchapter{%s}\n\n%s" % (esc_tex(title), tex.strip()))

    body = "\n\n".join(parts) + "\n"
    body = re.sub(r"\n{3,}", "\n\n", body)

    # the Keble apparatus quotes Greek in decomposed polytonic (the same
    # treatment as the Schaff volumes): print the inverted breve as the
    # circumflex it stands for, compose, drop orphan combining marks,
    # then wrap Greek and pointed-Hebrew runs for LGR/texthebrew
    import unicodedata
    body = body.replace("̑", "͂")
    body = unicodedata.normalize("NFC", body)
    body = "".join(c for c in body if not 0x0300 <= ord(c) <= 0x036F)

    def wrap(rx, macro, s):
        def repl(m):
            core = m.group(0).rstrip(" \t.,;:·'’”)")
            tail = m.group(0)[len(core):]
            return "\\%s{%s}%s" % (macro, core, tail)
        return re.sub(rx, repl, s)
    body = wrap(r"[Ͱ-Ͽἀ-῿]"
                r"[Ͱ-Ͽἀ-῿\s.,;:·'’]*",
                "textgreek", body)
    body = wrap(r"[֐-׿יִ-ﭏ]"
                r"[֐-׿יִ-ﭏ\s]*", "texthebrew", body)
    from newman import _map_symbols
    from schaff import _SYMBOLS as _SCHAFF_SYMBOLS
    body = _map_symbols(body)
    for a, b in _SCHAFF_SYMBOLS.items():
        body = body.replace(a, b)

    with open(OUT, "w", encoding="utf-8") as f:
        f.write(body)
    leftovers = sorted(set(re.findall(r"<[a-zA-Z/][^>]*>", body)))
    print(f"wrote {OUT}: {body.count(chr(92) + 'xchapter')} chapters, "
          f"{body.count(chr(92) + 'footnote')} footnotes, "
          f"{len(body) // 1024} KB"
          + (f"  LEFTOVER {leftovers[:8]}" if leftovers else ""))


if __name__ == "__main__":
    main()
