#!/usr/bin/env python3
"""Strip the retired nav.site markup from every built page, and give the
static footer a VISIBLE nav line.

The disclosure menu was retired (NAV_ENABLED = False in nav.py) and CSS-hidden
site-wide, but ~270 built pages still shipped its ~100-line dead markup, which
docs/nav.js's engine found and bound listeners to. Worse, hiding it left a
no-JS visitor with NO navigation at all. This sweep removes the dead block
(the nav.js script tag and <main> anchor stay — the app shell's content-swap
anchors on them) and inserts the same foot-nav line partials/footer.html now
carries, so future pandoc rebuilds and swept pages stay byte-identical.
Idempotent; wired into `make html` before the linkcheck; runnable standalone."""
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCS = os.path.join(ROOT, 'docs')

NAV_RE = re.compile(r'<nav class="site">.*?</nav>\n?', re.S)
FOOT_NAV = ('<p class="foot-nav"><a href="index.html">Home</a> &middot; '
            '<a href="library.html">Library</a> &middot; '
            '<a href="community.html">Community</a> &middot; '
            '<a href="about.html">About</a> &middot; '
            '<a href="contact.html">Contact</a></p>\n')


def main():
    stripped = footed = 0
    for name in sorted(os.listdir(DOCS)):
        if not name.endswith('.html'):
            continue
        path = os.path.join(DOCS, name)
        with open(path, encoding='utf-8') as f:
            s = f.read()
        orig = s
        s = NAV_RE.sub('', s, count=1)
        if s != orig:
            stripped += 1
        if 'foot-nav' not in s and '<footer>\n' in s:
            s = s.replace('<footer>\n', '<footer>\n' + FOOT_NAV, 1)
            footed += 1
        if s != orig:
            with open(path, 'w', encoding='utf-8') as f:
                f.write(s)
    print('strip_dead_nav:', stripped, 'navs stripped;', footed, 'foot-navs added')


if __name__ == '__main__':
    main()
