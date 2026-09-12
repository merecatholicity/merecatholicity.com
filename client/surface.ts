/* The press-and-hold surface (2026-09-12), shared by everything a member may
   react to: a direct message, a board post (a topic head, a reply, an
   article-page comment), a feed post, a feed comment. Born as the DM's own
   (client/dm.ts dmOpenActions / dmArmGestures, 2026-09-10) and lifted here
   verbatim where it could be when the board and the feed gained the same
   picker — the DM keeps only what is DM (its bubble, its reply swipe, its
   acts). Three things live here: the OVERLAY (the reaction bar above, the
   node lit in a hole between four pieces of scrim, the acts below; a popover
   at the pointer on desktop), the GESTURES that open it (a hold on touch, a
   right-click where a caller asks, a ⌄ on hover), and the public reactions'
   LEDGER — every tally on the page, the viewer's own reaction on each, the
   pills painted from it, the wire to /react — which the DM never touches (its
   reactions live on the message row, inside the pair's own thread). */
import type { Boot } from './boot';

export function installSurface(B: Boot) {
  /* Names this module takes from the boot — the root's helpers and the other
     modules' exports — bound in bind() once every module is installed, so
     order of installation never matters. */
  let API: any;
  let CUSTOM_EMOJI: any;
  let blockedOut: (d: any) => any;
  let bootSig: any;
  let buildEmojiPanel: (textarea: any, onPick?: (it: any) => void) => any;
  let el: (tag: string, cls?: string | null, text?: string | number | null) => any;
  let emojiImg: (path: any, code: any) => any;
  let profileHref: (hash: any) => any;
  let skeleton: (kind?: string) => any;
  let state: any;
  let wallAvatarInto: (host: any, hash: any, avatar: any) => any;

  /* ---- The overlay. One at a time; the boot's abort tears it down. ---- */
  var actOpen: any = null;
  function closeActs() {
    var a = actOpen;
    if (!a) return;
    actOpen = null;
    a.close();
  }
  /* A node that dies (a redacted bubble, a deleted post) takes its surface with it. */
  function closeActsFor(node: any) { if (actOpen && actOpen.node === node) closeActs(); }
  function isPhone() {
    try { return window.innerWidth <= 600 || window.matchMedia('(hover: none)').matches; } catch (e) { return window.innerWidth <= 600; }
  }
  /* A hold on a phone picks a message, never a word. iOS starts its own text
     selection under a long press and, when the node itself is not selectable,
     anchors it in the NEAREST selectable text — a header line, a day chip, a
     spacer — then extends it while the finger stays down (the blue bands and
     handles of 2026-09-11). So the chat screen and every post are not
     selectable text under (hover:none) (the DM's injected block; main.css for
     .comment), and the surface drops whatever selection the hold started. */
  function clearSelection() {
    try { var s = window.getSelection(); if (s && s.rangeCount) s.removeAllRanges(); } catch (e) { /* no selection API */ }
  }
  /* The quick six are the kernel's (Domain.Reaction.quickReactions). */
  function quickReactions(): string[] {
    return window.mcCore && window.mcCore.quickReactions
      ? window.mcCore.quickReactions.slice() : ['👍', '❤️', '😂', '😮', '😢', '🙏'];
  }
  /* One reaction as a node: a custom token (:code:) as its pack image when the
     pack knows it, else the glyph itself. Text nodes only, never innerHTML. */
  function reactionNode(emoji: any) {
    var str = String(emoji || '');
    var tok = /^:([a-z0-9][a-z0-9_+-]{0,39}):$/i.exec(str);
    if (tok && CUSTOM_EMOJI[tok[1].toLowerCase()]) return emojiImg(CUSTOM_EMOJI[tok[1].toLowerCase()], tok[1].toLowerCase());
    return document.createTextNode(str);
  }
  /* A short haptic where the device has one. Chrome refuses (and logs an
     intervention for) a vibrate before the frame's first real tap, so ask
     userActivation first where it exists. */
  function buzz(ms: number) {
    try {
      var ua: any = (navigator as any).userActivation;
      if (ua && !ua.hasBeenActive) return;
      if (navigator.vibrate) navigator.vibrate(ms);
    } catch (e) { /* fine */ }
  }
  /* Open the surface over `node`. spec:
       at      — the pointer, for the desktop popover (null = by the node)
       mine    — place the bar and the menu at the node's right edge (a sent bubble)
       react   — { current, onPick(emoji) } to draw the reaction bar, or null
       items   — the acts: {label, icon, cls, fn} specs, or the caller's OWN
                 elements (a post's ⋯ links), which travel into the menu and
                 BACK to where they were on close, so the elements and their
                 listeners stay singular
       onClose — a word when it goes
     On a phone the page is first scrolled just enough for bar + node + menu
     to fit, then the document is locked (the sheet's own lock, mcSheet.lock)
     for exactly as long as the surface stands, and the scrim is inert to
     touch — the three layers every overlay here keeps. On desktop it is a
     popover at the pointer that an outside click, a scroll, or Escape
     dismisses. */
  function openActs(spec: any) {
    closeActs();
    var node = spec.node;
    if (!node || node.mcDead || !node.isConnected) return;
    ensureActStyles();
    var phone = isPhone();
    if (phone) clearSelection();
    var mine = !!spec.mine;
    var root = el('div', 'dm-act ' + (phone ? 'dm-act-phone' : 'dm-act-desk') + (mine ? ' dm-act-mine' : ''));
    root.setAttribute('data-mc-app', '');
    /* The click that follows the opening hold is swallowed on the node — but
       the node may have been scrolled to fit under the bar, and the click
       then lands on a scrim instead (found by the CDP touch of the headless
       proof, 2026-09-12; a release between the hold's 430 ms and the OS's
       own long-press cut-off does the same on a phone). A scrim tap in the
       first moments after opening is that click, never a dismissal. */
    var openedAt = Date.now();
    var scrims: any[] = [];
    function scrim() {
      var sc = el('div', 'dm-act-scrim');
      sc.addEventListener('click', function (e: any) { e.preventDefault(); if (Date.now() - openedAt < 400) return; closeActs(); });
      root.appendChild(sc); scrims.push(sc);
      return sc;
    }
    /* The reaction bar: the quick six (plus my current reaction when it is not
       one of them), mine lit; tapping mine again withdraws it. */
    var react = spec.react || null;
    var bar: any = null, more: any = null;
    if (react) {
      bar = el('div', 'dm-act-bar');
      bar.setAttribute('role', 'toolbar'); bar.setAttribute('aria-label', 'React');
      var current = String(react.current || '');
      var cells = quickReactions();
      if (current && cells.indexOf(current) === -1) cells.push(current);
      cells.forEach(function (e) {
        var b = el('button', 'dm-act-emoji' + (e === current ? ' on' : ''));
        b.type = 'button';
        b.appendChild(reactionNode(e));
        b.title = e === current ? 'Remove your reaction' : 'React ' + e;
        b.setAttribute('aria-label', b.title);
        b.addEventListener('click', function () { closeActs(); react.onPick(e); });
        bar.appendChild(b);
      });
      more = el('button', 'dm-act-emoji dm-act-more', '+');
      more.type = 'button'; more.title = 'More reactions'; more.setAttribute('aria-label', 'More reactions');
      bar.appendChild(more);
    }
    /* The menu: only the acts that apply. */
    var menu = el('div', 'dm-act-menu');
    menu.setAttribute('role', 'menu');
    var travelled: any[] = [];
    (spec.items || []).forEach(function (it: any) {
      if (!it) return;
      if (it.nodeType === 1) {
        travelled.push({ node: it, parent: it.parentNode });
        it.classList.add('dm-act-item');
        it.setAttribute('role', 'menuitem');
        menu.appendChild(it);
        return;
      }
      var b = el('button', 'dm-act-item' + (it.cls ? ' ' + it.cls : ''));
      b.type = 'button'; b.setAttribute('role', 'menuitem');
      b.appendChild(el('span', 'dm-act-ico', it.icon || ''));
      b.appendChild(el('span', 'dm-act-label', it.label));
      b.addEventListener('click', function () { closeActs(); it.fn(); });
      menu.appendChild(b);
    });
    /* A travelled act closes the surface AFTER its own handler has run (a
       confirm sheet it opens, an edit box it swaps in). */
    if (travelled.length) {
      menu.addEventListener('click', function (ev: any) {
        var t = ev.target && ev.target.closest ? ev.target.closest('a,button') : null;
        if (t && menu.contains(t) && !t.classList.contains('dm-act-emoji')) setTimeout(closeActs, 0);
      });
    }
    var hasMenu = !!menu.childNodes.length;
    if (!bar && !hasMenu) return;
    var pop: any = null;
    if (phone) { scrim(); scrim(); scrim(); scrim(); if (bar) root.appendChild(bar); if (hasMenu) root.appendChild(menu); }
    else { scrim(); pop = el('div', 'dm-act-pop'); if (bar) pop.appendChild(bar); if (hasMenu) pop.appendChild(menu); root.appendChild(pop); }
    document.body.appendChild(root);
    var lockedByUs = false;
    var pad = 10, gap = 10;
    var vv: any = (window as any).visualViewport;
    function vTop() { return vv ? vv.offsetTop : 0; }
    function vH() { return vv ? vv.height : window.innerHeight; }
    var vW = window.innerWidth;
    var at = spec.at || null;
    function clampPop() {
      if (!pop) return;
      var w = pop.offsetWidth, h = pop.offsetHeight;
      var x = at ? at.x : node.getBoundingClientRect().right - w;
      var y = at ? at.y : node.getBoundingClientRect().top;
      pop.style.left = Math.max(pad, Math.min(vW - w - pad, x)) + 'px';
      pop.style.top = Math.max(vTop() + pad, Math.min(vTop() + vH() - h - pad, y)) + 'px';
    }
    if (phone) {
      var barH = bar ? bar.offsetHeight : 0, menuH = hasMenu ? menu.offsetHeight : 0;
      var r = node.getBoundingClientRect();
      var fits = barH + gap + r.height + gap + menuH <= vH() - 2 * pad;
      /* Scroll the page just enough — up, so the bar has room above, or down,
         so the menu has room below; a node taller than the room gets its top
         under the bar and its foot under the menu. Instant: this is placing,
         not travelling. */
      var delta = 0;
      if (fits) {
        var topWant = r.top - gap - barH, botWant = r.bottom + gap + menuH;
        if (topWant < vTop() + pad) delta = topWant - (vTop() + pad);
        else if (botWant > vTop() + vH() - pad) delta = botWant - (vTop() + vH() - pad);
      } else delta = r.top - (vTop() + pad + barH + gap);
      if (delta) {
        try { window.scrollBy({ top: delta, left: 0, behavior: 'instant' as any }); } catch (e) { window.scrollBy(0, delta); }
        r = node.getBoundingClientRect();
      }
      if (window.mcSheet && window.mcSheet.lock) lockedByUs = !!window.mcSheet.lock();
      /* The four pieces: above, below, left of, and right of the node. */
      var top = Math.max(0, r.top), bottom = Math.max(top, r.bottom);
      scrims[0].style.cssText = 'left:0;right:0;top:0;height:' + top + 'px';
      scrims[1].style.cssText = 'left:0;right:0;top:' + bottom + 'px;bottom:0';
      scrims[2].style.cssText = 'left:0;top:' + top + 'px;height:' + (bottom - top) + 'px;width:' + Math.max(0, r.left) + 'px';
      scrims[3].style.cssText = 'right:0;top:' + top + 'px;height:' + (bottom - top) + 'px;left:' + Math.min(vW, r.right) + 'px';
      var barTop = fits ? r.top - gap - barH : vTop() + pad;
      var menuTop = fits ? r.bottom + gap : vTop() + vH() - pad - menuH;
      if (bar) bar.style.top = Math.max(vTop() + pad, barTop) + 'px';
      if (hasMenu) menu.style.top = Math.min(vTop() + vH() - pad - menuH, Math.max(vTop() + pad, menuTop)) + 'px';
      var barW = bar ? bar.offsetWidth : 0, menuW = hasMenu ? menu.offsetWidth : 0;
      if (mine) {
        if (bar) bar.style.right = Math.max(pad, Math.min(vW - pad - barW, vW - r.right)) + 'px';
        if (hasMenu) menu.style.right = Math.max(pad, Math.min(vW - pad - menuW, vW - r.right)) + 'px';
      } else {
        if (bar) bar.style.left = Math.max(pad, Math.min(vW - pad - barW, r.left)) + 'px';
        if (hasMenu) menu.style.left = Math.max(pad, Math.min(vW - pad - menuW, r.left)) + 'px';
      }
    } else clampPop();
    /* The whole picker, in place of the bar and the menu, for a reaction
       beyond the quick six — our own packs included. */
    if (more) {
      more.addEventListener('click', function () {
        var panel = buildEmojiPanel(null, function (it: any) {
          closeActs();
          react.onPick(it.kind === 'img' ? ':' + it.code + ':' : it.char);
        });
        panel.classList.add('dm-act-picker');
        bar.hidden = true; menu.hidden = true;
        (pop || root).appendChild(panel);
        panel.openPanel();
        clampPop();
      });
    }
    function onKey(e: any) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeActs(); } }
    function onScroll(e: any) { if (root.contains(e.target)) return; closeActs(); }
    function onTap(e: any) { e.preventDefault(); e.stopPropagation(); closeActs(); }
    document.addEventListener('keydown', onKey, true);
    if (!phone) { window.addEventListener('scroll', onScroll, true); window.addEventListener('resize', closeActs); }
    else window.addEventListener('orientationchange', closeActs);
    node.addEventListener('click', onTap, true);
    node.classList.add('dm-held');
    var restore: any = document.activeElement;
    actOpen = { node: node, close: function () {
      if (root.parentNode) root.parentNode.removeChild(root);
      if (lockedByUs && window.mcSheet && window.mcSheet.unlock) window.mcSheet.unlock();
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', closeActs);
      window.removeEventListener('orientationchange', closeActs);
      node.removeEventListener('click', onTap, true);
      node.classList.remove('dm-held');
      /* the caller's own acts go home, in order, as they were */
      travelled.forEach(function (t) {
        t.node.classList.remove('dm-act-item'); t.node.removeAttribute('role');
        if (t.parent) t.parent.appendChild(t.node);
      });
      if (spec.onClose) { try { spec.onClose(); } catch (e) { /* the caller's */ } }
      if (!phone && restore && restore.focus && document.contains(restore)) { try { restore.focus(); } catch (e) { /* gone */ } }
    } };
    if (!phone) { var first = (hasMenu ? menu : bar).querySelector('button,a'); if (first) first.focus(); }
  }
  /* Arm a node with the gestures: a press-and-hold (touch) opens the surface
     — 430 ms, cancelled by 8 px of movement (a press that moves is a scroll),
     the click that follows a hold swallowed so a link under the finger does
     not also navigate, a buzz where the device has one. opts:
       skip        — a selector: a touch that starts on one of these is not a
                     hold (a control, a field, a pill — they own their taps)
       swipe       — a swipe to the right fires this (the DM's reply)
       contextmenu — a right-click opens the surface at the pointer (the DM;
                     a post keeps the browser's own menu over its prose)
       more        — hang a ⌄ on hover for the pointer's road (the DM; a post
                     has its ⋯)
     A node inside an armed node (a feed comment in a feed post) takes the
     hold itself: the nearest armed ancestor of the touch is the one that
     opens, the outer stays still. */
  function armHold(node: any, open: (at: any) => void, opts?: any) {
    var o = opts || {};
    var skip = o.skip || 'video,audio,textarea,input,select,button,a.wall-media,.dm-edit-box,.dm-react-pill,.mc-react-pill,.comment-form';
    var lpT: any = 0, sx = 0, sy = 0, held = false, swiping = false, dx = 0;
    node.setAttribute('data-mc-hold', '');
    function cancelHold() { if (lpT) { clearTimeout(lpT); lpT = 0; } }
    node.addEventListener('touchstart', function (e: any) {
      if (node.mcDead || e.touches.length !== 1) { cancelHold(); return; }
      var t = e.target;
      if (t && t.closest && t.closest('[data-mc-hold]') !== node) return;
      if (skip && t && t.closest && t.closest(skip)) return;
      sx = e.touches[0].clientX; sy = e.touches[0].clientY; held = false; swiping = false; dx = 0;
      cancelHold();
      lpT = setTimeout(function () {
        lpT = 0; held = true;
        buzz(12);
        open(null);
      }, 430);
    }, { passive: true });
    node.addEventListener('touchmove', function (e: any) {
      if (held || node.mcDead) return;
      var t = e.touches[0];
      var mx = t.clientX - sx, my = t.clientY - sy;
      if (!swiping) {
        if (Math.abs(mx) > 8 || Math.abs(my) > 8) cancelHold();
        if (o.swipe && mx > 24 && Math.abs(my) < mx * 0.6) { swiping = true; node.classList.add('dm-swiping'); }
        else return;
      }
      dx = Math.max(0, Math.min(72, mx - 24));
      node.style.transform = 'translateX(' + dx + 'px)';
      node.classList.toggle('dm-swipe-armed', dx >= 48);
    }, { passive: true });
    function endTouch() {
      cancelHold();
      /* A hold that no click follows (Android suppresses it) must not swallow
         some later, unrelated click. */
      if (held) setTimeout(function () { held = false; }, 500);
      if (!swiping) return;
      var fire = dx >= 48;
      swiping = false;
      node.classList.remove('dm-swiping'); node.classList.remove('dm-swipe-armed');
      node.style.transform = '';
      if (fire) { buzz(8); o.swipe(); }
    }
    node.addEventListener('touchend', endTouch, { passive: true });
    node.addEventListener('touchcancel', endTouch, { passive: true });
    node.addEventListener('click', function (e: any) {
      /* stopImmediatePropagation: the surface's own tap-to-close listener sits
         on this same node, registered later, and must not see this click. */
      if (held) { held = false; e.preventDefault(); e.stopImmediatePropagation(); }
    }, true);
    if (o.contextmenu) {
      node.addEventListener('contextmenu', function (e: any) {
        e.preventDefault();
        if (node.mcDead) return;
        try { if (window.matchMedia('(hover: none)').matches) return; } catch (x) { /* desktop */ }
        open({ x: e.clientX, y: e.clientY });
      });
    }
    if (o.more) {
      var more = el('button', 'dm-more', '⌄');
      more.type = 'button'; more.title = 'Message actions'; more.setAttribute('aria-label', 'Message actions');
      more.addEventListener('click', function (e: any) {
        e.stopPropagation();
        var r = more.getBoundingClientRect();
        open({ x: r.left, y: r.bottom + 2 });
      });
      node.appendChild(more);
    }
  }

  /* ---- The public reactions' ledger: one entry per target on the page —
     its tally ([{e, n}], most given first), the viewer's own reaction, and
     every mount that paints it (a post's pill, a feed card's summary, the
     theater rail's copy of it). Per boot, like everything here. ---- */
  var ledger: Record<string, { cells: Array<{ e: string; n: number }>; mine: string; mounts: any[] }> = {};
  function reactKey(target: any, id: any) { return String(target) + ':' + String(id); }
  function entry(target: any, id: any) {
    var k = reactKey(target, id);
    return ledger[k] || (ledger[k] = { cells: [], mine: '', mounts: [] });
  }
  function reactMine(target: any, id: any) { return entry(target, id).mine; }
  /* Register a mount for a target: `seed` is the served row ({reacts,
     react_me} — react_me absent on a cached public read, filled by
     reactLoadMine after), `paint` a custom painter (cells, mine, host) or
     nothing for the default pill at the host's end. */
  function reactRegister(target: any, id: any, host: any, seed: any, paint?: any) {
    ensureActStyles();
    var ent = entry(target, id);
    if (seed && Array.isArray(seed.reacts)) ent.cells = seed.reacts.map(function (c: any) { return { e: String(c.e || ''), n: Number(c.n) || 0 }; }).filter(function (c: any) { return c.e && c.n > 0; });
    if (seed && seed.react_me != null) ent.mine = String(seed.react_me || '');
    ent.mounts.push({ host: host, paint: paint || defaultPaint });
    /* The renderer registers mid-build (the article has no body yet): a
       detached host is painted a frame later, once it stands whole on the
       page, so the default pill lands at the post's END, not before its head. */
    if (host && host.isConnected) repaint(target, id);
    else requestAnimationFrame(function () { repaint(target, id); });
  }
  /* A mount registers BEFORE its post is appended to the page (the renderer
     builds the node first), so a detached host is painted, not dropped; a
     host that WAS on the page and is gone (a re-rendered list) is let go. */
  function repaint(target: any, id: any) {
    var ent = entry(target, id);
    ent.mounts = ent.mounts.filter(function (m: any) {
      if (!m.host) return false;
      if (m.host.isConnected) m.seen = true;
      return !(m.seen && !m.host.isConnected);
    });
    ent.mounts.forEach(function (m: any) { try { m.paint(ent.cells, ent.mine, m.host, target, id); } catch (e) { /* one mount */ } });
  }
  /* The pill: one chip per emoji with its count, mine lit. A tap on a chip
     gives that reaction (mine again withdraws it); a hover or a long press
     says who. */
  function reactPillInto(host: any, target: any, id: any, cells: any[], mine: string) {
    host.textContent = '';
    host.classList.add('mc-react-pill');
    host.hidden = !cells.length;
    cells.forEach(function (c: any) {
      var chip = el('button', 'mc-react-chip' + (c.e === mine ? ' on' : ''));
      chip.type = 'button';
      chip.appendChild(reactionNode(c.e));
      chip.appendChild(el('span', 'mc-react-n', String(c.n)));
      chip.title = (c.e === mine ? 'You reacted ' + c.e + ' — tap to remove' : 'React ' + c.e);
      chip.setAttribute('aria-label', c.n + (c.n === 1 ? ' reaction ' : ' reactions ') + c.e + (c.e === mine ? ', yours' : ''));
      chip.addEventListener('click', function (e: any) { e.preventDefault(); e.stopPropagation(); reactSend(target, id, c.e); });
      attachWho(chip, target, id);
      host.appendChild(chip);
    });
  }
  function defaultPaint(cells: any[], mine: string, host: any, target: any, id: any) {
    var pill = host.querySelector(':scope > .mc-react-pill');
    if (!cells.length) { if (pill) pill.remove(); return; }
    if (!pill) pill = el('div', 'mc-react-pill');
    host.appendChild(pill);   // (re)appended: the pill is always the post's last word
    reactPillInto(pill, target, id, cells, mine);
  }
  /* Give (or withdraw: mine again, or '') a reaction: optimistic on the
     ledger, settled from the answer's tally, reverted on refusal. The value
     is the kernel's to accept or refuse (mcCore.reaction), the same rule the
     worker's store runs. A keyless reader is shown the door in. */
  function reactSend(target: any, id: any, emoji: any) {
    if (!state.myHash) { if (window.mcOnboard) window.mcOnboard(); return; }
    var ent = entry(target, id);
    var was = ent.mine;
    var want = String(emoji || '');
    if (want === was) want = '';
    if (want && window.mcCore && window.mcCore.reaction && window.mcCore.reaction(want) === null) return;
    var before = ent.cells.map(function (c) { return { e: c.e, n: c.n }; });
    ent.mine = want;
    bump(ent.cells, was, -1); bump(ent.cells, want, 1);
    repaint(target, id);
    fetch(API + '/react', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: state.key, target: target, id: id, emoji: want }) })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (blockedOut(d)) return;
        if (d && d.ok) { ent.cells = (d.reacts || []).map(function (c: any) { return { e: String(c.e), n: Number(c.n) || 0 }; }); ent.mine = String(d.emoji || ''); }
        else { ent.cells = before; ent.mine = was; }
        repaint(target, id);
      })
      .catch(function () { ent.cells = before; ent.mine = was; repaint(target, id); });
  }
  function bump(cells: any[], e: string, d: number) {
    if (!e) return;
    for (var i = 0; i < cells.length; i++) {
      if (cells[i].e === e) { cells[i].n += d; if (cells[i].n <= 0) cells.splice(i, 1); return; }
    }
    if (d > 0) cells.push({ e: e, n: d });
  }
  /* The viewer's own reactions over the targets just rendered — the board's
     public payloads are cached, so "mine" rides this keyed read after them.
     Sixty ids a call; nothing for a keyless reader. */
  function reactLoadMine(target: any, ids: any[]) {
    if (!state.key || !ids || !ids.length) return;
    for (var i = 0; i < ids.length; i += 60) {
      (function (chunk) {
        fetch(API + '/reacts', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: state.key, target: target, ids: chunk }) })
          .then(function (r) { return r.json(); })
          .then(function (d) {
            if (!d || !d.ok) return;
            chunk.forEach(function (id: any) {
              var ent = entry(target, id);
              var mine = String((d.mine && d.mine[String(id)]) || '');
              if (mine !== ent.mine) { ent.mine = mine; repaint(target, id); }
            });
          }).catch(function () {});
      })(ids.slice(i, i + 60));
    }
  }
  /* A live tally (the worker fans `react` over the target's own scope): the
     page repaints, the viewer's own reaction untouched. */
  function onLiveReact(m: any) {
    if (!m || !m.target || !m.id) return;
    var k = reactKey(m.target, m.id);
    if (!ledger[k]) return;
    ledger[k].cells = (m.reacts || []).map(function (c: any) { return { e: String(c.e), n: Number(c.n) || 0 }; });
    repaint(m.target, m.id);
  }

  /* ---- Who reacted: a popover under the chip (hover on desktop, a long
     press on a phone), each row a member with their reaction. One at a
     time; an outside click or a scroll closes it. ---- */
  var whoPop: any = null;
  function closeWho() {
    if (whoPop && whoPop.parentNode) whoPop.parentNode.removeChild(whoPop);
    whoPop = null;
    document.removeEventListener('click', whoOutside, true);
    window.removeEventListener('scroll', closeWho, true);
  }
  function whoOutside(e: any) { if (whoPop && !whoPop.contains(e.target)) closeWho(); }
  function placeWho(pop: any, anchor: any) {
    var r = anchor.getBoundingClientRect();
    pop.style.position = 'absolute';
    pop.style.left = Math.max(8, Math.min(window.innerWidth - 244, r.left)) + 'px';
    pop.style.top = (window.scrollY + r.bottom + 6) + 'px';
  }
  function showWho(anchor: any, target: any, id: any) {
    closeWho();
    var pop = el('div', 'wall-pop wall-likers-pop mc-who-pop');
    pop.appendChild(skeleton('short'));
    document.body.appendChild(pop); whoPop = pop;
    placeWho(pop, anchor);
    setTimeout(function () { document.addEventListener('click', whoOutside, true); window.addEventListener('scroll', closeWho, true); }, 0);
    fetch(API + '/react/who', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target: target, id: id }) })
      .then(function (r) { return r.json(); }).then(function (d) {
        if (whoPop !== pop) return;
        pop.textContent = '';
        if (!d || !d.ok || !(d.who && d.who.length)) { pop.appendChild(el('div', 'wall-pop-empty', 'No reactions yet')); return; }
        pop.appendChild(el('div', 'wall-pop-title', 'Reactions'));
        d.who.forEach(function (u: any) {
          var row = el('a', 'wall-likers-row'); row.href = profileHref(u.hash);
          wallAvatarInto(row, u.hash, u.avatar);
          row.appendChild(el('span', 'wall-likers-name', u.nick));
          var em = el('span', 'mc-who-emoji'); em.appendChild(reactionNode(u.emoji)); row.appendChild(em);
          pop.appendChild(row);
        });
        if (d.more) pop.appendChild(el('div', 'wall-pop-more', 'and more…'));
        placeWho(pop, anchor);
      }).catch(function () { if (whoPop === pop) { pop.textContent = ''; pop.appendChild(el('div', 'wall-pop-empty', 'Could not load')); } });
  }
  function attachWho(anchor: any, target: any, id: any) {
    var lpT = 0, hoverT = 0;
    anchor.addEventListener('mouseenter', function () { clearTimeout(hoverT); hoverT = setTimeout(function () { showWho(anchor, target, id); }, 320); });
    anchor.addEventListener('mouseleave', function () { clearTimeout(hoverT); });
    anchor.addEventListener('touchstart', function () { clearTimeout(lpT); lpT = setTimeout(function () { showWho(anchor, target, id); }, 450); }, { passive: true });
    anchor.addEventListener('touchend', function () { clearTimeout(lpT); }, { passive: true });
    anchor.addEventListener('touchmove', function () { clearTimeout(lpT); }, { passive: true });
  }

  /* The surface's own styles, injected once: the hole between four pieces of
     scrim (phone) or the popover at the pointer (desktop) — scrim inert to
     touch, overscroll contained — the bar, the menu, the picker, the pill.
     The class names keep their DM-era `dm-act` prefix: the DOM contract the
     prod webtest asserts is unchanged, only the home of the code moved. */
  function ensureActStyles() {
    if (document.getElementById('mc-act-css')) return;
    var css =
      '.dm-act{position:fixed;inset:0;z-index:4100;pointer-events:none;-webkit-touch-callout:none;-webkit-user-select:none;user-select:none}' +
      '.dm-act>*{pointer-events:auto}' +
      '.dm-act-scrim{position:fixed;background:rgba(0,0,0,.45);touch-action:none;overscroll-behavior:contain}' +
      '.dm-act-desk .dm-act-scrim{inset:0;background:transparent}' +
      '.dm-act-bar{position:fixed;display:flex;gap:2px;align-items:center;padding:4px;border-radius:999px;background:var(--surface,#fff);border:1px solid var(--rule);box-shadow:var(--shadow-2);max-width:calc(100vw - 20px);overflow-x:auto;overscroll-behavior:contain;animation:dm-act-in .16s ease-out;transform-origin:bottom left}' +
      '.dm-act-mine .dm-act-bar,.dm-act-mine .dm-act-menu{transform-origin:bottom right}' +
      '.dm-act-emoji{width:2.4em;height:2.4em;display:inline-flex;align-items:center;justify-content:center;border:0;background:none;border-radius:999px;font:inherit;font-size:1.35rem;line-height:1;cursor:pointer;padding:0;flex:none;color:var(--ink)}' +
      '.dm-act-emoji:hover{background:color-mix(in srgb,var(--maroon,#8b1a1a) 8%,transparent)}' +
      '.dm-act-emoji.on{background:color-mix(in srgb,var(--maroon,#8b1a1a) 16%,transparent);box-shadow:0 0 0 2px var(--maroon,#8b1a1a) inset}' +
      '.dm-act-emoji .mc-emoji{height:1.3em;margin:0;vertical-align:middle}' +
      '.dm-act-more{font-size:1.45rem;color:var(--faint);border:1px solid var(--rule);width:2.1em;height:2.1em;margin-left:2px}' +
      '.dm-act-menu{position:fixed;min-width:12.5rem;max-width:calc(100vw - 20px);background:var(--surface,#fff);border:1px solid var(--rule);border-radius:14px;box-shadow:var(--shadow-2);padding:.3rem;animation:dm-act-in .16s ease-out;transform-origin:top left;overscroll-behavior:contain}' +
      '.dm-act-item{display:flex;align-items:center;gap:.7em;width:100%;text-align:left;font:inherit;font-size:1rem;color:var(--ink);background:none;border:0;border-radius:9px;padding:.6rem .7rem;cursor:pointer;margin:0;text-decoration:none;box-sizing:border-box}' +
      '.dm-act-item:hover,.dm-act-item:focus-visible{background:color-mix(in srgb,var(--maroon,#8b1a1a) 8%,transparent);color:var(--maroon,#8b1a1a)}' +
      /* a post's own act links (a .comment-dm in gold, a .comment-delete) read in the menu's ink, not their head's */
      '.dm-act-menu .dm-act-item{color:var(--ink);text-decoration:none;font-size:1rem;margin:0}.dm-act-menu .dm-act-item:hover,.dm-act-menu .dm-act-item:focus-visible{color:var(--maroon,#8b1a1a)}' +
      '.dm-act-ico{width:1.4em;text-align:center;flex:none;color:var(--faint);font-size:1.05em}' +
      '.dm-act-item.on .dm-act-ico{color:var(--dm-saved,#d9a520)}' +
      '.dm-act-danger,.dm-act-danger .dm-act-ico{color:var(--maroon,#8b1a1a)}' +
      '.dm-act-pop{position:fixed;display:flex;flex-direction:column;gap:6px;align-items:flex-start}' +
      '.dm-act-pop .dm-act-bar,.dm-act-pop .dm-act-menu{position:static}' +
      '.dm-act .dm-act-picker{position:fixed;left:10px;right:10px;bottom:10px;margin:0;z-index:1;max-height:70vh;display:flex;flex-direction:column;box-shadow:var(--shadow-2)}' +
      '.dm-act .dm-act-picker .emoji-body{max-height:45vh}' +
      '.dm-act-desk .dm-act-picker{position:static;width:22rem;max-width:calc(100vw - 20px)}' +
      '.dm-act-bar[hidden],.dm-act-menu[hidden]{display:none!important}' +
      '@keyframes dm-act-in{from{opacity:0;transform:scale(.88)}to{opacity:1;transform:none}}' +
      /* the held node is lifted; a swipe travels by transform, never widening the page */
      '.dm-held{box-shadow:0 8px 28px rgba(0,0,0,.28)}' +
      '.dm-swiping{transition:none}' +
      '.dm-swipe-armed{box-shadow:-4px 0 0 0 var(--maroon,#8b1a1a)}' +
      /* the pill under a post: one chip per emoji, mine lit */
      '.mc-react-pill{display:flex;flex-wrap:wrap;gap:.3em;margin:.4em 0 0}' +
      '.mc-react-pill[hidden]{display:none!important}' +
      '.mc-react-chip{display:inline-flex;align-items:center;gap:.28em;font:inherit;font-size:.85em;line-height:1;padding:.25em .55em;border:1px solid var(--rule);border-radius:999px;background:var(--surface,#fff);color:var(--ink);cursor:pointer;margin:0}' +
      '.mc-react-chip.on{border-color:var(--maroon,#8b1a1a);background:color-mix(in srgb,var(--maroon,#8b1a1a) 10%,transparent);color:var(--maroon,#8b1a1a)}' +
      '.mc-react-chip .mc-emoji{height:1.25em;margin:0;vertical-align:-.2em}' +
      '.mc-react-n{font-variant-numeric:tabular-nums;opacity:.85}' +
      '.mc-who-emoji{margin-left:auto;padding-left:.5em}.mc-who-emoji .mc-emoji{height:1.2em;margin:0}';
    var st = el('style');
    st.id = 'mc-act-css';
    st.textContent = css;
    document.head.appendChild(st);
  }

  function bind() {
    API = B.API;
    CUSTOM_EMOJI = B.CUSTOM_EMOJI;
    blockedOut = B.blockedOut;
    bootSig = B.bootSig;
    buildEmojiPanel = B.buildEmojiPanel;
    el = B.el;
    emojiImg = B.emojiImg;
    profileHref = B.profileHref;
    skeleton = B.skeleton;
    state = B.state;
    wallAvatarInto = B.wallAvatarInto;
  }
  /* What runs at boot time, after every module is bound: the surface dies
     with the boot, and the live tallies land. */
  function run() {
    bootSig.addEventListener('abort', closeActs, { once: true });
    bootSig.addEventListener('abort', closeWho, { once: true });
    document.addEventListener('mc-live', function (ev) {
      var m = (ev as CustomEvent).detail; if (!m) return;
      if (m.t === 'react') onLiveReact(m);
    }, { signal: bootSig });
  }
  return { bind, run, exports: { armHold, attachWho, closeActs, closeActsFor, ensureActStyles, openActs, reactLoadMine, reactMine, reactPillInto, reactRegister, reactSend, reactionNode, showWho } };
}
