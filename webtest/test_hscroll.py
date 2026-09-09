#!/usr/bin/env python3
"""test_hscroll.py — nothing scrolls sideways on a phone (2026-09-09).

The owner's report: many pages — the Bible, the articles — scrolled
horizontally in the installed app. This loads a sample of every kind of page
at a phone width and asserts, per page, that the document is no wider than
its viewport and cannot be scrolled sideways by script (html{overflow-x:hidden}
stops the user, not scripts — so this measures the overflow iOS pans anyway),
and that no element inside <main> has content wider than its own box (the
signature of an unbreakable run spilling out of a normal-width paragraph).

The sample: every hand and platform page, several works per shelf including
the ones that carried the original culprits, and Bible chapters in both
translations. Add a page here when a new KIND of surface ships.

Run:  python3 webtest/test_hscroll.py            (prod)
      MC_BASE=http://127.0.0.1:8000 python3 webtest/test_hscroll.py   (a local `make serve`)
"""
import json
import sys
import time

from flows import Flow, BASE

W = 390
HAND = ('index about community feed messages profile hours journal where-to-begin the-book library '
        'contact kjv douay-rheims merecat-ai credo development councils charting-communions free-churches '
        'objections book terms resources arguments lectio-divina rosary verses').split()
CORPUS = ('anf02 npnf201 hcc1 hcc3 annals histories luther-primary timaeus apologia parochial1 tracts-times '
          'catena-matthew summa-fp gibbon1 aeneid beowulf rigveda philo1 cityofgod bcp1662 westminster').split()
BIBLE = ['kjv.html#genesis-1', 'kjv.html#psalms-119', 'kjv.html#job-3', 'kjv.html#matthew-1',
         'kjv.html#1-chronicles-1', 'douay-rheims.html#genesis-1', 'douay-rheims.html#psalms-118']
URLS = [p + '.html' for p in HAND + CORPUS] + BIBLE

PROBE = r"""
var w = document.documentElement.clientWidth;
var sw = Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0);
window.scrollTo(200, 0); var sx = window.scrollX; window.scrollTo(0, 0);
var spill = [];
var all = document.querySelectorAll('main *');
for (var i = 0; i < all.length && spill.length < 3; i++) {
  var el = all[i];
  if (el.scrollWidth <= el.clientWidth + 1) continue;
  var cs = getComputedStyle(el);
  if (cs.overflowX !== 'visible') continue;           // a scroll container owns its overflow
  if (el.clientWidth < 4) continue;                   // a visually-hidden title (1px box)
  var owned = false;                                  // ...and so does one above it (the reception
  for (var a = el.parentElement; a && a.tagName !== 'MAIN'; a = a.parentElement) {   // matrix's .table-wrap)
    var ao = getComputedStyle(a).overflowX;
    if (ao === 'auto' || ao === 'scroll' || ao === 'hidden' || ao === 'clip') { owned = true; break; }
  }
  if (owned) continue;
  var inner = false;
  for (var k = 0; k < el.children.length; k++) { var c = el.children[k]; if (c.scrollWidth > c.clientWidth + 1 && getComputedStyle(c).overflowX === 'visible' && c.clientWidth >= 4) { inner = true; break; } }
  if (inner) continue;
  var cl = (typeof el.className === 'string' ? el.className : '').trim().split(/\s+/)[0];
  spill.push(el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (cl ? '.' + cl : '') + ' ' + el.scrollWidth + '>' + el.clientWidth);
}
return JSON.stringify({w: w, sw: sw, sx: sx, spill: spill});
"""


def main():
    checks = []
    with Flow(port=9604) as f:
        f._wd('POST', '/session/%s/window/rect' % f.sid, {'width': W, 'height': 844})
        time.sleep(0.5)
        for u in URLS:
            t0 = time.time()
            f._wd('POST', '/session/%s/url' % f.sid, {'url': BASE + '/' + u})
            while time.time() - t0 < 20:
                if f.js("return document.readyState === 'complete';"):
                    break
                time.sleep(0.15)
            if '#' in u:
                f.wait("document.querySelectorAll('.bible-verse').length > 0", timeout=10, every=0.25)
            time.sleep(0.5)
            try:
                d = json.loads(f.js(PROBE))
            except Exception as e:  # noqa: BLE001
                d = {'w': 0, 'sw': 1, 'sx': 1, 'spill': ['probe failed: ' + str(e)[:80]]}
            fits = d['sw'] <= d['w'] + 1 and d['sx'] == 0
            checks.append(('%s fits %dpx (scrollWidth %d, scrollX %d)' % (u, d['w'], d['sw'], d['sx']), fits))
            checks.append(('%s: no element wider than its box %s' % (u, d['spill']), not d['spill']))
        # A local `make serve` has no /api, so its console is noise by construction.
        if BASE.startswith('https://'):
            checks.append(('console clean', f.assert_console_clean('hscroll')))
        code = f.verdict(checks)
    sys.exit(code)


if __name__ == '__main__':
    main()
