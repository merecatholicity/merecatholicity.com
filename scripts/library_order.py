#!/usr/bin/env python3
"""Emit docs/library-order.json: the Library catalog in shelf order.

deeplink.js reads it to close the loop at the end of a work ("Next on this
shelf"), and anything else that needs the catalog as data can share it.
Shape (a contract with the client, keep exact):
  {"works": [{"href": "x.html", "title": "...", "shelf": "..."}]}
Parsed from docs/library.html with the stdlib HTMLParser: only anchors inside
<ul class="library"> lists within <main>, title from each <li>'s <strong>,
shelf from the nearest preceding h2/h3, document order, first-wins dedupe by
href. Deterministic output. Wired into `make html` (library-order target)."""
import json
import os
from html.parser import HTMLParser

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCS = os.path.join(ROOT, 'docs')


class Catalog(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.in_main = False
        self.list_depth = 0        # inside <ul class="library"> (nested uls counted)
        self.shelf = ''
        self.head = None           # 'h2'/'h3' while collecting heading text
        self.head_text = []
        self.li = None             # {'title': [], 'href': '', 'strong': False}
        self.works = []
        self.seen = set()

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == 'main':
            self.in_main = True
        if not self.in_main:
            return
        if tag in ('h2', 'h3'):
            self.head = tag
            self.head_text = []
        elif tag == 'ul':
            cls = a.get('class') or ''
            if self.list_depth or 'library' in cls.split():
                self.list_depth += 1
        elif tag == 'li' and self.list_depth:
            self.li = {'title': [], 'href': '', 'strong': False}
        elif tag == 'strong' and self.li is not None:
            self.li['strong'] = True
        elif tag == 'a' and self.li is not None and not self.li['href']:
            href = a.get('href') or ''
            if (href.endswith('.html') and '://' not in href
                    and not href.startswith('/') and '#' not in href
                    and '?' not in href):
                self.li['href'] = href

    def handle_endtag(self, tag):
        if tag == 'main':
            self.in_main = False
        if not self.in_main:
            return
        if tag in ('h2', 'h3') and self.head == tag:
            self.shelf = ' '.join(''.join(self.head_text).split())
            self.head = None
        elif tag == 'ul' and self.list_depth:
            self.list_depth -= 1
        elif tag == 'li' and self.li is not None:
            title = ' '.join(''.join(self.li['title']).split())
            href = self.li['href']
            if title and href and href not in self.seen:
                self.seen.add(href)
                self.works.append({'href': href, 'title': title, 'shelf': self.shelf})
            self.li = None
        elif tag == 'strong' and self.li is not None:
            self.li['strong'] = False

    def handle_data(self, data):
        if self.head is not None:
            self.head_text.append(data)
        if self.li is not None and self.li['strong']:
            self.li['title'].append(data)


def main():
    with open(os.path.join(DOCS, 'library.html'), encoding='utf-8') as f:
        html = f.read()
    cat = Catalog()
    cat.feed(html)
    out = os.path.join(DOCS, 'library-order.json')
    with open(out, 'w', encoding='utf-8') as f:
        json.dump({'works': cat.works}, f, ensure_ascii=False, indent=1)
        f.write('\n')
    print('library_order:', len(cat.works), 'works')


if __name__ == '__main__':
    main()
