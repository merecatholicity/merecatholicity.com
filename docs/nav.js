/* Light/dark theme: a reader's choice, saved in a year-long cookie, defaulting
   to CHARCOAL DARK for everyone when nothing is saved (system preference no
   longer decides the default). An explicit mc-theme=light choice always wins.
   data-theme goes on <html>. The reader toggles the theme from the platform
   Settings (the gear → Appearance); there is no longer a corner widget. */
(function () {
  function readCookie() {
    var m = document.cookie.match(/(?:^|;\s*)mc-theme=(light|dark)\b/);
    return m ? m[1] : '';
  }
  /* Which dark palette the reader chose: charcoal (default) / slate / warm ink.
     Only meaningful in dark mode; drives data-dark on <html> for the token
     variant blocks in 01-tokens.css. */
  function readDark() {
    var m = document.cookie.match(/(?:^|;\s*)mc-dark=(charcoal|slate|ink)\b/);
    return m ? m[1] : 'charcoal';
  }
  /* Which light palette the reader chose: paper (default) / mist (cool) / sepia
     (warm). Only meaningful in light mode; drives data-light on <html> for the
     light variant blocks in the stylesheet. */
  function readLight() {
    var m = document.cookie.match(/(?:^|;\s*)mc-light=(paper|mist|sepia)\b/);
    return m ? m[1] : 'paper';
  }
  function effective() {
    /* Charcoal dark is the default for everyone now; the reader can still opt
       into light (an explicit mc-theme=light choice always wins). System
       preference no longer decides the default. */
    return readCookie() || 'dark';
  }
  function apply(theme) {
    /* The mc-fout gate pre-paints <html> with an INLINE background from the
       cookie so a dark reader never sees a white flash before the stylesheet
       arrives. Inline beats every stylesheet rule, so once WE run (deferred =
       CSS is parsed) it must be cleared or a later live toggle flips every
       token EXCEPT the page background — the "background stays the old theme
       until a hard refresh" bug. html{background:var(--bg)} owns it from here. */
    document.documentElement.style.background = '';
    document.documentElement.setAttribute('data-theme', theme);
    /* charcoal is the base [data-theme="dark"] block (no attribute); slate/ink are
       delta blocks keyed on data-dark. Cleared in light mode so nothing lingers. */
    var dark = readDark();
    if (theme === 'dark' && (dark === 'slate' || dark === 'ink')) {
      document.documentElement.setAttribute('data-dark', dark);
    } else {
      document.documentElement.removeAttribute('data-dark');
    }
    /* paper is the base light :root (no attribute); mist/sepia are delta blocks
       keyed on data-light. Cleared in dark mode so nothing lingers. */
    var light = readLight();
    if (theme === 'light' && (light === 'mist' || light === 'sepia')) {
      document.documentElement.setAttribute('data-light', light);
    } else {
      document.documentElement.removeAttribute('data-light');
    }
  }
  /* Apply as soon as the (deferred) script runs, so an explicit choice takes
     hold before the reader interacts. */
  apply(effective());
  /* The dark-palette picker (in the settings sheet / desktop account menu) reaches
     the theme engine through these, so the palette lives in one place. */
  window.mcGetDark = readDark;
  window.mcSetDark = function (v) {
    if (v !== 'charcoal' && v !== 'slate' && v !== 'ink') return;
    document.cookie = 'mc-dark=' + v + ';path=/;max-age=31536000;samesite=lax';
    apply(effective());
  };
  window.mcGetLight = readLight;
  window.mcSetLight = function (v) {
    if (v !== 'paper' && v !== 'mist' && v !== 'sepia') return;
    document.cookie = 'mc-light=' + v + ';path=/;max-age=31536000;samesite=lax';
    apply(effective());
  };
  /* The settings gear's light/dark toggle drives THIS (write the mc-theme
     cookie, then call it) so the whole application — attributes, palette
     variants, the inline pre-paint clear — lives in one engine. */
  window.mcApplyTheme = function () { apply(effective()); };

  /* The floating corner light/dark toggle was RETIRED — the theme now lives in
     the platform Settings (gear → Appearance), which drives the same engine via
     window.mcSetDark / the mc-theme cookie. The engine above (apply on load +
     cookies) stays; only the corner widget is gone. */
})();

/* Site menu: WAI-ARIA disclosure navigation, start-menu style on desktop.
   Panels cascade right by default and flip left or slide up when the window
   runs out of room, at any nesting depth. JS owns all open state so click,
   hover, Esc, and outside-click stay consistent. */
