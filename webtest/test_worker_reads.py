#!/usr/bin/env python3
"""test_worker_reads.py — the broad READ-surface regression sweep.

Stdlib-only (urllib, json, hashlib — no browser, no third-party deps). Hits a
wide swath of the comments worker's READ endpoints on the LIVE site and
asserts each response is well-shaped: right HTTP status, valid JSON, `ok`
where applicable, and the 2-3 fields a caller actually depends on, with the
right type/shape. This is the safety net for the Phase 3-4 SQL/structure
refactor of comments-worker/src/index.ts — it exists to catch a regression
that `webtest/test_interactive.py`'s five live-forum scenarios don't reach
(e.g. a column rename in the board index CTE, a broken JOIN in search, a
shape change in /config that silently drops a field the client reads).

Endpoints are read straight from comments-worker/src/index.ts (the route
dispatch, `path === '/api/...' && request.method === '...'`, near the
`async fetch(request` handler) and the corresponding `handleX` function
bodies — the exact paths, params, and JSON field names below are copied from
there, not guessed. Keyed reads use the throwaway identities in the
git-ignored webtest/.testkeys (same file/format live_kit.py reads; loaded
here with a tiny standalone reader so this script has zero project imports).

Assertions are SHAPE/invariant checks (types, lengths that are law — 14 board
categories, 3 faiths, 9 ranks, 66 Bible books — presence of key fields), never
exact volatile values (post counts, timestamps, ids all change on prod).

Run:
    cd webtest && python3 test_worker_reads.py

Exits non-zero if any check FAILs. Prints PASS/FAIL per check and a final
"==== N PASS  M FAIL ====" line.

Coverage gaps (found in the source, NOT exercised here — see the report this
script's author gave alongside it): every WRITE endpoint (Turnstile-gated, not
a read); /api/merecat/about and /api/merecat/works (admin-only — the
webtest .testkeys identities are ordinary, non-admin members, confirmed live:
about -> 403 {"ok":false,"error":"No."}); /api/comments/feed (RSS/XML, not
JSON — a structurally different contract); /api/comments/board/admin and the
back room's keyed view (admin-only); /api/comments/dm/presence and
/dm/blocked (need a second identity + a real thread, thin payoff for a
structure smoke test); /@<handle> handleHandleCard (server-rendered HTML, not
JSON).
"""
import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.request

BASE = os.environ.get('MC_BASE', 'https://merecatholicity.com')
# Cloudflare's edge WAF 403s (error code 1010) the default Python-urllib
# User-Agent outright — every request needs a browser-ish UA to reach the
# worker at all (the same gotcha CLAUDE.md and live_kit.py both record).
HEADERS = {'User-Agent': 'curl/8.14.1'}

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


def _read_testkeys():
    """webtest/.testkeys -> {NAME: value}. Same tiny format live_kit.py reads
    (git-ignored, never committed): identity keys plus MC_TEST_TOKEN."""
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.testkeys')
    out = {}
    if os.path.exists(path):
        for line in open(path):
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                k, v = line.split('=', 1)
                out[k.strip()] = v.strip()
    return out


_TESTKEYS = _read_testkeys()
ALICE = _TESTKEYS.get('alice', '')
ALICE_HASH = hashlib.sha256(ALICE.encode()).hexdigest() if ALICE else ''


