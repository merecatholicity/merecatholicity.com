#!/usr/bin/env python3
"""Emit docs/sitemap.xml over every served page.

A 270-page corpus whose discovery strategy is organic search carried no
sitemap at all. Deterministic on purpose (sorted, no lastmod, no timestamps)
so rebuilds are byte-identical and git only churns when pages come or go.
Skips away.html (an interstitial), google*.html (verification files), and
resources.html (its canonical moved to library.html). index.html is emitted
as the bare domain root, matching its og:url canonical.
Wired into `make html` (the sitemap target); runnable standalone."""
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCS = os.path.join(ROOT, 'docs')
SITE = 'https://merecatholicity.com'


def main():
    locs = []
    for name in sorted(os.listdir(DOCS)):
        if not name.endswith('.html'):
            continue
        if name == 'away.html' or name == 'resources.html' or name.startswith('google'):
            continue
        if name.startswith('_'):    # dev scratch pages are not part of the site
            continue
        locs.append(SITE + '/' if name == 'index.html' else SITE + '/' + name)
    locs.sort()
    out = ['<?xml version="1.0" encoding="UTF-8"?>',
           '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    out += ['<url><loc>' + loc + '</loc></url>' for loc in locs]
    out.append('</urlset>')
    with open(os.path.join(DOCS, 'sitemap.xml'), 'w', encoding='utf-8') as f:
        f.write('\n'.join(out) + '\n')
    print('gen_sitemap:', len(locs), 'urls')


if __name__ == '__main__':
    main()
