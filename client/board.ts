/* The forum (Wave F, 2026-09-11 — moved out of comments.ts verbatim): the
   classic board views, the comment renderer, quoting, editing, the board
   composer form, the journal, search, and the post menu. */
import type { Boot } from './boot';

export function installBoard(B: Boot) {
  /* Names this module takes from the boot — the root's helpers and the other
     modules' exports — bound in bind() once every module is installed, so
     order of installation never matters and every body reads as it did. */
  let ADMIN_HASHES: any;
  let API: any;
  let BLOCK_CONFIRM: any;
  let MERECAT_BOT_HASH: any;
  let afterEdit: (ta: any) => any;
  let annotateMeta: (forPage?: any) => any;
  let appConfirm: (msg: any, opts: any, cb: any) => any;
  let attachBoardMedia: (form: any) => any;
  let attachDraft: (ta: any, ctx: string, titleInput?: any, overwrite?: boolean) => any;
  let attachMentions: (textarea: any) => any;
  let authorNode: (hash: any, nick: any, withSub: any, faith?: any, posts?: any) => any;
  let blockedOut: (d: any) => any;
  let browserTz: () => any;
  let busy: (el: any, p: Promise<any>) => any;
  let cachedJson: (url: any, init: any, ttl: any) => Promise<any>;
  let collectAltIps: () => any;
  let collectMentions: (text: any) => any;
  let crumb: (parts: any) => any;
  let displayName: (hash: any) => any;
  let dmLabel: (hash: any, nick: any) => any;
  let dmScore: (q: any, name: any) => any;
  let el: (tag: string, cls?: string | null, text?: string | number | null) => any;
  let ensureDmStyles: () => any;
  let ensureMentionDir: (cb: any) => any;
  let fetchRetry: (url: string, opts: RequestInit | undefined, delays: number[], onRetry?: () => void) => Promise<Response>;
  let fillBody: (node: HTMLElement, text: any, plain?: boolean) => any;
  let fmtDateTime: (epoch: any) => any;
  let fmtTimeCompact: (epoch: any) => any;
  let freshOpts: () => RequestInit | undefined;
  let freshParam: (sep: any) => any;
  let getFaith: () => any;
  let getToken: () => Promise<any>;
  let go: (href: string, replace?: boolean) => any;
  let identityAction: (label: any, onClick: any) => any;
  let isAdmin: () => any;
  let isBlocked: any;
  let isMember: () => any;
  let isMuted: (hash: any) => any;
  let markThreadRead: (topicId: any) => any;
  let mdEditor: (textarea: any, titleInput?: any) => any;
  let mountComments: (host: HTMLElement) => any;
  let notifCacheSet: (n: any) => any;
  let pageBar: (total: number, per: number, curPage: number, hrefFor: ((n: number) => string) | null, onGo?: (n: number) => void) => HTMLElement | null;
  let pageHref: any;
  let pageKey: any;
  let previewButton: (ta: any) => any;
  let profileHref: (hash: any) => any;
  let renderIdentity: () => any;
  let section: any;
  let setBlock: (hash: any, on: any, done?: any) => any;
  let skelInto: (node: any, kind?: string) => any;
  let skeleton: (kind?: string) => any;
  let stampFresh: () => any;
  let state: any;
  let topicAdminCorner: (topic: any, curCat: any) => any;
  let trace: (why: string) => any;
  let wallMediaNode: (mediaKey: any, post: any) => any;
  let wallPostNode: (p: any, expand?: boolean) => any;
  let armHold: (node: any, open: (at: any) => void, opts?: any) => any;
  let openActs: (spec: any) => any;
  let reactLoadMine: (target: any, ids: any[]) => any;
  let reactMine: (target: any, id: any) => string;
  let reactRegister: (target: any, id: any, host: any, seed: any, paint?: any) => any;
  let reactSend: (target: any, id: any, emoji: any) => any;

  /* The category display rows. Single-sourced from Domain.Board via window.mcCore
     (the same table the worker reads); the inline copy below is the no-app
     fallback (app disabled / storage blocked ⇒ no mcCore). Keys must match
     BOARD_CATS in the worker — which is why they now come from one PS source.
     The back room (adminsonly) is hidden here by courtesy; the server refuses
     everyone but admins on every path, which is the real lock. */
  var CATS = window.mcCore!.boardCatRows;

  function catByKey(key: any) {
    for (var i = 0; i < CATS.length; i++) if (CATS[i][0] === key) return CATS[i];
    return null;
  }

  /* ---- Rendering ---- */

  /* The reader's current selection, kept only when it lies inside this post's
     body — read on mousedown, before the Quote click can collapse it. Empty
     when there is no in-post selection, so quoteInto falls back to the whole
     post. */
  B.quotedSelection = '';
  function selectionInPost(c: any) {
    try {
      var sel = window.getSelection && window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) return '';
      var post = document.getElementById('comment-' + c.id);
      var bodyEl = post && post.querySelector('.comment-body');
      if (!bodyEl) return '';
      if (!bodyEl.contains(sel.getRangeAt(0).commonAncestorContainer)) return '';
      return sel.toString().replace(/^\s+|\s+$/g, '').slice(0, 1000);
    } catch (e) { return ''; }
  }

  /* A short, clean excerpt: trimmed, cut on a word boundary near n, an ellipsis
     when shortened. Internal newlines are kept so a multi-line quote stays one. */
  function truncate(s: any, n: any) {
    s = String(s == null ? '' : s).replace(/^\s+|\s+$/g, '');
    if (s.length <= n) return s;
    var cut = s.slice(0, n);
    var sp = cut.lastIndexOf(' ');
    if (sp > n * 0.6) cut = cut.slice(0, sp);
    return cut.replace(/\s+$/, '') + '…';
  }

  /* The absolute permalink to a post, in the one form the autolink trusts and
     the board's find-logic resolves to the right page: a board post keys off
     its topic root, a site-page comment off its page path. */
  function permalinkFor(c: any, ctx: any) {
    var origin = 'https://merecatholicity.com';
    if (ctx && ctx.topicId) {
      return origin + '/community.html?topic=' + ctx.topicId + '#comment-' + c.id;
    }
    return origin + ((ctx && ctx.page) || pageHref()) + '#comment-' + c.id;
  }

  /* Drop a quote of post c into the reply composer: an attribution line with
     the permalink, then the excerpt, every line ">"-prefixed so it renders as
     one blockquote. Quotes append, so several can stack for a point-by-point
     reply, and never push the body past its 4000-char cap. */
  function quoteInto(c: any, excerpt: any, url: any) {
    var ta = section.querySelector('.comment-form .comment-text') as any;
    if (!ta) return;
    /* Quoting while previewing swaps back to the editor, so the quote is
       seen to land. */
    if (ta.mcPreview && ta.mcPreview.active) ta.mcPreview.off();
    var name = (c.nick || (c.author_hash ? displayName(c.author_hash) : 'Anonymous'))
      .replace(/[\[\]()\r\n]/g, '');
    var quoted = String(excerpt == null ? '' : excerpt).split('\n')
      .map(function (ln) { return '> ' + ln; }).join('\n');
    /* The attribution is the clickable permalink: its text reads "Name wrote:"
       and its href is the post, so the reader jumps without a raw URL on show. */
    var block = '> [' + name + ' wrote:](' + url + ')\n' + quoted + '\n\n';
    var existing = ta.value;
    var sep = !existing ? '' : (/\n\n$/.test(existing) ? '' : (/\n$/.test(existing) ? '\n' : '\n\n'));
    var addition = sep + block;
    var room = 4000 - existing.length;
    if (room <= 0) { ta.focus(); return; }
    if (addition.length > room) addition = addition.slice(0, room);
    ta.value = existing + addition;
    try { ta.setSelectionRange(ta.value.length, ta.value.length); } catch (e) {}
    afterEdit(ta);
    ta.scrollIntoView({ block: 'center' });
  }

  /* May I edit this post? Its author, or any admin — the kernel's rule
     (Domain.Access.canEdit through mcCore), the server's too. */
  function canEditPost(authorHash: any) {
    return window.mcCore!.canEdit(authorHash, state.myHash, isAdmin());
    return !!state.myHash && (authorHash === state.myHash || isAdmin());
  }
  function commentNode(c: any, pending: any, quoteCtx: any, reveal?: boolean): any {
    /* The Lit view is THE screen (2026-09-16): the bundle always stands — docs/nav.js
       injects it on every page and this boot waits for it — so the classic body that
       once stood in for it is gone; only the door remains. */
    return window.mcViews!.commentNode(window.mcKit, c, pending, quoteCtx, reveal);
  }

  function setStatus(text: any) {
    section.querySelector('.comments-status')!.textContent = text;
  }

  /* Inline editing of one's own comment. Every save is re-screened by the
     server, so a flagged edit sends the comment back to review. */
  function startEdit(c: any, article: any) {
    if (article.querySelector('.comment-editor')) return;
    var bodyDiv = article.querySelector('.comment-body');
    var editor = el('div', 'comment-editor');
    var ta = el('textarea', 'comment-text');
    ta.maxLength = 4000;
    ta.rows = 5;
    ta.value = c.body;
    editor.appendChild(mdEditor(ta));
    /* An edit keeps a draft too, keyed to the comment, and a saved draft that
       differs from the live body wins over the prefill: the crashed half-edit
       is the newer work. */
    attachDraft(ta, 'edit:' + c.id, null, true);
    var row = el('div', 'comment-buttons');
    var save = el('button', 'btn btn-send key-copy', 'Save');
    save.type = 'button';
    row.appendChild(save);
    var pv = previewButton(ta);
    if (pv) row.appendChild(pv);
    editor.appendChild(row);
    var note = el('div', 'comment-note');
    editor.appendChild(note);
    editor.appendChild(identityAction('Cancel', function () {
      if (ta.mcDraftDone) ta.mcDraftDone();
      editor.remove();
      bodyDiv.hidden = false;
    }));
    save.addEventListener('click', function () {
      var newBody = ta.value.replace(/\s+$/, '');
      if (!newBody.trim()) {
        if (ta.mcPreview) ta.mcPreview.off();
        ta.focus();
        return;
      }
      save.disabled = true;
      note.textContent = 'Saving...';
      fetchRetry(API + '/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: c.id, key: state.key, body: newBody }),
      }, [1500], function () { note.textContent = 'Network hiccup, retrying...'; })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (!d.ok) throw new Error(d.error || 'Could not save the edit.');
          try { localStorage.setItem('mc-posted-at', String(Date.now())); } catch (e) {}
          c.body = newBody;
          c.edited_at = d.edited_at;
          if (ta.mcDraftDone) ta.mcDraftDone();
          editor.remove();
          fillBody(bodyDiv, newBody);
          bodyDiv.hidden = false;
          var head = article.querySelector('.comment-head');
          if (!head.querySelector('.comment-edited')) {
            head.insertBefore(el('span', 'comment-edited', 'edited'),
              head.querySelector('.comment-edit'));
          }
          if (d.status === 'pending' && !article.querySelector('.comment-note')) {
            article.className += ' comment-pending';
            article.appendChild(el('p', 'comment-note',
              'Edit held for review. It will reappear here once approved.'));
          }
        })
        .catch(function (err) {
          note.textContent = err.message || 'Network error. Try again in a moment.';
          save.disabled = false;
        });
    });
    bodyDiv.hidden = true;
    article.insertBefore(editor, bodyDiv.nextSibling);
    ta.focus();
  }

  function renderTrustLine(line: any, hash: any, trusted: any) {
    line.textContent = '';
    line.appendChild(document.createTextNode(trusted
      ? 'Trusted. Posts skip the AI spam screen. '
      : 'Untrusted. Posts are AI-screened for spam. '));
    var a = el('a', 'trust-toggle', trusted ? '(toggle-untrusted)' : '(toggle-trusted)');
    a.href = '#';
    a.addEventListener('click', function (e: any) {
      e.preventDefault();
      fetch(API + '/trust', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: state.key, hash: hash, trusted: !trusted }),
      }).then(function (r) { return r.json(); }).then(function (d) {
        if (!d.ok) return;
        section.querySelectorAll('.trust-line[data-hash="' + hash + '"]')
          .forEach(function (l: any) { renderTrustLine(l, hash, d.trusted); });
      }).catch(function () {});
    });
    line.appendChild(a);
  }

  /* ---- Posting ---- */

  function post(asKeyed: any) {
    collectAltIps();
    /* Scoped to the form: an open edit box in the list also wears
       .comment-text, and the first match must not win. */
    var textarea = section.querySelector('.comment-form .comment-text') as any;
    var status = section.querySelector('.form-status') as HTMLElement;
    var body = textarea.value.replace(/\s+$/, '');
    if (!body.trim()) {
      if (textarea.mcPreview) textarea.mcPreview.off();
      textarea.focus();
      return;
    }
    var buttons = section.querySelectorAll('.comment-buttons button');
    buttons.forEach(function (b: any) { b.disabled = true; });
trace('submit: page comment');
    status.textContent = 'Verifying...';
    getToken().then(function (token) {
      status.textContent = 'Posting...';
      return fetchRetry(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          page: pageKey(),
          body: body,
          token: token,
          key: asKeyed ? state.key : '',
          website: (section.querySelector('.hp') as HTMLInputElement).value,
          tz: browserTz(),
          faith: getFaith(),
          ipv4: state.altIps.ipv4 || '',
          ipv6: state.altIps.ipv6 || '',
        }),
      }, [1500], function () { status.textContent = 'Network hiccup, retrying...'; })
        .then(function (r) { return r.json(); });
    }).then(function (d) {
      if (blockedOut(d)) return;
      if (!d.ok) throw new Error(d.error || 'Something went wrong. Please try again.');
      var list = section.querySelector('.comments-list') as HTMLElement;
      list.appendChild(commentNode(d.comment, d.status === 'pending', { page: pageHref() }));
      try { localStorage.setItem('mc-posted-at', String(Date.now())); } catch (e) {}
      textarea.value = '';
      if (textarea.mcDraftDone) textarea.mcDraftDone();
      if (textarea.mcPreview) textarea.mcPreview.off();
      setStatus('');
      status.textContent = d.status === 'pending'
        ? 'Held for review. It will appear once approved.'
        : 'Posted.';
    }).catch(function (err) {
      status.textContent = err.message || 'Could not reach the server. Please try again.';
    }).finally(function () {
      buttons.forEach(function (b: any) { b.disabled = false; });
      if (window.turnstile && state.widgetId !== null) turnstile.reset(state.widgetId);
    });
  }

  function renderButtons() {
    var row = section.querySelector('.comment-buttons') as HTMLElement;
    row.textContent = '';
    if (isMember()) {
      var keyed = el('button', 'btn btn-send', 'Post as ' + (state.myNick || displayName(state.myHash)).split(' ')[0]);
      keyed.type = 'button';
      keyed.addEventListener('click', function () { post(true); });
      row.appendChild(keyed);
      if (state.anonAllowed) {
        var anon = el('button', 'btn btn-anon', 'Post anonymously');
        anon.type = 'button';
        anon.addEventListener('click', function () { post(false); });
        row.appendChild(anon);
      }
    } else {
      var button = el('button', 'btn btn-send', 'Post comment');
      button.type = 'button';
      if (state.anonAllowed) {
        button.addEventListener('click', function () { post(false); });
      } else {
        button.disabled = true;
        button.title = 'Create an identity first. One click, above the box.';
      }
      row.appendChild(button);
    }
    var pv = previewButton(section.querySelector('.comment-form .comment-text'));
    if (pv) row.appendChild(pv);
  }

  function buildBoardForm(withTitle: any, heading: any) {
    var form = el('div', 'comment-form');
    form.appendChild(el('h3', 'board-form-head', heading));
    form.appendChild(el('div', 'comment-identity'));
    var keyBox = el('div', 'key-box');
    keyBox.hidden = true;
    form.appendChild(keyBox);
    var title = null;
    if (withTitle) {
      title = el('input', 'board-title');
      title.type = 'text';
      title.maxLength = 120;
      title.placeholder = 'Topic title';
      form.appendChild(title);
    }
    var textarea = el('textarea', 'comment-text');
    textarea.maxLength = 4000;
    textarea.rows = 5;
    textarea.placeholder = 'Say what you want to say.';
    form.appendChild(mdEditor(textarea, title));
    var hp = el('input', 'hp');
    hp.type = 'text';
    hp.name = 'website';
    hp.tabIndex = -1;
    hp.autocomplete = 'off';
    hp.setAttribute('aria-hidden', 'true');
    form.appendChild(hp);
    form.appendChild(el('div', 'ts-slot'));
    form.appendChild(el('div', 'comment-buttons'));
    form.appendChild(el('p', 'form-status'));
    /* Board attachments (photos / voice notes): the controls appear only once
       /config says the board allows them. Both the classic views AND the Lit
       board/topic composers build through here, so one hook covers both paths. */
    attachBoardMedia(form);
    section.appendChild(form);
    return form;
  }

  function boardButtons(labelBase: any, submit: any) {
    state.boardBtn = [labelBase, submit];
    var row = section.querySelector('.comment-buttons');
    if (!row) return;
    row.textContent = '';
    var keyed = isMember();
    var label = keyed ? labelBase + ' as ' + (state.myNick || displayName(state.myHash)).split(' ')[0] : labelBase;
    var button = el('button', 'btn btn-send', label);
    button.type = 'button';
    if (keyed || state.anonAllowed) {
      button.addEventListener('click', submit);
    } else {
      button.disabled = true;
      button.title = 'Create an identity first. One click, above the box.';
    }
    row.appendChild(button);
    var pv = previewButton(section.querySelector('.comment-form .comment-text'));
    if (pv) row.appendChild(pv);
  }

  function boardPost(payload: any, onSuccess: any) {
    collectAltIps();
    var status = section.querySelector('.form-status') as HTMLElement;
    var buttons = section.querySelectorAll('.comment-buttons button');
    buttons.forEach(function (b: any) { b.disabled = true; });
trace('submit: board post');
    status.textContent = 'Verifying...';
    getToken().then(function (token) {
      status.textContent = 'Posting...';
      payload.token = token;
      payload.key = state.key || '';
      payload.website = (section.querySelector('.hp') as HTMLInputElement).value;
      payload.tz = browserTz();
      payload.faith = getFaith();
      payload.mentions = collectMentions(payload.body || '');
      payload.ipv4 = state.altIps.ipv4 || '';
      payload.ipv6 = state.altIps.ipv6 || '';
      /* An uploaded-but-unposted board attachment rides this post. */
      if (state.boardMedia && state.boardMedia.key) payload.media_key = state.boardMedia.key;
      return fetchRetry(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }, [1500], function () { status.textContent = 'Network hiccup, retrying...'; })
        .then(function (r) { return r.json(); });
    }).then(function (d) {
      if (blockedOut(d)) return;
      if (!d.ok) throw new Error(d.error || 'Something went wrong. Please try again.');
      stampFresh();
      status.textContent = '';
      if (state.boardMedia && state.boardMedia.key) state.boardMedia.clear();
      onSuccess(d);
    }).catch(function (err) {
      status.textContent = err.message || 'Could not reach the server. Please try again.';
    }).finally(function () {
      buttons.forEach(function (b: any) { b.disabled = false; });
      if (window.turnstile && state.widgetId !== null) turnstile.reset(state.widgetId);
    });
  }

  function armBoardForm() {
    renderIdentity();
    new MutationObserver(function () {
      if (state.boardBtn) boardButtons(state.boardBtn[0], state.boardBtn[1]);
    }).observe(section.querySelector('.comment-identity')!, { childList: true });
    /* No challenge for merely arriving at the board: the form's .ts-slot puts
       it under the focus net, which mounts on the first touch of the composer
       and only for a reader the server says needs one. This was the
       community's "white flash" (2026-09-09) — the same mount-on-open the DM
       view lost the day before, still here. */
  }

  function viewIndex() {
    /* The Lit view is THE screen (2026-09-16): the bundle always stands — docs/nav.js
       injects it on every page and this boot waits for it — so the classic body that
       once stood in for it is gone; only the door remains. */
    return window.mcViews!.boardIndex(section, window.mcKit);
  }

  function viewCat(key: any) {
    var cat = catByKey(key);
    if (!cat) return viewIndex();
    /* the back room shows nothing to a keyless visitor — not even its name */
    if (key === 'adminsonly' && !(isMember())) return viewIndex();
    /* The Lit view is THE screen (2026-09-16): the bundle always stands — docs/nav.js
       injects it on every page and this boot waits for it — so the classic body that
       once stood in for it is gone; only the door remains. */
    return window.mcViews!.boardCat(section, window.mcKit, key);
  }

  function viewTopic(id: any) {
    /* The Lit view is THE screen (2026-09-16): the bundle always stands — docs/nav.js
       injects it on every page and this boot waits for it — so the classic body that
       once stood in for it is gone; only the door remains. */
    return window.mcViews!.topic(section, window.mcKit, id);
  }

  /* ================= The Mere Catholicity Journal =================
     A public reading surface over one configured forum topic (server side):
     each post is a journal article. PUBLIC and shareable — no identity needed —
     so the topic is kept read-only to stop members posting into it. Bodies
     render through the one living markdown renderer (fillBody), so scripture
     autolinks and everything else behave exactly as on the board. */
  function journalDateLine(a: any) {
    var meta = el('div', 'journal-meta');
    meta.appendChild(el('time', 'journal-date', fmtDateTime(a.created_at)));
    if (a.author) meta.appendChild(el('span', 'journal-by', ' · ' + a.author));
    if (a.edited_at && a.edited_at > a.created_at) meta.appendChild(el('span', 'journal-edited', ' · updated'));
    return meta;
  }
  function journalShare(id: any) {
    var wrap = el('div', 'journal-share');
    var perma = el('a', 'journal-permalink', 'Permalink');
    perma.href = 'journal.html?a=' + id;
    wrap.appendChild(perma);
    var copy = el('button', 'journal-copy', 'Copy link');
    copy.type = 'button';
    copy.addEventListener('click', function () {
      var url = location.origin + '/journal.html?a=' + id;
      var done = function () { copy.textContent = 'Copied'; setTimeout(function () { copy.textContent = 'Copy link'; }, 1500); };
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(url).then(done, function () {}); return; }
      } catch (e) { /* fall through */ }
      var ta = document.createElement('textarea'); ta.value = url; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { /* ignore */ }
      document.body.removeChild(ta);
    });
    wrap.appendChild(copy);
    return wrap;
  }
  function journalEntry(a: any, full: any) {
    var art = el('article', full ? 'journal-entry journal-full' : 'journal-entry');
    art.appendChild(journalDateLine(a));
    var titleText = a.title || fmtDateTime(a.created_at);
    var h = el(full ? 'h1' : 'h2', 'journal-entry-title');
    if (full) { h.textContent = titleText; }
    else { var link = el('a', null, titleText); link.href = 'journal.html?a=' + a.id; h.appendChild(link); }
    art.appendChild(h);
    var bodyEl = el('div', 'journal-body prose');
    fillBody(bodyEl, a.body);
    art.appendChild(bodyEl);
    art.appendChild(journalShare(a.id));
    return art;
  }
  function viewJournal() {
    document.title = 'Journal | Mere Catholicity';
    var pageNum = Math.max(1, Math.floor(Number(new URLSearchParams(location.search).get('p')) || 1));
    var wrap = el('div', 'journal');
    section.appendChild(wrap);
    wrap.appendChild(skeleton());
    fetchRetry(API + '/journal?p=' + pageNum, {}, [1000, 3000])
      .then(function (r) { return r.json(); })
      .then(function (d) {
        wrap.textContent = '';
        if (!d.ok) { wrap.appendChild(el('p', 'comments-status', d.error || 'The journal could not be loaded.')); return; }
        document.title = (d.journal || 'Journal') + ' | Mere Catholicity';
        var head = el('header', 'journal-masthead');
        head.appendChild(el('h1', 'journal-title', d.journal || 'Journal'));
        head.appendChild(el('p', 'journal-tagline', 'Essays and notes from Mere Catholicity.'));
        wrap.appendChild(head);
        if (!d.articles || !d.articles.length) { wrap.appendChild(el('p', 'comments-status', 'No entries yet.')); return; }
        d.articles.forEach(function (a: any) { wrap.appendChild(journalEntry(a, false)); });
        var bar = pageBar(d.total, d.per, d.page, function (i: any) { return 'journal.html?p=' + i; });
        if (bar) wrap.appendChild(bar);
      })
      .catch(function () { wrap.textContent = ''; wrap.appendChild(el('p', 'comments-status', 'The journal could not be loaded.')); });
  }
  function viewJournalArticle(id: any) {
    document.title = 'Journal | Mere Catholicity';
    var wrap = el('div', 'journal journal-single');
    section.appendChild(wrap);
    wrap.appendChild(skeleton('short'));
    if (!Number.isInteger(id) || id < 1) { wrap.textContent = ''; wrap.appendChild(el('p', 'comments-status', 'That entry could not be found.')); return; }
    fetchRetry(API + '/journal?id=' + id, {}, [1000, 3000])
      .then(function (r) { return r.json(); })
      .then(function (d) {
        wrap.textContent = '';
        var back = el('a', 'journal-back', '← ' + ((d && d.journal) || 'The Journal'));
        back.href = 'journal.html';
        wrap.appendChild(back);
        if (!d.ok || !d.article) { wrap.appendChild(el('p', 'comments-status', (d && d.error) || 'That entry could not be found.')); return; }
        document.title = (d.article.title || 'Journal entry') + ' — ' + (d.journal || 'Journal');
        wrap.appendChild(journalEntry(d.article, true));
        /* The article's own comments section, when the admin has opened the
           journal's (the worker said so in this same read): keyed to the
           article, permalinked to it, mounted under it. The identity is already
           resolved — startBoard() did that before routing here. */
        if (d.comments === true) {
          B.COMMENTS_KEY = 'journal:' + id;
          B.COMMENTS_HREF = '/journal.html?a=' + id;
          var host = el('div', 'journal-comments');
          host.setAttribute('data-nosnippet', '');
          wrap.appendChild(host);
          mountComments(host);
        }
        var more = el('a', 'journal-back journal-back-foot', 'Read more entries →');
        more.href = 'journal.html';
        wrap.appendChild(more);
      })
      .catch(function () { wrap.textContent = ''; wrap.appendChild(el('p', 'comments-status', 'That entry could not be loaded.')); });
  }

  /* postMenu: the one ⋯ every post/row wears — the readability standard folds
     ALL action links here (the owner's ruling; the merecat-clean head keeps
     only author + time + ⋯). The items are the CALLER'S prebuilt elements —
     the same .comment-dm/.comment-quote-link/.comment-edit/... nodes as
     always, appended EAGERLY into the (hidden) pop, so the DOM contract the
     standing webtests assert is unchanged: only visibility moved. Since
     2026-09-12 the ⋯ opens the SHARED press-and-hold surface
     (client/surface.ts openActs) — the reaction bar above the post, the acts
     below — the same one a hold on the post opens on a phone; the items
     travel into the surface's menu and back on close. opts.onOpen fires on
     the ⋯ MOUSEDOWN, before a click can collapse a text selection (the quote
     grab lives there). opts.hold is the post's node to arm and to light;
     opts.react {target, id, seed, silent} names the post in the reactions'
     ledger — the bar appears for a keyed reader, and the pill is painted at
     the node's end unless the caller paints its own (silent). */
  function postMenu(opts: any) {
    var wrap = el('span', 'comment-menu-wrap');
    var btn = el('button', 'comment-menu', '⋯');
    btn.type = 'button';
    btn.title = 'More';
    btn.setAttribute('aria-label', 'More actions');
    var pop = el('div', 'comment-menu-pop');
    (opts.items || []).forEach(function (it: any) { if (it) pop.appendChild(it); });
    wrap.appendChild(btn);
    wrap.appendChild(pop);
    var react = opts.react || null;
    var host = opts.hold || null;
    if (react && host && !react.silent) reactRegister(react.target, react.id, host, react.seed);
    function open(at: any) {
      var items = [].slice.call(pop.childNodes);
      openActs({
        node: host || wrap,
        at: at,
        react: react && state.myHash
          ? { current: reactMine(react.target, react.id), onPick: function (e: any) { reactSend(react.target, react.id, e); } }
          : null,
        items: items,
        onClose: function () { items.forEach(function (k: any) { pop.appendChild(k); }); },
      });
    }
    btn.addEventListener('mousedown', function () { if (opts.onOpen) { try { opts.onOpen(); } catch (e) { /* selection grab is best-effort */ } } });
    btn.addEventListener('click', function (e: any) {
      e.preventDefault(); e.stopPropagation();
      var r = btn.getBoundingClientRect();
      open({ x: r.left, y: r.bottom + 2 });
    });
    if (host) armHold(host, open);
    return wrap;
  }

  /* Saved posts: one POST toggles a bookmark row; the Saved list
     (community.html?saved=1) is the reader's own shelf of them. */
  function bookmarkToggle(kind: any, ref: any, on: any) {
    if (!state.key) return Promise.resolve({ ok: false });
    return fetch(API + '/bookmark', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: state.key, kind: kind, ref: ref, on: !!on }),
    }).then(function (r) { return r.json(); }).catch(function () { return { ok: false }; });
  }

  /* What a reader gets where the social layer used to be: the page the site
     never had. Deliberately says nothing about a switch — a disabled surface is
     indistinguishable from one that never existed, which is the same posture
     the back room and the worker's own /wall* refusals take. */
  function viewNoSuchPage() {
    document.title = 'Not found | Mere Catholicity';
    crumb([['Community', 'community.html']]);
    section.appendChild(el('p', 'comments-status', 'No such page.'));
    var back = el('p');
    var a = el('a', null, 'Go to Community') as HTMLAnchorElement;
    a.href = 'community.html';
    back.appendChild(a);
    section.appendChild(back);
  }

  function viewPost(id: any) {
    if (!(id > 0)) { crumb([['Community', 'community.html'], ['Feed', 'feed.html']]); section.appendChild(el('p', 'comments-status', 'No such post.')); return; }
    /* A single post is PUBLIC: no identity needed to read it and its interactions.
       Liking/commenting is gated inside wallPostNode (it opens onboarding). */
    document.title = 'Post | Community';
    crumb([['Community', 'community.html'], ['Feed', 'feed.html'], ['Post']]);
    var holder = el('div', 'wall-list'); section.appendChild(holder);
    holder.appendChild(skeleton());
    fetch(API + '/wall/post/get', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: state.key || '', id: id }) })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        holder.textContent = '';
        if (blockedOut(d)) return;
        if (!d || !d.ok) { holder.appendChild(el('p', 'comments-status', d && d.error ? d.error : 'That post is gone.')); return; }
        if (typeof d.notif_unread === 'number') notifCacheSet(d.notif_unread);   // opening read the post's bells
        holder.appendChild(wallPostNode(d.post, true));
      }).catch(function () { holder.textContent = ''; holder.appendChild(el('p', 'comments-status', 'Could not load the post.')); });
  }

  /* The manual Watch/Unwatch control in a topic header. Posting already watches
     a thread; this lets a reader follow one they have not answered, or stop
     following one they have. Its label reflects the current state, read once. */
  function watchToggle(topicId: any) {
    var a = el('a', 'trust-toggle board-watch', 'Watch');
    a.href = '#';
    a.title = 'Get a notification when someone replies here';
    function setLabel(w: any) { a.textContent = w ? 'Unwatch' : 'Watch'; a.setAttribute('data-w', w ? '1' : '0'); }
    function call(act: any) {
      return fetch(API + '/watch', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: state.key, topic: topicId, act: act }),
      }).then(function (r) { return r.json(); });
    }
    call('status').then(function (d) { if (blockedOut(d)) return; if (d.ok) setLabel(d.watching); }).catch(function () {});
    a.addEventListener('click', function (e: any) {
      e.preventDefault();
      /* Flip at once and put it back if the server disagrees — the same
         generation-guarded shape the feed's like toggle uses. Before this the
         label only moved when the round trip returned, and a refusal moved
         nothing at all, so a failed watch looked exactly like a slow one. */
      var want = a.getAttribute('data-w') !== '1';
      var gen = (a.mcGen = (a.mcGen || 0) + 1);
      setLabel(want);
      call(want ? 'watch' : 'unwatch')
        .then(function (d) {
          if (gen !== a.mcGen) return;
          if (blockedOut(d)) return;
          if (d.ok) setLabel(d.watching);
          else { setLabel(!want); a.title = d.error || 'That did not save.'; }
        })
        .catch(function () { if (gen === a.mcGen) { setLabel(!want); a.title = 'That did not save — check your connection.'; } });
    });
    return a;
  }

  /* A search snippet arrives with matched terms wrapped in STX/ETX control
     characters (which a body can never contain). Split on them and mark the odd
     segments — built from text and <mark> nodes alone, never innerHTML. */
  function searchSnippet(snip: any) {
    var wrap = el('div', 'board-intro');
    String(snip == null ? '' : snip).split(/[\u0002\u0003]/).forEach(function (seg, i) {
      if (!seg) return;
      if (i % 2 === 1) wrap.appendChild(el('mark', null, seg));
      else wrap.appendChild(document.createTextNode(seg));
    });
    return wrap;
  }

  /* The "filter by author" field: the same directory and fuzzy scorer as the
     @-mention picker and DM search, but standalone — a pick fixes one author
     hash for the search, and editing the field clears it. Returns { hash, set }. */
  function attachAuthorPicker(input: any, actionLabel?: any) {
    var chosen = '', chosenText = '';
    var sug = el('div', 'mention-suggest');
    sug.hidden = true;
    input.parentNode.insertBefore(sug, input.nextSibling);
    var current: any[] = [], sel = 0, timer: any = null;
    function render() {
      sug.textContent = '';
      if (!current.length) { sug.hidden = true; return; }
      current.forEach(function (u, i) {
        var r = el('a', 'dm-suggest-row' + (i === sel ? ' dm-suggest-sel' : ''));
        r.href = '#';
        r.appendChild(el('span', null, dmLabel(u.hash, u.nick)));
        r.appendChild(el('span', 'dm-suggest-go', actionLabel || 'filter'));
        r.addEventListener('mousedown', function (e: any) { e.preventDefault(); pick(u); });
        sug.appendChild(r);
      });
      sug.hidden = false;
    }
    function pick(u: any) {
      chosen = u.hash;
      chosenText = '@' + (u.nick || displayName(u.hash));
      input.value = chosenText;
      current = []; sug.hidden = true;
    }
    function scan() {
      if (input.value !== chosenText) chosen = '';
      var q = input.value.trim().replace(/^@/, '').toLowerCase();
      if (q.length < 1) { current = []; sug.hidden = true; return; }
      ensureMentionDir(function () {
        /* Unlike the mention and DM pickers, the author filter offers you
           yourself too — searching your own posts by author is useful. */
        current = B.mentionDir
          .map(function (u: any) { return { u: u, s: Math.max(dmScore(q, u.nick), dmScore(q, displayName(u.hash))), label: dmLabel(u.hash, u.nick) }; })
          .filter(function (x: any) { return x.s > 0; })
          .sort(function (x: any, y: any) { return y.s - x.s || (x.label < y.label ? -1 : 1); })
          .slice(0, 8).map(function (x: any) { return x.u; });
        sel = 0; render();
      });
    }
    input.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(scan, 120); });
    input.addEventListener('keydown', function (e: any) {
      if (sug.hidden || !current.length) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(sel + 1, current.length - 1); render(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(sel - 1, 0); render(); }
      else if (e.key === 'Enter') { e.preventDefault(); if (current[sel]) pick(current[sel]); }
      else if (e.key === 'Escape') { current = []; sug.hidden = true; }
    });
    input.addEventListener('blur', function () { setTimeout(function () { sug.hidden = true; }, 200); });
    return {
      hash: function () { return chosen; },
      set: function (hash: any, label: any) { chosen = hash; chosenText = '@' + label; input.value = chosenText; },
    };
  }

  /* The compact search box on the board index: one query field to the results. */
  function indexSearchBox() {
    var form = el('form', 'board-search');
    var row = el('div', 'key-row');
    var input = el('input', 'key-input');
    input.type = 'search';
    input.placeholder = 'Search the board...';
    row.appendChild(input);
    var btn = el('button', 'btn btn-send', 'Search');
    btn.type = 'submit';
    row.appendChild(btn);
    form.appendChild(row);
    form.addEventListener('submit', function (e: any) {
      e.preventDefault();
      go('community.html?q=' + encodeURIComponent(input.value.trim()));
    });
    return form;
  }

  /* Full-text search over the forum, driven entirely by the URL so a result set
     is shareable and pages in place. A query field (quotes for an exact phrase),
     a category filter, an @-author filter, and a relevance/recency sort; each hit
     shows the thread title, a highlighted snippet, author, category, and date, and
     links to the exact post. */
  function viewSearch() {
    /* The Lit view is THE screen (2026-09-16): the bundle always stands — docs/nav.js
       injects it on every page and this boot waits for it — so the classic body that
       once stood in for it is gone; only the door remains. */
    return window.mcViews!.search(section, window.mcKit);
  }

  /* A logged-out reader on a members-only page (Messages, Profile) sees this clean
     prompt instead of the board; the app-chrome gate also pops the registration
     modal on top (desktop and mobile). */
  /* The members-only gate (Merecat / Profile / Inbox / DM / Feed / Post). This is
     the SAME calm, non-blocking idiom as the inline community gate (renderIdentity)
     — a prompt with a primary button and an "I have a key" link — NOT a forced,
     boxed-in modal. The onboarding sheet opens only on an explicit tap, so a
     visitor who came just to read the intro is never trapped (no auto-pop, no
     keyboard trap on someone who only wanted to look). */
  function viewJoin(what: any) {
    var wrap = el('div', 'mc-join');
    wrap.appendChild(el('p', 'comments-status', 'Create an identity to ' + what + '. One tap, no email, no signup.'));
    var btn = el('button', 'btn btn-send', 'Create an identity');
    btn.type = 'button';
    btn.addEventListener('click', function () {
      if (window.mcOnboard) window.mcOnboard();
      else go('community.html');
    });
    wrap.appendChild(btn);
    var have = el('p', 'mc-join-havekey');
    have.appendChild(identityAction('I already have a key', function () {
      if (window.mcOnboard) window.mcOnboard(null, { key: true });
      else go('community.html');
    }));
    wrap.appendChild(have);
    section.appendChild(wrap);
    /* The librarian's gate is an informed choice, not a bare wall: a visitor
       sees what an answer looks like and what asking costs before creating
       anything. A tapped example is remembered (the same prefill slot the
       reader chip uses) so it is waiting in the box once they join. */
    if ((location.pathname.split('/').pop() || '') === 'merecat-ai.html') {
      var starter = el('div', 'mc-cat-starter');
      starter.appendChild(el('span', 'mc-cat-starter-ico', '🐈'));
      starter.appendChild(el('h3', null, 'Ask the librarian'));
      starter.appendChild(el('p', null,
        'A question about the Fathers, the councils, Newman, or anything in our Library.'));
      var chips = el('div', 'mc-cat-chips');
      ['What do the Fathers make of John 6:53?',
        'How does Newman describe the development of doctrine?',
        'What did the Council of Nicaea settle?'].forEach(function (ex) {
        var chip = el('button', 'mc-cat-chip', ex);
        chip.type = 'button';
        chip.addEventListener('click', function () {
          try { localStorage.setItem('mc-merecat-prefill', JSON.stringify({ q: ex, at: Date.now() })); } catch (e2) {}
          if (window.mcOnboard) window.mcOnboard();
        });
        chips.appendChild(chip);
      });
      starter.appendChild(chips);
      var sample = el('div', 'mc-cat-sample');
      sample.appendChild(el('p', 'mc-cat-sample-q', 'Asked: What did the Council of Nicaea settle?'));
      sample.appendChild(el('p', 'mc-cat-sample-a',
        '🐈 The council confessed that the Son is of one substance with the Father, ' +
        'against Arius, and gave the Church the creed we still say. Every answer cites ' +
        'the Library, with links into the very texts.'));
      sample.appendChild(el('p', 'mc-cat-sample-note',
        'Members may ask ten questions a day. Joining is one tap and needs no email.'));
      starter.appendChild(sample);
      section.appendChild(starter);
    }
  }

  /* Recent activity: the last live posts across every public room, newest
     first — "what happened since I left" for members and visitors alike.
     One cacheable keyless GET. */
  function viewRecent(p: any) {
    section.textContent = '';
    document.title = 'Recent activity | Community';
    section.appendChild(crumb([['Community', 'community.html'], ['Recent activity']]));
    section.appendChild(el('p', 'board-intro', 'The latest posts across every room, newest first.'));
    var box = el('div', 'board-topics');
    box.appendChild(el('p', 'comments-status', 'Loading…'));
    section.appendChild(box);
    cachedJson(API + '/recent?p=' + p, undefined, 45000).then(function (d: any) {
      if (!d || !d.ok) throw new Error((d && d.error) || 'failed');
      box.textContent = '';
      if (!d.items.length) { box.appendChild(el('p', 'comments-status', 'Nothing here yet.')); return; }
      d.items.forEach(function (it: any) {
        var row = el('div', 'board-topic');
        var left = el('div', 'board-topic-left');
        var a = el('a', 'board-topic-title', it.topic_title || 'A topic');
        a.href = 'community.html?topic=' + it.topic_id + (it.parent_id ? '#comment-' + it.id : '');
        left.appendChild(a);
        var who = it.nick || (it.author_hash ? displayName(it.author_hash) : 'Anonymous');
        left.appendChild(el('div', 'board-cat-desc', who + (it.parent_id ? ' replied' : ' opened the topic')));
        if (it.body) left.appendChild(el('div', 'board-intro', String(it.body).slice(0, 160)));
        row.appendChild(left);
        var svs = el('div', 'board-stats', fmtTimeCompact(it.created_at));
        svs.title = fmtDateTime(it.created_at);
        row.appendChild(svs);
        box.appendChild(row);
      });
      var pager = el('p', 'board-pages');
      if (p > 1) { var pv = el('a', null, '‹ Newer'); pv.href = 'community.html?recent=1&p=' + (p - 1); pager.appendChild(pv); pager.appendChild(document.createTextNode(' ')); }
      if (d.more) { var nx = el('a', null, 'Older ›'); nx.href = 'community.html?recent=1&p=' + (p + 1); pager.appendChild(nx); }
      if (pager.firstChild) section.appendChild(pager);
    }).catch(function () {
      box.textContent = '';
      box.appendChild(el('p', 'comments-status', 'Recent activity could not be loaded. Reload to retry.'));
    });
  }

  /* Saved posts: the reader's bookmarks — forum topics and feed posts on one
     shelf, each removable. */
  function viewSaved(p: any) {
    section.textContent = '';
    document.title = 'Saved posts | Community';
    section.appendChild(crumb([['Community', 'community.html'], ['Saved posts']]));
    var box = el('div', 'board-topics');
    box.appendChild(el('p', 'comments-status', 'Loading…'));
    section.appendChild(box);
    fetchRetry(API + '/bookmarks', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: state.key, p: p }),
    }, [1000, 3000]).then(function (r) { return r.json(); }).then(function (d: any) {
      if (blockedOut(d)) return;
      if (!d || !d.ok) throw new Error((d && d.error) || 'failed');
      box.textContent = '';
      if (!d.items.length) {
        box.appendChild(el('p', 'comments-status',
          'Nothing saved yet. Use the save link on a topic, or Save post in a feed post’s share menu.'));
        return;
      }
      d.items.forEach(function (it: any) {
        var row = el('div', 'board-topic');
        var left = el('div', 'board-topic-left');
        var a = el('a', 'board-topic-title', it.label || (it.kind === 'topic' ? 'A topic' : 'A feed post'));
        a.href = it.kind === 'topic' ? ('community.html?topic=' + it.ref) : ('feed.html?post=' + it.ref);
        left.appendChild(a);
        left.appendChild(el('div', 'board-cat-desc', it.kind === 'topic' ? 'Forum topic' : 'Feed post'));
        row.appendChild(left);
        var right = el('div', 'board-stats');
        var un = el('a', 'identity-action', 'remove');
        un.href = '#';
        un.addEventListener('click', function (ev: any) {
          ev.preventDefault();
          bookmarkToggle(it.kind, it.ref, false).then(function () { row.remove(); });
        });
        right.appendChild(un);
        row.appendChild(right);
        box.appendChild(row);
      });
      var pager = el('p', 'board-pages');
      if (p > 1) { var pv = el('a', null, '‹ Back'); pv.href = 'community.html?saved=1&p=' + (p - 1); pager.appendChild(pv); pager.appendChild(document.createTextNode(' ')); }
      if (d.more) { var nx = el('a', null, 'More ›'); nx.href = 'community.html?saved=1&p=' + (p + 1); pager.appendChild(nx); }
      if (pager.firstChild) section.appendChild(pager);
    }).catch(function () {
      box.textContent = '';
      box.appendChild(el('p', 'comments-status', 'Saved posts could not be loaded. Reload to retry.'));
    });
  }
  function bind() {
    ADMIN_HASHES = B.ADMIN_HASHES;
    API = B.API;
    BLOCK_CONFIRM = B.BLOCK_CONFIRM;
    MERECAT_BOT_HASH = B.MERECAT_BOT_HASH;
    afterEdit = B.afterEdit;
    annotateMeta = B.annotateMeta;
    appConfirm = B.appConfirm;
    attachBoardMedia = B.attachBoardMedia;
    attachDraft = B.attachDraft;
    attachMentions = B.attachMentions;
    authorNode = B.authorNode;
    blockedOut = B.blockedOut;
    browserTz = B.browserTz;
    busy = B.busy;
    cachedJson = B.cachedJson;
    collectAltIps = B.collectAltIps;
    collectMentions = B.collectMentions;
    crumb = B.crumb;
    displayName = B.displayName;
    dmLabel = B.dmLabel;
    dmScore = B.dmScore;
    el = B.el;
    ensureDmStyles = B.ensureDmStyles;
    ensureMentionDir = B.ensureMentionDir;
    fetchRetry = B.fetchRetry;
    fillBody = B.fillBody;
    fmtDateTime = B.fmtDateTime;
    fmtTimeCompact = B.fmtTimeCompact;
    freshOpts = B.freshOpts;
    freshParam = B.freshParam;
    getFaith = B.getFaith;
    getToken = B.getToken;
    go = B.go;
    identityAction = B.identityAction;
    isAdmin = B.isAdmin;
    isBlocked = B.isBlocked;
    isMember = B.isMember;
    isMuted = B.isMuted;
    markThreadRead = B.markThreadRead;
    mdEditor = B.mdEditor;
    mountComments = B.mountComments;
    notifCacheSet = B.notifCacheSet;
    pageBar = B.pageBar;
    pageHref = B.pageHref;
    pageKey = B.pageKey;
    previewButton = B.previewButton;
    profileHref = B.profileHref;
    renderIdentity = B.renderIdentity;
    section = B.section;
    setBlock = B.setBlock;
    skelInto = B.skelInto;
    skeleton = B.skeleton;
    stampFresh = B.stampFresh;
    state = B.state;
    topicAdminCorner = B.topicAdminCorner;
    trace = B.trace;
    wallMediaNode = B.wallMediaNode;
    wallPostNode = B.wallPostNode;
    armHold = B.armHold;
    openActs = B.openActs;
    reactLoadMine = B.reactLoadMine;
    reactMine = B.reactMine;
    reactRegister = B.reactRegister;
    reactSend = B.reactSend;
  }
  /* What ran at boot time in the old file, in the old order, after every
     module is bound: listeners, deferred initializers. */
  function run() {
  }
  return { bind, run, exports: { CATS, armBoardForm, attachAuthorPicker, boardButtons, boardPost, bookmarkToggle, buildBoardForm, canEditPost, catByKey, commentNode, indexSearchBox, permalinkFor, postMenu, quoteInto, renderButtons, renderTrustLine, searchSnippet, selectionInPost, setStatus, startEdit, truncate, viewCat, viewIndex, viewJoin, viewJournal, viewJournalArticle, viewNoSuchPage, viewPost, viewRecent, viewSaved, viewSearch, viewTopic, watchToggle } };
}
