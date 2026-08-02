/* The profile and inbox read views (interior campaign, Wave C-reads 2):
   <mc-profile> and <mc-inbox>. Both are thin reactive shells over the store
   that reuse the proven machinery verbatim through the kit — <mc-profile>
   hands its card to the exact renderProfile() that already draws every
   profile (read card, the owner's Edit toggle, DM/mute buttons, recent
   posts, the admin fingerprint drawer) plus the admin in-place editor, so
   nothing about the profile's behavior changed, only which element owns it;
   <mc-inbox> renders the conversation list reactively and mounts the DM
   search box (write machinery) through the kit. The DM thread itself, being
   dominated by the Turnstile-gated composer, stays kit machinery. */

import { LitElement, html, nothing } from 'lit';
import { pagerTpl, crumbTpl } from './util.ts';

class McProfile extends LitElement {
  static properties = { profile: { attribute: false }, err: { attribute: false } };
  declare kit: any;
  declare hash: string;
  declare profile: any;
  declare err: string;
  declare _done: boolean;
  constructor() {
    super();
    this.kit = null;
    this.hash = '';
    this.profile = null;
    this.err = '';
  }
  createRenderRoot() { return this; }
  connectedCallback() {
    super.connectedCallback();
    const kit = this.kit;
    document.title = 'Profile | Community';
    if (!/^[0-9a-f]{64}$/.test(String(this.hash))) { this.err = 'bad'; return; }
    kit.cachedJson(kit.API + '/profile?hash=' + this.hash + kit.freshParam('&'), kit.freshOpts(), 30000)
      .then((d: any) => {
        if (!d.ok) throw new Error(d.error || 'failed');
        this.profile = d.profile;
      })
      .catch(() => { this.err = 'load'; });
  }
  updated() {
    if (!this.profile || this._done) return;
    this._done = true;
    const kit = this.kit;
    const editable = !!kit.state.key && this.hash === kit.state.myHash;
    const card = this.querySelector('.profile');
    /* Editing is a write, so the Turnstile slot lives outside the card (it
       survives the read/edit toggle) — mounted exactly as the old view did. */
    if (editable) {
      const slot = this.querySelector('.mc-ts-host');
      slot!.appendChild(kit.el('div', 'ts-slot'));
      kit.loadTurnstile();
    }
    kit.renderProfile(card, this.profile, editable);
    if (!editable && kit.isAdmin()) kit.adminProfileEditor(card, this.hash, this.profile || {});
  }
  render() {
    const kit = this.kit;
    if (!kit) return nothing;
    const head = crumbTpl([['Community', 'community.html'], ['Profile']]);
    if (this.err === 'bad') return html`${head}<p class="comments-status">No such profile.</p>`;
    if (this.err === 'load') return html`${head}<p class="comments-status">The profile could not be loaded. Check your connection and reload the page.</p>`;
    if (!this.profile) return html`${head}<p class="comments-status">Loading profile...</p>`;
    return html`${head}<div class="mc-ts-host"></div><div class="profile"></div>`;
  }
}
customElements.define('mc-profile', McProfile);

