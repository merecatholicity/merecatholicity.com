#!/usr/bin/env python3
"""Emit dr.json: the Douay-Rheims (Challoner) text as book -> chapters -> verse
strings, for the one-page reader (douay-rheims.html + bible-reader.js). Parsed
from the same Gutenberg source as dr2tex.py (douay-rheims-src.html), so the text
matches the reading page. The full Catholic canon: 46 Old Testament books
(deuterocanon included) and 27 New, each with a short display name and a
canonical slug used in the verse-anchor ids.

Run: python dr-json.py   ->   ../dr.json
"""
import html as htmlmod
import json
import re
from html.parser import HTMLParser

SRC = "douay-rheims-src.html"
OUT = "../docs/dr.json"

# 73 books in the source's order: (display name, verse-anchor slug).
BOOKS = [
    ("Genesis", "genesis"), ("Exodus", "exodus"), ("Leviticus", "leviticus"),
    ("Numbers", "numbers"), ("Deuteronomy", "deuteronomy"), ("Josue", "josue"),
    ("Judges", "judges"), ("Ruth", "ruth"), ("1 Kings", "1-kings"),
    ("2 Kings", "2-kings"), ("3 Kings", "3-kings"), ("4 Kings", "4-kings"),
    ("1 Paralipomenon", "1-paralipomenon"), ("2 Paralipomenon", "2-paralipomenon"),
    ("1 Esdras", "1-esdras"), ("2 Esdras (Nehemias)", "2-esdras"),
    ("Tobias", "tobias"), ("Judith", "judith"), ("Esther", "esther"),
    ("Job", "job"), ("Psalms", "psalms"), ("Proverbs", "proverbs"),
    ("Ecclesiastes", "ecclesiastes"), ("Canticle of Canticles", "canticle-of-canticles"),
    ("Wisdom", "wisdom"), ("Ecclesiasticus", "ecclesiasticus"),
    ("Isaias", "isaias"), ("Jeremias", "jeremias"), ("Lamentations", "lamentations"),
    ("Baruch", "baruch"), ("Ezechiel", "ezechiel"), ("Daniel", "daniel"),
    ("Osee", "osee"), ("Joel", "joel"), ("Amos", "amos"), ("Abdias", "abdias"),
    ("Jonas", "jonas"), ("Micheas", "micheas"), ("Nahum", "nahum"),
    ("Habacuc", "habacuc"), ("Sophonias", "sophonias"), ("Aggeus", "aggeus"),
    ("Zacharias", "zacharias"), ("Malachias", "malachias"),
    ("1 Machabees", "1-machabees"), ("2 Machabees", "2-machabees"),
    ("Matthew", "matthew"), ("Mark", "mark"), ("Luke", "luke"), ("John", "john"),
    ("Acts", "acts"), ("Romans", "romans"),
    ("1 Corinthians", "1-corinthians"), ("2 Corinthians", "2-corinthians"),
    ("Galatians", "galatians"), ("Ephesians", "ephesians"),
    ("Philippians", "philippians"), ("Colossians", "colossians"),
    ("1 Thessalonians", "1-thessalonians"), ("2 Thessalonians", "2-thessalonians"),
    ("1 Timothy", "1-timothy"), ("2 Timothy", "2-timothy"), ("Titus", "titus"),
    ("Philemon", "philemon"), ("Hebrews", "hebrews"), ("James", "james"),
    ("1 Peter", "1-peter"), ("2 Peter", "2-peter"), ("1 John", "1-john"),
    ("2 John", "2-john"), ("3 John", "3-john"), ("Jude", "jude"),
    ("Apocalypse", "apocalypse"),
]

VERSE = re.compile(r"^(\d+):(\d+)\.\s*(.*)", re.S)


class DR(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.active = False       # between a testament heading and the appendices
        self.testament = None     # "ot" / "nt" for the current book
        self.books = []           # each: (testament, {chap: {verse: text}})
        self.cap = None
        self.buf = []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag in ("h2", "h3"):
            self._flush(); self.cap = tag
        elif tag == "p" and self.active:
            self._flush()
            # only plain verse paragraphs; skip arguments (sp2/center) and notes (expl)
            self.cap = "verse" if a.get("class", "") not in ("sp2", "expl", "center") else None

    def handle_endtag(self, tag):
        if tag in ("h2", "h3", "p"):
            self._flush()

    def handle_data(self, data):
        if self.cap:
            self.buf.append(data)

    def _flush(self):
        if not self.cap:
            return
        text = re.sub(r"\s+", " ", "".join(self.buf)).strip()
        kind, self.cap, self.buf = self.cap, None, []
        if not text:
            return
        raw = htmlmod.unescape(text)
        if kind == "h2":
            t = raw.upper()
            if "OLD TESTAMENT" in t:
                self.active, self.testament = True, "ot"
            elif "NEW TESTAMENT" in t:
                self.active, self.testament = True, "nt"
            else:
                self.active = False
            return
        if not self.active:
            return
        if kind == "h3":
            self.books.append((self.testament, {}))
            return
        if not self.books:
            return
        m = VERSE.match(raw)
        if m:
            ch, vs = int(m.group(1)), int(m.group(2))
            self.books[-1][1].setdefault(ch, {})[vs] = m.group(3).strip()


def main():
    p = DR()
    with open(SRC, encoding="utf-8") as f:
        p.feed(f.read())
    p._flush()
    assert len(p.books) == len(BOOKS), \
        "expected %d books, got %d" % (len(BOOKS), len(p.books))
    out = []
    for (name, slug), (testament, chapmap) in zip(BOOKS, p.books):
        chapters = []
        for c in range(1, max(chapmap) + 1):
            vmap = chapmap.get(c, {})
            chapters.append([vmap.get(v, "") for v in range(1, (max(vmap) if vmap else 0) + 1)])
        out.append({"name": name, "slug": slug, "t": testament, "chapters": chapters})
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"books": out}, f, ensure_ascii=False, separators=(",", ":"))
    nv = sum(len(c) for b in out for c in b["chapters"])
    print(f"wrote {OUT}: {len(out)} books, {nv} verses")


if __name__ == "__main__":
    main()
