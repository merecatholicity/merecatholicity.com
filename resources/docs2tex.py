#!/usr/bin/env python3
"""Convert the self-hosted document sources in docs-src/ to LaTeX bodies.

Five documents, each preserved raw in docs-src/ and republished here with
an attribution note pointing to its original location:

- ravenna-en.html      (christianunity.va)  -> ravenna-body.tex
- chieti-en.html       (christianunity.va)  -> chieti-body.tex
- jddj-en.html         (christianunity.va)  -> jddj-body.tex
- encyclical1848.html  (orthodoxinfo.com)   -> encyclical1848-body.tex
- scranton2.html       (centraldiocesepncc.org) -> scranton-body.tex

Extraction slices the content region, pandoc converts HTML to LaTeX, and
a light cleanup pass normalizes headings.

Run: python docs2tex.py
"""
import re
import subprocess


def pandoc_latex(html_frag):
    p = subprocess.run(["pandoc", "-f", "html", "-t", "latex"],
                       input=html_frag, capture_output=True, text=True)
    assert p.returncode == 0, p.stderr[:500]
    return p.stdout


_TEX_MAP = {"\\": "\\textbackslash{}", "&": "\\&", "%": "\\%", "#": "\\#",
            "_": "\\_", "$": "\\$", "{": "\\{", "}": "\\}",
            "~": "\\textasciitilde{}", "^": "\\textasciicircum{}"}


def esc_tex(s):
    """Escape TeX specials in plain extracted text, one pass (the pandoc
    paths escape on their own; the pdftotext path needs this)."""
    return "".join(_TEX_MAP.get(c, c) for c in s)


def fix_mojibake(text):
    """Undo cp1252-as-utf8 double encoding where present."""
    try:
        return text.encode("cp1252", errors="strict").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return text


def clean(tex):
    # keep pandoc's labels (the JDDJ notes cross-reference them)
    tex = re.sub(r"\\begin\{center\}\\rule\{[^}]*\}\{[^}]*\}\\end\{center\}", "", tex)
    tex = re.sub(r"\n{3,}", "\n\n", tex)
    return tex.strip() + "\n"


def article(path):
    h = open(f"docs-src/{path}", encoding="utf-8", errors="replace").read()
    i = h.find("<article")
    j = h.find("</article>", i)
    return h[i:j] if i >= 0 else h


