/* app/chromebits.ts — the two fixed bars a phone sees, and the small things
   both they and the rest of the chrome read (2026-09-17).

   Why this module exists at all: these two elements used to live in
   appchrome.ts, which is the whole chrome — the Home launcher, the settings
   sheet, the notifications list, the desktop rail. That module rides app.js,
   and until app.js arrived a phone had no bars, so a cold open painted a page
   with no app around it and then grew one (the owner's "flash like an extra
   page reload"). The bars are now their own esbuild entry (app/chrome.ts →
   docs/chrome.js, ~25 KB against app.js's ~290), loaded first, so they stand
   within a round trip of the first paint. app.js imports the same module
   through a shared chunk, so nothing here is built twice and there is exactly
   one definition of each element. It imports Lit and NOTHING else on purpose:
   one import of app/core.ts (the kernel membrane) put the whole domain layer
   in the shared chunk and took the early bundle from 25 KB to 102 KB.

   What does NOT belong here: anything the bars can live without for the few
   hundred milliseconds before app.js lands. The bell and the gear open sheets
   that only app.js defines; pressing one early does nothing, and the press
   works the moment the shell stands. Nor does `armTap`, the law that fixed
   chrome answers the finger and not the platform's click (2026-09-13): it
   reads the tap kernel, which would drag the domain layer in here, so
   installChrome arms these two bars the moment app.js lands. A press before
   that follows the link natively, as every other link on the page does. */
import { LitElement, html } from 'lit';

