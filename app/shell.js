/* The app shell: soft navigation for the whole site — THE DEFAULT since
   Phase 1a (2026-07-30); ?app=0 is the standing opt-out latch, ?app=1 the
   way back in.

   Intercepts same-origin page links, fetches the target document, swaps the
   content region in place, and pushes history — no white flash, the nav and
   theme and the audio dock persisting untouched above it. Books and papers
   stay the same server-rendered documents they always were; this only
   changes how they ARRIVE. Anything doubtful — modified clicks, downloads,
   PDFs, cross-origin, oversized volumes, the away interstitial or a page
   marked data-noshell — falls back to an ordinary full navigation: the
   shell is an enhancement, never a cage.

   Every per-page script is a BOOT: the shell tears the old page's client
   down (mcCommentsTeardown aborts pollers and live ask streams — safe by
   the merecat disconnect contract: the question is stored, partials flush,
   re-entering resumes), swaps content, loads any script the new page needs
   that is not yet present, and boots the ones that are. Booting is exactly
   what a hard load always did, so behavior cannot drift.

   Content region: the page's <main> when both sides have one (the
   normalized skeleton), else every body sibling after the nav block's
   <script src=nav.js> — minus the shell's own fixtures. The permalink
   contract rides mcDeeplink.run()/reveal() after each swap.

   Free-tier law: this file talks to GitHub Pages only — it never touches
   /api/* and adds no polling. A small in-memory cache makes back/forward
   instant at zero requests. */

import { LitElement, html } from '../vendor/lit-all.min.js';
import * as store from './store.js';

/* The API store rides the shell (window bridge until the interiors port):
   in-memory TTL + in-flight dedup for the views' reads, invalidated by
   writes and identity changes. See app/store.js. */
window.mcStore = { fetchJson: store.fetchJson, invalidate: store.invalidate, metrics: store.metrics };

/* A thin top progress bar while a page is on its way. Light DOM so
   style.css and the theme own it. */
class McProgress extends LitElement {
  static properties = { active: { type: Boolean } };
  constructor() { super(); this.active = false; }
  createRenderRoot() { return this; }
  render() {
    return html`<div class="mc-progress-bar${this.active ? ' on' : ''}"></div>`;
  }
}
customElements.define('mc-progress', McProgress);

/* The persistent audio dock: ONE Audio element owned here, claimed by the
   Bible reader while its page stands, surfacing as a corner mini-player
   when the reader page is swapped away mid-listen — the sound never stops
   with the page. */
const dockAudio = new Audio();
dockAudio.preload = 'none';

class McAudioDock extends LitElement {
  static properties = { label: { type: String }, playing: { type: Boolean }, shown: { type: Boolean } };
  constructor() {
    super();
    this.label = '';
    this.playing = false;
    this.shown = false;
    this.claimed = false;
    dockAudio.addEventListener('play', () => this.sync());
    dockAudio.addEventListener('pause', () => this.sync());
    dockAudio.addEventListener('ended', () => this.sync());
  }
  createRenderRoot() { return this; }
  sync() {
    this.playing = !dockAudio.paused;
    this.shown = !this.claimed && this.playing;
    /* once paused while unclaimed, the bar lingers so it can be resumed;
       the ✕ is the way to dismiss it */
    if (!this.claimed && !this.playing && !dockAudio.src) this.shown = false;
  }
  toggle() { if (dockAudio.paused) dockAudio.play().catch(() => {}); else dockAudio.pause(); }
  dismiss() { dockAudio.pause(); this.shown = false; }
  render() {
    if (!this.shown) return html``;
    return html`<div class="mc-dock">
      <button type="button" class="mc-dock-play" @click=${this.toggle}
        title="Play / pause">${this.playing ? '❙❙' : '▶'}</button>
      <span class="mc-dock-label">${this.label}</span>
      <button type="button" class="mc-dock-x" @click=${this.dismiss}
        title="Stop listening" aria-label="Stop listening">×</button>
    </div>`;
  }
}
customElements.define('mc-audio-dock', McAudioDock);

