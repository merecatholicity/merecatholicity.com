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
PARTIAL = os.path.join(ROOT, 'partials', 'footer.html')
TAIL_RE = re.compile(r'^merecatholicity\.com &middot;.*$', re.M)


def footer_lines():
    """The foot-nav paragraph and the site tail, READ FROM partials/footer.html.

    Both were once copied into this file. That is the drift hazard the repo
    closes everywhere else: the Privacy link was added to the partial in
    6ca88bd and the copies here never learned it, so pages this sweep touched
    kept a footer the partial had stopped describing. The partial is the one
    source now — edit it, and a rebuild carries the change everywhere.
    """
    nav = tail = None
    with open(PARTIAL, encoding='utf-8') as f:
        for line in f:
            t = line.strip()
            if 'class="foot-nav"' in t:
                nav = t + '\n'
            elif t.startswith('merecatholicity.com &middot;'):
                tail = t
    assert nav and tail, 'partials/footer.html lost its foot-nav or site tail'
    return nav, tail


def main():
    FOOT_NAV, TAIL = footer_lines()
    stripped = footed = retailed = 0
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
        # Converge the site tail on the partial too. Hand pages carry their own
        # literal <footer> (no pandoc include rewrites them), so without this
        # they drift the moment the partial changes — which is exactly how the
        # Privacy link reached 256 generated pages but no hand page.
        if TAIL_RE.search(s):
            s2 = TAIL_RE.sub(TAIL.replace('\\', '\\\\'), s, count=1)
            if s2 != s:
                retailed += 1
            s = s2
        if s != orig:
            with open(path, 'w', encoding='utf-8') as f:
                f.write(s)
    print('strip_dead_nav:', stripped, 'navs stripped;', footed,
          'foot-navs added;', retailed, 'site tails synced to the partial')


if __name__ == '__main__':
    main()
