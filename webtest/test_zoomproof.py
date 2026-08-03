#!/usr/bin/env python3
"""iOS zoom-proofing + in-app theater containment (2026-08-02).

Born of a live report: most pages showed horizontal scroll on iOS Safari and
the installed PWA. No layout actually overflowed (proven in Blink AND real
WebKit at iPhone metrics) — the cause was iOS's focus auto-zoom: focusing any
control that renders under 16px zooms the viewport, the zoom OUTLIVES the
focus, and under the SPA shell (one document) it survives every soft
navigation, so the whole app pans horizontally until a manual pinch-out.
The offenders were select.scripture-sel (15.2px, every composer) and the
onboarding/DM key-input (15px on messages.html).

Two guards, both at a phone viewport (390px) against prod:
  1. FONT FLOOR — every visible input/select/textarea on the main member
     surfaces computes to >= 16px.
  2. THEATER CONTAINMENT — a synthetic .wall-lightbox under body.mc-app sits
     BETWEEN the app bars (top offset >= appbar height, bottom offset >=
     tabbar height, z-index below the bars' 40) so the top/bottom bars stay
     visible and tappable while a post is open.

Run: python3 webtest/test_zoomproof.py
"""
import json
import sys
import time

from flows import Flow

PAGES = ['community.html?feed=1', 'community.html', 'community.html?cat=pub',
         'messages.html', 'merecat-ai.html', 'profile.html', 'contact.html']

FONT_PROBE = """
var bad = [];
document.querySelectorAll('input, textarea, select').forEach(function (el) {
  var cs = getComputedStyle(el);
  if (cs.display === 'none' || cs.visibility === 'hidden') return;
  if (el.type === 'hidden' || el.type === 'checkbox' || el.type === 'radio' || el.type === 'file') return;
  var fs = parseFloat(cs.fontSize);
  if (fs < 15.95) {
    var sel = el.tagName.toLowerCase() + (el.className && typeof el.className === 'string'
      ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.') : '');
    bad.push(sel + '=' + fs + 'px');
  }
});
return bad;
"""

THEATER_PROBE = """
document.body.classList.add('mc-app');
var ov = document.createElement('div'); ov.className = 'wall-lightbox';
document.body.appendChild(ov);
var cs = getComputedStyle(ov);
var r = ov.getBoundingClientRect();
var out = { top: r.top, bottom: window.innerHeight - r.bottom, z: parseInt(cs.zIndex, 10) || 0 };
ov.remove();
return out;
"""


class PhoneFlow(Flow):
    def __init__(self, port=9612):
        Flow.__init__(self, port=port)
        self._wd('POST', '/session/%s/window/rect' % self.sid,
                 {'width': 390, 'height': 844})


def main():
    checks = []
    with PhoneFlow() as f:
        f.login()
        for page in PAGES:
            f.goto(page)
            time.sleep(3)
            bad = f.js(FONT_PROBE) or []
            checks.append(('%s: all visible controls >= 16px %s' % (page, bad or ''), not bad))
        # containment: probe on the feed page (the theater's home)
        f.goto('community.html?feed=1')
        time.sleep(2)
        t = f.js(THEATER_PROBE) or {}
        checks.append(('theater below the top bar (top %.0f >= 40)' % t.get('top', -1),
                       t.get('top', -1) >= 40))
        checks.append(('theater above the tab bar (bottom gap %.0f >= 40)' % t.get('bottom', -1),
                       t.get('bottom', -1) >= 40))
        checks.append(('theater under the bars (z %d < 40)' % t.get('z', 9999),
                       t.get('z', 9999) < 40))
        harness = list(f.failures)

    ok = True
    for label, passed in checks:
        print(('  ok ' if passed else 'FAIL ') + label)
        ok = ok and passed
    for h in harness:
        print('HARNESS ' + h)
    print('%d/%d passed' % (sum(1 for _, p in checks if p), len(checks)))
    sys.exit(0 if ok and not harness else 1)


if __name__ == '__main__':
    main()
