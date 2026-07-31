/* Mobile app chrome (appification, Phase 1): a persistent bottom tab bar, a slim
   top app bar, a reusable slide-up sheet, and the Home launcher. Shell-owned and
   light-DOM (like the audio dock), mounted once beside it with data-mc-app so
   they survive soft-navigation. EVERYTHING here is CSS-gated to phones
   (styles/13-app-mobile.css, @media max-width:600px) — desktop renders none of
   it and is byte-unchanged. installChrome() is called by app/shell.js after the
   ?app=0 latch; its returned sync() runs in boots() after every swap, and the
   click delegate in shell.js soft-navigates the tabs' <a href>s for free. */

import { LitElement, html } from '../vendor/lit-all.min.js';

/* The five primary destinations. Merecat is the raised center hero (the standout
   AI). hrefs are ordinary same-origin links the shell intercepts + soft-navs. */
const TABS = [
  { key: 'home', label: 'Home', icon: '🏠', href: 'index.html' },
  { key: 'community', label: 'Community', icon: '💬', href: 'community.html' },
  { key: 'merecat', label: 'Merecat', icon: '🐈', href: 'community.html?merecat=1', hero: true },
  { key: 'messages', label: 'Inbox', icon: '✉️', href: 'community.html?inbox=1', badge: 'dm' },
  { key: 'profile', label: 'Profile', icon: '👤', href: 'community.html?me=1' },
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
          <span class="mc-tab-ico">${t.icon}${t.badge === 'dm' && this.dm
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
        ? html`<button class="mc-ab-btn" @click=${(e) => this.goBack(e)} aria-label="Back">‹</button>`
        : html`<a class="mc-ab-brand" href="index.html" aria-label="Home">✝</a>`}</div>
      <div class="mc-appbar-title">${this.heading}</div>
      <div class="mc-appbar-side mc-appbar-r">
        <a class="mc-ab-btn" href="community.html?q=" aria-label="Search">🔍</a>
        <a class="mc-ab-btn mc-ab-bell" href="community.html?notifications=1" aria-label="Notifications">🔔${this.notif
          ? html`<span class="mc-tab-badge">${badgeText(this.notif)}</span>` : ''}</a>
        <button class="mc-ab-btn" @click=${(e) => this.settings(e)} aria-label="Settings">⚙</button>
      </div>
    </header>`;
  }
}
customElements.define('mc-appbar', McAppbar);

/* ---- the reusable slide-up sheet (the app-dialog primitive) ---- */
class McSheet extends LitElement {
  static properties = { open: { attribute: false }, heading: { attribute: false } };
  constructor() { super(); this.open = false; this.heading = ''; this._node = null; }
  createRenderRoot() { return this; }
  show(heading, node) { this.heading = heading || ''; this._node = node || null; this.open = true; }
  close() { this.open = false; }
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
    if (!confirm('Log out of this identity? Keep your key saved so you can log back in.')) return;
    try {
      localStorage.removeItem('mc-comment-key');
      localStorage.removeItem('mc-dm-unread');
      localStorage.removeItem('mc-notif-unread');
    } catch (e) { /* blocked */ }
    location.href = 'index.html';
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
    open: function (heading, node) { sheet.show(heading, node); },
    settings: function () { sheet.show('Settings', document.createElement('mc-settings')); },
    close: function () { sheet.close(); },
  };

  /* The comments client fires mc-badge whenever an unread count changes, so the
     tab bar and bell update the instant a DM or notification lands. */
  document.addEventListener('mc-badge', function () { tabbar.sync(); appbar.sync(); });

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
