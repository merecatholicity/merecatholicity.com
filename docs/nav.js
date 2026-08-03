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
   the reader taps Add to Home Screen, and a tap in the seconds before app.js
   arrived over the network produced a manifest-less white web clip (seen live
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
    s.src = 'app.js?v=3909925058';
    s.defer = true;
    document.head.appendChild(s);
  } catch (e) { /* storage blocked: the site stays a website */ }
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
    try { return window.performance.now() < 30000; } catch (e) { return false; }
  }
  function typing() {
    var el = document.activeElement;
    return !!(el && (el.tagName === 'TEXTAREA' || el.isContentEditable ||
      (el.tagName === 'INPUT' && el.type !== 'submit' && el.type !== 'button')) &&
      (el.value || el.textContent || '').length > 0);
  }
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
  var forced = false;
  try { forced = /[?&]debug=1\b/.test(location.search); } catch (e) { forced = false; }
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
  function note(m) {
    errs.push(new Date().toISOString().slice(11, 19) + ' ' + String(m).slice(0, 160));
    if (errs.length > 12) errs.shift();
    /* An installed app has no URL bar to reach ?debug=1 with — so in
       STANDALONE mode an uncaught error paints the overlay by itself: the
       broken state carries its own diagnosis. Browser tabs stay quiet. */
    if (standaloneMode()) start();
  }
  window.addEventListener('error', function (e) {
    note((e.message || 'error') + ' @ ' + String(e.filename || '').split('/').pop() + ':' + (e.lineno || 0));
  });
  window.addEventListener('unhandledrejection', function (e) {
    var r = e.reason;
    note('unhandled: ' + ((r && (r.message || r)) || 'rejection'));
  });
  if (forced) start();
  function paint() {
    if (dismissed || !document.body) return;
    var el = document.getElementById('mc-debug') || document.createElement('pre');
    el.id = 'mc-debug';
    el.style.cssText = 'position:fixed;left:8px;right:8px;bottom:8px;z-index:99999;' +
      'background:rgba(15,17,19,.94);color:#e8e2d5;font:11px/1.5 monospace;' +
      'padding:10px;border-radius:8px;max-height:45vh;overflow:auto;white-space:pre-wrap;margin:0';
    el.onclick = function () { dismissed = true; el.remove(); };
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
    el.textContent = head + '\ncaches: …\n' + (errs.length ? 'errors:\n' + errs.join('\n') : 'errors: none');
    if (window.caches && window.caches.keys) {
      window.caches.keys().then(function (ks) {
        el.textContent = head + '\ncaches: ' + (ks.join(', ') || 'none') + '\n' +
          (errs.length ? 'errors:\n' + errs.join('\n') : 'errors: none');
      }).catch(function () {});
    }
    if (!el.parentNode) document.body.appendChild(el);
  }
})();
