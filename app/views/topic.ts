/* The topic view (interior campaign, Wave B4): <mc-topic>. Renders one
   thread — crumb, head (sticky/locked marks, RSS), watch toggle, the posts
   through the shared renderer (window.mcViews.commentNode), and the pagers —
   reactively over the store; the reply composer, watch control, mentions,
   and draft are the kit's proven machinery mounted in place (Wave C owns the
   composer itself). The scroll-to-comment `find` contract is preserved: a
   bare #comment-N link takes the server's find branch to resolve the page,
   and the target is scrolled into view after paint. An admins-only topic is
   fetched through the keyed door exactly as the old view did — the public
   refusal is indistinguishable from a missing topic, so a keyed reader
   knocks once and the server judges. */

import { LitElement, html, nothing } from 'lit';
import { pagerTpl, crumbTpl, retryTpl } from './util.ts';
import * as Core from '../core.ts';

class McTopic extends LitElement {
  static properties = { d: { attribute: false }, err: { attribute: false },
    newAway: { attribute: false }, newLastPage: { attribute: false } };
  declare kit: any;
  declare topicId: number;
  declare d: any;
  declare err: string;
  declare newAway: number;
  declare newLastPage: number;
  declare _onLive?: (ev: any) => void;
  declare _onResync?: () => void;
  declare _mounted?: boolean;
  constructor() {
    super();
    this.kit = null;
    this.topicId = 0;
    this.d = null;
    this.err = '';
    this.newAway = 0;      // replies pushed live that live on a later page
    this.newLastPage = 0;  // the page to jump to for them
  }
  createRenderRoot() { return this; }
  connectedCallback() {
    super.connectedCallback();
    const kit = this.kit;
    const id = this.topicId;
    const qs = new URLSearchParams(location.search);
    const pNum = Math.floor(Number(qs.get('p')) || 0);
    const hashMatch = /^#comment-(\d+)$/.exec(location.hash);
    const extra = pNum ? '&p=' + pNum : (hashMatch ? '&find=' + hashMatch[1] : '');
    kit.cachedJson(kit.API + '/board/topic?id=' + id + extra + kit.freshParam('&'), kit.freshOpts(), 30000)
      .then((d: any) => {
        if (d && !d.ok && kit.state.key) {
          return kit.fetchRetry(kit.API + '/board/admin', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: kit.state.key, id: id, p: pNum || undefined,
              find: hashMatch ? hashMatch[1] : undefined }),
          }, [1000, 3000]).then((r: Response) => r.json());
        }
        return d;
      })
      .then((d: any) => {
        if (!d.ok) throw new Error(d.error || 'failed');
        this.d = d;
        document.title = d.topic.title + ' | Community';
        /* Mark the thread read (deduped in the kit, so paging within it does not
           re-write on every page turn). */
        if (kit.state.key) kit.markThreadRead(d.topic.id);
      })
      .catch((e: any) => { this.err = e.message || 'failed'; });

    /* Live: watch this thread and merge pushed replies in place (Facebook-style).
       Optional — if the shell/socket is absent the view behaves exactly as before. */
    if (window.mcLive) window.mcLive.board.sub(['topic:' + id]);
    this._onLive = (ev) => this._applyLive(ev.detail);
    this._onResync = () => this._catchUp();
    document.addEventListener('mc-live', this._onLive);
    document.addEventListener('mc-live-resync', this._onResync);
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._onLive) document.removeEventListener('mc-live', this._onLive);
    if (this._onResync) document.removeEventListener('mc-live-resync', this._onResync);
    if (window.mcLive) window.mcLive.board.leave();
  }
  /* A pushed reply for this topic: append it if it belongs on the shown page and
     is not already here (dedups the poster's own optimistic append + multi-tab). */
  _applyLive(m: any) {
    if (!m || !this.d) return;
    if (String(m.topic_id) !== String(this.topicId) &&
        !(m.t === 'moderation' && String(m.id) === String(this.topicId))) return;
    const kit = this.kit;
    const d = this.d;
    if (m.t === 'new-reply') {
      if (d.topic.locked) return;
      const c = m.comment;
      if (!c || this.querySelector('#comment-' + c.id)) return;   // dedup own/multi-tab
      d.total += 1;
      const replyPage = Core.replyPage(d.total, d.per);
      if (replyPage === d.page) {
        /* it belongs on the page in front of the reader — drop it in live */
        const list = this.querySelector('.comments-list');
        if (list) {
          const node = kit.commentNode(c, false, { topicId: this.topicId });
          list.appendChild(node);
          node.classList.add('mc-live-new');
          setTimeout(() => { node.classList.remove('mc-live-new'); }, 2200);
        }
      } else if (replyPage > d.page) {
        /* it opened (or filled) a later page — nudge with a pill to jump there */
        this.newAway = (this.newAway || 0) + 1;
        this.newLastPage = replyPage;
      }
      /* the thread grew: refresh the pagers so the new page count shows. The
         comments-list is a static template node with no bindings inside, so a
         re-render leaves the imperatively-appended posts in place. */
      this.requestUpdate();
    } else if (m.t === 'moderation') {
      if (m.act === 'delete') {
        if (String(m.id) === String(this.topicId)) { this.err = 'No such topic.'; this.d = null; }
        else { const node = this.querySelector('#comment-' + m.id); if (node) node.remove(); }
      } else if (m.act === 'lock' || m.act === 'unlock') {
        this.d = { ...d, topic: { ...d.topic, locked: m.act === 'lock' ? 1 : 0 } };
      } else if (m.act === 'readonly' || m.act === 'unreadonly') {
        this.d = { ...d, topic: { ...d.topic, readonly: m.act === 'readonly' ? 1 : 0 } };
      }
      /* sticky/unsticky change nothing visible inside the thread */
    } else if (m.t === 'edited') {
      /* an author edited a post: re-render its body in place if it is on the
         page in front of the reader (else the fresh text loads when they reach
         its page). window.mcRich is the one living body renderer. */
      const bodyEl = this.querySelector('#comment-' + m.id + ' .comment-body');
      if (bodyEl && window.mcRich) {
        bodyEl.textContent = '';
        window.mcRich.fillBody(bodyEl, m.body);
        bodyEl.classList.add('mc-live-new');
        setTimeout(() => { bodyEl.classList.remove('mc-live-new'); }, 2200);
      }
    }
  }
  /* On reconnect (e.g. tab returned from hidden), pull any replies missed while
     away and append the ones not already shown. */
  _catchUp() {
    const kit = this.kit;
    const d = this.d;
    if (!kit || !d || d.topic.locked) return;
    kit.fetchRetry(kit.API + '/board/topic?id=' + this.topicId + '&p=' + d.page + kit.freshParam('&'),
      kit.freshOpts(), [1000]).then((r: Response) => r.json()).then((fresh: any) => {
      if (!fresh || !fresh.ok || fresh.page !== d.page) return;
      const list = this.querySelector('.comments-list');
      if (!list) return;
      (fresh.replies || []).forEach((c: any) => {
        if (!this.querySelector('#comment-' + c.id)) {
          list.appendChild(kit.commentNode(c, false, { topicId: this.topicId }));
        }
      });
      d.total = fresh.total;
      this.requestUpdate();   // pages may have grown while we were away
    }).catch(() => {});
  }
  updated() {
    if (!this.d || this._mounted) return;
    this._mounted = true;
    const kit = this.kit;
    const d = this.d;
    const id = this.topicId;
    /* the comment list: topic head on page 1, then replies — through the one
       shared renderer, so every post-behavior contract holds */
    const list = this.querySelector('.comments-list') as HTMLElement;
    if (d.page === 1) list.appendChild(kit.commentNode(d.topic, false, { topicId: id }));
    d.replies.forEach((c: any) => list.appendChild(kit.commentNode(c, false, { topicId: id })));
    /* the watch toggle (kit machinery) + the save-for-later toggle */
    const watchSlot = this.querySelector('.mc-watch-slot');
    if (watchSlot && kit.state.key) {
      watchSlot.appendChild(kit.watchToggle(d.topic.id));
      if (kit.bookmarkToggle) {
        watchSlot.appendChild(document.createTextNode(' · '));
        const sv = kit.el('a', 'identity-action', 'save') as HTMLAnchorElement;
        sv.href = '#';
        sv.title = 'Save this topic to your saved posts';
        let on = false;
        sv.addEventListener('click', (e: Event) => {
          e.preventDefault();
          on = !on;
          sv.textContent = on ? 'saved ✓' : 'save';
          kit.bookmarkToggle('topic', d.topic.id, on).then((r: any) => {
            if (!r || !r.ok) { on = !on; sv.textContent = on ? 'saved ✓' : 'save'; }
          });
        });
        watchSlot.appendChild(sv);
      }
    }
    /* Locked closes the thread to everyone; read-only closes it to non-admins
       only (admins fall through to the composer, as on the classic path). */
    if (d.topic.locked || (d.topic.readonly && !kit.isAdmin())) {
      this.scrollToHash();
      kit.annotateMeta('board:' + d.cat);
      return;
    }
    /* the reply composer (Wave C machinery) mounts into `section` via the kit,
       exactly as the board-cat view mounts its new-topic form */
    const section = this.parentElement as HTMLElement;
    kit.buildBoardForm(false, 'Reply');
    kit.boardButtons('Reply', () => {
      const ta = section.querySelector('.comment-form .comment-text') as any;
      const body = ta.value.replace(/\s+$/, '');
      const status = section.querySelector('.form-status') as HTMLElement;
      if (!body.trim()) { if (ta.mcPreview) ta.mcPreview.off(); ta.focus(); return; }
      kit.boardPost({ topic: id, body }, (d2: any) => {
        ta.value = '';
        if (ta.mcDraftDone) ta.mcDraftDone();
        if (ta.mcPreview) ta.mcPreview.off();
        if (d2.status === 'pending') { status.textContent = 'Held for review. It will appear once approved.'; return; }
        const replyPage = Core.replyPage(d.total + 1, d.per);
        if (replyPage === d.page) {
          /* dedup: the live broadcast of our own reply may have already added it */
          let node: any = list.querySelector('#comment-' + d2.comment.id);
          if (!node) { d.total += 1; node = kit.commentNode(d2.comment, false, { topicId: id }); list.appendChild(node); }
          status.textContent = 'Posted.';
          node.scrollIntoView();
        } else {
          location.href = 'community.html?topic=' + id + '&p=' + replyPage + '#comment-' + d2.comment.id;
        }
      });
    });
    kit.armBoardForm();
    kit.attachMentions(section.querySelector('.comment-form .comment-text'));
    kit.attachDraft(section.querySelector('.comment-form .comment-text'), 'reply:' + id);
    this.scrollToHash();
    kit.annotateMeta('board:' + d.cat);
  }
  scrollToHash() {
    if (!/^#comment-\d+$/.test(location.hash)) return;
    const t = document.getElementById(location.hash.slice(1));
    if (t) t.scrollIntoView();
  }
  render() {
    const kit = this.kit;
    if (!kit) return nothing;
    if (this.err) {
      return html`${crumbTpl([['Community', 'community.html'], ['Topic']])}
        <p class="comments-status">${this.err === 'No such topic.'
          ? 'No such topic. It may have been removed.'
          : html`The topic could not be loaded.${retryTpl(this, { kit: this.kit, topicId: this.topicId })}`}</p>`;
    }
    if (!this.d) {
      return html`${crumbTpl([['Community', 'community.html'], ['Topic']])}
        <p class="comments-status">Loading…</p>`;
    }
    const d = this.d;
    const cat = kit.catByKey(d.cat);
    const href = (i: number) => 'community.html?topic=' + this.topicId + '&p=' + i;
    return html`
      ${crumbTpl([['Community', 'community.html'], [cat[1], 'community.html?cat=' + d.cat], [d.topic.title]])}
      <h2 class="board-topic-head">${d.topic.title}${d.topic.sticky ? html`<span class="board-sticky">(sticky)</span>` : nothing}${d.topic.locked ? html`<span class="board-locked">(locked)</span>` : nothing}${d.topic.readonly ? html`<span class="board-locked">(read only)</span>` : nothing}${d.cat === 'adminsonly' ? nothing : html`<a class="comments-rss" href=${kit.API + '/feed?topic=' + d.topic.id} title="Follow this topic with a feed reader">RSS</a>`}</h2>
      ${kit.state.key ? html`<p class="board-intro mc-watch-slot"></p>` : nothing}
      ${this.newAway ? html`<a class="mc-live-pill" href=${href(this.newLastPage)}>↓ ${this.newAway} new repl${this.newAway === 1 ? 'y' : 'ies'} — go to page ${this.newLastPage}</a>` : nothing}
      ${pagerTpl(d.total, d.per, d.page, href)}
      <div class="comments-list"></div>
      ${pagerTpl(d.total, d.per, d.page, href)}
      ${d.topic.locked ? html`<p class="comments-status">This topic is locked. No new replies.</p>` : nothing}
      ${!d.topic.locked && d.topic.readonly && !kit.isAdmin() ? html`<p class="comments-status">This is a read-only topic. Only the site can post here.</p>` : nothing}
    `;
  }
}
customElements.define('mc-topic', McTopic);

