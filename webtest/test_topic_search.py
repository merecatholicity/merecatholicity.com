#!/usr/bin/env python3
"""Wave B4+B5 feature test on prod: <mc-topic> and <mc-search>.

Topic: the component renders a real thread (crumb, head, posts via the
shared renderer, pager, reply composer), soft-hops from the category, and
honors the scroll-to-comment `find` contract — the CLAUDE.md cross-page
jump: community.html?topic=T#comment-C lands on the right page and scrolls
to the comment. Search: the component renders, filters shape the URL, and
a real query returns highlighted results linking to their posts.
"""
import json
import sys
import time

from flows import Flow


def main():
    checks = []
    with Flow(port=9586) as f:
        f.login()
        # --- topic: soft hop from a category into a real thread ---
        f.goto('community.html?cat=pub')
        f.wait("!!document.querySelector('mc-board-cat') && document.querySelectorAll('.board-topic').length>0", timeout=20)
        f.drain()
        f.click('.board-topic a.board-topic-title')
        f.wait("!!document.querySelector('mc-topic')", timeout=20)
        f.wait("document.querySelectorAll('mc-topic article.comment').length>0", timeout=20)
        soft = f.assert_soft('topic hop')
        st = json.loads(f.js1("""var t=document.querySelector('mc-topic');
          return JSON.stringify({
            crumb: !!t.querySelector('.board-crumb'),
            head: !!t.querySelector('.board-topic-head'),
            posts: t.querySelectorAll('article.comment').length,
            composer: !!document.querySelector('.comment-form .comment-text'),
            scripture: !!t.querySelector('.comment-body a.scripture-link, .comment-body')});"""))
        checks.append(('topic renders (crumb+head+posts)', st['crumb'] and st['head'] and st['posts'] >= 1))
        checks.append(('topic hop soft', soft))
        checks.append(('reply composer mounts', st['composer']))
        topic_id = f.js1("return Number(new URLSearchParams(location.search).get('topic'));")
        first_comment = f.js1("var a=document.querySelector('mc-topic article.comment'); return a? a.id.replace('comment-',''):'';")

        # --- the find/scroll contract: deep-link to that comment fresh ---
        f.goto('community.html?topic=%d#comment-%s' % (topic_id, first_comment))
        f.wait("!!document.getElementById('comment-%s')" % first_comment, timeout=20)
        time.sleep(2)
        jumped = f.js1("""var el=document.getElementById('comment-%s');
          if(!el) return false;
          var r=el.getBoundingClientRect();
          return r.top < window.innerHeight && r.bottom > -5;""" % first_comment)
        checks.append(('deep-link scrolls to the comment', bool(jumped)))
        checks.append(('topic console clean', f.assert_console_clean('topic')))

        # --- search ---
        f.goto('community.html?q=church')
        f.wait("!!document.querySelector('mc-search')", timeout=20)
        f.wait("!!document.querySelector('mc-search .board-search .mc-q')", timeout=15)
        time.sleep(3)
        sv = json.loads(f.js1("""var s=document.querySelector('mc-search');
          var rows=s.querySelectorAll('.board-topic');
          var marks=s.querySelectorAll('.board-topic mark');
          return JSON.stringify({
            form: !!s.querySelector('.board-search'),
            qval: (s.querySelector('.mc-q')||{}).value||'',
            count: (s.querySelector('.comments-status')||{}).textContent||'',
            rows: rows.length,
            firstHref: rows.length? rows[0].querySelector('a.board-topic-title').getAttribute('href'):'',
            marks: marks.length});"""))
        checks.append(('search form renders with query', sv['form'] and sv['qval'] == 'church'))
        # 'church' is common — expect results with highlight marks linking to a post
        if 'Nothing found' in sv['count']:
            checks.append(('search returned results', False))
        else:
            checks.append(('search returned results', sv['rows'] >= 1))
            checks.append(('results link to a comment', '#comment-' in (sv['firstHref'] or '')))
            checks.append(('snippet highlight marks present', sv['marks'] >= 1))
        checks.append(('search console clean', f.assert_console_clean('search')))
        fails = list(f.failures)
    for x in fails:
        print('FAIL', x)
    for n, p in checks:
        print(('PASS ' if p else 'FAIL '), n)
    sys.exit(2 if (fails or any(not p for _, p in checks)) else 0)


if __name__ == '__main__':
    main()
