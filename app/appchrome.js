/* Mobile app chrome (appification, Phase 1): a persistent bottom tab bar, a slim
   top app bar, a reusable slide-up sheet, and the Home launcher. Shell-owned and
   light-DOM (like the audio dock), mounted once beside it with data-mc-app so
   they survive soft-navigation. EVERYTHING here is CSS-gated to phones
   (styles/13-app-mobile.css, @media max-width:600px) — desktop renders none of
   it and is byte-unchanged. installChrome() is called by app/shell.js after the
   ?app=0 latch; its returned sync() runs in boots() after every swap, and the
   click delegate in shell.js soft-navigates the tabs' <a href>s for free. */

import { LitElement, html } from '../vendor/lit-all.min.js';

/* Crisp stroke icons (Feather-ish, 24×24, currentColor) so the chrome reads as an
   app, not a website. Static SVG templates — no unsafe injection. The Merecat
   hero keeps the 🐈 mascot on purpose (it IS the brand). */
const ICON = {
  home: html`<svg viewBox="0 0 24 24" class="mc-ico" aria-hidden="true"><path d="M3 10.8 12 3.5l9 7.3"/><path d="M5.5 9.6V20h13V9.6"/></svg>`,
  community: html`<svg viewBox="0 0 24 24" class="mc-ico" aria-hidden="true"><path d="M20 14a2 2 0 0 1-2 2H8.5L4.5 20V6a2 2 0 0 1 2-2H18a2 2 0 0 1 2 2z"/></svg>`,
  inbox: html`<svg viewBox="0 0 24 24" class="mc-ico" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m3.5 7.5 8.5 6 8.5-6"/></svg>`,
  profile: html`<svg viewBox="0 0 24 24" class="mc-ico" aria-hidden="true"><circle cx="12" cy="8" r="3.6"/><path d="M5 20c.4-3.6 3.4-5.6 7-5.6s6.6 2 7 5.6"/></svg>`,
  search: html`<svg viewBox="0 0 24 24" class="mc-ico" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20.5 20.5-4-4"/></svg>`,
  bell: html`<svg viewBox="0 0 24 24" class="mc-ico" aria-hidden="true"><path d="M18 8a6 6 0 1 0-12 0c0 6-2.5 7-2.5 7h17S18 14 18 8"/><path d="M10.2 19a1.9 1.9 0 0 0 3.6 0"/></svg>`,
  gear: html`<svg viewBox="0 0 24 24" class="mc-ico" aria-hidden="true"><circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M4.6 4.6l2.1 2.1M17.3 17.3l2.1 2.1M2.5 12h3M18.5 12h3M4.6 19.4l2.1-2.1M17.3 6.7l2.1-2.1"/></svg>`,
  cross: html`<svg viewBox="0 0 24 24" class="mc-ico" aria-hidden="true"><path d="M12 3.5v17M7.5 8.5h9"/></svg>`,
  back: html`<svg viewBox="0 0 24 24" class="mc-ico" aria-hidden="true"><path d="m14.5 6-6 6 6 6"/></svg>`,
};

/* The five primary destinations. Merecat is the raised center hero (the standout
   AI). hrefs are ordinary same-origin links the shell intercepts + soft-navs. */
const TABS = [
  { key: 'home', label: 'Home', svg: 'home', href: 'index.html' },
  { key: 'merecat', label: 'Merecat', icon: '🐈', href: 'community.html?merecat=1' },
  { key: 'community', label: 'Community', svg: 'community', href: 'community.html', hero: true },
  { key: 'messages', label: 'Inbox', svg: 'inbox', href: 'community.html?inbox=1', badge: 'dm' },
  { key: 'profile', label: 'Profile', svg: 'profile', href: 'community.html?me=1' },
];

/* The Home launcher: standout features first, then the reading shelf (mirrors
   scripts/nav.yml). Static links only — the shell adds no API traffic here. */
const HOME_FEATURES = [
  { icon: '💬', title: 'Community', sub: 'The Catholicity Board — join the conversation', href: 'community.html' },
  { icon: '🐈', title: 'Ask Merecat', sub: 'Put a question to the librarian AI', href: 'community.html?merecat=1' },
];
const HOME_SHELF = [
  { title: 'Credo', sub: 'What we believe', href: 'credo.html' },
  { title: 'Lex orandi, lex credendi', sub: 'The rule of prayer', href: 'lex-orandi.html' },
  { title: 'Mere Catholicity — the book', sub: 'Read online', href: 'book.html' },
  { title: 'Charting: the historic communions', sub: 'Companion chart', href: 'charting-communions.html' },
  { title: 'Charting: the free churches', sub: 'Companion chart', href: 'free-churches.html' },
  { title: 'Charting: fifty objections', sub: 'Answered by grade', href: 'objections.html' },
  { title: 'The bishop and the presbyter', sub: 'Companion paper', href: 'bishop-presbyter.html' },
  { title: 'Library', sub: 'The whole hosted corpus', href: 'library.html' },
  { title: 'About', sub: 'The project', href: 'about.html' },
];