document.addEventListener('DOMContentLoaded', function () {
  var nav = document.querySelector('nav.site');
  if (!nav) return;
  var toggle = nav.querySelector('.nav-toggle');
  var icon = toggle.querySelector('.nav-icon') || toggle;
  /* Mode is decided at event time, never at load time, so resizing the
     window or toggling device emulation always behaves like a fresh load. */
  var desktop = window.matchMedia('(min-width: 601px)');
  var canHover = window.matchMedia('(hover: hover)');
  function hoverMode() { return desktop.matches && canHover.matches; }

  /* Place an opened cascade panel. Prefer opening to the right with a small
     overlap. If the right edge would leave the window, mirror to the left.
     If the bottom would leave the window, slide the panel up just enough. */
  function placeSub(li, sub) {
    sub.style.left = sub.style.right = sub.style.top = '';
    if (!desktop.matches) return;
    var margin = 10;
    var lr = li.getBoundingClientRect();
    var sr = sub.getBoundingClientRect();
    var vw = document.documentElement.clientWidth;
    var vh = document.documentElement.clientHeight;
    if (sr.right > vw - margin) {
      var left = vw - margin - sr.width - lr.left;
      if (lr.left + left < margin) left = margin - lr.left;
      sub.style.left = Math.round(left) + 'px';
    }
    if (sr.bottom > vh - margin) {
      var top = (sr.top - lr.top) - (sr.bottom - (vh - margin));
      if (lr.top + top < margin) top = margin - lr.top;
      sub.style.top = Math.round(top) + 'px';
    }
  }

  function setSub(li, open) {
    var sub = li.querySelector(':scope > .sub');
    if (open && sub) placeSub(li, sub);
    li.classList.toggle('open', open);
    li.querySelector(':scope > .sub-toggle').setAttribute('aria-expanded', open);
  }

  function closeBranches(except) {
    nav.querySelectorAll('.has-sub.open').forEach(function (li) {
      if (!except || !li.contains(except)) setSub(li, false);
    });
  }

  function closeAll() {
    closeBranches(null);
    nav.classList.remove('open');
    toggle.setAttribute('aria-expanded', 'false');
    icon.textContent = '☰';
  }

  toggle.addEventListener('click', function () {
    var open = nav.classList.toggle('open');
    toggle.setAttribute('aria-expanded', open);
    icon.textContent = open ? '✕' : '☰';
    if (!open) closeBranches(null);
  });

  nav.querySelectorAll('.sub-toggle').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var li = btn.parentElement;
      clearTimeout(li._hoverTimer);
      clearTimeout(li._closeTimer);
      /* In hover mode a click only ever opens, beating the hover delay for
         decisive clickers. Mouseaway is the sole closer there. The mobile
         sheet keeps the toggle, since it has no hover to close with. */
      if (hoverMode()) {
        if (!li.classList.contains('open')) setSub(li, true);
        return;
      }
      var willOpen = !li.classList.contains('open');
      if (!willOpen) {
        li.querySelectorAll('.has-sub.open').forEach(function (d) { setSub(d, false); });
      }
      setSub(li, willOpen);
    });
  });

  nav.querySelectorAll('.back-btn').forEach(function (b) {
    b.addEventListener('click', function () {
      setSub(b.closest('.has-sub'), false);
    });
  });

  /* Clicking back on an earlier panel collapses every branch that does not
     contain the click, at any depth. Clicking the page scrim closes all. */
  nav.addEventListener('click', function (e) {
    if (e.target === nav) { closeAll(); return; }
    if (!e.target.closest('.nav-toggle') && !e.target.closest('.sub-toggle')) {
      closeBranches(e.target);
    }
  });

  document.addEventListener('click', function (e) {
    if (!nav.contains(e.target)) closeAll();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeAll();
  });

  /* Hover opens after a short delay, so a decisive clicker can click the
     toggle before hover fires. Leaving or clicking cancels the pending open.
     Listeners are always attached but check the mode when they fire, so a
     desktop browser narrowed to mobile width stops hovering immediately. */
  var HOVER_DELAY = 60;
  /* Closing on mouseaway waits a grace period, so crossing a gap between
     an item and its panel, or a clamped panel's odd geometry, does not
     drop the menu mid-journey. Re-entering cancels the pending close. */
  var CLOSE_GRACE = 250;
  nav.querySelectorAll('.has-sub').forEach(function (li) {
    li.addEventListener('mouseenter', function () {
      clearTimeout(li._closeTimer);
      if (!hoverMode()) return;
      if (!li.classList.contains('open')) {
        li._hoverTimer = setTimeout(function () { setSub(li, true); }, HOVER_DELAY);
      }
    });
    li.addEventListener('mouseleave', function () {
      clearTimeout(li._hoverTimer);
      if (!hoverMode()) return;
      li._closeTimer = setTimeout(function () { setSub(li, false); }, CLOSE_GRACE);
    });
  });

  /* Crossing the breakpoint resets the menu, so no open panels, pins, or
     computed positions leak from one layout into the other. */
  desktop.addEventListener('change', closeAll);

  var here = location.pathname.split('/').pop() || 'index.html';
  nav.querySelectorAll('a').forEach(function (a) {
    if (a.getAttribute('href') === here) {
      a.classList.add('here');
      var sub = a.closest('.sub');
      if (sub) sub.parentElement.querySelector('.sub-toggle').classList.add('here');
    }
  });
});

