#!/usr/bin/env python3
"""Pull to refresh (2026-09-07), driven with synthesized touch events.

The gesture arithmetic is unit-tested in tests/purescript/ptr.test.mjs; this is
the half that only exists in a real browser — that the handler is installed on
every page, that it owns the overscroll (or Chrome on Android fires its own
pull-to-refresh alongside ours), that an ordinary pull refetches IN PLACE, and
that the third pull in a run escalates to a document reload.

A note on probing: the "release to reload" hint must be read while the finger is
still DOWN, which is the only moment a human ever sees it. Reading it in the
same synchronous tick as the final synthesized touchmove reports it empty —
consistently, in a way I could not explain from the built code, which is correct
there. The hold-and-inspect shape below is both the reliable probe and the one
that matches real use.

Run: python3 webtest/test_ptr.py
"""
import json
import sys
import time

import flows
from flows import Flow


class Phone(Flow):
    def __init__(self, port=9660):
        Flow.__init__(self, port=port)
        self._wd('POST', '/session/%s/window/rect' % self.sid,
                 {'width': 390, 'height': 844})

    def cdp(self, cmd, params):
        return self._wd('POST', '/session/%s/goog/cdp/execute' % self.sid,
                        {'cmd': cmd, 'params': params})


PULL = """
var done = arguments[arguments.length - 1];
function T(y){ return new Touch({identifier:1, target:document.body, clientX:180, clientY:y}); }
function fire(type, y){
  var t = T(y);
  document.dispatchEvent(new TouchEvent(type, {bubbles:true, cancelable:true,
    touches: type==='touchend'?[]:[t], targetTouches: type==='touchend'?[]:[t], changedTouches:[t]}));
}
window.scrollTo(0,0);
fire('touchstart', 100);
var y = 100, n = 0;
var iv = setInterval(function(){
  y += 20; n++; fire('touchmove', y);
  if (n >= STEPS) {
    clearInterval(iv);
    var pill = document.querySelector('.mc-ptr');
    var nt = document.querySelector('.mc-ptr-note');
    var out = { ready: !!(pill && pill.classList.contains('ready')),
                visible: !!(pill && pill.style.opacity && pill.style.opacity !== '0') };
    if (RELEASE) fire('touchend', y);
    setTimeout(function(){
      out.note = nt ? nt.textContent : '';
      out.noteOn = !!(nt && nt.classList.contains('on'));
      done(JSON.stringify(out));
    }, 250);
  }
}, 16);
"""


def pull(f, steps=14, release=True):
    s = PULL.replace('STEPS', str(steps)).replace('RELEASE', 'true' if release else 'false')
    return json.loads(f._wd('POST', '/session/%s/execute/async' % f.sid,
                            {'script': s, 'args': []})['value'])


def main():
    checks = []
    with Phone() as f:
        f.cdp('Emulation.setTouchEmulationEnabled', {'enabled': True, 'maxTouchPoints': 5})
        f.login()
        f.goto('community.html')
        time.sleep(7)

        checks.append(('the handler is installed',
                       f.js("return !!document.querySelector('.mc-ptr');")))
        checks.append(('we own the vertical overscroll (no duelling native PTR)',
                       f.js("return getComputedStyle(document.body).overscrollBehaviorY;") == 'contain'))

        short = pull(f, steps=3)
        checks.append(('a short pull shows the indicator but does not arm: %s' % short,
                       short['visible'] and not short['ready']))
        time.sleep(1.0)

        f.js("window.__mark = 'alive'; return 1;")
        one = pull(f, steps=14)
        checks.append(('a full pull arms', one['ready']))
        time.sleep(1.2)
        checks.append(('an ordinary pull refetches IN PLACE — no document reload',
                       f.js("return window.__mark === 'alive';")))

        pull(f, steps=14)
        time.sleep(1.2)
        checks.append(('a second pull is still an in-place refetch',
                       f.js("return window.__mark === 'alive';")))

        held = pull(f, steps=14, release=False)
        checks.append(('the third pull announces itself before it fires: %r' % held.get('note'),
                       'reload' in (held.get('note') or '').lower() and held.get('noteOn')))
        # release it
        f.js("""var t = new Touch({identifier:1, target:document.body, clientX:180, clientY:400});
                document.dispatchEvent(new TouchEvent('touchend', {bubbles:true, cancelable:true,
                  touches:[], targetTouches:[], changedTouches:[t]})); return 1;""")
        time.sleep(3.0)
        checks.append(('and the third pull DOES reload the document',
                       f.js("return window.__mark !== 'alive';")))
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