/* Which tab the current URL belongs to (the forum's views live in the query
   string). '' = a content page (a paper, the library, about…): no tab is
   active and the app bar shows a back arrow. */
function activeTab() {
  const path = location.pathname.split('/').pop() || 'index.html';
  const qs = location.search;
  if (path === 'index.html' || path === '') return 'home';
  if (path === 'community.html') {
    if (/[?&]merecat=1\b/.test(qs)) return 'merecat';
    if (/[?&]inbox=1\b/.test(qs) || /[?&]dm=/.test(qs)) return 'messages';
    if (/[?&]me=1\b/.test(qs) || /[?&]profile=/.test(qs)) return 'profile';
    return 'community';
  }
  return '';
}

/* Unread counts, read from the caches the comments client keeps current (live
   layer + 90s poll). No fetch — the chrome only reflects what is already known. */
function badgeCount(which) {
  try {
    const raw = localStorage.getItem(which === 'dm' ? 'mc-dm-unread' : 'mc-notif-unread');
    const o = raw ? JSON.parse(raw) : null;
    return o && o.n > 0 ? o.n : 0;
  } catch (e) { return 0; }
}
function badgeText(n) { return n > 99 ? '99+' : String(n); }

function readKey() {
  try { return localStorage.getItem('mc-comment-key') || ''; } catch (e) { return ''; }
}

/* ---- the bottom tab bar ---- */
class McTabbar extends LitElement {
  static properties = { active: { attribute: false }, dm: { attribute: false } };
  constructor() { super(); this.active = 'home'; this.dm = 0; }
  createRenderRoot() { return this; }
  sync() { this.active = activeTab(); this.dm = badgeCount('dm'); }
  render() {
    return html`<nav class="mc-tabbar" aria-label="Primary">
      ${TABS.map((t) => html`
        <a class=${'mc-tab' + (t.hero ? ' mc-tab-hero' : '') + (this.active === t.key ? ' mc-tab-on' : '')}
           href=${t.href} aria-label=${t.label} aria-current=${this.active === t.key ? 'page' : 'false'}>
          <span class="mc-tab-ico">${t.icon ? t.icon : ICON[t.svg]}${t.badge === 'dm' && this.dm
            ? html`<span class="mc-tab-badge">${badgeText(this.dm)}</span>` : ''}</span>
          <span class="mc-tab-lbl">${t.label}</span>
        </a>`)}
    </nav>`;
  }
}
customElements.define('mc-tabbar', McTabbar);

/* ---- the top app bar ---- */
class McAppbar extends LitElement {
  static properties = { heading: { attribute: false }, back: { attribute: false }, notif: { attribute: false } };
  constructor() { super(); this.heading = ''; this.back = false; this.notif = 0; }
  createRenderRoot() { return this; }
  sync() {
    this.back = activeTab() === '';
    this.notif = badgeCount('notif');
    const t = (document.title || '').split('|')[0].split('·')[0].trim();
    this.heading = t || 'Mere Catholicity';
  }
  goBack(e) { e.preventDefault(); if (history.length > 1) history.back(); else { location.href = 'index.html'; } }
  settings(e) { e.preventDefault(); if (window.mcSheet) window.mcSheet.settings(); }
  render() {
    return html`<header class="mc-appbar">
      <div class="mc-appbar-side mc-appbar-l">${this.back
        ? html`<button class="mc-ab-btn" @click=${(e) => this.goBack(e)} aria-label="Back">${ICON.back}</button>`
        : html`<a class="mc-ab-brand" href="index.html" aria-label="Home">${ICON.cross}</a>`}</div>
      <div class="mc-appbar-title">${this.heading}</div>
      <div class="mc-appbar-side mc-appbar-r">
        <a class="mc-ab-btn" href="community.html?q=" aria-label="Search">${ICON.search}</a>
        <a class="mc-ab-btn mc-ab-bell" href="community.html?notifications=1" aria-label="Notifications">${ICON.bell}${this.notif
          ? html`<span class="mc-tab-badge">${badgeText(this.notif)}</span>` : ''}</a>
        <button class="mc-ab-btn" @click=${(e) => this.settings(e)} aria-label="Settings">${ICON.gear}</button>
      </div>
    </header>`;
  }
}
customElements.define('mc-appbar', McAppbar);

