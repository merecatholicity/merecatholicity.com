#!/usr/bin/env python3
"""The fixed chrome answers the finger (2026-09-13), driven with real touches.

The verdict is unit-tested in tests/purescript/tap.test.mjs and the road's
shape in tests/js/tabbar.test.mjs; this is the half that only exists in a
browser — that a press on a tab navigates softly on the finger's lift, exactly
ONCE (the engine's own click cancelled, or swallowed as an echo), that the
destination is painted at once, and that a drag or a hold on the bar navigates
nowhere. The touches are the engine's own (CDP Input.dispatchTouchEvent), so
Chromium synthesizes its click after the lift exactly as a phone does — which
is what the road has to beat.

Run: python3 webtest/test_tap.py
"""
import sys
import time

import flows
from flows import Flow


class Phone(Flow):
    def __init__(self, port=9661):
        Flow.__init__(self, port=port)
        self._wd('POST', '/session/%s/window/rect' % self.sid,
                 {'width': 390, 'height': 844})

    def cdp(self, cmd, params):
        return self._wd('POST', '/session/%s/goog/cdp/execute' % self.sid,
                        {'cmd': cmd, 'params': params})


CENTER = """
var a = document.querySelector('mc-tabbar a.mc-tab[href="%s"]');
if (!a) return null;
var r = a.getBoundingClientRect();
return {x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2)};
"""

HERE = "return {path: location.pathname.split('/').pop(), n: history.length, mark: window.__mark || ''};"


def touch(f, kind, points):
    f.cdp('Input.dispatchTouchEvent', {'type': kind, 'touchPoints': points})


def press(f, href, hold=0.0, drag=0):
    """A finger on the tab: down, optionally travelling `drag` px up or
    staying down `hold` seconds, then up."""
    c = f.js(CENTER % href)
    if not c:
        f.failures.append('no tab for ' + href)
        return
    x, y = c['x'], c['y']
    touch(f, 'touchStart', [{'x': x, 'y': y}])
    if drag:
        for i in range(1, 5):
            touch(f, 'touchMove', [{'x': x, 'y': y - drag * i // 4}])
    if hold:
        time.sleep(hold)
    touch(f, 'touchEnd', [])


def main():
    checks = []
    with Phone() as f:
        f.cdp('Emulation.setTouchEmulationEnabled', {'enabled': True, 'maxTouchPoints': 5})
        f.login()
        f.goto('index.html')
        f.wait("document.querySelector('mc-tabbar a.mc-tab[href=\"messages.html\"]')")
        time.sleep(1.5)
        f.js("window.__mark = 'alive'; return 1;")
        before = f.js(HERE)
        checks.append(('starts on Home: %s' % before, before and before['path'] in ('index.html', '')))

        # A tap: down and up in place. The road answers the lift.
        press(f, 'messages.html')
        moved = f.wait("location.pathname.split('/').pop() === 'messages.html'", timeout=8, every=0.25)
        checks.append(('a press on Inbox navigates', moved))
        time.sleep(2.0)
        after = f.js(HERE)
        checks.append(('softly — no document reload: %s' % after, after and after['mark'] == 'alive'))
        checks.append(('exactly once — one history entry, the engine\'s click cancelled or swallowed (before %s, after %s)'
                       % (before and before['n'], after and after['n']),
                       after and before and after['n'] == before['n'] + 1))
        checks.append(('the Inbox tab is the lit one',
                       f.js("var a=document.querySelector('mc-tabbar a.mc-tab[href=\"messages.html\"]'); return !!(a && a.classList.contains('mc-tab-on'));")))

        # Back to Home by the same road.
        press(f, 'index.html')
        home = f.wait("location.pathname.split('/').pop() === 'index.html'", timeout=8, every=0.25)
        checks.append(('a press on Home brings Home', home))
        time.sleep(1.5)
        base = f.js(HERE)

        # A drag that begins on the tab is a scroll, never a tap.
        press(f, 'messages.html', drag=40)
        time.sleep(1.5)
        dragged = f.js(HERE)
        checks.append(('a drag on the bar navigates nowhere: %s' % dragged,
                       dragged and dragged['path'] == 'index.html' and dragged['n'] == base['n']))

        # A hold is the platform's gesture, never a tap.
        press(f, 'messages.html', hold=0.8)
        time.sleep(1.5)
        held = f.js(HERE)
        checks.append(('a hold on the bar navigates nowhere: %s' % held,
                       held and held['path'] == 'index.html' and held['n'] == base['n']))
        harness = list(f.failures)

    ok = True
    for label, passed in checks:
        print(('  ok ' if passed else 'FAIL ') + str(label))
        ok = ok and bool(passed)
    for h in harness:
        print('HARNESS ' + h)
    print('%d/%d passed' % (sum(1 for _, p in checks if p), len(checks)))
    sys.exit(0 if ok and not harness else 1)


if __name__ == '__main__':
    main()
