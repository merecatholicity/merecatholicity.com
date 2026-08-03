#!/usr/bin/env python3
"""Wave B3b feature test: the ported post renderer (app/views/post.js).

Scope note — the write path is Turnstile-gated for everyone (admins too),
and the widget's execute/interaction-only mode does not resolve under
headless (the SAME limit binds the old imperative path, proven, not a
regression), so a live owner POST is unreachable here. This slice changed
the RENDERER, so it is proven where the renderer lives: a LOCAL fixture
battery (offline, no Turnstile) rendering synthetic comments across every
author role and asserting the full DOM, the gated affordances, edit-open,
quote-fill, and mute collapse+reveal. Needs the local preview server up.
"""
import importlib
import json
import os
import sys

BOT = 'efb94d8de69dc537e2bba1facbd9db3f849f3927593488d19c07629ce35f54cc'
OWNER_HASH = 'dfb7a8d637ce0762e5c0406bfd588b23e2f12072b25864cfd7424adb375189e'


def fixture(author_hash, extra=None):
    c = {'id': 4242, 'author_hash': author_hash, 'nick': 'Tester',
         'faith': 'nicene', 'posts': 3, 'created_at': 1690000000,
         'body': '**bold** and John 3:16 and :kekw: and :nope:',
         'signature': 'a humble signature'}
    if extra:
        c.update(extra)
    return c


def main():
    checks = []
    os.environ['MC_BASE'] = 'https://merecatholicity.com'
    import flows as _flows
    importlib.reload(_flows)
    from flows import owner_key
    with _flows.Flow(port=9582, hover=True) as f:
        f.goto('community.html')
        f.js("localStorage.setItem('mc-comment-key', %s); return 1;" % json.dumps(owner_key()))
        f.goto('credo.html')
        # the comment section boots on scroll (IntersectionObserver); nudge it
        # so the real identity + admin flag resolve from the server
        f.js('window.scrollTo(0, document.documentElement.scrollHeight); return 1;')
        f.wait('!!(window.mcViews && window.mcViews.commentNode) && !!window.mcKit', timeout=15)
        f.wait('!!(window.mcKit.state && window.mcKit.state.myHash)', timeout=20)
        import time as _t; _t.sleep(3)   # let the profile fetch set the admin flag
        myhash = f.js1('return window.mcKit.state.myHash;')
        checks.append(('owner identity + admin loaded', bool(myhash) and f.js1('return window.mcKit.isAdmin();') is True))

        own = json.loads(f.js1("""
          var c = %s;
          var n = window.mcViews.commentNode(window.mcKit, c, false, {page:'/credo.html'});
          document.body.appendChild(n); n.setAttribute('data-probe','own');
          return JSON.stringify({
            faith:(n.querySelector('.comment-faith')||{}).textContent||'',
            rank:(n.querySelector('.comment-rank')||{}).textContent||'',
            tip:(n.querySelector('a.comment-author-link')||{getAttribute:function(){return ''}}).getAttribute('title')||'',
            date:(n.querySelector('a.comment-date')||{}).getAttribute('href'),
            scripture:!!n.querySelector('.comment-body a.scripture-link'),
            emoji:!!n.querySelector('.comment-body img.mc-emoji'),
            nope:(n.querySelector('.comment-body')||{}).textContent.indexOf(':nope:')!==-1,
            sig:!!n.querySelector('.comment-sig'),
            edit:!!n.querySelector('.comment-edit'), del:!!n.querySelector('.comment-delete'),
            quote:!!n.querySelector('.comment-quote-link'), dm:!!n.querySelector('.comment-dm')});"""
          % json.dumps(fixture(myhash))).replace("__OWNER__", myhash))
        # Readability standard (2026-08-03): the inline rank is the LABEL alone;
        # the exact post count rides the author link's tooltip.
        checks.append(('own: faith+rank+permalink', own['faith'] == 'Nicene' and own['rank'] != ''
                       and 'post' not in own['rank'] and 'posts' in own['tip'] and own['date'] == '#comment-4242'))
        checks.append(('own: scripture+emoji+literal+sig', own['scripture'] and own['emoji'] and own['nope'] and own['sig']))
        checks.append(('own: edit+delete+quote, no DM', own['edit'] and own['del'] and own['quote'] and not own['dm']))

        opened = f.js1("""var n=document.querySelector('article[data-probe=own]');
          n.querySelector('.comment-edit').click();
          return !!n.querySelector('.comment-editor textarea');""")
        checks.append(('edit opens the in-place editor', bool(opened)))

        other = json.loads(f.js1("""
          var n = window.mcViews.commentNode(window.mcKit, %s, false, {page:'/credo.html'});
          document.body.appendChild(n);
          return JSON.stringify({dm:!!n.querySelector('.comment-dm'),
            mute:!!n.querySelector('a.comment-quote-link[title*="posts"]'),
            report:!!n.querySelector('a[title*="Report"]'),
            edit:!!n.querySelector('.comment-edit'), del:!!n.querySelector('.comment-delete')});"""
          % json.dumps(fixture('ab' * 32))))
        checks.append(('other: DM + mute present', other['dm'] and other['mute']))
        checks.append(('other: admin-viewer sees delete not edit', other['del'] and not other['edit']))
        checks.append(('other: admin sees no report link', not other['report']))

        bot = json.loads(f.js1("""
          var n = window.mcViews.commentNode(window.mcKit, %s, false, {page:'/credo.html'});
          document.body.appendChild(n);
          return JSON.stringify({dm:!!n.querySelector('.comment-dm')});"""
          % json.dumps(fixture(BOT, {'nick': 'merecat'}))))
        checks.append(('bot: no DM link', not bot['dm']))

        quoted = f.js1("""
          var sec = document.querySelector('section[data-comments], section[data-board]');
          var ta = sec ? sec.querySelector('.comment-form .comment-text') : null;
          if (!ta) return 'NO-COMPOSER';
          ta.value = '';
          document.querySelector('article[data-probe=own] .comment-quote-link').click();
          return ta.value;""")
        checks.append(('quote fills the reply box with >', '>' in (quoted or '') and 'wrote:' in (quoted or '')))

        muted = json.loads(f.js1("""
          window.mcKit.toggleMute('cd'.repeat(32));
          var box = document.createElement('div'); box.id='mute-box'; document.body.appendChild(box);
          var n = window.mcViews.commentNode(window.mcKit, %s, false, {page:'/credo.html'});
          box.appendChild(n);
          var collapsed = !!box.querySelector('.comment-muted');
          if (collapsed) box.querySelector('.comment-muted a').click();
          var revealed = !!box.querySelector('article.comment');
          window.mcKit.toggleMute('cd'.repeat(32));
          return JSON.stringify({collapsed:collapsed, revealed:revealed});"""
          % json.dumps(fixture('cd' * 32))))
        checks.append(('mute collapses then reveals', muted['collapsed'] and muted['revealed']))
        checks.append(('local console clean', f.assert_console_clean('local')))
        fails = list(f.failures)

    for x in fails:
        print('FAIL', x)
    for n, p in checks:
        print(('PASS ' if p else 'FAIL '), n)
    sys.exit(2 if (fails or any(not p for _, p in checks)) else 0)


if __name__ == '__main__':
    main()
