#!/usr/bin/env python3
"""Settings → About is a themed dialog carrying the footer's information, and
phones show no footer except on the home tab (2026-09-11).

Desktop: the settings open, About opens the dialog over them — the version
block, the © line, the seven doors (home, library, community, about, contact,
terms, privacy), Copy and Close — the body selectable; Escape closes the
dialog and leaves the settings under it; the scrim closes it too; the footer
stands on the page. Phone (a 390px window): the dialog fits the viewport, the
footer is hidden on Community and shown on the home tab.
"""
import json
import sys
import time

from flows import Flow


def jsj(f, js):
    r = f.js1(js)
    return json.loads(r) if isinstance(r, str) else {}


OPEN_ABOUT = """window.mcSheet.settings(); return 1;"""
CLICK_ABOUT = """var b = document.querySelector('mc-settings .mc-set-about'); if (!b) return false; b.click(); return true;"""
INSPECT = """return JSON.stringify((function(){
  var q = function(s){ return document.querySelector(s); };
  var d = q('.mc-dialog'); if (!d) return { none: true };
  var hrefs = Array.prototype.map.call(d.querySelectorAll('.mc-about-site a'), function(a){ return a.getAttribute('href'); });
  var r = d.getBoundingClientRect();
  return { title: (q('.mc-dialog-title')||{}).textContent, pre: !!q('.mc-about-pre'), preText: (q('.mc-about-pre')||{}).textContent || '',
           state: (q('.mc-about-state')||{}).textContent || '', copyLine: (q('.mc-about-copy')||{}).textContent || '', hrefs: hrefs,
           copyBtn: !!q('.mc-about-copy-btn'), closeBtn: !!q('.mc-dialog-close'), x: !!q('.mc-dialog-x'),
           selectable: getComputedStyle(d).userSelect === 'text' || getComputedStyle(d).webkitUserSelect === 'text',
           fits: r.left >= 0 && r.right <= window.innerWidth + 1 && r.top >= 0 && r.bottom <= window.innerHeight + 1,
           bg: getComputedStyle(d).backgroundColor, scrimTouch: getComputedStyle(q('.mc-dialog-scrim')).touchAction,
           sheetOpen: !!q('mc-sheet .mc-sheet.on') };
})());"""
DOORS = ['index.html', 'library.html', 'community.html', 'about.html', 'contact.html', 'terms.html', 'privacy.html']


def main():
    checks = []
    with Flow(port=9641, hover=True) as f:
        f.login()
        f.goto('community.html')
        f.wait('!!window.mcSheet && !!document.querySelector("mc-footer")', timeout=20)
        foot = jsj(f, """return JSON.stringify({ shown: getComputedStyle(document.querySelector('mc-footer')).display !== 'none', tab: document.body.dataset.mcTab || '' });""")
        checks.append(('desktop: the footer stands on Community, and the tab is stamped', foot.get('shown') and foot.get('tab') == 'community'))
        f.js1(OPEN_ABOUT)
        time.sleep(0.5)
        clicked = f.js1(CLICK_ABOUT)
        checks.append(('the settings carry an About this app row', bool(clicked)))
        time.sleep(0.6)
        d = jsj(f, INSPECT)
        checks.append(('About opens a themed dialog over the settings: title, version block, state line', d.get('title') == 'About this app' and d.get('pre') and 'version:' in d.get('preText', '') and bool(d.get('state'))))
        checks.append(('the dialog carries the footer\'s information: the © line and the seven doors', d.get('copyLine', '').startswith('© ') and d.get('hrefs') == DOORS))
        checks.append(('Copy, Close and ✕ are there; the body is selectable; the scrim is inert to touch', d.get('copyBtn') and d.get('closeBtn') and d.get('x') and d.get('selectable') and d.get('scrimTouch') == 'none'))
        checks.append(('it is themed (a painted surface, not the browser\'s gray)', bool(d.get('bg')) and d.get('bg') not in ('rgba(0, 0, 0, 0)', 'transparent')))
        after = jsj(f, """window.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true, cancelable:true}));
          return JSON.stringify({ gone: !document.querySelector('.mc-dialog'), sheetOpen: !!document.querySelector('mc-sheet .mc-sheet.on') });""")
        checks.append(('Escape closes the dialog and leaves the settings open under it', after.get('gone') and after.get('sheetOpen')))
        f.js1(CLICK_ABOUT)
        time.sleep(0.5)
        scrim = jsj(f, """var s = document.querySelector('.mc-dialog-scrim'); s.click();
          return JSON.stringify({ gone: !document.querySelector('.mc-dialog'), sheetOpen: !!document.querySelector('mc-sheet .mc-sheet.on') });""")
        checks.append(('a tap on the scrim closes it, the settings still under it', scrim.get('gone') and scrim.get('sheetOpen')))
        f.js1("window.mcSheet.close(); return 1;")
        checks.append(('desktop console clean', f.assert_console_clean('about desktop')))
        fails = list(f.failures)
    with Flow(port=9642) as f:
        f.login()
        f._wd('POST', '/session/%s/window/rect' % f.sid, {'width': 390, 'height': 844})
        f.goto('community.html')
        f.wait('!!window.mcSheet && !!document.querySelector("mc-footer")', timeout=20)
        foot = jsj(f, """return JSON.stringify({ hidden: getComputedStyle(document.querySelector('mc-footer')).display === 'none', tab: document.body.dataset.mcTab || '' });""")
        checks.append(('phone: no footer on Community', foot.get('hidden') and foot.get('tab') == 'community'))
        f.js1(OPEN_ABOUT)
        time.sleep(0.5)
        f.js1(CLICK_ABOUT)
        time.sleep(0.6)
        d = jsj(f, INSPECT)
        checks.append(('phone: the dialog opens over the settings sheet and fits the screen', d.get('title') == 'About this app' and d.get('fits') and d.get('sheetOpen')))
        checks.append(('phone: the seven doors are there', d.get('hrefs') == DOORS))
        closed = jsj(f, """document.querySelector('.mc-dialog-close').click();
          return JSON.stringify({ gone: !document.querySelector('.mc-dialog'), sheetOpen: !!document.querySelector('mc-sheet .mc-sheet.on'), locked: document.documentElement.classList.contains('mc-sheet-open') });""")
        checks.append(('phone: Close closes the dialog and the sheet keeps its lock', closed.get('gone') and closed.get('sheetOpen') and closed.get('locked')))
        f.js1("window.mcSheet.close(); return 1;")
        f.goto('index.html')
        f.wait('!!document.querySelector("mc-footer")', timeout=20)
        home = jsj(f, """return JSON.stringify({ shown: getComputedStyle(document.querySelector('mc-footer')).display !== 'none', tab: document.body.dataset.mcTab || '' });""")
        checks.append(('phone: the home tab keeps its footer', home.get('shown') and home.get('tab') == 'home'))
        checks.append(('phone console clean', f.assert_console_clean('about phone')))
        fails += f.failures
    rc = 2 if fails or any(not p for _, p in checks) else 0
    for x in fails:
        print('FAIL', x)
    for n, p in checks:
        print(('PASS ' if p else 'FAIL '), n)
    return rc


if __name__ == '__main__':
    sys.exit(main())
