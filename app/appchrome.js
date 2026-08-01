/* Mobile app chrome (appification, Phase 1): a persistent bottom tab bar, a slim
   top app bar, a reusable slide-up sheet, and the Home launcher. Shell-owned and
   light-DOM (like the audio dock), mounted once beside it with data-mc-app so
   they survive soft-navigation. EVERYTHING here is CSS-gated to phones
   (styles/13-app-mobile.css, @media max-width:600px) — desktop renders none of
   it and is byte-unchanged. installChrome() is called by app/shell.js after the
   ?app=0 latch; its returned sync() runs in boots() after every swap, and the
   click delegate in shell.js soft-navigates the tabs' <a href>s for free. */

import { LitElement, html } from 'lit';
import { mountLibrary } from './views/library.js';

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
  { icon: '🧭', title: 'Where to begin', sub: 'New here? Start here.', href: 'where-to-begin.html' },
  { icon: '📖', title: 'The Book', sub: 'Mere Catholicity — read, download, or buy', href: 'the-book.html' },
  { icon: '💬', title: 'Community', sub: 'Join the conversation', href: 'community.html' },
  { icon: '🐈', title: 'Ask Merecat', sub: 'Put a question to the librarian AI', href: 'community.html?merecat=1' },
];
/* The reading shelf, grouped the way a newcomer reads it. Surfaces the whole
   site nav (Contact lives in Settings + the footer, not here). */
