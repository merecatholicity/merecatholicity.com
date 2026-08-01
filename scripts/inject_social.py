#!/usr/bin/env python3
"""Give every docs/*.html a social-share card, derived from its own <title>.

The primary-source Library pages (Schaff, Newman, the Fathers, the Bibles, the
Summa, the Catena, the classics) are pandoc-built with no Open Graph tags; this
injects a title-specific card into each without editing the dozens of build
stanzas (and the generated *.mk files) that produce them. Pages that ALREADY
carry an og:title — the hand pages and the content.py pages, which have curated
per-page cards — are skipped untouched.

Idempotent (the og:title guard) and deterministic (fixed tags from the title).
Wired into `make html` after the resources build so a corpus rebuild re-injects;
also runnable standalone over the committed docs/ tree."""
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCS = os.path.join(ROOT, 'docs')
SITE = 'https://merecatholicity.com'
IMAGE = SITE + '/cover.jpg'
DESC = 'A primary source in the Mere Catholicity Library.'

TITLE_RE = re.compile(r'<title>(.*?)</title>', re.S)


def esc(s):
    return (s.replace('&', '&amp;').replace('"', '&quot;')
            .replace('<', '&lt;').replace('>', '&gt;'))


def card(title_html, url):
    # title_html is the already-HTML-escaped inner text of <title>; drop a
    # " | Mere Catholicity" suffix so og:title is the clean work title.
    t = re.sub(r'\s*\|\s*Mere Catholicity\s*$', '', title_html.strip())
    desc = esc(DESC)
    tags = [
        ('meta name="description"', t and desc or desc),
        ('meta property="og:type"', 'book'),
        ('meta property="og:site_name"', 'Mere Catholicity'),
        ('meta property="og:title"', t),
        ('meta property="og:description"', desc),
        ('meta property="og:url"', esc(url)),
        ('meta property="og:image"', esc(IMAGE)),
        ('meta name="twitter:card"', 'summary_large_image'),
        ('meta name="twitter:title"', t),
        ('meta name="twitter:description"', desc),
        ('meta name="twitter:image"', esc(IMAGE)),
    ]
    return '\n'.join('<' + a + ' content="' + v + '">' for a, v in tags)


def main():
    injected = skipped = 0
    for name in sorted(os.listdir(DOCS)):
        if not name.endswith('.html'):
            continue
        path = os.path.join(DOCS, name)
        with open(path, encoding='utf-8') as f:
            html = f.read()
        if 'og:title' in html:      # already has a curated card — leave it
            skipped += 1
            continue
        m = TITLE_RE.search(html)
        if not m or not m.group(1).strip():
            continue
        block = card(m.group(1), SITE + '/' + name)
        with open(path, 'w', encoding='utf-8') as f:
            f.write(html.replace(m.group(0), m.group(0) + '\n' + block, 1))
        injected += 1
    print('inject_social: injected', injected, 'cards; skipped', skipped, '(already carded)')


if __name__ == '__main__':
    main()