(function () {
  'use strict';
  if (window.__mcShell) return;   // one shell per page lifetime
  window.__mcShell = true;

  var SIZE_CAP = 2000000;         // volumes past ~2 MB take the ordinary road
  var cache = new Map();          // pathname -> html text
  var CACHE_MAX = 8;

  var style = document.createElement('style');
  style.id = 'mc-app-css';
  style.textContent =
    '.mc-progress-bar{position:fixed;top:0;left:0;height:2px;width:0;' +
    'background:var(--maroon,#8b1a1a);z-index:9999;opacity:0;' +
    'transition:width .3s ease,opacity .3s ease}' +
    '.mc-progress-bar.on{opacity:1;width:70%;transition:width 8s cubic-bezier(.1,.7,.1,1),opacity .2s ease}' +
    '.mc-dock{position:fixed;right:12px;bottom:12px;z-index:9998;display:flex;align-items:center;gap:.5rem;' +
    'background:var(--surface,#fffdf7);border:1px solid var(--rule,#d9cfb8);border-radius:8px;' +
    'padding:.45rem .6rem;box-shadow:0 2px 10px rgba(0,0,0,.15);max-width:min(88vw,26rem)}' +
    '.mc-dock-play{font:inherit;cursor:pointer;border:1px solid var(--rule,#d9cfb8);background:none;' +
    'color:var(--maroon,#8b1a1a);border-radius:50%;width:2.1rem;height:2.1rem;line-height:1}' +
    '.mc-dock-label{font-size:.85rem;color:var(--ink,#1a1a1a);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.mc-dock-x{font:inherit;cursor:pointer;border:0;background:none;color:var(--faint,#8a7f6a);font-size:1.1rem}';
  document.head.appendChild(style);

  var progress = document.createElement('mc-progress');
  progress.setAttribute('data-mc-app', '');
  document.body.appendChild(progress);

  var dock = document.createElement('mc-audio-dock');
  dock.setAttribute('data-mc-app', '');
  document.body.appendChild(dock);
  window.mcAudioDock = {
    audio: dockAudio,
    claim: function (label) { dock.label = label || dock.label; dock.claimed = true; dock.sync(); },
    release: function () { dock.claimed = false; dock.sync(); },
  };

  /* PWA: the installable face. The worker caches only the small shell
     assets; documents and the API always ride the network. */
  if ('serviceWorker' in navigator) {
    try { navigator.serviceWorker.register('sw.js').catch(function () {}); } catch (e) { /* no sw */ }
  }
  if (!document.querySelector('link[rel="manifest"]')) {
    var mf = document.createElement('link');
    mf.rel = 'manifest';
    mf.href = 'manifest.webmanifest';
    document.head.appendChild(mf);
  }

  /* ---- the per-page boot registry ---- */
  var REG = {
    'comments.js': { boot: 'mcCommentsBoot', down: 'mcCommentsTeardown' },
    'bible-reader.js': { boot: 'mcBibleBoot', down: 'mcBibleTeardown' },
    'contact.js': { boot: 'mcContactBoot' },
    'index.js': { boot: 'mcIndexBoot' },
    'flash.js': { boot: 'mcFlashBoot' },
  };
  function baseName(src) {
    return (src || '').split('?')[0].split('/').pop();
  }
  var loadedScripts = {};
  Array.prototype.forEach.call(document.querySelectorAll('script[src]'), function (s) {
    loadedScripts[baseName(s.getAttribute('src'))] = true;
  });

  function teardownPage() {
    Object.keys(REG).forEach(function (name) {
      var down = REG[name].down;
      if (down && loadedScripts[name] && typeof window[down] === 'function') {
        try { window[down](); } catch (e) { /* half-torn is torn */ }
      }
    });
  }
  function pageScripts(doc) {
    var out = [];
    Array.prototype.forEach.call(doc.querySelectorAll('body script[src]'), function (s) {
      var name = baseName(s.getAttribute('src'));
      if (name === 'nav.js' || name === 'app.js') return;
      out.push({ name: name, src: s.getAttribute('src') });
    });
    return out;
  }
  function loadScript(src) {
    return new Promise(function (resolve) {
      var s = document.createElement('script');
      s.src = src;
      s.defer = true;
      s.onload = function () { resolve(true); };
      s.onerror = function () { resolve(false); };
      document.head.appendChild(s);
    });
  }
  function bootPage(doc) {
    var jobs = pageScripts(doc).map(function (want) {
      if (!loadedScripts[want.name]) {
        loadedScripts[want.name] = true;
        return loadScript(want.src);   // a fresh script self-boots on load
      }
      var reg = REG[want.name];
      if (reg && typeof window[reg.boot] === 'function') {
        try { window[reg.boot](); } catch (e) { /* boot failed; page still readable */ }
      }
      return Promise.resolve(true);
    });
    return Promise.all(jobs);
  }

  function navScript(doc) {
    return doc.querySelector('body script[src*="nav.js"]');
  }
  function contentNodes(doc) {
    var anchor = navScript(doc);
    if (!anchor) return null;
    var out = [];
    var n = anchor.nextSibling;
    while (n) {
      if (!(n.nodeType === 1 && (n.hasAttribute('data-mc-app') ||
            n.tagName === 'MC-PROGRESS' || n.tagName === 'MC-AUDIO-DOCK'))) out.push(n);
      n = n.nextSibling;
    }
    return out;
  }
  function swapContent(doc) {
    var mineMain = document.querySelector('main');
    var theirMain = doc.querySelector('main');
    if (mineMain && theirMain) {
      mineMain.replaceWith(document.importNode(theirMain, true));
      return true;
    }
    var fresh = contentNodes(doc);
    var old = contentNodes(document);
    if (!fresh || !old) return false;
    old.forEach(function (n) { if (n.parentNode) n.parentNode.removeChild(n); });
    var frag = document.createDocumentFragment();
    fresh.forEach(function (n) { frag.appendChild(document.importNode(n, true)); });
    document.body.appendChild(frag);
    return true;
  }
  function noShell(doc) {
    return !!doc.querySelector('.away, [data-noshell]');
  }
  function sameOrigin(url) { return url.origin === location.origin; }
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
    dock.sync();
  }

  var navigating = false;
  var lastPath = location.pathname;
  var lastSearch = location.search;
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
      if (noShell(doc)) throw new Error('noshell');
      if (!cached) {
        cache.set(key, text);
        if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
      }
      teardownPage();
      if (!swapContent(doc)) throw new Error('no anchor');
      document.title = doc.title || document.title;
      if (push) history.pushState({ mcApp: true }, '', url.pathname + url.search + url.hash);
      lastPath = location.pathname;
      lastSearch = location.search;
      if (!url.hash) window.scrollTo(0, 0);
      return bootPage(doc).then(function () {
        boots();
        progress.active = false;
        navigating = false;
      });
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
    if (a.hasAttribute('download') || a.hasAttribute('data-noshell')) return;
    if (a.classList.contains('dl-anchor')) return;   // the ¶ copies, never navigates
    var url;
    try { url = new URL(a.href, location.href); } catch (_) { return; }
    if (!sameOrigin(url) || !pageish(url)) return;
    if (url.pathname === location.pathname && url.search === location.search && url.hash) return;   // same-page anchor: native
    if (document.querySelector('.away')) return;     // the interstitial stays ordinary
    e.preventDefault();
    softNav(url, true);
  });

  window.addEventListener('popstate', function () {
    /* back/forward through ANCHOR history stays a scroll, never a swap —
       a changed pathname OR search re-enters the soft path (the board's
       views live in the query string); cache makes it instant. */
    var u = new URL(location.href);
    if (u.pathname === lastPath && u.search === lastSearch) return;   // hash-only travel
    if (document.querySelector('.away')) { location.reload(); return; }
    softNav(u, false);
  });
})();