export const ICON = {
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


export interface Tab {
  key: string;
  label: string;
  href: string;
  svg?: keyof typeof ICON;
  icon?: string;
  badge?: string;
}
/* The social layer's mirror (written by client/comments.ts from /config, absence
   = on). The chrome must decide whether to draw the Feed tab SYNCHRONOUSLY, on
   every page, before any fetch — adding a /config read to the shell would put
   API traffic on all ~270 corpus pages and break the free-tier budget law. A
   reader who only ever opens corpus pages can hold a stale mirror; the tab then
   leads to the same "No such page." the worker gives, and self-corrects on
   their next platform page. */
export function socialOn(): boolean {
  try { return localStorage.getItem('mc-social') !== '0'; } catch (e) { return true; }
}
/* The tabs to draw right now: Feed disappears with the social layer. */
export function visibleTabs(): Tab[] {
  return socialOn() ? TABS : TABS.filter((t) => t.key !== 'feed');
}
export const TABS: Tab[] = [
  { key: 'home', label: 'Home', svg: 'home', href: 'index.html' },
  { key: 'merecat', label: 'Merecat', icon: '🐈', href: 'merecat-ai.html' },
  { key: 'feed', label: 'Feed', svg: 'feed', href: 'feed.html' },
  { key: 'community', label: 'Community', svg: 'community', href: 'community.html' },
  { key: 'messages', label: 'Inbox', svg: 'inbox', href: 'messages.html', badge: 'dm' },
  { key: 'profile', label: 'Profile', svg: 'profile', href: 'profile.html' },
];


export function activeTab(at?: string) {
  const path = (at == null ? location.pathname : at).split('/').pop() || 'index.html';
  if (path === 'index.html' || path === '') return 'home';
  if (path === 'merecat-ai.html') return 'merecat';
  if (path === 'messages.html') return 'messages';
  if (path === 'profile.html') return 'profile';
  if (path === 'feed.html') return 'feed';
  if (path === 'community.html') return 'community';
  return '';
}


export function pageTitle() {
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
export function onCommunity() {
  return (location.pathname.split('/').pop() || '') === 'community.html';
}


/* Unread counts, read from the caches the comments client keeps current (live
   layer + the shell's event-driven refresh). No fetch — the chrome only
   reflects what is already known, and only while it is still TRUE: a stored
   count older than its TTL (Domain.Cache.badgeShows) is last visit's number,
   and painting it made every fresh open show a wrong badge for as long as the
   refresh took (the owner's report, 2026-09-17; reproduced at 211 ms on a fast
   phone open, far longer on a slow link). No badge is the honest answer until
   the read lands — app/badges.ts asks for it at once. Without the kernel
   (a half-loaded bundle) nothing is painted, which is the safe side. */
export function badgeCount(which: string) {
  try {
    const raw = localStorage.getItem(which === 'dm' ? 'mc-dm-unread' : 'mc-notif-unread');
    const o = raw ? JSON.parse(raw) : null;
    if (!o || !(o.n > 0)) return 0;
    const core = window.mcCore;
    if (!core || !core.cacheBadgeShows) return 0;
    return core.cacheBadgeShows(Date.now() - (Number(o.at) || 0)) ? o.n : 0;
  } catch (e) { return 0; }
}
export function badgeText(n: number) { return n > 99 ? '99+' : String(n); }
/* The badge is a red disc a screen reader cannot read as anything — so the tab
   that carries one says the count in its own label: "Inbox, 3 unread messages". */
export function badgeLabel(label: string, n: number) {
  return n ? label + ', ' + n + (n === 1 ? ' unread message' : ' unread messages') : label;
}




/* ---- the bottom tab bar ---- */
export class McTabbar extends LitElement {
  static properties = { active: { attribute: false }, dm: { attribute: false }, pending: { attribute: false } };
  declare active: string;
  declare dm: number;
  /* The tab the finger just asked for, painted before the navigation has
     resolved. `lit()` prefers it over `active`; sync() clears it once the real
     page stands. Without this the highlight only moved after the fetch AND the
     boot, so a tap looked ignored for a beat — the ping-pong we are killing. */
  declare pending: string;
  private _onSocial = () => this.requestUpdate();
  constructor() { super(); this.active = 'home'; this.dm = 0; this.pending = ''; }
  createRenderRoot() { return this; }
  /* The Feed tab appears or vanishes with the social switch, without a reload. */
  connectedCallback() { super.connectedCallback(); document.addEventListener('mc-social-change', this._onSocial); }
  disconnectedCallback() { super.disconnectedCallback(); document.removeEventListener('mc-social-change', this._onSocial); }
  sync() { this.active = activeTab(); this.pending = ''; this.dm = badgeCount('dm'); }
  lit() { return this.pending || this.active; }
  render() {
    const on = this.lit();
    return html`<nav class="mc-tabbar" aria-label="Primary">
      ${visibleTabs().map((t) => html`
        <a class=${'mc-tab' + (on === t.key ? ' mc-tab-on' : '')}
           href=${t.href} aria-label=${badgeLabel(t.label, t.badge === 'dm' ? this.dm : 0)}
           aria-current=${on === t.key ? 'page' : 'false'}>
          <span class="mc-tab-ico">${t.icon ? t.icon : ICON[t.svg!]}${t.badge === 'dm' && this.dm
            ? html`<span class="mc-tab-badge">${badgeText(this.dm)}</span>` : ''}</span>
          <span class="mc-tab-lbl">${t.label}</span>
        </a>`)}
    </nav>`;
  }
}
customElements.define('mc-tabbar', McTabbar);


export class McAppbar extends LitElement {
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
  goBack(e: Event) { e.preventDefault(); if (history.length > 1) history.back(); else if (window.mcNav) window.mcNav('index.html'); else { location.href = 'index.html'; } }
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


/* Put the two bars in the document, once, and let them paint. Called by
   app/chrome.ts the moment the early bundle lands and again (idempotently) by
   installChrome when the shell stands, which is what keeps one pair of
   elements whatever order the two bundles arrive in. `data-mc-app` is
   load-bearing: without it the first soft navigation's content swap deletes
   the bars. The `mc-bars` mark on <html> retires the stylesheet's pre-shell
   placeholders (styles/main.css), so the surfaces the first paint drew are
   replaced by the real thing and nothing moves. */
export function mountBars(): { appbar: McAppbar; tabbar: McTabbar } {
  let appbar = document.querySelector('mc-appbar') as McAppbar | null;
  if (!appbar) {
    appbar = document.createElement('mc-appbar') as McAppbar;
    appbar.setAttribute('data-mc-app', '');
    document.body.appendChild(appbar);
  }
  let tabbar = document.querySelector('mc-tabbar') as McTabbar | null;
  if (!tabbar) {
    tabbar = document.createElement('mc-tabbar') as McTabbar;
    tabbar.setAttribute('data-mc-app', '');
    document.body.appendChild(tabbar);
  }
  try { appbar.sync(); tabbar.sync(); } catch (e) { /* a bar that cannot sync still stands */ }
  document.documentElement.classList.add('mc-bars');
  return { appbar, tabbar };
}
