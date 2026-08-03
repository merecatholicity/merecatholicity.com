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
      ['Platform settings', 'admin.html?settings=1', 'Media sharing on or off, the upload size limit, the default disappear time, and a purge-all-media button.'],
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
