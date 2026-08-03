/* The admin read/observe cluster (interior campaign, Wave C-reads 3):
   <mc-admin-home> (the hub of admin doors), <mc-merecat-threads> (the
   read-only window on how members use the librarian), and
   <mc-merecat-thread> (one conversation observed). All pure admin-gated
   READS — no moderation action moves here (the audit/ipban/admins consoles,
   which act, stay kit machinery). Bodies render through the living richtext
   (window.mcRich). The admin gate shows a neutral wait while status loads,
   never a false refusal, exactly as the old adminGate did. */

import { LitElement, html, nothing } from 'lit';
import { pagerTpl, crumbTpl, retryTpl } from './util.ts';

/* Shared admin gate for a component: returns 'ok' | 'wait' | 'no', and
   registers a re-render for when the profile (hence admin status) lands. */
function gate(kit: any, host: LitElement): 'ok' | 'wait' | 'no' {
  if (kit.isAdmin()) return 'ok';
  if (!kit.state.key || kit.state.profileLoaded) return 'no';
  kit.onProfile(() => host.requestUpdate());
  return 'wait';
}

class McAdminHome extends LitElement {
  static properties = { g: { attribute: false } };
  declare kit: any;
  declare g: string;
  constructor() { super(); this.kit = null; this.g = ''; }
  createRenderRoot() { return this; }
  connectedCallback() { super.connectedCallback(); document.title = 'Administrative options | Community'; }
  render() {
    const kit = this.kit;
    if (!kit) return nothing;
    const head = crumbTpl([['Community', 'community.html'], ['Administrative options']]);
    const g = gate(kit, this);
    if (g === 'wait') return html`${head}<p class="comments-status">Loading...</p>`;
    if (g === 'no') return html`${head}<p class="comments-status">This page is for the admins.</p>`;
    const doors = [
      ['Activity audit', 'admin.html?audit=1', 'Reported posts, the review queue, and the last two weeks of activity, every row actionable.'],
      ['IP ban list', 'admin.html?ipbans=1', 'Every banned address, added and removed by hand.'],
      ['Shadow bans', 'admin.html?shadowbans=1', 'Quiet mutes: a member keeps posting but no one else sees it. Add, review, and lift.'],
      ['Add / Remove Admins', 'admin.html?admins=1', 'Grant a member admin powers, or take them back.'],
      ['Platform settings', 'admin.html?settings=1', 'Per-area media controls — what the feed, forum, and DMs each accept, sizes, voice notes, AI screening, storage budgets, retention, and one-time purges.'],
      ['Platform usage', 'admin.html?usage=1', 'Cloudflare free-tier health bars — every meter the platform rides and how close each is to its wall, checked daily with DM alerts past 80%.'],
      ['Discord webhooks', 'admin.html?discord=1', 'Announce new posts to Discord: the two global webhooks, plus per-feed subscriptions that post one thread or category to a channel.'],
      ['merecat administration', 'admin.html?merecatadmin=1', 'The librarian’s dials: the per-member daily cap, on or off, and how many.'],
      ['merecat Q&A at a glance', 'admin.html?merecatthreads=1', 'Observe how members use the librarian, every question and answer, read-only, to guide what to teach it next.'],
    ];
    return html`${head}
      <p class="board-intro">Everything that governs the board sits behind these doors. Each is admin-only, here and at the server.</p>
      <div class="board-cats">${doors.map((o) => html`<div class="board-cat"><div class="board-cat-left">
        <a class="board-cat-name" href=${o[1]}>${o[0]}</a>
        <div class="board-cat-desc">${o[2]}</div></div></div>`)}</div>`;
  }
}
customElements.define('mc-admin-home', McAdminHome);

