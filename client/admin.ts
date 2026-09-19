/* The admin views — Administrative options, Platform settings (Alerts, Health), the Discord webhooks, the roster, the audit, IP bans, shadow bans, users, usage — and the pending queue. LAZY (P2-5, 2026-09-16): its own chunk, fetched the first time an admin route opens; nothing eager binds a name from here.
   Split out of client/admin.ts on 2026-09-16 (the six DM factories); every declaration
   moved verbatim. Names from the boot and the other modules are bound in bind(). */
import type { Boot } from './boot';

export function installAdmin(B: Boot) {
  /* Names this module takes from the boot — the root's helpers and the other
     modules' exports — bound in bind() once every module is installed, so
     order of installation never matters and every body reads as it did. */
  let API: any;
  let annotateProfileMeta: (hash: any, card: any) => any;
  let appConfirm: (msg: any, opts: any, cb: any) => any;
  let attachAuthorPicker: (input: any, actionLabel?: any) => any;
  let authorNode: (hash: any, nick: any, withSub: any, faith?: any, posts?: any) => any;
  let busy: (el: any, p: Promise<any>) => any;
  let catByKey: (key: any) => any;
  let crumb: (parts: any) => any;
  let dmTtlChoices: () => any;
  let el: (tag: string, cls?: string | null, text?: string | number | null) => any;
  let ensureDmStyles: () => any;
  let fetchRetry: (url: string, opts: RequestInit | undefined, delays: number[], onRetry?: () => void) => Promise<Response>;
  let fmtBytes: (n: any) => any;
  let fmtDateTime: (epoch: any) => any;
  let go: (href: string, replace?: boolean) => any;
  let profileHref: (hash: any) => any;
  let section: any;
  let state: any;
  let wallMediaNode: (mediaKey: any, post: any) => any;
  let adminGate: (rerender: unknown) => any;
  let topicAdminCorner: (topic: unknown, curCat: unknown) => any;

  /* Platform usage & limits: the Cloudflare free-tier health bars. A
     bundle-only Lit view (mc-usage in app/views/admin.ts) — admin pages
     require the app anyway, so there is no classic body to fall back to. */
  function viewUsage() {
    /* The Lit view is THE screen (2026-09-16): the bundle always stands — docs/nav.js
       injects it on every page and this boot waits for it — so the classic body that
       once stood in for it is gone; only the door remains. */
    return window.mcViews!.usage(section, window.mcKit);
  }

  /* The admin hub: one door from the board that gathers the three admin pages,
     so a member of staff picks a task rather than hunting scattered links. */
  function viewAdminHome() {
    /* The Lit view is THE screen (2026-09-16): the bundle always stands — docs/nav.js
       injects it on every page and this boot waits for it — so the classic body that
       once stood in for it is gone; only the door remains. */
    return window.mcViews!.adminHome(section, window.mcKit);
  }

  /* Add or remove admins. Owners (set in the worker config) show as permanent;
     everyone else carries a (remove). Adding is by the same @-mention picker as
     the rest of the site: type a name, pick a member, add. */
  function viewAdmins() {
    document.title = 'Add / Remove Admins | Community';
    crumb([['Community', 'community.html'], ['Administrative options', 'admin.html'], ['Add / Remove Admins']]);
    if (adminGate(viewAdmins)) return;
    section.appendChild(el('p', 'board-intro',
      'An admin can moderate every post, manage IP bans, and manage this list. All admins are equal: any admin can add or remove any other, yourself included. The board keeps at least one admin, so the last one cannot be removed until another is added.'));
    var addBox = el('div', 'key-box');
    addBox.hidden = false;
    addBox.appendChild(el('p', 'key-note', 'Add an admin. Type @ and a name to find a member, then pick them.'));
    var row = el('div', 'key-row');
    var input = el('input', 'key-input');
    input.type = 'text';
    input.placeholder = '@name';
    row.appendChild(input);
    var addBtn = el('button', 'btn btn-send', 'Add admin');
    addBtn.type = 'button';
    row.appendChild(addBtn);
    addBox.appendChild(row);
    var addNote = el('p', 'form-status');
    addBox.appendChild(addNote);
    section.appendChild(addBox);
    var picker = attachAuthorPicker(input, 'admin');
    var list = el('div', 'board-topics');
    list.textContent = 'Loading...';
    section.appendChild(list);
    function load() {
      fetchRetry(API + '/admins', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: state.key }) }, [1000, 3000])
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (!d.ok) throw new Error(d.error || 'failed');
          list.textContent = '';
          if (!d.admins.length) { list.appendChild(el('p', 'comments-status', 'No admins.')); return; }
          d.admins.forEach(function (a: any) {
            var r = el('div', 'board-topic');
            var mine = a.hash === state.myHash;
            var who = el('a', 'board-topic-title', (a.nick || a.assigned) + (mine ? ' (you)' : ''));
            who.href = profileHref(a.hash);
            r.appendChild(who);
            var rm = el('a', 'trust-toggle', '(remove)');
            rm.href = '#';
            rm.addEventListener('click', function (e: any) {
              e.preventDefault();
              appConfirm(mine
                ? 'Remove your own admin powers? You will lose admin access here.'
                : 'Remove admin powers from ' + (a.nick || a.assigned) + '?', { okLabel: 'Remove', danger: true }, function (ok: any) {
                if (!ok) return;
                fetch(API + '/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ key: state.key, hash: a.hash, admin: false }) })
                  .then(function (x) { return x.json(); })
                  /* Removing yourself ends your access, so leave for the board as a
                     plain member rather than reload a list you can no longer see. */
                  .then(function (x) { if (x.ok) { if (mine) { go('community.html'); } else { load(); } } else { addNote.textContent = x.error || 'Could not remove.'; } })
                  .catch(function () { addNote.textContent = 'Network error. Try again.'; });
              });
            });
            r.appendChild(rm);
            list.appendChild(r);
          });
        })
        .catch(function () { list.textContent = ''; list.appendChild(el('p', 'comments-status', 'The list could not be loaded.')); });
    }
    addBtn.addEventListener('click', function () {
      var hash = picker.hash();
      if (!/^[0-9a-f]{64}$/.test(hash)) { addNote.textContent = 'Type @ and pick a member from the list first.'; return; }
      addNote.textContent = 'Adding...';
      fetch(API + '/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: state.key, hash: hash, admin: true }) })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (!d.ok) { addNote.textContent = d.error || 'Could not add that admin.'; return; }
          input.value = ''; addNote.textContent = 'Added.'; load();
        })
        .catch(function () { addNote.textContent = 'Network error. Try again.'; });
    });
    load();
  }

  function viewAudit() {
    document.title = 'Activity audit | Community';
    crumb([['Community', 'community.html'], ['Administrative options', 'admin.html'], ['Activity audit']]);
    if (adminGate(viewAudit)) return;
    section.appendChild(el('p', 'board-intro',
      'The moderation console. Reported posts first, flagged by members and still live until you rule on them. Then the review queue the automated screen held back. Then the last two weeks of activity across the site pages, the book, and the forums, newest first, every line a link to that exact comment and actionable from here.'));
    /* A running tally at the top, so the work waiting on you is plain before you scroll. */
    var summary = el('p', 'board-intro audit-summary', 'Loading the console...');
    section.appendChild(summary);
    var counts = { reported: null, pending: null };
    function renderSummary() {
      var parts = [
        (counts.reported === null ? '…' : counts.reported) + (counts.reported === 1 ? ' report' : ' reports'),
        (counts.pending === null ? '…' : counts.pending) + ' held for review',
      ];
      summary.textContent = 'Waiting on you: ' + parts.join(' · ') + '.';
    }

    /* Delete any comment (admin power on /delete). Removes its row on success. */
    function deleteCommentLink(id: any, row: any) {
      var a = el('a', 'trust-toggle danger', '(delete)');
      a.href = '#';
      a.addEventListener('click', function (e: any) {
        e.preventDefault();
        appConfirm('Delete this post?', { okLabel: 'Delete', danger: true }, function (ok: any) {
          if (!ok) return;
          fetch(API + '/delete', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: state.key, id: id }),
          }).then(function (r) { return r.json(); }).then(function (r) { if (r.ok) row.remove(); }).catch(function () {});
        });
      });
      return a;
    }
    /* A lazy admin drawer for the row's author: the same fingerprint panel as the
       fingerprint dropdown, fetched only when opened (no /meta per row up front). */
    function authorDrawerLink(hash: any, host: any) {
      var a = el('a', 'trust-toggle', '(author ▾)');
      a.href = '#';
      a.addEventListener('click', function (e: any) {
        e.preventDefault();
        annotateProfileMeta(hash, host);
      });
      return a;
    }
    /* One activity/reported row with its actions: a topic head gets the full
       topic corner (move/sticky/lock/delete); any other post gets a plain delete.
       Every row gets a lazy author drawer, and callers may prepend more via
       extraActs(actsEl, rowEl). */
    function actionRow(linkUrl: any, where: any, r: any, extraActs?: any) {
      var line = el('div', 'board-topic audit-row');
      var left = el('div', 'board-topic-left');
      var a = el('a', 'board-topic-title', where);
      a.href = linkUrl;
      left.appendChild(a);
      if (r.snippet) left.appendChild(el('div', 'audit-snippet', r.snippet));
      line.appendChild(left);
      var rstat = el('div', 'board-stats');
      rstat.appendChild(authorNode(r.author_hash, r.nick, false));
      rstat.appendChild(document.createTextNode(' · ' + fmtDateTime(r.created_at || r.last_reported) +
        (r.status === 'pending' ? ' · pending' : '')));
      line.appendChild(rstat);
      var acts = el('div', 'board-admin-links audit-acts');
      if (extraActs) extraActs(acts, line);
      var isForum = String(r.page).indexOf('board:') === 0;
      var isTopic = Number(r.id) === Number(r.topic_id);
      if (isForum && isTopic) {
        acts.appendChild(topicAdminCorner(
          { id: r.topic_id, title: r.title || '', sticky: r.sticky, locked: r.locked },
          String(r.page).slice(6)));
      } else {
        acts.appendChild(deleteCommentLink(r.id, line));
      }
      acts.appendChild(document.createTextNode(' '));
      acts.appendChild(authorDrawerLink(r.author_hash, left));
      line.appendChild(acts);
      return line;
    }

    /* 1. Reported (populated by the /audit response below). */
    section.appendChild(el('h3', 'board-form-head', 'Reported'));
    section.appendChild(el('p', 'board-intro',
      'Posts members flagged for you. Each stays live and visible until you act. Dismiss clears the flags and leaves the post standing; Delete removes it. Most-reported first.'));
    var reportedBox = el('div', 'board-topics');
    reportedBox.appendChild(el('p', 'comments-status', 'Loading reports...'));
    section.appendChild(reportedBox);

    /* 2. Pending review. */
    renderPending(function (n: any) { counts.pending = n; renderSummary(); });

    /* 3. Recent activity. */
    var status = el('p', 'comments-status', 'Loading activity...');
    section.appendChild(status);
    fetchRetry(API + '/audit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: state.key }),
    }, [1000, 3000], function () { status.textContent = 'Network hiccup, retrying...'; })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok) throw new Error(d.error || 'failed');
        status.remove();
        var days = d.days || 14;

        reportedBox.textContent = '';
        var reports = d.reports || [];
        counts.reported = reports.length;
        renderSummary();
        if (!reports.length) {
          reportedBox.appendChild(el('p', 'comments-status', 'No open reports. Nothing flagged.'));
        }
        reports.forEach(function (r: any) {
          var isForum = String(r.page).indexOf('board:') === 0;
          var where = isForum
            ? ((catByKey(String(r.page).slice(6)) || [])[1] || r.page) + (r.title ? ' › ' + r.title : '')
            : r.page;
          var linkUrl = isForum
            ? 'community.html?topic=' + r.topic_id + '#comment-' + r.id
            : window.mcCore!.commentsPageHref(r.page) + '#comment-' + r.id;
          var row = actionRow(linkUrl, where, r, function (acts: any, line: any) {
            /* Dismiss clears this post's flags but leaves the post itself. */
            var dis = el('a', 'trust-toggle', '(dismiss)');
            dis.href = '#';
            dis.addEventListener('click', function (e: any) {
              e.preventDefault();
              fetch(API + '/report/dismiss', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key: state.key, id: r.id }),
              }).then(function (x) { return x.json(); }).then(function (x) { if (x.ok) line.remove(); }).catch(function () {});
            });
            acts.appendChild(dis);
            acts.appendChild(document.createTextNode(' '));
          });
          var meta = el('div', 'audit-report-meta');
          meta.appendChild(el('strong', null, r.report_count + (r.report_count === 1 ? ' report' : ' reports')));
          if (r.reasons) meta.appendChild(document.createTextNode(': ' + r.reasons));
          row.querySelector('.board-topic-left').appendChild(meta);
          reportedBox.appendChild(row);
        });

        section.appendChild(el('h3', 'board-form-head', 'Site pages and the book · last ' + days + ' days'));
        var pagesScroll = el('div', 'audit-scroll');
        var pagesBox = el('div', 'board-topics');
        if (!d.pages.length) pagesBox.appendChild(el('p', 'comments-status', 'No recent comments.'));
        d.pages.forEach(function (r: any) {
          /* A journal comment jumps to its article (the kernel maps the
             'journal:<id>' key to the permalink); a page comment to its page. */
          pagesBox.appendChild(actionRow(window.mcCore!.commentsPageHref(r.page) + '#comment-' + r.id, r.page, r));
        });
        pagesScroll.appendChild(pagesBox);
        section.appendChild(pagesScroll);

        section.appendChild(el('h3', 'board-form-head', 'Forums · last ' + days + ' days'));
        var topicsScroll = el('div', 'audit-scroll');
        var topicsBox = el('div', 'board-topics');
        if (!d.topics.length) topicsBox.appendChild(el('p', 'comments-status', 'No recent forum posts.'));
        d.topics.forEach(function (r: any) {
          var cat = catByKey(String(r.page).slice(6));
          var where = (cat ? cat[1] : r.page) + (r.title ? ' › ' + r.title : '');
          topicsBox.appendChild(actionRow('community.html?topic=' + r.topic_id + '#comment-' + r.id, where, r));
        });
        topicsScroll.appendChild(topicsBox);
        section.appendChild(topicsScroll);
      })
      .catch(function (err) {
        reportedBox.textContent = '';
        reportedBox.appendChild(el('p', 'comments-status', 'Reports could not be loaded.'));
        status.textContent = err.message === 'No.' ? 'This page is for the admins.'
          : 'The audit could not be loaded. Check your connection and reload the page.';
      });
  }

  /* The pending-review queue: the in-platform replacement for the old email
     approve link. Each held comment gets Approve and Delete, right here. */
  function renderPending(onCount: any) {
    var head = el('h3', 'board-form-head', 'Pending review');
    section.appendChild(head);
    section.appendChild(el('p', 'board-intro', 'Comments the automated screen flagged and held back from publishing. Approve one to publish it, or delete it to discard. An empty list means nothing is waiting on you.'));
    var box = el('div', 'board-topics');
    box.appendChild(el('p', 'comments-status', 'Loading held comments...'));
    section.appendChild(box);
    fetchRetry(API + '/pending', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: state.key }),
    }, [1000, 3000])
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok) throw new Error(d.error || 'failed');
        box.textContent = '';
        var wallRows = d.pending_wall || [];
        if (onCount) onCount(d.pending.length + wallRows.length);
        if (!d.pending.length && !wallRows.length) { box.appendChild(el('p', 'comments-status', 'Nothing held. All clear.')); return; }
        /* One row builder for both queues. The admin sees WHAT is held — the
           attachment renders inline via wallMediaNode (the sweep spares
           pending-linked media precisely so this evidence exists). approve/del
           are the wire calls that clear the row. */
        function pendingRow(c: any, where: any, approve: any, delOpts: any) {
          var row = el('div', 'board-topic pending-row');
          var left = el('div', 'board-topic-left');
          var whereEl = el('div', 'audit-where');
          whereEl.appendChild(authorNode(c.author_hash, c.nick, false));
          whereEl.appendChild(document.createTextNode(' · ' + where + ' · ' + fmtDateTime(c.created_at) +
            (c.ai_verdict ? ' · ' + c.ai_verdict : '')));
          left.appendChild(whereEl);
          left.appendChild(el('div', 'pending-body', c.body));
          if (c.media_key) {
            var mn = wallMediaNode(c.media_key, null);
            if (mn) left.appendChild(mn);
          }
          row.appendChild(left);
          var acts = el('div', 'board-admin-links');
          var app = el('a', 'trust-toggle', '(approve)');
          app.href = '#';
          app.addEventListener('click', function (e: any) {
            e.preventDefault();
            busy(app, fetch(API + '/approve', { method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(Object.assign({ key: state.key, id: c.id }, approve)) })
              .then(function (r) { return r.json(); }).then(function (r) {
                if (r.ok) { row.remove(); return; }
                app.title = r.error || 'Could not approve.';
              })).catch(function () { app.title = 'Could not approve — check your connection.'; });
          });
          var del = el('a', 'trust-toggle danger', '(delete)');
          del.href = '#';
          del.addEventListener('click', function (e: any) {
            e.preventDefault();
            appConfirm('Delete this held ' + (delOpts.what || 'comment') + '?', { okLabel: 'Delete', danger: true }, function (ok: any) {
              if (!ok) return;
              busy(del, fetch(API + delOpts.path, { method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(Object.assign({ key: state.key, id: c.id }, delOpts.body || {})) })
                .then(function (r) { return r.json(); }).then(function (r) {
                  if (r.ok) { row.remove(); return; }
                  del.title = r.error || 'Could not delete.';
                })).catch(function () { del.title = 'Could not delete — check your connection.'; });
            });
          });
          acts.appendChild(app);
          acts.appendChild(document.createTextNode(' '));
          acts.appendChild(del);
          row.appendChild(acts);
          box.appendChild(row);
        }
        d.pending.forEach(function (c: any) {
          var where = c.page.indexOf('board:') === 0
            ? ((catByKey(c.page.slice(6)) || [])[1] || c.page) + (c.title ? ' › ' + c.title : '')
            : c.page;
          pendingRow(c, where, {}, { path: '/delete', what: 'comment' });
        });
        /* Held FEED posts/comments (pending_wall, 2026-08-02 — before this a
           held wall post was stored pending but shown NOWHERE). Approve rides
           the same /approve with a kind discriminator; delete rides the
           existing /wall/delete, which already purges media and fixes counts. */
        wallRows.forEach(function (c: any) {
          var where = c.kind === 'comment' ? 'Feed comment' : 'Feed post';
          pendingRow(c, where,
            { kind: c.kind === 'comment' ? 'wall-comment' : 'wall-post' },
            { path: '/wall/delete', what: c.kind === 'comment' ? 'feed comment' : 'feed post',
              body: { kind: c.kind === 'comment' ? 'comment' : 'post' } });
        });
      })
      .catch(function () { if (onCount) onCount(0); box.textContent = ''; box.appendChild(el('p', 'comments-status', 'The pending queue could not be loaded.')); });
  }

  /* The admin IP-ban list: add or remove IPv4/IPv6 entries by hand, beside the
     one-click bans from the fingerprint dropdown. */
  function viewIpBans() {
    document.title = 'IP ban list | Community';
    crumb([['Community', 'community.html'], ['Administrative options', 'admin.html'], ['IP ban list']]);
    if (adminGate(viewIpBans)) return;
    var addBox = el('div', 'key-box');
    addBox.hidden = false;
    addBox.appendChild(el('p', 'key-note', 'Ban an IP by hand. IPv4 or IPv6, exactly as it appears in a fingerprint.'));
    var row = el('div', 'key-row');
    var input = el('input', 'key-input');
    input.type = 'text';
    input.placeholder = 'e.g. 203.0.113.7 or 2001:db8::1';
    row.appendChild(input);
    var addBtn = el('button', 'btn btn-send', 'Ban IP');
    addBtn.type = 'button';
    row.appendChild(addBtn);
    addBox.appendChild(row);
    var addNote = el('p', 'form-status');
    addBox.appendChild(addNote);
    section.appendChild(addBox);
    var list = el('div', 'board-topics');
    list.textContent = 'Loading...';
    section.appendChild(list);
    function ipValid(s: any) {
      return /^[0-9a-fA-F:.]{3,45}$/.test(s) && (s.indexOf('.') !== -1 || s.indexOf(':') !== -1);
    }
    function load() {
      fetchRetry(API + '/ipbans', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: state.key }) }, [1000, 3000])
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (!d.ok) throw new Error(d.error || 'failed');
          list.textContent = '';
          if (!d.ips.length) { list.appendChild(el('p', 'comments-status', 'No IPs banned.')); return; }
          d.ips.forEach(function (b: any) {
            var r = el('div', 'board-topic');
            r.appendChild(el('span', 'audit-where', b.ip));
            var rm = el('a', 'trust-toggle', '(remove)');
            rm.href = '#';
            rm.addEventListener('click', function (e: any) {
              e.preventDefault();
              fetch(API + '/ipban', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key: state.key, ip: b.ip, banned: false }) })
                .then(function (x) { return x.json(); }).then(function (x) { if (x.ok) load(); }).catch(function () {});
            });
            r.appendChild(rm);
            list.appendChild(r);
          });
        })
        .catch(function () { list.textContent = ''; list.appendChild(el('p', 'comments-status', 'The list could not be loaded.')); });
    }
    addBtn.addEventListener('click', function () {
      var ip = input.value.trim();
      if (!ipValid(ip)) { addNote.textContent = 'That is not a valid IPv4 or IPv6 address.'; return; }
      addNote.textContent = 'Banning...';
      fetch(API + '/ipban', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: state.key, ip: ip, banned: true }) })
        .then(function (r) { return r.json(); }).then(function (d) {
          if (!d.ok) { addNote.textContent = d.error || 'Could not ban that IP.'; return; }
          input.value = ''; addNote.textContent = ''; load();
        }).catch(function () { addNote.textContent = 'Network error. Try again.'; });
    });
    load();
  }

  /* Shadow-ban roster, the twin of the IP ban list. A shadow-banned member keeps
     posting and is never told, but nobody else sees their content. Add by picking
     a member (@name), remove with one click. The same reversible action lives in
     each post's fingerprint drawer; this gathers every mute in one place. */
  function viewShadowbans() {
    document.title = 'Shadow bans | Community';
    crumb([['Community', 'community.html'], ['Administrative options', 'admin.html'], ['Shadow bans']]);
    if (adminGate(viewShadowbans)) return;
    section.appendChild(el('p', 'board-intro',
      'A shadow-banned member keeps posting and is never told, but their posts are hidden from everyone else — a quiet mute for someone not worth a full ban. It is fully reversible, and can also be toggled from any of their posts. Admins and the librarian cannot be shadow banned.'));
    var addBox = el('div', 'key-box');
    addBox.hidden = false;
    addBox.appendChild(el('p', 'key-note', 'Shadow ban a member. Type @ and a name to find them, then pick them.'));
    var row = el('div', 'key-row');
    var input = el('input', 'key-input');
    input.type = 'text';
    input.placeholder = '@name';
    row.appendChild(input);
    var addBtn = el('button', 'btn btn-send', 'Shadow ban');
    addBtn.type = 'button';
    row.appendChild(addBtn);
    addBox.appendChild(row);
    var addNote = el('p', 'form-status');
    addBox.appendChild(addNote);
    section.appendChild(addBox);
    var picker = attachAuthorPicker(input, 'shadowban');
    var list = el('div', 'board-topics');
    list.textContent = 'Loading...';
    section.appendChild(list);
    function load() {
      fetchRetry(API + '/shadowban/list', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: state.key }) }, [1000, 3000])
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (!d.ok) throw new Error(d.error || 'failed');
          list.textContent = '';
          if (!d.bans.length) { list.appendChild(el('p', 'comments-status', 'No one is shadow banned.')); return; }
          d.bans.forEach(function (b: any) {
            var r = el('div', 'board-topic');
            var who = el('a', 'board-topic-title', b.nick);
            who.href = profileHref(b.hash);
            r.appendChild(who);
            r.appendChild(el('span', 'board-cat-desc', ' muted ' + fmtDateTime(b.created_at)));
            var rm = el('a', 'trust-toggle', '(un-shadowban)');
            rm.href = '#';
            rm.addEventListener('click', function (e: any) {
              e.preventDefault();
              fetch(API + '/shadowban', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key: state.key, hash: b.hash, on: false }) })
                .then(function (x) { return x.json(); }).then(function (x) { if (x.ok) load(); }).catch(function () {});
            });
            r.appendChild(document.createTextNode(' '));
            r.appendChild(rm);
            list.appendChild(r);
          });
        })
        .catch(function () { list.textContent = ''; list.appendChild(el('p', 'comments-status', 'The list could not be loaded.')); });
    }
    addBtn.addEventListener('click', function () {
      var hash = picker.hash();
      if (!/^[0-9a-f]{64}$/.test(hash)) { addNote.textContent = 'Type @ and pick a member from the list first.'; return; }
      addNote.textContent = 'Shadow banning...';
      fetch(API + '/shadowban', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: state.key, hash: hash, on: true }) })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (!d.ok) { addNote.textContent = d.error || 'Could not shadow ban that member.'; return; }
          input.value = ''; addNote.textContent = 'Done.'; load();
        })
        .catch(function () { addNote.textContent = 'Network error. Try again.'; });
    });
    load();
  }

  /* The member directory: everyone on the board, newest join first, searchable
     by nickname or assigned name across the whole roster (the full list rides
     in on one cached fetch, so a search narrows every page and the pager turns
     in place). Twenty to a page, click a name to open the profile. */
  function viewUsers() {
    /* The Lit view is THE screen (2026-09-16): the bundle always stands — docs/nav.js
       injects it on every page and this boot waits for it — so the classic body that
       once stood in for it is gone; only the door remains. */
    return window.mcViews!.users(section, window.mcKit);
  }

  /* A labelled danger box: an explanation and the destructive action together,
     so the button sits with the setting that governs it and reads clearly. */
  function dangerBox(title: any, explain: any, btnLabel: any, run: any) {
    var box = el('div', 'admin-danger');
    box.appendChild(el('div', 'admin-danger-title', title));
    box.appendChild(el('p', 'admin-danger-explain', explain));
    var btn = el('button', 'btn admin-danger-btn', btnLabel);
    btn.type = 'button';
    var note = el('span', 'form-status admin-danger-note');
    btn.addEventListener('click', function () { run(btn, note); });
    box.appendChild(btn);
    box.appendChild(note);
    return box;
  }

  function viewPlatformSettings() {
    document.title = 'Platform settings | Community';
    crumb([['Community', 'community.html'], ['Administrative options', 'admin.html'], ['Platform settings']]);
    if (adminGate(viewPlatformSettings)) return;
    ensureDmStyles();
    var wrap = el('div', 'admin-settings');
    wrap.textContent = 'Loading…';
    section.appendChild(wrap);
    fetch(API + '/admin/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: state.key }) })
      .then(function (r) { return r.json(); }).then(function (d) {
        if (!d.ok) throw new Error(d.error || 'failed');
        wrap.textContent = '';
        var s = d.settings || {};
        var mdefs: any = (window.mcCore as any).mediaDefaults;
        wrap.appendChild(el('p', 'board-intro', 'First, whether the social layer runs at all. Then three separate media stores — the public feed, the community forum, and private direct messages — each with its own panel: what it accepts, size limits, AI screening, its storage budget, retention, and a one-time purge. A control in one never touches the others.'));

        /* ---- Shared row builders (each appends into the given parent). ---- */
        function checkRow(parent: any, label: any, checked: any, disabled?: any) {
          var r = el('p', 'admin-set-row');
          var cb = el('input'); cb.type = 'checkbox'; cb.checked = !!checked;
          if (disabled) cb.disabled = true;
          r.appendChild(cb);
          r.appendChild(document.createTextNode(' ' + label));
          parent.appendChild(r);
          return cb;
        }
        function numRow(parent: any, label: any, value: any, min: any, max: any, step?: any) {
          var r = el('p', 'admin-set-row');
          r.appendChild(document.createTextNode(label + ': '));
          var inp = el('input'); inp.type = 'number'; inp.min = String(min); inp.max = String(max);
          if (step) inp.step = String(step);
          inp.value = String(value);
          r.appendChild(inp);
          parent.appendChild(r);
          return inp;
        }
        function desc(parent: any, text: any) { parent.appendChild(el('p', 'board-cat-desc', text)); }
        function kindsRow(parent: any, key: any, defMask: any) {
          var r = el('p', 'admin-set-row');
          r.appendChild(document.createTextNode('Allowed kinds: '));
          var cur = (window.mcCore as any).mediaParseKinds(s[key] == null ? defMask : s[key]);
          var boxes: any[] = [];
          ['image', 'video', 'audio'].forEach(function (kn) {
            var cb = el('input');
            cb.type = 'checkbox';
            cb.checked = cur.indexOf(kn) !== -1;
            cb.value = kn;
            r.appendChild(cb);
            r.appendChild(document.createTextNode(' ' + kn + '  '));
            boxes.push(cb);
          });
          parent.appendChild(r);
          return { csv: function () { return boxes.filter(function (b) { return b.checked; }).map(function (b) { return b.value; }).join(','); } };
        }
        /* One per-section media panel: kinds, voice, scan (null = the DM case —
           rendered disabled+unchecked with the honest E2E note, never saved),
           the three per-kind size inputs (prefilled with the EFFECTIVE value:
           section override → legacy global → kernel default; saving writes the
           section keys), the voice-note seconds, the storage budget with live
           usage, and the retention days. Returns getters for the save payload. */
        function mediaPanel(ctx: any, usedBytes: any) {
          var defKinds: any = { dm: mdefs.kindsDm, wall: mdefs.kindsWall, board: mdefs.kindsBoard };
          var defCap: any = { dm: Number(mdefs.capDmBytes), wall: Number(mdefs.capWallBytes), board: Number(mdefs.capBoardBytes) };
          var kinds = kindsRow(wrap, 'media_kinds_' + ctx, defKinds[ctx]);
          desc(wrap, 'Unticking everything turns this area’s uploads off.');
          var voice = checkRow(wrap, 'Voice notes (the 🎙 recorder in this area’s composers)', s['media_voice_' + ctx] !== '0');
          var scan: any = null;
          if (ctx === 'dm') {
            checkRow(wrap, 'AI-screen images before they are stored', false, true);
            desc(wrap, 'Not possible here, by design: direct-message attachments are end-to-end encrypted — the server holds only ciphertext and can never see, let alone scan, what is inside.');
          } else {
            scan = checkRow(wrap, 'AI-screen images before they are stored (flagged images are refused at upload)', s['media_scan_' + ctx] !== '0');
            desc(wrap, 'Uses the same vision model as avatar screening. If the screen itself cannot run, the image passes (fail-open). Video and audio are never scanned — they are size-capped and passed through.');
          }
          function effBytes(kind: any) {
            return Number(s['media_' + ctx + '_' + kind + '_max_bytes'])
              || Number(s['media_' + kind + '_max_bytes'])
              || Number(mdefs[kind + 'MaxBytes']);
          }
          var img = numRow(wrap, 'Largest image (MB)', Math.round(effBytes('image') / 1048576), 1, 100);
          var vid = numRow(wrap, 'Largest video (MB)', Math.round(effBytes('video') / 1048576), 1, 100);
          var aud = numRow(wrap, 'Largest audio (MB)', Math.round(effBytes('audio') / 1048576), 1, 100);
          if (ctx === 'dm') desc(wrap, 'Advisory for DMs: the server sees only ciphertext bytes, so the strict wall is the largest of these plus a small allowance.');
          var secs = numRow(wrap, 'Voice note limit (seconds)',
            Math.floor(Number(s['media_audio_max_seconds_' + ctx]) || Number(s.media_audio_max_seconds) || Number(mdefs.audioMaxSeconds)), 30, 600);
          var curCap = Number(s['media_cap_' + ctx + '_bytes']) || defCap[ctx];
          var capR = el('p', 'admin-set-row');
          capR.appendChild(document.createTextNode('Storage budget (GB): '));
          var capInp = el('input'); capInp.type = 'number'; capInp.min = '0.1'; capInp.max = '9'; capInp.step = '0.1';
          capInp.value = String(Math.round(curCap / 1073741824 * 10) / 10);
          capR.appendChild(capInp);
          capR.appendChild(document.createTextNode('  — ' + fmtBytes(usedBytes) + ' of ' + fmtBytes(curCap) + ' used'));
          wrap.appendChild(capR);
          desc(wrap, 'Uploads are refused near this budget; it never deletes existing media on its own.');
          var ret;
          if (ctx === 'dm') {
            ret = numRow(wrap, 'Attachments always expire after (days)', Math.floor(Number(s.media_dm_retention_days) || 30), 1, 90);
            desc(wrap, 'The hard cap on any DM attachment’s life — even inside a saved message (1–90 days; message text follows its own disappear timer).');
          } else {
            ret = numRow(wrap, 'Delete this area’s media older than (days, 0 = keep forever)', Math.floor(Number(s['media_' + ctx + '_retention_days']) || 0), 0, 3650);
            desc(wrap, 'Media-only retention: the post and its text stay, with an honest “attachment expired” note where the file was. 0 keeps media as long as its post lives.');
          }
          return { kinds: kinds, voice: voice, scan: scan, img: img, vid: vid, aud: aud, secs: secs, cap: capInp, ret: ret };
        }

        /* One shared purge-all builder: section name → dangerBox wired to that
           section's own purge endpoint. Text is kept everywhere; only media
           bytes are retracted (parents get the honest expired placeholder). */
        function purgeBox(title: any, explain: any, confirmText: any, path: any) {
          return dangerBox(title, explain, title, function (btn: any, note: any) {
            appConfirm(confirmText, { okLabel: 'Purge all', danger: true }, function (ok: any) {
              if (!ok) return;
              btn.disabled = true; note.textContent = ' Purging…';
              fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key: state.key }) }).then(function (r) { return r.json(); }).then(function (d3) {
                btn.disabled = false;
                if (!d3 || !d3.ok) { note.textContent = ' Purge failed.'; return; }
                /* A big store purges in bounded bites (free-tier budget) —
                   the server reports what is left, the admin clicks on. */
                note.textContent = (d3.remaining > 0)
                  ? (' Purged ' + d3.deleted + ' files — ' + d3.remaining + ' remain, click again to continue.')
                  : (' Purged ' + d3.deleted + ' files.');
              }).catch(function () { btn.disabled = false; note.textContent = ' Purge failed.'; });
            });
          });
        }

        /* ---- Social (Feed & member walls) ----
           The platform-level kill switch, kept above the media panels because it
           governs whether those surfaces exist at all. Polarity comes from the
           kernel (Domain.Wall), the same rule the worker applies. */
        wrap.appendChild(el('h3', null, 'Social (Feed & member walls)'));
        var socCb = checkRow(wrap, 'The Feed and member walls are on',
          (window.mcCore as any).wallEnabledFrom(s.social_enabled));
        desc(wrap, 'Turned off, the Feed tab disappears from the menu, feed.html and any shared link to a feed post read as a page that never existed, and the wall is removed from every profile — for everyone, admins included. Nothing is deleted: every post, comment, like and saved item stays in the database and comes back exactly as it was when you switch this on again. Profiles, direct messages, and the community forum are unaffected. Allow about five minutes for a change to reach every reader.');

        /* ---- Comments sections (the site's own writings) ----
           One switch per page that may carry a section — the book and the hand
           pages, from the kernel's list (Domain.Comments); a library work is
           never offered. All ship OFF, and the polarity is the kernel's. */
        wrap.appendChild(el('h3', null, 'Comments on our own writings'));
        desc(wrap, 'A comments section may stand under the site’s own writings only — the books and the pages written here — never under a work hosted in the library. Every such page is listed here automatically: a new article or book appears with its own switch on its first build, off until you open it. Turned off, the page shows no section and answers as though it never had one; nothing is deleted, and every comment returns when the section reopens. Allow about five minutes for a change to reach every reader.');
        var cmBoxes: Array<{ path: string; cb: any }> = [];
        [['book', 'Books'], ['article', 'Articles']].forEach(function (grp) {
          var pages = window.mcCore!.commentablePages.filter(function (pg) { return pg.kind === grp[0]; });
          if (!pages.length) return;
          wrap.appendChild(el('h4', null, grp[1]));
          pages.forEach(function (pg) {
            var cb = checkRow(wrap, pg.title + ' (' + pg.path + ')', window.mcCore!.commentsPageEnabled(s.comments_pages, pg.path));
            cmBoxes.push({ path: pg.path, cb: cb });
          });
        });
        /* The journal's switch belongs here with the rest, not down in the
           Journal panel (which governs the page itself): one switch for every
           entry, made with the entry and retired with it. */
        wrap.appendChild(el('h4', null, 'The Journal'));
        var jCm = checkRow(wrap, 'Every journal article carries its own comments section',
          window.mcCore!.commentsJournalFrom(s.comments_journal));
        desc(wrap, 'On, each entry’s page gets a section of its own, made with the entry and retired with it: deleting an entry from the journal topic removes its comments too. Off, no entry shows one and every existing comment waits, undeleted. Whether the Journal page itself is live, and which topic it reads, is set in its own panel further down.');

        /* ---- Verification (Turnstile) ----
           Above the media panels because it governs whether members can post at
           all on some devices. Polarity from the kernel (Domain.Turnstile). */
        wrap.appendChild(el('h3', null, 'Verification (Turnstile)'));
        var tsCb = checkRow(wrap, 'Skip the challenge for members who have already passed one',
          (window.mcCore as any).turnstileSkipFrom(s.turnstile_skip_established));
        desc(wrap, 'A challenge answers one question — is a person here — and an identity with a profile, a comment or a post has already answered it. Leaving this on means such a member is not challenged again on every message; a brand-new identity still is, on its very first write. This is on because the challenge cannot be run at all inside the installed iOS app: mounting the widget there takes the whole page down (a hard reload and a white flash, with the message lost), and six attempts at moving when and where it ran did not change that. Everything else that guards a write is untouched and does the continuous work — the identity key, the block and ban gates, the per-IP rate limits, and the AI screen. Turn this off to demand a challenge on every single write, and expect the installed app to become unusable for sending.');

        /* ---- Media platform (global) ---- */
        wrap.appendChild(el('h3', null, 'Media platform (global)'));
        var enCb = checkRow(wrap, 'Media sharing is on — the master switch for attachments everywhere (feed, forum, and direct messages)', s.media_enabled === '1');
        var szInp = numRow(wrap, 'Absolute per-file ceiling (MB)', Math.round((Number(s.media_max_bytes) || 26214400) / 1048576), 1, 100);
        desc(wrap, 'No per-area size limit below can rise past this ceiling — raising an area past it takes both knobs.');
        var acCb = checkRow(wrap, 'Auto-compress images in the browser before upload', s.media_image_autocompress == null ? true : s.media_image_autocompress === '1');
        desc(wrap, 'How the screening fits together: images on the public feed and forum can be AI-screened before they are stored (per-area toggles below; fail-open if the screen itself cannot run). Video and audio are never scanned — they are size-capped and passed through. Direct-message attachments are end-to-end encrypted: the server holds only ciphertext and can never scan them.');

        /* ---- Feed & member walls (ctx wall) ---- */
        wrap.appendChild(el('h3', null, 'Feed & member walls'));
        desc(wrap, 'The public posts anyone can see — the community feed and members’ own walls — and everything attached to them. Its media store and controls are its own.');
        var pWall = mediaPanel('wall', Number(s.wall_media_bytes) || 0);
        var wpEnRow = el('p', 'admin-set-row');
        var wpEn = el('input'); wpEn.type = 'checkbox'; wpEn.checked = s.wall_prune_enabled === '1';
        wpEnRow.appendChild(wpEn);
        wpEnRow.appendChild(document.createTextNode(' Automatically delete old public POSTS, text and all (off = keep forever)'));
        wrap.appendChild(wpEnRow);
        var wpRow = el('p', 'admin-set-row');
        wpRow.appendChild(document.createTextNode('Post retention — delete public posts older than: '));
        var wpSel = el('select');
        (d.wall_prune_options || [90, 180, 365]).forEach(function (n: any) {
          var label = n === 365 ? '1 year' : (n === 180 ? '6 months' : (n === 90 ? '3 months' : n + ' days'));
          var o = el('option', null, label); o.value = String(n);
          if (Number(s.wall_prune_days) === n) o.selected = true;
          wpSel.appendChild(o);
        });
        wpRow.appendChild(wpSel);
        wrap.appendChild(wpRow);
        desc(wrap, 'Post pruning deletes whole posts (text AND media); the media retention above deletes only aged attachments. This choice drives both the automatic sweep and the button below — save first if you changed it.');
        wrap.appendChild(dangerBox(
          'Prune old public posts now',
          'Delete public feed and wall posts — and their media — older than the retention chosen just above, right now. Posts newer than that stay. This runs once; it does not require the automatic sweep to be on. Cannot be undone.',
          'Prune old public posts',
          function (btn: any, note: any) {
            var days = Number(wpSel.value) || 365;
            var human = days === 365 ? 'a year' : (days === 180 ? '6 months' : (days === 90 ? '3 months' : days + ' days'));
            appConfirm('Delete public feed and wall posts (and their media) older than ' + human + ' right now? Newer posts stay. This cannot be undone.', { okLabel: 'Prune now', danger: true }, function (ok: any) {
              if (!ok) return;
              btn.disabled = true; note.textContent = ' Pruning…';
              fetch(API + '/wall/prune', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key: state.key, days: days }) }).then(function (r) { return r.json(); }).then(function (d4) {
                btn.disabled = false;
                note.textContent = d4 && d4.ok ? (' Deleted ' + d4.deleted + ' posts.') : ' Prune failed.';
              }).catch(function () { btn.disabled = false; note.textContent = ' Prune failed.'; });
            });
          }));
        wrap.appendChild(purgeBox(
          'Purge all feed & wall media now',
          'Immediately and permanently delete every image, video, and audio file attached to feed and wall posts, of any age. Post text is kept, with an “attachment expired” note where each file was. One-time cleanup; cannot be undone.',
          'Delete EVERY attachment from ALL feed and wall posts, of any age? Post text is kept. This cannot be undone.',
          '/wall/media/purge'));

        /* ---- Community forum (ctx board) ---- */
        wrap.appendChild(el('h3', null, 'Community forum'));
        desc(wrap, 'Attachments on forum topics and replies. Forum posts themselves are kept permanently — only their media is governed here.');
        var pBoard = mediaPanel('board', Number(s.board_media_bytes) || 0);
        wrap.appendChild(purgeBox(
          'Purge all forum attachments now',
          'Immediately and permanently delete every attachment on every forum topic and reply, of any age. The posts and their text are kept, with an “attachment expired” note where each file was. One-time cleanup; cannot be undone.',
          'Delete EVERY attachment from ALL forum topics and replies, of any age? The posts and their text are kept. This cannot be undone.',
          '/board/media/purge'));

        /* ---- Inbox (ctx dm) ---- */
        wrap.appendChild(el('h3', null, 'Inbox (direct messages)'));
        desc(wrap, 'Private, end-to-end encrypted messages between members, and the media attached to them. A separate, opaque store: the server never sees what is inside an attachment.');
        var pDm = mediaPanel('dm', Number(s.dm_media_bytes) || 0);
        var ttlRow = el('p', 'admin-set-row');
        ttlRow.appendChild(document.createTextNode('Default disappear time for new conversations: '));
        var ttlSel = el('select');
        dmTtlChoices().forEach(function (o: any) {
          var opt = el('option', null, o[1]); opt.value = String(o[0]);
          if (Number(s.dm_default_ttl) === o[0]) opt.selected = true;
          ttlSel.appendChild(opt);
        });
        ttlRow.appendChild(ttlSel);
        wrap.appendChild(ttlRow);
        desc(wrap, 'Messages disappear this long after the recipient first opens them. A member can change it per conversation or save a single message from disappearing.');
        var bsInp = numRow(wrap, 'Backstop for unopened messages (days)', Number(s.dm_backstop_days) || 30, 1, 365);
        desc(wrap, 'A never-opened message is deleted after this many days regardless, so nothing lingers forever.');
        wrap.appendChild(purgeBox(
          'Purge all DM attachments now',
          'Immediately and permanently delete every photo, audio, and video from every private conversation, of any age (opened, unopened, and saved alike). Message text is kept. One-time cleanup; cannot be undone.',
          'Delete EVERY attachment from ALL private conversations, of any age? Message text is kept. This cannot be undone.',
          '/dm/media/purge'));

        /* ---- The Journal ---- */
        /* ---- Voice calls ---- */
        wrap.appendChild(el('h3', null, 'Voice calls'));
        desc(wrap, 'Private 1-to-1 voice calls between members, end-to-end encrypted (the server relays only setup metadata — it can never hear a call). Calls connect directly between the two devices wherever the network allows.');
        var vcEn = checkRow(wrap, 'Voice calls are on (off refuses every call server-side and hides the Call button)', s.calls_enabled !== '0');
        var vcTurn = checkRow(wrap, 'Use the TURN relay for strict networks (~15–20% of calls need it to connect)', s.calls_turn !== '0');
        desc(wrap, 'TURN relays encrypted call traffic through Cloudflare when a direct connection is impossible. Free up to 1,000 GB per month (roughly a million relayed call-minutes); past that it bills per GB with no cap — turning it off removes ALL billing exposure, at the price of calls failing on the strictest networks (they will say so honestly).');
        /* The TURN guard (2026-09-17, Domain.Call.turnGuardStep; usage.ts). */
        var vcGuard = checkRow(wrap, 'Switch the relay off by itself near the end of the free pool', s.turn_guard_on !== '0');
        var vcGuardPct = numRow(wrap, 'At this share of the month’s 1,000 GB (%, 10–99)', Number(s.turn_guard_pct) || 95, 10, 99);
        var guardSt: { month?: string; at?: number; used?: number } | null = null;
        try { guardSt = s.turn_guard_state ? JSON.parse(s.turn_guard_state) : null; } catch (e) { guardSt = null; }
        var guardDay = guardSt && guardSt.month ? new Date(Number(guardSt.at) * 1000) : null;
        desc(wrap, (guardDay && isFinite(guardDay.getTime())
          ? 'The guard switched the relay off on ' + guardDay.toISOString().slice(0, 10) + ', at ' + (Number(guardSt!.used) / 1e9).toFixed(1) + ' GB relayed. '
          : '') + 'The nightly usage check reads the month’s relayed traffic and, at this line, switches the relay off and tells you through Alerts; the 1st of the month switches it back on — only if the guard switched it off. Switching the guard off leaves the relay as it stands.');
        var vcIdle = checkRow(wrap, 'End a call automatically when nobody has spoken for a while (a forgotten call should not run all night)', s.calls_idle_hangup !== '0');
        var vcIdleSecs = numRow(wrap, 'Silence before auto-hangup (seconds, 15–600)', Number(s.calls_idle_seconds) || 60, 15, 600);
        desc(wrap, 'Both phones watch the call’s own audio levels — either side speaking resets the clock, and the check never leaves the devices (the server cannot hear a call).');

        wrap.appendChild(el('h3', null, 'The Mere Catholicity Journal'));
        wrap.appendChild(el('p', 'board-cat-desc', 'The public Journal page turns the posts of one forum topic into journal articles. Point it at a topic here, then open that topic and mark it read-only (from its admin controls) so only the site can post into it.'));
        var jEnRow = el('p', 'admin-set-row');
        var jEn = el('input'); jEn.type = 'checkbox'; jEn.checked = s.journal_enabled !== '0';
        jEnRow.appendChild(jEn);
        jEnRow.appendChild(document.createTextNode(' Journal page is live'));
        wrap.appendChild(jEnRow);
        desc(wrap, 'Its comments switch sits with the other comments switches, near the top of this page.');
        var jRow = el('p', 'admin-set-row');
        jRow.appendChild(document.createTextNode('Journal source topic (its numeric id): '));
        var jInp = el('input'); jInp.type = 'number'; jInp.min = '1';
        jInp.value = String(Number(s.journal_topic) || 219);
        jRow.appendChild(jInp);
        wrap.appendChild(jRow);
        var jLinkP = el('p', 'board-cat-desc');
        jLinkP.appendChild(document.createTextNode('View it at '));
        var jLink = el('a', 'body-link', 'the Journal'); jLink.href = 'journal.html';
        jLinkP.appendChild(jLink); jLinkP.appendChild(document.createTextNode('.'));
        wrap.appendChild(jLinkP);

        /* ---- Alerts (2026-09-16): where the worker speaks. Email, Discord,
           a DM to every admin, or all three — a channel speaks when its box is
           ticked AND its field holds a valid value (Domain.Ops.channelsFrom);
           empty or unticked is silent. The DM's field is the roster. ---- */
        wrap.appendChild(el('h3', null, 'Alerts'));
        desc(wrap, 'Where the platform reports trouble — a cron step that failed, a missing daily backup, a usage meter past its band. Email, Discord, a DM to every admin, or all three: a channel speaks when its box is ticked and its field is filled; empty or unticked is silent.');
        var alEmRow = el('p', 'admin-set-row mc-set-key');
        alEmRow.appendChild(el('label', null, 'Alert email address:'));
        var alEm = el('input') as HTMLInputElement;
        alEm.type = 'email'; alEm.placeholder = 'you@example.org'; alEm.autocomplete = 'off';
        alEm.value = String(s.alert_email || '');
        alEmRow.appendChild(alEm);
        wrap.appendChild(alEmRow);
        var alEmOn = checkRow(wrap, 'Send alerts by email', s.alert_email_on !== '0');
        desc(wrap, 'Mail comes from alerts@merecatholicity.com. The address must be a verified destination in Cloudflare → Email Routing → Destination addresses (Cloudflare mails a confirmation link to it); until it is, a test alert reports the refusal right here.');
        var alDcRow = el('p', 'admin-set-row mc-set-key');
        alDcRow.appendChild(el('label', null, 'Alert Discord webhook:'));
        var alDc = el('input') as HTMLInputElement;
        alDc.type = 'url'; alDc.placeholder = 'https://discord.com/api/webhooks/…';
        alDc.value = String(s.alert_discord_webhook || '');
        alDcRow.appendChild(alDc);
        wrap.appendChild(alDcRow);
        var alDcOn = checkRow(wrap, 'Send alerts to Discord', s.alert_discord_on !== '0');
        desc(wrap, 'A channel webhook of its own (Discord: Server Settings → Integrations → Webhooks), separate from the forum and feed announcement hooks on the Discord webhooks page.');
        var alDmOn = checkRow(wrap, 'Send alerts as a DM to every admin', s.alert_dm_on !== '0');
        desc(wrap, 'merecat writes the same words to every admin on the roster, as an automated notice. No field to fill — the roster is the field — and it is the one channel that needs nothing set up outside the platform.');
        function alertKeys() {
          return {
            alert_email: alEm.value.trim(),
            alert_email_on: alEmOn.checked ? '1' : '0',
            alert_discord_webhook: alDc.value.trim(),
            alert_discord_on: alDcOn.checked ? '1' : '0',
            alert_dm_on: alDmOn.checked ? '1' : '0',
          };
        }
        /* The same rule the worker's door applies, so a typo is named before
           the round trip; the server remains the authority. */
        function alertAddressProblem() {
          var v = alEm.value.trim();
          return v && window.mcCore && !window.mcCore.opsIsEmailAddress(v) ? 'That is not a valid email address.' : '';
        }
        var alTest = el('button', 'btn btn-send', 'Send a test alert') as HTMLButtonElement;
        alTest.type = 'button';
        var alTestNote = el('p', 'form-status');
        alTest.addEventListener('click', function () {
          var problem = alertAddressProblem();
          if (problem) { alTestNote.textContent = problem; return; }
          alTest.disabled = true; alTestNote.textContent = 'Saving the alert settings, then sending…';
          /* save these four keys first, so the test speaks through what is on screen */
          fetch(API + '/admin/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: state.key, set: alertKeys() }) }).then(function (r) { return r.json(); }).then(function (d3) {
            if (!d3 || !d3.ok) throw new Error((d3 && d3.error) || 'Save failed.');
            return fetch(API + '/admin/alert-test', { method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ key: state.key }) }).then(function (r) { return r.json(); });
          }).then(function (d4) {
            alTest.disabled = false;
            if (!d4 || !d4.ok) { alTestNote.textContent = (d4 && d4.error) || 'The test could not be sent.'; return; }
            var parts: string[] = [];
            var ch = d4.channels || [];
            if (!ch.length) parts.push('No channel is open — fill a field and tick its box.');
            if (ch.indexOf('email') !== -1) parts.push(d4.email ? 'Email: sent to ' + alEm.value.trim() + '.' : 'Email: refused.');
            if (ch.indexOf('discord') !== -1) parts.push(d4.discord ? 'Discord: posted.' : 'Discord: refused.');
            (d4.errors || []).forEach(function (e: string) { parts.push(e); });
            alTestNote.textContent = parts.join(' ');
          }).catch(function (e) { alTest.disabled = false; alTestNote.textContent = (e && e.message) || 'The test could not be sent.'; });
        });
        wrap.appendChild(alTest);
        wrap.appendChild(alTestNote);

        /* ---- Health (2026-09-16): what the worker knows about itself —
           POST /admin/health (ops.ts readOps). The card is the truth the
           self-check alerts from; "Back up now" runs the same road the 03:15
           cron takes and prints its record. ---- */
        wrap.appendChild(el('h3', null, 'Health'));
        desc(wrap, 'What the worker knows about itself: the last backup and whether its object is really in the bucket, each cron chain\u2019s last heartbeat, the conditions currently alerted, and the nightly headless run\u2019s last report.');
        var hlBox = el('div', 'admin-health');
        hlBox.textContent = 'Loading\u2026';
        wrap.appendChild(hlBox);
        /* the health object, as ops.ts readOps serves it */
        type HealthBeat = { name: string; last: number; age: number | null; stale: boolean; stale_after: number };
        type HealthBackup = { at?: number; key?: string; bytes?: number; tables?: number; rows?: number; ms?: number; error?: string };
        type Health = {
          now: number; ok: boolean; heartbeat: HealthBeat[]; never: string[]; open: string[];
          backup: HealthBackup | null; object: { key: string; size: number } | null;
          webtest: { at: number; pass: number; fail: number; regressions: string[] } | null;
          egress?: Array<{ kind: string; site: string; names: string[]; n: number; last: number; standing: boolean }>;
          shapes?: Array<{ site: string; names: string[]; n: number; last: number; standing: boolean }>;
        };
        function ago(secs: unknown) {
          var n = Number(secs);
          if (!isFinite(n) || n < 0) return '';
          if (n < 90) return n + ' s ago';
          if (n < 5400) return Math.round(n / 60) + ' min ago';
          if (n < 172800) return Math.round(n / 3600) + ' h ago';
          return Math.round(n / 86400) + ' days ago';
        }
        function kb(n: unknown) { var v = Number(n) || 0; return v >= 1048576 ? (v / 1048576).toFixed(1) + ' MB' : Math.round(v / 1024) + ' KB'; }
        function renderHealth(h: Health) {
          hlBox.textContent = '';
          var verdict = el('p', 'admin-set-row', h.ok ? '\u2713 All well.' : '\u26a0 Something needs a look.');
          hlBox.appendChild(verdict);
          var b: HealthBackup = h.backup || {};
          var bLine = el('p', 'board-cat-desc');
          if (!b.key) bLine.textContent = 'Last backup: none recorded yet (the first daily run is at 03:15 UTC).';
          else if (b.error) bLine.textContent = 'Last backup FAILED ' + ago(h.now - Number(b.at)) + ' (' + b.key + '): ' + b.error;
          else bLine.textContent = 'Last backup ' + ago(h.now - Number(b.at)) + ': ' + b.key + ', ' + kb(b.bytes) + ' gzipped, ' + b.tables + ' tables, ' + b.rows + ' rows, ' + b.ms + ' ms.';
          hlBox.appendChild(bLine);
          hlBox.appendChild(el('p', 'board-cat-desc', h.object
            ? 'In the bucket: ' + h.object.key + ' (' + kb(h.object.size) + ').'
            : 'In the bucket: no object for today or yesterday' + (h.never && h.never.indexOf('daily') !== -1 ? ' \u2014 the daily chain has not run yet.' : '.')));
          var hb = el('ul', 'admin-health-beats');
          (h.heartbeat || []).forEach(function (x: HealthBeat) {
            var li = el('li', x.stale ? 'admin-health-stale' : null);
            li.textContent = x.name + ': ' + (x.last ? ago(x.age) : 'never') + (x.stale ? ' \u2014 STALE (presumed dead after ' + Math.round(x.stale_after / 3600) + ' h)' : '');
            hb.appendChild(li);
          });
          hlBox.appendChild(hb);
          hlBox.appendChild(el('p', 'board-cat-desc', (h.open && h.open.length) ? 'Alerted and still standing: ' + h.open.join(', ') : 'No condition is currently alerted.'));
          /* the egress guard (2026-09-17): an answer or a live frame refused for
             carrying a secret, or a handler that tried to copy the sealed env */
          var eg = (h.egress || []).filter(function (x) { return h.now - Number(x.last) < 7 * 86400; });
          hlBox.appendChild(el('p', eg.some(function (x) { return x.standing; }) ? 'board-cat-desc admin-health-stale' : 'board-cat-desc', eg.length
            ? 'Refused for carrying a secret (7 days): ' + eg.map(function (x) {
              return x.site + (x.kind === 'enumerated' ? ' (tried to copy the env)' : x.kind === 'frame' ? ' (a live frame' + (x.names.length ? ': ' + x.names.join(', ') : '') + ')' : (x.names.length ? ' (' + x.names.join(', ') + ')' : '')) + ', ' + x.n + '\u00d7, last ' + ago(h.now - Number(x.last));
            }).join('; ')
            : 'Nothing refused for carrying a secret.'));
          /* answers whose list was not a list (Domain.Wire, 2026-09-17): readers see "could not be loaded" */
          var sh = (h.shapes || []).filter(function (x) { return h.now - Number(x.last) < 7 * 86400; });
          hlBox.appendChild(el('p', sh.some(function (x) { return x.standing; }) ? 'board-cat-desc admin-health-stale' : 'board-cat-desc', sh.length
            ? 'Answers with a broken shape (7 days): ' + sh.map(function (x) {
              return x.site + ' (' + x.names.join(', ') + '), ' + x.n + '\u00d7, last ' + ago(h.now - Number(x.last));
            }).join('; ')
            : 'Every answer kept its shape.'));
          var w = h.webtest;
          hlBox.appendChild(el('p', 'board-cat-desc', w
            ? 'Nightly headless run ' + ago(h.now - Number(w.at)) + ': ' + w.pass + ' passed, ' + w.fail + ' failed' + (w.regressions && w.regressions.length ? ' \u2014 ' + w.regressions.length + ' regression(s): ' + w.regressions.join('; ') : '.')
            : 'Nightly headless run: no report yet.'));
        }
        function loadHealth() {
          return fetch(API + '/admin/health', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: state.key }) }).then(function (r) { return r.json(); }).then(function (d5) {
            if (!d5 || !d5.ok) throw new Error((d5 && d5.error) || 'failed');
            renderHealth(d5.health);
          }).catch(function () { hlBox.textContent = 'The health could not be read.'; });
        }
        loadHealth();
        var hlRow = el('p', 'admin-set-row');
        var bkBtn = el('button', 'btn btn-send', 'Back up now') as HTMLButtonElement;
        bkBtn.type = 'button';
        var rfBtn = el('button', 'btn btn-plain', 'Refresh') as HTMLButtonElement;
        rfBtn.type = 'button';
        var bkNote = el('span', 'form-status');
        bkBtn.addEventListener('click', function () {
          bkBtn.disabled = true; bkNote.textContent = ' Backing up\u2026';
          fetch(API + '/backup', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: state.key }) }).then(function (r) { return r.json(); }).then(function (d6) {
            bkBtn.disabled = false;
            var bk = (d6 && d6.backup) || {};
            bkNote.textContent = bk.error ? ' Backup failed: ' + bk.error : (bk.key ? ' Wrote ' + bk.key + ' (' + kb(bk.bytes) + ', ' + bk.rows + ' rows).' : ' Backup did not answer.');
            loadHealth();
          }).catch(function () { bkBtn.disabled = false; bkNote.textContent = ' Backup failed.'; });
        });
        rfBtn.addEventListener('click', function () { hlBox.textContent = 'Loading\u2026'; loadHealth(); });
        hlRow.appendChild(bkBtn);
        hlRow.appendChild(document.createTextNode(' '));
        hlRow.appendChild(rfBtn);
        hlRow.appendChild(bkNote);
        wrap.appendChild(hlRow);

        /* ---- Save (all tunables above; each panel contributes its own keys —
           the legacy global per-kind size keys are no longer written and stand
           only as server-side fallbacks for areas never saved here). ---- */
        function panelKeys(ctx: any, p: any) {
          var defBytes: any = { image: Number(mdefs.imageMaxBytes), video: Number(mdefs.videoMaxBytes), audio: Number(mdefs.audioMaxBytes) };
          var defCap: any = { dm: Number(mdefs.capDmBytes), wall: Number(mdefs.capWallBytes), board: Number(mdefs.capBoardBytes) };
          var out: any = {};
          out['media_kinds_' + ctx] = p.kinds.csv();
          out['media_voice_' + ctx] = p.voice.checked ? '1' : '0';
          if (p.scan) out['media_scan_' + ctx] = p.scan.checked ? '1' : '0';
          out['media_' + ctx + '_image_max_bytes'] = String(Math.round((Number(p.img.value) || (defBytes.image / 1048576)) * 1048576));
          out['media_' + ctx + '_video_max_bytes'] = String(Math.round((Number(p.vid.value) || (defBytes.video / 1048576)) * 1048576));
          out['media_' + ctx + '_audio_max_bytes'] = String(Math.round((Number(p.aud.value) || (defBytes.audio / 1048576)) * 1048576));
          out['media_audio_max_seconds_' + ctx] = String(Math.floor(Number(p.secs.value) || Number(mdefs.audioMaxSeconds)));
          out['media_cap_' + ctx + '_bytes'] = String(Math.round((Number(p.cap.value) || (defCap[ctx] / 1073741824)) * 1073741824));
          out[ctx === 'dm' ? 'media_dm_retention_days' : 'media_' + ctx + '_retention_days'] =
            ctx === 'dm' ? String(Math.floor(Number(p.ret.value) || 30)) : String(Math.max(0, Math.floor(Number(p.ret.value) || 0)));
          return out;
        }
        var saveBtn = el('button', 'btn btn-send', 'Save settings');
        saveBtn.type = 'button';
        var saveStatus = el('p', 'form-status');
        saveBtn.addEventListener('click', function () {
          var problem = alertAddressProblem();
          if (problem) { saveStatus.textContent = problem; return; }
          saveBtn.disabled = true;
          saveStatus.textContent = 'Saving…';
          var set: any = {
            media_enabled: enCb.checked ? '1' : '0',
            media_max_bytes: String(Math.round((Number(szInp.value) || 25) * 1048576)),
            media_image_autocompress: acCb.checked ? '1' : '0',
            wall_prune_enabled: wpEn.checked ? '1' : '0',
            wall_prune_days: wpSel.value,
            dm_default_ttl: ttlSel.value,
            dm_backstop_days: bsInp.value,
            social_enabled: socCb.checked ? '1' : '0',
            turnstile_skip_established: tsCb.checked ? '1' : '0',
            calls_enabled: vcEn.checked ? '1' : '0',
            calls_turn: vcTurn.checked ? '1' : '0',
            turn_guard_on: vcGuard.checked ? '1' : '0',
            turn_guard_pct: vcGuardPct.value,
            calls_idle_hangup: vcIdle.checked ? '1' : '0',
            calls_idle_seconds: vcIdleSecs.value,
            journal_enabled: jEn.checked ? '1' : '0',
            journal_topic: jInp.value,
            comments_pages: window.mcCore!.commentsSerializeEnabledPages(
              cmBoxes.filter(function (b) { return b.cb.checked; }).map(function (b) { return b.path; })),
            comments_journal: jCm.checked ? '1' : '0',
          };
          Object.assign(set, panelKeys('wall', pWall), panelKeys('board', pBoard), panelKeys('dm', pDm), alertKeys());
          fetch(API + '/admin/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: state.key, set: set }) }).then(function (r) { return r.json(); }).then(function (d2) {
            saveBtn.disabled = false;
            saveStatus.textContent = d2 && d2.ok ? 'Saved.' : ((d2 && d2.error) || 'Save failed.');
          }).catch(function () { saveBtn.disabled = false; saveStatus.textContent = 'Save failed.'; });
        });
        wrap.appendChild(el('hr', 'admin-set-rule'));
        wrap.appendChild(saveBtn);
        wrap.appendChild(saveStatus);
      })
      .catch(function () { wrap.textContent = 'The settings could not be loaded.'; });
  }

  /* Discord webhooks — the one place to wire the site into Discord. Two parts:
     the two GLOBAL webhooks (every forum post / every feed post), and the
     PER-FEED subscriptions (paste one of our feed URLs — ?topic=, ?cat=, or
     ?page= — and a Discord channel webhook, and that feed alone posts there).
     Admin-only, server-enforced. */
  function viewDiscordHooks() {
    document.title = 'Discord webhooks | Community';
    crumb([['Community', 'community.html'], ['Administrative options', 'admin.html'], ['Discord webhooks']]);
    if (adminGate(viewDiscordHooks)) return;
    var wrap = el('div', 'admin-settings');
    section.appendChild(wrap);
    wrap.appendChild(el('p', 'board-intro',
      'Announce community activity to Discord. Create a channel webhook in Discord under Server Settings → Integrations → Webhooks, then paste it here.'));

    /* --- The two coarse global webhooks (app_settings). --- */
    wrap.appendChild(el('h3', null, 'Global webhooks'));
    wrap.appendChild(el('p', 'board-cat-desc', 'Fire on EVERY new post. Leave a box empty to turn that one off.'));
    var gBox = el('div');
    gBox.textContent = 'Loading…';
    wrap.appendChild(gBox);
    fetch(API + '/admin/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: state.key }) })
      .then(function (r) { return r.json(); }).then(function (d) {
        if (!d.ok) throw new Error(d.error || 'failed');
        gBox.textContent = '';
        var s = d.settings || {};
        var dfRow = el('p', 'admin-set-row mc-set-key');
        dfRow.appendChild(el('label', null, 'Forum posts webhook (new topics & replies):'));
        var dfInp = el('input') as HTMLInputElement;
        dfInp.type = 'url'; dfInp.placeholder = 'https://discord.com/api/webhooks/…';
        dfInp.value = String(s.discord_forum_webhook || '');
        dfRow.appendChild(dfInp);
        gBox.appendChild(dfRow);
        var dgRow = el('p', 'admin-set-row mc-set-key');
        dgRow.appendChild(el('label', null, 'Feed posts webhook:'));
        var dgInp = el('input') as HTMLInputElement;
        dgInp.type = 'url'; dgInp.placeholder = 'https://discord.com/api/webhooks/…';
        dgInp.value = String(s.discord_feed_webhook || '');
        dgRow.appendChild(dgInp);
        gBox.appendChild(dgRow);
        /* opt-in: also send feed-post COMMENTS to the feed webhook. Handy early
           on, deliberately off by default (it gets noisy as the platform grows). */
        var fcRow = el('p', 'admin-set-row');
        var fcCb = el('input') as HTMLInputElement;
        fcCb.type = 'checkbox'; fcCb.checked = s.discord_feed_comments === '1';
        fcRow.appendChild(fcCb);
        fcRow.appendChild(document.createTextNode(' Also notify on comments to feed posts (noisier as the community grows)'));
        gBox.appendChild(fcRow);
        var gSave = el('button', 'btn btn-send', 'Save global webhooks') as HTMLButtonElement;
        gSave.type = 'button';
        var gStatus = el('p', 'form-status');
        gSave.addEventListener('click', function () {
          gSave.disabled = true; gStatus.textContent = 'Saving…';
          fetch(API + '/admin/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: state.key, set: {
              discord_forum_webhook: dfInp.value.trim(),
              discord_feed_webhook: dgInp.value.trim(),
              discord_feed_comments: fcCb.checked ? '1' : '0',
            } }) }).then(function (r) { return r.json(); }).then(function (d2) {
            gSave.disabled = false;
            gStatus.textContent = d2 && d2.ok ? 'Saved.' : ((d2 && d2.error) || 'Save failed.');
          }).catch(function () { gSave.disabled = false; gStatus.textContent = 'Save failed.'; });
        });
        gBox.appendChild(gSave);
        gBox.appendChild(gStatus);
      })
      .catch(function () { gBox.textContent = 'The global webhooks could not be loaded.'; });

    /* --- Per-feed subscriptions (discord_hooks). --- */
    wrap.appendChild(el('h3', null, 'Per-feed subscriptions'));
    wrap.appendChild(el('p', 'board-cat-desc',
      'Post one feed to one Discord channel. Paste one of our feed URLs — for example ' +
      'https://merecatholicity.com/api/comments/feed?topic=219 for a single thread, ' +
      '?cat=general for a whole category, or ?page=/credo.html for a page’s comments — ' +
      'and the channel’s webhook. Every new post in that feed is posted to the channel automatically.'));

    var listBox = el('div', 'discord-hooks-list');
    wrap.appendChild(listBox);

    /* The add form. */
    var form = el('div', 'admin-settings');
    var fRow = el('p', 'admin-set-row mc-set-key');
    fRow.appendChild(el('label', null, 'Feed URL:'));
    var feedInp = el('input') as HTMLInputElement;
    feedInp.type = 'url'; feedInp.placeholder = 'https://merecatholicity.com/api/comments/feed?topic=219';
    fRow.appendChild(feedInp);
    form.appendChild(fRow);
    var hRow = el('p', 'admin-set-row mc-set-key');
    hRow.appendChild(el('label', null, 'Discord webhook URL:'));
    var hookInp = el('input') as HTMLInputElement;
    hookInp.type = 'url'; hookInp.placeholder = 'https://discord.com/api/webhooks/…';
    hRow.appendChild(hookInp);
    form.appendChild(hRow);
    var lRow = el('p', 'admin-set-row mc-set-key');
    lRow.appendChild(el('label', null, 'Label (optional):'));
    var labelInp = el('input') as HTMLInputElement;
    labelInp.type = 'text'; labelInp.placeholder = 'e.g. #announcements';
    lRow.appendChild(labelInp);
    form.appendChild(lRow);
    var addBtn = el('button', 'btn btn-send', 'Add subscription') as HTMLButtonElement;
    addBtn.type = 'button';
    var addStatus = el('p', 'form-status');
    addBtn.addEventListener('click', function () {
      var feed = feedInp.value.trim(), hook = hookInp.value.trim();
      if (!feed || !hook) { addStatus.textContent = 'Both a feed URL and a Discord webhook are required.'; return; }
      addBtn.disabled = true; addStatus.textContent = 'Adding…';
      fetch(API + '/admin/discord/add', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: state.key, feed_url: feed, hook_url: hook, label: labelInp.value.trim() }) })
        .then(function (r) { return r.json(); }).then(function (d) {
          addBtn.disabled = false;
          if (d && d.ok) {
            addStatus.textContent = 'Added: ' + (d.scope_label || d.scope) + '.';
            feedInp.value = ''; hookInp.value = ''; labelInp.value = '';
            loadHooks();
          } else { addStatus.textContent = (d && d.error) || 'Could not add.'; }
        }).catch(function () { addBtn.disabled = false; addStatus.textContent = 'Could not add.'; });
    });
    form.appendChild(addBtn);
    form.appendChild(addStatus);
    wrap.appendChild(form);

    function loadHooks() {
      listBox.textContent = 'Loading subscriptions…';
      fetch(API + '/admin/discord/list', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: state.key }) })
        .then(function (r) { return r.json(); }).then(function (d) {
          if (!d.ok) throw new Error(d.error || 'failed');
          listBox.textContent = '';
          var hooks = d.hooks || [];
          if (!hooks.length) { listBox.appendChild(el('p', 'board-cat-desc', 'No per-feed subscriptions yet.')); return; }
          hooks.forEach(function (h: any) {
            var row = el('div', 'board-cat');
            var left = el('div', 'board-cat-left');
            left.appendChild(el('div', 'board-cat-name', (h.label ? (h.label + ' — ') : '') + (h.scope_label || h.scope)));
            left.appendChild(el('div', 'board-cat-desc', 'Feed: ' + h.feed_url));
            left.appendChild(el('div', 'board-cat-desc', 'Channel: ' + (h.hook_hint || 'webhook')));
            row.appendChild(left);
            var rm = el('button', 'btn btn-plain', 'Remove') as HTMLButtonElement;
            rm.type = 'button';
            rm.addEventListener('click', function () {
              appConfirm('Stop posting this feed to Discord?', { okLabel: 'Remove', danger: true }, function (ok: any) {
                if (!ok) return;
                rm.disabled = true;
                fetch(API + '/admin/discord/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ key: state.key, id: h.id }) })
                  .then(function (r) { return r.json(); }).then(function () { loadHooks(); })
                  .catch(function () { rm.disabled = false; });
              });
            });
            row.appendChild(rm);
            listBox.appendChild(row);
          });
        })
        .catch(function () { listBox.textContent = 'The subscriptions could not be loaded.'; });
    }
    loadHooks();
  }

  function bind() {
    API = B.API;
    annotateProfileMeta = B.annotateProfileMeta;
    appConfirm = B.appConfirm;
    attachAuthorPicker = B.attachAuthorPicker;
    authorNode = B.authorNode;
    busy = B.busy;
    catByKey = B.catByKey;
    crumb = B.crumb;
    dmTtlChoices = B.dmTtlChoices;
    el = B.el;
    ensureDmStyles = B.ensureDmStyles;
    fetchRetry = B.fetchRetry;
    fmtBytes = B.fmtBytes;
    fmtDateTime = B.fmtDateTime;
    go = B.go;
    profileHref = B.profileHref;
    section = B.section;
    state = B.state;
    wallMediaNode = B.wallMediaNode;
    adminGate = B.adminGate;
    topicAdminCorner = B.topicAdminCorner;
  }
  function run() {
  }
  return { bind, run, exports: { viewAdminHome, viewAdmins, viewAudit, viewDiscordHooks, viewIpBans, viewPlatformSettings, viewShadowbans, viewUsage, viewUsers } };
}
