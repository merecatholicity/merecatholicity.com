#!/usr/bin/env python3
"""A fresh open never paints last visit's unread count (2026-09-17).

The owner's report: on the phone, opening the app fresh on the inbox or the
community page showed a badge number that changed a moment later. The cause was
the chrome painting the stored count whatever its age, while the fresh read was
still in flight — reproduced here at 211 ms on a fast open, and far longer on a
slow link. The rule now: a stored count is painted only while it is fresh
(Domain.Cache.badgeShows), the shell asks for it at once when it is not, and
nothing but a real answer or a live frame ever moves a badge.

What this suite proves, from the FIRST frame (a document-start recorder, because
the whole flicker is over before `load`):
  · a STALE stored count is never painted, on either page, and the number that
    finally appears is the server's;
  · a FRESH stored count IS painted at once (the instant badge is not lost);
  · the bar ends up agreeing with the server either way.

Read-only: it plants values in this browser's own localStorage and reads. No
write reaches production. The probe identity has no unread messages, so "the
server's answer" here is no badge — which is exactly what makes a planted 5
visible if it is ever painted.
"""
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from flows import Flow  # noqa: E402

PAGES = ['messages.html', 'community.html']
STALE_MS = 3600000      # an hour: past the badge TTL by any reading
FRESH_MS = 5000         # five seconds: inside it

RECORDER = r"""
(function(){
  window.__badgeLog = [];
  var t0 = Date.now();
  function snap(){
    var b = [];
    document.querySelectorAll('.mc-tab-badge').forEach(function(n){ b.push((n.textContent||'').trim()); });
    var last = window.__badgeLog[window.__badgeLog.length-1];
    var key = b.join(',');
    if (!last || last.key !== key) window.__badgeLog.push({ ms: Date.now()-t0, key: key, badges: b });
    requestAnimationFrame(snap);
  }
  snap();
})();
"""

PLANT = """try{
  localStorage.setItem('mc-dm-unread', JSON.stringify({n: 5, at: Date.now() - %d}));
  localStorage.setItem('mc-notif-unread', JSON.stringify({n: 4, at: Date.now() - %d}));
}catch(e){}
return localStorage.getItem('mc-dm-unread');"""


def painted(f):
    """Every distinct set of badge texts seen since the document started."""
    raw = f.js1('return JSON.stringify(window.__badgeLog || []);')
    return json.loads(raw) if isinstance(raw, str) else []


def main():
    checks = []
    with Flow(port=9616) as f:
        f._wd('POST', '/session/%s/window/rect' % f.sid, {'width': 390, 'height': 844})
        f.login()
        f._wd('POST', '/session/%s/goog/cdp/execute' % f.sid,
              {'cmd': 'Page.addScriptToEvaluateOnNewDocument', 'params': {'source': RECORDER}})
        for page in PAGES:
            f.goto(page)
            f.js1(PLANT % (STALE_MS, STALE_MS))
            f.goto(page)                      # the fresh open a reader makes
            time.sleep(4)
            log = painted(f)
            planted = [e for e in log if any(t in ('5', '4') for t in e['badges'])]
            checks.append(('%s: a stale count is never painted (saw %s)' % (page, [e['badges'] for e in log]),
                           not planted))
            final = f.js1("return JSON.stringify(Array.prototype.map.call(document.querySelectorAll('.mc-tab-badge'), function(n){ return (n.textContent||'').trim(); }));")
            checks.append(('%s: the bar ends on the server\'s answer, not the stored number' % page,
                           json.loads(final) == []))
            cache = f.js1("return localStorage.getItem('mc-dm-unread');")
            checks.append(('%s: the stored count was replaced by a real read' % page,
                           isinstance(cache, str) and json.loads(cache).get('n') == 0))

        # the instant badge is not lost: a FRESH stored count still paints at once
        page = PAGES[0]
        f.goto(page)
        f.js1(PLANT % (FRESH_MS, FRESH_MS))
        f.goto(page)
        time.sleep(1.5)
        log = painted(f)
        first = next((e for e in log if e['badges']), None)
        checks.append(('a fresh stored count paints at once (%s at %s ms)'
                       % (first['badges'] if first else None, first['ms'] if first else '-'),
                       bool(first) and '5' in first['badges'] and first['ms'] < 1500))

    ok = sum(1 for _, good in checks if good)
    for label, good in checks:
        print(('PASS  ' if good else 'FAIL  ') + label)
    print('==== %d PASS  %d FAIL ====' % (ok, len(checks) - ok))
    sys.exit(0 if ok == len(checks) else 2)


main()
