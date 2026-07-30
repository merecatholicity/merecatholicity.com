#!/usr/bin/env python3
"""Wave B3b feature test: the ported post renderer, exercised as a living
flow in the admins-only back room (invisible to members, no fan-out):

  create a topic through the real composer (real Turnstile), edit our own
  post in place, quote it into the reply box, forward a merecat answer in
  so a second author (the bot) renders, assert the visibility rules (no
  report link for admins, no DM on the bot), collapse the bot under mute
  and reveal it again — then delete everything we made.
"""
import json
import sys
import time

from flows import Flow, api, owner_key

BOT = 'efb94d8de69dc537e2bba1facbd9db3f849f3927593488d19c07629ce35f54cc'


def main():
    checks = []
    topic_id = None
    chat_id = None
    with Flow(port=9574, hover=True) as f:
        f.login()
        f.goto('community.html?cat=adminsonly')
        f.wait("!!document.querySelector('.comment-form .board-title')", timeout=20)
        f.type_into('.comment-form .board-title', 'Renderer battery (test)')
        f.type_into('.comment-form .comment-text', '**bold** proof and John 3:16 and :kekw:')
        f.wait("!!document.querySelector('.comment-form input[name=\"cf-turnstile-response\"]')"
               " && document.querySelector('.comment-form input[name=\"cf-turnstile-response\"]').value.length > 0",
               timeout=30)
        f.click('.comment-form button[type="submit"], .comment-form .btn-send')
        f.wait("location.search.indexOf('?topic=') === 0", timeout=25)
        topic_id = f.js1("return Number(new URLSearchParams(location.search).get('topic'));")
        checks.append(('topic posted via real composer', bool(topic_id)))
        f.wait("!!document.querySelector('article.comment .comment-body strong')", timeout=20)
        st = json.loads(f.js1("""var a=document.querySelector('article.comment');
          return JSON.stringify({
            scripture: !!a.querySelector('.comment-body a.scripture-link'),
            emoji: !!a.querySelector('.comment-body img.mc-emoji'),
            edit: !!a.querySelector('.comment-edit'),
            report: !!a.querySelector('a.comment-quote-link[title*="Report"]')});"""))
        checks.append(('own post renders rich (scripture+emoji)', st['scripture'] and st['emoji']))
        checks.append(('own post editable, not reportable', st['edit'] and not st['report']))
        # --- edit in place ---
        f.click('article.comment .comment-edit')
        f.wait("!!document.querySelector('article.comment textarea')", timeout=10)
        f.type_into('article.comment textarea', '**bold** proof EDITED and John 3:16')
        f.click('article.comment .btn-send, article.comment button[type="button"]')
        f.wait("(document.querySelector('article.comment .comment-body')||{textContent:''}).textContent.indexOf('EDITED') !== -1", timeout=15)
        checks.append(('edit-own round trip', True))
        # --- quote into the reply box ---
        f.click('article.comment .comment-quote-link')
        time.sleep(1)
        quoted = f.js1("var t=document.querySelector('.comment-form .comment-text'); return t ? t.value : '';")
        checks.append(('quote fills the reply box', '>' in (quoted or '')))
        checks.append(('console clean (authoring)', f.assert_console_clean('authoring')))

    # --- a second author: forward a merecat answer here ---
    import http.client
    conn = http.client.HTTPSConnection('merecatholicity.com', timeout=90)
    conn.request('POST', '/api/merecat/ask',
                 json.dumps({'key': owner_key(), 'effort': 'off',
                             'q': 'One sentence: who wrote the fourth Gospel?'}),
                 {'Content-Type': 'application/json'})
    r = conn.getresponse()
    raw = b''
    t0 = time.time()
    while time.time() - t0 < 120:
        chunk = r.read1(4096)
        if not chunk:
            break
        raw += chunk
        if b'\x03' in raw:
            break
    head = json.loads(raw[:raw.find(b'\n\n')])
    chat_id = head.get('chat')
    conn.sock.close()
    fw = api('/api/merecat/forward', {'key': owner_key(), 'chat': chat_id,
                                      'msg': 'last', 'topic': topic_id})
    print('forwarded:', fw.get('ok'), fw.get('id'))
    with Flow(port=9575) as f:
        f.login()
        f.goto('community.html?topic=%d' % topic_id)
        f.wait("document.querySelectorAll('article.comment').length >= 2", timeout=25)
        st = json.loads(f.js1("""
          var bots = Array.prototype.filter.call(document.querySelectorAll('article.comment'),
            function(a){ return (a.textContent||'').indexOf('Forwarded from the librarian') !== -1; });
          var b = bots[0];
          return JSON.stringify({found: !!b,
            dm: b ? !!b.querySelector('.comment-dm') : null,
            report: b ? !!b.querySelector('a[title*="Report"]') : null});"""))
        checks.append(('bot post rendered', st['found']))
        checks.append(('bot carries no DM link', st['dm'] is False))
        checks.append(('admin sees no report link', st['report'] is False))
        # --- mute the bot, reveal again ---
        f.js("localStorage.setItem('mc-muted', JSON.stringify([%s])); return 1;" % json.dumps(BOT))
        f.goto('community.html?topic=%d' % topic_id)
        muted_seen = f.wait("!!document.querySelector('.comment-muted')", timeout=20)
        checks.append(('muted member collapses', bool(muted_seen)))
        if muted_seen:
            f.click('.comment-muted a')
            f.wait("(function(){var t=document.body.textContent;return t.indexOf('Forwarded from the librarian')!==-1})()", timeout=10)
            checks.append(('reveal restores the post', True))
        f.js("localStorage.removeItem('mc-muted'); return 1;")
        checks.append(('console clean (bot+mute)', f.assert_console_clean('bot')))
    # --- cleanup ---
    if topic_id:
        print('cleanup topic:', api('/api/comments/delete', {'key': owner_key(), 'id': topic_id}).get('ok'))
    if chat_id:
        print('cleanup chat:', api('/api/merecat/chat/delete', {'key': owner_key(), 'id': chat_id}).get('ok'))
    fails = [c for c in checks if not c[1]]
    for n, p in checks:
        print(('PASS ' if p else 'FAIL '), n)
    sys.exit(2 if fails else 0)


if __name__ == '__main__':
    main()