/* ---- the reusable slide-up sheet (the app-dialog primitive) ---- */
class McSheet extends LitElement {
  static properties = { open: { attribute: false }, heading: { attribute: false } };
  constructor() { super(); this.open = false; this.heading = ''; this._node = null; this._onClose = null; }
  createRenderRoot() { return this; }
  show(heading, node, onClose) { this.heading = heading || ''; this._node = node || null; this._onClose = onClose || null; this.open = true; }
  close() {
    if (!this.open) return;
    this.open = false;
    const cb = this._onClose; this._onClose = null;
    if (cb) { try { cb(); } catch (e) { /* caller's problem */ } }
  }
  updated() {
    /* The body host is a static template node, so Lit keeps whatever we append
       into it across re-renders (the McInbox dm-search idiom). Swap on new node. */
    const body = this.querySelector('.mc-sheet-body');
    if (body && this._node && body.firstChild !== this._node) { body.textContent = ''; body.appendChild(this._node); }
  }
  render() {
    return html`
      <div class=${'mc-sheet-scrim' + (this.open ? ' on' : '')} @click=${() => this.close()}></div>
      <section class=${'mc-sheet' + (this.open ? ' on' : '')} role="dialog" aria-modal="true" aria-label=${this.heading || 'Sheet'}>
        <button class="mc-sheet-grip" @click=${() => this.close()} aria-label="Close"></button>
        ${this.heading ? html`<h2 class="mc-sheet-head">${this.heading}</h2>` : ''}
        <div class="mc-sheet-body"></div>
      </section>`;
  }
}
customElements.define('mc-sheet', McSheet);

