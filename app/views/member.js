/* Member-facing read views (interior campaign, Wave C-reads): <mc-users>
   (the member directory) and <mc-notifications> (the notification list).
   Both are reads rendered reactively over the store; the DM composer and
   inbox actions (writes, Turnstile) stay kit machinery in their own slice.
   Same light-DOM, same class names, same delegation-with-fallback pattern
   as every board view. */

import { LitElement, html, nothing } from '../../vendor/lit-all.min.js';
import { pagerTpl, crumbTpl } from './util.js';

const PER_USERS = 20;

class McUsers extends LitElement {
  static properties = { roster: { attribute: false }, q: { attribute: false }, page: { attribute: false }, err: { attribute: false } };
  constructor() {
    super();
    this.kit = null;
    this.roster = null;
    this.q = '';
    this.page = 1;
    this.err = '';
  }
  createRenderRoot() { return this; }
  connectedCallback() {
    super.connectedCallback();
    const kit = this.kit;
    document.title = 'Members | Catholicity Board';
    this.page = Math.max(1, Math.floor(Number(new URLSearchParams(location.search).get('p')) || 1));
    kit.cachedJson(kit.API + '/dm/directory' + kit.freshParam('?'), kit.freshOpts(), 45000)
      .then((d) => {
        if (!d.ok) throw new Error(d.error || 'failed');
        this.roster = d.users || [];
      })
      .catch(() => { this.err = 'The member list could not be loaded. Check your connection and reload the page.'; });
  }
  visible() {
    const kit = this.kit;
    if (!this.q) return this.roster || [];
    const q = this.q.toLowerCase();
    return (this.roster || [])
      .map((u) => ({ u, s: Math.max(kit.dmScore(q, u.nick), kit.dmScore(q, kit.displayName(u.hash))) }))
      .filter((x) => x.s > 0)
      .sort((x, y) => y.s - x.s)
      .map((x) => x.u);
  }
  onSearch(e) {
    clearTimeout(this._t);
    const v = e.target.value.trim();
    this._t = setTimeout(() => { this.q = v; this.page = 1; }, 120);
  }
  render() {
    const kit = this.kit;
    if (!kit) return nothing;
    const head = html`${crumbTpl([['Catholicity Board', 'community.html'], ['Members']])}
      <p class="board-intro">Everyone on the board, newest first. Search by nickname or assigned name to find who is who, then open a profile.</p>
      <div class="key-row"><input class="key-input mc-userq" type="text" placeholder="Search members by name..." .value=${this.q} @input=${(e) => this.onSearch(e)}></div>`;
    if (this.err) return html`${head}<p class="comments-status">${this.err}</p>`;
    if (this.roster === null) return html`${head}<p class="comments-status">Loading members...</p>`;
    const items = this.visible();
    const total = items.length;
    const pages = Math.max(1, Math.ceil(total / PER_USERS));
    if (this.page > pages) this.page = pages;
    const count = !total ? (this.q ? 'No member matches that.' : 'No members yet.')
      : (this.q ? total + (total === 1 ? ' match' : ' matches') : total + (total === 1 ? ' member' : ' members'));
    const slice = items.slice((this.page - 1) * PER_USERS, this.page * PER_USERS);
    /* page turns in place (no URL), so the pager is buttons that set state */
    const pager = pages < 2 ? nothing : html`<p class="board-pages">${
      Array.from({ length: pages }, (_, i) => i + 1).filter((n) => n === 1 || n === pages || Math.abs(n - this.page) <= 1).map((n, i, arr) => {
        const prev = arr[i - 1];
        const gap = prev && n - prev > 1 ? (n - prev === 2 ? html` <a href="#" @click=${(e) => this.go(e, prev + 1)}>${prev + 1}</a> ` : html` … `) : nothing;
        return html`${gap}${n === this.page ? html` <strong>${n}</strong> ` : html` <a href="#" @click=${(e) => this.go(e, n)}>${n}</a> `}`;
      })}</p>`;
    return html`${head}
      <p class="comments-status">${count}</p>
      <div class="user-list">${slice.map((u) => html`<a class="user-row" href=${kit.profileHref(u.hash)}>
        <span class="user-names">${u.nick
          ? html`<span class="user-nick">${u.nick}</span><span class="user-assigned">${kit.displayName(u.hash)}</span>`
          : html`<span class="user-nick">${kit.displayName(u.hash)}</span>`}</span>
        <span class="user-go">profile →</span></a>`)}</div>
      ${pager}`;
  }
  go(e, n) { e.preventDefault(); this.page = n; window.scrollTo(0, 0); }
}
customElements.define('mc-users', McUsers);

