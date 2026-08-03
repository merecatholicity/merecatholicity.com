#!/usr/bin/env python3
"""flows.py — the per-feature test library for the interior campaign.

Every slice's headless test is written in these terms: a real Chromium
session (console + network logs on), the owner's identity, back-room
writes that clean up after themselves, and assertions that read like the
feature they guard. Stdlib only, like everything in webtest/.

  from flows import Flow
  with Flow() as f:
      f.login()
      f.goto('community.html')
      f.click('a[href="community.html?cat=pub"]')
      f.wait(lambda: f.js1("return document.querySelectorAll('.board-topic').length") > 0)
      f.assert_console_clean()
      f.assert_soft()            # no Document request since last drain
"""
import json
import os
import signal
import subprocess
import time
import urllib.error
import urllib.request

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHROME_DIR = os.path.expanduser('~/.cloakbrowser/chromium-146.0.7680.177.5')
BASE = os.environ.get('MC_BASE', 'https://merecatholicity.com')
BENIGN_CONSOLE = (
    "The Content Security Policy directive 'upgrade-insecure-requests' is ignored",
    'cdn-cgi/challenge-platform',
    'static.cloudflareinsights.com',
    'the server responded with a status of 429',
)


def owner_key():
    return open(os.path.join(REPO, 'librarian/.key')).read().strip()


def api(path, body, ua='curl/8.14.1'):
    """Server-to-server call with a UA the edge accepts (urllib's default is 403'd)."""
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode(),
                                 headers={'Content-Type': 'application/json',
                                          'User-Agent': ua}, method='POST')
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


