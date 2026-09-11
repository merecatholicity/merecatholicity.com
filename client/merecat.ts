/* merecat, the librarian's chat client (Wave F, 2026-09-11 — moved out of
   comments.ts verbatim): the ask screen, threads, dials and the admin page. */
import type { Boot } from './boot';

export function installMerecat(B: Boot) {
  /* Names this module takes from the boot — the root's helpers and the other
     modules' exports — bound in bind() once every module is installed, so
     order of installation never matters and every body reads as it did. */
  let API: any;
  let CATS: any;
  let adminGate: (rerender: any) => any;
  let appConfirm: (msg: any, opts: any, cb: any) => any;
  let attachDraft: (ta: any, ctx: string, titleInput?: any, overwrite?: boolean) => any;
  let blockedOut: (d: any) => any;
  let bootSig: any;
  let crumb: (parts: any) => any;
  let displayName: (hash: any) => any;
  let el: (tag: string, cls?: string | null, text?: string | number | null) => any;
  let fetchRetry: (url: string, opts: RequestInit | undefined, delays: number[], onRetry?: () => void) => Promise<Response>;
  let fillBody: (node: HTMLElement, text: any, plain?: boolean) => any;
  let fmtDateTime: (epoch: any) => any;
  let freshOpts: () => RequestInit | undefined;
  let freshParam: (sep: any) => any;
  let go: (href: string, replace?: boolean) => any;
  let isAdmin: () => any;
  let isMember: () => any;
  let loadingLine: (text: string, cls?: string) => any;
  let mcIcon: (name: any) => any;
  let pageBar: (total: number, per: number, curPage: number, hrefFor: ((n: number) => string) | null, onGo?: (n: number) => void) => HTMLElement | null;
  let profileHref: (hash: any) => any;
  let readEase: any;
  let readMark: any;
  let readThrottled: any;
  let renderIdentity: () => any;
  let scriptureDecor: (a: any, url: any) => any;
  let section: any;
  let skeleton: (kind?: string) => any;
  let stale: any;
  let state: any;
  let swipeDismissesKeyboard: (ta: any, composer: any) => any;

  /* merecat Q&A at a glance: an admin-only, READ-ONLY window on how members use
     the librarian, so the site can see what it is asked and where it falls
     short (what to teach it next). The terms disclose this review. The admin
     observes; there is no composer, no way to ask or reply, nothing to change. */
  function viewMerecatThreads() {
    if (window.mcViews && window.mcViews.merecatThreads) return window.mcViews.merecatThreads(section, window.mcKit);
    document.title = 'merecat Q&A at a glance | Community';
    crumb([['Community', 'community.html'], ['Administrative options', 'admin.html'], ['merecat Q&A']]);
    if (adminGate(viewMerecatThreads)) return;
    section.appendChild(el('p', 'board-intro',
      'Every question put to the librarian in the last thirty days, newest first, read-only. Open one to observe the whole exchange. A thread a member deletes leaves here too, and one saved past thirty days still ages off this view. This is for improving the service, not participating. You cannot ask or reply here.'));
    var pageNum = Math.max(1, Math.floor(Number(new URLSearchParams(location.search).get('p')) || 1));
    var list = el('div', 'board-topics');
    list.textContent = 'Loading…';
    section.appendChild(list);
    var pagerHost = el('div');
    section.appendChild(pagerHost);
    fetchRetry(MERECAT_API + '/admin/threads', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: state.key, p: pageNum }),
    }, [1000, 3000]).then(function (r) { return r.json(); }).then(function (d) {
      if (blockedOut(d)) return;
      if (!d.ok) { list.textContent = d.error === 'No.' ? 'This is for admins alone.' : 'Could not load.'; return; }
      list.textContent = '';
      if (!d.threads.length) { list.appendChild(el('p', 'comments-status', 'No conversations yet.')); return; }
      d.threads.forEach(function (t: any) {
        var row = el('div', 'board-topic');
        var left = el('div', 'board-topic-left');
        var title = el('a', 'board-topic-title', t.title || ('Conversation ' + t.id));
        title.href = 'community.html?merecatthread=' + t.id;
        left.appendChild(title);
        if (t.saved) left.appendChild(el('span', 'board-sticky', ' (saved)'));
        var who = el('div', 'board-cat-desc');
        who.appendChild(document.createTextNode('asked by '));
        var wl = el('a', 'body-link', t.nick || displayName(t.hash));
        wl.href = profileHref(t.hash);
        who.appendChild(wl);
        left.appendChild(who);
        row.appendChild(left);
        var stat = el('div', 'board-stats');
        var q = Math.max(0, Math.ceil((t.msgs || 0) / 2));
        stat.textContent = q + (q === 1 ? ' question · ' : ' questions · ') + fmtDateTime(t.last_at);
        row.appendChild(stat);
        list.appendChild(row);
      });
      var pager = pageBar(d.total, d.per, d.page, function (i) {
        return 'community.html?merecatthreads=1&p=' + i;
      });
      if (pager) pagerHost.appendChild(pager);
    }).catch(function () { list.textContent = 'Could not load the list. Reload to retry.'; });
  }

  /* One conversation, observed. Read-only: the questions as the member wrote
     them, the answers as the librarian gave them (its markdown neutralised the
     same as everywhere), sources shown. No composer, no forward, no controls. */
  function viewMerecatThread(id: any) {
    if (window.mcViews && window.mcViews.merecatThread) return window.mcViews.merecatThread(section, window.mcKit, id);
    document.title = 'Observing a conversation | Community';
    crumb([['Community', 'community.html'], ['Administrative options', 'admin.html'],
      ['merecat Q&A', 'community.html?merecatthreads=1'], ['Conversation ' + id]]);
    if (adminGate(function () { viewMerecatThread(id); })) return;
    if (!Number.isInteger(id) || id < 1) { section.appendChild(el('p', 'comments-status', 'No such conversation.')); return; }
    var note = el('p', 'board-intro', 'Observing only. You cannot ask or reply in this conversation.');
    section.appendChild(note);
    var log = el('div', 'merecat-log');
    section.appendChild(log);
    var status = el('p', 'comments-status', 'Loading…');
    section.appendChild(status);
    fetchRetry(MERECAT_API + '/admin/thread', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: state.key, id: id }),
    }, [1000, 3000]).then(function (r) { return r.json(); }).then(function (d) {
      if (blockedOut(d)) return;
      status.remove();
      if (!d.ok) { section.appendChild(el('p', 'comments-status', d.error === 'No.' ? 'This is for admins alone.' : 'That conversation is gone.')); return; }
      var who = d.chat.nick || displayName(d.chat.hash);
      var head = el('p', 'board-intro');
      head.appendChild(document.createTextNode('Conversation with '));
      var wl = el('a', 'body-link', who);
      wl.href = profileHref(d.chat.hash);
      head.appendChild(wl);
      head.appendChild(document.createTextNode('. Started ' + fmtDateTime(d.chat.created_at) + '.'));
      log.appendChild(head);
      (d.msgs || []).forEach(function (m: any) {
        var msg = el('div', 'merecat-msg ' + (m.role === 'user' ? 'you' : 'cat'));
        msg.appendChild(el('div', 'merecat-who', m.role === 'user' ? who : '🐈 merecat'));
        var body = el('div', 'merecat-body');
        msg.appendChild(body);
        if (m.role === 'user') {
          fillBody(body, m.body);
        } else {
          /* The stored answer verbatim (markdown neutralised, as the reader saw
             it), then a plain sources list. Self-contained, so this admin view
             leans on no helper scoped inside the live chat. */
          fillBody(body, m.body, true);
          var srcs = [];
          try { srcs = JSON.parse(m.sources || '[]'); } catch (e) {}
          if (srcs.length) {
            var ft = el('p', 'merecat-note');
            ft.appendChild(el('strong', null, 'Sources: '));
            srcs.forEach(function (sc: any, i: any) {
              if (i) ft.appendChild(document.createTextNode(' · '));
              var label = '[' + (sc.n || (i + 1)) + '] ' + (sc.title || '');
              if (sc.url) {
                var a = el('a', 'body-link', label);
                a.href = sc.url;
                ft.appendChild(a);
              } else {
                ft.appendChild(el('span', null, label));
              }
            });
            body.appendChild(ft);
          }
        }
        log.appendChild(msg);
      });
    }).catch(function () { status.textContent = 'Could not load the conversation. Reload to retry.'; });
  }

  /* ---- merecat, the librarian ----------------------------------------
     A members-only research chat at ?merecat=1. The worker retrieves from
     the site's own corpus and streams an answer behind a one-line JSON
     preamble carrying the numbered sources; refusals (caps, resting,
     blocked) come back as ordinary JSON. The reply body renders through
     fillBody, so citations like John 6:53 autolink into the KJV reader,
     and the sources footer is built here as plain same-site links. */
  var MERECAT_API = '/api/merecat';
  /* The librarian's fixed pseudo-identity: mentionable in posts and comments
     (type @merecat), never DMable, summoned server-side. Its hash has no
     possible key, so nobody can post as it. */
  var MERECAT_BOT_HASH = 'efb94d8de69dc537e2bba1facbd9db3f849f3927593488d19c07629ce35f54cc';

  /* The daily counters renew at midnight UTC; say it in the reader's own
     clock. Computed locally, shown locally, sent nowhere. */
  function merecatResetLocal() {
    var d = new Date();
    var next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1));
    try {
      return next.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    } catch (e) { return 'midnight UTC'; }
  }

  function ensureMerecatStyles() {
    if (document.getElementById('mc-merecat-css')) return;
    var css = '' +
      '.merecat-intro{display:flex;gap:.65rem;align-items:flex-start;border:1px solid var(--rule);background:var(--surface);border-radius:6px;padding:.7rem .9rem;margin:1rem 0}' +
      '.merecat-cat{font-size:1.7rem;line-height:1.1}' +
      '.merecat-intro p{margin:.15rem 0;font-size:.92rem}' +
      '.merecat-log{margin:.8rem 0}' +
      '.merecat-msg{border:1px solid var(--rule);border-radius:6px;padding:.55rem .8rem;margin:.55rem 0;max-width:92%}' +
      /* mine on the palette's accent tint, the librarian on the neutral surface —
         the same pair the DM bubbles keep (main.css), so the two chats agree */
      '.merecat-msg.you{margin-left:auto;background:var(--bubble-mine,var(--cream));border-color:var(--bubble-mine-rule,var(--rule))}' +
      '.merecat-msg.cat{background:var(--surface)}' +
      '.merecat-who{font-size:.78rem;color:var(--faint);margin-bottom:.3rem}' +
      /* fillBody leaves raw newlines in place, the board renders them with
         pre-wrap (.comment-body does the same), so the bot's paragraphs need it too */
      '.merecat-body{white-space:pre-wrap;overflow-wrap:break-word}' +
      '.merecat-body blockquote{margin:.5em 0 .5em .8em;padding-left:.6em;border-left:3px solid var(--rule);color:var(--ink-soft);white-space:normal}' +
      '.merecat-wait{color:var(--faint);font-style:italic}' +
      '.merecat-note{color:var(--maroon)}' +
      '.merecat-srcs{margin-top:.55rem;padding-top:.45rem;border-top:1px dashed var(--rule);font-size:.84rem}' +
      '.merecat-srcs a{display:block;margin:.15rem 0}' +
      '.merecat-about{border:1px solid var(--rule);border-radius:6px;background:color-mix(in srgb,var(--surface) 80%,transparent);margin:.6rem 0;padding:.1rem .9rem}' +
      '.merecat-about>summary{cursor:pointer;padding:.5rem 0;color:var(--maroon);font-size:.92rem}' +
      '.merecat-about-body{padding:.1rem 0 .8rem}' +
      '.merecat-about-body h3{margin:1em 0 .3em;font-size:1rem}' +
      '.merecat-about-body p{margin:.4em 0;font-size:.92rem}' +
      '.merecat-about-body ul{margin:.4em 0 .4em 1.3em;padding:0;font-size:.9rem}' +
      '.merecat-about-body li{margin:.15em 0}' +
      '.merecat-shelf{margin:.4em 0}' +
      '.merecat-shelf>summary{cursor:pointer;color:var(--maroon);font-size:.9rem}' +
      '.merecat-persona{white-space:pre-wrap;overflow-wrap:break-word;font-size:.85rem;color:var(--ink-soft);border-left:3px solid var(--rule);padding:.4em .8em;margin:.5em 0}' +
      /* the ask row: the DM composer's shape — a rounded, auto-growing field and
         the send button beside it (its word shows on desktop, the icon alone on
         phones, where main.css fixes the row on the tab bar with margin 0 — a
         fixed element's `bottom` places its MARGIN edge, so a margin here would
         float it) */
      '.merecat-form{display:flex;gap:.45rem;align-items:flex-end;margin:.8rem 0 .2rem}' +
      '.merecat-q{flex:1;min-width:0;min-height:0;max-height:168px;resize:none;font:inherit;line-height:1.35;color:var(--ink);background:var(--surface);border:1px solid var(--rule);border-radius:22px;padding:.55rem .9rem}' +
      '.merecat-q:focus{outline:1px solid var(--maroon);border-color:var(--maroon)}' +
      '.merecat-form .btn-send{display:inline-flex;align-items:center;justify-content:center;gap:.4rem;border-radius:22px;flex:none}' +
      '.merecat-form .btn-send .mc-ic{width:1.2rem;height:1.2rem;vertical-align:0}' +
      '.merecat-quota{color:var(--faint);font-size:.85rem;margin:.15rem 0 .9rem}' +
      '.merecat-persona-edit{width:100%;min-height:26em;font:inherit;font-size:.9rem;color:var(--ink);background:var(--surface);border:1px solid var(--rule);border-radius:6px;padding:.6rem .7rem;margin:.4rem 0;resize:vertical;white-space:pre-wrap}' +
      '.merecat-persona-edit:focus{outline:1px solid var(--maroon);border-color:var(--maroon)}' +
      '.merecat-quota strong{color:var(--maroon)}' +
      '.merecat-working{display:inline-flex;align-items:center;gap:.5em;color:var(--faint);font-style:italic}' +
      '.merecat-working .mc-cat-work{font-style:normal;display:inline-block;font-size:1.15em;animation:mc-bob 1s ease-in-out infinite}' +
      '.merecat-working .mc-spin{display:inline-block;width:.85em;height:.85em;border:2px solid var(--rule);border-top-color:var(--maroon);border-radius:50%;animation:mc-spin .8s linear infinite}' +
      '.merecat-working .mc-secs{font-style:normal;font-variant-numeric:tabular-nums;color:var(--ink-soft);min-width:2.4em}' +
      '@keyframes mc-spin{to{transform:rotate(360deg)}}' +
      '@keyframes mc-bob{0%,100%{transform:translateY(0) rotate(-6deg)}50%{transform:translateY(-3px) rotate(6deg)}}' +
      /* the forward drill-down: category, then topic, then confirm */
      '.mc-fwd{margin:.45rem 0 .3rem;border:1px solid var(--rule);border-radius:6px;background:var(--cream);padding:.55rem .65rem;font-size:.9rem;color:var(--ink)}' +
      '.mc-fwd-head{display:flex;justify-content:space-between;align-items:baseline;gap:.6rem}' +
      '.mc-fwd-crumb{margin:.3rem 0 .1rem;font-size:.85rem;color:var(--ink-soft)}' +
      /* 16px floor so a phone never zoom-jumps into the box */
      '.mc-fwd input{width:100%;box-sizing:border-box;font:inherit;font-size:max(16px,.95rem);color:var(--ink);background:var(--surface);border:1px solid var(--rule);border-radius:4px;padding:.45rem .55rem;margin:.3rem 0 .4rem}' +
      '.mc-fwd input:focus{outline:1px solid var(--maroon);border-color:var(--maroon)}' +
      '.mc-fwd-list{max-height:min(45vh,19rem);overflow-y:auto;-webkit-overflow-scrolling:touch;border:1px solid var(--rule);border-radius:4px;background:var(--surface)}' +
      '.mc-fwd-row{display:block;width:100%;text-align:left;font:inherit;font-size:.9rem;color:var(--ink);background:none;border:0;border-bottom:1px solid var(--rule);padding:.55rem .6rem;cursor:pointer}' +
      '.mc-fwd-row:last-child{border-bottom:0}' +
      '.mc-fwd-row:hover,.mc-fwd-row:focus{background:var(--cream)}' +
      '.mc-fwd-meta{color:var(--faint);font-size:.82rem}' +
      '.mc-fwd-locked{opacity:.55;cursor:default}' +
      '.mc-fwd-locked:hover{background:none}' +
      '.mc-fwd-more{color:var(--maroon)}' +
      '.mc-fwd-empty{padding:.55rem .6rem;color:var(--faint)}' +
      '.mc-fwd-note{color:var(--maroon);font-size:.85rem;margin:.25rem 0 0}' +
      '.mc-fwd-sure{margin:.35rem 0 .5rem}' +
      '.mc-fwd-actions{display:flex;flex-wrap:wrap;align-items:center;gap:.9rem}' +
      '.mc-fwd-go{font:inherit;font-size:.9rem;padding:.4rem .9rem;cursor:pointer}' +
      '@media (max-width:620px){.merecat-msg{max-width:100%}.mc-fwd-list{max-height:50vh}}' +
      '@media (max-width:600px){.merecat-form{flex-direction:row;align-items:flex-end;margin:0}' +
        '.merecat-form .btn-send{width:2.6rem;height:2.6rem;min-height:0;min-width:0;padding:0;border-radius:50%}' +
        '.merecat-form .btn-send .merecat-ask-word{display:none}' +
        '.merecat-form .btn-send .mc-ic{width:1.35rem;height:1.35rem}}';
    var st = el('style');
    st.id = 'mc-merecat-css';
    st.textContent = css;
    document.head.appendChild(st);
  }

  function viewMerecat() {
    document.title = 'Ask Merecat AI | Mere Catholicity';
    var crumbP = crumb([['Community', 'community.html'], ['merecat']]);
    /* Inside a conversation the trail grows a third step naming the thread —
       Community › merecat › <the question that opened it> — and
       "merecat" becomes the way back to the main page. The tail updates as
       the truth arrives: a placeholder from the URL, the stored title when a
       reopened thread loads, the question itself when a fresh thread mints. */
    function setCrumb(tail: any) {
      crumbP.textContent = '';
      var short = tail ? (tail.length > 48 ? tail.slice(0, 48) + '…' : tail) : '';
      var parts = [['Community', 'community.html']];
      if (short) { parts.push(['merecat', 'merecat-ai.html']); parts.push([short]); }
      else parts.push(['merecat']);
      parts.forEach(function (part, i) {
        if (i) crumbP.appendChild(document.createTextNode(' › '));
        if (part[1]) {
          var a = el('a', null, part[0]);
          a.href = part[1];
          crumbP.appendChild(a);
        } else {
          crumbP.appendChild(el('span', null, part[0]));
        }
      });
      document.title = (short ? short + ' | ' : '') + 'Ask Merecat AI | Mere Catholicity';
    }
    /* The page is open to everyone; asking needs a free identity, made in
       one click right above the question box. */
    var loggedIn = !!(isMember());
    ensureMerecatStyles();

    var intro = el('div', 'merecat-intro');
    intro.appendChild(el('span', 'merecat-cat', '🐈'));
    var ib = el('div');
    var p1 = el('p');
    p1.appendChild(el('strong', null, 'merecat'));
    p1.appendChild(document.createTextNode(
      ' is the community\u2019s AI librarian, trained to be well-versed within the exact contents of our '));
    var libLink = el('a', 'body-link', 'Library page');
    libLink.href = 'library.html';
    p1.appendChild(libLink);
    p1.appendChild(document.createTextNode('. '));
    /* The rest is folded behind a "read more" so the intro stays a single tidy
       line until the reader asks for the whole thing. */
    var more = el('span', 'merecat-intro-more');
    more.appendChild(document.createTextNode(
      'It answers Orthodox, Roman Catholic, and Protestant questions alike from a merely catholic ground. ' +
      'merecat specializes in theology and the contents of our Library. ' +
      'Anything off-topic will be of a substantially lower quality. '));
    var moreTgl = el('a', 'merecat-intro-toggle', 'read more');
    moreTgl.href = '#';
    moreTgl.addEventListener('click', function (e: any) {
      e.preventDefault();
      var open = more.style.display === 'inline';
      more.style.display = open ? 'none' : 'inline';
      moreTgl.textContent = open ? 'read more' : 'read less';
    });
    p1.appendChild(more);
    p1.appendChild(moreTgl);
    ib.appendChild(p1);
    intro.appendChild(ib);
    section.appendChild(intro);


    /* Saved conversations, the DM idiom: each thread keeps for thirty days
       from its last message, owner-keyed, deletable at once. Arriving with
       ?chat=<id> reopens a thread, and a fresh question mints one whose id
       the answer's preamble carries back. */
    var chatId = Number(new URLSearchParams(location.search).get('chat')) || 0;
    if (chatId) setCrumb('Conversation ' + chatId);

    var past = el('details', 'merecat-about');
    if (!loggedIn) past.hidden = true;
    past.appendChild(el('summary', null, 'Past conversations'));
    var pastBody = el('div', 'merecat-about-body');
    past.appendChild(pastBody);
    /* Action feedback for the list: a failure must never pass in silence — the
       flaky-save postmortem: a response-lost save retried into the rate limit,
       returned a refusal, and the old handler dropped it on the floor. */
    var actNote = el('p', 'comments-status');
    actNote.hidden = true;
    past.appendChild(actNote);
    function actSay(msg: any) {
      actNote.textContent = msg;
      actNote.hidden = !msg;
      if (msg) setTimeout(function () { actNote.hidden = true; }, 7000);
    }
    var pastLoaded = false;
    /* This list and the resume poll share ONE per-IP read budget (READ_LIMIT,
       15/60s), so opening it while the librarian is mid-answer can be
       throttled. A 429 is transient, not a dead end: wait for the window to
       drain and try again a couple of times before conceding, and on any real
       miss reset pastLoaded so a genuine reopen truly retries — it once stayed
       true even on failure, making "Reopen to retry" a lie that only a full
       page reload could undo. */
    function loadList(attempt: any) {
      pastBody.textContent = '';
      pastBody.appendChild(attempt
        ? loadingLine('The desk is busy for a moment — retrying…')
        : skeleton('short'));
      fetchRetry(MERECAT_API + '/chats', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: state.key }),
      }, [1000, 3000]).then(function (r) { return r.json(); }).then(function (d) {
        if (blockedOut(d)) return;
        if (!d.ok || !d.chats) {
          if (readThrottled(d) && attempt < 2) {
            readEase();   /* let the background pollers stand aside while we retry */
            setTimeout(function () { loadList(attempt + 1); }, 6000);
            return;
          }
          pastBody.textContent = '';
          pastBody.appendChild(el('p', null, 'Could not load the list. Reopen to retry.'));
          pastLoaded = false;
          return;
        }
        var chats = d.chats;
        /* When a response is lost the request may still have landed — ask the
           server for the truth instead of guessing either way. */
        function resyncChats() {
          return fetchRetry(MERECAT_API + '/chats', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: state.key }),
          }, [1000]).then(function (r) { return r.json(); }).then(function (d2) {
            if (d2.ok && d2.chats) { chats = d2.chats; renderChats(); }
          }).catch(function () {});
        }
        function chatRow(c: any) {
          /* A community/inbox-style card row: the whole tile opens the thread
             (mc-cardnav + the row click below), save/delete sit in the corner. */
          var row = el('div', 'board-topic mc-cardnav');
          var left = el('div', 'board-topic-left');
          var a = el('a', 'board-topic-title', c.title || ('Conversation ' + c.id));
          a.href = 'merecat-ai.html?chat=' + c.id;
          left.appendChild(a);
          row.appendChild(left);
          row.appendChild(el('div', 'board-stats',
            c.msgs + (c.msgs === 1 ? ' message · ' : ' messages · ') +
            new Date(c.last_at * 1000).toLocaleDateString()));
          var corner = el('div', 'board-admin-corner');
          var sv = el('a', 'trust-toggle', c.saved ? 'unsave' : 'save');
          sv.href = '#';
          sv.title = c.saved ? 'Return this conversation to the thirty-day keeping'
            : 'Keep this conversation permanently';
          sv.addEventListener('click', function (e: any) {
            e.preventDefault();
            /* Optimistic: the row moves at once; the server's answer then
               confirms, reverts with a note, or — on a lost response — a
               resync settles it from the server's truth. */
            var proceed = function () {
              var want = c.saved ? 0 : 1;
              c.saved = want;
              renderChats();
              fetchRetry(MERECAT_API + '/chat/save', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key: state.key, id: c.id, save: want }),
              }, [1000]).then(function (r) { return r.json(); }).then(function (dd) {
                if (!dd.ok) {
                  c.saved = want ? 0 : 1;
                  renderChats();
                  actSay((want ? 'Could not save: ' : 'Could not unsave: ') + (dd.error || 'try again in a moment.'));
                }
              }).catch(function () {
                resyncChats().then(function () {
                  actSay('Connection hiccup — the list was refreshed from the server.');
                });
              });
            };
            var expired = c.saved && c.last_at < Math.floor(Date.now() / 1000) - 30 * 86400;
            if (expired) appConfirm('This conversation is older than thirty days. Unsaving lets it expire, and it may be removed at once. Continue?', { okLabel: 'Unsave' }, function (ok: any) { if (ok) proceed(); });
            else proceed();
          });
          corner.appendChild(sv);
          corner.appendChild(document.createTextNode(' · '));
          var del = el('a', 'trust-toggle danger', 'delete');
          del.href = '#';
          del.addEventListener('click', function (e: any) {
            e.preventDefault();
            appConfirm('Delete this conversation outright? There is no undo.', { okLabel: 'Delete', danger: true }, function (ok: any) {
            if (!ok) return;
            fetchRetry(MERECAT_API + '/chat/delete', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ key: state.key, id: c.id }),
            }, [1000]).then(function (r) { return r.json(); }).then(function (dd) {
              if (dd.ok) {
                chats = chats.filter(function (x: any) { return x !== c; });
                renderChats();
                if (c.id === chatId) go('merecat-ai.html');
              } else {
                actSay('Could not delete: ' + (dd.error || 'try again in a moment.'));
              }
            }).catch(function () {
              resyncChats().then(function () {
                actSay('Connection hiccup — the list was refreshed from the server. Try the delete again if it still stands.');
              });
            });
            });
          });
          corner.appendChild(del);
          row.appendChild(corner);
          /* The whole tile opens the conversation — a nested link (title, save,
             delete) still wins, and a text selection never navigates. */
          row.addEventListener('click', function (e: any) {
            if (e.target.closest('a, button')) return;
            if (window.getSelection && String(window.getSelection()).length) return;
            a.click();
          });
          return row;
        }
        function renderChats() {
          pastBody.textContent = '';
          if (!chats.length) {
            pastBody.appendChild(el('p', 'comments-status', 'No conversations yet. Threads appear here as you ask, and expire thirty days after their last message unless you save them.'));
            return;
          }
          var saved = chats.filter(function (c: any) { return c.saved; });
          var recent = chats.filter(function (c: any) { return !c.saved; });
          function group(label: any, list: any) {
            if (!list.length) return;
            var h = el('p', 'mc-past-head');
            h.appendChild(el('strong', null, label));
            pastBody.appendChild(h);
            var wrap = el('div', 'board-topics');
            list.forEach(function (c: any) { wrap.appendChild(chatRow(c)); });
            pastBody.appendChild(wrap);
          }
          group('Saved conversations (kept permanently)', saved);
          group('Kept thirty days', recent);
        }
        renderChats();
      }).catch(function () {
        pastBody.textContent = 'Could not load the list. Reopen to retry.';
        pastLoaded = false;
      });
    }
    past.addEventListener('toggle', function () {
      if (!past.open || pastLoaded) return;
      pastLoaded = true;
      loadList(0);
    });

    var log = el('div', 'merecat-log');
    section.appendChild(log);

    /* The visitor's door, exactly where the eye lands before asking: the
       board's own identity drawer, one click, no email, no signup forms. */
    if (!loggedIn) {
      var join = el('div', 'merecat-intro');
      var jb = el('div');
      var jp = el('p');
      jp.appendChild(el('strong', null, 'Asking takes one click. '));
      jp.appendChild(document.createTextNode(
        'Create a free identity, no email and no forms, and the question box below opens. '));
      jb.appendChild(jp);
      join.appendChild(jb);
      section.appendChild(join);
      section.appendChild(el('div', 'comment-identity'));
      var mkKeyBox = el('div', 'key-box');
      mkKeyBox.hidden = true;
      section.appendChild(mkKeyBox);
      renderIdentity();
    }

    var form = el('form', 'merecat-form');
    var q = el('textarea', 'merecat-q');
    q.rows = 1;
    /* One row on a phone: the long example placeholder wrapped there (and the
       starter chips below already show examples). */
    var narrow = false;
    try { narrow = window.matchMedia('(max-width: 600px)').matches; } catch (e) { narrow = false; }
    q.placeholder = narrow ? 'Ask the librarian…' : 'Ask the librarian… say, what do the Fathers make of John 6:53?';
    q.setAttribute('aria-label', 'Your question');
    form.appendChild(q);
    /* The field grows with the words, to a few lines, then scrolls — the DM
       composer's road; a cleared box shrinks back (see the submit path). */
    q.mcGrow = function () {
      if (!q.value) { q.style.height = ''; return; }   // its natural one row: scrollHeight would count a wrapped placeholder
      q.style.height = 'auto';
      q.style.height = Math.min(q.scrollHeight + (q.offsetHeight - q.clientHeight), 168) + 'px';
    };
    q.addEventListener('input', q.mcGrow);
    swipeDismissesKeyboard(q, form);
    var send = el('button', 'btn btn-send');
    send.type = 'submit';
    send.title = 'Ask'; send.setAttribute('aria-label', 'Ask');
    send.appendChild(mcIcon('send'));
    send.appendChild(el('span', 'merecat-ask-word', 'Ask'));
    form.appendChild(send);
    section.appendChild(form);
    /* The ask box keeps a draft like every other composer on the site; a
       half-typed question must survive a crashed tab or a stray navigation. */
    attachDraft(q, 'merecat');
    /* The reader-to-librarian bridge: a corpus page's Ask-merecat selection
       chip (deeplink.js) leaves the question here. It wins over any draft —
       it is the most recent deliberate act — and the slot is cleared only
       when consumed, so a visitor who must first create an identity finds
       the question still waiting after the gate lifts. */
    try {
      var pre = JSON.parse(localStorage.getItem('mc-merecat-prefill') as string);
      if (pre && pre.q && Date.now() - (pre.at || 0) < 600000) {
        q.value = String(pre.q);
        q.dispatchEvent(new Event('input', { bubbles: true }));
        if (loggedIn) {
          localStorage.removeItem('mc-merecat-prefill');
          setTimeout(function () { try { q.focus(); } catch (e2) {} }, 50);
        }
      }
    } catch (e) { /* no prefill */ }
    /* Refill the box with the words of a failed ask, one tap. */
    function askAgainLink(prev: any) {
      var again = el('a', 'body-link', 'Ask again');
      again.setAttribute('href', '#');
      again.addEventListener('click', function (ev: any) {
        ev.preventDefault();
        q.value = String(prev || '');
        q.dispatchEvent(new Event('input', { bubbles: true }));
        try { q.focus(); } catch (e2) {}
      });
      return again;
    }
    /* Past conversations sit BELOW the ask box now, and open by default on the
       overview so they never hide behind a click. Auto-loading costs one /chats
       read (shared with the resume poll's budget), so only expand it on the
       overview — inside an open thread it stays a collapsed, click-to-load panel
       that never competes with an active generation. */
    section.appendChild(past);
    if (loggedIn && !chatId) { past.open = true; pastLoaded = true; loadList(0); }
    /* An empty log on a fresh thread gets an app blank slate on phones (CSS-gated,
       desktop never shows it): a few example questions that fill the box on tap.
       It removes itself the moment a question is asked and never shows when
       reopening an existing thread. */
    if (!chatId) {
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
          q.value = ex;
          q.dispatchEvent(new Event('input', { bubbles: true }));
          try { q.focus(); } catch (e2) {}
        });
        chips.appendChild(chip);
      });
      starter.appendChild(chips);
      log.appendChild(starter);
      form.addEventListener('submit', function () { if (starter.parentNode) starter.remove(); }, { once: true });
    }
    var askPlaceholder = q.placeholder;
    if (!loggedIn) {
      q.disabled = true;
      send.disabled = true;
      q.placeholder = 'Create your free identity above, and ask away…';
      /* Creating an identity here must open the box at once, with no manual
         refresh. renderIdentity() repaints .comment-identity on create, so
         watch it (the same self-healing hook armBoardForm and the article
         composer use) and lift the gate the instant a key exists. */
      var mkIdBox = section.querySelector('.comment-identity');
      if (mkIdBox) {
        new MutationObserver(function () {
          if (!(isMember())) return;
          q.disabled = false;
          send.disabled = false;
          q.placeholder = askPlaceholder;
          if (typeof past !== 'undefined' && past) past.hidden = false;
          if (typeof join !== 'undefined' && join && join.parentNode) join.remove();
          q.focus();
        }).observe(mkIdBox, { childList: true });
      }
    }

    /* The quota line: always visible so a member can ration for the
       community's sake, refreshed from /usage on open and from every
       answer's preamble. Admins read their true count against the cap
       they are allowed to pass. */
    var quota = el('p', 'merecat-quota');
    section.appendChild(quota);

    /* Reasoning control: the kernel's ladder (Domain.Merecat via mcCore),
       shown only while the admin has reasoning switched on, offering nothing
       above the admin's ceiling. The reader's own choice, remembered on this
       device; the server clamps every ask against the same rule, so this is a
       courtesy copy, never the gate. */
    var core: any = window.mcCore;
    var modeRow = el('p', 'merecat-quota'); modeRow.hidden = true;
    modeRow.appendChild(document.createTextNode('Reasoning: '));
    var modeSel = el('select', 'scripture-sel');
    modeSel.setAttribute('aria-label', 'Reasoning');
    modeRow.appendChild(modeSel);
    section.appendChild(modeRow);
    modeSel.addEventListener('change', function () {
      try { localStorage.setItem('mc-merecat-mode', modeSel.value); } catch (e) {}
    });
    var modeShown = '';
    /* The AI budget guard (Domain.Merecat through the worker's quota.ts):
       once the account's Workers AI day has reached the admin's line the
       server refuses every ask, so the box closes here too, with the note,
       and reopens on its own when a later reading (the /usage read on open,
       any answer's preamble) says the day has renewed. Only a member's box:
       the identity gate above owns it until then. */
    var guardResting = false;
    function applyGuard(g: any) {
      var resting = !!(g && g.on && g.resting);
      if (resting === guardResting) return;
      guardResting = resting;
      if (!isMember()) return;
      q.disabled = resting;
      send.disabled = resting;
      q.placeholder = resting ? 'merecat is resting until the day renews at midnight UTC.' : askPlaceholder;
    }
    function offerModes(r: any) {
      if (!r || !r.on) { modeRow.hidden = true; return; }
      var ladder = (r.ladder || core.merecatEffortLadder).slice();
      var cap = core.merecatEffortParse('off', r.max);
      var offered = ladder.filter(function (lv: string) { return core.merecatEffortClamp(cap, lv) === lv; });
      var sig = offered.join(',');
      if (sig !== modeShown) {
        modeShown = sig;
        var keep = modeSel.value;
        modeSel.textContent = '';
        offered.forEach(function (lv: string) { var o = el('option', null, core.merecatEffortLabel(lv)); o.value = lv; modeSel.appendChild(o); });
        var want = keep;
        try { want = want || localStorage.getItem('mc-merecat-mode') || ''; } catch (e) {}
        modeSel.value = core.merecatEffortClamp(cap, core.merecatEffortParse(r['default'] || 'off', want));
        if (window.mcSelectSheet) window.mcSelectSheet(modeSel);   // app picker on phones
      }
      modeRow.hidden = false;
    }
    function renderQuota(u: any) {
      if (!u) return;
      if (u.reasoning) offerModes(u.reasoning);
      if (u.quota) applyGuard(u.quota);
      quota.hidden = false;
      quota.textContent = '';
      var g = u.quota;
      if (g && g.on && g.resting) {
        quota.appendChild(el('strong', null, '🐈 ' + (g.note || 'merecat is resting until the day renews at midnight UTC.')));
        quota.appendChild(document.createTextNode(' That is ' + merecatResetLocal() + ' your time.'));
        return;
      }
      if (u.cap_on) {
        quota.appendChild(document.createTextNode('You have used '));
        quota.appendChild(el('strong', null, u.you + ' of ' + u.cap));
        quota.appendChild(document.createTextNode(
          ' questions today' + (u.admin ? ' (admin: the cap does not stop you, your use still counts)' : '') +
          ' · the community ' + u.today + ' of ' + u.gcap +
          ' · counters renew at ' + merecatResetLocal() + ' your time'));
      } else {
        quota.appendChild(document.createTextNode('The community has used '));
        quota.appendChild(el('strong', null, u.today + ' of ' + u.gcap));
        quota.appendChild(document.createTextNode(
          ' shared questions today · you have asked ' + u.you +
          ' · counters renew at ' + merecatResetLocal() + ' your time'));
      }
      if (g && g.on && typeof g.meter_pct === 'number') {
        quota.appendChild(document.createTextNode(
          ' · the day’s AI budget is ' + g.meter_pct + '% spent; merecat rests at ' + g.pct + '%'));
      }
    }
    if (loggedIn) {
      fetchRetry(MERECAT_API + '/usage', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: state.key }),
      }, [1000]).then(function (r) { return r.json(); })
        .then(function (d) { if (d.ok) renderQuota(d); })
        .catch(function () {});
    }

    /* The reader's intent, read from where they stand: at (or near) the
       page bottom means they are riding the conversation and every paint may
       follow; scrolled up means they are READING, and nothing below may move
       their view — the answer still paints, silently, and following resumes
       on its own when they return to the bottom. A short page counts as
       bottom, so opening a thread still lands on its newest message. */
    function nearPageBottom() {
      return (window.innerHeight + window.scrollY) >=
        (document.documentElement.scrollHeight - 160);
    }
    function bubble(who: any) {
      var m = el('div', 'merecat-msg ' + (who === 'you' ? 'you' : 'cat'));
      m.appendChild(el('div', 'merecat-who', who === 'you'
        ? (state.myNick || displayName(state.myHash))
        : '🐈 merecat'));
      var body = el('div', 'merecat-body');
      m.appendChild(body);
      var follow = nearPageBottom();
      log.appendChild(m);
      if (follow) m.scrollIntoView({ block: 'nearest' });
      return { msg: m, body: body };
    }

    /* Only the sources the answer actually cited make the footer, and the
       body's [n] markers renumber with it to a clean 1..k in order of first
       appearance — the model reads its full list, the reader gets a tidy
       one. The same helper runs at stream-finish and at thread-reopen, so a
       saved conversation reads back exactly as it streamed. */
    function citeRenumber(text: any, sources: any) {
      text = String(text || '');
      if (!sources || !sources.length) return { text: text, sources: [] };
      var firstAt: Record<string, any> = {};
      text.replace(/\[(\d+)\]/g, function (m: any, n: any, at: any) {
        var num = Number(n);
        var known = sources.some(function (s: any) { return s.n === num; });
        if (known && firstAt[num] === undefined) firstAt[num] = at;
        return m;
      });
      var order = Object.keys(firstAt).map(Number).sort(function (a, b) { return firstAt[a] - firstAt[b]; });
      if (!order.length) return { text: text, sources: [] };
      var renum: Record<string, any> = {};
      order.forEach(function (n, i) { renum[n] = i + 1; });
      var out = text.replace(/\[(\d+)\]/g, function (m: any, n: any) {
        return renum[Number(n)] ? '[' + renum[Number(n)] + ']' : m;
      });
      var used = sources.filter(function (s: any) { return renum[s.n]; })
        .map(function (s: any) { return { n: renum[s.n], title: s.title, heading: s.heading, url: s.url }; })
        .sort(function (a: any, b: any) { return a.n - b.n; });
      return { text: out, sources: used };
    }

    /* Forward one answer to a public topic: the owner's choice alone. The
       post goes up under the librarian's name, marked forwarded-by, so bot
       words never wear a member's face. */
    function attachForward(bubbleMsg: any, msgSel: any) {
      if (!state.key) return;
      var whoDiv = bubbleMsg.querySelector('.merecat-who');
      if (!whoDiv) return;
      /* One-tap copy of the answer text (the rendered words, without the
         sources footer) — quoting the librarian should never mean hand
         selecting inside a styled bubble on a phone. */
      whoDiv.appendChild(document.createTextNode(' · '));
      var cp = el('a', 'identity-action', 'copy');
      cp.href = '#';
      cp.addEventListener('click', function (e: any) {
        e.preventDefault();
        var bodyEl = bubbleMsg.querySelector('.merecat-body');
        var text = bodyEl ? bodyEl.textContent : '';
        try {
          if (navigator.clipboard && text) {
            navigator.clipboard.writeText(text).then(function () {
              cp.textContent = 'copied';
              setTimeout(function () { cp.textContent = 'copy'; }, 1500);
            });
          }
        } catch (e2) { /* no clipboard */ }
      });
      whoDiv.appendChild(cp);
      whoDiv.appendChild(document.createTextNode(' · '));
      var f = el('a', 'identity-action', 'forward to the board');
      f.href = '#';
      var open: any = null;
      f.addEventListener('click', function (e: any) {
        e.preventDefault();
        if (!chatId) return;
        if (open && open.isConnected) { open.remove(); open = null; return; }
        open = forwardPicker(whoDiv, f, msgSel);
        /* right under the name row, above the answer text */
        whoDiv.parentNode.insertBefore(open, whoDiv.nextSibling);
      });
      whoDiv.appendChild(f);
    }

    /* The destination drill-down: category first (only rooms this member may
       post into \u2014 the back room is offered to admins alone, and the server
       enforces regardless), then the topic, then one confirm. The topic step
       narrows SERVER-side as you type (title words against the live listing,
       debounced), so a two-topic room and a two-thousand-topic room both
       cost one twenty-row page \u2014 the client never pulls the whole list. */
    function forwardPicker(whoDiv: any, f: any, msgSel: any) {
      var panel = el('div', 'mc-fwd');
      var pickedCat: any = null;      /* CATS row once a category is chosen */
      var pickedTopic: any = null;    /* {id, title} once a topic is chosen */
      var seq = 0;               /* newest request owns the list */
      var lastQ = '', lastP = 1;
      var debounce: any = null;
      var deskTop = window.matchMedia && window.matchMedia('(hover: hover)').matches;

      var head = el('div', 'mc-fwd-head');
      head.appendChild(el('strong', null, 'Forward to the board'));
      var close = el('a', 'identity-action', 'cancel');
      close.href = '#';
      close.addEventListener('click', function (e: any) { e.preventDefault(); panel.remove(); });
      head.appendChild(close);
      panel.appendChild(head);

      var crumbLine = el('div', 'mc-fwd-crumb');
      panel.appendChild(crumbLine);
      var input = el('input');
      input.type = 'search';
      panel.appendChild(input);
      var listBox = el('div', 'mc-fwd-list');
      panel.appendChild(listBox);
      var confirmBox = el('div', 'mc-fwd-confirm');
      confirmBox.hidden = true;
      panel.appendChild(confirmBox);
      var note = el('div', 'mc-fwd-note');
      panel.appendChild(note);

      function allowedCats() {
        return CATS.filter(function (c: any) { return c[0] !== 'adminsonly' || isAdmin(); });
      }
      function stepCats() {
        pickedCat = null; pickedTopic = null;
        crumbLine.textContent = 'Pick a category:';
        input.value = '';
        input.placeholder = 'type to narrow the categories\u2026';
        input.hidden = false;
        listBox.hidden = false;
        confirmBox.hidden = true;
        note.textContent = '';
        renderCats('');
        if (deskTop) input.focus();
      }
      function renderCats(q: any) {
        var ql = q.replace(/\s+/g, ' ').trim().toLowerCase();
        listBox.textContent = '';
        var shown = allowedCats().filter(function (c: any) {
          return !ql || c[1].toLowerCase().indexOf(ql) !== -1 || c[0].indexOf(ql) !== -1;
        });
        if (!shown.length) {
          listBox.appendChild(el('div', 'mc-fwd-empty', 'No category matches.'));
          return;
        }
        shown.forEach(function (c: any) {
          var b = el('button', 'mc-fwd-row');
          b.type = 'button';
          b.appendChild(el('strong', null, c[1]));
          if (c[0] === 'adminsonly') b.appendChild(el('span', 'mc-fwd-meta', ' \u00b7 the back room'));
          b.addEventListener('click', function () { pickedCat = c; stepTopics(); });
          listBox.appendChild(b);
        });
      }

      function stepTopics() {
        pickedTopic = null;
        crumbLine.textContent = '';
        var back = el('a', 'identity-action', '\u2039 categories');
        back.href = '#';
        back.addEventListener('click', function (e: any) { e.preventDefault(); stepCats(); });
        crumbLine.appendChild(back);
        crumbLine.appendChild(document.createTextNode(' \u00b7 ' + pickedCat[1] + ' \u2014 pick the topic:'));
        input.value = '';
        input.placeholder = 'scroll, or type to narrow the topics\u2026';
        input.hidden = false;
        listBox.hidden = false;
        confirmBox.hidden = true;
        note.textContent = '';
        lastQ = ''; lastP = 1;
        loadTopics('', 1, false);
        if (deskTop) input.focus();
      }
      function fetchTopics(q: any, p: any) {
        return (pickedCat[0] === 'adminsonly'
          ? fetchRetry(API + '/board/admin', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ key: state.key || '', p: p, q: q }),
            }, [1000])
          : fetchRetry(API + '/board/cat?cat=' + pickedCat[0] + '&p=' + p +
              (q ? '&q=' + encodeURIComponent(q) : '') + freshParam('&'), freshOpts(), [1000]))
          .then(function (r) { return r.json(); });
      }
      function loadTopics(q: any, p: any, append: any) {
        var mySeq = ++seq;
        if (!append) {
          listBox.textContent = '';
          listBox.appendChild(skeleton('short'));
        }
        fetchTopics(q, p).then(function (d) {
          if (mySeq !== seq) return;
          if (!d.ok) throw new Error(d.error || 'failed');
          if (append) {
            var oldMore = listBox.querySelector('.mc-fwd-more');
            if (oldMore) oldMore.remove();
          } else {
            listBox.textContent = '';
          }
          lastQ = q; lastP = p;
          if (!d.topics.length && p === 1) {
            listBox.appendChild(el('div', 'mc-fwd-empty',
              q ? 'No topic matches.' : 'No topics here yet.'));
            return;
          }
          d.topics.forEach(function (t: any) {
            var b = el('button', 'mc-fwd-row' + (t.locked ? ' mc-fwd-locked' : ''));
            b.type = 'button';
            b.appendChild(el('strong', null, t.title));
            b.appendChild(el('span', 'mc-fwd-meta', ' \u00b7 ' +
              t.replies + (t.replies === 1 ? ' reply' : ' replies') +
              (t.sticky ? ' \u00b7 sticky' : '') + (t.locked ? ' \u00b7 locked' : '')));
            if (t.locked) b.disabled = true;
            else {
              b.addEventListener('click', function () {
                pickedTopic = { id: t.id, title: t.title };
                stepConfirm();
              });
            }
            listBox.appendChild(b);
          });
          var left = d.total - d.page * d.per;
          if (left > 0) {
            var more = el('button', 'mc-fwd-row mc-fwd-more',
              'show more (' + left + ' more)');
            more.type = 'button';
            more.addEventListener('click', function () {
              more.disabled = true;
              more.textContent = 'loading\u2026';
              loadTopics(lastQ, lastP + 1, true);
            });
            listBox.appendChild(more);
          }
        }).catch(function () {
          if (mySeq !== seq) return;
          if (!append) listBox.textContent = '';
          var oldMore = listBox.querySelector('.mc-fwd-more');
          if (oldMore) oldMore.remove();
          listBox.appendChild(el('div', 'mc-fwd-empty', 'Could not load the topics. Type to retry.'));
        });
      }
      /* nearing the bottom pulls the next page by itself; the button stays
         as the visible affordance and the double-fire guard */
      listBox.addEventListener('scroll', function () {
        if (listBox.scrollTop + listBox.clientHeight < listBox.scrollHeight - 60) return;
        var more = listBox.querySelector('.mc-fwd-more');
        if (more && !more.disabled) more.click();
      });

      input.addEventListener('input', function () {
        if (!pickedCat) { renderCats(input.value); return; }
        if (debounce) clearTimeout(debounce);
        debounce = setTimeout(function () {
          var q = input.value.replace(/\s+/g, ' ').trim();
          if (q === lastQ) return;
          loadTopics(q, 1, false);
        }, 300);
      });

      function stepConfirm() {
        input.hidden = true;
        listBox.hidden = true;
        note.textContent = '';
        confirmBox.textContent = '';
        confirmBox.hidden = false;
        confirmBox.appendChild(el('p', 'mc-fwd-sure',
          (pickedCat[0] === 'adminsonly'
            ? 'Post this answer into the admins-only back room, to \u201c' + pickedTopic.title + '\u201d'
            : 'Post this answer publicly to \u201c' + pickedTopic.title + '\u201d in ' + pickedCat[1]) +
          ', under the librarian\u2019s name, marked as forwarded by you?'));
        var go = el('button', 'mc-fwd-go', 'Forward it');
        go.type = 'button';
        go.addEventListener('click', function () {
          go.disabled = true;
          note.textContent = 'forwarding\u2026';
          fetchRetry(MERECAT_API + '/forward', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: state.key, chat: chatId, msg: msgSel, topic: pickedTopic.id }),
          }, [1000]).then(function (r) { return r.json(); }).then(function (d) {
            if (d.ok) {
              var v = el('a', 'identity-action', 'forwarded \u2713 view it');
              v.href = 'community.html?topic=' + d.topic + '#comment-' + d.id;
              whoDiv.replaceChild(v, f);
              panel.remove();
            } else {
              go.disabled = false;
              note.textContent = d.error || 'Forward failed.';
            }
          }).catch(function () {
            go.disabled = false;
            note.textContent = 'Network hiccup. Try again.';
          });
        });
        var back = el('a', 'identity-action', 'back to the topics');
        back.href = '#';
        back.addEventListener('click', function (e: any) {
          e.preventDefault();
          pickedTopic = null;
          confirmBox.hidden = true;
          input.hidden = false;
          listBox.hidden = false;
          note.textContent = '';
        });
        var row = el('div', 'mc-fwd-actions');
        row.appendChild(go);
        row.appendChild(back);
        confirmBox.appendChild(row);
      }

      stepCats();
      return panel;
    }

    function mcScrubLabel(t: any) {
      return String(t || '').replace(/<\/?[a-zA-Z][^>]{0,300}?>/g, ' ')
        .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ').trim();
    }
    function srcFooter(node: any, sources: any) {
      if (!sources || !sources.length) return;
      var f = el('div', 'merecat-srcs');
      f.appendChild(el('strong', null, 'Sources: '));
      sources.forEach(function (s: any) {
        var t = '[' + s.n + '] ' + mcScrubLabel(s.title) + (s.heading ? ' — ' + mcScrubLabel(s.heading) : '');
        if (s.url) {
          var a = el('a', 'body-link', t);
          a.href = s.url;
          scriptureDecor(a, s.url);
          f.appendChild(a);
        } else {
          /* the private shelf: a title is the whole citation */
          f.appendChild(el('span', 'merecat-src-plain', t));
        }
      });
      node.appendChild(f);
    }

    /* A client-side queue so the reader can stack questions on this one-on-one
       page. Submitting while the librarian answers does not interrupt it — the
       question waits (shown below the composer) and is sent only once the
       current answer is fully rendered, so a stack can be left to work through
       and returned to later. */
    var pendingBox = el('p', 'merecat-quota');
    pendingBox.hidden = true;
    section.appendChild(pendingBox);
    var askQueue: any[] = [];
    var busy = false;
    /* The active merecat chat socket (the WebSocket path). Closed when the
       reader leaves the page so a soft-navigation never leaves it listening on
       behalf of a detached view — the ChatRoom Durable Object keeps generating
       regardless and replays its state on reopen, so nothing is lost. */
    var liveChat: any = null;
    if (typeof bootSig !== 'undefined' && bootSig) {
      bootSig.addEventListener('abort', function () {
        if (liveChat) { try { liveChat.close(); } catch (e) {} liveChat = null; }
      });
    }
    /* A question still waiting in the stack lives only in this page — a sent
       question survives a refresh (the librarian stores its answer on the
       thread), an unsent one does not. So warn on leaving only while unsent
       questions remain, and only then (the listener also disables bfcache). */
    var unloadGuard: any = null;
    function syncUnloadGuard() {
      if (askQueue.length && !unloadGuard) {
        unloadGuard = function (e: any) { e.preventDefault(); e.returnValue = ''; };
        window.addEventListener('beforeunload', unloadGuard, { signal: bootSig });
      } else if (!askQueue.length && unloadGuard) {
        window.removeEventListener('beforeunload', unloadGuard);
        unloadGuard = null;
      }
    }
    function renderPending() {
      syncUnloadGuard();
      pendingBox.textContent = '';
      if (!askQueue.length) { pendingBox.hidden = true; return; }
      pendingBox.hidden = false;
      pendingBox.appendChild(el('strong', null,
        askQueue.length + (askQueue.length === 1 ? ' question' : ' questions') + ' queued (waiting to be asked): '));
      askQueue.forEach(function (it, i) {
        if (i) pendingBox.appendChild(document.createTextNode(' · '));
        pendingBox.appendChild(document.createTextNode(
          it.text.slice(0, 40) + (it.text.length > 40 ? '…' : '') + ' '));
        var x = el('a', 'body-link', '✕');
        x.href = '#'; x.title = 'Cancel this question';
        x.addEventListener('click', function (e: any) {
          e.preventDefault();
          var idx = askQueue.indexOf(it);
          if (idx !== -1) { askQueue.splice(idx, 1); renderPending(); }
        });
        pendingBox.appendChild(x);
      });
    }
    function enqueue(text: any) {
      askQueue.push({ text: text });
      renderPending();
      drain();
    }
    function drain() {
      if (stale()) return;
      if (busy || !askQueue.length) return;
      busy = true;
      var item = askQueue.shift();
      renderPending();
      askWs(item.text);
    }
    /* A live "working" indicator: a bobbing merecat, a spinner, and a seconds
       counter that ticks up while the librarian thinks (deep reasoning can run a
       minute or more), so the wait feels alive rather than stalled. */
    function startWorking(body: any, startMs?: any, onStop?: any) {
      body.textContent = '';
      var wrap = el('div', 'merecat-working');
      wrap.appendChild(el('span', 'mc-cat-work', '🐈'));
      wrap.appendChild(el('span', 'mc-spin'));
      var status = el('span', 'mc-status', 'merecat is working…');
      /* startMs lets a RESUMED wait count from the question's own birth, so
         a reader who refreshed or walked away sees the honest elapsed time */
      var start = startMs || Date.now();
      var secs = el('span', 'mc-secs', Math.max(0, Math.round((Date.now() - start) / 1000)) + 's');
      wrap.appendChild(status); wrap.appendChild(secs);
      /* Stop, the standard streaming-AI control: ends the generation at the
         server (the DO cancels its model read and keeps what streamed), which
         also spares the budget and frees the single local GPU for others. */
      if (onStop) {
        wrap.appendChild(document.createTextNode(' · '));
        var st = el('a', 'body-link', 'stop');
        st.setAttribute('href', '#');
        st.addEventListener('click', function (ev: any) {
          ev.preventDefault();
          st.textContent = 'stopping…';
          try { onStop(); } catch (e) { /* socket gone: the watchdogs recover */ }
        });
        wrap.appendChild(st);
      }
      body.appendChild(wrap);
      var timer: any = setInterval(function () {
        secs.textContent = Math.round((Date.now() - start) / 1000) + 's';
      }, 250);
      return {
        setStatus: function (t: any) { status.textContent = t; },
        stop: function () { if (timer) { clearInterval(timer); timer = null; } },
      };
    }

    /* The sticky follow-along grip, shared by a live ask and a resumed one:
       stick to the PAGE bottom while an answer prints if the reader was
       there when it began or comes back mid-print; any deliberate upward
       scroll releases it until they return. Never scrollIntoView on the
       bubble (the composer and footer sit below it — aligning the bubble's
       end yanked the view off the floor and instantly disarmed the old
       per-tick sample). The flag is sticky: page growth fires no scroll
       events, so only the reader's own movement changes it — reaching the
       bottom arms it, wheel-up or a downward finger-drag disarms at once,
       a position drop past the near-bottom band disarms too (keys and
       scrollbar), and the iOS rubber-band settle stays armed since it
       never leaves that band. */
    function stickyFollow() {
      var follow = nearPageBottom();
      var followY = window.scrollY;
      var touchY = 0;
      function onScroll() {
        var y = window.scrollY;
        if (y > followY + 2 && nearPageBottom()) follow = true;
        else if (y < followY - 2 && !nearPageBottom()) follow = false;
        followY = y;
      }
      function onWheel(e: any) { if (e.deltaY < 0) follow = false; }
      function onTouchStart(e: any) {
        if (e.touches && e.touches.length) touchY = e.touches[0].clientY;
      }
      function onTouchMove(e: any) {
        if (!(e.touches && e.touches.length)) return;
        var y = e.touches[0].clientY;
        if (y > touchY + 8) follow = false;   /* finger down = view up */
        touchY = y;
      }
      window.addEventListener('scroll', onScroll, { passive: true, signal: bootSig });
      window.addEventListener('wheel', onWheel, { passive: true, signal: bootSig });
      window.addEventListener('touchstart', onTouchStart, { passive: true, signal: bootSig });
      window.addEventListener('touchmove', onTouchMove, { passive: true, signal: bootSig });
      return {
        bottom: function () { if (follow) window.scrollTo(0, document.documentElement.scrollHeight); },
        stop: function () {
          window.removeEventListener('scroll', onScroll);
          window.removeEventListener('wheel', onWheel);
          window.removeEventListener('touchstart', onTouchStart);
          window.removeEventListener('touchmove', onTouchMove);
        },
      };
    }

    /* THE RESUME. A reopened thread whose last question has no finished
       answer joins the LIVING generation instead of showing a dead page:
       the same working chrome counting from the question's own birth, the
       stored partial flushes painting through the same paced reveal, the
       finished row landing exactly as a live stream's finish would. Both
       backends flush the growing answer to the thread every few seconds,
       so watching the thread IS watching the librarian — a refresh, an
       accidental navigation, a walk to another page and back change
       nothing the reader can see. Bound to its own question row id (the
       scan stops at any newer question), so a fresh ask typed meanwhile
       runs beside it without confusion; the poll rides READ_LIMIT
       politely (5s young, 10s past two minutes, 8s while a live ask also
       polls) with an instant pass when a background tab returns. */
    /* THE WEBSOCKET RESUME (primary). Reopening a thread whose last question
       has no finished answer joins the LIVING generation over the chat socket:
       the DO's hello frame replays the phase and the answer-so-far, the paced
       reveal paints from there, and a dropped socket simply reconnects (hello
       replays again) — no polling. If the DO is idle (the generation finished
       between the reopen read and the socket, or it truly died), ONE /chat read
       settles which: paint the finished answer, or show the partial with a
       note. On a browser with no WebSocket it shows a note to reopen later. */
    function resumeWs(userRow: any, partialRow: any) {
      if (!window.WebSocket || !window.mcLive || !window.mcLive.chat) {
        var cno = bubble('cat');
        cno.body.appendChild(el('span', 'merecat-note',
          'The librarian is still finishing this answer, but this browser blocked the live connection. Reopen the conversation shortly to read it.'));
        return;
      }
      var cat = bubble('cat');
      var sticky = stickyFollow();
      var startMs = (Number(userRow.created_at) * 1000) || Date.now();
      var acc = (partialRow && partialRow.body) ? String(partialRow.body) : '';
      var shown = 0, flowTimer: any = null, painted = false, settled = false, streamDone = false;
      var sources: any = null, handle: any = null, idleChecked = false;
      var working = startWorking(cat.body, startMs, function () { if (handle) handle.send({ t: 'stop' }); });
      working.setStatus('rejoining the librarian…');
      function endTurn() {
        if (settled) return; settled = true;
        working.stop();
        if (flowTimer) { clearInterval(flowTimer); flowTimer = null; }
        sticky.stop();
        if (handle) { try { handle.close(); } catch (e) {} if (liveChat === handle) liveChat = null; handle = null; }
      }
      function paint(finalBody?: any, finalSources?: any, fwdId?: any) {
        if (painted) return; painted = true;
        var body = (finalBody != null ? finalBody : acc).replace(/\s+$/, '');
        var srcs = finalSources != null ? finalSources : (sources || []);
        cat.body.textContent = '';
        if (!body) {
          cat.body.appendChild(el('span', 'merecat-note', '— this answer never finished. Ask again when you like.'));
        } else {
          var rr = citeRenumber(body, srcs);
          fillBody(cat.body, rr.text, true);
          srcFooter(cat.body, rr.sources);
          if (fwdId) attachForward(cat.msg, fwdId);
        }
        sticky.bottom();
        endTurn();
      }
      function tick() {
        if (painted) { if (flowTimer) { clearInterval(flowTimer); flowTimer = null; } return; }
        var backlog = acc.length - shown;
        if (backlog > 0) {
          shown = Math.min(acc.length, shown + Math.max(2, Math.ceil(backlog / 15)));
          cat.body.textContent = acc.slice(0, shown);
          sticky.bottom();
        } else if (streamDone) { clearInterval(flowTimer); flowTimer = null; paint(null, null, 'last'); }
      }
      function ensureFlow() { if (!flowTimer) flowTimer = setInterval(tick, 40); }
      function idleCheck() {
        if (idleChecked || painted) return;
        idleChecked = true;
        readMark();
        fetchRetry(MERECAT_API + '/chat', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: state.key, id: chatId }),
        }, [1000]).then(function (r) { return r.json(); }).then(function (d) {
          if (painted) return;
          var rows = (d && d.msgs) || [], fin = null;
          for (var i = 0; i < rows.length; i++) {
            var m = rows[i];
            if (m.id <= userRow.id) continue;
            if (m.role === 'user') break;
            if (m.role === 'assistant' && m.done !== 0) { fin = m; break; }
          }
          if (fin) {
            var s = []; try { s = JSON.parse(fin.sources || '[]'); } catch (e) {}
            paint(fin.body, s, fin.id);
          } else { paint(); }
        }).catch(function () { if (!painted) paint(); });
      }
      function onFrame(m: any) {
        if (settled || painted || !m) return;
        if (m.t === 'hello') {
          if (m.sources && m.sources.length) sources = m.sources;
          if (m.answer && m.answer.length > acc.length) { acc = m.answer; working.stop(); ensureFlow(); }
          if (m.phase === 'done') { streamDone = true; ensureFlow(); }
          else if (m.phase === 'idle') { idleCheck(); }
          else { working.setStatus('the librarian is still writing…'); if (acc) ensureFlow(); }
        } else if (m.t === 'state') {
          if (m.phase === 'thinking') working.setStatus('the librarian is reasoning…');
          else if (m.phase === 'done') { streamDone = true; ensureFlow(); }
          else if (m.phase === 'error') { paint(); }
        } else if (m.t === 'meta') {
          sources = m.sources || [];
        } else if (m.t === 'tokens') {
          acc += (m.d || '');
          if (acc.indexOf('\u0002') !== -1) acc = acc.replace(/\u0002/g, '');
          var mk = acc.indexOf('\u0003');
          if (mk !== -1) acc = acc.slice(0, mk);
          if (acc) { working.stop(); ensureFlow(); }
        }
      }
      if (acc) { working.stop(); ensureFlow(); }
      handle = window.mcLive.chat(chatId, state.key, onFrame);
      liveChat = handle;
      return true;
    }
    /* THE WEBSOCKET ASK (primary). merecat's generation is a state machine in
       a per-conversation Durable Object (ChatRoom): ask-init mints/verifies the
       thread and adopts its id into the URL BEFORE we connect (so a refresh
       anywhere lands back here), then the chat socket carries the question up
       and hello/state/meta/tokens frames down. The DO owns the generation and
       is the sole D1 writer, so a dropped socket loses nothing — mcLive
       reconnects and the DO's `hello` replays the phase and the answer-so-far,
       which IS the resume (no polling, no reconcile/recover). The paced reveal,
       sticky follow, citations, and forward are shared with the reopen path.
       A browser with no WebSocket, or a live channel that never answers, gets a
       plain note — the librarian is a WebSocket service now, no HTTP fallback. */
    function askWs(text: any) {
      var youB = bubble('you');
      fillBody(youB.body, text);
      if (!chatId) setCrumb(text);
      var cat = bubble('cat');
      var handle: any = null, openTimer: any = null;
      var working = startWorking(cat.body, 0, function () { if (handle) handle.send({ t: 'stop' }); });
      var sticky = stickyFollow();
      var acc = '', shown = 0, flowTimer: any = null, sources: any = null;
      var streamDone = false, painted = false, settled = false, asked = false, fellBack = false;
      var mode = modeRow.hidden ? 'off' : (modeSel.value || 'off');

      function endTurn() {
        if (settled) return; settled = true;
        working.stop();
        if (flowTimer) { clearInterval(flowTimer); flowTimer = null; }
        sticky.stop();
        if (openTimer) { clearTimeout(openTimer); openTimer = null; }
        if (handle) { try { handle.close(); } catch (e) {} if (liveChat === handle) liveChat = null; handle = null; }
        busy = false;
        if (askQueue.length) { setTimeout(drain, 900); }
        else { try { q.focus({ preventScroll: true }); } catch (e) { q.focus(); } }
      }
      function tick() {
        if (painted) { if (flowTimer) { clearInterval(flowTimer); flowTimer = null; } return; }
        var backlog = acc.length - shown;
        if (backlog > 0) {
          shown = Math.min(acc.length, shown + Math.max(2, Math.ceil(backlog / 15)));
          cat.body.textContent = acc.slice(0, shown);
          sticky.bottom();
        } else if (streamDone) {
          clearInterval(flowTimer); flowTimer = null; paint();
        }
      }
      function ensureFlow() { if (!flowTimer) flowTimer = setInterval(tick, 40); }
      function paint() {
        if (painted) return;
        painted = true;
        acc = acc.replace(/\s+$/, '');
        if (!acc) {
          cat.body.textContent = '';
          cat.body.appendChild(el('span', 'merecat-note', 'merecat had nothing to say. Try rephrasing. '));
          cat.body.appendChild(askAgainLink(text));
        } else {
          var rr = citeRenumber(acc, sources || []);
          cat.body.textContent = '';
          fillBody(cat.body, rr.text, true);
          srcFooter(cat.body, rr.sources);
          attachForward(cat.msg, 'last');
        }
        sticky.bottom();
        endTurn();
      }
      function refuse(d: any) {
        working.stop();
        if (blockedOut(d)) { endTurn(); return; }
        if (d.quota) applyGuard({ on: true, resting: true });
        cat.body.textContent = '';
        cat.body.appendChild(el('span', 'merecat-note',
          (d.resting ? '🐈 ' : '') + (d.error || 'merecat could not answer. Try again shortly.') +
          (d.resting || d.capped ? ' That is ' + merecatResetLocal() + ' your time.' : '')));
        /* A capped refusal cannot be retried today; anything else earns a
           one-tap way to put the same words back in the box. */
        if (!d.capped && !d.resting) {
          cat.body.appendChild(document.createTextNode(' '));
          cat.body.appendChild(askAgainLink(text));
        }
        endTurn();
      }
      /* WebSocket unavailable or unreachable: hand the SAME question to the
         proven HTTP path. Remove the two bubbles we drew so ask() can add its
         own without a duplicate pair; chatId (already minted by ask-init) is
         preserved, so the HTTP /ask simply continues the same thread. */
      function giveUpLive(msg: any) {
        if (fellBack || painted || settled) return;
        fellBack = true;
        if (openTimer) { clearTimeout(openTimer); openTimer = null; }
        if (handle) { try { handle.close(); } catch (e) {} if (liveChat === handle) liveChat = null; handle = null; }
        working.stop();
        cat.body.textContent = '';
        cat.body.appendChild(el('span', 'merecat-note', msg));
        endTurn();
      }
      function onFrame(m: any) {
        if (settled || fellBack || !m) return;
        if (openTimer) { clearTimeout(openTimer); openTimer = null; }   /* any frame proves the channel */
        if (m.t === 'hello') {
          if (m.phase === 'idle') {
            if (!asked) {
              asked = true;
              var a: any = { t: 'ask', q: text };
              a.effort = mode;   // a request; the ChatRoom clamps it against the admin's dials
              handle.send(a);
            }
          } else {
            /* reconnect / resume: the DO already holds our ask — adopt its state */
            asked = true;
            if (m.used) renderQuota(m.used);
            if (m.sources && m.sources.length) sources = m.sources;
            if (m.answer && m.answer.length > acc.length) { acc = m.answer; working.stop(); ensureFlow(); }
            if (m.phase === 'done') { streamDone = true; ensureFlow(); }
          }
        } else if (m.t === 'state') {
          if (m.phase === 'queued') {
            var wait = (m.place > 0)
              ? (m.place + (m.place === 1 ? ' question' : ' questions') + ' ahead of you in line, please wait')
              : 'no one else is in line, answering you now';
            working.setStatus(wait);
          } else if (m.phase === 'thinking') {
            if (m.used) renderQuota(m.used);
            working.setStatus('sources gathered, the librarian is reasoning…');
          } else if (m.phase === 'done') {
            streamDone = true; ensureFlow();
          } else if (m.phase === 'error') {
            refuse(m);
          }
        } else if (m.t === 'meta') {
          sources = m.sources || [];
          if (m.used) renderQuota(m.used);
          working.setStatus('sources gathered, the librarian is reasoning…');
        } else if (m.t === 'tokens') {
          acc += (m.d || '');
          if (acc.indexOf('\u0002') !== -1) acc = acc.replace(/\u0002/g, '');   /* defensive: DO strips STX */
          var mk = acc.indexOf('\u0003');
          if (mk !== -1) acc = acc.slice(0, mk);
          if (acc) { working.stop(); ensureFlow(); }
        }
      }

      if (!window.WebSocket || !window.mcLive || !window.mcLive.chat) {
        working.stop();
        cat.body.textContent = '';
        cat.body.appendChild(el('span', 'merecat-note',
          'This browser blocked the live connection to the librarian (WebSocket). Try a different browser or network.'));
        endTurn();
        return;
      }
      fetchRetry(MERECAT_API + '/ask-init', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: state.key, chat: chatId || 0, q: text }),
      }, [1000]).then(function (r) { return r.json(); }).then(function (d) {
        if (settled || fellBack) return;
        if (!d.ok) { refuse(d); return; }
        if (d.chatId && d.chatId !== chatId) {
          chatId = d.chatId;
          if (history.replaceState) history.replaceState(null, '', location.pathname + '?merecat=1&chat=' + chatId);
          setCrumb(text);
        }
        if (d.used) renderQuota(d.used);
        handle = window.mcLive!.chat(chatId, state.key, onFrame);
        liveChat = handle;
        /* a live channel that never speaks within the window is blocked or
           dead — the ask was never sent, so say so plainly */
        openTimer = setTimeout(function () {
          if (!asked && !painted && !settled) giveUpLive('Could not reach the live librarian. Please try again in a moment.');
        }, 12000);
      }).catch(function () {
        if (settled || fellBack || painted) return;
        giveUpLive('Network hiccup. Ask again.');
      });
    }
    form.addEventListener('submit', function (e: any) {
      e.preventDefault();
      var text = q.value.trim();
      if (!text) return;
      q.value = '';
      if (q.mcGrow) q.mcGrow();   // a cleared box shrinks back to one row
      if ((q as any).mcDraftDone) (q as any).mcDraftDone();
      enqueue(text);
    });
    q.addEventListener('keydown', function (e: any) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        form.dispatchEvent(new Event('submit', { cancelable: true }));
      }
    });

    /* Reopening a saved thread: replay its turns into the log, then the
       composer continues it. A vanished or foreign id falls back to fresh. */
    if (chatId && loggedIn) {
      var loadNote = el('p', 'comments-status', 'Reopening the conversation…');
      log.appendChild(loadNote);
      var reopenTries = 0;
      var reopenGo = function () {
      fetchRetry(MERECAT_API + '/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: state.key, id: chatId }),
      }, [1000, 3000]).then(function (r) { return r.json(); }).then(function (d) {
        if (blockedOut(d)) return;
        if (!d.ok) {
          /* Only the server's own word makes a thread GONE — a rate-limit
             429 or any passing refusal must never masquerade as deletion
             and strip the thread from the URL (the v140 live test caught
             exactly that: a burst of page-hops hit READ_LIMIT and a living
             conversation was declared gone). Transient troubles retry,
             the address intact. */
          if (/no such conversation/i.test(String(d.error || ''))) {
            loadNote.remove();
            chatId = 0;
            setCrumb('');
            if (history.replaceState) history.replaceState(null, '', location.pathname + '?merecat=1');
            log.appendChild(el('p', 'comments-status', 'That conversation is gone (expired or deleted). This is a fresh one.'));
            return;
          }
          if (readThrottled(d)) readEase();   /* a page-hop burst tripped the budget: ease the body, retry intact */
          throw new Error(d.error || 'transient');
        }
        loadNote.remove();
        setCrumb((d.chat && d.chat.title) || ('Conversation ' + chatId));
        var rows = d.msgs || [];
        /* The tail decides whether this thread is at rest or ALIVE: find the
           last question, then whether anything after it finished (done=1) or
           is still growing (done=0, the backends' partial flushes). A
           growing row is never replayed as a finished bubble — it seeds the
           resume, which paints it through the paced reveal instead. */
        var lastUser = null;
        for (var ri = rows.length - 1; ri >= 0; ri--) {
          if (rows[ri].role === 'user') { lastUser = rows[ri]; break; }
        }
        var tailDone = false, tailPartial = null;
        if (lastUser) {
          for (var rj = 0; rj < rows.length; rj++) {
            var rr0 = rows[rj];
            if (rr0.id <= lastUser.id || rr0.role !== 'assistant') continue;
            if (rr0.done === 0) tailPartial = rr0;
            else { tailDone = true; break; }
          }
        }
        rows.forEach(function (m: any) {
          if (m.role !== 'user' && m.done === 0) return;   /* the resume's to paint */
          var b = bubble(m.role === 'user' ? 'you' : 'cat');
          if (m.role === 'user') {
            fillBody(b.body, m.body);
          } else {
            var srcs = [];
            try { srcs = JSON.parse(m.sources || '[]'); } catch (e) {}
            var rr = citeRenumber(m.body, srcs);
            fillBody(b.body, rr.text, true);
            srcFooter(b.body, rr.sources);
            if (m.id) attachForward(b.msg, m.id);
          }
        });
        if (lastUser && !tailDone) resumeWs(lastUser, tailPartial);
        q.focus();
      }).catch(function () {
        reopenTries += 1;
        if (!stale() && reopenTries < 5) {
          loadNote.textContent = 'Reopening the conversation… (takes a moment)';
          setTimeout(reopenGo, 6000);
        } else {
          loadNote.textContent = 'Could not reopen the conversation. Reload to retry.';
        }
      });
      };
      reopenGo();
    } else {
      /* A bare open while a question still cooks somewhere? The rare refresh
         that beat the stream's first line loses the thread from the URL — so
         look once at the newest conversation, and when its tail is an
         unanswered question only minutes old, offer the way back in. A link,
         never a redirect: the reader may genuinely want a fresh start, and
         one click keeps that choice theirs. */
      if (loggedIn && state.key) {
        var noticeTried = false;
        var noticeGo = function () {
        fetchRetry(MERECAT_API + '/chats', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: state.key }),
        }, [1000]).then(function (r) { return r.json(); }).then(function (d) {
          if (blockedOut(d)) return;
          if (!d.ok) throw new Error('transient');
          if (!d.chats || !d.chats.length) return;
          var newest = d.chats[0];
          if (!newest || newest.last_at < Math.floor(Date.now() / 1000) - 600) return;
          return fetchRetry(MERECAT_API + '/chat', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: state.key, id: newest.id }),
          }, [1000]).then(function (r2) { return r2.json(); }).then(function (t) {
            if (!t.ok) throw new Error('transient');
            if (!t.msgs || !t.msgs.length) return;
            var rows = t.msgs;
            var lastUser = null;
            for (var i = rows.length - 1; i >= 0; i--) {
              if (rows[i].role === 'user') { lastUser = rows[i]; break; }
            }
            if (!lastUser) return;
            for (var j = 0; j < rows.length; j++) {
              var m = rows[j];
              if (m.id > lastUser.id && m.role === 'assistant' && m.done !== 0) return;
            }
            var note = el('p', 'merecat-quota');
            note.appendChild(document.createTextNode('🐈 The librarian is still working on your last question — '));
            var back = el('a', 'body-link', 'rejoin it');
            back.href = 'merecat-ai.html?chat=' + newest.id;
            note.appendChild(back);
            note.appendChild(document.createTextNode('.'));
            log.insertBefore(note, log.firstChild);
          });
        }).catch(function () {
          /* one quiet retry — the notice is a courtesy, but a courtesy
             eaten by a rate limit deserves its second chance */
          if (!stale() && !noticeTried) { noticeTried = true; setTimeout(noticeGo, 8000); }
        });
        };
        noticeGo();
      }
      q.focus();
    }
  }

  /* The librarian's administration page: one dial for now, the per-member
     daily cap, on or off and how many. Off means members draw freely until
     the community's shared daily budget answers for everyone. Saved through
     the admin-keyed /config, the same door the make-librarian push uses;
     other edge isolates pick a change up within about five minutes. */
  /* The librarian's dials (Domain.Merecat): whether readers may ask it to
     reason, the level a new reader starts at, the highest any reader may
     pick, and the level a thread mention reasons at — plus the file-owned
     values (temperature, band weights) shown for the record. Saved through
     the admin-keyed /config, the door the pipeline's push uses too; every
     edge isolate picks a change up within about five minutes. */
  function renderMerecatDials(body: any) {
    var core: any = window.mcCore;
    body.appendChild(el('h3', null, 'The librarian'));
    var wrap = el('div', 'merecat-backends');
    wrap.appendChild(el('p', 'comments-status', 'Checking…'));
    body.appendChild(wrap);
    function saveCfg(obj: any, label: any) {
      var note = el('p', 'comments-status', 'Saving…'); wrap.appendChild(note);
      fetchRetry(MERECAT_API + '/config', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: state.key, config: obj }) }, [1000])
        .then(function (r) { return r.json(); }).then(function (dd) {
          note.textContent = dd.ok ? (label + ' saved. Live across the edge within about five minutes.')
            : (dd.error || 'Could not save.');
        }).catch(function () { note.textContent = 'Could not save.'; });
    }
    function levelSelect(current: string, onPick: (lv: string) => void) {
      var sel = el('select', 'scripture-sel');
      core.merecatEffortLadder.forEach(function (lv: string) {
        var op = el('option', null, core.merecatEffortLabel(lv)); op.value = lv; sel.appendChild(op);
      });
      sel.value = core.merecatEffortParse('off', current);
      sel.addEventListener('change', function () { onPick(sel.value); });
      return sel;
    }
    fetchRetry(MERECAT_API + '/backends', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: state.key }) }, [1000])
      .then(function (r) { return r.json(); }).then(function (b) {
        if (!b.ok) throw new Error(b.error || 'failed');
        var r = b.reasoning || {};
        wrap.textContent = '';
        wrap.appendChild(el('p', null, 'Answers come from Cloudflare Workers AI, model ' + (b.model || '(default)') +
          '. Today: ' + b.cloudflare.today + ' of ' + b.cloudflare.gcap + ' shared questions.'));
        wrap.appendChild(el('h4', null, 'Reasoning'));
        var onRow = el('p', 'admin-set-row');
        var onCb = el('input'); onCb.type = 'checkbox'; onCb.checked = !!r.on;
        onRow.appendChild(onCb); onRow.appendChild(document.createTextNode(' Let the librarian reason (Qwen3 thinking)'));
        wrap.appendChild(onRow);
        wrap.appendChild(el('p', 'board-cat-desc',
          'Off is how the site always answered: the model is told not to think and replies at once. On, a reader may pick a level ' +
          'from the selector under the composer, up to the ceiling below; the thinking streams inside think-tags the worker strips, ' +
          'so nothing of it reaches a reader, but every level above Off spends more output tokens (the headroom grows with the level) ' +
          'and more neurons from the shared daily budget. Watch Platform usage after turning it on.'));
        onCb.addEventListener('change', function () { saveCfg({ reasoning_on: onCb.checked ? 1 : 0 }, 'Reasoning switch'); });
        var defRow = el('p', 'admin-set-row'); defRow.appendChild(document.createTextNode('Level a new reader starts at: '));
        defRow.appendChild(levelSelect(r['default'] || 'low', function (lv) { saveCfg({ reasoning_default: lv }, 'Default level'); }));
        wrap.appendChild(defRow);
        var maxRow = el('p', 'admin-set-row'); maxRow.appendChild(document.createTextNode('Highest level a reader may pick: '));
        maxRow.appendChild(levelSelect(r.max || 'high', function (lv) { saveCfg({ reasoning_max: lv }, 'Ceiling'); }));
        wrap.appendChild(maxRow);
        var mrow = el('p', 'admin-set-row'); mrow.appendChild(document.createTextNode('@merecat mention reasoning: '));
        mrow.appendChild(levelSelect(r.mention || b.mention_effort || 'high', function (lv) { saveCfg({ mention_effort: lv }, 'Mention reasoning'); }));
        wrap.appendChild(mrow);
        wrap.appendChild(el('p', 'board-cat-desc',
          'A mention in a thread reasons at this level, under the same switch and ceiling. The ceiling clamps every ask on the ' +
          'server, whatever a reader\u2019s device remembers.'));
        /* The AI budget guard: the account's Workers AI meter against a line,
           on by default at 95 (Domain.Merecat). It reads through the usage
           token; without one it has no meter, and says so. */
        wrap.appendChild(el('h4', null, 'The AI budget guard'));
        var g = b.quota || {};
        var gRow = el('p', 'admin-set-row');
        var gCb = el('input'); gCb.type = 'checkbox'; gCb.checked = !!g.on;
        gRow.appendChild(gCb);
        gRow.appendChild(document.createTextNode(' Rest the librarian once the day\u2019s Workers AI spend reaches '));
        var gPct = el('input', 'key-input'); gPct.type = 'number'; gPct.min = '10'; gPct.max = '99';
        gPct.value = String(g.pct || core.merecatQuotaGuardDefaults.pct); gPct.style.width = '4.5em';
        gRow.appendChild(gPct);
        gRow.appendChild(document.createTextNode('% of the free day'));
        wrap.appendChild(gRow);
        gCb.addEventListener('change', function () { saveCfg({ quota_guard_on: gCb.checked ? 1 : 0 }, 'Budget guard'); });
        gPct.addEventListener('change', function () {
          var n = core.merecatQuotaGuardPctFrom(gPct.value); gPct.value = String(n);
          saveCfg({ quota_guard_pct: n }, 'Guard line');
        });
        var gStatus;
        if (!g.configured) gStatus = 'The guard has no meter to read: the usage token is not set (CF_USAGE_TOKEN beside CF_ACCOUNT_ID; Platform usage shows the steps). Until it stands the guard does nothing and the question caps are the only wall.';
        else if (!g.on) gStatus = 'Off: the librarian answers until Cloudflare itself refuses or bills. The question caps still apply.';
        else if (g.unread) gStatus = 'The meter could not be read just now; the guard stands open until a read succeeds (worker log: merecat_quota_unread).';
        else gStatus = 'Workers AI today: ' + g.meter_pct + '% of the free day\u2019s ' + Number(g.limit).toLocaleString() + ' neurons (' +
          Math.round(Number(g.used)) + ' spent' + (g.stale ? ', from a reading up to fifteen minutes old' : '') + '). ' +
          (g.resting ? 'merecat is resting; the day renews in about ' + g.reset_in_h + ' hours.' : 'merecat rests at ' + g.pct + '%.');
        wrap.appendChild(el('p', 'comments-status', gStatus));
        wrap.appendChild(el('p', 'board-cat-desc',
          'On by default. Before every question and every @merecat mention the worker reads the account\u2019s Workers AI meter (the figure ' +
          'Platform usage draws) and, at the line, rests the librarian and tells the asker how many hours until the day renews at midnight UTC. ' +
          'The line is a margin, not the wall: the analytics run a minute or two behind, one plain question is about half a percent of the day ' +
          '(several times that with reasoning on), and the board\u2019s own screening spends from the same budget. Admins are held to it too, ' +
          'since it guards the account rather than the ration; switch it off here to ask past the line.'));
        wrap.appendChild(el('p', 'comments-status',
          'From librarian/config.yml, pushed by the pipeline: temperature ' + b.temperature + ', top-k ' + b.topk +
          ', answer ceiling ' + b.max_tokens + ' tokens, band weights ' + (b.band_weights || '(default)') + '.'));
        wrap.appendChild(el('p', 'comments-status', b.last_ingest
          ? 'Shelf last pushed ' + b.last_ingest + ' by ' + (b.last_ingest_by === 'local' ? 'a hand run' : 'pipeline run ' + b.last_ingest_by) + '.'
          : 'The shelf has not been pushed through the pipeline yet.'));
      }).catch(function () {
        wrap.textContent = '';
        wrap.appendChild(el('p', 'comments-status', 'Could not reach the status endpoint.'));
      });
  }

  function viewMerecatAdmin() {
    document.title = 'merecat administration | Community';
    crumb([['Community', 'community.html'], ['Administrative options', 'admin.html'], ['merecat']]);
    if (adminGate(viewMerecatAdmin)) return;
    ensureMerecatStyles();
    var box = el('div', 'merecat-about');
    box.setAttribute('open', '');
    var body = el('div', 'merecat-about-body');
    box.appendChild(body);
    section.appendChild(box);
    body.textContent = 'Loading the librarian’s dials…';
    fetchRetry(MERECAT_API + '/about', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: state.key }),
    }, [1000, 3000]).then(function (r) { return r.json(); }).then(function (d) {
      if (!d.ok) throw new Error(d.error || 'failed');
      body.textContent = '';
      renderMerecatDials(body);
      body.appendChild(el('h3', null, 'Usage today'));
      body.appendChild(el('p', null,
        'The community has used ' + d.today + ' of its ' + d.global_daily +
        ' shared questions. Counters renew at ' + merecatResetLocal() + ' your time.'));
      body.appendChild(el('h3', null, 'The per-member daily cap'));
      var row = el('p');
      var chk = el('input'); chk.type = 'checkbox'; chk.id = 'mc-cap-on';
      chk.checked = !!d.user_cap_on;
      row.appendChild(chk);
      var lbl = el('label', null, ' Limit each member to ');
      lbl.htmlFor = 'mc-cap-on';
      row.appendChild(lbl);
      var num = el('input', 'key-input'); num.type = 'number'; num.min = '1'; num.max = '500';
      num.value = d.user_daily; num.style.width = '5em';
      row.appendChild(num);
      row.appendChild(document.createTextNode(' questions per day. Unchecked, members draw freely until the community budget is spent. Admins are never capped either way. These caps guard the community’s Workers AI budget.'));
      body.appendChild(row);
      var save = el('button', 'btn btn-send', 'Save');
      save.type = 'button';
      var note = el('p', 'comments-status', '');
      save.addEventListener('click', function () {
        var n = Math.max(1, Math.min(500, Math.floor(Number(num.value) || 10)));
        num.value = n;
        save.disabled = true;
        note.textContent = 'Saving…';
        fetchRetry(MERECAT_API + '/config', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: state.key, config: { user_cap_on: chk.checked ? 1 : 0, user_daily: n } }),
        }, [1000]).then(function (r) { return r.json(); }).then(function (dd) {
          note.textContent = dd.ok
            ? 'Saved. The change reaches every corner of the edge within about five minutes.'
            : (dd.error || 'Could not save.');
        }).catch(function () { note.textContent = 'Could not save. Try again.'; })
          .then(function () { save.disabled = false; });
      });
      body.appendChild(save);
      body.appendChild(note);
      body.appendChild(el('p', 'comments-status',
        'Note: caps changed here also govern @merecat mentions in threads. The librarian’s open-book panel updates itself to match.'));

      /* The standing instructions, live-editable: what is saved here IS the
         system prompt, for every answer, within about five minutes. It
         stands until librarian/persona.md in the repo is itself next
         edited, whose push then takes over (the daily ingest pushes the
         file only when the file changed). */
      body.appendChild(el('h3', null, 'The standing instructions, verbatim, as the model receives them'));
      body.appendChild(el('p', null,
        'Edit and save, and the librarian answers under the new instructions within about five minutes, everywhere at once. A save here stands until librarian/persona.md in the repo is next edited, whose push then replaces it. The open-book panel always shows whatever stands.'));
      var pTa = el('textarea', 'merecat-persona-edit');
      pTa.value = d.persona || '';
      body.appendChild(pTa);
      var pSave = el('button', 'btn btn-send', 'Save the instructions');
      pSave.type = 'button';
      var pNote = el('p', 'comments-status', '');
      pSave.addEventListener('click', function () {
        var text = pTa.value.trim();
        if (!text) { pNote.textContent = 'The instructions cannot be empty.'; return; }
        var doSave = function () {
          pSave.disabled = true;
          pNote.textContent = 'Saving…';
          fetchRetry(MERECAT_API + '/config', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: state.key, persona: text }),
          }, [1000]).then(function (r) { return r.json(); }).then(function (dd) {
            pNote.textContent = dd.ok
              ? 'Saved. The librarian answers under these instructions within about five minutes.'
              : (dd.error || 'Could not save.');
          }).catch(function () { pNote.textContent = 'Could not save. Try again.'; })
            .then(function () { pSave.disabled = false; });
        };
        if (text.length < 200) appConfirm('These instructions are very short. Replace the librarian’s whole standing instructions with them?', { okLabel: 'Replace', danger: true }, function (ok: any) { if (ok) doSave(); });
        else doSave();
      });
      body.appendChild(pSave);
      body.appendChild(pNote);
    }).catch(function () {
      body.textContent = 'Could not load the dials. Reload to retry.';
    });
  }
  function bind() {
    API = B.API;
    CATS = B.CATS;
    adminGate = B.adminGate;
    appConfirm = B.appConfirm;
    attachDraft = B.attachDraft;
    blockedOut = B.blockedOut;
    bootSig = B.bootSig;
    crumb = B.crumb;
    displayName = B.displayName;
    el = B.el;
    fetchRetry = B.fetchRetry;
    fillBody = B.fillBody;
    fmtDateTime = B.fmtDateTime;
    freshOpts = B.freshOpts;
    freshParam = B.freshParam;
    go = B.go;
    isAdmin = B.isAdmin;
    isMember = B.isMember;
    loadingLine = B.loadingLine;
    mcIcon = B.mcIcon;
    pageBar = B.pageBar;
    profileHref = B.profileHref;
    readEase = B.readEase;
    readMark = B.readMark;
    readThrottled = B.readThrottled;
    renderIdentity = B.renderIdentity;
    scriptureDecor = B.scriptureDecor;
    section = B.section;
    skeleton = B.skeleton;
    stale = B.stale;
    state = B.state;
    swipeDismissesKeyboard = B.swipeDismissesKeyboard;
  }
  /* What ran at boot time in the old file, in the old order, after every
     module is bound: listeners, deferred initializers. */
  function run() {
  }
  return { bind, run, exports: { MERECAT_API, MERECAT_BOT_HASH, viewMerecat, viewMerecatAdmin, viewMerecatThread, viewMerecatThreads } };
}
