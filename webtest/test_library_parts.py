#!/usr/bin/env python3
"""A volume is a shelf, and every address that worked yesterday still works.

Since 2026-09-18 an oversized volume is served as an index over one page per
treatise (scripts/split_volumes.py): `anf03.html` went from 1.52 MB transferred
and 56,425 elements to 4 KB and 122. The promise that makes that a win rather
than a catastrophe is that nothing which was ever linked breaks, and most of
that promise is only true in a browser:

  * a contents entry wears the id it links to, so `anf03.html#apology.`
    resolves for a reader with no JavaScript and for the link checker;
  * deeplink.js hops the ids BELOW the contents — a chapter, a paragraph of its
    own ¶ scheme — through `<volume>-anchors.json`, which is fetched only on a
    miss. That hop is the one thing no unit test and no link check can see.

Also swept here: the two surfaces the split added (the part navigation and a
part's own contents) must fit a 390px phone, which is the law every new surface
answers to.

Run: python3 webtest/test_library_parts.py [base]   (default: prod BASE)
"""
import json
import sys
import time

import flows
from flows import Flow

W = 390
VOLUME = 'anf03.html'

HERE = "return JSON.stringify({url: location.pathname + location.hash, title: document.title});"
SPILL = """
var w = document.documentElement.clientWidth;
var sw = Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0);
return JSON.stringify({w: w, sw: sw});
"""


def landed(f):
    return json.loads(f.js(HERE))


def main():
    if len(sys.argv) > 1:
        flows.BASE = sys.argv[1].rstrip('/')
    checks = []
    with Flow(port=9635) as f:
        f._wd('POST', '/session/%s/window/rect' % f.sid, {'width': W, 'height': 844})

        # the manifest the whole shelf is described by
        f.goto('library-parts.json')
        time.sleep(1.0)
        raw = f.js("return document.body ? document.body.textContent : '';")
        try:
            manifest = json.loads(raw)
        except ValueError:
            manifest = {}
        vols = manifest.get('volumes', {})
        parts = manifest.get('parts', {})
        checks.append(('the manifest names the volumes (%d) and their parts (%d)'
                       % (len(vols), len(parts)), len(vols) > 100 and len(parts) > 5000))
        entry = vols.get(VOLUME) or {}
        rows = entry.get('parts') or []
        first = rows[0]['file'] if rows else ''

        # 1. the index itself: small, and a way in
        f.goto(VOLUME)
        time.sleep(1.5)
        n = f.js("return document.querySelectorAll('*').length;")
        checks.append(('the volume index is a page, not a book (%d elements)' % n, n < 2000))
        links = f.js("return document.querySelectorAll('nav#TOC a').length;")
        checks.append(('its contents point at its parts (%d entries)' % links, links > 10))

        # 2. an address from before the split, at contents depth: it must resolve
        #    ON the index (the entry wears the id) and then hop to the part
        f.goto(VOLUME + '#apology.')
        time.sleep(2.5)
        at = landed(f)
        checks.append(('a contents-depth deep link reaches a part page (%s)' % at['url'],
                       at['url'].endswith('.html') and VOLUME not in at['url']))

        # 3. an address BELOW the contents — a chapter — goes through the
        #    anchor map, which is the leg nothing else can check
        f.goto(VOLUME + '#chapter-i.')
        time.sleep(3.0)
        at = landed(f)
        hopped = VOLUME not in at['url'] and at['url'].endswith('#chapter-i.')
        checks.append(('a chapter deep link is carried to its part (%s)' % at['url'], hopped))
        if hopped:
            found = f.js("return !!document.getElementById('chapter-i.');")
            checks.append(('and the anchor it names is on the page it landed on', bool(found)))

        # 4. a part page reads like a page of the site
        if first:
            f.goto(first)
            time.sleep(1.5)
            title = f.js("return document.title;")
            checks.append(('a part is titled by its division and placed by its volume (%s)'
                           % title[:60], ' — ' in title))
            checks.append(('a part carries one h1',
                           f.js("return document.querySelectorAll('h1').length;") == 1))
            checks.append(('a part carries its own canonical',
                           f.js("return (document.querySelector('link[rel=canonical]')||{}).href;")
                           .endswith(first)))
            nav = f.js("return document.querySelectorAll('nav.mc-partnav').length;")
            checks.append(('the way back and the way on, at head and foot (%d)' % nav, nav == 2))
            box = json.loads(f.js(SPILL))
            checks.append(('nothing scrolls sideways at %dpx (%d wide in %d)'
                           % (W, box['sw'], box['w']), box['sw'] <= box['w'] + 1))

    for n, p in checks:
        print(('PASS ' if p else 'FAIL '), n)
    sys.exit(2 if any(not p for _, p in checks) else 0)


if __name__ == '__main__':
    main()