class Flow:
    def __init__(self, port=9560, autoplay=False, hover=False, mic=None):
        self.port = port
        args = ['--headless=new', '--no-sandbox', '--disable-gpu',
                '--disable-dev-shm-usage', '--window-size=1280,900',
                '--user-data-dir=/tmp/mc-flow-%d-%d' % (port, int(time.time()))]
        if autoplay:
            args.append('--autoplay-policy=no-user-gesture-required')
        if mic == 'fake':
            # getUserMedia yields a fake tone track with no permission prompt
            args += ['--use-fake-device-for-media-stream',
                     '--use-fake-ui-for-media-stream']
        elif mic == 'deny':
            # fake device but NO fake-ui: headless=new auto-denies the
            # permission prompt, so getUserMedia rejects NotAllowedError
            # deterministically (prod's Permissions-Policy microphone=()
            # header forces the same denial today regardless)
            args.append('--use-fake-device-for-media-stream')
        if hover:
            # headless=new reports (hover: none) by default; desktop probes
            # (the scripture tips) need an emulated fine pointer
            args.append('--blink-settings=primaryHoverType=2,availableHoverTypes=2,'
                        'primaryPointerType=4,availablePointerTypes=4')
        self.drv = subprocess.Popen(
            [os.path.join(CHROME_DIR, 'chromedriver'), '--port=%d' % port],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        time.sleep(1.5)
        self.sid = self._wd('POST', '/session', {'capabilities': {'alwaysMatch': {
            'goog:chromeOptions': {'binary': os.path.join(CHROME_DIR, 'chrome'),
                                   'args': args,
                                   'perfLoggingPrefs': {'enableNetwork': True}},
            'goog:loggingPrefs': {'browser': 'ALL', 'performance': 'ALL'},
        }}})['value']['sessionId']
        self.failures = []

    # -- plumbing --------------------------------------------------------
    def _wd(self, m, p, b=None):
        d = json.dumps(b).encode() if b is not None else None
        req = urllib.request.Request('http://127.0.0.1:%d%s' % (self.port, p),
                                     data=d, method=m,
                                     headers={'Content-Type': 'application/json'})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            # a page-side exception is a FINDING, never a harness crash
            try:
                detail = json.loads(e.read()).get('value', {}).get('message', '')[:200]
            except Exception:
                detail = 'HTTP %d' % e.code
            self.failures.append('webdriver: %s' % detail)
            return {'value': None}

    def js(self, script):
        return self._wd('POST', '/session/%s/execute/sync' % self.sid,
                        {'script': script, 'args': []})['value']

    def js1(self, script):
        """script must `return` a JSON-able value"""
        return self.js(script)

    def _logs(self, kind):
        for path in ('/session/%s/se/log' % self.sid, '/session/%s/log' % self.sid):
            try:
                return self._wd('POST', path, {'type': kind})['value'] or []
            except Exception:
                continue
        return []

    # -- actions ---------------------------------------------------------
    def goto(self, page):
        self._wd('POST', '/session/%s/url' % self.sid, {'url': BASE + '/' + page})
        time.sleep(1.5)

    def login(self, key=None):
        self.goto('community.html')
        self.js("localStorage.setItem('mc-comment-key', %s); return 1;"
                % json.dumps(key or owner_key()))
        self.goto('community.html')
        time.sleep(2)

    def click(self, sel):
        ok = self.js("var a=document.querySelector(%s); if(!a) return false; a.click(); return true;"
                     % json.dumps(sel))
        if not ok:
            self.failures.append('click: no element %s' % sel)
        return ok

    def type_into(self, sel, text):
        return self.js("""var t=document.querySelector(%s); if(!t) return false;
          t.focus(); t.value=%s; t.dispatchEvent(new Event('input',{bubbles:true})); return true;"""
                       % (json.dumps(sel), json.dumps(text)))

    def wait(self, js_pred, timeout=20, every=1.0):
        """js_pred: a JS expression string returning truthy when ready."""
        t0 = time.time()
        while time.time() - t0 < timeout:
            if self.js('return !!(%s);' % js_pred):
                return True
            time.sleep(every)
        self.failures.append('wait: timeout on %s' % js_pred[:80])
        return False

    def drain(self):
        self._logs('browser')
        self._logs('performance')

    # -- assertions ------------------------------------------------------
    def assert_console_clean(self, label=''):
        errs = [c for c in self._logs('browser') if c.get('level') == 'SEVERE'
                and not any(b in c.get('message', '') for b in BENIGN_CONSOLE)]
        if errs:
            self.failures.append('%s console: %s' % (label, [e.get('message', '')[:140] for e in errs[:4]]))
        return not errs

    def net(self):
        out = []
        for entry in self._logs('performance'):
            try:
                m = json.loads(entry['message'])['message']
            except Exception:
                continue
            if m.get('method') == 'Network.requestWillBeSent':
                p = m.get('params', {})
                out.append({'url': p.get('request', {}).get('url', ''),
                            'kind': p.get('type', '')})
        return out

    def assert_soft(self, label=''):
        docs = [e for e in self.net() if e['kind'] == 'Document' and e['url'].startswith(BASE)]
        if docs:
            self.failures.append('%s expected soft nav, saw Document: %s' % (label, [d['url'] for d in docs]))
        return not docs

    def api_requests(self, since_net=None):
        net = since_net if since_net is not None else self.net()
        return [e['url'] for e in net if '/api/' in e['url']]

    # -- back-room write hygiene ----------------------------------------
    @staticmethod
    def backroom_topic(title, body):
        """Create a topic in the admins-only back room via the API (invisible
        to members, no fan-out to non-admins). Returns the comment id."""
        d = api('/api/comments/post', {
            'key': owner_key(), 'page': 'board:adminsonly',
            'title': title, 'body': body, 'token': ''})
        return d

    @staticmethod
    def delete_comment(cid):
        return api('/api/comments/delete', {'key': owner_key(), 'id': cid})

    @staticmethod
    def merecat_delete_chat(cid):
        return api('/api/merecat/chat/delete', {'key': owner_key(), 'id': cid})

    # -- lifecycle -------------------------------------------------------
    def close(self):
        try:
            self._wd('DELETE', '/session/%s' % self.sid)
        except Exception:
            pass
        self.drv.send_signal(signal.SIGTERM)

    def __enter__(self):
        return self

    def __exit__(self, *a):
        self.close()

    def verdict(self, checks):
        """checks: list of (name, bool). Prints PASS/FAIL lines + failures;
        returns process exit code."""
        for f in self.failures:
            print('FAIL', f)
        for n, p in checks:
            print(('PASS ' if p else 'FAIL '), n)
        return 2 if (self.failures or any(not p for _, p in checks)) else 0