def _fetch(method, path, payload=None, retries=2):
    """One HTTP round-trip against the live worker. Returns (status, parsed
    JSON or None, raw bytes). Retries once or twice on a 429 (READ_LIMIT is a
    single per-IP bucket shared by every read endpoint on this box; other
    concurrent test runs can trip it) with a short backoff."""
    for attempt in range(retries + 1):
        headers = dict(HEADERS)
        data = None
        if payload is not None:
            headers['Content-Type'] = 'application/json'
            data = json.dumps(payload).encode()
        req = urllib.request.Request(BASE + path, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                raw = r.read()
                status = r.status
        except urllib.error.HTTPError as e:
            raw = e.read()
            status = e.code
        except Exception as e:
            return 0, None, str(e).encode()
        if status == 429 and attempt < retries:
            time.sleep(8)
            continue
        try:
            parsed = json.loads(raw)
        except Exception:
            parsed = None
        return status, parsed, raw
    return status, None, raw


def get(path):
    return _fetch('GET', path)


def post(path, payload):
    return _fetch('POST', path, payload)


def is_str(v):
    return isinstance(v, str)


def is_int(v):
    return isinstance(v, int) and not isinstance(v, bool)


def is_hex64(v):
    return is_str(v) and len(v) == 64 and all(c in '0123456789abcdef' for c in v)


# ---------------------------------------------------------------------------
# GET /api/comments/config — the shared-constants surface (Domain.Board,
# Domain.Faith, Domain.Rank, Domain.Scripture, Domain.Emoji all flow through
# this one endpoint, so it alone catches a lot of possible drift).
# ---------------------------------------------------------------------------
st, d, raw = get('/api/comments/config')
ok = st == 200 and d is not None and d.get('ok') is True
check(ok, 'config: 200 + ok:true', str(raw[:200]))
if ok:
    check(isinstance(d.get('cats'), list) and len(d['cats']) == 14,
          'config: cats is a 14-entry array (13 rooms + the back room)',
          'got %r' % (d.get('cats'),))
    check(isinstance(d.get('faiths'), list) and len(d['faiths']) == 3
          and {f['code'] for f in d['faiths']} == {'nicene', 'indo-european', 'seeker'},
          'config: faiths is the fixed 3-code set', 'got %r' % (d.get('faiths'),))
    check(isinstance(d.get('ranks'), list) and len(d['ranks']) == 9,
          'config: ranks is the 9-rung ladder', 'got %r' % (d.get('ranks'),))
    check(isinstance(d.get('bible'), list) and len(d['bible']) == 66
          and all('slug' in b and 'spellings' in b for b in d['bible'][:3]),
          'config: bible has all 66 books with slug+spellings', 'len=%r' % (len(d.get('bible', [])),))
    check(is_int(d.get('apiVersion')) and is_hex64(d.get('bot_hash')),
          'config: apiVersion is int, bot_hash is 64-hex', 'got %r/%r' % (d.get('apiVersion'), d.get('bot_hash')))
    emoji = d.get('emoji') or {}
    check(isinstance(emoji.get('custom'), dict) and isinstance(emoji.get('named'), dict)
          and is_str(emoji.get('data_url')),
          'config: emoji.{custom,named,data_url} shaped', 'got %r' % (emoji,))
else:
    for n in ('config: cats', 'config: faiths', 'config: ranks', 'config: bible',
              'config: apiVersion/bot_hash', 'config: emoji'):
        check(False, n, 'skipped, config itself failed')

# ---------------------------------------------------------------------------
# GET /api/comments?page=<PAGES entry> — article-page comments (handleGet).
# ---------------------------------------------------------------------------
st, d, raw = get('/api/comments?page=/book.html')
check(st == 200 and d is not None and d.get('ok') is True
      and isinstance(d.get('comments'), list) and isinstance(d.get('anon'), bool),
      'GET /api/comments?page=/book.html: shape', str(raw[:200]))

# ---------------------------------------------------------------------------
# GET /api/comments/board — the board index (windowed per-category CTE).
# ---------------------------------------------------------------------------
st, d, raw = get('/api/comments/board')
ok = st == 200 and d is not None and d.get('ok') is True and isinstance(d.get('cats'), dict)
check(ok, 'GET /api/comments/board: 200 + ok:true + cats dict', str(raw[:200]))
if ok:
    pub = d['cats'].get('pub')
    check(isinstance(pub, dict) and is_int(pub.get('topics')) and is_int(pub.get('posts'))
          and isinstance(pub.get('latest'), dict) and 'title' in pub['latest'] and 'assigned' in pub['latest'],
          'board index: pub category has topics/posts/latest{title,assigned}', 'got %r' % (pub,))
else:
    check(False, 'board index: pub category shape', 'skipped, index itself failed')

# ---------------------------------------------------------------------------
# GET /api/comments/board/cat?cat=pub — one category listing.
# ---------------------------------------------------------------------------
st, d, raw = get('/api/comments/board/cat?cat=pub&p=1')
ok = st == 200 and d is not None and d.get('ok') is True
check(ok and isinstance(d.get('topics'), list) and is_int(d.get('total'))
      and d.get('page') == 1 and d.get('per') == 20,
      'board/cat?cat=pub: shape (topics list, total int, page=1, per=20)', str(raw[:200]))
sample_topic_id = None
if ok and d.get('topics'):
    t0 = d['topics'][0]
    sample_topic_id = t0.get('id')
    check(is_int(t0.get('id')) and is_str(t0.get('title')) and is_hex64(t0.get('author_hash'))
          and 'assigned' in t0,
          'board/cat?cat=pub: topic row has id/title/author_hash/assigned', 'got %r' % (t0,))
else:
    check(False, 'board/cat?cat=pub: topic row shape', 'no topics returned to sample')

# Unknown category and the back room must both refuse identically (a prober
# must not be able to tell "adminsonly" from a category that doesn't exist).
st1, d1, raw1 = get('/api/comments/board/cat?cat=doesnotexist999')
check(st1 == 400 and d1 is not None and d1.get('ok') is False,
      'board/cat: unknown category -> 400 ok:false', str(raw1[:200]))
st2, d2, raw2 = get('/api/comments/board/cat?cat=adminsonly')
check(st2 == 400 and d2 is not None and d2.get('ok') is False and d2.get('error') == (d1.get('error') if d1 else None),
      'board/cat: back room refuses byte-identically to an unknown category', str(raw2[:200]))

# ---------------------------------------------------------------------------
# GET /api/comments/board/topic?id=<n> — one topic + its live replies.
# ---------------------------------------------------------------------------
if sample_topic_id:
    st, d, raw = get('/api/comments/board/topic?id=%d' % sample_topic_id)
    ok = st == 200 and d is not None and d.get('ok') is True
    topic = d.get('topic') if ok else None
    check(ok and isinstance(topic, dict) and topic.get('id') == sample_topic_id
          and isinstance(d.get('replies'), list) and is_int(d.get('total')) and is_str(d.get('cat')),
          'board/topic?id=%d: shape (topic, replies list, total, cat)' % sample_topic_id, str(raw[:200]))
else:
    check(False, 'board/topic?id=<sampled>: shape', 'no sample topic id available')

st, d, raw = get('/api/comments/board/topic?id=999999999')
check(st == 404 and d is not None and d.get('ok') is False,
      'board/topic?id=<bogus>: 404 ok:false ("No such topic.")', str(raw[:200]))

# ---------------------------------------------------------------------------
# GET /api/comments/board/author?hash=<64hex> — a member's forum post history.
# ---------------------------------------------------------------------------
if ALICE_HASH:
    st, d, raw = get('/api/comments/board/author?hash=%s&p=1' % ALICE_HASH)
    check(st == 200 and d is not None and d.get('ok') is True
          and isinstance(d.get('items'), list) and is_int(d.get('total')),
          'board/author?hash=<alice>: shape (items list, total int)', str(raw[:200]))
else:
    check(False, 'board/author?hash=<alice>: shape', 'no alice key in .testkeys')

st, d, raw = get('/api/comments/board/author?hash=not-a-valid-hash')
check(st == 400 and d is not None and d.get('ok') is False,
      'board/author: malformed hash -> 400 ok:false', str(raw[:200]))

# ---------------------------------------------------------------------------
# GET /api/comments/search — FTS5 over the forum only.
# ---------------------------------------------------------------------------
st, d, raw = get('/api/comments/search?q=history')
check(st == 200 and d is not None and d.get('ok') is True
      and isinstance(d.get('items'), list) and is_int(d.get('total')) and d.get('q') == 'history',
      'search?q=history: shape (items list, total int, q echoed)', str(raw[:200]))

st, d, raw = get('/api/comments/search?q=')
check(st == 200 and d is not None and d.get('ok') is True
      and d.get('items') == [] and d.get('total') == 0,
      'search?q=<empty>: safe empty result, not an error', str(raw[:200]))

# ---------------------------------------------------------------------------
# GET /api/comments/profile?hash=<64hex>
# ---------------------------------------------------------------------------
if ALICE_HASH:
    st, d, raw = get('/api/comments/profile?hash=%s' % ALICE_HASH)
    ok = st == 200 and d is not None and d.get('ok') is True
    prof = d.get('profile') if ok else None
    check(ok and isinstance(prof, dict) and prof.get('hash') == ALICE_HASH
          and is_int(prof.get('posts')) and is_str(prof.get('rank')) and is_str(prof.get('assigned')),
          'profile?hash=<alice>: shape (hash echoed, posts int, rank/assigned str)', str(raw[:200]))
else:
    check(False, 'profile?hash=<alice>: shape', 'no alice key in .testkeys')

st, d, raw = get('/api/comments/profile?hash=not-a-valid-hash')
check(st == 400 and d is not None and d.get('ok') is False,
      'profile: malformed hash -> 400 ok:false', str(raw[:200]))

# ---------------------------------------------------------------------------
# GET /api/comments/dm/directory — the cacheable member directory.
# ---------------------------------------------------------------------------
st, d, raw = get('/api/comments/dm/directory')
ok = st == 200 and d is not None and d.get('ok') is True and isinstance(d.get('users'), list)
check(ok and len(d['users']) > 0 and is_hex64(d['users'][0].get('hash')) and 'assigned' in d['users'][0],
      'dm/directory: shape (users list of {hash,assigned,...})', str(raw[:200]))

# ---------------------------------------------------------------------------
# GET /api/comments/push/vapid-key
# ---------------------------------------------------------------------------
st, d, raw = get('/api/comments/push/vapid-key')
check(st == 200 and d is not None and d.get('ok') is True and is_str(d.get('key')) and len(d.get('key', '')) > 20,
      'push/vapid-key: shape (non-empty public key string)', str(raw[:200]))

# ---------------------------------------------------------------------------
# Keyed POST reads (identity from webtest/.testkeys).
# ---------------------------------------------------------------------------
if ALICE:
    st, d, raw = post('/api/merecat/usage', {'key': ALICE})
    check(st == 200 and d is not None and d.get('ok') is True
          and is_int(d.get('cap')) and is_int(d.get('gcap')) and isinstance(d.get('admin'), bool)
          and is_str(d.get('backend')),
          'merecat/usage: shape (cap/gcap int, admin bool, backend str)', str(raw[:200]))

    st, d, raw = post('/api/comments/notifications/unread', {'key': ALICE})
    check(st == 200 and d is not None and d.get('ok') is True and is_int(d.get('unread')) and d['unread'] >= 0,
          'notifications/unread: shape (unread int >= 0)', str(raw[:200]))

    st, d, raw = post('/api/comments/dm/unread', {'key': ALICE})
    check(st == 200 and d is not None and d.get('ok') is True and is_int(d.get('unread')) and d['unread'] >= 0,
          'dm/unread: shape (unread int >= 0)', str(raw[:200]))

    st, d, raw = post('/api/comments/board/unread', {'key': ALICE})
    check(st == 200 and d is not None and d.get('ok') is True
          and is_int(d.get('total')) and isinstance(d.get('byCat'), dict),
          'board/unread: shape (total int, byCat dict)', str(raw[:200]))

    # Admin-only read, exercised here only to CONFIRM the gate itself still
    # refuses a non-admin identity the documented way (not a positive-shape
    # check — alice/bob are ordinary members, see the module docstring).
    st, d, raw = post('/api/merecat/about', {'key': ALICE})
    check(st == 403 and d is not None and d.get('ok') is False,
          'merecat/about: non-admin identity refused (403 ok:false)', str(raw[:200]))
else:
    for n in ('merecat/usage', 'notifications/unread', 'dm/unread', 'board/unread',
              'merecat/about (admin gate)'):
        check(False, n, 'no alice key in webtest/.testkeys')

print()
print('==== %d PASS  %d FAIL ====' % (PASS, FAIL))
sys.exit(1 if FAIL else 0)
