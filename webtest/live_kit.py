#!/usr/bin/env python3
"""live_kit.py — the interactive, multi-user, real-time test harness.

Drives N simultaneous cloakbrowser users against the LIVE site and asserts the
real-time platform: WebSocket live delivery (the `mc-live` seam), cross-context
DOM merges (board index / category / open thread / DM / notifications), and the
DevTools surface (console errors + the network waterfall) — the things a curl
or a single-page render can never prove.

Design
------
- `LiveUser(Flow)` extends the standing `webtest/flows.py` driver (already
  multi-user-safe: per-port, per-profile). It adds identity login, the in-page
  `mc-live` event collector, live-event waiting, and the four console/network
  detections lifted from audit.py.
- WRITES go through the server API (`api()`), not the browser, because every
  write is Turnstile-gated and headless/headful cloakbrowser cannot clear the
  production managed challenge (proven 2026-07-31). A write therefore needs a
  token the server will accept: set `MC_TEST_TOKEN` in the environment to the
  secret-gated test token (see the worker's TEST-bypass). With no token the
  write helpers return {'blocked': True} and the write scenarios report BLOCKED
  rather than falsely passing. Observation (login, sockets, DOM, console/net)
  needs no token and always runs.

Usage
-----
    from live_kit import LiveUser, Party, keys, write_post, watch
    ks = keys()                          # {'alice': <key>, 'bob': <key>}
    with Party(LiveUser('A', ks['alice'], 9560),
               LiveUser('B', ks['bob'],   9561)) as (A, B):
        B.nav('community.html')          # subscribes board:index, collector armed
        r = write_post(ks['alice'], cat='pub', title='hi', body='hello')   # API write
        B.wait_live(lambda e: e['t'] == 'new-topic')   # B sees it live
"""
import glob
import hashlib
import json
import os
import time
import urllib.error
import urllib.request

# Reuse the standing driver + its console/network capture wholesale.
from flows import Flow, BASE, BENIGN_CONSOLE, api  # noqa: F401

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read_testkeys():
    """The git-ignored webtest/.testkeys -> {NAME: value}. Holds the identity
    keys AND the MC_TEST_TOKEN write token. Never committed."""
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
# The secret-gated test token the worker accepts in place of a Turnstile token
# for the designated test identities (from env, or the .testkeys file). Empty =>
# writes are blocked (observe-only).
TEST_TOKEN = os.environ.get('MC_TEST_TOKEN', '') or _TESTKEYS.get('MC_TEST_TOKEN', '')


def _newest_chrome():
    """Resolve the newest ~/.cloakbrowser/chromium-* so the version pin can't rot."""
    dirs = sorted(glob.glob(os.path.expanduser('~/.cloakbrowser/chromium-*')))
    return dirs[-1] if dirs else None


def keys():
    """Identity keys from the git-ignored webtest/.testkeys -> {name: key}
    (config entries like MC_TEST_TOKEN excluded)."""
    return {k: v for k, v in _TESTKEYS.items() if k.isupper() is False and k != 'MC_TEST_TOKEN'}


def hash_of(key):
    return hashlib.sha256(key.encode()).hexdigest()


# ---- server-side write helpers (Turnstile-gated => need MC_TEST_TOKEN) -------

def _write(key, body):
    """POST a write. Injects the test token; returns {'blocked':True} if none."""
    if not TEST_TOKEN and 'token' not in body:
        return {'blocked': True, 'error': 'no MC_TEST_TOKEN (Turnstile write path unavailable)'}
    payload = dict(body)
    payload.setdefault('token', TEST_TOKEN)
    payload['key'] = key
    ep = payload.pop('_ep')
    try:
        return _post(ep, payload)
    except Exception as e:
        return {'ok': False, 'error': str(e)}


