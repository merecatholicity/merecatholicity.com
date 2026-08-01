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

# Domain.Scripture (Phase 1a): render real references through the bundle's
# mcRich.fillBody — which now sources its regex + slug lookup from Core — and
# confirm the autolinks are unchanged, plus the raw bibleSrc/bookSlug shape.
SCRIPTURE_PROBE = r"""
  var d = document.createElement('div');
  window.mcRich.fillBody(d, 'See Rom 8:28-30 and John 3:16 and Nope 1:1 and Rom 0:5 here.', false);
  var links = Array.prototype.slice.call(d.querySelectorAll('a.scripture-link')).map(function (a) {
    return { href: a.getAttribute('href'), text: a.textContent };
  });
  var vp = window.mcCore.verseParts;
  var valid = vp('rom', '8', '28', '30');
  return {
    bibleSrcLen: (window.mcCore.bibleSrc || '').length,
    slug1cor: window.mcCore.bookSlug('1 cor'),
    slugNope: window.mcCore.bookSlug('nope'),
    links: links,
    plainNope: d.textContent.indexOf('Nope 1:1') !== -1,
    plainZero: d.textContent.indexOf('Rom 0:5') !== -1,
    validHref: valid && valid.href,
    validV2: valid && valid.v2,
    zeroRef: vp('rom', '0', '0', null),
    profileLimits: window.mcCore.profileLimits,
    faithNicene: window.mcCore.faithLabel('nicene'),
    faithsLen: (window.mcCore.faiths || []).length,
    pseudo: window.mcCore.displayName('ffffffffffffffff'),
    dmTtl: window.mcCore.dmTtlLabel(604800),
    dmTtlN: (window.mcCore.dmTtlOptions || []).length,
    accDelAdmin: window.mcCore.canDelete('x', 'me', true),
    accEditSelf: window.mcCore.canEdit('me', 'me'),
    accNoSelfInteract: window.mcCore.canInteract('me', 'me', 'bot'),
    replyPage21: window.mcCore.replyPage(21, 20),
    stickyWins: window.mcCore.topicCompare({sticky:1,last:1}, {sticky:0,last:99}) < 0,
    pager: (function () {
      function s(total, per, active) {
        return (window.mcCore.pagerItems(total, per, active) || []).map(function (it) {
          return it.gap ? '…' : (it.active ? it.n + '*' : String(it.n));
        }).join('|');
      }
      return { big: s(500, 20, 10), two: s(40, 20, 1), none: s(10, 20, 1) };
    })(),
    board: (function () {
      var r = window.mcCore.boardCatRows || [];
      return { n: r.length, firstKey: r[0] && r[0][0], firstLabel: r[0] && r[0][1],
        lastKey: r[13] && r[13][0], keys: (window.mcCore.boardCatKeys || []).join(','),
        admin: window.mcCore.adminCat };
    })(),
    emoji: (function () {
      var p = window.mcCore.emojiPacks || {};
      var t = (window.mcCore.emojiNamedTokens || '').trim().split(/\s+/);
      // render a custom-pack code, a named alias, and a bogus code through the
      // real renderer to prove the client builds CUSTOM_EMOJI/NAMED_EMOJI from mcCore.
      var d = document.createElement('div');
      window.mcRich.fillBody(d, 'a :cry: b :fire: c :notacode: d', false);
      var img = d.querySelector('img.mc-emoji');
      return { memes: (p.memes || []).length, pepe: (p.pepe || []).length,
        firstMeme: (p.memes || [])[0] && (p.memes || [])[0][0], namedPairs: t.length,
        cryImg: img && img.getAttribute('src'), hasFireChar: d.textContent.indexOf('🔥') !== -1,
        literalBogus: d.textContent.indexOf(':notacode:') !== -1 };
    })(),
    routes: (function () {
      function tag(qs) { var p = new URLSearchParams(qs); return window.mcCore.parseRoute(function (k) { return p.get(k); }); }
      return { index: tag('').tag, merecat: tag('merecat=1').tag, users: tag('users=1').tag,
        search: tag('q=').tag, topicTag: tag('topic=42').tag, topicN: tag('topic=42').n,
        catS: tag('cat=rc').s, priority: tag('merecat=1&topic=5').tag, dmS: tag('dm=abc').s,
        me: tag('me=1').tag, topicZero: tag('topic=0').tag };
    })(),
    auth: (function () {
      var C = window.mcCore;
      function s(k, h, pl, ma, hi) { return { hasKey: k, hasHash: h, profileLoaded: pl, myAdmin: ma, hint: hi }; }
      return { anonAdmin: C.authIsAdmin(s(false, false, false, true, true)),
        hintAdmin: C.authIsAdmin(s(true, true, false, false, true)),
        loadedNotAdmin: C.authIsAdmin(s(true, true, true, false, true)),
        member: C.authIsMember(s(true, true, false, false, false)),
        notMember: C.authIsMember(s(true, false, false, false, false)),
        gatePass: C.authGate(s(true, true, true, true, false)),
        gateWait: C.authGate(s(true, true, false, false, false)),
        gateDeny: C.authGate(s(false, false, false, false, false)) };
    })()
  };
"""