/* Cache keys for everything the CLIENT fetches or injects at runtime — the
   vendored lazy scripts, the Bible/emoji data files, the Turnstile frame.

   They live here rather than in client/comments.ts for one structural reason: a
   key written into the bundle's source would change the bundle, which would
   change the bundle's own key, which would need re-stamping. Keeping them in
   nav.js — which nothing else is keyed on — breaks that loop. The line below is
   rewritten wholesale by scripts/stamp_versions.py; do not hand-edit it.

   GitHub Pages serves everything max-age=600 and a Cloudflare purge cannot
   reach a phone's own cache, so a changing URL is the only real control. Before
   this, tweetnacl.min.js and lamejs.min.js were pinned at a hand-written ?v=1
   that had not moved since July. */
var MC_ASSETS = {"avatars/presets/index.json":"1133856240","dr.json":"3308964207","emoji/emoji-data.json":"295875345","kjv.json":"856040020","lamejs.min.js":"701830801","qr.min.js":"1058418721","turnstile.html":"1895132035","tweetnacl.min.js":"2537342323"};
window.mcAssets = MC_ASSETS;
/* `name` with its current key, or bare if we have never heard of it (which is
   the honest fallback: an unkeyed URL still works, it is merely cacheable). */
window.mcAsset = function (name) {
  var v = MC_ASSETS[name];
  return v ? name + '?v=' + v : name;
};

/* Deep-link anchors for the generated Scripture and Fathers pages. Loaded from
   here so it reaches every page (all of which already carry nav.js) without
   rebuilding any of them; the script itself no-ops on the hand-authored pages. */
(function () {
  var s = document.createElement('script');
  s.src = 'deeplink.js?v=2297687171';
  document.head.appendChild(s);
})();

/* The installable face's identity, declared HERE — the first script every page
   carries — not from the app bundle: iOS captures the manifest at the moment
   the reader taps Add to Home Screen, and a tap in the seconds before the app
   bundle arrived over the network produced a manifest-less white web clip (seen live
   2026-08-02). The shell's own injection stays as a guard; both are idempotent.
   apple-touch-icon gives iOS a real icon even for a pre-manifest capture. */
(function () {
  if (!document.querySelector('link[rel="manifest"]')) {
    var mf = document.createElement('link');
    mf.rel = 'manifest';
    mf.href = 'manifest.webmanifest';
    document.head.appendChild(mf);
  }
  if (!document.querySelector('link[rel="apple-touch-icon"]')) {
    var ti = document.createElement('link');
    ti.rel = 'apple-touch-icon';
    ti.href = 'icon-192.png';
    document.head.appendChild(ti);
  }
})();

/* The app shell (Lit soft-navigation) — THE DEFAULT since 2026-07-30:
   every reader gets soft navigation, the persistent audio dock, and the
   installable face. ?app=0 is the standing opt-out latch (sticky per
   browser), ?app=1 the way back in; with storage blocked the site simply
   stays a website. */
(function () {
  try {
    if (/[?&]app=0\b/.test(location.search)) localStorage.setItem('mc-app', '0');
    else if (/[?&]app=1\b/.test(location.search)) localStorage.removeItem('mc-app');
    /* the bundle always loads (it carries the single living render path);
       the latch is read inside the shell and disables only the app chrome */
    var s = document.createElement('script');
    s.src = 'app.js?v=2925617269';
    s.defer = true;
    document.head.appendChild(s);
  } catch (e) { /* storage blocked: the site stays a website */ }
})();

/* Breadcrumbs + the submit backstop (2026-08-03, born of a live report:
   hitting Post occasionally refreshed the page without posting — the draft
   survived, the second click worked, and nothing recorded WHY).
   1. window.mcCrumb(msg) appends to a small persistent ring (localStorage —
      unlike the in-page error ring it SURVIVES the very reload it is there
      to explain) shown in the ?debug=1 overlay. Every real unload leaves a
      'pagehide' crumb, so after an incident the ring distinguishes a
      graceful navigation/reload (crumb present, cause named by its
      neighbors) from an engine crash-reload (no crumb at all).
   2. The backstop: every action-less <form> on this site is JS-handled
      (search boxes, the merecat ask box) — its native submission is never
      right, only a same-URL GET that reloads the page and posts nothing.
      If a submit reaches the document unhandled (a handler lost to a
      mid-build error, a not-yet-booted view), swallow it and record it
      instead of letting the browser refresh. Forms with a real action
      (the contact form) are left alone. */
