/* The app shell: soft navigation for the whole site (Phase 1, behind ?app=1).

   Intercepts same-origin page links, fetches the target document, swaps the
   content region in place, and pushes history — no white flash, the nav and
   theme and (later) the audio player persisting untouched above it. Books
   and papers stay the same server-rendered documents they always were; this
   only changes how they ARRIVE. Anything doubtful — modified clicks,
   downloads, PDFs, cross-origin, oversized volumes, pages whose scripts are
   not yet swap-aware — falls back to an ordinary full navigation: the shell
   is an enhancement, never a cage.

   Content region = everything after the nav block's own <script src=nav.js>
   sibling (the skeleton has no <main> yet; Phase 1a normalizes that). The
   permalink contract rides mcDeeplink.run()/reveal() re-run after each swap.

   Free-tier law: this file talks to GitHub Pages only — it never touches
   /api/* and adds no polling. A small in-memory cache makes back/forward
   instant at zero requests. */

import { LitElement, html } from '../vendor/lit-all.min.js';

/* A thin top progress bar while a page is on its way — the one visible sign
   of the shell, rendered in light DOM so style.css and the theme own it. */
class McProgress extends LitElement {
  static properties = { active: { type: Boolean } };
  constructor() { super(); this.active = false; }
  createRenderRoot() { return this; }
  render() {
    return html`<div class="mc-progress-bar${this.active ? ' on' : ''}"></div>`;
  }
}
customElements.define('mc-progress', McProgress);

(function () {
  'use strict';
  if (window.__mcShell) return;   // one shell per page lifetime
  window.__mcShell = true;

  var SIZE_CAP = 2000000;         // volumes past ~2 MB take the ordinary road
  var cache = new Map();          // url -> html text (back/forward at zero cost)
  var CACHE_MAX = 8;

  var style = document.createElement('style');
  style.id = 'mc-app-css';
  style.textContent =
    '.mc-progress-bar{position:fixed;top:0;left:0;height:2px;width:0;' +
    'background:var(--maroon,#8b1a1a);z-index:9999;opacity:0;' +
    'transition:width .3s ease,opacity .3s ease}' +
    '.mc-progress-bar.on{opacity:1;width:70%;transition:width 8s cubic-bezier(.1,.7,.1,1),opacity .2s ease}';
  document.head.appendChild(style);
  var progress = document.createElement('mc-progress');
  progress.setAttribute('data-mc-app', '');
  document.body.appendChild(progress);

  function navScript(doc) {
    return doc.querySelector('body script[src*="nav.js"]');
  }
  /* The swappable range: every body sibling AFTER the nav block's script,
     minus anything the shell itself owns. */
  function contentNodes(doc) {
    var anchor = navScript(doc);
    if (!anchor) return null;
    var out = [];
    var n = anchor.nextSibling;
    while (n) {
      if (!(n.nodeType === 1 && (n.hasAttribute('data-mc-app') || n.tagName === 'MC-PROGRESS'))) out.push(n);
      n = n.nextSibling;
    }
    return out;
  }
  /* Pages whose scripts are not yet swap-aware keep ordinary navigation —
     sniffed from the DOCUMENT (current or fetched), so future pages are
     safe by default the moment they carry one of these mounts. */
  function unswappable(doc) {
    return !!doc.querySelector('[data-comments],[data-board],#bible-reader,#contact-form,.away');
  }
  function sameOrigin(url) {
    return url.origin === location.origin;
  }
  function pageish(url) {
    var p = url.pathname;
    return p === '/' || /\.html$/.test(p);
  }

  function markHere() {
    var nav = document.querySelector('nav.site');
    if (!nav) return;
    var here = location.pathname.split('/').pop() || 'index.html';
    nav.querySelectorAll('a.here, .sub-toggle.here').forEach(function (a) { a.classList.remove('here'); });
    nav.querySelectorAll('a').forEach(function (a) {
      if (a.getAttribute('href') === here) {
        a.classList.add('here');
        var sub = a.closest('.sub');
        if (sub) sub.parentElement.querySelector('.sub-toggle').classList.add('here');
      }
    });
  }

  function boots() {
    if (window.mcDeeplink) {
      window.mcDeeplink.run();
      if (location.hash) window.mcDeeplink.reveal();
    }
    markHere();
  }

  var navigating = false;
  var lastPath = location.pathname;
  function softNav(url, push) {
    if (navigating) return;
    navigating = true;
    progress.active = true;
    var key = url.pathname;
    var cached = cache.get(key);
    (cached
      ? Promise.resolve(cached)
      : fetch(url.pathname).then(function (res) {
          if (!res.ok) throw new Error('status ' + res.status);
          var len = Number(res.headers.get('Content-Length') || 0);
          if (len > SIZE_CAP) throw new Error('oversize');
          return res.text();
        })
    ).then(function (text) {
      var doc = new DOMParser().parseFromString(text, 'text/html');
      if (unswappable(doc)) throw new Error('unswappable');
      var fresh = contentNodes(doc);
      var old = contentNodes(document);
      if (!fresh || !old) throw new Error('no anchor');
      if (!cached) {
        cache.set(key, text);
        if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
      }
      old.forEach(function (n) { n.parentNode && n.parentNode.removeChild(n); });
      var frag = document.createDocumentFragment();
      fresh.forEach(function (n) { frag.appendChild(document.importNode(n, true)); });
      document.body.appendChild(frag);
      document.title = doc.title || document.title;
      if (push) history.pushState({ mcApp: true }, '', url.pathname + url.search + url.hash);
      lastPath = location.pathname;
      /* an anchored arrival lands exactly like a hard one — boots() runs
         reveal (scroll + tint); a plain arrival starts at the top */
      if (!url.hash) window.scrollTo(0, 0);
      boots();
      progress.active = false;
      navigating = false;
    }).catch(function () {
      /* any doubt at all: the ordinary road */
      progress.active = false;
      navigating = false;
      location.href = url.href;
    });
  }

  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target && e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    if (a.target && a.target !== '_self') return;
    if (a.hasAttribute('download')) return;
    if (a.classList.contains('dl-anchor')) return;   // the ¶ copies, never navigates
    var url;
    try { url = new URL(a.href, location.href); } catch (_) { return; }
    if (!sameOrigin(url) || !pageish(url)) return;
    if (url.pathname === location.pathname) {
      if (url.hash) return;                          // same-page anchor: native
      // same page, no hash: fall through to a soft reload of the page
    }
    if (unswappable(document)) return;               // leaving a live app page: ordinary road
    e.preventDefault();
    softNav(url, true);
  });

  window.addEventListener('popstate', function () {
    /* back/forward through ANCHOR history stays a scroll, never a swap —
       only a changed pathname re-enters the soft path (cache makes it
       instant); a state we never pushed is still ours to serve. */
    if (location.pathname === lastPath) return;   // deeplink's hashchange reveals
    if (unswappable(document)) { location.reload(); return; }
    softNav(new URL(location.href), false);
  });
})();
