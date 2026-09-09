#!/usr/bin/env python3
"""test_turnstile_mount.py — arriving mounts no challenge, on prod (2026-09-09).

The report: open the app, tap Profile, an out-of-place white box — the
Turnstile frame, mounted INSIDE the view and unstyled — and sometimes the
white-flash reload that follows a mount on the installed app; Community
flashed too; the DM view (the one view whose mount-on-open had been removed
the day before) did not. This drives that exact path as the owner's identity
(established, therefore spared) and asserts that arriving mounts nothing:

  1. a fresh (hard) load of Community, then a soft hop into a category
     (where the board composer mounts through armBoardForm): no frame, no
     host, no Cloudflare script, no mount crumb — and the composer carries
     the .ts-slot that puts it under the focus net;
  2. a SOFT hop to Profile: the same, and never a .mc-ts-host inside <main>;
  3. opening the editor (the explicit warm): the ring says
     'turnstile: spared, nothing mounted' and still nothing is mounted;
  4. a soft hop back to the category and a focus on the composer (the net):
     still nothing.

A dark-theme screenshot of the Profile view is saved to
/tmp/mc-profile-dark.png for eyes: the reported box was white.

Run:  python3 webtest/test_turnstile_mount.py
"""
import json
import sys
import time

from flows import Flow

RING = "return JSON.parse(localStorage.getItem('mc-crumbs')||'[]');"
STATE = """return JSON.stringify({
  frames: document.querySelectorAll('.mc-ts-frame').length,
  hosts: document.querySelectorAll('.mc-ts-host').length,
  inMain: document.querySelectorAll('main .mc-ts-host, main .mc-ts-frame').length,
  css: !!document.getElementById('mc-ts-css'),
  slot: !!document.querySelector('.ts-slot'),
  ts: !!window.turnstile,
  script: !!document.getElementById('mc-ts-script')});"""


def state(f):
    return json.loads(f.js1(STATE))


def ring(f):
    return f.js1(RING) or []


def turnstile_crumbs(f, since):
    return [c for c in ring(f)[since:] if 'turnstile' in c]


def mounted_anything(c):
    """A crumb that names a mount: the frame being requested, the widget
    being mounted, or the in-page fallback loading Cloudflare's script."""
    return ('frame requested' in c) or ('mounting' in c) or ('frame ready' in c)


def nothing_mounted(st):
    return (st['frames'] == 0 and st['hosts'] == 0 and st['inMain'] == 0
            and not st['ts'] and not st['script'])


def main():
    checks = []
    with Flow(port=9597) as f:
        f.login()
        f.js("localStorage.setItem('mc-crumbs','[]'); return 1;")
        # 1. a fresh open of the app, landing on Community, then into a category
        f.goto('community.html')
        f.wait('!!(window.mcKit && window.mcKit.state && window.mcKit.state.myHash)', timeout=20)
        f.wait("!!document.querySelector('mc-board-index .board-cat')", timeout=20)
        time.sleep(3)
        st = state(f)
        cr = turnstile_crumbs(f, 0)
        checks.append(('fresh Community: nothing mounted', nothing_mounted(st)))
        checks.append(('fresh Community: no mount crumb %s' % cr, not any(mounted_anything(c) for c in cr)))
        f.click('a[href="community.html?cat=pub"]')
        f.wait("!!document.querySelector('.comment-form .comment-text')", timeout=20)
        time.sleep(3)
        st = state(f)
        cr = turnstile_crumbs(f, 0)
        checks.append(('category (soft): nothing mounted %s' % json.dumps(st), nothing_mounted(st)))
        checks.append(('category (soft): the composer is under the net (.ts-slot)', st['slot']))
        checks.append(('category (soft): no mount crumb %s' % cr, not any(mounted_anything(c) for c in cr)))
        # 2. the soft hop to Profile — the reported tap
        n0 = len(ring(f))
        f.drain()
        f.js("window.mcNav('profile.html'); return 1;")
        f.wait("!!document.querySelector('mc-profile .profile .profile-name')", timeout=20)
        time.sleep(3)
        st = state(f)
        cr = turnstile_crumbs(f, n0)
        checks.append(('Profile (soft): nothing mounted %s' % json.dumps(st), nothing_mounted(st)))
        checks.append(('Profile (soft): no challenge host inside <main>', st['inMain'] == 0))
        checks.append(('Profile (soft): the editor is under the net (.ts-slot)', st['slot']))
        checks.append(('Profile (soft): no mount crumb %s' % cr, not any(mounted_anything(c) for c in cr)))
        checks.append(('Profile: the hop was soft', f.assert_soft('profile')))
        f.js("document.documentElement.setAttribute('data-theme','dark'); return 1;")
        time.sleep(0.5)
        f.shot('/tmp/mc-profile-dark.png')
        # 3. opening the editor is the explicit warm: spared, nothing mounted
        n0 = len(ring(f))
        opened = f.js1("""var p=document.querySelector('mc-profile');
          var b=Array.prototype.find.call(p.querySelectorAll('button'),function(x){return x.textContent==='Edit profile';});
          if(!b) return false; b.click(); return true;""")
        checks.append(('Edit profile opens', bool(opened)))
        f.wait("JSON.parse(localStorage.getItem('mc-crumbs')||'[]').slice(%d)"
               ".some(function(c){return c.indexOf('spared, nothing mounted')!==-1;})" % n0, timeout=10)
        time.sleep(2)
        st = state(f)
        cr = turnstile_crumbs(f, n0)
        checks.append(('editor open: the ring says spared, nothing mounted %s' % cr,
                       any('spared, nothing mounted' in c for c in cr)))
        checks.append(('editor open: still nothing mounted', nothing_mounted(st)))
        # 4. back to the category softly, and the focus net on the composer
        n0 = len(ring(f))
        f.js("window.mcNav('community.html?cat=pub'); return 1;")
        f.wait("!!document.querySelector('.comment-form .comment-text')", timeout=20)
        focused = f.js1("var t=document.querySelector('.comment-form .comment-text'); if(!t) return false; t.focus(); return document.activeElement===t;")
        time.sleep(3)
        st = state(f)
        cr = turnstile_crumbs(f, n0)
        checks.append(('category (soft): the composer took focus', bool(focused)))
        checks.append(('category (soft) + focus: nothing mounted', nothing_mounted(st)))
        checks.append(('category (soft) + focus: no mount crumb %s' % cr, not any(mounted_anything(c) for c in cr)))
        checks.append(('console clean', f.assert_console_clean('turnstile')))
        print('ring:', json.dumps(ring(f)[-12:], indent=1))
        code = f.verdict(checks)
    sys.exit(code)


if __name__ == '__main__':
    main()
