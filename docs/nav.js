/* Light/dark theme: a reader's choice, saved in a year-long cookie, defaulting
   to the operating system's preference when nothing is saved. The stylesheet
   already answers prefers-color-scheme before any script runs, so a system-dark
   reader sees dark from first paint; this only records and re-applies an explicit
   choice. data-theme goes on <html>. The reader toggles the theme from the
   platform Settings (the gear → Appearance); there is no longer a corner widget. */
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
  function systemDark() {
    return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }
  function effective() {
    return readCookie() || (systemDark() ? 'dark' : 'light');
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
  s.src = 'deeplink.js?v=2';
  document.head.appendChild(s);
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
    s.src = 'app.js?v=35';
    s.defer = true;
    document.head.appendChild(s);
  } catch (e) { /* storage blocked: the site stays a website */ }
})();
