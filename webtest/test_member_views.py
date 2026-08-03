#!/usr/bin/env python3
"""Wave C-reads feature test: <mc-users> and <mc-notifications> on prod.

Users: component renders the directory, type-to-narrow filters in place
(no reload), the pager turns in place, a row links to a profile.
Notifications: component renders the list (logged in), each row links to
its post; a logged-out visitor is told to make an identity.
"""
import json
import sys
import time

from flows import Flow


def main():
    checks = []
    with Flow(port=9591) as f:
        f.login()
        # --- users ---
        f.goto('community.html?users=1')
        f.wait("!!document.querySelector('mc-users')", timeout=20)
        f.wait("document.querySelectorAll('.user-row').length > 0 || (document.querySelector('.comments-status')||{}).textContent.indexOf('member')!==-1", timeout=20)
        time.sleep(1)
        st = json.loads(f.js1("""var u=document.querySelector('mc-users');
          return JSON.stringify({rows: u.querySelectorAll('.user-row').length,
            count: (u.querySelector('.comments-status')||{}).textContent||'',
            firstHref: (u.querySelector('.user-row')||{}).getAttribute ? u.querySelector('.user-row').getAttribute('href') : ''});"""))
        checks.append(('users directory renders', st['rows'] >= 1 and 'member' in st['count']))
        checks.append(('user row links to a profile', (st['firstHref'] or '').startswith('profile.html?u=')))
        # type-to-narrow, in place (no Document request)
        f.drain()
        total_before = st['rows']
        f.js1("""var i=document.querySelector('.mc-userq'); i.value='zzznotamember';
          i.dispatchEvent(new Event('input',{bubbles:true})); return 1;""")
        time.sleep(1)
        narrowed = f.js1("return (document.querySelector('mc-users .comments-status')||{}).textContent||'';")
        soft = f.assert_soft('users filter')
        checks.append(('filter narrows in place, soft', 'No member matches' in narrowed and soft))
        # --- notifications ---
        f.goto('community.html?notifications=1')
        f.wait("!!document.querySelector('mc-notifications')", timeout=20)
        f.wait("((document.querySelector('mc-notifications .comments-status')||{}).textContent||'').length>0 || document.querySelectorAll('mc-notifications .board-topic').length>0", timeout=20)
        time.sleep(1)
        nt = json.loads(f.js1("""var n=document.querySelector('mc-notifications');
          var rows=n.querySelectorAll('.board-topic');
          return JSON.stringify({rows: rows.length,
            status: (n.querySelector('.comments-status')||{}).textContent||'',
            firstHref: rows.length? rows[0].querySelector('a.board-topic-title').getAttribute('href'):''});"""))
        # either has notifications (rows link to #comment-) or the empty note
        if nt['rows'] > 0:
            checks.append(('notifications render + link to post', '#comment-' in (nt['firstHref'] or '')))
        else:
            checks.append(('notifications empty-state renders', 'No notifications' in nt['status'] or 'Loading' not in nt['status']))
        checks.append(('member views console clean', f.assert_console_clean('member')))
        fails = list(f.failures)
    # logged-out notifications gate
    with Flow(port=9592) as f:
        f.goto('community.html?notifications=1')
        f.wait("!!document.querySelector('mc-notifications')", timeout=20)
        time.sleep(1)
        gate = f.js1("return (document.querySelector('mc-notifications .comments-status')||{}).textContent||'';")
        checks.append(('logged-out notifications gated', 'need an identity' in gate))
        fails += list(f.failures)
    for x in fails:
        print('FAIL', x)
    for n, p in checks:
        print(('PASS ' if p else 'FAIL '), n)
    sys.exit(2 if (fails or any(not p for _, p in checks)) else 0)


if __name__ == '__main__':
    main()
