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

import { LitElement, html } from 'lit';
import * as store from './store.ts';
import * as api from './api.ts';
import * as core from './core.ts';
import { installLive } from './live.ts';
import { installChrome } from './appchrome.ts';
import './richtext.js';
import './views/board.js';
import './views/post.js';
import './views/topic.js';
import './views/member.js';
import './views/profile.js';
import './views/admin.js';

/* Shell-owned window seams (only referenced here among the typed files;
   declared locally to keep them off the shared globals.d.ts). */
declare global {
  interface Window {
    __mcShell?: boolean;
    __mcShellReady?: boolean;
    mcAudioDock?: { audio: HTMLAudioElement; claim: (ctx: any) => void; release: () => void };
  }
}

/* The API store rides the shell (window bridge until the interiors port):
   in-memory TTL + in-flight dedup for the views' reads, invalidated by
   writes and identity changes. See app/store.js. */
window.mcStore = { fetchJson: store.fetchJson, invalidate: store.invalidate, metrics: store.metrics };

/* The PureScript domain kernel — the app/core.js barrel over the compiled
   purescript/output/. The un-bundled docs/comments.js delegates to it via
   `if (window.mcCore) …`, exactly like window.mcRich; the Lit views import
   app/core.js directly. Importing it above is what inlines compiled PureScript
   into docs/app.js (the bundle route). See CLAUDE.md. */
window.mcCore = core as unknown as NonNullable<typeof window.mcCore>;

/* The headless-API client SDK (app/api.js) rides the shell too — the single
   documented seam (comments-worker/API.md) new features call. Transport +
   identity + fresh-read policy are wired from the board client (window.mcKit)
   once it boots, so api.js reuses the proven fetchRetry/key/freshOpts. */
window.mcApi = api as unknown as NonNullable<typeof window.mcApi>;
document.addEventListener('mc-shell-ready', function wireApi() {
  var tryWire = function () {
    var k = window.mcKit;
    if (!k) return false;
    api.configure({
      tx: function (url, init) { return k!.fetchRetry(url, init, [1000, 3000]); },
      key: function () { return k!.state.key || ''; },
      fresh: function () { return !!k!.freshOpts(); },
    });
    return true;
  };
  if (!tryWire()) {
    var t = setInterval(function () { if (tryWire()) clearInterval(t); }, 500);
    setTimeout(function () { clearInterval(t); }, 8000);
  }
});

/* A thin top progress bar while a page is on its way. Light DOM so
   style.css and the theme own it. */
