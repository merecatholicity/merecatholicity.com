#!/usr/bin/env python3
"""Live light/dark toggling repaints EVERYTHING — the mc-fout regression.

The anti-flash gate pre-paints <html> with an INLINE background from the
mc-theme cookie (so a dark reader never sees a white flash before the
stylesheet arrives). Inline shadows the stylesheet, so unless the theme engine
clears it (nav.js apply()), a live toggle flips every token EXCEPT the page
background — "dark but the background stays bright white until a hard
refresh" (owner report, 2026-08-03). This drives the exact path the settings
gear takes (cookie + window.mcApplyTheme) and asserts the <html> computed
background equals the fresh-load value in BOTH directions.

Run: python3 webtest/test_theme_toggle.py [base]   (default: prod BASE)
"""
import json
import sys
import time

import flows
from flows import Flow

BG = "return getComputedStyle(document.documentElement).backgroundColor;"
TOGGLE = ("var n=document.documentElement.getAttribute('data-theme')==='dark'?'light':'dark';"
          "document.cookie='mc-theme='+n+';path=/;max-age=31536000;samesite=lax';"
          "if(window.mcApplyTheme)window.mcApplyTheme();return n;")


def main():
    if len(sys.argv) > 1:
        flows.BASE = sys.argv[1].rstrip('/')
    checks = []
    with Flow(port=9631) as f:
        f.goto('community.html')
        time.sleep(2.5)
        dark_fresh = f.js(BG)
        checks.append(('engine present (window.mcApplyTheme)', bool(f.js('return !!window.mcApplyTheme;'))))
        got = f.js(TOGGLE)
        checks.append(('toggle flips to light', got == 'light'))
        time.sleep(0.5)
        light_live = f.js(BG)
        f.goto('community.html')
        time.sleep(2.5)
        light_fresh = f.js(BG)
        checks.append(('LIVE light background == fresh-load light (%s vs %s)' % (light_live, light_fresh),
                       light_live == light_fresh and light_live != dark_fresh))
        got = f.js(TOGGLE)
        checks.append(('toggle flips back to dark', got == 'dark'))
        time.sleep(0.5)
        dark_live = f.js(BG)
        checks.append(('LIVE dark background == fresh-load dark (%s vs %s)' % (dark_live, dark_fresh),
                       dark_live == dark_fresh and dark_live != light_fresh))
        # leave the browser cookie on dark (the site default) — hygiene only
    for n, p in checks:
        print(('PASS ' if p else 'FAIL '), n)
    sys.exit(2 if any(not p for _, p in checks) else 0)


if __name__ == '__main__':
    main()
