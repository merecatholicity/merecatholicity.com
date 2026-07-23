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

  function fmtDate(epoch) {
    return new Date(epoch * 1000).toLocaleDateString('en-US',
      { year: 'numeric', month: 'long', day: 'numeric' });
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

  var section = document.querySelector('section[data-comments]');
  if (!section) return;

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
    document.head.appendChild(script);
  }

  function getToken() {
    return new Promise(function (resolve, reject) {
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
    if (state.myHash && (c.author_hash === state.myHash || ADMIN_HASHES.indexOf(state.myHash) !== -1)) {
      var del = el('a', 'comment-delete', 'delete');
      del.href = '#';
      del.addEventListener('click', function (e) {
        e.preventDefault();
        if (!confirm('Delete this comment?')) return;
        fetch(API + '/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: c.id, key: state.key }),
        }).then(function (r) { return r.json(); }).then(function (d) {
          if (d.ok) article.remove();
        }).catch(function () {});
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

  function load() {
    var list = section.querySelector('.comments-list');
    /* The comment list is browser-cached for 60s. To someone who just
       posted, that cache makes their own comment vanish on reload, so
       recent posters bypass it until the cache would be fresh again. */
    var posted = 0;
    try { posted = Number(localStorage.getItem('mc-posted-at')) || 0; } catch (e) {}
    var opts = (Date.now() - posted < 90000) ? { cache: 'no-store' } : undefined;
    fetch(API + '?page=' + encodeURIComponent(pagePath()), opts)
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
        setStatus('Comments could not be loaded right now.');
      });
  }

  /* Admin only. Fetches the logged IP, OS, and agent for each comment and
     writes them under the comments. The server refuses non-admin keys, so
     for everyone else this function returns without a trace. */
  function annotateMeta() {
    if (!state.key || ADMIN_HASHES.indexOf(state.myHash) === -1) return;
    fetch(API + '/meta', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ page: pagePath(), key: state.key }),
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (!d.ok) return;
      d.meta.forEach(function (m) {
        var node = document.getElementById('comment-' + m.id);
        if (!node || node.querySelector('.comment-meta')) return;
        var details = el('details', 'comment-meta');
        details.appendChild(el('summary', null, 'user-fingerprint'));
        details.appendChild(el('div', null,
          (m.ip || 'ip?') + (m.os ? ' · ' + m.os : '') + (m.tz ? ' · ' + m.tz : '') +
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
        hideKeyBox();
        renderIdentity();
        load();
      }));
    } else {
      line.appendChild(document.createTextNode(state.anonAllowed
        ? 'Commenting anonymously. '
        : 'To comment, create an identity. One click, no signup. '));
      line.appendChild(identityAction('Create an identity', function () {
        var key = makeKey();
        setKey(key);
        state.key = key;
        sha256hex(key).then(function (h) {
          state.myHash = h;
          renderIdentity();
          showKeyBox();
        });
      }));
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
      return fetch(API, {
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
      }).then(function (r) { return r.json(); });
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

  if (/^#comment-\d+$/.test(location.hash)) {
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