class McProgress extends LitElement {
  static properties = { active: { type: Boolean } };
  declare active: boolean;
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

/* Continuous ("keep reading") play: when on, a finished chapter auto-advances to
   the next. Default ON. Shared (via localStorage) between this dock and the Bible
   reader's own player, so the one toggle governs both. */
function continuousOn(): boolean {
  try { return localStorage.getItem('mc-audio-continuous') !== '0'; } catch (e) { return true; }
}

/* The dock is a FULL mini-player. The reader hands it a context (the whole
   book table + audio base + reader page + current position), so once the
   reader page is swapped away the dock can still step chapters, auto-advance,
   label itself, and link back to the exact chapter in the reader — all on its
   own. It sits in a fixed corner (not draggable), with a continuous-play toggle
   that keeps reading into the next chapter when a file ends. */
class McAudioDock extends LitElement {
  static properties = {
    label: { type: String }, playing: { type: Boolean }, shown: { type: Boolean },
    href: { type: String }, canStep: { type: Boolean }, cont: { state: true },
  };
  declare label: string;
  declare playing: boolean;
  declare shown: boolean;
  declare href: string;
  declare canStep: boolean;
  declare cont: boolean;
  declare claimed: boolean;
  declare ctx: any;
  constructor() {
    super();
    this.label = ''; this.playing = false; this.shown = false;
    this.href = ''; this.canStep = false; this.claimed = false;
    this.ctx = null;    // { books:[{slug,name,chapters}], audioBase, page, reader, b, c }
    this.cont = continuousOn();   // keep-reading toggle, shared with the reader
    dockAudio.addEventListener('play', () => this.sync());
    dockAudio.addEventListener('pause', () => this.sync());
    dockAudio.addEventListener('ended', () => this.onEnded());
  }
  toggleCont() {
    const next = !continuousOn();
    try { localStorage.setItem('mc-audio-continuous', next ? '1' : '0'); } catch (e) { /* blocked */ }
    this.cont = next;
  }
  createRenderRoot() { return this; }
  sync() {
    this.playing = !dockAudio.paused;
    /* show when the reader is gone and there is sound (playing, or paused with
       a chapter still loaded so it can be resumed). The ✕ is the way to dismiss. */
    this.shown = !this.claimed && (this.playing || (!!dockAudio.src && !!this.ctx));
    var c = this.ctx;
    this.canStep = !!(c && c.books && c.books.length);
    if (c && c.books && c.books[c.b]) {
      var bk = c.books[c.b];
      this.label = '♪ ' + (c.reader ? c.reader + ' — ' : '') + bk.name + ' ' + c.c;
      this.href = (c.page || 'kjv.html') + '#' + bk.slug + '-' + c.c;
    }
  }
  /* the reader calls this on every chapter it opens */
  claim(ctx: any) {
    if (ctx && typeof ctx === 'object') this.ctx = Object.assign(this.ctx || {}, ctx);
    this.claimed = true;
    this.sync();
  }
  release() { this.claimed = false; this.sync(); }
  toggle() { if (dockAudio.paused) dockAudio.play().catch(() => {}); else dockAudio.pause(); }
  dismiss() {
    dockAudio.pause();
    try { dockAudio.removeAttribute('src'); dockAudio.load(); } catch (e) { /* fine */ }
    this.shown = false;
  }
  skip(d: number) {
    try { dockAudio.currentTime = Math.max(0, Math.min(dockAudio.duration || Infinity, (dockAudio.currentTime || 0) + d)); } catch (e) { /* not seekable yet */ }
  }
  /* step chapters, crossing book boundaries, entirely from ctx (no reader needed) */
  step(dir: number) {
    var c = this.ctx;
    if (!c || !c.books || !c.books.length) return;
    var b = c.b, ch = (c.c || 1) + dir;
    if (ch < 1) { if (b > 0) { b -= 1; ch = c.books[b].chapters; } else return; }
    else if (ch > c.books[b].chapters) { if (b < c.books.length - 1) { b += 1; ch = 1; } else return; }
    c.b = b; c.c = ch;
    dockAudio.src = c.audioBase + '/' + c.books[b].slug + '/' + ch + '.mp3';
    dockAudio.play().catch(() => {});
    this.sync();
  }
  onEnded() {
    /* auto-advance only when the reader is gone (it advances when present) AND
       continuous play is on; otherwise just settle the controls. */
    if (!this.claimed && this.ctx && this.ctx.books && continuousOn()) this.step(1);
    else this.sync();
  }
  render() {
    if (!this.shown) return html``;
    return html`<div class="mc-dock">
      <button type="button" class="mc-dock-btn" @click=${() => this.step(-1)} ?disabled=${!this.canStep}
        title="Previous chapter" aria-label="Previous chapter">⏮</button>
      <button type="button" class="mc-dock-btn" @click=${() => this.skip(-10)}
        title="Back 10 seconds" aria-label="Back 10 seconds">«10</button>
      <button type="button" class="mc-dock-play" @click=${() => this.toggle()}
        title="Play / pause" aria-label="Play / pause">${this.playing ? '❙❙' : '▶'}</button>
      <button type="button" class="mc-dock-btn" @click=${() => this.skip(10)}
        title="Forward 10 seconds" aria-label="Forward 10 seconds">10»</button>
      <button type="button" class="mc-dock-btn" @click=${() => this.step(1)} ?disabled=${!this.canStep}
        title="Next chapter" aria-label="Next chapter">⏭</button>
      <button type="button" class=${'mc-dock-btn mc-dock-cont' + (this.cont ? ' on' : '')} @click=${() => this.toggleCont()}
        title=${this.cont ? 'Continuous play is on — keep reading into the next chapter' : 'Continuous play is off — stop at the end of this chapter'}
        aria-label="Continuous play" aria-pressed=${this.cont ? 'true' : 'false'}>🔁</button>
      <a class="mc-dock-label" href=${this.href || '#'} title="Open this chapter in the reader">${this.label}</a>
      <button type="button" class="mc-dock-x" @click=${() => this.dismiss()}
        title="Stop listening" aria-label="Stop listening">×</button>
    </div>`;
  }
}
customElements.define('mc-audio-dock', McAudioDock);

(function () {
  'use strict';
  if (window.__mcShell) return;   // one shell per page lifetime
  window.__mcShell = true;
  /* The ?app=0 latch now means "no soft navigation, no dock, no SW" — the
     MODULES (store, richtext, views) always stand, so there is exactly one
     living render path either way. */
  var latchOff = false;
  try { latchOff = localStorage.getItem('mc-app') === '0'; } catch (e) { latchOff = false; }

  var SIZE_CAP = 2000000;         // volumes past ~2 MB take the ordinary road
  var cache = new Map();          // pathname -> html text
  /* 12, not 8: the six tab destinations plus a handful of content pages — a
     round-robin power user must never evict their own loop mid-lap. */
  var CACHE_MAX = 12;

  var style = document.createElement('style');
  style.id = 'mc-app-css';
  style.textContent =
    '.mc-progress-bar{position:fixed;top:env(safe-area-inset-top,0px);left:0;height:2px;width:0;' +
    'background:var(--maroon,#8b1a1a);z-index:9999;opacity:0;' +
    'transition:width .3s ease,opacity .3s ease}' +
    '.mc-progress-bar.on{opacity:1;width:70%;transition:width 8s cubic-bezier(.1,.7,.1,1),opacity .2s ease}' +
    /* The visible "we're on it" pill: a slow navigation must never look like a
       dead page. Shown ~300ms into a fetch (fast hops never see it), cleared on
       swap or fallback. Safe-area aware so iOS standalone doesn't hide it. */
    '.mc-navload{position:fixed;left:50%;top:calc(env(safe-area-inset-top,0px) + 64px);' +
    'transform:translateX(-50%);z-index:9999;display:flex;align-items:center;gap:.5rem;' +
    'background:var(--surface,#fffdf7);border:1px solid var(--rule,#d9cfb8);border-radius:999px;' +
    'padding:.4rem .9rem;box-shadow:0 2px 12px rgba(0,0,0,.18);font-size:.85rem;' +
    'color:var(--maroon,#8b1a1a);opacity:0;pointer-events:none;transition:opacity .15s ease}' +
    '.mc-navload.on{opacity:1}' +
    '.mc-navload-spin{width:14px;height:14px;border:2px solid var(--rule,#d9cfb8);' +
    'border-top-color:var(--maroon,#8b1a1a);border-radius:50%;flex:none;' +
    'animation:mc-navspin .7s linear infinite}' +
    '@keyframes mc-navspin{to{transform:rotate(360deg)}}' +
    '.mc-dock{position:fixed;right:12px;bottom:12px;z-index:9998;display:flex;align-items:center;gap:.3rem;' +
    'background:var(--surface,#fffdf7);border:1px solid var(--rule,#d9cfb8);border-radius:8px;' +
    'padding:.4rem .5rem;box-shadow:0 2px 10px rgba(0,0,0,.15);max-width:min(94vw,34rem);' +
    'cursor:grab;touch-action:none;user-select:none}' +
    '.mc-dock:active{cursor:grabbing}' +
    '.mc-dock-btn{font:inherit;cursor:pointer;border:1px solid var(--rule,#d9cfb8);background:none;' +
    'color:var(--maroon,#8b1a1a);border-radius:6px;padding:.2rem .3rem;line-height:1;white-space:nowrap;font-size:.8rem}' +
    '.mc-dock-btn[disabled]{opacity:.4;cursor:default}' +
    '.mc-dock-play{font:inherit;cursor:pointer;border:1px solid var(--rule,#d9cfb8);background:none;' +
    'color:var(--maroon,#8b1a1a);border-radius:50%;width:2rem;height:2rem;line-height:1;flex:none}' +
    '.mc-dock-label{font-size:.85rem;color:var(--maroon,#8b1a1a);text-decoration:none;white-space:nowrap;' +
    'overflow:hidden;text-overflow:ellipsis;max-width:11rem}' +
    '.mc-dock-label:hover{text-decoration:underline}' +
    '.mc-dock-cont{font-size:.9rem}' +
    '.mc-dock-cont.on{background:var(--maroon,#8b1a1a);color:#fff;border-color:var(--maroon,#8b1a1a)}' +
    '.mc-dock-x{font:inherit;cursor:pointer;border:0;background:none;color:var(--faint,#8a7f6a);font-size:1.1rem;flex:none}';
  document.head.appendChild(style);

  if (latchOff) {
    window.__mcShellReady = true;
    document.dispatchEvent(new CustomEvent('mc-shell-ready'));
    return;
  }
  var progress = document.createElement('mc-progress') as McProgress;
  progress.setAttribute('data-mc-app', '');
  document.body.appendChild(progress);

  /* The loading pill: visible feedback for any navigation that takes real time.
     Armed on every soft-nav, it appears only after a 300ms grace (instant hops
     never flash it) and stands until the swap lands or the fallback takes over. */
  var navload = document.createElement('div');
  navload.className = 'mc-navload';
  navload.setAttribute('data-mc-app', '');
  navload.setAttribute('role', 'status');
  navload.setAttribute('aria-live', 'polite');
  var navloadSpin = document.createElement('span');
  navloadSpin.className = 'mc-navload-spin';
  navload.appendChild(navloadSpin);
  navload.appendChild(document.createTextNode('Loading…'));
  document.body.appendChild(navload);
  var navloadTimer = 0;
  function armNavload() {
    if (navloadTimer) clearTimeout(navloadTimer);
    navloadTimer = window.setTimeout(function () { navload.classList.add('on'); }, 300);
  }
  function disarmNavload() {
    if (navloadTimer) { clearTimeout(navloadTimer); navloadTimer = 0; }
    navload.classList.remove('on');
  }

  var dock = document.createElement('mc-audio-dock') as McAudioDock;
  dock.setAttribute('data-mc-app', '');
  document.body.appendChild(dock);
  window.mcAudioDock = {
    audio: dockAudio,
    /* ctx = { books:[{slug,name,chapters}], audioBase, page, reader, b, c } —
       enough for the dock to step chapters and link back on its own. */
    claim: function (ctx: any) { dock.claim(ctx); },
    release: function () { dock.release(); },
  };

  /* Live updates: the shell-owned WebSocket to the board hub (window.mcLive).
     Forum views subscribe on mount; idle tabs close it and reopen on return. */
  installLive();

  /* The mobile app chrome: the persistent bottom tab bar, top app bar, sheet,
     and Home launcher. Phones only (CSS-gated); desktop renders none of it.
     chrome.sync() re-syncs the active tab, badges, and Home mount in boots(). */
  var chrome = installChrome();

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

  /* Capture the browser's install prompt so the settings gear can offer an
     "Install app" row only when it is actually available (and hide it once
     installed). No effect where the browser doesn't fire the event. */
  window.mcInstall = window.mcInstall || {
    evt: null,
    available: function () { return !!(window.mcInstall && window.mcInstall.evt); },
    prompt: function () {
      var e = window.mcInstall!.evt;
      if (!e) return;
      window.mcInstall!.evt = null;
      try { e.prompt(); } catch (err) { /* dismissed */ }
    },
  };
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    window.mcInstall!.evt = e;
    document.dispatchEvent(new CustomEvent('mc-install-available'));
  });
  window.addEventListener('appinstalled', function () {
    window.mcInstall!.evt = null;
    document.dispatchEvent(new CustomEvent('mc-install-available'));
  });

