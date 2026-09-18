#!/usr/bin/env python3
"""The document metadata every served page owes a reader who is not us.

Four sweeps over docs/*.html, all idempotent, all deterministic, run at the end
of `make html` (after inject_social.py, so a page's og:url is already there and
a freshly split part is already a page):

  1. lang. 237 of 274 pages answered `<html lang="">` — pandoc emits an empty
     language attribute when the document declares none, and an EMPTY lang is
     worse than a missing one: it is a WCAG 3.1.1 (Level A) failure that a
     validator sees and a screen reader obeys, choosing no voice at all. Set
     to "en" (lang and xml:lang both; the corpus pages are XHTML-flavoured).

  2. rel=canonical. The site answers on merecatholicity.com and on www., and
     every page also answers with any query string a link carries (`?v=`,
     `?app=0`, a share tracker), so every page has an unbounded number of
     addresses and one page in 274 said which one was the real one. The value
     is the page's OWN og:url, which the build has written for years — the same
     string, one more tag. An existing canonical is never touched: resources.html
     deliberately points at library.html.

  3. A skip link on the corpus pages. A pandoc volume opens with a table of
     contents of up to several hundred entries; without a skip link a keyboard
     or screen-reader visitor walks every one of them before reaching the first
     line of the text. The link is the first focusable thing inside <main>
     (nothing precedes main on these pages but scripts — the site nav is
     stripped), and it rides INSIDE main so the app shell's soft navigation,
     which replaces the whole <main> element, carries the link and its target
     together.

  4. One <h1> per document. 230 pages carried more than one, because the
     LaTeX \\section* → pandoc mapping makes every top-level division an <h1>
     beside the title block's own. Each heading in a pandoc page is demoted one
     level (h1→h2 … h4→h5), leaving the title as the single <h1> and the
     divisions ranked beneath it. Pandoc's own ids are untouched, so every
     deep link, every TOC entry and merecat's citations still land. The
     <main> of a demoted page is marked `class="prose corpus"`, which is what
     the stylesheet keys the unchanged VISUAL hierarchy to (a corpus h2 still
     looks like the old h1) — and what tells anything else that this page is a
     reading page rather than a page of the site.

Runnable standalone over a built docs/ tree: python3 scripts/page_meta.py
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCS = os.path.join(ROOT, 'docs')
SITE = 'https://merecatholicity.com'

# Not pages of the site: the Turnstile iframe (deliberately minimal — see
# inject_social.py), Google's verification stub, and away.html, the outbound
# interstitial the sitemap also leaves out.
SKIP = {'turnstile.html', 'away.html'}

OG_URL_RE = re.compile(r'<meta property="og:url" content="([^"]*)"')
HTML_TAG_RE = re.compile(r'<html\b([^>]*)>', re.I)
PANDOC_RE = re.compile(r'<meta name="generator" content="pandoc"')
MAIN_OPEN_RE = re.compile(r'<main class="prose">')
TOC_END_RE = re.compile(r'(<nav id="TOC"[^>]*>.*?</nav>)', re.S)
HEADING_RE = re.compile(r'<(/?)(h[1-6])\b([^>]*)>')

SKIP_LINK = '<a class="mc-skip" href="#mc-text">Skip to the text</a>'
TEXT_ANCHOR = '<span id="mc-text" tabindex="-1"></span>'


def set_lang(html):
    """`<html lang="" xml:lang="">` -> en. A page that already names a
    language keeps it: a Latin or Greek edition may one day say so."""
    m = HTML_TAG_RE.search(html)
    if not m:
        return html, False
    attrs = m.group(1)
    new = re.sub(r'\blang=""', 'lang="en"', attrs)
    if 'lang=' not in new:
        new = new + ' lang="en"'
    if new == attrs:
        return html, False
    return html[:m.start()] + '<html' + new + '>' + html[m.end():], True


def set_canonical(html):
    """One canonical per page, from its own og:url. Never overwrites."""
    if 'rel="canonical"' in html:
        return html, False
    m = OG_URL_RE.search(html)
    if not m or not m.group(1):
        return html, False
    tag = '<link rel="canonical" href="' + m.group(1) + '">'
    # LAST IN THE HEAD, not beside the og:url it was read from: that line lives
    # inside inject_social.py's fenced card on 235 pages, and a fence is
    # REWRITTEN wholesale on every build — a canonical placed inside one would
    # be deleted by the next run of a script that knows nothing about it.
    end = html.lower().rfind('</head>')
    if end < 0:
        return html, False
    return html[:end] + tag + '\n' + html[end:], True


def demote_headings(html):
    """Shift every heading in the body down one level, leaving h1.title alone.

    Runs over the whole document: a pandoc page carries no heading outside
    <main> (the site nav is stripped and the footer has none), and the TOC is
    a list of links, not of headings. Opening and closing tags are shifted
    together by remembering the last decision — headings never nest."""
    stack = []
    out = []
    last = 0
    changed = False
    for m in HEADING_RE.finditer(html):
        closing, tag, attrs = m.group(1), m.group(2), m.group(3)
        level = int(tag[1])
        if not closing:
            keep = 'class="title"' in attrs or level >= 6
            stack.append(keep)
            shift = not keep
        else:
            shift = not stack.pop() if stack else False
        if not shift:
            continue
        out.append(html[last:m.start()])
        out.append('<' + closing + 'h' + str(level + 1) + attrs + '>')
        last = m.end()
        changed = True
    if not changed:
        return html, False
    out.append(html[last:])
    return ''.join(out), True


def mark_corpus(html):
    """`<main class="prose">` -> `prose corpus` on a reading page."""
    if '<main class="prose corpus">' in html:
        return html, False
    new = MAIN_OPEN_RE.sub('<main class="prose corpus">', html, count=1)
    return new, new != html


def add_skip_link(html):
    """The skip link first inside <main>, its target right after the TOC."""
    if 'class="mc-skip"' in html or 'id="TOC"' not in html:
        return html, False
    m = re.search(r'<main class="prose[^"]*">', html)
    if not m:
        return html, False
    html = html[:m.end()] + '\n' + SKIP_LINK + html[m.end():]
    m2 = TOC_END_RE.search(html)
    if not m2:
        return html, False
    return html[:m2.end()] + '\n' + TEXT_ANCHOR + html[m2.end():], True


def process(html):
    """Every sweep, in order. Returns (html, [what changed])."""
    did = []
    pandoc = bool(PANDOC_RE.search(html))
    html, ok = set_lang(html)
    if ok:
        did.append('lang')
    html, ok = set_canonical(html)
    if ok:
        did.append('canonical')
    if pandoc:
        # `prose corpus` on <main> IS the done-mark for the demotion: a second
        # run over an already-shifted page would push the whole corpus down
        # another level. Marking first would lose the mark's meaning, so the
        # two move together and only when the page still says `prose`.
        html, ok = mark_corpus(html)
        if ok:
            did.append('corpus')
            html, ok = demote_headings(html)
            if ok:
                did.append('headings')
        html, ok = add_skip_link(html)
        if ok:
            did.append('skip')
    return html, did


def main(argv):
    counts = {}
    pages = 0
    for name in sorted(os.listdir(DOCS)):
        if not name.endswith('.html') or name in SKIP or name.startswith('google'):
            continue
        path = os.path.join(DOCS, name)
        with open(path, encoding='utf-8') as f:
            html = f.read()
        new, did = process(html)
        pages += 1
        for d in did:
            counts[d] = counts.get(d, 0) + 1
        if new != html:
            with open(path, 'w', encoding='utf-8') as f:
                f.write(new)
    print('page_meta:', pages, 'pages;',
          ', '.join(f'{k} {v}' for k, v in sorted(counts.items())) or 'nothing to do')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