class McSearch extends LitElement {
  static properties = { d: { attribute: false }, count: { attribute: false } };
  declare kit: any;
  declare d: any;
  declare count: string;
  declare q: string;
  declare cat0: string;
  declare author0: string;
  declare sort0: string;
  declare page: number;
  constructor() {
    super();
    this.kit = null;
    this.d = null;
    this.count = '';
  }
  createRenderRoot() { return this; }
  connectedCallback() {
    super.connectedCallback();
    const kit = this.kit;
    document.title = 'Search | Community';
    if (!(kit.state.key && kit.state.myHash)) { this.count = 'gate'; return; }
    const qs = new URLSearchParams(location.search);
    this.q = qs.get('q') || '';
    this.cat0 = qs.get('cat') || '';
    this.author0 = qs.get('author') || '';
    this.sort0 = qs.get('sort') || '';
    this.page = Math.max(1, Math.floor(Number(qs.get('p')) || 1));
    if (!this.q.trim()) { this.count = 'Type a search above. Put "quotes" around an exact phrase.'; return; }
    this.count = 'Searching...';
    let u = kit.API + '/search?q=' + encodeURIComponent(this.q);
    if (this.cat0) u += '&cat=' + encodeURIComponent(this.cat0);
    if (this.author0) u += '&author=' + encodeURIComponent(this.author0);
    if (this.sort0) u += '&sort=' + encodeURIComponent(this.sort0);
    kit.cachedJson(u + '&p=' + this.page + kit.freshParam('&'), kit.freshOpts(), 30000)
      .then((d: any) => {
        if (!d.ok) throw new Error(d.error || 'failed');
        this.d = d;
        this.count = d.items.length ? (d.total + (d.total === 1 ? ' result.' : ' results.')) : 'Nothing found for that search.';
      })
      .catch(() => { this.count = ''; this.d = { error: true }; });
  }
  firstUpdated() { this.mountForm(); this.mountSelects(); }
  updated() { this.mountSnippets(); this.mountSelects(); }
  /* App bottom-sheet pickers over the category + sort selects on phones (desktop
     keeps the native selects). Re-applied each render; mcSelectSheet is
     re-entrant, so a Lit reconcile that drops the button rebuilds it. */
  mountSelects() {
    if (!window.mcSelectSheet) return;
    const cat = this.querySelector('.mc-cat');
    const sort = this.querySelector('.mc-sort');
    if (cat) { cat.setAttribute('aria-label', 'Category'); window.mcSelectSheet(cat); }
    if (sort) { sort.setAttribute('aria-label', 'Sort'); window.mcSelectSheet(sort); }
  }
  mountForm() {
    const kit = this.kit;
    const form = this.querySelector('.board-search') as HTMLFormElement;
    if (!form || (form as any)._armed) return;
    (form as any)._armed = true;
    const authorInput = form.querySelector('.mc-author');
    const picker = kit.attachAuthorPicker(authorInput);
    if (/^[0-9a-f]{64}$/.test(this.author0 || '')) picker.set(this.author0, kit.displayName(this.author0));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      let u = 'community.html?q=' + encodeURIComponent((form.querySelector('.mc-q') as HTMLInputElement).value.trim());
      if ((form.querySelector('.mc-cat') as HTMLSelectElement).value) u += '&cat=' + (form.querySelector('.mc-cat') as HTMLSelectElement).value;
      if (picker.hash()) u += '&author=' + picker.hash();
      if ((form.querySelector('.mc-sort') as HTMLSelectElement).value) u += '&sort=' + (form.querySelector('.mc-sort') as HTMLSelectElement).value;
      location.href = u;
    });
  }
  mountSnippets() {
    const kit = this.kit;
    if (!this.d || this.d.error) return;
    this.querySelectorAll('.mc-snip[data-snip]').forEach((slot: any) => {
      if (slot._done) return;
      slot._done = true;
      slot.appendChild(kit.searchSnippet(slot.getAttribute('data-snip')));
    });
  }
  resultRow(it: any) {
    const kit = this.kit;
    const who = it.nick || (it.author_hash ? kit.displayName(it.author_hash) : 'Anonymous');
    const ce = kit.catByKey(it.cat);
    return html`<div class="board-topic"><div class="board-topic-left">
      <a class="board-topic-title" href=${'community.html?topic=' + it.topic_id + '#comment-' + it.comment_id}>${it.title || 'a thread'}</a>
      ${it.snip ? html`<div class="mc-snip" data-snip=${it.snip}></div>` : nothing}
      </div><div class="board-stats" title=${kit.fmtDateTime(it.created_at)}>${who + ' · ' + (ce ? ce[1] : it.cat) + ' · ' + kit.fmtTimeCompact(it.created_at)}</div></div>`;
  }
  render() {
    const kit = this.kit;
    if (!kit) return nothing;
    if (this.count === 'gate') {
      return html`${crumbTpl([['Community', 'community.html'], ['Search']])}
        <p class="comments-status">Search is for logged-in members. Create an identity or paste your key above, then search the board.</p>`;
    }
    const href = (i: number) => {
      let u = 'community.html?q=' + encodeURIComponent(this.q);
      if (this.cat0) u += '&cat=' + encodeURIComponent(this.cat0);
      if (this.author0) u += '&author=' + encodeURIComponent(this.author0);
      if (this.sort0) u += '&sort=' + encodeURIComponent(this.sort0);
      return u + '&p=' + i;
    };
    const d = this.d && !this.d.error ? this.d : null;
    /* The two "nothing here" messages become app blank slates on phones (a big
       search glyph + roomy text); every other status (Searching…, "3 results.")
       stays the plain inline line. */
    const status = this.count === 'Nothing found for that search.'
      ? html`<p class="comments-status mc-empty" data-ico="🔍">Nothing found for that search. Try fewer or different words.</p>`
      : this.count === 'Type a search above. Put "quotes" around an exact phrase.'
        ? html`<p class="comments-status mc-empty" data-ico="🔍">Search the board. Put "quotes" around an exact phrase.</p>`
        : html`<p class="comments-status">${this.count}</p>`;
    return html`
      ${crumbTpl([['Community', 'community.html'], ['Search']])}
      <h1 class="mc-screen-title">Search</h1>
      <form class="board-search">
        <div class="key-row">
          <input class="key-input mc-q" type="search" .value=${this.q || ''}
            placeholder='Search the board... "quotes" for an exact phrase'>
          <button class="btn btn-send" type="submit">Search</button>
        </div>
        <div class="key-row">
          <select class="board-move mc-cat">
            <option value="">All categories</option>
            ${kit.CATS.filter((c: any) => c[0] !== 'adminsonly').map((c: any) =>
              html`<option value=${c[0]} ?selected=${c[0] === this.cat0}>${c[1]}</option>`)}
          </select>
          <input class="key-input mc-author" type="text" placeholder="@author (optional)">
          <select class="board-move mc-sort">
            <option value="" ?selected=${!this.sort0}>Most relevant</option>
            <option value="new" ?selected=${this.sort0 === 'new'}>Newest first</option>
          </select>
        </div>
      </form>
      ${status}
      <div class="board-topics">
        ${d && d.items && d.items.length ? d.items.map((it: any) => this.resultRow(it)) : nothing}
        ${this.d && this.d.error ? html`<p class="comments-status">Search could not be run.${retryTpl(this, { kit: this.kit })}</p>` : nothing}
      </div>
      ${d && d.items && d.items.length ? pagerTpl(d.total, d.per, d.page, href) : nothing}
    `;
  }
}
customElements.define('mc-search', McSearch);

window.mcViews = window.mcViews || {};
window.mcViews.topic = function (section, kit, id) {
  const n = document.createElement('mc-topic') as McTopic;
  n.kit = kit; n.topicId = id;
  section.appendChild(n);
};
window.mcViews.search = function (section, kit) {
  const n = document.createElement('mc-search') as McSearch;
  n.kit = kit;
  section.appendChild(n);
};
