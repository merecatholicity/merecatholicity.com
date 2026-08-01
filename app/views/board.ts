/* The board's first two Lit views (interior campaign, Wave B1+B2):
   <mc-board-index> and <mc-board-cat>. Light DOM, today's class names, so
   style.css and every standing behavior contract hold; the DATA is what
   turned reactive — payloads and unread marks flow into templates instead
   of imperative rebuilds. Anything owned by a later wave (identity drawer,
   composer, admin corner) mounts through the kit `comments.js` hands over,
   verbatim machinery untouched. Registration: window.mcViews.* — the old
   view functions delegate here when present, one revertible line each. */

import { LitElement, html, nothing } from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import { pagerTpl } from './util.ts';
import * as Core from '../core.ts';

/* Category ordering must match the server's ORDER BY: stickies first, then by
   last-activity descending. Used when live events reshuffle the listing. The
   comparator lives in the PureScript Domain.Live (Core.topicCompare). */
function sortTopics(arr: any[]) {
  return arr.slice().sort((a: any, b: any) => Core.topicCompare(a, b));
}

class McBoardIndex extends LitElement {
  declare kit: any;
  declare stats: any;
  declare unreadTotal: number;
  declare byCat: any;
  declare adminOn: boolean;
  declare _onLive?: (ev: Event) => void;
  declare _refetchT?: ReturnType<typeof setTimeout>;
  static properties = {
    stats: { attribute: false }, unreadTotal: { attribute: false },
    byCat: { attribute: false }, adminOn: { attribute: false },
  };
  constructor() {
    super();
    this.kit = null;
    this.stats = null;
    this.unreadTotal = 0;
    this.byCat = null;
    this.adminOn = false;
  }
  createRenderRoot() { return this; }
  connectedCallback() {
    super.connectedCallback();
    document.title = 'Community | Mere Catholicity';
    const kit = this.kit;
    this.adminOn = kit.isAdmin();
    kit.cachedJson(kit.API + '/board' + kit.freshParam('?'), kit.freshOpts(), 45000)
      .then((d: any) => { if (d.ok) this.stats = d.cats; })
      .catch(() => {});
    if (kit.state.key) {
      kit.cachedJson(kit.API + '/board/unread', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: kit.state.key }),
      }, 45000).then((d: any) => {
        if (kit.blockedOut(d) || !d.ok) return;
        this.unreadTotal = d.total || 0;
        this.byCat = d.byCat || null;
      }).catch(() => {});
    }
    /* Live: the per-category latest-poster / counts update as posts happen. */
    if (window.mcLive) window.mcLive.board.sub(['board:index']);
    this._onLive = (ev: Event) => this._applyLive((ev as CustomEvent).detail);
    document.addEventListener('mc-live', this._onLive);
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._onLive) document.removeEventListener('mc-live', this._onLive);
    if (this._refetchT) clearTimeout(this._refetchT);
    if (window.mcLive) window.mcLive.board.leave();
  }
  _applyLive(m: any) {
    if (!m || !this.stats) return;   // loading: the initial fetch is already fresh
    /* delete/move change counts and the latest-poster in ways not worth patching
       by hand; they are rare (admin actions), so refetch the whole (tiny) index. */
    if (m.t === 'moderation' || m.t === 'moved') { this._refetchStats(); return; }
    if (!m.cat) return;
    const s = this.stats;
    if (m.t === 'new-topic') {
      const cur = s[m.cat] || { topics: 0, posts: 0 };
      this.stats = { ...s, [m.cat]: { ...cur, topics: (cur.topics || 0) + 1, posts: (cur.posts || 0) + 1,
        last: m.topic.last,
        latest: { topic_id: m.topic.id, id: m.topic.id, title: m.topic.title,
          author_hash: m.topic.author_hash, nick: m.topic.nick, created_at: m.topic.created_at } } };
    } else if (m.t === 'topic-stats') {
      const cur = s[m.cat];
      if (!cur) return;
      this.stats = { ...s, [m.cat]: { ...cur, posts: (cur.posts || 0) + 1, last: m.last,
        latest: { topic_id: m.topic_id, id: m.last_id,
          title: m.title || (cur.latest && cur.latest.title) || 'a thread',
          author_hash: m.author_hash, nick: m.nick, created_at: m.last } } };
    }
  }
  _refetchStats() {
    if (this._refetchT) clearTimeout(this._refetchT);
    const kit = this.kit;
    this._refetchT = setTimeout(() => {
      kit.fetchRetry(kit.API + '/board?cb=' + Date.now(), {}, [1000])
        .then((r: Response) => r.json()).then((d: any) => { if (d && d.ok) this.stats = d.cats; }).catch(() => {});
    }, 1500);
  }
  firstUpdated() {
    const kit = this.kit;
    kit.renderIdentity();
    /* admin status can land after first paint (the profile fetch): watch the
       identity block exactly as the old view did and re-take the answer */
    const idBlock = this.querySelector('.comment-identity');
    if (idBlock) {
      new MutationObserver(() => { this.adminOn = kit.isAdmin(); })
        .observe(idBlock, { childList: true });
    }
    const searchSlot = this.querySelector('.mc-index-search');
    if (searchSlot && kit.state.key && kit.state.myHash) {
      searchSlot.appendChild(kit.indexSearchBox());
    }
  }
  markAllRead(e: Event) {
    e.preventDefault();
    const kit = this.kit;
    fetch(kit.API + '/board/read-all', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: kit.state.key }),
    }).then(() => { kit.notifCacheSet(0); kit.stampFresh(); location.reload(); })
      .catch(() => {});
  }
  /* The whole category tile is a click target into the category — but a nested
     link (the latest-post link, a "see X" link in the description) still wins,
     and a text selection never navigates. Synthesizing a click on the category
     name link lets the shell soft-navigate it exactly as a direct click would. */
  _catNav(e: Event) {
    if ((e.target as HTMLElement).closest('a, button, select, input, label')) return;
    if (window.getSelection && String(window.getSelection()).length) return;
    const a = (e.currentTarget as HTMLElement).querySelector('.board-cat-name');
    if (a) (a as HTMLElement).click();
  }
  statsCell(catKey: string) {
    const kit = this.kit;
    if (catKey === 'adminsonly') return html`<div class="board-stats">🔒 admins alone</div>`;
    const c = this.stats && this.stats[catKey];
    if (this.stats === null) return html`<div class="board-stats">—</div>`;
    if (!c) return html`<div class="board-stats">quiet so far</div>`;
    const latest = c.latest && c.latest.title ? (() => {
      const t = String(c.latest.title);
      const titleText = t.length > 42 ? t.slice(0, 42) + '…' : t;
      const who = c.latest.author_hash ? (c.latest.nick || kit.displayName(c.latest.author_hash)) : 'Anonymous';
      const href = 'community.html?topic=' + c.latest.topic_id +
        (c.latest.id ? '#comment-' + c.latest.id : '');
      return html`<div class="board-latest"><a href=${href}>${titleText + ' · ' + who}</a> · ${kit.fmtDateTime(c.latest.created_at)}</div>`;
    })() : nothing;
    return html`<div class="board-stats">
      <div>${c.topics + (c.topics === 1 ? ' topic · ' : ' topics · ') + c.posts + (c.posts === 1 ? ' post' : ' posts')}</div>
      ${latest}</div>`;
  }
  render() {
    const kit = this.kit;
    if (!kit) return nothing;
    return html`
      <p class="board-intro"><small>A board for exploring what it means to be merely catholic.</small></p>
      <div class="comment-identity"></div>
      <div class="key-box" hidden></div>
      <div class="mc-index-search"></div>
      ${this.unreadTotal > 0 ? html`<p class="board-intro">
          ${this.unreadTotal + (this.unreadTotal === 1 ? ' new thread since your last visit. ' : ' new threads since your last visit. ')}
          <a class="identity-action" href="#" @click=${this.markAllRead}>Mark all read</a></p>` : nothing}
      <div class="board-cats">
        ${kit.CATS.map((cat: any) => {
          const isBack = cat[0] === 'adminsonly';
          const unread = this.byCat && this.byCat[cat[0]];
          return html`<div class=${isBack ? 'board-cat board-cat-admin mc-cardnav' : 'board-cat mc-cardnav'}
              @click=${this._catNav}
              style=${isBack && !this.adminOn ? 'display:none' : nothing}>
            <div class="board-cat-left">
              <a class="board-cat-name" href=${'community.html?cat=' + cat[0]}>${cat[1]}</a>${unread ? html`<span class="dm-unread"> (${unread} new)</span>` : nothing}
              <div class="board-cat-desc">${cat[2]}${cat[3] ? html`<a href=${cat[4]}>${cat[3]}</a>.` : nothing}</div>
            </div>
            ${this.statsCell(cat[0])}
          </div>`;
        })}
      </div>
      <p class="board-audit-link">${this.adminOn ? html`<a class="identity-action" href="community.html?admin=1">Administrative options</a>` : nothing}</p>
    `;
  }
}
customElements.define('mc-board-index', McBoardIndex);

