#!/usr/bin/env python3
"""probe_turnstile.py — the write-path precheck for the interactive suite.

The definitive Turnstile finding (2026-07-31): the live site runs a REAL
production managed Turnstile sitekey (0x4AAAAAAD8IYH9_xQ0HE0yB). cloakbrowser
cannot clear it headless OR headful (both stall on "Verifying...", no token is
ever issued). So the interactive suite drives writes through the server API with
a secret-gated test token, gated to the two throwaway test identities:
  - worker: verifyTurnstile() skips Turnstile when token === 'TEST:'+MC_TEST_BYPASS
    AND the author hash is in TEST_HASHES (both wrangler secrets; inert without them).
  - kit: MC_TEST_TOKEN='TEST:<secret>' (env or webtest/.testkeys).

This precheck verifies the write path is healthy AND still safe:
  1. real Turnstile REJECTS a fake token (protection intact for real users),
  2. the bypass is GATED (a non-test key + the token is still rejected),
  3. the configured test token WRITES (bypass working).

Run:  python3 webtest/probe_turnstile.py
"""
import json
import sys
import time
import urllib.error
import urllib.request

from live_kit import BASE, TEST_TOKEN, keys, hash_of


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

    # 1. real Turnstile rejects a fake token (still protecting real users)
    st, _ = api('/api/comments', {'key': alice, 'cat': 'pub',
                                  'title': 'probe fake token', 'body': 'body', 'token': 'not-a-real-token'})
    checks.append(('real Turnstile rejects a fake token', st == 403, 'HTTP %s' % st))

    # 2. bypass is gated: a non-test key presenting the real token is still rejected
    st, _ = api('/api/comments', {'key': 'ZZnotAtestKey_' + ('9' * 30), 'cat': 'pub',
                                  'title': 'probe gating', 'body': 'body', 'token': TEST_TOKEN or 'TEST:none'})
    checks.append(('bypass gated to test identities (others 403)', st == 403, 'HTTP %s' % st))

    # 3. the configured test token writes
    if TEST_TOKEN:
        st, d = api('/api/comments', {'key': alice, 'cat': 'pub',
                                      'title': 'probe write %d' % int(time.time()),
                                      'body': 'A benign automated write-path check.', 'token': TEST_TOKEN})
        cid = (d.get('comment') or {}).get('id')
        checks.append(('test token writes (status=%s)' % d.get('status'), bool(d.get('ok') and cid),
                       json.dumps(d)[:90]))
        if cid:
            api('/api/comments/delete', {'key': alice, 'id': cid})
    else:
        checks.append(('MC_TEST_TOKEN configured', False, 'set it in webtest/.testkeys to enable writes'))

    ok = True
    for name, passed, detail in checks:
        print(('PASS ' if passed else 'FAIL '), name, '—', detail)
        ok = ok and passed
    print('\nWRITE PATH:', 'HEALTHY' if ok else 'PROBLEM')
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