class McMerecatThreads extends LitElement {
  static properties = { d: { attribute: false }, err: { attribute: false } };
  declare kit: any;
  declare d: any;
  declare err: string;
  declare _loading: boolean;
  constructor() { super(); this.kit = null; this.d = null; this.err = ''; }
  createRenderRoot() { return this; }
  connectedCallback() {
    super.connectedCallback();
    document.title = 'merecat Q&A at a glance | Community';
    this.maybeLoad();
  }
  maybeLoad() {
    const kit = this.kit;
    if (this._loading || kit.isAdmin() === false && (kit.state.profileLoaded || !kit.state.key)) return;
    if (!kit.isAdmin()) { kit.onProfile(() => { this.requestUpdate(); this.maybeLoad(); }); return; }
    this._loading = true;
    const pageNum = Math.max(1, Math.floor(Number(new URLSearchParams(location.search).get('p')) || 1));
    kit.fetchRetry(kit.MERECAT_API + '/admin/threads', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: kit.state.key, p: pageNum }),
    }, [1000, 3000]).then((r: Response) => r.json()).then((d: any) => {
      if (kit.blockedOut(d)) return;
      this._loading = false;
      if (!d.ok) { this.err = d.error === 'No.' ? 'This is for admins alone.' : 'Could not load.'; return; }
      this.d = d;
    }).catch(() => { this._loading = false; this.err = 'Could not load the list.'; });
  }
  render() {
    const kit = this.kit;
    if (!kit) return nothing;
    const head = crumbTpl([['Community', 'community.html'], ['Administrative options', 'admin.html'], ['merecat Q&A']]);
    const g = gate(kit, this);
    if (g === 'wait') return html`${head}<p class="comments-status">Loading...</p>`;
    if (g === 'no') return html`${head}<p class="comments-status">This page is for the admins.</p>`;
    const intro = html`<p class="board-intro">Every question put to the librarian in the last thirty days, newest first, read-only. Open one to observe the whole exchange. A thread a member deletes leaves here too, and one saved past thirty days still ages off this view. This is for improving the service, not participating. You cannot ask or reply here.</p>`;
    if (this.err) return html`${head}${intro}<p class="comments-status">${this.err}${this.err === 'This is for admins alone.' ? nothing : retryTpl(this, { kit: this.kit })}</p>`;
    if (!this.d) return html`${head}${intro}<p class="comments-status">Loading…</p>`;
    if (!this.d.threads.length) return html`${head}${intro}<p class="comments-status">No conversations yet.</p>`;
    const href = (i: number) => 'admin.html?merecatthreads=1&p=' + i;
    return html`${head}${intro}
      <div class="board-topics">${this.d.threads.map((t: any) => {
        const q = Math.max(0, Math.ceil((t.msgs || 0) / 2));
        return html`<div class="board-topic"><div class="board-topic-left">
          <a class="board-topic-title" href=${'admin.html?merecatthread=' + t.id}>${t.title || ('Conversation ' + t.id)}</a>${t.saved ? html`<span class="board-sticky"> (saved)</span>` : nothing}
          <div class="board-cat-desc">asked by <a class="body-link" href=${kit.profileHref(t.hash)}>${t.nick || kit.displayName(t.hash)}</a></div>
          </div><div class="board-stats">${q + (q === 1 ? ' question · ' : ' questions · ') + kit.fmtDateTime(t.last_at)}</div></div>`;
      })}</div>
      ${pagerTpl(this.d.total, this.d.per, this.d.page, href)}`;
  }
}
customElements.define('mc-merecat-threads', McMerecatThreads);

