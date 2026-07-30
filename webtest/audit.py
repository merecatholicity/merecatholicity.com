#!/usr/bin/env python3
"""The headless audit harness — the standing gate for every app-shell phase.

Drives real Chromium over the WebDriver HTTP API (stdlib only, no selenium),
with Chrome's browser + performance logs enabled, and fails on:
  - any console ERROR (SEVERE) on any visited page
  - any same-origin request answering >= 400
  - duplicate loads of the same static asset within one page's life
It prints the network waterfall per step so a human can read what the site
actually did — the DevTools Network tab, in CI form.

Usage:
  python3 webtest/audit.py --base https://merecatholicity.com \
      --pages index.html,credo.html,library.html,community.html
  python3 webtest/audit.py --base https://merecatholicity.com --app \
      --journey index.html,credo.html,development.html,councils.html#canons
`--app` arms the shell (?app=1) and asserts journeys navigate SOFTLY: after
the first load, page hops must produce NO top-level Document request.
`--journey` hops are followed by clicking a matching <a href> when present
(the true interception path), else via location.assign (reported).
"""
import argparse
import json
import os
import signal
import subprocess
import sys
import time
import urllib.request

CHROME_DIR = os.path.expanduser('~/.cloakbrowser/chromium-146.0.7680.177.5')
PORT = 9530


