/* The post renderer (interior campaign, Wave B3b): commentNode ported
   VERBATIM from comments.js, parameterized by the per-boot kit — the one
   builder every view will render posts through (the topic view consumes it
   at B4; merecat and the page threads follow). Bodies render through the
   living richtext module (window.mcRich). The old copy in comments.js
   stands as the no-bundle fallback and retires at Wave F. */

import * as Core from '../core.ts';

function el(tag: string, cls?: string, text?: string): HTMLElement {
  var node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

  function commentNode(kit: any, c: any, pending?: boolean, quoteCtx?: any, reveal?: boolean): HTMLElement {
    /* A muted member's post shows only a slim line until you choose to see it. */
    if (!reveal && c.author_hash && c.author_hash !== kit.state.myHash && kit.isMuted(c.author_hash)) {
      var ph = el('div', 'board-intro comment-muted');
      ph.id = 'comment-' + c.id;
      ph.appendChild(document.createTextNode('A muted member posted here. '));
      var show = el('a', 'comment-quote-link', 'show') as HTMLAnchorElement;
      show.href = '#';
      show.addEventListener('click', function (e: Event) {
        e.preventDefault();
        var full = commentNode(kit, c, pending, quoteCtx, true);
        if (ph.parentNode) ph.parentNode.replaceChild(full, ph);
      });
      ph.appendChild(show);
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
      var avLink = el('a', 'comment-avatar-link') as HTMLAnchorElement;
      avLink.href = kit.profileHref(c.author_hash);
      var av = el('img', 'comment-avatar') as HTMLImageElement;
      av.src = kit.API + '/avatar?hash=' + c.author_hash + '&v=' + encodeURIComponent(c.avatar);
      av.alt = '';
      av.width = 32;
      av.height = 32;
      avLink.appendChild(av);
      head.appendChild(avLink);
    }
    var author = kit.authorNode(c.author_hash, c.nick, true, c.faith, c.posts);
    author.setAttribute('itemprop', 'author');
    head.appendChild(author);
    /* The house speaks under its own colors. */
    if (c.author_hash && kit.ADMIN_HASHES.indexOf(c.author_hash) !== -1) {
      head.appendChild(el('span', 'comment-admin', '(admin)'));
    }
    /* A door to a private word with the author, for keyed readers only.
       The librarian holds no inbox: its posts carry no DM link. */
    if (Core.canInteract(c.author_hash, kit.state.myHash, kit.MERECAT_BOT_HASH)) {
      var dm = el('a', 'comment-dm', 'Direct Message') as HTMLAnchorElement;
      dm.href = 'community.html?dm=' + c.author_hash;
      dm.title = 'Send a direct message';
      head.appendChild(dm);
      /* Mute this member's posts for yourself. Reloading re-renders the view so
         the mute takes at once, everywhere they appear. */
      var muteLink = el('a', 'comment-quote-link', kit.isMuted(c.author_hash) ? 'unmute' : 'mute') as HTMLAnchorElement;
      muteLink.href = '#';
      muteLink.title = 'Hide this member’s posts, for you only';
      muteLink.addEventListener('click', function (e: Event) {
        e.preventDefault();
        kit.toggleMute(c.author_hash);
        location.reload();
      });
      head.appendChild(muteLink);
      /* Members flag a post for the moderators; admins act directly and don't
         see this. Reporting never hides the post — it only queues it for review. */
      if (!kit.isAdmin()) {
        var reportLink = el('a', 'comment-quote-link', 'report') as HTMLAnchorElement;
        reportLink.href = '#';
        reportLink.title = 'Report this post to the moderators';
        reportLink.addEventListener('click', function (e: Event) {
          e.preventDefault();
          var reason = prompt('Report this post to the moderators.\nOptionally, a short reason:');
          if (reason === null) return;
          fetch(kit.API + '/report', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: kit.state.key, id: c.id, reason: reason }),
          }).then(function (r: Response) { return r.json(); }).then(function (d: any) {
            if (kit.blockedOut(d)) return;
            reportLink.textContent = d.ok ? 'reported' : 'report';
            reportLink.title = d.ok ? 'Reported to the moderators. Thank you.' : (d.error || 'Could not report.');
          }).catch(function () {});
        });
        head.appendChild(reportLink);
      }
    }
    /* The date doubles as the comment's shareable permalink. */
    var date = el('a', 'comment-date', kit.fmtDateTime(c.created_at)) as HTMLAnchorElement;
    date.href = '#comment-' + c.id;
    head.appendChild(date);
    /* Anyone may quote any post into the reply box, so unlike edit/delete this
       is ungated. The selection is grabbed on mousedown, before the click can
       clear it; with none, the whole post (trimmed) is quoted. */
    var quote = el('a', 'comment-quote-link', 'quote') as HTMLAnchorElement;
    quote.href = '#';
    quote.addEventListener('mousedown', function () { kit.quoteGrab(c); });
    quote.addEventListener('click', function (e: Event) {
      e.preventDefault();
      kit.quoteTake(c, quoteCtx);
    });
    head.appendChild(quote);
    if (c.edited_at) head.appendChild(el('span', 'comment-edited', 'edited'));
    if (Core.canEdit(c.author_hash, kit.state.myHash)) {
      var ed = el('a', 'comment-edit', 'edit') as HTMLAnchorElement;
      ed.href = '#';
      ed.addEventListener('click', function (e: Event) {
        e.preventDefault();
        kit.startEdit(c, article);
      });
      head.appendChild(ed);
    }
    if (Core.canDelete(c.author_hash, kit.state.myHash, kit.isAdmin())) {
      var del = el('a', 'comment-delete', 'delete') as HTMLAnchorElement;
      del.href = '#';
      del.addEventListener('click', function (e: Event) {
        e.preventDefault();
        var go = function (ok: boolean) {
          if (!ok) return;
          kit.fetchRetry(kit.API + '/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: c.id, key: kit.state.key }),
          }, [1500]).then(function (r: Response) { return r.json(); }).then(function (d: any) {
            if (d.ok) {
              article.remove();
              /* Same freshness stamp as posting: the deleter's own reloads
                 must not resurrect the comment from the list cache. */
              try { localStorage.setItem('mc-posted-at', String(Date.now())); } catch (e2) {}
            } else kit.setStatus(d.error || 'Could not delete the comment.');
          }).catch(function () {
            kit.setStatus('Network error. The comment was not deleted.');
          });
        };
        if (window.mcConfirm) window.mcConfirm('Delete this comment?', { okLabel: 'Delete', danger: true }).then(go);
        else go(confirm('Delete this comment?'));
      });
      head.appendChild(del);
    }
    article.appendChild(head);
    var body = window.mcRich!.fillBody(el('div', 'comment-body'), c.body,
      c.author_hash === kit.MERECAT_BOT_HASH);
    body.setAttribute('itemprop', 'text');
    article.appendChild(body);
    if (c.signature) article.appendChild(window.mcRich!.fillBody(el('div', 'comment-sig'), c.signature,
      c.author_hash === kit.MERECAT_BOT_HASH));
    if (pending) {
      article.appendChild(el('p', 'comment-note',
        'Held for review. It will appear here once approved.'));
    }
    return article;
  }

window.mcViews = window.mcViews || {};
window.mcViews.commentNode = commentNode;
