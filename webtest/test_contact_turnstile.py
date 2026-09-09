#!/usr/bin/env python3
"""test_contact_turnstile.py — the contact page's challenge, on prod (2026-09-09).

The report: a Turnstile white flash and a reload on the contact page. The page
carried Cloudflare's script in its markup (the implicit render mounts the
widget on arrival) and re-rendered it on every soft arrival. Now:

  1. from inside the app, the Contact link is a FULL document load
     (app/shell.ts DOCUMENT_PAGES): a Document request is seen, and the
     document that arrives is contact.html;
  2. on arrival nothing is mounted: no Cloudflare script, no window.turnstile,
     no widget in the slot, no mount crumb;
  3. the first focus of a field loads the script and mounts the widget into
     the slot, and the ring says so;
  4. a direct (hard) open of contact.html behaves the same as 2 and 3.

Run:  python3 webtest/test_contact_turnstile.py
"""
import json
import sys
import time

from flows import Flow, BASE

STATE = """return JSON.stringify({
  path: location.pathname,
  script: !!document.querySelector('script[src*="challenges.cloudflare.com"]'),
  ts: !!window.turnstile,
  slot: !!document.querySelector('.contact-ts'),
  rendered: !!document.querySelector('.contact-ts[data-mc-rendered]'),
  widget: !!document.querySelector('.contact-ts iframe, .contact-ts input[name="cf-turnstile-response"]'),
  crumbs: JSON.parse(localStorage.getItem('mc-crumbs')||'[]').filter(function(c){return c.indexOf('turnstile(contact)')!==-1;})});"""


def state(f):
    return json.loads(f.js1(STATE))


def nothing_mounted(st):
    return st['slot'] and not st['script'] and not st['ts'] and not st['rendered'] and not st['widget'] and not st['crumbs']


def focus_and_wait(f):
    f.js("var i=document.querySelector('#contact-form input[name=name]'); if(i) i.focus(); return 1;")
    f.wait("!!document.querySelector('.contact-ts iframe, .contact-ts input[name=\"cf-turnstile-response\"]')", timeout=15)
    time.sleep(1)
    return state(f)


def main():
    checks = []
    with Flow(port=9605) as f:
        f.goto('community.html')
        f.wait('!!window.mcNav', timeout=20)
        f.js("localStorage.setItem('mc-crumbs','[]'); return 1;")
        # 1. the Contact link from inside the app is a document load
        f.drain()
        clicked = f.js("var a=Array.prototype.find.call(document.querySelectorAll('a[href]'),function(x){return /(^|\\/)contact\\.html$/.test(x.getAttribute('href')||'');}); if(!a) return false; a.click(); return true;")
        checks.append(('a Contact link exists in the app', bool(clicked)))
        f.wait("location.pathname.indexOf('contact.html') !== -1 && document.readyState === 'complete'", timeout=20)
        time.sleep(1.5)
        docs = [e['url'] for e in f.net() if e['kind'] == 'Document' and e['url'].startswith(BASE)]
        checks.append(('Contact arrived by a full document load %s' % docs, any('contact.html' in d for d in docs)))
        st = state(f)
        checks.append(('on arrival nothing is mounted %s' % json.dumps(st), nothing_mounted(st)))
        # 3. intent mounts it
        st = focus_and_wait(f)
        checks.append(('first focus loads the script and mounts the widget %s' % json.dumps(st),
                       st['script'] and st['ts'] and st['rendered'] and st['widget']))
        checks.append(('the mount is crumbed', any('mounting' in c for c in st['crumbs'])))
        # 4. a direct open behaves the same
        f.js("localStorage.setItem('mc-crumbs','[]'); return 1;")
        f.goto('contact.html')
        f.wait("document.readyState === 'complete' && !!document.getElementById('contact-form')", timeout=20)
        time.sleep(1.5)
        st = state(f)
        checks.append(('direct open: nothing mounted on arrival %s' % json.dumps(st), nothing_mounted(st)))
        st = focus_and_wait(f)
        checks.append(('direct open: focus mounts the widget', st['rendered'] and st['widget']))
        checks.append(('console clean', f.assert_console_clean('contact')))
        code = f.verdict(checks)
    sys.exit(code)


if __name__ == '__main__':
    main()