/* ---- the settings sheet content (relocated identity/account line) ---- */
class McSettings extends LitElement {
  static properties = { keyShown: { attribute: false }, theme: { attribute: false }, copied: { attribute: false } };
  constructor() { super(); this.keyShown = false; this.theme = this._theme(); this.copied = false; }
  createRenderRoot() { return this; }
  _theme() { return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'; }
  toggleTheme() {
    const n = this.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', n);
    try { document.cookie = 'mc-theme=' + n + ';path=/;max-age=31536000;samesite=lax'; } catch (e) { /* blocked */ }
    this.theme = n;
  }
  copyKey() {
    const k = readKey();
    if (!k) return;
    try {
      if (navigator.clipboard) { navigator.clipboard.writeText(k); this.copied = true; setTimeout(() => { this.copied = false; }, 1500); }
    } catch (e) { /* no clipboard */ }
  }
  logout() {
    mcConfirm('Log out of this identity? Keep your key saved so you can log back in.',
      { okLabel: 'Log out', danger: true }).then(function (ok) {
      if (!ok) return;
      try {
        localStorage.removeItem('mc-comment-key');
        localStorage.removeItem('mc-dm-unread');
        localStorage.removeItem('mc-notif-unread');
      } catch (e) { /* blocked */ }
      location.href = 'index.html';
    });
  }
  render() {
    const k = readKey();
    const link = (href, label, note) => html`<a class="mc-set-row" href=${href}>
      <span>${label}${note ? html`<small>${note}</small>` : ''}</span><span class="mc-set-go">›</span></a>`;
    return html`<div class="mc-settings">
      <h3 class="mc-set-sec">Account</h3>
      ${k ? html`
        ${link('community.html?me=1', 'My profile', 'Edit your name, faith, avatar')}
        <button class="mc-set-row mc-set-btn" @click=${() => { this.keyShown = !this.keyShown; }}>
          <span>Show my key<small>Your one login secret — save it somewhere safe</small></span><span class="mc-set-go">${this.keyShown ? '▾' : '›'}</span></button>
        ${this.keyShown ? html`<div class="mc-set-key">
          <input class="mc-set-keyin" readonly .value=${k} @focus=${(e) => e.target.select()}>
          <button class="btn btn-send mc-set-copy" @click=${() => this.copyKey()}>${this.copied ? 'Copied' : 'Copy'}</button>
        </div>` : ''}
        <button class="mc-set-row mc-set-btn mc-set-danger" @click=${() => this.logout()}>
          <span>Log out</span><span class="mc-set-go">›</span></button>
      ` : html`
        ${link('community.html?me=1', 'Create an identity', 'One click, no signup')}
      `}

      <h3 class="mc-set-sec">Appearance</h3>
      <button class="mc-set-row mc-set-btn" @click=${() => this.toggleTheme()}>
        <span>Theme<small>${this.theme === 'dark' ? 'Dark' : 'Light'}</small></span>
        <span class=${'mc-set-switch' + (this.theme === 'dark' ? ' on' : '')}><span class="mc-set-knob"></span></span>
      </button>

      <h3 class="mc-set-sec">Community</h3>
      ${link('community.html?users=1', 'Members', 'Everyone on the board')}
      ${link('community.html?q=', 'Search', 'Search the forum')}

      <h3 class="mc-set-sec">Read &amp; help</h3>
      ${link('library.html', 'Library')}
      ${link('about.html', 'About')}
      ${link('contact.html', 'Contact')}
      ${link('terms.html', 'Terms &amp; conditions')}
    </div>`;
  }
}
customElements.define('mc-settings', McSettings);

/* ---- the Home launcher (replaces the marketing homepage on phones) ---- */
class McHome extends LitElement {
  createRenderRoot() { return this; }
  render() {
    return html`<div class="mc-home">
      <div class="mc-home-hero"><span class="mc-home-cross">✝</span>
        <h1>Mere Catholicity</h1>
        <p>One, holy, catholic, and apostolic.</p></div>
      <div class="mc-home-feats">${HOME_FEATURES.map((f) => html`
        <a class="mc-home-feat" href=${f.href}>
          <span class="mc-home-feat-ico">${f.icon}</span>
          <span class="mc-home-feat-txt"><strong>${f.title}</strong><small>${f.sub}</small></span>
          <span class="mc-home-go">›</span></a>`)}</div>
      <h2 class="mc-home-sec">Read</h2>
      <div class="mc-home-shelf">${HOME_SHELF.map((s) => html`
        <a class="mc-home-row" href=${s.href}>
          <span class="mc-home-row-txt"><strong>${s.title}</strong>${s.sub ? html`<small>${s.sub}</small>` : ''}</span>
          <span class="mc-home-go">›</span></a>`)}</div>
      <button class="mc-home-settings" @click=${() => window.mcSheet && window.mcSheet.settings()}>⚙ Settings</button>
    </div>`;
  }
}
customElements.define('mc-home', McHome);

/* Phones get the app controls; desktop keeps its native ones (the decoupling
   line, matching the CSS breakpoint). */
function isMobile() { try { return matchMedia('(max-width: 600px)').matches; } catch (e) { return false; } }

/* An app-style confirm: a sheet with the message and two fat buttons on phones,
   the native confirm on desktop (which the owner keeps as-is). Returns a Promise
   that resolves true/false; dismissing the sheet (scrim/grip) is a cancel. */
function mcConfirm(message, opts) {
  opts = opts || {};
  if (!isMobile() || !window.mcSheet) return Promise.resolve(window.confirm(message));
  return new Promise(function (resolve) {
    let done = false;
    const finish = function (v) { if (done) return; done = true; window.mcSheet.close(); resolve(v); };
    const wrap = document.createElement('div');
    wrap.className = 'mc-confirm';
    const msg = document.createElement('p'); msg.className = 'mc-confirm-msg'; msg.textContent = message;
    const row = document.createElement('div'); row.className = 'mc-confirm-row';
    const cancel = document.createElement('button'); cancel.type = 'button';
    cancel.className = 'mc-confirm-btn mc-confirm-cancel'; cancel.textContent = opts.cancelLabel || 'Cancel';
    const ok = document.createElement('button'); ok.type = 'button';
    ok.className = 'mc-confirm-btn mc-confirm-ok' + (opts.danger ? ' mc-confirm-danger' : '');
    ok.textContent = opts.okLabel || 'OK';
    cancel.addEventListener('click', function () { finish(false); });
    ok.addEventListener('click', function () { finish(true); });
    row.appendChild(cancel); row.appendChild(ok);
    wrap.appendChild(msg); wrap.appendChild(row);
    window.mcSheet.open(opts.title || 'Confirm', wrap, function () { finish(false); });
  });
}

/* A brief bottom toast (phones only; desktop keeps its inline status text). */
function mcToast(message) {
  if (!isMobile()) return;
  const t = document.createElement('div');
  t.className = 'mc-toast'; t.setAttribute('data-mc-app', ''); t.textContent = message;
  document.body.appendChild(t);
  requestAnimationFrame(function () { t.classList.add('on'); });
  setTimeout(function () {
    t.classList.remove('on');
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 300);
  }, 2400);
}

/* Give a native <select> an app bottom-sheet picker on phones: the select stays
   the source of truth and the change target, but is visually replaced by a
   tappable button that opens a sheet of big option rows. Desktop keeps the native
   select untouched. Idempotent. Returns { refresh } to re-sync the button label
   after options are repopulated (cascading pickers). */