(function () {
  function crumb(msg) {
    try {
      var ring = JSON.parse(localStorage.getItem('mc-crumbs') || '[]');
      ring.push(new Date().toISOString().slice(5, 19) + ' ' + String(msg).slice(0, 120));
      /* Room for a whole incident. One submit now writes several entries
         (submit, turnstile execute, turnstile ok, then whatever unloads),
         so a 20-deep ring showing its last 8 could push the interesting
         part off the top before it was ever read. */
      if (ring.length > 40) ring = ring.slice(ring.length - 40);
      localStorage.setItem('mc-crumbs', JSON.stringify(ring));
    } catch (e) { /* storage blocked: crumbs are diagnosis, never load-bearing */ }
  }
  window.mcCrumb = crumb;
  document.addEventListener('submit', function (e) {
    var f = e.target;
    if (!f || f.tagName !== 'FORM' || e.defaultPrevented) return;
    if (f.getAttribute('action')) return;
    e.preventDefault();
    crumb('swallowed native submit: ' + (f.className || f.id || 'form') + ' @ ' + location.pathname);
  });
  /* HOW this document came to exist. The Navigation Timing type is the one
     fact that separates the possibilities we are left with, and the browser
     hands it over for free:
       reload        — something called location.reload(), or the app/OS did
       navigate      — a link, a location.href, or a fresh open
       back_forward  — history travel
     A run of `navigate` entries to the same URL is a hard link; a run of
     `reload` is something reloading us. Crumbed at load so it sits directly
     under the pagehide of the document it replaced. */
  try {
    var navEntry = (window.performance.getEntriesByType &&
      window.performance.getEntriesByType('navigation')[0]) || null;
    if (navEntry) crumb('load(' + navEntry.type + ') ' + location.pathname + location.search.slice(0, 30));
  } catch (e) { /* older engines: the pagehide pair still tells a story */ }

  /* beforeunload fires when the PAGE is leaving — a navigation, a reload, a
     link. It does NOT fire when the system discards the document underneath
     you. Pairing it with pagehide is therefore the test we cannot otherwise
     make: both = the page went somewhere; pagehide alone = something took it. */
  window.addEventListener('beforeunload', function () {
    crumb('beforeunload ' + location.pathname);
  });
  window.addEventListener('pagehide', function () {
    crumb('pagehide ' + location.pathname + ' age=' + Math.round(window.performance.now() / 1000) + 's');
  });
})();

/* The installed app's self-update lifecycle (2026-08-02, born of a live
   report: an installed iOS app ran days-old code and never healed). The SW is
   registered here — the FIRST script every page carries, never cached under a
   version key — so even a page running a stale bundle still pumps updates:
   1. iOS checks sw.js for byte changes only on a NAVIGATION, and an installed
      app is usually RESUMED, not relaunched — so every return to the
      foreground (and a slow hourly tick) asks the browser to re-check
      (registration.update()), throttled to one check per 5 minutes;
   2. when a NEW worker takes control mid-life (an update landing — NOT the
      first install claiming the page), or the worker reports this very page's
      cached skeleton was stale (mc-page-updated from sw.js), a YOUNG page
      reloads once: a page seconds into its life is a launch that painted
      yesterday's markup, and healing it costs a blink. An older page is
      mid-use — never yank it; the fresh copy serves the next navigation.
      Guards: once per page life, never while the reader is mid-typing, at
      most twice per 5 minutes across reloads (sessionStorage), so a surprise
      can never become a reload loop. */
