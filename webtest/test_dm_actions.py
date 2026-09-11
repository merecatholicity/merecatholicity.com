#!/usr/bin/env python3
"""The DM press-and-hold surface (2026-09-10), proven on prod over FIXTURES.

A conversation is rendered from synthetic messages: a page-level fetch stub
(installed before any document script through chromedriver's CDP endpoint)
answers the thread read with four fixture bubbles — theirs and mine, one
saved, one reacted on both sides, one edited, one a reply quoting the first —
and swallows every DM write, so the surface is exercised end to end with
nothing sent, reacted, saved or read from a real conversation. The owner's
own inbox is never opened.

Desktop (an emulated fine pointer, `hover=True`): the WhatsApp-shaped bubbles
(meta row, no author line, day chips, the hover ⌄, the saved ring, the
reaction pills, the quote block that jumps and flashes), a right-click opens
the popover surface — the quick six and the +, the menu with only the acts
that apply — the + swaps in the whole picker, Reply arms the "Replying to"
strip and ✕ disarms it, Escape leaves nothing behind, and the live hooks
repaint a pill and a saved ring. Phone (headless Chrome's default
`(hover: none)`): a synthetic press-and-hold opens the phone surface — four
pieces of scrim around the bubble, the document locked — and Escape releases
the lock with the body unpinned.
"""
import json
import sys
import time

from flows import Flow

OTHER = 'f1c7' * 16   # a 64-hex correspondent that is nobody; the read is stubbed

STUB = r"""
(function () {
  var OTHER = %s;
  var real = window.fetch;
  function reply(body) {
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  }
  function myHash() {
    return new Promise(function (res) {
      var n = 0;
      (function tick() {
        var h = window.mcKit && window.mcKit.state && window.mcKit.state.myHash;
        if (h || n++ > 100) return res(h || '');
        setTimeout(tick, 50);
      })();
    });
  }
  window.__mcDmWrites = [];
  window.fetch = function (url, opts) {
    var u = String(url);
    if (u.indexOf('/api/comments/dm/thread') !== -1) {
      return myHash().then(function (me) {
        var now = Math.floor(Date.now() / 1000);
        var msgs = [
          { id: 101, sender_hash: OTHER, body: 'First word from them', created_at: now - 2 * 86400, enc: 0, saved: 0, react_me: '', react_other: '' },
          { id: 102, sender_hash: me, body: 'My reply from yesterday', created_at: now - 86400, enc: 0, saved: 1, opened_at: now - 80000, react_me: '', react_other: '❤️' },
          { id: 103, sender_hash: OTHER, body: 'Today they wrote', created_at: now - 600, enc: 0, saved: 0, edited_at: now - 500, react_me: '👍', react_other: '👍' },
          { id: 104, sender_hash: me, body: 'And I answered', created_at: now - 60, enc: 0, saved: 0, react_me: '', react_other: '',
            reply: { id: 101, from: OTHER, kind: 'text', text: 'First word from them' } }
        ];
        return reply({ ok: true, thread_id: 1, ttl: 604800,
          other: { hash: OTHER, nick: 'Fixture', avatar: null, assigned: 'Fixture', pubkey: null },
          messages: msgs, total: msgs.length, page: 1, per: 20, blocked: 0 });
      });
    }
    if (/\/api\/comments\/dm\/(react|save|redact|edit|seen|ttl|send)/.test(u)) {
      window.__mcDmWrites.push(u);
      return reply({ ok: true, id: 0, emoji: '', saved: 1, edited_at: 0 });
    }
    return real.apply(this, arguments);
  };
})();
"""


def install_stub(f):
    f._wd('POST', '/session/%s/goog/cdp/execute' % f.sid,
          {'cmd': 'Page.addScriptToEvaluateOnNewDocument', 'params': {'source': STUB % json.dumps(OTHER)}})


def open_fixture(f):
    f.goto('messages.html?dm=' + OTHER)
    f.wait("document.querySelectorAll('.dm-msg[data-dmid]').length === 4", timeout=25)
    time.sleep(1)


