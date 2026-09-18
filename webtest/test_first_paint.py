#!/usr/bin/env python3
"""A phone's FIRST paint is already the app, not the plain site (2026-09-17).

The owner's report: opening the app fresh, and first visiting Inbox or
Community, "flashes like an extra page reload". It did: until app.js arrived
(hundreds of milliseconds on a cold cache, longer on a phone link) the page
painted a centred page title, the desktop footer's two link rows and no bars,
and then the shell replaced all three at once.

This suite freezes that first frame by BLOCKING app.js, which is what a slow
link looks like held still, and asserts the page is already wearing the app:
the two bars' surfaces in place, no page title, no static footer. It then
proves the escape hatch still works — a reader who asked for the plain site
(?app=0) keeps the title and the footer and gets no placeholders.

Read-only: it blocks a script and reads the layout. Nothing is written.
"""
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from flows import Flow, BASE  # noqa: E402

PAGES = ['messages.html', 'community.html', 'feed.html']

LOOK = r"""return JSON.stringify({
  bodyCls: document.body.className,
  htmlCls: document.documentElement.className,
  footer: (function(){ var n = document.querySelector('body > footer'); return n ? getComputedStyle(n).display : 'no-element'; })(),
  title: (function(){ var n = document.querySelector('main.prose > .home-title, main.prose > #title-block-header'); return n ? getComputedStyle(n).display : 'no-element'; })(),
  top: getComputedStyle(document.body, '::before').height,
  bottom: getComputedStyle(document.body, '::after').height,
  topBg: getComputedStyle(document.body, '::before').backgroundColor,
  chrome: !!document.querySelector('mc-tabbar') || !!document.querySelector('mc-appbar')
});"""


def px(v):
    try:
        return float(str(v).replace('px', ''))
    except ValueError:
        return 0.0


def main():
    checks = []
    with Flow(port=9625) as f:
        f._wd('POST', '/session/%s/window/rect' % f.sid, {'width': 390, 'height': 844})

        def cdp(cmd, params):
            f._wd('POST', '/session/%s/goog/cdp/execute' % f.sid, {'cmd': cmd, 'params': params})

        cdp('Network.enable', {})
        cdp('Network.setBlockedURLs', {'urls': ['*app.js*']})
        for page in PAGES:
            f._wd('POST', '/session/%s/url' % f.sid, {'url': BASE + '/' + page})
            time.sleep(2)
            s = json.loads(f.js1(LOOK))
            checks.append(('%s: the shell has not mounted (the frame under test)' % page,
                           'mc-app' not in s['bodyCls'] and not s['chrome']))
            checks.append(('%s: no page title before the shell (the app bar carries it)' % page,
                           s['title'] in ('none', 'no-element')))
            checks.append(('%s: no static footer before the shell' % page,
                           s['footer'] in ('none', 'no-element')))
            checks.append(('%s: both bars hold their place (top %s, bottom %s)' % (page, s['top'], s['bottom']),
                           px(s['top']) >= 40 and px(s['bottom']) >= 48))
            checks.append(('%s: the placeholder wears the bars own surface (%s)' % (page, s['topBg']),
                           s['topBg'] not in ('rgba(0, 0, 0, 0)', 'transparent')))

        # the escape hatch: ?app=0 keeps the plain site, title and footer and all
        f._wd('POST', '/session/%s/url' % f.sid, {'url': BASE + '/messages.html?app=0'})
        time.sleep(2)
        f._wd('POST', '/session/%s/url' % f.sid, {'url': BASE + '/messages.html'})
        time.sleep(2)
        s = json.loads(f.js1(LOOK))
        checks.append(('?app=0: the reader is marked (%s)' % s['htmlCls'], 'mc-noapp' in s['htmlCls']))
        checks.append(('?app=0: the page title stands', s['title'] not in ('none', 'no-element')))
        checks.append(('?app=0: the static footer stands', s['footer'] not in ('none', 'no-element')))
        checks.append(('?app=0: no placeholder bars over the plain site',
                       px(s['top']) == 0 or s['top'] == 'auto'))
        f._wd('POST', '/session/%s/url' % f.sid, {'url': BASE + '/messages.html?app=1'})
        time.sleep(1.5)

        # and with the bundle allowed, the real chrome arrives and the placeholders go
        cdp('Network.setBlockedURLs', {'urls': []})
        f._wd('POST', '/session/%s/url' % f.sid, {'url': BASE + '/messages.html'})
        time.sleep(4)
        s = json.loads(f.js1(LOOK))
        checks.append(('settled: the real chrome stands and the page wears mc-app', s['chrome'] and 'mc-app' in s['bodyCls']))
        checks.append(('settled: the static footer stays hidden on the phone', s['footer'] in ('none', 'no-element')))

    ok = sum(1 for _, good in checks if good)
    for label, good in checks:
        print(('PASS  ' if good else 'FAIL  ') + label)
    print('==== %d PASS  %d FAIL ====' % (ok, len(checks) - ok))
    sys.exit(0 if ok == len(checks) else 2)


main()