def _post(ep, payload, retries=4, wait=22):
    """POST with automatic retry on the per-IP rate limits (429 or a 'Too many'
    body). Two users behind one egress IP share POST_LIMIT, so a fast suite trips
    it; a regression run trades wall-clock for correctness."""
    for attempt in range(retries + 1):
        req = urllib.request.Request(
            BASE + ep, data=json.dumps(payload).encode(),
            headers={'Content-Type': 'application/json', 'User-Agent': 'curl/8.14.1'}, method='POST')
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                d = json.loads(r.read())
        except urllib.error.HTTPError as e:
            code = e.code
            try:
                d = json.loads(e.read())
            except Exception:
                d = {'ok': False, 'error': 'HTTP %d' % code}
            if code == 429 and attempt < retries:
                time.sleep(wait)
                continue
            return d
        # some limiters answer 200 ok:false with a 'Too many' message
        if (not d.get('ok')) and 'too many' in str(d.get('error', '')).lower() and attempt < retries:
            time.sleep(wait)
            continue
        return d
    return {'ok': False, 'error': 'rate-limit retries exhausted'}


def write_post(key, cat=None, topic=None, page=None, title=None, body='', mentions=None):
    """Create a topic (cat+title), a reply (topic), or a page comment (page)."""
    d = {'_ep': '/api/comments', 'body': body}
    if cat is not None:
        d['cat'] = cat
        d['title'] = title
    elif topic is not None:
        d['topic'] = topic
    elif page is not None:
        d['page'] = page
    if mentions:
        d['mentions'] = mentions
    return _write(key, d)


def write_dm(key, to_hash, body, enc=None):
    d = {'_ep': '/api/comments/dm/send', 'to': to_hash, 'body': body}
    if enc is not None:
        d['enc'] = enc
    return _write(key, d)


def delete_comment(key, cid):
    return _post('/api/comments/delete', {'key': key, 'id': cid})


# ---- keyed, NON-Turnstile writes (always available) -------------------------

def watch(key, topic, on=True):
    return _post('/api/comments/watch', {'key': key, 'topic': topic,
                                         'act': 'watch' if on else 'unwatch'})


def notif_unread(key):
    d = _post('/api/comments/notifications/unread', {'key': key})
    return d.get('unread', -1)


def dm_unread(key):
    d = _post('/api/comments/dm/unread', {'key': key})
    return d.get('unread', -1)


# ---- the browser user -------------------------------------------------------

_COLLECTOR = (
    "window.__mcLive=window.__mcLive||[];"
    "if(!window.__mcLiveHook){window.__mcLiveHook=1;"
    "document.addEventListener('mc-live',function(e){window.__mcLive.push({at:Date.now(),d:e.detail});});"
    "document.addEventListener('mc-live-resync',function(){window.__mcLive.push({at:Date.now(),d:{t:'__resync'}});});}"
    "return (window.__mcLive||[]).length;"
)