const HOME_SECTIONS = [
  { heading: 'Start here', items: [
    { title: 'Credo', sub: 'What we believe, clause by clause', href: 'credo.html' },
    { title: 'Lex orandi, lex credendi', sub: 'The rule of prayer', href: 'lex-orandi.html' },
  ] },
  { heading: 'The papers', items: [
    { title: 'Charting: the historic communions', sub: 'Rome, the Orthodox, the confessional churches', href: 'charting-communions.html' },
    { title: 'Charting: the free churches', sub: 'The same rule, turned around', href: 'free-churches.html' },
    { title: 'The top fifty objections', sub: 'Answered one by one', href: 'objections.html' },
    { title: 'The bishop and the presbyter', sub: 'Companion paper', href: 'bishop-presbyter.html' },
  ] },
  { heading: 'Explore', items: [
    { title: 'Library', sub: 'The whole hosted corpus', href: 'library.html' },
    { title: 'Sources', sub: 'The primary texts, Newman included', href: 'resources.html' },
    { title: 'About', sub: 'The project', href: 'about.html' },
  ] },
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

/* The current page/view title for the top bar. Home shows the brand; every other
   page uses document.title with the trailing " | site" / " — site" suffix stripped
   (each forum view + content page keeps document.title current, and a title
   MutationObserver re-syncs the bar whenever an async view updates it). */
function pageTitle() {
  if (activeTab() === 'home') return 'Mere Catholicity';
  var t = String(document.title || '').split(/\s+[|—–]\s+/)[0].trim();
  return t || 'Mere Catholicity';
}

/* Board search only belongs where the board is — on community.html. Elsewhere the
   top-bar search magnifier is hidden (a content page has nothing to search here). */
function onCommunity() {
  return (location.pathname.split('/').pop() || '') === 'community.html';
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
/* Admin status, bridged from the comments client (loadMyProfile writes the flag)
   so the platform chrome can surface admin-only entries without its own fetch. */
function isAdmin() {
  try { return localStorage.getItem('mc-admin') === '1'; } catch (e) { return false; }
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
  static properties = { canBack: { attribute: false }, notif: { attribute: false }, title: { attribute: false } };
  constructor() { super(); this.canBack = false; this.notif = 0; this.title = ''; }
  createRenderRoot() { return this; }
  sync() {
    this.canBack = history.length > 1;   // dim < at the very start of history
    this.notif = badgeCount('notif');
    this.title = pageTitle();             // the current page/view title, shown centered
  }
  goBack(e) { e.preventDefault(); if (history.length > 1) history.back(); else { location.href = 'index.html'; } }
  goFwd(e) { e.preventDefault(); history.forward(); }
  settings(e) { e.preventDefault(); if (window.mcSheet) window.mcSheet.settings(); }
  notifs(e) { e.preventDefault(); if (window.mcSheet) window.mcSheet.open('', document.createElement('mc-notifs')); }
  render() {
    return html`<header class="mc-appbar">
      <div class="mc-appbar-side mc-appbar-l">
        <button class=${'mc-ab-btn' + (this.canBack ? '' : ' mc-ab-dim')} @click=${(e) => this.goBack(e)} aria-label="Back">${ICON.back}</button>
      </div>
      <div class="mc-appbar-title" title=${this.title}>${this.title}</div>
      <div class="mc-appbar-side mc-appbar-r">
        ${onCommunity() ? html`<a class="mc-ab-btn" href="community.html?q=" aria-label="Search">${ICON.search}</a>` : ''}
        <button class="mc-ab-btn mc-ab-bell" @click=${(e) => this.notifs(e)} aria-label="Notifications">${ICON.bell}${this.notif
          ? html`<span class="mc-tab-badge">${badgeText(this.notif)}</span>` : ''}</button>
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
  /* Swipe-down-to-dismiss. A downward drag that starts at the top of the sheet
     (so it never fights content scrolling) drags the panel with the finger; a far
     enough pull or a quick flick lets it go, otherwise it snaps back. Tapping the
     scrim or the grip still closes it as before. */
  dragStart(e) {
    const sheet = e.currentTarget;
    if (sheet.scrollTop > 0) return;                     // let the content scroll
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    this._drag = { sheet, y0: e.clientY, y: e.clientY, t: e.timeStamp || 0, dy: 0, vy: 0, active: false };
    this._pm = (ev) => this.dragMove(ev);
    this._pu = (ev) => this.dragEnd(ev);
    document.addEventListener('pointermove', this._pm, { passive: false });
    document.addEventListener('pointerup', this._pu);
    document.addEventListener('pointercancel', this._pu);
  }
  dragMove(e) {
    const d = this._drag; if (!d) return;
    const dy = e.clientY - d.y0;
    if (!d.active) {
      if (d.sheet.scrollTop > 0) { this.dragCleanup(); return; }  // scrolled — hand back
      if (dy > 5) d.active = true; else return;                    // only a real downward pull
    }
    e.preventDefault();
    d.dy = Math.max(0, dy);
    d.sheet.style.transition = 'none';
    d.sheet.style.transform = 'translateY(' + d.dy + 'px)';
    const dt = Math.max(1, (e.timeStamp || 0) - d.t);
    d.vy = (e.clientY - d.y) / dt; d.y = e.clientY; d.t = e.timeStamp || 0;
  }
  dragEnd() {
    const d = this._drag; this.dragCleanup();
    if (!d || !d.active) return;
    if (d.dy > 90 || d.vy > 0.5) {           // far enough, or a quick flick — dismiss
      d.sheet.style.transition = 'transform 0.2s ease-out';
      d.sheet.style.transform = 'translateY(100%)';
      setTimeout(() => { this.close(); d.sheet.style.transition = ''; d.sheet.style.transform = ''; }, 190);
    } else {                                  // snap back to the CSS resting position
      d.sheet.style.transition = ''; d.sheet.style.transform = '';
    }
  }
  dragCleanup() {
    if (this._pm) document.removeEventListener('pointermove', this._pm);
    if (this._pu) { document.removeEventListener('pointerup', this._pu); document.removeEventListener('pointercancel', this._pu); }
    this._pm = this._pu = null; this._drag = null;
  }
  render() {
    return html`
      <div class=${'mc-sheet-scrim' + (this.open ? ' on' : '')} @click=${() => this.close()}></div>
      <section class=${'mc-sheet' + (this.open ? ' on' : '')} role="dialog" aria-modal="true" aria-label=${this.heading || 'Sheet'}
        @pointerdown=${(e) => this.dragStart(e)}>
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
        localStorage.removeItem('mc-admin');
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

      ${isAdmin() ? html`<h3 class="mc-set-sec">Administration</h3>
      ${link('community.html?admin=1', 'Administrative options', 'Moderation, platform settings, audit')}` : ''}

      <h3 class="mc-set-sec">Read &amp; help</h3>
      ${link('library.html', 'Library')}
      ${link('about.html', 'About')}
      ${link('contact.html', 'Contact')}
      ${link('terms.html', 'Terms &amp; conditions')}
    </div>`;
  }
}
customElements.define('mc-settings', McSettings);

/* ---- the notifications panel (bell dropdown / sheet, mirrors mc-settings) ----
   Self-contained like mc-settings: reads the identity from storage, fetches the
   list, renders it, and marks it read (clearing the badge). Opening it never
   leaves the page — the bell behaves exactly like the gear. */
class McNotifs extends LitElement {
  static properties = { items: { attribute: false }, state: { attribute: false } };
  constructor() { super(); this.items = null; this.state = 'load'; }
  createRenderRoot() { return this; }
  connectedCallback() {
    super.connectedCallback();
    const key = readKey();
    if (!key) { this.state = 'gate'; return; }
    const API = '/api/comments';
    fetch(API + '/notifications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: key, p: 1 }) })
      .then((r) => r.json()).then((d) => {
        if (!d || !d.ok) { this.state = 'err'; return; }
        this.items = d.items || []; this.state = 'ok';
        /* reading the list clears it on the server — tell the badge the truth */
        fetch(API + '/notifications/read', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: key }) })
          .then(() => {
            try { localStorage.setItem('mc-notif-unread', JSON.stringify({ n: 0, at: Date.now() })); } catch (e) { /* storage */ }
            document.dispatchEvent(new Event('mc-badge'));
          }).catch(() => {});
      }).catch(() => { this.state = 'err'; });
  }
  render() {
    const wrap = (inner) => html`<div class="mc-notifs"><h3 class="mc-set-sec">Notifications</h3>${inner}</div>`;
    if (this.state === 'gate') return wrap(html`<p class="mc-notifs-empty">Notifications need an identity — create one from the board.</p>`);
    if (this.state === 'err') return wrap(html`<p class="mc-notifs-empty">Could not load notifications. Check your connection.</p>`);
    if (this.state === 'load') return wrap(html`<p class="mc-notifs-empty">Loading…</p>`);
    if (!this.items.length) return wrap(html`<p class="mc-notifs-empty" data-ico="🔔">No notifications yet. Post in a thread to follow it; you will hear when someone replies or names you.</p>`);
    const name = (it) => it.actor_nick || (it.actor_hash && window.mcCore ? window.mcCore.displayName(it.actor_hash) : 'Someone');
    return wrap(html`${this.items.map((it) => {
      const isDm = it.kind === 'dm';
      const who = name(it);
      const label = isDm ? (who + ' sent you a message')
        : who + (it.kind === 'mention' ? ' mentioned you in ' : ' replied in ') + (it.topic_title || 'a thread');
      const to = isDm ? ('community.html?dm=' + it.actor_hash)
        : ('community.html?topic=' + it.topic_id + '#comment-' + it.comment_id);
      return html`<a class=${'mc-notifs-row' + (it.read_at ? '' : ' mc-notifs-new')} href=${to}>${label}</a>`;
    })}`);
  }
}
customElements.define('mc-notifs', McNotifs);

/* ---- the desktop TOP bar (≥601px) ----
   The platform's utility bar on the big screen, mirroring the mobile app bar:
   history back/forward, brand, board search, notifications, and a settings gear
   whose dropdown reuses <mc-settings> verbatim (account, theme, admin, help). The
   five primary destinations live in the LEFT app-bar (mc-sidebar) below, exactly
   as the mobile bottom tabs do. Reads the same badge caches; phones never see it
   (CSS-gated). The dropdown closes on outside-click, Escape, AND any soft-nav
   (the mc-navigate signal) so a chosen link never loads behind an open menu. */
class McDeskbar extends LitElement {
  static properties = { notif: { attribute: false }, canBack: { attribute: false }, menu: { attribute: false }, title: { attribute: false }, notifMenu: { attribute: false } };
  constructor() { super(); this.notif = 0; this.canBack = false; this.menu = false; this.title = ''; this.notifMenu = false; }
  createRenderRoot() { return this; }
  sync() { this.notif = badgeCount('notif'); this.canBack = history.length > 1; this.title = pageTitle(); }
  connectedCallback() {
    super.connectedCallback();
    this._onDoc = (e) => {
      if (this.menu && !e.target.closest('.mc-db-acct')) this.menu = false;
      if (this.notifMenu && !e.target.closest('.mc-db-notif')) this.notifMenu = false;
    };
    this._onKey = (e) => { if (e.key === 'Escape') { this.menu = false; this.notifMenu = false; } };
    this._onNav = () => { this.menu = false; this.notifMenu = false; };
    document.addEventListener('click', this._onDoc);
    document.addEventListener('keydown', this._onKey);
    document.addEventListener('mc-navigate', this._onNav);
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('click', this._onDoc);
    document.removeEventListener('keydown', this._onKey);
    document.removeEventListener('mc-navigate', this._onNav);
  }
  toggleMenu(e) { e.preventDefault(); e.stopPropagation(); this.menu = !this.menu; this.notifMenu = false; }
  toggleNotif(e) { e.preventDefault(); e.stopPropagation(); this.notifMenu = !this.notifMenu; this.menu = false; }
  goBack(e) { e.preventDefault(); if (history.length > 1) history.back(); else { location.href = 'index.html'; } }
  goFwd(e) { e.preventDefault(); history.forward(); }
  search(e) {
    e.preventDefault();
    const input = this.querySelector('.mc-db-search input');
    location.href = 'community.html?q=' + encodeURIComponent((input && input.value.trim()) || '');
  }
  render() {
    const badge = (n) => n ? html`<span class="mc-tab-badge">${badgeText(n)}</span>` : '';
    return html`<div class="mc-deskbar">
      <div class="mc-db-hist">
        <button class=${'mc-db-ico' + (this.canBack ? '' : ' mc-ab-dim')} @click=${(e) => this.goBack(e)} aria-label="Back" title="Back">${ICON.back}</button>
        <button class="mc-db-ico" @click=${(e) => this.goFwd(e)} aria-label="Forward" title="Forward">${ICON.forward}</button>
      </div>
      <a class="mc-db-brand" href="index.html" aria-label="Home">${ICON.cross}<span class="mc-db-word">Mere Catholicity</span></a>
      ${onCommunity()
        ? html`<form class="mc-db-search" @submit=${(e) => this.search(e)} role="search">
            <span class="mc-db-searchico">${ICON.search}</span>
            <input type="search" placeholder="Search the board…" aria-label="Search the board">
          </form>`
        : (activeTab() === 'home'
            ? html`<span class="mc-db-center"></span>`
            : html`<div class="mc-db-center mc-db-title" title=${this.title}>${this.title}</div>`)}
      <nav class="mc-db-cluster" aria-label="Account">
        <div class="mc-db-notif">
          <button class="mc-db-ico" @click=${(e) => this.toggleNotif(e)} aria-label="Notifications" title="Notifications" aria-expanded=${this.notifMenu ? 'true' : 'false'}>${ICON.bell}${badge(this.notif)}</button>
          ${this.notifMenu ? html`<div class="mc-db-menu mc-db-notifmenu"></div>` : ''}
        </div>
        <div class="mc-db-acct">
          <button class="mc-db-ico mc-db-gear" @click=${(e) => this.toggleMenu(e)} aria-label="Settings" aria-expanded=${this.menu ? 'true' : 'false'}>${ICON.gear}</button>
          ${this.menu ? html`<div class="mc-db-menu"></div>` : ''}
        </div>
      </nav>
    </div>`;
  }
  updated() {
    const menu = this.querySelector('.mc-db-menu:not(.mc-db-notifmenu)');
    if (menu && !menu.firstChild) menu.appendChild(document.createElement('mc-settings'));
    const nmenu = this.querySelector('.mc-db-notifmenu');
    if (nmenu && !nmenu.firstChild) nmenu.appendChild(document.createElement('mc-notifs'));
  }
}
customElements.define('mc-deskbar', McDeskbar);

/* ---- the desktop LEFT app-bar (≥601px) ----
   The mobile bottom tabs, stood up as a floating, vertically-centered rail on the
   big screen (GNOME / Facebook-inspired): wide with labels by default, a clicker
   collapses it to icons-only (persisted in localStorage). Reuses TABS / activeTab
   and the badge caches. Phones never see it (CSS-gated ≥601px). */
class McSidebar extends LitElement {
  static properties = { active: { attribute: false }, dm: { attribute: false }, wide: { attribute: false } };
  constructor() {
    super();
    this.active = 'home'; this.dm = 0;
    let w = true;
    try { w = localStorage.getItem('mc-sidebar') !== 'icons'; } catch (e) { /* default wide */ }
    this.wide = w;
  }
  createRenderRoot() { return this; }
  connectedCallback() { super.connectedCallback(); this._applyBody(); }
  /* Reflect wide/collapsed on <body> so the desktop CSS pushes the content over
     when the rail is expanded (like Facebook), and floats it back when collapsed. */
  _applyBody() { try { document.body.classList.toggle('mc-sb-wide', this.wide); } catch (e) { /* blocked */ } }
  sync() { this.active = activeTab(); this.dm = badgeCount('dm'); }
  toggle() {
    this.wide = !this.wide;
    try { localStorage.setItem('mc-sidebar', this.wide ? 'wide' : 'icons'); } catch (e) { /* blocked */ }
    this._applyBody();
  }
  render() {
    return html`<nav class=${'mc-sidebar' + (this.wide ? ' mc-sb-wide' : '')} aria-label="Primary">
      <button class="mc-sb-toggle" @click=${() => this.toggle()} aria-label=${this.wide ? 'Collapse menu' : 'Expand menu'} title=${this.wide ? 'Collapse' : 'Expand'}>${this.wide ? ICON.back : ICON.forward}</button>
      ${TABS.map((t) => {
        const n = t.badge === 'dm' ? this.dm : 0;
        return html`<a class=${'mc-sb-item' + (this.active === t.key ? ' mc-tab-on' : '')} href=${t.href} aria-label=${t.label} aria-current=${this.active === t.key ? 'page' : 'false'} title=${t.label}>
          <span class="mc-sb-ico">${t.icon ? t.icon : ICON[t.svg]}${n ? html`<span class="mc-tab-badge">${badgeText(n)}</span>` : ''}</span>
          <span class="mc-sb-lbl">${t.label}</span></a>`;
      })}
    </nav>`;
  }
}
customElements.define('mc-sidebar', McSidebar);

/* ---- the persistent site footer (all viewports) ---- */
class McFooter extends LitElement {
  createRenderRoot() { return this; }
  render() {
    return html`<div class="mc-footer">
      <a href="index.html">merecatholicity.com</a><span class="mc-foot-sep">·</span>
      <a href="terms.html">terms &amp; conditions</a><span class="mc-foot-sep">·</span>
      <a href="contact.html">Contact</a>
    </div>`;
  }
}
customElements.define('mc-footer', McFooter);

/* ---- the Home launcher (replaces the marketing homepage on phones) ---- */
class McHome extends LitElement {
  createRenderRoot() { return this; }
  render() {
    return html`<div class="mc-home">
      <div class="mc-home-hero"><span class="mc-home-cross">✝</span>
        <p>One, holy, catholic, and apostolic.</p></div>
      <hr class="mc-home-rule">
      <div class="mc-home-feats">${HOME_FEATURES.map((f) => html`
        <a class="mc-home-feat" href=${f.href}>
          <span class="mc-home-feat-ico">${f.icon}</span>
          <span class="mc-home-feat-txt"><strong>${f.title}</strong><small>${f.sub}</small></span>
          <span class="mc-home-go">›</span></a>`)}</div>
      ${HOME_SECTIONS.map((sec) => html`
        <h2 class="mc-home-sec">${sec.heading}</h2>
        <div class="mc-home-shelf">${sec.items.map((s) => html`
          <a class="mc-home-row" href=${s.href}>
            <span class="mc-home-row-txt"><strong>${s.title}</strong>${s.sub ? html`<small>${s.sub}</small>` : ''}</span>
            <span class="mc-home-go">›</span></a>`)}</div>`)}
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
  /* The desktop LEFT app-bar (the mobile tabs stood up) + the persistent site
     footer. Both data-mc-app so soft-nav preserves them across swaps. */
  const sidebar = document.createElement('mc-sidebar');
  sidebar.setAttribute('data-mc-app', '');
  document.body.appendChild(sidebar);
  const footer = document.createElement('mc-footer');
  footer.setAttribute('data-mc-app', '');
  document.body.appendChild(footer);
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
  document.addEventListener('mc-badge', function () { tabbar.sync(); appbar.sync(); deskbar.sync(); sidebar.sync(); });

  /* The top bar names the current page/view. Its title is set (often async, after
     a fetch) by each view via document.title, so re-sync the bars the moment the
     <title> changes — the bar then always matches where you are, even for a topic
     whose title arrives with the data. */
  var titleEl = document.querySelector('title');
  if (titleEl && window.MutationObserver) {
    new MutationObserver(function () { appbar.sync(); deskbar.sync(); }).observe(titleEl, { childList: true });
  }

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
    var gated = tab === 'messages' || tab === 'profile' || tab === 'merecat' || /[?&]notifications=1\b/.test(location.search);
    if (!gated) { onboardLatch = ''; return; }
    var routeKey = location.pathname + location.search;
    if (onboardLatch === routeKey) return;                       // already offered here
    onboardLatch = routeKey;
    window.mcOnboard();
  }

  /* The Library page becomes an app-style drill-down on both breakpoints (parses
     its own static catalog; SEO/no-JS keep the flat list). Runs after every swap. */
  function mountLibraryHook() {
    if ((location.pathname.split('/').pop() || '') !== 'library.html') return;
    const main = document.querySelector('main');
    if (main) mountLibrary(main);
  }

  function sync() { tabbar.sync(); appbar.sync(); deskbar.sync(); sidebar.sync(); mountHome(); mountLibraryHook(); maybeOnboard(); }
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