class McMerecatThread extends LitElement {
  static properties = { d: { attribute: false }, err: { attribute: false } };
  declare kit: any;
  declare tid: number;
  declare d: any;
  declare err: string;
  declare _loading: boolean;
  declare _painted: boolean;
  constructor() { super(); this.kit = null; this.tid = 0; this.d = null; this.err = ''; }
  createRenderRoot() { return this; }
  connectedCallback() {
    super.connectedCallback();
    document.title = 'Observing a conversation | Community';
    this.maybeLoad();
  }
  maybeLoad() {
    const kit = this.kit;
    if (this._loading) return;
    if (!kit.isAdmin()) {
      if (kit.state.profileLoaded || !kit.state.key) return;
      kit.onProfile(() => { this.requestUpdate(); this.maybeLoad(); });
      return;
    }
    if (!Number.isInteger(this.tid) || this.tid < 1) { this.err = 'No such conversation.'; return; }
    this._loading = true;
    kit.fetchRetry(kit.MERECAT_API + '/admin/thread', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: kit.state.key, id: this.tid }),
    }, [1000, 3000]).then((r: Response) => r.json()).then((d: any) => {
      if (kit.blockedOut(d)) return;
      this._loading = false;
      if (!d.ok) { this.err = d.error === 'No.' ? 'This is for admins alone.' : 'That conversation is gone.'; return; }
      this.d = d;
    }).catch(() => { this._loading = false; this.err = 'That conversation could not be loaded.'; });
  }
  updated() {
    if (!this.d || this._painted) return;
    this._painted = true;
    const kit = this.kit;
    const d = this.d;
    const who = d.chat.nick || kit.displayName(d.chat.hash);
    const log = this.querySelector('.merecat-log');
    (d.msgs || []).forEach((m: any) => {
      const msg = kit.el('div', 'merecat-msg ' + (m.role === 'user' ? 'you' : 'cat'));
      msg.appendChild(kit.el('div', 'merecat-who', m.role === 'user' ? who : '🐈 merecat'));
      const body = kit.el('div', 'merecat-body');
      msg.appendChild(body);
      if (m.role === 'user') { window.mcRich!.fillBody(body, m.body); }
      else {
        window.mcRich!.fillBody(body, m.body, true);
        let srcs: any[] = [];
        try { srcs = JSON.parse(m.sources || '[]'); } catch (e) { /* footer stays off */ }
        if (srcs.length) {
          const ft = kit.el('p', 'merecat-note');
          ft.appendChild(kit.el('strong', null, 'Sources: '));
          srcs.forEach((sc: any, i: number) => {
            if (i) ft.appendChild(document.createTextNode(' · '));
            const label = '[' + (sc.n || (i + 1)) + '] ' + (sc.title || '');
            if (sc.url) { const a = kit.el('a', 'body-link', label); a.href = sc.url; ft.appendChild(a); }
            else ft.appendChild(document.createTextNode(label));
          });
          msg.appendChild(ft);
        }
      }
      log!.appendChild(msg);
    });
  }
  render() {
    const kit = this.kit;
    if (!kit) return nothing;
    const head = crumbTpl([['Community', 'community.html'], ['Administrative options', 'admin.html'], ['merecat Q&A', 'admin.html?merecatthreads=1'], ['Conversation ' + this.tid]]);
    const g = gate(kit, this);
    if (g === 'wait') return html`${head}<p class="comments-status">Loading...</p>`;
    if (g === 'no') return html`${head}<p class="comments-status">This page is for the admins.</p>`;
    if (this.err) return html`${head}<p class="comments-status">${this.err}${this.err === 'That conversation could not be loaded.' ? retryTpl(this, { kit: this.kit, tid: this.tid }) : nothing}</p>`;
    if (!this.d) return html`${head}<p class="board-intro">Observing only. You cannot ask or reply in this conversation.</p><p class="comments-status">Loading…</p>`;
    const d = this.d;
    const who = d.chat.nick || kit.displayName(d.chat.hash);
    return html`${head}
      <p class="board-intro">Observing only. You cannot ask or reply in this conversation.</p>
      <div class="merecat-log">
        <p class="board-intro">Conversation with <a class="body-link" href=${kit.profileHref(d.chat.hash)}>${who}</a>. Started ${kit.fmtDateTime(d.chat.created_at)}.</p>
      </div>`;
  }
}
customElements.define('mc-merecat-thread', McMerecatThread);

/* The Cloudflare free-tier health bars (admin.html?usage=1). Live numbers from
   POST /admin/usage — every product's meters as bars banded ok/watch/hot/over
   (the same 80/100 scale the daily 23:30 UTC check alerts on), per-script/
   model/database/bucket detail, and the one-time setup card until the
   read-only analytics token is installed. Pure read; Refresh re-asks. */

