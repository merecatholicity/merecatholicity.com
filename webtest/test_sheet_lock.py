#!/usr/bin/env python3
"""test_sheet_lock.py — an open sheet owns the scroll, on prod (2026-09-09).

The report, on phones: scrolling the Settings sheet sometimes scrolled the
page behind it. This resizes the headless window to a phone width so the
gear opens the bottom sheet, scrolls the page first, opens Settings, and
asserts the three layers are live in the served build:

  1. the document is locked: html.mc-sheet-open is set, the body is
     position:fixed with the scroll offset carried in its inline top, and
     window.scrollY reads 0 while the page has not visibly moved;
  2. the sheet itself is contained (overscroll-behavior: contain) and only
     pans vertically; the scrim is inert (touch-action: none);
  3. closing the sheet releases the lock and puts the page back at the same
     offset, and a second open/close cycle does the same (one lock, reused).

Then the same on a desktop viewport, where the modal is the same element.

Run:  python3 webtest/test_sheet_lock.py
"""
import json
import sys
import time

from flows import Flow

STATE = """return JSON.stringify({
  locked: document.documentElement.classList.contains('mc-sheet-open'),
  bodyPos: getComputedStyle(document.body).position,
  bodyTop: document.body.style.top,
  scrollY: window.scrollY,
  sheetOpen: !!document.querySelector('.mc-sheet.on'),
  sheetOB: (function(){var s=document.querySelector('.mc-sheet');return s?getComputedStyle(s).overscrollBehavior:''})(),
  sheetTA: (function(){var s=document.querySelector('.mc-sheet');return s?getComputedStyle(s).touchAction:''})(),
  scrimTA: (function(){var s=document.querySelector('.mc-sheet-scrim');return s?getComputedStyle(s).touchAction:''})(),
  mainTop: (function(){var m=document.querySelector('main');return m?Math.round(m.getBoundingClientRect().top):null})()});"""


def state(f):
    return json.loads(f.js1(STATE))


def resize(f, w, h):
    f._wd('POST', '/session/%s/window/rect' % f.sid, {'width': w, 'height': h})
    time.sleep(0.5)


def cycle(f, checks, label):
    """Scroll down, open Settings, assert the lock, close, assert the release."""
    f.js('window.scrollTo(0, 600); return 1;')
    time.sleep(0.6)
    before = state(f)
    checks.append((label + ': page scrolled before opening', before['scrollY'] > 0))
    f.js('window.mcSheet.settings(); return 1;')
    f.wait("!!document.querySelector('.mc-sheet.on')", timeout=10)
    time.sleep(0.6)
    st = state(f)
    checks.append((label + ': html.mc-sheet-open set', st['locked']))
    checks.append((label + ': body is position:fixed', st['bodyPos'] == 'fixed'))
    checks.append((label + ': body top carries the offset (%s for %s)' % (st['bodyTop'], before['scrollY']),
                   st['bodyTop'] == '-%dpx' % before['scrollY']))
    checks.append((label + ': the page did not visibly move (main top %s -> %s)' % (before['mainTop'], st['mainTop']),
                   st['mainTop'] == before['mainTop']))
    checks.append((label + ': sheet overscroll-behavior contain (%s)' % st['sheetOB'],
                   st['sheetOB'].split(' ')[0] == 'contain'))
    checks.append((label + ': scrim touch-action none (%s)' % st['scrimTA'], st['scrimTA'] == 'none'))
    f.js('window.mcSheet.close(); return 1;')
    f.wait("!document.querySelector('.mc-sheet.on')", timeout=10)
    time.sleep(0.6)
    after = state(f)
    checks.append((label + ': lock released on close', not after['locked'] and after['bodyPos'] != 'fixed' and after['bodyTop'] == ''))
    checks.append((label + ': scroll offset restored (%s -> %s)' % (before['scrollY'], after['scrollY']),
                   after['scrollY'] == before['scrollY']))
    return st


def main():
    checks = []
    with Flow(port=9598) as f:
        f.login()
        # a long page, so there is something to scroll: the Community index
        f.goto('community.html')
        f.wait('!!(window.mcSheet && window.mcKit && window.mcKit.state && window.mcKit.state.myHash)', timeout=20)
        # --- phone: the bottom sheet ---
        resize(f, 420, 860)
        f.wait("matchMedia('(max-width: 600px)').matches", timeout=5)
        st = cycle(f, checks, 'phone')
        checks.append(('phone: sheet pans vertically only (%s)' % st['sheetTA'], st['sheetTA'] == 'pan-y'))
        cycle(f, checks, 'phone, second cycle')
        # --- desktop: the centered modal, same element ---
        resize(f, 1280, 900)
        f.wait("!matchMedia('(max-width: 600px)').matches", timeout=5)
        cycle(f, checks, 'desktop')
        checks.append(('console clean', f.assert_console_clean('sheet lock')))
        code = f.verdict(checks)
    sys.exit(code)


if __name__ == '__main__':
    main()
