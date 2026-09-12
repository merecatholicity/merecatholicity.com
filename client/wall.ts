/* The feed and member walls (Wave F, 2026-09-11 — moved out of comments.ts
   verbatim): social config, the line icons, likes/likers, share, the wall
   post/comment renderers, the wall composer, the infinite list. */
import type { Boot } from './boot';

export function installWall(B: Boot) {
  /* Names this module takes from the boot — the root's helpers and the other
     modules' exports — bound in bind() once every module is installed, so
     order of installation never matters and every body reads as it did. */
  let ADMIN_HASHES: any;
  let API: any;
  let MERECAT_BOT_HASH: any;
  let appConfirm: (msg: any, opts: any, cb: any) => any;
  let armHold: (node: any, open: (at: any) => void, opts?: any) => any;
  let attachDraft: (ta: any, ctx: string, titleInput?: any, overwrite?: boolean) => any;
  let attachMentions: (textarea: any) => any;
  let authorNode: (hash: any, nick: any, withSub: any, faith?: any, posts?: any) => any;
  let blockedOut: (d: any) => any;
  let bookmarkToggle: (kind: any, ref: any, on: any) => any;
  let cachedJson: (url: any, init: any, ttl: any) => Promise<any>;
  let canEditPost: (authorHash: any) => boolean;
  let clampBody: (bodyEl: any, lines: any) => any;
  let collectMentions: (text: any) => any;
  let crumb: (parts: any) => any;
  let el: (tag: string, cls?: string | null, text?: string | number | null) => any;
  let ensureDmStyles: () => any;
  let fillBody: (node: HTMLElement, text: any, plain?: boolean) => any;
  let fmtBytes: (n: any) => any;
  let fmtDateTime: (epoch: any) => any;
  let fmtTimeCompact: (epoch: any) => any;
  let getFaith: () => any;
  let getToken: () => Promise<any>;
  let go: (href: string, replace?: boolean) => any;
  let isAdmin: () => any;
  let isBlocked: any;
  let isMember: () => any;
  let loginToInteract: (what: any) => any;
  let mdEditor: (textarea: any, titleInput?: any) => any;
  let mediaCfg: () => Promise<any>;
  let mediaDownloadLink: (url: any, filename: any, label: any, cls: any) => any;
  let mediaGateFile: (f: any, cfg: any, sec: any, statusEl: any) => any;
  let mediaStash: (op: any, place: any, rec?: any) => any;
  let myAvatar: any;
  let myNick: any;
  let myPostCount: any;
  let openActs: (spec: any) => any;
  let openMedia: (mediaKey: any, kind: any, post: any) => any;
  let postMenu: (opts: any) => any;
  let reactMine: (target: any, id: any) => string;
  let reactPillInto: (host: any, target: any, id: any, cells: any[], mine: string) => any;
  let reactRegister: (target: any, id: any, host: any, seed: any, paint?: any) => any;
  let reactSend: (target: any, id: any, emoji: any) => any;
  let previewButton: (ta: any) => any;
  let profileHref: (hash: any) => any;
  let section: any;
  let skeleton: (kind?: string) => any;
  let state: any;
  let trace: (why: string) => any;
  let utilBtnLabel: (btn: any, icon: string, word: string) => any;
  let viewJoin: (what: any) => any;
  let voiceControl: (form: any, cfg: any, sec: any, statusEl: any, takeFile: any) => any;
  /* ================= The social layer's global switch =================
     app_settings `social_enabled`, served in /config. Off, the Feed and every
     member wall are inaccessible to everyone (admins included) and read as
     pages that never existed; nothing is deleted, and flipping it back restores
     the whole stream untouched. The server refuses every /wall* surface on its
     own — everything here is the client's courtesy: don't offer what cannot be
     had.

     The value is MIRRORED into localStorage because app/appchrome.ts must
     decide whether to draw the Feed tab SYNCHRONOUSLY, on every page, before
     any fetch — the same reason the `mc-admin` flag exists. Absence means ON,
     so a first-time visitor gets the default; the mirror is refreshed from
     /config on every page this client boots, and `mc-social-change` lets the
     chrome re-render without a reload. */
  function socialRead() {
    try { return localStorage.getItem('mc-social') !== '0'; } catch (e) { return true; }
  }
  function socialMirror(on: boolean) {
    var was = socialRead();
    try {
      if (on) localStorage.removeItem('mc-social');
      else localStorage.setItem('mc-social', '0');
    } catch (e) { /* blocked storage: the gates below still read /config */ }
    if (was !== on) document.dispatchEvent(new CustomEvent('mc-social-change', { detail: { on: on } }));
  }
  /* Shares mcStore's per-URL cache with mediaCfg()/callsCfg(), so asking costs
     no extra request — the free-tier budget law holds. Fails to the mirror (and
     so to ON for a fresh browser), because the server is the authority. */
  function socialCfg(): Promise<any> {
    return cachedJson(API + '/config', undefined, 300000)
      .then(function (d: any) {
        var on = !(d && d.ok && d.social && d.social.enabled === false);
        socialMirror(on);
        return on;
      })
      .catch(function () { return socialRead(); });
  }

  /* Brand-logo SVG paths (24x24, currentColor). "website" is a link/chain glyph.
     Static markup, built via createElementNS (no innerHTML). */
  var SOCIAL_SVG: Record<string, string> = {
    website: 'M3.9 12a4.1 4.1 0 014.1-4.1h3v1.9h-3a2.2 2.2 0 000 4.4h3v1.9h-3A4.1 4.1 0 013.9 12zm5.6 1h5v-2h-5v2zm3.5-5.1h3a4.1 4.1 0 010 8.2h-3v-1.9h3a2.2 2.2 0 000-4.4h-3v-1.9z',
    x: 'M18.9 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.153h7.594l5.243 6.932zm-1.29 19.49h2.039L6.486 3.24H4.298z',
    facebook: 'M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z',
    instagram: 'M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163C8.741 0 8.332.014 7.052.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z',
    tiktok: 'M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z',
  };
  function ensureSocialStyles() {
    if (document.getElementById('mc-social-css')) return;
    var s = el('style'); s.id = 'mc-social-css';
    s.textContent = '.profile-socials{display:flex;flex-wrap:wrap;gap:0.5rem;margin:0.5rem 0 0.3rem}'
      + '.profile-social{display:inline-flex;align-items:center;justify-content:center;width:2.3rem;height:2.3rem;border-radius:50%;border:1px solid var(--rule);color:var(--maroon);text-decoration:none;transition:background .12s,border-color .12s}'
      + '.profile-social:hover{background:var(--cream);border-color:var(--maroon)}'
      + '.mc-social-svg{display:block}'
      + '.profile-link-row{margin:0 0 0.55rem}'
      + '.profile-link-plat{display:inline-flex;align-items:center;gap:0.35rem;font-size:0.85rem;color:var(--muted);margin:0 0 0.15rem}'
      + '.profile-link-plat .mc-social-svg{width:1rem;height:1rem}';
    document.head.appendChild(s);
  }
  function mcSocialIcon(name: any) {
    ensureSocialStyles();
    var NS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', '22'); svg.setAttribute('height', '22');
    svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('class', 'mc-social-svg');
    var path = document.createElementNS(NS, 'path');
    path.setAttribute('d', SOCIAL_SVG[name] || SOCIAL_SVG.website); path.setAttribute('fill', 'currentColor');
    svg.appendChild(path);
    return svg;
  }
  var SOCIAL_ORDER = ['website', 'x', 'facebook', 'instagram', 'tiktok'];
  var SOCIAL_LABEL: Record<string, string> = { website: 'Website', x: 'X (Twitter)', facebook: 'Facebook', instagram: 'Instagram', tiktok: 'TikTok' };

  /* ===================== Public posting: walls + the feed =====================
     A member's wall is their own public posts; the feed is everyone's together.
     Public + unencrypted, reusing the composer, Turnstile, @mentions, and the
     rank/faith author line. Media rides the public /wall/media endpoint. */

  function wallAvatarInto(head: any, hash: any, avatar: any) {
    if (!avatar || !hash) return;
    var link = el('a', 'comment-avatar-link');
    link.href = profileHref(hash);
    var img = el('img', 'comment-avatar');
    img.src = API + '/avatar?hash=' + hash + '&v=' + encodeURIComponent(avatar);
    img.alt = ''; img.width = 32; img.height = 32;
    link.appendChild(img);
    head.appendChild(link);
  }
  /* ================= Feed / wall: Facebook-style cards ================= */
  /* Inline SVG icons — CSP-safe (no innerHTML), crisp at any DPI. Stroked by
     default; the brand marks (X, Facebook) and the filled heart use fill, keyed
     by CSS on the button state. */
  function mcIcon(name: any) {
    var P: any = {
      heart: 'M12 20.5S3.5 15 3.5 8.9C3.5 6.3 5.5 4.5 7.9 4.5c1.6 0 3.1.9 3.8 2.3l.3.6.3-.6c.7-1.4 2.2-2.3 3.8-2.3 2.4 0 4.4 1.8 4.4 4.4C20.5 15 12 20.5 12 20.5z',
      comment: 'M20 4H4a1 1 0 00-1 1v11a1 1 0 001 1h3v4l5-4h8a1 1 0 001-1V5a1 1 0 00-1-1z',
      share: 'M18 8a2.5 2.5 0 10-2.4-3.2L9 8.2a2.5 2.5 0 100 4.6l6.6 3.4A2.5 2.5 0 1018 15l-6.6-3.4a2.5 2.5 0 000-1.6L18 6.6A2.5 2.5 0 0018 8z',
      download: 'M12 3v11m0 0l4.5-4.5M12 14l-4.5-4.5M4.5 19.5h15',
      copy: 'M15.5 8.5v-2a2 2 0 00-2-2h-7a2 2 0 00-2 2v7a2 2 0 002 2h2M10.5 8.5h7a2 2 0 012 2v7a2 2 0 01-2 2h-7a2 2 0 01-2-2v-7a2 2 0 012-2z',
      expand: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
      close: 'M6 6l12 12M18 6L6 18',
      /* the DM chat screen's line icons (Feather-shaped, hand-drawn) */
      plus: 'M12 5v14M5 12h14',
      send: 'M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z',
      mic: 'M12 2a3 3 0 00-3 3v7a3 3 0 006 0V5a3 3 0 00-3-3zM19 10v2a7 7 0 01-14 0v-2M12 19v3',
      phone: 'M22 16.9v3a2 2 0 01-2.2 2 19.8 19.8 0 01-8.6-3.1 19.5 19.5 0 01-6-6A19.8 19.8 0 012.1 4.2 2 2 0 014.1 2h3a2 2 0 012 1.7c.1.9.4 1.8.7 2.6a2 2 0 01-.5 2.1L8.1 9.7a16 16 0 006 6l1.3-1.3a2 2 0 012.1-.4c.8.3 1.7.6 2.6.7a2 2 0 011.7 2z',
      info: 'M12 22a10 10 0 100-20 10 10 0 000 20zM12 16v-4M12 8h.01',
      smile: 'M12 22a10 10 0 100-20 10 10 0 000 20zM8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01',
      keyboard: 'M3 7h18v10H3zM7 10.5h.01M11 10.5h.01M15 10.5h.01M8 14h8',
      x: 'M18.9 2.5H22l-7.6 8.6L23 21.5h-6.9l-5.4-7-6.2 7H1.4l8.1-9.2L1 2.5h7l4.9 6.4L18.9 2.5z',
      facebook: 'M22 12a10 10 0 10-11.6 9.9v-7H7.9V12h2.5V9.8c0-2.5 1.5-3.8 3.7-3.8 1.1 0 2.2.2 2.2.2v2.4h-1.2c-1.2 0-1.6.8-1.6 1.5V12h2.7l-.4 2.9h-2.3v7A10 10 0 0022 12z',
    };
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('class', 'mc-ic mc-ic-' + name); svg.setAttribute('aria-hidden', 'true');
    var pth = document.createElementNS(ns, 'path'); pth.setAttribute('d', P[name] || '');
    if (name === 'x' || name === 'facebook') { pth.setAttribute('fill', 'currentColor'); }
    else {
      pth.setAttribute('fill', 'none'); pth.setAttribute('stroke', 'currentColor');
      pth.setAttribute('stroke-width', '2'); pth.setAttribute('stroke-linecap', 'round'); pth.setAttribute('stroke-linejoin', 'round');
    }
    svg.appendChild(pth);
    return svg;
  }
  /* A short download filename for a wall media object (kind is encoded in the key
     as wall/<i|v|a>/…). The bytes keep their real type; this only names the save. */
  function mediaFilename(mediaKey: any) {
    var k = String(mediaKey).split('/')[1];
    var ext = k === 'v' ? 'mp4' : k === 'a' ? 'mp3' : 'jpg';
    return 'merecatholicity-' + String(mediaKey).replace(/[^a-z0-9]/gi, '').slice(-8) + '.' + ext;
  }

  /* Who-liked popover: hover (desktop) or long-press (mobile) the like count to
     see the likers. One at a time; closes on outside click / scroll / Esc. */
  var mcPop: any = null;
  function closePop() {
    if (mcPop && mcPop.parentNode) mcPop.parentNode.removeChild(mcPop);
    mcPop = null;
    document.removeEventListener('click', popOutside, true);
    window.removeEventListener('scroll', closePop, true);
  }
  function popOutside(e: any) { if (mcPop && !mcPop.contains(e.target)) closePop(); }
  function placePop(pop: any, anchor: any) {
    var r = anchor.getBoundingClientRect();
    pop.style.position = 'absolute';
    pop.style.left = Math.max(8, Math.min(window.innerWidth - 244, r.left)) + 'px';
    pop.style.top = (window.scrollY + r.bottom + 6) + 'px';
  }
  /* The share popover: Copy link, X, Facebook, an optional media Download, and the
     native OS share sheet where available. Proper icons, not text links. */
  function showShareMenu(anchor: any, shareUrl: any, mediaDl: any, saveRef?: any) {
    closePop();
    var pop = el('div', 'wall-pop wall-share-pop');
    if (saveRef && state.key) {
      var sv = el('button', 'wall-share-item'); sv.type = 'button';
      var svl = el('span', null, 'Save post'); sv.appendChild(svl);
      sv.addEventListener('click', function (e: any) {
        e.stopPropagation();
        bookmarkToggle(saveRef.kind, saveRef.ref, true).then(function (d: any) {
          svl.textContent = d && d.ok ? 'Saved ✓' : 'Could not save';
          setTimeout(closePop, 900);
        });
      });
      pop.appendChild(sv);
    }
    var copy = el('button', 'wall-share-item'); copy.type = 'button';
    copy.appendChild(mcIcon('copy')); var cl = el('span', null, 'Copy link'); copy.appendChild(cl);
    copy.addEventListener('click', function (e: any) {
      e.stopPropagation();
      var done = function () { cl.textContent = 'Copied ✓'; setTimeout(function () { cl.textContent = 'Copy link'; }, 1400); };
      try { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(shareUrl).then(done).catch(function () { window.prompt('Copy this link:', shareUrl); }); else window.prompt('Copy this link:', shareUrl); }
      catch (err) { window.prompt('Copy this link:', shareUrl); }
    });
    pop.appendChild(copy);
    if (mediaDl) { pop.appendChild(mediaDownloadLink(mediaDl.url, mediaDl.filename, 'Download', 'wall-share-item')); }
    var xa = el('a', 'wall-share-item'); xa.href = 'https://twitter.com/intent/tweet?url=' + encodeURIComponent(shareUrl);
    xa.target = '_blank'; xa.rel = 'noopener noreferrer'; xa.appendChild(mcIcon('x')); xa.appendChild(el('span', null, 'X'));
    xa.addEventListener('click', function (e: any) { e.stopPropagation(); }); pop.appendChild(xa);
    var fb = el('a', 'wall-share-item'); fb.href = 'https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(shareUrl);
    fb.target = '_blank'; fb.rel = 'noopener noreferrer'; fb.appendChild(mcIcon('facebook')); fb.appendChild(el('span', null, 'Facebook'));
    fb.addEventListener('click', function (e: any) { e.stopPropagation(); }); pop.appendChild(fb);
    if ((navigator as any).share) {
      var na = el('button', 'wall-share-item'); na.type = 'button'; na.appendChild(mcIcon('share')); na.appendChild(el('span', null, 'More…'));
      na.addEventListener('click', function (e: any) { e.stopPropagation(); (navigator as any).share({ url: shareUrl, title: 'A post on Mere Catholicity' }).catch(function () {}); closePop(); });
      pop.appendChild(na);
    }
    document.body.appendChild(pop); mcPop = pop;
    placePop(pop, anchor);
    setTimeout(function () { document.addEventListener('click', popOutside, true); window.addEventListener('scroll', closePop, true); }, 0);
  }

  /* The post action bar (the reactions' pill + the comment count, then Like /
     Comment / Share), reused by the feed card AND the media theater rail. The
     tally and my reaction come from the ledger (client/surface.ts): the pill
     of chips in the summary — a tap on a chip gives that reaction, a hover or
     a long press says who — and the Like button lit when my reaction is the
     ❤️. A tap on Like is the ❤️ (mine again withdraws it); a hold on it opens
     the whole bar (Facebook's road to a reaction beyond the heart), as does a
     hold on the card. Returns the element + the button hooks. */
  function wallActions(post: any) {
    var liked = false, haveReacts = false, cn = Number(post.comments) || 0;
    var box = el('div', 'wall-actions');
    var summary = el('div', 'wall-summary');
    var likeSum = el('div', 'wall-sum-likes');
    var cmtSum = el('button', 'wall-sum-comments'); cmtSum.type = 'button';
    summary.appendChild(likeSum); summary.appendChild(cmtSum);
    var btns = el('div', 'wall-btnrow');
    var likeBtn = el('button', 'wall-act wall-like'); likeBtn.type = 'button';
    likeBtn.appendChild(mcIcon('heart')); likeBtn.appendChild(el('span', 'wall-act-lbl', 'Like'));
    var cmtBtn = el('button', 'wall-act'); cmtBtn.type = 'button'; cmtBtn.appendChild(mcIcon('comment')); cmtBtn.appendChild(el('span', 'wall-act-lbl', 'Comment'));
    var shareBtn = el('button', 'wall-act'); shareBtn.type = 'button'; shareBtn.appendChild(mcIcon('share')); shareBtn.appendChild(el('span', 'wall-act-lbl', 'Share'));
    btns.appendChild(likeBtn); btns.appendChild(cmtBtn); btns.appendChild(shareBtn);
    function render() {
      likeBtn.classList.toggle('on', liked); likeBtn.title = liked ? 'Unlike' : 'Like';
      cmtSum.textContent = cn > 0 ? (cn === 1 ? '1 comment' : cn + ' comments') : '';
      cmtSum.style.display = cn > 0 ? '' : 'none';
      summary.style.display = (haveReacts || cn > 0) ? '' : 'none';
    }
    reactRegister('wall', post.id, box, post, function (cells: any[], mine: string) {
      haveReacts = cells.length > 0; liked = mine === '❤️';
      reactPillInto(likeSum, 'wall', post.id, cells, mine);
      render();
    });
    likeBtn.addEventListener('click', function (e: any) {
      e.preventDefault(); e.stopPropagation();
      reactSend('wall', post.id, '❤️');
    });
    armHold(likeBtn, function (at: any) {
      openActs({ node: likeBtn.closest('.wall-post') || box, at: at, items: [],
        react: { current: reactMine('wall', post.id), onPick: function (e: any) { reactSend('wall', post.id, e); } } });
    }, { skip: '', contextmenu: true });
    box.appendChild(summary); box.appendChild(btns);
    render();
    return { el: box, likeBtn: likeBtn, cmtBtn: cmtBtn, shareBtn: shareBtn, cmtSum: cmtSum, bumpComment: function (d: any) { cn = Math.max(0, cn + d); render(); } };
  }

  /* The comment section for a post (list + composer), lazily loaded. Reused inline
     under a card and in the media theater rail. */
  function wallCommentsSection(post: any, onCount: any) {
    var wrap = el('div', 'wall-comments');
    var list = el('div', 'wall-comment-list');
    wrap.appendChild(list);
    var loaded = false;
    function load() {
      if (loaded) return; loaded = true;
      list.appendChild(skeleton('short'));
      fetch(API + '/wall/post/get', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: state.key || '', id: post.id }) })
        .then(function (r) { return r.json(); }).then(function (d) {
          list.textContent = '';
          if (!d || !d.ok) { list.appendChild(el('p', 'comments-status', 'Could not load comments.')); return; }
          (d.comments || []).forEach(function (c: any) { list.appendChild(wallCommentNode(c, post)); });
          /* a reaction's bell lands on the comment (#wc-<id>), lit for a moment */
          var want = /^#wc-\d+$/.test(location.hash) ? list.querySelector(location.hash) : null;
          if (want) {
            try { want.scrollIntoView({ block: 'center' }); } catch (e) { /* fine */ }
            want.classList.add('dm-flash'); setTimeout(function () { want.classList.remove('dm-flash'); }, 1300);
          }
          if (state.myHash) wrap.appendChild(wallComposer('comment', { post: post.id }, function (added: any) {
            if (added) { list.appendChild(wallCommentNode(added, post)); if (onCount) onCount(1); }
          }));
          else wrap.appendChild(loginToInteract('comment on this post'));
        }).catch(function () { list.textContent = ''; list.appendChild(el('p', 'comments-status', 'Could not load comments.')); });
    }
    return { wrap: wrap, load: load };
  }
  /* One media element for a post/comment. Sizes are STANDARDISED: small media
     shows at natural size, large media caps (CSS max-height) so one giant image
     never dominates the scroll. `post` (a post object) makes a click pop the FB
     theater; passing null (comment media) gives a plain viewer. Images and video
     both pop open — video plays there. An always-visible expand button makes the
     "open" affordance clear even over video controls. */
  function wallMediaNode(mediaKey: any, post: any) {
    if (!mediaKey) return null;
    ensureDmStyles();   // board comments render through here too (kit.wallMediaNode)
    var kind = String(mediaKey).split('/')[1];
    var src = API + '/wall/media?key=' + encodeURIComponent(mediaKey);
    var holder = el('div', 'wall-media wall-media-' + (kind === 'v' ? 'video' : kind === 'a' ? 'audio' : 'img'));
    var mel: any;
    var open = function (e: any) { if (e) { e.preventDefault(); e.stopPropagation(); } openMedia(mediaKey, kind, post); };
    if (kind === 'v') {
      mel = el('video', 'wall-media-el'); mel.src = src; mel.controls = true; mel.preload = 'metadata'; mel.playsInline = true;
    } else if (kind === 'a') {
      mel = el('audio', 'wall-media-el'); mel.src = src; mel.controls = true; mel.preload = 'metadata';
    } else {
      mel = el('img', 'wall-media-el'); mel.src = src; mel.alt = ''; mel.loading = 'lazy'; mel.style.cursor = 'pointer';
      mel.addEventListener('click', open);
    }
    mel.addEventListener('error', function () { holder.textContent = ''; holder.appendChild(el('span', 'wall-media-gone', '🖼️ media unavailable')); });
    holder.appendChild(mel);
    /* the expand affordance (image + video; audio has no theater) */
    if (kind !== 'a') {
      var exp = el('button', 'wall-media-expand'); exp.type = 'button'; exp.title = 'Open'; exp.setAttribute('aria-label', 'Open');
      exp.appendChild(mcIcon('expand'));
      exp.addEventListener('click', open);
      holder.appendChild(exp);
    }
    return holder;
  }
  /* True if I may delete this authored item (mine, or I am an admin). */
  function wallCanDelete(authorHash: any) {
    if (window.mcCore) return window.mcCore.canDelete(authorHash, state.myHash, isAdmin());
    return isAdmin() || (!!state.myHash && authorHash === state.myHash);
  }
  function wallDeleteLink(id: any, kind: any, node: any) {
    var a = el('a', 'comment-quote-link wall-del', 'delete');
    a.href = '#';
    a.addEventListener('click', function (e: any) {
      e.preventDefault();
      appConfirm('Delete this ' + (kind === 'comment' ? 'comment' : 'post') + '? This cannot be undone.', { okLabel: 'Delete', danger: true }, function (ok: any) {
        if (!ok) return;
        fetch(API + '/wall/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: state.key, id: id, kind: kind }) })
          .then(function (r) { return r.json(); })
          .then(function (d) { if (d && d.ok && node && node.parentNode) node.parentNode.removeChild(node); })
          .catch(function () {});
      });
    });
    return a;
  }
  /* Edit your own wall post or comment in place (the server re-screens like a
     fresh post). Swaps the rendered body for a small editor and back. */
  function wallEditLink(item: any, kind: any, node: any) {
    var a = el('a', 'comment-quote-link wall-del', 'edit');
    a.href = '#';
    a.addEventListener('click', function (e: any) {
      e.preventDefault();
      var bodyEl = node.querySelector('.comment-body');
      if (!bodyEl || node.querySelector('.wall-edit-box')) return;
      var box = el('div', 'comment-form wall-edit-box');
      var ta = el('textarea', 'comment-text');
      ta.maxLength = 4000; ta.rows = 3; ta.value = String(item.body || '');
      box.appendChild(ta);
      var row = el('div', 'comment-buttons');
      var save = el('button', 'btn btn-send', 'Save'); save.type = 'button';
      var cancel = el('button', 'btn', 'Cancel'); cancel.type = 'button';
      var status = el('p', 'form-status');
      row.appendChild(save); row.appendChild(cancel);
      box.appendChild(row); box.appendChild(status);
      bodyEl.style.display = 'none';
      bodyEl.parentNode.insertBefore(box, bodyEl.nextSibling);
      function closeBox() { box.remove(); (bodyEl as any).style.display = ''; }
      cancel.addEventListener('click', closeBox);
      save.addEventListener('click', function () {
        var body = ta.value.replace(/\s+$/, '');
        if (!body.trim()) { ta.focus(); return; }
        save.disabled = true; status.textContent = 'Saving…';
        fetch(API + '/wall/edit', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: state.key, id: item.id, comment: kind === 'comment' ? 1 : 0, body: body }),
        }).then(function (r) { return r.json(); }).then(function (d) {
          save.disabled = false;
          if (blockedOut(d)) return;
          if (!d || !d.ok) { status.textContent = (d && d.error) || 'Could not save.'; return; }
          item.body = body;
          bodyEl.textContent = '';
          fillBody(bodyEl, body);
          closeBox();
          if (d.status === 'pending') {
            node.appendChild(el('p', 'comments-status', 'Held for review. It will reappear once approved.'));
          }
        }).catch(function () { save.disabled = false; status.textContent = 'Could not save. Try again.'; });
      });
      ta.focus();
    });
    return a;
  }
  /* One comment on a public post. */
  /* A compact like control for a COMMENT (Facebook style): a "Like" text
     button — the ❤️, mine again withdraws — and the reactions' pill beside
     it, both from the ledger; a hold on the button opens the whole bar. */
  function wallCommentLike(c: any) {
    var wrap = el('span', 'wall-clike-wrap');
    var liked = false;
    var btn = el('button', 'wall-clike'); btn.type = 'button';
    var cnt = el('span', 'wall-clike-count');
    function render() { btn.textContent = liked ? 'Liked' : 'Like'; btn.classList.toggle('on', liked); }
    reactRegister('wallc', c.id, wrap, c, function (cells: any[], mine: string) {
      liked = mine === '❤️';
      reactPillInto(cnt, 'wallc', c.id, cells, mine);
      render();
    });
    btn.addEventListener('click', function (e: any) {
      e.preventDefault(); e.stopPropagation();
      reactSend('wallc', c.id, '❤️');
    });
    armHold(btn, function (at: any) {
      openActs({ node: btn.closest('.wall-comment') || wrap, at: at, items: [],
        react: { current: reactMine('wallc', c.id), onPick: function (e: any) { reactSend('wallc', c.id, e); } } });
    }, { skip: '', contextmenu: true });
    wrap.appendChild(btn); wrap.appendChild(cnt);
    return wrap;
  }
  function wallCommentNode(c: any, post: any) {
    /* A blocked author's comment does not exist for you (block unification). */
    if (c.author_hash && c.author_hash !== state.myHash && isBlocked(c.author_hash)) {
      var bph = el('div', 'comment-blocked');
      bph.style.display = 'none';
      (bph as any).hidden = true;
      return bph;
    }
    var node = el('article', 'comment wall-comment');
    node.id = 'wc-' + c.id;   // a reaction's bell lands here (feed.html?post=P#wc-C)
    var head = el('div', 'comment-head');
    wallAvatarInto(head, c.author_hash, c.avatar);
    head.appendChild(authorNode(c.author_hash, c.nick, true, c.faith, c.posts));
    if (c.author_hash && ADMIN_HASHES.indexOf(c.author_hash) !== -1) head.appendChild(el('span', 'comment-admin', '(admin)'));
    var cdate = el('a', 'comment-date', fmtTimeCompact(c.created_at));
    cdate.title = fmtDateTime(c.created_at);
    head.appendChild(cdate);
    var citems: any[] = [];
    if (canEditPost(c.author_hash)) citems.push(wallEditLink(c, 'comment', node));   // yours, or any as an admin
    if (wallCanDelete(c.author_hash)) citems.push(wallDeleteLink(c.id, 'comment', node));
    /* the ⋯ and a hold open the comment's surface; the like control paints the pill */
    if (citems.length || state.myHash) head.appendChild(postMenu({ items: citems, hold: node, react: { target: 'wallc', id: c.id, seed: c, silent: true } }));
    node.appendChild(head);
    node.appendChild(fillBody(el('div', 'comment-body'), c.body));
    if (c.media_key) { var m = wallMediaNode(c.media_key, null); if (m) node.appendChild(m); }
    var actRow = el('div', 'wall-comment-actions');
    actRow.appendChild(wallCommentLike(c));
    node.appendChild(actRow);
    return node;
  }
  function wallPostNode(p: any, expand?: boolean) {
    /* A blocked author's post does not exist for you (block unification);
       the hidden stub keeps every feed list's append/prune bookkeeping. */
    if (p.author_hash && p.author_hash !== state.myHash && isBlocked(p.author_hash)) {
      var bph = el('article', 'comment-blocked');
      bph.id = 'post-' + p.id;
      bph.style.display = 'none';
      (bph as any).hidden = true;
      return bph;
    }
    ensureDmStyles();
    var node = el('article', 'comment wall-post' + (expand ? ' wall-post-detail' : '') + (p.media_key ? ' wall-post-media' : ''));
    node.id = 'post-' + p.id;
    /* In the feed/list (not the detail view), the whole card opens the post's own
       page — but never when the click lands on a control, link, media, the action
       bar, or the comments, and never over a text selection. (Media itself opens
       the theater, handled in wallMediaNode.) */
    if (!expand) {
      node.style.cursor = 'pointer';
      node.addEventListener('click', function (e: any) {
        if (e.target.closest('a, button, video, audio, input, textarea, label, .wall-comments, .wall-media, .wall-actions')) return;
        if (window.getSelection && String(window.getSelection())) return;
        go('feed.html?post=' + p.id);
      });
    }
    var head = el('div', 'comment-head');
    wallAvatarInto(head, p.author_hash, p.avatar);
    head.appendChild(authorNode(p.author_hash, p.nick, true, p.faith, p.posts));
    if (p.author_hash && ADMIN_HASHES.indexOf(p.author_hash) !== -1) head.appendChild(el('span', 'comment-admin', '(admin)'));
    var permalink = el('a', 'comment-date', fmtTimeCompact(p.created_at));
    permalink.title = fmtDateTime(p.created_at);
    permalink.href = 'feed.html?post=' + p.id;
    head.appendChild(permalink);
    var pitems: any[] = [];
    if (p.author_hash && state.myHash && p.author_hash !== state.myHash && p.author_hash !== MERECAT_BOT_HASH) {
      var dm = el('a', 'comment-dm', 'Direct Message'); dm.href = 'messages.html?dm=' + p.author_hash; pitems.push(dm);
    }
    if (canEditPost(p.author_hash)) pitems.push(wallEditLink(p, 'post', node));   // yours, or any as an admin
    if (wallCanDelete(p.author_hash)) pitems.push(wallDeleteLink(p.id, 'post', node));
    /* the ⋯ and a hold open the post's surface; the action bar paints the pill */
    if (pitems.length || state.myHash) head.appendChild(postMenu({ items: pitems, hold: node, react: { target: 'wall', id: p.id, seed: p, silent: true } }));
    node.appendChild(head);
    if (p.body) {
      var bodyEl = fillBody(el('div', 'comment-body'), p.body);
      node.appendChild(bodyEl);
      /* media posts: text is a caption, clamp tight (media is the focus); solo
         text posts get a longer read before "See more". Full text in the detail. */
      if (!expand) node.appendChild(clampBody(bodyEl, p.media_key ? 3 : 9));
    }
    if (p.media_key) { var mm = wallMediaNode(p.media_key, p); if (mm) node.appendChild(mm); }

    var acts = wallActions(p);
    node.appendChild(acts.el);
    var cs = wallCommentsSection(p, acts.bumpComment);
    cs.wrap.style.display = expand ? '' : 'none';
    node.appendChild(cs.wrap);
    var openComments = function () { cs.wrap.style.display = ''; cs.load(); var ta = cs.wrap.querySelector('.comment-form .comment-text') as HTMLElement; if (ta) ta.focus(); };
    acts.cmtBtn.addEventListener('click', function () { if (cs.wrap.style.display === 'none') openComments(); else cs.wrap.style.display = 'none'; });
    acts.cmtSum.addEventListener('click', openComments);
    acts.shareBtn.addEventListener('click', function (e: any) {
      e.stopPropagation();
      showShareMenu(acts.shareBtn, location.origin + '/feed.html?post=' + p.id,
        p.media_key ? { url: API + '/wall/media?key=' + encodeURIComponent(p.media_key), filename: mediaFilename(p.media_key) } : null,
        { kind: 'wall', ref: p.id });
    });
    if (expand) cs.load();
    return node;
  }

  /* A composer for a post (kind 'post') or a comment (kind 'comment', extra.post).
     Reuses mdEditor + preview + drafts + @mentions + Turnstile + a media attach,
     uploading to /wall/media then posting to /wall/post|/wall/comment. onDone gets
     the created row (enriched enough to render) when it went live, or null. */
  function wallComposer(kind: any, extra: any, onDone: any) {
    var form = el('div', 'comment-form wall-composer');
    var ta = el('textarea', 'comment-text');
    ta.maxLength = 4000; ta.rows = kind === 'comment' ? 2 : 3;
    ta.placeholder = kind === 'comment' ? 'Write a comment…' : 'Share something with the community…';
    form.appendChild(mdEditor(ta));
    /* The wall/feed composer keeps a draft like every other composer now: a
       long post must survive a crashed tab. Keyed per place, so the feed box,
       a wall box, and each comment box restore to their own spots. */
    attachDraft(ta, kind === 'comment' ? 'wallc:' + (extra.post || 0) : 'wall:' + location.pathname);
    attachMentions(ta);
    form.appendChild(el('div', 'ts-slot'));
    var btnRow = el('div', 'comment-buttons');
    var send = el('button', 'btn btn-send', kind === 'comment' ? 'Comment' : 'Post'); send.type = 'button';
    btnRow.appendChild(send);
    var pv = previewButton(ta); if (pv) btnRow.appendChild(pv);
    var pendingFile: any = null;
    var wplace = kind === 'comment' ? 'wallc:' + (extra.post || 0) : 'wall:' + location.pathname;
    var fileInput = el('input'); fileInput.type = 'file'; fileInput.style.display = 'none';
    var attach = utilBtnLabel(el('button', 'btn btn-attach'), '📎', 'Attach'); attach.type = 'button';
    var chip = el('span', 'dm-attach-chip'); chip.style.display = 'none';
    function clearAttach() { pendingFile = null; fileInput.value = ''; chip.style.display = 'none'; chip.textContent = ''; mediaStash('del', wplace); }
    attach.addEventListener('click', function () { fileInput.click(); });
    function holdWallFile(out: any) {
      pendingFile = out; chip.textContent = '';
      chip.appendChild(document.createTextNode('📎 ' + (out.name || 'attachment') + ' · ' + fmtBytes(out.size) + '  '));
      var x = el('a', null, '✕'); x.href = '#'; x.addEventListener('click', function (e: any) { e.preventDefault(); clearAttach(); });
      chip.appendChild(x); chip.style.display = '';
    }
    /* Gate + hold one picked (or recorded) file: kind and size from the FEED
       section's served settings, images downscaled in the browser first. The
       held file also enters the media stash so a reload cannot lose it (the
       wall uploads at post time, so only the bytes are kept). */
    function takeWallFile(f: any) {
      mediaCfg().then(function (cfg: any) {
        mediaGateFile(f, cfg, cfg.sections.wall, status).then(function (out: any) {
          if (!out) { fileInput.value = ''; return; }
          status.textContent = '';
          holdWallFile(out);
          mediaStash('put', wplace, { blob: out, name: out.name || 'attachment',
            type: out.type || '', size: out.size, at: Date.now() });
        });
      });
    }
    mediaStash('get', wplace).then(function (rec: any) {
      if (!rec || !rec.at || pendingFile || fileInput.value) return;
      if (Date.now() - rec.at > 86400000) { mediaStash('del', wplace); return; }
      if (!rec.blob) return;
      try {
        holdWallFile(new File([rec.blob], rec.name || 'attachment', { type: rec.type || rec.blob.type || '' }));
      } catch (e) { /* File ctor unavailable: stash stays for a newer engine */ }
    });
    fileInput.addEventListener('change', function () {
      var f = fileInput.files && fileInput.files[0]; if (!f) return;
      takeWallFile(f);
    });
    btnRow.appendChild(attach);
    /* One config tap governs the whole attach row: hidden outright when the
       feed takes no media (the board composer always behaved this way), accept
       derived from the section's own kinds, 🎙 behind its voice flag. */
    mediaCfg().then(function (cfg: any) {
      var sec = cfg.sections.wall;
      if (!cfg.enabled || !sec.kinds.length) { attach.style.display = 'none'; return; }
      fileInput.accept = window.mcCore ? (window.mcCore as any).mediaAcceptFor(sec.kinds) : 'image/*,video/*,audio/*';
      if (sec.voice && sec.kinds.indexOf('audio') !== -1) btnRow.appendChild(voiceControl(form, cfg, sec, status, takeWallFile));
    });
    form.appendChild(chip); form.appendChild(fileInput); form.appendChild(btnRow);
    var status = el('p', 'form-status'); form.appendChild(status);
    ensureDmStyles();
    /* The composer's .ts-slot puts it under the focus net; opening the feed
       mounts nothing. */
    send.addEventListener('click', function () {
      var body = ta.value.replace(/\s+$/, '');
      if (!pendingFile && !body.trim()) { if (ta.mcPreview) ta.mcPreview.off(); ta.focus(); return; }
trace('submit: feed post');
      send.disabled = true; status.textContent = 'Verifying…';
      var file = pendingFile;
      getToken().then(function (token) {
        function post(mediaKey: any) {
          status.textContent = 'Posting…';
          var payload: any = { key: state.key, body: body, token: token, mentions: collectMentions(body) };
          if (mediaKey) payload.media_key = mediaKey;
          var url = API + '/wall/post';
          if (kind === 'comment') { payload.post = extra.post; url = API + '/wall/comment'; }
          return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
            .then(function (r) { return r.json(); })
            .then(function (d) {
              send.disabled = false;
              if (blockedOut(d)) return;
              if (!d || !d.ok) { status.textContent = (d && d.error) || 'Could not post.'; if (window.turnstile) try { turnstile.reset(); } catch (e) {} return; }
              ta.value = ''; if (ta.mcDraftDone) ta.mcDraftDone(); clearAttach();
              if (ta.mcPreview) ta.mcPreview.off();
              if (window.turnstile) try { turnstile.reset(); } catch (e) {}
              if (d.status === 'pending') { status.textContent = 'Held for review. It will appear once approved.'; return; }
              status.textContent = '';
              /* Build a local row to render immediately (author = me). */
              var row = { id: d.id, author_hash: state.myHash, nick: myNick(), avatar: myAvatar(), faith: getFaith(),
                body: body, created_at: Math.floor(Date.now() / 1000), media_key: mediaKey || null, comments: 0,
                likes: 0, liked: false, posts: myPostCount() };
              if (onDone) onDone(row);
            });
        }
        if (file) {
          status.textContent = 'Uploading…';
          var fd = new FormData(); fd.append('key', state.key); fd.append('file', file);
          return fetch(API + '/wall/media', { method: 'POST', body: fd })
            .then(function (r) { return r.json(); })
            .then(function (d) {
              if (!d || !d.ok) { send.disabled = false; status.textContent = (d && d.error) || 'Upload failed.'; return; }
              return post(d.media_key);
            });
        }
        return post(null);
      }).catch(function () { send.disabled = false; status.textContent = 'Could not post. Try again.'; });
    });
    return form;
  }

  /* A reusable infinite-scroll list: `fetcher(cursor)` returns {ok, posts, next}. */
  /* An endless-scroll list. opts.loop (the global Feed) makes it a true endless
     scroll: at the end it starts the feed over from the top, and it CAPS the live
     DOM — pruning the oldest cards (already scrolled past) with exact scroll
     compensation so memory stays bounded while it "always keeps scrolling". A
     profile wall passes no loop (it is finite and stops at the end). */
  function wallInfiniteList(fetcher: any, opts?: any) {
    opts = opts || {};
    var wrap = el('div', 'wall-list');
    var status = el('p', 'comments-status');
    var sentinel = el('div', 'wall-sentinel');
    wrap.appendChild(sentinel); wrap.appendChild(status);
    var next = 0, loading = false, done = false, any = false;
    var MAX_NODES = 80;
    function count() { return wrap.querySelectorAll('.wall-post').length; }
    function fills() { return wrap.scrollHeight > window.innerHeight * 1.3; }
    /* Prune the oldest cards once we exceed the cap, but only ones fully scrolled
       past (their bottom above the viewport), compensating window scroll by the
       exact height removed so the viewport never jumps. */
    function prune() {
      if (!opts.loop) return;
      while (count() > MAX_NODES) {
        var first: any = wrap.firstElementChild;
        if (!first || first === sentinel || first === status) break;
        if (first.getBoundingClientRect().bottom > 0) break;   // still (partly) visible — stop
        var before = document.documentElement.scrollHeight;
        wrap.removeChild(first);
        window.scrollBy(0, document.documentElement.scrollHeight - before);
      }
    }
    function load() {
      if (loading || done) return;
      loading = true; status.textContent = 'Loading…';
      fetcher(next).then(function (d: any) {
        loading = false; status.textContent = '';
        if (blockedOut(d)) return;
        if (!d || !d.ok) { status.textContent = 'Could not load. Reload the page.'; return; }
        (d.posts || []).forEach(function (p: any) { any = true; wrap.insertBefore(wallPostNode(p), sentinel); });
        next = Number(d.next) || 0;
        if (!next) {
          if (!any) { done = true; status.textContent = 'Nothing here yet. Be the first to post.'; }
          else if (opts.loop && fills()) {
            /* endless scroll: mark the wrap-around and re-read from the top */
            wrap.insertBefore(el('div', 'wall-loopmark', '· You’re all caught up — earlier posts follow ·'), sentinel);
            next = 0;
          } else { done = true; }
        }
        prune();
      }).catch(function () { loading = false; status.textContent = 'Could not load. Reload the page.'; });
    }
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (ents) { if (ents.some(function (e) { return e.isIntersecting; })) load(); }, { rootMargin: '600px' });
      io.observe(sentinel);
    } else {
      var more = el('button', 'btn', 'Load more'); more.type = 'button';
      more.addEventListener('click', load); wrap.appendChild(more);
    }
    load();
    return {
      wrap: wrap,
      prepend: function (row: any, live?: boolean) {
        any = true;
        var node = wallPostNode(row);
        if (wrap.querySelector('#post-' + row.id)) return;   // already shown (dedup live vs optimistic)
        if (live) node.classList.add('wall-live-new');
        var before = document.documentElement.scrollHeight;
        wrap.insertBefore(node, wrap.firstChild);
        /* keep the reader's place if they are scrolled down; if near the top the
           new card simply appears (Facebook's "new post floats in"). */
        if (live && window.scrollY > 240) window.scrollBy(0, document.documentElement.scrollHeight - before);
        if (live) setTimeout(function () { node.classList.remove('wall-live-new'); }, 2200);
      },
    };
  }

  function viewFeed() {
    document.title = 'Feed | Community';
    crumb([['Community', 'community.html'], ['Feed']]);
    if (!isMember()) { viewJoin('see and post to the community feed'); return; }
    section.appendChild(el('p', 'board-intro', 'Everything the community is sharing. Your posts appear here and on your profile.'));
    section.appendChild(wallComposer('post', {}, function (row: any) { if (row && list) list.prepend(row); }));
    var list = wallInfiniteList(function (cursor: any) {
      return fetch(API + '/wall/feed', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: state.key, cursor: cursor }) }).then(function (r) { return r.json(); });
    }, { loop: true });
    section.appendChild(list.wrap);
    /* Live: a new post floats straight to the top over the WebSocket (we get only
       the id on the wire, so fetch the row and prepend it, keeping the reader's
       place if they are scrolled down). New COMMENTS just bump the count when
       their post is on screen; otherwise they are ignored here. */
    var seenLive: Record<string, boolean> = {};
    state.onLiveWall = function (m: any) {
      if (!m || m.t !== 'wall-post' || !m.id || seenLive[m.id]) return;
      seenLive[m.id] = true;
      if (list.wrap.querySelector('#post-' + m.id)) return;
      fetch(API + '/wall/post/get', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: state.key || '', id: m.id }) })
        .then(function (r) { return r.json(); })
        .then(function (d: any) { if (d && d.ok && d.post) list.prepend(d.post, true); })
        .catch(function () {});
    };
  }
  function bind() {
    ADMIN_HASHES = B.ADMIN_HASHES;
    API = B.API;
    MERECAT_BOT_HASH = B.MERECAT_BOT_HASH;
    appConfirm = B.appConfirm;
    armHold = B.armHold;
    attachDraft = B.attachDraft;
    attachMentions = B.attachMentions;
    authorNode = B.authorNode;
    blockedOut = B.blockedOut;
    bookmarkToggle = B.bookmarkToggle;
    cachedJson = B.cachedJson;
    canEditPost = B.canEditPost;
    clampBody = B.clampBody;
    collectMentions = B.collectMentions;
    crumb = B.crumb;
    el = B.el;
    ensureDmStyles = B.ensureDmStyles;
    fillBody = B.fillBody;
    fmtBytes = B.fmtBytes;
    fmtDateTime = B.fmtDateTime;
    fmtTimeCompact = B.fmtTimeCompact;
    getFaith = B.getFaith;
    getToken = B.getToken;
    go = B.go;
    isAdmin = B.isAdmin;
    isBlocked = B.isBlocked;
    isMember = B.isMember;
    loginToInteract = B.loginToInteract;
    mdEditor = B.mdEditor;
    mediaCfg = B.mediaCfg;
    mediaDownloadLink = B.mediaDownloadLink;
    mediaGateFile = B.mediaGateFile;
    mediaStash = B.mediaStash;
    myAvatar = B.myAvatar;
    myNick = B.myNick;
    myPostCount = B.myPostCount;
    openActs = B.openActs;
    openMedia = B.openMedia;
    postMenu = B.postMenu;
    reactMine = B.reactMine;
    reactPillInto = B.reactPillInto;
    reactRegister = B.reactRegister;
    reactSend = B.reactSend;
    previewButton = B.previewButton;
    profileHref = B.profileHref;
    section = B.section;
    skeleton = B.skeleton;
    state = B.state;
    trace = B.trace;
    utilBtnLabel = B.utilBtnLabel;
    viewJoin = B.viewJoin;
    voiceControl = B.voiceControl;
  }
  /* What ran at boot time in the old file, in the old order, after every
     module is bound: listeners, deferred initializers. */
  function run() {
  }
  return { bind, run, exports: { SOCIAL_LABEL, SOCIAL_ORDER, closePop, mcIcon, mcSocialIcon, mediaFilename, showShareMenu, socialCfg, socialRead, viewFeed, wallActions, wallAvatarInto, wallCommentsSection, wallComposer, wallInfiniteList, wallMediaNode, wallPostNode } };
}