const USAGE_GROUPS = ['workers', 'ai', 'd1', 'do', 'r2', 'vectorize', 'turn', 'turnstile', 'cron'];

function fmtQty(n: number, unit: string): string {
  if (unit === 'bytes') {
    if (n >= 1e9) return (n / 1e9).toFixed(2) + ' GB';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + ' MB';
    if (n >= 1e3) return (n / 1e3).toFixed(0) + ' KB';
    return n + ' B';
  }
  if (unit === 'gbs') return n.toLocaleString() + ' GB-s';
  const words: Record<string, string> = { req: 'requests', ops: 'operations', rows: 'rows', neurons: 'neurons', dims: 'dimensions', count: '' };
  const w = words[unit] != null ? words[unit] : unit;
  return n.toLocaleString() + (w ? ' ' + w : '');
}

class McUsage extends LitElement {
  static properties = { d: { attribute: false }, err: { attribute: false } };
  declare kit: any;
  declare d: any;
  declare err: string;
  declare _loading: boolean;
  constructor() { super(); this.kit = null; this.d = null; this.err = ''; }
  createRenderRoot() { return this; }
  connectedCallback() {
    super.connectedCallback();
    document.title = 'Platform usage | Community';
    this.maybeLoad();
  }
  maybeLoad() {
    const kit = this.kit;
    if (this._loading) return;
    if (!kit.isAdmin()) {
      if (kit.state.profileLoaded || !kit.state.key) return;
      kit.onProfile(() => { this.requestUpdate(); this.maybeLoad(); });
      return;
    }
    this._loading = true;
    kit.fetchRetry(kit.API + '/admin/usage', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: kit.state.key }),
    }, [1500, 4000]).then((r: Response) => r.json()).then((d: any) => {
      if (kit.blockedOut(d)) return;
      this._loading = false;
      if (!d.ok) { this.err = d.error === 'No.' ? 'This is for admins alone.' : 'The usage report could not be loaded.'; return; }
      this.d = d;
    }).catch(() => { this._loading = false; this.err = 'The usage report could not be loaded.'; });
  }
  refresh() { if (this._loading) return; this.d = null; this.err = ''; this.maybeLoad(); }
  rowTpl(r: any) {
    if (r.error) {
      return html`<div class="mc-usage-row na"><div class="mc-usage-head"><span>${r.label}</span>
        <span class="mc-usage-val">unavailable — ${r.error}</span></div></div>`;
    }
    const over = r.pct != null && r.pct >= 100;
    const width = r.pct == null ? 0 : Math.max(0.5, Math.min(100, r.pct));
    return html`<div class="mc-usage-row ${r.band || 'na'}">
      <div class="mc-usage-head"><span>${r.label}</span>
        <span class="mc-usage-val">${r.limit
          ? html`${fmtQty(r.used, r.unit)} of ${fmtQty(r.limit, r.unit)} · <strong>${r.pct}%</strong>${over ? html` <em class="mc-usage-over">OVER</em>` : nothing}`
          : html`${fmtQty(r.used, r.unit)} · unmetered`}</span></div>
      ${r.limit ? html`<div class="mc-usage-bar"><span style="width:${width}%"></span></div>` : nothing}
      ${r.detail ? html`<div class="mc-usage-details">${r.detail.map((dd: any) =>
        html`<div class="mc-usage-detail">${dd.label} — ${fmtQty(dd.used, r.unit)}${dd.limit
          ? html` of ${fmtQty(dd.limit, r.unit)} (<strong class=${dd.pct >= 80 ? 'hotpct' : ''}>${dd.pct}%</strong>)` : nothing}</div>`)}</div>` : nothing}
      ${r.note ? html`<div class="mc-usage-note">${r.note}</div>` : nothing}
    </div>`;
  }
  setupTpl() {
    return html`<p class="board-intro">The monitor reads the account's own usage through the Cloudflare analytics API with a READ-ONLY token. That token is not set yet — three steps, once:</p>
      <ol class="mc-usage-setup">
        <li>In the Cloudflare dashboard open <strong>Manage account → Account API tokens → Create token → Custom token</strong>.</li>
        <li>Give it the single permission <strong>Account · Account Analytics · Read</strong>, include this account, and create it.</li>
        <li>Where the worker deploys from, run <code>cd comments-worker && npx wrangler secret put CF_USAGE_TOKEN</code> and paste the token.</li>
      </ol>
      <p class="board-intro">No redeploy needed — reload this page and the bars appear, and the daily 23:30 UTC check starts alerting the same moment. The token can read usage numbers and nothing else; revoke it in the dashboard any time.</p>`;
  }
  render() {
    const kit = this.kit;
    if (!kit) return nothing;
    const head = crumbTpl([['Community', 'community.html'], ['Administrative options', 'admin.html'], ['Platform usage']]);
    const g = gate(kit, this);
    if (g === 'wait') return html`${head}<p class="comments-status">Loading...</p>`;
    if (g === 'no') return html`${head}<p class="comments-status">This page is for the admins.</p>`;
    if (this.err) return html`${head}<p class="comments-status">${this.err}${this.err === 'This is for admins alone.' ? nothing : retryTpl(this, { kit: this.kit })}</p>`;
    if (!this.d) return html`${head}<p class="comments-status">Reading the meters…</p>`;
    const d = this.d;
    if (!d.configured) return html`${head}${this.setupTpl()}`;
    const rows = d.rows || [];
    const worst = rows.reduce((w: any, r: any) => (r.pct != null && (!w || r.pct > w.pct) ? r : w), null);
    const hotN = rows.filter((r: any) => r.pct != null && r.pct >= 80).length;
    return html`${head}
      <p class="board-intro">Every Cloudflare free-tier meter the platform rides, live from the analytics API.
        ${hotN ? html`<strong>${hotN} meter${hotN === 1 ? ' is' : 's are'} at 80% or beyond.</strong>`
          : worst ? 'All inside the free tier — the closest to its wall is ' + worst.label.toLowerCase() + ' at ' + worst.pct + '%.' : ''}
        <a class="body-link mc-usage-refresh" href="admin.html?usage=1"
          @click=${(e: Event) => { e.preventDefault(); this.refresh(); }}>Refresh</a></p>
      ${USAGE_GROUPS.filter((p) => rows.some((r: any) => r.product === p)).map((p) => html`
        <div class="mc-usage-group">
          <h3>${(d.products && d.products[p]) || p}</h3>
          ${rows.filter((r: any) => r.product === p).map((r: any) => this.rowTpl(r))}
        </div>`)}
      <p class="mc-usage-foot">Daily meters reset at 00:00 UTC; monthly ones follow the calendar month; “stored” bars are standing totals. A check runs daily at ${d.check_utc || '23:30'} UTC and DMs every admin when a meter crosses 80% or its ceiling — escalations at once, standing warnings weekly. Unmetered on the free plan and so not barred here: CDN bandwidth in front of GitHub Pages, Email Routing, rate-limit bindings, and WebSocket traffic. Free-plan ceilings as published ${d.free_as_of || ''}.</p>`;
  }
}
customElements.define('mc-usage', McUsage);

window.mcViews = window.mcViews || {};
window.mcViews.adminHome = function (section, kit) {
  const n = document.createElement('mc-admin-home') as any; n.kit = kit; section.appendChild(n);
};
window.mcViews.merecatThreads = function (section, kit) {
  const n = document.createElement('mc-merecat-threads') as any; n.kit = kit; section.appendChild(n);
};
window.mcViews.merecatThread = function (section, kit, id) {
  const n = document.createElement('mc-merecat-thread') as any; n.kit = kit; n.tid = id; section.appendChild(n);
};
window.mcViews.usage = function (section, kit) {
  const n = document.createElement('mc-usage') as any; n.kit = kit; section.appendChild(n);
};