class McBoardCat extends LitElement {
  declare kit: any;
  declare catKey: string;
  declare pageNum: number;
  declare payload: any;
  declare unread: any;
  declare err: string;
  declare _onLive?: (ev: Event) => void;
  declare _refetchT?: ReturnType<typeof setTimeout>;
  static properties = {
    payload: { attribute: false }, unread: { attribute: false }, err: { attribute: false },
  };
  constructor() {
    super();
    this.kit = null;
    this.catKey = '';
    this.pageNum = 1;
    this.payload = null;
    this.unread = null;
    this.err = '';
  }
  createRenderRoot() { return this; }
  connectedCallback() {
    super.connectedCallback();
    const kit = this.kit;
    const cat = kit.catByKey(this.catKey);
    document.title = cat[1] + ' | Community';
    this.pageNum = Math.max(1, Math.floor(Number(new URLSearchParams(location.search).get('p')) || 1));
    (this.catKey === 'adminsonly'
      ? kit.cachedJson(kit.API + '/board/admin', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: kit.state.key || '', p: this.pageNum }),
        }, 45000)
      : kit.cachedJson(kit.API + '/board/cat?cat=' + this.catKey + '&p=' + this.pageNum + kit.freshParam('&'), kit.freshOpts(), 45000))
      .then((d: any) => {
        if (!d.ok) {
          if (this.catKey === 'adminsonly') { kit.goIndex(); return; }
          throw new Error(d.error || 'failed');
        }
        this.payload = d;
        if (kit.state.key) {
          kit.cachedJson(kit.API + '/board/reads', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: kit.state.key, cat: this.catKey }),
          }, 45000).then((rd: any) => {
            if (kit.blockedOut(rd) || !rd.ok) return;
            this.unread = rd.unread || [];
          }).catch(() => {});
        }
      })
      .catch(() => { this.err = 'Could not load the topics. Reload to retry.'; });
    /* Live: new topics appear and rows re-sort as posts happen (page 1 only —
       new activity always lands on the first page). The back room isn't broadcast. */
    if (window.mcLive && this.catKey !== 'adminsonly') window.mcLive.board.sub(['cat:' + this.catKey]);
    this._onLive = (ev: Event) => this._applyLive((ev as CustomEvent).detail);
    document.addEventListener('mc-live', this._onLive);
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._onLive) document.removeEventListener('mc-live', this._onLive);
    if (this._refetchT) clearTimeout(this._refetchT);
    if (window.mcLive) window.mcLive.board.leave();
  }
  _refetchCat() {
    if (this._refetchT) clearTimeout(this._refetchT);
    const kit = this.kit;
    this._refetchT = setTimeout(() => {
      kit.fetchRetry(kit.API + '/board/cat?cat=' + this.catKey + '&p=1&cb=' + Date.now(), {}, [1000])
        .then((r: Response) => r.json()).then((d: any) => { if (d && d.ok) this.payload = d; }).catch(() => {});
    }, 1500);
  }
  _applyLive(m: any) {
    if (!m || !this.payload) return;
    if (m.cat !== this.catKey && m.from !== this.catKey) return;   // for-this-category only
    const p = this.payload;
    if (m.t === 'new-topic' && m.cat === this.catKey) {
      if (this.pageNum !== 1) return;                       // new topics land on page 1
      if (p.topics.some((t: any) => t.id === m.topic.id)) return;   // dedup (own post / multi-tab)
      this.payload = { ...p, topics: sortTopics([m.topic, ...p.topics]), total: (p.total || 0) + 1 };
    } else if (m.t === 'topic-stats' && m.cat === this.catKey) {
      if (p.topics.some((t: any) => t.id === m.topic_id)) {
        const topics = p.topics.map((x: any) => x.id === m.topic_id
          ? { ...x, replies: m.replies, last: m.last, last_id: m.last_id, author_hash: m.author_hash, nick: m.nick }
          : x);
        this.payload = { ...p, topics: sortTopics(topics) };
      } else if (this.pageNum === 1) {
        /* a topic not on this page got a reply and should bump to the top of
           page 1 — a stats event lacks its full row (author, created_at, flags),
           so refetch page 1 lightly (debounced), exactly as the index does */
        this._refetchCat();
      }
    } else if ((m.t === 'moderation' && m.act === 'delete') || m.t === 'moved') {
      /* a whole topic removed from, or moved out of, this category */
      if (!p.topics.some((t: any) => t.id === m.id)) return;
      this.payload = { ...p, topics: p.topics.filter((t: any) => t.id !== m.id), total: Math.max(0, (p.total || 1) - 1) };
    } else if (m.t === 'moderation' && (m.act === 'lock' || m.act === 'unlock' || m.act === 'sticky' || m.act === 'unsticky')) {
      if (!p.topics.some((t: any) => t.id === m.topic_id)) return;
      const topics = p.topics.map((t: any) => t.id === m.topic_id
        ? { ...t, locked: m.locked != null ? m.locked : t.locked, sticky: m.sticky != null ? m.sticky : t.sticky }
        : t);
      this.payload = { ...p, topics: sortTopics(topics) };
    }
  }
  firstUpdated() {
    /* the composer below the listing is Wave C's machinery — mounted through
       the kit exactly as the old view mounted it, appended after this element */
    const kit = this.kit;
    const key = this.catKey;
    kit.buildBoardForm(true, 'Start a topic');
    kit.boardButtons('Post topic', () => {
      const section = this.parentElement!;
      const ta = section.querySelector('.comment-form .comment-text') as HTMLTextAreaElement & { mcPreview?: { off(): void }; mcDraftDone?: () => void };
      const titleBox = section.querySelector('.comment-form .board-title') as HTMLInputElement;
      const title = titleBox.value.replace(/\s+/g, ' ').trim();
      const body = ta.value.replace(/\s+$/, '');
      const status = section.querySelector('.form-status') as HTMLElement;
      if (ta.mcPreview && (title.length < 3 || !body.trim())) ta.mcPreview.off();
      if (title.length < 3) { titleBox.focus(); return; }
      if (!body.trim()) { ta.focus(); return; }
      kit.boardPost({ cat: key, title, body }, (d: any) => {
        if (ta.mcDraftDone) ta.mcDraftDone();
        if (d.status === 'pending') {
          status.textContent = 'Held for review. It will appear once approved.';
          titleBox.value = '';
          ta.value = '';
          if (ta.mcPreview) ta.mcPreview.off();
        } else {
          location.href = 'community.html?topic=' + d.comment.id;
        }
      });
    });
    kit.armBoardForm();
    const section = this.parentElement!;
    kit.attachMentions(section.querySelector('.comment-form .comment-text'));
    kit.attachDraft(section.querySelector('.comment-form .comment-text'), 'topic:' + key,
      section.querySelector('.comment-form .board-title'));
  }
  updated() {
    /* admin corners are Wave E machinery: mount imperatively per row, once */
    const kit = this.kit;
    if (!kit.isAdmin() || !this.payload) return;
    this.querySelectorAll('.board-topic[data-tid]').forEach((row) => {
      if (row.hasAttribute('data-corner')) return;
      row.setAttribute('data-corner', '1');
      const t = this.payload.topics.find((x: any) => String(x.id) === row.getAttribute('data-tid'));
      if (t) row.appendChild(kit.topicAdminCorner(t, this.catKey));
    });
  }
  /* The whole topic row is a click target into the topic; a nested link (the
     title itself, a pager page, the last-poster jump, an admin control) still
     wins, and a text selection never navigates. */
  _topicNav(e: Event) {
    if ((e.target as HTMLElement).closest('a, button, select, input, label')) return;
    if (window.getSelection && String(window.getSelection()).length) return;
    const a = (e.currentTarget as HTMLElement).querySelector('.board-topic-title');
    if (a) (a as HTMLElement).click();
  }
  topicRow(t: any) {
    const kit = this.kit;
    const isNew = this.unread && this.unread.indexOf(t.id) !== -1;
    const who = t.author_hash ? (t.nick || kit.displayName(t.author_hash)) : 'Anonymous';
    return html`<div class="board-topic mc-cardnav" data-tid=${t.id} @click=${this._topicNav}>
      <div class="board-topic-left">
        <a class=${isNew ? 'board-topic-title dm-unread' : 'board-topic-title'}
           href=${'community.html?topic=' + t.id}>${t.title}</a>${isNew ? html`<span class="dm-unread"> ● new</span>` : nothing}
        ${t.sticky ? html`<span class="board-sticky">(sticky)</span>` : nothing}
        ${t.locked ? html`<span class="board-locked">(locked)</span>` : nothing}
        ${pagerTpl(t.replies, 20, 0, (i) => 'community.html?topic=' + t.id + '&p=' + i, 'board-pages topic-pages')}
      </div>
      <div class="board-stats">
        <a href=${'community.html?topic=' + t.id + '#comment-' + (t.last_id || t.id)}>${who}</a>
        ${' · ' + t.replies + (t.replies === 1 ? ' reply · ' : ' replies · ') + kit.fmtDateTime(t.last)}
      </div>
    </div>`;
  }
  render() {
    const kit = this.kit;
    if (!kit) return nothing;
    const cat = kit.catByKey(this.catKey);
    const hrefFor = (i: number) => 'community.html?cat=' + this.catKey + '&p=' + i;
    return html`
      <p class="board-crumb"><a href="community.html">Community</a> › <span>${cat[1]}</span>
        ${this.catKey === 'adminsonly' ? nothing : html` <a class="comments-rss" href=${kit.API + '/feed?cat=' + this.catKey} title="Follow this category with a feed reader">RSS</a>`}</p>
      <h1 class="mc-screen-title">${cat[1]}</h1>
      <p class="board-cat-desc">${cat[2]}${cat[3] ? html`<a href=${cat[4]}>${cat[3]}</a>.` : nothing}</p>
      ${this.payload ? pagerTpl(this.payload.total, this.payload.per, this.payload.page, hrefFor) : nothing}
      <div class="board-topics">
        ${this.err ? html`<p class="comments-status">${this.err}</p>`
        : !this.payload ? html`<p class="comments-status">Loading topics...</p>`
        : this.payload.topics.length === 0
          ? html`<p class="comments-status">No topics yet. Yours can be the first.</p>`
          : repeat(this.payload.topics, (t: any) => t.id, (t: any) => this.topicRow(t))}
      </div>
      ${this.payload ? pagerTpl(this.payload.total, this.payload.per, this.payload.page, hrefFor) : nothing}
    `;
  }
}
customElements.define('mc-board-cat', McBoardCat);

window.mcViews = window.mcViews || {};
window.mcViews.boardIndex = function (section, kit) {
  const node = document.createElement('mc-board-index') as McBoardIndex;
  node.kit = kit;
  section.appendChild(node);
};
window.mcViews.boardCat = function (section, kit, key) {
  const node = document.createElement('mc-board-cat') as McBoardCat;
  node.kit = kit;
  node.catKey = key;
  section.appendChild(node);
};
