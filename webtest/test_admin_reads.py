#!/usr/bin/env python3
"""Wave C-reads 3 feature test on prod: the admin read/observe cluster —
<mc-admin-home>, <mc-merecat-threads>, <mc-merecat-thread>. All pure reads,
admin-gated. Verified as the owner (admin) and as a logged-out visitor
(gate shows 'for the admins', never a false render). Read-only: no action.
"""
import json
import sys
import time

from flows import Flow


def main():
    checks = []
    with Flow(port=9596) as f:
        f.login()
        # let the profile fetch set the admin flag
        f.goto('community.html')
        f.wait("!!(window.mcKit && window.mcKit.isAdmin && window.mcKit.isAdmin())", timeout=20)
        # --- admin home ---
        f.goto('community.html?admin=1')
        f.wait("!!document.querySelector('mc-admin-home .board-cat-name')", timeout=15)
        doors = f.js1("return document.querySelectorAll('mc-admin-home .board-cat-name').length;")
        checks.append(('admin home shows all doors', (doors or 0) >= 5))
        # --- merecat Q&A list ---
        f.goto('community.html?merecatthreads=1')
        f.wait("!!document.querySelector('mc-merecat-threads')", timeout=15)
        f.wait("document.querySelectorAll('mc-merecat-threads .board-topic').length>0 || ((document.querySelector('mc-merecat-threads .comments-status')||{}).textContent||'').length>0", timeout=20)
        time.sleep(1)
        lst = json.loads(f.js1("""var t=document.querySelector('mc-merecat-threads');
          var rows=t.querySelectorAll('.board-topic');
          return JSON.stringify({rows: rows.length,
            status: (t.querySelector('.comments-status')||{}).textContent||'',
            firstHref: rows.length? rows[0].querySelector('a.board-topic-title').getAttribute('href'):''});"""))
        has_threads = lst['rows'] > 0
        checks.append(('merecat Q&A list renders', has_threads or 'No conversations' in lst['status']))
        if has_threads:
            checks.append(('Q&A row links to observe view', 'merecatthread=' in (lst['firstHref'] or '')))
            tid = lst['firstHref'].split('merecatthread=')[1].split('&')[0]
            # --- observe one conversation ---
            f.goto('community.html?merecatthread=%s' % tid)
            f.wait("!!document.querySelector('mc-merecat-thread .merecat-log .merecat-msg')", timeout=20)
            time.sleep(1)
            obs = json.loads(f.js1("""var t=document.querySelector('mc-merecat-thread');
              return JSON.stringify({msgs: t.querySelectorAll('.merecat-msg').length,
                observeNote: (t.textContent||'').indexOf('Observing only')!==-1,
                composer: !!t.querySelector('textarea')});"""))
            checks.append(('conversation renders messages', obs['msgs'] >= 1))
            checks.append(('observe note present, no composer', obs['observeNote'] and not obs['composer']))
        # --- platform usage (the free-tier health bars) ---
        f.goto('admin.html?usage=1')
        f.wait("!!document.querySelector('mc-usage')", timeout=15)
        f.wait("document.querySelectorAll('mc-usage .mc-usage-bar').length>0"
               " || !!document.querySelector('mc-usage .mc-usage-setup')"
               " || ((document.querySelector('mc-usage .comments-status')||{}).textContent||'').indexOf('could not')!==-1", timeout=30)
        time.sleep(1)
        us = json.loads(f.js1("""var t=document.querySelector('mc-usage');
          return JSON.stringify({bars: t.querySelectorAll('.mc-usage-bar').length,
            setup: !!t.querySelector('.mc-usage-setup'),
            groups: t.querySelectorAll('.mc-usage-group').length});"""))
        checks.append(('usage page: health bars or the setup card', us['bars'] > 0 or us['setup']))
        if us['bars']:
            checks.append(('usage page: meters grouped by product', us['groups'] >= 5))
        checks.append(('admin console clean', f.assert_console_clean('admin')))
        fails = list(f.failures)
    # --- visitor gate ---
    with Flow(port=9597) as f:
        f.goto('community.html?admin=1')
        f.wait("!!document.querySelector('mc-admin-home')", timeout=15)
        time.sleep(1)
        g = f.js1("return (document.querySelector('mc-admin-home .comments-status')||{}).textContent||'';")
        checks.append(('visitor: admin home gated', 'for the admins' in g))
        f.goto('community.html?merecatthreads=1')
        f.wait("!!document.querySelector('mc-merecat-threads')", timeout=15)
        time.sleep(1)
        g2 = f.js1("return (document.querySelector('mc-merecat-threads .comments-status')||{}).textContent||'';")
        checks.append(('visitor: Q&A gated', 'for the admins' in g2))
        f.goto('admin.html?usage=1')
        f.wait("!!document.querySelector('mc-usage')", timeout=15)
        time.sleep(1)
        g3 = f.js1("return (document.querySelector('mc-usage .comments-status')||{}).textContent||'';")
        checks.append(('visitor: usage gated', 'for the admins' in g3))
        fails += list(f.failures)
    for x in fails:
        print('FAIL', x)
    for n, p in checks:
        print(('PASS ' if p else 'FAIL '), n)
    sys.exit(2 if (fails or any(not p for _, p in checks)) else 0)


if __name__ == '__main__':
    main()
