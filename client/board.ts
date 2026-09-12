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

  /* A description with an optional trailing link, built as nodes so the
     link is real and everything else stays inert text. */
  function catDescNode(tag: any, cat: any) {
    var node = el(tag, 'board-cat-desc', cat[2]);
    if (cat[3]) {
      var a = el('a', null, cat[3]);
      a.href = cat[4];
      node.appendChild(a);
      node.appendChild(document.createTextNode('.'));
    }
    return node;
  }
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
    if (window.mcCore) return window.mcCore.canEdit(authorHash, state.myHash, isAdmin());
    return !!state.myHash && (authorHash === state.myHash || isAdmin());
  }
  function commentNode(c: any, pending: any, quoteCtx: any, reveal?: boolean): any {
    /* Ported (Wave B3b): the module builder renders when the bundle stands;
       this body is the no-bundle fallback (the deliberate no-bundle fallback). */
    if (window.mcViews && window.mcViews.commentNode) return window.mcViews.commentNode(window.mcKit, c, pending, quoteCtx, reveal);
    /* A BLOCKED member's post does not exist for you (the 2026-08-03 block
       unification: no collapse, no "show" — you chose not to see them). The
       hidden stub keeps every caller's append/anchor bookkeeping intact. */
    if (!reveal && c.author_hash && c.author_hash !== state.myHash && isMuted(c.author_hash)) {
      var ph = el('div', 'comment-blocked');
      ph.id = 'comment-' + c.id;
      ph.style.display = 'none';
      ph.hidden = true;
      return ph;
    }
    var article = el('article', 'comment' + (pending ? ' comment-pending' : ''));
    article.id = 'comment-' + c.id;
    /* Machine-readable notice that this is a visitor's comment, not the
       site's own text. */
    article.setAttribute('itemscope', '');
    article.setAttribute('itemtype', 'https://schema.org/Comment');
    var head = el('div', 'comment-head');
    /* A poster with an avatar wears it here; without one, the head is as it
       always was. The link makes the picture a second door to the profile. */
    if (c.avatar && c.author_hash) {
      var avLink = el('a', 'comment-avatar-link');
      avLink.href = profileHref(c.author_hash);
      var av = el('img', 'comment-avatar');
      av.src = API + '/avatar?hash=' + c.author_hash + '&v=' + encodeURIComponent(c.avatar);
      av.alt = '';
      av.width = 20;
      av.height = 20;
      avLink.appendChild(av);
      head.appendChild(avLink);
    }
    var author = authorNode(c.author_hash, c.nick, true, c.faith, c.posts);
    author.setAttribute('itemprop', 'author');
    head.appendChild(author);
    /* The house speaks under its own colors. */
    if (c.author_hash && ADMIN_HASHES.indexOf(c.author_hash) !== -1) {
      head.appendChild(el('span', 'comment-admin', '(admin)'));
    }
    if (c.edited_at) head.appendChild(el('span', 'comment-edited', 'edited'));
    /* The date doubles as the comment's shareable permalink — compact form,
       the full wording on hover (the readability standard). */
    var date = el('a', 'comment-date', fmtTimeCompact(c.created_at));
    date.title = fmtDateTime(c.created_at);
    date.href = '#comment-' + c.id;
    head.appendChild(date);
    /* Every action folds into the ⋯ menu (the owner's ruling): the head keeps
       only author + time + ⋯. The links are built EXACTLY as before — same
       classes, same handlers — only their home moved. */
    var items: any[] = [];
    /* A door to a private word with the author, for keyed readers only.
       The librarian holds no inbox: its posts carry no DM link. */
    if (c.author_hash && state.myHash && c.author_hash !== state.myHash &&
        c.author_hash !== MERECAT_BOT_HASH) {
      var dm = el('a', 'comment-dm', 'Direct Message');
      dm.href = 'messages.html?dm=' + c.author_hash;
      dm.title = 'Send a direct message';
      items.push(dm);
      /* Block, the one member control: their posts vanish for you and their
         messages stop. Reloading re-renders the view so it takes at once. */
      var blockLink = el('a', 'comment-quote-link', isBlocked(c.author_hash) ? 'unblock' : 'block');
      blockLink.href = '#';
      blockLink.title = 'Block this member: hide their posts and stop their messages';
      blockLink.addEventListener('click', function (e: any) {
        e.preventDefault();
        if (isBlocked(c.author_hash)) { setBlock(c.author_hash, false, function () { location.reload(); }); return; }
        appConfirm(BLOCK_CONFIRM, { okLabel: 'Block', danger: true }, function (ok: any) {
          if (ok) setBlock(c.author_hash, true, function () { location.reload(); });
        });
      });
      items.push(blockLink);
      /* Members flag a post for the moderators; admins act directly and don't
         see this. Reporting never hides the post — it only queues it for review. */
      if (!isAdmin()) {
        var reportLink = el('a', 'comment-quote-link', 'report');
        reportLink.href = '#';
        reportLink.title = 'Report this post to the moderators';
        reportLink.addEventListener('click', function (e: any) {
          e.preventDefault();
          var reason = prompt('Report this post to the moderators.\nOptionally, a short reason:');
          if (reason === null) return;
          /* The tap used to change nothing until the round trip returned, and
             a network failure changed nothing ever — so a report that never
             arrived looked identical to one that did. */
          busy(reportLink, fetch(API + '/report', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: state.key, id: c.id, reason: reason }),
          }).then(function (r) { return r.json(); }).then(function (d) {
            if (blockedOut(d)) return;
            reportLink.mcAfter = d.ok ? 'reported' : 'report';
            reportLink.title = d.ok ? 'Reported to the moderators. Thank you.' : (d.error || 'Could not report.');
          })).then(function () {
            if (reportLink.mcAfter) reportLink.textContent = reportLink.mcAfter;
          }).catch(function () {
            reportLink.title = 'Could not report — check your connection and try again.';
          });
        });
        items.push(reportLink);
      }
    }
    /* Anyone may quote any post into the reply box, so unlike edit/delete this
       is ungated. The selection grab moved to the ⋯ MOUSEDOWN (postMenu's
       onOpen) — opening the menu is now the click that would have cleared it. */
    var quote = el('a', 'comment-quote-link', 'quote');
    quote.href = '#';
    quote.addEventListener('click', function (e: any) {
      e.preventDefault();
      var excerpt = B.quotedSelection || truncate(c.body, 400);
      B.quotedSelection = '';
      quoteInto(c, excerpt, permalinkFor(c, quoteCtx));
    });
    items.push(quote);
    /* Yours, or any post when you are an admin (Domain.Access.canEdit, 2026-09-12). */
    if (canEditPost(c.author_hash)) {
      var ed = el('a', 'comment-edit', 'edit');
      ed.href = '#';
      ed.addEventListener('click', function (e: any) {
        e.preventDefault();
        startEdit(c, article);
      });
      items.push(ed);
    }
    if (state.myHash && (c.author_hash === state.myHash || isAdmin())) {
      var del = el('a', 'comment-delete', 'delete');
      del.href = '#';
      del.addEventListener('click', function (e: any) {
        e.preventDefault();
        appConfirm('Delete this comment?', { okLabel: 'Delete', danger: true }, function (ok: any) {
          if (!ok) return;
          fetchRetry(API + '/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: c.id, key: state.key }),
          }, [1500]).then(function (r) { return r.json(); }).then(function (d) {
            if (d.ok) {
              article.remove();
              /* Same freshness stamp as posting: the deleter's own reloads
                 must not resurrect the comment from the list cache. */
              try { localStorage.setItem('mc-posted-at', String(Date.now())); } catch (e2) {}
            } else setStatus(d.error || 'Could not delete the comment.');
          }).catch(function () {
            setStatus('Network error. The comment was not deleted.');
          });
        });
      });
      items.push(del);
    }
    /* The ⋯ and the hold open the post's surface — the reaction bar for a
       keyed reader, the acts below — so a post with no acts still wears it. */
    if (items.length || state.myHash) {
      head.appendChild(postMenu({ items: items, onOpen: function () { B.quotedSelection = selectionInPost(c); },
        hold: article, react: { target: 'post', id: c.id, seed: c } }));
    }
    article.appendChild(head);
    var body = fillBody(el('div', 'comment-body'), c.body,
      c.author_hash === MERECAT_BOT_HASH);
    body.setAttribute('itemprop', 'text');
    article.appendChild(body);
    if (c.signature) article.appendChild(fillBody(el('div', 'comment-sig'), c.signature,
      c.author_hash === MERECAT_BOT_HASH));
    /* Board attachments ride the same renderer as wall media (post=null = the
       plain viewer); an attachment the sweep has taken leaves a muted note. */
    if (c.media_key) {
      ensureDmStyles();
      var media = wallMediaNode(c.media_key, null);
      if (media) article.appendChild(media);
    } else if (c.media_expired) {
      ensureDmStyles();
      article.appendChild(el('p', 'comment-note wall-media-gone', 'The attachment expired.'));
    }
    if (pending) {
      article.appendChild(el('p', 'comment-note',
        'Held for review. It will appear here once approved.'));
    }
    return article;
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
    /* Ported (Wave B1): the Lit view renders when the bundle stands; this
       body remains the no-shell fallback and the one-line revert. */
    if (window.mcViews && window.mcViews.boardIndex) return window.mcViews.boardIndex(section, window.mcKit);
    document.title = 'Community | Mere Catholicity';
    /* A muted word on who we are, for the newcomer who lands here. One paragraph. */
    var introP = el('p', 'board-intro');
    introP.appendChild(el('small', null,
      'A board for exploring what it means to be merely catholic.'));
    section.appendChild(introP);
    /* The identity drawer lives on the front page too, so a reader can
       create, show, or swap a key before ever entering a room. The board
       index is the ONE page that keeps the logged-in utilities row
       (comment-identity-nav — see renderIdentity). */
    section.appendChild(el('div', 'comment-identity comment-identity-nav'));
    var keyBox = el('div', 'key-box');
    keyBox.hidden = true;
    section.appendChild(keyBox);
    renderIdentity();
    /* Admins alone see the door to the console. The server would refuse anyone
       else anyway, so hiding it is courtesy, not the lock. One link now, to a
       page that gathers the audit, the IP bans, and the admin roster. */
    var auditSlot = el('p', 'board-audit-link');
    function ensureAuditLink() {
      var ar = section.querySelector('.board-cat-admin') as HTMLElement | null;
      if (ar) ar.style.display = isAdmin() ? '' : 'none';
      /* "Administrative options" moved to the platform Settings gear (admin-only),
         off the community page — the site is a platform now, not just a forum. */
      auditSlot.textContent = '';
    }
    ensureAuditLink();
    new MutationObserver(ensureAuditLink)
      .observe(section.querySelector('.comment-identity')!, { childList: true });
    /* Search is a members' feature, so the box only shows once you are logged in. */
    if (isMember()) section.appendChild(indexSearchBox());
    var wrap = el('div', 'board-cats');
    var stats: Record<string, any> = {}, catNames: Record<string, any> = {};
    CATS.forEach(function (cat) {
      var row = el('div', 'board-cat');
      var left = el('div', 'board-cat-left');
      var name = el('a', 'board-cat-name', cat[1]);
      name.href = 'community.html?cat=' + cat[0];
      left.appendChild(name);
      catNames[cat[0]] = name;
      left.appendChild(catDescNode('div', cat));
      row.appendChild(left);
      stats[cat[0]] = el('div', 'board-stats', '—');
      row.appendChild(stats[cat[0]]);
      if (cat[0] === 'adminsonly') {
        /* inline display, not the hidden attribute: .board-cat's own
           display:flex outranks [hidden]'s UA rule and once left this
           tile showing to the whole world */
        row.className = 'board-cat board-cat-admin';
        row.style.display = isAdmin() ? '' : 'none';
        stats[cat[0]].textContent = '🔒 admins alone';
      }
      wrap.appendChild(row);
    });
    section.appendChild(wrap);
    /* The admin doors sit at the foot of the room list, right-aligned and out
       of the reader's path, after the last room and before the footer rule. */
    section.appendChild(auditSlot);
    /* New since your last visit: a summary line above the rooms and a "(k new)"
       beside each room's name. Keyed only, and merged onto the synchronous name
       so the async /board stats fetch never clears it. */
    if (state.key) {
      var unreadHost = el('p', 'board-intro');
      section.insertBefore(unreadHost, wrap);
      fetch(API + '/board/unread', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: state.key }),
      }).then(function (r) { return r.json(); }).then(function (d) {
        if (blockedOut(d) || !d.ok) return;
        if (d.total > 0) {
          unreadHost.appendChild(document.createTextNode(
            d.total + (d.total === 1 ? ' new thread since your last visit. ' : ' new threads since your last visit. ')));
          var mark = el('a', 'identity-action', 'Mark all read');
          mark.href = '#';
          mark.addEventListener('click', function (e: any) {
            e.preventDefault();
            fetch(API + '/board/read-all', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ key: state.key }),
            }).then(function () {
              /* Caught up is caught up: the badge must not spend ninety
                 seconds contradicting the page it reloads into. */
              notifCacheSet(0);
              location.reload();
            }).catch(function () {});
          });
          unreadHost.appendChild(mark);
        }
        if (d.byCat) {
          CATS.forEach(function (cat) {
            var n = d.byCat[cat[0]], nm = catNames[cat[0]];
            if (n && nm) nm.parentNode.insertBefore(el('span', 'dm-unread', ' (' + n + ' new)'), nm.nextSibling);
          });
        }
      }).catch(function () {});
    }
    cachedJson(API + '/board' + freshParam('?'), freshOpts(), 45000)
      .then(function (d) {
        if (!d.ok) return;
        CATS.forEach(function (cat) {
          var c = d.cats[cat[0]];
          var cell = stats[cat[0]];
          cell.textContent = '';
          if (!c) { cell.textContent = 'quiet so far'; return; }
          cell.appendChild(el('div', null,
            c.topics + (c.topics === 1 ? ' topic · ' : ' topics · ') + c.posts + (c.posts === 1 ? ' post' : ' posts')));
          if (c.latest && c.latest.title
              && !(c.latest.author_hash && isBlocked(c.latest.author_hash))) {
            /* The one dim secondary line (the readability standard): latest
               title + poster as one anchor to the newest post, compact time.
               A blocked member's latest never surfaces (block unification). */
            var line = el('div', 'board-row-sub');
            var t = String(c.latest.title);
            var titleText = t.length > 42 ? t.slice(0, 42) + '…' : t;
            var who = c.latest.author_hash ? (c.latest.nick || displayName(c.latest.author_hash)) : 'Anonymous';
            var a = el('a', null, titleText + ' · ' + who);
            a.href = 'community.html?topic=' + c.latest.topic_id +
              (c.latest.id ? '#comment-' + c.latest.id : '');
            line.appendChild(a);
            line.appendChild(document.createTextNode(' · ' + fmtTimeCompact(c.latest.created_at)));
            line.title = fmtDateTime(c.latest.created_at);
            cell.appendChild(line);
          }
        });
      })
      .catch(function () {});
  }

  function viewCat(key: any) {
    var cat = catByKey(key);
    if (!cat) return viewIndex();
    /* the back room shows nothing to a keyless visitor — not even its name */
    if (key === 'adminsonly' && !(isMember())) return viewIndex();
    /* Ported (Wave B2): the Lit view renders when the bundle stands. */
    if (window.mcViews && window.mcViews.boardCat) return window.mcViews.boardCat(section, window.mcKit, key);
    var pageNum = Math.max(1, Math.floor(Number(new URLSearchParams(location.search).get('p')) || 1));
    document.title = cat[1] + ' | Community';
    var head = crumb([['Community', 'community.html'], [cat[1]]]);
    var rss = el('a', 'comments-rss', 'RSS');
    rss.href = API + '/feed?cat=' + key;
    rss.title = 'Follow this category with a feed reader';
    head.appendChild(document.createTextNode(' '));
    head.appendChild(rss);
    if (key === 'adminsonly') rss.hidden = true;
    section.appendChild(catDescNode('p', cat));
    var list = el('div', 'board-topics');
    skelInto(list);
    section.appendChild(list);
    buildBoardForm(true, 'Start a topic');
    boardButtons('Post topic', function () {
      var ta = section.querySelector('.comment-form .comment-text') as any;
      var titleBox = section.querySelector('.comment-form .board-title') as HTMLInputElement;
      var title = titleBox.value.replace(/\s+/g, ' ').trim();
      var body = ta.value.replace(/\s+$/, '');
      var status = section.querySelector('.form-status') as HTMLElement;
      if (ta.mcPreview && (title.length < 3 || !body.trim())) ta.mcPreview.off();
      if (title.length < 3) { titleBox.focus(); return; }
      if (!body.trim()) { ta.focus(); return; }
      boardPost({ cat: key, title: title, body: body }, function (d: any) {
        if (ta.mcDraftDone) ta.mcDraftDone();
        if (d.status === 'pending') {
          status.textContent = 'Held for review. It will appear once approved.';
          titleBox.value = '';
          ta.value = '';
          if (ta.mcPreview) ta.mcPreview.off();
        } else {
          trace('new topic posted -> topic'); go('community.html?topic=' + d.comment.id);
        }
      });
    });
    armBoardForm();
    attachMentions(section.querySelector('.comment-form .comment-text'));
    attachDraft(section.querySelector('.comment-form .comment-text'), 'topic:' + key,
      section.querySelector('.comment-form .board-title'));
    (key === 'adminsonly'
      ? cachedJson(API + '/board/admin', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: state.key || '', p: pageNum }),
        }, 45000)
      : cachedJson(API + '/board/cat?cat=' + key + '&p=' + pageNum + freshParam('&'), freshOpts(), 45000))
      .then(function (d) {
        if (!d.ok) {
          if (key === 'adminsonly') {
            /* refused: erase every trace and stand on the index instead */
            section.textContent = '';
            viewIndex();
            return;
          }
          throw new Error(d.error || 'failed');
        }
        list.textContent = '';
        if (!d.topics.length) {
          list.appendChild(el('p', 'comments-status', 'No topics yet. Yours can be the first.'));
          return;
        }
        var titlesByTopic: Record<string, any> = {};
        d.topics.forEach(function (t: any) {
          /* A blocked member's topics do not exist for you (block unification). */
          if (t.author_hash && isBlocked(t.author_hash)) return;
          var row = el('div', 'board-topic');
          var left = el('div', 'board-topic-left');
          var title = el('a', 'board-topic-title', t.title);
          title.href = 'community.html?topic=' + t.id;
          left.appendChild(title);
          titlesByTopic[t.id] = title;
          if (t.sticky) left.appendChild(el('span', 'board-sticky', '(sticky)'));
          if (t.locked) left.appendChild(el('span', 'board-locked', '(locked)'));
          if (t.readonly) left.appendChild(el('span', 'board-locked', '(read only)'));
          /* Jump straight into a page of this thread. Replies paginate 20 to a
             page (the server's TOPICS_PER_PAGE); the bar hides below two. */
          var tPager = pageBar(t.replies, 20, 0, function (i) {
            return 'community.html?topic=' + t.id + '&p=' + i;
          });
          if (tPager) {
            tPager.className = 'board-pages topic-pages';
            left.appendChild(tPager);
          }
          /* The one dim secondary line under the title: last poster (a jump to
             the newest post, never a profile) · compact time. The right column
             keeps only the count. */
          var sub = el('div', 'board-row-sub');
          var who = t.author_hash ? (t.nick || displayName(t.author_hash)) : 'Anonymous';
          var wholink = el('a', null, who);
          wholink.href = 'community.html?topic=' + t.id + '#comment-' + (t.last_id || t.id);
          sub.appendChild(wholink);
          sub.appendChild(document.createTextNode(' · ' + fmtTimeCompact(t.last)));
          sub.title = fmtDateTime(t.last);
          left.appendChild(sub);
          row.appendChild(left);
          var tstat = el('div', 'board-stats', t.replies + (t.replies === 1 ? ' reply' : ' replies'));
          tstat.title = fmtDateTime(t.last);
          row.appendChild(tstat);
          /* Admin controls ride the bottom-right corner of the row, well clear
             of the title, pager, and author links, against fat-finger taps. */
          if (isAdmin()) row.appendChild(topicAdminCorner(t, key));
          list.appendChild(row);
        });
        /* Mark the threads new since your last visit — a separate keyed call so
           the listing itself stays public and cacheable. */
        if (state.key) {
          cachedJson(API + '/board/reads', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: state.key, cat: key }),
          }, 45000).then(function (rd) {
            if (blockedOut(rd) || !rd.ok) return;
            (rd.unread || []).forEach(function (id: any) {
              var t = titlesByTopic[id];
              if (t) { t.className = 'board-topic-title dm-unread'; t.parentNode.insertBefore(el('span', 'dm-unread', ' ● new'), t.nextSibling); }
            });
          }).catch(function () {});
        }
        function catHref(i: any) { return 'community.html?cat=' + key + '&p=' + i; }
        var topBar = pageBar(d.total, d.per, d.page, catHref);
        if (topBar) section.insertBefore(topBar, list);
        var botBar = pageBar(d.total, d.per, d.page, catHref);
        if (botBar) section.insertBefore(botBar, section.querySelector('.comment-form'));
      })
      .catch(function () {
        list.textContent = '';
        list.appendChild(el('p', 'comments-status', 'Topics could not be loaded. Check your connection and reload the page.'));
      });
  }

  function viewTopic(id: any) {
    if (window.mcViews && window.mcViews.topic) return window.mcViews.topic(section, window.mcKit, id);
    var qs = new URLSearchParams(location.search);
    /* Zero when no explicit page, so a bare #comment-N link takes the find
       branch and the server resolves which page that comment lives on. */
    var pNum = Math.floor(Number(qs.get('p')) || 0);
    var hashMatch = /^#comment-(\d+)$/.exec(location.hash);
    var extra = pNum ? '&p=' + pNum : (hashMatch ? '&find=' + hashMatch[1] : '');
    /* Stand something up BEFORE the round trip. This view used to render
       nothing until its fetch resolved — a blank section for the whole wait. */
    crumb([['Community', 'community.html'], ['Topic']]);
    section.appendChild(skeleton());
    cachedJson(API + '/board/topic?id=' + id + extra + freshParam('&'), freshOpts(), 30000)
      .then(function (d) {
        /* A topic the public read cannot see might be an admins-only one —
           the refusal is indistinguishable from a missing topic by design, so
           a keyed reader knocks once on the keyed door and the server judges;
           for a truly missing topic that door answers the same not-found. */
        if (d && !d.ok && state.key) {
          return fetchRetry(API + '/board/admin', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: state.key, id: id, p: pNum || undefined,
              find: hashMatch ? hashMatch[1] : undefined }),
          }, [1000, 3000]).then(function (r) { return r.json(); });
        }
        return d;
      })
      .then(function (d) {
        if (!d.ok) throw new Error(d.error || 'failed');
        /* Drop the placeholder crumb + skeleton; the real ones follow. */
        section.textContent = '';
        var cat = catByKey(d.cat);
        state.anonAllowed = !!d.anon;
        document.title = d.topic.title + ' | Community';
        /* Opening a thread marks it read for the "new since last visit" state
           AND reads its notifications — however you got here. Deduped so paging
           within the thread does not re-write each turn; the reply's fresh unread
           count corrects the badge on this very page. */
        if (state.key) markThreadRead(d.topic.id);
        crumb([['Community', 'community.html'], [(cat as any)[1], 'community.html?cat=' + d.cat], [d.topic.title]]);
        var headEl = el('h2', 'board-topic-head', d.topic.title);
        if (d.topic.sticky) headEl.appendChild(el('span', 'board-sticky', '(sticky)'));
        if (d.topic.locked) headEl.appendChild(el('span', 'board-locked', '(locked)'));
        if (d.topic.readonly) headEl.appendChild(el('span', 'board-locked', '(read only)'));
        var topicRss = el('a', 'comments-rss', 'RSS');
        topicRss.href = API + '/feed?topic=' + d.topic.id;
        topicRss.title = 'Follow this topic with a feed reader';
        if (d.cat === 'adminsonly') topicRss.hidden = true;
        headEl.appendChild(topicRss);
        section.appendChild(headEl);
        if (state.key) {
          var wctrl = el('p', 'board-intro');
          wctrl.appendChild(watchToggle(d.topic.id));
          section.appendChild(wctrl);
        }
        var list = el('div', 'comments-list');
        section.appendChild(list);
        if (d.page === 1) list.appendChild(commentNode(d.topic, false, { topicId: id }));
        d.replies.forEach(function (c: any) { list.appendChild(commentNode(c, false, { topicId: id })); });
        /* the viewer's own reactions ride a keyed read after the cached payload */
        reactLoadMine('post', (d.page === 1 ? [d.topic.id] : []).concat(d.replies.map(function (c: any) { return c.id; })));
        function topicHref(i: any) { return 'community.html?topic=' + id + '&p=' + i; }
        var topBar = pageBar(d.total, d.per, d.page, topicHref);
        if (topBar) section.insertBefore(topBar, list);
        var botBar = pageBar(d.total, d.per, d.page, topicHref);
        if (botBar) section.appendChild(botBar);
        section.appendChild(el('p', 'comments-status', ''));
        if (d.topic.locked) {
          section.appendChild(el('p', 'comments-status', 'This topic is locked. No new replies.'));
          if (/^#comment-\d+$/.test(location.hash)) {
            var lockedTarget = document.getElementById(location.hash.slice(1));
            if (lockedTarget) lockedTarget.scrollIntoView();
          }
          annotateMeta('board:' + d.cat);
          return;
        }
        /* Read-only: everyone reads, only admins post (unlike lock). A non-admin
           gets the notice and no composer; an admin falls through to the form. */
        if (d.topic.readonly && !isAdmin()) {
          section.appendChild(el('p', 'comments-status', 'This is a read-only topic. Only the site can post here.'));
          if (/^#comment-\d+$/.test(location.hash)) {
            var roTarget = document.getElementById(location.hash.slice(1));
            if (roTarget) roTarget.scrollIntoView();
          }
          annotateMeta('board:' + d.cat);
          return;
        }
        buildBoardForm(false, 'Reply');
        boardButtons('Reply', function () {
          var ta = section.querySelector('.comment-form .comment-text') as any;
          var body = ta.value.replace(/\s+$/, '');
          var status = section.querySelector('.form-status') as HTMLElement;
          if (!body.trim()) {
            if (ta.mcPreview) ta.mcPreview.off();
            ta.focus();
            return;
          }
          boardPost({ topic: id, body: body }, function (d2: any) {
            ta.value = '';
            if (ta.mcDraftDone) ta.mcDraftDone();
            if (ta.mcPreview) ta.mcPreview.off();
            if (d2.status === 'pending') {
              status.textContent = 'Held for review. It will appear once approved.';
              return;
            }
            /* A new reply belongs at the end of the last page. Show it inline
               only when that is the page on screen; otherwise jump to it so it
               is never dropped in the middle of an earlier page. */
            var replyPage = Math.ceil((d.total + 1) / d.per);
            if (replyPage === d.page) {
              d.total += 1;
              var node = commentNode(d2.comment, false, { topicId: id });
              list.appendChild(node);
              status.textContent = 'Posted.';
              node.scrollIntoView();
            } else {
              go('community.html?topic=' + id + '&p=' + replyPage + '#comment-' + d2.comment.id);
            }
          });
        });
        armBoardForm();
        attachMentions(section.querySelector('.comment-form .comment-text'));
        attachDraft(section.querySelector('.comment-form .comment-text'), 'reply:' + id);
        if (/^#comment-\d+$/.test(location.hash)) {
          var target = document.getElementById(location.hash.slice(1));
          if (target) target.scrollIntoView();
        }
        annotateMeta('board:' + d.cat);
      })
      .catch(function (err) {
        section.textContent = '';
        crumb([['Community', 'community.html'], ['Topic']]);
        section.appendChild(el('p', 'comments-status',
          err.message === 'No such topic.' ? 'No such topic. It may have been removed.'
            : 'The topic could not be loaded. Check your connection and reload the page.'));
      });
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
    if (window.mcViews && window.mcViews.search) return window.mcViews.search(section, window.mcKit);
    var qs = new URLSearchParams(location.search);
    var q = qs.get('q') || '';
    var cat0 = qs.get('cat') || '';
    var author0 = qs.get('author') || '';
    var sort0 = qs.get('sort') || '';
    document.title = 'Search | Community';
    crumb([['Community', 'community.html'], ['Search']]);
    /* Search is for logged-in members only. A logged-out visitor who lands on a
       shared ?q= link is told to log in rather than shown the search UI. */
    if (!(isMember())) {
      section.appendChild(el('p', 'comments-status',
        'Search is for logged-in members. Create an identity or paste your key above, then search the board.'));
      return;
    }

    var form = el('form', 'board-search');
    var row1 = el('div', 'key-row');
    var qInput = el('input', 'key-input');
    qInput.type = 'search';
    qInput.value = q;
    qInput.placeholder = 'Search the board... "quotes" for an exact phrase';
    row1.appendChild(qInput);
    var goBtn = el('button', 'btn btn-send', 'Search');
    goBtn.type = 'submit';
    row1.appendChild(goBtn);
    form.appendChild(row1);

    var row2 = el('div', 'key-row');
    var catSel = el('select', 'board-move');
    var allOpt = el('option', null, 'All categories'); allOpt.value = '';
    catSel.appendChild(allOpt);
    CATS.forEach(function (c) {
      if (c[0] === 'adminsonly') return;
      var o = el('option', null, c[1]); o.value = c[0];
      if (c[0] === cat0) o.selected = true;
      catSel.appendChild(o);
    });
    row2.appendChild(catSel);
    var authorInput = el('input', 'key-input');
    authorInput.type = 'text';
    authorInput.placeholder = '@author (optional)';
    row2.appendChild(authorInput);
    var sortSel = el('select', 'board-move');
    [['', 'Most relevant'], ['new', 'Newest first']].forEach(function (s) {
      var o = el('option', null, s[1]); o.value = s[0];
      if (s[0] === sort0) o.selected = true;
      sortSel.appendChild(o);
    });
    row2.appendChild(sortSel);
    form.appendChild(row2);
    section.appendChild(form);

    var authorPicker = attachAuthorPicker(authorInput);
    if (/^[0-9a-f]{64}$/.test(author0)) authorPicker.set(author0, displayName(author0));

    form.addEventListener('submit', function (e: any) {
      e.preventDefault();
      var u = 'community.html?q=' + encodeURIComponent(qInput.value.trim());
      if (catSel.value) u += '&cat=' + catSel.value;
      if (authorPicker.hash()) u += '&author=' + authorPicker.hash();
      if (sortSel.value) u += '&sort=' + sortSel.value;
      go(u);
    });

    var count = el('p', 'comments-status', '');
    section.appendChild(count);
    var list = el('div', 'board-topics');
    section.appendChild(list);
    if (!q.trim()) { count.textContent = 'Type a search above. Put "quotes" around an exact phrase.'; return; }

    count.textContent = 'Searching...';
    var page = Math.max(1, Math.floor(Number(qs.get('p')) || 1));
    function apiUrl(pg: any) {
      var u = API + '/search?q=' + encodeURIComponent(q);
      if (cat0) u += '&cat=' + encodeURIComponent(cat0);
      if (author0) u += '&author=' + encodeURIComponent(author0);
      if (sort0) u += '&sort=' + encodeURIComponent(sort0);
      return u + '&p=' + pg;
    }
    function pageHref(i: any) {
      var u = 'community.html?q=' + encodeURIComponent(q);
      if (cat0) u += '&cat=' + encodeURIComponent(cat0);
      if (author0) u += '&author=' + encodeURIComponent(author0);
      if (sort0) u += '&sort=' + encodeURIComponent(sort0);
      return u + '&p=' + i;
    }
    fetchRetry(apiUrl(page) + freshParam('&'), freshOpts(), [1000, 3000])
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok) throw new Error(d.error || 'failed');
        list.textContent = '';
        if (!d.items.length) { count.textContent = 'Nothing found for that search.'; return; }
        count.textContent = d.total + (d.total === 1 ? ' result.' : ' results.');
        d.items.forEach(function (it: any) {
          /* A blocked member's posts do not surface in search (block unification). */
          if (it.author_hash && isBlocked(it.author_hash)) return;
          var rowEl = el('div', 'board-topic');
          var left = el('div', 'board-topic-left');
          var a = el('a', 'board-topic-title', it.title || 'a thread');
          a.href = 'community.html?topic=' + it.topic_id + '#comment-' + it.comment_id;
          left.appendChild(a);
          if (it.snip) left.appendChild(searchSnippet(it.snip));
          rowEl.appendChild(left);
          var who = it.nick || (it.author_hash ? displayName(it.author_hash) : 'Anonymous');
          var ce = catByKey(it.cat);
          var sstat = el('div', 'board-stats', who + ' · ' + (ce ? ce[1] : it.cat) + ' · ' + fmtTimeCompact(it.created_at));
          sstat.title = fmtDateTime(it.created_at);
          rowEl.appendChild(sstat);
          list.appendChild(rowEl);
        });
        var top = pageBar(d.total, d.per, d.page, pageHref);
        if (top) section.insertBefore(top, list);
        var bot = pageBar(d.total, d.per, d.page, pageHref);
        if (bot) section.appendChild(bot);
      })
      .catch(function () {
        count.textContent = '';
        list.textContent = '';
        list.appendChild(el('p', 'comments-status', 'Search could not be run. Check your connection and reload the page.'));
      });
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
