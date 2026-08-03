/* Mobile app chrome (appification, Phase 1): a persistent bottom tab bar, a slim
   top app bar, a reusable slide-up sheet, and the Home launcher. Shell-owned and
   light-DOM (like the audio dock), mounted once beside it with data-mc-app so
   they survive soft-navigation. EVERYTHING here is CSS-gated to phones
   (styles/13-app-mobile.css, @media max-width:600px) — desktop renders none of
   it and is byte-unchanged. installChrome() is called by app/shell.js after the
   ?app=0 latch; its returned sync() runs in boots() after every swap, and the
   click delegate in shell.js soft-navigates the tabs' <a href>s for free. */

import { LitElement, html } from 'lit';
import { mountLibrary } from './views/library.ts';

/* Crisp stroke icons (Feather-ish, 24×24, currentColor) so the chrome reads as an
   app, not a website. Static SVG templates — no unsafe injection. The Merecat
   hero keeps the 🐈 mascot on purpose (it IS the brand). */
const ICON = {
  home: html`<svg viewBox="0 0 24 24" width="24" height="24" class="mc-ico" aria-hidden="true"><path d="M3 10.8 12 3.5l9 7.3"/><path d="M5.5 9.6V20h13V9.6"/></svg>`,
  community: html`<svg viewBox="0 0 24 24" width="24" height="24" class="mc-ico" aria-hidden="true"><path d="M20 14a2 2 0 0 1-2 2H8.5L4.5 20V6a2 2 0 0 1 2-2H18a2 2 0 0 1 2 2z"/></svg>`,
  inbox: html`<svg viewBox="0 0 24 24" width="24" height="24" class="mc-ico" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m3.5 7.5 8.5 6 8.5-6"/></svg>`,
  profile: html`<svg viewBox="0 0 24 24" width="24" height="24" class="mc-ico" aria-hidden="true"><circle cx="12" cy="8" r="3.6"/><path d="M5 20c.4-3.6 3.4-5.6 7-5.6s6.6 2 7 5.6"/></svg>`,
  search: html`<svg viewBox="0 0 24 24" width="24" height="24" class="mc-ico" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20.5 20.5-4-4"/></svg>`,
  bell: html`<svg viewBox="0 0 24 24" width="24" height="24" class="mc-ico" aria-hidden="true"><path d="M18 8a6 6 0 1 0-12 0c0 6-2.5 7-2.5 7h17S18 14 18 8"/><path d="M10.2 19a1.9 1.9 0 0 0 3.6 0"/></svg>`,
  gear: html`<svg viewBox="0 0 24 24" width="24" height="24" class="mc-ico" aria-hidden="true"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>`,
  cross: html`<svg viewBox="0 0 24 24" width="24" height="24" class="mc-ico" aria-hidden="true"><path d="M12 3.5v17M7.5 8.5h9"/></svg>`,
  back: html`<svg viewBox="0 0 24 24" width="24" height="24" class="mc-ico" aria-hidden="true"><path d="m14.5 6-6 6 6 6"/></svg>`,
  forward: html`<svg viewBox="0 0 24 24" width="24" height="24" class="mc-ico" aria-hidden="true"><path d="m9.5 6 6 6-6 6"/></svg>`,
  feed: html`<svg viewBox="0 0 24 24" width="24" height="24" class="mc-ico" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M7 8.5h6M7 12h10M7 15.5h10"/></svg>`,
};

/* The primary destinations. Community (the forum hub) is the raised center hero;
   Merecat 🐈 keeps its mascot emoji (a deliberate brand mark), Feed uses a stroke
   SVG like the other structural tabs. hrefs are ordinary same-origin links the
   shell intercepts + soft-navs. (A 6-item bar can't optically centre the raised
   hero; it sits at slot 4 by design.) */
interface Tab {
  key: string;
  label: string;
  href: string;
  svg?: keyof typeof ICON;
  icon?: string;
  hero?: boolean;
  badge?: string;
}
const TABS: Tab[] = [
  { key: 'home', label: 'Home', svg: 'home', href: 'index.html' },
  { key: 'merecat', label: 'Merecat', icon: '🐈', href: 'merecat-ai.html' },
  { key: 'feed', label: 'Feed', svg: 'feed', href: 'feed.html' },
  { key: 'community', label: 'Community', svg: 'community', href: 'community.html', hero: true },
  { key: 'messages', label: 'Inbox', svg: 'inbox', href: 'messages.html', badge: 'dm' },
  { key: 'profile', label: 'Profile', svg: 'profile', href: 'profile.html' },
];

/* The Home launcher: standout BROWSE features first, then the reading shelf
   (mirrors scripts/nav.yml). Static links only — the shell adds no API traffic
   here. P3-e: these deliberately do NOT repeat the rail / tab-bar destinations
   (Community, Ask Merecat, Inbox, Profile) — the rail is the quick-switch, the
   launcher is browse — and no item appears both here and in HOME_SECTIONS. */
const HOME_FEATURES = [
  { icon: '🧭', title: 'Where to begin', sub: 'New here? Start here.', href: 'where-to-begin.html' },
  { icon: '📖', title: 'The Book', sub: 'Mere Catholicity — read, download, or buy', href: 'the-book.html' },
  { icon: '📚', title: 'Library', sub: 'The whole hosted corpus', href: 'library.html' },
  { icon: '🎧', title: 'The audio Bible', sub: 'The King James Version read aloud, chapter by chapter', href: 'kjv.html' },
  { icon: '📰', title: 'Journal', sub: 'The Mere Catholicity Journal', href: 'journal.html' },
];

/* The reader's way back into whatever they were last reading: deeplink.js
   stores mc-readpos:<path> = {id, title, at} as corpus pages scroll. The most
   recent one becomes a "Continue reading" chip atop the Home launcher. */
function lastReadPos(): { href: string; title: string } | null {
  try {
    let best: { at: number; href: string; title: string } | null = null;
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i) || '';
      if (k.indexOf('mc-readpos:') !== 0) continue;
      const v = JSON.parse(localStorage.getItem(k) as string);
      if (!v || !v.at) continue;
      const path = k.slice('mc-readpos:'.length);
      const title = String(v.title || '').split(/\s+[|—–]\s+/)[0].trim() || path;
      if (!best || v.at > best.at) best = { at: v.at, href: path + (v.id ? '#' + v.id : ''), title };
    }
    return best ? { href: best.href, title: best.title } : null;
  } catch (e) { return null; }
}
/* The reading shelf, grouped the way a newcomer reads it. Surfaces the rest of
   the site nav (Contact lives only in the footer, kept quiet by design — not
   here; Library + Journal are up in the feature cards, not repeated here). */
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
    { title: 'Sources', sub: 'The primary texts, Newman included', href: 'resources.html' },
    { title: 'About', sub: 'The project', href: 'about.html' },
  ] },
];

/* Which tab the current URL belongs to (the forum's views live in the query
   string). '' = a content page (a paper, the library, about…): no tab is
   active and the app bar shows a back arrow. */
function activeTab() {
  const path = location.pathname.split('/').pop() || 'index.html';
  if (path === 'index.html' || path === '') return 'home';
  if (path === 'merecat-ai.html') return 'merecat';
  if (path === 'messages.html') return 'messages';
  if (path === 'profile.html') return 'profile';
  if (path === 'feed.html') return 'feed';
  if (path === 'community.html') return 'community';
  return '';
}

/* The sacred-art theme accent: each primary feature carries a background painting
   (see styles/main.css `body[data-art]`). The art key mostly follows the active
   tab, with two remaps: Inbox uses the Pietà (`inbox`), and the forum's admin
   pages (admin.html) share Community's Last Supper. Set on <body> so CSS can key
   the fixed, faded, edge-masked accent; re-run on every soft-nav via sync(). */
