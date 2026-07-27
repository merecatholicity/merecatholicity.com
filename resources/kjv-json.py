#!/usr/bin/env python3
"""Emit kjv.json: the King James text as book -> chapters -> verse strings, for
the comment composer's Scripture picker (fetched lazily like emoji-data.json).
Parsed from the same Gutenberg source as kjv2tex.py (kjv-src.html), so the text
matches the reading page. Short book names + canonical slugs (matching the
autolink and deeplink.js verse ids) accompany each book.

Run: python kjv-json.py   ->   ../kjv.json
"""
import html as htmlmod
import json
import re
from html.parser import HTMLParser

SRC = "kjv-src.html"
OUT = "../kjv.json"

# 66 books in canonical order: (display name, verse-anchor slug)
BOOKS = [
    ("Genesis", "genesis"), ("Exodus", "exodus"), ("Leviticus", "leviticus"),
    ("Numbers", "numbers"), ("Deuteronomy", "deuteronomy"), ("Joshua", "joshua"),
    ("Judges", "judges"), ("Ruth", "ruth"), ("1 Samuel", "1-samuel"),
    ("2 Samuel", "2-samuel"), ("1 Kings", "1-kings"), ("2 Kings", "2-kings"),
    ("1 Chronicles", "1-chronicles"), ("2 Chronicles", "2-chronicles"),
    ("Ezra", "ezra"), ("Nehemiah", "nehemiah"), ("Esther", "esther"),
    ("Job", "job"), ("Psalms", "psalms"), ("Proverbs", "proverbs"),
    ("Ecclesiastes", "ecclesiastes"), ("Song of Solomon", "song-of-solomon"),
    ("Isaiah", "isaiah"), ("Jeremiah", "jeremiah"), ("Lamentations", "lamentations"),
    ("Ezekiel", "ezekiel"), ("Daniel", "daniel"), ("Hosea", "hosea"),
    ("Joel", "joel"), ("Amos", "amos"), ("Obadiah", "obadiah"), ("Jonah", "jonah"),
    ("Micah", "micah"), ("Nahum", "nahum"), ("Habakkuk", "habakkuk"),
    ("Zephaniah", "zephaniah"), ("Haggai", "haggai"), ("Zechariah", "zechariah"),
    ("Malachi", "malachi"), ("Matthew", "matthew"), ("Mark", "mark"),
    ("Luke", "luke"), ("John", "john"), ("Acts", "acts"), ("Romans", "romans"),
    ("1 Corinthians", "1-corinthians"), ("2 Corinthians", "2-corinthians"),
    ("Galatians", "galatians"), ("Ephesians", "ephesians"),
    ("Philippians", "philippians"), ("Colossians", "colossians"),
    ("1 Thessalonians", "1-thessalonians"), ("2 Thessalonians", "2-thessalonians"),
    ("1 Timothy", "1-timothy"), ("2 Timothy", "2-timothy"), ("Titus", "titus"),
    ("Philemon", "philemon"), ("Hebrews", "hebrews"), ("James", "james"),
    ("1 Peter", "1-peter"), ("2 Peter", "2-peter"), ("1 John", "1-john"),
    ("2 John", "2-john"), ("3 John", "3-john"), ("Jude", "jude"),
    ("Revelation", "revelation"),
]

VERSE = re.compile(r"(\d+):(\d+)\s+")


class KJV(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.active = False
        self.books = []          # each: {chap: {verse: text}}
        self.cap = None
        self.buf = []

    def handle_starttag(self, tag, attrs):
        if tag == "h2":
            self._flush(); self.cap = "h2"
        elif tag == "p" and self.active:
            self._flush(); self.cap = "p"

    def handle_endtag(self, tag):
        if tag in ("h2", "p"):
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
            if "OLD TESTAMENT" in t or "NEW TESTAMENT" in t:
                self.active = True
            elif self.active and "GUTENBERG" not in t and "LICENSE" not in t:
                self.books.append({})    # a new book
            else:
                self.active = False
            return
        if not self.active or not self.books:
            return
        marks = list(VERSE.finditer(raw))
        for i, m in enumerate(marks):
            ch, vs = int(m.group(1)), int(m.group(2))
            end = marks[i + 1].start() if i + 1 < len(marks) else len(raw)
            self.books[-1].setdefault(ch, {})[vs] = raw[m.end():end].strip()


def main():
    p = KJV()
    with open(SRC, encoding="utf-8") as f:
        p.feed(f.read())
    p._flush()
    assert len(p.books) == 66, "expected 66 books, got %d" % len(p.books)
    out = []
    for (name, slug), chapmap in zip(BOOKS, p.books):
        chapters = []
        for c in range(1, max(chapmap) + 1):
            vmap = chapmap.get(c, {})
            chapters.append([vmap.get(v, "") for v in range(1, (max(vmap) if vmap else 0) + 1)])
        out.append({"name": name, "slug": slug, "chapters": chapters})
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"books": out}, f, ensure_ascii=False, separators=(",", ":"))
    nv = sum(len(c) for b in out for c in b["chapters"])
    print(f"wrote {OUT}: 66 books, {nv} verses")


if __name__ == "__main__":
    main()
