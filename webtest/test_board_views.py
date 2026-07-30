#!/usr/bin/env python3
"""Wave B1+B2 feature test: the board index and category Lit views.

Visitor: component mounts, all public tiles, the back room INVISIBLE (the
computed-display lesson), category renders topics with no admin corners.
Admin (owner key): the back-room tile shows once the profile lands, the
category rows carry the admin corner, and the admins-only room itself
renders through the component. Soft hops + clean console throughout.
"""
import sys
import time

from flows import Flow


def main():
    checks = []
    # --- visitor ---------------------------------------------------------
    with Flow(port=9565) as f:
        f.goto('community.html')
        f.wait("!!document.querySelector('mc-board-index')")
        time.sleep(2)
        st = f.js1("""return JSON.stringify({
          tiles: document.querySelectorAll('.board-cat').length,
          back: (function(){var b=document.querySelector('.board-cat-admin');return b? getComputedStyle(b).display==='none' : 'missing'})(),
          stats: document.querySelectorAll('.board-stats').length})""")
        import json as _j
        st = _j.loads(st)
        checks.append(('visitor: index component + tiles', st['tiles'] >= 13))
        checks.append(('visitor: back room hidden', st['back'] is True))
        f.drain()
        f.click('a[href="community.html?cat=pub"]')
        f.wait("!!document.querySelector('mc-board-cat')")
        f.wait("document.querySelectorAll('.board-topic').length > 0")
        soft = f.assert_soft('visitor cat hop')
        st2 = _j.loads(f.js1("""return JSON.stringify({
          corners: document.querySelectorAll('.board-admin-corner').length,
          form: !!document.querySelector('.comment-form'),
          topics: document.querySelectorAll('.board-topic').length})"""))
        checks.append(('visitor: cat topics render soft', soft and st2['topics'] >= 1))
        checks.append(('visitor: no admin corners', st2['corners'] == 0))
        checks.append(('visitor: composer mounts', st2['form']))
        checks.append(('visitor: console clean', f.assert_console_clean('visitor')))
        vfail = list(f.failures)
    # --- admin -----------------------------------------------------------
    with Flow(port=9566) as f:
        f.login()
        f.wait("!!document.querySelector('mc-board-index')")
        f.wait("(function(){var b=document.querySelector('.board-cat-admin');return b && getComputedStyle(b).display!=='none'})()", timeout=15)
        back_shown = f.js1("var b=document.querySelector('.board-cat-admin');return b && getComputedStyle(b).display!=='none';")
        checks.append(('admin: back room tile shows', bool(back_shown)))
        f.drain()
        f.click('a[href="community.html?cat=pub"]')
        f.wait("document.querySelectorAll('.board-topic').length > 0")
        f.wait("document.querySelectorAll('.board-admin-corner').length > 0", timeout=15)
        corners = f.js1("return document.querySelectorAll('.board-admin-corner select.board-move').length;")
        checks.append(('admin: corners with Move on rows', (corners or 0) >= 1))
        f.goto('community.html')
        f.wait("(function(){var b=document.querySelector('.board-cat-admin');return b && getComputedStyle(b).display!=='none'})()", timeout=15)
        time.sleep(45)   # let the read-rate window breathe: a 429 on the keyed
                         # door bounces to index BY DESIGN (parity with the old
                         # view); the test must walk at an honest pace here
        f.drain()
        f.click('a[href="community.html?cat=adminsonly"]')
        f.wait("!!document.querySelector('mc-board-cat')")
        time.sleep(3)
        st3 = f.js1("""return JSON.stringify({
          crumb: (document.querySelector('.board-crumb')||{}).textContent||'',
          status: (document.querySelector('.comments-status')||{}).textContent||'',
          topics: document.querySelectorAll('.board-topic').length});""")
        import json as _j2
        st3 = _j2.loads(st3)
        ok_back = 'Admins only' in st3['crumb'] and (st3['topics'] >= 0) and 'Could not' not in st3['status']
        checks.append(('admin: back room renders via component', ok_back))
        checks.append(('admin: console clean', f.assert_console_clean('admin')))
        afail = list(f.failures)
    for x in vfail + afail:
        print('FAIL', x)
    for n, p in checks:
        print(('PASS ' if p else 'FAIL '), n)
    sys.exit(2 if (vfail or afail or any(not p for _, p in checks)) else 0)


if __name__ == '__main__':
    main()
