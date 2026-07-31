#!/usr/bin/env python3
"""test_core_rank.py — Phase 0 of the PureScript migration (Domain.Rank).

Proves, in a real browser over the real minified docs/app.js:
  * the BUNDLE route: window.mcCore is populated from compiled PureScript
    (shell.js imports app/core.js -> purescript/output, inlined by esbuild), and
  * PARITY: window.mcCore.rankFor/rankLine byte-match the classic JS ladder
    they replace (docs/comments.js:53-66), across the whole threshold sweep.
This is Layer 2; Layer 1 is `make pstest` (purescript/test/run.mjs).

An unshipped slice must be tested against a LOCAL bundle, never prod:
  (cd docs && python3 -m http.server 8000 --bind 127.0.0.1) &
  MC_BASE=http://127.0.0.1:8000 python3 webtest/test_core_rank.py
"""
import sys
from flows import Flow

PROBE = r"""
  // The classic ladder, reimplemented verbatim from docs/comments.js:53-66,
  // as the parity oracle for the PureScript-backed window.mcCore.
  var RANKS = [[0,'Novice'],[10,'Apprentice'],[50,'Scriptorium Hand'],[100,'Copyist'],
    [250,'Scribe'],[500,'Illuminator'],[1000,'Master Scribe'],
    [2500,'Keeper of Scrolls'],[5000,'Treasury of Wisdom']];
  function classicRankFor(n){ n = Number(n)||0; var name=RANKS[0][1];
    for(var i=0;i<RANKS.length;i++){ if(n>=RANKS[i][0]) name=RANKS[i][1]; } return name; }
  function classicRankLine(p){ return classicRankFor(p)+' · '+p+(p===1?' post':' posts'); }
  var C = window.mcCore;
  if (!C) return { ok:false, why:'no window.mcCore' };
  var shape = (typeof C.rankFor==='function') && (typeof C.rankLine==='function');
  var mism = [];
  for (var n=-5; n<=6000; n++){
    if (C.rankFor(n) !== classicRankFor(n))
      mism.push('rankFor '+n+' -> '+C.rankFor(n)+' vs '+classicRankFor(n));
    if (C.rankLine(n) !== classicRankLine(n))
      mism.push('rankLine '+n+' -> '+JSON.stringify(C.rankLine(n))+' vs '+JSON.stringify(classicRankLine(n)));
    if (mism.length>5) break;
  }
  return { ok:true, shape:shape,
    samples: { r250:C.rankLine(250), r1:C.rankLine(1), r5000:C.rankFor(5000) },
    mismatches: mism };
"""


def main():
    with Flow(port=9571) as f:
        f.goto('credo.html?app=1')
        if not f.wait('window.mcCore && typeof window.mcCore.rankLine === "function"', timeout=20):
            print('FAIL window.mcCore never appeared (bundle did not boot?)')
            return 2
        r = f.js1('return (function(){' + PROBE + '})();') or {}
        f.assert_console_clean('core-rank')
        samples = r.get('samples') or {}
        if r.get('mismatches'):
            for m in r['mismatches']:
                print('  mismatch:', m)
        checks = [
            ('window.mcCore populated from the bundle', bool(r.get('ok'))),
            ('mcCore shape (rankFor/rankLine are functions)', bool(r.get('shape'))),
            ('rankLine(250) == "Scribe · 250 posts"', samples.get('r250') == 'Scribe · 250 posts'),
            ('rankLine(1) singular "post"', samples.get('r1') == 'Novice · 1 post'),
            ('rankFor(5000) == "Treasury of Wisdom"', samples.get('r5000') == 'Treasury of Wisdom'),
            ('PS == classic across -5..6000 (no mismatches)', r.get('mismatches') == []),
        ]
        return f.verdict(checks)


if __name__ == '__main__':
    sys.exit(main())
