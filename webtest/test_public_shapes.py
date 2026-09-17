#!/usr/bin/env python3
"""test_public_shapes.py — production's public answers keep their committed shape.

Read-only, stdlib-only (urllib, json, re). The leak that ran from 2026-08-02 to
2026-09-17 changed the SHAPE of a public answer — `GET /api/comments/recent`'s
`items` became one object holding the worker's env — and no nightly looked. This
suite asks every public JSON read on the LIVE site (and the keyed unread counts,
as the webtest's read-only alice) and holds each answer to the snapshot the unit
suite commits (tests/_support/response_shapes.json, written by
`node scripts/response_shapes.mjs --write` from the leak sweep):

  - every top-level key is one the snapshot knows (a new key on a public answer
    is a FAIL: it is either undocumented or a leak);
  - every field the snapshot records as always a list is a list (or absent/null);
  - no key anywhere is named like a worker binding, var or secret
    (comments-worker/src/env.ts).

A deeper key the snapshot has not seen (production data the unit seed never
made) is printed as a NOTE, not a FAIL. Keys that are data (a category, a hash,
an emoji code) are collapsed the way the snapshot collapses them (its
`_dynamic` map, and any 64-hex or numeric key).

Run:  cd webtest && python3 test_public_shapes.py
Prints PASS/FAIL per check and a final "==== N PASS  M FAIL ====" line; exits
non-zero on any FAIL.
"""
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
BASE = os.environ.get('MC_BASE', 'https://merecatholicity.com')
# the edge refuses Python-urllib's own agent (error 1010): a browser's
UA = {'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'}
DATA_KEY = re.compile(r'^([0-9a-f]{64}|\d+)$')

PASS = 0
FAIL = 0


def check(cond, name, detail=''):
    global PASS, FAIL
    if cond:
        PASS += 1
        print('PASS  %s' % name)
    else:
        FAIL += 1
        print('FAIL  %s%s' % (name, (' — ' + detail) if detail else ''))


def load_snapshot():
    with open(os.path.join(ROOT, 'tests', '_support', 'response_shapes.json'), encoding='utf-8') as f:
        snap = json.load(f)
    return snap.pop('_dynamic', {}), snap


def env_names():
    """Every binding, var and secret name the worker's Env declares."""
    with open(os.path.join(ROOT, 'comments-worker', 'src', 'env.ts'), encoding='utf-8') as f:
        src = f.read()
    body = src[src.index('export interface Env {'):]
    body = body[:body.index('\n}\n')]
    return set(re.findall(r'^\s*([A-Z][A-Z0-9_]*)\??:', body, re.M))


def testkey(name):
    path = os.path.join(HERE, '.testkeys')
    if not os.path.exists(path):
        return ''
    for line in open(path):
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            k, v = line.split('=', 1)
            if k.strip() == name:
                return v.strip()
    return ''


