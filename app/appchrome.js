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
  gear: html`<svg viewBox="0 0 24 24" class="mc-ico" aria-hidden="true"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>`,
  cross: html`<svg viewBox="0 0 24 24" class="mc-ico" aria-hidden="true"><path d="M12 3.5v17M7.5 8.5h9"/></svg>`,
  back: html`<svg viewBox="0 0 24 24" class="mc-ico" aria-hidden="true"><path d="m14.5 6-6 6 6 6"/></svg>`,
  forward: html`<svg viewBox="0 0 24 24" class="mc-ico" aria-hidden="true"><path d="m9.5 6 6 6-6 6"/></svg>`,
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

/* ---- the top app bar ----
   A browser-like nav frame: a persistent back < at the far left and forward > at
   the far right (just past the gear), so back/forward are always in the same place.
   The center title is intentionally empty (the tab bar + content title say where
   you are); the div stays as the flex:1 spacer that pins the two icon clusters to
   the edges. */
class McAppbar extends LitElement {
  static properties = { canBack: { attribute: false }, notif: { attribute: false } };
  constructor() { super(); this.canBack = false; this.notif = 0; }
  createRenderRoot() { return this; }
  sync() {
    this.canBack = history.length > 1;   // dim < at the very start of history
    this.notif = badgeCount('notif');
  }
  goBack(e) { e.preventDefault(); if (history.length > 1) history.back(); else { location.href = 'index.html'; } }
  goFwd(e) { e.preventDefault(); history.forward(); }
  settings(e) { e.preventDefault(); if (window.mcSheet) window.mcSheet.settings(); }
  render() {
    return html`<header class="mc-appbar">
      <div class="mc-appbar-side mc-appbar-l">
        <button class=${'mc-ab-btn' + (this.canBack ? '' : ' mc-ab-dim')} @click=${(e) => this.goBack(e)} aria-label="Back">${ICON.back}</button>
      </div>
      <div class="mc-appbar-title"></div>
      <div class="mc-appbar-side mc-appbar-r">
        <a class="mc-ab-btn" href="community.html?q=" aria-label="Search">${ICON.search}</a>
        <a class="mc-ab-btn mc-ab-bell" href="community.html?notifications=1" aria-label="Notifications">${ICON.bell}${this.notif
          ? html`<span class="mc-tab-badge">${badgeText(this.notif)}</span>` : ''}</a>
        <button class="mc-ab-btn" @click=${(e) => this.settings(e)} aria-label="Settings">${ICON.gear}</button>
        <button class="mc-ab-btn" @click=${(e) => this.goFwd(e)} aria-label="Forward">${ICON.forward}</button>
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
  static properties = { keyShown: { attribute: false }, theme: { attribute: false }, copied: { attribute: false }, dark: { attribute: false } };
  constructor() { super(); this.keyShown = false; this.theme = this._theme(); this.copied = false; this.dark = (window.mcGetDark && window.mcGetDark()) || 'charcoal'; }
  createRenderRoot() { return this; }
  _theme() { return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'; }
  toggleTheme() {
    const n = this.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', n);
    try { document.cookie = 'mc-theme=' + n + ';path=/;max-age=31536000;samesite=lax'; } catch (e) { /* blocked */ }
    /* keep the chosen dark palette applied when turning dark on, cleared for light */
    if (n === 'dark' && (this.dark === 'slate' || this.dark === 'ink')) document.documentElement.setAttribute('data-dark', this.dark);
    else document.documentElement.removeAttribute('data-dark');
    this.theme = n;
  }
  setDark(p) { if (window.mcSetDark) window.mcSetDark(p); this.dark = p; }
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
        <button class="mc-set-row mc-set-btn" @click=${() => window.mcOnboard && window.mcOnboard()}>
          <span>Create an identity<small>One tap, no signup</small></span><span class="mc-set-go">›</span></button>
      `}

