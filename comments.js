/* Comments client. A page opts in with <section class="comments" data-comments>
   before its footer plus this script. The thread loads only when the section
   scrolls into view, so readers who never reach it cost no API request.

   Identity is a random key generated in the browser and kept in localStorage.
   The server stores only SHA-256(key). Everyone else sees a pseudonym derived
   from that hash, so the same person keeps the same name and nobody can
   recover the key from it. Losing the key loses the identity, which is why
   the key is shown once with a copy button. All rendering goes through
   textContent, never innerHTML, so comment text cannot inject markup. */

(function () {
  'use strict';

  var API = '/api/comments';
  var SITEKEY = '0x4AAAAAAD8IYH9_xQ0HE0yB';
  var STORAGE = 'mc-comment-key';
  /* Fingerprints of the site owners' identities. Holding a key that hashes
     to one of these shows delete links on every comment, and the server
     honors those deletes. Publishing the hash reveals nothing usable, the
     power is in the key, which never leaves the owner's browser. */
  var ADMIN_HASHES = ['d1915a05c2583f437b1316971563b3c4c404cff016a016770d91af1f2645f7f6',
    'c83c2b4d105771aafa662a26745ddd2172213ddf5b39d64dfb91f579b5e18b03'];

  /* Must stay identical to the lists in comments-worker/src/index.js. */
  var ADJ = ['Patient','Quiet','Steadfast','Humble','Gentle','Sober','Watchful','Earnest',
    'Merry','Plain','Hidden','Upright','Ancient','Early','Golden','Green',
    'Grey','Amber','Ivory','Deep','Broad','High','Still','Bright',
    'Clear','Kind','Mild','Firm','True','Swift','Careful','Cheerful',
    'Constant','Modest','Peaceful','Prudent','Silent','Simple','Sturdy','Temperate'];
  var NOUN = ['Cedar','Harbor','Meadow','River','Garden','Orchard','Bridge','Lantern',
    'Anchor','Well','Spring','Stone','Oak','Olive','Vine','Wheat',
    'Barley','Dove','Sparrow','Heron','Candle','Bell','Tower','Gate',
    'Path','Field','Hill','Valley','Brook','Shore','Island','Harvest',
    'Vineyard','Cypress','Juniper','Almond','Fig','Palm','Elm','Ash'];

  function displayName(hash) {
    function b(i) { return parseInt(hash.slice(i * 2, i * 2 + 2), 16); }
    var adj = ADJ[((b(4) << 8) | b(5)) % ADJ.length];
    var noun = NOUN[((b(6) << 8) | b(7)) % NOUN.length];
    return adj + '-' + noun + ' ' + hash.slice(0, 4);
  }

  function pagePath() {
    var p = location.pathname;
    if (p.slice(-1) === '/') p += 'index.html';
    if (p.slice(-5) !== '.html') p += '.html';
    return p;
  }

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  function browserTz() {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { return ''; }
  }

  /* Bounded retries for network failures only. An HTTP response of any
     status is final: the server spoke, retrying could only double an
     action. A rejected fetch means nothing arrived, so a short backoff
     and another try are safe, and the attempt count is small on purpose:
     after the last one the reader's manual refresh is the only restart. */
  function fetchRetry(url, opts, delays, onRetry) {
    function attempt(i) {
      return fetch(url, opts).catch(function (err) {
        if (i >= delays.length) throw new Error('Network error. Check your connection and try again.');
        if (onRetry) onRetry();
        return new Promise(function (resolve) { setTimeout(resolve, delays[i]); })
          .then(function () { return attempt(i + 1); });
      });
    }
    return attempt(0);
  }

  function fmtDate(epoch) {
    return new Date(epoch * 1000).toLocaleDateString('en-US',
      { year: 'numeric', month: 'long', day: 'numeric' });
  }

  function fmtDateTime(epoch) {
    return new Date(epoch * 1000).toLocaleString('en-US',
      { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  function isAdmin() {
    return !!state.key && ADMIN_HASHES.indexOf(state.myHash) !== -1;
  }

  function sha256hex(text) {
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)).then(function (buf) {
      return Array.prototype.map.call(new Uint8Array(buf), function (x) {
        return ('0' + x.toString(16)).slice(-2);
      }).join('');
    });
  }

  function getKey() {
    try { return localStorage.getItem(STORAGE) || ''; } catch (e) { return ''; }
  }
  function setKey(key) {
    try { localStorage.setItem(STORAGE, key); } catch (e) {}
  }
  function clearKey() {
    try { localStorage.removeItem(STORAGE); } catch (e) {}
  }
  function makeKey() {
    var bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return btoa(String.fromCharCode.apply(null, bytes))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  var section = document.querySelector('section[data-comments], section[data-board]');
  if (!section) return;
  var BOARD = section.hasAttribute('data-board');

  /* Keys must match BOARD_CATS in the worker. */
  var CATS = [
    ['pub', 'Pub', 'General discussion, for whatever fits nowhere more specific.'],
    ['news', 'News', 'News of the Church and of the world.'],
    ['theology', 'Theology', 'Historical, biblical, systematic, covenant, all of it.'],
    ['philosophy', 'Philosophy', 'Does this board really exist.'],
    ['history', 'History', 'What happened, when, and to whom.'],
    ['rc', 'Roman Catholicism', 'In-house talk for Roman Catholics.'],
    ['eo', 'Eastern Orthodoxy', 'In-house talk for the Eastern Orthodox.'],
    ['prot', 'Protestantism', 'In-house talk for Protestants.'],
    ['offtopic', 'Off Topic', 'Everything else, cheerfully off the point.'],
  ];
  function catByKey(key) {
    for (var i = 0; i < CATS.length; i++) if (CATS[i][0] === key) return CATS[i];
    return null;
  }

  var state = {
    key: getKey(),
    myHash: '',
    started: false,
    widgetId: null,
    tokenWait: null,
    anonAllowed: false,
  };

  /* ---- Turnstile. Loaded lazily, challenge run only at post time so the
     token cannot expire while a long comment is being written. ---- */

  function loadTurnstile() {
    if (window.turnstile || document.getElementById('mc-ts-script')) return;
    window.__mcCommentsTs = function () {
      var slot = section.querySelector('.ts-slot');
      if (!slot) return;
      state.widgetId = turnstile.render(slot, {
        sitekey: SITEKEY,
        execution: 'execute',
        appearance: 'interaction-only',
        callback: function (token) {
          if (state.tokenWait) { state.tokenWait.resolve(token); state.tokenWait = null; }
        },
        'error-callback': function () {
          if (state.tokenWait) { state.tokenWait.reject(new Error('challenge failed')); state.tokenWait = null; }
          return true;
        },
        'expired-callback': function () {},
      });
    };
    var script = document.createElement('script');
    script.id = 'mc-ts-script';
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=__mcCommentsTs&render=explicit';
    script.async = true;
    script.onerror = function () { state.tsError = true; };
    document.head.appendChild(script);
  }

  function getToken() {
    return new Promise(function (resolve, reject) {
      if (state.tsError) {
        reject(new Error('Verification could not load. Check your connection and reload the page.'));
        return;
      }
      if (!window.turnstile || state.widgetId === null) {
        reject(new Error('Verification is still loading. Try again in a moment.'));
        return;
      }
      state.tokenWait = { resolve: resolve, reject: reject };
      try { turnstile.execute(state.widgetId); } catch (e) {
        state.tokenWait = null;
        reject(e);
      }
    });
  }

  /* ---- Rendering ---- */

  function commentNode(c, pending) {
    var article = el('article', 'comment' + (pending ? ' comment-pending' : ''));
    article.id = 'comment-' + c.id;
    /* Machine-readable notice that this is a visitor's comment, not the
       site's own text. */
    article.setAttribute('itemscope', '');
    article.setAttribute('itemtype', 'https://schema.org/Comment');
    var head = el('div', 'comment-head');
    var author = el('span', 'comment-author',
      c.author_hash ? displayName(c.author_hash) : 'Anonymous');
    author.setAttribute('itemprop', 'author');
    head.appendChild(author);
    /* The date doubles as the comment's shareable permalink. */
    var date = el('a', 'comment-date', fmtDate(c.created_at));
    date.href = '#comment-' + c.id;
    head.appendChild(date);
    if (c.edited_at) head.appendChild(el('span', 'comment-edited', 'edited'));
    if (c.author_hash && c.author_hash === state.myHash) {
      var ed = el('a', 'comment-edit', 'edit');
      ed.href = '#';
      ed.addEventListener('click', function (e) {
        e.preventDefault();
        startEdit(c, article);
      });
      head.appendChild(ed);
    }
    if (state.myHash && (c.author_hash === state.myHash || ADMIN_HASHES.indexOf(state.myHash) !== -1)) {
      var del = el('a', 'comment-delete', 'delete');
      del.href = '#';
      del.addEventListener('click', function (e) {
        e.preventDefault();
        if (!confirm('Delete this comment?')) return;
        fetchRetry(API + '/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: c.id, key: state.key }),
        }, [1500]).then(function (r) { return r.json(); }).then(function (d) {
          if (d.ok) {
            article.remove();
            /* Same freshness stamp as posting: the deleter's own reloads
               must not resurrect the comment from the list cache. */
            try { localStorage.setItem('mc-posted-at', String(Date.now())); } catch (e) {}
          } else setStatus(d.error || 'Could not delete the comment.');
        }).catch(function () {
          setStatus('Network error. The comment was not deleted.');
        });
      });
      head.appendChild(del);
    }
    article.appendChild(head);
    var body = el('div', 'comment-body', c.body);
    body.setAttribute('itemprop', 'text');
    article.appendChild(body);
    if (pending) {
      article.appendChild(el('p', 'comment-note',
        'Held for review. It will appear here once approved.'));
    }
    return article;
  }

  function setStatus(text) {
    section.querySelector('.comments-status').textContent = text;
  }

  /* Inline editing of one's own comment. Every save is re-screened by the
     server, so a flagged edit sends the comment back to review. */
  function startEdit(c, article) {
    if (article.querySelector('.comment-editor')) return;
    var bodyDiv = article.querySelector('.comment-body');
    var editor = el('div', 'comment-editor');
    var ta = el('textarea', 'comment-text');
    ta.maxLength = 4000;
    ta.rows = 4;
    ta.value = c.body;
    editor.appendChild(ta);
    var row = el('div', 'comment-buttons');
    var save = el('button', 'btn btn-send key-copy', 'Save');
    save.type = 'button';
    row.appendChild(save);
    editor.appendChild(row);
    var note = el('div', 'comment-note');
    editor.appendChild(note);
    editor.appendChild(identityAction('Cancel', function () {
      editor.remove();
      bodyDiv.hidden = false;
    }));
    save.addEventListener('click', function () {
      var newBody = ta.value.replace(/\s+$/, '');
      if (!newBody.trim()) { ta.focus(); return; }
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
          editor.remove();
          bodyDiv.textContent = newBody;
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

  /* Reads are browser-cached for 60s. To someone who just wrote, that
     cache makes their own change vanish on reload, so recent writers
     bypass it until the cache would be fresh again. */
  function freshOpts() {
    var posted = 0;
    try { posted = Number(localStorage.getItem('mc-posted-at')) || 0; } catch (e) {}
    return (Date.now() - posted < 90000) ? { cache: 'no-store' } : undefined;
  }

  function stampFresh() {
    try { localStorage.setItem('mc-posted-at', String(Date.now())); } catch (e) {}
  }

  function load() {
    var list = section.querySelector('.comments-list');
    fetchRetry(API + '?page=' + encodeURIComponent(pagePath()), freshOpts(), [1000, 3000],
      function () { setStatus('Network hiccup, retrying...'); })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok) throw new Error(d.error || 'failed');
        state.anonAllowed = !!d.anon;
        renderIdentity();
        list.textContent = '';
        d.comments.forEach(function (c) { list.appendChild(commentNode(c, false)); });
        section.querySelector('.comments-title-text').textContent =
          d.comments.length ? 'Comments (' + d.comments.length + ')' : 'Comments';
        setStatus(d.comments.length ? '' : 'No comments yet. Yours can be the first.');
        /* A shared permalink points at markup that only now exists, so the
           browser's own hash jump has already missed. Finish it by hand. */
        if (/^#comment-\d+$/.test(location.hash)) {
          var target = document.getElementById(location.hash.slice(1));
          if (target) target.scrollIntoView();
        }
        annotateMeta();
      })
      .catch(function () {
        setStatus('Comments could not be loaded. Check your connection and reload the page.');
      });
  }

  /* Admin only. Fetches the logged IP, OS, and agent for each comment and
     writes them under the comments. The server refuses non-admin keys, so
     for everyone else this function returns without a trace. */
  function annotateMeta(pageKey) {
    if (!state.key || ADMIN_HASHES.indexOf(state.myHash) === -1) return;
    fetch(API + '/meta', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ page: pageKey || pagePath(), key: state.key }),
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (!d.ok) return;
      d.meta.forEach(function (m) {
        var node = document.getElementById('comment-' + m.id);
        if (!node || node.querySelector('.comment-meta')) return;
        var details = el('details', 'comment-meta');
        details.appendChild(el('summary', null, 'user-fingerprint'));
        details.appendChild(el('div', null,
          (m.ip ? (m.ip.indexOf(':') !== -1 ? 'IPv6 ' : 'IPv4 ') + m.ip : 'ip?') +
          (m.os ? ' · ' + m.os : '') + (m.tz ? ' · ' + m.tz : '') +
          (m.lang ? ' · ' + m.lang : '')));
        if (m.ua) details.appendChild(el('div', null, m.ua));
        node.appendChild(details);
      });
    }).catch(function () {});
  }

  /* ---- Identity UI ---- */

  function renderIdentity() {
    var box = section.querySelector('.comment-identity');
    box.textContent = '';
    var line = el('p', 'identity-line');
    if (state.key && state.myHash) {
      line.appendChild(document.createTextNode('Commenting as '));
      line.appendChild(el('strong', null, displayName(state.myHash)))
      line.appendChild(document.createTextNode('. '));
      line.appendChild(identityAction('Show my key', showKeyBox));
      line.appendChild(document.createTextNode(' · '));
      line.appendChild(identityAction('Logout', function () {
        if (!confirm('Log out and forget this identity here? Unless you saved your key, there is no way back to this name.')) return;
        clearKey();
        state.key = '';
        state.myHash = '';
        if (BOARD) { location.reload(); return; }
        hideKeyBox();
        renderIdentity();
        load();
      }));
    } else {
      line.appendChild(document.createTextNode(state.anonAllowed
        ? 'Commenting anonymously. '
        : 'To comment, create an identity. One click, no signup. '));
      line.appendChild(identityAction('Create an identity', showAgreeBox));
      line.appendChild(document.createTextNode(' · '));
      line.appendChild(identityAction('I have a key', showPasteBox));
    }
    box.appendChild(line);
  }

  function identityAction(label, onClick) {
    var a = el('a', 'identity-action', label);
    a.href = '#';
    a.addEventListener('click', function (e) { e.preventDefault(); onClick(); });
    return a;
  }

  /* Signup is one checkbox deep. Agreeing to the terms is what creates
     the identity, so every commenter has agreed by construction. */
  function showAgreeBox() {
    var box = section.querySelector('.key-box');
    box.textContent = '';
    var label = el('label', 'agree-row');
    var check = el('input');
    check.type = 'checkbox';
    label.appendChild(check);
    label.appendChild(document.createTextNode(' I agree to the '));
    var terms = el('a', null, 'terms & conds');
    terms.href = 'terms.html';
    terms.target = '_blank';
    label.appendChild(terms);
    box.appendChild(label);
    var row = el('div', 'key-row');
    var create = el('button', 'btn btn-send key-copy', 'Create');
    create.type = 'button';
    create.disabled = true;
    check.addEventListener('change', function () { create.disabled = !check.checked; });
    create.addEventListener('click', function () {
      if (!check.checked) return;
      try { localStorage.setItem('mc-agreed-at', String(Date.now())); } catch (e) {}
      var key = makeKey();
      setKey(key);
      state.key = key;
      sha256hex(key).then(function (h) {
        state.myHash = h;
        renderIdentity();
        showKeyBox();
      });
    });
    row.appendChild(create);
    box.appendChild(row);
    box.appendChild(identityAction('Cancel', hideKeyBox));
    box.hidden = false;
  }

  function showKeyBox() {
    var box = section.querySelector('.key-box');
    box.textContent = '';
    var note = el('p', 'key-note');
    note.appendChild(el('strong', null, 'Your key. '));
    note.appendChild(document.createTextNode(
      'This is your identity. Save it somewhere private to log in on ' +
      'another device or after this browser forgets it. Anyone who has it can post under your name.'));
    box.appendChild(note);
    var row = el('div', 'key-row');
    var input = el('input', 'key-input');
    input.type = 'text';
    input.readOnly = true;
    input.value = state.key;
    input.addEventListener('focus', function () { input.select(); });
    row.appendChild(input);
    var copy = el('button', 'btn btn-send key-copy', 'Copy');
    copy.type = 'button';
    copy.addEventListener('click', function () {
      navigator.clipboard.writeText(state.key).then(function () {
        copy.textContent = 'Copied';
        setTimeout(function () { copy.textContent = 'Copy'; }, 1500);
      }, function () { input.focus(); });
    });
    row.appendChild(copy);
    box.appendChild(row);
    box.appendChild(identityAction('Hide', hideKeyBox));
    box.hidden = false;
  }

  function showPasteBox() {
    var box = section.querySelector('.key-box');
    box.textContent = '';
    box.appendChild(el('p', 'key-note', 'Paste the key you saved.'));
    var row = el('div', 'key-row');
    var input = el('input', 'key-input');
    input.type = 'text';
    row.appendChild(input);
    var use = el('button', 'btn btn-send key-copy', 'Use it');
    use.type = 'button';
    use.addEventListener('click', function () {
      var key = input.value.trim();
      if (key.length < 16) { input.focus(); return; }
      setKey(key);
      state.key = key;
      /* On the board the cleanest login is the og one: reload, and the
         current view returns with the right name, buttons, and links. */
      if (BOARD) { location.reload(); return; }
      sha256hex(key).then(function (h) {
        state.myHash = h;
        hideKeyBox();
        renderIdentity();
        load();
      });
    });
    row.appendChild(use);
    box.appendChild(row);
    box.appendChild(identityAction('Cancel', hideKeyBox));
    box.hidden = false;
  }

  function hideKeyBox() {
    var box = section.querySelector('.key-box');
    box.hidden = true;
    box.textContent = '';
  }

  /* ---- Posting ---- */

  function post(asKeyed) {
    var textarea = section.querySelector('.comment-text');
    var status = section.querySelector('.form-status');
    var body = textarea.value.replace(/\s+$/, '');
    if (!body.trim()) { textarea.focus(); return; }
    var buttons = section.querySelectorAll('.comment-buttons button');
    buttons.forEach(function (b) { b.disabled = true; });
    status.textContent = 'Verifying...';
    getToken().then(function (token) {
      status.textContent = 'Posting...';
      return fetchRetry(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          page: pagePath(),
          body: body,
          token: token,
          key: asKeyed ? state.key : '',
          website: section.querySelector('.hp').value,
          tz: browserTz(),
        }),
      }, [1500], function () { status.textContent = 'Network hiccup, retrying...'; })
        .then(function (r) { return r.json(); });
    }).then(function (d) {
      if (!d.ok) throw new Error(d.error || 'Something went wrong. Please try again.');
      var list = section.querySelector('.comments-list');
      list.appendChild(commentNode(d.comment, d.status === 'pending'));
      try { localStorage.setItem('mc-posted-at', String(Date.now())); } catch (e) {}
      textarea.value = '';
      setStatus('');
      status.textContent = d.status === 'pending'
        ? 'Held for review. It will appear once approved.'
        : 'Posted.';
    }).catch(function (err) {
      status.textContent = err.message || 'Could not reach the server. Please try again.';
    }).finally(function () {
      buttons.forEach(function (b) { b.disabled = false; });
      if (window.turnstile && state.widgetId !== null) turnstile.reset(state.widgetId);
    });
  }

  function renderButtons() {
    var row = section.querySelector('.comment-buttons');
    row.textContent = '';
    if (state.key && state.myHash) {
      var keyed = el('button', 'btn btn-send', 'Post as ' + displayName(state.myHash).split(' ')[0]);
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
  }

  /* ---- The Catholicity Board ---- */

  function crumb(parts) {
    var p = el('p', 'board-crumb');
    parts.forEach(function (part, i) {
      if (i) p.appendChild(document.createTextNode(' › '));
      if (part[1]) {
        var a = el('a', null, part[0]);
        a.href = part[1];
        p.appendChild(a);
      } else {
        p.appendChild(el('span', null, part[0]));
      }
    });
    section.appendChild(p);
    return p;
  }

  function buildBoardForm(withTitle, heading) {
    var form = el('div', 'comment-form');
    form.appendChild(el('h3', 'board-form-head', heading));
    form.appendChild(el('div', 'comment-identity'));
    var keyBox = el('div', 'key-box');
    keyBox.hidden = true;
    form.appendChild(keyBox);
    if (withTitle) {
      var title = el('input', 'board-title');
      title.type = 'text';
      title.maxLength = 120;
      title.placeholder = 'Topic title';
      form.appendChild(title);
    }
    var textarea = el('textarea', 'comment-text');
    textarea.maxLength = 4000;
    textarea.rows = 5;
    textarea.placeholder = 'Say what you want to say.';
    form.appendChild(textarea);
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
    section.appendChild(form);
    return form;
  }

  function boardButtons(labelBase, submit) {
    state.boardBtn = [labelBase, submit];
    var row = section.querySelector('.comment-buttons');
    if (!row) return;
    row.textContent = '';
    var keyed = state.key && state.myHash;
    var label = keyed ? labelBase + ' as ' + displayName(state.myHash).split(' ')[0] : labelBase;
    var button = el('button', 'btn btn-send', label);
    button.type = 'button';
    if (keyed || state.anonAllowed) {
      button.addEventListener('click', submit);
    } else {
      button.disabled = true;
      button.title = 'Create an identity first. One click, above the box.';
    }
    row.appendChild(button);
  }

  function boardPost(payload, onSuccess) {
    var status = section.querySelector('.form-status');
    var buttons = section.querySelectorAll('.comment-buttons button');
    buttons.forEach(function (b) { b.disabled = true; });
    status.textContent = 'Verifying...';
    getToken().then(function (token) {
      status.textContent = 'Posting...';
      payload.token = token;
      payload.key = state.key || '';
      payload.website = section.querySelector('.hp').value;
      payload.tz = browserTz();
      return fetchRetry(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }, [1500], function () { status.textContent = 'Network hiccup, retrying...'; })
        .then(function (r) { return r.json(); });
    }).then(function (d) {
      if (!d.ok) throw new Error(d.error || 'Something went wrong. Please try again.');
      stampFresh();
      status.textContent = '';
      onSuccess(d);
    }).catch(function (err) {
      status.textContent = err.message || 'Could not reach the server. Please try again.';
    }).finally(function () {
      buttons.forEach(function (b) { b.disabled = false; });
      if (window.turnstile && state.widgetId !== null) turnstile.reset(state.widgetId);
    });
  }

  function armBoardForm() {
    renderIdentity();
    new MutationObserver(function () {
      if (state.boardBtn) boardButtons(state.boardBtn[0], state.boardBtn[1]);
    }).observe(section.querySelector('.comment-identity'), { childList: true });
    loadTurnstile();
  }

  function viewIndex() {
    document.title = 'Catholicity Board | Mere Catholicity';
    /* The identity drawer lives on the front page too, so a reader can
       create, show, or swap a key before ever entering a room. */
    section.appendChild(el('div', 'comment-identity'));
    var keyBox = el('div', 'key-box');
    keyBox.hidden = true;
    section.appendChild(keyBox);
    renderIdentity();
    /* Admins alone see the door to the audit. The server would refuse
       anyone else anyway, so hiding it is courtesy, not the lock. */
    var auditSlot = el('p', 'board-audit-link');
    section.appendChild(auditSlot);
    function ensureAuditLink() {
      auditSlot.textContent = '';
      if (!isAdmin()) return;
      var a = el('a', 'identity-action', 'Activity audit');
      a.href = 'community.html?audit=1';
      auditSlot.appendChild(a);
    }
    ensureAuditLink();
    new MutationObserver(ensureAuditLink)
      .observe(section.querySelector('.comment-identity'), { childList: true });
    var wrap = el('div', 'board-cats');
    var stats = {};
    CATS.forEach(function (cat) {
      var row = el('div', 'board-cat');
      var left = el('div', 'board-cat-left');
      var name = el('a', 'board-cat-name', cat[1]);
      name.href = 'community.html?cat=' + cat[0];
      left.appendChild(name);
      left.appendChild(el('div', 'board-cat-desc', cat[2]));
      row.appendChild(left);
      stats[cat[0]] = el('div', 'board-stats', '—');
      row.appendChild(stats[cat[0]]);
      wrap.appendChild(row);
    });
    section.appendChild(wrap);
    fetchRetry(API + '/board', freshOpts(), [1000, 3000])
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok) return;
        CATS.forEach(function (cat) {
          var c = d.cats[cat[0]];
          var cell = stats[cat[0]];
          cell.textContent = '';
          if (!c) { cell.textContent = 'quiet so far'; return; }
          cell.appendChild(el('div', null,
            c.topics + (c.topics === 1 ? ' topic · ' : ' topics · ') + c.posts + (c.posts === 1 ? ' post' : ' posts')));
          if (c.latest && c.latest.title) {
            var line = el('div', 'board-latest');
            var t = String(c.latest.title);
            var a = el('a', null, t.length > 42 ? t.slice(0, 42) + '…' : t);
            a.href = 'community.html?topic=' + c.latest.topic_id;
            line.appendChild(a);
            line.appendChild(document.createTextNode(' · ' +
              (c.latest.author_hash ? displayName(c.latest.author_hash) : 'Anonymous') +
              ' · ' + fmtDate(c.latest.created_at)));
            cell.appendChild(line);
          }
        });
      })
      .catch(function () {});
  }

  function viewCat(key) {
    var cat = catByKey(key);
    if (!cat) return viewIndex();
    document.title = cat[1] + ' | Catholicity Board';
    var head = crumb([['Catholicity Board', 'community.html'], [cat[1]]]);
    var rss = el('a', 'comments-rss', 'RSS');
    rss.href = API + '/feed?cat=' + key;
    rss.title = 'Follow this category with a feed reader';
    head.appendChild(document.createTextNode(' '));
    head.appendChild(rss);
    section.appendChild(el('p', 'board-cat-desc', cat[2]));
    var list = el('div', 'board-topics');
    list.textContent = 'Loading topics...';
    section.appendChild(list);
    buildBoardForm(true, 'Start a topic');
    boardButtons('Post topic', function () {
      var title = section.querySelector('.board-title').value.replace(/\s+/g, ' ').trim();
      var body = section.querySelector('.comment-text').value.replace(/\s+$/, '');
      var status = section.querySelector('.form-status');
      if (title.length < 3) { section.querySelector('.board-title').focus(); return; }
      if (!body.trim()) { section.querySelector('.comment-text').focus(); return; }
      boardPost({ cat: key, title: title, body: body }, function (d) {
        if (d.status === 'pending') {
          status.textContent = 'Held for review. It will appear once approved.';
          section.querySelector('.board-title').value = '';
          section.querySelector('.comment-text').value = '';
        } else {
          location.href = 'community.html?topic=' + d.comment.id;
        }
      });
    });
    armBoardForm();
    fetchRetry(API + '/board/cat?cat=' + key, freshOpts(), [1000, 3000])
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok) throw new Error(d.error || 'failed');
        list.textContent = '';
        if (!d.topics.length) {
          list.appendChild(el('p', 'comments-status', 'No topics yet. Yours can be the first.'));
          return;
        }
        d.topics.forEach(function (t) {
          var row = el('div', 'board-topic');
          var title = el('a', 'board-topic-title', t.title);
          title.href = 'community.html?topic=' + t.id;
          row.appendChild(title);
          row.appendChild(el('div', 'board-stats',
            (t.author_hash ? displayName(t.author_hash) : 'Anonymous') + ' · ' +
            t.replies + (t.replies === 1 ? ' reply · ' : ' replies · ') + fmtDate(t.last)));
          list.appendChild(row);
        });
      })
      .catch(function () {
        list.textContent = '';
        list.appendChild(el('p', 'comments-status', 'Topics could not be loaded. Check your connection and reload the page.'));
      });
  }

  function viewTopic(id) {
    fetchRetry(API + '/board/topic?id=' + id, freshOpts(), [1000, 3000])
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok) throw new Error(d.error || 'failed');
        var cat = catByKey(d.cat);
        state.anonAllowed = !!d.anon;
        document.title = d.topic.title + ' | Catholicity Board';
        crumb([['Catholicity Board', 'community.html'], [cat[1], 'community.html?cat=' + d.cat], [d.topic.title]]);
        section.appendChild(el('h2', 'board-topic-head', d.topic.title));
        var list = el('div', 'comments-list');
        section.appendChild(list);
        list.appendChild(commentNode(d.topic, false));
        d.replies.forEach(function (c) { list.appendChild(commentNode(c, false)); });
        section.appendChild(el('p', 'comments-status', ''));
        buildBoardForm(false, 'Reply');
        boardButtons('Reply', function () {
          var body = section.querySelector('.comment-text').value.replace(/\s+$/, '');
          var status = section.querySelector('.form-status');
          if (!body.trim()) { section.querySelector('.comment-text').focus(); return; }
          boardPost({ topic: id, body: body }, function (d2) {
            list.appendChild(commentNode(d2.comment, d2.status === 'pending'));
            section.querySelector('.comment-text').value = '';
            status.textContent = d2.status === 'pending'
              ? 'Held for review. It will appear once approved.' : 'Posted.';
          });
        });
        armBoardForm();
        if (/^#comment-\d+$/.test(location.hash)) {
          var target = document.getElementById(location.hash.slice(1));
          if (target) target.scrollIntoView();
        }
        annotateMeta('board:' + d.cat);
      })
      .catch(function (err) {
        crumb([['Catholicity Board', 'community.html'], ['Topic']]);
        section.appendChild(el('p', 'comments-status',
          err.message === 'No such topic.' ? 'No such topic. It may have been removed.'
            : 'The topic could not be loaded. Check your connection and reload the page.'));
      });
  }

  /* The audit: one line per commented page and per board topic, the last
     poster and the moment, pending marked. A quick answer to what is new. */
  function viewAudit() {
    document.title = 'Activity audit | Catholicity Board';
    crumb([['Catholicity Board', 'community.html'], ['Activity audit']]);
    if (!isAdmin()) {
      section.appendChild(el('p', 'comments-status', 'This page is for the admins.'));
      return;
    }
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
        function row(label, r) {
          var line = el('div', 'board-topic');
          line.appendChild(el('span', 'audit-where', label));
          line.appendChild(el('div', 'board-stats',
            (r.author_hash ? displayName(r.author_hash) : 'Anonymous') +
            ' · ' + fmtDateTime(r.created_at) +
            (r.status === 'pending' ? ' · pending' : '')));
          return line;
        }
        section.appendChild(el('h3', 'board-form-head', 'Site pages'));
        var pages = el('div', 'board-topics');
        if (!d.pages.length) pages.appendChild(el('p', 'comments-status', 'No comments anywhere yet.'));
        d.pages.forEach(function (r) { pages.appendChild(row(r.page, r)); });
        section.appendChild(pages);
        section.appendChild(el('h3', 'board-form-head', 'Board topics'));
        var topics = el('div', 'board-topics');
        if (!d.topics.length) topics.appendChild(el('p', 'comments-status', 'No topics yet.'));
        d.topics.forEach(function (r) {
          var cat = catByKey(String(r.page).slice(6));
          topics.appendChild(row((cat ? cat[1] : r.page) + ' › ' + r.title, r));
        });
        section.appendChild(topics);
      })
      .catch(function (err) {
        status.textContent = err.message === 'No.' ? 'This page is for the admins.'
          : 'The audit could not be loaded. Check your connection and reload the page.';
      });
  }

  function startBoard() {
    section.setAttribute('data-nosnippet', '');
    /* Resolve the identity before any view renders, or a keyed visitor
       reads as anonymous and the owner's own links never appear. */
    var ready = state.key ? sha256hex(state.key) : Promise.resolve('');
    ready.then(function (h) {
      state.myHash = h;
      var params = new URLSearchParams(location.search);
      if (params.get('audit')) return viewAudit();
      var topic = Number(params.get('topic'));
      if (Number.isInteger(topic) && topic > 0) return viewTopic(topic);
      if (params.get('cat')) return viewCat(params.get('cat'));
      viewIndex();
    });
  }

  /* ---- Assembly ---- */

  function start() {
    if (state.started) return;
    state.started = true;

    /* Tell search engines this block is visitor content: keep it out of
       snippets, and never let it read as the site's own words. */
    section.setAttribute('data-nosnippet', '');

    var feedUrl = API + '/feed?page=' + encodeURIComponent(pagePath());
    var discover = document.createElement('link');
    discover.rel = 'alternate';
    discover.type = 'application/rss+xml';
    discover.title = 'Comments feed';
    discover.href = feedUrl;
    document.head.appendChild(discover);

    var title = el('h2', 'comments-title');
    title.appendChild(el('span', 'comments-title-text', 'Comments'));
    var rss = el('a', 'comments-rss', 'RSS');
    rss.href = feedUrl;
    rss.title = 'Follow these comments with a feed reader';
    title.appendChild(rss);
    section.appendChild(title);
    section.appendChild(el('div', 'comments-list'));
    section.appendChild(el('p', 'comments-status', 'Loading comments...'));

    var form = el('div', 'comment-form');
    form.appendChild(el('div', 'comment-identity'));
    var keyBox = el('div', 'key-box');
    keyBox.hidden = true;
    form.appendChild(keyBox);
    var textarea = el('textarea', 'comment-text');
    textarea.maxLength = 4000;
    textarea.rows = 5;
    textarea.placeholder = 'Say what you want to say.';
    form.appendChild(textarea);
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
    section.appendChild(form);

    var ready = state.key ? sha256hex(state.key) : Promise.resolve('');
    ready.then(function (h) {
      state.myHash = h;
      renderIdentity();
      renderButtons();
      load();
    });

    /* Re-render the buttons whenever identity changes. Cheapest hook: watch
       the identity box for the re-renders triggered above. */
    new MutationObserver(function () { renderButtons(); })
      .observe(form.querySelector('.comment-identity'), { childList: true });

    loadTurnstile();
  }

  if (BOARD) {
    startBoard();
  } else if (/^#comment-\d+$/.test(location.hash)) {
    start();
  } else if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) { io.disconnect(); start(); }
      });
    }, { rootMargin: '400px' });
    io.observe(section);
  } else {
    start();
  }
})();
