#!/usr/bin/env python3
"""The composer loss guard (2026-09-07).

Born of a live report: hitting Post sometimes white-flashed, reloaded, posted
nothing, and lost what had been typed — so the reader had to write the message
again. Whatever is causing that reload, losing the words to it is the part that
actually hurts, and it is separately fixable.

Drafts were saved 400ms after the last keystroke, plus on blur. Both USUALLY
fire before a submit, and "usually" is exactly what was failing: type fast, tap
Post, and a reload landing in the gap took the text with it. The draft is now
written on POINTERDOWN, capture phase — before any handler, before any async
work, before anything can reload the page.

This test drives that exact race. Run: python3 webtest/test_draft_guard.py
"""
import json
import sys
import time

from flows import Flow

CTX = 'mc-draft:topic:pub'
MARK = 'RACED-TEXT-MUST-SURVIVE'

TYPE_THEN_PRESS = """
var ta = document.querySelector('.comment-form .comment-text');
if (!ta) return JSON.stringify({err: 'no composer'});
try { localStorage.removeItem(%s); } catch (e) {}
ta.focus();
ta.value = %s;
ta.dispatchEvent(new Event('input', {bubbles:true}));
/* Before the 400ms debounce and before any blur: nothing should be stored. */
var beforePress = localStorage.getItem(%s);
/* Now press Post, the way a fast typist does — no pause. */
var btn = document.querySelector('.comment-buttons button');
if (btn) btn.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true}));
var afterPress = localStorage.getItem(%s);
return JSON.stringify({
  beforePress: !!beforePress,
  afterPress: !!afterPress,
  body: afterPress ? JSON.parse(afterPress).body : null
});
""" % (json.dumps(CTX), json.dumps(MARK), json.dumps(CTX), json.dumps(CTX))


def main():
    checks = []
    with Flow(port=9653) as f:
        f.login()
        f.goto('community.html?cat=pub')
        time.sleep(7)
        r = json.loads(f.js1(TYPE_THEN_PRESS))
        if r.get('err'):
            print('FAIL  ' + r['err'])
            sys.exit(1)

        # Not an assertion about desired behaviour — it pins the GAP the guard
        # exists to close, so this test would still mean something if the
        # debounce were ever shortened into hiding the real fix.
        checks.append(('the debounce alone had not saved it yet (the gap is real)',
                       not r['beforePress']))
        checks.append(('a press on Post writes the draft synchronously',
                       r['afterPress'] and r['body'] == MARK))

        # And it must actually come back after the reload being reported.
        f.goto('community.html?cat=pub')
        time.sleep(7)
        back = f.js("return (document.querySelector('.comment-form .comment-text')||{}).value || '';")
        checks.append(('and it is still in the composer after a hard reload',
                       back == MARK))

        # Leave nothing behind for the next run or the next human.
        f.js("try { localStorage.removeItem(%s); } catch (e) {} return 1;" % json.dumps(CTX))
        harness = list(f.failures)

    ok = True
    for label, passed in checks:
        print(('  ok ' if passed else 'FAIL ') + label)
        ok = ok and bool(passed)
    for h in harness:
        print('HARNESS ' + h)
    print('%d/%d passed' % (sum(1 for _, p in checks if p), len(checks)))
    sys.exit(0 if ok and not harness else 1)


if __name__ == '__main__':
    main()