const ART_BY_PAGE: Record<string, string> = {
  'admin.html': 'community',
  // content pages reuse the six feature paintings, plus a few of their own
  'where-to-begin.html': 'inbox',
  'the-book.html': 'home',
  'library.html': 'merecat',
  'about.html': 'feed',
  'credo.html': 'credo',
  'lex-orandi.html': 'lexorandi',
  'journal.html': 'lexorandi',   // the Journal shares Lex Orandi's painting (owner's call)
  'charting-communions.html': 'communions',
  'free-churches.html': 'freechurches',
  'bishop-presbyter.html': 'geneva',
  'objections.html': 'luther',
  'resources.html': 'merecat',
};
function themeArt(): string {
  const path = location.pathname.split('/').pop() || 'index.html';
  if (ART_BY_PAGE[path]) return ART_BY_PAGE[path];
  const t = activeTab();
  if (t === 'messages') return 'inbox';
  return t;   // 'home' | 'merecat' | 'feed' | 'community' | 'profile' | ''
}
function syncThemeArt() {
  try {
    const a = themeArt();
    if (a) document.body.dataset.art = a;
    else delete document.body.dataset.art;
  } catch (e) { /* storage/DOM blocked — no accent, no harm */ }
  applyArt();
}

/* Whether the sacred-art page accents are on (Settings → Appearance). Default on;
   a reader who finds them distracting turns them off, remembered per browser. */
function artOn(): boolean {
  try { return localStorage.getItem('mc-art') !== '0'; } catch (e) { return true; }
}
function applyArt() {
  try { document.body.classList.toggle('mc-no-art', !artOn()); } catch (e) { /* blocked */ }
}

/* The current page/view title for the top bar. Home shows the brand; every other
   page uses document.title with the trailing " | site" / " — site" suffix stripped
   (each forum view + content page keeps document.title current, and a title
   MutationObserver re-syncs the bar whenever an async view updates it). */
function pageTitle() {
  var tab = activeTab();
  if (tab === 'home') return 'Mere Catholicity';
  /* The forum's tabbed views share community.html, and its static <title> reads
     "Community" until the async view resets it — so name the Feed explicitly to
     keep the chrome from briefly (or, on a slow view, lastingly) labelling the
     Feed screen "Community", contradicting the tab. */
  if (tab === 'feed') return 'Feed';
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
function badgeCount(which: string) {
  try {
    const raw = localStorage.getItem(which === 'dm' ? 'mc-dm-unread' : 'mc-notif-unread');
    const o = raw ? JSON.parse(raw) : null;
    return o && o.n > 0 ? o.n : 0;
  } catch (e) { return 0; }
}
function badgeText(n: number) { return n > 99 ? '99+' : String(n); }

function readKey() {
  try { return localStorage.getItem('mc-comment-key') || ''; } catch (e) { return ''; }
}
/* Admin status, bridged from the comments client (loadMyProfile writes the flag)
   so the platform chrome can surface admin-only entries without its own fetch. */
function isAdmin() {
  try { return localStorage.getItem('mc-admin') === '1'; } catch (e) { return false; }
}

/* The standard VAPID applicationServerKey decoder: base64url string -> Uint8Array
   (pushManager.subscribe needs raw bytes, not the string). */
function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}
function sameBytes(a: Uint8Array | null, b: Uint8Array | null) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

/* ---- key backup + device linking helpers (the key-loss cliff work) ---- */

/* Save the identity key as a small text file the reader can file away. */
function downloadKeyFile(key: string) {
  try {
    const body = 'Your merecatholicity.com identity key. Keep this file private.\n' +
      'Paste the key into "I already have a key" on any device to sign in.\n\n' + key + '\n';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([body], { type: 'text/plain' }));
    a.download = 'merecatholicity-key.txt';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { try { URL.revokeObjectURL(a.href); } catch (e) { /* gone */ } a.remove(); }, 2000);
  } catch (e) { /* blocked: the copy button still stands */ }
}

/* The vendored QR encoder (docs/qr.min.js, qrcode-generator 1.4.4, MIT),
   lazy-injected same-origin like tweetnacl so script-src 'self' holds. */
declare global { interface Window { qrcode?: any } }
let qrLoading: Promise<any> | null = null;
function ensureQr(): Promise<any> {
  if (window.qrcode) return Promise.resolve(window.qrcode);
  if (qrLoading) return qrLoading;
  qrLoading = new Promise(function (resolve, reject) {
    const s = document.createElement('script');
    s.src = 'qr.min.js';
    s.onload = function () { window.qrcode ? resolve(window.qrcode) : reject(new Error('no qrcode')); };
    s.onerror = function () { qrLoading = null; reject(new Error('qr load failed')); };
    document.head.appendChild(s);
  });
  return qrLoading;
}

/* Render text as a QR into an SVG built node-by-node (no innerHTML, CSP-clean,
   theme-safe: dark cells use currentColor on a white tile). */
function qrSvg(text: string): SVGSVGElement | null {
  try {
    const qr = window.qrcode!(0, 'M');
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '-2 -2 ' + (n + 4) + ' ' + (n + 4));
    svg.setAttribute('shape-rendering', 'crispEdges');
    const bg = document.createElementNS(NS, 'rect');
    bg.setAttribute('x', '-2'); bg.setAttribute('y', '-2');
    bg.setAttribute('width', String(n + 4)); bg.setAttribute('height', String(n + 4));
    bg.setAttribute('fill', '#fff');
    svg.appendChild(bg);
    let d = '';
    for (let r = 0; r < n; r += 1) {
      for (let c = 0; c < n; c += 1) {
        if (qr.isDark(r, c)) d += 'M' + c + ' ' + r + 'h1v1h-1z';
      }
    }
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', '#111');
    svg.appendChild(path);
    return svg;
  } catch (e) { return null; }
}

