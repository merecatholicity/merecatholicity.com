/* One DM message: its expiry chooser, reactions and the saved mark, the press-and-hold acts and Message info, the bubbles and quotes, the reply envelope inside the plaintext, E2E media, the render, edit, copy, redact and delete.
   Split out of client/dm.ts on 2026-09-16 (the six DM factories); every declaration
   moved verbatim. Names from the boot and the other modules are bound in bind(). */
import type { Boot } from './boot';

export function installDmMessage(B: Boot) {
  /* Names this module takes from the boot — the root's helpers and the other
     modules' exports — bound in bind() once every module is installed, so
     order of installation never matters and every body reads as it did. */
  let API: string;
  let appConfirm: (msg: any, opts: any, cb: any) => any;
  let armHold: (node: any, open: (at: any) => void, opts?: any) => any;
  let blockedOut: (d: any) => any;
  let bootSig: AbortSignal;
  let closeActs: () => any;
  let closeActsFor: (node: any) => any;
  let displayName: (hash: any) => any;
  let el: (tag: string, cls?: string | null, text?: string | number | null) => any;
  let fillBody: (node: HTMLElement, text: any, plain?: boolean) => any;
  let fmtDateTime: (epoch: any) => any;
  let reactPillInto: (host: unknown, target: unknown, id: unknown, cells: unknown[], mine: string, opts?: unknown) => any;
  let loadingLine: (text: string, cls?: string) => any;
  let mcDmBlobGet: (key: string) => string | null;
  let mcDmBlobPut: (key: string, url: string, bytes: number) => void;
  let notifCacheSet: (n: any) => any;
  let mediaDownloadLink: (url: any, filename: any, label: any, cls: any) => any;
  let openActs: (spec: any) => any;
  let reactionNode: (emoji: any) => any;
  let state: Record<string, any>;
  let truncate: (s: any, n: any) => any;
  let DM_CACHE: string;
  let dmAvatarCell: (mm: unknown, cls: string) => any;
  let dmB64uDec: (str: unknown) => any;
  let dmB64uEnc: (bytes: unknown) => any;
  let dmForwardPicker: (m: unknown, ctx: unknown) => any;
  let dmPlain: (m: unknown, ctx: unknown) => any;
  let dmReseal: (plaintext: unknown, m: unknown, ctx: unknown) => any;

  /* ---- Disappearing messages: the expiry note + chooser, and the per-message
     save toggle. The lifetime is per-conversation; either party changes it and
     the last write wins for both. Saving a message exempts it for both. ---- */
  function dmTtlLabel(ttl: any) {
    if (window.mcCore) return window.mcCore.dmTtlLabel(ttl);
    ttl = Number(ttl) || 2592000;   // Domain.Dm.defaultTtl (30 days)
    if (ttl <= 86400) return '24 hours';
    if (ttl >= 2592000) return '30 days';
    return '7 days';
  }

  /* The DM lifetime chooser options, single-sourced from the PureScript Domain.Dm
     (Core); the inline fallback matches the worker's DM_TTLS. */
  function dmTtlChoices() {
    return (window.mcCore && window.mcCore.dmTtlOptions)
      ? window.mcCore.dmTtlOptions.map(function (o) { return [o.secs, o.label]; })
      : [[86400, '24 hours'], [604800, '7 days'], [2592000, '30 days']];
  }

  function dmExpiryNode(target: any, ttl: any, isNew: any, onChange?: (t: number) => void) {
    var p = el('p', 'dm-expiry');
    var cur = Number(ttl) || 2592000;   // Domain.Dm.defaultTtl (30 days)
    function paint() {
      p.textContent = '';
      p.appendChild(document.createTextNode('⏳ ' + (isNew ? 'Messages here disappear ' : 'Disappears ') + dmTtlLabel(cur) + ' after they are opened. '));
      var change = el('a', null, 'change');
      change.href = '#';
      change.addEventListener('click', function (ev: any) { ev.preventDefault(); chooser(); });
      p.appendChild(change);
    }
    function chooser() {
      p.textContent = 'Disappears after opening: ';
      dmTtlChoices().forEach(function (opt, i) {
        if (i) p.appendChild(document.createTextNode(' · '));
        var a = el('a', null, opt[1] + (cur === opt[0] ? ' ✓' : ''));
        a.href = '#';
        a.addEventListener('click', function (ev: any) {
          ev.preventDefault();
          fetch(API + '/dm/ttl', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(Object.assign({ key: state.key, ttl: opt[0] }, target)) })
            .then(function (r) { return r.json(); })
            .then(function (d) { if (d && d.ok) { cur = opt[0] as number; isNew = false; paint(); if (onChange) onChange(cur); } })
            .catch(function () {});
        });
        p.appendChild(a);
      });
      p.appendChild(document.createTextNode(' · '));
      var cancel = el('a', null, 'cancel');
      cancel.href = '#';
      cancel.addEventListener('click', function (ev: any) { ev.preventDefault(); paint(); });
      p.appendChild(cancel);
    }
    p.mcSetTtl = function (t: any) { cur = Number(t) || cur; isNew = false; paint(); };
    paint();
    return p;
  }

  /* A pair's two sides from the ledger's rows (0016: one row per member,
     m.reactions) — or the react_me / react_other a pair's payload still carries
     one deploy. */
  function dmReactSides(m: any) {
    if (Array.isArray(m.reactions)) {
      var mine = '', theirs = '';
      m.reactions.forEach(function (r: any) {
        if (!r || !r.emoji) return;
        if (r.hash === state.myHash) mine = String(r.emoji); else if (!theirs) theirs = String(r.emoji);
      });
      return { mine: mine, theirs: theirs };
    }
    return { mine: String(m.react_me || ''), theirs: String(m.react_other || '') };
  }

  /* One member's reaction set (or withdrawn) on a message object: the rows,
     and the pair fields beside them. */
  function dmSetReaction(m: any, hash: any, emoji: any) {
    var h = String(hash || ''), e = String(emoji || '');
    if (!Array.isArray(m.reactions)) {
      /* A word that arrived in the pair shape alone (a bundle's cached payload
         from before 0016): its two sides seed the rows, the other's under a
         stand-in hash, so a first reaction here never loses theirs. */
      m.reactions = [];
      if (m.react_me) m.reactions.push({ hash: state.myHash, emoji: String(m.react_me) });
      if (m.react_other) m.reactions.push({ hash: '*', emoji: String(m.react_other) });
    }
    m.reactions = m.reactions.filter(function (r: any) { return r && r.hash !== h && !(h !== state.myHash && r.hash === '*'); });
    if (e) m.reactions.push({ hash: h, emoji: e });
    if (h === state.myHash) m.react_me = e; else m.react_other = e;
  }

  /* Paint (or repaint) a bubble's reaction pill from the message's reactions.
     The pill opens the same surface a press-and-hold does, so a reaction is
     changed or withdrawn where it is seen. */
  function dmReactPaint(m: any, node: any, ctx: any) {
    var old = node.querySelector(':scope > .dm-react-pill');
    if (old) old.remove();
    if (ctx && ctx.kind === 1) {
      /* A group's pill is the public painter's (client/surface.ts): the set
         with counts, mine lit, who under each chip; a chip reacts the same or
         withdraws mine — the surface's own act, never the public ledger. */
      var cells = (window.mcCore && window.mcCore.dmTally) ? window.mcCore.dmTally(m.reactions || []) : [];
      node.classList.toggle('dm-has-react', !!cells.length);
      if (!cells.length) return;
      var host = el('div', 'dm-react-pill dm-react-many');
      reactPillInto(host, 'dm', m.id, cells, dmReactSides(m).mine, {
        onPick: function (e: any) { dmReact(m, node, ctx, e); },
        title: function (e: any) {
          return (m.reactions || []).filter(function (r: any) { return r && r.emoji === e; })
            .map(function (r: any) { return r.hash === state.myHash ? 'You' : ctx.nameOf(r.hash); }).join(', ') + ' reacted ' + e;
        } });
      node.appendChild(host);
      return;
    }
    var rx = dmReactSides(m);
    var mine = rx.mine, theirs = rx.theirs;
    node.classList.toggle('dm-has-react', !!(mine || theirs));
    if (!mine && !theirs) return;
    var pill = el('button', 'dm-react-pill');
    pill.type = 'button';
    var who = (ctx && ctx.shortName) || 'They';
    if (mine && theirs && mine === theirs) {
      pill.appendChild(reactionNode(mine));
      pill.appendChild(el('span', 'dm-react-n', '2'));
      pill.title = 'You and ' + who + ' both reacted ' + mine;
    } else {
      if (theirs) pill.appendChild(reactionNode(theirs));
      if (mine) pill.appendChild(reactionNode(mine));
      pill.title = (theirs ? who + ' reacted ' + theirs : '') + (theirs && mine ? ' · ' : '') + (mine ? 'You reacted ' + mine : '');
    }
    pill.setAttribute('aria-label', pill.title);
    pill.addEventListener('click', function (e: any) { e.stopPropagation(); dmOpenActions(m, node, ctx, null); });
    node.appendChild(pill);
  }

  /* Send my reaction (empty = withdraw; my own again = withdraw): optimistic,
     reverted on refusal. The value is the kernel's to accept or refuse
     (mcCore.dmReaction), the same rule the worker's store runs. */
  function dmReact(m: any, node: any, ctx: any, emoji: any) {
    var was = dmReactSides(m).mine;
    var want = String(emoji || '');
    if (want === was) want = '';
    if (want && window.mcCore && window.mcCore.dmReaction && window.mcCore.dmReaction(want) === null) return;
    dmSetReaction(m, state.myHash, want); dmReactPaint(m, node, ctx);
    fetch(API + '/dm/react', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ key: state.key, id: m.id, emoji: want }, ctx.target())) })
      .then(function (r) { return r.json(); })
      .then(function (d) { if (blockedOut(d)) return; if (!d || !d.ok) { dmSetReaction(m, state.myHash, was); dmReactPaint(m, node, ctx); } })
      .catch(function () { dmSetReaction(m, state.myHash, was); dmReactPaint(m, node, ctx); });
  }

  /* The saved mark. A saved message is exempt from expiry for both, and it is
     LIT for both — the bubble takes the saved ring and a ★ in its meta row
     (the Snapchat convention: a kept message must look kept). Repainted live
     when the other side saves or unsaves. */
  function dmSavedPaint(m: any, node: any) {
    var on = !!Number(m.saved || 0);
    node.classList.toggle('dm-saved', on);
    var meta = node.querySelector(':scope > .dm-meta');
    if (!meta) return;
    var mark = meta.querySelector('.dm-savedmark');
    if (on && !mark) {
      mark = el('span', 'dm-savedmark', '★');
      mark.title = 'Saved — kept for both of you';
      mark.setAttribute('aria-label', 'Saved');
      var date = meta.querySelector('.comment-date');
      meta.insertBefore(mark, date || null);
    } else if (!on && mark) mark.remove();
  }

  function dmSave(m: any, node: any, ctx: any, want: any) {
    var was = Number(m.saved || 0) ? 1 : 0;
    m.saved = want ? 1 : 0; dmSavedPaint(m, node);
    fetch(API + '/dm/save', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ key: state.key, id: m.id, saved: !!want }, ctx.target())) })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (blockedOut(d)) return;
        if (!d || !d.ok) { m.saved = was; dmSavedPaint(m, node); return; }
        if (ctx.note) ctx.note(want ? 'Saved — it will not disappear.' : 'Unsaved.');
      })
      .catch(function () { m.saved = was; dmSavedPaint(m, node); });
  }

  /* ---- UI sounds: ONE engine, shell-owned in app/call.ts (window.mcSound —
     it must live in the bundle so an incoming call rings on any page). This
     client only delegates its bell dings; no bundle = no sounds, which is the
     honest no-app posture. ---- */
  function playSound(name: any, loop?: any) {
    try { if ((window as any).mcSound) (window as any).mcSound.play(name, loop); } catch (e) { /* silent */ }
  }

  /* ---- The message surface (2026-09-10; the shared surface since
     2026-09-12, client/surface.ts openActs): a press-and-hold over one bubble
     — the reaction bar above, the bubble lit in a hole between four pieces of
     scrim, the acts below; a popover at the pointer on desktop. What is DM
     here: my reaction on the message (react_me, one per side), and the acts
     that apply — Reply · Forward (any word but a system line or an expired
     attachment; 2026-09-13) · Copy (text, or a media caption) · Edit (mine,
     text, not a system notice) · Save/Unsave (★ lit when saved) · Delete
     (mine). No Star or More. A redacted bubble opens nothing. ---- */
  function dmCloseActions() { closeActs(); }

  function dmOpenActions(m: any, node: any, ctx: any, at: any) {
    if (!m || !m.id || m.redacted || node.mcDead || !node.isConnected) { closeActs(); return; }
    var mine = m.sender_hash === state.myHash;
    var sys = Number(m.enc || 0) === 2;
    var hasText = !m.media_key && !m.media_expired;
    var items: any[] = [];
    items.push({ label: 'Reply', icon: '↩', fn: function () { ctx.reply(m); } });
    if (!sys && !m.media_expired) items.push({ label: 'Forward', icon: '↪', fn: function () { dmForwardPicker(m, ctx); } });
    var copyText = hasText ? String(m.body || '') : String((m._env && m._env.caption) || '');
    if (copyText) items.push({ label: 'Copy', icon: '⧉', fn: function () { dmCopy(copyText, ctx); } });
    if (mine && ctx && ctx.kind === 1 && !sys) items.push({ label: 'Info', icon: 'ⓘ', fn: function () { dmReadByInfo(m, ctx); } });
    if (mine && hasText && !sys) items.push({ label: 'Edit', icon: '✎', fn: function () { dmStartEdit(m, node, ctx); } });
    var saved = !!Number(m.saved || 0);
    items.push({ label: saved ? 'Unsave' : 'Save', icon: saved ? '★' : '☆', cls: saved ? 'on' : '', fn: function () { dmSave(m, node, ctx, saved ? 0 : 1); } });
    if (mine && !sys) items.push({ label: 'Delete', icon: '✕', cls: 'dm-act-danger', fn: function () { dmDeleteMsg(m, node, ctx); } });
    openActs({ node: node, at: at, mine: mine,
      react: { current: String(m.react_me || ''), onPick: function (e: any) { dmReact(m, node, ctx, e); } },
      items: items });
  }

  /* Message info (a group, 2026-09-15): who has read this word of mine — each
     other current member as Read / Delivered, or "Receipts off" for one who
     hides their reads (WhatsApp's "Message info", Snapchat's "Opened by").
     Opened from the surface's Info and from the tick itself. The stamps are
     watermarks, so a member's reading is told, never the minute of it. */
  function dmReadByInfo(m: any, ctx: any) {
    var rows = ctx.current().filter(function (mm: any) { return mm.hash !== state.myHash; }).map(function (mm: any) {
      var off = mm.receipts === 0 || mm.receipts === '0';
      var read = !off && Number(mm.read_at || 0) >= Number(m.created_at || 0);
      return { mm: mm, rank: read ? 0 : (off ? 2 : 1), state: read ? 'Read' : (off ? 'Receipts off' : 'Delivered') };
    }).sort(function (a: any, b: any) { return a.rank - b.rank; });
    var readN = rows.filter(function (r: any) { return r.rank === 0; }).length;
    var box = el('div', 'dm-info dm-readby');
    box.appendChild(el('div', 'dm-info-row-title', readN ? 'Read by ' + readN + ' of ' + rows.length : 'Read by nobody yet'));
    var list = el('div', 'dm-members');
    rows.forEach(function (r: any) {
      var row = el('div', 'dm-member-row');
      row.appendChild(dmAvatarCell(r.mm, 'dm-member-av'));
      row.appendChild(el('span', 'dm-member-name', ctx.nameOf(r.mm.hash)));
      row.appendChild(el('span', 'dm-member-acts dm-readby-state' + (r.rank === 0 ? ' dm-receipt-seen' : ''), r.rank === 0 ? '✓✓ Read' : r.state));
      list.appendChild(row);
    });
    box.appendChild(list);
    if (window.mcSheet) window.mcSheet.open('Message info', box);
    else if (ctx.note) ctx.note(readN ? 'Read by ' + rows.filter(function (r: any) { return r.rank === 0; }).map(function (r: any) { return ctx.nameOf(r.mm.hash); }).join(', ') : 'Read by nobody yet');
  }

  /* A downward swipe over the page while a composer has the keyboard up
     dismisses it (the owner's report: the page scrolled under a keyboard that
     stayed, with no easy way out). Touch only, passive, live only while the
     field is focused; a swipe that starts inside the composer itself is left
     alone. The listeners die with the boot. */
  function swipeDismissesKeyboard(ta: any, composer: any) {
    var y0 = -1;
    document.addEventListener('touchstart', function (e: any) {
      if (document.activeElement !== ta || e.touches.length !== 1) { y0 = -1; return; }
      var t = e.target;
      y0 = (t && t.closest && composer.contains(t)) ? -1 : e.touches[0].clientY;
    }, { passive: true, signal: bootSig });
    document.addEventListener('touchmove', function (e: any) {
      if (y0 < 0 || document.activeElement !== ta) return;
      if (e.touches[0].clientY - y0 > 48) { y0 = -1; try { ta.blur(); } catch (x) { /* fine */ } }
    }, { passive: true, signal: bootSig });
  }

  /* Arm a rendered bubble: the shared gestures (client/surface.ts armHold —
     a hold on touch, a right-click, the ⌄ on hover) open the message surface;
     a swipe to the right replies (the DM's own). */
  function dmArmGestures(m: any, node: any, ctx: any) {
    armHold(node, function (at: any) { dmOpenActions(m, node, ctx, at); },
      { skip: 'video,audio,textarea,input,button,.dm-edit-box,.dm-react-pill', swipe: function () { ctx.reply(m); }, contextmenu: true, more: true });
  }

  /* The bubble frame every DM message shares (WhatsApp-shaped): the optional
     system label, the quote of what it answers, the body the caller built, and
     a meta row at the foot — the edited mark, the saved star, the time, and on
     mine the ticks. No author line: the side and the fill say who. */
  function dmBubble(m: any, bodyEl: any, opts: any) {
    var mine = m.sender_hash === state.myHash;
    var node = el('div', 'dm-msg' + (mine ? ' dm-mine' : ''));
    if (m.id) node.setAttribute('data-dmid', String(m.id));
    /* In a group another's bubble names its author — once per run of the same
       sender (placeMsg decides), in that member's colour (Domain.Dm.memberHue);
       a pair's bubbles never do: the side and the fill say who. */
    if (!mine && m._author && opts && opts.ctx && opts.ctx.kind === 1) {
      var hue = (window.mcCore && window.mcCore.dmMemberHue) ? window.mcCore.dmMemberHue(String(m.sender_hash || '')) : 0;
      node.appendChild(el('div', 'dm-author dm-hue-' + hue, opts.ctx.nameOf(m.sender_hash)));
    }
    if (opts && opts.sysLabel) node.appendChild(el('div', 'dm-sys-label', opts.sysLabel));
    if (m.fwd) node.appendChild(el('div', 'dm-fwd', '↪ ' + ((window.mcCore && window.mcCore.dmForwardedLabel) || 'Forwarded')));
    if (opts && opts.reply && opts.ctx) node.appendChild(dmQuoteNode(opts.reply, opts.ctx));
    node.appendChild(bodyEl);
    var meta = el('div', 'dm-meta');
    if (m.edited_at) meta.appendChild(el('span', 'dm-edited', 'edited'));
    var dt = el('span', 'comment-date', dmTimeLabel(m.created_at));
    dt.title = fmtDateTime(m.created_at);
    meta.appendChild(dt);
    node.appendChild(meta);
    return node;
  }

  /* Only the time: the day is said once, by the chip above the first bubble
     of each day. */
  function dmTimeLabel(epoch: any) {
    return new Date((Number(epoch) || 0) * 1000).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  function dmDayLabel(epoch: any) {
    var d = new Date((Number(epoch) || 0) * 1000), now = new Date();
    var yest = new Date(now); yest.setDate(now.getDate() - 1);
    if (d.toDateString() === now.toDateString()) return 'Today';
    if (d.toDateString() === yest.toDateString()) return 'Yesterday';
    if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function dmDayNode(epoch: any) {
    var n = el('div', 'dm-day', dmDayLabel(epoch));
    n.setAttribute('data-day', new Date((Number(epoch) || 0) * 1000).toDateString());
    return n;
  }

  /* What a quote of another message says: the media kind as a word, then the
     caption or the excerpt. */
  function dmQuoteText(reply: any) {
    var kind = String(reply.kind || 'text');
    var label = kind === 'image' ? '📷 Photo' : kind === 'video' ? '🎞️ Video' : kind === 'audio' ? '🎤 Voice note' : kind === 'file' ? '📎 File' : '';
    var text = String(reply.text || '');
    return label ? (text ? label + ' · ' + text : label) : (text || 'Message');
  }

  /* Light a bubble for a moment: the quote jump's and the bell's landing. */
  function dmFlash(target: any) {
    target.classList.remove('dm-flash');
    void target.offsetWidth;
    target.classList.add('dm-flash');
    setTimeout(function () { target.classList.remove('dm-flash'); }, 1300);
  }

  /* The quote block at the head of a reply: who and what, and a tap jumps to
     the original when it is on this page (and lights it for a moment). */
  function dmQuoteNode(reply: any, ctx: any) {
    var q = el('div', 'dm-quote');
    q.setAttribute('role', 'button'); q.tabIndex = 0;
    q.title = 'Jump to the quoted message';
    q.appendChild(el('span', 'dm-quote-who', String(reply.from || '') === state.myHash ? 'You' : (ctx.nameOf ? ctx.nameOf(reply.from) : (ctx.shortName || 'Them'))));
    q.appendChild(el('span', 'dm-quote-text', dmQuoteText(reply)));
    function jump() {
      var target = ctx.list && ctx.list.querySelector('[data-dmid="' + String(reply.id).replace(/"/g, '') + '"]');
      if (!target) { if (ctx.note) ctx.note('That message is not on this page.'); return; }
      try { target.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { target.scrollIntoView(); }
      dmFlash(target);
    }
    q.addEventListener('click', function (e: any) { e.stopPropagation(); jump(); });
    q.addEventListener('keydown', function (e: any) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); jump(); } });
    return q;
  }

  /* ---- The reply envelope. A quoted reply rides INSIDE the E2E plaintext —
     the server stays blind to what answers what — as the kernel's sentinel
     (Domain.Dm.replySentinel, U+0001, untypeable) followed by JSON:
     {v:1, text, reply:{id, from, kind, text}, fwd:1}. Plaintext without the
     sentinel is the bare message it always was. A media message carries its
     reply in the media envelope instead (env.reply), and its mark (env.fwd).
     The mark (2026-09-13) says a word was forwarded — the small "Forwarded"
     line the owner chose — and rides here so the server never learns it. ---- */
  function dmReplySentinel() {
    return (window.mcCore && window.mcCore.dmReplySentinel) || '';
  }

  function dmWrapText(text: any, reply: any, fwd?: any) {
    var t = String(text == null ? '' : text);
    if (!reply && !fwd) return t;
    var o: any = { v: 1, text: t };
    if (reply) o.reply = reply;
    if (fwd) o.fwd = 1;
    return dmReplySentinel() + JSON.stringify(o);
  }

  /* A reply reference as received: only the shape we send, or nothing. */
  function dmReplyClean(r: any) {
    if (!r || typeof r !== 'object') return null;
    var id = Math.floor(Number(r.id) || 0);
    var from = String(r.from || '');
    if (id < 1 || !/^[0-9a-f]{64}$/.test(from)) return null;
    var kind = String(r.kind || 'text');
    if (['text', 'image', 'video', 'audio', 'file'].indexOf(kind) === -1) kind = 'text';
    return { id: id, from: from, kind: kind, text: String(r.text == null ? '' : r.text).slice(0, 400) };
  }

  function dmParseText(plain: any) {
    var str = String(plain == null ? '' : plain);
    if (str.charAt(0) !== dmReplySentinel()) return { text: str, reply: null };
    try {
      var o = JSON.parse(str.slice(1));
      if (o && typeof o === 'object') {
        var out: any = { text: String(o.text == null ? '' : o.text), reply: dmReplyClean(o.reply) };
        if (o.fwd) out.fwd = true;   // the mark, only when it was set
        return out;
      }
    } catch (e) { /* not an envelope after all */ }
    return { text: str.slice(1), reply: null };
  }

  /* What a reply to m quotes. The excerpt rule is the kernel's (whitespace
     folded, cut by code points with an ellipsis). */
  function dmReplyRef(m: any) {
    var kind = 'text', text = '';
    if (m.media_key || m.media_expired) {
      var mime = (m._env && m._env.mime) || '';
      kind = /^image\//.test(mime) ? 'image' : /^video\//.test(mime) ? 'video' : /^audio\//.test(mime) ? 'audio' : 'file';
      text = (m._env && m._env.caption) || '';
    } else text = m.body || '';
    var ex = window.mcCore && window.mcCore.dmReplyExcerpt ? window.mcCore.dmReplyExcerpt(text) : truncate(text, 160);
    return { id: m.id, from: m.sender_hash, kind: kind, text: ex };
  }

  /* "I watched it arrive": debounced acknowledgment for a live-delivered message
     in the OPEN thread — stamps the read state, starts the disappearing clock,
     sends the Seen receipt, and clears any raced dm notification, exactly as a
     thread reload would, without refetching it. */
  var dmSeenT: any = 0;

  function dmSeenPing(target: any) {
    clearTimeout(dmSeenT);
    dmSeenT = setTimeout(function () {
      try { localStorage.removeItem(DM_CACHE); } catch (e) { /* fine */ }
      fetch(API + '/dm/seen', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.assign({ key: state.key }, target)) })
        .then(function (r) { return r.json(); })
        .then(function (d) { if (d && typeof d.notif_unread === 'number') notifCacheSet(d.notif_unread); })   // the bells it read
        .catch(function () { /* next open settles it */ });
    }, 1200);
  }

  /* ---- E2E media: encrypt a file with AES-256-GCM (a fresh key per file), carry
     the key/iv/meta inside the nacl.box message body, upload only ciphertext, and
     lazily fetch + decrypt + blob-render it on the other side. ---- */
  function fmtBytes(n: any) {
    n = Number(n) || 0;
    if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
    if (n >= 1024) return Math.round(n / 1024) + ' KB';
    return n + ' B';
  }

  function dmMediaEncryptFile(file: any) {
    return file.arrayBuffer().then(function (buf: any) {
      var iv = crypto.getRandomValues(new Uint8Array(12));
      return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']).then(function (k) {
        return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, k, buf).then(function (ctBuf) {
          return crypto.subtle.exportKey('raw', k).then(function (rawK) {
            return { ct: new Uint8Array(ctBuf), env: { k: dmB64uEnc(new Uint8Array(rawK)), iv: dmB64uEnc(iv),
              name: String(file.name || 'file').slice(0, 120), mime: file.type || 'application/octet-stream', size: file.size } };
          });
        });
      });
    });
  }

  function dmMediaDecrypt(ct: any, envInfo: any) {
    return crypto.subtle.importKey('raw', dmB64uDec(envInfo.k), { name: 'AES-GCM' }, false, ['decrypt'])
      .then(function (k) { return crypto.subtle.decrypt({ name: 'AES-GCM', iv: dmB64uDec(envInfo.iv) }, k, ct); })
      .then(function (buf) { return new Uint8Array(buf); });
  }

  function loadDmMedia(mediaKey: any, envInfo: any) {
    var held = mcDmBlobGet(mediaKey);
    if (held) return Promise.resolve(held);
    return fetch(API + '/dm/media/get', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: state.key, media_key: mediaKey }) })
      .then(function (r) { if (!r.ok) throw new Error('media ' + r.status); return r.arrayBuffer(); })
      .then(function (buf) { return dmMediaDecrypt(new Uint8Array(buf), envInfo); })
      .then(function (bytes) {
        var url = URL.createObjectURL(new Blob([bytes], { type: (envInfo && envInfo.mime) || 'application/octet-stream' }));
        mcDmBlobPut(mediaKey, url, bytes.length);
        return url;
      });
  }

  /* Do the work when the reader is nearly looking at it, not when the page
     draws. Every attachment in a thread used to be fetched and AES-decrypted
     the instant the history rendered — a page of voice notes decoded all of
     them into memory at once and handed each a live <audio>, which on iOS is a
     decoder apiece. */
  function whenNear(node: any, fn: () => void) {
    if (!('IntersectionObserver' in window)) { fn(); return; }
    var io = new IntersectionObserver(function (ents) {
      if (!ents.some(function (e) { return e.isIntersecting; })) return;
      io.disconnect();
      fn();
    }, { rootMargin: '400px' });
    io.observe(node);
    /* An attachment the reader never scrolled to leaves an observer holding
       its element. The view is gone at teardown; the observer should be too. */
    bootSig.addEventListener('abort', function () { io.disconnect(); }, { once: true });
  }

  /* One media bubble: the shared frame (dmBubble), its body lazily loading the
     decrypted media as an <img>/<video>/<audio> (or a download link). */
  function dmMediaNode(m: any, ctx: any, envInfo: any) {
    var bodyEl = el('div', 'comment-body dm-media-body');
    var holder = el('div', 'dm-media');
    holder.appendChild(loadingLine('Loading ' + ((envInfo && envInfo.name) || 'media') + '…', 'dm-media-status'));
    bodyEl.appendChild(holder);
    if (envInfo && envInfo.caption) bodyEl.appendChild(fillBody(el('div', 'dm-media-caption'), envInfo.caption));
    var node = dmBubble(m, bodyEl, { reply: m.reply, ctx: ctx });
    /* On approach, not on render: see whenNear. */
    var tries = 0;
    function paint() {
      loadDmMedia(m.media_key, envInfo).then(function (url) {
        holder.textContent = '';
        var mime = (envInfo && envInfo.mime) || '';
        var mel;
        var isFile = false;
        if (/^image\//.test(mime)) { mel = el('img', 'dm-media-img'); mel.src = url; mel.alt = envInfo.name || 'image'; mel.loading = 'lazy'; }
        /* preload='none': a blob src is already bytes in hand, but iOS spins up
           a media decoder per element the moment it may need one, and a thread
           of voice notes is a thread of decoders. The reader presses play. */
        else if (/^video\//.test(mime)) { mel = el('video', 'dm-media-vid'); mel.preload = 'none'; mel.src = url; mel.controls = true; }
        else if (/^audio\//.test(mime)) { mel = el('audio', 'dm-media-aud'); mel.preload = 'none'; mel.src = url; mel.controls = true; }
        else { isFile = true; mel = el('a', 'dm-media-file', (envInfo.name || 'download') + ' · ' + fmtBytes(envInfo.size)); mel.href = url; mel.download = envInfo.name || 'file'; }
        /* The store is bounded, so a blob far up a long thread can be revoked
           while its element still points at it. Fetch it again rather than
           leaving a broken bubble — eviction should cost a moment, not the
           attachment. Once, so a genuinely dead object cannot loop. */
        if (!isFile) {
          mel.addEventListener('error', function () {
            if (tries++) return;
            holder.textContent = '';
            holder.appendChild(loadingLine('Loading ' + ((envInfo && envInfo.name) || 'media') + '…', 'dm-media-status'));
            paint();
          });
        }
        holder.appendChild(mel);
        /* a plain "Download" control for image/video/audio (the file case is already
           a download link). The blob is the decrypted bytes, saved under its name. */
        if (!isFile) {
          var dlRow = el('div', 'dm-media-dl');
          dlRow.appendChild(mediaDownloadLink(url, envInfo.name || 'download', 'Download', 'wall-act wall-act-dl dm-dl'));
          holder.appendChild(dlRow);
        }
      }).catch(function () {
        holder.textContent = '';
        holder.appendChild(el('span', 'dm-media-status', '⚠️ media unavailable (it may have expired)'));
      });
    }
    whenNear(node, paint);
    return node;
  }

  /* The stand-in for a media attachment the 30-day hard cap has swept away
     while the (saved) message itself survives — no fetch, the placeholder over
     any caption the message still carries. */
  function dmMediaExpiredNode(m: any, ctx: any, caption: any) {
    var bodyEl = el('div', 'comment-body dm-media-body');
    var ph = el('div', 'dm-media-expired');
    ph.appendChild(el('span', 'dm-media-expired-icon', '🖼️'));
    ph.appendChild(el('span', 'dm-media-expired-text', 'Attachment expired'));
    bodyEl.appendChild(ph);
    if (caption) bodyEl.appendChild(fillBody(el('div', 'dm-media-caption'), caption));
    return dmBubble(m, bodyEl, { reply: m.reply, ctx: ctx });
  }

  /* Render one DM message — decrypting upstream of the bubble builders, parsing
     the reply envelope, keeping the media envelope on the message (a quote and
     a Copy read it) — then arm it: the saved mark, the reaction pill, the
     gestures. Shared by the history loop, the live drop-in, and my own echo
     (which arrives with its envelope already in hand). A deleted message is the
     "<redacted>" placeholder and takes no gesture. */
  function dmRenderMsg(m: any, ctx: any) {
    var node;
    if (m.redacted) node = dmRedactedNode(m);
    else {
      var e = Number(m.enc || 0);
      if (m.media_key) {
        var envInfo = m._env || null;
        if (!envInfo && (e === 1 || e === 3)) { try { envInfo = JSON.parse(dmPlain(m, ctx) || 'null'); } catch (x) { envInfo = null; } }
        if (envInfo) { m._env = envInfo; m.reply = dmReplyClean(envInfo.reply); m.fwd = !!envInfo.fwd; node = dmMediaNode(m, ctx, envInfo); }
        else { m.body = '⚠️ could not open media'; node = dmMsgNode(m, ctx, null); }
      } else if (m.media_expired) {
        var cap = '';
        if (e === 1 || e === 3) {
          try { var ev = JSON.parse(dmPlain(m, ctx) || 'null'); if (ev) { m._env = ev; m.reply = dmReplyClean(ev.reply); cap = ev.caption || ''; } } catch (x2) { cap = ''; }
        }
        node = dmMediaExpiredNode(m, ctx, cap);
      } else if (e === 2 && window.mcCore && window.mcCore.callLine && window.mcCore.callLine(String(m.body || ''))) {
        /* A call's line (2026-09-12; the log 2026-09-13): the system word the
           worker writes into the thread once per call — missed, declined, or
           answered with its length — drawn by side (Domain.Call.callLineText):
           the caller's "no answer", the callee's "missed", "Outgoing voice
           call · 12 min". A muted line, not a bubble: no surface, no pill,
           nothing to reply to. Asked FIRST among the system words: the
           sys-line grammar must never read a call's word (2026-09-14). */
        return dmCallLine(m);
      } else if (e === 2 && window.mcCore && window.mcCore.dmSysLine && window.mcCore.dmSysLine(String(m.body || ''))) {
        /* A membership line (0016): "Ann added Bob and you", "Bob left", "Ann
           named the conversation “Choir”" — a muted line like a call's, no
           bubble, no surface, nothing to reply to. */
        return dmSysLineNode(m, ctx);
      } else {
        var sysLabel = null;
        if (e === 1 || e === 3) { var pt = dmParseText(dmPlain(m, ctx) || '⚠️ could not decrypt'); m.body = pt.text; m.reply = pt.reply; m.fwd = !!pt.fwd; }
        else if (e === 2) sysLabel = '⚙️ Automated notice';
        node = dmMsgNode(m, ctx, sysLabel);
      }
    }
    dmArmMessage(m, node, ctx);
    return node;
  }

  function dmSysLineNode(m: any, ctx: any) {
    var core = window.mcCore as NonNullable<typeof window.mcCore>;   // dmRenderMsg took this road only because the membrane read the line
    var mine = m.sender_hash === state.myHash;
    var who = function (h: any) { return String(h) === state.myHash ? 'you' : (ctx && ctx.nameOf ? ctx.nameOf(h) : displayName(String(h || ''))); };
    var actor = mine ? 'You' : who(m.sender_hash);
    var line = el('div', 'dm-call-line dm-sys-line');
    if (m.id) line.setAttribute('data-dmid', String(m.id));
    line.appendChild(el('span', 'dm-call-text', core.dmSysLineText(String(m.body || ''), actor, who)));
    var t = el('span', 'dm-call-time', dmTimeLabel(m.created_at));
    t.title = fmtDateTime(m.created_at);
    line.appendChild(t);
    return line;
  }

  function dmCallLine(m: any) {
    var mine = m.sender_hash === state.myHash;   // I placed it
    var body = String(m.body || '');
    var core = window.mcCore as NonNullable<typeof window.mcCore>;   // dmRenderMsg took this road only because the membrane read the line
    var line = el('div', 'dm-call-line' + (core.callLineMissed(body, mine) ? ' dm-call-missed' : ''));
    if (m.id) line.setAttribute('data-dmid', String(m.id));
    line.appendChild(el('span', 'dm-call-ico', mine ? '📞↗' : '📞↙'));
    line.appendChild(el('span', 'dm-call-text', core.callLineText(body, mine)));
    var t = el('span', 'dm-call-time', dmTimeLabel(m.created_at));
    t.title = fmtDateTime(m.created_at);
    line.appendChild(t);
    return line;
  }

  function dmArmMessage(m: any, node: any, ctx: any) {
    dmSavedPaint(m, node);
    if (m.redacted || !m.id) { node.mcDead = true; return; }
    if (ctx.byId) ctx.byId[String(m.id)] = m;
    dmReactPaint(m, node, ctx);
    dmArmGestures(m, node, ctx);
    node.mcReactPaint = function (emoji: any, by: any) { dmSetReaction(m, String(by || ctx.other || ''), String(emoji || '')); dmReactPaint(m, node, ctx); };
    node.mcSavedPaint = function (saved: any) { m.saved = saved ? 1 : 0; dmSavedPaint(m, node); };
  }

  /* Save an edit: the new plaintext re-wrapped around the quote it answered,
     sealed, posted; on success the bubble re-renders and gains "edited" (the
     other side is told live). One routine for the composer's Editing strip
     (the road since 2026-09-12) and the in-bubble box it replaced. */
  function dmSaveEdit(m: any, node: any, ctx: any, nv: string) {
    var sealed = dmReseal(dmWrapText(nv, m.reply), m, ctx);
    if (!sealed) return Promise.resolve({ ok: false, error: 'Could not seal the edit.' });
    return fetch(API + '/dm/edit', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ key: state.key, id: m.id, body: sealed.body, enc: sealed.enc }, ctx.target())) })
      .then(function (r) { return r.json(); }).then(function (d) {
        if (blockedOut(d)) return { ok: false, error: '' };
        if (!d || !d.ok) return { ok: false, error: (d && d.error) || 'Could not save.' };
        m.body = nv; m.edited_at = d.edited_at || Math.floor(Date.now() / 1000);
        var bodyEl = node.querySelector(':scope > .comment-body');
        if (bodyEl) { bodyEl.textContent = ''; fillBody(bodyEl, nv); }
        dmMarkEdited(node);
        return { ok: true, error: '' };
      });
  }

  function dmStartEdit(m: any, node: any, ctx: any) {
    /* Editing happens IN the composer (2026-09-12, WhatsApp's way): the text
       loaded into the field under an "Editing message" strip, Send become a
       ✓ — the composer is fixed on the keyboard by construction, so an edit
       can never hide behind it (the owner's screenshot: a box in the bubble,
       its Save row under the composer). The in-bubble box below stands only
       for a thread with no composer to edit in. */
    if (ctx && ctx.edit) { ctx.edit(m, node); return; }
    if (node.querySelector('.dm-edit-box')) return;
    var bodyEl = node.querySelector(':scope > .comment-body');
    var meta = node.querySelector(':scope > .dm-meta');
    if (bodyEl) bodyEl.style.display = 'none';
    if (meta) meta.style.display = 'none';
    var box = el('div', 'dm-edit-box');
    var ta = el('textarea', 'comment-text');
    ta.rows = 3;
    ta.maxLength = 4000;
    ta.value = m.body || '';
    box.appendChild(ta);
    var btns = el('div', 'comment-buttons');
    var save = el('button', 'btn btn-send', 'Save'); save.type = 'button';
    var cancel = el('button', 'btn', 'Cancel'); cancel.type = 'button';
    btns.appendChild(save); btns.appendChild(cancel);
    box.appendChild(btns);
    var st = el('p', 'form-status');
    box.appendChild(st);
    node.appendChild(box);
    ta.focus();
    function done() { box.remove(); if (bodyEl) bodyEl.style.display = ''; if (meta) meta.style.display = ''; }
    cancel.addEventListener('click', done);
    save.addEventListener('click', function () {
      var nv = ta.value.replace(/\s+$/, '');
      if (!nv.trim()) { ta.focus(); return; }
      if (nv === (m.body || '')) { done(); return; }
      save.disabled = true; st.textContent = 'Saving…';
      dmSaveEdit(m, node, ctx, nv).then(function (r) {
        if (r.ok) { done(); return; }
        st.textContent = r.error; save.disabled = false;
      }).catch(function () { st.textContent = 'Network error. Try again.'; save.disabled = false; });
    });
  }

  function dmMarkEdited(node: any) {
    var meta = node.querySelector(':scope > .dm-meta');
    if (meta && !meta.querySelector('.dm-edited')) meta.insertBefore(el('span', 'dm-edited', 'edited'), meta.firstChild);
  }

  /* Mutate a bubble in place into the "<redacted>" placeholder, stripping its
     body/media, its quote, its pill, and every control; a surface open over it
     closes. Used by my own delete and by the live redact from the other side. */
  function dmMakeRedacted(node: any, mine: any) {
    node.mcDead = true;
    node.classList.add('dm-redacted-msg');
    node.classList.remove('dm-saved'); node.classList.remove('dm-has-react');
    var body = node.querySelector(':scope > .comment-body');
    if (body) {
      body.textContent = '';
      body.className = 'comment-body';
      body.appendChild(el('span', 'dm-redacted', mine ? '<redacted> — you deleted this message' : '<redacted>'));
    }
    ['.dm-quote', '.dm-react-pill', '.dm-more', '.dm-edit-box', '.dm-receipt', '.dm-savedmark', '.dm-sys-label', '.dm-fwd'].forEach(function (sel) {
      var n = node.querySelector(sel); if (n) n.remove();
    });
    closeActsFor(node);
  }

  /* Copy a message's text (or a media caption) to the clipboard, with a word
     of feedback; the old execCommand road where the async clipboard is absent. */
  function dmCopy(text: any, ctx: any) {
    var str = String(text == null ? '' : text);
    var done = function () { if (ctx.note) ctx.note('Copied.'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(str).then(done, function () { if (ctx.note) ctx.note('Could not copy.'); });
      return;
    }
    var ta = el('textarea');
    ta.value = str; ta.setAttribute('readonly', '');
    ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { /* silent */ }
    ta.remove();
  }

  /* Delete (redact) one of my own messages: a "<redacted>" note stands in its
     place for both of us until it would have disappeared anyway. */
  function dmDeleteMsg(m: any, node: any, ctx: any) {
    appConfirm('Delete this message? A “<redacted>” note stands in its place for both of you until it would have disappeared anyway.', { okLabel: 'Delete', danger: true }, function (ok: any) {
      if (!ok) return;
      fetch(API + '/dm/redact', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.assign({ key: state.key, id: m.id }, ctx.target())) })
        .then(function (r) { return r.json(); }).then(function (d) {
          if (blockedOut(d)) return;
          if (d && d.ok) { m.redacted = 1; dmMakeRedacted(node, true); }
        }).catch(function () {});
    });
  }

  /* A text bubble: the shared frame around the rendered body (m.body is the
     plaintext dmRenderMsg decrypted; m.reply the envelope's quote, if any). */
  function dmMsgNode(m: any, ctx: any, sysLabel: any) {
    return dmBubble(m, fillBody(el('div', 'comment-body'), m.body), { sysLabel: sysLabel, reply: m.reply, ctx: ctx });
  }

  /* A deleted (redacted) message: the ciphertext is gone server-side, and both
     sides see a "<redacted>" placeholder standing in its place until the moment
     the message would have expired anyway. Built from text nodes only. */
  function dmRedactedNode(m: any) {
    var mine = m.sender_hash === state.myHash;
    var body = el('div', 'comment-body');
    body.appendChild(el('span', 'dm-redacted', mine ? '<redacted> — you deleted this message' : '<redacted>'));
    var node = dmBubble(m, body, null);
    node.classList.add('dm-redacted-msg');
    return node;
  }

  function bind() {
    API = B.API;
    appConfirm = B.appConfirm;
    armHold = B.armHold;
    blockedOut = B.blockedOut;
    bootSig = B.bootSig;
    closeActs = B.closeActs;
    closeActsFor = B.closeActsFor;
    displayName = B.displayName;
    el = B.el;
    fillBody = B.fillBody;
    fmtDateTime = B.fmtDateTime;
    reactPillInto = B.reactPillInto;
    loadingLine = B.loadingLine;
    mcDmBlobGet = B.mcDmBlobGet;
    mcDmBlobPut = B.mcDmBlobPut;
    notifCacheSet = B.notifCacheSet;
    mediaDownloadLink = B.mediaDownloadLink;
    openActs = B.openActs;
    reactionNode = B.reactionNode;
    state = B.state;
    truncate = B.truncate;
    DM_CACHE = B.DM_CACHE;
    dmAvatarCell = B.dmAvatarCell;
    dmB64uDec = B.dmB64uDec;
    dmB64uEnc = B.dmB64uEnc;
    dmForwardPicker = B.dmForwardPicker;
    dmPlain = B.dmPlain;
    dmReseal = B.dmReseal;
  }
  function run() { /* nothing of this module ran at the boot's top level */ }
  return { bind, run, exports: { dmDayNode, dmExpiryNode, dmFlash, dmMakeRedacted, dmMarkEdited, dmMediaEncryptFile, dmParseText, dmQuoteText, dmReadByInfo, dmRenderMsg, dmReplyClean, dmReplyRef, dmSaveEdit, dmSeenPing, dmTtlChoices, dmTtlLabel, dmWrapText, fmtBytes, playSound, swipeDismissesKeyboard } };
}
