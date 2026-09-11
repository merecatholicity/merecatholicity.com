#!/usr/bin/env python3
"""Detect the site's OWN writings and hand them to the kernel.

A comments section may stand only under something we wrote — never under a
work merely hosted in the library — and the admin console offers one switch
per such page. Rather than a hand-kept list that a new article or book would
have to be added to, the list is DETECTED from the sources here and written
as a generated PureScript data module, `purescript/src/Domain/Writings.purs`
(git-ignored; `npm run build:ps` — every `make psbuild`, every CI gate —
regenerates it, so it can never be stale). `Domain.Comments` reads it as the
pages that may carry a section; the worker and the client read that.

What counts as ours:

  * ARTICLES — every page built from content/ (`<slug>.md` or `<slug>.html`)
    whose frontmatter does not say `comments: false`. The key is an OPT-OUT for
    the utility pages (terms, privacy, the catalogs, a download page); an
    ordinary page needs no key at all. content.py stamps the widget's mount by
    the very same rule (`carries_comments`), so a listed page always has the
    section to open.
  * BOOKS — every book the root Makefile builds from book/ with pandoc into
    docs/<name>.html, titled by its `--metadata title`. Each must be built with
    partials/book-tail.html (the widget's mount); a book target without it
    would give the admin a switch that does nothing, so this refuses it.

The corpus under resources/ has its own Makefile and is never read here.
Write the module with `make writings` (or any psbuild); the parity test
(tests/js/commentable_pages.test.mjs) derives the same set independently and
holds the kernel to it.
"""

import html
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
import content  # noqa: E402  (the frontmatter splitter + the opt-out rule)

CONTENT_DIR = os.path.join(ROOT, 'content')
MAKEFILE = os.path.join(ROOT, 'Makefile')
OUT = os.path.join(ROOT, 'purescript', 'src', 'Domain', 'Writings.purs')
TAIL = '../partials/book-tail.html'


def books_from_makefile(text):
    """Every pandoc call in the (root) Makefile text that writes docs/<name>.html,
    as [(path, title)] in Makefile order. Continuation lines are joined first.
    A book built without the tail partial raises: its switch would be dead."""
    joined = text.replace('\\\n', ' ')
    books = []
    for m in re.finditer(r'pandoc\s[^\n]*', joined):
        call = m.group(0)
        out = re.search(r'-o \.\./docs/([A-Za-z0-9_-]+)\.html(?:\s|$)', call)
        if not out:
            continue
        path = '/' + out.group(1) + '.html'
        title = re.search(r'--metadata title="([^"]*)"', call)
        if not title:
            raise ValueError(path + ': the book needs a --metadata title')
        if ('-A ' + TAIL) not in call:
            raise ValueError(path + ': built without partials/book-tail.html — '
                             'its comments switch would open nothing')
        books.append((path, html.unescape(title.group(1))))
    return books


def article_from_source(name, text):
    """(path, title) for one content/ source, or None when its frontmatter opts
    out (`comments: false`). A source without a title is a build error already
    (content.py refuses it); it is refused here too."""
    if not (name.endswith('.md') or name.endswith('.html')):
        return None
    fm, _body = content.split_frontmatter(text)
    if not content.carries_comments(fm):
        return None
    title = fm.get('title')
    if not title:
        raise ValueError(name + ': frontmatter needs a title')
    slug = name.rsplit('.', 1)[0]
    # A title is written for <title> and may carry an entity (Mary&rsquo;s);
    # the console shows it as text, so it is decoded here.
    return ('/' + slug + '.html', html.unescape(str(title)))


def detect(root=ROOT):
    """[(path, title, kind)]: the books in Makefile order, then the articles by
    slug — a deterministic list, so the generated module is byte-stable."""
    with open(os.path.join(root, 'Makefile'), encoding='utf-8') as f:
        books = books_from_makefile(f.read())
    entries = [(p, t, 'book') for p, t in books]
    cdir = os.path.join(root, 'content')
    for name in sorted(os.listdir(cdir)):
        with open(os.path.join(cdir, name), encoding='utf-8') as f:
            a = article_from_source(name, f.read())
        if a:
            entries.append((a[0], a[1], 'article'))
    seen = set()
    for p, _t, _k in entries:
        if p in seen:
            raise ValueError(p + ': written twice (a book and an article of one name?)')
        seen.add(p)
    return entries


def _ps_string(s):
    """A PureScript string literal: backslash and double quote escaped, and no
    raw newline (a title is one line)."""
    return '"' + str(s).replace('\\', '\\\\').replace('"', '\\"').replace('\n', ' ') + '"'


def render_module(entries):
    """The generated Domain.Writings source for [(path, title, kind)]."""
    head = (
        '-- | GENERATED by scripts/writings.py — do not hand-edit. Git-ignored; every\n'
        '-- | `npm run build:ps` (each `make psbuild`, each CI gate) regenerates it,\n'
        '-- | so it can never be stale. The site\'s OWN writings, detected from the\n'
        '-- | sources: every page built from content/ unless its frontmatter says\n'
        '-- | `comments: false`, and every book the root Makefile builds from book/ —\n'
        '-- | never a work merely hosted in the library (resources/). Domain.Comments\n'
        '-- | reads this as the pages that may carry a comments section; the worker\n'
        '-- | and the client read that. To add one: write it (and, for a book, build\n'
        '-- | it with partials/book-tail.html) — nothing to list.\n'
        'module Domain.Writings (writings) where\n'
        '\n'
        '-- | path = the served path (the comments `page` key — a storage key, so a\n'
        '-- | rename orphans rows); title = what the admin console shows;\n'
        '-- | kind = "book" | "article".\n'
        'writings :: Array { path :: String, title :: String, kind :: String }\n'
        'writings =\n'
    )
    if not entries:
        return head + '  []\n'
    rows = []
    for i, (path, title, kind) in enumerate(entries):
        rows.append(('  [ ' if i == 0 else '  , ') +
                    '{ path: ' + _ps_string(path) + ', title: ' + _ps_string(title) +
                    ', kind: ' + _ps_string(kind) + ' }')
    return head + '\n'.join(rows) + '\n  ]\n'


def main():
    entries = detect()
    src = render_module(entries)
    current = None
    if os.path.exists(OUT):
        with open(OUT, encoding='utf-8') as f:
            current = f.read()
    if current != src:
        with open(OUT, 'w', encoding='utf-8') as f:
            f.write(src)
    print('writings.py: %d writings (%d books, %d articles) -> Domain.Writings%s' % (
        len(entries), sum(1 for e in entries if e[2] == 'book'),
        sum(1 for e in entries if e[2] == 'article'), '' if current != src else ' (current)'))


if __name__ == '__main__':
    main()
