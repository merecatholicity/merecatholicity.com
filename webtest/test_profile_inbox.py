#!/usr/bin/env python3
"""Wave C-reads 2 feature test on prod: <mc-profile> and <mc-inbox>.

Profile (own, as owner/admin): renders the card through the reused
renderProfile — head with name/rank, the owner's Edit button, recent-posts
reveal; opening Edit swaps in the editor (proof the reused write machinery
still wires). A logged-out visitor viewing a profile sees the read card
with no Edit/DM. Inbox: renders the thread list (or empty state) with the
DM search box mounted; a logged-out visitor is gated.
"""
import json
import sys
import time

from flows import Flow, owner_key

OWNER = None  # read live


def main():
    checks = []
    with Flow(port=9593) as f:
        f.login()
        f.goto('community.html')
        f.js("localStorage.setItem('mc-comment-key', %s); return 1;" % json.dumps(owner_key()))
        f.goto('credo.html')
        f.js('window.scrollTo(0, document.documentElement.scrollHeight); return 1;')
        f.wait('!!(window.mcKit && window.mcKit.state && window.mcKit.state.myHash)', timeout=20)
        myhash = f.js1('return window.mcKit.state.myHash;')
        # --- own profile ---
        f.goto('community.html?profile=%s' % myhash)
        f.wait("!!document.querySelector('mc-profile .profile .profile-name')", timeout=20)
        time.sleep(1)
        st = json.loads(f.js1("""var p=document.querySelector('mc-profile');
          return JSON.stringify({
            name: !!p.querySelector('.profile-name'),
            rank: !!p.querySelector('.profile-rank'),
            edit: !!Array.prototype.find.call(p.querySelectorAll('button'), function(b){return b.textContent==='Edit profile';}),
            recent: !!Array.prototype.find.call(p.querySelectorAll('a,button'), function(a){return (a.textContent||'').indexOf('Show recent posts')!==-1;})});"""))
        checks.append(('own profile card renders (name+rank)', st['name'] and st['rank']))
        checks.append(('own profile has Edit + recent-posts', st['edit'] and st['recent']))
        # opening Edit swaps in the editor (reused write machinery still wires)
        opened = f.js1("""var p=document.querySelector('mc-profile');
          var b=Array.prototype.find.call(p.querySelectorAll('button'),function(x){return x.textContent==='Edit profile';});
          if(!b) return false; b.click();
          return !!p.querySelector('.profile textarea, .profile .key-input');""")
        checks.append(('Edit opens the editor', bool(opened)))
        # recent posts reveal (re-navigate since Edit consumed the card)
        f.goto('community.html?profile=%s' % myhash)
        f.wait("!!document.querySelector('mc-profile .profile .profile-name')", timeout=20)
        f.js1("""var a=Array.prototype.find.call(document.querySelectorAll('mc-profile a,mc-profile button'),function(x){return (x.textContent||'').indexOf('Show recent posts')!==-1;}); if(a) a.click(); return 1;""")
        got_posts = f.wait("document.querySelectorAll('mc-profile .profile-posts .board-topic').length>0 || (document.querySelector('mc-profile .profile-posts .comments-status')||{}).textContent", timeout=15)
        checks.append(('recent posts load on reveal', bool(got_posts)))
        checks.append(('profile console clean', f.assert_console_clean('profile')))
        # --- inbox ---
        f.goto('community.html?inbox=1')
        f.wait("!!document.querySelector('mc-inbox')", timeout=20)
        f.wait("!!document.querySelector('mc-inbox .dm-search') || (document.querySelector('mc-inbox .comments-status')||{}).textContent", timeout=15)
        time.sleep(1)
        ib = json.loads(f.js1("""var x=document.querySelector('mc-inbox');
          return JSON.stringify({search: !!x.querySelector('.dm-search'),
            threads: x.querySelectorAll('.board-topic').length,
            status: (x.querySelector('.comments-status')||{}).textContent||''});"""))
        checks.append(('inbox: DM search box mounts', ib['search']))
        checks.append(('inbox: list or empty-state renders', ib['threads'] >= 1 or 'No messages' in ib['status']))
        checks.append(('inbox console clean', f.assert_console_clean('inbox')))
        fails = list(f.failures)
    # --- logged-out profile is read-only; inbox gated ---
    with Flow(port=9594) as f:
        f.goto('community.html?profile=%s' % myhash)
        # Profiles are members-only now (the discovery wave): a visitor gets the
        # join gate, never the read card - assert the gate, not the old card.
        f.wait("(document.body.textContent||'').indexOf('Create an identity') !== -1", timeout=20)
        time.sleep(1)
        vo = json.loads(f.js1("""return JSON.stringify({
            gate: (document.body.textContent||'').indexOf('Create an identity') !== -1,
            name: !!document.querySelector('mc-profile .profile-name')});"""))
        checks.append(('visitor gets the join gate, no profile card', vo['gate'] and not vo['name']))
        f.goto('community.html?inbox=1')
        # The inbox is behind the join gate for visitors now (the discovery
        # wave): no mc-inbox mounts, the create-identity invitation stands.
        f.wait("(document.body.textContent||'').indexOf('Create an identity') !== -1", timeout=15)
        time.sleep(1)
        gate = f.js1("return document.body.textContent||'';")
        checks.append(('visitor inbox gated', 'Create an identity' in gate
                       and not f.js('return !!document.querySelector(\'mc-inbox .dm-search\');')))
        fails += list(f.failures)
    for x in fails:
        print('FAIL', x)
    for n, p in checks:
        print(('PASS ' if p else 'FAIL '), n)
    sys.exit(2 if (fails or any(not p for _, p in checks)) else 0)


if __name__ == '__main__':
    main()
