/* Identity and profile (Wave F, 2026-09-11 — moved out of comments.ts
   verbatim): the key box and identity drawer, faith, mute/block, prefs, the
   profile card and editor, avatars, notifications. */
import type { Boot } from './boot';

export function installProfile(B: Boot) {
  /* Names this module takes from the boot — the root's helpers and the other
     modules' exports — bound in bind() once every module is installed, so
     order of installation never matters and every body reads as it did. */
  let ADMIN_HASHES: any;
  let API: any;
  let BOARD: any;
  let DM_CACHE: any;
  let MERECAT_BOT_HASH: any;
  let SOCIAL_LABEL: any;
  let SOCIAL_ORDER: any;
  let adminProfileEditor: (card: any, hash: any, prof: any) => any;
  let appConfirm: (msg: any, opts: any, cb: any) => any;
  let asset: any;
  let badgeChanged: () => any;
  let bootSig: any;
  let buildFingerprint: (m: any, identities: any) => any;
  let cachedJson: (url: any, init: any, ttl: any) => Promise<any>;
  let catByKey: (key: any) => any;
  let clearKey: () => any;
  let crumb: (parts: any) => any;
  let displayName: (hash: any) => any;
  let dmCacheGet: () => any;
  let dmSeenLabel: (epoch: any) => any;
  let dmUnreadCheck: (force?: boolean) => any;
  let el: (tag: string, cls?: string | null, text?: string | number | null) => any;
  let openImage: (src: any, filename: any) => any;
  let enableMemberLive: () => any;
  let ensureDmStyles: () => any;
  let ensureEmojiStyles: () => any;
  let fetchRetry: (url: string, opts: RequestInit | undefined, delays: number[], onRetry?: () => void) => Promise<Response>;
  let fmtDateTime: (epoch: any) => any;
  let fmtTimeCompact: (epoch: any) => any;
  let freshOpts: () => RequestInit | undefined;
  let freshParam: (sep: any) => any;
  let getToken: () => Promise<any>;
  let go: (href: string, replace?: boolean) => any;
  let isAdmin: () => any;
  let load: () => any;
  let makeKey: () => any;
  let mcSocialIcon: (name: any) => any;
  let pageBar: (total: number, per: number, curPage: number, hrefFor: ((n: number) => string) | null, onGo?: (n: number) => void) => HTMLElement | null;
  let playSound: (name: any, loop?: any) => any;
  let rankLine: (posts: any) => any;
  let readEase: any;
  let readMark: any;
  let readThrottled: any;
  let route: () => any;
  let section: any;
  let setKey: (key: any) => any;
  let sha256hex: (text: any) => Promise<string>;
  let skelInto: (node: any, kind?: string) => any;
  let skeleton: (kind?: string) => any;
  let socialCfg: () => Promise<any>;
  let socialRead: () => any;
  let stampFresh: () => any;
  let state: any;
  let trace: (why: string) => any;
  let wallComposer: (kind: any, extra: any, onDone: any) => any;
  let wallInfiniteList: (fetcher: any, opts?: any) => any;
  let wallPostNode: (p: any, expand?: boolean) => any;
  let warmToken: () => any;
  /* The faith declaration a member picks at signup and may change in their
     profile. Codes are stored; labels and order come from the PureScript
     kernel (Domain.Faith via window.mcCore), the same source the worker
     reads — single-sourced, nothing to keep in step by hand. */
  var FAITH_STORE = 'mc-faith';

  /* Faith code↔label + display order, single-sourced from the PureScript
     Domain.Faith via window.mcCore. The bundle is required (Wave F, 2026-08-01):
     the shell always installs mcCore before booting this client. */
  function faithLabel(code: any) {
    return window.mcCore!.faithLabel(code) || '';
  }
  function faithCodes() {
    return window.mcCore!.faiths.map(function (f) { return f.code; });
  }

  function profileHref(hash: any) {
    return 'profile.html?u=' + hash;
  }

  /* The member's declared faith lives in localStorage from signup and rides
     along with each post; the profile edit is the authoritative changer. */
  function getFaith() {
    try { var v = localStorage.getItem(FAITH_STORE); return faithLabel(v) ? v : ''; } catch (e) { return ''; }
  }
  function setFaith(code: any) {
    try { if (faithLabel(code)) localStorage.setItem(FAITH_STORE, code); } catch (e) {}
  }

  /* Mute is self-moderation for a pseudonymous room: a purely local list of
     hashes whose posts collapse for you alone. No server, orthogonal to the DM
     block (which holds their messages to you) — this only hides their forum
     posts, on this browser. */
  var MUTED_STORE = 'mc-muted';
  function getMuted() {
    try { var a = JSON.parse(localStorage.getItem(MUTED_STORE) as string); return Array.isArray(a) ? a : []; } catch (e) { return []; }
  }
  /* The librarian cannot be muted: it speaks only when summoned, so a muted
     bot would read as a broken summons (a stale stored mute is ignored too). */
  function isMuted(hash: any) {
    if (window.mcCore) return window.mcCore.isMuted(MERECAT_BOT_HASH, hash, getMuted());
    if (hash === MERECAT_BOT_HASH) return false;
    return !!hash && getMuted().indexOf(hash) !== -1;
  }
  /* Mutes follow the member now: the list rides the prefs row server-side
     (like blocks), so a second device sees the same quiet. localStorage stays
     the fast local truth; the server copy is merged in by loadPrefs and
     written through here, best effort. */
  function syncMutedUp() {
    if (!state.key) return;
    fetch(API + '/prefs', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: state.key, set: { muted: getMuted().slice(0, 200) } }),
    }).catch(function () { /* best effort */ });
  }
  function toggleMute(hash: any) {
    if (!hash) return false;
    var added;
    if (window.mcCore) {
      var r = window.mcCore.toggleMute(hash, getMuted());
      try { localStorage.setItem(MUTED_STORE, JSON.stringify(r.list)); } catch (e) {}
      added = r.added;
    } else {
      var a = getMuted(), i = a.indexOf(hash);
      if (i === -1) a.push(hash); else a.splice(i, 1);
      try { localStorage.setItem(MUTED_STORE, JSON.stringify(a)); } catch (e) {}
      added = i === -1;
    }
    syncMutedUp();
    return added;
  }
  /* BLOCK is the ONE member-facing control now (the owner's 2026-08-03
     ruling: "User can block. User can unblock. that is it."). One act closes
     both doors — their messages to you (the DM shadow-block, server-side in
     dm_blocks) and their posts/profile in your view (the hide-list above,
     server-synced through /prefs). The old member-facing "mute" surface is
     retired; the list machinery survives underneath as block's hide half.
     Admin moderation (locks, bans, shadow bans, delete) is a separate,
     untouched world. */
  function isBlocked(hash: any) { return isMuted(hash); }
  function setBlock(hash: any, on: any, done?: any) {
    if (!hash || hash === MERECAT_BOT_HASH || hash === state.myHash) { if (done) done(); return; }
    var a = getMuted(), i = a.indexOf(hash);
    if (on && i === -1) a.push(hash);
    if (!on && i !== -1) a.splice(i, 1);
    try { localStorage.setItem(MUTED_STORE, JSON.stringify(a)); } catch (e) { /* hide-list is best effort */ }
    syncMutedUp();
    fetch(API + '/dm/block', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: state.key, hash: hash, blocked: !!on }),
    }).then(function (r) { return r.json(); })
      .catch(function () { /* the hide half already stands; the DM half heals on the next toggle */ })
      .then(function () { if (done) done(); });
  }
  var BLOCK_CONFIRM = 'Block this member? They can no longer message you (they are never told), and their posts and profile are hidden from you. You can unblock them any time in Settings or from their profile.';
  /* The "I hold to:" radio group, one row per faith, used at signup and in the
     profile editor. onChange fires with the chosen code. */
  function faithRadios(current: any, onChange: any) {
    var wrap = el('div', 'faith-radios');
    wrap.appendChild(el('div', 'faith-legend', 'I hold to:'));
    faithCodes().forEach(function (code) {
      var lab = el('label', 'faith-option');
      var r = el('input');
      r.type = 'radio';
      r.name = 'mc-faith-choice';
      r.value = code;
      if (code === current) r.checked = true;
      r.addEventListener('change', function () { if (r.checked && onChange) onChange(code); });
      lab.appendChild(r);
      lab.appendChild(document.createTextNode(' ' + faithLabel(code)));
      wrap.appendChild(lab);
    });
    return wrap;
  }

  /* Admin status comes from the server (state.myAdmin, off your own profile).
     Before that profile has loaded the built-in list is only a hint, so a known
     admin's controls are not withheld for a beat; once it loads the server is
     the sole authority, so an admin removed elsewhere loses the controls here
     too. The board re-renders when the answer changes (see loadMyProfile). */
  function authSig() {
    return { hasKey: state.key, hasHash: state.myHash, profileLoaded: state.profileLoaded,
      myAdmin: state.myAdmin, hint: ADMIN_HASHES.indexOf(state.myHash) !== -1 };
  }
  /* A resolved, logged-in member (key + hash). Single-sources the "is member"
     decision (Domain.Auth.isMember) that was inlined as the raw key-and-hash
     conjunction across the board; the classic conjunction is the no-bundle fallback. */
  function isMember() {
    if (window.mcCore) return window.mcCore.authIsMember(authSig());
    return !!(state.key && state.myHash);
  }

  /* Callbacks waiting on the reader's own profile fetch, so a view that renders
     before admin status is known can redraw once it lands. */
  B.profileWaiters = [];

  /* Avatar presets: the ready-made gallery art, grouped into packs by a
     generated manifest and fetched once on first use, so a profile view never
     pays for it. The images themselves are same-origin static files, drawn
     into the avatar canvas exactly like an uploaded photo. */
  var avatarPresetsPromise: any = null;
  function loadAvatarPresets(): Promise<any> {
    if (avatarPresetsPromise) return avatarPresetsPromise;
    avatarPresetsPromise = fetch(asset('avatars/presets/index.json'))
      .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
      .then(function (d) { return (d && d.packs) || []; })
      .catch(function (e) { avatarPresetsPromise = null; throw e; });
    return avatarPresetsPromise;
  }

  /* The avatar preset gallery: the same panel chrome as the emoji picker (search
     box, pack tabs, inner-scrolling grid), but each tile is a bigger image on the
     parchment tile so it previews the avatar it will become. onPick(path, name)
     fires with the chosen image. The manifest loads lazily on first open. */
  function buildAvatarGallery(onPick: any) {
    ensureEmojiStyles();
    var panel = el('div', 'emoji-panel av-panel');
    panel.hidden = true;
    var search = el('input', 'emoji-search');
    search.type = 'search'; search.placeholder = 'Search avatars...';
    var srow = el('div', 'emoji-search-row'); srow.appendChild(search); panel.appendChild(srow);
    var tabs = el('div', 'emoji-tabs'), body = el('div', 'emoji-body av-body');
    panel.appendChild(tabs); panel.appendChild(body);
    var packs: any = null, active: any = null, tabBtns: Record<string, any> = {};
    function tile(name: any, path: any) {
      var b = el('button', 'emoji-cell av-cell'); b.type = 'button'; b.title = name;
      var im = el('img'); im.src = path; im.alt = name; im.loading = 'lazy';
      b.appendChild(im);
      b.addEventListener('click', function () { onPick(path, name); });
      return b;
    }
    function grid(items: any) { var g = el('div', 'emoji-grid av-grid'); items.forEach(function (it: any) { g.appendChild(tile(it[0], it[1])); }); return g; }
    function mark() { if (packs) packs.forEach(function (p: any) { tabBtns[p.slug].className = 'emoji-tab' + (p.slug === active ? ' emoji-tab-on' : ''); }); }
    function draw() {
      body.textContent = '';
      if (!packs) { body.appendChild(skeleton('short')); return; }
      var q = search.value.trim().toLowerCase();
      if (q) {
        var res: any[] = [];
        packs.forEach(function (p: any) { p.items.forEach(function (it: any) { if (it[0].indexOf(q) !== -1) res.push(it); }); });
        if (!res.length) { body.appendChild(el('p', 'emoji-empty', 'No matches.')); return; }
        body.appendChild(grid(res.slice(0, 300)));
        return;
      }
      var pack: any = null;
      packs.forEach(function (p: any) { if (p.slug === active) pack = p; });
      if (pack) body.appendChild(grid(pack.items));
    }
    function build() {
      tabs.textContent = '';
      packs.forEach(function (p: any) {
        var b = el('button', 'emoji-tab', p.label); b.type = 'button';
        b.addEventListener('click', function () { active = p.slug; search.value = ''; mark(); draw(); });
        tabBtns[p.slug] = b; tabs.appendChild(b);
      });
      if (!active && packs.length) active = packs[0].slug;
      mark(); draw();
    }
    search.addEventListener('input', draw);
    panel.openPanel = function () {
      panel.hidden = false;
      if (packs) { mark(); draw(); }
      else {
        draw();
        loadAvatarPresets().then(function (pk: any) { packs = pk; build(); })
          .catch(function () { body.textContent = ''; body.appendChild(el('p', 'emoji-empty', 'The gallery could not be loaded. Try again in a moment.')); });
      }
      try { if (window.matchMedia && window.matchMedia('(hover: none)').matches) search.focus(); } catch (e) {}
    };
    panel.closePanel = function () { panel.hidden = true; };
    panel.toggle = function () { if (panel.hidden) panel.openPanel(); else panel.closePanel(); };
    return panel;
  }

  /* The same drawer on a profile, keyed by the identity's hash rather than a
     comment id, so an admin viewing anyone's profile gets every control the
     post drawer has: trust, lock, per-IP ban and ban-all, delete. Admin-only,
     here and at the server. */
  function annotateProfileMeta(hash: any, card: any) {
    if (!isAdmin()) return;
    if (card.querySelector('.comment-meta')) return;
    fetch(API + '/meta', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hash: hash, key: state.key }),
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (!d.ok || !d.meta || !d.meta.length || card.querySelector('.comment-meta')) return;
      card.appendChild(buildFingerprint(d.meta[0], d.identities));
    }).catch(function () {});
  }

  /* The notification badge rides the same one-count, ninety-second-cached
     mechanism as the DM badge: a reply in a watched thread or an @mention. */
  var NOTIF_CACHE = 'mc-notif-unread';
  function notifCacheGet() {
    try { return JSON.parse(localStorage.getItem(NOTIF_CACHE) as string) || null; } catch (e) { return null; }
  }
  function notifCacheSet(n: any) {
    try { localStorage.setItem(NOTIF_CACHE, JSON.stringify({ n: n, at: Date.now() })) } catch (e) {}
    renderIdentity();
    badgeChanged();
  }
  function notifUnreadCheck(force?: boolean) {
    if (!state.key) return;
    var c = notifCacheGet();
    if (!force && c && Date.now() - c.at < 90000) return;
    try { localStorage.setItem(NOTIF_CACHE, JSON.stringify({ n: c ? c.n : 0, at: Date.now() })) } catch (e) {}
    readMark();
    fetch(API + '/notifications/unread', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: state.key }),
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (blockedOut(d)) return;
      if (readThrottled(d)) readEase();
      if (d.ok) notifCacheSet(d.unread);
    }).catch(function () {});
  }
  function liveNotifBadge() {
    if ((window as any).mcBadges) return;   // the shell's badges (app/badges.ts) hear the frame on every page — no second read, no second bell
    playSound('bell'); clearTimeout(B.notifBadgeT); B.notifBadgeT = setTimeout(function () { notifUnreadCheck(true); }, 300);
  }
  function onLiveNotif() {
    /* The notifications list (McNotifications) reloads itself and marks read;
       elsewhere, just ring the badge. */
    if (new URLSearchParams(location.search).get('notifications') === '1') return;
    liveNotifBadge();
  }

  /* A locked identity or a banned network, discovered on any keyed call:
     forget the key, raise a message that outlives the redirect, and land on
     the terms page. This is what "logged out and cannot come back" looks like. */
  function blockedOut(d: any) {
    if (!d || !d.blocked) return false;
    try {
      localStorage.setItem('mc-flash', window.mcCore
        ? window.mcCore.blockedMessage(d.blocked)
        : (d.blocked === 'ipban'
          ? 'Your network is banned from merecatholicity.com for violating the Terms and Conditions.'
          : 'This identity has been locked by the moderators for violating the Terms and Conditions.'));
    } catch (e) {}
    clearKey();
    state.key = '';
    state.myHash = '';
    try { localStorage.removeItem(DM_CACHE); } catch (e) {}
    try { localStorage.removeItem(NOTIF_CACHE); } catch (e) {}
    /* Deliberately a FULL load, not go(): the identity this page was built
       around has just been revoked, and a fresh document is the only way to
       be sure nothing keyed to it survives — an open live socket, a cached
       view, a half-rendered composer. Everywhere else the hop is soft. */
    location.href = 'terms.html';
    return true;
  }

  /* ---- Identity UI ---- */

  function renderIdentity() {
    var box = section.querySelector('.comment-identity');
    if (!box) return;
    box.textContent = '';
    /* The -in / -out modifier lets the mobile CSS hide the redundant logged-in nav
       line (every link is in the tab bar / app-bar / settings sheet) while keeping
       the logged-out create line, which is the only join path on article pages. */
    var loggedIn = !!(isMember());
    var line = el('p', 'identity-line ' + (loggedIn ? 'identity-line-in' : 'identity-line-out'));
    if (loggedIn && !box.classList.contains('comment-identity-nav')) {
      /* Readability standard: the logged-in five-link utilities row renders
         ONLY into the box the board index marks (comment-identity-nav). Every
         other page already reaches those doors through the deskbar/tab-bar and
         the gear, and the duplicated pill rows were half the visual noise on
         category/topic pages. A hidden stamp keeps every standing
         MutationObserver on .comment-identity firing on login/logout; the
         logged-out create-identity branch below is untouched everywhere (it is
         the one join path on article pages). */
      var stamp = el('span', 'identity-stamp');
      stamp.hidden = true;
      box.appendChild(stamp);
      return;
    }
    if (loggedIn) {
      /* First line: where to go, grouped — your activity (the two badge feeds),
         then people (you, then the roster), then search over it all. */
      var notifLink = el('a', 'identity-action', 'Notifications');
      notifLink.href = 'community.html?notifications=1';
      line.appendChild(notifLink);
      var nc = notifCacheGet();
      if (nc && nc.n > 0) line.appendChild(el('span', 'dm-unread', ' (' + nc.n + ')'));
      line.appendChild(document.createTextNode(' · '));
      var inboxLink = el('a', 'identity-action', 'Inbox');
      inboxLink.href = 'messages.html';
      line.appendChild(inboxLink);
      var dmc = dmCacheGet();
      if (dmc && dmc.n > 0) line.appendChild(el('span', 'dm-unread', ' (' + dmc.n + ')'));
      line.appendChild(document.createTextNode(' · '));
      var viewProfileLink = el('a', 'identity-action', 'View My Profile');
      viewProfileLink.href = profileHref(state.myHash);
      line.appendChild(viewProfileLink);
      line.appendChild(document.createTextNode(' · '));
      var usersLink = el('a', 'identity-action', 'User List');
      usersLink.href = 'community.html?users=1';
      line.appendChild(usersLink);
      line.appendChild(document.createTextNode(' · '));
      var searchLink = el('a', 'identity-action', 'Search');
      searchLink.href = 'community.html?q=';
      line.appendChild(searchLink);
      /* merecat is NOT listed here — it has its own tab in the app rail / bottom
         bar and is clearly marked there; a second entry on this line is redundant. */
      /* The platform-level identity controls (who you are, Show my key, Logout)
         moved OUT of the forum line into the platform chrome / Settings gear, now
         that the site is a platform and not only a forum. Forum controls stay. */
    } else {
      line.appendChild(document.createTextNode(state.anonAllowed
        ? 'Commenting anonymously. '
        : 'To comment, create an identity. One click, no signup. '));
      /* Both actions open the app-native onboarding modal (a slide-up sheet on
         phones, a centered popup on desktop) — the same slick animation the tab
         gates use. Only ?app=0 (no shell) falls back to the classic inline drawer.
         "I have a key" opens the modal straight to its paste-your-key box. */
      line.appendChild(identityAction('Create an identity', function () {
        if (window.mcOnboard) window.mcOnboard();
        else showAgreeBox();
      }));
      line.appendChild(document.createTextNode(' · '));
      line.appendChild(identityAction('I have a key', function () {
        if (window.mcOnboard) window.mcOnboard(null, { key: true });
        else showPasteBox();
      }));
    }
    box.appendChild(line);
  }

  function identityAction(label: any, onClick: any) {
    var a = el('a', 'identity-action', label);
    a.href = '#';
    a.addEventListener('click', function (e: any) { e.preventDefault(); onClick(); });
    return a;
  }

  /* Signup is one checkbox deep. Agreeing to the terms is what creates
     the identity, so every commenter has agreed by construction. */
  function showAgreeBox() {
    var box = section.querySelector('.key-box') as HTMLElement;
    box.textContent = '';
    box.appendChild(el('p', 'key-note',
      'Membership is open to North America, Europe, Russia, Israel, Korea, Japan, and Oceania. ' +
      'Elsewhere it is declined, for security, spam, relevance, and quality.'));
    /* A faith declaration is required to join: one of the three welcomed here.
       It is kept in the browser and shown on your posts and profile. */
    var chosenFaith = getFaith() || '';
    box.appendChild(faithRadios(chosenFaith, function (code: any) { chosenFaith = code; refresh(); }));
    var label = el('label', 'agree-row');
    var check = el('input');
    check.type = 'checkbox';
    label.appendChild(check);
    label.appendChild(document.createTextNode(' I agree to the '));
    var terms = el('a', null, 'Terms & Conditions');
    terms.href = 'terms.html';
    terms.target = '_blank';
    label.appendChild(terms);
    box.appendChild(label);
    /* Adults only (terms + privacy): confirming 18+ is required to join. */
    var ageLabel = el('label', 'agree-row');
    var ageCheck = el('input');
    ageCheck.type = 'checkbox';
    ageLabel.appendChild(ageCheck);
    ageLabel.appendChild(document.createTextNode(' I am at least 18 years old.'));
    box.appendChild(ageLabel);
    var row = el('div', 'key-row');
    var create = el('button', 'btn btn-send key-copy', 'Create');
    create.type = 'button';
    create.disabled = true;
    function refresh() { create.disabled = !(check.checked && ageCheck.checked && chosenFaith); }
    check.addEventListener('change', refresh);
    ageCheck.addEventListener('change', refresh);
    create.addEventListener('click', function () {
      if (!check.checked || !ageCheck.checked || !chosenFaith) return;
      try { localStorage.setItem('mc-agreed-at', String(Date.now())); } catch (e) {}
      setFaith(chosenFaith);
      var key = makeKey();
      setKey(key);
      state.key = key;
      sha256hex(key).then(function (h) {
        state.myHash = h;
        enableMemberLive();
        renderIdentity();
        showKeyBox();
      });
    });
    row.appendChild(create);
    box.appendChild(row);
    box.appendChild(identityAction('Cancel', hideKeyBox));
    box.hidden = false;
  }

  function showKeyBox() {
    var box = section.querySelector('.key-box') as HTMLElement;
    box.textContent = '';
    var note = el('p', 'key-note');
    note.appendChild(el('strong', null, 'Your key. '));
    note.appendChild(document.createTextNode(
      'This is your identity. Save it somewhere private to log in on ' +
      'another device or after this browser forgets it. Anyone who has it can post under your name.'));
    box.appendChild(note);
    var row = el('div', 'key-row');
    var input = el('input', 'key-input');
    input.type = 'text';
    input.readOnly = true;
    input.value = state.key;
    input.addEventListener('focus', function () { input.select(); });
    row.appendChild(input);
    var copy = el('button', 'btn btn-send key-copy', 'Copy');
    copy.type = 'button';
    copy.addEventListener('click', function () {
      navigator.clipboard.writeText(state.key).then(function () {
        copy.textContent = 'Copied';
        setTimeout(function () { copy.textContent = 'Copy'; }, 1500);
      }, function () { input.focus(); });
    });
    row.appendChild(copy);
    box.appendChild(row);
    box.appendChild(identityAction('Hide', hideKeyBox));
    box.hidden = false;
  }

  function showPasteBox() {
    var box = section.querySelector('.key-box') as HTMLElement;
    box.textContent = '';
    box.appendChild(el('p', 'key-note', 'Paste the key you saved.'));
    var row = el('div', 'key-row');
    var input = el('input', 'key-input');
    input.type = 'text';
    row.appendChild(input);
    var use = el('button', 'btn btn-send key-copy', 'Use it');
    use.type = 'button';
    use.addEventListener('click', function () {
      var key = input.value.trim();
      if (key.length < 16) { input.focus(); return; }
      setKey(key);
      state.key = key;
      /* Fresh login must be re-checked against lock/ban at once, not ride a
         stale badge cache. */
      try { localStorage.removeItem(DM_CACHE); } catch (e) {}
      /* On the board the cleanest login is the og one: reload, and the
         current view returns with the right name, buttons, and links. */
      trace('key import -> reload'); if (BOARD) { location.reload(); return; }
      sha256hex(key).then(function (h) {
        state.myHash = h;
        enableMemberLive();
        hideKeyBox();
        renderIdentity();
        load();
        dmUnreadCheck();
      });
    });
    row.appendChild(use);
    box.appendChild(row);
    box.appendChild(identityAction('Cancel', hideKeyBox));
    box.hidden = false;
  }

  /* The identity mint + login, factored out for the app-native onboarding sheet
     (window.mcKit.mintIdentity / loginWithKey, called from app/appchrome.js on
     phones). Same steps as showAgreeBox's Create and showPasteBox's Use it; the
     sheet reloads on success (like the classic BOARD login), so these only mint,
     store, set state, and resolve — they do not repaint. */
  function mintIdentity(faith: any) {
    try { localStorage.setItem('mc-agreed-at', String(Date.now())); } catch (e) {}
    if (faith) setFaith(faith);
    var key = makeKey();
    setKey(key);
    state.key = key;
    return sha256hex(key).then(function (h) {
      state.myHash = h;
      enableMemberLive();
      return { key: key, hash: h };
    });
  }
  function loginWithKey(key: any) {
    key = String(key || '').trim();
    if (key.length < 16) return Promise.resolve(false);
    setKey(key);
    state.key = key;
    try { localStorage.removeItem(DM_CACHE); } catch (e) {}
    return sha256hex(key).then(function (h) {
      state.myHash = h;
      enableMemberLive();
      return true;
    });
  }

  function hideKeyBox() {
    var box = section.querySelector('.key-box') as HTMLElement;
    box.hidden = true;
    box.textContent = '';
  }

  /* Load the signed-in reader's own nick once, so their name reads the same
     to them as to everyone else (the identity line, the post buttons). Purely
     cosmetic: it only refreshes label text, never the login state. */
  function loadMyProfile() {
    if (!state.myHash) return;
    cachedJson(API + '/profile?hash=' + state.myHash + '&fresh=1', undefined, 180000)
      .then(function (d) {
        /* Learn admin status from the server, the sole authority. Compare the
           effective answer against the pre-load hint: if it changed (an admin
           granted or revoked elsewhere), re-render the whole board once so the
           controls appear or vanish, and that redraw covers any waiting view so
           drop the waiters. Otherwise refresh the identity line and let a
           waiting admin view redraw itself. */
        var wasAdmin = isAdmin();
        if (d && d.ok && d.profile) {
          state.myNick = d.profile.nick || '';
          state.myAdmin = !!d.profile.admin;
        }
        state.profileLoaded = true;
        /* Bridge admin status to the platform chrome (the Settings gear reads this
           flag to show the admin-only "Administrative options" entry). */
        try { localStorage.setItem('mc-admin', isAdmin() ? '1' : '0'); } catch (e) {}
        if (BOARD && isAdmin() !== wasAdmin) { B.profileWaiters = []; route(); return; }
        if (section.querySelector('.comment-identity')) renderIdentity();
        flushProfileWaiters();
      })
      .catch(function () { state.profileLoaded = true; flushProfileWaiters(); });
  }

  function flushProfileWaiters() {
    var ws = B.profileWaiters;
    B.profileWaiters = [];
    ws.forEach(function (cb: any) { cb(); });
  }

  /* A profile view. Your own is read/write; everyone else's is read-only. It
     is reached from the View-profile link and from every clickable username. */
  /* Resolve a custom @handle to its owner's hash, then render the profile the
     normal way (both the classic path and the Lit view take a hash). The URL
     keeps the handle so the shared link stays pretty. */
  function viewProfileByHandle(handle: any) {
    crumb([['Community', 'community.html'], ['Profile']]);
    var status = skeleton('card');
    section.appendChild(status);
    fetchRetry(API + '/profile?handle=' + encodeURIComponent(handle) + freshParam('&'), freshOpts(), [1000, 3000])
      .then(function (r) { return r.json(); })
      .then(function (d) {
        section.textContent = '';
        if (!d.ok || !d.profile || !d.profile.hash) {
          section.appendChild(el('p', 'comments-status', 'No such profile.'));
          return;
        }
        viewProfile(d.profile.hash);
      })
      .catch(function () {
        /* Replace the skeleton outright — writing text INTO it would leave the
           shimmer wrapper around a sentence. */
        status.replaceWith(el('p', 'comments-status',
          'The profile could not be loaded. Check your connection and reload the page.'));
      });
  }

  function viewProfile(hash: any) {
    if (window.mcViews && window.mcViews.profile) return window.mcViews.profile(section, window.mcKit, hash);
    document.title = 'Profile | Community';
    crumb([['Community', 'community.html'], ['Profile']]);
    if (!/^[0-9a-f]{64}$/.test(String(hash))) {
      section.appendChild(el('p', 'comments-status', 'No such profile.'));
      return;
    }
    var editable = !!state.key && hash === state.myHash;
    var card = el('div', 'profile');
    section.appendChild(card);
    var status = skeleton('card');
    section.appendChild(status);
    /* Editing is a write, so it gets the same Turnstile gate as posting. The
       slot lives outside the card so it survives the read/edit toggle — and it
       is only the net's marker: nothing mounts until the editor opens
       (editProfile warms) or a field is focused. */
    if (editable) section.appendChild(el('div', 'ts-slot'));
    fetchRetry(API + '/profile?hash=' + hash + freshParam('&'), freshOpts(), [1000, 3000])
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok) throw new Error(d.error || 'failed');
        status.remove();
        renderProfile(card, d.profile, editable);
        /* Admin defense: edit or clean another member's profile in place —
           the middle ground between doing nothing and lock/ban/delete. Only
           on profiles that are not your own; the server refuses non-admins
           regardless, so hiding this is courtesy, not the lock. */
        if (!editable && isAdmin()) adminProfileEditor(card, hash, d.profile || {});
      })
      .catch(function () {
        /* Replace the skeleton outright — writing text INTO it would leave the
           shimmer wrapper around a sentence. */
        status.replaceWith(el('p', 'comments-status',
          'The profile could not be loaded. Check your connection and reload the page.'));
      });
  }

  /* The profile field caps, single-sourced from the PureScript Domain.Profile
     (via window.mcCore); the fallback matches the worker (the no-bundle path,
     the deliberate no-bundle fallback). Fixes the drift where the admin editor capped bio at
     1000 while the worker rejects anything over 500. See CLAUDE.md. */
  function profileLimits() {
    return (window.mcCore && window.mcCore.profileLimits) || { nick: 40, bio: 500, sig: 200 };
  }

  /* Read view: an avatar placeholder, the primary name (nick or assigned) with
     the assigned pseudonym muted beneath when a nick is set, then bio and
     signature. The owner gets an Edit button that swaps in the form. */
  /* The "recent posts" list on a profile: a member's own live forum posts,
     newest first, each linking to the exact post, paged in place. */
  function renderProfilePosts(card: any, hash: any) {
    card.appendChild(el('h3', 'profile-label', 'Recent Community Posts'));
    var wrap = el('div', 'profile-posts');
    card.appendChild(wrap);
    /* Deferred behind a click (no worker call until asked), and RE-collapsible: a
       reader can expand it, then close it again to get back down to the wall. */
    var toggle = el('button', 'btn btn-anon profile-posts-toggle', 'Show recent posts');
    toggle.type = 'button';
    wrap.appendChild(toggle);
    var panel = el('div', 'profile-posts-panel');
    panel.style.display = 'none';
    wrap.appendChild(panel);
    var loaded = false;
    var list: any, pagerHost: any;
    var st = { page: 1 };
    function draw() {
      skelInto(list, 'short');
      pagerHost.textContent = '';
      fetchRetry(API + '/board/author?hash=' + hash + '&p=' + st.page + freshParam('&'), freshOpts(), [1000, 3000])
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (!d.ok) throw new Error('failed');
          list.textContent = '';
          if (!d.items.length) {
            list.appendChild(el('p', 'comments-status', st.page > 1 ? 'No more posts.' : 'No forum posts yet.'));
            return;
          }
          d.items.forEach(function (it: any) {
            var row = el('div', 'board-topic');
            var left = el('div', 'board-topic-left');
            var a = el('a', 'board-topic-title', it.title || 'a thread');
            a.href = 'community.html?topic=' + it.topic_id + '#comment-' + it.comment_id;
            left.appendChild(a);
            if (it.snippet) left.appendChild(el('div', 'board-intro', it.snippet));
            row.appendChild(left);
            var ce = catByKey(it.cat);
            var rcs = el('div', 'board-stats', (ce ? ce[1] : it.cat) + ' · ' + fmtTimeCompact(it.created_at));
            rcs.title = fmtDateTime(it.created_at);
            row.appendChild(rcs);
            list.appendChild(row);
          });
          var bar = pageBar(d.total, d.per, d.page, null, function (n) { st.page = n; draw(); window.scrollTo(0, 0); });
          if (bar) pagerHost.appendChild(bar);
        })
        .catch(function () { list.textContent = ''; list.appendChild(el('p', 'comments-status', 'Recent posts could not be loaded.')); });
    }
    toggle.addEventListener('click', function (e: any) {
      e.preventDefault();
      if (panel.style.display === 'none') {
        panel.style.display = '';
        toggle.textContent = 'Hide recent posts';
        if (!loaded) {
          loaded = true;
          list = el('div', 'board-topics');
          panel.appendChild(list);
          pagerHost = el('div');
          panel.appendChild(pagerHost);
          draw();
        }
      } else {
        panel.style.display = 'none';
        toggle.textContent = 'Show recent posts';
      }
    });
  }

  /* Online or offline, under another member's name (2026-09-11): one keyed
     read of /dm/presence on open, then the live presence:<hash> frames the
     hub seeds and fans. Not for yourself, not for the bot, never without an
     identity. A member who chose "appear offline" reads Offline — the hub
     honours the choice before it answers, so nothing here can leak it. */
  function profilePresenceInto(names: any, hash: any) {
    if (!state.key || !hash || hash === state.myHash || hash === MERECAT_BOT_HASH || !/^[0-9a-f]{64}$/.test(String(hash))) return;
    ensureDmStyles();
    var line = el('div', 'profile-presence');
    line.hidden = true;
    names.appendChild(line);
    var seenAt = 0, wasOn: boolean | null = null;
    function paint(on: boolean) {
      if (wasOn === true && !on) seenAt = Math.floor(Date.now() / 1000);   // went offline before our eyes
      wasOn = on;
      line.textContent = '';
      line.appendChild(el('span', 'dm-dot ' + (on ? 'dm-dot-on' : 'dm-dot-off')));
      line.appendChild(document.createTextNode(on ? 'Online' : (seenAt ? 'Last seen ' + dmSeenLabel(seenAt) : 'Offline')));
      line.hidden = false;
    }
    state.profilePresence = function (h: any, on: any) { if (h === hash && line.isConnected) paint(!!on); };
    fetch(API + '/dm/presence', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: state.key, hashes: [hash] }) })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!(d && d.ok && Array.isArray(d.online)) || !line.isConnected) return;
        seenAt = Number((d.seen && d.seen[hash]) || 0);   // absent for a member who hides their presence
        paint(d.online.indexOf(hash) !== -1);
      })
      .catch(function () { /* no line, no harm */ });
    if (window.mcLive && window.mcLive.board) window.mcLive.board.sub(['presence:' + hash]);
  }
  function renderProfile(card: any, p: any, editable: any) {
    card.textContent = '';
    /* A blocked member's profile is closed to you — no card, no wall, no
       posts; just the honest line and the way back (the block unification). */
    if (!editable && p.hash !== state.myHash && isBlocked(p.hash)) {
      card.appendChild(el('p', 'comments-status', 'You have blocked this member. Their profile and posts are hidden from you.'));
      var ub = el('button', 'btn btn-anon', 'Unblock this member');
      ub.type = 'button';
      ub.addEventListener('click', function () {
        setBlock(p.hash, false, function () { renderProfile(card, p, editable); });
      });
      card.appendChild(ub);
      return;
    }
    var headRow = el('div', 'profile-head');
    var avatar = el('div', 'profile-avatar');
    if (p.avatar) {
      var img = el('img');
      img.src = API + '/avatar?hash=' + p.hash + '&v=' + encodeURIComponent(p.avatar);
      img.alt = '';
      img.width = 72;
      img.height = 72;
      avatar.appendChild(img);
      /* The picture pops out full size in the bare theater (2026-09-12): as
         large as the viewport allows, a download beside it; a tap, or Enter. */
      avatar.classList.add('profile-avatar-zoom');
      avatar.setAttribute('role', 'button'); avatar.tabIndex = 0;
      avatar.title = 'View picture'; avatar.setAttribute('aria-label', 'View the profile picture full size');
      var zoom = function () { openImage(img.src, 'avatar-' + String(p.hash || '').slice(0, 8) + '.jpg'); };
      avatar.addEventListener('click', zoom);
      avatar.addEventListener('keydown', function (e: any) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); zoom(); } });
    }
    headRow.appendChild(avatar);
    var names = el('div', 'profile-names');
    names.appendChild(el('div', 'profile-name', p.nick || p.assigned));
    profilePresenceInto(names, p.hash);
    if (p.nick) names.appendChild(el('div', 'profile-assigned', p.assigned));
    if (p.handle) names.appendChild(el('div', 'profile-assigned profile-handle', '@' + p.handle));
    if (p.admin) names.appendChild(el('span', 'comment-admin', '(admin)'));
    /* The faith declaration. For one's own profile it falls back to the local
       choice before the first post has carried it to the server. */
    var faithCode = p.faith || (p.hash === state.myHash ? getFaith() : '');
    var pfl = faithCode && faithLabel(faithCode);
    if (pfl) names.appendChild(el('div', 'profile-faith', 'I hold to: ' + pfl));
    /* Standing on the board: the total post count and the rank it earns. */
    if (p.posts != null) names.appendChild(el('div', 'profile-faith profile-rank', rankLine(Number(p.posts) || 0)));
    headRow.appendChild(names);
    card.appendChild(headRow);
    /* Share: one tap copies this member's public profile link (the pretty
       /@handle when they have one, else the ?u= form) to the clipboard. */
    var shareUrl = location.origin + (p.handle ? ('/@' + p.handle) : ('/' + profileHref(p.hash)));
    var shareLink = el('button', 'btn btn-anon profile-share', '🔗 Share profile');
    shareLink.type = 'button';
    shareLink.addEventListener('click', function (e: any) {
      e.preventDefault();
      var done = function () {
        var was = shareLink.textContent;
        shareLink.textContent = '✓ Link copied';
        setTimeout(function () { shareLink.textContent = was; }, 2000);
      };
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(shareUrl).then(done).catch(function () { window.prompt('Copy this link:', shareUrl); });
        } else { window.prompt('Copy this link:', shareUrl); }
      } catch (err) { window.prompt('Copy this link:', shareUrl); }
    });
    card.appendChild(shareLink);
    /* Offsite links (website + socials) as brand-icon buttons. Server-sanitized to
       safe https URLs, so rendering as an href is safe; still noopener/nofollow. */
    if (p.links && typeof p.links === 'object') {
      var socials = el('div', 'profile-socials');
      SOCIAL_ORDER.forEach(function (plat: any) {
        var url = p.links[plat];
        if (!url || typeof url !== 'string') return;
        var a = el('a', 'profile-social');
        a.href = url; a.target = '_blank'; a.rel = 'noopener nofollow noreferrer';
        a.title = SOCIAL_LABEL[plat] || plat;
        a.appendChild(mcSocialIcon(plat));
        socials.appendChild(a);
      });
      if (socials.firstChild) card.appendChild(socials);
    }
    if (p.bio) {
      card.appendChild(el('h3', 'profile-label', 'Bio'));
      card.appendChild(el('p', 'profile-bio', p.bio));
    } else if (!editable) {
      card.appendChild(el('p', 'profile-bio profile-empty', 'No bio yet.'));
    }
    if (p.signature) {
      card.appendChild(el('h3', 'profile-label', 'Signature'));
      card.appendChild(el('div', 'comment-sig', p.signature));
    }
    if (editable) {
      var edit = el('button', 'btn btn-send', 'Edit profile');
      edit.type = 'button';
      edit.addEventListener('click', function () { editProfile(card, p); });
      card.appendChild(edit);
    } else if (isMember() && p.hash !== state.myHash) {
      /* The librarian gets neither door: no DMs (it holds no inbox) and no
         mute (it speaks only when summoned). */
      if (p.hash !== MERECAT_BOT_HASH) {
        var dmBtn = el('button', 'btn btn-send', 'Send a Direct Message');
        dmBtn.type = 'button';
        dmBtn.addEventListener('click', function () {
          go('messages.html?dm=' + p.hash);
        });
        card.appendChild(dmBtn);
        var blockBtn = el('button', 'btn btn-anon', 'Block this member');
        blockBtn.type = 'button';
        blockBtn.addEventListener('click', function () {
          appConfirm(BLOCK_CONFIRM, { okLabel: 'Block', danger: true }, function (ok: any) {
            if (ok) setBlock(p.hash, true, function () { renderProfile(card, p, editable); });
          });
        });
        card.appendChild(blockBtn);
      }
    }
    /* The member's public wall — their own posts, with a composer on your own. */
    /* Recent Community Posts sit ABOVE the wall so heavy wall posting never buries
       the way to look up someone's forum history; it stays collapsed by default. */
    renderProfilePosts(card, p.hash);
    renderProfileWall(card, p.hash, editable);
    /* Admins get the very same user-fingerprint drawer here as on a post,
       driven by this identity's hash. Everyone else sees nothing. */
    annotateProfileMeta(p.hash, card);
  }

  /* The edit form. Every save is re-screened by the server; a flagged save is
     refused with its reason and the fields survive so nothing is retyped. */
  function editProfile(card: any, p: any) {
    /* Both actions here are Turnstile-gated — the save AND the avatar upload —
       and the avatar rides a file input that can be used without focusing any
       text, so the focusin net alone would miss it. Opening the editor is
       intent enough. */
    warmToken();
    card.textContent = '';
    card.appendChild(el('p', 'key-note',
      'Your assigned name ' + p.assigned + ' always stays as your identifier. ' +
      'A custom nickname simply shows first.'));
    var chosenFaith = p.faith || (p.hash === state.myHash ? getFaith() : '') || '';
    card.appendChild(faithRadios(chosenFaith, function (code: any) { chosenFaith = code; }));
    var PLIM = profileLimits();
    card.appendChild(el('label', 'profile-label', 'Nickname (up to ' + PLIM.nick + ' characters)'));
    var nickIn = el('input', 'key-input');
    nickIn.type = 'text';
    nickIn.maxLength = PLIM.nick;
    nickIn.placeholder = p.assigned;
    nickIn.value = p.nick || '';
    card.appendChild(nickIn);
    card.appendChild(el('label', 'profile-label', 'Bio (up to ' + PLIM.bio + ' characters)'));
    var bioIn = el('textarea', 'comment-text');
    bioIn.maxLength = PLIM.bio;
    bioIn.rows = 4;
    bioIn.value = p.bio || '';
    card.appendChild(bioIn);
    card.appendChild(el('label', 'profile-label', 'Signature (up to ' + PLIM.sig + ' characters)'));
    var sigIn = el('textarea', 'comment-text');
    sigIn.maxLength = PLIM.sig;
    sigIn.rows = 2;
    sigIn.value = p.signature || '';
    card.appendChild(sigIn);

    /* Custom @handle — the member's own profile URL (merecatholicity.com/@handle),
       distinct from the display nickname. Optional; lower-cased; must be unique
       (the server is authoritative and returns a clear message if it is taken).
       The live hint shows the resulting link, or why a value is not allowed,
       validated through the same kernel the server uses. */
    function handleErrText(tag: any) {
      switch (tag) {
        case 'too_short': return 'Too short — 3 to 30 characters.';
        case 'too_long': return 'Too long — 3 to 30 characters.';
        case 'bad_chars': return 'Use only lowercase letters, numbers, and underscore.';
        case 'bad_start': return 'Must start with a letter.';
        case 'bad_underscore': return 'Cannot end with, or repeat, an underscore.';
        case 'reserved': return 'That handle is reserved.';
        default: return 'That handle is not allowed.';
      }
    }
    card.appendChild(el('label', 'profile-label', 'Profile link — your @handle (optional)'));
    var handleIn = el('input', 'key-input');
    handleIn.type = 'text';
    handleIn.maxLength = (window.mcCore && window.mcCore.handleMax) || 30;
    handleIn.placeholder = 'e.g. john_smith';
    handleIn.value = p.handle || '';
    handleIn.autocapitalize = 'none';
    handleIn.autocomplete = 'off';
    handleIn.spellcheck = false;
    card.appendChild(handleIn);
    var handleHint = el('p', 'profile-empty');
    card.appendChild(handleHint);
    function updateHandleHint() {
      var raw = handleIn.value.trim();
      handleHint.style.color = '';
      if (!raw) { handleHint.textContent = 'No handle set — your link stays the default.'; return; }
      if (window.mcCore && window.mcCore.handleValidate) {
        var v = window.mcCore.handleValidate(raw);
        if (v.ok) { handleHint.textContent = 'Your link: merecatholicity.com/@' + v.handle; }
        else { handleHint.textContent = handleErrText(v.error); handleHint.style.color = '#a3324a'; }
      } else {
        handleHint.textContent = 'Your link: merecatholicity.com/@' + raw.toLowerCase();
      }
    }
    handleIn.addEventListener('input', updateHandleHint);
    updateHandleHint();

    /* Offsite links: your website + socials. Each accepts a full URL or a bare
       handle; the live hint shows the resulting link, and the server keeps only
       safe http(s) / normalized-handle URLs (Domain.Links). */
    card.appendChild(el('label', 'profile-label', 'Links (optional) — your website and socials'));
    var linkInputs: Record<string, any> = {};
    SOCIAL_ORDER.forEach(function (plat: any) {
      var row = el('div', 'profile-link-row');
      var lab = el('span', 'profile-link-plat');
      lab.appendChild(mcSocialIcon(plat));
      lab.appendChild(document.createTextNode(' ' + (SOCIAL_LABEL[plat] || plat)));
      row.appendChild(lab);
      var inp = el('input', 'key-input');
      inp.type = 'text'; inp.autocapitalize = 'none'; inp.autocomplete = 'off'; inp.spellcheck = false;
      inp.placeholder = plat === 'website' ? 'https://your-site.com' : 'your handle, or a full URL';
      inp.value = (p.links && p.links[plat]) || '';
      row.appendChild(inp);
      var lhint = el('p', 'profile-empty');
      row.appendChild(lhint);
      function updLink() {
        var raw = inp.value.trim();
        lhint.style.color = '';
        if (!raw) { lhint.textContent = ''; return; }
        if (window.mcCore && window.mcCore.linkNormalize) {
          var n = (window.mcCore.linkNormalize as any)(plat, raw);
          if (n.ok && n.url) { lhint.textContent = '→ ' + n.url; }
          else { lhint.textContent = 'Use a handle or an https:// link.'; lhint.style.color = '#a3324a'; }
        }
      }
      inp.addEventListener('input', updLink);
      updLink();
      linkInputs[plat] = inp;
      card.appendChild(row);
    });

    /* Avatar. Two ways to set one: upload your own JPEG, or pick a ready-made
       from the gallery. Both end in the same canvas step that hands the server
       the exact 400x400 JPEG it demands; the server re-checks bytes, format,
       dimensions, and content regardless of which path produced them. */
    card.appendChild(el('label', 'profile-label', 'Avatar'));
    var avNote = el('p', 'profile-empty', '');

    /* The shared tail: a loaded image is rasterized to a 400x400 JPEG and pushed
       through the same upload posting is gated on. 'cover' fills the square with
       a photo; 'contain' fits a preset whole onto the parchment tile so its
       transparent edges read as the tile rather than as black. */
    function pushAvatar(img: any, mode: any) {
      var iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
      if (!iw || !ih) { avNote.textContent = 'That image could not be read. Try another.'; return; }
      /* Rasterize to a fixed square. Larger than the old 400px so an upload keeps
         more detail; the CSS caps the display size, and the worker accepts any
         square in its range. */
      var AV = 512;
      var c = document.createElement('canvas');
      c.width = AV;
      c.height = AV;
      var ctx = c.getContext('2d') as CanvasRenderingContext2D;
      if (mode === 'contain') {
        ctx.fillStyle = '#faf6ee';
        ctx.fillRect(0, 0, AV, AV);
        var box = AV * 0.82;
        var s = Math.min(box / iw, box / ih);
        var cw = iw * s, ch = ih * s;
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, (AV - cw) / 2, (AV - ch) / 2, cw, ch);
      } else {
        var scale = Math.max(AV / iw, AV / ih);
        var w = iw * scale, h = ih * scale;
        ctx.drawImage(img, (AV - w) / 2, (AV - h) / 2, w, h);
      }
      /* JPEG, so the stored bytes decode cleanly for both the AI vision screen
         and every browser; a lower-quality second pass is the net for the rare
         frame that overruns the cap. */
      var send = function (blob: any) {
        if (!blob || blob.size > 1024 * 1024) {
          avNote.textContent = 'The image could not be brought under 1 MB. Try another.';
          return;
        }
        avNote.textContent = 'Verifying...';
        getToken().then(function (token) {
          avNote.textContent = 'Checking image...';
          var fd = new FormData();
          fd.append('key', state.key);
          fd.append('token', token);
          fd.append('avatar', blob, 'avatar');
          return fetchRetry(API + '/avatar', { method: 'POST', body: fd }, [1500])
            .then(function (r) { return r.json(); });
        }).then(function (d) {
          if (!d.ok) throw new Error(d.error || 'Could not upload the avatar.');
          stampFresh();
          p.avatar = d.avatar;
          if (window.turnstile && state.widgetId !== null) turnstile.reset(state.widgetId);
          editProfile(card, p);
        }).catch(function (err) {
          avNote.textContent = err.message || 'Network error. Try again in a moment.';
          if (window.turnstile && state.widgetId !== null) turnstile.reset(state.widgetId);
        });
      };
      c.toBlob(function (blob) {
        if (blob && blob.size <= 1024 * 1024) return send(blob);
        c.toBlob(send, 'image/jpeg', 0.7);
      }, 'image/jpeg', 0.85);
    }

    /* Path one: upload a file. */
    var avRow = el('div', 'key-row');
    var avPick = el('input');
    avPick.type = 'file';
    avPick.accept = '.jpg,.jpeg,image/jpeg';
    avRow.appendChild(avPick);
    card.appendChild(avRow);
    avPick.addEventListener('change', function () {
      var file = avPick.files && avPick.files[0];
      if (!file) return;
      avNote.textContent = 'Preparing image...';
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onerror = function () {
        URL.revokeObjectURL(url);
        avNote.textContent = 'That file is not a usable image.';
      };
      img.onload = function () {
        URL.revokeObjectURL(url);
        pushAvatar(img, 'cover');
      };
      img.src = url;
    });

    /* Path two: the preset gallery, revealed by a toggle so it never crowds the
       form until asked for. A pick loads that same-origin image (canvas stays
       untainted) and runs the shared tail in 'contain' mode. */
    var galBtn = el('button', 'btn btn-anon btn-gallery', 'Choose from the gallery');
    galBtn.type = 'button';
    var gallery = buildAvatarGallery(function (path: any) {
      gallery.closePanel();
      galBtn.textContent = 'Choose from the gallery';
      avNote.textContent = 'Preparing image...';
      var pim = new Image();
      pim.onerror = function () { avNote.textContent = 'That gallery image could not be loaded. Try another.'; };
      pim.onload = function () { pushAvatar(pim, 'contain'); };
      pim.src = path;
    });
    galBtn.addEventListener('click', function () {
      gallery.toggle();
      galBtn.textContent = gallery.hidden ? 'Choose from the gallery' : 'Hide the gallery';
    });
    card.appendChild(galBtn);
    card.appendChild(gallery);

    card.appendChild(el('p', 'profile-empty',
      'Upload a JPEG (cropped to a square, 1 MB at most) or pick a ready-made from the gallery. ' +
      (p.avatar ? 'Either choice replaces your current avatar.' : '')));
    card.appendChild(avNote);
    if (p.avatar) {
      var avPrev = el('div', 'profile-avatar');
      var avPrevImg = el('img');
      avPrevImg.src = API + '/avatar?hash=' + p.hash + '&v=' + encodeURIComponent(p.avatar);
      avPrevImg.alt = '';
      avPrev.appendChild(avPrevImg);
      card.appendChild(avPrev);
      var avDel = el('a', 'identity-action', 'Remove avatar');
      avDel.href = '#';
      avDel.addEventListener('click', function (e: any) {
        e.preventDefault();
        appConfirm('Remove your avatar?', { okLabel: 'Remove', danger: true }, function (ok: any) {
          if (!ok) return;
          fetchRetry(API + '/avatar/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: state.key }),
          }, [1500]).then(function (r) { return r.json(); }).then(function (d) {
            if (!d.ok) throw new Error(d.error || 'Could not remove it.');
            stampFresh();
            p.avatar = null;
            editProfile(card, p);
          }).catch(function (err) { avNote.textContent = err.message; });
        });
      });
      card.appendChild(avDel);
    }
    var row = el('div', 'comment-buttons');
    var save = el('button', 'btn btn-send', 'Save');
    save.type = 'button';
    row.appendChild(save);
    card.appendChild(row);
    var note = el('p', 'form-status');
    card.appendChild(note);
    card.appendChild(identityAction('Cancel', function () { renderProfile(card, p, true); }));
    save.addEventListener('click', function () {
      save.disabled = true;
      note.textContent = 'Verifying...';
      getToken().then(function (token) {
        note.textContent = 'Saving...';
        return fetchRetry(API + '/profile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: state.key, nick: nickIn.value, bio: bioIn.value, signature: sigIn.value, faith: chosenFaith, handle: handleIn.value,
            links: { website: linkInputs.website.value, x: linkInputs.x.value, facebook: linkInputs.facebook.value, instagram: linkInputs.instagram.value, tiktok: linkInputs.tiktok.value }, token: token }),
        }, [1500], function () { note.textContent = 'Network hiccup, retrying...'; })
          .then(function (r) { return r.json(); });
      })
        .then(function (d) {
          if (!d.ok) throw new Error(d.error || 'Could not save.');
          stampFresh();
          state.myNick = d.profile.nick || '';
          if (d.profile.faith) setFaith(d.profile.faith);
          if (window.turnstile && state.widgetId !== null) turnstile.reset(state.widgetId);
          renderProfile(card, d.profile, true);
        })
        .catch(function (err) {
          note.textContent = err.message || 'Network error. Try again in a moment.';
          save.disabled = false;
          if (window.turnstile && state.widgetId !== null) turnstile.reset(state.widgetId);
        });
    });
  }

  /* Best-effort "my own" display bits for an optimistic render (the server is
     authoritative on the next load). */
  function myNick() { try { return (state.profile && state.profile.nick) || ''; } catch (e) { return ''; } }
  function myAvatar() { try { return (state.profile && state.profile.avatar) || ''; } catch (e) { return ''; } }

  /* The wall section on a profile: the member's own posts, with a composer when
     it is your own profile. Called from renderProfile. */
  function renderProfileWall(card: any, hash: any, editable: any) {
    if (!isMember()) return;   // profiles are members-only now; a guest never gets here
    /* Social off: the profile keeps its identity, bio, links, rank, and Recent
       Community Posts — it simply has no wall. Every post is still in D1 and
       reappears, untouched, when the switch goes back on. The mirror answers
       synchronously so the card never renders a wall it must then take away. */
    if (!socialRead()) return;
    function mountWall() {
      card.appendChild(el('h3', null, editable ? 'Your wall' : 'Wall'));
      if (editable) {
        card.appendChild(wallComposer('post', {}, function (row: any) { if (row) wrap.wrap.insertBefore(wallPostNode(row), wrap.wrap.firstChild); }));
      }
      var wrap = wallInfiniteList(function (cursor: any) {
        return fetch(API + '/wall', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: state.key, hash: hash, cursor: cursor }) }).then(function (r) { return r.json(); });
      });
      card.appendChild(wrap.wrap);
    }
    socialCfg().then(function (on: boolean) { if (on) mountWall(); });
  }

  /* The notification list. Opening it is reading it: the server marks every row
     read and the badge clears. Each row says who did what in which thread and
     links to the exact post, riding the same find-pagination jump as any
     permalink. Newest first, twenty to a page. */
  function viewNotifications() {
    if (window.mcViews && window.mcViews.notifications) return window.mcViews.notifications(section, window.mcKit);
    document.title = 'Notifications | Community';
    crumb([['Community', 'community.html'], ['Notifications']]);
    if (!state.key) {
      section.appendChild(el('p', 'comments-status', 'Notifications need an identity. Create one on the board front page.'));
      return;
    }
    var list = el('div', 'board-topics');
    skelInto(list);
    section.appendChild(list);
    var pageNum = Math.max(1, Math.floor(Number(new URLSearchParams(location.search).get('p')) || 1));
    fetchRetry(API + '/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: state.key, p: pageNum }),
    }, [1000, 3000])
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (blockedOut(d)) return;
        if (!d.ok) throw new Error(d.error || 'failed');
        /* Reading the list clears it on the server; make the badge tell the truth. */
        fetch(API + '/notifications/read', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: state.key }),
        }).then(function () { try { localStorage.removeItem(NOTIF_CACHE); } catch (e) {} notifUnreadCheck(); }).catch(function () {});
        list.textContent = '';
        if (!d.items.length) {
          list.appendChild(el('p', 'comments-status', 'No notifications yet. Post in a thread to follow it; you will hear when someone replies or names you.'));
          return;
        }
        d.items.forEach(function (it: any) {
          var row = el('div', 'board-topic');
          var left = el('div', 'board-topic-left');
          /* The sentence and the door are the kernel's (Domain.Notif via
             mcCore) — the one map the member-page list and the bell sheet
             render from too; a fourth inline copy for the reaction kinds was
             the moment to make it one rule. */
          var core: any = window.mcCore;
          var label = core && core.notifLabel ? core.notifLabel(it) : ((it.actor_nick || 'Someone') + ' · ' + it.kind);
          var a = el('a', 'board-topic-title' + (it.read_at ? '' : ' dm-unread'), label);
          a.href = core && core.notifHref ? core.notifHref(it) : 'community.html?notifications=1';
          left.appendChild(a);
          if (!it.read_at) left.appendChild(el('span', 'dm-unread', ' ● new'));
          if (it.snippet && (!core || !core.notifHasSnippet || core.notifHasSnippet(it.kind))) left.appendChild(el('div', 'board-intro', it.snippet));
          row.appendChild(left);
          var nstat = el('div', 'board-stats', fmtTimeCompact(it.created_at));
          nstat.title = fmtDateTime(it.created_at);
          row.appendChild(nstat);
          list.appendChild(row);
        });
        function notifHref(i: any) { return 'community.html?notifications=1&p=' + i; }
        var topBar = pageBar(d.total, d.per, d.page, notifHref);
        if (topBar) section.insertBefore(topBar, list);
        var botBar = pageBar(d.total, d.per, d.page, notifHref);
        if (botBar) section.appendChild(botBar);
      })
      .catch(function () {
        list.textContent = '';
        list.appendChild(el('p', 'comments-status', 'Notifications could not be loaded. Check your connection and reload the page.'));
      });
  }

  /* Device linking: the Settings QR encodes profile.html#key=… — the fragment
     never reaches the server, and it is stripped from the URL the instant we
     read it here. A confirm gates the sign-in so a mis-scanned or hostile link
     never silently replaces the identity on this device. */
  function keyFromFragment() {
    var m = /^#key=([^&]+)/.exec(location.hash || '');
    if (!m) return;
    history.replaceState(history.state, '', location.pathname + location.search);
    var key = '';
    try { key = decodeURIComponent(m[1]).trim(); } catch (e) { return; }
    if (!key || key.length < 16) return;
    if (state.key === key) { if (window.mcToast) window.mcToast('Already signed in on this device.'); return; }
    var msg = state.key
      ? 'Sign in with the scanned key? This device is already signed in as another identity, which will be signed out.'
      : 'Sign in with the scanned key on this device?';
    var confirmFn = window.mcConfirm || function (m2: string) { return Promise.resolve(window.confirm(m2)); };
    confirmFn(msg, { okLabel: 'Sign in' }).then(function (ok: any) {
      if (!ok) return;
      loginWithKey(key).then(function (good: any) {
        if (good) location.reload();
        else if (window.mcToast) window.mcToast('That key was not recognized.');
      });
    });
  }

  /* One quiet, one-time reminder to save the key: a member on their third
     visit who has never opened Show-my-key or saved at onboarding gets a
     dismissible line above the board. Loss is unrecoverable by design, so
     the platform owes the reader one more chance to hear that in time. */
  function keyNudge() {
    if (!state.key) return;
    try {
      if (localStorage.getItem('mc-key-nudged') === '1') return;
      var boots = Number(localStorage.getItem('mc-key-boots') || 0) + 1;
      localStorage.setItem('mc-key-boots', String(boots));
      if (boots < 3) return;
      localStorage.setItem('mc-key-nudged', '1');
    } catch (e) { return; }
    var bar = el('p', 'comments-status');
    bar.appendChild(document.createTextNode('Have you saved your key? It is the only way back into this identity. '));
    var show = el('a', 'body-link', 'Show my key');
    show.setAttribute('href', '#');
    show.addEventListener('click', function (ev: any) {
      ev.preventDefault();
      if (window.mcSheet && window.mcSheet.settings) window.mcSheet.settings();
      bar.remove();
    });
    bar.appendChild(show);
    bar.appendChild(document.createTextNode(' · '));
    var dis = el('a', 'body-link', 'Dismiss');
    dis.setAttribute('href', '#');
    dis.addEventListener('click', function (ev: any) { ev.preventDefault(); bar.remove(); });
    bar.appendChild(dis);
    section.parentNode!.insertBefore(bar, section);
  }
  function bind() {
    ADMIN_HASHES = B.ADMIN_HASHES;
    API = B.API;
    BOARD = B.BOARD;
    DM_CACHE = B.DM_CACHE;
    MERECAT_BOT_HASH = B.MERECAT_BOT_HASH;
    SOCIAL_LABEL = B.SOCIAL_LABEL;
    SOCIAL_ORDER = B.SOCIAL_ORDER;
    adminProfileEditor = B.adminProfileEditor;
    appConfirm = B.appConfirm;
    asset = B.asset;
    badgeChanged = B.badgeChanged;
    bootSig = B.bootSig;
    buildFingerprint = B.buildFingerprint;
    cachedJson = B.cachedJson;
    catByKey = B.catByKey;
    clearKey = B.clearKey;
    crumb = B.crumb;
    displayName = B.displayName;
    dmCacheGet = B.dmCacheGet;
    dmSeenLabel = B.dmSeenLabel;
    dmUnreadCheck = B.dmUnreadCheck;
    el = B.el;
    openImage = B.openImage;
    enableMemberLive = B.enableMemberLive;
    ensureDmStyles = B.ensureDmStyles;
    ensureEmojiStyles = B.ensureEmojiStyles;
    fetchRetry = B.fetchRetry;
    fmtDateTime = B.fmtDateTime;
    fmtTimeCompact = B.fmtTimeCompact;
    freshOpts = B.freshOpts;
    freshParam = B.freshParam;
    getToken = B.getToken;
    go = B.go;
    isAdmin = B.isAdmin;
    load = B.load;
    makeKey = B.makeKey;
    mcSocialIcon = B.mcSocialIcon;
    pageBar = B.pageBar;
    playSound = B.playSound;
    rankLine = B.rankLine;
    readEase = B.readEase;
    readMark = B.readMark;
    readThrottled = B.readThrottled;
    route = B.route;
    section = B.section;
    setKey = B.setKey;
    sha256hex = B.sha256hex;
    skelInto = B.skelInto;
    skeleton = B.skeleton;
    socialCfg = B.socialCfg;
    socialRead = B.socialRead;
    stampFresh = B.stampFresh;
    state = B.state;
    trace = B.trace;
    wallComposer = B.wallComposer;
    wallInfiniteList = B.wallInfiniteList;
    wallPostNode = B.wallPostNode;
    warmToken = B.warmToken;
  }
  /* What ran at boot time in the old file, in the old order, after every
     module is bound: listeners, deferred initializers. */
  function run() {
    /* A badge the SHELL wrote (a frame heard on this page) repaints the
       identity line too; the classic's own writes already do. */
    document.addEventListener('mc-badge', function (ev: any) { if (ev && ev.detail && ev.detail.from === 'shell') renderIdentity(); }, { signal: bootSig });
  }
  return { bind, run, exports: { BLOCK_CONFIRM, MUTED_STORE, NOTIF_CACHE, annotateProfileMeta, authSig, blockedOut, faithLabel, getFaith, getMuted, identityAction, isBlocked, isMember, isMuted, keyFromFragment, keyNudge, loadMyProfile, loginWithKey, mintIdentity, myAvatar, myNick, notifCacheSet, notifUnreadCheck, onLiveNotif, profileHref, profileLimits, renderIdentity, renderProfile, setBlock, syncMutedUp, toggleMute, viewNotifications, viewProfile, viewProfileByHandle } };
}