function mcSelectSheet(sel) {
  if (!sel) return { refresh: function () {} };
  /* Re-entrant: if the button was reconciled away by a Lit re-render, rebuild it
     (call this from the view's updated()); otherwise reuse the existing one. */
  if (sel.__mcBtn && sel.__mcBtn.isConnected) return sel.__mcHandle;
  if (!sel.parentNode) return { refresh: function () {} };
  sel.classList.add('mc-hassheet');
  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'mc-selbtn';
  sel.parentNode.insertBefore(btn, sel.nextSibling);
  const refresh = function () {
    const o = sel.options[sel.selectedIndex];
    btn.textContent = (o ? o.textContent : '') || ' ';
    const caret = document.createElement('span'); caret.className = 'mc-selbtn-caret'; caret.textContent = '▾';
    btn.appendChild(caret);
  };
  btn.addEventListener('click', function () {
    if (!isMobile() || !window.mcSheet) { try { sel.focus(); } catch (e) { /* gone */ } return; }
    const list = document.createElement('div'); list.className = 'mc-optlist';
    Array.prototype.forEach.call(sel.options, function (o, i) {
      if (o.disabled) return;
      const r = document.createElement('button');
      r.type = 'button'; r.className = 'mc-optrow' + (i === sel.selectedIndex ? ' on' : '');
      r.textContent = o.textContent;
      r.addEventListener('click', function () {
        sel.selectedIndex = i;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        refresh();
        window.mcSheet.close();
      });
      list.appendChild(r);
    });
    window.mcSheet.open(sel.getAttribute('aria-label') || sel.getAttribute('title') || 'Choose', list);
  });
  refresh();
  sel.__mcBtn = btn;
  sel.__mcHandle = { refresh: refresh };
  return sel.__mcHandle;
}

/* Mount the persistent chrome (called by the shell after the ?app=0 latch) and
   return { sync } for boots() to call after every swap. The elements carry
   data-mc-app so swapContent skips them; CSS keeps them off desktop. */
export function installChrome() {
  const appbar = document.createElement('mc-appbar');
  appbar.setAttribute('data-mc-app', '');
  document.body.appendChild(appbar);

  const tabbar = document.createElement('mc-tabbar');
  tabbar.setAttribute('data-mc-app', '');
  document.body.appendChild(tabbar);

  const sheet = document.createElement('mc-sheet');
  sheet.setAttribute('data-mc-app', '');
  document.body.appendChild(sheet);

  window.mcSheet = {
    open: function (heading, node, onClose) { sheet.show(heading, node, onClose); },
    settings: function () { sheet.show('Settings', document.createElement('mc-settings')); },
    close: function () { sheet.close(); },
  };
  /* App controls for the whole client to reach (phones only; desktop no-ops to
     the native control). Phase 2 of the appification. */
  window.mcConfirm = mcConfirm;
  window.mcToast = mcToast;
  window.mcSelectSheet = mcSelectSheet;

  /* The comments client fires mc-badge whenever an unread count changes, so the
     tab bar and bell update the instant a DM or notification lands. */
  document.addEventListener('mc-badge', function () { tabbar.sync(); appbar.sync(); });

  /* Keyboard-aware composer. A position:fixed composer anchored to the layout
     viewport bottom (the sticky merecat ask box) hides BEHIND the soft keyboard
     on phones — the classic iOS quirk. Track the visual viewport, publish the
     bottom overlap as --mc-kb, and flag <body> so the mobile CSS lifts the
     composer to sit right above the keyboard and slides the tab bar out of the
     way. Desktop never raises a soft keyboard, so kb stays ~0 and this no-ops. */
  var vv = window.visualViewport;
  if (vv) {
    var applyKb = function () {
      var kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
      /* A real keyboard is tall; a browser toolbar reveal is not. The threshold
         keeps chrome bars from being mistaken for a keyboard. */
      var open = kb > 120;
      document.documentElement.style.setProperty('--mc-kb', kb + 'px');
      document.body.classList.toggle('mc-kb-open', open);
    };
    vv.addEventListener('resize', applyKb);
    vv.addEventListener('scroll', applyKb);
  }

  /* On the Home route, drop the launcher into <main> and mark it so the mobile
     CSS hides the marketing siblings (phones only; desktop keeps the homepage). */
  function mountHome() {
    const main = document.querySelector('main');
    if (!main || activeTab() !== 'home') return;
    if (!main.querySelector('mc-home')) {
      main.insertBefore(document.createElement('mc-home'), main.firstChild);
      main.classList.add('mc-app-home');
    }
  }

  function sync() { tabbar.sync(); appbar.sync(); mountHome(); }
  sync();
  return { sync: sync };
}