(function () {
  if (!('serviceWorker' in navigator)) return;
  try { if (localStorage.getItem('mc-app') === '0') return; } catch (e) { /* latch unreadable: proceed */ }
  var sw = navigator.serviceWorker;
  try { sw.register('sw.js', { updateViaCache: 'none' }).catch(function () {}); } catch (e) { return; }

  var lastCheck = 0;
  function check() {
    var now = Date.now();
    if (now - lastCheck < 300000) return;
    lastCheck = now;
    sw.getRegistration().then(function (r) {
      if (r) r.update().catch(function () {});
    }).catch(function () {});
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') check();
  });
  window.addEventListener('pageshow', function (ev) { if (ev.persisted) check(); });
  setInterval(check, 3600000);

  var reloaded = false;
  function young() {
    /* WALL-CLOCK age, not performance.now(): on iOS the monotonic clock can
       exclude time suspended, so a resumed installed app read as seconds old
       hours after its real load — reopening the heal window exactly when the
       reader came back to act (and a heal firing as they hit Post killed the
       submit). Date.now() minus the document's birth cannot be fooled. */
    try {
      var t0 = window.performance.timeOrigin ||
        (window.performance.timing && window.performance.timing.navigationStart) || 0;
      if (t0) return Date.now() - t0 < 30000;
      return window.performance.now() < 30000;
    } catch (e) { return false; }
  }
  /* Shared with the update banner below via window.mcTyping — ONE definition,
     because two copies of "is the reader mid-compose" would drift and the
     one that drifted would be the one that ate somebody's post. */
  function typing() {
    var el = document.activeElement;
    if (el && (el.tagName === 'TEXTAREA' || el.isContentEditable ||
      (el.tagName === 'INPUT' && el.type !== 'submit' && el.type !== 'button')) &&
      (el.value || el.textContent || '').length > 0) return true;
    /* A non-empty composer ANYWHERE is mid-use even when focus has moved on —
       the reader may be one click from posting it (tapping Post moves focus
       to the button, which is precisely when the old focused-element check
       went blind and a heal could eat the submit). Textareas only: text
       inputs are routinely prefilled by code (the search box echoes ?q=),
       and a composer is a textarea everywhere on this site. */
    var tas = document.querySelectorAll('textarea');
    for (var i = 0; i < tas.length; i++) {
      if (tas[i].value && tas[i].value.length > 0) return true;
    }
    /* A media post can ride an EMPTY body: a filled topic title or a visible
       attachment chip (a picked photo, a recorded voice note) is mid-use
       every bit as much as typed text. */
    var title = document.querySelector('input.board-title');
    if (title && title.value) return true;
    var chips = document.querySelectorAll('.dm-attach-chip');
    for (var j = 0; j < chips.length; j++) {
      if (chips[j].textContent && chips[j].offsetParent !== null) return true;
    }
    return false;
  }
  window.mcTyping = typing;
  /* key names the CAUSE ('page:/feed.html', 'sw') — the worker resends each
     signal several times (single sends race document creation and reach
     nobody), and the same cause may arrive over two channels, so a stamp in
     sessionStorage swallows repeats for 20s (it survives the reload; the
     resends land on the healed page and do nothing). The rolling 2-per-5min
     cap is the reload-loop backstop. */
  function healReload(key) {
    if (reloaded || !young() || typing()) return;
    var now = Date.now(), hist = [];
    try {
      var last = Number(sessionStorage.getItem('mc-heal:' + key) || 0);
      if (now - last < 20000) return;
      hist = JSON.parse(sessionStorage.getItem('mc-sw-heal') || '[]');
    } catch (e) { hist = []; }
    hist = hist.filter(function (t) { return now - t < 300000; });
    if (hist.length >= 2) return;
    hist.push(now);
    try {
      sessionStorage.setItem('mc-sw-heal', JSON.stringify(hist));
      sessionStorage.setItem('mc-heal:' + key, String(now));
    } catch (e) { /* still reload */ }
    reloaded = true;
    if (window.mcCrumb) window.mcCrumb('heal-reload ' + key);
    location.reload();
  }
  /* bornControlled tells an UPDATE apart from the first install: a page whose
     very load was served under a worker is living through an update when a new
     worker announces itself; a page born uncontrolled just witnessed its
     first install — nothing it runs is stale. controllerchange stays as belt
     and braces where it fires; the worker's own mc-sw-updated message is the
     reliable channel (same 'sw' key, so never both). */
  var bornControlled = !!sw.controller;
  var hadController = bornControlled;
  sw.addEventListener('controllerchange', function () {
    if (!hadController) { hadController = true; return; }   // first install claiming the page
    healReload('sw');
  });
  sw.addEventListener('message', function (ev) {
    var d = ev.data || {};
    if (!d) return;
    if (d.t === 'mc-page-updated' && d.path === location.pathname) healReload('page:' + d.path);
    else if (d.t === 'mc-sw-updated' && bornControlled) healReload('sw');
  });
  /* addEventListener alone leaves client messages QUEUED (delivery starts only
     when onmessage is assigned or startMessages() is called) — without this
     the stale-skeleton signal would never arrive. */
  try { if (sw.startMessages) sw.startMessages(); } catch (e) { /* older engine */ }
  /* Report this deploy's ACTUAL asset URLs so the worker can prime its cache —
     only the page knows the current ?v= keys (sw v5 never intercepts what it
     has not positively cached, so priming is what turns the cache on). Idle-
     deferred; priming is an optimization and nothing depends on it. */
  window.setTimeout(function () {
    try {
      var urls = ['nav.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];
      document.querySelectorAll('script[src], link[rel="stylesheet"][href]').forEach(function (el) {
        var u = el.getAttribute('src') || el.getAttribute('href') || '';
        if (/(^|\/)(app\.js|deeplink\.js|style\.css)([?#]|$)/.test(u)) urls.push(u);
      });
      sw.ready.then(function (reg) {
        if (reg && reg.active) reg.active.postMessage({ t: 'mc-prime', urls: urls });
      }).catch(function () { /* no registration: nothing to prime */ });
    } catch (e) { /* fine */ }
  }, 2500);
})();

/* IS THIS DEVICE RUNNING THE CURRENT APP? (2026-09-08)

   Every asset now carries a content-hash key, and docs/version.json is the
   manifest of what the server currently serves. This compares that manifest
   against the keys THIS PAGE IS ACTUALLY RUNNING — read off the live <script>
   and <link> URLs, not from a constant compiled in.

   Comparing what is loaded rather than a stamped-in build id is the whole
   point: the real hazard on this site is a browser- or service-worker-cached
   HTML skeleton whose baked-in ?v= keys are older than the kernel it is
   talking to. A constant would say "I am build X" and be right about itself
   while the page around it was stale. The URLs cannot lie.

   Lives in nav.js, like the service-worker pump and for the same reason: it is
   the first script on every page and it keeps working when the stale thing IS
   the app bundle.

   It PROMPTS and never acts. The owner's call, and the right one — the app has
   spent a week being reloaded out from under its reader. */
(function () {
  var VERSION_URL = 'version.json';
  var manifest = null;

  /* What this page is actually running: {asset: key} read from the DOM. */
  function running() {
    var out = {};
    var nodes = document.querySelectorAll('script[src], link[href]');
    for (var i = 0; i < nodes.length; i++) {
      var raw = nodes[i].getAttribute('src') || nodes[i].getAttribute('href') || '';
      var m = /([^/?#]+)\?v=([0-9a-z]+)/.exec(raw);
      if (m) out[m[1]] = m[2];
    }
    return out;
  }

  /* Which assets this page carries that the server has since moved on from.
     Only assets present in BOTH are compared: a page that does not load
     comments.js is not stale for lacking it. */
  function behind(served) {
    var have = running(), out = [];
    for (var k in have) {
      if (Object.prototype.hasOwnProperty.call(have, k) &&
          served[k] && served[k] !== have[k]) out.push(k);
    }
    return out;
  }

  function typingNow() {
    /* The shared guard when it exists. It is defined inside the service-worker
       block, which returns early where workers are unsupported or the app is
       latched off — hence the small honest fallback rather than a second full
       copy that could drift from the original. */
    if (window.mcTyping) { try { return window.mcTyping(); } catch (e) { /* fall through */ } }
    var tas = document.querySelectorAll('textarea');
    for (var i = 0; i < tas.length; i++) if (tas[i].value) return true;
    return false;
  }

  var bar = null;
  function dismissed(build) {
    try { return sessionStorage.getItem('mc-ver-hide') === build; } catch (e) { return false; }
  }
  function banner(build, stale) {
    if (bar || dismissed(build)) return;
    /* Never over a half-written post. It will be offered again on the next
       check, which is at most five minutes away. */
    if (typingNow()) return;
    bar = document.createElement('div');
    bar.className = 'mc-update-bar';
    bar.setAttribute('role', 'status');
    var msg = document.createElement('span');
    msg.textContent = 'A new version of the app is ready.';
    var go = document.createElement('button');
    go.type = 'button';
    go.className = 'mc-update-go';
    go.textContent = 'Reload';
    go.onclick = function () {
      if (window.mcCrumb) window.mcCrumb('update banner -> reload (' + stale.join(',') + ')');
      location.reload();
    };
    var later = document.createElement('button');
    later.type = 'button';
    later.className = 'mc-update-later';
    later.textContent = 'Later';
    later.onclick = function () {
      try { sessionStorage.setItem('mc-ver-hide', build); } catch (e) { /* fine */ }
      if (bar && bar.parentNode) bar.parentNode.removeChild(bar);
      bar = null;
    };
    bar.appendChild(msg);
    bar.appendChild(go);
    bar.appendChild(later);
    /* data-mc-app marks furniture the app shell preserves across a <main>
       swap, so a soft navigation does not silently drop the notice. */
    bar.setAttribute('data-mc-app', '');
    document.body.appendChild(bar);
  }

  function check() {
    /* no-store, not no-cache: the answer to "what is current" must never come
       from the cache being asked about. */
    return fetch(VERSION_URL, { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || !d.assets) return null;
        manifest = d;
        var stale = behind(d.assets);
        if (stale.length) {
          if (window.mcCrumb) window.mcCrumb('version: behind on ' + stale.join(','));
          banner(d.build, stale);
        }
        return d;
      })
      .catch(function () { return null; });   // offline: silence, not a scare
  }

  /* Read by the Settings → About panel, so there is one source of truth about
     what this device is running. */
  window.mcVersion = {
    running: running,
    served: function () { return manifest; },
    stale: function () { return manifest ? behind(manifest.assets) : []; },
    check: check,
  };

  /* The same rhythm as the service-worker pump: on return to the foreground, on
     a restored page, and an hourly tick — throttled so a busy tab-switcher asks
     once per five minutes. version.json is a few hundred bytes of static Pages
     content: no worker request, nothing against the free-tier budget. */
  var last = 0;
  function paced() {
    var now = Date.now();
    if (now - last < 300000) return;
    last = now;
    check();
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') paced();
  });
  window.addEventListener('pageshow', function (ev) { if (ev.persisted) paced(); });
  setInterval(paced, 3600000);
  /* One check shortly after load, late enough not to compete with the page's
     own first paint and its data fetches. */
  setTimeout(paced, 4000);
})();

/* ?debug=1: a small diagnostic overlay for the next "the app is acting up"
   report — shows what a phone cannot otherwise say: which bundle versions this
   page is actually running, whether a service worker controls it and under
   which cache VERSION, standalone or browser, and the last JS errors. The
   error ring buffer records from first script on every page (nav.js loads
   first) so the overlay can be consulted after the fact; readers never see
   any of this without the query flag. Tap the overlay to dismiss. */
(function () {
  var errs = [];
  var painting = false;
  var dismissed = false;
  /* Two ways in. ?debug=1 is the one-shot: what you tell someone to type once
     so a report arrives with a screenshot. mc-debug is the STICKY one, set by
     the Settings switch — an installed app has no address bar to type a query
     into, and asking anyone to remember a URL every time is a poor tool. The
     flag is per-device and set only by the person who flips it, so leaving it
     on affects nobody else. */
  var forced = false;
  try {
    forced = /[?&]debug=1\b/.test(location.search) ||
      localStorage.getItem('mc-debug') === '1';
  } catch (e) { forced = false; }
  function standaloneMode() {
    try {
      return navigator.standalone === true ||
        (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
    } catch (e) { return false; }
  }
  function start() {
    if (painting || dismissed) return;
    painting = true;
    function go() { paint(); setInterval(paint, 2000); }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go);
    else go();
  }
  /* Auto-show is for the OWNER'S phone, never the members' (live report
     2026-08-03: a reader opening Feed met a wall of diagnostics because a
     cross-origin script hiccuped). Gate: the mc-admin flag loadMyProfile
     maintains. Anyone may still open ?debug=1 DELIBERATELY — that is how a
     member report gets its screenshot — but an error never pushes the panel
     at a regular reader. */
  function adminHere() {
    try { return localStorage.getItem('mc-admin') === '1'; } catch (e) { return false; }
  }
  function note(m, opaque) {
    errs.push(new Date().toISOString().slice(11, 19) + ' ' + String(m).slice(0, 160));
    if (errs.length > 12) errs.shift();
    /* Mirror into the persistent ring: an error that precedes a reload (the
       very state that disarms a form's submit handler) must outlive it. */
    if (window.mcCrumb) window.mcCrumb('err: ' + String(m).slice(0, 100));
    if (opaque) return;   // "Script error. @ :0" (cross-origin, no detail): record, never pop
    /* An installed app has no URL bar to reach ?debug=1 with — so in
       STANDALONE mode an uncaught error paints the overlay by itself: the
       broken state carries its own diagnosis. Browser tabs stay quiet. */
    if (standaloneMode() && adminHere()) start();
  }
  window.addEventListener('error', function (e) {
    /* A cross-origin script's exception arrives OPAQUE — the literal message
       "Script error." with no file and line 0 (Turnstile et al.). Nothing in
       it is actionable, so it is recorded but never pops the panel. */
    var opaque = /^Script error\.?$/.test(e.message || '') || (!e.filename && !e.lineno);
    note((e.message || 'error') + ' @ ' + String(e.filename || '').split('/').pop() + ':' + (e.lineno || 0), opaque);
  });
  window.addEventListener('unhandledrejection', function (e) {
    var r = e.reason;
    note('unhandled: ' + ((r && (r.message || r)) || 'rejection'));
  });
  if (forced) start();
  /* The switch has to work while you are standing there, and dismissal must not
     be a one-way door. Both were broken in the first cut: `dismissed` was a
     latch for the life of the DOCUMENT, and the app soft-navigates, so one
     accidental tap killed the overlay until a hard reload — turning the setting
     off and on again did nothing either, because `forced` was read once at
     load. Re-read the flag on a timer, and let a navigation bring a dismissed
     panel back. */
  function wanted() {
    try {
      return /[?&]debug=1\b/.test(location.search) || localStorage.getItem('mc-debug') === '1';
    } catch (e) { return false; }
  }
  document.addEventListener('mc-navigate', function () { dismissed = false; });
  setInterval(function () {
    if (!wanted()) {
      var gone = document.getElementById('mc-debug');
      if (gone) gone.remove();
      return;
    }
    if (!dismissed) start();
  }, 1500);

  function paint() {
    if (!wanted()) { var off = document.getElementById('mc-debug'); if (off) off.remove(); return; }
    if (dismissed || !document.body) return;
    var el = document.getElementById('mc-debug') || document.createElement('pre');
    el.id = 'mc-debug';
    el.style.cssText = 'position:fixed;left:8px;right:8px;bottom:8px;z-index:99999;' +
      'background:rgba(15,17,19,.94);color:#e8e2d5;font:11px/1.5 monospace;' +
      'padding:10px;border-radius:8px;max-height:45vh;overflow:auto;white-space:pre-wrap;margin:0';
    /* Tapping the BODY does nothing now — that is how it kept vanishing. Only
       the × hides it, and only until the next navigation. */
    el.onclick = null;
    var lines = [];
    lines.push('mode: ' + (standaloneMode() ? 'standalone (installed app)' : 'browser tab'));
    var scripts = [];
    try {
      document.querySelectorAll('script[src]').forEach(function (s) {
        var m = (s.getAttribute('src') || '').match(/(app|comments|bible-reader)\.js\?v=\d+/);
        if (m) scripts.push(m[0]);
      });
    } catch (e) { /* fine */ }
    lines.push('scripts: ' + (scripts.join(' ') || 'none versioned yet'));
    if ('serviceWorker' in navigator) {
      lines.push('sw controller: ' + (navigator.serviceWorker.controller ? 'yes' : 'NO'));
    } else lines.push('sw: unsupported');
    lines.push('page age: ' + Math.round(window.performance.now() / 1000) + 's  path: ' + location.pathname);
    var head = lines.join('\n');
    /* The persistent breadcrumb ring (window.mcCrumb): pagehides, heal-reload
       causes, swallowed native submits — the story of the last few unloads,
       readable AFTER the reload that would have erased an in-page log. */
    var crumbs = [];
    try { crumbs = JSON.parse(localStorage.getItem('mc-crumbs') || '[]'); } catch (e) { /* fine */ }
    var tail = (crumbs.length ? 'crumbs:\n' + crumbs.slice(-16).join('\n') + '\n' : '') +
      (errs.length ? 'errors:\n' + errs.join('\n') : 'errors: none');
    /* Buttons live in their own row so the body can stay a plain <pre> that
       selects and copies cleanly. Rebuilt each paint; cheap, and it keeps the
       copy button's payload in step with what is on screen. */
    function chrome(text) {
      el.textContent = text;
      var bar = document.createElement('div');
      bar.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;margin-bottom:6px';
      var copy = document.createElement('button');
      copy.textContent = 'Copy';
      copy.style.cssText = 'font:11px/1 monospace;padding:5px 10px;border-radius:6px;' +
        'border:1px solid #4a4a4a;background:#1e2126;color:#e8e2d5';
      copy.onclick = function (ev) {
        ev.stopPropagation();
        var payload = text;
        function ok() { copy.textContent = 'Copied'; setTimeout(function () { copy.textContent = 'Copy'; }, 1200); }
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(payload).then(ok, fallback);
          } else fallback();
        } catch (e) { fallback(); }
        function fallback() {
          /* iOS standalone can refuse the async clipboard; the old road works. */
          try {
            var ta = document.createElement('textarea');
            ta.value = payload;
            ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            ta.remove();
            ok();
          } catch (e2) { copy.textContent = 'Select and copy'; }
        }
      };
      var hide = document.createElement('button');
      hide.textContent = '\u00d7';
      hide.style.cssText = copy.style.cssText;
      hide.onclick = function (ev) { ev.stopPropagation(); dismissed = true; el.remove(); };
      bar.appendChild(copy);
      bar.appendChild(hide);
      el.insertBefore(bar, el.firstChild);
    }
    chrome(head + '\ncaches: …\n' + tail);
    if (window.caches && window.caches.keys) {
      window.caches.keys().then(function (ks) {
        chrome(head + '\ncaches: ' + (ks.join(', ') || 'none') + '\n' + tail);
      }).catch(function () {});
    }
    if (!el.parentNode) document.body.appendChild(el);
  }
})();