  /* ---- the per-page boot registry ---- */
  var REG: Record<string, { boot: string; down?: string }> = {
    'comments.js': { boot: 'mcCommentsBoot', down: 'mcCommentsTeardown' },
    'bible-reader.js': { boot: 'mcBibleBoot', down: 'mcBibleTeardown' },
    'contact.js': { boot: 'mcContactBoot' },
    'index.js': { boot: 'mcIndexBoot' },
    'flash.js': { boot: 'mcFlashBoot' },
  };
  function baseName(src: string | null): string {
    return (src || '').split('?')[0].split('/').pop()!;
  }
  var loadedScripts: Record<string, boolean> = {};
  Array.prototype.forEach.call(document.querySelectorAll('script[src]'), function (s) {
    loadedScripts[baseName(s.getAttribute('src'))] = true;
  });

  function teardownPage() {
    Object.keys(REG).forEach(function (name) {
      var down = REG[name].down;
      if (down && loadedScripts[name] && typeof (window as any)[down] === 'function') {
        try { (window as any)[down](); } catch (e) { /* half-torn is torn */ }
      }
    });
  }
  function pageScripts(doc: Document) {
    var out: Array<{ name: string; src: string }> = [];
    Array.prototype.forEach.call(doc.querySelectorAll('body script[src]'), function (s) {
      var name = baseName(s.getAttribute('src'));
      if (name === 'nav.js' || name === 'app.js') return;
      out.push({ name: name, src: s.getAttribute('src') });
    });
    return out;
  }
  function loadScript(src: string) {
    return new Promise(function (resolve) {
      var s = document.createElement('script');
      s.src = src;
      s.defer = true;
      s.onload = function () { resolve(true); };
      s.onerror = function () { resolve(false); };
      document.head.appendChild(s);
    });
  }
  function bootPage(doc: Document) {
    var jobs = pageScripts(doc).map(function (want) {
      if (!loadedScripts[want.name]) {
        loadedScripts[want.name] = true;
        /* A fresh script self-boots on load. A failed load must NOT be
           remembered as loaded — that once left every later visit to the page
           with a silent, empty section until a hard refresh. Retry once after a
           breath; still failing, clear the flag so the next navigation tries
           again from scratch. */
        return loadScript(want.src).then(function (ok) {
          if (ok) return true;
          return new Promise(function (r) { setTimeout(r, 500); }).then(function () {
            return loadScript(want.src);
          }).then(function (ok2) {
            if (!ok2) delete loadedScripts[want.name];
            return ok2;
          });
        });
      }
      var reg = REG[want.name];
      if (reg && typeof (window as any)[reg.boot] === 'function') {
        try { (window as any)[reg.boot](); } catch (e) { /* boot failed; page still readable */ }
      }
      return Promise.resolve(true);
    });
    return Promise.all(jobs);
  }

