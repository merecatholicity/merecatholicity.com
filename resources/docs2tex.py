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
    open("encyclical1848-body.tex", "w").write(tex)
    print("wrote encyclical1848-body.tex", len(tex))

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