def fetch(method, path, payload=None, retries=2):
    for attempt in range(retries + 1):
        headers = dict(UA)
        data = None
        if payload is not None:
            headers['Content-Type'] = 'application/json'
            data = json.dumps(payload).encode()
        req = urllib.request.Request(BASE + path, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                status, raw = r.status, r.read()
        except urllib.error.HTTPError as e:
            status, raw = e.code, e.read()
        except Exception as e:  # network trouble: report it as the answer
            return 0, None, str(e)
        if status == 429 and attempt < retries:
            time.sleep(8)
            continue
        try:
            return status, json.loads(raw), ''
        except Exception:
            return status, None, raw[:120].decode('utf-8', 'replace')
    return status, None, ''


def type_of(v):
    if v is None:
        return 'null'
    if isinstance(v, bool):
        return 'boolean'
    if isinstance(v, (int, float)):
        return 'number'
    if isinstance(v, str):
        return 'string'
    if isinstance(v, list):
        return 'array'
    return 'object'


def paths_of(value, route, dynamic):
    """The snapshot's reading of an answer: {path: {types}} (tests/_support/shapes.mjs)."""
    dyn = set(dynamic.get(route, []))
    out = {}

    def add(path, v):
        if path:
            out.setdefault(path, set()).add(type_of(v))

    def walk(v, path, bare, depth):
        if depth > 8:
            return
        if isinstance(v, list):
            for x in v:
                add(path + '[]', x)
                walk(x, path + '[]', bare + '[]', depth + 1)
            return
        if not isinstance(v, dict):
            return
        data_keys = bare in dyn
        for k, x in v.items():
            name = '*' if (data_keys or DATA_KEY.match(k)) else k
            p = path + '.' + name if path else name
            add(p, x)
            walk(x, p, (bare + '.*') if data_keys else (bare + '.' + k if bare else k), depth + 1)

    walk(value, '', '', 0)
    return out


def all_keys(value, out):
    if isinstance(value, list):
        for x in value:
            all_keys(x, out)
    elif isinstance(value, dict):
        for k, x in value.items():
            out.add(k)
            all_keys(x, out)
    return out


def hold(label, route, status, body, snap, dynamic, forbidden):
    if not isinstance(body, dict):
        check(False, label + ': a JSON answer', 'status %s' % status)
        return
    shape = snap[route]
    known = {p.split(':')[0] for p in shape['json']}
    # `error` is the envelope's (API.md §2.1): any read may be refused
    top_known = {p for p in known if '.' not in p and '[]' not in p} | {'error'}
    new_top = sorted(set(body.keys()) - top_known)
    check(not new_top, label + ': every top-level key is known', 'new: %s' % ', '.join(new_top))
    if body.get('ok') is not False and 200 <= status < 300:
        broken = [f for f in shape['lists'] if f in body and body[f] is not None and not isinstance(body[f], list)]
        check(not broken, label + ': its lists are lists', 'not a list: %s' % ', '.join(broken))
    named = sorted(all_keys(body, set()) & forbidden)
    check(not named, label + ': no key is named like a worker secret or binding', ', '.join(named))
    unseen = sorted(p for p in paths_of(body, route, dynamic) if p not in known and p != 'error')
    if unseen:
        print('NOTE  %s: deeper keys the unit seed never made: %s' % (label, ', '.join(unseen[:8])))


def main():
    dynamic, snap = load_snapshot()
    forbidden = env_names()
    check(len(forbidden) >= 20, 'the worker env names were read (%d)' % len(forbidden))

    st, config, _ = fetch('GET', '/api/comments/config')
    open_pages = ((config or {}).get('comments') or {}).get('pages') if isinstance(config, dict) else None
    open_page = open_pages[0] if isinstance(open_pages, list) and open_pages else ''
    st, cat, _ = fetch('GET', '/api/comments/board/cat?cat=pub&p=1')
    topics = (cat or {}).get('topics') if isinstance(cat, dict) else None
    topic = topics[0] if isinstance(topics, list) and topics else {}
    topic_id = topic.get('id') or 219
    author = topic.get('author_hash') or ''

    public = [
        ('GET /api/comments/config', '/api/comments/config'),
        ('GET /api/comments/board', '/api/comments/board'),
        ('GET /api/comments/board/cat', '/api/comments/board/cat?cat=pub&p=1'),
        ('GET /api/comments/board/topic', '/api/comments/board/topic?id=%s' % topic_id),
        ('GET /api/comments/recent', '/api/comments/recent'),
        ('GET /api/comments/recent', '/api/comments/recent?p=2'),
        ('GET /api/comments/search', '/api/comments/search?q=history'),
        ('GET /api/comments/search', '/api/comments/search?q=church&sort=new'),
        ('GET /api/comments/dm/directory', '/api/comments/dm/directory'),
        ('GET /api/comments/push/vapid-key', '/api/comments/push/vapid-key'),
        ('GET /api/comments/journal', '/api/comments/journal'),
    ]
    if open_page:
        public.append(('GET /api/comments', '/api/comments?page=' + open_page))
    else:
        print('NOTE  no comments section is open: the page read was not asked')
    if author:
        public.append(('GET /api/comments/board/author', '/api/comments/board/author?hash=%s&p=1' % author))
        public.append(('GET /api/comments/profile', '/api/comments/profile?hash=%s' % author))
    for route, path in public:
        sep = '&' if '?' in path else '?'
        st, body, _ = fetch('GET', path + sep + 'probe=%d' % int(time.time() * 1000))
        hold(path, route, st, body, snap, dynamic, forbidden)
        time.sleep(0.3)

    alice = testkey('alice')
    if alice:
        for path in ('/api/comments/notifications/unread', '/api/comments/dm/unread', '/api/comments/board/unread', '/api/merecat/usage'):
            st, body, _ = fetch('POST', path, {'key': alice})
            hold(path + ' (alice)', 'POST ' + path, st, body, snap, dynamic, forbidden)
            time.sleep(0.3)
    else:
        print('NOTE  no alice key in webtest/.testkeys: the keyed counts were not asked')

    print('==== %d PASS  %d FAIL ====' % (PASS, FAIL))
    return 0 if FAIL == 0 else 1


if __name__ == '__main__':
    sys.exit(main())
