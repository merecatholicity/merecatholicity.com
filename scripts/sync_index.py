#!/usr/bin/env python3
"""Re-sync docs/index.html from its two source pages.

The homepage duplicates the book hero (the-book.html) and the Where-to-begin
prose (where-to-begin.html) verbatim, and the three copies had already begun
to drift (a lost img attribute; the footer belongs to partials/footer.html
and strip_dead_nav.py, never to this script). The two
dedicated pages are the SOURCE now: this script copies their current blocks
into index.html, anchor-delimited and idempotent. Any block whose anchors are
missing or ambiguous is left untouched with a warning, never guessed at.
Wired into `make html` (sync-index target); runnable standalone."""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCS = os.path.join(ROOT, 'docs')


def read(name):
    with open(os.path.join(DOCS, name), encoding='utf-8') as f:
        return f.read()


def span(text, start, end, include_end=True, label=''):
    """The [start..end] span when each anchor appears exactly once, else None."""
    if text.count(start) != 1 or text.count(end) != 1:
        print('sync_index WARNING:', label, 'anchors missing or ambiguous, left untouched')
        return None
    i = text.index(start)
    j = text.index(end)
    if j < i:
        print('sync_index WARNING:', label, 'anchors out of order, left untouched')
        return None
    return (i, j + (len(end) if include_end else 0))


def main():
    idx = read('index.html')
    orig = idx

    # 1. The book hero, from the-book.html.
    book = read('the-book.html')
    a, b = '<div class="amazon">', 'for any purpose.</p>'
    src = span(book, a, b, True, 'book hero (source)')
    dst = span(idx, a, b, True, 'book hero (index)')
    if src and dst:
        idx = idx[:dst[0]] + book[src[0]:src[1]] + idx[dst[1]:]

    # 2. The Where-to-begin prose, from where-to-begin.html: everything after
    #    its own h1 up to </main>, placed between index's h2 and its terminator.
    wtb = read('where-to-begin.html')
    src = span(wtb, '</h1>', '</main>', False, 'where-to-begin (source)')
    dst = span(idx, '<h2>Where to begin</h2>', '<hr>\n\n<p class="canon">Quod ubique',
               False, 'where-to-begin (index)')
    if src and dst:
        body = wtb[src[0] + len('</h1>'):src[1]].strip()
        head = '<h2>Where to begin</h2>'
        idx = (idx[:dst[0]] + head + '\n\n' + body + '\n\n' + idx[dst[1]:])

    # The footer is deliberately NOT touched here. This script once appended a
    # Contact link to index's footer tail, to heal a drift that was real at the
    # time. It stopped being right: the footer moved into partials/footer.html
    # (Terms + Privacy, with Contact already in the foot-nav directly above),
    # and strip_dead_nav.py now syncs every page's tail from that partial. Both
    # ran in `make html` — the sweep set the tail, then this put Contact back on
    # index alone — so the homepage was the one page that never matched, every
    # build, forever. One owner for the footer; that owner is the partial.

    if idx != orig:
        with open(os.path.join(DOCS, 'index.html'), 'w', encoding='utf-8') as f:
            f.write(idx)
        print('sync_index: index.html synced')
    else:
        print('sync_index: index.html unchanged')
    return 0


if __name__ == '__main__':
    sys.exit(main())