class McInbox extends LitElement {
  static properties = { d: { attribute: false }, err: { attribute: false } };
  declare kit: any;
  declare d: any;
  declare err: string;
  declare _onLive: (ev: Event) => void;
  constructor() {
    super();
    this.kit = null;
    this.d = null;
    this.err = '';
  }
  createRenderRoot() { return this; }
  connectedCallback() {
    super.connectedCallback();
    document.title = 'Inbox | Community';
    if (!this.kit.state.key) { this.err = 'gate'; return; }
    this.load();
    /* Live: a DM pushed over the private user scope bumps its thread to the top
       and rings the count, so the inbox stays current while it is open. */
    this._onLive = (ev: Event) => { const det = (ev as CustomEvent).detail; if (det && det.t === 'dm') this.load(); };
    document.addEventListener('mc-live', this._onLive);
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._onLive) document.removeEventListener('mc-live', this._onLive);
  }
  load() {
    const kit = this.kit;
    const pageNum = Math.max(1, Math.floor(Number(new URLSearchParams(location.search).get('p')) || 1));
    kit.fetchRetry(kit.API + '/dm/threads', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: kit.state.key, p: pageNum }),
    }, [1000, 3000]).then((r: Response) => r.json()).then((d: any) => {
      if (!d.ok) throw new Error(d.error || 'failed');
      kit.dmCacheSet(d.unread_total);
      this.d = d;
    }).catch(() => { this.err = 'load'; });
  }
  updated() {
    /* the DM search box (write machinery) mounts through the kit into its
       host — whenever the host is present and empty, NOT once-ever: the
       loading template and the data template are different TemplateResults,
       so Lit discards the loading DOM (and any child appended into it) and
       renders a fresh empty host on the data render, which must be re-filled */
    const kit = this.kit;
    if (!kit.state.key) return;
    const host = this.querySelector('.mc-dmsearch');
    if (host && !host.firstChild) host.appendChild(kit.dmSearchBox());
  }
  del(e: Event, other: string, row: HTMLElement) {
    e.preventDefault();
    const kit = this.kit;
    const go = (ok: boolean) => {
      if (!ok) return;
      fetch(kit.API + '/dm/delete', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: kit.state.key, with: other }),
      }).then((r) => r.json()).then((d2) => {
        if (d2.ok) { row.remove(); try { localStorage.removeItem('mc-dm-unread'); } catch (e2) {} kit.dmUnreadCheck(); }
      }).catch(() => {});
    };
    const msg = 'Delete this conversation? It is cleared from your inbox; the other member keeps their copy until they delete it too.';
    if (window.mcConfirm) window.mcConfirm(msg, { okLabel: 'Delete', danger: true }).then(go);
    else go(confirm(msg));
  }
  /* The whole inbox row is a click target into the conversation, exactly like a
     community board row: a nested link/button (the title, Delete) still wins, and
     a text selection never navigates. */
  _dmNav(e: Event) {
    if ((e.target as HTMLElement).closest('a, button, select, input, label')) return;
    if (window.getSelection && String(window.getSelection()).length) return;
    const a = (e.currentTarget as HTMLElement).querySelector('.board-topic-title');
    if (a) (a as HTMLElement).click();
  }
  render() {
    const kit = this.kit;
    if (!kit) return nothing;
    const head = crumbTpl([['Community', 'community.html'], ['Inbox']]);
    if (this.err === 'gate') return html`${head}<p class="comments-status">Messages need an identity. Create one on the board front page.</p>`;
    if (this.err === 'load') return html`${head}<div class="mc-dmsearch"></div><p class="comments-status">The inbox could not be loaded. Check your connection and reload the page.</p>`;
    if (!this.d) return html`${head}<div class="mc-dmsearch"></div><p class="comments-status">Loading messages...</p>`;
    const d = this.d;
    const href = (i: number) => 'messages.html&p=' + i;
    return html`${head}
      <div class="mc-dmsearch"></div>
      ${d.threads.length ? pagerTpl(d.total, d.per, d.page, href) : nothing}
      <div class="board-topics">
        ${!d.threads.length
          ? html`<p class="comments-status mc-empty" data-ico="✉️">No messages yet. Find a member above, or press Direct Message on any post.</p>`
          : d.threads.map((t: any) => html`<div class="board-topic mc-cardnav" @click=${this._dmNav}>
              <div class="board-topic-left">
                <a class=${'board-topic-title' + (t.unread ? ' dm-unread' : '')} href=${'messages.html?dm=' + t.other_hash}>${kit.dmLabel(t.other_hash, t.nick)}</a>${t.unread ? html`<span class="dm-unread"> ● new</span>` : nothing}
              </div>
              <div class="board-stats">${t.msgs + (t.msgs === 1 ? ' message · ' : ' messages · ') + kit.fmtDateTime(t.last_at)}</div>
              <div class="board-admin-corner"><a class="trust-toggle" href="#" @click=${(e: Event) => this.del(e, t.other_hash, (e.target as HTMLElement).closest('.board-topic') as HTMLElement)}>Delete</a></div>
            </div>`)}
      </div>
      ${d.threads.length ? pagerTpl(d.total, d.per, d.page, href) : nothing}`;
  }
}
customElements.define('mc-inbox', McInbox);

window.mcViews = window.mcViews || {};
window.mcViews.profile = function (section, kit, hash) {
  const n = document.createElement('mc-profile') as any; n.kit = kit; n.hash = hash; section.appendChild(n);
};
window.mcViews.inbox = function (section, kit) {
  const n = document.createElement('mc-inbox') as any; n.kit = kit; section.appendChild(n);
};