class LiveUser(Flow):
    """A logged-in browser user with the live-event collector armed."""

    def __init__(self, name, key, port):
        super().__init__(port=port)
        self.name = name
        self.key = key
        self.hash = hash_of(key)

    def login(self):
        """Log in with this user's key; wait for the member hash + live socket."""
        self.goto('community.html')
        self.js("localStorage.setItem('mc-comment-key', %s); return 1;" % json.dumps(self.key))
        self.goto('community.html')
        ok = self.wait("window.mcKit && window.mcKit.state && window.mcKit.state.myHash === %s"
                       % json.dumps(self.hash), timeout=15)
        self.arm()
        return ok

    def nav(self, view):
        """Hard-navigate to community.html?<view> (or a full page), then re-arm
        the collector (a hard nav makes a fresh document). Waits for boot."""
        page = view if view.startswith(('community.html', 'index.html', 'http')) or view.endswith('.html') else ('community.html?' + view)
        self.goto(page)
        time.sleep(1.5)
        self.arm()

    def arm(self):
        """Install the mc-live collector on the current document."""
        self.js(_COLLECTOR)

    def live_events(self):
        return self.js("return (window.__mcLive||[]).map(function(x){return x.d;});") or []

    def clear_live(self):
        self.js("window.__mcLive=[]; return 1;")

    def wait_live(self, pred, timeout=20, every=0.7):
        """Wait until some collected mc-live frame satisfies pred(frame). Returns
        the matching frame or None."""
        t0 = time.time()
        while time.time() - t0 < timeout:
            for ev in self.live_events():
                try:
                    if ev and pred(ev):
                        return ev
                except Exception:
                    pass
            time.sleep(every)
        self.failures.append('%s: no mc-live frame matched within %ds' % (self.name, timeout))
        return None

    def saw_live(self, pred):
        """Non-blocking: did any collected frame satisfy pred?"""
        for ev in self.live_events():
            try:
                if ev and pred(ev):
                    return ev
            except Exception:
                pass
        return None

    # -- console + network gate (the DevTools requirement) --------------------
    def net_responses(self):
        """performance log -> response events [{url,status,kind}]."""
        out = []
        for entry in self._logs('performance'):
            try:
                m = json.loads(entry['message'])['message']
            except Exception:
                continue
            if m.get('method') == 'Network.responseReceived':
                r = m.get('params', {}).get('response', {})
                out.append({'url': r.get('url', ''), 'status': r.get('status', 0),
                            'kind': m.get('params', {}).get('type', '')})
        return out

    def devtools_findings(self, label=''):
        """The four detections from audit.py: console SEVERE (minus benign),
        same-origin >=400 (429 on /api exempt), duplicate asset loads, and
        unexpected Document requests. Returns a list of finding strings."""
        found = []
        console = self._logs('browser')
        errs = [c for c in console if c.get('level') == 'SEVERE'
                and not any(b in c.get('message', '') for b in BENIGN_CONSOLE)]
        for e in errs[:5]:
            found.append('%s console SEVERE: %s' % (label, e.get('message', '')[:160]))
        resp = self.net_responses()
        bad = [r for r in resp if r['url'].startswith(BASE) and (r['status'] or 0) >= 400
               and not (r['status'] == 429 and '/api/' in r['url'])
               and 'cdn-cgi/' not in r['url']]  # cdn-cgi is Cloudflare-injected, not ours
        for r in bad[:5]:
            found.append('%s HTTP %s: %s' % (label, r['status'], r['url']))
        seen = {}
        for r in resp:
            u = r['url']
            if not u.startswith(BASE) or 'cdn-cgi/' in u:
                continue
            if any(u.split('?')[0].endswith(x) for x in ('.js', '.css', '.json', '.webp', '.jpg', '.png')):
                seen[u] = seen.get(u, 0) + 1
                if seen[u] == 2:
                    found.append('%s duplicate load: %s' % (label, u))
        return found

    def socket_open(self):
        """True if the board WebSocket is OPEN (readyState 1). Defensive against
        the minified mcLive internals."""
        return bool(self.js(
            "try{var c=window.mcLive&&window.mcLive._conns;if(!c)return false;"
            "var vs=Object.keys(c).map(function(k){return c[k];});"
            "return vs.some(function(v){return v&&v.ws&&v.ws.readyState===1;});}"
            "catch(e){return false;}"))

    def waterfall(self):
        """Print the same-origin network waterfall (for failure diagnosis)."""
        print('  -- %s network --' % self.name)
        for r in self.net_responses():
            if r['url'].startswith(BASE):
                print('    %s %-9s %s' % (r['status'], r['kind'], r['url'][len(BASE):][:90]))


class Party:
    """Holds N LiveUsers alive at once; logs each in; tears all down."""

    def __init__(self, *users):
        self.users = users

    def __enter__(self):
        for u in self.users:
            u.login()
        return self.users if len(self.users) != 1 else self.users[0]

    def __exit__(self, *a):
        for u in self.users:
            try:
                u.close()
            except Exception:
                pass

    def failures(self):
        out = []
        for u in self.users:
            out += ['%s: %s' % (u.name, f) for f in u.failures]
        return out