SHAPE = """return JSON.stringify((function(){
  var q = function(s){ return document.querySelector(s); };
  var bs = Array.prototype.slice.call(document.querySelectorAll('.dm-msg[data-dmid]'));
  var b102 = q('[data-dmid="102"]'), b103 = q('[data-dmid="103"]'), b104 = q('[data-dmid="104"]');
  return {
    bubbles: bs.length,
    meta: bs.every(function(b){ return !!b.querySelector(':scope > .dm-meta .comment-date'); }),
    noHead: bs.every(function(b){ return !b.querySelector('.comment-head, .comment-author'); }),
    mine: [b102, b104].every(function(b){ return b.classList.contains('dm-mine'); }) && !b103.classList.contains('dm-mine'),
    days: document.querySelectorAll('.dm-day').length,
    dayText: Array.prototype.map.call(document.querySelectorAll('.dm-day'), function(d){ return d.textContent; }),
    more: bs.every(function(b){ return !!b.querySelector(':scope > .dm-more'); }),
    saved102: b102.classList.contains('dm-saved') && !!b102.querySelector('.dm-meta .dm-savedmark'),
    ticks102: (b102.querySelector('.dm-meta .dm-receipt')||{}).textContent === '✓✓',
    ticks104: (b104.querySelector('.dm-meta .dm-receipt')||{}).textContent === '✓',
    noTicks103: !b103.querySelector('.dm-receipt'),
    pill102: (b102.querySelector(':scope > .dm-react-pill')||{}).textContent === '❤️',
    pill103: (b103.querySelector(':scope > .dm-react-pill')||{}).textContent === '👍2',
    noPill104: !b104.querySelector('.dm-react-pill'),
    edited103: !!b103.querySelector('.dm-meta .dm-edited'),
    quote104: !!b104.querySelector(':scope > .dm-quote') && (b104.querySelector('.dm-quote-who')||{}).textContent === 'Fixture'
      && (b104.querySelector('.dm-quote-text')||{}).textContent === 'First word from them',
    replyBarHidden: !!(q('.dm-reply-bar')||{}).hidden,
    writes: (window.__mcDmWrites||[]).length
  };
})());"""


