/* Direct messages (Wave F, 2026-09-11 — moved out of comments.ts verbatim):
   the E2E crypto layer, E2E media, the bubbles and the press-and-hold
   surface, the reply envelope, the chat screen (viewDm), the inbox, presence,
   the live DM frame handlers, and calls. */
import type { Boot } from './boot';

export function installDm(B: Boot) {
  /* Names this module takes from the boot — the root's helpers and the other
     modules' exports — bound in bind() once every module is installed, so
     order of installation never matters and every body reads as it did. */
  let API: any;
  let CUSTOM_EMOJI: any;
  let MERECAT_BOT_HASH: any;
  let NACL_SRC: any;
  let appConfirm: (msg: any, opts: any, cb: any) => any;
  let armHold: (node: any, open: (at: any) => void, opts?: any) => any;
  let attachDraft: (ta: any, ctx: string, titleInput?: any, overwrite?: boolean) => any;
  let attachEmoji: (textarea: any) => any;
  let attachMentions: (textarea: any) => any;
  let badgeChanged: () => any;
  let blockedOut: (d: any) => any;
  let bootSig: any;
  let buildEmojiPanel: (textarea: any, onPick?: (it: any) => void) => any;
  let cachedJson: (url: any, init: any, ttl: any) => Promise<any>;
  let closeActs: () => any;
  let closeActsFor: (node: any) => any;
  let crumb: (parts: any) => any;
  let displayName: (hash: any) => any;
  let el: (tag: string, cls?: string | null, text?: string | number | null) => any;
  let emojiImg: (path: any, code: any) => any;
  let fetchRetry: (url: string, opts: RequestInit | undefined, delays: number[], onRetry?: () => void) => Promise<Response>;
  let fillBody: (node: HTMLElement, text: any, plain?: boolean) => any;
  let fmtDateTime: (epoch: any) => any;
  let fmtTimeCompact: (epoch: any) => any;
  let freshParam: (sep: any) => any;
  let getToken: () => Promise<any>;
  let go: (href: string, replace?: boolean) => any;
  let identityAction: (label: any, onClick: any) => any;
  let insertEmojiItem: (ta: any, it: any) => any;
  let loadingLine: (text: string, cls?: string) => any;
  let mcDmBlobGet: any;
  let mcDmBlobPut: any;
  let mcDmBlobs: any;
  let mcIcon: (name: any) => any;
  let mediaCfg: () => Promise<any>;
  let mediaDownloadLink: (url: any, filename: any, label: any, cls: any) => any;
  let mediaGateFile: (f: any, cfg: any, sec: any, statusEl: any) => any;
  let onLiveNotif: () => any;
  let openActs: (spec: any) => any;
  let pageBar: (total: number, per: number, curPage: number, hrefFor: ((n: number) => string) | null, onGo?: (n: number) => void) => HTMLElement | null;
  let profileHref: (hash: any) => any;
  let reactionNode: (emoji: any) => any;
  let readEase: any;
  let readMark: any;
  let readThrottled: any;
  let renderIdentity: () => any;
  let section: any;
  let setBlock: (hash: any, on: any, done?: any) => any;
  let skelInto: (node: any, kind?: string) => any;
  let skeleton: (kind?: string) => any;
  let state: any;
  let trace: (why: string) => any;
  let truncate: (s: any, n: any) => any;
  let utilBtnLabel: (btn: any, icon: string, word: string) => any;
  let voiceControl: (form: any, cfg: any, sec: any, statusEl: any, takeFile: any) => any;
  let warmOnFocus: (ta: any) => any;

  /* "Last seen" beside Offline (2026-09-11): just now / N min ago / today at
     3:09 PM / yesterday at 11:30 PM / Mon at 2:15 PM / Sep 8 — the WhatsApp
     ladder, in the reader's own zone. The moment comes from the hub's stamp;
     a member who chose appear-offline has none, and reads Offline alone. */
  function dmSeenLabel(epoch: any) {
    var t = Number(epoch) || 0;
    if (!t) return '';
    var now = Date.now() / 1000, age = now - t;
    if (age < 60) return 'just now';
    if (age < 3600) return Math.max(1, Math.floor(age / 60)) + ' min ago';
    var d = new Date(t * 1000), today = new Date();
    var time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    var yest = new Date(today); yest.setDate(today.getDate() - 1);
    if (d.toDateString() === today.toDateString()) return 'today at ' + time;
    if (d.toDateString() === yest.toDateString()) return 'yesterday at ' + time;
    if (age < 6 * 86400) return d.toLocaleDateString('en-US', { weekday: 'short' }) + ' at ' + time;
    if (d.getFullYear() === today.getFullYear()) return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  var _naclP: any = null;
  function ensureNacl(): Promise<any> {
    if (window.nacl) return Promise.resolve(window.nacl);
    if (_naclP) return _naclP;
    _naclP = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = NACL_SRC;
      s.async = true;
      s.onload = function () { if (window.nacl) resolve(window.nacl); else { _naclP = null; reject(new Error('nacl')); } };
      s.onerror = function () { _naclP = null; reject(new Error('nacl load failed')); };
      document.head.appendChild(s);
    });
    return _naclP;
  }
  function dmB64uEnc(bytes: any) {
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function dmB64uDec(str: any) {
    var s = String(str).replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    var bin = atob(s);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  /* Keypair from the identity secret, cached until the key changes. SHA-512 of a
     domain-separated copy of the secret gives a 32-byte curve25519 seed (the
     secret is already 256-bit uniform, so this is a clean PRF); tweetnacl clamps
     it internally when it computes the public half. */
  var _dmKP: any = null, _dmKPFor: any = null;
  function myDmKeypair() {
    if (_dmKP && _dmKPFor === state.key) return _dmKP;
    var seed = nacl.hash(new TextEncoder().encode('mc/dm/x25519/v1|' + state.key)).subarray(0, 32);
    _dmKP = nacl.box.keyPair.fromSecretKey(new Uint8Array(seed));
    _dmKPFor = state.key;
    return _dmKP;
  }
  function dmEncrypt(plaintext: any, otherPubB64: any) {
    var kp = myDmKeypair();
    var nonce = nacl.randomBytes(24);
    var ct = nacl.box(new TextEncoder().encode(plaintext), nonce, dmB64uDec(otherPubB64), kp.secretKey);
    return 'E1.' + dmB64uEnc(nonce) + '.' + dmB64uEnc(ct);
  }
  function dmDecrypt(blob: any, otherPubB64: any) {
    if (typeof blob !== 'string' || blob.slice(0, 3) !== 'E1.' || !otherPubB64) return null;
    var parts = blob.split('.');
    if (parts.length !== 3) return null;
    try {
      var pt = nacl.box.open(dmB64uDec(parts[2]), dmB64uDec(parts[1]), dmB64uDec(otherPubB64), myDmKeypair().secretKey);
      return pt ? new TextDecoder().decode(pt) : null;
    } catch (e) { return null; }
  }
  /* A per-conversation safety number: a short fingerprint of the two public keys,
     ordered the same way on both sides so both compute the identical code. Two
     people compare it out of band to be sure no key was substituted. */
  function dmSafetyNumber(otherPubB64: any) {
    try {
      var mineBytes = myDmKeypair().publicKey;
      var mineB64 = dmB64uEnc(mineBytes);
      var theirBytes = dmB64uDec(otherPubB64);
      var mineFirst = mineB64 < otherPubB64;
      var f = mineFirst ? mineBytes : theirBytes;
      var s = mineFirst ? theirBytes : mineBytes;
      var cat = new Uint8Array(f.length + s.length);
      cat.set(f, 0); cat.set(s, f.length);
      var h = nacl.hash(cat);
      var hex = '';
      for (var i = 0; i < 10; i++) hex += ('0' + h[i].toString(16)).slice(-2);
      return hex.toUpperCase().replace(/(.{4})/g, '$1 ').trim();
    } catch (e) { return ''; }
  }
  /* Which correspondents this browser has marked "safety number verified". */
  var DM_VERIFIED = 'mc-dm-verified';
  function dmVerifiedSet() { try { var a = JSON.parse(localStorage.getItem(DM_VERIFIED) as string); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
  function dmVerified(other: any) { return dmVerifiedSet().indexOf(other) !== -1; }
  function dmMarkVerified(other: any) {
    var a = dmVerifiedSet();
    if (a.indexOf(other) === -1) { a.push(other); try { localStorage.setItem(DM_VERIFIED, JSON.stringify(a)); } catch (e) {} }
  }
  /* The honest "how it works" note behind the badge — confident, scoped to what
     the design actually guarantees (stored ciphertext, keys never leave you). */
  function dmE2eExplainer() {
    appConfirm(
      'End-to-end encrypted. Your messages are encrypted on your own device before they are sent. '
      + 'We store them only as ciphertext, we do not hold the keys, and we cannot read your inbox — '
      + 'only you and the person you are writing to can open them. The encryption is standard, open '
      + 'X25519 + XSalsa20-Poly1305 (NaCl), and the code that runs it is public in our repository. '
      + 'To be sure no one is in the middle, compare the safety number at the top of a conversation. '
      + 'One thing to keep in mind: because only you hold your key, a lost key means the encrypted '
      + 'history cannot be recovered — not even by us.',
      { okLabel: 'Got it', cancelLabel: 'Close' }, function () {});
  }
  /* The tucked-away verify step: reveal the safety number and let the reader mark
     the pair confirmed (remembered locally, so it never nags again). */
  function dmVerifyPanel(other: any, otherPubB64: any, link: any) {
    appConfirm(
      'Safety number: ' + dmSafetyNumber(otherPubB64) + '.  '
      + 'Read this aloud with the person you are messaging. If it matches on both sides, no one is '
      + 'intercepting this conversation. This is optional — your messages are encrypted either way.',
      { okLabel: 'Mark verified', cancelLabel: 'Close' }, function (ok: any) {
        if (ok) { dmMarkVerified(other); if (link) link.textContent = '✓ verified'; }
      });
  }
  /* The quiet "🔒 End-to-end encrypted" badge, shared by the inbox and the thread
     view: the honest explainer one tap away, and — when a specific correspondent
     is in view — the optional safety-number verify. No PIN, no friction. */
  function dmE2eBadge(other?: any, otherPubB64?: any) {
    var e2e = el('p', 'dm-e2e');
    e2e.appendChild(document.createTextNode('🔒 End-to-end encrypted · '));
    var how = el('a', null, 'how it works');
    how.href = '#';
    how.addEventListener('click', function (ev: any) { ev.preventDefault(); dmE2eExplainer(); });
    e2e.appendChild(how);
    if (other && otherPubB64) {
      e2e.appendChild(document.createTextNode(' · '));
      var v = el('a', null, dmVerified(other) ? '✓ verified' : 'verify');
      v.href = '#';
      v.addEventListener('click', function (ev: any) { ev.preventDefault(); dmVerifyPanel(other, otherPubB64, v); });
      e2e.appendChild(v);
    }
    return e2e;
  }
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
  function dmExpiryNode(other: any, ttl: any, isNew: any, onChange?: (t: number) => void) {
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
            body: JSON.stringify({ key: state.key, with: other, ttl: opt[0] }) })
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
  /* ---- Per-message reactions and the saved mark (the WhatsApp press-and-hold
     surface, 2026-09-10). One emoji per side per message — the quick six from
     Domain.Dm, any single standard emoji, or one of our own custom-pack images
     (:pepeheart: and friends, the reaction WhatsApp cannot offer). A reaction is
     metadata beside opened_at (react_a/react_b on the canonical pair); the
     plaintext stays sealed. It renders as a small pill hanging off the bubble's
     bottom corner — the left corner of their bubble, the right of mine — both
     glyphs side by side when we both reacted, "❤️ 2" when we agreed. ---- */
  /* Paint (or repaint) a bubble's reaction pill from m.react_me / m.react_other.
     The pill opens the same surface a press-and-hold does, so a reaction is
     changed or withdrawn where it is seen. */
  function dmReactPaint(m: any, node: any, ctx: any) {
    var old = node.querySelector(':scope > .dm-react-pill');
    if (old) old.remove();
    var mine = String(m.react_me || ''), theirs = String(m.react_other || '');
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
    var was = String(m.react_me || '');
    var want = String(emoji || '');
    if (want === was) want = '';
    if (want && window.mcCore && window.mcCore.dmReaction && window.mcCore.dmReaction(want) === null) return;
    m.react_me = want; dmReactPaint(m, node, ctx);
    fetch(API + '/dm/react', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: state.key, with: ctx.other, id: m.id, emoji: want }) })
      .then(function (r) { return r.json(); })
      .then(function (d) { if (blockedOut(d)) return; if (!d || !d.ok) { m.react_me = was; dmReactPaint(m, node, ctx); } })
      .catch(function () { m.react_me = was; dmReactPaint(m, node, ctx); });
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
      body: JSON.stringify({ key: state.key, with: ctx.other, id: m.id, saved: !!want }) })
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
  /* ---- The message action surface (the WhatsApp press-and-hold, 2026-09-10).
     What a press-and-hold (touch), a right-click, the ⌄ that appears on hover,
     or a tap on a bubble's reaction pill opens over ONE bubble: the reaction
     bar above it — the quick six and a + for the whole picker, our own packs
     included — the bubble itself untouched and lit in a hole between four
     pieces of scrim, and the menu below it: Reply · Copy · Edit · Save/Unsave ·
     Delete, only the acts that apply to that message. On a phone the page is
     first scrolled just enough for the three to fit, then the document is
     locked (the sheet's own lock, mcSheet.lock) for exactly as long as the
     surface stands, and the scrim is inert to touch — the three layers every
     overlay here keeps. On desktop it is a popover at the pointer that an
     outside click, a scroll, or Escape dismisses. One at a time; a soft
     navigation tears it down with the boot. ---- */
  /* ---- The message surface (2026-09-10; the shared surface since
     2026-09-12, client/surface.ts openActs): a press-and-hold over one bubble
     — the reaction bar above, the bubble lit in a hole between four pieces of
     scrim, the acts below; a popover at the pointer on desktop. What is DM
     here: my reaction on the message (react_me, one per side), and the acts
     that apply — Reply · Copy (text, or a media caption) · Edit (mine, text,
     not a system notice) · Save/Unsave (★ lit when saved) · Delete (mine).
     No Forward, Star or More (the owner's ruling). A redacted bubble opens
     nothing. ---- */
  function dmCloseActions() { closeActs(); }
  function dmOpenActions(m: any, node: any, ctx: any, at: any) {
    if (!m || !m.id || m.redacted || node.mcDead || !node.isConnected) { closeActs(); return; }
    var mine = m.sender_hash === state.myHash;
    var sys = Number(m.enc || 0) === 2;
    var hasText = !m.media_key && !m.media_expired;
    var items: any[] = [];
    items.push({ label: 'Reply', icon: '↩', fn: function () { ctx.reply(m); } });
    var copyText = hasText ? String(m.body || '') : String((m._env && m._env.caption) || '');
    if (copyText) items.push({ label: 'Copy', icon: '⧉', fn: function () { dmCopy(copyText, ctx); } });
    if (mine && hasText && !sys) items.push({ label: 'Edit', icon: '✎', fn: function () { dmStartEdit(m, node, ctx); } });
    var saved = !!Number(m.saved || 0);
    items.push({ label: saved ? 'Unsave' : 'Save', icon: saved ? '★' : '☆', cls: saved ? 'on' : '', fn: function () { dmSave(m, node, ctx, saved ? 0 : 1); } });
    if (mine && !sys) items.push({ label: 'Delete', icon: '✕', cls: 'dm-act-danger', fn: function () { dmDeleteMsg(m, node, ctx); } });
    openActs({ node: node, at: at, mine: mine,
      react: { current: String(m.react_me || ''), onPick: function (e: any) { dmReact(m, node, ctx, e); } },
      items: items });
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
    if (opts && opts.sysLabel) node.appendChild(el('div', 'dm-sys-label', opts.sysLabel));
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
    q.appendChild(el('span', 'dm-quote-who', String(reply.from || '') === state.myHash ? 'You' : (ctx.shortName || 'Them')));
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
     {v:1, text, reply:{id, from, kind, text}}. Plaintext without the sentinel
     is the bare message it always was. A media message carries its reply in
     the media envelope instead (env.reply). ---- */
  function dmReplySentinel() {
    return (window.mcCore && window.mcCore.dmReplySentinel) || '';
  }
  function dmWrapText(text: any, reply: any) {
    var t = String(text == null ? '' : text);
    if (!reply) return t;
    return dmReplySentinel() + JSON.stringify({ v: 1, text: t, reply: reply });
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
      if (o && typeof o === 'object') return { text: String(o.text == null ? '' : o.text), reply: dmReplyClean(o.reply) };
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
  function dmSeenPing(other: any) {
    clearTimeout(dmSeenT);
    dmSeenT = setTimeout(function () {
      try { localStorage.removeItem(DM_CACHE); } catch (e) { /* fine */ }
      fetch(API + '/dm/seen', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: state.key, with: other }) }).catch(function () { /* next open settles it */ });
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
        if (!envInfo && e === 1) { try { envInfo = JSON.parse(dmDecrypt(m.body, ctx.otherPub) || 'null'); } catch (x) { envInfo = null; } }
        if (envInfo) { m._env = envInfo; m.reply = dmReplyClean(envInfo.reply); node = dmMediaNode(m, ctx, envInfo); }
        else { m.body = '⚠️ could not open media'; node = dmMsgNode(m, ctx, null); }
      } else if (m.media_expired) {
        var cap = '';
        if (e === 1) {
          try { var ev = JSON.parse(dmDecrypt(m.body, ctx.otherPub) || 'null'); if (ev) { m._env = ev; m.reply = dmReplyClean(ev.reply); cap = ev.caption || ''; } } catch (x2) { cap = ''; }
        }
        node = dmMediaExpiredNode(m, ctx, cap);
      } else {
        var sysLabel = null;
        if (e === 1) { var pt = dmParseText(dmDecrypt(m.body, ctx.otherPub) || '⚠️ could not decrypt'); m.body = pt.text; m.reply = pt.reply; }
        else if (e === 2) sysLabel = '⚙️ Automated notice';
        node = dmMsgNode(m, ctx, sysLabel);
      }
    }
    dmArmMessage(m, node, ctx);
    return node;
  }
  function dmArmMessage(m: any, node: any, ctx: any) {
    dmSavedPaint(m, node);
    if (m.redacted || !m.id) { node.mcDead = true; return; }
    if (ctx.byId) ctx.byId[String(m.id)] = m;
    dmReactPaint(m, node, ctx);
    dmArmGestures(m, node, ctx);
    node.mcReactPaint = function (emoji: any) { m.react_other = String(emoji || ''); dmReactPaint(m, node, ctx); };
    node.mcSavedPaint = function (saved: any) { m.saved = saved ? 1 : 0; dmSavedPaint(m, node); };
  }
  /* Turn a live text bubble into an in-place editor. Saving re-encrypts — the
     reply envelope re-wrapped around the new text — and posts /dm/edit; on
     success the body re-renders and the meta row gains "edited" (the other
     side is told live). m.body is the plaintext dmRenderMsg decrypted. */
  function dmStartEdit(m: any, node: any, ctx: any) {
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
      fetch(API + '/dm/edit', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: state.key, with: ctx.other, id: m.id, body: dmEncrypt(dmWrapText(nv, m.reply), ctx.otherPub), enc: 1 }) })
        .then(function (r) { return r.json(); }).then(function (d) {
          if (blockedOut(d)) return;
          if (!d || !d.ok) { st.textContent = (d && d.error) || 'Could not save.'; save.disabled = false; return; }
          m.body = nv; m.edited_at = d.edited_at || Math.floor(Date.now() / 1000);
          if (bodyEl) { bodyEl.textContent = ''; fillBody(bodyEl, nv); }
          dmMarkEdited(node);
          done();
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
    ['.dm-quote', '.dm-react-pill', '.dm-more', '.dm-edit-box', '.dm-receipt', '.dm-savedmark', '.dm-sys-label'].forEach(function (sel) {
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
        body: JSON.stringify({ key: state.key, with: ctx.other, id: m.id }) })
        .then(function (r) { return r.json(); }).then(function (d) {
          if (blockedOut(d)) return;
          if (d && d.ok) { m.redacted = 1; dmMakeRedacted(node, true); }
        }).catch(function () {});
    });
  }
  /* One injected style block for the disappearing/media/settings UI — kept out of
     the shared stylesheets (like the emoji CSS) so it never collides. */
  function ensureDmStyles() {
    if (document.getElementById('mc-dm-css')) return;
    var css = '' +
      '.dm-expiry{font-size:0.85em;opacity:0.72;margin:0.15em 0 0.5em}' +
      '.dm-expiry a{cursor:pointer}' +
      /* The WhatsApp-shaped bubble (2026-09-10): a meta row at the foot, the
         saved ring, the quote block, the reaction pill hanging off the corner,
         the hover ⌄, the day chips, and the press-and-hold surface. The bubble's
         base card (border, fill, radius, position:relative) is main.css's. */
      '.dm-msg{--dm-saved:#d9a520;transition:transform .18s ease}' +
      '.dm-sys-label{font-size:.78em;color:var(--faint);margin-bottom:.2em}' +
      '.dm-meta{display:flex;justify-content:flex-end;align-items:center;gap:.45em;margin-top:.2em;font-size:.72em;line-height:1.2;color:var(--faint);white-space:nowrap}' +
      '.dm-meta .comment-date{font-size:1em;color:inherit;margin:0}' +
      '.dm-edited{font-style:italic;opacity:.85}' +
      '.dm-receipt{opacity:.85;letter-spacing:-.08em}' +
      '.dm-receipt-seen{color:var(--maroon,#8b1a1a);opacity:1}' +
      /* The saved mark, settled after two looks (2026-09-11): the ring shouted
         and a faint-ink star whispered — a gold star in the meta row and the
         bubble's own 1px border tinted the same gold; no ring, no shadow. */
      '.dm-savedmark{color:var(--dm-saved);font-size:1.05em;line-height:1}' +
      '.dm-msg.dm-saved{border-color:color-mix(in srgb,var(--dm-saved) 70%,var(--rule))}' +
      /* An element toggled by its hidden attribute must not be revived by its
         own display rule (author display beats the UA's [hidden]). */
      '.dm-reply-bar[hidden],.dm-act-bar[hidden],.dm-act-menu[hidden],.dm-c-btn[hidden],.dm-c-send[hidden],.dm-attach-chip[hidden]{display:none!important}' +
      '.dm-quote{display:block;border-left:3px solid var(--maroon,#8b1a1a);background:color-mix(in srgb,var(--ink,#000) 7%,transparent);border-radius:6px;padding:.3em .6em;margin:0 0 .35em;cursor:pointer;font-size:.9em;max-width:100%;overflow:hidden}' +
      '.dm-quote:focus-visible{outline:2px solid var(--maroon,#8b1a1a);outline-offset:1px}' +
      '.dm-quote-who{display:block;font-weight:600;color:var(--maroon,#8b1a1a);font-size:.85em}' +
      '.dm-quote-text{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;color:var(--ink-soft,#333);opacity:.85;white-space:normal;overflow-wrap:anywhere}' +
      '.dm-flash{animation:dm-flash 1.2s ease}' +
      '@keyframes dm-flash{0%,55%{box-shadow:0 0 0 3px color-mix(in srgb,var(--maroon,#8b1a1a) 60%,transparent)}100%{box-shadow:none}}' +
      '.dm-react-pill{position:absolute;bottom:-.9em;right:.6em;display:inline-flex;align-items:center;gap:.15em;font:inherit;font-size:.82em;line-height:1;padding:.2em .45em;border:1px solid var(--rule);border-radius:999px;background:var(--surface,#fff);color:var(--ink);box-shadow:var(--shadow-1);cursor:pointer;z-index:1}' +
      '.dm-msg:not(.dm-mine) .dm-react-pill{right:auto;left:.6em}' +
      '.dm-react-pill .mc-emoji{height:1.25em;vertical-align:-.2em;margin:0}' +
      '.dm-react-n{font-size:.85em;color:var(--faint);margin-left:.1em}' +
      '.dm-msg.dm-has-react{margin-bottom:1.3rem}' +
      '.dm-more{position:absolute;top:.2em;right:.3em;font:inherit;line-height:1;background:var(--surface,#fff);border:1px solid var(--rule);border-radius:999px;width:1.5em;height:1.5em;padding:0 0 .15em;cursor:pointer;color:var(--faint);opacity:0;transition:opacity .12s;z-index:1}' +
      '.dm-msg:hover .dm-more,.dm-more:focus-visible{opacity:1}' +
      '.dm-day{width:max-content;max-width:90%;margin:.9em auto .35em;font-size:.72em;color:var(--faint);background:var(--surface,#fff);border:1px solid var(--rule);border-radius:999px;padding:.15em .75em;text-align:center}' +
      /* reading back (2026-09-11): the unread line, the jump button with its count, the typing bubble */
      '.dm-unread-line{display:flex;align-items:center;gap:.6em;margin:.9em 0 .5em;font-size:.72em;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--maroon,#8b1a1a)}' +
      '.dm-unread-line::before,.dm-unread-line::after{content:"";flex:1;border-top:1px solid color-mix(in srgb,var(--maroon,#8b1a1a) 45%,transparent)}' +
      '.dm-jump{position:absolute;right:.7rem;bottom:calc(100% + .6rem);width:2.6rem;height:2.6rem;display:flex;align-items:center;justify-content:center;border-radius:999px;background:var(--surface,#fff);color:var(--ink);border:1px solid var(--rule);box-shadow:var(--shadow-2);font:inherit;font-size:1.5rem;line-height:1;cursor:pointer;padding:0 0 .3rem;z-index:1}' +
      '.dm-jump[hidden]{display:none}' +
      '.dm-jump-n{position:absolute;top:-.5rem;right:-.35rem;min-width:1.35rem;height:1.35rem;padding:0 .35rem;border-radius:999px;background:var(--maroon,#8b1a1a);color:#fff;font-size:.72rem;font-weight:700;line-height:1.35rem;text-align:center}' +
      '.dm-jump-n[hidden]{display:none}' +
      '.dm-typing-bubble{display:inline-flex;gap:.3em;align-items:center;padding:.75em .95em;width:max-content}' +
      '.dm-typing-dot{width:.5em;height:.5em;border-radius:50%;background:var(--faint);animation:dm-typing 1.2s infinite ease-in-out}' +
      '.dm-typing-dot:nth-child(2){animation-delay:.2s}.dm-typing-dot:nth-child(3){animation-delay:.4s}' +
      '@keyframes dm-typing{0%,80%,100%{opacity:.35;transform:translateY(0)}40%{opacity:1;transform:translateY(-.25em)}}' +
      '.dm-sub-typing{animation:dm-typing-pulse 1.2s infinite ease-in-out}@keyframes dm-typing-pulse{50%{opacity:.55}}' +
      '@media (hover:none){.dm-more{display:none}.dm-screen{-webkit-touch-callout:none;-webkit-user-select:none;user-select:none}.dm-screen textarea,.dm-screen input{-webkit-user-select:text;user-select:text}.dm-msg{-webkit-touch-callout:none;-webkit-user-select:none;user-select:none;touch-action:pan-y pinch-zoom}.dm-msg textarea{-webkit-user-select:text;user-select:text}}' +
      /* the reply strip above the composer */
      '.dm-reply-bar{display:flex;align-items:center;gap:.5em;margin:0 0 .4em;padding:.35em .5em .35em .7em;border-left:3px solid var(--maroon,#8b1a1a);background:color-mix(in srgb,var(--ink,#000) 6%,transparent);border-radius:8px}' +
      '.dm-reply-body{flex:1;min-width:0;font-size:.9em}' +
      '.dm-reply-body .dm-quote-text{-webkit-line-clamp:2}' +
      '.dm-reply-x{flex:none;font:inherit;background:none;border:0;cursor:pointer;color:var(--faint);font-size:1.1em;padding:.2em .45em;border-radius:6px}' +
      '.dm-reply-x:hover{color:var(--maroon,#8b1a1a)}' +
      /* the chat screen: a sticky header over the words, a sticky composer under them */
      '.dm-head{position:sticky;top:0;z-index:38;display:flex;align-items:center;gap:.65rem;padding:.45rem 0;margin:0 0 .3rem;background:var(--surface,#fff);border-bottom:1px solid var(--rule)}' +
      'body.mc-app .dm-head{top:var(--mc-deskbar-h,0px)}' +
      '.dm-head-avatar{flex:none;width:2.5rem;height:2.5rem;border-radius:50%;overflow:hidden;background:var(--cream-2,#faf6ee);display:inline-flex;align-items:center;justify-content:center;color:var(--maroon,#8b1a1a);font-weight:700;text-decoration:none}' +
      '.dm-head-img{width:100%;height:100%;object-fit:cover;display:block;margin:0}' +
      '.dm-head-text{flex:1;min-width:0;display:flex;flex-direction:column;align-items:flex-start;gap:.12em;background:none;border:0;padding:0;font:inherit;color:inherit;text-align:left;cursor:pointer}' +
      '.dm-head-name{font-weight:600;font-size:1.02rem;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}' +
      '.dm-head-sub{font-size:.8rem;color:var(--faint);display:inline-flex;align-items:center;gap:.3em;white-space:nowrap;max-width:100%;overflow:hidden}' +
      '.dm-head-sub .dm-dot{margin-right:0}' +
      '.dm-sub-typing{color:#3ba55d;font-style:italic}' +
      '.dm-head-acts{flex:none;display:inline-flex;gap:.1rem}' +
      '.dm-head-btn,.dm-c-btn,.dm-c-send,.dm-c-emoji{font:inherit;line-height:1;background:none;border:0;cursor:pointer;color:var(--maroon,#8b1a1a);width:2.6rem;height:2.6rem;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;padding:0;flex:none}' +
      '.dm-head-btn:hover,.dm-c-btn:hover,.dm-c-emoji:hover{background:color-mix(in srgb,var(--maroon,#8b1a1a) 8%,transparent)}' +
      '.dm-head-btn .mc-ic,.dm-c-btn .mc-ic,.dm-c-send .mc-ic{width:1.45rem;height:1.45rem;vertical-align:0}' +
      '.dm-c-emoji .mc-ic{width:1.35rem;height:1.35rem;vertical-align:0}' +
      '.dm-note{display:block;width:max-content;max-width:92%;margin:.6em auto .4em;font:inherit;font-size:.74em;color:var(--faint);background:var(--surface,#fff);border:1px solid var(--rule);border-radius:999px;padding:.25em .8em;text-align:center;cursor:pointer}' +
      /* FIXED, never sticky: a thread opens at the document's end, where a
         sticky bar sits in its natural place — above the body's tab-bar
         reservation and the footer — and floated a gap over the tab bar until
         a scroll re-stuck it (the owner's report, 2026-09-11). The spacer
         reserves its height under the last bubble; on desktop the view aligns
         it to the content column by measurement. */
      '.dm-composer{position:fixed;left:0;right:0;bottom:0;z-index:37;margin:0;padding:.45rem 0 .3rem;background:var(--bg,#fff);border-top:1px solid var(--rule)}' +
      '.dm-c-space{height:0}' +
      '.dm-c-row{display:flex;align-items:flex-end;gap:.3rem}' +
      '.dm-c-field{flex:1;min-width:0;display:flex;align-items:flex-end;background:var(--surface,#fff);border:1px solid var(--rule);border-radius:22px;padding:.15rem .15rem .15rem .9rem}' +
      '.dm-c-field:focus-within{border-color:var(--maroon,#8b1a1a)}' +
      '.dm-c-ta{flex:1;min-width:0;width:auto;border:0;background:none;padding:.55rem 0;margin:0;font:inherit;color:var(--ink);resize:none;line-height:1.35;max-height:168px;outline:none;border-radius:0;box-shadow:none}' +
      '.dm-c-ta:disabled{color:var(--faint)}' +
      '.dm-c-emoji{width:2.3rem;height:2.3rem;color:var(--faint)}' +
      '.dm-c-send{background:var(--accent-fill,#8b1a1a);color:var(--accent-on,#fff)}' +
      '.dm-c-send:hover{filter:brightness(1.07)}' +
      '.dm-c-send.dm-c-idle{opacity:.45}' +
      '.dm-c-send:disabled{opacity:.4;cursor:not-allowed;filter:none}' +
      '.dm-c-emoji-panel{margin:0 0 .4rem}' +
      '.dm-c-status{margin:.2rem .2rem 0;font-size:.85rem;min-height:0}' +
      '.dm-c-status:empty{display:none}' +
      '.dm-composer .dm-attach-chip{margin:.1rem 0 .35rem}' +
      '.dm-composer .mc-rec-row{margin:.4rem 0 .1rem}' +
      '@media (max-width:600px){' +
        'body.mc-app .dm-head{top:calc(var(--mc-appbar-h,3rem) + env(safe-area-inset-top,0px));margin-left:calc(-1 * var(--page-pad,.8rem));margin-right:calc(-1 * var(--page-pad,.8rem));padding-left:var(--page-pad,.8rem);padding-right:var(--page-pad,.8rem)}' +
        'body.mc-app .dm-head-name{display:none}' +   /* the app bar carries the name on phones */
        '.dm-composer{padding-left:var(--page-pad,.8rem);padding-right:var(--page-pad,.8rem)}' +
        'body.mc-app .dm-composer{bottom:calc(var(--mc-tabbar-h,3.6rem) + env(safe-area-inset-bottom,0px))}' +
        'body.mc-app.mc-kb-open .dm-composer{bottom:var(--mc-kb,0px);transition:bottom .18s ease}' +
        '.dm-c-ta{font-size:16px}' +   /* zoom-proof, as every phone text control here */
      '}' +
      /* conversation info (the ⓘ sheet) */
      '.dm-info-card{text-align:center;padding:.4rem 0 .9rem}' +
      '.dm-info-avatar{width:4.5rem;height:4.5rem;border-radius:50%;margin:0 auto .5rem;overflow:hidden;background:var(--cream-2,#faf6ee);display:flex;align-items:center;justify-content:center;font-size:1.8rem;font-weight:700;color:var(--maroon,#8b1a1a)}' +
      '.dm-info-avatar .dm-head-img{width:100%;height:100%}' +
      '.dm-info-name{font-weight:600;font-size:1.1rem}' +
      '.dm-info-link{font-size:.9rem}' +
      '.dm-info-row{padding:.75rem 0;border-top:1px solid var(--rule)}' +
      '.dm-info-row-title{font-weight:600;margin-bottom:.3rem}' +
      '.dm-info-row-text{margin:0;font-size:.92rem;color:var(--ink-soft,#333)}' +
      '.dm-info-row .dm-expiry{margin:0;font-size:.92rem;opacity:.9}' +
      '.dm-info-danger .identity-action{display:block;padding:.45rem 0;color:var(--maroon,#8b1a1a)}' +
      '.dm-info-inline{margin:0 0 .8rem;padding:0 .2rem;border-bottom:1px solid var(--rule)}' +
      '.dm-attach-chip{display:inline-block;font-size:0.85em;opacity:0.85;margin:0.3em 0}' +
      '.btn-attach{margin-left:6px}' +
      '.dm-media{margin:0.1em 0}' +
      '.dm-media-status{opacity:0.6;font-size:0.9em}' +
      '.dm-media-img,.dm-media-vid{max-width:100%;max-height:60vh;border-radius:8px;display:block}' +
      '.dm-media-aud{width:100%;max-width:320px}' +
      '.dm-media-caption{margin-top:0.35em}' +
      '.dm-media-expired{display:flex;align-items:center;gap:8px;padding:12px 14px;border:1px dashed var(--rule,#cbb);border-radius:10px;opacity:0.78}' +
      '.dm-media-expired-icon{font-size:1.25em;filter:grayscale(1);opacity:0.7}' +
      '.dm-media-expired-text{font-size:0.9em;font-style:italic;opacity:0.85}' +
      '.dm-dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:7px;vertical-align:middle;background:#c8c8c8}' +
      '.dm-dot-on{background:#3ba55d;box-shadow:0 0 0 2px rgba(59,165,93,0.22)}' +
      '.dm-dot-off{background:#c0c0c0}.dm-dot-unknown{background:#dcdcdc}' +
      '.dm-typing{font-size:0.85em;opacity:0.7;font-style:italic;margin:0.25em 0.2em}' +
      '.profile-presence{display:flex;align-items:center;gap:.35em;font-size:.86rem;color:var(--faint);margin:.1rem 0 .2rem}' +
      '.profile-presence .dm-dot{margin-right:0}' +
      '.mc-inbox-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;vertical-align:middle;background:#3ba55d}' +
      '.wall-media{margin:0.45em 0}' +
      '.wall-media-el{max-width:100%;max-height:62vh;border-radius:8px;display:block}' +
      '.wall-post-detail .wall-media-el{max-height:85vh}' +
      '.wall-share{position:relative;display:inline-flex;align-items:center}.wall-share-menu{display:inline-flex;flex-wrap:wrap;gap:0.7em;margin-left:0.7em}' +
      '.wall-media-gone{opacity:0.6;font-size:0.9em;font-style:italic}' +
      '.wall-foot{margin-top:0.45em;font-size:0.9em}' +
      '.wall-comments-toggle{cursor:pointer;opacity:0.78}.wall-comments-toggle:hover{opacity:1}' +
      '.wall-comments{margin:0.55em 0 0.2em 0.9em;border-left:2px solid var(--rule,#e6e0d5);padding-left:0.85em}' +
      '.wall-comment{margin:0.45em 0}' +
      '.wall-newpill{display:inline-block;margin:0.4em 0;padding:0.3em 0.85em;border-radius:14px;background:var(--maroon,#8b1a1a);color:#fff;font-size:0.85em;cursor:pointer;text-decoration:none}' +
      '.wall-composer{margin:0.6em 0 1.1em}.wall-del{color:var(--maroon,#8b1a1a);opacity:0.7}' +
      '.wall-sentinel{height:1px}' +
      '.dm-redacted{font-style:italic;opacity:0.6}' +
      '.dm-redacted-msg .comment-body{opacity:0.9}' +
      '.dm-edit-box textarea{width:100%;box-sizing:border-box}' +
      '.dm-edit-box{margin-top:3px}' +
      '.admin-set-row{margin:0.6em 0}' +
      '.admin-set-row input[type=number]{width:6em}' +
      '.mc-media-row{margin:0.5em 0}' +
      '.mc-media-note{font-size:0.85em;opacity:0.75;margin-left:8px}' +
      '.mc-rec-row{display:flex;align-items:center;gap:10px;margin:0.5em 0;flex-wrap:wrap}' +
      '.mc-rec-dot{width:10px;height:10px;border-radius:50%;background:#c0392b;animation:mc-rec-pulse 1.1s ease-in-out infinite}' +
      '@keyframes mc-rec-pulse{0%,100%{opacity:1}50%{opacity:0.25}}' +
      '.mc-rec-time{font-variant-numeric:tabular-nums;font-size:0.9em;opacity:0.85}' +
      '.mc-rec-audio{max-width:280px}';
    var st = el('style');
    st.id = 'mc-dm-css';
    st.textContent = css;
    document.head.appendChild(st);
  }

  /* ---- Unread badge. One localStorage-cached count, refreshed from the
     server at most every ninety seconds, so idle page turns cost nothing.
     Inbox and thread responses refresh the cache for free. ---- */

  var DM_CACHE = 'mc-dm-unread';

  function dmCacheGet() {
    try { return JSON.parse(localStorage.getItem(DM_CACHE) as string) || null; } catch (e) { return null; }
  }
  function dmCacheSet(n: any) {
    try { localStorage.setItem(DM_CACHE, JSON.stringify({ n: n, at: Date.now() })) } catch (e) {}
    renderIdentity();
    badgeChanged();
  }

  function dmUnreadCheck(force?: boolean) {
    if (!state.key) return;
    var c = dmCacheGet();
    if (!force && c && Date.now() - c.at < 90000) return;
    /* Stamp first, so parallel page loads inside the window stay quiet. */
    try { localStorage.setItem(DM_CACHE, JSON.stringify({ n: c ? c.n : 0, at: Date.now() })) } catch (e) {}
    readMark();
    fetch(API + '/dm/unread', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: state.key }),
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (blockedOut(d)) return;
      if (readThrottled(d)) readEase();
      if (d.ok) dmCacheSet(d.unread);
    }).catch(function () {});
  }

  /* ---- Live DMs and notifications (window.mcLive private user scope) ----
     A signed-in member authenticates the board socket and subscribes to its own
     user:<hash> scope; the worker pushes that member's DMs and notifications
     instantly. Here we turn those pushes into the badge tick, the open DM thread
     drop-in, and (for the Lit lists) a self-refresh. No push ⇒ the 90-second
     poll below is the fallback, exactly as before. */
  var dmBadgeT = 0; B.notifBadgeT = 0;
  /* Refresh a badge from the server, debounced so a burst of events (and the
     shared read budget) coalesce into one fresh read. */
  /* Both are reached ONLY from live socket events (never the 90s polls or page
     boot), so the bell sound obeys the "already on the site" rule for free. */
  function liveDmBadge() { playSound('bell'); clearTimeout(dmBadgeT); dmBadgeT = setTimeout(function () { dmUnreadCheck(true); }, 300); }

  function onLiveDm(m: any) {
    var openDm = new URLSearchParams(location.search).get('dm');
    if (state.dmView && openDm && openDm === m.from && m.message) {
      state.dmView.append(m.message);   // instant in the open conversation
    } else {
      liveDmBadge();   // a background thread — ring the badge (McInbox self-refreshes if open)
    }
  }
  /* The other party changed the disappearing-message lifetime: update the open
     conversation's expiry note live so both sides always show the same setting. */
  function onLiveDmTtl(m: any) {
    var openDm = new URLSearchParams(location.search).get('dm');
    if (state.dmView && openDm && openDm === m.from && state.dmView.setTtl) state.dmView.setTtl(m.ttl);
  }
  /* The other party edited a message they sent me: re-render that bubble live. */
  function onLiveDmEdit(m: any) {
    var openDm = new URLSearchParams(location.search).get('dm');
    if (state.dmView && openDm && openDm === m.from && m.message && state.dmView.editMsg) state.dmView.editMsg(m.message);
  }
  /* The other party deleted a message they sent me: replace it with "<redacted>". */
  function onLiveDmRedact(m: any) {
    var openDm = new URLSearchParams(location.search).get('dm');
    if (state.dmView && openDm && openDm === m.from && m.message && state.dmView.redactMsg) state.dmView.redactMsg(m.message.id);
  }
  /* The other party reacted (or withdrew a reaction) on a message in the open
     conversation: repaint that bubble's pill. Quiet by design — no badge, no sound. */
  function onLiveDmReact(m: any) {
    var openDm = new URLSearchParams(location.search).get('dm');
    if (state.dmView && openDm && openDm === m.from && m.message && state.dmView.reactMsg) state.dmView.reactMsg(m.message);
  }
  /* The other party saved (or unsaved) a message in the open conversation: a
     save is for both, so the bubble lights (or dims) here too. */
  function onLiveDmSave(m: any) {
    var openDm = new URLSearchParams(location.search).get('dm');
    if (state.dmView && openDm && openDm === m.from && m.message && state.dmView.saveMsg) state.dmView.saveMsg(m.message);
  }
  /* The recipient opened my messages: flip the open conversation's sent bubbles
     to "Seen" up to their read timestamp. m.reader is the other party. */
  function onLiveDmRead(m: any) {
    var openDm = new URLSearchParams(location.search).get('dm');
    if (state.dmView && openDm && openDm === m.reader && state.dmView.markRead) state.dmView.markRead(m.at);
  }
  /* The other party is (or stopped) typing — show/hide the "…typing" line in the
     open conversation only. */
  function onLiveTyping(m: any) {
    var openDm = new URLSearchParams(location.search).get('dm');
    if (state.dmView && openDm && openDm === m.from && state.dmView.setTyping) state.dmView.setTyping(m.state !== 'stop');
    if (state.inboxTyping) state.inboxTyping(m.from, m.state !== 'stop');
  }
  /* A member's online state changed: update the open thread's header dot and any
     inbox row dot. */
  function onLivePresence(m: any) {
    if (state.dmView && state.dmView.other === m.hash && state.dmView.setPresence) state.dmView.setPresence(!!m.online);
    if (state.inboxPresence) state.inboxPresence(m.hash, !!m.online);
    if (state.profilePresence) state.profilePresence(m.hash, !!m.online);
  }
  function callsCfg(): Promise<{ enabled: boolean }> {
    return cachedJson(API + '/config', undefined, 300000)
      .then(function (d: any) { return { enabled: !(d && d.ok && d.calls && d.calls.enabled === false) }; })
      .catch(function () { return { enabled: true }; });   // server refuses regardless
  }
  function placeCall(other: string, label: string) {
    var mc: any = (window as any).mcCall;
    if (mc && mc.place) mc.place(other, label);
  }
  function callButton(other: string, label: string) {
    var b = utilBtnLabel(el('button', 'btn btn-attach mc-call-btn'), '📞', 'Call');
    b.type = 'button';
    b.title = 'Voice call (end-to-end encrypted)';
    b.addEventListener('click', function () { placeCall(other, label); });
    return b;
  }

  /* ---- Direct messages ---- */

  function dmLabel(hash: any, nick: any) {
    var assigned = displayName(hash);
    return nick ? nick + ' (' + assigned + ')' : assigned;
  }

  /* Fuzzy score of one candidate string against the lowercased query:
     whole-prefix beats word-prefix beats substring beats subsequence. */
  function dmScore(q: any, name: any) {
    if (!name) return 0;
    var n = String(name).toLowerCase();
    if (n.indexOf(q) === 0) return 100;
    var words = n.split(/[\s-]+/);
    for (var i = 0; i < words.length; i++) if (words[i].indexOf(q) === 0) return 80;
    if (n.indexOf(q) !== -1) return 60;
    var j = 0;
    for (var k = 0; k < n.length && j < q.length; k++) if (n[k] === q[j]) j++;
    return j === q.length ? 30 : 0;
  }

  /* The Send-a-DM box with autocomplete. The member directory is fetched
     once per session at the third character; every keystroke after that is
     scored locally and costs no request. */
  function dmSearchBox() {
    var box = el('div', 'key-box dm-search');
    box.hidden = false;
    box.appendChild(el('p', 'key-note', 'Send a direct message. Type a nickname or an assigned name, then click the member below to open the conversation.'));
    var row = el('div', 'key-row');
    var input = el('input', 'key-input');
    input.type = 'text';
    input.placeholder = 'e.g. Constant-Almond, or a nickname';
    row.appendChild(input);
    box.appendChild(row);
    var sug = el('div', 'dm-suggest');
    sug.hidden = true;
    box.appendChild(sug);
    var note = el('p', 'form-status');
    box.appendChild(note);
    var dir: any = null;
    var loading = false;
    var current: any[] = [];
    var sel = 0;
    var timer: any = null;
    function ensureDir(cb: any) {
      if (dir) return cb();
      if (loading) return;
      loading = true;
      fetch(API + '/dm/directory' + freshParam('?'))
        .then(function (r) { return r.json(); })
        .then(function (d) { loading = false; if (d.ok) { dir = d.users; cb(); } })
        .catch(function () { loading = false; note.textContent = 'The member list could not be loaded.'; });
    }
    function renderSug() {
      sug.textContent = '';
      if (!current.length) { sug.hidden = true; return; }
      current.forEach(function (u, i) {
        var r = el('a', 'dm-suggest-row' + (i === sel ? ' dm-suggest-sel' : ''));
        r.href = 'messages.html?dm=' + u.hash;
        r.title = 'Open the conversation';
        r.appendChild(el('span', null, dmLabel(u.hash, u.nick)));
        r.appendChild(el('span', 'dm-suggest-go', 'message →'));
        r.addEventListener('mousedown', function (e: any) {
          e.preventDefault();
          go('messages.html?dm=' + u.hash);
        });
        sug.appendChild(r);
      });
      sug.hidden = false;
    }
    function suggest() {
      var q = input.value.trim().toLowerCase();
      if (q.length < 3) { current = []; renderSug(); return; }
      ensureDir(function () {
        current = dir
          .filter(function (u: any) { return u.hash !== state.myHash; })
          .map(function (u: any) {
            var s = Math.max(dmScore(q, u.nick), dmScore(q, displayName(u.hash)));
            return { u: u, s: s, label: dmLabel(u.hash, u.nick) };
          })
          .filter(function (x: any) { return x.s > 0; })
          .sort(function (x: any, y: any) { return y.s - x.s || (x.label < y.label ? -1 : 1); })
          .slice(0, 8)
          .map(function (x: any) { return x.u; });
        sel = 0;
        note.textContent = current.length ? '' : 'No member matches that. Pick from the suggestions.';
        renderSug();
      });
    }
    input.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(suggest, 150);
    });
    input.addEventListener('keydown', function (e: any) {
      if (sug.hidden) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(sel + 1, current.length - 1); renderSug(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(sel - 1, 0); renderSug(); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        if (current[sel]) go('messages.html?dm=' + current[sel].hash);
      } else if (e.key === 'Escape') { current = []; renderSug(); }
    });
    input.addEventListener('blur', function () {
      setTimeout(function () { current = []; renderSug(); }, 200);
    });
    return box;
  }

  function viewInbox() {
    if (window.mcViews && window.mcViews.inbox) {
      /* The Lit <mc-inbox> renders into its own subtree without clearing section,
         so a badge prepended here survives above the list — no bundle change. */
      section.appendChild(dmE2eBadge());
      return window.mcViews.inbox(section, window.mcKit);
    }
    document.title = 'Inbox | Community';
    crumb([['Community', 'community.html'], ['Inbox']]);
    if (!state.key) {
      section.appendChild(el('p', 'comments-status', 'Messages need an identity. Create one on the board front page.'));
      return;
    }
    section.appendChild(dmSearchBox());
    section.appendChild(dmE2eBadge());
    var list = el('div', 'board-topics');
    skelInto(list);
    section.appendChild(list);
    var pageNum = Math.max(1, Math.floor(Number(new URLSearchParams(location.search).get('p')) || 1));
    fetchRetry(API + '/dm/threads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: state.key, p: pageNum }),
    }, [1000, 3000])
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok) throw new Error(d.error || 'failed');
        dmCacheSet(d.unread_total);
        list.textContent = '';
        if (!d.threads.length) {
          list.appendChild(el('p', 'comments-status', 'No messages yet. Find a member above, or press Direct Message on any post.'));
          return;
        }
        var presDots: Record<string, any> = {};
        d.threads.forEach(function (t: any) {
          var row = el('div', 'board-topic' + (t.unread ? ' dm-row-unread' : ''));
          var left = el('div', 'board-topic-left');
          var a = el('a', 'board-topic-title' + (t.unread ? ' dm-unread' : ''), dmLabel(t.other_hash, t.nick));
          a.href = 'messages.html?dm=' + t.other_hash;
          left.appendChild(a);
          if (t.unread) left.appendChild(el('span', 'dm-unread-badge', String(t.unread)));   // the count (2026-09-11)
          var isub = el('div', 'board-row-sub', fmtTimeCompact(t.last_at));
          isub.title = fmtDateTime(t.last_at);
          left.appendChild(isub);
          /* the presence line, painted once the batched read answers */
          var presLine = el('div', 'board-row-sub dm-row-pres');
          presLine.hidden = true;
          var dot = el('span', 'dm-row-dot');
          presLine.appendChild(dot);
          left.appendChild(presLine);
          presDots[t.other_hash] = dot;
          row.appendChild(left);
          var istat = el('div', 'board-stats', t.msgs + (t.msgs === 1 ? ' message' : ' messages'));
          istat.title = fmtDateTime(t.last_at);
          row.appendChild(istat);
          /* A quiet Delete in the corner: clears my side, keeps the other's. */
          var delWrap = el('div', 'board-admin-corner');
          var del = el('a', 'trust-toggle', 'Delete');
          del.href = '#';
          del.addEventListener('click', (function (other, rowEl) {
            return function (e: any) {
              e.preventDefault();
              appConfirm('Delete this conversation? It is cleared from your inbox; the other member keeps their copy until they delete it too.', { okLabel: 'Delete', danger: true }, function (ok: any) {
                if (!ok) return;
                fetch(API + '/dm/delete', {
                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ key: state.key, with: other }),
                }).then(function (r) { return r.json(); }).then(function (d2) {
                  if (d2.ok) { rowEl.remove(); try { localStorage.removeItem(DM_CACHE); } catch (e2) {} dmUnreadCheck(); }
                }).catch(function () {});
              });
            };
          })(t.other_hash, row));
          delWrap.appendChild(del);
          row.appendChild(delWrap);
          list.appendChild(row);
        });
        /* One batched presence snapshot for the whole page: which correspondents
           are online now (honouring appear-offline). No per-row polling. */
        var presHashes = d.threads.map(function (t: any) { return t.other_hash; });
        if (presHashes.length) {
          fetch(API + '/dm/presence', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: state.key, hashes: presHashes }) })
            .then(function (r) { return r.json(); })
            .then(function (pd) {
              if (!(pd && pd.ok && Array.isArray(pd.online))) return;
              Object.keys(presDots).forEach(function (h) {
                presOnMap[h] = pd.online.indexOf(h) !== -1;
                seenMap[h] = Number((pd.seen && pd.seen[h]) || 0);
                paintRow(h, presOnMap[h], seenMap[h]);
              });
            })
            .catch(function () {});
        }
        var presOnMap: Record<string, boolean> = {}, seenMap: Record<string, number> = {};
        /* Online / Last seen … / Offline under the name (2026-09-11), the
           thread header's own line; a live offline reads "just now". */
        function paintRow(h: any, on: boolean, seen: number) {
          var dot = presDots[h]; if (!dot) return;
          var line = dot.parentNode;
          line.textContent = '';
          line.appendChild(dot);
          dot.className = 'dm-row-dot' + (on ? ' on' : '');
          line.appendChild(document.createTextNode(on ? 'Online' : (seen ? 'Last seen ' + dmSeenLabel(seen) : 'Offline')));
          line.hidden = false;
        }
        /* "typing…" under the name while the other party writes to me (the
           hub fans their signal to my own scope), the line back in 6 s. */
        var typingT: Record<string, any> = {};
        state.inboxTyping = function (h: any, on: any) {
          var dot = presDots[h]; if (!dot) return;
          clearTimeout(typingT[h]);
          if (on) {
            var line = dot.parentNode;
            line.textContent = ''; line.appendChild(dot); dot.className = 'dm-row-dot on';
            line.appendChild(el('span', 'dm-sub-typing', 'typing…')); line.hidden = false;
            typingT[h] = setTimeout(function () { paintRow(h, !!presOnMap[h], presOnMap[h] ? 0 : (seenMap[h] || 0)); }, 6000);
          } else paintRow(h, !!presOnMap[h], presOnMap[h] ? 0 : (seenMap[h] || 0));
        };
        /* Only an online → offline transition is "just now" — the hub also seeds
           "offline" on subscribe, which must not overwrite the read's stamp. */
        state.inboxPresence = function (h: any, on: any) {
          var was = !!presOnMap[h];
          presOnMap[h] = !!on;
          if (!on && was) seenMap[h] = Math.floor(Date.now() / 1000);
          paintRow(h, !!on, on ? 0 : (seenMap[h] || 0));
        };
        function inboxHref(i: any) { return 'messages.html&p=' + i; }
        var topBar = pageBar(d.total, d.per, d.page, inboxHref);
        if (topBar) section.insertBefore(topBar, list);
        var botBar = pageBar(d.total, d.per, d.page, inboxHref);
        if (botBar) section.appendChild(botBar);
      })
      .catch(function () {
        list.textContent = '';
        list.appendChild(el('p', 'comments-status', 'The inbox could not be loaded. Check your connection and reload the page.'));
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

  /* The conversation: a chat SCREEN (WhatsApp-shaped, the owner's 2026-09-11
     ruling). A sticky header — the correspondent's avatar, name (the app bar
     carries it on phones), a subtitle that reads Online / typing… / the lock,
     the call button, and ⓘ — over the messages, with a sticky composer at the
     foot: + attach, the rounded field with its emoji button, the mic that
     becomes Send the moment there is something to send. Everything about the
     conversation that is not a message — encryption and the safety number,
     the disappearing-message lifetime, block, delete — lives in the ⓘ sheet
     (tap the header, the ⓘ, or the ⏳ chip); the thread itself is only words. */
  function iconBtn(name: string, label: string, cls: string) {
    var b = el('button', cls);
    b.type = 'button';
    b.title = label;
    b.setAttribute('aria-label', label);
    b.appendChild(mcIcon(name));
    return b;
  }
  function viewDm(other: any) {
    if (!/^[0-9a-f]{64}$/.test(String(other))) {
      crumb([['Community', 'community.html'], ['Messages']]);
      section.appendChild(el('p', 'comments-status', 'No such member.'));
      return;
    }
    if (!state.key) {
      crumb([['Community', 'community.html'], ['Messages']]);
      section.appendChild(el('p', 'comments-status', 'Messages need an identity. Create one on the board front page.'));
      return;
    }
    if (other === state.myHash) {
      crumb([['Community', 'community.html'], ['Messages']]);
      section.appendChild(el('p', 'comments-status', 'That would be a soliloquy. Pick another member.'));
      return;
    }
    var qs = new URLSearchParams(location.search);
    var pNum = Math.floor(Number(qs.get('p')) || 0);
    /* A reaction's bell lands on the very message (2026-09-12): ?m=<id> asks
       the server for that message's page (find=) and is scrolled to on arrival. */
    var mWant = Math.floor(Number(qs.get('m')) || 0);
    var payload: any = { key: state.key, with: other };
    if (pNum > 0) payload.p = pNum;
    else if (mWant > 0) payload.find = mWant;
    /* Same as viewTopic: this rendered nothing at all until the thread AND the
       crypto library had both arrived — the longest blank wait in the app. */
    crumb([['Community', 'community.html'], ['Messages', 'messages.html'], ['Conversation']]);
    section.appendChild(skeleton());
    Promise.all([
      ensureNacl(),
      fetchRetry(API + '/dm/thread', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }, [1000, 3000]).then(function (r) { return r.json(); }),
    ])
      .then(function (res) {
        var d = res[1];
        if (!d.ok) throw new Error(d.error || 'failed');
        section.textContent = '';        // drop the placeholder crumb + skeleton
        /* The thread is a chat screen, not a document: under (hover:none)
           nothing on it is selectable text but the fields (ensureDmStyles) — a
           hold picks a message. The class leaves with the boot, so the next
           view on this section is a document again. */
        section.classList.add('dm-screen');
        bootSig.addEventListener('abort', function () { section.classList.remove('dm-screen'); }, { once: true });
        ensureDmStyles();
        /* The correspondent's public key drives both decrypt and encrypt for the
           whole thread (the shared secret is the same in both directions). */
        var otherPub = (d.other && d.other.pubkey) || null;
        var label = dmLabel(other, d.other.nick);
        var shortName = d.other.nick || displayName(other);
        document.title = shortName + ' | Inbox';
        crumb([['Community', 'community.html'], ['Inbox', 'messages.html'], [shortName]]);
        var curTtl = Number(d.ttl) || 2592000;   // Domain.Dm.defaultTtl
        var isNew = !d.messages.length;
        /* ---- the header ---- */
        var headEl = el('div', 'dm-head');
        var avatarLink = el('a', 'dm-head-avatar');
        avatarLink.href = profileHref(other);
        avatarLink.setAttribute('aria-label', 'Profile');
        function avatarInto(host: any, size: number) {
          if (d.other.avatar) {
            var im = el('img', 'dm-head-img');
            im.src = API + '/avatar?hash=' + other + '&v=' + encodeURIComponent(d.other.avatar);
            im.alt = ''; im.width = size; im.height = size;
            host.appendChild(im);
          } else host.appendChild(el('span', 'dm-head-initial', (shortName.charAt(0) || '?').toUpperCase()));
        }
        avatarInto(avatarLink, 40);
        headEl.appendChild(avatarLink);
        var headText = el('button', 'dm-head-text');
        headText.type = 'button';
        headText.title = 'Conversation info';
        headText.appendChild(el('span', 'dm-head-name', label));
        var sub = el('span', 'dm-head-sub');
        headText.appendChild(sub);
        headEl.appendChild(headText);
        var acts = el('div', 'dm-head-acts');
        headEl.appendChild(acts);
        section.appendChild(headEl);
        /* presOn: null until the hub seeds it (then the lock line stands), true
           = Online, false = Offline — which is also what a member who chose
           "appear offline" reads as; the hub honours that before it answers. */
        var presOn: boolean | null = null, typingOn = false, typingHideT: any = 0;
        /* The stamp the thread arrived with (null for a member who hides their
           presence); a live offline is "just now". Repainted each minute so
           "3 min ago" keeps time; the timer dies with the boot. */
        var seenAt: number = Number((d.other && d.other.last_seen) || 0);
        function paintSub() {
          sub.textContent = '';
          if (typingOn) { sub.appendChild(el('span', 'dm-sub-typing', 'typing…')); return; }
          if (presOn === true) { sub.appendChild(el('span', 'dm-dot dm-dot-on')); sub.appendChild(document.createTextNode('Online')); return; }
          if (presOn === false) {
            sub.appendChild(el('span', 'dm-dot dm-dot-off'));
            sub.appendChild(document.createTextNode(seenAt ? 'Last seen ' + dmSeenLabel(seenAt) : 'Offline'));
            return;
          }
          sub.appendChild(document.createTextNode('🔒 End-to-end encrypted'));
        }
        paintSub();
        var seenTick = setInterval(function () { if (presOn === false && seenAt) paintSub(); }, 60000);
        bootSig.addEventListener('abort', function () { clearInterval(seenTick); }, { once: true });
        /* ---- conversation info: the sheet behind the header, the ⓘ and the ⏳ chip ---- */
        var infoExpiry: any = null;
        function infoNode() {
          var box = el('div', 'dm-info');
          var card = el('div', 'dm-info-card');
          var big = el('div', 'dm-info-avatar');
          avatarInto(big, 72);
          card.appendChild(big);
          card.appendChild(el('div', 'dm-info-name', label));
          var pl = el('a', 'dm-info-link', 'View profile');
          pl.href = profileHref(other);
          card.appendChild(pl);
          box.appendChild(card);
          var enc = el('div', 'dm-info-row');
          enc.appendChild(el('div', 'dm-info-row-title', '🔒 End-to-end encrypted'));
          var encP = el('p', 'dm-info-row-text');
          encP.appendChild(document.createTextNode('Messages here are encrypted on your own device; we hold only ciphertext. '));
          var how = el('a', null, 'How it works');
          how.href = '#';
          how.addEventListener('click', function (ev: any) { ev.preventDefault(); dmE2eExplainer(); });
          encP.appendChild(how);
          if (otherPub) {
            encP.appendChild(document.createTextNode(' · '));
            var v = el('a', null, dmVerified(other) ? '✓ verified' : 'Verify safety number');
            v.href = '#';
            v.addEventListener('click', function (ev: any) { ev.preventDefault(); dmVerifyPanel(other, otherPub, v); });
            encP.appendChild(v);
          }
          enc.appendChild(encP);
          box.appendChild(enc);
          var dis = el('div', 'dm-info-row');
          dis.appendChild(el('div', 'dm-info-row-title', '⏳ Disappearing messages'));
          infoExpiry = dmExpiryNode(other, curTtl, isNew, function (t: number) { curTtl = t; isNew = false; paintNote(); });
          dis.appendChild(infoExpiry);
          box.appendChild(dis);
          /* The quiet exit — the ONE block (unified 2026-08-03): messages held
             out of sight AND their posts/profile hidden from your view. */
          var dz = el('div', 'dm-info-row dm-info-danger');
          dz.appendChild(identityAction(d.blocked ? 'Unblock this member' : 'Block this member', function () {
            var blocking = !d.blocked;
            var doBlock = function () { setBlock(other, blocking, function () { location.reload(); }); };
            if (blocking) appConfirm('Block this member? Their future messages are held out of your sight (they are never told), and their posts and profile are hidden from you. Unblocking undoes all of it and delivers everything they wrote meanwhile.', { okLabel: 'Block', danger: true }, function (ok: any) { if (ok) doBlock(); });
            else doBlock();
          }));
          dz.appendChild(identityAction('Delete conversation', function () {
            appConfirm('Delete this conversation? It is cleared from your inbox; the other member keeps their copy until they delete it too.', { okLabel: 'Delete', danger: true }, function (ok: any) {
              if (!ok) return;
              fetch(API + '/dm/delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key: state.key, with: other }),
              }).then(function (r) { return r.json(); }).then(function (d3) {
                if (d3.ok) { try { localStorage.removeItem(DM_CACHE); } catch (e) {} go('messages.html'); }
              }).catch(function () {});
            });
          }));
          box.appendChild(dz);
          return box;
        }
        function openInfo() {
          var node = infoNode();
          if (window.mcSheet) { window.mcSheet.open(shortName, node, function () { infoExpiry = null; }); return; }
          /* No shell: the same panel folds out under the header. */
          var old = section.querySelector('.dm-info-inline');
          if (old) { old.remove(); infoExpiry = null; return; }
          node.classList.add('dm-info-inline');
          headEl.parentNode.insertBefore(node, headEl.nextSibling);
        }
        headText.addEventListener('click', openInfo);
        var infoBtn = iconBtn('info', 'Conversation info', 'dm-head-btn dm-head-info');
        infoBtn.addEventListener('click', openInfo);
        acts.appendChild(infoBtn);
        /* Opening marked it read on the server; make the badge tell the
           same story on the next paint. */
        try { localStorage.removeItem(DM_CACHE); } catch (e) {}
        dmUnreadCheck();
        /* ---- the messages ---- */
        var list = el('div', 'comments-list dm-list');
        var note = el('button', 'dm-note');
        note.type = 'button';
        function paintNote() { note.textContent = '⏳ Messages disappear ' + dmTtlLabel(curTtl) + ' after they are opened'; }
        paintNote();
        note.addEventListener('click', openInfo);
        list.appendChild(note);
        var dmPages = Math.max(1, Math.ceil(d.total / d.per));
        function dmHref(i: any) { return 'messages.html?dm=' + other + '&p=' + i; }
        var topBar = pageBar(d.total, d.per, d.page, dmHref);
        if (topBar) list.appendChild(topBar);   // earlier pages are above; the newest word is at the foot
        section.appendChild(list);
        if (!d.messages.length) {
          list.appendChild(el('p', 'comments-status', 'No messages yet. Say the first word.'));
        }
        /* Everything a rendered bubble needs to act: the correspondent, the
           pair's key, the list it lives in (a quote jumps within it), the
           messages by id (a live edit updates the object a menu reads), the
           reply hook the composer owns below, and a word of feedback. */
        var ctx: any = { other: other, otherPub: otherPub, shortName: shortName, list: list, byId: {},
          reply: function () {},
          note: function (t: string) { status.textContent = t; if (window.mcToast) window.mcToast(t); } };
        /* Read receipts: my own bubbles carry ✓ until the other opens them
           (opened_at is set at load, or a live dm-read event flips them to ✓✓).
           Only my sent messages carry one; it rides the bubble's meta row. */
        var receipts: any[] = [];
        function addReceipt(node: any, m: any) {
          if (String(m.sender_hash) !== state.myHash) return;
          if (state.prefs && state.prefs.receipts === 'off') return;   // reciprocal: I send none AND see none
          var seen = !!m.opened_at;
          var r = el('span', 'dm-receipt' + (seen ? ' dm-receipt-seen' : ''), seen ? '✓✓' : '✓');
          r.title = seen ? 'Seen' : 'Delivered';
          r.setAttribute('aria-label', r.title);
          var meta = node.querySelector(':scope > .dm-meta');
          (meta || node).appendChild(r);
          receipts.push({ created: Number(m.created_at) || 0, span: r });
        }
        function renderMsg(m: any) { var n = dmRenderMsg(m, ctx); addReceipt(n, m); return n; }
        /* Bubbles land under a day chip — Today, Yesterday, a date — whenever
           the day changes, so each bubble's meta carries only the time. */
        var lastDay = '';
        function placeMsg(m: any) {
          var empty = list.querySelector(':scope > .comments-status');
          if (empty) empty.remove();   // the first word retires "No messages yet"
          var day = new Date((Number(m.created_at) || 0) * 1000).toDateString();
          if (day !== lastDay) { list.appendChild(dmDayNode(m.created_at)); lastDay = day; }
          var n = renderMsg(m);
          list.appendChild(n);
          return n;
        }
        d.messages.forEach(function (m: any) { placeMsg(m); });
        /* What this page actually weighs. A killed web view leaves no pagehide
           and no error, so the crumb ring can only say the app died — never
           how much it was carrying. Now it says. */
        trace('dm thread: ' + d.messages.length + ' msgs, '
          + d.messages.filter(function (m: any) { return m.media_key; }).length + ' attachments, '
          + mcDmBlobs.length + ' blobs held');
        /* The newest word sits at the foot, just above the composer. The foot
           of the THREAD — the last bubble against the fixed bar — never of the
           document: on desktop the footer follows the thread and must stay
           below the bar, not be pulled up into view (the owner's report,
           2026-09-11). The spacer stands behind the bar; its top is where the
           bubbles end. (spacer and form are the composer's, built below.) */
        function endGap() { return spacer.getBoundingClientRect().top - (form.getBoundingClientRect().top - 8); }
        function scrollToEnd(smooth?: boolean) {
          var delta = endGap();
          if (delta <= 0) return;
          try { window.scrollBy({ top: delta, left: 0, behavior: (smooth ? 'smooth' : 'instant') as any }); } catch (e) { window.scrollBy(0, delta); }
        }
        function nearEnd() { return endGap() < 240; }
        /* Reading back is never interrupted, and never blind (2026-09-11): a
           word that lands while the foot is out of view stays put under an
           "N unread messages" line, the jump button above the composer carries
           the count, and "seen" goes out only for words the reader actually
           reached — at the foot when they arrived, or when the reader comes
           down to them. pending: what the button counts; unseenLive: the live
           words no seen ping has covered yet. */
        var pending = 0, unseenLive = 0, unreadLine: any = null;
        function unreadText(n: number) { return n === 1 ? '1 unread message' : n + ' unread messages'; }
        function setUnreadLine(n: number, before: any) {
          if (unreadLine) unreadLine.remove();
          unreadLine = el('div', 'dm-unread-line', unreadText(n));
          unreadLine.setAttribute('role', 'separator');
          list.insertBefore(unreadLine, before);
        }
        function bumpUnreadLine(n: number) { if (unreadLine) unreadLine.textContent = unreadText(n); }
        var jump: any = null, jumpN: any = null, jumpRaf = 0;
        function updateJump() {
          if (!jump) return;
          var away = !nearEnd();
          jump.hidden = !away;
          if (!away) {
            pending = 0;
            if (unseenLive) { unseenLive = 0; dmSeenPing(other); }   // reached: now they are seen
          }
          jumpN.hidden = !pending;
          jumpN.textContent = pending > 99 ? '99+' : String(pending);
        }
        window.addEventListener('scroll', function () {
          if (jumpRaf) return;
          jumpRaf = requestAnimationFrame(function () { jumpRaf = 0; updateJump(); });
        }, { passive: true, signal: bootSig } as any);
        /* The other party's keystrokes, in the thread itself: a bubble of three
           dots at the foot while they type (kept in view when the foot is), and
           the header's line for a reader who is scrolled back. */
        var typingNode: any = null;
        function typingBubble(on: boolean) {
          if (on && !typingNode) {
            typingNode = el('div', 'dm-msg dm-typing-bubble');
            typingNode.setAttribute('aria-label', 'typing');
            for (var i = 0; i < 3; i++) typingNode.appendChild(el('span', 'dm-typing-dot'));
            var wasNear = nearEnd();
            list.appendChild(typingNode);
            if (wasNear) scrollToEnd();
          } else if (!on && typingNode) { typingNode.remove(); typingNode = null; }
        }
        /* Live drop-in + presence/typing/receipt updates for this open thread.
           A message pushed over the private user scope from THIS other party lands
           at once (their own echo is ignored); presence and typing paint the
           header's subtitle; dm-read flips my bubbles to ✓✓. */
        state.dmView = { other: other,
          setTtl: function (t: any) { curTtl = Number(t) || curTtl; isNew = false; paintNote(); if (infoExpiry && infoExpiry.mcSetTtl) infoExpiry.mcSetTtl(t); },
          setPresence: function (on: any) {
            if (presOn === true && !on && seenAt !== -1) seenAt = Math.floor(Date.now() / 1000);   // went offline before our eyes
            presOn = !!on; paintSub();
          },
          setTyping: function (on: any) {
            clearTimeout(typingHideT);
            typingOn = !!on; paintSub(); typingBubble(!!on);
            if (on) typingHideT = setTimeout(function () { typingOn = false; paintSub(); typingBubble(false); }, 6000);
          },
          markRead: function (at: any) {
            var t = Number(at) || 0;
            receipts.forEach(function (rc) {
              if (rc.created <= t) {
                rc.span.textContent = '✓✓'; rc.span.title = 'Seen'; rc.span.setAttribute('aria-label', 'Seen');
                rc.span.className = 'dm-receipt dm-receipt-seen';
              }
            });
          },
          append: function (msg: any) {
            if (!msg || String(msg.sender_hash) === state.myHash) return;
            clearTimeout(typingHideT); typingOn = false; paintSub(); typingBubble(false);   // a real message ends "typing"
            var newMsgPage = Math.max(1, Math.ceil((d.total + 1) / d.per));
            d.total += 1;
            if (d.page === newMsgPage) {
              var wasNear = nearEnd();
              var landed = placeMsg(msg);
              if (wasNear) {
                scrollToEnd();
                /* Watched it arrive: settle read state + receipt server-side
                   (the send-side quiet bell already skipped the notification). */
                dmSeenPing(other);
              } else {
                /* Reading back: the word waits under the line, the button counts
                   it, and it is "seen" when the reader comes down to it. */
                if (!pending) setUnreadLine(1, landed); else bumpUnreadLine(pending + 1);
                pending += 1; unseenLive += 1;
              }
              updateJump();
            } else {
              liveDmBadge();   // in the thread but paged back in history — still a bell
            }
          },
          /* The other party edited a message they sent me: re-render its body
             (decrypting, the reply envelope parsed away) and mark it edited.
             Only its text changes; the object the menu reads follows. */
          editMsg: function (msg: any) {
            if (!msg || !msg.id) return;
            var bubble = list.querySelector('[data-dmid="' + String(msg.id).replace(/"/g, '') + '"]');
            if (!bubble || bubble.classList.contains('dm-redacted-msg') || bubble.querySelector('.dm-media')) return;
            var body = bubble.querySelector(':scope > .comment-body');
            var text = Number(msg.enc || 0) === 1 ? (dmDecrypt(msg.body, otherPub) || '⚠️ could not decrypt') : (msg.body || '');
            var pt = dmParseText(text);
            if (body) { body.textContent = ''; fillBody(body, pt.text); }
            var mm = ctx.byId[String(msg.id)];
            if (mm) { mm.body = pt.text; mm.edited_at = msg.edited_at || Math.floor(Date.now() / 1000); }
            dmMarkEdited(bubble);
          },
          /* The other party deleted a message they sent me: show "<redacted>". */
          redactMsg: function (id: any) {
            if (!id) return;
            var bubble = list.querySelector('[data-dmid="' + String(id).replace(/"/g, '') + '"]');
            if (bubble) dmMakeRedacted(bubble, false);
          },
          /* The other party reacted (or withdrew) on one of these bubbles: repaint its pill. */
          reactMsg: function (msg: any) {
            if (!msg || !msg.id) return;
            var bubble = list.querySelector('[data-dmid="' + String(msg.id).replace(/"/g, '') + '"]');
            if (bubble && (bubble as any).mcReactPaint) (bubble as any).mcReactPaint(msg.emoji);
          },
          /* The other party saved (or unsaved) one of these bubbles: mark it for me too. */
          saveMsg: function (msg: any) {
            if (!msg || !msg.id) return;
            var bubble = list.querySelector('[data-dmid="' + String(msg.id).replace(/"/g, '') + '"]');
            if (bubble && (bubble as any).mcSavedPaint) (bubble as any).mcSavedPaint(msg.saved);
          } };
        /* Watch the other party's online state live (the DO seeds it now), and
           carry the on-screen claim (dmview:<other>) that keeps THIS thread's
           incoming messages off the bell while it is mounted — the sub is
           replaced by the next view's sub() and the socket closes on a hidden
           tab, so the claim is only ever true while the reader truly looks. */
        if (window.mcLive && window.mcLive.board) window.mcLive.board.sub(['presence:' + other, 'dmview:' + other]);
        /* ---- the composer ---- */
        var form = el('div', 'dm-composer');
        /* "Replying to …": the strip above the field while a reply is armed —
           from the surface's Reply, or a swipe on a bubble — with the ✕ that
           disarms it. The quote rides inside the next send's E2E plaintext. */
        var replyTo: any = null;
        var replyBar = el('div', 'dm-reply-bar');
        replyBar.hidden = true;
        var replyBody = el('div', 'dm-reply-body');
        var replyX = el('button', 'dm-reply-x', '✕');
        replyX.type = 'button'; replyX.title = 'Cancel reply'; replyX.setAttribute('aria-label', 'Cancel reply');
        replyBar.appendChild(replyBody); replyBar.appendChild(replyX);
        form.appendChild(replyBar);
        var mediaChip = el('span', 'dm-attach-chip');
        mediaChip.hidden = true;
        form.appendChild(mediaChip);
        var ta = el('textarea', 'comment-text dm-c-ta');
        ta.maxLength = 4000;
        ta.rows = 1;
        ta.placeholder = 'Message';
        ta.setAttribute('aria-label', 'Message');
        /* The focus net: the widget warms the instant they touch the field,
           the earliest honest sign they mean to send (the mdEditor road, here
           by hand because this composer is not the forum's). */
        warmOnFocus(ta);
        /* The picker and the keyboard never share the screen on a phone (the
           owner's report: both up at once was crammed). Opening the picker
           dismisses the keyboard; the 😊 becomes a keyboard button while it
           stands; a pick inserts the emoji, closes the picker and hands the
           keyboard back; a tap into the field closes it too. On desktop the
           picker simply stays open beside the field, as the forum's does. */
        var touchUi = false;
        try { touchUi = window.matchMedia('(hover: none)').matches; } catch (e) { touchUi = false; }
        var emojiPanel = buildEmojiPanel(ta, function (it: any) {
          insertEmojiItem(ta, it);
          if (touchUi) closePicker();
          ta.focus();
        });
        emojiPanel.classList.add('dm-c-emoji-panel');
        form.appendChild(emojiPanel);
        var row = el('div', 'dm-c-row');
        var plus = iconBtn('plus', 'Attach a photo, video or audio', 'dm-c-btn dm-c-plus');
        row.appendChild(plus);
        var field = el('div', 'dm-c-field');
        field.appendChild(ta);
        var emojiBtn = iconBtn('smile', 'Emoji', 'dm-c-emoji');
        function setEmojiFace(open: boolean) {
          emojiBtn.textContent = '';
          emojiBtn.appendChild(mcIcon(open ? 'keyboard' : 'smile'));
          emojiBtn.title = open ? 'Keyboard' : 'Emoji';
          emojiBtn.setAttribute('aria-label', emojiBtn.title);
          emojiBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
        }
        function openPicker() { if (touchUi) ta.blur(); emojiPanel.openPanel(); setEmojiFace(true); }
        function closePicker() { emojiPanel.closePanel(); setEmojiFace(false); }
        setEmojiFace(false);
        emojiBtn.addEventListener('click', function () {
          if (emojiPanel.hidden) openPicker();
          else { closePicker(); if (touchUi) ta.focus(); }
        });
        ta.addEventListener('focus', function () { if (touchUi && !emojiPanel.hidden) closePicker(); });
        field.appendChild(emojiBtn);
        row.appendChild(field);
        var mic: any = null;   // the voice button, when the Inbox takes voice notes
        var send = iconBtn('send', 'Send', 'dm-c-send');
        row.appendChild(send);
        form.appendChild(row);
        form.appendChild(el('div', 'ts-slot'));
        var status = el('p', 'form-status dm-c-status');
        form.appendChild(status);
        /* The way back to the foot: a round button above the composer whenever
           the foot is out of view, carrying the count of what waits there. */
        jump = el('button', 'dm-jump');
        jump.type = 'button'; jump.title = 'Jump to the latest message'; jump.setAttribute('aria-label', 'Jump to the latest message');
        jump.appendChild(el('span', 'dm-jump-ico', '⌄'));
        jumpN = el('span', 'dm-jump-n'); jumpN.hidden = true;
        jump.appendChild(jumpN);
        jump.hidden = true;
        jump.addEventListener('click', function () { scrollToEnd(true); });
        form.appendChild(jump);
        section.appendChild(form);
        /* The bar is FIXED above the tab bar (the merecat road), never sticky:
           a thread opens at the document's end, where a sticky bar sits in its
           natural place — above the body's tab-bar reservation and the footer
           — and floated a gap over the tab bar until a scroll re-stuck it (the
           owner's report, 2026-09-11). A spacer reserves the bar's height under
           the last bubble, remeasured as the bar changes (the reply strip, the
           attach chip, the recorder, the growing field); on desktop the bar is
           aligned to the content column by measurement, since the sidebar
           shifts the column. */
        var spacer = el('div', 'dm-c-space');
        section.appendChild(spacer);
        function place() {
          if (window.innerWidth > 600) {
            var r = section.getBoundingClientRect();
            form.style.left = Math.round(r.left) + 'px';
            form.style.width = Math.round(r.width) + 'px';
            form.style.right = 'auto';
          } else { form.style.left = ''; form.style.width = ''; form.style.right = ''; }
          spacer.style.height = (form.offsetHeight + 8) + 'px';
        }
        place();
        var placeT: any = 0;
        function replace() {
          clearTimeout(placeT);
          placeT = setTimeout(function () { var atEnd = nearEnd(); place(); if (atEnd) scrollToEnd(); updateJump(); }, 0);
        }
        if (window.ResizeObserver) {
          var ro = new ResizeObserver(replace);
          ro.observe(form); ro.observe(section);
          bootSig.addEventListener('abort', function () { ro.disconnect(); }, { once: true });
        }
        window.addEventListener('resize', replace, { signal: bootSig });
        if (window.MutationObserver) {
          /* the desktop sidebar toggles a body class and eases the column over: re-place after the ease too */
          var mo = new MutationObserver(function () { replace(); setTimeout(place, 320); });
          mo.observe(document.body, { attributes: true, attributeFilter: ['class'] });
          bootSig.addEventListener('abort', function () { mo.disconnect(); }, { once: true });
        }
        function setReply(ref: any) {
          replyTo = ref;
          replyBody.textContent = '';
          if (!ref) { replyBar.hidden = true; return; }
          replyBody.appendChild(el('span', 'dm-quote-who', 'Replying to ' + (ref.from === state.myHash ? 'yourself' : shortName)));
          replyBody.appendChild(el('span', 'dm-quote-text', dmQuoteText(ref)));
          replyBar.hidden = false;
        }
        replyX.addEventListener('click', function () { setReply(null); ta.focus(); });
        ctx.reply = function (m: any) { setReply(dmReplyRef(m)); ta.focus(); };
        /* The field grows with the words, to a few lines, then scrolls. */
        /* An empty box is its natural one row (scrollHeight would count a
           wrapped placeholder); a filled one grows to a few lines, then scrolls.
           scrollHeight excludes a border-box field's borders: add them back. */
        function grow() {
          if (!ta.value) { ta.style.height = ''; return; }
          ta.style.height = 'auto';
          ta.style.height = Math.min(ta.scrollHeight + (ta.offsetHeight - ta.clientHeight), 168) + 'px';
        }
        var pendingFile: any = null;
        /* Mic while there is nothing to send, Send the moment there is —
           WhatsApp's swap. Without voice, Send stands always, dimmed when idle. */
        function refresh() {
          var has = !!(ta.value.trim() || pendingFile);
          if (mic) { mic.hidden = has; send.hidden = !has; }
          else { send.hidden = false; send.classList.toggle('dm-c-idle', !has); }
        }
        attachDraft(ta, 'dm:' + other);
        attachEmoji(ta);
        attachMentions(ta);
        swipeDismissesKeyboard(ta, form);
        grow(); refresh();
        /* Sparing typing signal: a "start" at most once per 3s while composing,
           a "stop" 4s after the last keystroke. WebSocket only — no HTTP. */
        var typingLastSent = 0, typingStopT = 0;
        ta.addEventListener('input', function () {
          grow(); refresh();
          if (!(window.mcLive && window.mcLive.member)) return;
          var now = Date.now();
          if (now - typingLastSent > 3000) { window.mcLive!.member.typing!(other, 'start'); typingLastSent = now; }
          clearTimeout(typingStopT);
          typingStopT = setTimeout(function () { window.mcLive!.member.typing!(other, 'stop'); typingLastSent = 0; }, 4000);
        });
        /* Enter sends where there is a keyboard with a pointer (WhatsApp Web's
           convention; Shift+Enter breaks the line); on a phone Enter is a new
           line and the button sends. A picker that already took the key
           (the : emoji and @ mention lists) keeps it. */
        var finePointer = false;
        try { finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches; } catch (e) { finePointer = false; }
        ta.addEventListener('keydown', function (e: any) {
          if (e.key !== 'Enter' || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey || e.isComposing || e.defaultPrevented || !finePointer) return;
          e.preventDefault();
          send.click();
        });
        /* Attach a photo / audio / video from the device library. It is encrypted
           in the browser (AES-GCM) and sent as an E2E media message on Send; the
           text box becomes an optional caption. */
        var fileInput = el('input', 'dm-file-input');
        fileInput.type = 'file';
        fileInput.style.display = 'none';
        form.appendChild(fileInput);
        function clearAttach() { pendingFile = null; fileInput.value = ''; mediaChip.hidden = true; mediaChip.textContent = ''; refresh(); }
        plus.addEventListener('click', function () { fileInput.click(); });
        /* Gate + hold one picked (or recorded) file. The kind and size caps come
           from the served media settings (the old hardcoded 60 MB here let the
           server refuse at its own, smaller caps); images are downscaled in the
           browser BEFORE the E2E encrypt, so only the small ciphertext uploads. */
        function takeDmFile(f: any) {
          mediaCfg().then(function (cfg: any) {
            mediaGateFile(f, cfg, cfg.sections.dm, status).then(function (out: any) {
              if (!out) { fileInput.value = ''; return; }
              pendingFile = out;
              status.textContent = '';
              mediaChip.textContent = '';
              mediaChip.appendChild(document.createTextNode('📎 ' + (out.name || 'attachment') + ' · ' + fmtBytes(out.size) + '  '));
              var x = el('a', null, '✕');
              x.href = '#';
              x.addEventListener('click', function (ev: any) { ev.preventDefault(); clearAttach(); });
              mediaChip.appendChild(x);
              mediaChip.hidden = false;
              refresh();
            });
          });
        }
        fileInput.addEventListener('change', function () {
          var f = fileInput.files && fileInput.files[0];
          if (!f) return;
          takeDmFile(f);
        });
        /* One config tap: hide + when the Inbox takes no media, accept from
           the DM section's own kinds, the mic behind its voice flag. */
        mediaCfg().then(function (cfg: any) {
          var sec = cfg.sections.dm;
          if (cfg.enabled && sec.kinds.length) {
            fileInput.accept = window.mcCore ? (window.mcCore as any).mediaAcceptFor(sec.kinds) : 'image/*,video/*,audio/*';
            if (sec.voice && sec.kinds.indexOf('audio') !== -1) {
              mic = voiceControl(form, cfg, sec, status, takeDmFile);
              mic.className = 'dm-c-btn dm-c-mic';
              mic.textContent = '';
              mic.appendChild(mcIcon('mic'));
              mic.title = 'Voice note'; mic.setAttribute('aria-label', 'Voice note');
              row.insertBefore(mic, send);
              refresh();
            }
          } else plus.hidden = true;
          /* 📞 lives in the header, always in view (the WhatsApp place). Gated on
             the platform switch + WebRTC support; the bot has no ears. */
          if (other !== MERECAT_BOT_HASH && (window as any).RTCPeerConnection
            && (navigator as any).mediaDevices && (navigator as any).mediaDevices.getUserMedia) {
            callsCfg().then(function (cc: any) {
              if (!cc.enabled) return;
              var cb = iconBtn('phone', 'Voice call (end-to-end encrypted)', 'dm-head-btn dm-head-call');
              cb.addEventListener('click', function () { placeCall(other, label); });
              acts.insertBefore(cb, acts.firstChild);
            });
          }
        });
        /* No challenge merely for OPENING a conversation: the focus net warms
           the widget the instant they touch the field. */
        /* We can only encrypt to a member who has published a key. Until they have
           signed in once under the encrypted client, hold the send with a plain
           notice rather than silently falling back to plaintext. */
        if (!otherPub) {
          send.disabled = true;
          ta.disabled = true;
          plus.disabled = true;
          ta.placeholder = 'Waiting for this member to sign in once to set up encryption.';
          status.textContent = 'You can message them privately once they have signed in to set up their encryption key.';
        }
        send.addEventListener('click', function () {
          if (send.disabled) return;
          var body = ta.value.replace(/\s+$/, '');
          if (!pendingFile && !body.trim()) { ta.focus(); return; }
          send.disabled = true;
          trace('submit: DM send');
          status.textContent = 'Verifying...';
          var sending = pendingFile;   // captured: the echo path needs the local file
          var replyAt = replyTo;       // captured: the quote this send answers
          getToken().then(function (token) {
            if (sending) {
              /* Media: encrypt the file in the browser, upload only ciphertext,
                 then send a normal E2E message whose body carries the AES key. */
              status.textContent = 'Encrypting...';
              return dmMediaEncryptFile(sending).then(function (mm: any) {
                status.textContent = 'Uploading...';
                var fd = new FormData();
                fd.append('key', state.key);
                fd.append('file', new Blob([mm.ct]), 'blob');
                return fetch(API + '/dm/media', { method: 'POST', body: fd }).then(function (r) { return r.json(); }).then(function (u) {
                  if (!u.ok) throw new Error(u.error || 'The file could not be uploaded.');
                  status.textContent = 'Sending...';
                  if (body.trim()) mm.env.caption = body;
                  if (replyAt) mm.env.reply = replyAt;
                  return fetchRetry(API + '/dm/send', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ key: state.key, to: other, body: dmEncrypt(JSON.stringify(mm.env), otherPub), enc: 1, media_key: u.media_key, token: token }),
                  }, [1500]).then(function (r) { return r.json(); }).then(function (d2) { d2._env = mm.env; d2._media_key = u.media_key; return d2; });
                });
              });
            }
            status.textContent = 'Sending...';
            return fetchRetry(API + '/dm/send', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ key: state.key, to: other, body: dmEncrypt(dmWrapText(body, replyAt), otherPub), enc: 1, token: token }),
            }, [1500], function () { status.textContent = 'Network hiccup, retrying...'; })
              .then(function (r) { return r.json(); });
          }).then(function (d2) {
            if (blockedOut(d2)) return;
            if (!d2.ok) throw new Error(d2.error || 'The message could not be sent.');
            ta.value = '';
            if (ta.mcDraftDone) ta.mcDraftDone();
            closePicker();
            /* Seed the media cache from the local file so our own echo renders
               instantly without a round-trip. */
            if (sending && d2._media_key) { try { mcDmBlobPut(d2._media_key, URL.createObjectURL(sending), sending.size || 0); } catch (e) {} }
            clearAttach();
            setReply(null);
            grow(); refresh();
            /* Newest message lands at the bottom of the last page. Show it
               inline when that page is on screen; else jump to it. */
            var msgPage = Math.ceil((d.total + 1) / d.per);
            if (msgPage === d.page) {
              d.total += 1;
              if (sending && d2._media_key) {
                /* The media echo arrives with its envelope in hand (no decrypt). */
                var mecho = { id: d2.id, sender_hash: state.myHash, media_key: d2._media_key, created_at: d2.created_at, saved: 0, enc: 1,
                  _env: d2._env, reply: dmReplyClean(replyAt), react_me: '', react_other: '' };
                placeMsg(mecho);
              } else {
                /* The text echo is already plaintext (enc 0) and carries its quote. */
                var echo = { id: d2.id, sender_hash: state.myHash, body: body, created_at: d2.created_at, saved: 0, enc: 0,
                  reply: dmReplyClean(replyAt), react_me: '', react_other: '' };
                placeMsg(echo);
              }
              status.textContent = '';
              scrollToEnd();
            } else {
              go('messages.html?dm=' + other + '&p=' + msgPage);
            }
          }).catch(function (err) {
            status.textContent = err.message || 'Network error. Try again in a moment.';
          }).finally(function () {
            send.disabled = !otherPub;
            refresh();
            if (window.turnstile && state.widgetId !== null) turnstile.reset(state.widgetId);
          });
        });
        /* Open a conversation at its newest word: on the last page, the foot of
           the thread, just above the composer. Chrome resets the scroll position
           at the window load event (its restoration for a fresh entry), and on a
           real network the thread renders BEFORE load — the first cut opened at
           the top on prod and at the foot on a local serve, where load had long
           fired. When load is still to come, re-land the foot for a beat after
           it (the reader has had no time to scroll away). */
        /* The unread line stands above the first word this reader had not read
           when the thread opened — the server tells it BEFORE this open marks
           them read — with the count; it stays until the reader leaves. The
           landing is WhatsApp's: the foot when the unread words all fit under
           the header, else the line just under the header with the jump button
           carrying the count. */
        var firstUnread = d.unread_from ? list.querySelector('[data-dmid="' + String(d.unread_from).replace(/"/g, '') + '"]') : null;
        if (firstUnread && Number(d.unread) > 0) { setUnreadLine(Number(d.unread), firstUnread); pending = Number(d.unread); }
        function landing() {
          scrollToEnd();
          if (unreadLine) {
            var top = unreadLine.getBoundingClientRect().top, under = headEl.getBoundingClientRect().bottom + 6;
            if (top < under) { try { window.scrollBy({ top: top - under, left: 0, behavior: 'instant' as any }); } catch (e) { window.scrollBy(0, top - under); } }
          }
          updateJump();
        }
        var landOn = mWant > 0 ? list.querySelector('[data-dmid="' + mWant + '"]') : null;
        if (landOn) {
          try { landOn.scrollIntoView({ block: 'center' }); } catch (e) { landOn.scrollIntoView(); }
          dmFlash(landOn);
          updateJump();
        } else if (d.messages.length && d.page >= dmPages) {
          landing();
          if (document.readyState !== 'complete') {
            window.addEventListener('load', function () {
              var n = 0;
              var settle = function () { landing(); if (++n < 6) setTimeout(settle, 50); };
              settle();
            }, { once: true, signal: bootSig });
          }
        }
      })
      .catch(function () {
        section.textContent = '';        // drop the placeholder crumb + skeleton
        crumb([['Community', 'community.html'], ['Messages']]);
        section.appendChild(el('p', 'comments-status', 'The conversation could not be loaded. Check your connection and reload the page.'));
      });
  }
  function bind() {
    API = B.API;
    CUSTOM_EMOJI = B.CUSTOM_EMOJI;
    MERECAT_BOT_HASH = B.MERECAT_BOT_HASH;
    NACL_SRC = B.NACL_SRC;
    appConfirm = B.appConfirm;
    armHold = B.armHold;
    attachDraft = B.attachDraft;
    attachEmoji = B.attachEmoji;
    attachMentions = B.attachMentions;
    badgeChanged = B.badgeChanged;
    blockedOut = B.blockedOut;
    bootSig = B.bootSig;
    buildEmojiPanel = B.buildEmojiPanel;
    cachedJson = B.cachedJson;
    closeActs = B.closeActs;
    closeActsFor = B.closeActsFor;
    crumb = B.crumb;
    displayName = B.displayName;
    el = B.el;
    emojiImg = B.emojiImg;
    fetchRetry = B.fetchRetry;
    fillBody = B.fillBody;
    fmtDateTime = B.fmtDateTime;
    fmtTimeCompact = B.fmtTimeCompact;
    freshParam = B.freshParam;
    getToken = B.getToken;
    go = B.go;
    identityAction = B.identityAction;
    insertEmojiItem = B.insertEmojiItem;
    loadingLine = B.loadingLine;
    mcDmBlobGet = B.mcDmBlobGet;
    mcDmBlobPut = B.mcDmBlobPut;
    mcDmBlobs = B.mcDmBlobs;
    mcIcon = B.mcIcon;
    mediaCfg = B.mediaCfg;
    mediaDownloadLink = B.mediaDownloadLink;
    mediaGateFile = B.mediaGateFile;
    onLiveNotif = B.onLiveNotif;
    openActs = B.openActs;
    pageBar = B.pageBar;
    profileHref = B.profileHref;
    reactionNode = B.reactionNode;
    readEase = B.readEase;
    readMark = B.readMark;
    readThrottled = B.readThrottled;
    renderIdentity = B.renderIdentity;
    section = B.section;
    setBlock = B.setBlock;
    skelInto = B.skelInto;
    skeleton = B.skeleton;
    state = B.state;
    trace = B.trace;
    truncate = B.truncate;
    utilBtnLabel = B.utilBtnLabel;
    voiceControl = B.voiceControl;
    warmOnFocus = B.warmOnFocus;
  }
  /* What ran at boot time in the old file, in the old order, after every
     module is bound: listeners, deferred initializers. */
  function run() {
    document.addEventListener('mc-live', function (ev) {
      var m = (ev as CustomEvent).detail; if (!m) return;
      if (m.t === 'dm') onLiveDm(m);
      else if (m.t === 'dm-ttl') onLiveDmTtl(m);
      else if (m.t === 'dm-edit') onLiveDmEdit(m);
      else if (m.t === 'dm-redact') onLiveDmRedact(m);
      else if (m.t === 'dm-react') onLiveDmReact(m);
      else if (m.t === 'dm-save') onLiveDmSave(m);
      else if (m.t === 'dm-read') onLiveDmRead(m);
      else if (m.t === 'typing') onLiveTyping(m);
      else if (m.t === 'presence') onLivePresence(m);
      else if (m.t === 'notification') onLiveNotif();
      else if (m.t === 'wall-post' || m.t === 'wall-comment') { if (state.onLiveWall) state.onLiveWall(m); }
    }, { signal: bootSig });
  }
  return { bind, run, exports: { DM_CACHE, dmB64uEnc, dmCacheGet, dmCacheSet, dmLabel, dmScore, dmSearchBox, dmSeenLabel, dmTtlChoices, dmUnreadCheck, ensureDmStyles, ensureNacl, fmtBytes, myDmKeypair, playSound, swipeDismissesKeyboard, viewDm, viewInbox } };
}