      <h3 class="mc-set-sec">Appearance</h3>
      <button class="mc-set-row mc-set-btn" @click=${() => this.toggleTheme()}>
        <span>Theme<small>${this.theme === 'dark' ? 'Dark' : 'Light'}</small></span>
        <span class=${'mc-set-switch' + (this.theme === 'dark' ? ' on' : '')}><span class="mc-set-knob"></span></span>
      </button>
      ${this.theme === 'dark' ? html`<div class="mc-set-palette">
        ${[['charcoal', 'Charcoal'], ['slate', 'Slate'], ['ink', 'Warm ink']].map((p) => html`
          <button class=${'mc-set-pal mc-pal-' + p[0] + (this.dark === p[0] ? ' on' : '')} @click=${() => this.setDark(p[0])} aria-label=${p[1]}>
            <span class="mc-pal-sw"></span><span class="mc-pal-name">${p[1]}</span></button>`)}
      </div>` : ''}

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

/* ---- the desktop platform bar (≥601px) ----
   The app's persistent member layer for the big screen: brand, board search, and
   the member cluster (merecat, notifications, inbox, account) on EVERY page — the
   features that on desktop today live only in the community identity line. It
   AUGMENTS the existing nav.site (which stays as the content menu below); it reads
   the same badge caches as the mobile chrome (no boot-order dependency on mcKit)
   and links into the existing routes (soft-nav for free). The account button opens
   a dropdown that reuses <mc-settings> verbatim. Phones never see it (CSS-gated). */
class McDeskbar extends LitElement {
  static properties = { notif: { attribute: false }, dm: { attribute: false }, keyed: { attribute: false }, menu: { attribute: false } };
  constructor() { super(); this.notif = 0; this.dm = 0; this.keyed = false; this.menu = false; }
  createRenderRoot() { return this; }
  sync() { this.notif = badgeCount('notif'); this.dm = badgeCount('dm'); this.keyed = !!readKey(); }
  connectedCallback() {
    super.connectedCallback();
    this._onDoc = (e) => { if (this.menu && !e.target.closest('.mc-db-acct')) this.menu = false; };
    this._onKey = (e) => { if (e.key === 'Escape') this.menu = false; };
    document.addEventListener('click', this._onDoc);
    document.addEventListener('keydown', this._onKey);
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('click', this._onDoc);
    document.removeEventListener('keydown', this._onKey);
  }
  toggleMenu(e) { e.preventDefault(); e.stopPropagation(); this.menu = !this.menu; }
  search(e) {
    e.preventDefault();
    const input = this.querySelector('.mc-db-search input');
    location.href = 'community.html?q=' + encodeURIComponent((input && input.value.trim()) || '');
  }
  render() {
    const badge = (n) => n ? html`<span class="mc-tab-badge">${badgeText(n)}</span>` : '';
    return html`<div class="mc-deskbar">
      <a class="mc-db-brand" href="index.html" aria-label="Home">${ICON.cross}<span class="mc-db-word">Mere Catholicity</span></a>
      <form class="mc-db-search" @submit=${(e) => this.search(e)} role="search">
        <span class="mc-db-searchico">${ICON.search}</span>
        <input type="search" placeholder="Search the board…" aria-label="Search the board">
      </form>
      <nav class="mc-db-cluster" aria-label="Member">
        <a class="mc-db-ico mc-db-merecat" href="community.html?merecat=1" aria-label="Ask Merecat" title="Ask Merecat">🐈</a>
        <a class="mc-db-ico" href="community.html?notifications=1" aria-label="Notifications" title="Notifications">${ICON.bell}${badge(this.notif)}</a>
        <a class="mc-db-ico" href="community.html?inbox=1" aria-label="Inbox" title="Inbox">${ICON.inbox}${badge(this.dm)}</a>
        ${this.keyed ? html`<div class="mc-db-acct">
          <button class="mc-db-ico mc-db-avatar" @click=${(e) => this.toggleMenu(e)} aria-label="Account" aria-expanded=${this.menu ? 'true' : 'false'}>${ICON.profile}</button>
          ${this.menu ? html`<div class="mc-db-menu"></div>` : ''}
        </div>` : html`<a class="mc-db-join" href="community.html?me=1">Sign in / Join</a>`}
      </nav>
    </div>`;
  }
  updated() {
    /* mount the shared settings component into the open dropdown (imperative slot,
       the McSheet idiom) — a fresh instance each open reflects current state */
    const menu = this.querySelector('.mc-db-menu');
    if (menu && !menu.firstChild) menu.appendChild(document.createElement('mc-settings'));
  }
}
customElements.define('mc-deskbar', McDeskbar);

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

/* App-native onboarding (phones only): a slide-up "join in one tap" sheet that
   replaces the dead-end gates and the dreaded "create an identity | I have a key"
   text links. It mints the identity IN PLACE through the identity primitives the
   comments client exports on window.mcKit (read lazily at tap-time so it never
   races the client boot), reveals the new key to save, then reloads so the current
   view renders logged-in (the same reload the classic login/logout paths use).
   Desktop / ?app=0 never see it (no mcSheet, isMobile() false). */
const ONBOARD_FAITHS = [
  ['nicene', 'Nicene Christian', 'I hold the Nicene Creed'],
  ['indo-european', 'Indo-European', 'I keep one of the old pre-Christian ways (a guest)'],
  ['seeker', 'Seeker', 'I’m still seeking'],
];
function mcOnboard(onDone) {
  if (!isMobile() || !window.mcSheet) return;
  const wrap = document.createElement('div');
  wrap.className = 'mc-onboard';
  const done = function () { window.mcSheet.close(); if (onDone) { try { onDone(); } catch (e) { /* caller */ } } location.reload(); };

  const intro = document.createElement('p');
  intro.className = 'mc-onboard-intro';
  intro.textContent = 'Join in one tap — no email, no signup. Pick where you stand:';
  wrap.appendChild(intro);

  let chosenFaith = '';
  const faiths = document.createElement('div');
  faiths.className = 'faith-radios mc-onboard-faiths';
  ONBOARD_FAITHS.forEach(function (f) {
    const lbl = document.createElement('label');
    lbl.className = 'faith-option';
    const rad = document.createElement('input');
    rad.type = 'radio'; rad.name = 'mc-onboard-faith'; rad.value = f[0];
    rad.addEventListener('change', function () { chosenFaith = f[0]; refresh(); });
    const txt = document.createElement('span');
    const strong = document.createElement('strong'); strong.textContent = f[1];
    const small = document.createElement('small'); small.textContent = f[2];
    txt.appendChild(strong); txt.appendChild(document.createElement('br')); txt.appendChild(small);
    lbl.appendChild(rad); lbl.appendChild(txt);
    faiths.appendChild(lbl);
  });
  wrap.appendChild(faiths);

  const agreeRow = document.createElement('label');
  agreeRow.className = 'agree-row mc-onboard-agree';
  const agree = document.createElement('input'); agree.type = 'checkbox';
  agree.addEventListener('change', refresh);
  const agreeTxt = document.createElement('span');
  agreeTxt.appendChild(document.createTextNode('I agree to the '));
  const termsLink = document.createElement('a'); termsLink.href = 'terms.html'; termsLink.target = '_blank'; termsLink.textContent = 'terms';
  agreeTxt.appendChild(termsLink); agreeTxt.appendChild(document.createTextNode('.'));
  agreeRow.appendChild(agree); agreeRow.appendChild(agreeTxt);
  wrap.appendChild(agreeRow);

  const createBtn = document.createElement('button');
  createBtn.type = 'button'; createBtn.className = 'btn btn-send mc-onboard-create';
  createBtn.textContent = 'Create my identity'; createBtn.disabled = true;
  wrap.appendChild(createBtn);

  const note = document.createElement('p'); note.className = 'mc-onboard-note'; wrap.appendChild(note);

  const haveKey = document.createElement('button');
  haveKey.type = 'button'; haveKey.className = 'mc-onboard-havekey'; haveKey.textContent = 'I already have a key';
  wrap.appendChild(haveKey);
  const pasteWrap = document.createElement('div'); pasteWrap.className = 'mc-onboard-paste'; pasteWrap.hidden = true;
  const pasteIn = document.createElement('input'); pasteIn.type = 'text'; pasteIn.className = 'key-input mc-onboard-keyin'; pasteIn.placeholder = 'Paste your key';
  const pasteBtn = document.createElement('button'); pasteBtn.type = 'button'; pasteBtn.className = 'btn btn-send'; pasteBtn.textContent = 'Log in';
  pasteWrap.appendChild(pasteIn); pasteWrap.appendChild(pasteBtn);
  wrap.appendChild(pasteWrap);

  function refresh() { createBtn.disabled = !(chosenFaith && agree.checked); }
  haveKey.addEventListener('click', function () { pasteWrap.hidden = !pasteWrap.hidden; if (!pasteWrap.hidden) pasteIn.focus(); });

  function revealKey(key) {
    wrap.textContent = '';
    const h = document.createElement('p'); h.className = 'mc-onboard-intro';
    h.textContent = 'You’re in. Save your key — it is the only way back to this identity.';
    wrap.appendChild(h);
    const keyRow = document.createElement('div'); keyRow.className = 'mc-set-key';
    const keyIn = document.createElement('input'); keyIn.className = 'mc-set-keyin'; keyIn.readOnly = true; keyIn.value = key || '';
    keyIn.addEventListener('focus', function () { keyIn.select(); });
    const copyBtn = document.createElement('button'); copyBtn.type = 'button'; copyBtn.className = 'btn btn-send mc-set-copy'; copyBtn.textContent = 'Copy';
    copyBtn.addEventListener('click', function () { try { if (navigator.clipboard) { navigator.clipboard.writeText(key); copyBtn.textContent = 'Copied'; } } catch (e) { /* no clipboard */ } });
    keyRow.appendChild(keyIn); keyRow.appendChild(copyBtn);
    wrap.appendChild(keyRow);
    const cont = document.createElement('button'); cont.type = 'button'; cont.className = 'btn btn-send mc-onboard-create'; cont.textContent = 'Continue';
    cont.addEventListener('click', done);
    wrap.appendChild(cont);
  }

  createBtn.addEventListener('click', function () {
    const kit = window.mcKit;
    if (!kit || !kit.mintIdentity) { location.href = 'community.html?me=1'; return; }
    createBtn.disabled = true; note.textContent = 'Creating…';
    kit.mintIdentity(chosenFaith).then(function (res) { revealKey(res && res.key); })
      .catch(function () { note.textContent = 'Could not create. Try again.'; createBtn.disabled = false; });
  });
  pasteBtn.addEventListener('click', function () {
    const kit = window.mcKit;
    const key = pasteIn.value.trim();
    if (!key) { pasteIn.focus(); return; }
    if (!kit || !kit.loginWithKey) { location.href = 'community.html?me=1'; return; }
    pasteBtn.disabled = true; note.textContent = 'Logging in…';
    kit.loginWithKey(key).then(function (ok) {
      if (ok) done();
      else { note.textContent = 'That key was not recognized.'; pasteBtn.disabled = false; }
    }).catch(function () { note.textContent = 'Could not log in. Try again.'; pasteBtn.disabled = false; });
  });

  window.mcSheet.open('Join the conversation', wrap);
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

  /* The desktop platform bar (CSS-gated ≥601px). data-mc-app is load-bearing:
     without it swapContent deletes the bar on the first soft-nav. */
  const deskbar = document.createElement('mc-deskbar');
  deskbar.setAttribute('data-mc-app', '');
  document.body.appendChild(deskbar);
  /* One marker so desktop CSS knows the shell/deskbar is present (padding under the
     fixed bar); never set under ?app=0, where installChrome never runs. */
  document.body.classList.add('mc-app');

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
  window.mcOnboard = mcOnboard;

  /* The comments client fires mc-badge whenever an unread count changes, so the
     tab bar, app-bar bell, and desktop bar update the instant a DM or notification
     lands. */
  document.addEventListener('mc-badge', function () { tabbar.sync(); appbar.sync(); deskbar.sync(); });

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

  /* A logged-out reader who lands on a screen that NEEDS an identity (Inbox,
     Profile, Notifications) is signed up in place — the onboarding sheet opens
     instead of a dead-end. Latched per route-entry so the repeated sync() calls
     (every soft-nav + every mc-badge) never re-open it after a dismissal; a fresh
     gated route (or login) re-arms it. Reads window.mcKit, so it no-ops on the
     pre-boot sync and only fires once the client has booted. */
  var onboardLatch = '';
  function maybeOnboard() {
    if (!isMobile() || !window.mcKit || !window.mcOnboard) { onboardLatch = ''; return; }
    if (readKey()) { onboardLatch = ''; return; }               // logged in — nothing to do
    var tab = activeTab();
    var gated = tab === 'messages' || tab === 'profile' || /[?&]notifications=1\b/.test(location.search);
    if (!gated) { onboardLatch = ''; return; }
    var routeKey = location.pathname + location.search;
    if (onboardLatch === routeKey) return;                       // already offered here
    onboardLatch = routeKey;
    window.mcOnboard();
  }

  function sync() { tabbar.sync(); appbar.sync(); deskbar.sync(); mountHome(); maybeOnboard(); }
  sync();
  /* boots()/chrome.sync() only fire on soft-nav; on a DIRECT initial load the
     onboarding trigger needs one sync once the client has booted (window.mcKit
     set), so a logged-out reader who lands straight on a gated URL still gets the
     sheet. Bounded poll; a no-op on soft-nav loads (mcKit already present). */
  if (!window.mcKit) {
    var kitTries = 0;
    (function waitKit() {
      if (window.mcKit) { sync(); return; }
      if (kitTries++ > 30) return;
      setTimeout(waitKit, 100);
    })();
  }
  return { sync: sync };
}