/* ---- the bottom tab bar ---- */
class McTabbar extends LitElement {
  static properties = { active: { attribute: false }, dm: { attribute: false } };
  declare active: string;
  declare dm: number;
  constructor() { super(); this.active = 'home'; this.dm = 0; }
  createRenderRoot() { return this; }
  sync() { this.active = activeTab(); this.dm = badgeCount('dm'); }
  render() {
    return html`<nav class="mc-tabbar" aria-label="Primary">
      ${TABS.map((t) => html`
        <a class=${'mc-tab' + (t.hero ? ' mc-tab-hero' : '') + (this.active === t.key ? ' mc-tab-on' : '')}
           href=${t.href} aria-label=${t.label} aria-current=${this.active === t.key ? 'page' : 'false'}>
          <span class="mc-tab-ico">${t.icon ? t.icon : ICON[t.svg!]}${t.badge === 'dm' && this.dm
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
  declare canBack: boolean;
  declare notif: number;
  constructor() { super(); this.canBack = false; this.notif = 0; this.title = ''; }
  createRenderRoot() { return this; }
  sync() {
    this.canBack = history.length > 1;   // dim < at the very start of history
    this.notif = badgeCount('notif');
    this.title = pageTitle();             // the current page/view title, shown centered
  }
  goBack(e: Event) { e.preventDefault(); if (history.length > 1) history.back(); else { location.href = 'index.html'; } }
  goFwd(e: Event) { e.preventDefault(); history.forward(); }
  settings(e: Event) { e.preventDefault(); if (window.mcSheet) window.mcSheet.settings!(); }
  notifs(e: Event) { e.preventDefault(); if (window.mcSheet) window.mcSheet.open('', document.createElement('mc-notifs')); }
  render() {
    return html`<header class="mc-appbar">
      <div class="mc-appbar-side mc-appbar-l">
        <button class=${'mc-ab-btn' + (this.canBack ? '' : ' mc-ab-dim')} @click=${(e: Event) => this.goBack(e)} aria-label="Back">${ICON.back}</button>
      </div>
      <div class="mc-appbar-title" title=${this.title}>${this.title}</div>
      <div class="mc-appbar-side mc-appbar-r">
        ${onCommunity() ? html`<a class="mc-ab-btn" href="community.html?q=" aria-label="Search">${ICON.search}</a>` : ''}
        <button class="mc-ab-btn mc-ab-bell" @click=${(e: Event) => this.notifs(e)} aria-label="Notifications">${ICON.bell}${this.notif
          ? html`<span class="mc-tab-badge">${badgeText(this.notif)}</span>` : ''}</button>
        <button class="mc-ab-btn" @click=${(e: Event) => this.settings(e)} aria-label="Settings">${ICON.gear}</button>
        <button class="mc-ab-btn" @click=${(e: Event) => this.goFwd(e)} aria-label="Forward">${ICON.forward}</button>
      </div>
    </header>`;
  }
}
customElements.define('mc-appbar', McAppbar);

/* ---- the reusable slide-up sheet (the app-dialog primitive) ---- */
class McSheet extends LitElement {
  static properties = { open: { attribute: false }, heading: { attribute: false } };
  declare open: boolean;
  declare heading: string;
  declare _node: Node | null;
  declare _onClose: (() => void) | null;
  declare _drag: { sheet: HTMLElement; y0: number; y: number; t: number; dy: number; vy: number; active: boolean } | null;
  declare _pm: ((ev: PointerEvent) => void) | null;
  declare _pu: ((ev: PointerEvent) => void) | null;
  declare _onKey: ((e: KeyboardEvent) => void) | null;
  declare _restoreFocus: HTMLElement | null;
  constructor() { super(); this.open = false; this.heading = ''; this._node = null; this._onClose = null; this._onKey = null; this._restoreFocus = null; }
  createRenderRoot() { return this; }
  connectedCallback() {
    super.connectedCallback();
    /* Escape closes the dialog and Tab is trapped inside it while open — with
       role=dialog/aria-modal set, a modal MUST offer a keyboard exit and keep
       focus within, or it is a broken-dialog a11y failure. */
    this._onKey = (e: KeyboardEvent) => {
      if (!this.open) return;
      if (e.key === 'Escape') { e.preventDefault(); this.close(); return; }
      if (e.key === 'Tab') this._trapTab(e);
    };
    document.addEventListener('keydown', this._onKey, true);
  }
  disconnectedCallback() {
    if (this._onKey) document.removeEventListener('keydown', this._onKey, true);
    this._onKey = null;
    super.disconnectedCallback();
  }
  _focusables(): HTMLElement[] {
    const sheet = this.querySelector('.mc-sheet');
    if (!sheet) return [];
    return Array.from(sheet.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter(el => el.offsetParent !== null || el === document.activeElement);
  }
  _trapTab(e: KeyboardEvent) {
    const items = this._focusables();
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (e.shiftKey && (active === first || !this.contains(active))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
  }
  show(heading?: string | null, node?: Node | null, onClose?: (() => void) | null) {
    if (!this.open) this._restoreFocus = document.activeElement as HTMLElement | null;
    this.heading = heading || ''; this._node = node || null; this._onClose = onClose || null; this.open = true;
  }
  close() {
    if (!this.open) return;
    this.open = false;
    const restore = this._restoreFocus; this._restoreFocus = null;
    const cb = this._onClose; this._onClose = null;
    if (cb) { try { cb(); } catch (e) { /* caller's problem */ } }
    /* Return focus to whatever opened the dialog (the a11y contract). */
    if (restore && typeof restore.focus === 'function' && document.contains(restore)) { try { restore.focus(); } catch (e) { /* gone */ } }
  }
  updated(changed: Map<string, unknown>) {
    /* The body host is a static template node, so Lit keeps whatever we append
       into it across re-renders (the McInbox dm-search idiom). Swap on new node. */
    const body = this.querySelector('.mc-sheet-body');
    if (body && this._node && body.firstChild !== this._node) { body.textContent = ''; body.appendChild(this._node); }
    /* On open, move focus into the dialog so keyboard/AT users land inside it. */
    if (changed.has('open') && this.open) {
      const items = this._focusables();
      const target = items[0] || this.querySelector<HTMLElement>('.mc-sheet');
      if (target) { try { target.focus(); } catch (e) { /* not focusable yet */ } }
    }
  }
  /* Swipe-down-to-dismiss. A downward drag that starts at the top of the sheet
     (so it never fights content scrolling) drags the panel with the finger; a far
     enough pull or a quick flick lets it go, otherwise it snaps back. Tapping the
     scrim or the grip still closes it as before. */
  dragStart(e: PointerEvent) {
    if (!isMobile()) return;                             // desktop is a centered modal — no drag
    const sheet = e.currentTarget as HTMLElement;
    if (sheet.scrollTop > 0) return;                     // let the content scroll
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    this._drag = { sheet, y0: e.clientY, y: e.clientY, t: e.timeStamp || 0, dy: 0, vy: 0, active: false };
    this._pm = (ev) => this.dragMove(ev);
    this._pu = (ev) => this.dragEnd(ev);
    document.addEventListener('pointermove', this._pm, { passive: false });
    document.addEventListener('pointerup', this._pu);
    document.addEventListener('pointercancel', this._pu);
  }
  dragMove(e: PointerEvent) {
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
  dragEnd(_ev?: PointerEvent) {
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
      <section class=${'mc-sheet' + (this.open ? ' on' : '')} role="dialog" aria-modal="true" tabindex="-1"
        aria-label=${this.heading || 'Sheet'}
        @pointerdown=${(e: PointerEvent) => this.dragStart(e)}>
        <button class="mc-sheet-grip" @click=${() => this.close()} aria-label="Close"></button>
        <button class="mc-sheet-close" @click=${() => this.close()} aria-label="Close" type="button">×</button>
        ${this.heading ? html`<h2 class="mc-sheet-head">${this.heading}</h2>` : ''}
        <div class="mc-sheet-body"></div>
      </section>`;
  }
}
customElements.define('mc-sheet', McSheet);

/* ---- the settings sheet content (relocated identity/account line) ---- */
class McSettings extends LitElement {
  static properties = { keyShown: { attribute: false }, theme: { attribute: false }, art: { attribute: false }, copied: { attribute: false }, dark: { attribute: false }, light: { attribute: false }, presence: { attribute: false }, sounds: { attribute: false }, prefs: { attribute: false }, panel: { attribute: false }, blocked: { attribute: false }, canInstall: { attribute: false }, pushOn: { attribute: false }, pushBusy: { attribute: false }, pushMsg: { attribute: false } };
  declare keyShown: boolean;
  declare theme: string;
  declare art: boolean;
  declare copied: boolean;
  declare dark: string;
  declare light: string;
  declare presence: string;
  declare sounds: boolean;
  declare prefs: any;
  declare panel: string;
  declare blocked: Array<{ hash: string; nick?: string; assigned?: string }> | null;
    declare canInstall: boolean;
  declare pushOn: boolean | null;
  declare pushBusy: boolean;
  declare pushMsg: string;
  declare _onInstall: () => void;
  constructor() {
    super();
    this.keyShown = false; this.theme = this._theme(); this.art = artOn(); this.copied = false;
    this.dark = (window.mcGetDark && window.mcGetDark()) || 'charcoal';
    this.light = (window.mcGetLight && window.mcGetLight()) || 'paper'; this.presence = this._presence(); this.sounds = this._sounds();
    this.prefs = window.mcPrefs || null; this.panel = ''; this.blocked = null;
    this.canInstall = !!(window.mcInstall && window.mcInstall.evt);
    this.pushOn = null; this.pushBusy = false; this.pushMsg = '';   // null = state not yet reflected
    this._onInstall = () => { this.canInstall = !!(window.mcInstall && window.mcInstall.evt); };
  }
  createRenderRoot() { return this; }
  connectedCallback() { super.connectedCallback(); document.addEventListener('mc-install-available', this._onInstall); this._loadPrefs(); this._reflectPush(); }
  disconnectedCallback() { super.disconnectedCallback(); document.removeEventListener('mc-install-available', this._onInstall); }
  _api() { return '/api/comments'; }
  _loadPrefs() {
    const k = readKey(); if (!k) return;
    fetch(this._api() + '/prefs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: k }) })
      .then((r) => r.json()).then((d) => { if (d && d.ok) { this.prefs = d.prefs; window.mcPrefs = d.prefs; } }).catch(() => { /* keep defaults */ });
  }
  _setPref(patch: Record<string, unknown>) {
    const k = readKey(); if (!k) return;
    this.prefs = Object.assign({ receipts: 'auto', notify_reply: 1, notify_mention: 1, notify_dm: 1 }, this.prefs, patch);
    window.mcPrefs = this.prefs;
    fetch(this._api() + '/prefs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: k, set: patch }) }).catch(() => { /* best effort */ });
  }
  _notifyOn(kind: string) { return !this.prefs || this.prefs['notify_' + kind] !== 0; }
  _callsOn() { return !this.prefs || this.prefs.calls !== 0; }
  _receiptsOn() { return !(this.prefs && this.prefs.receipts === 'off'); }
  _openPanel(which: string) {
    this.panel = this.panel === which ? '' : which;
    if (this.panel === 'blocked' && this.blocked == null) this._loadBlocked();
  }
  /* ONE Blocked list since the 2026-08-03 block unification: the server's
     dm_blocks roster unioned with the local hide-list (mc-muted — block's
     other half, and where any pre-unification "mutes" still live), so every
     blocked member appears here whichever half recorded them. */
  _loadBlocked() {
    let local: string[] = [];
    try { local = (JSON.parse(localStorage.getItem('mc-muted') as string) || []).filter(Boolean); } catch (e) { local = []; }
    const dn = (h: string) => (window.mcCore ? window.mcCore.displayName(h) : String(h).slice(0, 8));
    const merge = (server: Array<{ hash: string; nick?: string; assigned?: string }>) => {
      const seen: Record<string, boolean> = {};
      const out: Array<{ hash: string; nick?: string; assigned?: string }> = [];
      server.concat(local.map((h) => ({ hash: h, assigned: dn(h) }))).forEach((b) => {
        if (!b.hash || seen[b.hash]) return;
        seen[b.hash] = true; out.push(b);
      });
      return out;
    };
    const k = readKey(); if (!k) { this.blocked = merge([]); return; }
    fetch(this._api() + '/dm/blocked', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: k }) })
      .then((r) => r.json()).then((d) => { this.blocked = merge((d && d.ok) ? d.blocked : []); }).catch(() => { this.blocked = merge([]); });
  }
  /* Unblock undoes BOTH halves: the DM shadow-block and the hide-list (with
     its /prefs write-through, so a second device unhides too). */
  _unblock(hash: string) {
    this.blocked = (this.blocked || []).filter((b) => b.hash !== hash);
    let list: string[] = [];
    try { list = JSON.parse(localStorage.getItem('mc-muted') as string) || []; } catch (e) { list = []; }
    list = list.filter((h) => h !== hash);
    try { localStorage.setItem('mc-muted', JSON.stringify(list)); } catch (e) { /* hide-list is best effort */ }
    const k = readKey(); if (!k) return;
    fetch(this._api() + '/dm/block', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: k, hash, blocked: false }) }).catch(() => { /* best effort */ });
    fetch(this._api() + '/prefs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: k, set: { muted: list.slice(0, 200) } }) }).catch(() => { /* best effort */ });
  }
  _install() { if (window.mcInstall) window.mcInstall.prompt(); this.canInstall = false; }

  /* ---- Add-to-Home-Screen + native push (Web Push / VAPID) ---- */
  _isStandalone() {
    try {
      return (matchMedia && matchMedia('(display-mode: standalone)').matches) || (navigator as any).standalone === true;
    } catch (e) { return false; }
  }
  _isIOS() {
    const ua = navigator.userAgent || '';
    // iPadOS 13+ reports as MacIntel; the touch-point count distinguishes it.
    return /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }
  /* Which browser we're in, precisely enough to give the RIGHT install steps.
     On iOS this matters more than anywhere: only Safari can install a real,
     push-capable web app — Chrome/Firefox/Edge/Opera there run on WebKit and
     produce only a bookmark (no notifications, an Apple limitation). Brave on
     iOS masquerades as Safari in its UA and is not separable, so it falls into
     'ios-safari' and its note carries the "if that doesn't work, use Safari"
     caveat. */
  _browser() {
    const ua = navigator.userAgent || '';
    if (this._isIOS()) {
      if (/CriOS/.test(ua)) return 'ios-chrome';
      if (/FxiOS/.test(ua)) return 'ios-firefox';
      if (/EdgiOS/.test(ua)) return 'ios-edge';
      if (/OPiOS|OPT\//.test(ua)) return 'ios-opera';
      return 'ios-safari';
    }
    if (/Firefox\//.test(ua)) return 'firefox';
    if (/Edg\//.test(ua)) return 'edge';
    if (/OPR\//.test(ua)) return 'opera';
    if (/Safari\//.test(ua) && !/Chrome|Chromium|CriOS/.test(ua)) return 'safari';   // desktop Safari
    if (/Chrome|Chromium/.test(ua)) return 'chrome';
    return 'other';
  }
  _pushSupported() {
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  }
  /* Reflect the current subscription so the toggle opens showing the truth. It
     reflects ON only for the identity that actually enabled push on THIS device
     (tracked in mc-push-owner), so a leftover subscription is never silently
     adopted by whoever logs in next. When it does own the subscription it also
     self-heals a VAPID key rotation (re-subscribe with the new key) and refreshes
     the server token binding. */
  async _reflectPush() {
    if (!this._pushSupported() || (this._isIOS() && !this._isStandalone())) { this.pushOn = false; return; }
    try {
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      const key = readKey();
      let owner = '';
      try { owner = localStorage.getItem('mc-push-owner') || ''; } catch (e) { owner = ''; }
      // Not this identity's subscription (or none, or permission revoked): show
      // OFF and touch nothing — never re-register someone else's device to this key.
      if (!sub || Notification.permission !== 'granted' || !key || owner !== key) {
        this.pushOn = !!(sub && Notification.permission === 'granted' && key && owner === key);
        return;
      }
      // Self-heal a VAPID key rotation: the old subscription's pushes would be
      // rejected (403, never pruned server-side), so re-subscribe with the new key.
      try {
        const kr = await fetch(this._api() + '/push/vapid-key').then((r) => r.json()).catch(() => null);
        if (kr && kr.ok && kr.key) {
          const want = urlBase64ToUint8Array(kr.key);
          const have = (sub.options && sub.options.applicationServerKey) ? new Uint8Array(sub.options.applicationServerKey) : null;
          if (have && !sameBytes(have, want)) {
            const oldToken = JSON.stringify(sub.toJSON());
            try { await sub.unsubscribe(); } catch (e) { /* ignore */ }
            fetch(this._api() + '/push/unregister', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ key, token: oldToken }),
            }).catch(() => { /* drop the stale binding */ });
            sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: want });
          }
        }
      } catch (e) { /* rotation re-subscribe failed — fall through and re-check */ }
      // Confirm a live subscription still exists (a failed rotation may have torn
      // the old one down) before claiming ON and registering its token.
      const live = await reg.pushManager.getSubscription().catch(() => null);
      if (!live) { this.pushOn = false; return; }
      this.pushOn = true;
      fetch(this._api() + '/push/register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, platform: 'web', token: JSON.stringify(live.toJSON()) }),
      }).catch(() => { /* best-effort refresh */ });
    } catch (e) { this.pushOn = false; }
  }
  async _togglePush() {
    if (this.pushBusy) return;
    const key = readKey();
    if (!key) { this.pushMsg = 'Create an identity first, then turn on notifications.'; return; }
    this.pushBusy = true; this.pushMsg = '';
    try {
      if (this.pushOn) await this._disablePush(key);
      else await this._enablePush(key);
    } catch (e) {
      this.pushMsg = 'Something went wrong. Try again.'; this.pushOn = false;
    } finally {
      this.pushBusy = false;
    }
  }
  async _enablePush(key: string) {
    // 1) permission — this runs from the toggle tap, so it is a valid user gesture
    let perm = Notification.permission;
    if (perm === 'default') perm = await Notification.requestPermission();
    if (perm === 'denied') { this.pushMsg = 'Notifications are blocked — turn them on in your browser or site settings.'; this.pushOn = false; return; }
    if (perm !== 'granted') { this.pushOn = false; return; }
    // 2) the active service worker
    const reg = await navigator.serviceWorker.ready;
    // 3) the server's VAPID public key
    const kr = await fetch(this._api() + '/push/vapid-key').then((r) => r.json()).catch(() => null);
    if (!kr || !kr.ok || !kr.key) { this.pushMsg = "Couldn't reach the notification service. Try again."; this.pushOn = false; return; }
    const appKey = urlBase64ToUint8Array(kr.key);
    // 4) subscribe (idempotent for the same key; replace a stale different-key sub)
    let sub;
    try {
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: appKey });
    } catch (e) {
      const old = await reg.pushManager.getSubscription();
      if (old) { try { await old.unsubscribe(); } catch (e2) { /* ignore */ } }
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: appKey });
    }
    const token = JSON.stringify(sub.toJSON());
    // If a DIFFERENT identity previously enabled push on this device, drop its
    // binding first, so one browser is never registered to two identities at once.
    let prevOwner = '';
    try { prevOwner = localStorage.getItem('mc-push-owner') || ''; } catch (e) { prevOwner = ''; }
    if (prevOwner && prevOwner !== key) {
      fetch(this._api() + '/push/unregister', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: prevOwner, token }),
      }).catch(() => { /* best-effort */ });
    }
    // 5) register the token to this identity
    const res = await fetch(this._api() + '/push/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, platform: 'web', token }),
    }).then((r) => r.json()).catch(() => null);
    if (!res || !res.ok) { this.pushMsg = "Couldn't register for notifications. Try again."; this.pushOn = false; return; }
    try { localStorage.setItem('mc-push-owner', key); } catch (e) { /* blocked */ }
    this.pushMsg = ''; this.pushOn = true;
  }
  async _disablePush(key: string) {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      const token = JSON.stringify(sub.toJSON());
      try { await sub.unsubscribe(); } catch (e) { /* keep going — still unregister */ }
      fetch(this._api() + '/push/unregister', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, token }),
      }).catch(() => { /* best-effort */ });
    }
    try { localStorage.removeItem('mc-push-owner'); } catch (e) { /* blocked */ }
    this.pushMsg = ''; this.pushOn = false;
  }

  /* Fill the QR box once the panel is open: the QR encodes a sign-in link
     (profile.html#key=…) the phone camera opens; the fragment never reaches
     the server and the client strips it on arrival. */
  updated() {
    const box = this.querySelector('.mc-set-qrbox');
    if (!box || box.firstChild) return;
    const k = readKey();
    if (!k) return;
    ensureQr().then(() => {
      if (box.firstChild) return;
      const svg = qrSvg(location.origin + '/profile.html#key=' + encodeURIComponent(k));
      if (svg) { svg.style.width = '100%'; svg.style.height = 'auto'; box.appendChild(svg); }
    }).catch(() => { /* no QR: the copy and download paths still stand */ });
  }
  _presence() { try { return localStorage.getItem('mc-presence') === 'off' ? 'off' : 'auto'; } catch (e) { return 'auto'; } }
  /* UI sounds (bell + call ring/hang-up, played by comments.js): a per-device
     switch — 'off' in localStorage silences them, anything else is on. */
  _sounds() { try { return localStorage.getItem('mc-sounds') !== 'off'; } catch (e) { return true; } }
  toggleSounds() {
    const on = !this.sounds;
    try { localStorage.setItem('mc-sounds', on ? 'on' : 'off'); } catch (e) { /* blocked */ }
    this.sounds = on;
  }
  togglePresence() {
    const n = this.presence === 'off' ? 'auto' : 'off';
    try { localStorage.setItem('mc-presence', n); } catch (e) { /* blocked */ }
    if (window.mcLive && window.mcLive.member && window.mcLive.member.setPresence) window.mcLive.member.setPresence(n);
    this.presence = n;
  }
  _theme() { return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'; }
  toggleArt() {
    const off = this.art;   // currently on → turning off
    try { localStorage.setItem('mc-art', off ? '0' : '1'); } catch (e) { /* blocked */ }
    applyArt();
    this.art = artOn();
  }
  toggleTheme() {
    const n = this.theme === 'dark' ? 'light' : 'dark';
    try { document.cookie = 'mc-theme=' + n + ';path=/;max-age=31536000;samesite=lax'; } catch (e) { /* blocked */ }
    /* Route through the nav.js engine: it applies data-theme AND the palette
       variants (data-dark/data-light, both directions) AND clears the mc-fout
       gate's inline <html> pre-paint — which inline-shadows the stylesheet and
       once left the page background stuck in the old theme until a hard
       refresh. The fallback (a cached pre-engine nav.js, ~10 min TTL) does the
       same by hand. */
    if ((window as any).mcApplyTheme) (window as any).mcApplyTheme();
    else {
      const e = document.documentElement;
      e.style.background = '';
      e.setAttribute('data-theme', n);
      if (n === 'dark' && (this.dark === 'slate' || this.dark === 'ink')) e.setAttribute('data-dark', this.dark);
      else e.removeAttribute('data-dark');
      if (n === 'light' && (this.light === 'mist' || this.light === 'sepia')) e.setAttribute('data-light', this.light);
      else e.removeAttribute('data-light');
    }
    this.theme = n;
  }
  setDark(p: string) { if (window.mcSetDark) window.mcSetDark(p); this.dark = p; }
  setLight(p: string) { if (window.mcSetLight) window.mcSetLight(p); this.light = p; }
  copyKey() {
    const k = readKey();
    if (!k) return;
    try {
      if (navigator.clipboard) { navigator.clipboard.writeText(k); this.copied = true; setTimeout(() => { this.copied = false; }, 1500); }
    } catch (e) { /* no clipboard */ }
  }
  logout() {
    mcConfirm('Log out of this identity? Keep your key saved so you can log back in.',
      { okLabel: 'Log out', danger: true }).then(async (ok) => {
      if (!ok) return;
      // Tear down this device's push subscription FIRST (while the key is still
      // present), so a logged-out or handed-off browser stops receiving this
      // identity's OS notifications and the server token row is removed. Best
      // effort — logout must never hang on it.
      const key = readKey();
      if (key && this._pushSupported()) { try { await this._disablePush(key); } catch (e) { /* ignore */ } }
      try {
        localStorage.removeItem('mc-comment-key');
        localStorage.removeItem('mc-dm-unread');
        localStorage.removeItem('mc-notif-unread');
        localStorage.removeItem('mc-admin');
      } catch (e) { /* blocked */ }
      location.href = 'index.html';
    });
  }
  _switch(label: string, note: any, on: boolean, onClick: (e?: Event) => any) {
    return html`<button class="mc-set-row mc-set-btn" @click=${onClick}>
      <span>${label}${note ? html`<small>${note}</small>` : ''}</span>
      <span class=${'mc-set-switch' + (on ? ' on' : '')}><span class="mc-set-knob"></span></span></button>`;
  }
  _managedList(which: string, label: string, count: number | null, rows: Array<{ name: string; hash: string }> | null, action: (hash: string) => void, actionLabel: string) {
    const open = this.panel === which;
    return html`
      <button class="mc-set-row mc-set-btn" @click=${() => this._openPanel(which)}>
        <span>${label}${count != null ? html`<small>${count === 0 ? 'None' : (count + (count === 1 ? ' member' : ' members'))}</small>` : ''}</span>
        <span class="mc-set-go">${open ? '▾' : '›'}</span></button>
      ${open ? html`<div class="mc-set-key" style="flex-direction:column;gap:0.35rem;align-items:stretch">
        ${rows == null ? html`<p style="opacity:0.6;margin:0.2rem 0">Loading…</p>`
        : (rows.length ? rows.map((r) => html`
          <div style="display:flex;align-items:center;justify-content:space-between;gap:0.5rem">
            <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.name}</span>
            <button class="btn" style="padding:0.15rem 0.6rem;font-size:0.85em" @click=${() => action(r.hash)}>${actionLabel}</button>
          </div>`) : html`<p style="opacity:0.6;margin:0.2rem 0">Nobody here.</p>`)}
      </div>` : ''}`;
  }
  /* Install the app — a real affordance for EVERY platform, from the gear.
     Android / desktop Chrome & Edge fire beforeinstallprompt, so they get the
     one-tap native button. Everyone else (iOS Safari, iOS non-Safari, desktop
     Safari, Firefox, and the long tail) gets the exact, browser-correct steps
     — no dead "open it somewhere else" hand-wave. Hidden once installed. */
  _homeScreenSection() {
    const noteStyle = 'padding:0.5rem 0.95rem 0.7rem;font-size:0.92em;opacity:0.85;line-height:1.55';
    if (this._isStandalone()) {
      return html`<h3 class="mc-set-sec">App</h3>
        <div class="mc-set-note" style=${noteStyle}>Installed ✓ — you're using merecatholicity as an app.</div>`;
    }
    const heading = html`<h3 class="mc-set-sec">Install the app</h3>`;
    // The one-tap path: the browser handed us a real install prompt.
    if (this.canInstall) {
      return html`${heading}
        <button class="mc-set-row mc-set-btn" @click=${() => this._install()}>
          <span>Install this app<small>Adds merecatholicity to your home screen</small></span>
          <span class="mc-set-go">›</span></button>`;
    }
    const share = html`<span aria-hidden="true" style="display:inline-block;transform:translateY(2px)">⎋</span>`;
    let steps;
    switch (this._browser()) {
      case 'ios-safari':
        steps = html`Tap the Share button ${share} in Safari's toolbar, then choose
          <strong>Add to Home Screen</strong>. Open merecatholicity from its new icon — that's what unlocks
          notifications on iPhone and iPad. <em>Using Brave, Chrome or another browser? Open the site in
          <strong>Safari</strong> first — only Safari can install it with notifications.</em>`;
        break;
      case 'ios-chrome': case 'ios-firefox': case 'ios-edge': case 'ios-opera':
        steps = html`On iPhone and iPad the app installs from <strong>Safari</strong>. Open
          <strong>merecatholicity.com in Safari</strong>, tap Share ${share} → <strong>Add to Home Screen</strong>,
          then open it from its icon. (Chrome, Brave, Firefox and Edge on iOS can't install web apps or
          receive notifications — that's an Apple limitation, not ours.)`;
        break;
      case 'safari':
        steps = html`In Safari, open the <strong>File</strong> menu → <strong>Add to Dock</strong>
          (or the Share button ${share} → <strong>Add to Dock</strong>). merecatholicity then opens in its
          own window like an app.`;
        break;
      case 'firefox':
        steps = html`Firefox on the desktop doesn't support installing web apps. To install merecatholicity,
          open it in <strong>Chrome</strong>, <strong>Edge</strong>, or <strong>Safari</strong> and use their
          install option.`;
        break;
      default:
        steps = html`Look for <strong>Install merecatholicity</strong> in your browser's menu, or the install
          icon in the address bar. On a phone, use <strong>Add to Home Screen</strong>.`;
    }
    return html`${heading}<div class="mc-set-note" style=${noteStyle}>${steps}</div>`;
  }
  /* The push toggle, guarded: unsupported browsers and iOS-not-installed get a
     note instead of a dead switch. */
  _pushRow() {
    const noteStyle = 'padding:0.5rem 0.95rem 0.7rem;font-size:0.92em;opacity:0.8;line-height:1.5';
    if (!this._pushSupported()) {
      return html`<div class="mc-set-note" style=${noteStyle}>Your browser doesn't support push notifications.</div>`;
    }
    if (this._isIOS() && !this._isStandalone()) {
      return html`<div class="mc-set-note" style=${noteStyle}>Notifications on iPhone and iPad work only from the
        installed app. Use <strong>Install the app</strong> above (in <strong>Safari</strong>) to add it to your
        home screen, then open merecatholicity from its icon and come back here to turn them on.</div>`;
    }
    const note = this.pushBusy ? 'Working…'
      : (this.pushMsg || (this.pushOn ? 'On — notified even with the site closed' : 'Off — get notified even with the site closed'));
    return this._switch('Push notifications', note, !!this.pushOn, () => this._togglePush());
  }
  render() {
    const k = readKey();
    const link = (href: string, label: string, note?: any) => html`<a class="mc-set-row" href=${href}>
      <span>${label}${note ? html`<small>${note}</small>` : ''}</span><span class="mc-set-go">›</span></a>`;
    const blockedRows = this.blocked == null ? null : this.blocked.map((b) => ({ hash: b.hash, name: b.nick || b.assigned || (b.hash || '').slice(0, 8) }));
    return html`<div class="mc-settings">
      <h3 class="mc-set-sec">Account</h3>
      ${k ? html`
        ${link('profile.html', 'My profile', 'Edit your name, faith, avatar')}
        ${link('community.html?saved=1', 'Saved posts', 'Topics and feed posts you saved')}
        <button class="mc-set-row mc-set-btn" @click=${() => { this.keyShown = !this.keyShown; }}>
          <span>Show my key<small>Your one login secret — save it somewhere safe</small></span><span class="mc-set-go">${this.keyShown ? '▾' : '›'}</span></button>
        ${this.keyShown ? html`<div class="mc-set-key">
          <input class="mc-set-keyin" readonly .value=${k} @focus=${(e: Event) => (e.target as HTMLInputElement).select()}>
          <button class="btn btn-send mc-set-copy" @click=${() => this.copyKey()}>${this.copied ? 'Copied' : 'Copy'}</button>
        </div>
        <div class="mc-set-key" style="flex-direction:column;gap:0.5rem;align-items:stretch">
          <button class="btn" style="align-self:flex-start" @click=${() => downloadKeyFile(k)}>Download key file</button>
          <div class="mc-set-qrbox" style="max-width:220px"></div>
          <p style="margin:0;font-size:0.85em;opacity:0.75">Scan with your phone camera to sign in there.
            Anyone who scans this owns the identity, so show it to no one else.</p>
        </div>` : ''}
        <button class="mc-set-row mc-set-btn mc-set-danger" @click=${() => this.logout()}>
          <span>Log out</span><span class="mc-set-go">›</span></button>
      ` : html`
        <button class="mc-set-row mc-set-btn" @click=${() => window.mcOnboard && window.mcOnboard()}>
          <span>Create an identity<small>One tap, no signup</small></span><span class="mc-set-go">›</span></button>
      `}

      <h3 class="mc-set-sec">Appearance</h3>
      ${this._switch('Theme', this.theme === 'dark' ? 'Dark' : 'Light', this.theme === 'dark', () => this.toggleTheme())}
      ${this.theme === 'dark' ? html`<div class="mc-set-palette">
        ${[['charcoal', 'Charcoal'], ['slate', 'Slate'], ['ink', 'Warm ink']].map((p) => html`
          <button class=${'mc-set-pal mc-pal-' + p[0] + (this.dark === p[0] ? ' on' : '')} @click=${() => this.setDark(p[0])} aria-label=${p[1]}>
            <span class="mc-pal-sw"></span><span class="mc-pal-name">${p[1]}</span></button>`)}
      </div>` : html`<div class="mc-set-palette">
        ${[['paper', 'Paper'], ['mist', 'Mist'], ['sepia', 'Sepia']].map((p) => html`
          <button class=${'mc-set-pal mc-pal-' + p[0] + (this.light === p[0] ? ' on' : '')} @click=${() => this.setLight(p[0])} aria-label=${p[1]}>
            <span class="mc-pal-sw"></span><span class="mc-pal-name">${p[1]}</span></button>`)}
      </div>`}
      ${this._switch('Background images', 'Sacred-art page accents', this.art, () => this.toggleArt())}

      ${this._homeScreenSection()}

      ${k ? html`
        <h3 class="mc-set-sec">Privacy &amp; safety</h3>
        ${this._switch("Show when I'm online", this.presence === 'off' ? 'Appear offline' : 'Automatic', this.presence !== 'off', () => this.togglePresence())}
        ${this._switch('Read receipts', this._receiptsOn() ? 'On' : 'Off — you send none and see none', this._receiptsOn(), () => this._setPref({ receipts: this._receiptsOn() ? 'off' : 'auto' }))}
        ${this._switch('Voice calls', this._callsOn() ? 'Members can call you' : 'Off — callers just hear ringing, like no answer', this._callsOn(), () => this._setPref({ calls: this._callsOn() ? 0 : 1 }))}
        ${this._managedList('blocked', 'Blocked members', blockedRows ? blockedRows.length : null, blockedRows, (h) => this._unblock(h), 'Unblock')}
        <div class="mc-set-note" style="padding:0 0.95rem 0.4rem;font-size:0.85em;opacity:0.7">A blocked member cannot message you, their posts are hidden from your feed and community, and their profile is closed to you. They are never told.</div>

        <h3 class="mc-set-sec">Notifications</h3>
        ${this._switch('Replies', null, this._notifyOn('reply'), () => this._setPref({ notify_reply: this._notifyOn('reply') ? 0 : 1 }))}
        ${this._switch('Mentions', null, this._notifyOn('mention'), () => this._setPref({ notify_mention: this._notifyOn('mention') ? 0 : 1 }))}
        ${this._switch('Direct messages', 'The bell only — messages still arrive', this._notifyOn('dm'), () => this._setPref({ notify_dm: this._notifyOn('dm') ? 0 : 1 }))}
        ${this._switch('Sound effects', 'Bell and call sounds on this device', this.sounds, () => this.toggleSounds())}
        ${this._pushRow()}
      ` : ''}

      ${isAdmin() ? html`<h3 class="mc-set-sec">Administration</h3>
      ${link('admin.html', 'Administrative options', 'Moderation, platform settings, audit')}` : ''}
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
  declare items: any[] | null;
  declare state: string;
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
    const wrap = (inner: unknown) => html`<div class="mc-notifs"><h3 class="mc-set-sec">Notifications</h3>${inner}</div>`;
    if (this.state === 'gate') return wrap(html`<p class="mc-notifs-empty">Notifications need an identity — create one from the board.</p>`);
    if (this.state === 'err') return wrap(html`<p class="mc-notifs-empty">Could not load notifications. Check your connection.</p>`);
    if (this.state === 'load') return wrap(html`<p class="mc-notifs-empty">Loading…</p>`);
    if (!this.items!.length) return wrap(html`<p class="mc-notifs-empty" data-ico="🔔">No notifications yet. Post in a thread to follow it; you will hear when someone replies or names you.</p>`);
    const name = (it: any) => it.actor_nick || (it.actor_hash && window.mcCore ? window.mcCore.displayName(it.actor_hash) : 'Someone');
    return wrap(html`${this.items!.map((it: any) => {
      const isDm = it.kind === 'dm';
      const isWall = it.kind === 'wall';
      const isLike = it.kind === 'wall-like';
      const isCat = it.kind === 'merecat';
      const who = name(it);
      const label = isDm ? (who + ' sent you a message')
        : isCat ? 'merecat finished answering your question'
          : isLike ? (who + ' liked your post')
            : isWall ? (who + (it.topic_id === 1 ? ' commented on your post' : ' mentioned you in a post'))
              : who + (it.kind === 'mention' ? ' mentioned you in ' : ' replied in ') + (it.topic_title || 'a thread');
      const to = isDm ? ('messages.html?dm=' + it.actor_hash)
        : isCat ? ('merecat-ai.html?chat=' + it.topic_id)
          : (isWall || isLike) ? ('feed.html?post=' + it.comment_id)
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
  declare notif: number;
  declare canBack: boolean;
  declare menu: boolean;
  declare notifMenu: boolean;
  declare _onDoc: (e: Event) => void;
  declare _onKey: (e: KeyboardEvent) => void;
  declare _onNav: () => void;
  constructor() { super(); this.notif = 0; this.canBack = false; this.menu = false; this.title = ''; this.notifMenu = false; }
  createRenderRoot() { return this; }
  sync() { this.notif = badgeCount('notif'); this.canBack = history.length > 1; this.title = pageTitle(); }
  connectedCallback() {
    super.connectedCallback();
    this._onDoc = (e) => {
      if (this.menu && !(e.target as HTMLElement).closest('.mc-db-acct')) this.menu = false;
      if (this.notifMenu && !(e.target as HTMLElement).closest('.mc-db-notif')) this.notifMenu = false;
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
  toggleMenu(e: Event) { e.preventDefault(); e.stopPropagation(); this.menu = !this.menu; this.notifMenu = false; }
  toggleNotif(e: Event) { e.preventDefault(); e.stopPropagation(); this.notifMenu = !this.notifMenu; this.menu = false; }
  goBack(e: Event) { e.preventDefault(); if (history.length > 1) history.back(); else { location.href = 'index.html'; } }
  goFwd(e: Event) { e.preventDefault(); history.forward(); }
  render() {
    const badge = (n: number) => n ? html`<span class="mc-tab-badge">${badgeText(n)}</span>` : '';
    return html`<div class="mc-deskbar">
      <div class="mc-db-hist">
        <button class=${'mc-db-ico' + (this.canBack ? '' : ' mc-ab-dim')} @click=${(e: Event) => this.goBack(e)} aria-label="Back" title="Back">${ICON.back}</button>
        <button class="mc-db-ico" @click=${(e: Event) => this.goFwd(e)} aria-label="Forward" title="Forward">${ICON.forward}</button>
      </div>
      <a class="mc-db-brand" href="index.html" aria-label="Home">${ICON.cross}<span class="mc-db-word">Mere Catholicity</span></a>
      ${activeTab() === 'home'
        ? html`<span class="mc-db-center"></span>`
        : html`<div class="mc-db-center mc-db-title" title=${this.title}>${this.title}</div>`}
      <nav class="mc-db-cluster" aria-label="Account">
        <div class="mc-db-notif">
          <button class="mc-db-ico" @click=${(e: Event) => this.toggleNotif(e)} aria-label="Notifications" title="Notifications" aria-expanded=${this.notifMenu ? 'true' : 'false'}>${ICON.bell}${badge(this.notif)}</button>
          ${this.notifMenu ? html`<div class="mc-db-menu mc-db-notifmenu"></div>` : ''}
        </div>
        <div class="mc-db-acct">
          <button class="mc-db-ico mc-db-gear" @click=${(e: Event) => this.toggleMenu(e)} aria-label="Settings" aria-expanded=${this.menu ? 'true' : 'false'}>${ICON.gear}</button>
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
  declare active: string;
  declare dm: number;
  declare wide: boolean;
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
        const inner = html`<span class="mc-sb-ico">${t.icon ? t.icon : ICON[t.svg!]}${n ? html`<span class="mc-tab-badge">${badgeText(n)}</span>` : ''}</span>
          <span class="mc-sb-lbl">${t.label}</span>`;
        /* P3-e: the active destination is rendered as a non-navigating "current"
           item (a span, not a self-link) so the rail doesn't offer "Home" while on
           Home — the rail is a quick-switch, and you cannot switch to where you are. */
        return this.active === t.key
          ? html`<span class="mc-sb-item mc-tab-on mc-sb-current" aria-current="page" title=${t.label}>${inner}</span>`
          : html`<a class="mc-sb-item" href=${t.href} aria-label=${t.label} title=${t.label}>${inner}</a>`;
      })}
    </nav>`;
  }
}
customElements.define('mc-sidebar', McSidebar);

/* ---- the persistent site footer (all viewports) ---- */
class McFooter extends LitElement {
  createRenderRoot() { return this; }
  render() {
    /* Year computed at render time so the copyright never goes stale — never hardcoded. */
    const year = new Date().getFullYear();
    return html`<div class="mc-footer">
      <a href="index.html">© ${year} merecatholicity.com</a><span class="mc-foot-sep">·</span>
      <a href="terms.html">Terms &amp; Conditions</a><span class="mc-foot-sep">·</span>
      <a href="privacy.html">Privacy</a><span class="mc-foot-sep">·</span>
      <a href="contact.html">Contact</a>
    </div>`;
  }
}
customElements.define('mc-footer', McFooter);

/* ---- the Home launcher (replaces the marketing homepage on phones) ---- */
class McHome extends LitElement {
  createRenderRoot() { return this; }
  render() {
    const cont = lastReadPos();
    return html`<div class="mc-home">
      <div class="mc-home-hero"><span class="mc-home-cross">✝</span>
        <p>One, holy, catholic, and apostolic.</p></div>
      <hr class="mc-home-rule">
      <div class="mc-home-feats">${cont ? html`<a class="mc-home-feat" href=${cont.href}>
        <span class="mc-home-feat-ico">📖</span>
        <span class="mc-home-feat-txt"><strong>Continue reading</strong><small>${cont.title}</small></span>
        <span class="mc-home-go">›</span></a>` : ''}${HOME_FEATURES.map((f) => html`
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
function mcConfirm(message: string, opts?: any): Promise<boolean> {
  opts = opts || {};
  if (!isMobile() || !window.mcSheet) return Promise.resolve(window.confirm(message));
  return new Promise<boolean>(function (resolve) {
    let done = false;
    const finish = function (v: boolean) { if (done) return; done = true; window.mcSheet!.close(); resolve(v); };
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
    window.mcSheet!.open(opts.title || 'Confirm', wrap, function () { finish(false); });
  });
}

/* A brief bottom toast (phones only; desktop keeps its inline status text). */
function mcToast(message: string) {
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
function mcSelectSheet(sel: any) {
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
        window.mcSheet!.close();
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
  ['indo-european', 'Indo-European', 'I keep one of the old pre-Christian ways'],
  ['seeker', 'Seeker', 'I’m still seeking'],
];
function mcOnboard(onDone?: any, opts?: any) {
  if (!window.mcSheet) return;   // the sheet is a centered modal on desktop, a bottom sheet on phones
  const wrap = document.createElement('div');
  wrap.className = 'mc-onboard';
  const done = function () { window.mcSheet!.close(); if (onDone) { try { onDone(); } catch (e) { /* caller */ } } location.reload(); };

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

  /* This place is for adults only (terms + privacy): confirming 18+ is
     required to mint an identity, like the terms agreement. */
  const ageRow = document.createElement('label');
  ageRow.className = 'agree-row mc-onboard-agree';
  const age = document.createElement('input'); age.type = 'checkbox';
  age.addEventListener('change', refresh);
  const ageTxt = document.createElement('span');
  ageTxt.appendChild(document.createTextNode('I am at least 18 years old.'));
  ageRow.appendChild(age); ageRow.appendChild(ageTxt);
  wrap.appendChild(ageRow);

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

  function refresh() { createBtn.disabled = !(chosenFaith && agree.checked && age.checked); }
  haveKey.addEventListener('click', function () { pasteWrap.hidden = !pasteWrap.hidden; if (!pasteWrap.hidden) pasteIn.focus(); });

  function revealKey(key: string) {
    wrap.textContent = '';
    const h = document.createElement('p'); h.className = 'mc-onboard-intro';
    h.textContent = 'You’re in. Save your key now. It is the only way back to this identity, and there is no recovery if it is lost.';
    wrap.appendChild(h);
    const keyRow = document.createElement('div'); keyRow.className = 'mc-set-key';
    const keyIn = document.createElement('input'); keyIn.className = 'mc-set-keyin'; keyIn.readOnly = true; keyIn.value = key || '';
    keyIn.addEventListener('focus', function () { keyIn.select(); });
    const copyBtn = document.createElement('button'); copyBtn.type = 'button'; copyBtn.className = 'btn btn-send mc-set-copy'; copyBtn.textContent = 'Copy';
    keyRow.appendChild(keyIn); keyRow.appendChild(copyBtn);
    wrap.appendChild(keyRow);
    /* The save gate: Continue stays disabled until the reader has actually
       copied or downloaded the key (or sworn to the checkbox). Tapping
       Continue past an unsaved key was the whole account-loss cliff. */
    const dlRow = document.createElement('div'); dlRow.className = 'mc-onboard-paste';
    const dlBtn = document.createElement('button'); dlBtn.type = 'button'; dlBtn.className = 'btn'; dlBtn.textContent = 'Download key file';
    dlRow.appendChild(dlBtn);
    wrap.appendChild(dlRow);
    const savedRow = document.createElement('label'); savedRow.className = 'agree-row mc-onboard-agree';
    const savedCk = document.createElement('input'); savedCk.type = 'checkbox';
    const savedTxt = document.createElement('span'); savedTxt.textContent = 'I have saved my key somewhere safe.';
    savedRow.appendChild(savedCk); savedRow.appendChild(savedTxt);
    wrap.appendChild(savedRow);
    const cont = document.createElement('button'); cont.type = 'button'; cont.className = 'btn btn-send mc-onboard-create'; cont.textContent = 'Continue';
    cont.disabled = true;
    let saved = false;
    const markSaved = function () { saved = true; cont.disabled = false; };
    copyBtn.addEventListener('click', function () {
      try { if (navigator.clipboard) { navigator.clipboard.writeText(key); copyBtn.textContent = 'Copied'; } } catch (e) { /* no clipboard */ }
      markSaved();
    });
    dlBtn.addEventListener('click', function () { downloadKeyFile(key); dlBtn.textContent = 'Downloaded'; markSaved(); });
    savedCk.addEventListener('change', function () { if (savedCk.checked) markSaved(); else if (!saved) cont.disabled = true; });
    cont.addEventListener('click', done);
    wrap.appendChild(cont);
  }

  createBtn.addEventListener('click', function () {
    const kit = window.mcKit;
    if (!kit || !kit.mintIdentity) { location.href = 'profile.html'; return; }
    createBtn.disabled = true; note.textContent = 'Creating…';
    kit.mintIdentity(chosenFaith).then(function (res: any) { revealKey(res && res.key); })
      .catch(function () { note.textContent = 'Could not create. Try again.'; createBtn.disabled = false; });
  });
  pasteBtn.addEventListener('click', function () {
    const kit = window.mcKit;
    const key = pasteIn.value.trim();
    if (!key) { pasteIn.focus(); return; }
    if (!kit || !kit.loginWithKey) { location.href = 'profile.html'; return; }
    pasteBtn.disabled = true; note.textContent = 'Logging in…';
    kit.loginWithKey(key).then(function (ok: any) {
      if (ok) done();
      else { note.textContent = 'That key was not recognized.'; pasteBtn.disabled = false; }
    }).catch(function () { note.textContent = 'Could not log in. Try again.'; pasteBtn.disabled = false; });
  });

  window.mcSheet.open('Join the conversation', wrap);
  /* "I have a key" entry point: reveal the paste box up front and focus it. */
  if (opts && opts.key) { pasteWrap.hidden = false; try { pasteIn.focus(); } catch (e) { /* not focusable yet */ } }
}

/* Mount the persistent chrome (called by the shell after the ?app=0 latch) and
   return { sync } for boots() to call after every swap. The elements carry
   data-mc-app so swapContent skips them; CSS keeps them off desktop. */
export function installChrome() {
  const appbar = document.createElement('mc-appbar') as McAppbar;
  appbar.setAttribute('data-mc-app', '');
  document.body.appendChild(appbar);

  const tabbar = document.createElement('mc-tabbar') as McTabbar;
  tabbar.setAttribute('data-mc-app', '');
  document.body.appendChild(tabbar);

  const sheet = document.createElement('mc-sheet') as McSheet;
  sheet.setAttribute('data-mc-app', '');
  document.body.appendChild(sheet);

  /* The desktop platform bar (CSS-gated ≥601px). data-mc-app is load-bearing:
     without it swapContent deletes the bar on the first soft-nav. */
  const deskbar = document.createElement('mc-deskbar') as McDeskbar;
  deskbar.setAttribute('data-mc-app', '');
  document.body.appendChild(deskbar);
  /* The desktop LEFT app-bar (the mobile tabs stood up) + the persistent site
     footer. Both data-mc-app so soft-nav preserves them across swaps. */
  const sidebar = document.createElement('mc-sidebar') as McSidebar;
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
      var kb = Math.max(0, Math.round(window.innerHeight - vv!.height - vv!.offsetTop));
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

  /* P3-a: a logged-out reader on a gated screen (Inbox, Profile, Merecat,
     Notifications) is NO LONGER met by an auto-popped, boxed-in modal. The client
     renders a calm, non-blocking inline prompt in place (comments.ts viewJoin),
     matching the Community gate, and the onboarding sheet opens only on an explicit
     tap — so exploring a members-only feature never traps a visitor who only came
     to look. (The former shell-level auto-open latch lived here.) */

  /* The Library page becomes an app-style drill-down on both breakpoints (parses
     its own static catalog; SEO/no-JS keep the flat list). Runs after every swap. */
  function mountLibraryHook() {
    if ((location.pathname.split('/').pop() || '') !== 'library.html') return;
    const main = document.querySelector('main');
    if (main) mountLibrary(main);
  }

  function sync() { syncThemeArt(); tabbar.sync(); appbar.sync(); deskbar.sync(); sidebar.sync(); mountHome(); mountLibraryHook(); }
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