def wd(method, path, body=None, timeout=60):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request('http://127.0.0.1:%d%s' % (PORT, path),
                                 data=data, method=method,
                                 headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


class Session:
    def __init__(self):
        self.drv = subprocess.Popen(
            [os.path.join(CHROME_DIR, 'chromedriver'), '--port=%d' % PORT],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        time.sleep(1.5)
        caps = {'capabilities': {'alwaysMatch': {
            'goog:chromeOptions': {
                'binary': os.path.join(CHROME_DIR, 'chrome'),
                'args': ['--headless=new', '--no-sandbox', '--disable-gpu',
                         '--disable-dev-shm-usage', '--window-size=1280,900',
                         '--user-data-dir=/tmp/mc-audit-%d' % int(time.time())],
                'perfLoggingPrefs': {'enableNetwork': True},
            },
            'goog:loggingPrefs': {'browser': 'ALL', 'performance': 'ALL'},
        }}}
        self.sid = wd('POST', '/session', caps)['value']['sessionId']

    def go(self, url):
        wd('POST', '/session/%s/url' % self.sid, {'url': url})

    def js(self, script):
        return wd('POST', '/session/%s/execute/sync' % self.sid,
                  {'script': script, 'args': []})['value']

    def logs(self, kind):
        for path in ('/session/%s/se/log' % self.sid, '/session/%s/log' % self.sid):
            try:
                return wd('POST', path, {'type': kind})['value'] or []
            except Exception:
                continue
        return []

    def close(self):
        try:
            wd('DELETE', '/session/%s' % self.sid)
        except Exception:
            pass
        self.drv.send_signal(signal.SIGTERM)


def net_events(raw):
    """performance log -> [{url, status, kind, doc}] responses + doc requests"""
    out = []
    for entry in raw:
        try:
            msg = json.loads(entry['message'])['message']
        except Exception:
            continue
        m = msg.get('method', '')
        p = msg.get('params', {})
        if m == 'Network.responseReceived':
            r = p.get('response', {})
            out.append({'url': r.get('url', ''), 'status': r.get('status', 0),
                        'kind': p.get('type', ''), 'event': 'response'})
        elif m == 'Network.requestWillBeSent':
            out.append({'url': p.get('request', {}).get('url', ''),
                        'kind': p.get('type', ''), 'event': 'request',
                        'status': None})
    return out


def audit_step(sess, base, label, failures, expect_soft=False):
    """Drain logs after a step; report + collect failures."""
    console = sess.logs('browser')
    perf = net_events(sess.logs('performance'))
    responses = [e for e in perf if e['event'] == 'response' and e['url'].startswith('http')]
    docs = [e for e in perf if e['kind'] == 'Document' and e['event'] == 'request'
            and e['url'].startswith(base)]
    errs = [c for c in console if c.get('level') == 'SEVERE']
    bad = [r for r in responses if r['url'].startswith(base) and (r['status'] or 0) >= 400]
    seen = {}
    dups = []
    for r in responses:
        u = r['url']
        if not u.startswith(base):
            continue
        if any(u.split('?')[0].endswith(ext) for ext in ('.js', '.css', '.json', '.webp', '.jpg', '.png')):
            seen[u] = seen.get(u, 0) + 1
            if seen[u] == 2:
                dups.append(u)
    print('== %s: %d requests (%d same-origin), %d console entries'
          % (label, len(responses), sum(1 for r in responses if r['url'].startswith(base)), len(console)))
    for r in responses:
        if r['url'].startswith(base):
            print('   %s %-10s %s' % (r['status'], r['kind'], r['url'][len(base):][:90]))
    for c in console:
        line = '%s %s' % (c.get('level'), c.get('message', '')[:180])
        print('   console:', line)
    if errs:
        failures.append('%s: console ERRORS: %s' % (label, [c.get('message', '')[:160] for c in errs]))
    if bad:
        failures.append('%s: same-origin >=400: %s' % (label, [(r['status'], r['url']) for r in bad]))
    if dups:
        failures.append('%s: duplicate asset loads: %s' % (label, dups))
    if expect_soft and docs:
        failures.append('%s: expected SOFT navigation but saw Document request(s): %s'
                        % (label, [d['url'] for d in docs]))
    return failures


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--base', default='https://merecatholicity.com')
    ap.add_argument('--pages', default='')
    ap.add_argument('--journey', default='')
    ap.add_argument('--app', action='store_true', help='arm the ?app=1 shell first')
    args = ap.parse_args()
    base = args.base.rstrip('/')
    failures = []
    sess = Session()
    try:
        if args.pages:
            for page in [p for p in args.pages.split(',') if p]:
                sess.logs('browser'); sess.logs('performance')   # drain
                sess.go(base + '/' + page)
                time.sleep(4)
                probe = sess.js(
                    "return JSON.stringify({nav: !!document.querySelector('nav.site'),"
                    " body: document.body.textContent.length, title: document.title});")
                print('   probe:', probe)
                st = json.loads(probe)
                if not st['nav'] or st['body'] < 200:
                    failures.append('%s: page skeleton missing (nav=%s bytes=%d)'
                                    % (page, st['nav'], st['body']))
                audit_step(sess, base, page, failures)
        if args.journey:
            hops = [h for h in args.journey.split(',') if h]
            first = hops[0] + ('&app=1' if args.app and '?' in hops[0] else '?app=1' if args.app else '')
            sess.logs('browser'); sess.logs('performance')
            sess.go(base + '/' + first)
            time.sleep(4)
            audit_step(sess, base, 'journey start ' + hops[0], failures)
            for hop in hops[1:]:
                sess.logs('browser'); sess.logs('performance')
                target = hop.split('#')[0]
                clicked = sess.js(
                    "var a=document.querySelector('a[href=\"" + hop + "\"]')"
                    "||document.querySelector('a[href=\"" + target + "\"]');"
                    "if(a){a.click();return true}return false;")
                if not clicked:
                    print('   (no link to %s on page; location.assign fallback)' % hop)
                    sess.js("location.assign('" + base + '/' + hop + "');return 1;")
                time.sleep(4)
                got = sess.js("return location.pathname + location.hash;")
                if not got.endswith(hop.split('?')[0]) and target not in got:
                    failures.append('journey %s: landed on %s' % (hop, got))
                audit_step(sess, base, 'journey -> ' + hop, failures,
                           expect_soft=(args.app and bool(clicked)))
    finally:
        sess.close()
    print()
    if failures:
        print('AUDIT FAIL (%d):' % len(failures))
        for f in failures:
            print(' -', f)
        sys.exit(2)
    print('AUDIT PASS')


if __name__ == '__main__':
    main()