def main():
    for name, out, probe in [
            ("ravenna-en.html", "ravenna-body.tex",
             "ECCLESIOLOGICAL AND CANONICAL"),
            ("chieti-en.html", "chieti-body.tex", "SYNODALITY AND PRIMACY"),
            ("jddj-en.html", "jddj-body.tex", "JOINT DECLARATION")]:
        frag = article(name)
        i = frag.upper().find(probe)
        if i > 0:
            i = frag.rfind("<h", 0, i)
            frag = frag[i:] if i > 0 else frag
        if name.startswith("jddj"):
            # The original links footnotes 16 and 20 by absolute vatican.va
            # URL (now dead) where every other note uses the local #16/#r20
            # scheme, and it carries one empty anchor with a bogus href.
            frag = re.sub(r'href="http://www\.vatican\.va/[^"]*#_ftnref(\d+)"',
                          r'href="#r\1"', frag)
            frag = re.sub(r'href="http://www\.vatican\.va/[^"]*#_ftn(\d+)"',
                          r'href="#\1"', frag)
            frag = frag.replace('<a href="1"></a>', "")
        tex = clean(pandoc_latex(frag))
        open(out, "w").write(tex)
        print("wrote", out, len(tex))

    # 1848 encyclical: content run from the title heading to the notes
    h = open("docs-src/encyclical1848.html", encoding="utf-8",
             errors="replace").read()
    i = h.find("To All the Bishops")
    i = h.rfind("<p", 0, i)
    frag = h[i:]
    tex = clean(pandoc_latex(frag))
    # the encyclical's own address line opens the text as its one heading
    # (the deep-link client engages on pandoc's unnumbered headings)
    tex = re.sub(r"\A\s*(?:\\emph\{)?(To All the Bishops.*?)\}?(\n\n)",
                 lambda m: "\\subsection{" + " ".join(m.group(1).split())
                 + "}" + m.group(2), tex, flags=re.S)
    open("encyclical1848-body.tex", "w").write(tex)
    print("wrote encyclical1848-body.tex", len(tex))

    # 1895 encyclical: from the Reply heading through the endnotes
    h = open("docs-src/encyclical1895.html", encoding="utf-8",
             errors="replace").read()
    i = h.find("A Reply to the Papal Encyclical")
    i = h.rfind("<h", 0, i)
    frag = h[i:]
    # cut the site's trailing chrome if present
    for endmark in ("</article", "For Further Reading", "<footer"):
        k = frag.find(endmark, 200)
        if k > 0:
            frag = frag[:k]
            break
    tex = clean(pandoc_latex(frag))
    open("encyclical1895-body.tex", "w").write(tex)
    print("wrote encyclical1895-body.tex", len(tex))

    # Apostolicae Curae: the article region of the papalencyclicals page
    h = open("docs-src/apostolicae-curae.html", encoding="utf-8",
             errors="replace").read()
    i = h.find("<article")
    j = h.find("</article>", i)
    frag = h[i:j if j > 0 else len(h)]
    # the page's own share/navigation furniture
    frag = re.sub(r'<h\d[^>]*>\s*Post navigation.*$', '', frag, flags=re.S)
    tex = clean(pandoc_latex(frag))
    open("apostolicae-body.tex", "w").write(tex)
    print("wrote apostolicae-body.tex", len(tex))

    # Saepius Officio: the Project Canterbury typeset PDF, extracted with
    # pdftotext (born-digital, so the text layer is exact). Its footnotes
    # are set at page feet as a bare note-number paragraph followed by the
    # note's text, numbered in one sequence through the pamphlet, with the
    # in-text reference glued to the preceding word ("Ordinal.3"); pair
    # them back up as real \footnotes, validated both ways. The running
    # head, a lone trailing page number, and the colophon drop.
    p = subprocess.run(["pdftotext", "-layout", "docs-src/saepius.pdf", "-"],
                       capture_output=True, text=True)
    assert p.returncode == 0, p.stderr[:300]
    notes, flow = {}, []
    expected = 1                                 # notes run 1..43 in order
    for page in p.stdout.split("\f"):
        lines = [ln for ln in page.split("\n")
                 if not re.fullmatch(
                     r"\s*(?:Saepius Officio, 1897\.?|"
                     r"Project Canterbury edition AD \d+\.?)\s*", ln)]
        # the foot-notes sit at the page foot as a bare note-number line
        # followed by the note's wrapped text, numbered in one sequence
        # through the pamphlet; the first line that is exactly the next
        # expected number opens the note zone
        cut = len(lines)
        for i, ln in enumerate(lines):
            if ln.strip() == str(expected):
                cut = i
                break
        n = None
        for ln in lines[cut:]:
            s = ln.strip()
            if not s:
                continue
            if s == str(expected):
                n = s
                notes[n] = ""
                expected += 1
            elif n:
                notes[n] = (notes[n] + " " + s).strip()
        flow.append("\n".join(lines[:cut]))
    text = "\n\n".join(flow)
    # -layout keeps print wrapping: rejoin, then paragraphs on blank lines
    text = re.sub(r"[ \t]+", " ", text)
    paras = [re.sub(r"\s+", " ", b).strip()
             for b in re.split(r"\n\s*\n", text) if b.strip()]
    text = "\n\n".join(paras)
    notes = {k: re.sub(r"\s+", " ", v).strip() for k, v in notes.items()}

    used = []

    def sae_ref(m):
        n = m.group(2)
        if n in notes:
            used.append(n)
            return m.group(1) + "\x0e" + n + "\x0f"
        return m.group(0)
    text = re.sub(r"([a-z\)\.,;:'’”])(\d{1,3})(?=[\s,\.\)]|$)", sae_ref, text)
    # a few references are set off by a space ("chrism. 30 The first…");
    # match those against the notes still unplaced, requiring a fresh
    # sentence after so citation page-numbers cannot false-positive
    remaining = set(notes) - set(used)

    def sae_ref2(m):
        n = m.group(2)
        if n in remaining:
            used.append(n)
            remaining.discard(n)
            return m.group(1) + "\x0e" + n + "\x0f"
        return m.group(0)
    text = re.sub(r"([\.;:'’”\)])\s(\d{1,2})(?=\s+[A-Z“])", sae_ref2, text)
    unused = sorted(set(notes) - set(used), key=int)
    if unused:
        print("  saepius: unreferenced notes", unused)

    text = re.sub(r"Project Canterbury edition AD \d+\.?", "", text)
    text = re.sub(r"[\u0370-\u03FF\u1F00-\u1FFF][\u0370-\u03FF\u1F00-\u1FFF\s,;·\u0374\u02b9]*",
                  lambda m: chr(16) + m.group(0) + chr(17), text)
    tex = esc_tex(text)
    tex = tex.replace(chr(16), "\\textgreek{").replace(chr(17), "}")
    tex = re.sub("\x0e(\\d+)\x0f",
                 lambda m: "\\footnote{" + esc_tex(notes[m.group(1)]) + "}",
                 tex)
    if unused:
        # a reference the passes could not place: keep its note, faithful
        # and visible, in a short block at the end
        tail = ["\\subsection{Notes of the 1897 edition not anchored above}"]
        tail += ["%s. %s" % (n, esc_tex(notes[n])) for n in unused]
        tex = tex.rstrip() + "\n\n" + "\n\n".join(tail)
    tex = re.sub(r"\n{3,}", "\n\n", tex).strip() + "\n"
    open("saepius-body.tex", "w").write(tex)
    print(f"wrote saepius-body.tex {len(tex)} "
          f"({tex.count(chr(92) + 'footnote')} footnotes of {len(notes)})")

    # Scranton: declaration text region on the PNCC diocese page
    h = open("docs-src/scranton2.html", encoding="utf-8",
             errors="replace").read()
    h = fix_mojibake(h)
    i = h.find("A Profession of Faith and Declaration")
    i = h.rfind("<", 0, i)
    frag = h[i:]
    # cut trailing site chrome after the document's end if findable
    for endmark in ("</article", "footer", "Comments are closed"):
        k = frag.find(endmark)
        if k > 0:
            frag = frag[:k]
            break
    tex = clean(pandoc_latex(frag))
    open("scranton-body.tex", "w").write(tex)
    print("wrote scranton-body.tex", len(tex))


if __name__ == "__main__":
    main()