def main():
    checks = []
    # ---- desktop: the popover at the pointer ----
    with Flow(port=9611, hover=True) as f:
        f.login()
        install_stub(f)
        open_fixture(f)
        st = json.loads(f.js1(SHAPE))
        checks.append(('four fixture bubbles render, mine on my side', st['bubbles'] == 4 and st['mine']))
        checks.append(('every bubble: a meta row with the time, no author line', st['meta'] and st['noHead']))
        checks.append(('day chips: one per day, the last two Yesterday and Today', st['days'] == 3 and st['dayText'][-2:] == ['Yesterday', 'Today']))
        checks.append(('the hover ⌄ is on every bubble (fine pointer)', st['more']))
        checks.append(('a saved message is lit: the ring and the ★', st['saved102']))
        checks.append(('ticks: ✓✓ on my seen bubble, ✓ on my fresh one, none on theirs', st['ticks102'] and st['ticks104'] and st['noTicks103']))
        checks.append(('reaction pills: theirs alone, "👍 2" when we agree, none without', st['pill102'] and st['pill103'] and st['noPill104']))
        checks.append(('an edited message says so in its meta', st['edited103']))
        checks.append(('a reply carries the quote block naming them and their words', st['quote104']))
        checks.append(('the reply strip is mounted hidden above the composer', st['replyBarHidden']))
        jumped = f.js1("""var q = document.querySelector('[data-dmid="104"] .dm-quote'); q.click();
          return document.querySelector('[data-dmid="101"]').classList.contains('dm-flash');""")
        checks.append(('tapping the quote flashes the original', bool(jumped)))
        opened = json.loads(f.js1("""return JSON.stringify((function(){
          var b = document.querySelector('[data-dmid="104"]');
          var r = b.getBoundingClientRect();
          b.dispatchEvent(new MouseEvent('contextmenu', {bubbles:true, cancelable:true, clientX:r.left+20, clientY:r.top+10}));
          var act = document.querySelector('.dm-act');
          var labels = Array.prototype.map.call(document.querySelectorAll('.dm-act-menu .dm-act-item .dm-act-label'), function(x){return x.textContent;});
          return { desk: !!(act && act.classList.contains('dm-act-desk')), held: b.classList.contains('dm-held'),
                   cells: document.querySelectorAll('.dm-act-bar .dm-act-emoji').length, hasMore: !!document.querySelector('.dm-act-bar .dm-act-more'),
                   lit: document.querySelectorAll('.dm-act-bar .dm-act-emoji.on').length, labels: labels,
                   locked: document.documentElement.classList.contains('mc-sheet-open') };
        })());"""))
        checks.append(('right-click opens the desktop popover over the held bubble, no lock', opened['desk'] and opened['held'] and not opened['locked']))
        checks.append(('the bar: the quick six and the +, none lit (no reaction of mine)', opened['cells'] == 7 and opened['hasMore'] and opened['lit'] == 0))
        checks.append(('my bubble: Reply · Copy · Edit · Save · Delete', opened['labels'] == ['Reply', 'Copy', 'Edit', 'Save', 'Delete']))
        replied = json.loads(f.js1("""return JSON.stringify((function(){
          var items = document.querySelectorAll('.dm-act-menu .dm-act-item');
          items[0].click();   // Reply
          var bar = document.querySelector('.dm-reply-bar');
          return { gone: !document.querySelector('.dm-act'), shown: bar && !bar.hidden,
                   who: (bar.querySelector('.dm-quote-who')||{}).textContent, text: (bar.querySelector('.dm-quote-text')||{}).textContent };
        })());"""))
        checks.append(('Reply closes the surface and arms "Replying to yourself" with my words',
                       replied['gone'] and replied['shown'] and replied['who'] == 'Replying to yourself' and replied['text'] == 'And I answered'))
        disarmed = f.js1("""document.querySelector('.dm-reply-x').click(); return !!document.querySelector('.dm-reply-bar').hidden;""")
        checks.append(('✕ disarms the reply', bool(disarmed)))
        theirs = json.loads(f.js1("""return JSON.stringify((function(){
          var b = document.querySelector('[data-dmid="103"]');
          b.dispatchEvent(new MouseEvent('contextmenu', {bubbles:true, cancelable:true, clientX:20, clientY:20}));
          var labels = Array.prototype.map.call(document.querySelectorAll('.dm-act-menu .dm-act-item .dm-act-label'), function(x){return x.textContent;});
          var lit = document.querySelector('.dm-act-bar .dm-act-emoji.on');
          return { labels: labels, lit: lit ? lit.textContent : '', litTitle: lit ? lit.title : '' };
        })());"""))
        checks.append(('their bubble: Reply · Copy · Save — no Edit, no Delete', theirs['labels'] == ['Reply', 'Copy', 'Save']))
        checks.append(('my current reaction is lit, and tapping it would withdraw', theirs['lit'] == '\U0001F44D' and theirs['litTitle'] == 'Remove your reaction'))
        picker = json.loads(f.js1("""return JSON.stringify((function(){
          document.querySelector('.dm-act-bar .dm-act-more').click();
          return { panel: !!document.querySelector('.dm-act .dm-act-picker.emoji-panel'),
                   cells: document.querySelectorAll('.dm-act .dm-act-picker .emoji-cell').length,
                   barHidden: !!document.querySelector('.dm-act-bar').hidden, menuHidden: !!document.querySelector('.dm-act-menu').hidden };
        })());"""))
        checks.append(('+ swaps in the whole picker in place of bar and menu', picker['panel'] and picker['cells'] > 50 and picker['barHidden'] and picker['menuHidden']))
        picked = json.loads(f.js1("""return JSON.stringify((function(){
          var tab = Array.prototype.find.call(document.querySelectorAll('.dm-act-picker .emoji-tab'), function(t){ return t.textContent === 'Pepe'; });
          tab.click();
          var cell = document.querySelector('.dm-act-picker .emoji-cell img.mc-emoji');
          var code = cell ? cell.alt : '';
          cell.parentNode.click();
          var pill = document.querySelector('[data-dmid="103"] > .dm-react-pill');
          return { code: code, gone: !document.querySelector('.dm-act'),
                   img: pill && pill.querySelectorAll('img.mc-emoji').length, glyph: pill ? pill.textContent : '',
                   wrote: (window.__mcDmWrites||[]).some(function(u){ return u.indexOf('/dm/react') !== -1; }) };
        })());"""))
        checks.append(('a pack emoji reacts as its image: the pill shows 👍 (theirs) and the pepe (mine), one stubbed write',
                       picked['gone'] and picked['code'].startswith(':') and picked['img'] == 1 and picked['glyph'] == '\U0001F44D' and picked['wrote']))
        live = json.loads(f.js1("""return JSON.stringify((function(){
          var b104 = document.querySelector('[data-dmid="104"]');
          b104.mcReactPaint('😂'); b104.mcSavedPaint(1);
          var p = b104.querySelector(':scope > .dm-react-pill');
          return { pill: p ? p.textContent : '', saved: b104.classList.contains('dm-saved') && !!b104.querySelector('.dm-savedmark') };
        })());"""))
        checks.append(('the live hooks repaint: their 😂 lands as a pill, their save lights my bubble', live['pill'] == '\U0001F602' and live['saved']))
        closed = f.js1("""var b = document.querySelector('[data-dmid="102"]');
          b.dispatchEvent(new MouseEvent('contextmenu', {bubbles:true, cancelable:true, clientX:20, clientY:20}));
          var open = !!document.querySelector('.dm-act');
          document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true, cancelable:true}));
          return open && !document.querySelector('.dm-act') && !document.querySelector('.dm-held');""")
        checks.append(('Escape closes the surface and leaves nothing behind', bool(closed)))
        writes = f.js1("return (window.__mcDmWrites||[]).join(' ');")
        checks.append(('the only write the whole run made was the stubbed reaction', writes.count('/dm/') == 1 and '/dm/react' in writes))
        checks.append(('desktop console clean', f.assert_console_clean('dm desktop')))
        fails = list(f.failures)
    # ---- phone: the hole between four pieces of scrim, and the lock ----
    with Flow(port=9612) as f:
        f.login()
        install_stub(f)
        open_fixture(f)
        ph = json.loads(f.js1("""return JSON.stringify((function(){
          var b = document.querySelector('[data-dmid="103"]');
          var r = b.getBoundingClientRect();
          var t = new Touch({identifier: 7, target: b, clientX: r.left + 20, clientY: r.top + 10});
          b.dispatchEvent(new TouchEvent('touchstart', {touches:[t], targetTouches:[t], changedTouches:[t], bubbles:true, cancelable:true}));
          return { moreHidden: getComputedStyle(b.querySelector('.dm-more')).display === 'none', before: !!document.querySelector('.dm-act'),
                   ctxMenu: (function(){ b.dispatchEvent(new MouseEvent('contextmenu', {bubbles:true, cancelable:true})); return !!document.querySelector('.dm-act'); })() };
        })());"""))
        checks.append(('the hover ⌄ is hidden under (hover: none)', bool(ph['moreHidden'])))
        checks.append(('nothing opens before the hold matures, and contextmenu is not a road on touch', not ph['before'] and not ph['ctxMenu']))
        time.sleep(0.7)
        held = json.loads(f.js1("""return JSON.stringify((function(){
          var act = document.querySelector('.dm-act');
          return { phone: !!(act && act.classList.contains('dm-act-phone')), scrims: document.querySelectorAll('.dm-act-scrim').length,
                   locked: document.documentElement.classList.contains('mc-sheet-open'),
                   bar: !!document.querySelector('.dm-act-bar'), menu: !!document.querySelector('.dm-act-menu'), held: !!document.querySelector('.dm-held') };
        })());"""))
        checks.append(('a press-and-hold opens the phone surface: bar, hole, menu', held['phone'] and held['bar'] and held['menu'] and held['held']))
        checks.append(('four pieces of scrim around the bubble', held['scrims'] == 4))
        checks.append(('the document is locked while the surface stands', held['locked']))
        released = json.loads(f.js1("""return JSON.stringify((function(){
          var b = document.querySelector('[data-dmid="103"]');
          var t = new Touch({identifier: 7, target: b, clientX: 0, clientY: 0});
          b.dispatchEvent(new TouchEvent('touchend', {touches:[], targetTouches:[], changedTouches:[t], bubbles:true, cancelable:true}));
          b.dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true}));   // the click a hold is followed by
          var stillOpen = !!document.querySelector('.dm-act');
          document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true, cancelable:true}));
          return { stillOpen: stillOpen, gone: !document.querySelector('.dm-act'),
                   unlocked: !document.documentElement.classList.contains('mc-sheet-open'), bodyTop: document.body.style.top || '' };
        })());"""))
        checks.append(('the click after the hold is swallowed — the surface stays', released['stillOpen']))
        checks.append(('Escape closes it and releases the lock, body unpinned', released['gone'] and released['unlocked'] and released['bodyTop'] == ''))
        checks.append(('phone console clean', f.assert_console_clean('dm phone')))
        fails += f.failures
    rc = 2 if fails or any(not p for _, p in checks) else 0
    for x in fails:
        print('FAIL', x)
    for n, p in checks:
        print(('PASS ' if p else 'FAIL '), n)
    return rc


if __name__ == '__main__':
    sys.exit(main())