def main():
    with Flow(port=9571) as f:
        f.goto('credo.html?app=1')
        if not f.wait('window.mcCore && window.mcRich && typeof window.mcCore.rankLine === "function"', timeout=20):
            print('FAIL window.mcCore never appeared (bundle did not boot?)')
            return 2
        r = f.js1('return (function(){' + PROBE + '})();') or {}
        sc = f.js1('return (function(){' + SCRIPTURE_PROBE + '})();') or {}
        f.assert_console_clean('core')
        samples = r.get('samples') or {}
        if r.get('mismatches'):
            for m in r['mismatches']:
                print('  mismatch:', m)
        hrefs = [l.get('href') for l in (sc.get('links') or [])]
        checks = [
            ('window.mcCore populated from the bundle', bool(r.get('ok'))),
            ('mcCore shape (rankFor/rankLine are functions)', bool(r.get('shape'))),
            ('rankLine(250) == "Scribe · 250 posts"', samples.get('r250') == 'Scribe · 250 posts'),
            ('rankLine(1) singular "post"', samples.get('r1') == 'Novice · 1 post'),
            ('rankFor(5000) == "Treasury of Wisdom"', samples.get('r5000') == 'Treasury of Wisdom'),
            ('PS == classic across -5..6000 (no mismatches)', r.get('mismatches') == []),
            ('scripture: Rom 8:28-30 → kjv.html#romans-8-28', 'kjv.html#romans-8-28' in hrefs),
            ('scripture: John 3:16 → kjv.html#john-3-16', 'kjv.html#john-3-16' in hrefs),
            ('scripture: only the 2 valid refs link (Nope + Rom 0:5 stay plain)',
             len(sc.get('links') or []) == 2 and bool(sc.get('plainNope')) and bool(sc.get('plainZero'))),
            ('mcCore.verseParts valid ref → href romans-8-28, v2 30',
             sc.get('validHref') == 'romans-8-28' and sc.get('validV2') == 30),
            ('mcCore.verseParts rejects Rom 0:0 (→ null)', sc.get('zeroRef') is None),
            ('mcCore.bibleSrc is 2267 chars', sc.get('bibleSrcLen') == 2267),
            ("mcCore.bookSlug('1 cor') == '1-corinthians'", sc.get('slug1cor') == '1-corinthians'),
            ("mcCore.bookSlug('nope') == null", sc.get('slugNope') is None),
            ('mcCore.profileLimits == {nick:40, bio:500, sig:200} (drift-killer)',
             (sc.get('profileLimits') or {}).get('bio') == 500
             and (sc.get('profileLimits') or {}).get('nick') == 40
             and (sc.get('profileLimits') or {}).get('sig') == 200),
            ('mcCore.faithLabel + faiths (3 ordered)',
             sc.get('faithNicene') == 'Nicene' and sc.get('faithsLen') == 3),
            ('mcCore.displayName parity (ffff… → Green-Wheat ffff)',
             sc.get('pseudo') == 'Green-Wheat ffff'),
            ('mcCore.dmTtlLabel/Options (604800 → "7 days", 3 options)',
             sc.get('dmTtl') == '7 days' and sc.get('dmTtlN') == 3),
            ('mcCore.canDelete/canEdit/canInteract (permission matrix)',
             sc.get('accDelAdmin') is True and sc.get('accEditSelf') is True
             and sc.get('accNoSelfInteract') is False),
            ('mcCore.replyPage/topicCompare (live decisions)',
             sc.get('replyPage21') == 2 and sc.get('stickyWins') is True),
            ('mcCore.pagerItems windowing (1|…|9|10*|11|…|25 ; 1*|2 ; empty)',
             (sc.get('pager') or {}).get('big') == '1|…|9|10*|11|…|25'
             and (sc.get('pager') or {}).get('two') == '1*|2'
             and (sc.get('pager') or {}).get('none') == ''),
            ('mcCore.boardCatRows/Keys/adminCat (14 cats, pub first, adminsonly last)',
             (sc.get('board') or {}).get('n') == 14
             and (sc.get('board') or {}).get('firstKey') == 'pub'
             and (sc.get('board') or {}).get('firstLabel') == 'Pub'
             and (sc.get('board') or {}).get('lastKey') == 'adminsonly'
             and (sc.get('board') or {}).get('admin') == 'board:adminsonly'
             and (sc.get('board') or {}).get('keys', '').startswith('pub,news,offtopic')),
            ('mcCore.emojiPacks/Tokens render (:cry:→img, :fire:→🔥, :notacode: literal)',
             (sc.get('emoji') or {}).get('memes') == 33
             and (sc.get('emoji') or {}).get('pepe') == 27
             and (sc.get('emoji') or {}).get('firstMeme') == 'cry'
             and (sc.get('emoji') or {}).get('namedPairs') == 364
             and (sc.get('emoji') or {}).get('cryImg') == 'emoji/memes/cry.webp'
             and (sc.get('emoji') or {}).get('hasFireChar') is True
             and (sc.get('emoji') or {}).get('literalBogus') is True),
            ('mcCore.parseRoute ladder (index/merecat/users/search/topic/cat/priority/me; topic=0→index)',
             (sc.get('routes') or {}).get('index') == 'Index'
             and (sc.get('routes') or {}).get('merecat') == 'Merecat'
             and (sc.get('routes') or {}).get('users') == 'Users'
             and (sc.get('routes') or {}).get('search') == 'Search'
             and (sc.get('routes') or {}).get('topicTag') == 'Topic'
             and (sc.get('routes') or {}).get('topicN') == 42
             and (sc.get('routes') or {}).get('catS') == 'rc'
             and (sc.get('routes') or {}).get('priority') == 'Merecat'
             and (sc.get('routes') or {}).get('dmS') == 'abc'
             and (sc.get('routes') or {}).get('me') == 'Me'
             and (sc.get('routes') or {}).get('topicZero') == 'Index'),
            ('mcCore.auth classification (no-key/hint/server-override admin; member; gate pass/wait/deny)',
             (sc.get('auth') or {}).get('anonAdmin') is False
             and (sc.get('auth') or {}).get('hintAdmin') is True
             and (sc.get('auth') or {}).get('loadedNotAdmin') is False
             and (sc.get('auth') or {}).get('member') is True
             and (sc.get('auth') or {}).get('notMember') is False
             and (sc.get('auth') or {}).get('gatePass') == 'pass'
             and (sc.get('auth') or {}).get('gateWait') == 'wait'
             and (sc.get('auth') or {}).get('gateDeny') == 'deny'),
        ]
        return f.verdict(checks)


if __name__ == '__main__':
    sys.exit(main())
