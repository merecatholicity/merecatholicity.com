#!/usr/bin/env python3
"""probe_turnstile.py — the write-path precheck for the interactive suite.

The live site runs a REAL production managed Turnstile sitekey
(0x4AAAAAAD8IYH9_xQ0HE0yB); cloakbrowser cannot clear it headless or headful
(proven 2026-07-31). The interactive suite therefore writes through the server
API as the two ESTABLISHED test identities, sending no token: the worker spares
an established identity that offers none (Domain.Turnstile,
`turnstile_skip_established`). The secret-gated `TEST:` bypass that did this
job was retired on 2026-09-17 after the env disclosure published its secret.

This precheck verifies the write path is healthy AND still safe:
  1. a fake token is refused (a token that IS offered is always verified);
  2. the retired `TEST:` token is refused like any fake token;
  3. a fresh, unestablished key with no token is refused (the skip is earned);
  4. an established test identity writes with no token (then deletes it).

Run:  python3 webtest/probe_turnstile.py
"""
import json
import sys
import time
import urllib.error
import urllib.request

from live_kit import BASE, keys


def api(path, body):
    req = urllib.request.Request(
        BASE + path, data=json.dumps(body).encode(),
        headers={'Content-Type': 'application/json', 'User-Agent': 'curl/8.14.1'}, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read())
        except Exception:
            return e.code, {}


def main():
    ks = keys()
    alice = ks['alice']
    checks = []

    # 1. a fake token is refused (a presented token is always verified)
    st, _ = api('/api/comments', {'key': alice, 'cat': 'pub',
                                  'title': 'probe fake token', 'body': 'body', 'token': 'not-a-real-token'})
    checks.append(('a fake token is refused', st == 403, 'HTTP %s' % st))

    # 2. the retired bypass token is just another fake token
    st, _ = api('/api/comments', {'key': alice, 'cat': 'pub',
                                  'title': 'probe retired bypass', 'body': 'body', 'token': 'TEST:retired'})
    checks.append(('the retired TEST: token is refused', st == 403, 'HTTP %s' % st))

    # 3. a fresh key sending no token is not spared
    st, _ = api('/api/comments', {'key': 'ZZprobeUnestablished_' + str(int(time.time())) + ('9' * 20), 'cat': 'pub',
                                  'title': 'probe fresh key', 'body': 'body'})
    checks.append(('a fresh key without a token is refused', st == 403, 'HTTP %s' % st))

    # 4. the established test identity writes with no token, and the row goes again
    st, d = api('/api/comments', {'key': alice, 'cat': 'pub',
                                  'title': 'probe write %d' % int(time.time()),
                                  'body': 'A benign automated write-path check.'})
    cid = (d.get('comment') or {}).get('id')
    checks.append(('an established identity writes with no token (status=%s)' % d.get('status'),
                   bool(d.get('ok') and cid), json.dumps(d)[:90]))
    if cid:
        api('/api/comments/delete', {'key': alice, 'id': cid})

    ok = True
    for name, passed, detail in checks:
        print(('PASS ' if passed else 'FAIL '), name, '—', detail)
        ok = ok and passed
    print('\nWRITE PATH:', 'HEALTHY' if ok else 'PROBLEM')
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
