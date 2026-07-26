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
  /* The faith declaration a member picks at signup and may change in their
     profile. Codes are stored; these are the words shown. Kept identical to
     the FAITHS list in comments-worker/src/index.js. */
  var FAITH = { nicene: 'Nicene', 'indo-european': 'pre-Christian Indo European', seeker: 'Seeker' };
  var FAITH_ORDER = ['nicene', 'indo-european', 'seeker'];
  var FAITH_STORE = 'mc-faith';
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

  /* Inline markup, parsed left-to-right in one pass and built ONLY from
     createElement + text nodes (never innerHTML), so nothing a user writes can
     inject markup. Precedence: **bold**, then *italic*, then a link written
     [text](url) or as a bare URL. Only http(s) URLs are ever linkified, so
     javascript: and data: (and any stray marker) stay inert text; a same-site
     link goes straight through, an off-site one is routed via the away.html
     warning page (see appendRich). No images, ever. */
  var INLINE_MD = /\*\*([^\n]+?)\*\*|\*(\S[^*\n]*?)\*|\[([^\]\n]+)\]\((https?:\/\/[^\s<>"')]+)\)|https?:\/\/[^\s<>"']+/gi;

  /* Append rich inline text to a node: the marked spans above become <strong>,
     <em>, and same-site <a> nodes, everything else plain text. Emphasis nests
     (a link inside bold works) by recursing on the strictly-shorter inner text.
     Shared by the body renderer and each quoted/list line. */
  function appendRich(target, str) {
    var s = String(str == null ? '' : str);
    /* A fresh matcher per call: appendRich recurses into emphasis, and a single
       shared global regex's lastIndex would be clobbered by the inner call. */
    var re = new RegExp(INLINE_MD.source, 'gi');
    var last = 0, m;
    while ((m = re.exec(s))) {
      if (m[0].length === 0) { re.lastIndex++; continue; }
      if (m.index > last) target.appendChild(document.createTextNode(s.slice(last, m.index)));
      if (m[1] !== undefined) {
        var strong = el('strong');
        appendRich(strong, m[1]);
        target.appendChild(strong);
      } else if (m[2] !== undefined) {
        var em = el('em');
        appendRich(em, m[2]);
        target.appendChild(em);
      } else {
        var url = m[3] !== undefined ? m[4] : m[0];
        var a = el('a', 'body-link', m[3] !== undefined ? m[3] : m[0]);
        if (/^https?:\/\/(?:www\.)?merecatholicity\.com(?:[\/?#]|$)/i.test(url)) {
          a.href = url;
        } else {
          /* Off-site: link to our own warning page, which names the destination
             and requires a click. rel keeps referrer/opener from leaking and
             tells crawlers we gate outbound clicks. */
          a.href = 'away.html?url=' + encodeURIComponent(url);
          a.rel = 'nofollow ugc noopener';
        }
        target.appendChild(a);
      }
      last = m.index + m[0].length;
    }
    if (last < s.length) target.appendChild(document.createTextNode(s.slice(last)));
  }

  /* Render a body as text (trusted links clickable), with runs of lines that
     begin with ">" drawn as a blockquote — the quoting convention the Quote
     button writes and anyone may type by hand. Built entirely from text nodes
     and anchors, never innerHTML, so a body can never inject markup. Use this
     in place of a plain textContent wherever a user body is shown. */
  function fillBody(node, text) {
    node.textContent = '';
    var lines = String(text == null ? '' : text).split('\n');
    var i = 0;
    while (i < lines.length) {
      if (/^>/.test(lines[i])) {
        var quoted = [];
        while (i < lines.length && /^>/.test(lines[i])) {
          quoted.push(lines[i].replace(/^>\s?/, ''));
          i++;
        }
        var bq = el('blockquote', 'comment-quote');
        appendRich(bq, quoted.join('\n'));
        node.appendChild(bq);
      } else if (/^[-*] /.test(lines[i])) {
        var ul = el('ul', 'comment-list');
        while (i < lines.length && /^[-*] /.test(lines[i])) {
          var li = el('li');
          appendRich(li, lines[i].replace(/^[-*] +/, ''));
          ul.appendChild(li);
          i++;
        }
        node.appendChild(ul);
      } else {
        var plain = [];
        while (i < lines.length && !/^>/.test(lines[i]) && !/^[-*] /.test(lines[i])) {
          plain.push(lines[i]);
          i++;
        }
        appendRich(node, plain.join('\n'));
      }
    }
    return node;
  }

  function profileHref(hash) {
    return 'community.html?profile=' + hash;
  }

  /* An author's visible name: the custom nick when set, the assigned pseudonym
     otherwise, always a link to the profile. Anonymous authors have no profile
     and stay plain text. With a nick set, the assigned name rides along as a
     muted, equally-clickable line (withSub), so the authoritative identifier
     is never lost. Text goes through el()/textContent, never innerHTML. */
  function authorNode(hash, nick, withSub, faith) {
    if (!hash) return el('span', 'comment-author', 'Anonymous');
    var wrap = el('span', 'comment-author');
    var primary = el('a', 'comment-author-link', nick || displayName(hash));
    primary.href = profileHref(hash);
    wrap.appendChild(primary);
    if (withSub && nick) {
      var sub = el('a', 'comment-author-sub', displayName(hash));
      sub.href = profileHref(hash);
      wrap.appendChild(sub);
    }
    /* The faith declaration sits under the name on every post. */
    if (faith && FAITH[faith]) wrap.appendChild(el('span', 'comment-faith', FAITH[faith]));
    return wrap;
  }

  /* The member's declared faith lives in localStorage from signup and rides
     along with each post; the profile edit is the authoritative changer. */
  function getFaith() {
    try { var v = localStorage.getItem(FAITH_STORE); return FAITH[v] ? v : ''; } catch (e) { return ''; }
  }
  function setFaith(code) {
    try { if (FAITH[code]) localStorage.setItem(FAITH_STORE, code); } catch (e) {}
  }

  /* Mute is self-moderation for a pseudonymous room: a purely local list of
     hashes whose posts collapse for you alone. No server, orthogonal to the DM
     block (which holds their messages to you) — this only hides their forum
     posts, on this browser. */
  var MUTED_STORE = 'mc-muted';
  function getMuted() {
    try { var a = JSON.parse(localStorage.getItem(MUTED_STORE)); return Array.isArray(a) ? a : []; } catch (e) { return []; }
  }
  function isMuted(hash) { return !!hash && getMuted().indexOf(hash) !== -1; }
  function toggleMute(hash) {
    if (!hash) return false;
    var a = getMuted(), i = a.indexOf(hash);
    if (i === -1) a.push(hash); else a.splice(i, 1);
    try { localStorage.setItem(MUTED_STORE, JSON.stringify(a)); } catch (e) {}
    return i === -1;
  }
  /* The "I hold to:" radio group, one row per faith, used at signup and in the
     profile editor. onChange fires with the chosen code. */
  function faithRadios(current, onChange) {
    var wrap = el('div', 'faith-radios');
    wrap.appendChild(el('div', 'faith-legend', 'I hold to:'));
    FAITH_ORDER.forEach(function (code) {
      var lab = el('label', 'faith-option');
      var r = el('input');
      r.type = 'radio';
      r.name = 'mc-faith-choice';
      r.value = code;
      if (code === current) r.checked = true;
      r.addEventListener('change', function () { if (r.checked && onChange) onChange(code); });
      lab.appendChild(r);
      lab.appendChild(document.createTextNode(' ' + FAITH[code]));
      wrap.appendChild(lab);
    });
    return wrap;
  }

  function browserTz() {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { return ''; }
  }

  /* A dual-stack browser reaches us on only one address family, so the other
     stays invisible to the server. So we ask two single-family echoes (run by
     Cloudflare, CORS-open) what address each family sees and send them along,
     so a ban can later close both doors. Best-effort and time-boxed: if an echo
     is slow or down we simply lack that family and the post proceeds anyway. */
  function collectAltIps() {
    ['ipv4', 'ipv6'].forEach(function (fam) {
      var ctl = ('AbortController' in window) ? new AbortController() : null;
      var timer = ctl ? setTimeout(function () { ctl.abort(); }, 2000) : null;
      fetch('https://' + fam + '.icanhazip.com', ctl ? { signal: ctl.signal } : {})
        .then(function (r) { return r.ok ? r.text() : ''; })
        .then(function (txt) {
          var ip = String(txt || '').trim();
          if (ip && ip.length <= 45 && /^[0-9a-fA-F:.]+$/.test(ip)) state.altIps[fam] = ip;
        })
        .catch(function () {})
        .finally(function () { if (timer) clearTimeout(timer); });
    });
  }

  /* Carrier-grade NAT (100.64.0.0/10) is shared by many customers, so the
     drawer warns before an admin bans such a v4. */
  function isSharedV4Client(ip) {
    var m = /^(\d{1,3})\.(\d{1,3})\./.exec(ip || '');
    return !!m && +m[1] === 100 && +m[2] >= 64 && +m[2] <= 127;
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

  /* Timestamps are stored as UTC epochs; toLocaleString renders them in each
     reader's own timezone, date and time together. */
  function fmtDateTime(epoch) {
    return new Date(epoch * 1000).toLocaleString('en-US',
      { year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });
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
    ['pub', 'Pub', 'General discussion, for whatever fits nowhere more specific. New here? ', 'Introduce yourself and say hello', 'community.html?topic=37'],
    ['news', 'News', 'News of the Church and of the world.'],
    ['offtopic', 'Off Topic', 'Everything else, cheerfully off the point.'],
    ['theology', 'Theology', 'All genres. Systematic and Dogmatic, Biblical and Exegetical, Historical and Patristic, Philosophical and Natural, etc.'],
    ['philosophy', 'Philosophy', 'From Plato and Aristotle to Kant and Wittgenstein.'],
    ['history', 'History', 'World, church, and national history. All of it.'],
    ['indoeuropean', 'Indo-European Religion', 'Healendry, Germanic and Norse Christianity, pre-Christian Indo-European religion, Japhetic origins, and more.'],
    ['rc', 'Roman Catholic', 'In-house talk for Roman Catholics.'],
    ['eo', 'Eastern Orthodoxy', 'In-house talk for the Eastern Orthodox.'],
    ['lutheran', 'Confessional Lutheran', 'In-house talk for confessional Lutherans.'],
    ['anglican', 'High Anglican', 'In-house talk for high Anglicans.'],
    ['presbyterian', 'Reformed Presbyterian', 'In-house talk for Reformed Presbyterians. Reformed Congregationalists and Reformed Baptists are welcome to coexist here too.'],
    ['prot', 'Protestantism', 'For everyone the rooms above do not quite fit, e.g. ', 'the free churches', 'free-churches.html'],
  ];

  /* A description with an optional trailing link, built as nodes so the
     link is real and everything else stays inert text. */
  function catDescNode(tag, cat) {
    var node = el(tag, 'board-cat-desc', cat[2]);
    if (cat[3]) {
      var a = el('a', null, cat[3]);
      a.href = cat[4];
      node.appendChild(a);
      node.appendChild(document.createTextNode('.'));
    }
    return node;
  }
  function catByKey(key) {
    for (var i = 0; i < CATS.length; i++) if (CATS[i][0] === key) return CATS[i];
    return null;
  }

  var state = {
    key: getKey(),
    myHash: '',
    myNick: '',
    started: false,
    widgetId: null,
    tokenWait: null,
    anonAllowed: false,
    altIps: { ipv4: '', ipv6: '' },
  };

  /* Reverse-DNS results, cached per address across drawers so a fingerprint
     opened twice never looks the same IP up twice. */
  var rdnsCache = {};

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

  /* The reader's current selection, kept only when it lies inside this post's
     body — read on mousedown, before the Quote click can collapse it. Empty
     when there is no in-post selection, so quoteInto falls back to the whole
     post. */
  var quotedSelection = '';
  function selectionInPost(c) {
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
  function truncate(s, n) {
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
  function permalinkFor(c, ctx) {
    var origin = 'https://merecatholicity.com';
    if (ctx && ctx.topicId) {
      return origin + '/community.html?topic=' + ctx.topicId + '#comment-' + c.id;
    }
    return origin + ((ctx && ctx.page) || pagePath()) + '#comment-' + c.id;
  }

  /* Drop a quote of post c into the reply composer: an attribution line with
     the permalink, then the excerpt, every line ">"-prefixed so it renders as
     one blockquote. Quotes append, so several can stack for a point-by-point
     reply, and never push the body past its 4000-char cap. */
  function quoteInto(c, excerpt, url) {
    var ta = section.querySelector('.comment-form .comment-text');
    if (!ta) return;
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
    ta.focus();
    ta.scrollIntoView({ block: 'center' });
  }

  /* ---- Markdown compose toolbar. The box stays a single plain-text textarea
     holding the markdown source; these buttons only edit that source at the
     caret or around the selection, and fillBody renders it on show. ---- */

  function afterEdit(ta) {
    ta.focus();
    try { ta.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {}
  }

  /* Wrap the selection, or, with nothing selected, drop the markers and put the
     caret between them: WORD -> **WORD**, and | -> **|**. */
  function wrapSel(ta, before, after) {
    var s = ta.value, a = ta.selectionStart, b = ta.selectionEnd, sel = s.slice(a, b);
    if (sel) {
      ta.value = s.slice(0, a) + before + sel + after + s.slice(b);
      try { ta.setSelectionRange(a + before.length, a + before.length + sel.length); } catch (e) {}
    } else {
      ta.value = s.slice(0, a) + before + after + s.slice(a);
      var caret = a + before.length;
      try { ta.setSelectionRange(caret, caret); } catch (e) {}
    }
    afterEdit(ta);
  }

  /* Prefix every line the selection touches (or the caret's own line). */
  function linePrefix(ta, prefix) {
    var s = ta.value, a = ta.selectionStart, b = ta.selectionEnd;
    var start = s.lastIndexOf('\n', a - 1) + 1;
    var end = s.indexOf('\n', b); if (end === -1) end = s.length;
    var block = s.slice(start, end).split('\n').map(function (ln) { return prefix + ln; }).join('\n');
    ta.value = s.slice(0, start) + block + s.slice(end);
    try { ta.setSelectionRange(start, start + block.length); } catch (e) {}
    afterEdit(ta);
  }

  /* Insert a same-site link template, caret landing in the URL to complete. */
  function insertLink(ta) {
    var s = ta.value, a = ta.selectionStart, b = ta.selectionEnd, sel = s.slice(a, b) || 'text';
    var url = 'https://merecatholicity.com/';
    ta.value = s.slice(0, a) + '[' + sel + '](' + url + ')' + s.slice(b);
    var urlStart = a + sel.length + 3;
    try { ta.setSelectionRange(urlStart, urlStart + url.length); } catch (e) {}
    afterEdit(ta);
  }

  function mdButton(label, title, cls, handler) {
    var btn = el('button', 'md-btn' + (cls ? ' ' + cls : ''), label);
    btn.type = 'button';
    btn.title = title;
    btn.addEventListener('click', function (e) { e.preventDefault(); handler(); });
    return btn;
  }

  /* Wrap a compose textarea with a button row above and a syntax legend below,
     returning the wrapper to mount where the textarea would have gone. The
     textarea itself is unchanged, so .comment-text lookups still resolve. */
  function mdEditor(textarea) {
    var wrap = el('div', 'md-editor');
    var bar = el('div', 'md-toolbar');
    bar.appendChild(mdButton('B', 'Bold  **text**', 'md-b', function () { wrapSel(textarea, '**', '**'); }));
    bar.appendChild(mdButton('I', 'Italic  *text*', 'md-i', function () { wrapSel(textarea, '*', '*'); }));
    bar.appendChild(mdButton('” Quote', 'Blockquote  > line', null, function () { linePrefix(textarea, '> '); }));
    bar.appendChild(mdButton('• List', 'Bulleted list  - item', null, function () { linePrefix(textarea, '- '); }));
    bar.appendChild(mdButton('Link', 'Link  [text](url) — merecatholicity.com only', null, function () { insertLink(textarea); }));
    wrap.appendChild(bar);
    wrap.appendChild(textarea);
    wrap.appendChild(el('p', 'md-legend',
      'Markdown: **bold** · *italic* · > quote · - list · [text](merecatholicity.com/…)'));
    return wrap;
  }

  function commentNode(c, pending, quoteCtx, reveal) {
    /* A muted member's post shows only a slim line until you choose to see it. */
    if (!reveal && c.author_hash && c.author_hash !== state.myHash && isMuted(c.author_hash)) {
      var ph = el('div', 'board-intro comment-muted');
      ph.id = 'comment-' + c.id;
      ph.appendChild(document.createTextNode('A muted member posted here. '));
      var show = el('a', 'comment-quote-link', 'show');
      show.href = '#';
      show.addEventListener('click', function (e) {
        e.preventDefault();
        var full = commentNode(c, pending, quoteCtx, true);
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
      var avLink = el('a', 'comment-avatar-link');
      avLink.href = profileHref(c.author_hash);
      var av = el('img', 'comment-avatar');
      av.src = API + '/avatar?hash=' + c.author_hash + '&v=' + encodeURIComponent(c.avatar);
      av.alt = '';
      av.width = 32;
      av.height = 32;
      avLink.appendChild(av);
      head.appendChild(avLink);
    }
    var author = authorNode(c.author_hash, c.nick, true, c.faith);
    author.setAttribute('itemprop', 'author');
    head.appendChild(author);
    /* The house speaks under its own colors. */
    if (c.author_hash && ADMIN_HASHES.indexOf(c.author_hash) !== -1) {
      head.appendChild(el('span', 'comment-admin', '(admin)'));
    }
    /* A door to a private word with the author, for keyed readers only. */
    if (c.author_hash && state.myHash && c.author_hash !== state.myHash) {
      var dm = el('a', 'comment-dm', 'Direct Message');
      dm.href = 'community.html?dm=' + c.author_hash;
      dm.title = 'Send a direct message';
      head.appendChild(dm);
      /* Mute this member's posts for yourself. Reloading re-renders the view so
         the mute takes at once, everywhere they appear. */
      var muteLink = el('a', 'comment-quote-link', isMuted(c.author_hash) ? 'unmute' : 'mute');
      muteLink.href = '#';
      muteLink.title = 'Hide this member’s posts, for you only';
      muteLink.addEventListener('click', function (e) {
        e.preventDefault();
        toggleMute(c.author_hash);
        location.reload();
      });
      head.appendChild(muteLink);
    }
    /* The date doubles as the comment's shareable permalink. */
    var date = el('a', 'comment-date', fmtDateTime(c.created_at));
    date.href = '#comment-' + c.id;
    head.appendChild(date);
    /* Anyone may quote any post into the reply box, so unlike edit/delete this
       is ungated. The selection is grabbed on mousedown, before the click can
       clear it; with none, the whole post (trimmed) is quoted. */
    var quote = el('a', 'comment-quote-link', 'quote');
    quote.href = '#';
    quote.addEventListener('mousedown', function () { quotedSelection = selectionInPost(c); });
    quote.addEventListener('click', function (e) {
      e.preventDefault();
      var excerpt = quotedSelection || truncate(c.body, 400);
      quotedSelection = '';
      quoteInto(c, excerpt, permalinkFor(c, quoteCtx));
    });
    head.appendChild(quote);
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
    var body = fillBody(el('div', 'comment-body'), c.body);
    body.setAttribute('itemprop', 'text');
    article.appendChild(body);
    if (c.signature) article.appendChild(fillBody(el('div', 'comment-sig'), c.signature));
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
    editor.appendChild(mdEditor(ta));
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

  /* Keyed visitors ask the server for the short-cache profile and keep
     today's behavior to the letter. Anonymous readers ride a five-minute
     browser cache, their repeat views never reaching the worker. */
  function freshParam(sep) {
    return state.key ? sep + 'fresh=1' : '';
  }

  function load() {
    var list = section.querySelector('.comments-list');
    fetchRetry(API + '?page=' + encodeURIComponent(pagePath()) + freshParam('&'), freshOpts(), [1000, 3000],
      function () { setStatus('Network hiccup, retrying...'); })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok) throw new Error(d.error || 'failed');
        state.anonAllowed = !!d.anon;
        renderIdentity();
        list.textContent = '';
        d.comments.forEach(function (c) { list.appendChild(commentNode(c, false, { page: pagePath() })); });
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
  /* Build the admin user-fingerprint drawer from one meta row and the
     identity->IPs map. Identical whether it hangs under a comment or on a
     profile, so both surfaces carry the very same controls. */
  function buildFingerprint(m, identities) {
    var details = el('details', 'comment-meta');
    details.appendChild(el('summary', null, 'user-fingerprint'));
    details.appendChild(el('div', null,
      (m.ip ? (m.ip.indexOf(':') !== -1 ? 'IPv6 ' : 'IPv4 ') + m.ip : 'ip?') +
      (m.os ? ' · ' + m.os : '') + (m.tz ? ' · ' + m.tz : '') +
      (m.lang ? ' · ' + m.lang : '')));
    if (m.ua) details.appendChild(el('div', null, m.ua));
    /* Trusted authors skip the AI screen. The line states the standing fact
       and offers the reversal, and flipping it updates every fingerprint of
       the same author on the page. The author never sees any of this. */
    if (m.author_hash) {
      var line = el('div', 'trust-line');
      line.setAttribute('data-hash', m.author_hash);
      renderTrustLine(line, m.author_hash, !!m.trusted);
      details.appendChild(line);
      details.appendChild(modLockLine(m.author_hash, !!m.locked));
      var ips = (identities && identities[m.author_hash]) || [];
      if (!ips.length && m.ip) ips = [{ ip_display: m.ip, ip_key: m.ip,
        family: m.ip.indexOf(':') !== -1 ? 6 : 4, source: 'seen', banned: !!m.ipbanned }];
      details.appendChild(modIpBlock(ips));
      wireRdns(details, ips);
      details.appendChild(modDeleteUserLine(m.author_hash));
      details.appendChild(modHelpNote());
    }
    return details;
  }

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
        node.appendChild(buildFingerprint(m, d.identities));
      });
    }).catch(function () {});
  }

  /* The same drawer on a profile, keyed by the identity's hash rather than a
     comment id, so an admin viewing anyone's profile gets every control the
     post drawer has: trust, lock, per-IP ban and ban-all, delete. Admin-only,
     here and at the server. */
  function annotateProfileMeta(hash, card) {
    if (!state.key || ADMIN_HASHES.indexOf(state.myHash) === -1) return;
    if (card.querySelector('.comment-meta')) return;
    fetch(API + '/meta', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hash: hash, key: state.key }),
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (!d.ok || !d.meta || !d.meta.length || card.querySelector('.comment-meta')) return;
      card.appendChild(buildFingerprint(d.meta[0], d.identities));
    }).catch(function () {});
  }

  function renderTrustLine(line, hash, trusted) {
    line.textContent = '';
    line.appendChild(document.createTextNode(trusted
      ? 'Trusted. Posts skip the AI spam screen. '
      : 'Untrusted. Posts are AI-screened for spam. '));
    var a = el('a', 'trust-toggle', trusted ? '(toggle-untrusted)' : '(toggle-trusted)');
    a.href = '#';
    a.addEventListener('click', function (e) {
      e.preventDefault();
      fetch(API + '/trust', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: state.key, hash: hash, trusted: !trusted }),
      }).then(function (r) { return r.json(); }).then(function (d) {
        if (!d.ok) return;
        section.querySelectorAll('.trust-line[data-hash="' + hash + '"]')
          .forEach(function (l) { renderTrustLine(l, hash, d.trusted); });
      }).catch(function () {});
    });
    line.appendChild(a);
  }

  /* Admin moderation controls, all inside the user-fingerprint dropdown and
     each guarded by a plain confirm() that reads the same on phone or desktop.
     A reload after each so the page returns true. */

  function modLockLine(hash, locked) {
    var line = el('div', 'trust-line');
    line.appendChild(document.createTextNode(locked ? 'Locked. ' : 'Unlocked. '));
    var a = el('a', 'trust-toggle', locked ? '(toggle-unlocked)' : '(toggle-locked)');
    a.href = '#';
    a.addEventListener('click', function (e) {
      e.preventDefault();
      if (!locked && !confirm('Lock this identity? They will be logged out and unable to interact until you unlock them.')) return;
      fetch(API + '/lock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: state.key, hash: hash, locked: !locked }),
      }).then(function (r) { return r.json(); }).then(function (d) {
        if (d.ok) location.reload();
      }).catch(function () {});
    });
    line.appendChild(a);
    return line;
  }

  /* The IP block in a fingerprint: every address known for this identity, each
     bannable on its own, and a ban-all that shuts both families of a dual-stack
     user in one act. A v4 that looks like carrier-grade NAT is flagged, since it
     may be shared by many people. */
  function modIpBlock(rows) {
    var wrap = el('div', 'ip-block');
    if (!rows.length) {
      wrap.appendChild(el('div', 'trust-line', 'No IP on record.'));
      return wrap;
    }
    if (rows.length > 1) {
      var allBanned = rows.every(function (r) { return r.banned; });
      var head = el('div', 'trust-line');
      head.appendChild(document.createTextNode('Known IPs (' + rows.length + '). '));
      var all = el('a', 'trust-toggle', allBanned ? '(unban all)' : '(ban all IPs)');
      all.href = '#';
      all.addEventListener('click', function (e) {
        e.preventDefault();
        if (!allBanned && !confirm(banAllPrompt(rows))) return;
        ipbanRequest(rows.map(function (r) { return r.ip_key; }), !allBanned);
      });
      head.appendChild(all);
      wrap.appendChild(head);
    }
    rows.forEach(function (r) { wrap.appendChild(ipRow(r)); });
    return wrap;
  }

  function ipRow(r) {
    var line = el('div', 'trust-line');
    line.appendChild(document.createTextNode((r.banned ? 'Banned. ' : 'Not banned. ') +
      (r.family === 6 ? 'IPv6 ' : 'IPv4 ') + r.ip_display +
      (r.source === 'claimed' ? ' · claimed' : '') + ' '));
    var rd = el('span', 'ip-rdns');
    rd.setAttribute('data-ip', r.ip_display);
    if (rdnsCache[r.ip_display]) rd.textContent = rdnsCache[r.ip_display] + ' ';
    line.appendChild(rd);
    var a = el('a', 'trust-toggle', r.banned ? '(unban)' : '(ban)');
    a.href = '#';
    a.addEventListener('click', function (e) {
      e.preventDefault();
      if (!r.banned && !confirm('Ban ' + r.ip_display + '?' +
        (isSharedV4Client(r.ip_display) ? ' This looks like carrier-grade NAT, shared by many users; banning it may block innocents.' : '') +
        '\n\nLogged-in users from it will be blocked and sent to the terms page.')) return;
      ipbanRequest([r.ip_key], !r.banned);
    });
    line.appendChild(a);
    return line;
  }

  function banAllPrompt(rows) {
    var shared = rows.filter(function (r) { return isSharedV4Client(r.ip_display); });
    return 'Ban all ' + rows.length + ' IPs for this identity?\n\n' +
      rows.map(function (r) { return (r.family === 6 ? 'IPv6 ' : 'IPv4 ') + r.ip_display; }).join('\n') +
      (shared.length ? '\n\nWARNING: ' + shared.map(function (r) { return r.ip_display; }).join(', ') +
        ' looks like carrier-grade NAT (shared by many users); banning may block innocents.' : '') +
      '\n\nLogged-in users from any of them will be blocked and sent to the terms page.';
  }

  function ipbanRequest(keys, banned) {
    fetch(API + '/ipban', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: state.key, ips: keys, banned: banned }),
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (d.ok) location.reload();
    }).catch(function () {});
  }

  /* Reverse-DNS the identity's addresses the first time its drawer opens, then
     fill every matching row. Admin-only and lazy, so the bulk fingerprint fetch
     and the poster's own path never pay for it. */
  function wireRdns(details, rows) {
    if (!rows.length) return;
    details.addEventListener('toggle', function () {
      if (!details.open || details.__rdnsDone) return;
      details.__rdnsDone = true;
      var want = rows.map(function (r) { return r.ip_display; })
        .filter(function (ip) { return !(ip in rdnsCache); });
      if (!want.length) return fillRdns(details);
      fetch(API + '/rdns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: state.key, ips: want }),
      }).then(function (r) { return r.json(); }).then(function (d) {
        if (d.ok && d.rdns) Object.keys(d.rdns).forEach(function (ip) { rdnsCache[ip] = d.rdns[ip] || ''; });
        fillRdns(details);
      }).catch(function () {});
    });
  }

  function fillRdns(details) {
    details.querySelectorAll('.ip-rdns').forEach(function (span) {
      var host = rdnsCache[span.getAttribute('data-ip')];
      if (host) span.textContent = host + ' ';
    });
  }

  function modHelpNote() {
    return el('p', 'mod-help',
      'Handling a troublesome user: an identity is only a key in a browser, so a locked or deleted one can be remade in a click. To actually keep someone out, ban the IP first, while it still shows above, then lock or delete the identity. IP bans reach signed-in users only, never anonymous cached reading, and a determined person can switch networks. Lean on bans sparingly, and reserve deletion for the worst.');
  }

  function modDeleteUserLine(hash) {
    var line = el('div', 'trust-line');
    var a = el('a', 'trust-toggle danger', 'Delete user and all posts');
    a.href = '#';
    a.addEventListener('click', function (e) {
      e.preventDefault();
      if (!confirm('DELETE THIS USER? This permanently deletes ALL of their posts, their profile, and their avatar, and locks the identity so they cannot post again. This cannot be undone. Continue?')) return;
      if (!confirm('Are you sure? There is no undo.')) return;
      fetch(API + '/deleteuser', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: state.key, hash: hash }),
      }).then(function (r) { return r.json(); }).then(function (d) {
        if (d.ok) location.reload();
      }).catch(function () {});
    });
    line.appendChild(a);
    return line;
  }

  /* ---- Unread badge. One localStorage-cached count, refreshed from the
     server at most every ninety seconds, so idle page turns cost nothing.
     Inbox and thread responses refresh the cache for free. ---- */

  var DM_CACHE = 'mc-dm-unread';

  function dmCacheGet() {
    try { return JSON.parse(localStorage.getItem(DM_CACHE)) || null; } catch (e) { return null; }
  }
  function dmCacheSet(n) {
    try { localStorage.setItem(DM_CACHE, JSON.stringify({ n: n, at: Date.now() })) } catch (e) {}
    renderIdentity();
  }

  function dmUnreadCheck() {
    if (!state.key) return;
    var c = dmCacheGet();
    if (c && Date.now() - c.at < 90000) return;
    /* Stamp first, so parallel page loads inside the window stay quiet. */
    try { localStorage.setItem(DM_CACHE, JSON.stringify({ n: c ? c.n : 0, at: Date.now() })) } catch (e) {}
    fetch(API + '/dm/unread', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: state.key }),
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (blockedOut(d)) return;
      if (d.ok) dmCacheSet(d.unread);
    }).catch(function () {});
  }

  /* The notification badge rides the same one-count, ninety-second-cached
     mechanism as the DM badge: a reply in a watched thread or an @mention. */
  var NOTIF_CACHE = 'mc-notif-unread';
  function notifCacheGet() {
    try { return JSON.parse(localStorage.getItem(NOTIF_CACHE)) || null; } catch (e) { return null; }
  }
  function notifCacheSet(n) {
    try { localStorage.setItem(NOTIF_CACHE, JSON.stringify({ n: n, at: Date.now() })) } catch (e) {}
    renderIdentity();
  }
  function notifUnreadCheck() {
    if (!state.key) return;
    var c = notifCacheGet();
    if (c && Date.now() - c.at < 90000) return;
    try { localStorage.setItem(NOTIF_CACHE, JSON.stringify({ n: c ? c.n : 0, at: Date.now() })) } catch (e) {}
    fetch(API + '/notifications/unread', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: state.key }),
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (blockedOut(d)) return;
      if (d.ok) notifCacheSet(d.unread);
    }).catch(function () {});
  }

  /* A locked identity or a banned network, discovered on any keyed call:
     forget the key, raise a message that outlives the redirect, and land on
     the terms page. This is what "logged out and cannot come back" looks like. */
  function blockedOut(d) {
    if (!d || !d.blocked) return false;
    try {
      localStorage.setItem('mc-flash', d.blocked === 'ipban'
        ? 'Your network is banned from merecatholicity.com for violating the terms and conditions.'
        : 'This identity has been locked by the moderators for violating the terms and conditions.');
    } catch (e) {}
    clearKey();
    state.key = '';
    state.myHash = '';
    try { localStorage.removeItem(DM_CACHE); } catch (e) {}
    try { localStorage.removeItem(NOTIF_CACHE); } catch (e) {}
    location.href = 'terms.html';
    return true;
  }

  /* ---- Identity UI ---- */

  function renderIdentity() {
    var box = section.querySelector('.comment-identity');
    if (!box) return;
    box.textContent = '';
    var line = el('p', 'identity-line');
    if (state.key && state.myHash) {
      /* First line: who you are, then the account actions. */
      line.appendChild(document.createTextNode('Logged in as '));
      line.appendChild(el('strong', null, state.myNick || displayName(state.myHash)));
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
      line.appendChild(el('br'));
      /* Second line: where to go, grouped — your activity (the two badge
         feeds), then people (you, then the roster), then search over it all. */
      var notifLink = el('a', 'identity-action', 'Notifications');
      notifLink.href = 'community.html?notifications=1';
      line.appendChild(notifLink);
      var nc = notifCacheGet();
      if (nc && nc.n > 0) line.appendChild(el('span', 'dm-unread', ' (' + nc.n + ')'));
      line.appendChild(document.createTextNode(' · '));
      var inboxLink = el('a', 'identity-action', 'Inbox');
      inboxLink.href = 'community.html?inbox=1';
      line.appendChild(inboxLink);
      var dmc = dmCacheGet();
      if (dmc && dmc.n > 0) line.appendChild(el('span', 'dm-unread', ' (' + dmc.n + ')'));
      line.appendChild(document.createTextNode(' · '));
      var viewProfileLink = el('a', 'identity-action', 'View My Profile');
      viewProfileLink.href = profileHref(state.myHash);
      line.appendChild(viewProfileLink);
      line.appendChild(document.createTextNode(' · '));
      var usersLink = el('a', 'identity-action', 'User List');
      usersLink.href = 'community.html?users=1';
      line.appendChild(usersLink);
      line.appendChild(document.createTextNode(' · '));
      var searchLink = el('a', 'identity-action', 'Search');
      searchLink.href = 'community.html?q=';
      line.appendChild(searchLink);
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
    box.appendChild(el('p', 'key-note',
      'Membership is open to North America, Europe, Russia, Israel, Korea, Japan, and Oceania. ' +
      'Elsewhere it is declined, for security, spam, relevance, and quality.'));
    /* A faith declaration is required to join: one of the three welcomed here.
       It is kept in the browser and shown on your posts and profile. */
    var chosenFaith = getFaith() || '';
    box.appendChild(faithRadios(chosenFaith, function (code) { chosenFaith = code; refresh(); }));
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
    function refresh() { create.disabled = !(check.checked && chosenFaith); }
    check.addEventListener('change', refresh);
    create.addEventListener('click', function () {
      if (!check.checked || !chosenFaith) return;
      try { localStorage.setItem('mc-agreed-at', String(Date.now())); } catch (e) {}
      setFaith(chosenFaith);
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
      /* Fresh login must be re-checked against lock/ban at once, not ride a
         stale badge cache. */
      try { localStorage.removeItem(DM_CACHE); } catch (e) {}
      /* On the board the cleanest login is the og one: reload, and the
         current view returns with the right name, buttons, and links. */
      if (BOARD) { location.reload(); return; }
      sha256hex(key).then(function (h) {
        state.myHash = h;
        hideKeyBox();
        renderIdentity();
        load();
        dmUnreadCheck();
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
    collectAltIps();
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
          faith: getFaith(),
          ipv4: state.altIps.ipv4 || '',
          ipv6: state.altIps.ipv6 || '',
        }),
      }, [1500], function () { status.textContent = 'Network hiccup, retrying...'; })
        .then(function (r) { return r.json(); });
    }).then(function (d) {
      if (blockedOut(d)) return;
      if (!d.ok) throw new Error(d.error || 'Something went wrong. Please try again.');
      var list = section.querySelector('.comments-list');
      list.appendChild(commentNode(d.comment, d.status === 'pending', { page: pagePath() }));
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
    form.appendChild(mdEditor(textarea));
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
  }

  function boardPost(payload, onSuccess) {
    collectAltIps();
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
      payload.faith = getFaith();
      payload.mentions = collectMentions(payload.body || '');
      payload.ipv4 = state.altIps.ipv4 || '';
      payload.ipv6 = state.altIps.ipv6 || '';
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

  /* A row of page links, dropped at both the top and the bottom of every
     paginated view so the buttons are never a scroll away. Condensed when the
     count is high: always the first three and the last, plus the current page
     and its neighbours, an ellipsis spanning any wider gap, and a single
     hidden page shown outright rather than dotted over (so "1 2 3 … 25", but
     "1 2 3 4 5" when only five). Null below two pages. Call it twice for two
     live bars; hrefFor(i) gives each page its URL. */
  function pageBar(total, per, curPage, hrefFor, onGo) {
    var pages = Math.ceil(total / per);
    if (pages <= 1) return null;
    var show = {};
    [1, 2, 3, curPage - 1, curPage, curPage + 1, pages].forEach(function (n) {
      if (n >= 1 && n <= pages) show[n] = true;
    });
    var nums = Object.keys(show).map(Number).sort(function (a, b) { return a - b; });
    var bar = el('p', 'board-pages');
    bar.appendChild(document.createTextNode('Pages: '));
    function link(n) {
      if (n === curPage) return el('strong', null, String(n));
      var a = el('a', null, String(n));
      /* onGo turns the page in place (member list); otherwise the number is a
         plain link the server resolves. */
      if (onGo) { a.href = '#'; a.addEventListener('click', function (e) { e.preventDefault(); onGo(n); }); }
      else a.href = hrefFor(n);
      return a;
    }
    var prev = 0;
    nums.forEach(function (n) {
      if (prev) {
        if (n - prev === 2) {
          bar.appendChild(document.createTextNode(' '));
          bar.appendChild(link(prev + 1));
          bar.appendChild(document.createTextNode(' '));
        } else if (n - prev > 2) {
          bar.appendChild(document.createTextNode(' … '));
        } else {
          bar.appendChild(document.createTextNode(' '));
        }
      }
      bar.appendChild(link(n));
      prev = n;
    });
    return bar;
  }

  function viewIndex() {
    document.title = 'Catholicity Board | Mere Catholicity';
    /* A muted word on who we are, for the newcomer who lands here. */
    [
      'A board for exploring what it means to be merely catholic.',
      'If you hold the Nicene Creed you are welcome. Or if you are a seeker, or if you keep one of the old pre-Christian Indo-European ways, you are also welcome as our guest in the conversation.',
      'This is not a forum for debating non-Christian religions, or atheism / agnosticism. Comparative religion discussion is welcome from a Christian perspective.'
    ].forEach(function (text) {
      var p = el('p', 'board-intro');
      p.appendChild(el('small', null, text));
      section.appendChild(p);
    });
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
    function ensureAuditLink() {
      auditSlot.textContent = '';
      if (!isAdmin()) return;
      var a = el('a', 'identity-action', 'Activity audit');
      a.href = 'community.html?audit=1';
      auditSlot.appendChild(a);
      auditSlot.appendChild(document.createTextNode(' · '));
      var ib = el('a', 'identity-action', 'IP ban list');
      ib.href = 'community.html?ipbans=1';
      auditSlot.appendChild(ib);
    }
    ensureAuditLink();
    new MutationObserver(ensureAuditLink)
      .observe(section.querySelector('.comment-identity'), { childList: true });
    section.appendChild(indexSearchBox());
    var wrap = el('div', 'board-cats');
    var stats = {}, catNames = {};
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
          mark.addEventListener('click', function (e) {
            e.preventDefault();
            fetch(API + '/board/read-all', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ key: state.key }),
            }).then(function () { location.reload(); }).catch(function () {});
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
    fetchRetry(API + '/board' + freshParam('?'), freshOpts(), [1000, 3000])
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
            /* Title and last poster together as one plain anchor jumping to
               that most-recent post, never to a profile or the thread top. */
            var titleText = t.length > 42 ? t.slice(0, 42) + '…' : t;
            var who = c.latest.author_hash ? (c.latest.nick || displayName(c.latest.author_hash)) : 'Anonymous';
            var a = el('a', null, titleText + ' · ' + who);
            a.href = 'community.html?topic=' + c.latest.topic_id +
              (c.latest.id ? '#comment-' + c.latest.id : '');
            line.appendChild(a);
            line.appendChild(document.createTextNode(' · ' + fmtDateTime(c.latest.created_at)));
            cell.appendChild(line);
          }
        });
      })
      .catch(function () {});
  }

  /* Admin topic controls on the category page. Reload after the act so
     the list, markers, and counts return true. */
  function modLinkEl(id, act, label) {
    var a = el('a', 'trust-toggle', label);
    a.href = '#';
    a.addEventListener('click', function (e) {
      e.preventDefault();
      if (act === 'delete' && !confirm('Delete this topic?')) return;
      fetch(API + '/moderate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: state.key, id: id, act: act }),
      }).then(function (r) { return r.json(); }).then(function (d) {
        if (d.ok) { stampFresh(); location.reload(); }
      }).catch(function () {});
    });
    return a;
  }

  function viewCat(key) {
    var cat = catByKey(key);
    if (!cat) return viewIndex();
    var pageNum = Math.max(1, Math.floor(Number(new URLSearchParams(location.search).get('p')) || 1));
    document.title = cat[1] + ' | Catholicity Board';
    var head = crumb([['Catholicity Board', 'community.html'], [cat[1]]]);
    var rss = el('a', 'comments-rss', 'RSS');
    rss.href = API + '/feed?cat=' + key;
    rss.title = 'Follow this category with a feed reader';
    head.appendChild(document.createTextNode(' '));
    head.appendChild(rss);
    section.appendChild(catDescNode('p', cat));
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
    attachMentions(section.querySelector('.comment-form .comment-text'));
    fetchRetry(API + '/board/cat?cat=' + key + '&p=' + pageNum + freshParam('&'), freshOpts(), [1000, 3000])
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok) throw new Error(d.error || 'failed');
        list.textContent = '';
        if (!d.topics.length) {
          list.appendChild(el('p', 'comments-status', 'No topics yet. Yours can be the first.'));
          return;
        }
        var titlesByTopic = {};
        d.topics.forEach(function (t) {
          var row = el('div', 'board-topic');
          var left = el('div', 'board-topic-left');
          var title = el('a', 'board-topic-title', t.title);
          title.href = 'community.html?topic=' + t.id;
          left.appendChild(title);
          titlesByTopic[t.id] = title;
          if (t.sticky) left.appendChild(el('span', 'board-sticky', '(sticky)'));
          if (t.locked) left.appendChild(el('span', 'board-locked', '(locked)'));
          /* Jump straight into a page of this thread. Replies paginate 20 to a
             page (the server's TOPICS_PER_PAGE); the bar hides below two. */
          var tPager = pageBar(t.replies, 20, 0, function (i) {
            return 'community.html?topic=' + t.id + '&p=' + i;
          });
          if (tPager) {
            tPager.className = 'board-pages topic-pages';
            left.appendChild(tPager);
          }
          row.appendChild(left);
          var tstat = el('div', 'board-stats');
          /* The last poster's name jumps to the newest post in the thread,
             not to a profile. */
          var who = t.author_hash ? (t.nick || displayName(t.author_hash)) : 'Anonymous';
          var wholink = el('a', null, who);
          wholink.href = 'community.html?topic=' + t.id + '#comment-' + (t.last_id || t.id);
          tstat.appendChild(wholink);
          tstat.appendChild(document.createTextNode(' · ' +
            t.replies + (t.replies === 1 ? ' reply · ' : ' replies · ') + fmtDateTime(t.last)));
          row.appendChild(tstat);
          /* Admin controls ride the bottom-right corner of the row, well clear
             of the title, pager, and author links, against fat-finger taps. */
          if (isAdmin()) {
            var admin = el('span', 'board-admin-links board-admin-corner');
            /* A Move dropdown lists every category with the current one greyed;
               picking one confirms, moves the whole thread, and DMs the poster. */
            var moveSel = el('select', 'board-move');
            var movePh = el('option', null, 'Move'); movePh.value = ''; moveSel.appendChild(movePh);
            CATS.forEach(function (c) {
              var o = el('option', null, c[1]); o.value = c[0];
              if (c[0] === key) o.disabled = true;
              moveSel.appendChild(o);
            });
            moveSel.addEventListener('change', (function (topic) {
              return function () {
                var target = moveSel.value;
                if (!target) return;
                var name = catByKey(target)[1];
                if (!confirm('Move "' + topic.title + '" to ' + name + '? The original poster will be notified by DM.')) { moveSel.value = ''; return; }
                fetch(API + '/move', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ key: state.key, id: topic.id, cat: target, catName: name }),
                }).then(function (r) { return r.json(); }).then(function (d) {
                  if (d.ok) { stampFresh(); location.reload(); } else moveSel.value = '';
                }).catch(function () { moveSel.value = ''; });
              };
            })(t));
            admin.appendChild(moveSel);
            admin.appendChild(document.createTextNode(' '));
            admin.appendChild(modLinkEl(t.id, t.sticky ? 'unsticky' : 'sticky', t.sticky ? '(unsticky)' : '(sticky)'));
            admin.appendChild(document.createTextNode(' '));
            admin.appendChild(modLinkEl(t.id, t.locked ? 'unlock' : 'lock', t.locked ? '(unlock)' : '(lock)'));
            admin.appendChild(document.createTextNode(' '));
            admin.appendChild(modLinkEl(t.id, 'delete', '(delete)'));
            row.appendChild(admin);
          }
          list.appendChild(row);
        });
        /* Mark the threads new since your last visit — a separate keyed call so
           the listing itself stays public and cacheable. */
        if (state.key) {
          fetch(API + '/board/reads', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: state.key, cat: key }),
          }).then(function (r) { return r.json(); }).then(function (rd) {
            if (blockedOut(rd) || !rd.ok) return;
            (rd.unread || []).forEach(function (id) {
              var t = titlesByTopic[id];
              if (t) { t.className = 'board-topic-title dm-unread'; t.parentNode.insertBefore(el('span', 'dm-unread', ' ● new'), t.nextSibling); }
            });
          }).catch(function () {});
        }
        function catHref(i) { return 'community.html?cat=' + key + '&p=' + i; }
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

  function viewTopic(id) {
    var qs = new URLSearchParams(location.search);
    /* Zero when no explicit page, so a bare #comment-N link takes the find
       branch and the server resolves which page that comment lives on. */
    var pNum = Math.floor(Number(qs.get('p')) || 0);
    var hashMatch = /^#comment-(\d+)$/.exec(location.hash);
    var extra = pNum ? '&p=' + pNum : (hashMatch ? '&find=' + hashMatch[1] : '');
    fetchRetry(API + '/board/topic?id=' + id + extra + freshParam('&'), freshOpts(), [1000, 3000])
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok) throw new Error(d.error || 'failed');
        var cat = catByKey(d.cat);
        state.anonAllowed = !!d.anon;
        document.title = d.topic.title + ' | Catholicity Board';
        /* Opening a thread marks it read for the "new since last visit" state. */
        if (state.key) {
          fetch(API + '/board/read', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: state.key, topic: d.topic.id }),
          }).catch(function () {});
        }
        crumb([['Catholicity Board', 'community.html'], [cat[1], 'community.html?cat=' + d.cat], [d.topic.title]]);
        var headEl = el('h2', 'board-topic-head', d.topic.title);
        if (d.topic.sticky) headEl.appendChild(el('span', 'board-sticky', '(sticky)'));
        if (d.topic.locked) headEl.appendChild(el('span', 'board-locked', '(locked)'));
        var topicRss = el('a', 'comments-rss', 'RSS');
        topicRss.href = API + '/feed?topic=' + d.topic.id;
        topicRss.title = 'Follow this topic with a feed reader';
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
        d.replies.forEach(function (c) { list.appendChild(commentNode(c, false, { topicId: id })); });
        function topicHref(i) { return 'community.html?topic=' + id + '&p=' + i; }
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
        buildBoardForm(false, 'Reply');
        boardButtons('Reply', function () {
          var body = section.querySelector('.comment-text').value.replace(/\s+$/, '');
          var status = section.querySelector('.form-status');
          if (!body.trim()) { section.querySelector('.comment-text').focus(); return; }
          boardPost({ topic: id, body: body }, function (d2) {
            section.querySelector('.comment-text').value = '';
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
              location.href = 'community.html?topic=' + id + '&p=' + replyPage + '#comment-' + d2.comment.id;
            }
          });
        });
        armBoardForm();
        attachMentions(section.querySelector('.comment-form .comment-text'));
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
    section.appendChild(el('p', 'board-intro',
      'An at-a-glance way to keep tabs on the board. First the review queue: comments the automated screen flagged and held back from publishing, waiting for you to approve or delete each one. Then the last two weeks of activity across the site pages, the book, and the forums, newest first, every line a link straight to that exact comment.'));
    renderPending();
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
        function auditRow(linkUrl, where, r) {
          var line = el('div', 'board-topic audit-row');
          var left = el('div', 'board-topic-left');
          var a = el('a', 'board-topic-title', where);
          a.href = linkUrl;
          left.appendChild(a);
          if (r.snippet) left.appendChild(el('div', 'audit-snippet', r.snippet));
          line.appendChild(left);
          var rstat = el('div', 'board-stats');
          rstat.appendChild(authorNode(r.author_hash, r.nick, false));
          rstat.appendChild(document.createTextNode(' · ' + fmtDateTime(r.created_at) +
            (r.status === 'pending' ? ' · pending' : '')));
          line.appendChild(rstat);
          return line;
        }
        section.appendChild(el('h3', 'board-form-head', 'Site pages and the book · last ' + days + ' days'));
        var pagesScroll = el('div', 'audit-scroll');
        var pages = el('div', 'board-topics');
        if (!d.pages.length) pages.appendChild(el('p', 'comments-status', 'No recent comments.'));
        d.pages.forEach(function (r) {
          pages.appendChild(auditRow(r.page + '#comment-' + r.id, r.page, r));
        });
        pagesScroll.appendChild(pages);
        section.appendChild(pagesScroll);
        section.appendChild(el('h3', 'board-form-head', 'Forums · last ' + days + ' days'));
        var topicsScroll = el('div', 'audit-scroll');
        var topics = el('div', 'board-topics');
        if (!d.topics.length) topics.appendChild(el('p', 'comments-status', 'No recent forum posts.'));
        d.topics.forEach(function (r) {
          var cat = catByKey(String(r.page).slice(6));
          var where = (cat ? cat[1] : r.page) + (r.title ? ' › ' + r.title : '');
          topics.appendChild(auditRow('community.html?topic=' + r.topic_id + '#comment-' + r.id, where, r));
        });
        topicsScroll.appendChild(topics);
        section.appendChild(topicsScroll);
      })
      .catch(function (err) {
        status.textContent = err.message === 'No.' ? 'This page is for the admins.'
          : 'The audit could not be loaded. Check your connection and reload the page.';
      });
  }

  /* The pending-review queue: the in-platform replacement for the old email
     approve link. Each held comment gets Approve and Delete, right here. */
  function renderPending() {
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
        if (!d.pending.length) { box.appendChild(el('p', 'comments-status', 'Nothing held. All clear.')); return; }
        d.pending.forEach(function (c) {
          var row = el('div', 'board-topic pending-row');
          var left = el('div', 'board-topic-left');
          var where = c.page.indexOf('board:') === 0
            ? ((catByKey(c.page.slice(6)) || [])[1] || c.page) + (c.title ? ' › ' + c.title : '')
            : c.page;
          var whereEl = el('div', 'audit-where');
          whereEl.appendChild(authorNode(c.author_hash, c.nick, false));
          whereEl.appendChild(document.createTextNode(' · ' + where + ' · ' + fmtDateTime(c.created_at) +
            (c.ai_verdict ? ' · ' + c.ai_verdict : '')));
          left.appendChild(whereEl);
          left.appendChild(el('div', 'pending-body', c.body));
          row.appendChild(left);
          var acts = el('div', 'board-admin-links');
          var app = el('a', 'trust-toggle', '(approve)');
          app.href = '#';
          app.addEventListener('click', function (e) {
            e.preventDefault();
            fetch(API + '/approve', { method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ key: state.key, id: c.id }) })
              .then(function (r) { return r.json(); }).then(function (r) { if (r.ok) row.remove(); }).catch(function () {});
          });
          var del = el('a', 'trust-toggle danger', '(delete)');
          del.href = '#';
          del.addEventListener('click', function (e) {
            e.preventDefault();
            if (!confirm('Delete this held comment?')) return;
            fetch(API + '/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ key: state.key, id: c.id }) })
              .then(function (r) { return r.json(); }).then(function (r) { if (r.ok) row.remove(); }).catch(function () {});
          });
          acts.appendChild(app);
          acts.appendChild(document.createTextNode(' '));
          acts.appendChild(del);
          row.appendChild(acts);
          box.appendChild(row);
        });
      })
      .catch(function () { box.textContent = ''; box.appendChild(el('p', 'comments-status', 'The pending queue could not be loaded.')); });
  }

  /* The admin IP-ban list: add or remove IPv4/IPv6 entries by hand, beside the
     one-click bans from the fingerprint dropdown. */
  function viewIpBans() {
    document.title = 'IP ban list | Catholicity Board';
    crumb([['Catholicity Board', 'community.html'], ['IP ban list']]);
    if (!isAdmin()) {
      section.appendChild(el('p', 'comments-status', 'This page is for the admins.'));
      return;
    }
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
    function ipValid(s) {
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
          d.ips.forEach(function (b) {
            var r = el('div', 'board-topic');
            r.appendChild(el('span', 'audit-where', b.ip));
            var rm = el('a', 'trust-toggle', '(remove)');
            rm.href = '#';
            rm.addEventListener('click', function (e) {
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

  /* Load the signed-in reader's own nick once, so their name reads the same
     to them as to everyone else (the identity line, the post buttons). Purely
     cosmetic: it only refreshes label text, never the login state. */
  function loadMyProfile() {
    if (!state.myHash) return;
    fetch(API + '/profile?hash=' + state.myHash + '&fresh=1')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok || !d.profile) return;
        state.myNick = d.profile.nick || '';
        if (section.querySelector('.comment-identity')) renderIdentity();
      })
      .catch(function () {});
  }

  /* A profile view. Your own is read/write; everyone else's is read-only. It
     is reached from the View-profile link and from every clickable username. */
  function viewProfile(hash) {
    document.title = 'Profile | Catholicity Board';
    crumb([['Catholicity Board', 'community.html'], ['Profile']]);
    if (!/^[0-9a-f]{64}$/.test(String(hash))) {
      section.appendChild(el('p', 'comments-status', 'No such profile.'));
      return;
    }
    var editable = !!state.key && hash === state.myHash;
    var card = el('div', 'profile');
    section.appendChild(card);
    var status = el('p', 'comments-status', 'Loading profile...');
    section.appendChild(status);
    /* Editing is a write, so it gets the same Turnstile gate as posting. The
       slot lives outside the card so it survives the read/edit toggle. */
    if (editable) {
      section.appendChild(el('div', 'ts-slot'));
      loadTurnstile();
    }
    fetchRetry(API + '/profile?hash=' + hash + freshParam('&'), freshOpts(), [1000, 3000])
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok) throw new Error(d.error || 'failed');
        status.remove();
        renderProfile(card, d.profile, editable);
      })
      .catch(function () {
        status.textContent = 'The profile could not be loaded. Check your connection and reload the page.';
      });
  }

  /* Read view: an avatar placeholder, the primary name (nick or assigned) with
     the assigned pseudonym muted beneath when a nick is set, then bio and
     signature. The owner gets an Edit button that swaps in the form. */
  /* The "recent posts" list on a profile: a member's own live forum posts,
     newest first, each linking to the exact post, paged in place. */
  function renderProfilePosts(card, hash) {
    var wrap = el('div', 'profile-posts');
    card.appendChild(el('h3', 'profile-label', 'Recent posts'));
    card.appendChild(wrap);
    var list = el('div', 'board-topics');
    list.textContent = 'Loading...';
    wrap.appendChild(list);
    var pagerHost = el('div');
    wrap.appendChild(pagerHost);
    var st = { page: 1 };
    function draw() {
      list.textContent = 'Loading...';
      pagerHost.textContent = '';
      fetchRetry(API + '/board/author?hash=' + hash + '&p=' + st.page + freshParam('&'), freshOpts(), [1000, 3000])
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (!d.ok) throw new Error('failed');
          list.textContent = '';
          if (!d.items.length) {
            list.appendChild(el('p', 'comments-status', st.page > 1 ? 'No more posts.' : 'No forum posts yet.'));
            return;
          }
          d.items.forEach(function (it) {
            var row = el('div', 'board-topic');
            var left = el('div', 'board-topic-left');
            var a = el('a', 'board-topic-title', it.title || 'a thread');
            a.href = 'community.html?topic=' + it.topic_id + '#comment-' + it.comment_id;
            left.appendChild(a);
            if (it.snippet) left.appendChild(el('div', 'board-intro', it.snippet));
            row.appendChild(left);
            var ce = catByKey(it.cat);
            row.appendChild(el('div', 'board-stats', (ce ? ce[1] : it.cat) + ' · ' + fmtDateTime(it.created_at)));
            list.appendChild(row);
          });
          var bar = pageBar(d.total, d.per, d.page, null, function (n) { st.page = n; draw(); window.scrollTo(0, 0); });
          if (bar) pagerHost.appendChild(bar);
        })
        .catch(function () { list.textContent = ''; list.appendChild(el('p', 'comments-status', 'Recent posts could not be loaded.')); });
    }
    draw();
  }

  function renderProfile(card, p, editable) {
    card.textContent = '';
    var headRow = el('div', 'profile-head');
    var avatar = el('div', 'profile-avatar');
    if (p.avatar) {
      var img = el('img');
      img.src = API + '/avatar?hash=' + p.hash + '&v=' + encodeURIComponent(p.avatar);
      img.alt = '';
      img.width = 72;
      img.height = 72;
      avatar.appendChild(img);
    }
    headRow.appendChild(avatar);
    var names = el('div', 'profile-names');
    names.appendChild(el('div', 'profile-name', p.nick || p.assigned));
    if (p.nick) names.appendChild(el('div', 'profile-assigned', p.assigned));
    if (p.admin) names.appendChild(el('span', 'comment-admin', '(admin)'));
    /* The faith declaration. For one's own profile it falls back to the local
       choice before the first post has carried it to the server. */
    var faithCode = p.faith || (p.hash === state.myHash ? getFaith() : '');
    if (faithCode && FAITH[faithCode]) names.appendChild(el('div', 'profile-faith', 'I hold to: ' + FAITH[faithCode]));
    headRow.appendChild(names);
    card.appendChild(headRow);
    if (p.bio) {
      card.appendChild(el('h3', 'profile-label', 'Bio'));
      card.appendChild(el('p', 'profile-bio', p.bio));
    } else if (!editable) {
      card.appendChild(el('p', 'profile-bio profile-empty', 'No bio yet.'));
    }
    if (p.signature) {
      card.appendChild(el('h3', 'profile-label', 'Signature'));
      card.appendChild(el('div', 'comment-sig', p.signature));
    }
    if (editable) {
      var edit = el('button', 'btn btn-send', 'Edit profile');
      edit.type = 'button';
      edit.addEventListener('click', function () { editProfile(card, p); });
      card.appendChild(edit);
    } else if (state.key && state.myHash && p.hash !== state.myHash) {
      var dmBtn = el('button', 'btn btn-send', 'Send a Direct Message');
      dmBtn.type = 'button';
      dmBtn.addEventListener('click', function () {
        location.href = 'community.html?dm=' + p.hash;
      });
      card.appendChild(dmBtn);
      var muteBtn = el('button', 'btn btn-anon', isMuted(p.hash) ? 'Unmute this member' : 'Mute this member');
      muteBtn.type = 'button';
      muteBtn.addEventListener('click', function () {
        toggleMute(p.hash);
        muteBtn.textContent = isMuted(p.hash) ? 'Unmute this member' : 'Mute this member';
      });
      card.appendChild(muteBtn);
    }
    /* A member's own recent forum posts, so a reader can follow a thinker. */
    renderProfilePosts(card, p.hash);
    /* Admins get the very same user-fingerprint drawer here as on a post,
       driven by this identity's hash. Everyone else sees nothing. */
    annotateProfileMeta(p.hash, card);
  }

  /* The edit form. Every save is re-screened by the server; a flagged save is
     refused with its reason and the fields survive so nothing is retyped. */
  function editProfile(card, p) {
    card.textContent = '';
    card.appendChild(el('p', 'key-note',
      'Your assigned name ' + p.assigned + ' always stays as your identifier. ' +
      'A custom nickname simply shows first.'));
    var chosenFaith = p.faith || (p.hash === state.myHash ? getFaith() : '') || '';
    card.appendChild(faithRadios(chosenFaith, function (code) { chosenFaith = code; }));
    card.appendChild(el('label', 'profile-label', 'Nickname (up to 40 characters)'));
    var nickIn = el('input', 'key-input');
    nickIn.type = 'text';
    nickIn.maxLength = 40;
    nickIn.placeholder = p.assigned;
    nickIn.value = p.nick || '';
    card.appendChild(nickIn);
    card.appendChild(el('label', 'profile-label', 'Bio (up to 500 characters)'));
    var bioIn = el('textarea', 'comment-text');
    bioIn.maxLength = 500;
    bioIn.rows = 4;
    bioIn.value = p.bio || '';
    card.appendChild(bioIn);
    card.appendChild(el('label', 'profile-label', 'Signature (up to 200 characters)'));
    var sigIn = el('textarea', 'comment-text');
    sigIn.maxLength = 200;
    sigIn.rows = 2;
    sigIn.value = p.signature || '';
    card.appendChild(sigIn);

    /* Avatar. Any picked image is center-cropped to 400x400 on a canvas, so
       what leaves the browser already matches what the server demands. The
       server re-checks bytes, format, and dimensions regardless. */
    card.appendChild(el('label', 'profile-label', 'Avatar'));
    var avRow = el('div', 'key-row');
    var avPick = el('input');
    avPick.type = 'file';
    avPick.accept = '.jpg,.jpeg,image/jpeg';
    avRow.appendChild(avPick);
    card.appendChild(avRow);
    card.appendChild(el('p', 'profile-empty',
      'JPEG only. Cropped square to 400 by 400 pixels, 500 KB at most.'));
    var avNote = el('p', 'profile-empty', p.avatar
      ? 'Choosing a new image replaces the current avatar.'
      : '');
    card.appendChild(avNote);
    if (p.avatar) {
      var avPrev = el('div', 'profile-avatar');
      var avPrevImg = el('img');
      avPrevImg.src = API + '/avatar?hash=' + p.hash + '&v=' + encodeURIComponent(p.avatar);
      avPrevImg.alt = '';
      avPrev.appendChild(avPrevImg);
      card.appendChild(avPrev);
      var avDel = el('a', 'identity-action', 'Remove avatar');
      avDel.href = '#';
      avDel.addEventListener('click', function (e) {
        e.preventDefault();
        if (!confirm('Remove your avatar?')) return;
        fetchRetry(API + '/avatar/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: state.key }),
        }, [1500]).then(function (r) { return r.json(); }).then(function (d) {
          if (!d.ok) throw new Error(d.error || 'Could not remove it.');
          stampFresh();
          p.avatar = null;
          editProfile(card, p);
        }).catch(function (err) { avNote.textContent = err.message; });
      });
      card.appendChild(avDel);
    }
    avPick.addEventListener('change', function () {
      var file = avPick.files && avPick.files[0];
      if (!file) return;
      avNote.textContent = 'Preparing image...';
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onerror = function () {
        URL.revokeObjectURL(url);
        avNote.textContent = 'That file is not a usable image.';
      };
      img.onload = function () {
        URL.revokeObjectURL(url);
        var c = document.createElement('canvas');
        c.width = 400;
        c.height = 400;
        var scale = Math.max(400 / img.naturalWidth, 400 / img.naturalHeight);
        var w = img.naturalWidth * scale;
        var h = img.naturalHeight * scale;
        c.getContext('2d').drawImage(img, (400 - w) / 2, (400 - h) / 2, w, h);
        /* JPEG, so the stored bytes decode cleanly for both the AI vision
           screen and every browser; a lower-quality second pass is the net
           for the rare frame that overruns the cap. */
        var send = function (blob) {
          if (!blob || blob.size > 500 * 1024) {
            avNote.textContent = 'The image could not be brought under 500 KB. Try another.';
            return;
          }
          avNote.textContent = 'Verifying...';
          getToken().then(function (token) {
            avNote.textContent = 'Checking image...';
            var fd = new FormData();
            fd.append('key', state.key);
            fd.append('token', token);
            fd.append('avatar', blob, 'avatar');
            return fetchRetry(API + '/avatar', { method: 'POST', body: fd }, [1500])
              .then(function (r) { return r.json(); });
          }).then(function (d) {
            if (!d.ok) throw new Error(d.error || 'Could not upload the avatar.');
            stampFresh();
            p.avatar = d.avatar;
            if (window.turnstile && state.widgetId !== null) turnstile.reset(state.widgetId);
            editProfile(card, p);
          }).catch(function (err) {
            avNote.textContent = err.message || 'Network error. Try again in a moment.';
            if (window.turnstile && state.widgetId !== null) turnstile.reset(state.widgetId);
          });
        };
        c.toBlob(function (blob) {
          if (blob && blob.size <= 500 * 1024) return send(blob);
          c.toBlob(send, 'image/jpeg', 0.7);
        }, 'image/jpeg', 0.85);
      };
      img.src = url;
    });
    var row = el('div', 'comment-buttons');
    var save = el('button', 'btn btn-send', 'Save');
    save.type = 'button';
    row.appendChild(save);
    card.appendChild(row);
    var note = el('p', 'form-status');
    card.appendChild(note);
    card.appendChild(identityAction('Cancel', function () { renderProfile(card, p, true); }));
    save.addEventListener('click', function () {
      save.disabled = true;
      note.textContent = 'Verifying...';
      getToken().then(function (token) {
        note.textContent = 'Saving...';
        return fetchRetry(API + '/profile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: state.key, nick: nickIn.value, bio: bioIn.value, signature: sigIn.value, faith: chosenFaith, token: token }),
        }, [1500], function () { note.textContent = 'Network hiccup, retrying...'; })
          .then(function (r) { return r.json(); });
      })
        .then(function (d) {
          if (!d.ok) throw new Error(d.error || 'Could not save.');
          stampFresh();
          state.myNick = d.profile.nick || '';
          if (d.profile.faith) setFaith(d.profile.faith);
          if (window.turnstile && state.widgetId !== null) turnstile.reset(state.widgetId);
          renderProfile(card, d.profile, true);
        })
        .catch(function (err) {
          note.textContent = err.message || 'Network error. Try again in a moment.';
          save.disabled = false;
          if (window.turnstile && state.widgetId !== null) turnstile.reset(state.widgetId);
        });
    });
  }

  /* ---- Direct messages ---- */

  function dmLabel(hash, nick) {
    var assigned = displayName(hash);
    return nick ? nick + ' (' + assigned + ')' : assigned;
  }

  /* Fuzzy score of one candidate string against the lowercased query:
     whole-prefix beats word-prefix beats substring beats subsequence. */
  function dmScore(q, name) {
    if (!name) return 0;
    var n = String(name).toLowerCase();
    if (n.indexOf(q) === 0) return 100;
    var words = n.split(/[\s-]+/);
    for (var i = 0; i < words.length; i++) if (words[i].indexOf(q) === 0) return 80;
    if (n.indexOf(q) !== -1) return 60;
    var j = 0;
    for (var k = 0; k < n.length && j < q.length; k++) if (n[k] === q[j]) j++;
    return j === q.length ? 30 : 0;
  }

  /* The Send-a-DM box with autocomplete. The member directory is fetched
     once per session at the third character; every keystroke after that is
     scored locally and costs no request. */
  function dmSearchBox() {
    var box = el('div', 'key-box dm-search');
    box.hidden = false;
    box.appendChild(el('p', 'key-note', 'Send a direct message. Type a nickname or an assigned name, then click the member below to open the conversation.'));
    var row = el('div', 'key-row');
    var input = el('input', 'key-input');
    input.type = 'text';
    input.placeholder = 'e.g. Constant-Almond, or a nickname';
    row.appendChild(input);
    box.appendChild(row);
    var sug = el('div', 'dm-suggest');
    sug.hidden = true;
    box.appendChild(sug);
    var note = el('p', 'form-status');
    box.appendChild(note);
    var dir = null;
    var loading = false;
    var current = [];
    var sel = 0;
    var timer = null;
    function ensureDir(cb) {
      if (dir) return cb();
      if (loading) return;
      loading = true;
      fetch(API + '/dm/directory' + freshParam('?'))
        .then(function (r) { return r.json(); })
        .then(function (d) { loading = false; if (d.ok) { dir = d.users; cb(); } })
        .catch(function () { loading = false; note.textContent = 'The member list could not be loaded.'; });
    }
    function renderSug() {
      sug.textContent = '';
      if (!current.length) { sug.hidden = true; return; }
      current.forEach(function (u, i) {
        var r = el('a', 'dm-suggest-row' + (i === sel ? ' dm-suggest-sel' : ''));
        r.href = 'community.html?dm=' + u.hash;
        r.title = 'Open the conversation';
        r.appendChild(el('span', null, dmLabel(u.hash, u.nick)));
        r.appendChild(el('span', 'dm-suggest-go', 'message →'));
        r.addEventListener('mousedown', function (e) {
          e.preventDefault();
          location.href = 'community.html?dm=' + u.hash;
        });
        sug.appendChild(r);
      });
      sug.hidden = false;
    }
    function suggest() {
      var q = input.value.trim().toLowerCase();
      if (q.length < 3) { current = []; renderSug(); return; }
      ensureDir(function () {
        current = dir
          .filter(function (u) { return u.hash !== state.myHash; })
          .map(function (u) {
            var s = Math.max(dmScore(q, u.nick), dmScore(q, displayName(u.hash)));
            return { u: u, s: s, label: dmLabel(u.hash, u.nick) };
          })
          .filter(function (x) { return x.s > 0; })
          .sort(function (x, y) { return y.s - x.s || (x.label < y.label ? -1 : 1); })
          .slice(0, 8)
          .map(function (x) { return x.u; });
        sel = 0;
        note.textContent = current.length ? '' : 'No member matches that. Pick from the suggestions.';
        renderSug();
      });
    }
    input.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(suggest, 150);
    });
    input.addEventListener('keydown', function (e) {
      if (sug.hidden) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(sel + 1, current.length - 1); renderSug(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(sel - 1, 0); renderSug(); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        if (current[sel]) location.href = 'community.html?dm=' + current[sel].hash;
      } else if (e.key === 'Escape') { current = []; renderSug(); }
    });
    input.addEventListener('blur', function () {
      setTimeout(function () { current = []; renderSug(); }, 200);
    });
    return box;
  }

  /* @mentions in the reply box. The very same directory and fuzzy scorer as the
     Send-a-DM search, but triggered by an "@" token at the caret: a pick inserts
     "@Name" and remembers that member's hash, and boardPost carries the hashes
     whose token still stands in the body. Picking is the only source of truth,
     since a pseudonym cannot be reversed to a hash. */
  var mentionDir = null, mentionDirLoading = false;
  var pendingMentions = [];
  function ensureMentionDir(cb) {
    if (mentionDir) return cb();
    if (mentionDirLoading) return;
    mentionDirLoading = true;
    fetch(API + '/dm/directory' + freshParam('?'))
      .then(function (r) { return r.json(); })
      .then(function (d) { mentionDirLoading = false; if (d.ok) { mentionDir = d.users; cb(); } })
      .catch(function () { mentionDirLoading = false; });
  }
  function collectMentions(text) {
    var out = [];
    for (var i = 0; i < pendingMentions.length; i++) {
      var m = pendingMentions[i];
      if (text.indexOf(m.token) > -1 && out.indexOf(m.hash) === -1) out.push(m.hash);
    }
    return out;
  }
  function attachMentions(textarea) {
    if (!textarea || textarea.dataset.mentions) return;
    textarea.dataset.mentions = '1';
    pendingMentions = [];
    /* A plain static container (not the absolute .dm-suggest) so the list flows
       right below the box; its rows carry the shared suggestion styling. */
    var sug = el('div', 'mention-suggest');
    sug.hidden = true;
    textarea.parentNode.insertBefore(sug, textarea.nextSibling);
    var current = [], sel = 0, at = -1, timer = null;
    function scan() {
      var caret = textarea.selectionStart;
      var m = /(^|\s)@([^\s@]{1,30})$/.exec(textarea.value.slice(0, caret));
      if (!m) { current = []; at = -1; sug.hidden = true; return; }
      at = caret - m[2].length - 1;
      var q = m[2].toLowerCase();
      ensureMentionDir(function () {
        current = mentionDir
          .filter(function (u) { return u.hash !== state.myHash; })
          .map(function (u) { return { u: u, s: Math.max(dmScore(q, u.nick), dmScore(q, displayName(u.hash))), label: dmLabel(u.hash, u.nick) }; })
          .filter(function (x) { return x.s > 0; })
          .sort(function (x, y) { return y.s - x.s || (x.label < y.label ? -1 : 1); })
          .slice(0, 8).map(function (x) { return x.u; });
        sel = 0;
        render();
      });
    }
    function render() {
      sug.textContent = '';
      if (!current.length) { sug.hidden = true; return; }
      current.forEach(function (u, i) {
        var r = el('a', 'dm-suggest-row' + (i === sel ? ' dm-suggest-sel' : ''));
        r.href = '#';
        r.appendChild(el('span', null, dmLabel(u.hash, u.nick)));
        r.appendChild(el('span', 'dm-suggest-go', 'mention'));
        r.addEventListener('mousedown', function (e) { e.preventDefault(); pick(u); });
        sug.appendChild(r);
      });
      sug.hidden = false;
    }
    function pick(u) {
      if (at < 0) return;
      var caret = textarea.selectionStart;
      var token = '@' + (u.nick || displayName(u.hash));
      var v = textarea.value;
      textarea.value = v.slice(0, at) + token + ' ' + v.slice(caret);
      var np = at + token.length + 1;
      try { textarea.setSelectionRange(np, np); } catch (e) {}
      if (!pendingMentions.some(function (m) { return m.hash === u.hash && m.token === token; })) {
        pendingMentions.push({ hash: u.hash, token: token });
      }
      current = []; at = -1; sug.hidden = true;
      textarea.focus();
    }
    textarea.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(scan, 120); });
    textarea.addEventListener('keydown', function (e) {
      if (sug.hidden || !current.length) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(sel + 1, current.length - 1); render(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(sel - 1, 0); render(); }
      else if (e.key === 'Enter') { e.preventDefault(); if (current[sel]) pick(current[sel]); }
      else if (e.key === 'Escape') { current = []; sug.hidden = true; }
    });
    textarea.addEventListener('blur', function () { setTimeout(function () { sug.hidden = true; }, 200); });
  }

  /* The member directory: everyone on the board, newest join first, searchable
     by nickname or assigned name across the whole roster (the full list rides
     in on one cached fetch, so a search narrows every page and the pager turns
     in place). Twenty to a page, click a name to open the profile. */
  function viewUsers() {
    document.title = 'Members | Catholicity Board';
    crumb([['Catholicity Board', 'community.html'], ['Members']]);
    section.appendChild(el('p', 'board-intro',
      'Everyone on the board, newest first. Search by nickname or assigned name to find who is who, then open a profile.'));
    var searchRow = el('div', 'key-row');
    var search = el('input', 'key-input');
    search.type = 'text';
    search.placeholder = 'Search members by name...';
    searchRow.appendChild(search);
    section.appendChild(searchRow);
    var count = el('p', 'comments-status', 'Loading members...');
    section.appendChild(count);
    var list = el('div', 'user-list');
    section.appendChild(list);
    var pagerHost = el('div');
    section.appendChild(pagerHost);

    var roster = null;
    var st = { q: '', page: 1 };
    var PER = 20;

    /* Empty query keeps the server's newest-first order; a query filters the
       whole roster and ranks by match, both on nickname and assigned name. */
    function visible() {
      if (!st.q) return roster;
      var q = st.q.toLowerCase();
      return roster
        .map(function (u) { return { u: u, s: Math.max(dmScore(q, u.nick), dmScore(q, displayName(u.hash))) }; })
        .filter(function (x) { return x.s > 0; })
        .sort(function (x, y) { return y.s - x.s; })
        .map(function (x) { return x.u; });
    }

    function draw() {
      var items = visible();
      var total = items.length;
      var pages = Math.max(1, Math.ceil(total / PER));
      if (st.page > pages) st.page = pages;
      list.textContent = '';
      if (!total) {
        count.textContent = st.q ? 'No member matches that.' : 'No members yet.';
      } else {
        count.textContent = st.q
          ? total + (total === 1 ? ' match' : ' matches')
          : total + (total === 1 ? ' member' : ' members');
        items.slice((st.page - 1) * PER, st.page * PER).forEach(function (u) {
          var row = el('a', 'user-row');
          row.href = profileHref(u.hash);
          var names = el('span', 'user-names');
          if (u.nick) {
            names.appendChild(el('span', 'user-nick', u.nick));
            names.appendChild(el('span', 'user-assigned', displayName(u.hash)));
          } else {
            names.appendChild(el('span', 'user-nick', displayName(u.hash)));
          }
          row.appendChild(names);
          row.appendChild(el('span', 'user-go', 'profile →'));
          list.appendChild(row);
        });
      }
      pagerHost.textContent = '';
      var bar = pageBar(total, PER, st.page, null, function (n) { st.page = n; draw(); window.scrollTo(0, 0); });
      if (bar) pagerHost.appendChild(bar);
    }

    var timer = null;
    search.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(function () { st.q = search.value.trim(); st.page = 1; draw(); }, 120);
    });

    fetchRetry(API + '/dm/directory' + freshParam('?'), freshOpts(), [1000, 3000])
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok) throw new Error(d.error || 'failed');
        roster = d.users || [];
        st.page = Math.max(1, Math.floor(Number(new URLSearchParams(location.search).get('p')) || 1));
        draw();
      })
      .catch(function () {
        count.textContent = 'The member list could not be loaded. Check your connection and reload the page.';
      });
  }

  function viewInbox() {
    document.title = 'Inbox | Catholicity Board';
    crumb([['Catholicity Board', 'community.html'], ['Inbox']]);
    if (!state.key) {
      section.appendChild(el('p', 'comments-status', 'Messages need an identity. Create one on the board front page.'));
      return;
    }
    section.appendChild(dmSearchBox());
    var list = el('div', 'board-topics');
    list.textContent = 'Loading messages...';
    section.appendChild(list);
    var pageNum = Math.max(1, Math.floor(Number(new URLSearchParams(location.search).get('p')) || 1));
    fetchRetry(API + '/dm/threads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: state.key, p: pageNum }),
    }, [1000, 3000])
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok) throw new Error(d.error || 'failed');
        dmCacheSet(d.unread_total);
        list.textContent = '';
        if (!d.threads.length) {
          list.appendChild(el('p', 'comments-status', 'No messages yet. Find a member above, or press Direct Message on any post.'));
          return;
        }
        d.threads.forEach(function (t) {
          var row = el('div', 'board-topic');
          var left = el('div', 'board-topic-left');
          var a = el('a', 'board-topic-title' + (t.unread ? ' dm-unread' : ''), dmLabel(t.other_hash, t.nick));
          a.href = 'community.html?dm=' + t.other_hash;
          left.appendChild(a);
          if (t.unread) left.appendChild(el('span', 'dm-unread', ' ● new'));
          row.appendChild(left);
          row.appendChild(el('div', 'board-stats',
            t.msgs + (t.msgs === 1 ? ' message · ' : ' messages · ') + fmtDateTime(t.last_at)));
          /* A quiet Delete in the corner: clears my side, keeps the other's. */
          var delWrap = el('div', 'board-admin-corner');
          var del = el('a', 'trust-toggle', 'Delete');
          del.href = '#';
          del.addEventListener('click', (function (other, rowEl) {
            return function (e) {
              e.preventDefault();
              if (!confirm('Delete this conversation? It is cleared from your inbox; the other member keeps their copy until they delete it too.')) return;
              fetch(API + '/dm/delete', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key: state.key, with: other }),
              }).then(function (r) { return r.json(); }).then(function (d2) {
                if (d2.ok) { rowEl.remove(); try { localStorage.removeItem(DM_CACHE); } catch (e2) {} dmUnreadCheck(); }
              }).catch(function () {});
            };
          })(t.other_hash, row));
          delWrap.appendChild(del);
          row.appendChild(delWrap);
          list.appendChild(row);
        });
        function inboxHref(i) { return 'community.html?inbox=1&p=' + i; }
        var topBar = pageBar(d.total, d.per, d.page, inboxHref);
        if (topBar) section.insertBefore(topBar, list);
        var botBar = pageBar(d.total, d.per, d.page, inboxHref);
        if (botBar) section.appendChild(botBar);
      })
      .catch(function () {
        list.textContent = '';
        list.appendChild(el('p', 'comments-status', 'The inbox could not be loaded. Check your connection and reload the page.'));
      });
  }

  /* The notification list. Opening it is reading it: the server marks every row
     read and the badge clears. Each row says who did what in which thread and
     links to the exact post, riding the same find-pagination jump as any
     permalink. Newest first, twenty to a page. */
  function viewNotifications() {
    document.title = 'Notifications | Catholicity Board';
    crumb([['Catholicity Board', 'community.html'], ['Notifications']]);
    if (!state.key) {
      section.appendChild(el('p', 'comments-status', 'Notifications need an identity. Create one on the board front page.'));
      return;
    }
    var list = el('div', 'board-topics');
    list.textContent = 'Loading notifications...';
    section.appendChild(list);
    var pageNum = Math.max(1, Math.floor(Number(new URLSearchParams(location.search).get('p')) || 1));
    fetchRetry(API + '/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: state.key, p: pageNum }),
    }, [1000, 3000])
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (blockedOut(d)) return;
        if (!d.ok) throw new Error(d.error || 'failed');
        /* Reading the list clears it on the server; make the badge tell the truth. */
        fetch(API + '/notifications/read', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: state.key }),
        }).then(function () { try { localStorage.removeItem(NOTIF_CACHE); } catch (e) {} notifUnreadCheck(); }).catch(function () {});
        list.textContent = '';
        if (!d.items.length) {
          list.appendChild(el('p', 'comments-status', 'No notifications yet. Post in a thread to follow it; you will hear when someone replies or names you.'));
          return;
        }
        d.items.forEach(function (it) {
          var row = el('div', 'board-topic');
          var left = el('div', 'board-topic-left');
          var who = it.actor_nick || (it.actor_hash ? displayName(it.actor_hash) : 'Someone');
          var verb = it.kind === 'mention' ? ' mentioned you in ' : ' replied in ';
          var a = el('a', 'board-topic-title' + (it.read_at ? '' : ' dm-unread'), who + verb + (it.topic_title || 'a thread'));
          a.href = 'community.html?topic=' + it.topic_id + '#comment-' + it.comment_id;
          left.appendChild(a);
          if (!it.read_at) left.appendChild(el('span', 'dm-unread', ' ● new'));
          if (it.snippet) left.appendChild(el('div', 'board-intro', it.snippet));
          row.appendChild(left);
          row.appendChild(el('div', 'board-stats', fmtDateTime(it.created_at)));
          list.appendChild(row);
        });
        function notifHref(i) { return 'community.html?notifications=1&p=' + i; }
        var topBar = pageBar(d.total, d.per, d.page, notifHref);
        if (topBar) section.insertBefore(topBar, list);
        var botBar = pageBar(d.total, d.per, d.page, notifHref);
        if (botBar) section.appendChild(botBar);
      })
      .catch(function () {
        list.textContent = '';
        list.appendChild(el('p', 'comments-status', 'Notifications could not be loaded. Check your connection and reload the page.'));
      });
  }

  /* The manual Watch/Unwatch control in a topic header. Posting already watches
     a thread; this lets a reader follow one they have not answered, or stop
     following one they have. Its label reflects the current state, read once. */
  function watchToggle(topicId) {
    var a = el('a', 'trust-toggle board-watch', 'Watch');
    a.href = '#';
    a.title = 'Get a notification when someone replies here';
    function setLabel(w) { a.textContent = w ? 'Unwatch' : 'Watch'; a.setAttribute('data-w', w ? '1' : '0'); }
    function call(act) {
      return fetch(API + '/watch', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: state.key, topic: topicId, act: act }),
      }).then(function (r) { return r.json(); });
    }
    call('status').then(function (d) { if (blockedOut(d)) return; if (d.ok) setLabel(d.watching); }).catch(function () {});
    a.addEventListener('click', function (e) {
      e.preventDefault();
      call(a.getAttribute('data-w') === '1' ? 'unwatch' : 'watch')
        .then(function (d) { if (blockedOut(d)) return; if (d.ok) setLabel(d.watching); }).catch(function () {});
    });
    return a;
  }

  function dmMsgNode(m, otherLabel) {
    var mine = m.sender_hash === state.myHash;
    var node = el('div', 'dm-msg' + (mine ? ' dm-mine' : ''));
    var head = el('div', 'comment-head');
    head.appendChild(el('span', 'comment-author', mine ? 'You' : otherLabel));
    head.appendChild(el('span', 'comment-date', ' ' + fmtDateTime(m.created_at)));
    node.appendChild(head);
    node.appendChild(fillBody(el('div', 'comment-body'), m.body));
    return node;
  }

  function viewDm(other) {
    if (!/^[0-9a-f]{64}$/.test(String(other))) {
      crumb([['Catholicity Board', 'community.html'], ['Messages']]);
      section.appendChild(el('p', 'comments-status', 'No such member.'));
      return;
    }
    if (!state.key) {
      crumb([['Catholicity Board', 'community.html'], ['Messages']]);
      section.appendChild(el('p', 'comments-status', 'Messages need an identity. Create one on the board front page.'));
      return;
    }
    if (other === state.myHash) {
      crumb([['Catholicity Board', 'community.html'], ['Messages']]);
      section.appendChild(el('p', 'comments-status', 'That would be a soliloquy. Pick another member.'));
      return;
    }
    var qs = new URLSearchParams(location.search);
    var pNum = Math.floor(Number(qs.get('p')) || 0);
    var payload = { key: state.key, with: other };
    if (pNum > 0) payload.p = pNum;
    fetchRetry(API + '/dm/thread', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }, [1000, 3000])
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok) throw new Error(d.error || 'failed');
        var label = dmLabel(other, d.other.nick);
        var shortName = d.other.nick || displayName(other);
        document.title = shortName + ' | Inbox';
        crumb([['Catholicity Board', 'community.html'], ['Inbox', 'community.html?inbox=1'], [shortName]]);
        var headEl = el('h2', 'board-topic-head');
        var nameLink = el('a', null, label);
        nameLink.href = profileHref(other);
        headEl.appendChild(nameLink);
        section.appendChild(headEl);
        /* Opening marked it read on the server; make the badge tell the
           same story on the next paint. */
        try { localStorage.removeItem(DM_CACHE); } catch (e) {}
        dmUnreadCheck();
        var list = el('div', 'comments-list');
        section.appendChild(list);
        if (!d.messages.length) {
          list.appendChild(el('p', 'comments-status', 'No messages yet. Say the first word.'));
        }
        d.messages.forEach(function (m) { list.appendChild(dmMsgNode(m, shortName)); });
        var dmPages = Math.max(1, Math.ceil(d.total / d.per));
        function dmHref(i) { return 'community.html?dm=' + other + '&p=' + i; }
        var topBar = pageBar(d.total, d.per, d.page, dmHref);
        if (topBar) section.insertBefore(topBar, list);
        var botBar = pageBar(d.total, d.per, d.page, dmHref);
        if (botBar) section.appendChild(botBar);
        var form = el('div', 'comment-form');
        var ta = el('textarea', 'comment-text');
        ta.maxLength = 4000;
        ta.rows = 3;
        ta.placeholder = 'Write your message.';
        form.appendChild(mdEditor(ta));
        form.appendChild(el('div', 'ts-slot'));
        var btnRow = el('div', 'comment-buttons');
        var send = el('button', 'btn btn-send', 'Send');
        send.type = 'button';
        btnRow.appendChild(send);
        form.appendChild(btnRow);
        var status = el('p', 'form-status');
        form.appendChild(status);
        section.appendChild(form);
        loadTurnstile();
        send.addEventListener('click', function () {
          var body = ta.value.replace(/\s+$/, '');
          if (!body.trim()) { ta.focus(); return; }
          send.disabled = true;
          status.textContent = 'Verifying...';
          getToken().then(function (token) {
            status.textContent = 'Sending...';
            return fetchRetry(API + '/dm/send', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ key: state.key, to: other, body: body, token: token }),
            }, [1500], function () { status.textContent = 'Network hiccup, retrying...'; })
              .then(function (r) { return r.json(); });
          }).then(function (d2) {
            if (blockedOut(d2)) return;
            if (!d2.ok) throw new Error(d2.error || 'The message could not be sent.');
            ta.value = '';
            /* Newest message lands at the bottom of the last page. Show it
               inline when that page is on screen; else jump to it. */
            var msgPage = Math.ceil((d.total + 1) / d.per);
            if (msgPage === d.page) {
              d.total += 1;
              var node = dmMsgNode({ sender_hash: state.myHash, body: body, created_at: d2.created_at }, shortName);
              list.appendChild(node);
              status.textContent = 'Sent.';
              node.scrollIntoView();
            } else {
              location.href = 'community.html?dm=' + other + '&p=' + msgPage;
            }
          }).catch(function (err) {
            status.textContent = err.message || 'Network error. Try again in a moment.';
          }).finally(function () {
            send.disabled = false;
            if (window.turnstile && state.widgetId !== null) turnstile.reset(state.widgetId);
          });
        });
        /* The quiet exit: block stops their future messages to you. */
        var blockLine = el('p', 'board-audit-link');
        blockLine.appendChild(identityAction(d.blocked ? 'Unblock this member' : 'Block this member', function () {
          var blocking = !d.blocked;
          if (blocking && !confirm('Block this member? Their future messages will be held out of your sight, and they will never be told. Unblocking delivers everything they wrote meanwhile.')) return;
          fetch(API + '/dm/block', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: state.key, hash: other, blocked: blocking }),
          }).then(function (r) { return r.json(); }).then(function (d3) {
            if (d3.ok) location.reload();
          }).catch(function () {});
        }));
        blockLine.appendChild(document.createTextNode(' · '));
        blockLine.appendChild(identityAction('Delete conversation', function () {
          if (!confirm('Delete this conversation? It is cleared from your inbox; the other member keeps their copy until they delete it too.')) return;
          fetch(API + '/dm/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: state.key, with: other }),
          }).then(function (r) { return r.json(); }).then(function (d3) {
            if (d3.ok) { try { localStorage.removeItem(DM_CACHE); } catch (e) {} location.href = 'community.html?inbox=1'; }
          }).catch(function () {});
        }));
        section.appendChild(blockLine);
        /* Open a conversation at its newest word: on the last page, bring the
           final message into view, above the composer. */
        if (d.messages.length && d.page >= dmPages && list.lastChild) {
          list.lastChild.scrollIntoView();
        }
      })
      .catch(function () {
        crumb([['Catholicity Board', 'community.html'], ['Messages']]);
        section.appendChild(el('p', 'comments-status', 'The conversation could not be loaded. Check your connection and reload the page.'));
      });
  }

  /* A search snippet arrives with matched terms wrapped in STX/ETX control
     characters (which a body can never contain). Split on them and mark the odd
     segments — built from text and <mark> nodes alone, never innerHTML. */
  function searchSnippet(snip) {
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
  function attachAuthorPicker(input) {
    var chosen = '', chosenText = '';
    var sug = el('div', 'mention-suggest');
    sug.hidden = true;
    input.parentNode.insertBefore(sug, input.nextSibling);
    var current = [], sel = 0, timer = null;
    function render() {
      sug.textContent = '';
      if (!current.length) { sug.hidden = true; return; }
      current.forEach(function (u, i) {
        var r = el('a', 'dm-suggest-row' + (i === sel ? ' dm-suggest-sel' : ''));
        r.href = '#';
        r.appendChild(el('span', null, dmLabel(u.hash, u.nick)));
        r.appendChild(el('span', 'dm-suggest-go', 'filter'));
        r.addEventListener('mousedown', function (e) { e.preventDefault(); pick(u); });
        sug.appendChild(r);
      });
      sug.hidden = false;
    }
    function pick(u) {
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
        current = mentionDir
          .map(function (u) { return { u: u, s: Math.max(dmScore(q, u.nick), dmScore(q, displayName(u.hash))), label: dmLabel(u.hash, u.nick) }; })
          .filter(function (x) { return x.s > 0; })
          .sort(function (x, y) { return y.s - x.s || (x.label < y.label ? -1 : 1); })
          .slice(0, 8).map(function (x) { return x.u; });
        sel = 0; render();
      });
    }
    input.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(scan, 120); });
    input.addEventListener('keydown', function (e) {
      if (sug.hidden || !current.length) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(sel + 1, current.length - 1); render(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(sel - 1, 0); render(); }
      else if (e.key === 'Enter') { e.preventDefault(); if (current[sel]) pick(current[sel]); }
      else if (e.key === 'Escape') { current = []; sug.hidden = true; }
    });
    input.addEventListener('blur', function () { setTimeout(function () { sug.hidden = true; }, 200); });
    return {
      hash: function () { return chosen; },
      set: function (hash, label) { chosen = hash; chosenText = '@' + label; input.value = chosenText; },
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
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      location.href = 'community.html?q=' + encodeURIComponent(input.value.trim());
    });
    return form;
  }

  /* Full-text search over the forum, driven entirely by the URL so a result set
     is shareable and pages in place. A query field (quotes for an exact phrase),
     a category filter, an @-author filter, and a relevance/recency sort; each hit
     shows the thread title, a highlighted snippet, author, category, and date, and
     links to the exact post. */
  function viewSearch() {
    var qs = new URLSearchParams(location.search);
    var q = qs.get('q') || '';
    var cat0 = qs.get('cat') || '';
    var author0 = qs.get('author') || '';
    var sort0 = qs.get('sort') || '';
    document.title = 'Search | Catholicity Board';
    crumb([['Catholicity Board', 'community.html'], ['Search']]);

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

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var u = 'community.html?q=' + encodeURIComponent(qInput.value.trim());
      if (catSel.value) u += '&cat=' + catSel.value;
      if (authorPicker.hash()) u += '&author=' + authorPicker.hash();
      if (sortSel.value) u += '&sort=' + sortSel.value;
      location.href = u;
    });

    var count = el('p', 'comments-status', '');
    section.appendChild(count);
    var list = el('div', 'board-topics');
    section.appendChild(list);
    if (!q.trim()) { count.textContent = 'Type a search above. Put "quotes" around an exact phrase.'; return; }

    count.textContent = 'Searching...';
    var page = Math.max(1, Math.floor(Number(qs.get('p')) || 1));
    function apiUrl(pg) {
      var u = API + '/search?q=' + encodeURIComponent(q);
      if (cat0) u += '&cat=' + encodeURIComponent(cat0);
      if (author0) u += '&author=' + encodeURIComponent(author0);
      if (sort0) u += '&sort=' + encodeURIComponent(sort0);
      return u + '&p=' + pg;
    }
    function pageHref(i) {
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
        d.items.forEach(function (it) {
          var rowEl = el('div', 'board-topic');
          var left = el('div', 'board-topic-left');
          var a = el('a', 'board-topic-title', it.title || 'a thread');
          a.href = 'community.html?topic=' + it.topic_id + '#comment-' + it.comment_id;
          left.appendChild(a);
          if (it.snip) left.appendChild(searchSnippet(it.snip));
          rowEl.appendChild(left);
          var who = it.nick || (it.author_hash ? displayName(it.author_hash) : 'Anonymous');
          var ce = catByKey(it.cat);
          rowEl.appendChild(el('div', 'board-stats', who + ' · ' + (ce ? ce[1] : it.cat) + ' · ' + fmtDateTime(it.created_at)));
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

  function startBoard() {
    section.setAttribute('data-nosnippet', '');
    collectAltIps();
    /* Resolve the identity before any view renders, or a keyed visitor
       reads as anonymous and the owner's own links never appear. */
    var ready = state.key ? sha256hex(state.key) : Promise.resolve('');
    ready.then(function (h) {
      state.myHash = h;
      loadMyProfile();
      dmUnreadCheck();
      notifUnreadCheck();
      var params = new URLSearchParams(location.search);
      if (params.get('ipbans')) return viewIpBans();
      if (params.get('notifications')) return viewNotifications();
      if (params.get('inbox')) return viewInbox();
      if (params.get('users')) return viewUsers();
      if (params.get('q') !== null) return viewSearch();
      if (params.get('dm')) return viewDm(params.get('dm'));
      if (params.get('profile')) return viewProfile(params.get('profile'));
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
    collectAltIps();

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
    form.appendChild(mdEditor(textarea));
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
      loadMyProfile();
      dmUnreadCheck();
      notifUnreadCheck();
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