  function navScript(doc: Document) {
    return doc.querySelector('body script[src*="nav.js"]');
  }
  function contentNodes(doc: Document) {
    var anchor = navScript(doc);
    if (!anchor) return null;
    var out = [];
    var n = anchor.nextSibling;
    while (n) {
      if (!(n.nodeType === 1 && ((n as Element).hasAttribute('data-mc-app') ||
            (n as Element).tagName === 'MC-PROGRESS' || (n as Element).tagName === 'MC-AUDIO-DOCK'))) out.push(n);
      n = n.nextSibling;
    }
    return out;
  }
  function swapContent(doc: Document) {
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
  function noShell(doc: Document) {
    return !!doc.querySelector('.away, [data-noshell]');
  }
  function sameOrigin(url: URL) { return url.origin === location.origin; }
  function pageish(url: URL) {
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
        if (sub) sub.parentElement!.querySelector('.sub-toggle')!.classList.add('here');
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
    chrome.sync();
    /* A gentle fade-in of freshly-swapped content (phones only; CSS-gated). The
       <main> is a new node each swap, so the class triggers the animation once. */
    var swapped = document.querySelector('main');
    if (swapped) swapped.classList.add('mc-swapin');
  }

  /* ---- robust document fetch: per-attempt timeout + retries ----
     A phone's network hangs and drops; a navigation must survive both. Each
     attempt is aborted after TIMEOUT ms (a stalled fetch once froze the whole
     shell forever — every later tap silently dropped); a network failure, a
     timeout, or a 429/5xx retries after a short breath. `outer` is the
     navigation's own abort (a newer click supersedes this one): it cancels the
     in-flight attempt and stops the retry ladder cold. */
  var NAV_WAITS = [400, 1200];
  var NAV_TIMEOUT = 9000;
  function navSleep(ms: number) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function fetchDoc(path: string, outer: AbortSignal | null): Promise<string> {
    function attempt(i: number): Promise<string> {
      if (outer && outer.aborted) return Promise.reject(new Error('superseded'));
      var ctrl: AbortController | null = null;
      var timer = 0;
      var onOuter: (() => void) | null = null;
      var init: RequestInit = {};
      if (typeof AbortController === 'function') {
        ctrl = new AbortController();
        init.signal = ctrl.signal;
        timer = window.setTimeout(function () { if (ctrl) ctrl.abort(); }, NAV_TIMEOUT);
        if (outer) {
          onOuter = function () { if (ctrl) ctrl.abort(); };
          outer.addEventListener('abort', onOuter);
        }
      }
      var cleanup = function () {
        if (timer) { clearTimeout(timer); timer = 0; }
        if (outer && onOuter) { outer.removeEventListener('abort', onOuter); onOuter = null; }
      };
      return fetch(path, init).then(function (res) {
        if (!res.ok) {
          var httpErr = new Error('status ' + res.status) as Error & { retryable?: boolean };
          httpErr.retryable = res.status === 429 || res.status >= 500;
          throw httpErr;
        }
        var len = Number(res.headers.get('Content-Length') || 0);
        if (len > SIZE_CAP) {
          var big = new Error('oversize') as Error & { terminal?: boolean };
          big.terminal = true;
          throw big;
        }
        /* the timer stays armed through the body read so a stalled body is a
           timeout too, not a forever-hang */
        return res.text().then(function (t) { cleanup(); return t; });
      }).catch(function (err: Error & { retryable?: boolean; terminal?: boolean }) {
        cleanup();
        if (err && err.terminal) throw err;                    // oversize: ordinary road now
        if (outer && outer.aborted) throw err;                 // superseded: stop cold
        var httpish = err && /^status /.test(err.message || '');
        var retryable = httpish ? !!err.retryable : true;      // network/timeout always retries
        if (retryable && i < NAV_WAITS.length) {
          return navSleep(NAV_WAITS[i]).then(function () { return attempt(i + 1); });
        }
        throw err;
      });
    }
    return attempt(0);
  }

  /* ---- latest-wins navigation ----
     Every click starts a navigation; a newer click supersedes an older one
     (aborting its fetch) instead of being dropped. The old model swallowed any
     tap made while a navigation was in flight — preventDefault had already
     fired, so fast tapping "did nothing" — and a hung fetch wedged the flag
     forever. seq guards every mutation: a superseded navigation never touches
     the DOM, history, or the spinner. On any terminal failure the ordinary
     road (a full page load) takes over — the shell never strands an empty or
     stale page. */
  var navSeq = 0;
  var navCtrl: AbortController | null = null;
  var lastPath = location.pathname;
  var lastSearch = location.search;
  function softNav(url: URL, push: boolean) {
    var seq = ++navSeq;
    if (navCtrl) { try { navCtrl.abort(); } catch (e) { /* already done */ } }
    navCtrl = typeof AbortController === 'function' ? new AbortController() : null;
    var signal = navCtrl ? navCtrl.signal : null;
    /* Any navigation closes the app menus/sheets so a chosen link never loads
       behind an open one (the mobile Settings sheet + the desktop account
       dropdown, which its own outside-click can't catch for an in-menu link). */
    try { if (window.mcSheet) window.mcSheet.close(); } catch (e) { /* ignore */ }
    try { document.dispatchEvent(new Event('mc-navigate')); } catch (e) { /* ignore */ }
    progress.active = true;
    armNavload();
    var key = url.pathname;
    var cached = cache.get(key);
    (cached
      ? Promise.resolve(cached)
      : fetchDoc(url.pathname, signal)
    ).then(function (text) {
      if (seq !== navSeq) return;               // a newer navigation owns the page
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
        if (seq !== navSeq) return;             // superseded mid-boot: the newer nav repaints
        boots();
        progress.active = false;
        disarmNavload();
      });
    }).catch(function () {
      if (seq !== navSeq) return;               // superseded: the newer nav owns the UI
      progress.active = false;
      disarmNavload();
      /* any doubt at all: the ordinary road */
      location.href = url.href;
    });
  }

  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = (e.target && (e.target as Element).closest && (e.target as Element).closest('a[href]')) as HTMLAnchorElement | null;
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

  /* Tell the page clients the shell (and its registered views) stand — the
     deferred comments.js waits for this before booting, so the Lit views
     win the load-order race deterministically instead of by luck. */
  window.__mcShellReady = true;
  document.dispatchEvent(new CustomEvent('mc-shell-ready'));
})();