class McNotifications extends LitElement {
  static properties = { d: { attribute: false }, err: { attribute: false } };
  constructor() {
    super();
    this.kit = null;
    this.d = null;
    this.err = '';
  }
  createRenderRoot() { return this; }
  connectedCallback() {
    super.connectedCallback();
    document.title = 'Notifications | Catholicity Board';
    if (!this.kit.state.key) { this.err = 'gate'; return; }
    this.load();
    /* Live: a notification pushed over the private user scope reloads the list
       (which also re-marks it read), so a new arrival appears while it is open. */
    this._onLive = (ev) => { if (ev.detail && ev.detail.t === 'notification') this.load(); };
    document.addEventListener('mc-live', this._onLive);
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._onLive) document.removeEventListener('mc-live', this._onLive);
  }
  load() {
    const kit = this.kit;
    const pageNum = Math.max(1, Math.floor(Number(new URLSearchParams(location.search).get('p')) || 1));
    kit.fetchRetry(kit.API + '/notifications', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: kit.state.key, p: pageNum }),
    }, [1000, 3000]).then((r) => r.json()).then((d) => {
      if (kit.blockedOut(d)) return;
      if (!d.ok) throw new Error(d.error || 'failed');
      this.d = d;
      /* reading the list clears it on the server; make the badge tell the truth */
      fetch(kit.API + '/notifications/read', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: kit.state.key }),
      }).then(() => { kit.notifClear(); }).catch(() => {});
    }).catch(() => { this.err = 'load'; });
  }
  render() {
    const kit = this.kit;
    if (!kit) return nothing;
    const head = crumbTpl([['Catholicity Board', 'community.html'], ['Notifications']]);
    if (this.err === 'gate') return html`${head}<p class="comments-status">Notifications need an identity. Create one on the board front page.</p>`;
    if (this.err === 'load') return html`${head}<p class="comments-status">Notifications could not be loaded. Check your connection and reload the page.</p>`;
    if (!this.d) return html`${head}<p class="comments-status">Loading notifications...</p>`;
    const d = this.d;
    if (!d.items.length) return html`${head}<p class="comments-status">No notifications yet. Post in a thread to follow it; you will hear when someone replies or names you.</p>`;
    const href = (i) => 'community.html?notifications=1&p=' + i;
    return html`${head}
      ${pagerTpl(d.total, d.per, d.page, href)}
      <div class="board-topics">${d.items.map((it) => {
        const who = it.actor_nick || (it.actor_hash ? kit.displayName(it.actor_hash) : 'Someone');
        const verb = it.kind === 'mention' ? ' mentioned you in ' : ' replied in ';
        return html`<div class="board-topic"><div class="board-topic-left">
          <a class=${'board-topic-title' + (it.read_at ? '' : ' dm-unread')} href=${'community.html?topic=' + it.topic_id + '#comment-' + it.comment_id}>${who + verb + (it.topic_title || 'a thread')}</a>${it.read_at ? nothing : html`<span class="dm-unread"> ● new</span>`}
          ${it.snippet ? html`<div class="board-intro">${it.snippet}</div>` : nothing}
          </div><div class="board-stats">${kit.fmtDateTime(it.created_at)}</div></div>`;
      })}</div>
      ${pagerTpl(d.total, d.per, d.page, href)}`;
  }
}
customElements.define('mc-notifications', McNotifications);

window.mcViews = window.mcViews || {};
window.mcViews.users = function (section, kit) {
  const n = document.createElement('mc-users'); n.kit = kit; section.appendChild(n);
};
window.mcViews.notifications = function (section, kit) {
  const n = document.createElement('mc-notifications'); n.kit = kit; section.appendChild(n);
};
