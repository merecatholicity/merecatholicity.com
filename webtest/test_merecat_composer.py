#!/usr/bin/env python3
"""The merecat ask row is the DM composer's shape (2026-09-11): one rounded,
auto-growing field and a round send button, flush on the tab bar on phones.

Phone (a 390px window): the form is one row, its bottom edge meets the tab
bar's top edge before any scroll (the old injected .2rem bottom margin
floated it — a fixed element's `bottom` places the margin edge), the button
is round with its word hidden, the field stands one row tall and grows with
the words, and there is no footer under it. Desktop: the row stands in the
page flow with the icon and the word "Ask". Nothing is asked.
"""
import json
import sys
import time

from flows import Flow


def jsj(f, js):
    r = f.js1(js)
    return json.loads(r) if isinstance(r, str) else {}


SHAPE = """return JSON.stringify((function(){
  var q = function(s){ return document.querySelector(s); };
  var form = q('.merecat-form'), ta = q('.merecat-q'), btn = q('.merecat-form .btn-send'), tb = q('.mc-tabbar'), foot = q('mc-footer');
  if (!form || !ta || !btn) return { missing: true };
  var fr = form.getBoundingClientRect(), br = btn.getBoundingClientRect();
  var one = ta.getBoundingClientRect().height;
  ta.value = 'one\\ntwo\\nthree\\nfour'; ta.dispatchEvent(new Event('input', { bubbles: true }));
  var four = ta.getBoundingClientRect().height;
  ta.value = ''; ta.dispatchEvent(new Event('input', { bubbles: true }));
  var back = ta.getBoundingClientRect().height;
  return { row: getComputedStyle(form).flexDirection === 'row', position: getComputedStyle(form).position,
           marginBottom: getComputedStyle(form).marginBottom,
           flushTab: tb ? Math.abs(fr.bottom - tb.getBoundingClientRect().top) < 1 : null,
           round: Math.abs(br.width - br.height) < 1 && getComputedStyle(btn).borderRadius.indexOf('50%') !== -1,
           wordShown: getComputedStyle(q('.merecat-ask-word')).display !== 'none',
           icon: !!btn.querySelector('.mc-ic-send'), rows: Number(ta.getAttribute('rows')),
           one: one, four: four, back: back, grows: four > one + 20 && Math.abs(back - one) < 2,
           footerHidden: !foot || getComputedStyle(foot).display === 'none', tab: document.body.dataset.mcTab || '' };
})());"""


def main():
    checks = []
    with Flow(port=9651) as f:
        f.login()
        f._wd('POST', '/session/%s/window/rect' % f.sid, {'width': 390, 'height': 844})
        f.goto('merecat-ai.html')
        f.wait("!!document.querySelector('.merecat-form .btn-send') && !!document.querySelector('.mc-tabbar')", timeout=25)
        time.sleep(1)
        st = jsj(f, SHAPE)
        checks.append(('phone: the ask row is ONE row, fixed, with no bottom margin', st.get('row') and st.get('position') == 'fixed' and st.get('marginBottom') == '0px'))
        checks.append(('phone: the row sits flush on the tab bar before any scroll', st.get('flushTab')))
        checks.append(('phone: a round send button, the icon alone', st.get('round') and st.get('icon') and not st.get('wordShown')))
        checks.append(('phone: the field is one row and grows with the words, then shrinks back', st.get('rows') == 1 and st.get('grows') and (st.get('one') or 99) < 52))
        checks.append(('phone: no footer under the librarian', st.get('footerHidden') and st.get('tab') == 'merecat'))
        checks.append(('phone console clean', f.assert_console_clean('merecat phone')))
        fails = list(f.failures)
    with Flow(port=9652, hover=True) as f:
        f.login()
        f.goto('merecat-ai.html')
        f.wait("!!document.querySelector('.merecat-form .btn-send')", timeout=25)
        time.sleep(1)
        st = jsj(f, SHAPE)
        checks.append(('desktop: the row stands in the flow with the icon and the word', st.get('row') and st.get('position') != 'fixed' and st.get('icon') and st.get('wordShown')))
        checks.append(('desktop: the field is one row and grows with the words', st.get('rows') == 1 and st.get('grows')))
        checks.append(('desktop console clean', f.assert_console_clean('merecat desktop')))
        fails += f.failures
    rc = 2 if fails or any(not p for _, p in checks) else 0
    for x in fails:
        print('FAIL', x)
    for n, p in checks:
        print(('PASS ' if p else 'FAIL '), n)
    return rc


if __name__ == '__main__':
    sys.exit(main())
