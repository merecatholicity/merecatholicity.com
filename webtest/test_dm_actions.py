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
(meta row, no author line, day chips, the hover ⌄, the quiet saved ★, the
reaction pills, the quote block that jumps and flashes), the sticky header and
composer, the ⓘ conversation sheet, a right-click opens
the popover surface — the quick six and the +, the menu with only the acts
that apply — the + swaps in the whole picker, Reply arms the "Replying to"
strip and ✕ disarms it, Escape leaves nothing behind, and the live hooks
repaint a pill and a saved mark. Phone (headless Chrome's default
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
          other: { hash: OTHER, nick: 'Fixture', avatar: null, assigned: 'Fixture', pubkey: 'A'.repeat(43), last_seen: now - 90000 },
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


def jsj(f, js):
    """json.loads over js1, or {} when the page threw (the throw is already in f.failures)."""
    r = f.js1(js)
    return json.loads(r) if isinstance(r, str) else {}


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
    replyBarHidden: !!q('.dm-reply-bar') && getComputedStyle(q('.dm-reply-bar')).display === 'none',
    head: !!q('.dm-head .dm-head-avatar') && !!q('.dm-head .dm-head-sub') && !!q('.dm-head .dm-head-info'),
    headSticky: q('.dm-head') && getComputedStyle(q('.dm-head')).position === 'sticky',
    subLock: (function(){ var s = (q('.dm-head-sub')||{}).textContent || ''; return s === '🔒 End-to-end encrypted' || s === 'Last seen yesterday at ' + new Date((Math.floor(Date.now()/1000) - 90000) * 1000).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); })(),   // the lock until the hub seeds presence; then the fixture's stamp, yesterday
    composer: !!q('.dm-composer .dm-c-ta') && !!q('.dm-composer .dm-c-send') && !!q('.dm-composer .dm-c-plus') && !!q('.dm-composer .dm-c-emoji'),
    composerFixed: q('.dm-composer') && getComputedStyle(q('.dm-composer')).position === 'fixed',
    spacerLast: !!q('.dm-c-space') && q('.dm-c-space').parentNode.lastElementChild === q('.dm-c-space') && q('.dm-c-space').previousElementSibling === q('.dm-composer')
      && parseFloat(getComputedStyle(q('.dm-c-space')).height) >= q('.dm-composer').offsetHeight,
    flushBottom: q('.dm-composer') && Math.abs(q('.dm-composer').getBoundingClientRect().bottom - window.innerHeight) < 2,
    alignedLeft: q('.dm-composer') && Math.abs(q('.dm-composer').getBoundingClientRect().left - q('section[data-board], section[data-comments]').getBoundingClientRect().left) < 2,
    nameShown: q('.dm-head-name') && getComputedStyle(q('.dm-head-name')).display !== 'none',
    lastAboveBar: (function(){ var bs = document.querySelectorAll('.dm-msg[data-dmid]'); var last = bs[bs.length-1]; var gap = q('.dm-composer').getBoundingClientRect().top - last.getBoundingClientRect().bottom; return gap >= -1 && gap <= 40; })(),
    footerBelowBar: !q('mc-footer') || q('mc-footer').getBoundingClientRect().top >= q('.dm-composer').getBoundingClientRect().top - 1,
    footerShown: !!q('mc-footer') && getComputedStyle(q('mc-footer')).display !== 'none',
    note: (q('.dm-note')||{}).textContent || '',
    oldChrome: !!(q('.board-topic-head') || q('.dm-e2e') || q('.board-audit-link') || q('.dm-expiry:not(.dm-info .dm-expiry)')),
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
        st = jsj(f, SHAPE)
        checks.append(('four fixture bubbles render, mine on my side', st.get('bubbles') == 4 and st.get('mine')))
        checks.append(('every bubble: a meta row with the time, no author line', st.get('meta') and st.get('noHead')))
        checks.append(('day chips: one per day, the last two Yesterday and Today', st.get('days') == 3 and (st.get('dayText') or [])[-2:] == ['Yesterday', 'Today']))
        checks.append(('the hover ⌄ is on every bubble (fine pointer)', st.get('more')))
        checks.append(('a saved message carries its quiet ★ in the meta row', st.get('saved102')))
        checks.append(('ticks: ✓✓ on my seen bubble, ✓ on my fresh one, none on theirs', st.get('ticks102') and st.get('ticks104') and st.get('noTicks103')))
        checks.append(('reaction pills: theirs alone, "👍 2" when we agree, none without', st.get('pill102') and st.get('pill103') and st.get('noPill104')))
        checks.append(('an edited message says so in its meta', st.get('edited103')))
        checks.append(('a reply carries the quote block naming them and their words', st.get('quote104')))
        checks.append(('the reply strip is mounted above the field and truly hidden until a reply is armed', st.get('replyBarHidden')))
        checks.append(('a sticky header: avatar, the subtitle (the lock, or Last seen yesterday once seeded), the ⓘ', st.get('head') and st.get('headSticky') and st.get('subLock')))
        checks.append(('a fixed composer at the foot: +, the field, emoji, Send; the spacer reserves its height', st.get('composer') and st.get('composerFixed') and st.get('spacerLast')))
        checks.append(('on open the bar is flush with the viewport bottom, aligned to the column, and the last bubble sits just above it', st.get('flushBottom') and st.get('alignedLeft') and st.get('lastAboveBar')))
        checks.append(('desktop keeps the footer, and it stays below the bar on open (the thread scrolls to its own foot)', st.get('footerShown') and st.get('footerBelowBar')))
        checks.append(('desktop shows the name in the header', st.get('nameShown')))
        pal = jsj(f, """return JSON.stringify((function(){
          var html = document.documentElement, mine = document.querySelector('.dm-msg.dm-mine'), theirs = document.querySelector('.dm-msg:not(.dm-mine)');
          var keep = { theme: html.dataset.theme, dark: html.dataset.dark, light: html.dataset.light };
          function rgb(s) { var m = /rgba?\\(([^)]+)\\)/.exec(s); return m ? m[1].split(',').slice(0, 3).map(Number) : [0, 0, 0]; }
          function dist(a, b) { var x = rgb(a), y = rgb(b); return Math.abs(x[0]-y[0]) + Math.abs(x[1]-y[1]) + Math.abs(x[2]-y[2]); }
          var out = {};
          [['dark','charcoal'],['dark','slate'],['dark','ink'],['light','paper'],['light','mist'],['light','sepia']].forEach(function(p){
            html.dataset.theme = p[0];
            if (p[0] === 'dark') { html.dataset.dark = p[1] === 'charcoal' ? '' : p[1]; delete html.dataset.light; if (p[1] === 'charcoal') delete html.dataset.dark; }
            else { html.dataset.light = p[1] === 'paper' ? '' : p[1]; delete html.dataset.dark; if (p[1] === 'paper') delete html.dataset.light; }
            var a = getComputedStyle(mine).backgroundColor, b = getComputedStyle(theirs).backgroundColor;
            var ink = getComputedStyle(mine).color;
            out[p[1]] = { mine: a, theirs: b, apart: dist(a, b), inkApart: dist(a, ink) };
          });
          html.dataset.theme = keep.theme; if (keep.dark) html.dataset.dark = keep.dark; else delete html.dataset.dark; if (keep.light) html.dataset.light = keep.light; else delete html.dataset.light;
          return out;
        })());""")
        apart = all((pal.get(k) or {}).get('apart', 0) >= 24 for k in ('charcoal', 'slate', 'ink', 'paper', 'mist', 'sepia'))
        legible = all((pal.get(k) or {}).get('inkApart', 0) >= 300 for k in ('charcoal', 'slate', 'ink', 'paper', 'mist', 'sepia'))
        checks.append(('sent and received read apart in all six palettes, and the ink stays legible on the tint', apart and legible))
        checks.append(('the ⏳ chip names the lifetime', str(st.get('note') or '').startswith('⏳ Messages disappear ') and 'after they are opened' in st.get('note')))
        checks.append(('the old thread chrome is gone (title line, badge, expiry note, block/delete links)', not st.get('oldChrome')))
        f.js1("document.querySelector('.dm-head-info').click(); return 1;")
        time.sleep(0.5)   # the sheet mounts its node on Lit's next update
        info = jsj(f, """return JSON.stringify((function(){
          var box = document.querySelector('mc-sheet .dm-info');
          var titles = box ? Array.prototype.map.call(box.querySelectorAll('.dm-info-row-title'), function(x){return x.textContent;}) : [];
          var acts = box ? Array.prototype.map.call(box.querySelectorAll('.dm-info-danger .identity-action'), function(x){return x.textContent;}) : [];
          var chooser = !!(box && box.querySelector('.dm-expiry'));
          window.mcSheet.close();
          return { box: !!box, titles: titles, acts: acts, chooser: chooser };
        })());""")
        time.sleep(0.4)
        # the sheet keeps its last node mounted (hidden) after closing; open state is the class and the lock
        info['closed'] = bool(f.js1("return !document.querySelector('mc-sheet .mc-sheet.on') && !document.documentElement.classList.contains('mc-sheet-open');"))
        checks.append(('ⓘ opens the conversation sheet: encryption, disappearing messages (with the chooser), block, delete',
                       info.get('box') and info.get('titles') == ['🔒 End-to-end encrypted', '⏳ Disappearing messages'] and info.get('chooser')
                       and info.get('acts') == ['Block this member', 'Delete conversation'] and info.get('closed')))
        jumped = f.js1("""var q = document.querySelector('[data-dmid="104"] .dm-quote'); q.click();
          return document.querySelector('[data-dmid="101"]').classList.contains('dm-flash');""")
        checks.append(('tapping the quote flashes the original', bool(jumped)))
        time.sleep(0.9)   # the jump scrolls smoothly; a surface opened mid-scroll would close on the scroll
        opened = jsj(f, """return JSON.stringify((function(){
          var b = document.querySelector('[data-dmid="104"]');
          var r = b.getBoundingClientRect();
          b.dispatchEvent(new MouseEvent('contextmenu', {bubbles:true, cancelable:true, clientX:r.left+20, clientY:r.top+10}));
          var act = document.querySelector('.dm-act');
          var labels = Array.prototype.map.call(document.querySelectorAll('.dm-act-menu .dm-act-item .dm-act-label'), function(x){return x.textContent;});
          return { desk: !!(act && act.classList.contains('dm-act-desk')), held: b.classList.contains('dm-held'),
                   cells: document.querySelectorAll('.dm-act-bar .dm-act-emoji').length, hasMore: !!document.querySelector('.dm-act-bar .dm-act-more'),
                   lit: document.querySelectorAll('.dm-act-bar .dm-act-emoji.on').length, labels: labels,
                   locked: document.documentElement.classList.contains('mc-sheet-open') };
        })());""")
        checks.append(('right-click opens the desktop popover over the held bubble, no lock', opened.get('desk') and opened.get('held') and not opened.get('locked')))
        checks.append(('the bar: the quick six and the +, none lit (no reaction of mine)', opened.get('cells') == 7 and opened.get('hasMore') and opened.get('lit') == 0))
        checks.append(('my bubble: Reply · Copy · Edit · Save · Delete', opened.get('labels') == ['Reply', 'Copy', 'Edit', 'Save', 'Delete']))
        replied = jsj(f, """return JSON.stringify((function(){
          var items = document.querySelectorAll('.dm-act-menu .dm-act-item');
          items[0].click();   // Reply
          var bar = document.querySelector('.dm-reply-bar');
          return { gone: !document.querySelector('.dm-act'), shown: bar && getComputedStyle(bar).display !== 'none',
                   who: (bar.querySelector('.dm-quote-who')||{}).textContent, text: (bar.querySelector('.dm-quote-text')||{}).textContent };
        })());""")
        checks.append(('Reply closes the surface and arms "Replying to yourself" with my words',
                       replied.get('gone') and replied.get('shown') and replied.get('who') == 'Replying to yourself' and replied.get('text') == 'And I answered'))
        disarmed = f.js1("""document.querySelector('.dm-reply-x').click(); return getComputedStyle(document.querySelector('.dm-reply-bar')).display === 'none';""")
        checks.append(('✕ disarms the reply', bool(disarmed)))
        theirs = jsj(f, """return JSON.stringify((function(){
          var b = document.querySelector('[data-dmid="103"]');
          b.dispatchEvent(new MouseEvent('contextmenu', {bubbles:true, cancelable:true, clientX:20, clientY:20}));
          var labels = Array.prototype.map.call(document.querySelectorAll('.dm-act-menu .dm-act-item .dm-act-label'), function(x){return x.textContent;});
          var lit = document.querySelector('.dm-act-bar .dm-act-emoji.on');
          return { labels: labels, lit: lit ? lit.textContent : '', litTitle: lit ? lit.title : '' };
        })());""")
        checks.append(('their bubble: Reply · Copy · Save — no Edit, no Delete', theirs.get('labels') == ['Reply', 'Copy', 'Save']))
        checks.append(('my current reaction is lit, and tapping it would withdraw', theirs.get('lit') == '\U0001F44D' and theirs.get('litTitle') == 'Remove your reaction'))
        picker = jsj(f, """return JSON.stringify((function(){
          document.querySelector('.dm-act-bar .dm-act-more').click();
          return { panel: !!document.querySelector('.dm-act .dm-act-picker.emoji-panel'),
                   cells: document.querySelectorAll('.dm-act .dm-act-picker .emoji-cell').length,
                   barHidden: getComputedStyle(document.querySelector('.dm-act-bar')).display === 'none',
                   menuHidden: getComputedStyle(document.querySelector('.dm-act-menu')).display === 'none' };
        })());""")
        checks.append(('+ swaps in the whole picker in place of bar and menu (both truly hidden)', picker.get('panel') and (picker.get('cells') or 0) > 50 and picker.get('barHidden') and picker.get('menuHidden')))
        picked = jsj(f, """return JSON.stringify((function(){
          var tab = Array.prototype.find.call(document.querySelectorAll('.dm-act-picker .emoji-tab'), function(t){ return t.textContent === 'Pepe'; });
          tab.click();
          var cell = document.querySelector('.dm-act-picker .emoji-cell img.mc-emoji');
          var code = cell ? cell.alt : '';
          cell.parentNode.click();
          var pill = document.querySelector('[data-dmid="103"] > .dm-react-pill');
          return { code: code, gone: !document.querySelector('.dm-act'),
                   img: pill && pill.querySelectorAll('img.mc-emoji').length, glyph: pill ? pill.textContent : '',
                   wrote: (window.__mcDmWrites||[]).some(function(u){ return u.indexOf('/dm/react') !== -1; }) };
        })());""")
        checks.append(('a pack emoji reacts as its image: the pill shows 👍 (theirs) and the pepe (mine), one stubbed write',
                       picked.get('gone') and str(picked.get('code') or '').startswith(':') and picked.get('img') == 1 and picked.get('glyph') == '\U0001F44D' and picked.get('wrote')))
        live = jsj(f, """return JSON.stringify((function(){
          var b104 = document.querySelector('[data-dmid="104"]');
          b104.mcReactPaint('😂'); b104.mcSavedPaint(1);
          var p = b104.querySelector(':scope > .dm-react-pill');
          return { pill: p ? p.textContent : '', saved: b104.classList.contains('dm-saved') && !!b104.querySelector('.dm-savedmark') };
        })());""")
        checks.append(('the live hooks repaint: their 😂 lands as a pill, their save marks my bubble', live.get('pill') == '\U0001F602' and live.get('saved')))
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
        f._wd('POST', '/session/%s/window/rect' % f.sid, {'width': 390, 'height': 844})   # a phone: the app bar and tab bar are real
        install_stub(f)
        open_fixture(f)
        bars = jsj(f, """return JSON.stringify((function(){
          var q = function(s){ return document.querySelector(s); };
          var c = q('.dm-composer'), tb = q('.mc-tabbar'), h = q('.dm-head'), ab = q('.mc-appbar');
          if (!c || !tb || !h || !ab) return { missing: true };
          var bs = document.querySelectorAll('.dm-msg[data-dmid]'); var last = bs[bs.length-1];
          return { flushTab: Math.abs(c.getBoundingClientRect().bottom - tb.getBoundingClientRect().top) < 2,
                   fullWidth: c.getBoundingClientRect().width >= document.documentElement.clientWidth - 1,   // clientWidth: headless Chrome's classic scrollbar is outside the layout viewport
                   headUnderBar: Math.abs(h.getBoundingClientRect().top - ab.getBoundingClientRect().bottom) < 2,
                   nameHidden: getComputedStyle(q('.dm-head-name')).display === 'none',
                   lastAboveBar: (function(){ var gap = c.getBoundingClientRect().top - last.getBoundingClientRect().bottom; return gap >= -1 && gap <= 40; })(),
                   footerHidden: !q('mc-footer') || getComputedStyle(q('mc-footer')).display === 'none',
                   tab: document.body.dataset.mcTab || '' };
        })());""")
        checks.append(('phone, on open: the bar sits flush on the tab bar, full width, before any scroll', bars.get('flushTab') and bars.get('fullWidth')))
        checks.append(('phone: the header sits flush under the app bar and the app bar carries the name', bars.get('headUnderBar') and bars.get('nameHidden')))
        checks.append(('phone: the thread opens at its foot, the last bubble just above the bar', bars.get('lastAboveBar')))
        checks.append(('phone: no footer under the thread (the tab is stamped, the footer hidden)', bars.get('tab') == 'messages' and bars.get('footerHidden')))
        pk = jsj(f, """return JSON.stringify((function(){
          var q = function(s){ return document.querySelector(s); };
          var ta = q('.dm-c-ta'), btn = q('.dm-c-emoji'), panel = q('.dm-c-emoji-panel');
          ta.focus();
          var focusedBefore = document.activeElement === ta;
          btn.click();
          var opened = getComputedStyle(panel).display !== 'none';
          var blurred = document.activeElement !== ta;
          var searchIdle = document.activeElement !== panel.querySelector('.emoji-search');
          var face = btn.getAttribute('aria-label');
          var cell = panel.querySelector('.emoji-cell');
          var glyph = cell ? cell.textContent : '';
          if (cell) cell.click();
          return { focusedBefore: focusedBefore, opened: opened, blurred: blurred, searchIdle: searchIdle, face: face,
                   closedAfterPick: getComputedStyle(panel).display === 'none', inserted: !!glyph && ta.value.indexOf(glyph) !== -1,
                   refocused: document.activeElement === ta, faceBack: btn.getAttribute('aria-label') };
        })());""")
        checks.append(('phone: opening the picker dismisses the keyboard (field blurred, search idle) and the button becomes Keyboard',
                       pk.get('focusedBefore') and pk.get('opened') and pk.get('blurred') and pk.get('searchIdle') and pk.get('face') == 'Keyboard'))
        checks.append(('phone: a pick inserts the emoji, closes the picker, and hands the keyboard back',
                       pk.get('closedAfterPick') and pk.get('inserted') and pk.get('refocused') and pk.get('faceBack') == 'Emoji'))
        sw = jsj(f, """return JSON.stringify((function(){
          var ta = document.querySelector('.dm-c-ta'); ta.focus();
          var b = document.querySelector('[data-dmid="101"]');
          var r = b.getBoundingClientRect();
          function touch(type, y) { var t = new Touch({identifier: 9, target: b, clientX: r.left + 30, clientY: y});
            b.dispatchEvent(new TouchEvent(type, {touches: type === 'touchend' ? [] : [t], targetTouches: type === 'touchend' ? [] : [t], changedTouches: [t], bubbles: true, cancelable: true})); }
          var focusedBefore = document.activeElement === ta;
          touch('touchstart', r.top + 10); touch('touchmove', r.top + 30);
          var stillAfterSmall = document.activeElement === ta;
          touch('touchmove', r.top + 70); touch('touchend', r.top + 70);
          var blurred = document.activeElement !== ta;
          var c = document.querySelector('.dm-composer'); ta.focus();
          var ct = c.getBoundingClientRect();
          var t2 = new Touch({identifier: 10, target: ta, clientX: ct.left + 40, clientY: ct.top + 10});
          ta.dispatchEvent(new TouchEvent('touchstart', {touches:[t2], targetTouches:[t2], changedTouches:[t2], bubbles:true}));
          var t3 = new Touch({identifier: 10, target: ta, clientX: ct.left + 40, clientY: ct.top + 90});
          ta.dispatchEvent(new TouchEvent('touchmove', {touches:[t3], targetTouches:[t3], changedTouches:[t3], bubbles:true}));
          var keptInComposer = document.activeElement === ta;
          ta.blur();
          return { focusedBefore: focusedBefore, stillAfterSmall: stillAfterSmall, blurred: blurred, keptInComposer: keptInComposer };
        })());""")
        checks.append(('phone: a downward swipe over the thread while typing dismisses the keyboard; a small move or a swipe inside the composer does not',
                       sw.get('focusedBefore') and sw.get('stillAfterSmall') and sw.get('blurred') and sw.get('keptInComposer')))
        ph = jsj(f, """return JSON.stringify((function(){
          var b = document.querySelector('[data-dmid="103"]');
          var r = b.getBoundingClientRect();
          var t = new Touch({identifier: 7, target: b, clientX: r.left + 20, clientY: r.top + 10});
          b.dispatchEvent(new TouchEvent('touchstart', {touches:[t], targetTouches:[t], changedTouches:[t], bubbles:true, cancelable:true}));
          return { moreHidden: getComputedStyle(b.querySelector('.dm-more')).display === 'none', before: !!document.querySelector('.dm-act'),
                   ctxMenu: (function(){ b.dispatchEvent(new MouseEvent('contextmenu', {bubbles:true, cancelable:true})); return !!document.querySelector('.dm-act'); })() };
        })());""")
        checks.append(('the hover ⌄ is hidden under (hover: none)', bool(ph.get('moreHidden'))))
        checks.append(('nothing opens before the hold matures, and contextmenu is not a road on touch', not ph.get('before') and not ph.get('ctxMenu')))
        time.sleep(0.7)
        held = jsj(f, """return JSON.stringify((function(){
          var act = document.querySelector('.dm-act');
          return { phone: !!(act && act.classList.contains('dm-act-phone')), scrims: document.querySelectorAll('.dm-act-scrim').length,
                   locked: document.documentElement.classList.contains('mc-sheet-open'),
                   bar: !!document.querySelector('.dm-act-bar'), menu: !!document.querySelector('.dm-act-menu'), held: !!document.querySelector('.dm-held') };
        })());""")
        checks.append(('a press-and-hold opens the phone surface: bar, hole, menu', held.get('phone') and held.get('bar') and held.get('menu') and held.get('held')))
        checks.append(('four pieces of scrim around the bubble', held.get('scrims') == 4))
        checks.append(('the document is locked while the surface stands', held.get('locked')))
        released = jsj(f, """return JSON.stringify((function(){
          var b = document.querySelector('[data-dmid="103"]');
          var t = new Touch({identifier: 7, target: b, clientX: 0, clientY: 0});
          b.dispatchEvent(new TouchEvent('touchend', {touches:[], targetTouches:[], changedTouches:[t], bubbles:true, cancelable:true}));
          b.dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true}));   // the click a hold is followed by
          var stillOpen = !!document.querySelector('.dm-act');
          document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true, cancelable:true}));
          return { stillOpen: stillOpen, gone: !document.querySelector('.dm-act'),
                   unlocked: !document.documentElement.classList.contains('mc-sheet-open'), bodyTop: document.body.style.top || '' };
        })());""")
        checks.append(('the click after the hold is swallowed — the surface stays', released.get('stillOpen')))
        checks.append(('Escape closes it and releases the lock, body unpinned', released.get('gone') and released.get('unlocked') and released.get('bodyTop') == ''))
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
