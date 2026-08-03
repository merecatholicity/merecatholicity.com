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

  /* SWAP-AWARENESS (the app shell, 2026-07-30). The whole client is one
     boot function — booting is exactly what a page load always did, so the
     shell can tear a page down and boot the next with reload parity and
     zero behavioral drift. Teardown = bump the epoch (every long-lived
     poller checks stale() and stands down), abort the boot's global
     listeners (all registered with this boot's signal), and abort any
     in-flight ask streams (the merecat disconnect contract makes that
     SAFE: the question is stored server-side, partials keep flushing, and
     re-entering the thread resumes — a soft swap away is a refresh). */
  var MC_EPOCH = 0;
  var mcDown: any = null;
  function mcBoot() {
  if (mcDown) { try { mcDown(); } catch (e) { /* half-torn is still torn */ } mcDown = null; }
  var epoch = ++MC_EPOCH;
  var bootCtl = new AbortController();
  var bootSig = bootCtl.signal;
  var liveStreams: any[] = [];
  function stale() { return epoch !== MC_EPOCH; }
  mcDown = function () {
    MC_EPOCH++;
    try { bootCtl.abort(); } catch (e) { /* already */ }
    liveStreams.forEach(function (c) { try { c.abort(); } catch (e) { /* already */ } });
    liveStreams.length = 0;
  };

  var API = '/api/comments';
  var SITEKEY = '0x4AAAAAAD8IYH9_xQ0HE0yB';
  var STORAGE = 'mc-comment-key';
  /* The faith declaration a member picks at signup and may change in their
     profile. Codes are stored; labels and order come from the PureScript
     kernel (Domain.Faith via window.mcCore), the same source the worker
     reads — single-sourced, nothing to keep in step by hand. */
  var FAITH_STORE = 'mc-faith';

  /* Faith code↔label + display order, single-sourced from the PureScript
     Domain.Faith via window.mcCore. The bundle is required (Wave F, 2026-08-01):
     the shell always installs mcCore before booting this client. */
  function faithLabel(code: any) {
    return window.mcCore!.faithLabel(code) || '';
  }
  function faithCodes() {
    return window.mcCore!.faiths.map(function (f) { return f.code; });
  }

  /* The scriptorium rank ladder: a member's standing by total live forum posts.
     Thresholds ascend; rankFor returns the highest one reached. The count itself
     rides each post and the profile from the worker (postCountsFor). */
  /* The rank ladder is the first slice migrated to the PureScript domain layer
     (Domain.Rank). When the app shell is present it computes rank; the classic
     body below is the no-bundle fallback, kept as the deliberate no-bundle fallback. See CLAUDE.md. */
  function rankFor(n: any) {
    return window.mcCore!.rankFor(n);
  }
  function rankLine(posts: any) {
    return window.mcCore!.rankLine(posts);
  }
  /* Fingerprints of the site owners' identities. Holding a key that hashes
     to one of these shows delete links on every comment, and the server
     honors those deletes. Publishing the hash reveals nothing usable, the
     power is in the key, which never leaves the owner's browser. */
  var ADMIN_HASHES = ['d1915a05c2583f437b1316971563b3c4c404cff016a016770d91af1f2645f7f6',
    'c83c2b4d105771aafa662a26745ddd2172213ddf5b39d64dfb91f579b5e18b03'];

  /* Custom emoji: image packs a member can drop into a post as :shortcode:. The
     body stores only the plain-text code; the renderer swaps a KNOWN code for a
     same-origin <img> from this whitelist, and an unknown :code: stays literal
     text, so nothing a user writes ever becomes an arbitrary image source. */
  /* Single-sourced from Domain.Emoji via window.mcCore (the same packs the worker
     serves at /config); the inline copy is the no-app fallback. */
  var EMOJI_PACKS: Record<string, [string, string][]> = window.mcCore!.emojiPacks;
  var CUSTOM_EMOJI: Record<string, string> = {};
  Object.keys(EMOJI_PACKS).forEach(function (k) {
    EMOJI_PACKS[k].forEach(function (e: any) { CUSTOM_EMOJI[e[0]] = e[1]; });
  });
  /* Tab 1 of the picker: the common Unicode emoji, inserted as characters and
     stored as UTF-8 like any other text. Split on spaces (no emoji holds one). */
  var STANDARD_EMOJI = ('😀 😃 😄 😁 😆 😅 😂 🤣 🙂 🙃 😉 😊 😇 🥰 😍 🤩 😘 😗 😚 😙 😋 😛 😜 🤪 😝 🤗 🤭 🤫 🤔 🤐 🤨 😐 😑 😶 😏 😒 🙄 😬 😌 😔 😪 🤤 😴 😷 🤒 🤕 🤢 🤮 🤧 🥵 🥶 🥴 😵 🤯 🤠 🥳 😎 🤓 🧐 😕 😟 🙁 😮 😯 😲 😳 🥺 😦 😧 😨 😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 🥱 😤 😡 😠 🤬 😈 👿 💀 💩 🤡 👻 👽 🤖 😺 😸 😹 😻 😼 😽 🙀 😿 😾 👋 🤚 ✋ 🖖 👌 🤌 🤏 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ 👍 👎 ✊ 👊 🤛 🤜 👏 🙌 👐 🤲 🙏 🤝 💪 🖕 ❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 💕 💞 💓 💗 💖 💘 💝 💯 💢 💥 💫 💦 💨 💬 💭 💤 🔥 ⭐ 🌟 ✨ ⚡ 💧 🌈 ☀️ 🎉 🎊 🎁 🏆 🥇 🎯 ✅ ❌ ⭕ ❗ ❓ ⚠️ 🔔 💡 🔑 🔒 🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🙈 🙉 🙊 🐔 🐧 🐦 🦆 🦉 🐺 🐗 🐴 🦄 🐝 🐛 🦋 🐌 🐢 🐍 🐙 🦀 🐟 🐬 🐳 🍎 🍌 🍉 🍇 🍓 🍒 🍑 🍍 🥝 🍅 🥑 🌽 🍄 🍞 🧀 🍔 🍟 🍕 🌭 🌮 🍿 🍩 🍪 🎂 🍰 🍫 🍬 🍭 🍺 🍻 🥂 🍷 ☕ 🍵').split(' ');
  /* Named standard emoji: the subset reachable by a :shortcode:, so the : helper
     and manual typing resolve common names (:fire:, :joy:) to a character, the
     same path custom pack codes take. name/char pairs, char never holding a
     space. A :code: matches a custom image first, then a name here, else stays
     literal text. */
  var NAMED_EMOJI: Record<string, string> = {};
  (window.mcCore!.emojiNamedTokens).trim().split(/\s+/).forEach(function (tok, i, a) { if (i % 2 === 0) NAMED_EMOJI[tok] = a[i + 1]; });


  function displayName(hash: any) {
    return window.mcCore!.displayName(hash);
  }

  function pagePath() {
    var p = location.pathname;
    if (p.slice(-1) === '/') p += 'index.html';
    if (p.slice(-5) !== '.html') p += '.html';
    return p;
  }

  function el(tag: string, cls?: string | null, text?: string | number | null): any {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text as string;
    return node;
  }

  /* Inline markup, parsed left-to-right in one pass and built ONLY from
     createElement + text nodes (never innerHTML), so nothing a user writes can
     inject markup. Precedence: **bold**, then *italic*, then a link written
     [text](url) or as a bare URL, then a :shortcode: emoji. Only http(s) URLs
     are ever linkified, so javascript: and data: (and any stray marker) stay
     inert text; a same-site link goes straight through, an off-site one is
     routed via the away.html warning page (see appendRich). The ONLY images are
     :shortcode: emoji resolved against a fixed whitelist to a same-origin path
     (CUSTOM_EMOJI); an unknown :token: stays literal text, so a body can never
     name an arbitrary image source. */
  /* Scripture references ("Rom 8:28-30", "John 3:16", "1 Cor 13:4") link to the
     exact verse in our own KJV (kjv.html, where deeplink.js has stamped every
     verse with a <slug>-<chapter>-<verse> id). A bare book name never links: a
     chapter:verse is required. BIBLE maps every accepted spelling/abbreviation
     to the verse-anchor slug and yields the regex fragment (book, chapter,
     verse) spliced into INLINE_MD below. Two-letter forms that are common
     English words (is/am/so/re) are deliberately omitted to avoid false hits. */
  var BIBLE = (function () {
    var spec = [
      ['genesis', 'genesis|gen|ge|gn'], ['exodus', 'exodus|exod|exo|ex'],
      ['leviticus', 'leviticus|lev|lv'], ['numbers', 'numbers|num|nm|nb'],
      ['deuteronomy', 'deuteronomy|deut|deu|dt'], ['joshua', 'joshua|josh|jos|jsh'],
      ['judges', 'judges|judg|jdg|jg'], ['ruth', 'ruth|rth|ru'],
      ['1-samuel', '1 samuel|1samuel|1 sam|1sam|1 sa|i samuel|i sam|first samuel'],
      ['2-samuel', '2 samuel|2samuel|2 sam|2sam|2 sa|ii samuel|ii sam|second samuel'],
      ['1-kings', '1 kings|1kings|1 kgs|1kgs|1 ki|i kings|i kgs|first kings'],
      ['2-kings', '2 kings|2kings|2 kgs|2kgs|2 ki|ii kings|ii kgs|second kings'],
      ['1-chronicles', '1 chronicles|1 chron|1 chr|1chr|1 ch|i chronicles|i chron|first chronicles'],
      ['2-chronicles', '2 chronicles|2 chron|2 chr|2chr|2 ch|ii chronicles|ii chron|second chronicles'],
      ['ezra', 'ezra|ezr|ez'], ['nehemiah', 'nehemiah|neh|ne'],
      ['esther', 'esther|esth|est|es'], ['job', 'job|jb'],
      ['psalms', 'psalms|psalm|pslm|psa|ps|pss|psm'], ['proverbs', 'proverbs|prov|pro|prv|pr'],
      ['ecclesiastes', 'ecclesiastes|eccles|eccl|ecc|ec|qoh'],
      ['song-of-solomon', 'song of solomon|song of songs|song|sos|canticles|cant'],
      ['isaiah', 'isaiah|isa|isai'], ['jeremiah', 'jeremiah|jer|je|jr'],
      ['lamentations', 'lamentations|lam|la'], ['ezekiel', 'ezekiel|ezek|eze|ezk'],
      ['daniel', 'daniel|dan|da|dn'], ['hosea', 'hosea|hos|ho'],
      ['joel', 'joel|joe|jl'], ['amos', 'amos|amo'], ['obadiah', 'obadiah|obad|oba|ob'],
      ['jonah', 'jonah|jon|jnh'], ['micah', 'micah|mic|mc'], ['nahum', 'nahum|nah|na'],
      ['habakkuk', 'habakkuk|hab|hb'], ['zephaniah', 'zephaniah|zeph|zep|zp'],
      ['haggai', 'haggai|hag|hg'], ['zechariah', 'zechariah|zech|zec|zc'],
      ['malachi', 'malachi|mal|ml'], ['matthew', 'matthew|matt|mat|mt'],
      ['mark', 'mark|mrk|mar|mk|mr'], ['luke', 'luke|luk|lk'],
      ['john', 'john|jhn|joh|jn'], ['acts', 'acts|act|ac'],
      ['romans', 'romans|rom|ro|rm'],
      ['1-corinthians', '1 corinthians|1 cor|1cor|1 co|i corinthians|i cor|first corinthians'],
      ['2-corinthians', '2 corinthians|2 cor|2cor|2 co|ii corinthians|ii cor|second corinthians'],
      ['galatians', 'galatians|gal|ga'], ['ephesians', 'ephesians|ephes|eph'],
      ['philippians', 'philippians|phil|php|pp'], ['colossians', 'colossians|col'],
      ['1-thessalonians', '1 thessalonians|1 thess|1thess|1 thes|1 th|i thessalonians|i thess|first thessalonians'],
      ['2-thessalonians', '2 thessalonians|2 thess|2thess|2 thes|2 th|ii thessalonians|ii thess|second thessalonians'],
      ['1-timothy', '1 timothy|1 tim|1tim|1 ti|i timothy|i tim|first timothy'],
      ['2-timothy', '2 timothy|2 tim|2tim|2 ti|ii timothy|ii tim|second timothy'],
      ['titus', 'titus|tit|ti'], ['philemon', 'philemon|philem|phlm|phm|pm'],
      ['hebrews', 'hebrews|heb|hb'], ['james', 'james|jas|jm'],
      ['1-peter', '1 peter|1 pet|1pet|1 pe|1 pt|i peter|i pet|first peter'],
      ['2-peter', '2 peter|2 pet|2pet|2 pe|2 pt|ii peter|ii pet|second peter'],
      ['1-john', '1 john|1 jhn|1 jn|1jn|i john|i jn|first john'],
      ['2-john', '2 john|2 jhn|2 jn|2jn|ii john|ii jn|second john'],
      ['3-john', '3 john|3 jhn|3 jn|3jn|iii john|iii jn|third john'],
      ['jude', 'jude|jud|jd'], ['revelation', 'revelation|revelations|rev|apocalypse|apoc']
    ];
    var map: Record<string, string> = {}, forms: any[] = [];
    spec.forEach(function (row) {
      row[1].split('|').forEach(function (f) {
        f = f.trim(); if (!f) return; map[f] = row[0]; forms.push(f);
      });
    });
    forms.sort(function (a, b) { return b.length - a.length; });   // longest-first
    var alt = forms.map(function (f) {
      return f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+');
    }).join('|');
    return { map: map, src: '(' + alt + ')\\.?[ \\t]+(\\d+):(\\d+)(?:[\\-\\u2013](\\d+))?' };
  })();

  /* Any anchor whose href lands on a KJV verse gets the hover-preview data,
     however the anchor was born: a plain written reference, a markdown link
     (merecat writes those), or a sources-footer entry. The slug is greedy, so
     1-corinthians-6-9 splits book/chapter/verse correctly; a chapter-only
     hash (no verse) stays undecorated since there is nothing to preview. */
  function scriptureDecor(a: any, url: any) {
    if (window.mcRich) return window.mcRich.scriptureDecor(a, url);
    var m = /(?:^|\/)kjv\.html#([a-z0-9-]+)-(\d+)-(\d+)$/.exec(String(url || ''));
    var dr = null;
    if (!m) {
      dr = /(?:^|\/)douay-rheims\.html#([a-z0-9-]+)-(\d+)-(\d+)$/.exec(String(url || ''));
      m = dr;
    }
    if (!m) return;
    a.className += ' scripture-link';
    if (dr) a.setAttribute('data-bible', 'dr');
    a.setAttribute('data-slug', m[1]);
    a.setAttribute('data-ch', m[2]);
    a.setAttribute('data-v1', m[3]);
    /* A range written in the link's own text ("1 Cor 6:9-10") previews whole,
       as a plainly written reference would; the URL carries only the first
       verse. The text's range must start at the URL's verse or the URL wins. */
    var r = /:(\d+)\s*[-\u2013]\s*(\d+)\s*$/.exec(a.textContent || '');
    a.setAttribute('data-v2', (r && r[1] === m[3]) ? r[2] : m[3]);
  }

  /* The base inline grammar; the scripture group (book=6, chapter=7, verse=8) is
     appended so a reference becomes a same-site verse link in appendRich. */
  var INLINE_BASE = /\*\*([^\n]+?)\*\*|\*(\S[^*\n]*?)\*|\[([^\]\n]+)\]\((https?:\/\/[^\s<>"')]+)\)|https?:\/\/[^\s<>"']+|:([a-z0-9_+-]{1,40}):/gi;
  var INLINE_MD = new RegExp(INLINE_BASE.source + '|' + BIBLE.src, 'gi');

  /* Append rich inline text to a node: the marked spans above become <strong>,
     <em>, and same-site <a> nodes, everything else plain text. Emphasis nests
     (a link inside bold works) by recursing on the strictly-shorter inner text.
     Shared by the body renderer and each quoted/list line. */
  function appendRich(target: HTMLElement, str: any, plain?: boolean): any {
    /* Wave B3a: the living renderer is app/richtext.js when the bundle
       stands; this body is the frozen no-bundle fallback (the deliberate no-bundle fallback). */
    if (window.mcRich) return window.mcRich.appendRich(target, str, plain);
    /* plain mode — the librarian's leash: every markdown feature is consumed
       but none applies, so the bot may write **bold** all day and the reader
       sees only "bold". Scripture autolinks and [text](url) links stay live
       (the sources depend on them). Humans always render in full. */
    var s = String(str == null ? '' : str);
    /* A fresh matcher per call: appendRich recurses into emphasis, and a single
       shared global regex's lastIndex would be clobbered by the inner call. */
    var re = new RegExp(INLINE_MD.source, 'gi');
    var last = 0, m;
    while ((m = re.exec(s))) {
      if (m[0].length === 0) { re.lastIndex++; continue; }
      if (m.index > last) target.appendChild(document.createTextNode(s.slice(last, m.index)));
      if (m[1] !== undefined) {
        if (plain) { appendRich(target, m[1], plain); } else {
          var strong = el('strong');
          appendRich(strong, m[1]);
          target.appendChild(strong);
        }
      } else if (m[2] !== undefined) {
        if (plain) { appendRich(target, m[2], plain); } else {
          var em = el('em');
          appendRich(em, m[2]);
          target.appendChild(em);
        }
      } else if (m[5] !== undefined) {
        target.appendChild(emojiToken(m[5], m[0]));
      } else if (m[6] !== undefined) {
        /* A scripture reference: link to the exact verse in our KJV, or, if the
           book isn't one we know, leave the whole thing as plain text. A range
           (8:28-30) points at its first verse. */
        var slug = BIBLE.map[m[6].toLowerCase().replace(/\s+/g, ' ')];
        if (slug) {
          var sa = el('a', 'body-link scripture-link');
          sa.href = 'kjv.html#' + slug + '-' + m[7] + '-' + m[8];
          /* Parts kept for the on-hover verse preview (see scriptureHover). */
          sa.setAttribute('data-slug', slug);
          sa.setAttribute('data-ch', m[7]);
          sa.setAttribute('data-v1', m[8]);
          sa.setAttribute('data-v2', m[9] || m[8]);
          sa.appendChild(document.createTextNode(m[0]));
          target.appendChild(sa);
        } else {
          target.appendChild(document.createTextNode(m[0]));
        }
      } else {
        var url = m[3] !== undefined ? m[4] : m[0];
        var a = el('a', 'body-link', m[3] !== undefined ? m[3] : m[0]);
        if (/^https?:\/\/(?:www\.)?merecatholicity\.com(?:[\/?#]|$)/i.test(url)) {
          a.href = url;
          scriptureDecor(a, url);
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
  function fillBody(node: HTMLElement, text: any, plain?: boolean): any {
    if (window.mcRich) return window.mcRich.fillBody(node, text, plain);
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
        if (plain) {
          var qp = el('p');
          appendRich(qp, quoted.join('\n'), plain);
          node.appendChild(qp);
        } else {
          var bq = el('blockquote', 'comment-quote');
          appendRich(bq, quoted.join('\n'));
          node.appendChild(bq);
        }
      } else if (/^[-*] /.test(lines[i])) {
        if (plain) {
          var items = [];
          while (i < lines.length && /^[-*] /.test(lines[i])) {
            items.push(lines[i].replace(/^[-*] +/, ''));
            i++;
          }
          var lp = el('p');
          appendRich(lp, items.join('\n'), plain);
          node.appendChild(lp);
        } else {
          var ul = el('ul', 'comment-list');
          while (i < lines.length && /^[-*] /.test(lines[i])) {
            var li = el('li');
            appendRich(li, lines[i].replace(/^[-*] +/, ''));
            ul.appendChild(li);
            i++;
          }
          node.appendChild(ul);
        }
      } else if (/^#{1,5} /.test(lines[i])) {
        /* A heading line: one to five #-marks then a space. Rendered as a
           styled paragraph, not a real h-element, so a comment can never
           pollute the page's own outline; inline markdown still applies
           inside. Six or more marks, or no space, stays literal text. In
           plain mode the marks are consumed and the text stands unstyled. */
        var hm = /^(#{1,5}) +(.*)$/.exec(lines[i])!;
        if (plain) {
          var hp = el('p');
          appendRich(hp, hm[2], plain);
          node.appendChild(hp);
        } else {
          ensureEmojiStyles();
          var hd = el('p', 'mc-hd mc-hd' + hm[1].length);
          appendRich(hd, hm[2]);
          node.appendChild(hd);
        }
        i++;
      } else {
        var run = [];
        while (i < lines.length && !/^>/.test(lines[i]) && !/^[-*] /.test(lines[i]) &&
               !/^#{1,5} /.test(lines[i])) {
          run.push(lines[i]);
          i++;
        }
        appendRich(node, run.join('\n'), plain);
      }
    }
    return node;
  }

  function profileHref(hash: any) {
    return 'profile.html?u=' + hash;
  }

  /* An author's visible name: the custom nick when set, the assigned pseudonym
     otherwise, always a link to the profile. Anonymous authors have no profile
     and stay plain text. With a nick set, the assigned name rides along as a
     muted, equally-clickable line (withSub), so the authoritative identifier
     is never lost. Text goes through el()/textContent, never innerHTML. */
  function authorNode(hash: any, nick: any, withSub: any, faith?: any, posts?: any) {
    if (!hash) return el('span', 'comment-author', 'Anonymous');
    var wrap = el('span', 'comment-author');
    var primary = el('a', 'comment-author-link', nick || displayName(hash));
    primary.href = profileHref(hash);
    /* ONE quiet line (the readability standard): the assigned pseudonym and
       the exact post count ride the link's title (and the profile page) —
       the old stacked sub/faith/rank lines are gone. withSub now gates only
       the tooltip's pseudonym half. */
    var tip: string[] = [];
    if (withSub && nick) tip.push(displayName(hash));
    if (posts != null) tip.push((Number(posts) || 0) + ' posts');
    if (tip.length) primary.title = tip.join(' · ');
    wrap.appendChild(primary);
    /* Faith + rank: dim inline suffixes beside the name (CSS supplies the `·`
       separators as pseudo-content, so textContent stays clean). Rank shows
       the LABEL alone — the count lives in the tooltip. */
    var fl = faith && faithLabel(faith);
    if (fl) wrap.appendChild(el('span', 'comment-faith', fl));
    if (posts != null) wrap.appendChild(el('span', 'comment-faith comment-rank', rankFor(Number(posts) || 0)));
    return wrap;
  }

  /* The member's declared faith lives in localStorage from signup and rides
     along with each post; the profile edit is the authoritative changer. */
  function getFaith() {
    try { var v = localStorage.getItem(FAITH_STORE); return faithLabel(v) ? v : ''; } catch (e) { return ''; }
  }
  function setFaith(code: any) {
    try { if (faithLabel(code)) localStorage.setItem(FAITH_STORE, code); } catch (e) {}
  }

  /* Mute is self-moderation for a pseudonymous room: a purely local list of
     hashes whose posts collapse for you alone. No server, orthogonal to the DM
     block (which holds their messages to you) — this only hides their forum
     posts, on this browser. */
  var MUTED_STORE = 'mc-muted';
  function getMuted() {
    try { var a = JSON.parse(localStorage.getItem(MUTED_STORE) as string); return Array.isArray(a) ? a : []; } catch (e) { return []; }
  }
  /* The librarian cannot be muted: it speaks only when summoned, so a muted
     bot would read as a broken summons (a stale stored mute is ignored too). */
  function isMuted(hash: any) {
    if (window.mcCore) return window.mcCore.isMuted(MERECAT_BOT_HASH, hash, getMuted());
    if (hash === MERECAT_BOT_HASH) return false;
    return !!hash && getMuted().indexOf(hash) !== -1;
  }
  /* Mutes follow the member now: the list rides the prefs row server-side
     (like blocks), so a second device sees the same quiet. localStorage stays
     the fast local truth; the server copy is merged in by loadPrefs and
     written through here, best effort. */
  function syncMutedUp() {
    if (!state.key) return;
    fetch(API + '/prefs', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: state.key, set: { muted: getMuted().slice(0, 200) } }),
    }).catch(function () { /* best effort */ });
  }
  function toggleMute(hash: any) {
    if (!hash) return false;
    var added;
    if (window.mcCore) {
      var r = window.mcCore.toggleMute(hash, getMuted());
      try { localStorage.setItem(MUTED_STORE, JSON.stringify(r.list)); } catch (e) {}
      added = r.added;
    } else {
      var a = getMuted(), i = a.indexOf(hash);
      if (i === -1) a.push(hash); else a.splice(i, 1);
      try { localStorage.setItem(MUTED_STORE, JSON.stringify(a)); } catch (e) {}
      added = i === -1;
    }
    syncMutedUp();
    return added;
  }
  /* BLOCK is the ONE member-facing control now (the owner's 2026-08-03
     ruling: "User can block. User can unblock. that is it."). One act closes
     both doors — their messages to you (the DM shadow-block, server-side in
     dm_blocks) and their posts/profile in your view (the hide-list above,
     server-synced through /prefs). The old member-facing "mute" surface is
     retired; the list machinery survives underneath as block's hide half.
     Admin moderation (locks, bans, shadow bans, delete) is a separate,
     untouched world. */
  function isBlocked(hash: any) { return isMuted(hash); }
  function setBlock(hash: any, on: any, done?: any) {
    if (!hash || hash === MERECAT_BOT_HASH || hash === state.myHash) { if (done) done(); return; }
    var a = getMuted(), i = a.indexOf(hash);
    if (on && i === -1) a.push(hash);
    if (!on && i !== -1) a.splice(i, 1);
    try { localStorage.setItem(MUTED_STORE, JSON.stringify(a)); } catch (e) { /* hide-list is best effort */ }
    syncMutedUp();
    fetch(API + '/dm/block', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: state.key, hash: hash, blocked: !!on }),
    }).then(function (r) { return r.json(); })
      .catch(function () { /* the hide half already stands; the DM half heals on the next toggle */ })
      .then(function () { if (done) done(); });
  }
  var BLOCK_CONFIRM = 'Block this member? They can no longer message you (they are never told), and their posts and profile are hidden from you. You can unblock them any time in Settings or from their profile.';
  /* The "I hold to:" radio group, one row per faith, used at signup and in the
     profile editor. onChange fires with the chosen code. */
  function faithRadios(current: any, onChange: any) {
    var wrap = el('div', 'faith-radios');
    wrap.appendChild(el('div', 'faith-legend', 'I hold to:'));
    faithCodes().forEach(function (code) {
      var lab = el('label', 'faith-option');
      var r = el('input');
      r.type = 'radio';
      r.name = 'mc-faith-choice';
      r.value = code;
      if (code === current) r.checked = true;
      r.addEventListener('change', function () { if (r.checked && onChange) onChange(code); });
      lab.appendChild(r);
      lab.appendChild(document.createTextNode(' ' + faithLabel(code)));
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
      var timer = ctl ? setTimeout(function () { ctl!.abort(); }, 2000) : null;
      fetch('https://' + fam + '.icanhazip.com', ctl ? { signal: ctl.signal } : {})
        .then(function (r) { return r.ok ? r.text() : ''; })
        .then(function (txt) {
          var ip = String(txt || '').trim();
          if (ip && ip.length <= 45 && /^[0-9a-fA-F:.]+$/.test(ip)) (state.altIps as any)[fam] = ip;
        })
        .catch(function () {})
        .finally(function () { if (timer) clearTimeout(timer); });
    });
  }

  /* Carrier-grade NAT (100.64.0.0/10) is shared by many customers, so the
     drawer warns before an admin bans such a v4. */
  function isSharedV4Client(ip: any) {
    var m = /^(\d{1,3})\.(\d{1,3})\./.exec(ip || '');
    return !!m && +m[1] === 100 && +m[2] >= 64 && +m[2] <= 127;
  }

  /* Bounded retries for network failures only. An HTTP response of any
     status is final: the server spoke, retrying could only double an
     action. A rejected fetch means nothing arrived, so a short backoff
     and another try are safe, and the attempt count is small on purpose:
     after the last one the reader's manual refresh is the only restart.
     Every attempt also carries a hard timeout: a fetch that never settles
     (a flaky mobile radio, service-worker limbo) once hung a view's
     "Loading…" forever with no error and no retry — an aborted attempt is
     a network failure and rides the same ladder. Callers that manage their
     own AbortSignal keep it; the timeout only guards unsignalled calls. */
  var FETCH_TIMEOUT = 15000;
  function fetchRetry(url: string, opts: RequestInit | undefined, delays: number[], onRetry?: () => void): Promise<Response> {
    function attempt(i: number): Promise<Response> {
      var init = opts;
      var timer = 0;
      if (typeof AbortController === 'function' && !(opts && opts.signal)) {
        var ctrl = new AbortController();
        init = Object.assign({}, opts, { signal: ctrl.signal });
        timer = window.setTimeout(function () { ctrl.abort(); }, FETCH_TIMEOUT);
      }
      return fetch(url, init).then(function (res) {
        if (timer) clearTimeout(timer);
        return res;
      }, function (err) {
        if (timer) clearTimeout(timer);
        if (i >= delays.length) throw new Error('Network error. Check your connection and try again.');
        if (onRetry) onRetry();
        return new Promise(function (resolve) { setTimeout(resolve, delays[i]); })
          .then(function () { return attempt(i + 1); });
      });
    }
    return attempt(0);
  }

  /* ---- The shared read budget: one brain over every polling limb. ----
     Each quiet endpoint draws from a single per-IP server bucket (READ_LIMIT,
     120 reads a minute). A page can keep several background polls alive at
     once — a resume watching a thread grow, the reconciler guarding a live
     answer, a recovery poll after a dropped stream, the two unread badges —
     and the reader's own clicks (opening Past conversations, a thread) draw
     from that very same bucket. Cadences tuned in isolation cannot feel one
     another and can sum past the ceiling, throttling the reader through no
     fault of theirs. So the pollers share one sense of pressure here: every
     polled read is stamped in a rolling minute, a throttle felt ANYWHERE eases
     them all at once, and a poll about to fire stretches its own gap when the
     minute is nearly full — keeping background traffic clear of the ceiling so
     the reader's own reads always have room to land. A page reload starts this
     ledger empty while the server's window lives on, so the reactive ease (any
     429, from any poller or click) is the true safety net; the ledger only
     smooths the steady state. */
  var READ_CEIL = 120;                // the server bucket: reads per minute per IP (keep in step with wrangler.jsonc READ_LIMIT)
  var readStamps: any[] = [];                // times of recent polled reads
  var readEaseUntil = 0;              // a throttle anywhere eases every poller until here
  function readTrim(now: any) { while (readStamps.length && readStamps[0] <= now - 60000) readStamps.shift(); }
  function readMark() { var now = Date.now(); readTrim(now); readStamps.push(now); }
  function readEase() { readEaseUntil = Date.now() + 15000; }
  function readThrottled(d: any) { return !!(d && d.error && /too many|slow down/i.test(String(d.error))); }
  /* The gap a background poll honours before its next tick: its own base
     cadence, stretched while a throttle is easing everyone or the rolling
     minute is within two of the ceiling, so contention slows the whole body
     as one and the reader's reads keep their headroom. A quiet page leaves the
     base untouched, so a lone poll stays as snappy as it was tuned to be. */
  function readPace(base: any) {
    var now = Date.now();
    readTrim(now);
    var gap = base;
    if (now < readEaseUntil) gap = Math.max(gap, readEaseUntil - now, 8000);
    if (readStamps.length >= READ_CEIL - 2) gap = Math.max(gap, 12000);
    return gap;
  }

  /* Timestamps are stored as UTC epochs; toLocaleString renders them in each
     reader's own timezone, date and time together. */
  function fmtDateTime(epoch: any) {
    return new Date(epoch * 1000).toLocaleString('en-US',
      { year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  /* Compact timestamps for post heads and list rows (the readability standard):
     today -> '2:49 PM', this year -> 'Jul 31', older -> 'Jul 2025'. Consumers
     put the full fmtDateTime on the title attribute; prose sentences keep the
     full form. */
  function fmtTimeCompact(epoch: any) {
    var d = new Date(epoch * 1000), now = new Date();
    if (d.toDateString() === now.toDateString())
      return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    if (d.getFullYear() === now.getFullYear())
      return d.toLocaleString('en-US', { month: 'short', day: 'numeric' });
    return d.toLocaleString('en-US', { month: 'short', year: 'numeric' });
  }

  /* Admin status comes from the server (state.myAdmin, off your own profile).
     Before that profile has loaded the built-in list is only a hint, so a known
     admin's controls are not withheld for a beat; once it loads the server is
     the sole authority, so an admin removed elsewhere loses the controls here
     too. The board re-renders when the answer changes (see loadMyProfile). */
  function authSig() {
    return { hasKey: state.key, hasHash: state.myHash, profileLoaded: state.profileLoaded,
      myAdmin: state.myAdmin, hint: ADMIN_HASHES.indexOf(state.myHash) !== -1 };
  }
  function isAdmin() {
    if (window.mcCore) return window.mcCore.authIsAdmin(authSig());
    if (!state.key) return false;
    if (state.profileLoaded) return state.myAdmin;
    return state.myAdmin || ADMIN_HASHES.indexOf(state.myHash) !== -1;
  }
  /* A resolved, logged-in member (key + hash). Single-sources the "is member"
     decision (Domain.Auth.isMember) that was inlined as the raw key-and-hash
     conjunction across the board; the classic conjunction is the no-bundle fallback. */
  function isMember() {
    if (window.mcCore) return window.mcCore.authIsMember(authSig());
    return !!(state.key && state.myHash);
  }

  /* Callbacks waiting on the reader's own profile fetch, so a view that renders
     before admin status is known can redraw once it lands. */
  var profileWaiters: any[] = [];

  /* Guard for an admin-only view. Owners pass at once. If we cannot yet tell (a
     key is present but its profile has not loaded), show a neutral wait and
     redraw when it does, rather than flash a false "not for you". With no key,
     or once the profile is in, the answer is certain. Returns true when the
     caller should stop. */
  function adminGate(rerender: any) {
    var g = window.mcCore ? window.mcCore.authGate(authSig())
      : (isAdmin() ? 'pass' : ((!state.key || state.profileLoaded) ? 'deny' : 'wait'));
    if (g === 'pass') return false;
    if (g === 'deny') {
      section.appendChild(el('p', 'comments-status', 'This page is for the admins.'));
      return true;
    }
    section.appendChild(el('p', 'comments-status', 'Loading...'));
    if (rerender) profileWaiters.push(function () { section.textContent = ''; rerender(); });
    return true;
  }

  function sha256hex(text: any) {
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)).then(function (buf) {
      return Array.prototype.map.call(new Uint8Array(buf), function (x) {
        return ('0' + x.toString(16)).slice(-2);
      }).join('');
    });
  }

  function getKey() {
    try { return localStorage.getItem(STORAGE) || ''; } catch (e) { return ''; }
  }
  function setKey(key: any) {
    if (window.mcStore) window.mcStore.invalidate();
    try { localStorage.setItem(STORAGE, key); } catch (e) {}
  }
  function clearKey() {
    try { localStorage.removeItem(STORAGE); } catch (e) {}
    try { localStorage.removeItem('mc-admin'); } catch (e) {}
  }
  function makeKey() {
    var bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return btoa(String.fromCharCode.apply(null, bytes as unknown as number[]))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  /* ---- End-to-end-encrypted DM crypto (TweetNaCl, loaded on demand) ---------
     Each identity derives an X25519 keypair deterministically from the secret
     behind its localStorage key, so nothing new is stored and carrying the key to
     another browser reproduces the same keypair. Only the PUBLIC half is ever
     published (/dm/pubkey). A message is sealed with the pair's shared secret
     X25519(mine, theirs), which both sides compute identically — so one
     ciphertext is opened by the recipient AND re-read later by the sender. The
     server only ever holds the opaque "E1.<nonce>.<ct>" blob and cannot decrypt.
     nacl is the vendored tweetnacl.min.js, injected once on first use. */
  var NACL_SRC = 'tweetnacl.min.js?v=1';
  var _naclP: any = null;
  function ensureNacl() {
    if (window.nacl) return Promise.resolve(window.nacl);
    if (_naclP) return _naclP;
    _naclP = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = NACL_SRC;
      s.async = true;
      s.onload = function () { if (window.nacl) resolve(window.nacl); else { _naclP = null; reject(new Error('nacl')); } };
      s.onerror = function () { _naclP = null; reject(new Error('nacl load failed')); };
      document.head.appendChild(s);
    });
    return _naclP;
  }
  function dmB64uEnc(bytes: any) {
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function dmB64uDec(str: any) {
    var s = String(str).replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    var bin = atob(s);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  /* Keypair from the identity secret, cached until the key changes. SHA-512 of a
     domain-separated copy of the secret gives a 32-byte curve25519 seed (the
     secret is already 256-bit uniform, so this is a clean PRF); tweetnacl clamps
     it internally when it computes the public half. */
  var _dmKP: any = null, _dmKPFor: any = null;
  function myDmKeypair() {
    if (_dmKP && _dmKPFor === state.key) return _dmKP;
    var seed = nacl.hash(new TextEncoder().encode('mc/dm/x25519/v1|' + state.key)).subarray(0, 32);
    _dmKP = nacl.box.keyPair.fromSecretKey(new Uint8Array(seed));
    _dmKPFor = state.key;
    return _dmKP;
  }
  function dmEncrypt(plaintext: any, otherPubB64: any) {
    var kp = myDmKeypair();
    var nonce = nacl.randomBytes(24);
    var ct = nacl.box(new TextEncoder().encode(plaintext), nonce, dmB64uDec(otherPubB64), kp.secretKey);
    return 'E1.' + dmB64uEnc(nonce) + '.' + dmB64uEnc(ct);
  }
  function dmDecrypt(blob: any, otherPubB64: any) {
    if (typeof blob !== 'string' || blob.slice(0, 3) !== 'E1.' || !otherPubB64) return null;
    var parts = blob.split('.');
    if (parts.length !== 3) return null;
    try {
      var pt = nacl.box.open(dmB64uDec(parts[2]), dmB64uDec(parts[1]), dmB64uDec(otherPubB64), myDmKeypair().secretKey);
      return pt ? new TextDecoder().decode(pt) : null;
    } catch (e) { return null; }
  }
  /* A per-conversation safety number: a short fingerprint of the two public keys,
     ordered the same way on both sides so both compute the identical code. Two
     people compare it out of band to be sure no key was substituted. */
  function dmSafetyNumber(otherPubB64: any) {
    try {
      var mineBytes = myDmKeypair().publicKey;
      var mineB64 = dmB64uEnc(mineBytes);
      var theirBytes = dmB64uDec(otherPubB64);
      var mineFirst = mineB64 < otherPubB64;
      var f = mineFirst ? mineBytes : theirBytes;
      var s = mineFirst ? theirBytes : mineBytes;
      var cat = new Uint8Array(f.length + s.length);
      cat.set(f, 0); cat.set(s, f.length);
      var h = nacl.hash(cat);
      var hex = '';
      for (var i = 0; i < 10; i++) hex += ('0' + h[i].toString(16)).slice(-2);
      return hex.toUpperCase().replace(/(.{4})/g, '$1 ').trim();
    } catch (e) { return ''; }
  }
  /* Publish my public key once per session (idempotent server-side). Fired when
     an identity goes live, so any active member is reachable for an encrypted DM. */
  var _pubkeyFor: any = null;
  function ensureMyPubkey() {
    if (!state.key || !state.myHash || _pubkeyFor === state.key) return;
    var forKey = state.key;
    _pubkeyFor = forKey;
    ensureNacl().then(function () {
      return fetch(API + '/dm/pubkey', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: forKey, pubkey: dmB64uEnc(myDmKeypair().publicKey) }),
      });
    }).then(function (r: any) { return r.json(); })
      .then(function (d: any) { if (!d || !d.ok) { if (_pubkeyFor === forKey) _pubkeyFor = null; } })
      .catch(function () { if (_pubkeyFor === forKey) _pubkeyFor = null; });
  }
  /* Which correspondents this browser has marked "safety number verified". */
  var DM_VERIFIED = 'mc-dm-verified';
  function dmVerifiedSet() { try { var a = JSON.parse(localStorage.getItem(DM_VERIFIED) as string); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
  function dmVerified(other: any) { return dmVerifiedSet().indexOf(other) !== -1; }
  function dmMarkVerified(other: any) {
    var a = dmVerifiedSet();
    if (a.indexOf(other) === -1) { a.push(other); try { localStorage.setItem(DM_VERIFIED, JSON.stringify(a)); } catch (e) {} }
  }
  /* The honest "how it works" note behind the badge — confident, scoped to what
     the design actually guarantees (stored ciphertext, keys never leave you). */
  function dmE2eExplainer() {
    appConfirm(
      'End-to-end encrypted. Your messages are encrypted on your own device before they are sent. '
      + 'We store them only as ciphertext, we do not hold the keys, and we cannot read your inbox — '
      + 'only you and the person you are writing to can open them. The encryption is standard, open '
      + 'X25519 + XSalsa20-Poly1305 (NaCl), and the code that runs it is public in our repository. '
      + 'To be sure no one is in the middle, compare the safety number at the top of a conversation. '
      + 'One thing to keep in mind: because only you hold your key, a lost key means the encrypted '
      + 'history cannot be recovered — not even by us.',
      { okLabel: 'Got it', cancelLabel: 'Close' }, function () {});
  }
  /* The tucked-away verify step: reveal the safety number and let the reader mark
     the pair confirmed (remembered locally, so it never nags again). */
  function dmVerifyPanel(other: any, otherPubB64: any, link: any) {
    appConfirm(
      'Safety number: ' + dmSafetyNumber(otherPubB64) + '.  '
      + 'Read this aloud with the person you are messaging. If it matches on both sides, no one is '
      + 'intercepting this conversation. This is optional — your messages are encrypted either way.',
      { okLabel: 'Mark verified', cancelLabel: 'Close' }, function (ok: any) {
        if (ok) { dmMarkVerified(other); if (link) link.textContent = '✓ verified'; }
      });
  }
  /* The quiet "🔒 End-to-end encrypted" badge, shared by the inbox and the thread
     view: the honest explainer one tap away, and — when a specific correspondent
     is in view — the optional safety-number verify. No PIN, no friction. */
  function dmE2eBadge(other?: any, otherPubB64?: any) {
    var e2e = el('p', 'dm-e2e');
    e2e.appendChild(document.createTextNode('🔒 End-to-end encrypted · '));
    var how = el('a', null, 'how it works');
    how.href = '#';
    how.addEventListener('click', function (ev: any) { ev.preventDefault(); dmE2eExplainer(); });
    e2e.appendChild(how);
    if (other && otherPubB64) {
      e2e.appendChild(document.createTextNode(' · '));
      var v = el('a', null, dmVerified(other) ? '✓ verified' : 'verify');
      v.href = '#';
      v.addEventListener('click', function (ev: any) { ev.preventDefault(); dmVerifyPanel(other, otherPubB64, v); });
      e2e.appendChild(v);
    }
    return e2e;
  }
  /* ---- Disappearing messages: the expiry note + chooser, and the per-message
     save toggle. The lifetime is per-conversation; either party changes it and
     the last write wins for both. Saving a message exempts it for both. ---- */
  function dmTtlLabel(ttl: any) {
    if (window.mcCore) return window.mcCore.dmTtlLabel(ttl);
    ttl = Number(ttl) || 2592000;   // Domain.Dm.defaultTtl (30 days)
    if (ttl <= 86400) return '24 hours';
    if (ttl >= 2592000) return '30 days';
    return '7 days';
  }
  /* The DM lifetime chooser options, single-sourced from the PureScript Domain.Dm
     (Core); the inline fallback matches the worker's DM_TTLS. */
  function dmTtlChoices() {
    return (window.mcCore && window.mcCore.dmTtlOptions)
      ? window.mcCore.dmTtlOptions.map(function (o) { return [o.secs, o.label]; })
      : [[86400, '24 hours'], [604800, '7 days'], [2592000, '30 days']];
  }
  function dmExpiryNode(other: any, ttl: any, isNew: any) {
    var p = el('p', 'dm-expiry');
    var cur = Number(ttl) || 2592000;   // Domain.Dm.defaultTtl (30 days)
    function paint() {
      p.textContent = '';
      p.appendChild(document.createTextNode('⏳ ' + (isNew ? 'Messages here disappear ' : 'Disappears ') + dmTtlLabel(cur) + ' after they are opened. '));
      var change = el('a', null, 'change');
      change.href = '#';
      change.addEventListener('click', function (ev: any) { ev.preventDefault(); chooser(); });
      p.appendChild(change);
    }
    function chooser() {
      p.textContent = 'Disappears after opening: ';
      dmTtlChoices().forEach(function (opt, i) {
        if (i) p.appendChild(document.createTextNode(' · '));
        var a = el('a', null, opt[1] + (cur === opt[0] ? ' ✓' : ''));
        a.href = '#';
        a.addEventListener('click', function (ev: any) {
          ev.preventDefault();
          fetch(API + '/dm/ttl', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: state.key, with: other, ttl: opt[0] }) })
            .then(function (r) { return r.json(); })
            .then(function (d) { if (d && d.ok) { cur = opt[0] as number; isNew = false; paint(); } })
            .catch(function () {});
        });
        p.appendChild(a);
      });
      p.appendChild(document.createTextNode(' · '));
      var cancel = el('a', null, 'cancel');
      cancel.href = '#';
      cancel.addEventListener('click', function (ev: any) { ev.preventDefault(); paint(); });
      p.appendChild(cancel);
    }
    p.mcSetTtl = function (t: any) { cur = Number(t) || cur; isNew = false; paint(); };
    paint();
    return p;
  }
  function dmSaveControl(m: any, other: any) {
    if (!m || !m.id) return null;
    var a = el('a', 'dm-save', m.saved ? '★ saved' : '☆ save');
    a.href = '#';
    a.addEventListener('click', function (ev: any) {
      ev.preventDefault();
      var want = m.saved ? 0 : 1;
      fetch(API + '/dm/save', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: state.key, with: other, id: m.id, saved: !!want }) })
        .then(function (r) { return r.json(); })
        .then(function (d) { if (d && d.ok) { m.saved = want; a.textContent = want ? '★ saved' : '☆ save'; } })
        .catch(function () {});
    });
    return a;
  }
  /* ---- UI sounds: ONE engine, shell-owned in app/call.ts (window.mcSound —
     it must live in the bundle so an incoming call rings on any page). This
     client only delegates its bell dings; no bundle = no sounds, which is the
     honest no-app posture. ---- */
  function playSound(name: any, loop?: any) {
    try { if ((window as any).mcSound) (window as any).mcSound.play(name, loop); } catch (e) { /* silent */ }
  }
  /* ❤ per message: on the OTHER party's bubbles a toggle, on your own a passive
     heart that lights when they like it (live or on load). The flag rides
     /dm/like — metadata only, the plaintext stays sealed. */
  function dmLikeControl(m: any, node: any, other: any) {
    if (!m || !m.id || m.redacted) return;
    var mine = m.sender_hash === state.myHash;
    var wrap = el('div', 'dm-like-row');
    var btn: any = null;
    var chip = el('span', 'dm-like-chip');
    function paint() {
      var meL = Number(m.liked_me || 0) ? 1 : 0;
      var themL = Number(m.liked_other || 0) ? 1 : 0;
      chip.style.display = (meL || themL) ? '' : 'none';
      chip.textContent = (meL + themL) > 1 ? '❤ 2' : '❤';
      chip.title = themL ? (meL ? 'Liked by both of you' : 'Liked') : 'You liked this';
      if (btn) {
        btn.textContent = meL ? '❤' : '♡';
        btn.title = meL ? 'Unlike' : 'Like';
        btn.classList.toggle('on', !!meL);
      }
    }
    if (!mine) {
      btn = el('button', 'dm-like-btn');
      btn.type = 'button';
      btn.addEventListener('click', function () {
        var want = Number(m.liked_me || 0) ? 0 : 1;
        m.liked_me = want; paint();   // optimistic; revert on refusal
        fetch(API + '/dm/like', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: state.key, with: other, id: m.id, like: want }) })
          .then(function (r) { return r.json(); })
          .then(function (d) { if (blockedOut(d)) return; if (!d || !d.ok) { m.liked_me = want ? 0 : 1; paint(); } })
          .catch(function () { m.liked_me = want ? 0 : 1; paint(); });
      });
      wrap.appendChild(btn);
    }
    wrap.appendChild(chip);
    node.appendChild(wrap);
    (node as any).mcLikePaint = function (like: any) { m.liked_other = like ? 1 : 0; paint(); };
    paint();
  }
  /* "I watched it arrive": debounced acknowledgment for a live-delivered message
     in the OPEN thread — stamps the read state, starts the disappearing clock,
     sends the Seen receipt, and clears any raced dm notification, exactly as a
     thread reload would, without refetching it. */
  var dmSeenT: any = 0;
  function dmSeenPing(other: any) {
    clearTimeout(dmSeenT);
    dmSeenT = setTimeout(function () {
      try { localStorage.removeItem(DM_CACHE); } catch (e) { /* fine */ }
      fetch(API + '/dm/seen', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: state.key, with: other }) }).catch(function () { /* next open settles it */ });
    }, 1200);
  }
  /* ---- E2E media: encrypt a file with AES-256-GCM (a fresh key per file), carry
     the key/iv/meta inside the nacl.box message body, upload only ciphertext, and
     lazily fetch + decrypt + blob-render it on the other side. ---- */
  function fmtBytes(n: any) {
    n = Number(n) || 0;
    if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
    if (n >= 1024) return Math.round(n / 1024) + ' KB';
    return n + ' B';
  }
  function dmMediaEncryptFile(file: any) {
    return file.arrayBuffer().then(function (buf: any) {
      var iv = crypto.getRandomValues(new Uint8Array(12));
      return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']).then(function (k) {
        return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, k, buf).then(function (ctBuf) {
          return crypto.subtle.exportKey('raw', k).then(function (rawK) {
            return { ct: new Uint8Array(ctBuf), env: { k: dmB64uEnc(new Uint8Array(rawK)), iv: dmB64uEnc(iv),
              name: String(file.name || 'file').slice(0, 120), mime: file.type || 'application/octet-stream', size: file.size } };
          });
        });
      });
    });
  }
  function dmMediaDecrypt(ct: any, envInfo: any) {
    return crypto.subtle.importKey('raw', dmB64uDec(envInfo.k), { name: 'AES-GCM' }, false, ['decrypt'])
      .then(function (k) { return crypto.subtle.decrypt({ name: 'AES-GCM', iv: dmB64uDec(envInfo.iv) }, k, ct); })
      .then(function (buf) { return new Uint8Array(buf); });
  }
  var _mediaCache: Record<string, any> = {};
  function loadDmMedia(mediaKey: any, envInfo: any) {
    if (_mediaCache[mediaKey]) return Promise.resolve(_mediaCache[mediaKey]);
    return fetch(API + '/dm/media/get', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: state.key, media_key: mediaKey }) })
      .then(function (r) { if (!r.ok) throw new Error('media ' + r.status); return r.arrayBuffer(); })
      .then(function (buf) { return dmMediaDecrypt(new Uint8Array(buf), envInfo); })
      .then(function (bytes) {
        var url = URL.createObjectURL(new Blob([bytes], { type: (envInfo && envInfo.mime) || 'application/octet-stream' }));
        _mediaCache[mediaKey] = url;
        return url;
      });
  }
  /* One media bubble: the same chrome as dmMsgNode, but the body lazily loads the
     decrypted media as an <img>/<video>/<audio> (or a download link). */
  function dmMediaNode(m: any, otherLabel: any, other: any, envInfo: any) {
    var mine = m.sender_hash === state.myHash;
    var node = el('div', 'dm-msg' + (mine ? ' dm-mine' : ''));
    if (m.id) node.setAttribute('data-dmid', String(m.id));   // likes/receipts address bubbles by id
    var head = el('div', 'comment-head');
    head.appendChild(el('span', 'comment-author', mine ? 'You' : otherLabel));
    var mdt = el('span', 'comment-date', fmtTimeCompact(m.created_at));
    mdt.title = fmtDateTime(m.created_at);
    head.appendChild(mdt);
    node.appendChild(head);
    var bodyEl = el('div', 'comment-body dm-media-body');
    var holder = el('div', 'dm-media');
    holder.appendChild(el('p', 'dm-media-status', 'Loading ' + ((envInfo && envInfo.name) || 'media') + '…'));
    bodyEl.appendChild(holder);
    if (envInfo && envInfo.caption) bodyEl.appendChild(fillBody(el('div', 'dm-media-caption'), envInfo.caption));
    node.appendChild(bodyEl);
    loadDmMedia(m.media_key, envInfo).then(function (url) {
      holder.textContent = '';
      var mime = (envInfo && envInfo.mime) || '';
      var mel;
      var isFile = false;
      if (/^image\//.test(mime)) { mel = el('img', 'dm-media-img'); mel.src = url; mel.alt = envInfo.name || 'image'; mel.loading = 'lazy'; }
      else if (/^video\//.test(mime)) { mel = el('video', 'dm-media-vid'); mel.src = url; mel.controls = true; }
      else if (/^audio\//.test(mime)) { mel = el('audio', 'dm-media-aud'); mel.src = url; mel.controls = true; }
      else { isFile = true; mel = el('a', 'dm-media-file', (envInfo.name || 'download') + ' · ' + fmtBytes(envInfo.size)); mel.href = url; mel.download = envInfo.name || 'file'; }
      holder.appendChild(mel);
      /* a plain "Download" control for image/video/audio (the file case is already
         a download link). The blob is the decrypted bytes, saved under its name. */
      if (!isFile) {
        var dlRow = el('div', 'dm-media-dl');
        dlRow.appendChild(mediaDownloadLink(url, envInfo.name || 'download', 'Download', 'wall-act wall-act-dl dm-dl'));
        holder.appendChild(dlRow);
      }
    }).catch(function () {
      holder.textContent = '';
      holder.appendChild(el('span', 'dm-media-status', '⚠️ media unavailable (it may have expired)'));
    });
    return node;
  }
  /* An elegant stand-in for a media attachment the 30-day hard cap has swept away
     while the (saved) message itself survives — no fetch, just the placeholder over
     any caption the message still carries. */
  function dmMediaExpiredNode(m: any, otherLabel: any, caption: any) {
    var mine = m.sender_hash === state.myHash;
    var node = el('div', 'dm-msg' + (mine ? ' dm-mine' : ''));
    var head = el('div', 'comment-head');
    head.appendChild(el('span', 'comment-author', mine ? 'You' : otherLabel));
    var mdt = el('span', 'comment-date', fmtTimeCompact(m.created_at));
    mdt.title = fmtDateTime(m.created_at);
    head.appendChild(mdt);
    node.appendChild(head);
    var bodyEl = el('div', 'comment-body dm-media-body');
    var ph = el('div', 'dm-media-expired');
    ph.appendChild(el('span', 'dm-media-expired-icon', '🖼️'));
    ph.appendChild(el('span', 'dm-media-expired-text', 'Attachment expired'));
    bodyEl.appendChild(ph);
    if (caption) bodyEl.appendChild(fillBody(el('div', 'dm-media-caption'), caption));
    node.appendChild(bodyEl);
    return node;
  }
  /* Render one decrypted DM message: text via dmMsgNode, media via dmMediaNode,
     with the per-message controls (save, and — on your own — edit + delete)
     attached. Shared by history + live paths. A deleted message renders as the
     "<redacted>" placeholder with no controls. */
  function dmRenderMsg(m: any, otherPub: any, shortName: any, other: any) {
    if (m.redacted) return dmRedactedNode(m, shortName);
    var e = Number(m.enc || 0);
    var lbl = shortName;
    var node;
    if (m.media_key) {
      var envInfo = null;
      if (e === 1) { try { envInfo = JSON.parse(dmDecrypt(m.body, otherPub) || 'null'); } catch (x) { envInfo = null; } }
      if (envInfo) node = dmMediaNode(m, lbl, other, envInfo);
      else { m.body = '⚠️ could not open media'; node = dmMsgNode(m, lbl); }
    } else if (m.media_expired) {
      var cap = '';
      if (e === 1) { try { var ev = JSON.parse(dmDecrypt(m.body, otherPub) || 'null'); cap = (ev && ev.caption) || ''; } catch (x2) { cap = ''; } }
      node = dmMediaExpiredNode(m, lbl, cap);
    } else {
      if (e === 1) m.body = dmDecrypt(m.body, otherPub) || '⚠️ could not decrypt';
      else if (e === 2) lbl = '⚙️ Automated notice';
      node = dmMsgNode(m, lbl);
    }
    dmAppendControls(m, node, otherPub, shortName, other);
    return node;
  }
  /* Append the per-message controls to a rendered bubble: the save toggle for
     any message, and — only on your OWN, non-system, non-redacted messages — an
     edit link (text messages) and a delete link. Editing re-encrypts a new body
     to the same pair secret; deleting redacts it (a "<redacted>" note both sides
     keep until it would have expired). */
  function dmAppendControls(m: any, node: any, otherPub: any, shortName: any, other: any) {
    /* The like ♡ stays a subtle inline affordance (the readability standard);
       save/edit/delete fold into the bubble head's ⋯ menu. */
    dmLikeControl(m, node, other);
    var items: any[] = [];
    var sv = dmSaveControl(m, other);
    if (sv) items.push(sv);
    var mine = m.sender_hash === state.myHash;
    if (mine && !m.redacted && Number(m.enc || 0) !== 2 && m.id) {
      if (!m.media_key) {   // a media caption is not separately editable
        var ed = el('a', 'dm-edit', 'edit');
        ed.href = '#';
        ed.addEventListener('click', function (e: any) { e.preventDefault(); dmStartEdit(m, node, otherPub, shortName, other); });
        items.push(ed);
      }
      var del = el('a', 'dm-del', 'delete');
      del.href = '#';
      del.addEventListener('click', function (e: any) {
        e.preventDefault();
        appConfirm('Delete this message? A “<redacted>” note stands in its place for both of you until it would have disappeared anyway.', { okLabel: 'Delete', danger: true }, function (ok: any) {
          if (!ok) return;
          fetch(API + '/dm/redact', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: state.key, with: other, id: m.id }) })
            .then(function (r) { return r.json(); }).then(function (d) {
              if (blockedOut(d)) return;
              if (d && d.ok) { m.redacted = 1; dmMakeRedacted(node, true); }
            }).catch(function () {});
        });
      });
      items.push(del);
    }
    if (items.length) {
      var head = node.querySelector('.comment-head');
      if (head) head.appendChild(postMenu({ items: items }));
      else node.appendChild(postMenu({ items: items }));
    }
  }
  /* Turn a live text bubble into an in-place editor. Saving re-encrypts and
     posts /dm/edit; on success the body re-renders and an "(edited)" marker is
     added (the other side is told live). The current plaintext is m.body, which
     dmRenderMsg has already decrypted into place. */
  function dmStartEdit(m: any, node: any, otherPub: any, shortName: any, other: any) {
    if (node.querySelector('.dm-edit-box')) return;
    var bodyEl = node.querySelector('.comment-body');
    var actions = node.querySelector('.dm-msg-actions');
    if (bodyEl) bodyEl.style.display = 'none';
    if (actions) actions.style.display = 'none';
    var box = el('div', 'dm-edit-box');
    var ta = el('textarea', 'comment-text');
    ta.rows = 3;
    ta.maxLength = 4000;
    ta.value = m.body || '';
    box.appendChild(ta);
    var btns = el('div', 'comment-buttons');
    var save = el('button', 'btn btn-send', 'Save'); save.type = 'button';
    var cancel = el('button', 'btn', 'Cancel'); cancel.type = 'button';
    btns.appendChild(save); btns.appendChild(cancel);
    box.appendChild(btns);
    var st = el('p', 'form-status');
    box.appendChild(st);
    node.appendChild(box);
    ta.focus();
    function done() { box.remove(); if (bodyEl) bodyEl.style.display = ''; if (actions) actions.style.display = ''; }
    cancel.addEventListener('click', done);
    save.addEventListener('click', function () {
      var nv = ta.value.replace(/\s+$/, '');
      if (!nv.trim()) { ta.focus(); return; }
      if (nv === (m.body || '')) { done(); return; }
      save.disabled = true; st.textContent = 'Saving…';
      fetch(API + '/dm/edit', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: state.key, with: other, id: m.id, body: dmEncrypt(nv, otherPub), enc: 1 }) })
        .then(function (r) { return r.json(); }).then(function (d) {
          if (blockedOut(d)) return;
          if (!d || !d.ok) { st.textContent = (d && d.error) || 'Could not save.'; save.disabled = false; return; }
          m.body = nv; m.edited_at = d.edited_at || Math.floor(Date.now() / 1000);
          if (bodyEl) { bodyEl.textContent = ''; fillBody(bodyEl, nv); }
          var head = node.querySelector('.comment-head');
          if (head && !head.querySelector('.dm-edited')) head.appendChild(el('span', 'dm-edited', ' (edited)'));
          done();
        }).catch(function () { st.textContent = 'Network error. Try again.'; save.disabled = false; });
    });
  }
  /* Mutate a bubble in place into the "<redacted>" placeholder, stripping its
     body/media and every control. Used by my own delete and by the live redact
     push from the other side. */
  function dmMakeRedacted(node: any, mine: any) {
    node.classList.add('dm-redacted-msg');
    var body = node.querySelector('.comment-body');
    if (body) {
      body.textContent = '';
      body.className = 'comment-body';
      body.appendChild(el('span', 'dm-redacted', mine ? '<redacted> — you deleted this message' : '<redacted>'));
    }
    ['.dm-msg-actions', '.dm-save', '.dm-edit-box', '.dm-receipt'].forEach(function (sel) {
      var n = node.querySelector(sel); if (n) n.remove();
    });
  }
  /* One injected style block for the disappearing/media/settings UI — kept out of
     the shared stylesheets (like the emoji CSS) so it never collides. */
  function ensureDmStyles() {
    if (document.getElementById('mc-dm-css')) return;
    var css = '' +
      '.dm-expiry{font-size:0.85em;opacity:0.72;margin:0.15em 0 0.5em}' +
      '.dm-expiry a{cursor:pointer}' +
      '.dm-save{font-size:0.78em;opacity:0.55;margin-left:10px;cursor:pointer;white-space:nowrap}' +
      '.dm-save:hover{opacity:0.9}' +
      '.dm-like-row{display:flex;align-items:center;gap:0.45em;margin-top:0.25em;min-height:1.2em}' +
      '.dm-like-btn{background:none;border:0;cursor:pointer;font:inherit;font-size:1.05em;line-height:1;color:var(--faint);padding:0.1em 0.35em;border-radius:8px}' +
      '.dm-like-btn.on,.dm-like-btn:hover{color:var(--maroon)}' +
      '.dm-like-chip{font-size:0.8em;color:var(--maroon);border:1px solid var(--rule);border-radius:999px;padding:0.05em 0.5em;background:var(--surface)}' +
      '.dm-attach-chip{display:inline-block;font-size:0.85em;opacity:0.85;margin:0.3em 0}' +
      '.btn-attach{margin-left:6px}' +
      '.dm-media{margin:0.1em 0}' +
      '.dm-media-status{opacity:0.6;font-size:0.9em}' +
      '.dm-media-img,.dm-media-vid{max-width:100%;max-height:60vh;border-radius:8px;display:block}' +
      '.dm-media-aud{width:100%;max-width:320px}' +
      '.dm-media-caption{margin-top:0.35em}' +
      '.dm-media-expired{display:flex;align-items:center;gap:8px;padding:12px 14px;border:1px dashed var(--rule,#cbb);border-radius:10px;opacity:0.78}' +
      '.dm-media-expired-icon{font-size:1.25em;filter:grayscale(1);opacity:0.7}' +
      '.dm-media-expired-text{font-size:0.9em;font-style:italic;opacity:0.85}' +
      '.dm-dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:7px;vertical-align:middle;background:#c8c8c8}' +
      '.dm-dot-on{background:#3ba55d;box-shadow:0 0 0 2px rgba(59,165,93,0.22)}' +
      '.dm-dot-off{background:#c0c0c0}.dm-dot-unknown{background:#dcdcdc}' +
      '.dm-typing{font-size:0.85em;opacity:0.7;font-style:italic;margin:0.25em 0.2em}' +
      '.dm-receipt{display:block;font-size:0.72em;opacity:0.5;margin-top:2px}' +
      '.dm-receipt-seen{opacity:0.8;color:var(--maroon,#8b1a1a)}' +
      '.mc-inbox-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;vertical-align:middle;background:#3ba55d}' +
      '.wall-media{margin:0.45em 0}' +
      '.wall-media-el{max-width:100%;max-height:62vh;border-radius:8px;display:block}' +
      '.wall-post-detail .wall-media-el{max-height:85vh}' +
      '.wall-share{position:relative;display:inline-flex;align-items:center}.wall-share-menu{display:inline-flex;flex-wrap:wrap;gap:0.7em;margin-left:0.7em}' +
      '.wall-media-gone{opacity:0.6;font-size:0.9em;font-style:italic}' +
      '.wall-foot{margin-top:0.45em;font-size:0.9em}' +
      '.wall-comments-toggle{cursor:pointer;opacity:0.78}.wall-comments-toggle:hover{opacity:1}' +
      '.wall-comments{margin:0.55em 0 0.2em 0.9em;border-left:2px solid var(--rule,#e6e0d5);padding-left:0.85em}' +
      '.wall-comment{margin:0.45em 0}' +
      '.wall-newpill{display:inline-block;margin:0.4em 0;padding:0.3em 0.85em;border-radius:14px;background:var(--maroon,#8b1a1a);color:#fff;font-size:0.85em;cursor:pointer;text-decoration:none}' +
      '.wall-composer{margin:0.6em 0 1.1em}.wall-del{color:var(--maroon,#8b1a1a);opacity:0.7}' +
      '.wall-sentinel{height:1px}' +
      '.dm-edited{font-size:0.72em;opacity:0.5;font-style:italic}' +
      '.dm-redacted{font-style:italic;opacity:0.6}' +
      '.dm-redacted-msg .comment-body{opacity:0.9}' +
      '.dm-msg-actions{margin-top:2px}' +
      '.dm-msg-actions a{font-size:0.78em;opacity:0.5;margin-right:10px;cursor:pointer;white-space:nowrap}' +
      '.dm-msg-actions a:hover{opacity:0.9}' +
      '.dm-del{color:var(--maroon,#8b1a1a)}' +
      '.dm-edit-box textarea{width:100%;box-sizing:border-box}' +
      '.dm-edit-box{margin-top:3px}' +
      '.admin-set-row{margin:0.6em 0}' +
      '.admin-set-row input[type=number]{width:6em}' +
      '.mc-media-row{margin:0.5em 0}' +
      '.mc-media-note{font-size:0.85em;opacity:0.75;margin-left:8px}' +
      '.mc-rec-row{display:flex;align-items:center;gap:10px;margin:0.5em 0;flex-wrap:wrap}' +
      '.mc-rec-dot{width:10px;height:10px;border-radius:50%;background:#c0392b;animation:mc-rec-pulse 1.1s ease-in-out infinite}' +
      '@keyframes mc-rec-pulse{0%,100%{opacity:1}50%{opacity:0.25}}' +
      '.mc-rec-time{font-variant-numeric:tabular-nums;font-size:0.9em;opacity:0.85}' +
      '.mc-rec-audio{max-width:280px}';
    var st = el('style');
    st.id = 'mc-dm-css';
    st.textContent = css;
    document.head.appendChild(st);
  }

  /* ---- The served media settings: one cached read of /api/comments/config's
     `media` block. EVERY client-side attachment gate below reads THIS — never a
     hardcoded number (the old 60 MB client gate vs the server's own caps was a
     real bug). On any failure the kernel's Domain.Media defaults stand in, so
     the gates always have a shape to read. ---- */
  var _mediaCfgP: any = null;
  /* Normalize whatever the server sent (the per-section `sections` shape, an
     older worker's flat legacy fields, or nothing at all) into ONE shape every
     gate below reads: { enabled, autocompress, kinds, max_bytes,
     audio_max_seconds, sections: { dm|wall|board: { kinds, voice, scan,
     max_bytes:{image,video,audio}, audio_max_seconds } } }. The ladder per
     field: served section value → served legacy value → kernel default. dm's
     scan is ALWAYS false — E2E ciphertext is structurally unscannable. */
  function mediaCfgNormalize(m: any) {
    var core: any = window.mcCore;
    var d = core.mediaDefaults;
    m = m || {};
    var defKinds: any = { dm: d.kindsDm, wall: d.kindsWall, board: d.kindsBoard };
    var defBytes: any = { image: Number(d.imageMaxBytes), video: Number(d.videoMaxBytes), audio: Number(d.audioMaxBytes) };
    function sec(ctx: any) {
      var s = (m.sections && m.sections[ctx]) || {};
      var kinds = Array.isArray(s.kinds) ? s.kinds
        : (m.kinds && Array.isArray(m.kinds[ctx]) ? m.kinds[ctx] : core.mediaParseKinds(defKinds[ctx]));
      var mb: any = {};
      for (var k in defBytes) {
        mb[k] = Number(s.max_bytes && s.max_bytes[k]) || Number(m.max_bytes && m.max_bytes[k]) || defBytes[k];
      }
      return {
        kinds: kinds,
        voice: typeof s.voice === 'boolean' ? s.voice : true,
        scan: ctx === 'dm' ? false : (typeof s.scan === 'boolean' ? s.scan : true),
        max_bytes: mb,
        audio_max_seconds: Number(s.audio_max_seconds) || Number(m.audio_max_seconds) || Number(d.audioMaxSeconds),
      };
    }
    var out: any = {
      enabled: m.enabled !== false,
      autocompress: m.autocompress !== false,
      max_bytes: { image: Number(m.max_bytes && m.max_bytes.image) || defBytes.image,
        video: Number(m.max_bytes && m.max_bytes.video) || defBytes.video,
        audio: Number(m.max_bytes && m.max_bytes.audio) || defBytes.audio },
      audio_max_seconds: Number(m.audio_max_seconds) || Number(d.audioMaxSeconds),
      sections: { dm: sec('dm'), wall: sec('wall'), board: sec('board') },
    };
    out.kinds = { dm: out.sections.dm.kinds, wall: out.sections.wall.kinds, board: out.sections.board.kinds };
    return out;
  }
  function mediaCfg() {
    if (_mediaCfgP) return _mediaCfgP;
    _mediaCfgP = cachedJson(API + '/config', undefined, 300000)
      .then(function (d: any) {
        return mediaCfgNormalize(d && d.ok ? d.media : null);
      })
      .catch(function () { return mediaCfgNormalize(null); });
    return _mediaCfgP;
  }
  /* File via window so the built classic script never names a bare DOM global
     eslint's browser whitelist lacks; falls back to a named Blob where the File
     constructor is missing (the server sniffs magic bytes, not names). */
  function mkFile(parts: any[], name: any, type: any) {
    var F: any = (window as any).File;
    try { return new F(parts, name, { type: type }); }
    catch (e) { var b: any = new Blob(parts, { type: type }); b.name = name; return b; }
  }
  /* Downscale/re-encode a picked image in the browser before upload (the served
     `autocompress` switch): long edge capped at 2048, JPEG at 0.8 (one retry at
     0.65 when still over the image cap). Small JPEGs and non-images pass through
     untouched; resolves null only when the image cannot be decoded at all. */
  function compressImage(file: any, cfg: any, imageLimit?: any) {
    if (!/^image\//.test(String(file.type || ''))) return Promise.resolve(file);
    if (!cfg || cfg.autocompress === false) return Promise.resolve(file);
    if (file.size <= 524288 && file.type === 'image/jpeg') return Promise.resolve(file);
    var cib: any = (window as any).createImageBitmap;
    if (typeof cib !== 'function') return Promise.resolve(file);
    var limit = Number(imageLimit) || Number(cfg.max_bytes && cfg.max_bytes.image) || 10485760;
    return cib(file).then(function (bmp: any) {
      var scale = Math.min(1, 2048 / Math.max(bmp.width || 1, bmp.height || 1));
      if (scale === 1 && file.type === 'image/jpeg' && file.size <= limit) {
        try { bmp.close(); } catch (e) { /* fine */ }
        return file;
      }
      var canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bmp.width * scale));
      canvas.height = Math.max(1, Math.round(bmp.height * scale));
      var ctx = canvas.getContext('2d');
      if (!ctx) { try { bmp.close(); } catch (e) { /* fine */ } return file; }
      ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
      try { bmp.close(); } catch (e) { /* fine */ }
      function encode(q: any) {
        return new Promise(function (resolve) { canvas.toBlob(resolve, 'image/jpeg', q); });
      }
      return encode(0.8).then(function (blob: any) {
        if (blob && blob.size > limit) return encode(0.65);
        return blob;
      }).then(function (blob: any) {
        if (!blob) return file;
        var name = String(file.name || 'image').replace(/\.[A-Za-z0-9]+$/, '') + '.jpg';
        return mkFile([blob], name, 'image/jpeg');
      });
    }, function () { return null; });
  }
  /* Gate one picked (or recorded) file for a SECTION (a cfg.sections.* object):
     kind whitelisted for that section, per-section per-kind size cap from the
     served settings, images downscaled first (against the section's own image
     cap). Resolves the File to hold, or null after writing a friendly line to
     statusEl. Shared by the DM, wall, and board attach paths. */
  function mediaGateFile(f: any, cfg: any, sec: any, statusEl: any) {
    var core: any = window.mcCore;
    var kind = core ? core.mediaKindOfMime(String(f.type || '')) : null;
    var kinds = (sec && sec.kinds) || [];
    if (!cfg.enabled) { statusEl.textContent = 'Media sharing is turned off.'; return Promise.resolve(null); }
    if (!kind || kinds.indexOf(kind) === -1) {
      statusEl.textContent = 'That file type cannot be shared here' + (kinds.length ? ' — only ' + kinds.join(', ') + '.' : '.');
      return Promise.resolve(null);
    }
    var p = kind === 'image' ? compressImage(f, cfg, sec.max_bytes && sec.max_bytes.image) : Promise.resolve(f);
    return p.then(function (out: any) {
      if (!out) { statusEl.textContent = 'That image could not be read.'; return null; }
      var limit = Number(sec.max_bytes && sec.max_bytes[kind]) || 0;
      if (limit && out.size > limit) {
        statusEl.textContent = 'That ' + kind + ' is too large — the limit is ' + Math.round(limit / 1048576) + ' MB.';
        return null;
      }
      return out;
    });
  }

  /* ---- Voice notes: one shared recorder for the DM, wall, and board composers.
     Feature-detected; where MediaRecorder is missing (iOS PWA among others) the
     🎙 button falls back to a plain capture file input riding the normal attach
     path. A finished take is MP3-encoded in the browser (lamejs, lazily injected
     the same way as tweetnacl) so one small format plays everywhere; an encode
     failure falls back to the raw recording — a take is never dead-ended. ---- */
  var LAME_SRC = 'lamejs.min.js?v=1';
  var _lameP: any = null;
  function ensureLame() {
    var w: any = window;
    if (w.lamejs) return Promise.resolve(w.lamejs);
    if (_lameP) return _lameP;
    _lameP = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = LAME_SRC;
      s.async = true;
      s.onload = function () { if (w.lamejs) resolve(w.lamejs); else { _lameP = null; reject(new Error('lamejs')); } };
      s.onerror = function () { _lameP = null; reject(new Error('lamejs load failed')); };
      document.head.appendChild(s);
    });
    return _lameP;
  }
  function voiceSupported() {
    var w: any = window;
    var nav: any = navigator;
    return !!(nav.mediaDevices && nav.mediaDevices.getUserMedia && w.MediaRecorder && w.MediaRecorder.isTypeSupported);
  }
  /* First recordable type the browser admits to; '' lets it pick its default.
     INVARIANT: every named entry must be decodable by the SAME browser's
     decodeAudioData (Safari records+decodes mp4/AAC; Chrome mp4 [126+] or
     webm/opus, decodes both; Firefox webm/ogg opus, decodes both) — that is
     what makes voiceMp3Encode same-browser-safe. The '' tail is the one
     unproven pair, and voicePreview's raw-file catch covers it. */
  function voiceMime() {
    var MR: any = (window as any).MediaRecorder;
    var list = ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm;codecs=opus', 'audio/ogg;codecs=opus', ''];
    for (var i = 0; i < list.length; i++) {
      if (list[i] === '' || MR.isTypeSupported(list[i])) return list[i];
    }
    return '';
  }
  function fmtSecs(s: any) {
    s = Math.max(0, Math.floor(Number(s) || 0));
    return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2);
  }
  /* The raw-recording fallback File, extension matched to the recorder's mime. */
  function voiceRawFile(blob: any) {
    var t = String(blob.type || '');
    var ext = t.indexOf('mp4') !== -1 ? 'm4a' : (t.indexOf('ogg') !== -1 ? 'ogg' : 'webm');
    return mkFile([blob], 'voice-note.' + ext, t || 'audio/webm');
  }
  /* Decode the take, downmix to mono, and MP3-encode at 64 kbps in 1152-sample
     blocks, yielding to the UI every ~64 blocks so a long note never freezes
     the composer. Resolves a File('voice-note.mp3'). */
  function voiceMp3Encode(blob: any) {
    return ensureLame().then(function (lame: any) {
      return blob.arrayBuffer().then(function (buf: any) {
        var AC: any = (window as any).AudioContext || (window as any).webkitAudioContext;
        if (!AC) throw new Error('no audio context');
        var ctx = new AC();
        return new Promise(function (resolve, reject) { ctx.decodeAudioData(buf, resolve, reject); })
          .then(function (audio: any) {
            try { ctx.close(); } catch (e) { /* fine */ }
            var chs = audio.numberOfChannels || 1;
            var len = audio.length;
            var mono = new Float32Array(len);
            for (var c = 0; c < chs; c++) {
              var data = audio.getChannelData(c);
              for (var i = 0; i < len; i++) mono[i] += data[i];
            }
            if (chs > 1) for (var j = 0; j < len; j++) mono[j] /= chs;
            var pcm = new Int16Array(len);
            for (var k = 0; k < len; k++) {
              var v = Math.max(-1, Math.min(1, mono[k]));
              pcm[k] = Math.round(v * 32767);
            }
            var enc = new lame.Mp3Encoder(1, audio.sampleRate, 64);
            var parts: any[] = [];
            var pos = 0;
            function step(): any {
              var n = 0;
              while (pos < len && n < 64) {
                var out = enc.encodeBuffer(pcm.subarray(pos, Math.min(pos + 1152, len)));
                if (out && out.length) parts.push(out);
                pos += 1152;
                n++;
              }
              if (pos < len) return new Promise(function (r) { setTimeout(r, 0); }).then(step);
              var tail = enc.flush();
              if (tail && tail.length) parts.push(tail);
              return mkFile(parts, 'voice-note.mp3', 'audio/mpeg');
            }
            return step();
          });
      });
    });
  }
  /* The OS-layer recording fallback: a hidden capture file input riding the
     composer's normal attach path. The road that always exists — used where
     MediaRecorder is missing AND offered inline after any getUserMedia
     failure, so a blocked/absent/busy microphone never dead-ends a voice note
     (on phones `capture` opens the OS recorder; on desktop it is an honest
     audio-file pick). */
  function voiceFallbackInput(form: any, takeFile: any) {
    var fi = form.querySelector('input.mc-voice-input');
    if (fi) return fi;
    fi = el('input', 'mc-voice-input');
    fi.type = 'file';
    fi.accept = 'audio/*';
    fi.setAttribute('capture', '');
    fi.style.display = 'none';
    fi.addEventListener('change', function () {
      var f = fi.files && fi.files[0];
      if (f) takeFile(f);
      fi.value = '';
    });
    form.appendChild(fi);
    return fi;
  }
  /* After a failed getUserMedia: one idempotent row offering the OS-layer
     road. Sits under the honest error line statusEl just carried. */
  function voiceOfferFallback(form: any, takeFile: any) {
    if (form.querySelector('.mc-voice-fallback')) return;
    var row = el('div', 'mc-rec-row mc-voice-fallback');
    var btn = el('button', 'btn btn-attach', 'Record with your device instead');
    btn.type = 'button';
    btn.addEventListener('click', function () { voiceFallbackInput(form, takeFile).click(); });
    row.appendChild(btn);
    form.appendChild(row);
  }
  /* Honest per-cause failure copy. NotAllowedError covers BOTH a user "Block"
     and a Permissions-Policy denial (the header case rejects instantly with no
     prompt — the live 2026-08-02 report); the message points at the site
     permission and the fallback row carries the working road either way. */
  function voiceFailMessage(e: any) {
    var name = String((e && e.name) || '');
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') {
      return 'No microphone was found on this device — you can record with your device below.';
    }
    if (name === 'NotReadableError' || name === 'TrackStartError') {
      return 'The microphone is busy — another app or tab may be using it. You can record with your device below.';
    }
    if (name === 'SecurityError') {
      return 'Recording is blocked in this browser context — you can record with your device below.';
    }
    return 'Microphone access is blocked. Check this site’s microphone permission (the icon by the address bar), or record with your device below.';
  }
  /* The live recorder row: pulsing dot, elapsed / cap countdown, Stop. Stops
     itself at the section's seconds cap or when the raw bytes pass its audio
     size cap, then offers the preview row (listen / Use this / Re-record /
     Discard). A permissions preflight (where the browser has the API — Safari
     may not, and a query that throws just proceeds) catches the
     denied-without-a-prompt case up front. */
  function startVoiceRecorder(form: any, cfg: any, sec: any, statusEl: any, takeFile: any) {
    /* Block a second recorder while a take or preview is up — but NOT for the
       fallback row (also classed mc-rec-row), or one failed attempt would
       silently kill the 🎙 button for the rest of the page's life. */
    if (form.querySelector('.mc-rec-row:not(.mc-voice-fallback)')) return;
    var maxSecs = Number(sec && sec.audio_max_seconds) || Number(cfg.audio_max_seconds) || 180;
    var maxBytes = Number(sec && sec.max_bytes && sec.max_bytes.audio) || 5242880;
    var nav: any = navigator;
    var pre = (nav.permissions && nav.permissions.query)
      ? Promise.resolve().then(function () { return nav.permissions.query({ name: 'microphone' }); }).catch(function () { return null; })
      : Promise.resolve(null);
    pre.then(function (st: any) {
      if (st && st.state === 'denied') {
        statusEl.textContent = voiceFailMessage({ name: 'NotAllowedError' });
        voiceOfferFallback(form, takeFile);
        return;
      }
      navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream: any) {
      /* The mic works (again) — a fallback row from an earlier failure is
         stale chrome now. */
      var fb = form.querySelectorAll('.mc-voice-fallback');
      for (var fi = 0; fi < fb.length; fi++) fb[fi].remove();
      var MR: any = (window as any).MediaRecorder;
      var mt = voiceMime();
      var opts: any = { audioBitsPerSecond: 64000 };
      if (mt) opts.mimeType = mt;
      var rec: any;
      try { rec = new MR(stream, opts); }
      catch (e) {
        stream.getTracks().forEach(function (t: any) { t.stop(); });
        statusEl.textContent = 'Recording is not available in this browser.';
        return;
      }
      var row = el('div', 'mc-rec-row');
      row.appendChild(el('span', 'mc-rec-dot'));
      var time = el('span', 'mc-rec-time', '0:00 / ' + fmtSecs(maxSecs));
      row.appendChild(time);
      var stopBtn = el('button', 'btn', 'Stop');
      stopBtn.type = 'button';
      row.appendChild(stopBtn);
      form.appendChild(row);
      var chunks: any[] = [];
      var bytes = 0;
      var startedAt = Date.now();
      var stopped = false;
      function stopNow() {
        if (stopped) return;
        stopped = true;
        clearInterval(tick);
        try { rec.stop(); } catch (e) { /* already */ }
      }
      var tick = setInterval(function () {
        var s = Math.floor((Date.now() - startedAt) / 1000);
        time.textContent = fmtSecs(Math.min(s, maxSecs)) + ' / ' + fmtSecs(maxSecs);
        if (s >= maxSecs) stopNow();
      }, 250);
      stopBtn.addEventListener('click', stopNow);
      rec.ondataavailable = function (ev: any) {
        if (ev.data && ev.data.size) {
          chunks.push(ev.data);
          bytes += ev.data.size;
          if (bytes > maxBytes) stopNow();
        }
      };
      rec.onstop = function () {
        stream.getTracks().forEach(function (t: any) { t.stop(); });
        row.remove();
        var blob = new Blob(chunks, { type: rec.mimeType || mt || 'audio/webm' });
        if (!blob.size) { statusEl.textContent = 'Nothing was recorded.'; return; }
        voicePreview(form, cfg, sec, statusEl, blob, takeFile);
      };
      try { rec.start(1000); } catch (e) { stopNow(); }
      }).catch(function (e: any) {
        statusEl.textContent = voiceFailMessage(e);
        voiceOfferFallback(form, takeFile);
      });
    });
  }
  function voicePreview(form: any, cfg: any, sec: any, statusEl: any, blob: any, takeFile: any) {
    var row = el('div', 'mc-rec-row mc-rec-preview');
    var url = URL.createObjectURL(blob);
    var player = el('audio', 'mc-rec-audio');
    player.src = url;
    player.controls = true;
    row.appendChild(player);
    var use = el('button', 'btn btn-send', 'Use this');
    use.type = 'button';
    var redo = el('button', 'btn', 'Re-record');
    redo.type = 'button';
    var drop = el('button', 'btn', 'Discard');
    drop.type = 'button';
    row.appendChild(use);
    row.appendChild(redo);
    row.appendChild(drop);
    form.appendChild(row);
    function cleanup() { try { URL.revokeObjectURL(url); } catch (e) { /* fine */ } row.remove(); }
    drop.addEventListener('click', function () { cleanup(); });
    redo.addEventListener('click', function () { cleanup(); startVoiceRecorder(form, cfg, sec, statusEl, takeFile); });
    use.addEventListener('click', function () {
      use.disabled = true; redo.disabled = true; drop.disabled = true;
      statusEl.textContent = 'Preparing…';
      voiceMp3Encode(blob)
        .catch(function () { return voiceRawFile(blob); })
        .then(function (f: any) { statusEl.textContent = ''; cleanup(); takeFile(f); });
    });
  }
  /* The 🎙 button a composer places beside its 📎: real recorder where the
     browser has one, otherwise the capture file input riding the same attach
     path (takeFile = that composer's own picked-file handler). `sec` is the
     composer's own cfg.sections.* — its caps and its voice flag govern. */
  /* Phone composers show the utility buttons (📎 🎙 📞) as icon-only circles
     (the mobile CSS sizes them equal); the word survives in title +
     aria-label. Desktop keeps "icon word". Decided at build time — composers
     are rebuilt on every view, so a rotated/resized session heals itself. */
  function utilBtnLabel(btn: any, icon: string, word: string) {
    var phone = false;
    try { phone = window.matchMedia('(max-width: 600px)').matches; } catch (e) { /* desktop */ }
    btn.textContent = phone ? icon : icon + ' ' + word;
    btn.title = word;
    btn.setAttribute('aria-label', word);
    return btn;
  }

  function voiceControl(form: any, cfg: any, sec: any, statusEl: any, takeFile: any) {
    var btn = utilBtnLabel(el('button', 'btn btn-attach mc-voice-btn'), '🎙', 'Voice');
    btn.type = 'button';
    if (!voiceSupported()) {
      btn.addEventListener('click', function () { voiceFallbackInput(form, takeFile).click(); });
      return btn;
    }
    btn.addEventListener('click', function () { startVoiceRecorder(form, cfg, sec, statusEl, takeFile); });
    return btn;
  }

  var section = document.querySelector('section[data-comments], section[data-board]') as HTMLElement;
  if (!section) return;
  var BOARD = section.hasAttribute('data-board');

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

  var state: any = {
    key: getKey(),
    myHash: '',
    myNick: '',
    myAdmin: false,
    profileLoaded: false,
    started: false,
    widgetId: null,
    tokenWait: null,
    anonAllowed: false,
    altIps: { ipv4: '', ipv6: '' },
    dmView: null,   // set by viewDm: the open thread's live drop-in hook
  };

  /* Reverse-DNS results, cached per address across drawers so a fingerprint
     opened twice never looks the same IP up twice. */
  var rdnsCache: Record<string, any> = {};

  /* ---- Turnstile. Loaded lazily, challenge run only at post time so the
     token cannot expire while a long comment is being written. ---- */

  /* Render (or re-render) the invisible widget into the current view's slot.
     Idempotent and safe to call repeatedly: it keeps a widget that is still live
     in the DOM and only (re)renders when there is none, or when the one we had
     was torn out with its old composer/view. This is the load-bearing fix for
     the SPA: once the Turnstile script is loaded (page-wide, it lives on
     document.head), any later boot/view has a fresh boot-scoped `state`
     (widgetId=null) but window.turnstile already exists — without an explicit
     re-render here the widget was never created for the new view and every
     getToken() timed out ("Verification is taking a moment to load"). */
  function renderTurnstileWidget() {
    if (!window.turnstile) return;
    var slot = section.querySelector('.ts-slot');
    if (!slot) return;
    if (state.widgetId !== null && slot.querySelector('iframe')) return;
    try {
      state.widgetId = turnstile.render(slot, {
        sitekey: SITEKEY,
        execution: 'execute',
        appearance: 'interaction-only',
        callback: function (token: any) {
          if (state.tokenWait) { state.tokenWait.resolve(token); state.tokenWait = null; }
        },
        'error-callback': function () {
          if (state.tokenWait) { state.tokenWait.reject(new Error('challenge failed')); state.tokenWait = null; }
          return true;
        },
        'expired-callback': function () {},
      });
    } catch (e) { /* a double-render into the same slot throws; ignore */ }
  }

  function loadTurnstile() {
    if (window.turnstile) { renderTurnstileWidget(); return; }
    if (document.getElementById('mc-ts-script')) return;   // loading; onload renders
    (window as any).__mcCommentsTs = function () { renderTurnstileWidget(); };
    var script = document.createElement('script');
    script.id = 'mc-ts-script';
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=__mcCommentsTs&render=explicit';
    script.async = true;
    script.onerror = function () { state.tsError = true; };
    document.head.appendChild(script);
  }

  /* Get a fresh Turnstile token. The widget loads lazily and asynchronously, so a
     reader who clicks Post/Send the instant a composer opens once hit a bare
     "still loading" refusal and had to refresh. Now the click ensures the script
     is loading and WAITS for the widget to be ready (up to ~10s, polling), then
     runs the challenge — so the button just works after a brief beat instead of
     failing. Only a genuine load failure or a real timeout rejects. */
  function getToken() {
    return new Promise<any>(function (resolve, reject) {
      loadTurnstile();   // a click may be the first thing that needs it
      var waited = 0;
      var STEP = 150, MAX = 10000;
      function run() {
        if (state.tsError) {
          reject(new Error('Verification could not load. Check your connection and reload the page.'));
          return;
        }
        if (window.turnstile && state.widgetId === null) renderTurnstileWidget();
        if (!window.turnstile || state.widgetId === null) {
          if (waited >= MAX) {
            reject(new Error('Verification is taking a moment to load. Give it a few seconds and press the button again.'));
            return;
          }
          waited += STEP;
          setTimeout(run, STEP);
          return;
        }
        state.tokenWait = { resolve: resolve, reject: reject };
        try { turnstile.execute(state.widgetId); } catch (e) {
          state.tokenWait = null;
          reject(e);
        }
      }
      run();
    });
  }

  /* ---- Rendering ---- */

  /* The reader's current selection, kept only when it lies inside this post's
     body — read on mousedown, before the Quote click can collapse it. Empty
     when there is no in-post selection, so quoteInto falls back to the whole
     post. */
  var quotedSelection = '';
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
    return origin + ((ctx && ctx.page) || pagePath()) + '#comment-' + c.id;
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

  /* ---- Markdown compose toolbar. The box stays a single plain-text textarea
     holding the markdown source; these buttons only edit that source at the
     caret or around the selection, and fillBody renders it on show. ---- */

  function afterEdit(ta: any) {
    ta.focus();
    try { ta.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {}
  }

  /* Wrap the selection, or, with nothing selected, drop the markers and put the
     caret between them: WORD -> **WORD**, and | -> **|**. */
  function wrapSel(ta: any, before: any, after: any) {
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
  function linePrefix(ta: any, prefix: any) {
    var s = ta.value, a = ta.selectionStart, b = ta.selectionEnd;
    var start = s.lastIndexOf('\n', a - 1) + 1;
    var end = s.indexOf('\n', b); if (end === -1) end = s.length;
    var block = s.slice(start, end).split('\n').map(function (ln: any) { return prefix + ln; }).join('\n');
    ta.value = s.slice(0, start) + block + s.slice(end);
    try { ta.setSelectionRange(start, start + block.length); } catch (e) {}
    afterEdit(ta);
  }

  /* Insert a same-site link template, caret landing in the URL to complete. */
  function insertLink(ta: any) {
    var s = ta.value, a = ta.selectionStart, b = ta.selectionEnd, sel = s.slice(a, b) || 'text';
    var url = 'https://merecatholicity.com/';
    ta.value = s.slice(0, a) + '[' + sel + '](' + url + ')' + s.slice(b);
    var urlStart = a + sel.length + 3;
    try { ta.setSelectionRange(urlStart, urlStart + url.length); } catch (e) {}
    afterEdit(ta);
  }

  function mdButton(label: any, title: any, cls: any, handler: any) {
    var btn = el('button', 'md-btn' + (cls ? ' ' + cls : ''), label);
    btn.type = 'button';
    btn.title = title;
    btn.addEventListener('click', function (e: any) { e.preventDefault(); handler(); });
    return btn;
  }

  /* ================= Emoji =================================================
     Standard Unicode emoji insert and store as plain characters; the pack emoji
     (memes/pepe) insert and store as :code:, and only a code on the CUSTOM_EMOJI
     whitelist ever becomes a same-origin <img> (an unknown :token: stays text).
     The full standard set, with search keywords and grouped for browsing, is
     fetched once from emoji/emoji-data.json on first use, so ~1900 emoji never
     ride the initial page load. Three ways in: the picker button's tabbed panel,
     the : autocomplete while typing (both desktop and mobile), and hand-typed
     :shortcode:. ======================================================== */

  /* One :code: -> a node: a whitelisted pack image, a named-emoji character, or
     the literal text when neither is known. Called by appendRich. */
  function emojiToken(code: any, raw: any) {
    var c = code.toLowerCase();
    if (CUSTOM_EMOJI[c]) return emojiImg(CUSTOM_EMOJI[c], c);
    if (NAMED_EMOJI[c]) return document.createTextNode(NAMED_EMOJI[c]);
    return document.createTextNode(raw);
  }
  function emojiImg(path: any, code: any) {
    ensureEmojiStyles();
    var img = el('img', 'mc-emoji');
    img.src = path;
    img.alt = ':' + code + ':';
    img.title = ':' + code + ':';
    img.loading = 'lazy';
    img.decoding = 'async';
    return img;
  }

  var emojiData: any = null, emojiDataPromise: any = null;
  function loadEmojiData() {
    if (emojiDataPromise) return emojiDataPromise;
    emojiDataPromise = fetch('emoji/emoji-data.json').then(function (r) { return r.json(); })
      .then(function (d) {
        var flat: any[] = [];
        (d.groups || []).forEach(function (g: any) { g.e.forEach(function (e: any) { flat.push({ c: e[0], a: e[1], k: e[2] }); }); });
        emojiData = { groups: d.groups || [], flat: flat };
        return emojiData;
      })
      .catch(function () { emojiData = { groups: [], flat: [] }; return emojiData; });
    return emojiDataPromise;
  }
  function prefetchEmoji() { loadEmojiData(); }

  /* Avatar presets: the ready-made gallery art, grouped into packs by a
     generated manifest and fetched once on first use, so a profile view never
     pays for it. The images themselves are same-origin static files, drawn
     into the avatar canvas exactly like an uploaded photo. */
  var avatarPresetsPromise: any = null;
  function loadAvatarPresets() {
    if (avatarPresetsPromise) return avatarPresetsPromise;
    avatarPresetsPromise = fetch('avatars/presets/index.json')
      .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
      .then(function (d) { return (d && d.packs) || []; })
      .catch(function (e) { avatarPresetsPromise = null; throw e; });
    return avatarPresetsPromise;
  }

  /* One ranked search across pack codes and the standard set (the full lazy set
     when it is loaded, else the small inline NAMED_EMOJI). Prefix hits rank above
     substring hits. Returns items the picker and the : list both render. */
  function emojiSearch(q: any, limit: any) {
    q = String(q).toLowerCase();
    if (!q) return [];
    var pre: any[] = [], sub: any[] = [], seen: Record<string, any> = {};
    Object.keys(EMOJI_PACKS).forEach(function (pk) {
      EMOJI_PACKS[pk].forEach(function (e: any) {
        var i = e[0].indexOf(q);
        if (i === 0) pre.push({ kind: 'img', code: e[0], path: e[1] });
        else if (i > 0) sub.push({ kind: 'img', code: e[0], path: e[1] });
      });
    });
    if (emojiData && emojiData.flat.length) {
      emojiData.flat.forEach(function (e: any) {
        if (e.a.indexOf(q) === 0 || (' ' + e.k).indexOf(' ' + q) > -1) pre.push({ kind: 'char', char: e.c, label: e.a });
        else if (e.k.indexOf(q) > -1) sub.push({ kind: 'char', char: e.c, label: e.a });
      });
    } else {
      Object.keys(NAMED_EMOJI).forEach(function (n) {
        var i = n.indexOf(q);
        if (i === 0) pre.push({ kind: 'char', char: NAMED_EMOJI[n], label: n });
        else if (i > 0) sub.push({ kind: 'char', char: NAMED_EMOJI[n], label: n });
      });
    }
    var out: any[] = [];
    pre.concat(sub).forEach(function (it) {
      var key = it.kind === 'img' ? 'i' + it.code : 'c' + it.char;
      if (seen[key] || out.length >= limit) return;
      seen[key] = 1; out.push(it);
    });
    return out;
  }

  function insertAtCaret(ta: any, text: any) {
    var s = ta.value, a = ta.selectionStart, b = ta.selectionEnd;
    ta.value = s.slice(0, a) + text + s.slice(b);
    var np = a + text.length;
    try { ta.setSelectionRange(np, np); } catch (e) {}
    afterEdit(ta);
  }
  function insertEmojiItem(ta: any, it: any) {
    insertAtCaret(ta, it.kind === 'img' ? ':' + it.code + ':' : it.char);
  }

  /* The : autocomplete, the sibling of attachMentions: an @ picks a member, a :
     picks an emoji. Triggered by ":" plus a code start at the caret; Enter/Tab or
     tap inserts. Works the same on desktop and mobile. */
  function attachEmoji(textarea: any) {
    if (!textarea || textarea.dataset.emojiac) return;
    textarea.dataset.emojiac = '1';
    var sug = el('div', 'mention-suggest emoji-suggest');
    sug.hidden = true;
    textarea.parentNode.insertBefore(sug, textarea.nextSibling);
    var current: any[] = [], sel = 0, at = -1, timer: any = null;
    function render() {
      sug.textContent = '';
      if (!current.length) { sug.hidden = true; return; }
      current.forEach(function (it, i) {
        var r = el('a', 'dm-suggest-row emoji-suggest-row' + (i === sel ? ' dm-suggest-sel' : ''));
        r.href = '#';
        var g = el('span', 'emoji-suggest-glyph');
        if (it.kind === 'img') g.appendChild(emojiImg(it.path, it.code)); else g.textContent = it.char;
        r.appendChild(g);
        r.appendChild(el('span', null, ':' + (it.kind === 'img' ? it.code : it.label) + ':'));
        r.addEventListener('mousedown', function (e: any) { e.preventDefault(); pick(it); });
        sug.appendChild(r);
      });
      sug.hidden = false;
    }
    function scan() {
      var caret = textarea.selectionStart;
      var m = /(^|\s):([a-z0-9][a-z0-9_+-]{0,39})$/i.exec(textarea.value.slice(0, caret));
      if (!m) { current = []; at = -1; sug.hidden = true; return; }
      at = caret - m[2].length - 1;
      var q = m[2].toLowerCase();
      current = emojiSearch(q, 30); sel = 0; render();
      if (!emojiData) loadEmojiData().then(function () { if (at > -1) { current = emojiSearch(q, 30); render(); } });
    }
    function pick(it: any) {
      if (at < 0) return;
      var caret = textarea.selectionStart, v = textarea.value;
      var ins = it.kind === 'img' ? ':' + it.code + ':' : it.char;
      textarea.value = v.slice(0, at) + ins + ' ' + v.slice(caret);
      var np = at + ins.length + 1;
      try { textarea.setSelectionRange(np, np); } catch (e) {}
      current = []; at = -1; sug.hidden = true; afterEdit(textarea);
    }
    textarea.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(scan, 100); });
    textarea.addEventListener('keydown', function (e: any) {
      if (sug.hidden || !current.length) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(sel + 1, current.length - 1); render(); scrollSel(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(sel - 1, 0); render(); scrollSel(); }
      else if (e.key === 'Enter' || e.key === 'Tab') { if (current[sel]) { e.preventDefault(); pick(current[sel]); } }
      else if (e.key === 'Escape') { current = []; sug.hidden = true; }
    });
    function scrollSel() { var s = sug.querySelector('.dm-suggest-sel'); if (s && s.scrollIntoView) s.scrollIntoView({ block: 'nearest' }); }
    textarea.addEventListener('blur', function () { setTimeout(function () { sug.hidden = true; }, 200); });
  }

  /* The picker panel: a search box that narrows across everything, then tabs for
     the standard set (grouped, scrolling) and each pack. On touch the search
     focuses on open, so a tap behaves like typing ":". Kept short with an inner
     scroll so it never swallows the screen. */
  function buildEmojiPanel(textarea: any) {
    ensureEmojiStyles();
    var panel = el('div', 'emoji-panel');
    panel.hidden = true;
    var search = el('input', 'emoji-search');
    search.type = 'search'; search.placeholder = 'Search emoji...';
    var srow = el('div', 'emoji-search-row'); srow.appendChild(search); panel.appendChild(srow);
    var tabs = el('div', 'emoji-tabs'), body = el('div', 'emoji-body');
    var TABS = [['standard', 'Emoji'], ['memes', 'Memes'], ['pepe', 'Pepe']];
    var active = 'standard', tabBtns: Record<string, any> = {};
    TABS.forEach(function (t) {
      var b = el('button', 'emoji-tab', t[1]); b.type = 'button';
      b.addEventListener('click', function () { active = t[0]; search.value = ''; mark(); draw(); });
      tabBtns[t[0]] = b; tabs.appendChild(b);
    });
    panel.appendChild(tabs); panel.appendChild(body);
    function mark() { TABS.forEach(function (t) { tabBtns[t[0]].className = 'emoji-tab' + (t[0] === active ? ' emoji-tab-on' : ''); }); }
    function put(it: any) { insertEmojiItem(textarea, it); textarea.focus(); }
    function cellChar(ch: any, label: any) {
      var b = el('button', 'emoji-cell'); b.type = 'button'; b.textContent = ch; b.title = ':' + label + ':';
      b.addEventListener('click', function () { put({ kind: 'char', char: ch }); });
      return b;
    }
    function cellImg(code: any, path: any) {
      var b = el('button', 'emoji-cell'); b.type = 'button'; b.title = ':' + code + ':';
      b.appendChild(emojiImg(path, code));
      b.addEventListener('click', function () { put({ kind: 'img', code: code }); });
      return b;
    }
    function gridImgs(pairs: any) { var g = el('div', 'emoji-grid'); pairs.forEach(function (e: any) { g.appendChild(cellImg(e[0], e[1])); }); return g; }
    function draw() {
      body.textContent = '';
      var q = search.value.trim();
      if (q) {
        var res = emojiSearch(q, 250);
        if (!res.length) { body.appendChild(el('p', 'emoji-empty', 'No matches.')); return; }
        var g = el('div', 'emoji-grid');
        res.forEach(function (it) { g.appendChild(it.kind === 'img' ? cellImg(it.code, it.path) : cellChar(it.char, it.label)); });
        body.appendChild(g);
        return;
      }
      if (active === 'memes') { body.appendChild(gridImgs(EMOJI_PACKS.memes)); return; }
      if (active === 'pepe') { body.appendChild(gridImgs(EMOJI_PACKS.pepe)); return; }
      if (emojiData && emojiData.groups.length) {
        emojiData.groups.forEach(function (grp: any) {
          body.appendChild(el('div', 'emoji-group-head', grp.g));
          var g = el('div', 'emoji-grid');
          grp.e.forEach(function (e: any) { g.appendChild(cellChar(e[0], e[1])); });
          body.appendChild(g);
        });
      } else {
        var g2 = el('div', 'emoji-grid');
        STANDARD_EMOJI.forEach(function (ch) { g2.appendChild(cellChar(ch, ch)); });
        body.appendChild(g2);
        loadEmojiData().then(function () { if (active === 'standard' && !search.value.trim() && !panel.hidden) draw(); });
      }
    }
    search.addEventListener('input', draw);
    panel.openPanel = function () {
      panel.hidden = false; mark(); draw(); loadEmojiData();
      try { if (window.matchMedia && window.matchMedia('(hover: none)').matches) search.focus(); } catch (e) {}
    };
    panel.closePanel = function () { panel.hidden = true; };
    panel.toggle = function () { if (panel.hidden) panel.openPanel(); else panel.closePanel(); };
    return panel;
  }

  /* The whole KJV text, fetched once and cached, only when the Scripture picker
     is first opened — the same lazy pattern as the emoji data. */
  var kjvData: any = null, kjvPromise: any = null;
  function loadKjv() {
    if (kjvPromise) return kjvPromise;
    kjvPromise = fetch('kjv.json').then(function (r) { return r.json(); })
      .then(function (d) { kjvData = d; return d; })
      .catch(function () { kjvData = { books: [] }; return kjvData; });
    return kjvPromise;
  }
  var drData: any = null, drPromise: any = null;
  function loadDr() {
    if (drPromise) return drPromise;
    drPromise = fetch('dr.json').then(function (r) { return r.json(); })
      .then(function (d) { drData = d; return d; })
      .catch(function () { drData = { books: [] }; return drData; });
    return drPromise;
  }

  /* The Scripture picker: choose a book, chapter, and a verse (or a span of
     verses), and drop the passage into the box as a blockquote with the
     reference — which the renderer then autolinks back to the exact verse. */
  function buildScripturePanel(textarea: any) {
    ensureEmojiStyles();
    var panel = el('div', 'emoji-panel scripture-panel');
    panel.hidden = true;
    var row = el('div', 'scripture-row');
    var bookSel = el('select', 'scripture-sel');
    var chapSel = el('select', 'scripture-sel scripture-sel-sm');
    var v1Sel = el('select', 'scripture-sel scripture-sel-sm');
    var dash = el('span', 'scripture-dash', '–');
    var v2Sel = el('select', 'scripture-sel scripture-sel-sm');
    row.appendChild(bookSel); row.appendChild(el('span', 'scripture-sp', ' '));
    row.appendChild(chapSel); row.appendChild(el('span', 'scripture-colon', ':'));
    row.appendChild(v1Sel); row.appendChild(dash); row.appendChild(v2Sel);
    panel.appendChild(row);
    var status = el('div', 'scripture-status', 'Loading the King James text…');
    panel.appendChild(status);
    var preview = el('blockquote', 'scripture-preview'); preview.hidden = true;
    panel.appendChild(preview);
    var insert = el('button', 'scripture-insert', 'Insert passage');
    insert.type = 'button';
    panel.appendChild(insert);

    function opts(sel: any, n: any, label?: any) {
      sel.textContent = '';
      for (var i = 1; i <= n; i++) {
        var o = el('option'); o.value = i; o.textContent = label ? label + ' ' + i : i;
        sel.appendChild(o);
      }
    }
    function curBook() { return kjvData.books[bookSel.value ? +bookSel.value - 1 : 0]; }
    function fillBooks() {
      bookSel.textContent = '';
      kjvData.books.forEach(function (b: any, i: any) {
        var o = el('option'); o.value = i + 1; o.textContent = b.name; bookSel.appendChild(o);
      });
      fillChapters();
    }
    function fillChapters() { opts(chapSel, curBook().chapters.length, 'Chapter'); fillVerses(); }
    function fillVerses() {
      var ch = curBook().chapters[+chapSel.value - 1] || [];
      opts(v1Sel, ch.length); opts(v2Sel, ch.length);
      drawPreview();
    }
    function drawPreview() {
      var a = +v1Sel.value || 1, z = +v2Sel.value || a;
      if (z < a) { z = a; v2Sel.value = a; }
      var ch = curBook().chapters[+chapSel.value - 1] || [], parts = [];
      for (var v = a; v <= z; v++) if (ch[v - 1]) parts.push(ch[v - 1]);
      fillBody(preview, parts.join(' '));
      preview.hidden = !parts.length;
    }
    function passage() {
      var b = curBook(), c = +chapSel.value, a = +v1Sel.value, z = +v2Sel.value;
      if (z < a) z = a;
      var ch = b.chapters[c - 1] || [], parts = [];
      for (var v = a; v <= z; v++) if (ch[v - 1]) parts.push(ch[v - 1]);
      var ref = b.name + ' ' + c + ':' + a + (z > a ? '-' + z : '');
      return '> ' + parts.join(' ') + ' (' + ref + ')\n';
    }
    /* App bottom-sheet pickers over the four cascading selects on phones; each
       fill repopulates dependents, so refresh their picker labels after. */
    function enhSel(sel: any, label: any) {
      sel.setAttribute('aria-label', label);
      if (window.mcSelectSheet) { var h = window.mcSelectSheet(sel); if (h) h.refresh(); }
    }
    function enhAll() { enhSel(bookSel, 'Book'); enhSel(chapSel, 'Chapter'); enhSel(v1Sel, 'From verse'); enhSel(v2Sel, 'To verse'); }
    bookSel.addEventListener('change', function () { fillChapters(); enhAll(); });
    chapSel.addEventListener('change', function () { fillVerses(); enhAll(); });
    v1Sel.addEventListener('change', function () { drawPreview(); enhAll(); });
    v2Sel.addEventListener('change', function () { drawPreview(); enhAll(); });
    insert.addEventListener('click', function () {
      insertAtCaret(textarea, passage());
      textarea.focus();
      panel.closePanel();
    });

    panel.openPanel = function () {
      panel.hidden = false;
      if (kjvData) { status.hidden = true; fillBooks(); enhAll(); }
      else {
        status.hidden = false;
        loadKjv().then(function () {
          if (kjvData.books.length) { status.hidden = true; fillBooks(); enhAll(); }
          else status.textContent = 'Could not load the Bible text.';
        });
      }
    };
    panel.closePanel = function () { panel.hidden = true; };
    panel.toggle = function () { if (panel.hidden) panel.openPanel(); else panel.closePanel(); };
    return panel;
  }

  /* Hovering an autolinked reference pops the verse(s) themselves, pulled from
     the same cached KJV text the picker uses. Desktop only — there is no hover
     on touch, and reading the passage is a tap away on the link. A large span is
     allowed but capped so a whole-chapter reference can't fill the screen. */
  if (window.mcRich) { window.mcRich.initScriptureHover(bootSig); } else (function scriptureHover() {
    try { if (!window.matchMedia || !window.matchMedia('(hover: hover)').matches) return; } catch (e) { return; }
    var tip: any = null, maps: Record<string, any> = {}, hideTimer: any = null, CAP = 30;
    function bySlug(which: any, data: any, slug: any) {
      if (!maps[which] && data) {
        maps[which] = {};
        data.books.forEach(function (b: any) { maps[which][b.slug] = b; });
      }
      return maps[which] ? maps[which][slug] : null;
    }
    function place(a: any, ex: any, ey: any) {
      /* A reference that wraps across lines has a union box spanning the
         whole paragraph width, and a tip placed from it lands far from the
         cursor (in the narrow merecat bubbles this happened constantly and
         read as "no tooltip"). Place from the line fragment actually under
         the pointer, first fragment as the fallback. */
      var r = a.getBoundingClientRect();
      var rs = a.getClientRects();
      if (rs && rs.length) {
        r = rs[0];
        if (ey != null) {
          for (var i = 0; i < rs.length; i++) {
            if (ey >= rs[i].top - 2 && ey <= rs[i].bottom + 2) { r = rs[i]; break; }
          }
        }
      }
      tip.style.left = Math.max(6, Math.min(r.left, window.innerWidth - tip.offsetWidth - 10)) + 'px';
      /* Below the fragment if it fits, above if not, and always clamped into
         the viewport: a tall tip near the top edge once fled off-screen. The
         tip scrolls internally and ignores the pointer, so overlap is safe. */
      var below = r.bottom + 8;
      var top = below;
      if (below + tip.offsetHeight > window.innerHeight) {
        var above = r.top - tip.offsetHeight - 8;
        top = above > 6 ? above : Math.max(6, window.innerHeight - tip.offsetHeight - 6);
      }
      tip.style.top = top + 'px';
    }
    function show(a: any, ex: any, ey: any) {
      var dr = a.getAttribute('data-bible') === 'dr';
      (dr ? loadDr() : loadKjv()).then(function () {
        var b = bySlug(dr ? 'dr' : 'kjv', dr ? drData : kjvData, a.getAttribute('data-slug')); if (!b) return;
        var c = +a.getAttribute('data-ch'), ch = b.chapters[c - 1]; if (!ch) return;
        var v1 = +a.getAttribute('data-v1'), v2 = +a.getAttribute('data-v2');
        if (!tip) {
          /* The tip's CSS rides ensureEmojiStyles, which composer views call
             and the merecat chat does not: without it the tip is an unstyled
             static div at the end of the body, invisible below the fold —
             the whole "no tooltip in the chat" mystery. Idempotent, so call
             it here and the hover owns its own dress in every view. */
          ensureEmojiStyles();
          tip = el('div', 'scripture-tip');
          document.body.appendChild(tip);
        }
        tip.textContent = '';
        var h = el('strong', 'scripture-tip-ref', b.name + ' ' + c + ':' + v1 + (v2 > v1 ? '-' + v2 : ''));
        tip.appendChild(h);
        var body = el('div'), n = 0;
        for (var v = v1; v <= v2 && n < CAP; v++, n++) {
          if (!ch[v - 1]) continue;
          if (v2 > v1) { var vn = el('sup', 'scripture-tip-v', v + ' '); body.appendChild(vn); }
          body.appendChild(document.createTextNode(ch[v - 1] + ' '));
        }
        if (v2 - v1 + 1 > CAP) body.appendChild(document.createTextNode('…'));
        tip.appendChild(body);
        tip.hidden = false;
        place(a, ex, ey);
      });
    }
    document.addEventListener('mouseover', function (e) {
      var a = (e.target as any) && (e.target as any).closest && (e.target as any).closest('a.scripture-link');
      if (!a) return;
      clearTimeout(hideTimer);
      show(a, e.clientX, e.clientY);
    }, { signal: bootSig });
    document.addEventListener('mouseout', function (e) {
      var a = (e.target as any) && (e.target as any).closest && (e.target as any).closest('a.scripture-link');
      if (!a) return;
      hideTimer = setTimeout(function () { if (tip) tip.hidden = true; }, 160);
    }, { signal: bootSig });
  })();

  /* The avatar preset gallery: the same panel chrome as the emoji picker (search
     box, pack tabs, inner-scrolling grid), but each tile is a bigger image on the
     parchment tile so it previews the avatar it will become. onPick(path, name)
     fires with the chosen image. The manifest loads lazily on first open. */
  function buildAvatarGallery(onPick: any) {
    ensureEmojiStyles();
    var panel = el('div', 'emoji-panel av-panel');
    panel.hidden = true;
    var search = el('input', 'emoji-search');
    search.type = 'search'; search.placeholder = 'Search avatars...';
    var srow = el('div', 'emoji-search-row'); srow.appendChild(search); panel.appendChild(srow);
    var tabs = el('div', 'emoji-tabs'), body = el('div', 'emoji-body av-body');
    panel.appendChild(tabs); panel.appendChild(body);
    var packs: any = null, active: any = null, tabBtns: Record<string, any> = {};
    function tile(name: any, path: any) {
      var b = el('button', 'emoji-cell av-cell'); b.type = 'button'; b.title = name;
      var im = el('img'); im.src = path; im.alt = name; im.loading = 'lazy';
      b.appendChild(im);
      b.addEventListener('click', function () { onPick(path, name); });
      return b;
    }
    function grid(items: any) { var g = el('div', 'emoji-grid av-grid'); items.forEach(function (it: any) { g.appendChild(tile(it[0], it[1])); }); return g; }
    function mark() { if (packs) packs.forEach(function (p: any) { tabBtns[p.slug].className = 'emoji-tab' + (p.slug === active ? ' emoji-tab-on' : ''); }); }
    function draw() {
      body.textContent = '';
      if (!packs) { body.appendChild(el('p', 'emoji-empty', 'Loading gallery...')); return; }
      var q = search.value.trim().toLowerCase();
      if (q) {
        var res: any[] = [];
        packs.forEach(function (p: any) { p.items.forEach(function (it: any) { if (it[0].indexOf(q) !== -1) res.push(it); }); });
        if (!res.length) { body.appendChild(el('p', 'emoji-empty', 'No matches.')); return; }
        body.appendChild(grid(res.slice(0, 300)));
        return;
      }
      var pack: any = null;
      packs.forEach(function (p: any) { if (p.slug === active) pack = p; });
      if (pack) body.appendChild(grid(pack.items));
    }
    function build() {
      tabs.textContent = '';
      packs.forEach(function (p: any) {
        var b = el('button', 'emoji-tab', p.label); b.type = 'button';
        b.addEventListener('click', function () { active = p.slug; search.value = ''; mark(); draw(); });
        tabBtns[p.slug] = b; tabs.appendChild(b);
      });
      if (!active && packs.length) active = packs[0].slug;
      mark(); draw();
    }
    search.addEventListener('input', draw);
    panel.openPanel = function () {
      panel.hidden = false;
      if (packs) { mark(); draw(); }
      else {
        draw();
        loadAvatarPresets().then(function (pk: any) { packs = pk; build(); })
          .catch(function () { body.textContent = ''; body.appendChild(el('p', 'emoji-empty', 'The gallery could not be loaded. Try again in a moment.')); });
      }
      try { if (window.matchMedia && window.matchMedia('(hover: none)').matches) search.focus(); } catch (e) {}
    };
    panel.closePanel = function () { panel.hidden = true; };
    panel.toggle = function () { if (panel.hidden) panel.openPanel(); else panel.closePanel(); };
    return panel;
  }

  /* Inject the emoji styles once, matched to the site palette, rather than touch
     the shared stylesheet. The inner scroll keeps the panel and : list compact. */
  function ensureEmojiStyles() {
    if (window.mcRich) return window.mcRich.ensureEmojiStyles();
    if (document.getElementById('mc-emoji-css')) return;
    var css = '' +
      /* Markdown headings inside bodies: sized within reason for a comment —
         # a touch larger, ### about normal, ##### slightly small — never a
         page-title shout, and dressed in the site's maroon. */
      '.mc-hd{font-weight:bold;color:var(--maroon,#8b1a1a);margin:0.65em 0 0.3em;line-height:1.25}' +
      '.mc-hd:first-child{margin-top:0.1em}' +
      '.mc-hd1{font-size:1.28em}' +
      '.mc-hd2{font-size:1.18em}' +
      '.mc-hd3{font-size:1.09em}' +
      '.mc-hd4{font-size:1em}' +
      '.mc-hd5{font-size:0.92em}' +
      /* display explicit: a site-wide img{display:block} (05-home.css) would
         otherwise drop every inline emoji onto its own line. */
      '.mc-emoji{display:inline-block;height:1.35em;width:auto;vertical-align:-0.28em;margin:0 .04em}' +
      '.emoji-suggest{max-height:15em;overflow-y:auto}' +
      'a.emoji-suggest-row{align-items:center}' +
      '.emoji-suggest-glyph{display:inline-flex;align-items:center;justify-content:center;min-width:1.6em;font-size:1.15rem}' +
      '.emoji-suggest-glyph .mc-emoji{height:1.4em}' +
      '.emoji-panel{margin:.45em 0 0;border:1px solid var(--rule);border-radius:8px;background:var(--surface,#fff);box-shadow:0 2px 10px rgba(0,0,0,.08);overflow:hidden}' +
      '.emoji-search-row{padding:.5em;border-bottom:1px solid var(--rule)}' +
      '.emoji-search{width:100%;box-sizing:border-box;padding:.4em .6em;border:1px solid var(--rule);border-radius:6px;font:inherit;background:var(--surface,#fff);color:var(--ink,#1a1a1a)}' +
      '.emoji-search:focus,.scripture-sel:focus{outline:1px solid var(--maroon);border-color:var(--maroon)}' +
      '.emoji-tabs{display:flex;gap:.3em;flex-wrap:wrap;padding:.45em .5em 0}' +
      '.emoji-tab{font:inherit;font-size:.92rem;padding:.25em .8em;border:1px solid var(--rule);border-bottom:none;border-radius:6px 6px 0 0;background:var(--cream,#f7f1e3);color:var(--faint);cursor:pointer}' +
      '.emoji-tab-on{background:var(--surface,#fff);color:var(--maroon);font-weight:600}' +
      '.emoji-body{max-height:15em;overflow-y:auto;padding:.4em .5em .6em}' +
      '.emoji-group-head{position:sticky;top:0;background:var(--surface,#fff);color:var(--faint);font-size:.75rem;text-transform:uppercase;letter-spacing:.04em;padding:.4em .15em .2em}' +
      '.emoji-grid{display:flex;flex-wrap:wrap;gap:.1em}' +
      '.emoji-cell{width:2em;height:2em;display:inline-flex;align-items:center;justify-content:center;border:none;background:none;border-radius:6px;cursor:pointer;font-size:1.25rem;line-height:1;padding:0}' +
      '.emoji-cell:hover{background:var(--cream,#f9f3e6)}' +
      '.emoji-cell .mc-emoji{height:1.5em}' +
      '.emoji-empty{color:var(--faint);padding:.5em;margin:0}' +
      '.av-body{max-height:17em}' +
      '.av-grid{gap:.35em}' +
      '.av-cell{width:3em;height:3em;padding:2px;border:1px solid var(--rule);background:var(--cream-2,#faf6ee);border-radius:8px}' +
      '.av-cell:hover{background:var(--cream,#f2e7d0);border-color:var(--maroon)}' +
      '.av-cell img{max-width:100%;max-height:100%;width:auto;height:auto;object-fit:contain;display:block;margin:0}' +
      '.btn-gallery{display:inline-block;margin:.15em 0 .1em}' +
      /* Scripture picker + autolink + hover preview */
      '.scripture-panel{padding:.6em}' +
      '.scripture-row{display:flex;flex-wrap:wrap;align-items:center;gap:.25em}' +
      '.scripture-sel{font:inherit;font-size:.95rem;padding:.15em .3em;border:1px solid var(--rule);border-radius:5px;background:var(--cream-2,#faf6ee);color:var(--ink);max-width:14em}' +
      '.scripture-sel-sm{max-width:6em}' +
      '.scripture-colon,.scripture-dash{color:var(--faint);padding:0 .05em}' +
      '.scripture-status{color:var(--faint);font-size:.9rem;padding:.4em 0}' +
      '.scripture-preview{margin:.6em 0;padding:.4em .7em;border-left:3px solid var(--rule);color:var(--ink-soft);font-size:.95rem;max-height:9em;overflow:auto}' +
      '.scripture-insert{font:inherit;cursor:pointer;margin-top:.3em;padding:.3em .8em;border:1px solid var(--maroon);border-radius:6px;background:var(--maroon);color:var(--bg,#faf6ee)}' +
      '.scripture-insert:hover{background:var(--maroon-dark)}' +
      '.scripture-link{white-space:nowrap}' +
      '.scripture-tip{position:fixed;z-index:1200;max-width:30rem;max-height:60vh;overflow:auto;background:var(--surface,#fff);color:var(--ink);border:1px solid var(--rule);border-radius:6px;box-shadow:0 3px 14px rgba(0,0,0,.22);padding:.55em .7em;font-size:.92rem;line-height:1.5;pointer-events:none}' +
      '.scripture-tip-ref{display:block;color:var(--maroon);margin-bottom:.25em}' +
      '.scripture-tip-v{color:var(--faint);font-size:.72em;margin-right:.1em}' +
      /* Post preview: the composer swaps for the rendered body */
      '.md-editor.md-previewing>:not(.md-preview){display:none}' +
      '.md-preview{border:1px dashed var(--rule);border-radius:8px;padding:.55em .8em;min-height:5em}' +
      '.md-preview-title{font-weight:700}' +
      '.md-preview-empty{color:var(--faint);margin:0}' +
      '.btn-preview{background:transparent;border-color:var(--maroon);color:var(--maroon);font:inherit;cursor:pointer}' +
      '.btn-preview:hover{background:var(--maroon);color:var(--bg,#fff)}' +
      '.btn-preview:disabled{opacity:.6;cursor:default}' +
      // scripture-sel 16px on phones: a sub-16px focused control zooms the iOS viewport (and the zoom outlives it)
      '@media (max-width:620px){.emoji-body,.emoji-suggest{max-height:40vh}.emoji-cell{width:2.4em;height:2.4em;font-size:1.45rem}.av-cell{width:3.4em;height:3.4em}.scripture-sel{max-width:9em;font-size:16px}}';
    var st = el('style'); st.id = 'mc-emoji-css'; st.textContent = css;
    document.head.appendChild(st);
  }

  /* ---- Drafts. Whatever you type is kept in this browser's localStorage as
     you type it, one slot per composer: this page's comment box, each board
     category's new-topic form, each topic's reply box, each DM thread, each
     post being edited. A crashed browser or a dead phone costs nothing, come
     back and the words are where you left them. A slot is cleared when its
     post lands (or its edit is cancelled), and any slot untouched for thirty
     days is swept on the next visit. Purely client-side, the server never
     sees a draft. ---- */
  var DRAFT_NS = 'mc-draft:';
  var DRAFT_KEEP_MS = 30 * 86400 * 1000;

  function draftRead(ctx: any) {
    try {
      var d = JSON.parse(localStorage.getItem(DRAFT_NS + ctx) as string);
      return d && typeof d.body === 'string' ? d : null;
    } catch (e) { return null; }
  }

  function draftClear(ctx: any) {
    try { localStorage.removeItem(DRAFT_NS + ctx); } catch (e) {}
  }

  (function pruneDrafts() {
    try {
      var cut = Date.now() - DRAFT_KEEP_MS;
      var dead = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (!k || k.indexOf(DRAFT_NS) !== 0) continue;
        var d = null;
        try { d = JSON.parse(localStorage.getItem(k) as string); } catch (e2) {}
        if (!d || !(d.at > cut)) dead.push(k);
      }
      dead.forEach(function (k2) { localStorage.removeItem(k2); });
    } catch (e) {}
  })();

  /* Wire a composer to its slot: restore on build, save as it changes (the
     toolbar, pickers, and quote button all dispatch input like typing does),
     flush when the tab is hidden or torn down. A successful post calls
     ta.mcDraftDone(), which clears the slot and holds further saves until the
     next real keystroke, so a teardown flush on the way to a redirect can
     never resurrect what was just posted. With overwrite set (editing an
     existing post), a differing draft wins over the prefilled body. */
  function attachDraft(ta: any, ctx: string, titleInput?: any, overwrite?: boolean) {
    var muted = false;
    var timer: any = null;
    var d = draftRead(ctx);
    if (d) {
      if (d.body && (overwrite ? d.body !== ta.value : !ta.value)) ta.value = d.body;
      if (titleInput && d.title && !titleInput.value) titleInput.value = d.title;
    }
    function save() {
      if (muted || !ta.isConnected) return;
      var body = ta.value;
      var title = titleInput ? titleInput.value : '';
      try {
        if (!body.trim() && !title.trim()) localStorage.removeItem(DRAFT_NS + ctx);
        else localStorage.setItem(DRAFT_NS + ctx,
          JSON.stringify({ body: body, title: title || undefined, at: Date.now() }));
      } catch (e) {}
    }
    function later() { muted = false; clearTimeout(timer); timer = setTimeout(save, 400); }
    ta.addEventListener('input', later);
    ta.addEventListener('blur', save);
    if (titleInput) {
      titleInput.addEventListener('input', later);
      titleInput.addEventListener('blur', save);
    }
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') save();
    }, { signal: bootSig });
    addEventListener('pagehide', save, { signal: bootSig });
    ta.mcDraftDone = function () {
      muted = true;
      clearTimeout(timer);
      draftClear(ctx);
    };
  }

  /* Wrap a compose textarea with a button row above,
     returning the wrapper to mount where the textarea would have gone. The
     textarea itself is unchanged, so .comment-text lookups still resolve.
     A topic form passes its title input too, so the preview can wear it. */
  function mdEditor(textarea: any, titleInput?: any) {
    var wrap = el('div', 'md-editor');
    var bar = el('div', 'md-toolbar');
    bar.appendChild(mdButton('B', 'Bold  **text**', 'md-b', function () { wrapSel(textarea, '**', '**'); }));
    bar.appendChild(mdButton('I', 'Italic  *text*', 'md-i', function () { wrapSel(textarea, '*', '*'); }));
    bar.appendChild(mdButton('” Quote', 'Blockquote  > line', null, function () { linePrefix(textarea, '> '); }));
    bar.appendChild(mdButton('• List', 'Bulleted list  - item', null, function () { linePrefix(textarea, '- '); }));
    bar.appendChild(mdButton('Link', 'Link  [text](url) — merecatholicity.com only', null, function () { insertLink(textarea); }));
    var panel = buildEmojiPanel(textarea);
    var scripture = buildScripturePanel(textarea);
    bar.appendChild(mdButton('😊 Emoji', 'Insert an emoji', 'md-emoji', function () { scripture.closePanel(); panel.toggle(); }));
    bar.appendChild(mdButton('✝ Scripture', 'Insert a Bible passage', 'md-scripture', function () { panel.closePanel(); scripture.toggle(); }));
    wrap.appendChild(bar);
    wrap.appendChild(textarea);
    wrap.appendChild(panel);
    wrap.appendChild(scripture);
    /* Preview rides the composer: the whole editor swaps for the post as it
       will render, drawn by the same fillBody that draws every published
       comment, and one click swaps back. The state lives on the textarea
       because button rows are rebuilt whenever identity changes, so any
       button made by previewButton binds here and is relabeled in place.
       The value is untouched, posting works from either side. */
    var pvBox: any = null;
    var pvBtns: any[] = [];
    textarea.mcPreview = {
      active: false,
      bind: function (btn: any) {
        pvBtns.push(btn);
        btn.textContent = this.active ? 'Edit' : 'Preview';
      },
      toggle: function () { this.set(!this.active); },
      off: function () { this.set(false); },
      set: function (on: any) {
        if (on === this.active) return;
        this.active = on;
        if (on) {
          panel.closePanel();
          scripture.closePanel();
          pvBox = el('div', 'comment-body md-preview');
          if (textarea.value.trim()) fillBody(pvBox, textarea.value);
          else pvBox.appendChild(el('p', 'md-preview-empty', 'Nothing to preview yet.'));
          var t = titleInput ? titleInput.value.replace(/\s+/g, ' ').trim() : '';
          if (t) pvBox.insertBefore(el('p', 'md-preview-title', t), pvBox.firstChild);
          wrap.appendChild(pvBox);
          wrap.classList.add('md-previewing');
        } else {
          if (pvBox) pvBox.remove();
          pvBox = null;
          wrap.classList.remove('md-previewing');
          textarea.focus();
        }
        if (titleInput) titleInput.style.display = on ? 'none' : '';
        pvBtns = pvBtns.filter(function (b) { return b.isConnected; });
        pvBtns.forEach(function (b) { b.textContent = on ? 'Edit' : 'Preview'; });
      }
    };
    attachEmoji(textarea);
    textarea.addEventListener('focus', prefetchEmoji, { once: true });
    return wrap;
  }

  /* The Preview and back-to-Edit toggle that sits beside every Post button.
     Rows rebuild when identity changes, so the label reads the live state
     and bind keeps whichever button currently stands relabeled. */
  function previewButton(ta: any) {
    if (!ta || !ta.mcPreview) return null;
    var btn = el('button', 'btn btn-preview', 'Preview');
    btn.type = 'button';
    btn.title = 'Read the post as it will look';
    btn.addEventListener('click', function () { ta.mcPreview.toggle(); });
    ta.mcPreview.bind(btn);
    return btn;
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
          fetch(API + '/report', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: state.key, id: c.id, reason: reason }),
          }).then(function (r) { return r.json(); }).then(function (d) {
            if (blockedOut(d)) return;
            reportLink.textContent = d.ok ? 'reported' : 'report';
            reportLink.title = d.ok ? 'Reported to the moderators. Thank you.' : (d.error || 'Could not report.');
          }).catch(function () {});
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
      var excerpt = quotedSelection || truncate(c.body, 400);
      quotedSelection = '';
      quoteInto(c, excerpt, permalinkFor(c, quoteCtx));
    });
    items.push(quote);
    if (c.author_hash && c.author_hash === state.myHash) {
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
    if (items.length) {
      head.appendChild(postMenu({ items: items, onOpen: function () { quotedSelection = selectionInPost(c); } }));
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

  /* Reads are browser-cached for 60s. To someone who just wrote, that
     cache makes their own change vanish on reload, so recent writers
     bypass it until the cache would be fresh again. */
  function freshOpts(): RequestInit | undefined {
    var posted = 0;
    try { posted = Number(localStorage.getItem('mc-posted-at')) || 0; } catch (e) {}
    return (Date.now() - posted < 90000) ? { cache: 'no-store' } : undefined;
  }

  function stampFresh() {
    try { localStorage.setItem('mc-posted-at', String(Date.now())); } catch (e) {}
    if (window.mcStore) window.mcStore.invalidate();
  }

  /* Keyed visitors ask the server for the short-cache profile and keep
     today's behavior to the letter. Anonymous readers ride a five-minute
     browser cache, their repeat views never reaching the worker. */
  function freshParam(sep: any) {
    return state.key ? sep + 'fresh=1' : '';
  }

  /* Reads route through the shell's store when it stands (in-memory TTL +
     in-flight dedup — the free-tier budget law's second half: rapid view
     hops render from memory instead of drawing keyed reads from the shared
     rate bucket). Without the shell, the plain transport serves as always.
     WRITES never come through here. */
  function cachedJson(url: any, init: any, ttl: any) {
    if (window.mcStore) {
      return window.mcStore.fetchJson(function (u, i) { return fetchRetry(u, i, [1000, 3000]); },
        url, init, { ttl: ttl, bypass: !!freshOpts() });
    }
    return fetchRetry(url, init, [1000, 3000]).then(function (r) { return r.json(); });
  }

  function load() {
    var list = section.querySelector('.comments-list') as HTMLElement;
    fetchRetry(API + '?page=' + encodeURIComponent(pagePath()) + freshParam('&'), freshOpts(), [1000, 3000],
      function () { setStatus('Network hiccup, retrying...'); })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok) throw new Error(d.error || 'failed');
        state.anonAllowed = !!d.anon;
        renderIdentity();
        list.textContent = '';
        d.comments.forEach(function (c: any) { list.appendChild(commentNode(c, false, { page: pagePath() })); });
        section.querySelector('.comments-title-text')!.textContent =
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
  function buildFingerprint(m: any, identities: any) {
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
      details.appendChild(modShadowLine(m.author_hash, !!m.shadowbanned));
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

  function annotateMeta(pageKey?: any) {
    if (!isAdmin()) return;
    fetch(API + '/meta', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ page: pageKey || pagePath(), key: state.key }),
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (!d.ok) return;
      d.meta.forEach(function (m: any) {
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
  function annotateProfileMeta(hash: any, card: any) {
    if (!isAdmin()) return;
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
          .forEach(function (l) { renderTrustLine(l, hash, d.trusted); });
      }).catch(function () {});
    });
    line.appendChild(a);
  }

  /* Admin moderation controls, all inside the user-fingerprint dropdown and
     each guarded by appConfirm() — a slide-up sheet on phones, the native
     confirm on desktop, reading the same either way. A reload after each so
     the page returns true. */

  function modLockLine(hash: any, locked: any) {
    var line = el('div', 'trust-line');
    line.appendChild(document.createTextNode(locked ? 'Locked. ' : 'Unlocked. '));
    var a = el('a', 'trust-toggle', locked ? '(toggle-unlocked)' : '(toggle-locked)');
    a.href = '#';
    a.addEventListener('click', function (e: any) {
      e.preventDefault();
      var doLock = function () {
        fetch(API + '/lock', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: state.key, hash: hash, locked: !locked }),
        }).then(function (r) { return r.json(); }).then(function (d) {
          if (d.ok) location.reload();
        }).catch(function () {});
      };
      if (locked) doLock();
      else appConfirm('Lock this identity? They will be logged out and unable to interact until you unlock them.', { okLabel: 'Lock', danger: true }, function (ok: any) { if (ok) doLock(); });
    });
    line.appendChild(a);
    return line;
  }

  /* Shadow ban: a quiet global mute. Their posts keep succeeding and they are
     never logged out or told, but their public content is hidden from everyone
     else and announces nothing. Toggles in place (no reload) so nothing about
     the admin's own view flashes. The author never sees any of this. */
  function modShadowLine(hash: any, shadowbanned: any) {
    var line = el('div', 'trust-line');
    function render(on: any) {
      line.textContent = '';
      line.appendChild(document.createTextNode(on
        ? 'Shadow banned. Their posts are muted globally — hidden from everyone else, and they are not told. '
        : 'Not shadow banned. '));
      var a = el('a', 'trust-toggle', on ? '(un-shadowban)' : '(shadow ban)');
      a.href = '#';
      a.addEventListener('click', function (e: any) {
        e.preventDefault();
        var doShadow = function () {
          fetch(API + '/shadowban', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: state.key, hash: hash, on: !on }),
          }).then(function (r) { return r.json(); }).then(function (d) {
            if (d && d.ok) render(!!d.shadowbanned);
          }).catch(function () {});
        };
        if (on) doShadow();
        else appConfirm('Shadow ban this identity? Their posts will be hidden from everyone else site-wide, but they can keep posting and will not be told. Undo it here any time.', { okLabel: 'Shadow ban', danger: true }, function (ok: any) { if (ok) doShadow(); });
      });
      line.appendChild(a);
    }
    render(shadowbanned);
    return line;
  }

  /* The IP block in a fingerprint: every address known for this identity, each
     bannable on its own, and a ban-all that shuts both families of a dual-stack
     user in one act. A v4 that looks like carrier-grade NAT is flagged, since it
     may be shared by many people. */
  function modIpBlock(rows: any) {
    var wrap = el('div', 'ip-block');
    if (!rows.length) {
      wrap.appendChild(el('div', 'trust-line', 'No IP on record.'));
      return wrap;
    }
    if (rows.length > 1) {
      var allBanned = rows.every(function (r: any) { return r.banned; });
      var head = el('div', 'trust-line');
      head.appendChild(document.createTextNode('Known IPs (' + rows.length + '). '));
      var all = el('a', 'trust-toggle', allBanned ? '(unban all)' : '(ban all IPs)');
      all.href = '#';
      all.addEventListener('click', function (e: any) {
        e.preventDefault();
        var doBan = function () { ipbanRequest(rows.map(function (r: any) { return r.ip_key; }), !allBanned); };
        if (allBanned) doBan();
        else appConfirm(banAllPrompt(rows), { okLabel: 'Ban all', danger: true }, function (ok: any) { if (ok) doBan(); });
      });
      head.appendChild(all);
      wrap.appendChild(head);
    }
    rows.forEach(function (r: any) { wrap.appendChild(ipRow(r)); });
    return wrap;
  }

  function ipRow(r: any) {
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
    a.addEventListener('click', function (e: any) {
      e.preventDefault();
      var doBan = function () { ipbanRequest([r.ip_key], !r.banned); };
      if (r.banned) { doBan(); return; }
      appConfirm('Ban ' + r.ip_display + '?' +
        (isSharedV4Client(r.ip_display) ? ' This looks like carrier-grade NAT, shared by many users; banning it may block innocents.' : '') +
        '\n\nLogged-in users from it will be blocked and sent to the terms page.',
      { okLabel: 'Ban', danger: true }, function (ok: any) { if (ok) doBan(); });
    });
    line.appendChild(a);
    return line;
  }

  function banAllPrompt(rows: any) {
    var shared = rows.filter(function (r: any) { return isSharedV4Client(r.ip_display); });
    return 'Ban all ' + rows.length + ' IPs for this identity?\n\n' +
      rows.map(function (r: any) { return (r.family === 6 ? 'IPv6 ' : 'IPv4 ') + r.ip_display; }).join('\n') +
      (shared.length ? '\n\nWARNING: ' + shared.map(function (r: any) { return r.ip_display; }).join(', ') +
        ' looks like carrier-grade NAT (shared by many users); banning may block innocents.' : '') +
      '\n\nLogged-in users from any of them will be blocked and sent to the terms page.';
  }

  function ipbanRequest(keys: any, banned: any) {
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
  function wireRdns(details: any, rows: any) {
    if (!rows.length) return;
    details.addEventListener('toggle', function () {
      if (!details.open || details.__rdnsDone) return;
      details.__rdnsDone = true;
      var want = rows.map(function (r: any) { return r.ip_display; })
        .filter(function (ip: any) { return !(ip in rdnsCache); });
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

  function fillRdns(details: any) {
    details.querySelectorAll('.ip-rdns').forEach(function (span: any) {
      var host = rdnsCache[span.getAttribute('data-ip')];
      if (host) span.textContent = host + ' ';
    });
  }

  function modHelpNote() {
    return el('p', 'mod-help',
      'Handling a troublesome user: an identity is only a key in a browser, so a locked or deleted one can be remade in a click. To actually keep someone out, ban the IP first, while it still shows above, then lock or delete the identity. IP bans reach signed-in users only, never anonymous cached reading, and a determined person can switch networks. Lean on bans sparingly, and reserve deletion for the worst.');
  }

  function modDeleteUserLine(hash: any) {
    var line = el('div', 'trust-line');
    var a = el('a', 'trust-toggle danger', 'Delete user and all posts');
    a.href = '#';
    a.addEventListener('click', function (e: any) {
      e.preventDefault();
      appConfirm('DELETE THIS USER? This permanently deletes ALL of their posts, their profile, and their avatar, and locks the identity so they cannot post again. This cannot be undone. Continue?', { okLabel: 'Continue', danger: true }, function (ok1: any) {
        if (!ok1) return;
        appConfirm('Are you sure? There is no undo.', { okLabel: 'Delete user', danger: true }, function (ok2: any) {
          if (!ok2) return;
          fetch(API + '/deleteuser', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: state.key, hash: hash }),
          }).then(function (r) { return r.json(); }).then(function (d) {
            if (d.ok) location.reload();
          }).catch(function () {});
        });
      });
    });
    line.appendChild(a);
    return line;
  }

  /* ---- Unread badge. One localStorage-cached count, refreshed from the
     server at most every ninety seconds, so idle page turns cost nothing.
     Inbox and thread responses refresh the cache for free. ---- */

  var DM_CACHE = 'mc-dm-unread';

  function dmCacheGet() {
    try { return JSON.parse(localStorage.getItem(DM_CACHE) as string) || null; } catch (e) { return null; }
  }
  function dmCacheSet(n: any) {
    try { localStorage.setItem(DM_CACHE, JSON.stringify({ n: n, at: Date.now() })) } catch (e) {}
    renderIdentity();
    badgeChanged();
  }

  function dmUnreadCheck(force?: boolean) {
    if (!state.key) return;
    var c = dmCacheGet();
    if (!force && c && Date.now() - c.at < 90000) return;
    /* Stamp first, so parallel page loads inside the window stay quiet. */
    try { localStorage.setItem(DM_CACHE, JSON.stringify({ n: c ? c.n : 0, at: Date.now() })) } catch (e) {}
    readMark();
    fetch(API + '/dm/unread', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: state.key }),
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (blockedOut(d)) return;
      if (readThrottled(d)) readEase();
      if (d.ok) dmCacheSet(d.unread);
    }).catch(function () {});
  }

  /* The notification badge rides the same one-count, ninety-second-cached
     mechanism as the DM badge: a reply in a watched thread or an @mention. */
  var NOTIF_CACHE = 'mc-notif-unread';
  function notifCacheGet() {
    try { return JSON.parse(localStorage.getItem(NOTIF_CACHE) as string) || null; } catch (e) { return null; }
  }
  function notifCacheSet(n: any) {
    try { localStorage.setItem(NOTIF_CACHE, JSON.stringify({ n: n, at: Date.now() })) } catch (e) {}
    renderIdentity();
    badgeChanged();
  }
  /* Tell the mobile app chrome (tab bar + notification bell) a badge changed, so
     they update the instant a DM or notification lands, not on their own poll. */
  function badgeChanged() {
    try { document.dispatchEvent(new CustomEvent('mc-badge')); } catch (e) {}
  }
  /* A confirm that becomes an app dialog on phones (window.mcConfirm from the
     shell) and stays the native confirm on desktop. cb receives true/false. */
  function appConfirm(msg: any, opts: any, cb: any) {
    if (window.mcConfirm) window.mcConfirm(msg, opts || {}).then(cb);
    else cb(window.confirm(msg));
  }
  /* Mark a topic read on open — deduped so paging through a thread does not fire
     the write on every page turn (opening any page already marks the whole thread
     read). One write per topic per minute; the notif badge rides its response. */
  var _readMarks: Record<string, number> = {};
  function markThreadRead(topicId: any) {
    if (!state.key || !topicId) return;
    var now = Date.now();
    if (_readMarks[topicId] && now - _readMarks[topicId] < 60000) return;
    _readMarks[topicId] = now;
    fetch(API + '/board/read', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: state.key, topic: topicId }),
    }).then(function (r) { return r.json(); }).then(function (rd) {
      if (rd && rd.ok && typeof rd.notif_unread === 'number') notifCacheSet(rd.notif_unread);
    }).catch(function () {});
  }
  function notifUnreadCheck(force?: boolean) {
    if (!state.key) return;
    var c = notifCacheGet();
    if (!force && c && Date.now() - c.at < 90000) return;
    try { localStorage.setItem(NOTIF_CACHE, JSON.stringify({ n: c ? c.n : 0, at: Date.now() })) } catch (e) {}
    readMark();
    fetch(API + '/notifications/unread', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: state.key }),
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (blockedOut(d)) return;
      if (readThrottled(d)) readEase();
      if (d.ok) notifCacheSet(d.unread);
    }).catch(function () {});
  }

  /* ---- Live DMs and notifications (window.mcLive private user scope) ----
     A signed-in member authenticates the board socket and subscribes to its own
     user:<hash> scope; the worker pushes that member's DMs and notifications
     instantly. Here we turn those pushes into the badge tick, the open DM thread
     drop-in, and (for the Lit lists) a self-refresh. No push ⇒ the 90-second
     poll below is the fallback, exactly as before. */
  var dmBadgeT = 0, notifBadgeT = 0;
  /* Refresh a badge from the server, debounced so a burst of events (and the
     shared read budget) coalesce into one fresh read. */
  /* Both are reached ONLY from live socket events (never the 90s polls or page
     boot), so the bell sound obeys the "already on the site" rule for free. */
  function liveDmBadge() { playSound('bell'); clearTimeout(dmBadgeT); dmBadgeT = setTimeout(function () { dmUnreadCheck(true); }, 300); }
  function liveNotifBadge() { playSound('bell'); clearTimeout(notifBadgeT); notifBadgeT = setTimeout(function () { notifUnreadCheck(true); }, 300); }

  function onLiveDm(m: any) {
    var openDm = new URLSearchParams(location.search).get('dm');
    if (state.dmView && openDm && openDm === m.from && m.message) {
      state.dmView.append(m.message);   // instant in the open conversation
    } else {
      liveDmBadge();   // a background thread — ring the badge (McInbox self-refreshes if open)
    }
  }
  /* The other party changed the disappearing-message lifetime: update the open
     conversation's expiry note live so both sides always show the same setting. */
  function onLiveDmTtl(m: any) {
    var openDm = new URLSearchParams(location.search).get('dm');
    if (state.dmView && openDm && openDm === m.from && state.dmView.setTtl) state.dmView.setTtl(m.ttl);
  }
  /* The other party edited a message they sent me: re-render that bubble live. */
  function onLiveDmEdit(m: any) {
    var openDm = new URLSearchParams(location.search).get('dm');
    if (state.dmView && openDm && openDm === m.from && m.message && state.dmView.editMsg) state.dmView.editMsg(m.message);
  }
  /* The other party deleted a message they sent me: replace it with "<redacted>". */
  function onLiveDmRedact(m: any) {
    var openDm = new URLSearchParams(location.search).get('dm');
    if (state.dmView && openDm && openDm === m.from && m.message && state.dmView.redactMsg) state.dmView.redactMsg(m.message.id);
  }
  /* The other party liked (or unliked) a message in the open conversation:
     light the heart on that bubble. Quiet by design — no badge, no sound. */
  function onLiveDmLike(m: any) {
    var openDm = new URLSearchParams(location.search).get('dm');
    if (state.dmView && openDm && openDm === m.from && m.message && state.dmView.likeMsg) state.dmView.likeMsg(m.message);
  }
  function onLiveNotif() {
    /* The notifications list (McNotifications) reloads itself and marks read;
       elsewhere, just ring the badge. */
    if (new URLSearchParams(location.search).get('notifications') === '1') return;
    liveNotifBadge();
  }
  /* The recipient opened my messages: flip the open conversation's sent bubbles
     to "Seen" up to their read timestamp. m.reader is the other party. */
  function onLiveDmRead(m: any) {
    var openDm = new URLSearchParams(location.search).get('dm');
    if (state.dmView && openDm && openDm === m.reader && state.dmView.markRead) state.dmView.markRead(m.at);
  }
  /* The other party is (or stopped) typing — show/hide the "…typing" line in the
     open conversation only. */
  function onLiveTyping(m: any) {
    var openDm = new URLSearchParams(location.search).get('dm');
    if (state.dmView && openDm && openDm === m.from && state.dmView.setTyping) state.dmView.setTyping(m.state !== 'stop');
  }
  /* A member's online state changed: update the open thread's header dot and any
     inbox row dot. */
  function onLivePresence(m: any) {
    if (state.dmView && state.dmView.other === m.hash && state.dmView.setPresence) state.dmView.setPresence(!!m.online);
    if (state.inboxPresence) state.inboxPresence(m.hash, !!m.online);
  }
  /* Authenticate the live socket for this member so DM/notif pushes arrive. */
  function enableMemberLive() {
    ensureMyPubkey();   // publish this identity's DM public key once it is live
    if (isMember() && window.mcLive && window.mcLive.member) {
      window.mcLive.member.enable(state.key, state.myHash);
    }
    loadPrefs();
  }
  /* The member's private settings-gear prefs (read-receipts mode + per-type
     notification switches). Loaded once so the DM view can honour receipts
     reciprocally; the gear reads/writes them too. */
  function loadPrefs() {
    if (!state.key) return;
    fetch(API + '/prefs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: state.key }) })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.ok) return;
        state.prefs = d.prefs; window.mcPrefs = d.prefs;
        /* Merge the server's mute list with this device's (union), and push
           the union back up when this device knew someone the server did not,
           so every device converges on the same list. */
        try {
          var server = Array.isArray(d.prefs && d.prefs.muted) ? d.prefs.muted : [];
          var local = getMuted();
          var union = local.slice();
          server.forEach(function (h: any) {
            if (/^[0-9a-f]{64}$/.test(String(h)) && union.indexOf(h) === -1) union.push(h);
          });
          if (union.length !== local.length) localStorage.setItem(MUTED_STORE, JSON.stringify(union));
          if (union.length !== server.length) syncMutedUp();
        } catch (e) { /* storage blocked */ }
      })
      .catch(function () {});
  }
  /* ================= 1v1 voice calls =================
     The ENGINE lives in the shell bundle now (app/call.ts, 2026-08-03) so a
     receiver rings on ANY page — not just the ones this client boots on, and
     not subject to this boot's teardown cycle. This file keeps only the 📞
     buttons, which delegate to window.mcCall.place(), and the /config gate
     that decides whether to render them. */
  function callsCfg() {
    return cachedJson(API + '/config', undefined, 300000)
      .then(function (d: any) { return { enabled: !(d && d.ok && d.calls && d.calls.enabled === false) }; })
      .catch(function () { return { enabled: true }; });   // server refuses regardless
  }
  function placeCall(other: string, label: string) {
    var mc: any = (window as any).mcCall;
    if (mc && mc.place) mc.place(other, label);
  }
  function callButton(other: string, label: string) {
    var b = utilBtnLabel(el('button', 'btn btn-attach mc-call-btn'), '📞', 'Call');
    b.type = 'button';
    b.title = 'Voice call (end-to-end encrypted)';
    b.addEventListener('click', function () { placeCall(other, label); });
    return b;
  }

  document.addEventListener('mc-live', function (ev) {
    var m = (ev as CustomEvent).detail; if (!m) return;
    if (m.t === 'dm') onLiveDm(m);
    else if (m.t === 'dm-ttl') onLiveDmTtl(m);
    else if (m.t === 'dm-edit') onLiveDmEdit(m);
    else if (m.t === 'dm-redact') onLiveDmRedact(m);
    else if (m.t === 'dm-like') onLiveDmLike(m);
    else if (m.t === 'dm-read') onLiveDmRead(m);
    else if (m.t === 'typing') onLiveTyping(m);
    else if (m.t === 'presence') onLivePresence(m);
    else if (m.t === 'notification') onLiveNotif();
    else if (m.t === 'wall-post' || m.t === 'wall-comment') { if (state.onLiveWall) state.onLiveWall(m); }
  }, { signal: bootSig });

  /* A locked identity or a banned network, discovered on any keyed call:
     forget the key, raise a message that outlives the redirect, and land on
     the terms page. This is what "logged out and cannot come back" looks like. */
  function blockedOut(d: any) {
    if (!d || !d.blocked) return false;
    try {
      localStorage.setItem('mc-flash', window.mcCore
        ? window.mcCore.blockedMessage(d.blocked)
        : (d.blocked === 'ipban'
          ? 'Your network is banned from merecatholicity.com for violating the Terms and Conditions.'
          : 'This identity has been locked by the moderators for violating the Terms and Conditions.'));
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
    /* The -in / -out modifier lets the mobile CSS hide the redundant logged-in nav
       line (every link is in the tab bar / app-bar / settings sheet) while keeping
       the logged-out create line, which is the only join path on article pages. */
    var loggedIn = !!(isMember());
    var line = el('p', 'identity-line ' + (loggedIn ? 'identity-line-in' : 'identity-line-out'));
    if (loggedIn && !box.classList.contains('comment-identity-nav')) {
      /* Readability standard: the logged-in five-link utilities row renders
         ONLY into the box the board index marks (comment-identity-nav). Every
         other page already reaches those doors through the deskbar/tab-bar and
         the gear, and the duplicated pill rows were half the visual noise on
         category/topic pages. A hidden stamp keeps every standing
         MutationObserver on .comment-identity firing on login/logout; the
         logged-out create-identity branch below is untouched everywhere (it is
         the one join path on article pages). */
      var stamp = el('span', 'identity-stamp');
      stamp.hidden = true;
      box.appendChild(stamp);
      return;
    }
    if (loggedIn) {
      /* First line: where to go, grouped — your activity (the two badge feeds),
         then people (you, then the roster), then search over it all. */
      var notifLink = el('a', 'identity-action', 'Notifications');
      notifLink.href = 'community.html?notifications=1';
      line.appendChild(notifLink);
      var nc = notifCacheGet();
      if (nc && nc.n > 0) line.appendChild(el('span', 'dm-unread', ' (' + nc.n + ')'));
      line.appendChild(document.createTextNode(' · '));
      var inboxLink = el('a', 'identity-action', 'Inbox');
      inboxLink.href = 'messages.html';
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
      /* merecat is NOT listed here — it has its own tab in the app rail / bottom
         bar and is clearly marked there; a second entry on this line is redundant. */
      /* The platform-level identity controls (who you are, Show my key, Logout)
         moved OUT of the forum line into the platform chrome / Settings gear, now
         that the site is a platform and not only a forum. Forum controls stay. */
    } else {
      line.appendChild(document.createTextNode(state.anonAllowed
        ? 'Commenting anonymously. '
        : 'To comment, create an identity. One click, no signup. '));
      /* Both actions open the app-native onboarding modal (a slide-up sheet on
         phones, a centered popup on desktop) — the same slick animation the tab
         gates use. Only ?app=0 (no shell) falls back to the classic inline drawer.
         "I have a key" opens the modal straight to its paste-your-key box. */
      line.appendChild(identityAction('Create an identity', function () {
        if (window.mcOnboard) window.mcOnboard();
        else showAgreeBox();
      }));
      line.appendChild(document.createTextNode(' · '));
      line.appendChild(identityAction('I have a key', function () {
        if (window.mcOnboard) window.mcOnboard(null, { key: true });
        else showPasteBox();
      }));
    }
    box.appendChild(line);
  }

  function identityAction(label: any, onClick: any) {
    var a = el('a', 'identity-action', label);
    a.href = '#';
    a.addEventListener('click', function (e: any) { e.preventDefault(); onClick(); });
    return a;
  }

  /* Signup is one checkbox deep. Agreeing to the terms is what creates
     the identity, so every commenter has agreed by construction. */
  function showAgreeBox() {
    var box = section.querySelector('.key-box') as HTMLElement;
    box.textContent = '';
    box.appendChild(el('p', 'key-note',
      'Membership is open to North America, Europe, Russia, Israel, Korea, Japan, and Oceania. ' +
      'Elsewhere it is declined, for security, spam, relevance, and quality.'));
    /* A faith declaration is required to join: one of the three welcomed here.
       It is kept in the browser and shown on your posts and profile. */
    var chosenFaith = getFaith() || '';
    box.appendChild(faithRadios(chosenFaith, function (code: any) { chosenFaith = code; refresh(); }));
    var label = el('label', 'agree-row');
    var check = el('input');
    check.type = 'checkbox';
    label.appendChild(check);
    label.appendChild(document.createTextNode(' I agree to the '));
    var terms = el('a', null, 'Terms & Conditions');
    terms.href = 'terms.html';
    terms.target = '_blank';
    label.appendChild(terms);
    box.appendChild(label);
    /* Adults only (terms + privacy): confirming 18+ is required to join. */
    var ageLabel = el('label', 'agree-row');
    var ageCheck = el('input');
    ageCheck.type = 'checkbox';
    ageLabel.appendChild(ageCheck);
    ageLabel.appendChild(document.createTextNode(' I am at least 18 years old.'));
    box.appendChild(ageLabel);
    var row = el('div', 'key-row');
    var create = el('button', 'btn btn-send key-copy', 'Create');
    create.type = 'button';
    create.disabled = true;
    function refresh() { create.disabled = !(check.checked && ageCheck.checked && chosenFaith); }
    check.addEventListener('change', refresh);
    ageCheck.addEventListener('change', refresh);
    create.addEventListener('click', function () {
      if (!check.checked || !ageCheck.checked || !chosenFaith) return;
      try { localStorage.setItem('mc-agreed-at', String(Date.now())); } catch (e) {}
      setFaith(chosenFaith);
      var key = makeKey();
      setKey(key);
      state.key = key;
      sha256hex(key).then(function (h) {
        state.myHash = h;
        enableMemberLive();
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
    var box = section.querySelector('.key-box') as HTMLElement;
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
    var box = section.querySelector('.key-box') as HTMLElement;
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
        enableMemberLive();
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

  /* The identity mint + login, factored out for the app-native onboarding sheet
     (window.mcKit.mintIdentity / loginWithKey, called from app/appchrome.js on
     phones). Same steps as showAgreeBox's Create and showPasteBox's Use it; the
     sheet reloads on success (like the classic BOARD login), so these only mint,
     store, set state, and resolve — they do not repaint. */
  function mintIdentity(faith: any) {
    try { localStorage.setItem('mc-agreed-at', String(Date.now())); } catch (e) {}
    if (faith) setFaith(faith);
    var key = makeKey();
    setKey(key);
    state.key = key;
    return sha256hex(key).then(function (h) {
      state.myHash = h;
      enableMemberLive();
      return { key: key, hash: h };
    });
  }
  function loginWithKey(key: any) {
    key = String(key || '').trim();
    if (key.length < 16) return Promise.resolve(false);
    setKey(key);
    state.key = key;
    try { localStorage.removeItem(DM_CACHE); } catch (e) {}
    return sha256hex(key).then(function (h) {
      state.myHash = h;
      enableMemberLive();
      return true;
    });
  }

  function hideKeyBox() {
    var box = section.querySelector('.key-box') as HTMLElement;
    box.hidden = true;
    box.textContent = '';
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
      list.appendChild(commentNode(d.comment, d.status === 'pending', { page: pagePath() }));
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

  /* ---- The Community ---- */

  function crumb(parts: any) {
    var p = el('p', 'board-crumb');
    parts.forEach(function (part: any, i: any) {
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

  /* ---- The attachment stash: a picked or RECORDED file survives a reload.
     Born of a live loss (2026-08-03): a voice note rode a new-topic composer,
     the page died at Post (an iOS engine reload no page script can prevent),
     and the recording — already uploaded, its media_key held only in JS
     memory — was orphaned and swept. Text drafts survive via attachDraft;
     this is the same covenant for media. IndexedDB, because a blob has no
     place in localStorage: one record per composer place {blob, name, type,
     size, key, at}. A stashed upload key is reused while the server's
     unlinked-orphan window (15 min) can still hold the row; past that the
     kept blob re-uploads through the normal gate. Cleared by ✕, by a
     successful post, and by age (24 h). Board + feed/wall composers; the DM
     composer is deliberately out (its media rides the E2E envelope, a
     different custody story). Best-effort throughout: no IndexedDB = exactly
     the old behavior. */
  var stashDbP: any = null;
  function mediaStashDb() {
    if (stashDbP) return stashDbP;
    stashDbP = new Promise(function (resolve) {
      try {
        var req = indexedDB.open('mc-media-stash', 1);
        req.onupgradeneeded = function () { try { req.result.createObjectStore('stash'); } catch (e) { /* raced */ } };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { resolve(null); };
      } catch (e) { resolve(null); }
    });
    return stashDbP;
  }
  function mediaStash(op: any, place: any, rec?: any) {
    return mediaStashDb().then(function (db: any) {
      if (!db) return null;
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction('stash', op === 'get' ? 'readonly' : 'readwrite');
          var st = tx.objectStore('stash');
          var r = op === 'get' ? st.get(place) : op === 'del' ? st.delete(place) : st.put(rec, place);
          r.onsuccess = function () { resolve(op === 'get' ? r.result : true); };
          r.onerror = function () { resolve(null); };
        } catch (e) { resolve(null); }
      });
    }).catch(function () { return null; });
  }
  /* The board composer's place, in attachDraft's own key grammar. */
  function boardMediaPlace() {
    var qs = new URLSearchParams(location.search);
    return qs.get('topic') ? 'reply:' + qs.get('topic') : 'topic:' + (qs.get('cat') || '');
  }

  /* The board composer's attach controls (📎 + 🎙), added asynchronously once
     the served settings say the board takes attachments at all. The pick path
     gates kind + size (images downscaled first), uploads at once to
     /board/media, and holds the returned media_key on state.boardMedia for the
     next boardPost; ✕ or a successful post clears it. The row lives OUTSIDE
     .comment-buttons, which identity re-renders wipe. The back-room composer
     gets no controls (the server refuses back-room attachments outright). */
  function attachBoardMedia(form: any) {
    state.boardMedia = null;
    if (new URLSearchParams(location.search).get('cat') === 'adminsonly') return;
    mediaCfg().then(function (cfg: any) {
      var sec = cfg.sections.board;
      if (!cfg.enabled || !sec.kinds.length) return;
      var core: any = window.mcCore;
      var row = el('div', 'mc-media-row');
      var fileInput = el('input', 'mc-board-file');
      fileInput.type = 'file';
      fileInput.accept = core.mediaAcceptFor(sec.kinds);
      fileInput.style.display = 'none';
      var chip = el('span', 'dm-attach-chip');
      chip.style.display = 'none';
      var note = el('span', 'mc-media-note');
      var place = boardMediaPlace();
      var held: any = { key: '', clear: clearHeld };
      function clearHeld() {
        held.key = '';
        fileInput.value = '';
        chip.style.display = 'none';
        chip.textContent = '';
        mediaStash('del', place);
      }
      state.boardMedia = held;
      var attach = utilBtnLabel(el('button', 'btn btn-attach'), '📎', 'Attach');
      attach.type = 'button';
      attach.addEventListener('click', function () { fileInput.click(); });
      function showChip(name: any, size: any) {
        chip.textContent = '';
        chip.appendChild(document.createTextNode('📎 ' + (name || 'attachment') + ' · ' + fmtBytes(size) + '  '));
        var x = el('a', null, '✕');
        x.href = '#';
        x.addEventListener('click', function (e: any) { e.preventDefault(); clearHeld(); });
        chip.appendChild(x);
        chip.style.display = '';
      }
      function takeFile(f: any) {
        note.textContent = '';
        mediaGateFile(f, cfg, sec, note).then(function (out: any) {
          if (!out) { fileInput.value = ''; return; }
          note.textContent = 'Uploading…';
          var fd = new FormData();
          fd.append('key', state.key || '');
          fd.append('file', out);
          fetchRetry(API + '/board/media', { method: 'POST', body: fd }, [1500])
            .then(function (r) { return r.json(); })
            .then(function (d: any) {
              if (blockedOut(d)) return;
              if (!d || !d.ok) { note.textContent = (d && d.error) || 'Upload failed.'; return; }
              note.textContent = '';
              held.key = d.media_key;
              showChip(out.name, out.size);
              /* The stash keeps BOTH the key (instant reuse) and the bytes
                 (re-upload once the server's orphan window has passed). */
              mediaStash('put', place, { blob: out, name: out.name || 'attachment',
                type: out.type || '', size: out.size, key: d.media_key, at: Date.now() });
            })
            .catch(function () { note.textContent = 'Upload failed. Try again.'; });
        });
      }
      /* A reload (or the iOS engine dying at Post) rebuilds the composer:
         re-adopt what the stash holds so the recording is still attached. */
      mediaStash('get', place).then(function (rec: any) {
        if (!rec || !rec.at || held.key || fileInput.value) return;
        if (Date.now() - rec.at > 86400000) { mediaStash('del', place); return; }
        if (rec.key && Date.now() - rec.at < 12 * 60000) {
          held.key = rec.key;
          showChip(rec.name, rec.size);
        } else if (rec.blob) {
          try {
            takeFile(new File([rec.blob], rec.name || 'attachment', { type: rec.type || rec.blob.type || '' }));
          } catch (e) { /* File ctor unavailable: stash stays for a newer engine */ }
        }
      });
      fileInput.addEventListener('change', function () {
        var f = fileInput.files && fileInput.files[0];
        if (f) takeFile(f);
      });
      row.appendChild(attach);
      if (sec.voice && sec.kinds.indexOf('audio') !== -1) row.appendChild(voiceControl(form, cfg, sec, note, takeFile));
      row.appendChild(chip);
      row.appendChild(note);
      form.appendChild(fileInput);
      var btnRow = form.querySelector('.comment-buttons');
      if (btnRow) form.insertBefore(row, btnRow);
      else form.appendChild(row);
    });
  }

  function armBoardForm() {
    renderIdentity();
    new MutationObserver(function () {
      if (state.boardBtn) boardButtons(state.boardBtn[0], state.boardBtn[1]);
    }).observe(section.querySelector('.comment-identity')!, { childList: true });
    loadTurnstile();
  }

  /* A row of page links, dropped at both the top and the bottom of every
     paginated view so the buttons are never a scroll away. Condensed when the
     count is high: always the first three and the last, plus the current page
     and its neighbours, an ellipsis spanning any wider gap, and a single
     hidden page shown outright rather than dotted over (so "1 2 3 … 25", but
     "1 2 3 4 5" when only five). Null below two pages. Call it twice for two
     live bars; hrefFor(i) gives each page its URL. */
  function pageBar(total: number, per: number, curPage: number, hrefFor: ((n: number) => string) | null, onGo?: (n: number) => void): HTMLElement | null {
    var pages = Math.ceil(total / per);
    if (pages <= 1) return null;
    var show: Record<number, boolean> = {};
    [1, 2, 3, curPage - 1, curPage, curPage + 1, pages].forEach(function (n) {
      if (n >= 1 && n <= pages) show[n] = true;
    });
    var nums = Object.keys(show).map(Number).sort(function (a, b) { return a - b; });
    var bar = el('p', 'board-pages');
    bar.appendChild(document.createTextNode('Pages: '));
    function link(n: number) {
      if (n === curPage) return el('strong', null, String(n));
      var a = el('a', null, String(n));
      /* onGo turns the page in place (member list); otherwise the number is a
         plain link the server resolves. */
      if (onGo) { a.href = '#'; a.addEventListener('click', function (e: any) { e.preventDefault(); onGo(n); }); }
      else a.href = hrefFor!(n);
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

  /* Admin topic controls on the category page. Reload after the act so
     the list, markers, and counts return true. */
  function modLinkEl(id: any, act: any, label: any) {
    var a = el('a', 'trust-toggle', label);
    a.href = '#';
    a.addEventListener('click', function (e: any) {
      e.preventDefault();
      var doAct = function () {
        fetch(API + '/moderate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: state.key, id: id, act: act }),
        }).then(function (r) { return r.json(); }).then(function (d) {
          if (d.ok) { stampFresh(); location.reload(); }
        }).catch(function () {});
      };
      if (act === 'delete') appConfirm('Delete this topic?', { okLabel: 'Delete', danger: true }, function (ok: any) { if (ok) doAct(); });
      else doAct();
    });
    return a;
  }

  /* The full admin corner for one topic: a Move dropdown plus sticky, lock, and
     delete. Shared by the category listing and the moderation console, so a topic
     is governed the same way wherever it shows. `curCat` is the topic's own
     category key, greyed in the Move list. Every act reloads the view on success. */
  function topicAdminCorner(topic: any, curCat: any) {
    var admin = el('span', 'board-admin-links board-admin-corner');
    var moveSel = el('select', 'board-move');
    var movePh = el('option', null, 'Move'); movePh.value = ''; moveSel.appendChild(movePh);
    CATS.forEach(function (c) {
      var o = el('option', null, c[1]); o.value = c[0];
      if (c[0] === curCat) o.disabled = true;
      moveSel.appendChild(o);
    });
    var resetMove = function () { moveSel.value = ''; if (moveSel.__mcHandle) moveSel.__mcHandle.refresh(); };
    moveSel.addEventListener('change', function () {
      var target = moveSel.value;
      if (!target) return;
      var name = catByKey(target)![1];
      appConfirm('Move "' + topic.title + '" to ' + name + '? The original poster will be notified by DM.', { okLabel: 'Move' }, function (ok: any) {
        if (!ok) { resetMove(); return; }
        fetch(API + '/move', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: state.key, id: topic.id, cat: target, catName: name }),
        }).then(function (r) { return r.json(); }).then(function (d) {
          if (d.ok) { stampFresh(); location.reload(); } else resetMove();
        }).catch(function () { resetMove(); });
      });
    });
    moveSel.setAttribute('aria-label', 'Move to category');
    /* The whole governance kit folds into one row-level ⋯ (the readability
       standard) — the Move select and every mod link keep their classes and
       handlers, they just live in the menu now. mcSelectSheet wraps the select
       AFTER it is parented inside the menu. */
    admin.appendChild(postMenu({ items: [
      moveSel,
      modLinkEl(topic.id, topic.sticky ? 'unsticky' : 'sticky', topic.sticky ? '(unsticky)' : '(sticky)'),
      modLinkEl(topic.id, topic.locked ? 'unlock' : 'lock', topic.locked ? '(unlock)' : '(lock)'),
      modLinkEl(topic.id, topic.readonly ? 'unreadonly' : 'readonly', topic.readonly ? '(un-read-only)' : '(read-only)'),
      modLinkEl(topic.id, 'delete', '(delete)'),
    ] }));
    if (window.mcSelectSheet) window.mcSelectSheet(moveSel);
    return admin;
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
    list.textContent = 'Loading topics...';
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
          location.href = 'community.html?topic=' + d.comment.id;
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
              location.href = 'community.html?topic=' + id + '&p=' + replyPage + '#comment-' + d2.comment.id;
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
        crumb([['Community', 'community.html'], ['Topic']]);
        section.appendChild(el('p', 'comments-status',
          err.message === 'No such topic.' ? 'No such topic. It may have been removed.'
            : 'The topic could not be loaded. Check your connection and reload the page.'));
      });
  }

  /* The audit: one line per commented page and per board topic, the last
     poster and the moment, pending marked. A quick answer to what is new. */
  /* The moderation console. Three actionable sections — reported posts, the
     review queue, and recent activity — each row governable in place, so an
     admin never has to leave to act. The in-context controls on the board stay;
     this is the one place that gathers everything waiting on a moderator. */
  /* Platform usage & limits: the Cloudflare free-tier health bars. A
     bundle-only Lit view (mc-usage in app/views/admin.ts) — admin pages
     require the app anyway, so there is no classic body to fall back to. */
  function viewUsage() {
    if (window.mcViews && window.mcViews.usage) return window.mcViews.usage(section, window.mcKit);
    section.appendChild(el('p', 'comments-status', 'This page needs the app to finish loading. Refresh to try again.'));
  }

  /* The admin hub: one door from the board that gathers the three admin pages,
     so a member of staff picks a task rather than hunting scattered links. */
  function viewAdminHome() {
    if (window.mcViews && window.mcViews.adminHome) return window.mcViews.adminHome(section, window.mcKit);
    document.title = 'Administrative options | Community';
    crumb([['Community', 'community.html'], ['Administrative options']]);
    if (adminGate(viewAdminHome)) return;
    section.appendChild(el('p', 'board-intro',
      'Everything that governs the board sits behind these doors. Each is admin-only, here and at the server.'));
    var wrap = el('div', 'board-cats');
    [
      ['Activity audit', 'admin.html?audit=1', 'Reported posts, the review queue, and the last two weeks of activity, every row actionable.'],
      ['IP ban list', 'admin.html?ipbans=1', 'Every banned address, added and removed by hand.'],
      ['Shadow bans', 'admin.html?shadowbans=1', 'Quiet mutes: a member keeps posting but no one else sees it. Add, review, and lift.'],
      ['Add / Remove Admins', 'admin.html?admins=1', 'Grant a member admin powers, or take them back.'],
      ['Platform settings', 'admin.html?settings=1', 'Per-area media controls — what the feed, forum, and DMs each accept, sizes, voice notes, AI screening, storage budgets, retention, and one-time purges.'],
      ['Platform usage', 'admin.html?usage=1', 'Cloudflare free-tier health bars — every meter the platform rides and how close each is to its wall, checked daily with DM alerts past 80%.'],
      ['Discord webhooks', 'admin.html?discord=1', 'Announce new posts to Discord: the two global webhooks, plus per-feed subscriptions that post one thread or category to a channel.'],
      ['merecat administration', 'admin.html?merecatadmin=1', 'The librarian’s dials: the per-member daily cap, on or off, and how many.'],
      ['merecat Q&A at a glance', 'admin.html?merecatthreads=1', 'Observe how members use the librarian, every question and answer, read-only, to guide what to teach it next.']
    ].forEach(function (opt) {
      var row = el('div', 'board-cat');
      var left = el('div', 'board-cat-left');
      var name = el('a', 'board-cat-name', opt[0]);
      name.href = opt[1];
      left.appendChild(name);
      left.appendChild(el('div', 'board-cat-desc', opt[2]));
      row.appendChild(left);
      wrap.appendChild(row);
    });
    section.appendChild(wrap);
  }

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
                  .then(function (x) { if (x.ok) { if (mine) { location.href = 'community.html'; } else { load(); } } else { addNote.textContent = x.error || 'Could not remove.'; } })
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
            : r.page + '#comment-' + r.id;
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
          pagesBox.appendChild(actionRow(r.page + '#comment-' + r.id, r.page, r));
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
            fetch(API + '/approve', { method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(Object.assign({ key: state.key, id: c.id }, approve)) })
              .then(function (r) { return r.json(); }).then(function (r) { if (r.ok) row.remove(); }).catch(function () {});
          });
          var del = el('a', 'trust-toggle danger', '(delete)');
          del.href = '#';
          del.addEventListener('click', function (e: any) {
            e.preventDefault();
            appConfirm('Delete this held ' + (delOpts.what || 'comment') + '?', { okLabel: 'Delete', danger: true }, function (ok: any) {
              if (!ok) return;
              fetch(API + delOpts.path, { method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(Object.assign({ key: state.key, id: c.id }, delOpts.body || {})) })
                .then(function (r) { return r.json(); }).then(function (r) { if (r.ok) row.remove(); }).catch(function () {});
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
    wrap.appendChild(el('p', 'comments-status', 'Loading the journal…'));
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
    wrap.appendChild(el('p', 'comments-status', 'Loading…'));
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
        var more = el('a', 'journal-back journal-back-foot', 'Read more entries →');
        more.href = 'journal.html';
        wrap.appendChild(more);
      })
      .catch(function () { wrap.textContent = ''; wrap.appendChild(el('p', 'comments-status', 'That entry could not be loaded.')); });
  }

  /* Load the signed-in reader's own nick once, so their name reads the same
     to them as to everyone else (the identity line, the post buttons). Purely
     cosmetic: it only refreshes label text, never the login state. */
  function loadMyProfile() {
    if (!state.myHash) return;
    cachedJson(API + '/profile?hash=' + state.myHash + '&fresh=1', undefined, 180000)
      .then(function (d) {
        /* Learn admin status from the server, the sole authority. Compare the
           effective answer against the pre-load hint: if it changed (an admin
           granted or revoked elsewhere), re-render the whole board once so the
           controls appear or vanish, and that redraw covers any waiting view so
           drop the waiters. Otherwise refresh the identity line and let a
           waiting admin view redraw itself. */
        var wasAdmin = isAdmin();
        if (d && d.ok && d.profile) {
          state.myNick = d.profile.nick || '';
          state.myAdmin = !!d.profile.admin;
        }
        state.profileLoaded = true;
        /* Bridge admin status to the platform chrome (the Settings gear reads this
           flag to show the admin-only "Administrative options" entry). */
        try { localStorage.setItem('mc-admin', isAdmin() ? '1' : '0'); } catch (e) {}
        if (BOARD && isAdmin() !== wasAdmin) { profileWaiters = []; route(); return; }
        if (section.querySelector('.comment-identity')) renderIdentity();
        flushProfileWaiters();
      })
      .catch(function () { state.profileLoaded = true; flushProfileWaiters(); });
  }

  function flushProfileWaiters() {
    var ws = profileWaiters;
    profileWaiters = [];
    ws.forEach(function (cb) { cb(); });
  }

  /* A profile view. Your own is read/write; everyone else's is read-only. It
     is reached from the View-profile link and from every clickable username. */
  /* Resolve a custom @handle to its owner's hash, then render the profile the
     normal way (both the classic path and the Lit view take a hash). The URL
     keeps the handle so the shared link stays pretty. */
  function viewProfileByHandle(handle: any) {
    crumb([['Community', 'community.html'], ['Profile']]);
    var status = el('p', 'comments-status', 'Loading profile...');
    section.appendChild(status);
    fetchRetry(API + '/profile?handle=' + encodeURIComponent(handle) + freshParam('&'), freshOpts(), [1000, 3000])
      .then(function (r) { return r.json(); })
      .then(function (d) {
        section.textContent = '';
        if (!d.ok || !d.profile || !d.profile.hash) {
          section.appendChild(el('p', 'comments-status', 'No such profile.'));
          return;
        }
        viewProfile(d.profile.hash);
      })
      .catch(function () {
        status.textContent = 'The profile could not be loaded. Check your connection and reload the page.';
      });
  }

  function viewProfile(hash: any) {
    if (window.mcViews && window.mcViews.profile) return window.mcViews.profile(section, window.mcKit, hash);
    document.title = 'Profile | Community';
    crumb([['Community', 'community.html'], ['Profile']]);
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
        /* Admin defense: edit or clean another member's profile in place —
           the middle ground between doing nothing and lock/ban/delete. Only
           on profiles that are not your own; the server refuses non-admins
           regardless, so hiding this is courtesy, not the lock. */
        if (!editable && isAdmin()) adminProfileEditor(card, hash, d.profile || {});
      })
      .catch(function () {
        status.textContent = 'The profile could not be loaded. Check your connection and reload the page.';
      });
  }

  /* The profile field caps, single-sourced from the PureScript Domain.Profile
     (via window.mcCore); the fallback matches the worker (the no-bundle path,
     the deliberate no-bundle fallback). Fixes the drift where the admin editor capped bio at
     1000 while the worker rejects anything over 500. See CLAUDE.md. */
  function profileLimits() {
    return (window.mcCore && window.mcCore.profileLimits) || { nick: 40, bio: 500, sig: 200 };
  }

  function adminProfileEditor(card: any, hash: any, prof: any) {
    var slot = el('div', 'profile-admin-edit');
    var open = el('a', 'identity-action', 'Edit this profile (admin)');
    open.href = '#';
    slot.appendChild(open);
    card.appendChild(slot);
    open.addEventListener('click', function (e: any) {
      e.preventDefault();
      slot.textContent = '';
      function field(label: any, value: any, max: any, tag?: any) {
        slot.appendChild(el('div', 'profile-label', label));
        var inp = el(tag || 'input', 'key-input');
        if (!tag) inp.type = 'text';
        inp.value = value || '';
        inp.maxLength = max;
        slot.appendChild(inp);
        return inp;
      }
      var PLIM = profileLimits();
      var nick = field('Nickname', prof.nick, PLIM.nick);
      var bio = field('Bio', prof.bio, PLIM.bio, 'textarea');
      var sig = field('Signature', prof.signature, PLIM.sig, 'textarea');
      var avRow = el('label', 'profile-label');
      var avChk = el('input');
      avChk.type = 'checkbox';
      avRow.appendChild(avChk);
      avRow.appendChild(document.createTextNode(' Remove their avatar'));
      slot.appendChild(avRow);
      var note = el('p', 'comments-status', '');
      var save = el('button', 'btn btn-send', 'Save (admin)');
      var cancel = el('a', 'identity-action', 'Cancel');
      cancel.href = '#';
      slot.appendChild(save);
      slot.appendChild(document.createTextNode(' '));
      slot.appendChild(cancel);
      slot.appendChild(note);
      cancel.addEventListener('click', function (ev: any) { ev.preventDefault(); location.reload(); });
      save.addEventListener('click', function () {
        save.disabled = true;
        note.textContent = 'Saving…';
        fetchRetry(API + '/profile/admin', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: state.key, hash: hash, nick: nick.value,
            bio: bio.value, signature: sig.value, clear_avatar: avChk.checked }),
        }, [1000]).then(function (r) { return r.json(); }).then(function (d) {
          if (d.ok) { location.reload(); return; }
          save.disabled = false;
          note.textContent = 'Could not save: ' + (d.error || 'try again.');
        }).catch(function () {
          save.disabled = false;
          note.textContent = 'Network hiccup. Try again.';
        });
      });
    });
  }

  /* Read view: an avatar placeholder, the primary name (nick or assigned) with
     the assigned pseudonym muted beneath when a nick is set, then bio and
     signature. The owner gets an Edit button that swaps in the form. */
  /* The "recent posts" list on a profile: a member's own live forum posts,
     newest first, each linking to the exact post, paged in place. */
  function renderProfilePosts(card: any, hash: any) {
    card.appendChild(el('h3', 'profile-label', 'Recent Community Posts'));
    var wrap = el('div', 'profile-posts');
    card.appendChild(wrap);
    /* Deferred behind a click (no worker call until asked), and RE-collapsible: a
       reader can expand it, then close it again to get back down to the wall. */
    var toggle = el('button', 'btn btn-anon profile-posts-toggle', 'Show recent posts');
    toggle.type = 'button';
    wrap.appendChild(toggle);
    var panel = el('div', 'profile-posts-panel');
    panel.style.display = 'none';
    wrap.appendChild(panel);
    var loaded = false;
    var list: any, pagerHost: any;
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
          d.items.forEach(function (it: any) {
            var row = el('div', 'board-topic');
            var left = el('div', 'board-topic-left');
            var a = el('a', 'board-topic-title', it.title || 'a thread');
            a.href = 'community.html?topic=' + it.topic_id + '#comment-' + it.comment_id;
            left.appendChild(a);
            if (it.snippet) left.appendChild(el('div', 'board-intro', it.snippet));
            row.appendChild(left);
            var ce = catByKey(it.cat);
            var rcs = el('div', 'board-stats', (ce ? ce[1] : it.cat) + ' · ' + fmtTimeCompact(it.created_at));
            rcs.title = fmtDateTime(it.created_at);
            row.appendChild(rcs);
            list.appendChild(row);
          });
          var bar = pageBar(d.total, d.per, d.page, null, function (n) { st.page = n; draw(); window.scrollTo(0, 0); });
          if (bar) pagerHost.appendChild(bar);
        })
        .catch(function () { list.textContent = ''; list.appendChild(el('p', 'comments-status', 'Recent posts could not be loaded.')); });
    }
    toggle.addEventListener('click', function (e: any) {
      e.preventDefault();
      if (panel.style.display === 'none') {
        panel.style.display = '';
        toggle.textContent = 'Hide recent posts';
        if (!loaded) {
          loaded = true;
          list = el('div', 'board-topics');
          panel.appendChild(list);
          pagerHost = el('div');
          panel.appendChild(pagerHost);
          draw();
        }
      } else {
        panel.style.display = 'none';
        toggle.textContent = 'Show recent posts';
      }
    });
  }

  /* Brand-logo SVG paths (24x24, currentColor). "website" is a link/chain glyph.
     Static markup, built via createElementNS (no innerHTML). */
  var SOCIAL_SVG: Record<string, string> = {
    website: 'M3.9 12a4.1 4.1 0 014.1-4.1h3v1.9h-3a2.2 2.2 0 000 4.4h3v1.9h-3A4.1 4.1 0 013.9 12zm5.6 1h5v-2h-5v2zm3.5-5.1h3a4.1 4.1 0 010 8.2h-3v-1.9h3a2.2 2.2 0 000-4.4h-3v-1.9z',
    x: 'M18.9 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.153h7.594l5.243 6.932zm-1.29 19.49h2.039L6.486 3.24H4.298z',
    facebook: 'M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z',
    instagram: 'M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163C8.741 0 8.332.014 7.052.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z',
    tiktok: 'M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z',
  };
  function ensureSocialStyles() {
    if (document.getElementById('mc-social-css')) return;
    var s = el('style'); s.id = 'mc-social-css';
    s.textContent = '.profile-socials{display:flex;flex-wrap:wrap;gap:0.5rem;margin:0.5rem 0 0.3rem}'
      + '.profile-social{display:inline-flex;align-items:center;justify-content:center;width:2.3rem;height:2.3rem;border-radius:50%;border:1px solid var(--rule);color:var(--maroon);text-decoration:none;transition:background .12s,border-color .12s}'
      + '.profile-social:hover{background:var(--cream);border-color:var(--maroon)}'
      + '.mc-social-svg{display:block}'
      + '.profile-link-row{margin:0 0 0.55rem}'
      + '.profile-link-plat{display:inline-flex;align-items:center;gap:0.35rem;font-size:0.85rem;color:var(--muted);margin:0 0 0.15rem}'
      + '.profile-link-plat .mc-social-svg{width:1rem;height:1rem}';
    document.head.appendChild(s);
  }
  function mcSocialIcon(name: any) {
    ensureSocialStyles();
    var NS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', '22'); svg.setAttribute('height', '22');
    svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('class', 'mc-social-svg');
    var path = document.createElementNS(NS, 'path');
    path.setAttribute('d', SOCIAL_SVG[name] || SOCIAL_SVG.website); path.setAttribute('fill', 'currentColor');
    svg.appendChild(path);
    return svg;
  }
  var SOCIAL_ORDER = ['website', 'x', 'facebook', 'instagram', 'tiktok'];
  var SOCIAL_LABEL: Record<string, string> = { website: 'Website', x: 'X (Twitter)', facebook: 'Facebook', instagram: 'Instagram', tiktok: 'TikTok' };

  function renderProfile(card: any, p: any, editable: any) {
    card.textContent = '';
    /* A blocked member's profile is closed to you — no card, no wall, no
       posts; just the honest line and the way back (the block unification). */
    if (!editable && p.hash !== state.myHash && isBlocked(p.hash)) {
      card.appendChild(el('p', 'comments-status', 'You have blocked this member. Their profile and posts are hidden from you.'));
      var ub = el('button', 'btn btn-anon', 'Unblock this member');
      ub.type = 'button';
      ub.addEventListener('click', function () {
        setBlock(p.hash, false, function () { renderProfile(card, p, editable); });
      });
      card.appendChild(ub);
      return;
    }
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
    if (p.handle) names.appendChild(el('div', 'profile-assigned profile-handle', '@' + p.handle));
    if (p.admin) names.appendChild(el('span', 'comment-admin', '(admin)'));
    /* The faith declaration. For one's own profile it falls back to the local
       choice before the first post has carried it to the server. */
    var faithCode = p.faith || (p.hash === state.myHash ? getFaith() : '');
    var pfl = faithCode && faithLabel(faithCode);
    if (pfl) names.appendChild(el('div', 'profile-faith', 'I hold to: ' + pfl));
    /* Standing on the board: the total post count and the rank it earns. */
    if (p.posts != null) names.appendChild(el('div', 'profile-faith profile-rank', rankLine(Number(p.posts) || 0)));
    headRow.appendChild(names);
    card.appendChild(headRow);
    /* Share: one tap copies this member's public profile link (the pretty
       /@handle when they have one, else the ?u= form) to the clipboard. */
    var shareUrl = location.origin + (p.handle ? ('/@' + p.handle) : ('/' + profileHref(p.hash)));
    var shareLink = el('button', 'btn btn-anon profile-share', '🔗 Share profile');
    shareLink.type = 'button';
    shareLink.addEventListener('click', function (e: any) {
      e.preventDefault();
      var done = function () {
        var was = shareLink.textContent;
        shareLink.textContent = '✓ Link copied';
        setTimeout(function () { shareLink.textContent = was; }, 2000);
      };
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(shareUrl).then(done).catch(function () { window.prompt('Copy this link:', shareUrl); });
        } else { window.prompt('Copy this link:', shareUrl); }
      } catch (err) { window.prompt('Copy this link:', shareUrl); }
    });
    card.appendChild(shareLink);
    /* Offsite links (website + socials) as brand-icon buttons. Server-sanitized to
       safe https URLs, so rendering as an href is safe; still noopener/nofollow. */
    if (p.links && typeof p.links === 'object') {
      var socials = el('div', 'profile-socials');
      SOCIAL_ORDER.forEach(function (plat) {
        var url = p.links[plat];
        if (!url || typeof url !== 'string') return;
        var a = el('a', 'profile-social');
        a.href = url; a.target = '_blank'; a.rel = 'noopener nofollow noreferrer';
        a.title = SOCIAL_LABEL[plat] || plat;
        a.appendChild(mcSocialIcon(plat));
        socials.appendChild(a);
      });
      if (socials.firstChild) card.appendChild(socials);
    }
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
    } else if (isMember() && p.hash !== state.myHash) {
      /* The librarian gets neither door: no DMs (it holds no inbox) and no
         mute (it speaks only when summoned). */
      if (p.hash !== MERECAT_BOT_HASH) {
        var dmBtn = el('button', 'btn btn-send', 'Send a Direct Message');
        dmBtn.type = 'button';
        dmBtn.addEventListener('click', function () {
          location.href = 'messages.html?dm=' + p.hash;
        });
        card.appendChild(dmBtn);
        var blockBtn = el('button', 'btn btn-anon', 'Block this member');
        blockBtn.type = 'button';
        blockBtn.addEventListener('click', function () {
          appConfirm(BLOCK_CONFIRM, { okLabel: 'Block', danger: true }, function (ok: any) {
            if (ok) setBlock(p.hash, true, function () { renderProfile(card, p, editable); });
          });
        });
        card.appendChild(blockBtn);
      }
    }
    /* The member's public wall — their own posts, with a composer on your own. */
    /* Recent Community Posts sit ABOVE the wall so heavy wall posting never buries
       the way to look up someone's forum history; it stays collapsed by default. */
    renderProfilePosts(card, p.hash);
    renderProfileWall(card, p.hash, editable);
    /* Admins get the very same user-fingerprint drawer here as on a post,
       driven by this identity's hash. Everyone else sees nothing. */
    annotateProfileMeta(p.hash, card);
  }

  /* The edit form. Every save is re-screened by the server; a flagged save is
     refused with its reason and the fields survive so nothing is retyped. */
  function editProfile(card: any, p: any) {
    card.textContent = '';
    card.appendChild(el('p', 'key-note',
      'Your assigned name ' + p.assigned + ' always stays as your identifier. ' +
      'A custom nickname simply shows first.'));
    var chosenFaith = p.faith || (p.hash === state.myHash ? getFaith() : '') || '';
    card.appendChild(faithRadios(chosenFaith, function (code: any) { chosenFaith = code; }));
    var PLIM = profileLimits();
    card.appendChild(el('label', 'profile-label', 'Nickname (up to ' + PLIM.nick + ' characters)'));
    var nickIn = el('input', 'key-input');
    nickIn.type = 'text';
    nickIn.maxLength = PLIM.nick;
    nickIn.placeholder = p.assigned;
    nickIn.value = p.nick || '';
    card.appendChild(nickIn);
    card.appendChild(el('label', 'profile-label', 'Bio (up to ' + PLIM.bio + ' characters)'));
    var bioIn = el('textarea', 'comment-text');
    bioIn.maxLength = PLIM.bio;
    bioIn.rows = 4;
    bioIn.value = p.bio || '';
    card.appendChild(bioIn);
    card.appendChild(el('label', 'profile-label', 'Signature (up to ' + PLIM.sig + ' characters)'));
    var sigIn = el('textarea', 'comment-text');
    sigIn.maxLength = PLIM.sig;
    sigIn.rows = 2;
    sigIn.value = p.signature || '';
    card.appendChild(sigIn);

    /* Custom @handle — the member's own profile URL (merecatholicity.com/@handle),
       distinct from the display nickname. Optional; lower-cased; must be unique
       (the server is authoritative and returns a clear message if it is taken).
       The live hint shows the resulting link, or why a value is not allowed,
       validated through the same kernel the server uses. */
    function handleErrText(tag: any) {
      switch (tag) {
        case 'too_short': return 'Too short — 3 to 30 characters.';
        case 'too_long': return 'Too long — 3 to 30 characters.';
        case 'bad_chars': return 'Use only lowercase letters, numbers, and underscore.';
        case 'bad_start': return 'Must start with a letter.';
        case 'bad_underscore': return 'Cannot end with, or repeat, an underscore.';
        case 'reserved': return 'That handle is reserved.';
        default: return 'That handle is not allowed.';
      }
    }
    card.appendChild(el('label', 'profile-label', 'Profile link — your @handle (optional)'));
    var handleIn = el('input', 'key-input');
    handleIn.type = 'text';
    handleIn.maxLength = (window.mcCore && window.mcCore.handleMax) || 30;
    handleIn.placeholder = 'e.g. john_smith';
    handleIn.value = p.handle || '';
    handleIn.autocapitalize = 'none';
    handleIn.autocomplete = 'off';
    handleIn.spellcheck = false;
    card.appendChild(handleIn);
    var handleHint = el('p', 'profile-empty');
    card.appendChild(handleHint);
    function updateHandleHint() {
      var raw = handleIn.value.trim();
      handleHint.style.color = '';
      if (!raw) { handleHint.textContent = 'No handle set — your link stays the default.'; return; }
      if (window.mcCore && window.mcCore.handleValidate) {
        var v = window.mcCore.handleValidate(raw);
        if (v.ok) { handleHint.textContent = 'Your link: merecatholicity.com/@' + v.handle; }
        else { handleHint.textContent = handleErrText(v.error); handleHint.style.color = '#a3324a'; }
      } else {
        handleHint.textContent = 'Your link: merecatholicity.com/@' + raw.toLowerCase();
      }
    }
    handleIn.addEventListener('input', updateHandleHint);
    updateHandleHint();

    /* Offsite links: your website + socials. Each accepts a full URL or a bare
       handle; the live hint shows the resulting link, and the server keeps only
       safe http(s) / normalized-handle URLs (Domain.Links). */
    card.appendChild(el('label', 'profile-label', 'Links (optional) — your website and socials'));
    var linkInputs: Record<string, any> = {};
    SOCIAL_ORDER.forEach(function (plat) {
      var row = el('div', 'profile-link-row');
      var lab = el('span', 'profile-link-plat');
      lab.appendChild(mcSocialIcon(plat));
      lab.appendChild(document.createTextNode(' ' + (SOCIAL_LABEL[plat] || plat)));
      row.appendChild(lab);
      var inp = el('input', 'key-input');
      inp.type = 'text'; inp.autocapitalize = 'none'; inp.autocomplete = 'off'; inp.spellcheck = false;
      inp.placeholder = plat === 'website' ? 'https://your-site.com' : 'your handle, or a full URL';
      inp.value = (p.links && p.links[plat]) || '';
      row.appendChild(inp);
      var lhint = el('p', 'profile-empty');
      row.appendChild(lhint);
      function updLink() {
        var raw = inp.value.trim();
        lhint.style.color = '';
        if (!raw) { lhint.textContent = ''; return; }
        if (window.mcCore && window.mcCore.linkNormalize) {
          var n = (window.mcCore.linkNormalize as any)(plat, raw);
          if (n.ok && n.url) { lhint.textContent = '→ ' + n.url; }
          else { lhint.textContent = 'Use a handle or an https:// link.'; lhint.style.color = '#a3324a'; }
        }
      }
      inp.addEventListener('input', updLink);
      updLink();
      linkInputs[plat] = inp;
      card.appendChild(row);
    });

    /* Avatar. Two ways to set one: upload your own JPEG, or pick a ready-made
       from the gallery. Both end in the same canvas step that hands the server
       the exact 400x400 JPEG it demands; the server re-checks bytes, format,
       dimensions, and content regardless of which path produced them. */
    card.appendChild(el('label', 'profile-label', 'Avatar'));
    var avNote = el('p', 'profile-empty', '');

    /* The shared tail: a loaded image is rasterized to a 400x400 JPEG and pushed
       through the same upload posting is gated on. 'cover' fills the square with
       a photo; 'contain' fits a preset whole onto the parchment tile so its
       transparent edges read as the tile rather than as black. */
    function pushAvatar(img: any, mode: any) {
      var iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
      if (!iw || !ih) { avNote.textContent = 'That image could not be read. Try another.'; return; }
      /* Rasterize to a fixed square. Larger than the old 400px so an upload keeps
         more detail; the CSS caps the display size, and the worker accepts any
         square in its range. */
      var AV = 512;
      var c = document.createElement('canvas');
      c.width = AV;
      c.height = AV;
      var ctx = c.getContext('2d') as CanvasRenderingContext2D;
      if (mode === 'contain') {
        ctx.fillStyle = '#faf6ee';
        ctx.fillRect(0, 0, AV, AV);
        var box = AV * 0.82;
        var s = Math.min(box / iw, box / ih);
        var cw = iw * s, ch = ih * s;
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, (AV - cw) / 2, (AV - ch) / 2, cw, ch);
      } else {
        var scale = Math.max(AV / iw, AV / ih);
        var w = iw * scale, h = ih * scale;
        ctx.drawImage(img, (AV - w) / 2, (AV - h) / 2, w, h);
      }
      /* JPEG, so the stored bytes decode cleanly for both the AI vision screen
         and every browser; a lower-quality second pass is the net for the rare
         frame that overruns the cap. */
      var send = function (blob: any) {
        if (!blob || blob.size > 1024 * 1024) {
          avNote.textContent = 'The image could not be brought under 1 MB. Try another.';
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
        if (blob && blob.size <= 1024 * 1024) return send(blob);
        c.toBlob(send, 'image/jpeg', 0.7);
      }, 'image/jpeg', 0.85);
    }

    /* Path one: upload a file. */
    var avRow = el('div', 'key-row');
    var avPick = el('input');
    avPick.type = 'file';
    avPick.accept = '.jpg,.jpeg,image/jpeg';
    avRow.appendChild(avPick);
    card.appendChild(avRow);
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
        pushAvatar(img, 'cover');
      };
      img.src = url;
    });

    /* Path two: the preset gallery, revealed by a toggle so it never crowds the
       form until asked for. A pick loads that same-origin image (canvas stays
       untainted) and runs the shared tail in 'contain' mode. */
    var galBtn = el('button', 'btn btn-anon btn-gallery', 'Choose from the gallery');
    galBtn.type = 'button';
    var gallery = buildAvatarGallery(function (path: any) {
      gallery.closePanel();
      galBtn.textContent = 'Choose from the gallery';
      avNote.textContent = 'Preparing image...';
      var pim = new Image();
      pim.onerror = function () { avNote.textContent = 'That gallery image could not be loaded. Try another.'; };
      pim.onload = function () { pushAvatar(pim, 'contain'); };
      pim.src = path;
    });
    galBtn.addEventListener('click', function () {
      gallery.toggle();
      galBtn.textContent = gallery.hidden ? 'Choose from the gallery' : 'Hide the gallery';
    });
    card.appendChild(galBtn);
    card.appendChild(gallery);

    card.appendChild(el('p', 'profile-empty',
      'Upload a JPEG (cropped to a square, 1 MB at most) or pick a ready-made from the gallery. ' +
      (p.avatar ? 'Either choice replaces your current avatar.' : '')));
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
      avDel.addEventListener('click', function (e: any) {
        e.preventDefault();
        appConfirm('Remove your avatar?', { okLabel: 'Remove', danger: true }, function (ok: any) {
          if (!ok) return;
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
      });
      card.appendChild(avDel);
    }
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
          body: JSON.stringify({ key: state.key, nick: nickIn.value, bio: bioIn.value, signature: sigIn.value, faith: chosenFaith, handle: handleIn.value,
            links: { website: linkInputs.website.value, x: linkInputs.x.value, facebook: linkInputs.facebook.value, instagram: linkInputs.instagram.value, tiktok: linkInputs.tiktok.value }, token: token }),
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

  function dmLabel(hash: any, nick: any) {
    var assigned = displayName(hash);
    return nick ? nick + ' (' + assigned + ')' : assigned;
  }

  /* Fuzzy score of one candidate string against the lowercased query:
     whole-prefix beats word-prefix beats substring beats subsequence. */
  function dmScore(q: any, name: any) {
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
    var dir: any = null;
    var loading = false;
    var current: any[] = [];
    var sel = 0;
    var timer: any = null;
    function ensureDir(cb: any) {
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
        r.href = 'messages.html?dm=' + u.hash;
        r.title = 'Open the conversation';
        r.appendChild(el('span', null, dmLabel(u.hash, u.nick)));
        r.appendChild(el('span', 'dm-suggest-go', 'message →'));
        r.addEventListener('mousedown', function (e: any) {
          e.preventDefault();
          location.href = 'messages.html?dm=' + u.hash;
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
          .filter(function (u: any) { return u.hash !== state.myHash; })
          .map(function (u: any) {
            var s = Math.max(dmScore(q, u.nick), dmScore(q, displayName(u.hash)));
            return { u: u, s: s, label: dmLabel(u.hash, u.nick) };
          })
          .filter(function (x: any) { return x.s > 0; })
          .sort(function (x: any, y: any) { return y.s - x.s || (x.label < y.label ? -1 : 1); })
          .slice(0, 8)
          .map(function (x: any) { return x.u; });
        sel = 0;
        note.textContent = current.length ? '' : 'No member matches that. Pick from the suggestions.';
        renderSug();
      });
    }
    input.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(suggest, 150);
    });
    input.addEventListener('keydown', function (e: any) {
      if (sug.hidden) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(sel + 1, current.length - 1); renderSug(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(sel - 1, 0); renderSug(); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        if (current[sel]) location.href = 'messages.html?dm=' + current[sel].hash;
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
  var mentionDir: any = null, mentionDirLoading = false;
  var pendingMentions: any[] = [];
  function ensureMentionDir(cb: any) {
    if (mentionDir) return cb();
    if (mentionDirLoading) return;
    mentionDirLoading = true;
    fetch(API + '/dm/directory' + freshParam('?'))
      .then(function (r) { return r.json(); })
      .then(function (d) { mentionDirLoading = false; if (d.ok) { mentionDir = d.users; cb(); } })
      .catch(function () { mentionDirLoading = false; });
  }
  function collectMentions(text: any) {
    if (window.mcCore) return window.mcCore.mentionsIn(text, pendingMentions);
    var out = [];
    for (var i = 0; i < pendingMentions.length; i++) {
      var m = pendingMentions[i];
      if (text.indexOf(m.token) > -1 && out.indexOf(m.hash) === -1) out.push(m.hash);
    }
    return out;
  }
  function attachMentions(textarea: any) {
    if (!textarea || textarea.dataset.mentions) return;
    textarea.dataset.mentions = '1';
    pendingMentions = [];
    /* A plain static container (not the absolute .dm-suggest) so the list flows
       right below the box; its rows carry the shared suggestion styling. */
    var sug = el('div', 'mention-suggest');
    sug.hidden = true;
    textarea.parentNode.insertBefore(sug, textarea.nextSibling);
    var current: any[] = [], sel = 0, at = -1, timer: any = null;
    function scan() {
      var caret = textarea.selectionStart;
      var m = /(^|\s)@([^\s@]{1,30})$/.exec(textarea.value.slice(0, caret));
      if (!m) { current = []; at = -1; sug.hidden = true; return; }
      at = caret - m[2].length - 1;
      var q = m[2].toLowerCase();
      ensureMentionDir(function () {
        current = mentionDir
          .filter(function (u: any) { return u.hash !== state.myHash; })
          .map(function (u: any) { return { u: u, s: Math.max(dmScore(q, u.nick), dmScore(q, displayName(u.hash))), label: dmLabel(u.hash, u.nick) }; })
          .filter(function (x: any) { return x.s > 0; })
          .sort(function (x: any, y: any) { return y.s - x.s || (x.label < y.label ? -1 : 1); })
          .slice(0, 8).map(function (x: any) { return x.u; });
        /* The librarian rides the same picker: type toward "merecat" and the
           bot leads the list, labeled for what it is. Picking it inserts the
           literal @merecat token — the server watches for the words, so no
           hash rides in the mentions at all. */
        if (dmScore(q, 'merecat') > 0) {
          current = [{ bot: true, nick: 'merecat' }].concat(current).slice(0, 8);
        }
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
        r.appendChild(el('span', null, u.bot ? 'merecat · AI BOT 🐈' : dmLabel(u.hash, u.nick)));
        r.appendChild(el('span', 'dm-suggest-go', u.bot ? 'ask the librarian' : 'mention'));
        r.addEventListener('mousedown', function (e: any) { e.preventDefault(); pick(u); });
        sug.appendChild(r);
      });
      sug.hidden = false;
    }
    function pick(u: any) {
      if (at < 0) return;
      var caret = textarea.selectionStart;
      var token = u.bot ? '@merecat' : '@' + (u.nick || displayName(u.hash));
      var v = textarea.value;
      textarea.value = v.slice(0, at) + token + ' ' + v.slice(caret);
      var np = at + token.length + 1;
      try { textarea.setSelectionRange(np, np); } catch (e) {}
      if (!u.bot && !pendingMentions.some(function (m) { return m.hash === u.hash && m.token === token; })) {
        pendingMentions.push({ hash: u.hash, token: token });
      }
      current = []; at = -1; sug.hidden = true;
      afterEdit(textarea);
    }
    textarea.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(scan, 120); });
    textarea.addEventListener('keydown', function (e: any) {
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
    if (window.mcViews && window.mcViews.users) return window.mcViews.users(section, window.mcKit);
    document.title = 'Members | Community';
    crumb([['Community', 'community.html'], ['Members']]);
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

    var roster: any = null;
    var st = { q: '', page: 1 };
    var PER = 20;

    /* Empty query keeps the server's newest-first order; a query filters the
       whole roster and ranks by match, both on nickname and assigned name. */
    function visible() {
      if (!st.q) return roster;
      var q = st.q.toLowerCase();
      return roster
        .map(function (u: any) { return { u: u, s: Math.max(dmScore(q, u.nick), dmScore(q, displayName(u.hash))) }; })
        .filter(function (x: any) { return x.s > 0; })
        .sort(function (x: any, y: any) { return y.s - x.s; })
        .map(function (x: any) { return x.u; });
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
        items.slice((st.page - 1) * PER, st.page * PER).forEach(function (u: any) {
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

    var timer: any = null;
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

  /* ===================== Public posting: walls + the feed =====================
     A member's wall is their own public posts; the feed is everyone's together.
     Public + unencrypted, reusing the composer, Turnstile, @mentions, and the
     rank/faith author line. Media rides the public /wall/media endpoint. */

  function wallAvatarInto(head: any, hash: any, avatar: any) {
    if (!avatar || !hash) return;
    var link = el('a', 'comment-avatar-link');
    link.href = profileHref(hash);
    var img = el('img', 'comment-avatar');
    img.src = API + '/avatar?hash=' + hash + '&v=' + encodeURIComponent(avatar);
    img.alt = ''; img.width = 32; img.height = 32;
    link.appendChild(img);
    head.appendChild(link);
  }
  /* ================= Feed / wall: Facebook-style cards ================= */
  /* Inline SVG icons — CSP-safe (no innerHTML), crisp at any DPI. Stroked by
     default; the brand marks (X, Facebook) and the filled heart use fill, keyed
     by CSS on the button state. */
  function mcIcon(name: any) {
    var P: any = {
      heart: 'M12 20.5S3.5 15 3.5 8.9C3.5 6.3 5.5 4.5 7.9 4.5c1.6 0 3.1.9 3.8 2.3l.3.6.3-.6c.7-1.4 2.2-2.3 3.8-2.3 2.4 0 4.4 1.8 4.4 4.4C20.5 15 12 20.5 12 20.5z',
      comment: 'M20 4H4a1 1 0 00-1 1v11a1 1 0 001 1h3v4l5-4h8a1 1 0 001-1V5a1 1 0 00-1-1z',
      share: 'M18 8a2.5 2.5 0 10-2.4-3.2L9 8.2a2.5 2.5 0 100 4.6l6.6 3.4A2.5 2.5 0 1018 15l-6.6-3.4a2.5 2.5 0 000-1.6L18 6.6A2.5 2.5 0 0018 8z',
      download: 'M12 3v11m0 0l4.5-4.5M12 14l-4.5-4.5M4.5 19.5h15',
      copy: 'M15.5 8.5v-2a2 2 0 00-2-2h-7a2 2 0 00-2 2v7a2 2 0 002 2h2M10.5 8.5h7a2 2 0 012 2v7a2 2 0 01-2 2h-7a2 2 0 01-2-2v-7a2 2 0 012-2z',
      expand: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
      close: 'M6 6l12 12M18 6L6 18',
      x: 'M18.9 2.5H22l-7.6 8.6L23 21.5h-6.9l-5.4-7-6.2 7H1.4l8.1-9.2L1 2.5h7l4.9 6.4L18.9 2.5z',
      facebook: 'M22 12a10 10 0 10-11.6 9.9v-7H7.9V12h2.5V9.8c0-2.5 1.5-3.8 3.7-3.8 1.1 0 2.2.2 2.2.2v2.4h-1.2c-1.2 0-1.6.8-1.6 1.5V12h2.7l-.4 2.9h-2.3v7A10 10 0 0022 12z',
    };
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('class', 'mc-ic mc-ic-' + name); svg.setAttribute('aria-hidden', 'true');
    var pth = document.createElementNS(ns, 'path'); pth.setAttribute('d', P[name] || '');
    if (name === 'x' || name === 'facebook') { pth.setAttribute('fill', 'currentColor'); }
    else {
      pth.setAttribute('fill', 'none'); pth.setAttribute('stroke', 'currentColor');
      pth.setAttribute('stroke-width', '2'); pth.setAttribute('stroke-linecap', 'round'); pth.setAttribute('stroke-linejoin', 'round');
    }
    svg.appendChild(pth);
    return svg;
  }
  /* A short download filename for a wall media object (kind is encoded in the key
     as wall/<i|v|a>/…). The bytes keep their real type; this only names the save. */
  function mediaFilename(mediaKey: any) {
    var k = String(mediaKey).split('/')[1];
    var ext = k === 'v' ? 'mp4' : k === 'a' ? 'mp3' : 'jpg';
    return 'merecatholicity-' + String(mediaKey).replace(/[^a-z0-9]/gi, '').slice(-8) + '.' + ext;
  }
  function mediaDownloadLink(url: any, filename: any, label: any, cls: any) {
    var a = el('a', cls || 'wall-act wall-act-dl');
    a.href = url; (a as HTMLAnchorElement).download = filename || 'download';
    a.title = 'Download'; a.setAttribute('aria-label', 'Download');
    a.appendChild(mcIcon('download'));
    if (label) a.appendChild(el('span', 'wall-act-lbl', label));
    a.addEventListener('click', function (e: any) { e.stopPropagation(); });
    return a;
  }

  /* postMenu: the one ⋯ overflow menu every post/row uses — the readability
     standard folds ALL action links here (the owner's ruling; the merecat-
     clean head keeps only author + time + ⋯). The items are the CALLER'S
     prebuilt elements — the same .comment-dm/.comment-quote-link/.comment-
     edit/... nodes as always, appended EAGERLY into the (hidden) pop, so the
     DOM contract the standing webtests assert is unchanged: only visibility
     moved. opts.onOpen fires on the ⋯ MOUSEDOWN, before a click can collapse
     a text selection (the quote grab lives there). On phones the items travel
     into the app sheet and BACK on close, so the elements and their listeners
     stay singular. */
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
    function closeMenu() {
      wrap.classList.remove('open');
      document.removeEventListener('click', menuOutside, true);
      document.removeEventListener('keydown', menuKey, true);
      window.removeEventListener('scroll', closeMenu, true);
    }
    function menuOutside(e: any) { if (!wrap.contains(e.target)) closeMenu(); }
    function menuKey(e: any) { if (e.key === 'Escape') closeMenu(); }
    btn.addEventListener('mousedown', function () { if (opts.onOpen) { try { opts.onOpen(); } catch (e) { /* selection grab is best-effort */ } } });
    btn.addEventListener('click', function (e: any) {
      e.preventDefault(); e.stopPropagation();
      var sheet: any = (window as any).mcSheet;
      if (window.innerWidth <= 600 && sheet && sheet.open) {
        var list = el('div', 'comment-menu-sheet');
        var kids = [].slice.call(pop.childNodes);
        kids.forEach(function (k: any) { list.appendChild(k); });
        list.addEventListener('click', function (ev: any) {
          var t = ev.target && ev.target.closest ? ev.target.closest('a,button') : null;
          if (t) setTimeout(function () { try { sheet.close(); } catch (x) { /* fine */ } }, 0);
        });
        sheet.open('', list, function () {
          [].slice.call(list.childNodes).forEach(function (k: any) { pop.appendChild(k); });
        });
        return;
      }
      if (wrap.classList.contains('open')) { closeMenu(); return; }
      wrap.classList.add('open');
      setTimeout(function () {
        document.addEventListener('click', menuOutside, true);
        document.addEventListener('keydown', menuKey, true);
        window.addEventListener('scroll', closeMenu, true);
      }, 0);
    });
    pop.addEventListener('click', function (ev: any) {
      var t = ev.target && ev.target.closest ? ev.target.closest('a,button') : null;
      if (t) closeMenu();
    });
    return wrap;
  }

  /* Who-liked popover: hover (desktop) or long-press (mobile) the like count to
     see the likers. One at a time; closes on outside click / scroll / Esc. */
  var mcPop: any = null;
  function closePop() {
    if (mcPop && mcPop.parentNode) mcPop.parentNode.removeChild(mcPop);
    mcPop = null;
    document.removeEventListener('click', popOutside, true);
    window.removeEventListener('scroll', closePop, true);
  }
  function popOutside(e: any) { if (mcPop && !mcPop.contains(e.target)) closePop(); }
  function placePop(pop: any, anchor: any) {
    var r = anchor.getBoundingClientRect();
    pop.style.position = 'absolute';
    pop.style.left = Math.max(8, Math.min(window.innerWidth - 244, r.left)) + 'px';
    pop.style.top = (window.scrollY + r.bottom + 6) + 'px';
  }
  function showLikers(anchor: any, params: any) {
    closePop();
    var pop = el('div', 'wall-pop wall-likers-pop');
    pop.appendChild(el('div', 'wall-pop-load', 'Loading…'));
    document.body.appendChild(pop); mcPop = pop;
    placePop(pop, anchor);
    setTimeout(function () { document.addEventListener('click', popOutside, true); window.addEventListener('scroll', closePop, true); }, 0);
    fetch(API + '/wall/likers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params) })
      .then(function (r) { return r.json(); }).then(function (d) {
        if (mcPop !== pop) return;
        pop.textContent = '';
        if (!d || !d.ok || !(d.likers && d.likers.length)) { pop.appendChild(el('div', 'wall-pop-empty', 'No likes yet')); return; }
        pop.appendChild(el('div', 'wall-pop-title', 'Liked by'));
        d.likers.forEach(function (u: any) {
          var row = el('a', 'wall-likers-row'); row.href = profileHref(u.hash);
          wallAvatarInto(row, u.hash, u.avatar);
          row.appendChild(el('span', 'wall-likers-name', u.nick));
          pop.appendChild(row);
        });
        if (d.more) pop.appendChild(el('div', 'wall-pop-more', 'and more…'));
        placePop(pop, anchor);
      }).catch(function () { if (mcPop === pop) { pop.textContent = ''; pop.appendChild(el('div', 'wall-pop-empty', 'Could not load')); } });
  }
  function attachLikers(anchor: any, getParams: any) {
    var lpT = 0, hoverT = 0;
    anchor.addEventListener('mouseenter', function () { clearTimeout(hoverT); hoverT = setTimeout(function () { showLikers(anchor, getParams()); }, 320); });
    anchor.addEventListener('mouseleave', function () { clearTimeout(hoverT); });
    anchor.addEventListener('touchstart', function () { clearTimeout(lpT); lpT = setTimeout(function () { showLikers(anchor, getParams()); }, 450); }, { passive: true });
    anchor.addEventListener('touchend', function () { clearTimeout(lpT); }, { passive: true });
    anchor.addEventListener('touchmove', function () { clearTimeout(lpT); }, { passive: true });
    anchor.addEventListener('click', function (e: any) { e.preventDefault(); e.stopPropagation(); showLikers(anchor, getParams()); });
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

  /* The share popover: Copy link, X, Facebook, an optional media Download, and the
     native OS share sheet where available. Proper icons, not text links. */
  function showShareMenu(anchor: any, shareUrl: any, mediaDl: any, saveRef?: any) {
    closePop();
    var pop = el('div', 'wall-pop wall-share-pop');
    if (saveRef && state.key) {
      var sv = el('button', 'wall-share-item'); sv.type = 'button';
      var svl = el('span', null, 'Save post'); sv.appendChild(svl);
      sv.addEventListener('click', function (e: any) {
        e.stopPropagation();
        bookmarkToggle(saveRef.kind, saveRef.ref, true).then(function (d: any) {
          svl.textContent = d && d.ok ? 'Saved ✓' : 'Could not save';
          setTimeout(closePop, 900);
        });
      });
      pop.appendChild(sv);
    }
    var copy = el('button', 'wall-share-item'); copy.type = 'button';
    copy.appendChild(mcIcon('copy')); var cl = el('span', null, 'Copy link'); copy.appendChild(cl);
    copy.addEventListener('click', function (e: any) {
      e.stopPropagation();
      var done = function () { cl.textContent = 'Copied ✓'; setTimeout(function () { cl.textContent = 'Copy link'; }, 1400); };
      try { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(shareUrl).then(done).catch(function () { window.prompt('Copy this link:', shareUrl); }); else window.prompt('Copy this link:', shareUrl); }
      catch (err) { window.prompt('Copy this link:', shareUrl); }
    });
    pop.appendChild(copy);
    if (mediaDl) { pop.appendChild(mediaDownloadLink(mediaDl.url, mediaDl.filename, 'Download', 'wall-share-item')); }
    var xa = el('a', 'wall-share-item'); xa.href = 'https://twitter.com/intent/tweet?url=' + encodeURIComponent(shareUrl);
    xa.target = '_blank'; xa.rel = 'noopener noreferrer'; xa.appendChild(mcIcon('x')); xa.appendChild(el('span', null, 'X'));
    xa.addEventListener('click', function (e: any) { e.stopPropagation(); }); pop.appendChild(xa);
    var fb = el('a', 'wall-share-item'); fb.href = 'https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(shareUrl);
    fb.target = '_blank'; fb.rel = 'noopener noreferrer'; fb.appendChild(mcIcon('facebook')); fb.appendChild(el('span', null, 'Facebook'));
    fb.addEventListener('click', function (e: any) { e.stopPropagation(); }); pop.appendChild(fb);
    if ((navigator as any).share) {
      var na = el('button', 'wall-share-item'); na.type = 'button'; na.appendChild(mcIcon('share')); na.appendChild(el('span', null, 'More…'));
      na.addEventListener('click', function (e: any) { e.stopPropagation(); (navigator as any).share({ url: shareUrl, title: 'A post on Mere Catholicity' }).catch(function () {}); closePop(); });
      pop.appendChild(na);
    }
    document.body.appendChild(pop); mcPop = pop;
    placePop(pop, anchor);
    setTimeout(function () { document.addEventListener('click', popOutside, true); window.addEventListener('scroll', closePop, true); }, 0);
  }

  /* The post action bar (summary counts + Like / Comment / Share buttons), reused
     by the feed card AND the media theater rail. Owns the like state so the button
     and the summary count stay in step. Returns the element + the button hooks. */
  function wallActions(post: any) {
    var likeN = Number(post.likes) || 0, liked = !!post.liked, gen = 0, cn = Number(post.comments) || 0;
    var box = el('div', 'wall-actions');
    var summary = el('div', 'wall-summary');
    var likeSum = el('button', 'wall-sum-likes'); likeSum.type = 'button';
    likeSum.appendChild(mcIcon('heart')); var likeSumN = el('span', 'wall-sum-n'); likeSum.appendChild(likeSumN);
    var cmtSum = el('button', 'wall-sum-comments'); cmtSum.type = 'button';
    summary.appendChild(likeSum); summary.appendChild(cmtSum);
    attachLikers(likeSum, function () { return { post: post.id }; });
    var btns = el('div', 'wall-btnrow');
    var likeBtn = el('button', 'wall-act wall-like'); likeBtn.type = 'button';
    likeBtn.appendChild(mcIcon('heart')); likeBtn.appendChild(el('span', 'wall-act-lbl', 'Like'));
    var cmtBtn = el('button', 'wall-act'); cmtBtn.type = 'button'; cmtBtn.appendChild(mcIcon('comment')); cmtBtn.appendChild(el('span', 'wall-act-lbl', 'Comment'));
    var shareBtn = el('button', 'wall-act'); shareBtn.type = 'button'; shareBtn.appendChild(mcIcon('share')); shareBtn.appendChild(el('span', 'wall-act-lbl', 'Share'));
    btns.appendChild(likeBtn); btns.appendChild(cmtBtn); btns.appendChild(shareBtn);
    function render() {
      likeBtn.classList.toggle('on', liked); likeBtn.title = liked ? 'Unlike' : 'Like';
      likeSum.classList.toggle('on', liked);
      likeSumN.textContent = likeN > 0 ? String(likeN) : '';
      likeSum.style.display = likeN > 0 ? '' : 'none';
      cmtSum.textContent = cn > 0 ? (cn === 1 ? '1 comment' : cn + ' comments') : '';
      cmtSum.style.display = cn > 0 ? '' : 'none';
      summary.style.display = (likeN > 0 || cn > 0) ? '' : 'none';
    }
    likeBtn.addEventListener('click', function (e: any) {
      e.preventDefault(); e.stopPropagation();
      if (!state.myHash) { if (window.mcOnboard) window.mcOnboard(); return; }
      var want = !liked, myGen = ++gen;
      liked = want; likeN = Math.max(0, likeN + (want ? 1 : -1)); render();
      fetch(API + '/wall/like', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: state.key, post: post.id, like: want }) })
        .then(function (r) { return r.json(); }).then(function (d) {
          if (myGen !== gen) return;
          if (d && d.ok) { liked = !!d.liked; likeN = Number(d.likes) || 0; } else { liked = !want; likeN = Math.max(0, likeN + (want ? -1 : 1)); }
          render();
        }).catch(function () { if (myGen !== gen) return; liked = !want; likeN = Math.max(0, likeN + (want ? -1 : 1)); render(); });
    });
    box.appendChild(summary); box.appendChild(btns);
    render();
    return { el: box, likeBtn: likeBtn, cmtBtn: cmtBtn, shareBtn: shareBtn, cmtSum: cmtSum, bumpComment: function (d: any) { cn = Math.max(0, cn + d); render(); } };
  }

  /* The comment section for a post (list + composer), lazily loaded. Reused inline
     under a card and in the media theater rail. */
  function wallCommentsSection(post: any, onCount: any) {
    var wrap = el('div', 'wall-comments');
    var list = el('div', 'wall-comment-list');
    wrap.appendChild(list);
    var loaded = false;
    function load() {
      if (loaded) return; loaded = true;
      list.appendChild(el('p', 'comments-status', 'Loading…'));
      fetch(API + '/wall/post/get', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: state.key || '', id: post.id }) })
        .then(function (r) { return r.json(); }).then(function (d) {
          list.textContent = '';
          if (!d || !d.ok) { list.appendChild(el('p', 'comments-status', 'Could not load comments.')); return; }
          (d.comments || []).forEach(function (c: any) { list.appendChild(wallCommentNode(c, post)); });
          if (state.myHash) wrap.appendChild(wallComposer('comment', { post: post.id }, function (added: any) {
            if (added) { list.appendChild(wallCommentNode(added, post)); if (onCount) onCount(1); }
          }));
          else wrap.appendChild(loginToInteract('comment on this post'));
        }).catch(function () { list.textContent = ''; list.appendChild(el('p', 'comments-status', 'Could not load comments.')); });
    }
    return { wrap: wrap, load: load };
  }

  /* The media THEATER: click a post's image/video to pop it open — media as large
     as possible on the left (video plays), the post's engagement + comments on the
     right (desktop) or stacked below (mobile). Click the scrim / ✕ / Esc closes.
     For a comment's media (no post) it is a plain viewer with a download. */
  function openMedia(mediaKey: any, kind: any, post: any) {
    closePop();
    var src = API + '/wall/media?key=' + encodeURIComponent(mediaKey);
    var ov = el('div', 'wall-lightbox' + (post ? '' : ' wall-lightbox-bare'));
    var inner = el('div', 'wall-lb-inner');
    var stage = el('div', 'wall-lb-stage');
    var mel: any;
    if (kind === 'v') { mel = el('video', 'wall-lb-media'); mel.src = src; mel.controls = true; mel.autoplay = true; mel.playsInline = true; }
    else if (kind === 'a') { mel = el('audio', 'wall-lb-media wall-lb-audio'); mel.src = src; mel.controls = true; mel.autoplay = true; }
    else { mel = el('img', 'wall-lb-media'); mel.src = src; mel.alt = ''; }
    stage.appendChild(mel);
    inner.appendChild(stage);
    var rail = el('div', 'wall-lb-rail');
    if (post) {
      var head = el('div', 'comment-head');
      wallAvatarInto(head, post.author_hash, post.avatar);
      head.appendChild(authorNode(post.author_hash, post.nick, true, post.faith, post.posts));
      head.appendChild(el('span', 'comment-date', ' ' + fmtDateTime(post.created_at)));
      rail.appendChild(head);
      if (post.body) rail.appendChild(fillBody(el('div', 'comment-body'), post.body));
      var acts = wallActions(post);
      rail.appendChild(acts.el);
      var cs = wallCommentsSection(post, acts.bumpComment);
      rail.appendChild(cs.wrap); cs.load();
      var focusComposer = function () { var ta = cs.wrap.querySelector('.comment-form .comment-text') as HTMLElement; if (ta) ta.focus(); };
      acts.cmtBtn.addEventListener('click', focusComposer);
      acts.cmtSum.addEventListener('click', focusComposer);
      acts.shareBtn.addEventListener('click', function (e: any) { e.stopPropagation(); showShareMenu(acts.shareBtn, location.origin + '/feed.html?post=' + post.id, { url: src, filename: mediaFilename(mediaKey) }, { kind: 'wall', ref: post.id }); });
    } else {
      var mini = el('div', 'wall-lb-mini');
      mini.appendChild(mediaDownloadLink(src, mediaFilename(mediaKey), 'Download', 'btn btn-anon'));
      rail.appendChild(mini);
    }
    inner.appendChild(rail);
    ov.appendChild(inner);
    var x = el('button', 'wall-lb-x'); x.type = 'button'; x.appendChild(mcIcon('close')); x.title = 'Close';
    ov.appendChild(x);
    /* The theater must never feel like leaving the app: it joins history (the
       shell treats a same-URL popstate as hash-only travel and stays put), so
       the app bar's back button, the phone's back gesture, and the browser back
       all close it in place; a soft navigation (a tab tap, any in-app link)
       closes it too. With the scrim gap and the ✕ that is five ways out. */
    var pushed = false;
    function close(fromHistory?: any) {
      if (!ov.parentNode) return;
      ov.parentNode.removeChild(ov);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('popstate', onPop);
      document.removeEventListener('mc-navigate', onNav);
      try { if (mel.pause) mel.pause(); } catch (e) { /* fine */ }
      if (pushed && !fromHistory) { pushed = false; try { history.back(); } catch (e) { /* fine */ } }
    }
    function onPop() { close(true); }
    function onNav() { close(true); }   // the navigation owns history; never history.back() over it
    function onKey(e: any) { if (e.key === 'Escape') close(); }
    ov.addEventListener('click', function (e: any) { if (e.target === ov || e.target === inner || e.target === stage) close(); });
    x.addEventListener('click', function (e: any) { e.stopPropagation(); close(); });
    document.addEventListener('keydown', onKey);
    window.addEventListener('popstate', onPop);
    document.addEventListener('mc-navigate', onNav);
    try { history.pushState({ mcTheater: 1 }, '', location.href); pushed = true; } catch (e) { /* private mode etc.: ✕/scrim/Esc still close */ }
    document.body.appendChild(ov);
  }
  /* One media element for a post/comment. Sizes are STANDARDISED: small media
     shows at natural size, large media caps (CSS max-height) so one giant image
     never dominates the scroll. `post` (a post object) makes a click pop the FB
     theater; passing null (comment media) gives a plain viewer. Images and video
     both pop open — video plays there. An always-visible expand button makes the
     "open" affordance clear even over video controls. */
  function wallMediaNode(mediaKey: any, post: any) {
    if (!mediaKey) return null;
    ensureDmStyles();   // board comments render through here too (kit.wallMediaNode)
    var kind = String(mediaKey).split('/')[1];
    var src = API + '/wall/media?key=' + encodeURIComponent(mediaKey);
    var holder = el('div', 'wall-media wall-media-' + (kind === 'v' ? 'video' : kind === 'a' ? 'audio' : 'img'));
    var mel: any;
    var open = function (e: any) { if (e) { e.preventDefault(); e.stopPropagation(); } openMedia(mediaKey, kind, post); };
    if (kind === 'v') {
      mel = el('video', 'wall-media-el'); mel.src = src; mel.controls = true; mel.preload = 'metadata'; mel.playsInline = true;
    } else if (kind === 'a') {
      mel = el('audio', 'wall-media-el'); mel.src = src; mel.controls = true; mel.preload = 'metadata';
    } else {
      mel = el('img', 'wall-media-el'); mel.src = src; mel.alt = ''; mel.loading = 'lazy'; mel.style.cursor = 'pointer';
      mel.addEventListener('click', open);
    }
    mel.addEventListener('error', function () { holder.textContent = ''; holder.appendChild(el('span', 'wall-media-gone', '🖼️ media unavailable')); });
    holder.appendChild(mel);
    /* the expand affordance (image + video; audio has no theater) */
    if (kind !== 'a') {
      var exp = el('button', 'wall-media-expand'); exp.type = 'button'; exp.title = 'Open'; exp.setAttribute('aria-label', 'Open');
      exp.appendChild(mcIcon('expand'));
      exp.addEventListener('click', open);
      holder.appendChild(exp);
    }
    return holder;
  }
  /* True if I may delete this authored item (mine, or I am an admin). */
  function wallCanDelete(authorHash: any) {
    if (window.mcCore) return window.mcCore.canDelete(authorHash, state.myHash, isAdmin());
    return isAdmin() || (!!state.myHash && authorHash === state.myHash);
  }
  function wallDeleteLink(id: any, kind: any, node: any) {
    var a = el('a', 'comment-quote-link wall-del', 'delete');
    a.href = '#';
    a.addEventListener('click', function (e: any) {
      e.preventDefault();
      appConfirm('Delete this ' + (kind === 'comment' ? 'comment' : 'post') + '? This cannot be undone.', { okLabel: 'Delete', danger: true }, function (ok: any) {
        if (!ok) return;
        fetch(API + '/wall/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: state.key, id: id, kind: kind }) })
          .then(function (r) { return r.json(); })
          .then(function (d) { if (d && d.ok && node && node.parentNode) node.parentNode.removeChild(node); })
          .catch(function () {});
      });
    });
    return a;
  }
  /* Edit your own wall post or comment in place (the server re-screens like a
     fresh post). Swaps the rendered body for a small editor and back. */
  function wallEditLink(item: any, kind: any, node: any) {
    var a = el('a', 'comment-quote-link wall-del', 'edit');
    a.href = '#';
    a.addEventListener('click', function (e: any) {
      e.preventDefault();
      var bodyEl = node.querySelector('.comment-body');
      if (!bodyEl || node.querySelector('.wall-edit-box')) return;
      var box = el('div', 'comment-form wall-edit-box');
      var ta = el('textarea', 'comment-text');
      ta.maxLength = 4000; ta.rows = 3; ta.value = String(item.body || '');
      box.appendChild(ta);
      var row = el('div', 'comment-buttons');
      var save = el('button', 'btn btn-send', 'Save'); save.type = 'button';
      var cancel = el('button', 'btn', 'Cancel'); cancel.type = 'button';
      var status = el('p', 'form-status');
      row.appendChild(save); row.appendChild(cancel);
      box.appendChild(row); box.appendChild(status);
      bodyEl.style.display = 'none';
      bodyEl.parentNode.insertBefore(box, bodyEl.nextSibling);
      function closeBox() { box.remove(); (bodyEl as any).style.display = ''; }
      cancel.addEventListener('click', closeBox);
      save.addEventListener('click', function () {
        var body = ta.value.replace(/\s+$/, '');
        if (!body.trim()) { ta.focus(); return; }
        save.disabled = true; status.textContent = 'Saving…';
        fetch(API + '/wall/edit', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: state.key, id: item.id, comment: kind === 'comment' ? 1 : 0, body: body }),
        }).then(function (r) { return r.json(); }).then(function (d) {
          save.disabled = false;
          if (blockedOut(d)) return;
          if (!d || !d.ok) { status.textContent = (d && d.error) || 'Could not save.'; return; }
          item.body = body;
          bodyEl.textContent = '';
          fillBody(bodyEl, body);
          closeBox();
          if (d.status === 'pending') {
            node.appendChild(el('p', 'comments-status', 'Held for review. It will reappear once approved.'));
          }
        }).catch(function () { save.disabled = false; status.textContent = 'Could not save. Try again.'; });
      });
      ta.focus();
    });
    return a;
  }
  /* One comment on a public post. */
  /* A compact like control for a COMMENT (Facebook style: a "Like" text button and
     a small heart count that reveals who liked on hover / long-press). */
  function wallCommentLike(c: any) {
    var wrap = el('span', 'wall-clike-wrap');
    var n = Number(c.likes) || 0, on = !!c.liked, gen = 0;
    var btn = el('button', 'wall-clike'); btn.type = 'button';
    var cnt = el('button', 'wall-clike-count'); cnt.type = 'button';
    function render() { btn.textContent = on ? 'Liked' : 'Like'; btn.classList.toggle('on', on); if (n > 0) { cnt.textContent = '♥ ' + n; cnt.style.display = ''; } else { cnt.style.display = 'none'; } }
    render();
    attachLikers(cnt, function () { return { comment: c.id }; });
    btn.addEventListener('click', function (e: any) {
      e.preventDefault(); e.stopPropagation();
      if (!state.myHash) { if (window.mcOnboard) window.mcOnboard(); return; }
      var want = !on, myGen = ++gen; on = want; n = Math.max(0, n + (want ? 1 : -1)); render();
      fetch(API + '/wall/comment/like', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: state.key, comment: c.id, like: want }) })
        .then(function (r) { return r.json(); }).then(function (d) {
          if (myGen !== gen) return;
          if (d && d.ok) { on = !!d.liked; n = Number(d.likes) || 0; } else { on = !want; n = Math.max(0, n + (want ? -1 : 1)); }
          render();
        }).catch(function () { if (myGen !== gen) return; on = !want; n = Math.max(0, n + (want ? -1 : 1)); render(); });
    });
    wrap.appendChild(btn); wrap.appendChild(cnt);
    return wrap;
  }
  function wallCommentNode(c: any, post: any) {
    /* A blocked author's comment does not exist for you (block unification). */
    if (c.author_hash && c.author_hash !== state.myHash && isBlocked(c.author_hash)) {
      var bph = el('div', 'comment-blocked');
      bph.style.display = 'none';
      (bph as any).hidden = true;
      return bph;
    }
    var node = el('article', 'comment wall-comment');
    var head = el('div', 'comment-head');
    wallAvatarInto(head, c.author_hash, c.avatar);
    head.appendChild(authorNode(c.author_hash, c.nick, true, c.faith, c.posts));
    if (c.author_hash && ADMIN_HASHES.indexOf(c.author_hash) !== -1) head.appendChild(el('span', 'comment-admin', '(admin)'));
    var cdate = el('a', 'comment-date', fmtTimeCompact(c.created_at));
    cdate.title = fmtDateTime(c.created_at);
    head.appendChild(cdate);
    var citems: any[] = [];
    if (c.author_hash && state.myHash && c.author_hash === state.myHash) citems.push(wallEditLink(c, 'comment', node));
    if (wallCanDelete(c.author_hash)) citems.push(wallDeleteLink(c.id, 'comment', node));
    if (citems.length) head.appendChild(postMenu({ items: citems }));
    node.appendChild(head);
    node.appendChild(fillBody(el('div', 'comment-body'), c.body));
    if (c.media_key) { var m = wallMediaNode(c.media_key, null); if (m) node.appendChild(m); }
    var actRow = el('div', 'wall-comment-actions');
    actRow.appendChild(wallCommentLike(c));
    node.appendChild(actRow);
    return node;
  }
  /* One public post: header, body, media, and a lazily-loaded comment section
     with its own composer. `expand` opens the comments immediately (post detail). */
  /* A quiet prompt shown to a logged-out reader on a PUBLIC post, in place of the
     control they cannot use yet — the interaction opens onboarding, never a wall. */
  function loginToInteract(what: any) {
    var p = el('p', 'comments-status');
    var a = identityAction('Create an identity', function () { if (window.mcOnboard) window.mcOnboard(); });
    p.appendChild(document.createTextNode('Sign in to ' + what + '. '));
    p.appendChild(a);
    return p;
  }

  /* Clamp a rendered body to N lines with a "See more" that expands in place.
     Measured after insertion (rAF): if it does not actually overflow, the clamp is
     dropped so short posts are never truncated. Media posts clamp tighter so the
     image/video is the focus; solo-text posts get a longer clamp. */
  function clampBody(bodyEl: any, lines: any) {
    bodyEl.classList.add('wall-clamp');
    bodyEl.style.setProperty('--wall-lines', String(lines));
    var more = el('button', 'wall-seemore', 'See more'); more.type = 'button';
    more.style.display = 'none';
    more.addEventListener('click', function (e: any) { e.preventDefault(); e.stopPropagation(); bodyEl.classList.remove('wall-clamp'); more.style.display = 'none'; });
    requestAnimationFrame(function () {
      if (bodyEl.scrollHeight > bodyEl.clientHeight + 4) more.style.display = '';
      else bodyEl.classList.remove('wall-clamp');
    });
    return more;
  }
  function wallPostNode(p: any, expand?: boolean) {
    /* A blocked author's post does not exist for you (block unification);
       the hidden stub keeps every feed list's append/prune bookkeeping. */
    if (p.author_hash && p.author_hash !== state.myHash && isBlocked(p.author_hash)) {
      var bph = el('article', 'comment-blocked');
      bph.id = 'post-' + p.id;
      bph.style.display = 'none';
      (bph as any).hidden = true;
      return bph;
    }
    ensureDmStyles();
    var node = el('article', 'comment wall-post' + (expand ? ' wall-post-detail' : '') + (p.media_key ? ' wall-post-media' : ''));
    node.id = 'post-' + p.id;
    /* In the feed/list (not the detail view), the whole card opens the post's own
       page — but never when the click lands on a control, link, media, the action
       bar, or the comments, and never over a text selection. (Media itself opens
       the theater, handled in wallMediaNode.) */
    if (!expand) {
      node.style.cursor = 'pointer';
      node.addEventListener('click', function (e: any) {
        if (e.target.closest('a, button, video, audio, input, textarea, label, .wall-comments, .wall-media, .wall-actions')) return;
        if (window.getSelection && String(window.getSelection())) return;
        location.href = 'feed.html?post=' + p.id;
      });
    }
    var head = el('div', 'comment-head');
    wallAvatarInto(head, p.author_hash, p.avatar);
    head.appendChild(authorNode(p.author_hash, p.nick, true, p.faith, p.posts));
    if (p.author_hash && ADMIN_HASHES.indexOf(p.author_hash) !== -1) head.appendChild(el('span', 'comment-admin', '(admin)'));
    var permalink = el('a', 'comment-date', fmtTimeCompact(p.created_at));
    permalink.title = fmtDateTime(p.created_at);
    permalink.href = 'feed.html?post=' + p.id;
    head.appendChild(permalink);
    var pitems: any[] = [];
    if (p.author_hash && state.myHash && p.author_hash !== state.myHash && p.author_hash !== MERECAT_BOT_HASH) {
      var dm = el('a', 'comment-dm', 'Direct Message'); dm.href = 'messages.html?dm=' + p.author_hash; pitems.push(dm);
    }
    if (p.author_hash && state.myHash && p.author_hash === state.myHash) pitems.push(wallEditLink(p, 'post', node));
    if (wallCanDelete(p.author_hash)) pitems.push(wallDeleteLink(p.id, 'post', node));
    if (pitems.length) head.appendChild(postMenu({ items: pitems }));
    node.appendChild(head);
    if (p.body) {
      var bodyEl = fillBody(el('div', 'comment-body'), p.body);
      node.appendChild(bodyEl);
      /* media posts: text is a caption, clamp tight (media is the focus); solo
         text posts get a longer read before "See more". Full text in the detail. */
      if (!expand) node.appendChild(clampBody(bodyEl, p.media_key ? 3 : 9));
    }
    if (p.media_key) { var mm = wallMediaNode(p.media_key, p); if (mm) node.appendChild(mm); }

    var acts = wallActions(p);
    node.appendChild(acts.el);
    var cs = wallCommentsSection(p, acts.bumpComment);
    cs.wrap.style.display = expand ? '' : 'none';
    node.appendChild(cs.wrap);
    var openComments = function () { cs.wrap.style.display = ''; cs.load(); var ta = cs.wrap.querySelector('.comment-form .comment-text') as HTMLElement; if (ta) ta.focus(); };
    acts.cmtBtn.addEventListener('click', function () { if (cs.wrap.style.display === 'none') openComments(); else cs.wrap.style.display = 'none'; });
    acts.cmtSum.addEventListener('click', openComments);
    acts.shareBtn.addEventListener('click', function (e: any) {
      e.stopPropagation();
      showShareMenu(acts.shareBtn, location.origin + '/feed.html?post=' + p.id,
        p.media_key ? { url: API + '/wall/media?key=' + encodeURIComponent(p.media_key), filename: mediaFilename(p.media_key) } : null,
        { kind: 'wall', ref: p.id });
    });
    if (expand) cs.load();
    return node;
  }

  /* A composer for a post (kind 'post') or a comment (kind 'comment', extra.post).
     Reuses mdEditor + preview + drafts + @mentions + Turnstile + a media attach,
     uploading to /wall/media then posting to /wall/post|/wall/comment. onDone gets
     the created row (enriched enough to render) when it went live, or null. */
  function wallComposer(kind: any, extra: any, onDone: any) {
    var form = el('div', 'comment-form wall-composer');
    var ta = el('textarea', 'comment-text');
    ta.maxLength = 4000; ta.rows = kind === 'comment' ? 2 : 3;
    ta.placeholder = kind === 'comment' ? 'Write a comment…' : 'Share something with the community…';
    form.appendChild(mdEditor(ta));
    /* The wall/feed composer keeps a draft like every other composer now: a
       long post must survive a crashed tab. Keyed per place, so the feed box,
       a wall box, and each comment box restore to their own spots. */
    attachDraft(ta, kind === 'comment' ? 'wallc:' + (extra.post || 0) : 'wall:' + location.pathname);
    attachMentions(ta);
    form.appendChild(el('div', 'ts-slot'));
    var btnRow = el('div', 'comment-buttons');
    var send = el('button', 'btn btn-send', kind === 'comment' ? 'Comment' : 'Post'); send.type = 'button';
    btnRow.appendChild(send);
    var pv = previewButton(ta); if (pv) btnRow.appendChild(pv);
    var pendingFile: any = null;
    var wplace = kind === 'comment' ? 'wallc:' + (extra.post || 0) : 'wall:' + location.pathname;
    var fileInput = el('input'); fileInput.type = 'file'; fileInput.style.display = 'none';
    var attach = utilBtnLabel(el('button', 'btn btn-attach'), '📎', 'Attach'); attach.type = 'button';
    var chip = el('span', 'dm-attach-chip'); chip.style.display = 'none';
    function clearAttach() { pendingFile = null; fileInput.value = ''; chip.style.display = 'none'; chip.textContent = ''; mediaStash('del', wplace); }
    attach.addEventListener('click', function () { fileInput.click(); });
    function holdWallFile(out: any) {
      pendingFile = out; chip.textContent = '';
      chip.appendChild(document.createTextNode('📎 ' + (out.name || 'attachment') + ' · ' + fmtBytes(out.size) + '  '));
      var x = el('a', null, '✕'); x.href = '#'; x.addEventListener('click', function (e: any) { e.preventDefault(); clearAttach(); });
      chip.appendChild(x); chip.style.display = '';
    }
    /* Gate + hold one picked (or recorded) file: kind and size from the FEED
       section's served settings, images downscaled in the browser first. The
       held file also enters the media stash so a reload cannot lose it (the
       wall uploads at post time, so only the bytes are kept). */
    function takeWallFile(f: any) {
      mediaCfg().then(function (cfg: any) {
        mediaGateFile(f, cfg, cfg.sections.wall, status).then(function (out: any) {
          if (!out) { fileInput.value = ''; return; }
          status.textContent = '';
          holdWallFile(out);
          mediaStash('put', wplace, { blob: out, name: out.name || 'attachment',
            type: out.type || '', size: out.size, at: Date.now() });
        });
      });
    }
    mediaStash('get', wplace).then(function (rec: any) {
      if (!rec || !rec.at || pendingFile || fileInput.value) return;
      if (Date.now() - rec.at > 86400000) { mediaStash('del', wplace); return; }
      if (!rec.blob) return;
      try {
        holdWallFile(new File([rec.blob], rec.name || 'attachment', { type: rec.type || rec.blob.type || '' }));
      } catch (e) { /* File ctor unavailable: stash stays for a newer engine */ }
    });
    fileInput.addEventListener('change', function () {
      var f = fileInput.files && fileInput.files[0]; if (!f) return;
      takeWallFile(f);
    });
    btnRow.appendChild(attach);
    /* One config tap governs the whole attach row: hidden outright when the
       feed takes no media (the board composer always behaved this way), accept
       derived from the section's own kinds, 🎙 behind its voice flag. */
    mediaCfg().then(function (cfg: any) {
      var sec = cfg.sections.wall;
      if (!cfg.enabled || !sec.kinds.length) { attach.style.display = 'none'; return; }
      fileInput.accept = window.mcCore ? (window.mcCore as any).mediaAcceptFor(sec.kinds) : 'image/*,video/*,audio/*';
      if (sec.voice && sec.kinds.indexOf('audio') !== -1) btnRow.appendChild(voiceControl(form, cfg, sec, status, takeWallFile));
    });
    form.appendChild(chip); form.appendChild(fileInput); form.appendChild(btnRow);
    var status = el('p', 'form-status'); form.appendChild(status);
    ensureDmStyles();
    loadTurnstile();
    send.addEventListener('click', function () {
      var body = ta.value.replace(/\s+$/, '');
      if (!pendingFile && !body.trim()) { if (ta.mcPreview) ta.mcPreview.off(); ta.focus(); return; }
      send.disabled = true; status.textContent = 'Verifying…';
      var file = pendingFile;
      getToken().then(function (token) {
        function post(mediaKey: any) {
          status.textContent = 'Posting…';
          var payload: any = { key: state.key, body: body, token: token, mentions: collectMentions(body) };
          if (mediaKey) payload.media_key = mediaKey;
          var url = API + '/wall/post';
          if (kind === 'comment') { payload.post = extra.post; url = API + '/wall/comment'; }
          return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
            .then(function (r) { return r.json(); })
            .then(function (d) {
              send.disabled = false;
              if (blockedOut(d)) return;
              if (!d || !d.ok) { status.textContent = (d && d.error) || 'Could not post.'; if (window.turnstile) try { turnstile.reset(); } catch (e) {} return; }
              ta.value = ''; if (ta.mcDraftDone) ta.mcDraftDone(); clearAttach();
              if (ta.mcPreview) ta.mcPreview.off();
              if (window.turnstile) try { turnstile.reset(); } catch (e) {}
              if (d.status === 'pending') { status.textContent = 'Held for review. It will appear once approved.'; return; }
              status.textContent = '';
              /* Build a local row to render immediately (author = me). */
              var row = { id: d.id, author_hash: state.myHash, nick: myNick(), avatar: myAvatar(), faith: getFaith(),
                body: body, created_at: Math.floor(Date.now() / 1000), media_key: mediaKey || null, comments: 0,
                likes: 0, liked: false, posts: myPostCount() };
              if (onDone) onDone(row);
            });
        }
        if (file) {
          status.textContent = 'Uploading…';
          var fd = new FormData(); fd.append('key', state.key); fd.append('file', file);
          return fetch(API + '/wall/media', { method: 'POST', body: fd })
            .then(function (r) { return r.json(); })
            .then(function (d) {
              if (!d || !d.ok) { send.disabled = false; status.textContent = (d && d.error) || 'Upload failed.'; return; }
              return post(d.media_key);
            });
        }
        return post(null);
      }).catch(function () { send.disabled = false; status.textContent = 'Could not post. Try again.'; });
    });
    return form;
  }

  /* Best-effort "my own" display bits for an optimistic render (the server is
     authoritative on the next load). */
  function myNick() { try { return (state.profile && state.profile.nick) || ''; } catch (e) { return ''; } }
  function myAvatar() { try { return (state.profile && state.profile.avatar) || ''; } catch (e) { return ''; } }
  function myPostCount() { try { return (state.profile && state.profile.posts) || 0; } catch (e) { return 0; } }

  /* A reusable infinite-scroll list: `fetcher(cursor)` returns {ok, posts, next}. */
  /* An endless-scroll list. opts.loop (the global Feed) makes it a true endless
     scroll: at the end it starts the feed over from the top, and it CAPS the live
     DOM — pruning the oldest cards (already scrolled past) with exact scroll
     compensation so memory stays bounded while it "always keeps scrolling". A
     profile wall passes no loop (it is finite and stops at the end). */
  function wallInfiniteList(fetcher: any, opts?: any) {
    opts = opts || {};
    var wrap = el('div', 'wall-list');
    var status = el('p', 'comments-status');
    var sentinel = el('div', 'wall-sentinel');
    wrap.appendChild(sentinel); wrap.appendChild(status);
    var next = 0, loading = false, done = false, any = false;
    var MAX_NODES = 80;
    function count() { return wrap.querySelectorAll('.wall-post').length; }
    function fills() { return wrap.scrollHeight > window.innerHeight * 1.3; }
    /* Prune the oldest cards once we exceed the cap, but only ones fully scrolled
       past (their bottom above the viewport), compensating window scroll by the
       exact height removed so the viewport never jumps. */
    function prune() {
      if (!opts.loop) return;
      while (count() > MAX_NODES) {
        var first: any = wrap.firstElementChild;
        if (!first || first === sentinel || first === status) break;
        if (first.getBoundingClientRect().bottom > 0) break;   // still (partly) visible — stop
        var before = document.documentElement.scrollHeight;
        wrap.removeChild(first);
        window.scrollBy(0, document.documentElement.scrollHeight - before);
      }
    }
    function load() {
      if (loading || done) return;
      loading = true; status.textContent = 'Loading…';
      fetcher(next).then(function (d: any) {
        loading = false; status.textContent = '';
        if (blockedOut(d)) return;
        if (!d || !d.ok) { status.textContent = 'Could not load. Reload the page.'; return; }
        (d.posts || []).forEach(function (p: any) { any = true; wrap.insertBefore(wallPostNode(p), sentinel); });
        next = Number(d.next) || 0;
        if (!next) {
          if (!any) { done = true; status.textContent = 'Nothing here yet. Be the first to post.'; }
          else if (opts.loop && fills()) {
            /* endless scroll: mark the wrap-around and re-read from the top */
            wrap.insertBefore(el('div', 'wall-loopmark', '· You’re all caught up — earlier posts follow ·'), sentinel);
            next = 0;
          } else { done = true; }
        }
        prune();
      }).catch(function () { loading = false; status.textContent = 'Could not load. Reload the page.'; });
    }
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (ents) { if (ents.some(function (e) { return e.isIntersecting; })) load(); }, { rootMargin: '600px' });
      io.observe(sentinel);
    } else {
      var more = el('button', 'btn', 'Load more'); more.type = 'button';
      more.addEventListener('click', load); wrap.appendChild(more);
    }
    load();
    return {
      wrap: wrap,
      prepend: function (row: any, live?: boolean) {
        any = true;
        var node = wallPostNode(row);
        if (wrap.querySelector('#post-' + row.id)) return;   // already shown (dedup live vs optimistic)
        if (live) node.classList.add('wall-live-new');
        var before = document.documentElement.scrollHeight;
        wrap.insertBefore(node, wrap.firstChild);
        /* keep the reader's place if they are scrolled down; if near the top the
           new card simply appears (Facebook's "new post floats in"). */
        if (live && window.scrollY > 240) window.scrollBy(0, document.documentElement.scrollHeight - before);
        if (live) setTimeout(function () { node.classList.remove('wall-live-new'); }, 2200);
      },
    };
  }

  function viewFeed() {
    document.title = 'Feed | Community';
    crumb([['Community', 'community.html'], ['Feed']]);
    if (!isMember()) { viewJoin('see and post to the community feed'); return; }
    section.appendChild(el('p', 'board-intro', 'Everything the community is sharing. Your posts appear here and on your profile.'));
    section.appendChild(wallComposer('post', {}, function (row: any) { if (row && list) list.prepend(row); }));
    var list = wallInfiniteList(function (cursor: any) {
      return fetch(API + '/wall/feed', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: state.key, cursor: cursor }) }).then(function (r) { return r.json(); });
    }, { loop: true });
    section.appendChild(list.wrap);
    /* Live: a new post floats straight to the top over the WebSocket (we get only
       the id on the wire, so fetch the row and prepend it, keeping the reader's
       place if they are scrolled down). New COMMENTS just bump the count when
       their post is on screen; otherwise they are ignored here. */
    var seenLive: Record<string, boolean> = {};
    state.onLiveWall = function (m: any) {
      if (!m || m.t !== 'wall-post' || !m.id || seenLive[m.id]) return;
      seenLive[m.id] = true;
      if (list.wrap.querySelector('#post-' + m.id)) return;
      fetch(API + '/wall/post/get', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: state.key || '', id: m.id }) })
        .then(function (r) { return r.json(); })
        .then(function (d: any) { if (d && d.ok && d.post) list.prepend(d.post, true); })
        .catch(function () {});
    };
  }

  function viewPost(id: any) {
    if (!(id > 0)) { crumb([['Community', 'community.html'], ['Feed', 'feed.html']]); section.appendChild(el('p', 'comments-status', 'No such post.')); return; }
    /* A single post is PUBLIC: no identity needed to read it and its interactions.
       Liking/commenting is gated inside wallPostNode (it opens onboarding). */
    document.title = 'Post | Community';
    crumb([['Community', 'community.html'], ['Feed', 'feed.html'], ['Post']]);
    var holder = el('div', 'wall-list'); section.appendChild(holder);
    holder.appendChild(el('p', 'comments-status', 'Loading…'));
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

  /* The wall section on a profile: the member's own posts, with a composer when
     it is your own profile. Called from renderProfile. */
  function renderProfileWall(card: any, hash: any, editable: any) {
    if (!isMember()) return;   // profiles are members-only now; a guest never gets here
    card.appendChild(el('h3', null, editable ? 'Your wall' : 'Wall'));
    if (editable) {
      card.appendChild(wallComposer('post', {}, function (row: any) { if (row) wrap.wrap.insertBefore(wallPostNode(row), wrap.wrap.firstChild); }));
    }
    var wrap = wallInfiniteList(function (cursor: any) {
      return fetch(API + '/wall', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: state.key, hash: hash, cursor: cursor }) }).then(function (r) { return r.json(); });
    });
    card.appendChild(wrap.wrap);
  }

  function viewInbox() {
    if (window.mcViews && window.mcViews.inbox) {
      /* The Lit <mc-inbox> renders into its own subtree without clearing section,
         so a badge prepended here survives above the list — no bundle change. */
      section.appendChild(dmE2eBadge());
      return window.mcViews.inbox(section, window.mcKit);
    }
    document.title = 'Inbox | Community';
    crumb([['Community', 'community.html'], ['Inbox']]);
    if (!state.key) {
      section.appendChild(el('p', 'comments-status', 'Messages need an identity. Create one on the board front page.'));
      return;
    }
    section.appendChild(dmSearchBox());
    section.appendChild(dmE2eBadge());
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
        var presDots: Record<string, any> = {};
        d.threads.forEach(function (t: any) {
          var row = el('div', 'board-topic');
          var left = el('div', 'board-topic-left');
          var dot = el('span', 'mc-inbox-dot');
          dot.style.display = 'none';
          dot.title = 'Online';
          left.appendChild(dot);
          presDots[t.other_hash] = dot;
          var a = el('a', 'board-topic-title' + (t.unread ? ' dm-unread' : ''), dmLabel(t.other_hash, t.nick));
          a.href = 'messages.html?dm=' + t.other_hash;
          left.appendChild(a);
          if (t.unread) left.appendChild(el('span', 'dm-unread', ' ● new'));
          var isub = el('div', 'board-row-sub', fmtTimeCompact(t.last_at));
          isub.title = fmtDateTime(t.last_at);
          left.appendChild(isub);
          row.appendChild(left);
          var istat = el('div', 'board-stats', t.msgs + (t.msgs === 1 ? ' message' : ' messages'));
          istat.title = fmtDateTime(t.last_at);
          row.appendChild(istat);
          /* A quiet Delete in the corner: clears my side, keeps the other's. */
          var delWrap = el('div', 'board-admin-corner');
          var del = el('a', 'trust-toggle', 'Delete');
          del.href = '#';
          del.addEventListener('click', (function (other, rowEl) {
            return function (e: any) {
              e.preventDefault();
              appConfirm('Delete this conversation? It is cleared from your inbox; the other member keeps their copy until they delete it too.', { okLabel: 'Delete', danger: true }, function (ok: any) {
                if (!ok) return;
                fetch(API + '/dm/delete', {
                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ key: state.key, with: other }),
                }).then(function (r) { return r.json(); }).then(function (d2) {
                  if (d2.ok) { rowEl.remove(); try { localStorage.removeItem(DM_CACHE); } catch (e2) {} dmUnreadCheck(); }
                }).catch(function () {});
              });
            };
          })(t.other_hash, row));
          delWrap.appendChild(del);
          row.appendChild(delWrap);
          list.appendChild(row);
        });
        /* One batched presence snapshot for the whole page: which correspondents
           are online now (honouring appear-offline). No per-row polling. */
        var presHashes = d.threads.map(function (t: any) { return t.other_hash; });
        if (presHashes.length) {
          fetch(API + '/dm/presence', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: state.key, hashes: presHashes }) })
            .then(function (r) { return r.json(); })
            .then(function (pd) { if (pd && pd.ok && Array.isArray(pd.online)) pd.online.forEach(function (h: any) { if (presDots[h]) presDots[h].style.display = ''; }); })
            .catch(function () {});
        }
        state.inboxPresence = function (h: any, on: any) { if (presDots[h]) presDots[h].style.display = on ? '' : 'none'; };
        function inboxHref(i: any) { return 'messages.html&p=' + i; }
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
    if (window.mcViews && window.mcViews.notifications) return window.mcViews.notifications(section, window.mcKit);
    document.title = 'Notifications | Community';
    crumb([['Community', 'community.html'], ['Notifications']]);
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
        d.items.forEach(function (it: any) {
          var row = el('div', 'board-topic');
          var left = el('div', 'board-topic-left');
          var who = it.actor_nick || (it.actor_hash ? displayName(it.actor_hash) : 'Someone');
          /* A 'dm' notification opens the conversation; 'call' (a missed call)
             does too; 'wall' jumps to the post; reply/mention jump to the
             forum post. */
          var isDm = it.kind === 'dm';
          var isCall = it.kind === 'call';
          var isWall = it.kind === 'wall';
          var isLike = it.kind === 'wall-like';
          var isCat = it.kind === 'merecat';
          var label = isDm ? (who + ' sent you a message')
            : isCall ? ('📞 ' + who + ' called you')
              : isCat ? 'merecat finished answering your question'
                : isLike ? (who + ' liked your post')
                  : isWall ? (who + (it.topic_id === 1 ? ' commented on your post' : ' mentioned you in a post'))
                    : who + (it.kind === 'mention' ? ' mentioned you in ' : ' replied in ') + (it.topic_title || 'a thread');
          var a = el('a', 'board-topic-title' + (it.read_at ? '' : ' dm-unread'), label);
          a.href = (isDm || isCall) ? ('messages.html?dm=' + it.actor_hash)
            : isCat ? ('merecat-ai.html?chat=' + it.topic_id)
              : (isWall || isLike) ? ('feed.html?post=' + it.comment_id)
                : ('community.html?topic=' + it.topic_id + '#comment-' + it.comment_id);
          left.appendChild(a);
          if (!it.read_at) left.appendChild(el('span', 'dm-unread', ' ● new'));
          if (it.snippet && !isDm) left.appendChild(el('div', 'board-intro', it.snippet));
          row.appendChild(left);
          var nstat = el('div', 'board-stats', fmtTimeCompact(it.created_at));
          nstat.title = fmtDateTime(it.created_at);
          row.appendChild(nstat);
          list.appendChild(row);
        });
        function notifHref(i: any) { return 'community.html?notifications=1&p=' + i; }
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
      call(a.getAttribute('data-w') === '1' ? 'unwatch' : 'watch')
        .then(function (d) { if (blockedOut(d)) return; if (d.ok) setLabel(d.watching); }).catch(function () {});
    });
    return a;
  }

  function dmMsgNode(m: any, otherLabel: any) {
    var mine = m.sender_hash === state.myHash;
    var node = el('div', 'dm-msg' + (mine ? ' dm-mine' : ''));
    if (m.id) node.setAttribute('data-dmid', String(m.id));
    var head = el('div', 'comment-head');
    head.appendChild(el('span', 'comment-author', mine ? 'You' : otherLabel));
    var dt = el('span', 'comment-date', fmtTimeCompact(m.created_at));
    dt.title = fmtDateTime(m.created_at);
    head.appendChild(dt);
    if (m.edited_at) head.appendChild(el('span', 'dm-edited', ' (edited)'));
    node.appendChild(head);
    node.appendChild(fillBody(el('div', 'comment-body'), m.body));
    return node;
  }
  /* A deleted (redacted) message: the ciphertext is gone server-side, and both
     sides see a "<redacted>" placeholder standing in its place until the moment
     the message would have expired anyway. Built from text nodes only. */
  function dmRedactedNode(m: any, otherLabel: any) {
    var mine = m.sender_hash === state.myHash;
    var node = el('div', 'dm-msg dm-redacted-msg' + (mine ? ' dm-mine' : ''));
    if (m.id) node.setAttribute('data-dmid', String(m.id));
    var head = el('div', 'comment-head');
    head.appendChild(el('span', 'comment-author', mine ? 'You' : otherLabel));
    var mdt = el('span', 'comment-date', fmtTimeCompact(m.created_at));
    mdt.title = fmtDateTime(m.created_at);
    head.appendChild(mdt);
    node.appendChild(head);
    var body = el('div', 'comment-body');
    body.appendChild(el('span', 'dm-redacted', mine ? '<redacted> — you deleted this message' : '<redacted>'));
    node.appendChild(body);
    return node;
  }

  function viewDm(other: any) {
    if (!/^[0-9a-f]{64}$/.test(String(other))) {
      crumb([['Community', 'community.html'], ['Messages']]);
      section.appendChild(el('p', 'comments-status', 'No such member.'));
      return;
    }
    if (!state.key) {
      crumb([['Community', 'community.html'], ['Messages']]);
      section.appendChild(el('p', 'comments-status', 'Messages need an identity. Create one on the board front page.'));
      return;
    }
    if (other === state.myHash) {
      crumb([['Community', 'community.html'], ['Messages']]);
      section.appendChild(el('p', 'comments-status', 'That would be a soliloquy. Pick another member.'));
      return;
    }
    var qs = new URLSearchParams(location.search);
    var pNum = Math.floor(Number(qs.get('p')) || 0);
    var payload: any = { key: state.key, with: other };
    if (pNum > 0) payload.p = pNum;
    Promise.all([
      ensureNacl(),
      fetchRetry(API + '/dm/thread', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }, [1000, 3000]).then(function (r) { return r.json(); }),
    ])
      .then(function (res) {
        var d = res[1];
        if (!d.ok) throw new Error(d.error || 'failed');
        /* The correspondent's public key drives both decrypt and encrypt for the
           whole thread (the shared secret is the same in both directions). */
        var otherPub = (d.other && d.other.pubkey) || null;
        var label = dmLabel(other, d.other.nick);
        var shortName = d.other.nick || displayName(other);
        document.title = shortName + ' | Inbox';
        crumb([['Community', 'community.html'], ['Inbox', 'messages.html'], [shortName]]);
        var headEl = el('h2', 'board-topic-head');
        var presDot = el('span', 'dm-dot dm-dot-unknown');
        headEl.appendChild(presDot);
        var nameLink = el('a', null, label);
        nameLink.href = profileHref(other);
        headEl.appendChild(nameLink);
        section.appendChild(headEl);
        /* The encrypted-inbox assurance: a quiet badge, the honest explainer one
           tap away, and the optional safety-number verify — no PIN, no friction. */
        ensureDmStyles();
        section.appendChild(dmE2eBadge(other, otherPub));
        /* Disappearing-message notice (implied at the top of every conversation,
           more prominent on a brand-new one) with the 24h/7d/30d chooser. */
        var expiryNote = dmExpiryNode(other, d.ttl, !d.messages.length);
        section.appendChild(expiryNote);
        /* Opening marked it read on the server; make the badge tell the
           same story on the next paint. */
        try { localStorage.removeItem(DM_CACHE); } catch (e) {}
        dmUnreadCheck();
        var list = el('div', 'comments-list');
        section.appendChild(list);
        if (!d.messages.length) {
          list.appendChild(el('p', 'comments-status', 'No messages yet. Say the first word.'));
        }
        /* Read receipts: my own bubbles read "Delivered" until the other opens
           them (opened_at is set at load, or a live dm-read event flips them to
           "Seen"). Only my sent messages carry a receipt. */
        var receipts: any[] = [];
        function addReceipt(node: any, m: any) {
          if (String(m.sender_hash) !== state.myHash) return;
          if (state.prefs && state.prefs.receipts === 'off') return;   // reciprocal: I send none AND see none
          var seen = !!m.opened_at;
          var r = el('span', 'dm-receipt' + (seen ? ' dm-receipt-seen' : ''), seen ? '✓✓ Seen' : '✓ Delivered');
          node.appendChild(r);
          receipts.push({ created: Number(m.created_at) || 0, span: r });
        }
        function renderMsg(m: any) { var n = dmRenderMsg(m, otherPub, shortName, other); addReceipt(n, m); return n; }
        d.messages.forEach(function (m: any) { list.appendChild(renderMsg(m)); });
        /* The "…is typing" line, shown only while the other side is composing. */
        var typingLine = el('p', 'dm-typing', shortName + ' is typing…');
        typingLine.style.display = 'none';
        var typingHideT = 0;
        /* Live drop-in + presence/typing/receipt updates for this open thread.
           A message pushed over the private user scope from THIS other party lands
           at once (their own echo is ignored); presence toggles the header dot;
           dm-read flips my bubbles to "Seen". */
        state.dmView = { other: other,
          setTtl: function (t: any) { if (expiryNote && expiryNote.mcSetTtl) expiryNote.mcSetTtl(t); },
          setPresence: function (on: any) {
            presDot.className = 'dm-dot ' + (on ? 'dm-dot-on' : 'dm-dot-off');
            presDot.title = on ? 'Online' : 'Offline';
          },
          setTyping: function (on: any) {
            clearTimeout(typingHideT);
            if (on) { typingLine.style.display = ''; typingHideT = setTimeout(function () { typingLine.style.display = 'none'; }, 6000); }
            else { typingLine.style.display = 'none'; }
          },
          markRead: function (at: any) {
            var t = Number(at) || 0;
            receipts.forEach(function (rc) {
              if (rc.created <= t) { rc.span.textContent = '✓✓ Seen'; rc.span.className = 'dm-receipt dm-receipt-seen'; }
            });
          },
          append: function (msg: any) {
            if (!msg || String(msg.sender_hash) === state.myHash) return;
            clearTimeout(typingHideT); typingLine.style.display = 'none';   // a real message ends "typing"
            var newMsgPage = Math.max(1, Math.ceil((d.total + 1) / d.per));
            d.total += 1;
            if (d.page === newMsgPage) {
              var node = renderMsg(msg);
              list.appendChild(node);
              node.scrollIntoView();
              /* Watched it arrive: settle read state + receipt server-side
                 (the send-side quiet bell already skipped the notification). */
              dmSeenPing(other);
            } else {
              liveDmBadge();   // in the thread but paged back in history — still a bell
            }
          },
          /* The other party edited a message they sent me: re-render its body
             (decrypting) and mark it "(edited)". Only its text body changes. */
          editMsg: function (msg: any) {
            if (!msg || !msg.id) return;
            var bubble = list.querySelector('[data-dmid="' + String(msg.id).replace(/"/g, '') + '"]');
            if (!bubble || bubble.classList.contains('dm-redacted-msg') || bubble.querySelector('.dm-media')) return;
            var body = bubble.querySelector('.comment-body');
            if (body) {
              var text = Number(msg.enc || 0) === 1 ? (dmDecrypt(msg.body, otherPub) || '⚠️ could not decrypt') : (msg.body || '');
              body.textContent = ''; fillBody(body, text);
            }
            var head = bubble.querySelector('.comment-head');
            if (head && !head.querySelector('.dm-edited')) head.appendChild(el('span', 'dm-edited', ' (edited)'));
          },
          /* The other party deleted a message they sent me: show "<redacted>". */
          redactMsg: function (id: any) {
            if (!id) return;
            var bubble = list.querySelector('[data-dmid="' + String(id).replace(/"/g, '') + '"]');
            if (bubble) dmMakeRedacted(bubble, false);
          },
          /* The other party liked/unliked one of these bubbles: repaint it. */
          likeMsg: function (msg: any) {
            if (!msg || !msg.id) return;
            var bubble = list.querySelector('[data-dmid="' + String(msg.id).replace(/"/g, '') + '"]');
            if (bubble && (bubble as any).mcLikePaint) (bubble as any).mcLikePaint(msg.like);
          } };
        /* Watch the other party's online state live (the DO seeds it now), and
           carry the on-screen claim (dmview:<other>) that keeps THIS thread's
           incoming messages off the bell while it is mounted — the sub is
           replaced by the next view's sub() and the socket closes on a hidden
           tab, so the claim is only ever true while the reader truly looks. */
        if (window.mcLive && window.mcLive.board) window.mcLive.board.sub(['presence:' + other, 'dmview:' + other]);
        var dmPages = Math.max(1, Math.ceil(d.total / d.per));
        function dmHref(i: any) { return 'messages.html?dm=' + other + '&p=' + i; }
        var topBar = pageBar(d.total, d.per, d.page, dmHref);
        if (topBar) section.insertBefore(topBar, list);
        var botBar = pageBar(d.total, d.per, d.page, dmHref);
        if (botBar) section.appendChild(botBar);
        section.appendChild(typingLine);
        var form = el('div', 'comment-form');
        var ta = el('textarea', 'comment-text');
        ta.maxLength = 4000;
        ta.rows = 3;
        ta.placeholder = 'Write your message.';
        form.appendChild(mdEditor(ta));
        attachDraft(ta, 'dm:' + other);
        /* Sparing typing signal: a "start" at most once per 3s while composing,
           a "stop" 4s after the last keystroke. WebSocket only — no HTTP. */
        var typingLastSent = 0, typingStopT = 0;
        ta.addEventListener('input', function () {
          if (!(window.mcLive && window.mcLive.member)) return;
          var now = Date.now();
          if (now - typingLastSent > 3000) { window.mcLive!.member.typing!(other, 'start'); typingLastSent = now; }
          clearTimeout(typingStopT);
          typingStopT = setTimeout(function () { window.mcLive!.member.typing!(other, 'stop'); typingLastSent = 0; }, 4000);
        });
        form.appendChild(el('div', 'ts-slot'));
        var btnRow = el('div', 'comment-buttons');
        var send = el('button', 'btn btn-send', 'Send');
        send.type = 'button';
        btnRow.appendChild(send);
        var pv = previewButton(ta);
        if (pv) btnRow.appendChild(pv);
        /* Attach a photo / audio / video from the device library. It is encrypted
           in the browser (AES-GCM) and sent as an E2E media message on Send; the
           text box becomes an optional caption. */
        var pendingFile: any = null;
        var fileInput = el('input', 'dm-file-input');
        fileInput.type = 'file';
        fileInput.style.display = 'none';
        var attach = utilBtnLabel(el('button', 'btn btn-attach'), '📎', 'Attach');
        attach.type = 'button';
        var mediaChip = el('span', 'dm-attach-chip');
        mediaChip.style.display = 'none';
        function clearAttach() { pendingFile = null; fileInput.value = ''; mediaChip.style.display = 'none'; mediaChip.textContent = ''; }
        attach.addEventListener('click', function () { fileInput.click(); });
        /* Gate + hold one picked (or recorded) file. The kind and size caps come
           from the served media settings (the old hardcoded 60 MB here let the
           server refuse at its own, smaller caps); images are downscaled in the
           browser BEFORE the E2E encrypt, so only the small ciphertext uploads. */
        function takeDmFile(f: any) {
          mediaCfg().then(function (cfg: any) {
            mediaGateFile(f, cfg, cfg.sections.dm, status).then(function (out: any) {
              if (!out) { fileInput.value = ''; return; }
              pendingFile = out;
              status.textContent = '';
              mediaChip.textContent = '';
              mediaChip.appendChild(document.createTextNode('📎 ' + (out.name || 'attachment') + ' · ' + fmtBytes(out.size) + '  '));
              var x = el('a', null, '✕');
              x.href = '#';
              x.addEventListener('click', function (ev: any) { ev.preventDefault(); clearAttach(); });
              mediaChip.appendChild(x);
              mediaChip.style.display = '';
            });
          });
        }
        fileInput.addEventListener('change', function () {
          var f = fileInput.files && fileInput.files[0];
          if (!f) return;
          takeDmFile(f);
        });
        btnRow.appendChild(attach);
        /* One config tap: hide 📎 when the Inbox takes no media, accept from
           the DM section's own kinds, 🎙 behind its voice flag. */
        mediaCfg().then(function (cfg: any) {
          var sec = cfg.sections.dm;
          if (cfg.enabled && sec.kinds.length) {
            fileInput.accept = window.mcCore ? (window.mcCore as any).mediaAcceptFor(sec.kinds) : 'image/*,video/*,audio/*';
            if (sec.voice && sec.kinds.indexOf('audio') !== -1) btnRow.appendChild(voiceControl(form, cfg, sec, status, takeDmFile));
          } else attach.style.display = 'none';
          /* 📞 lives HERE, beside 🎙 — reachable from the bottom of a long
             thread where the composer already is (the header scrolled away
             long ago). Gated on the platform switch + WebRTC support; the
             bot has no ears. */
          if (other !== MERECAT_BOT_HASH && (window as any).RTCPeerConnection
            && (navigator as any).mediaDevices && (navigator as any).mediaDevices.getUserMedia) {
            callsCfg().then(function (cc: any) {
              if (cc.enabled) btnRow.appendChild(callButton(other, label));
            });
          }
        });
        form.appendChild(mediaChip);
        form.appendChild(fileInput);
        form.appendChild(btnRow);
        var status = el('p', 'form-status');
        form.appendChild(status);
        section.appendChild(form);
        loadTurnstile();
        /* We can only encrypt to a member who has published a key. Until they have
           signed in once under the encrypted client, hold the send with a plain
           notice rather than silently falling back to plaintext. */
        if (!otherPub) {
          send.disabled = true;
          ta.disabled = true;
          ta.placeholder = 'Waiting for this member to sign in once to set up encryption.';
          status.textContent = 'You can message them privately once they have signed in to set up their encryption key.';
        }
        send.addEventListener('click', function () {
          var body = ta.value.replace(/\s+$/, '');
          if (!pendingFile && !body.trim()) {
            if (ta.mcPreview) ta.mcPreview.off();
            ta.focus();
            return;
          }
          send.disabled = true;
          status.textContent = 'Verifying...';
          var sending = pendingFile;   // captured: the echo path needs the local file
          getToken().then(function (token) {
            if (sending) {
              /* Media: encrypt the file in the browser, upload only ciphertext,
                 then send a normal E2E message whose body carries the AES key. */
              status.textContent = 'Encrypting...';
              return dmMediaEncryptFile(sending).then(function (mm: any) {
                status.textContent = 'Uploading...';
                var fd = new FormData();
                fd.append('key', state.key);
                fd.append('file', new Blob([mm.ct]), 'blob');
                return fetch(API + '/dm/media', { method: 'POST', body: fd }).then(function (r) { return r.json(); }).then(function (u) {
                  if (!u.ok) throw new Error(u.error || 'The file could not be uploaded.');
                  status.textContent = 'Sending...';
                  if (body.trim()) mm.env.caption = body;
                  return fetchRetry(API + '/dm/send', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ key: state.key, to: other, body: dmEncrypt(JSON.stringify(mm.env), otherPub), enc: 1, media_key: u.media_key, token: token }),
                  }, [1500]).then(function (r) { return r.json(); }).then(function (d2) { d2._env = mm.env; d2._media_key = u.media_key; return d2; });
                });
              });
            }
            status.textContent = 'Sending...';
            return fetchRetry(API + '/dm/send', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ key: state.key, to: other, body: dmEncrypt(body, otherPub), enc: 1, token: token }),
            }, [1500], function () { status.textContent = 'Network hiccup, retrying...'; })
              .then(function (r) { return r.json(); });
          }).then(function (d2) {
            if (blockedOut(d2)) return;
            if (!d2.ok) throw new Error(d2.error || 'The message could not be sent.');
            ta.value = '';
            if (ta.mcDraftDone) ta.mcDraftDone();
            if (ta.mcPreview) ta.mcPreview.off();
            /* Seed the media cache from the local file so our own echo renders
               instantly without a round-trip. */
            if (sending && d2._media_key) { try { _mediaCache[d2._media_key] = URL.createObjectURL(sending); } catch (e) {} }
            clearAttach();
            /* Newest message lands at the bottom of the last page. Show it
               inline when that page is on screen; else jump to it. */
            var msgPage = Math.ceil((d.total + 1) / d.per);
            if (msgPage === d.page) {
              d.total += 1;
              var node;
              if (sending && d2._media_key) {
                var mecho = { id: d2.id, sender_hash: state.myHash, media_key: d2._media_key, created_at: d2.created_at, saved: 0, enc: 1 };
                node = dmMediaNode(mecho, shortName, other, d2._env);
                dmAppendControls(mecho, node, otherPub, shortName, other);   // save + delete (edit not offered for media)
              } else {
                /* Route the text echo through dmRenderMsg so my just-sent
                   message carries edit/delete at once (body is already plaintext). */
                var echo = { id: d2.id, sender_hash: state.myHash, body: body, created_at: d2.created_at, saved: 0, enc: 0 };
                node = dmRenderMsg(echo, otherPub, shortName, other);
              }
              list.appendChild(node);
              status.textContent = 'Sent.';
              node.scrollIntoView();
            } else {
              location.href = 'messages.html?dm=' + other + '&p=' + msgPage;
            }
          }).catch(function (err) {
            status.textContent = err.message || 'Network error. Try again in a moment.';
          }).finally(function () {
            send.disabled = false;
            if (window.turnstile && state.widgetId !== null) turnstile.reset(state.widgetId);
          });
        });
        /* The quiet exit — the ONE block (unified 2026-08-03): messages held
           out of sight AND their posts/profile hidden from your view. */
        var blockLine = el('p', 'board-audit-link');
        blockLine.appendChild(identityAction(d.blocked ? 'Unblock this member' : 'Block this member', function () {
          var blocking = !d.blocked;
          var doBlock = function () { setBlock(other, blocking, function () { location.reload(); }); };
          if (blocking) appConfirm('Block this member? Their future messages are held out of your sight (they are never told), and their posts and profile are hidden from you. Unblocking undoes all of it and delivers everything they wrote meanwhile.', { okLabel: 'Block', danger: true }, function (ok: any) { if (ok) doBlock(); });
          else doBlock();
        }));
        blockLine.appendChild(document.createTextNode(' · '));
        blockLine.appendChild(identityAction('Delete conversation', function () {
          appConfirm('Delete this conversation? It is cleared from your inbox; the other member keeps their copy until they delete it too.', { okLabel: 'Delete', danger: true }, function (ok: any) {
            if (!ok) return;
            fetch(API + '/dm/delete', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ key: state.key, with: other }),
            }).then(function (r) { return r.json(); }).then(function (d3) {
              if (d3.ok) { try { localStorage.removeItem(DM_CACHE); } catch (e) {} location.href = 'messages.html'; }
            }).catch(function () {});
          });
        }));
        section.appendChild(blockLine);
        /* Open a conversation at its newest word: on the last page, bring the
           final message into view, above the composer. */
        if (d.messages.length && d.page >= dmPages && list.lastChild) {
          list.lastChild.scrollIntoView();
        }
      })
      .catch(function () {
        crumb([['Community', 'community.html'], ['Messages']]);
        section.appendChild(el('p', 'comments-status', 'The conversation could not be loaded. Check your connection and reload the page.'));
      });
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
        current = mentionDir
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
      location.href = u;
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
      '.merecat-msg.you{margin-left:auto;background:var(--cream)}' +
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
      '.merecat-form{display:flex;gap:.5rem;align-items:flex-end;margin:.8rem 0 .2rem}' +
      '.merecat-q{flex:1;min-height:3.1em;resize:vertical;font:inherit;color:var(--ink);background:var(--surface);border:1px solid var(--rule);border-radius:6px;padding:.5rem .65rem}' +
      '.merecat-q:focus{outline:1px solid var(--maroon);border-color:var(--maroon)}' +
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
      '@media (max-width:620px){.merecat-msg{max-width:100%}.merecat-form{flex-direction:column;align-items:stretch}.mc-fwd-list{max-height:50vh}}';
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
      pastBody.textContent = attempt ? 'The desk is busy for a moment — retrying…' : 'Loading…';
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
                if (c.id === chatId) location.href = 'merecat-ai.html';
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
    q.placeholder = 'Ask the librarian… say, what do the Fathers make of John 6:53?';
    q.setAttribute('aria-label', 'Your question');
    form.appendChild(q);
    var send = el('button', 'btn btn-send', 'Ask');
    send.type = 'submit';
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
    if (!loggedIn) {
      var askPlaceholder = q.placeholder;
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

    /* Reasoning control, shown only while the local librarian is the active
       backend. The reader's own choice, remembered on this device. Instant
       drops the question to Cloudflare, no wait and no deep reasoning. */
    var MC_MODES = [['instant', 'Instant (Cloudflare, no wait)'], ['off', 'Local · thinking off'],
      ['low', 'Local · thinking: Low'], ['medium', 'Local · thinking: Medium'],
      ['high', 'Local · thinking: High'], ['xhigh', 'Local · thinking: Extra high'],
      ['max', 'Local · thinking: Max']];
    var modeRow = el('p', 'merecat-quota'); modeRow.hidden = true;
    modeRow.appendChild(document.createTextNode('Reasoning: '));
    var modeSel = el('select', 'scripture-sel');
    MC_MODES.forEach(function (m) { var o = el('option', null, m[1]); o.value = m[0]; modeSel.appendChild(o); });
    try { modeSel.value = localStorage.getItem('mc-merecat-mode') || 'high'; } catch (e) {}
    if (!modeSel.value) modeSel.value = 'high';
    modeSel.addEventListener('change', function () {
      try { localStorage.setItem('mc-merecat-mode', modeSel.value); } catch (e) {}
    });
    modeSel.setAttribute('aria-label', 'Reasoning');
    modeRow.appendChild(modeSel);
    section.appendChild(modeRow);
    if (window.mcSelectSheet) window.mcSelectSheet(modeSel);   // app picker on phones
    function renderQuota(u: any) {
      if (!u) return;
      if (u.backend) modeRow.hidden = (u.backend !== 'local');
      /* Caps and the community quota belong to strict Cloudflare mode. In local
         mode there is no rate limiting, so the quota line is hidden entirely. */
      if (u.backend === 'local') { quota.hidden = true; quota.textContent = ''; return; }
      quota.hidden = false;
      quota.textContent = '';
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
        return CATS.filter(function (c) { return c[0] !== 'adminsonly' || isAdmin(); });
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
        var shown = allowedCats().filter(function (c) {
          return !ql || c[1].toLowerCase().indexOf(ql) !== -1 || c[0].indexOf(ql) !== -1;
        });
        if (!shown.length) {
          listBox.appendChild(el('div', 'mc-fwd-empty', 'No category matches.'));
          return;
        }
        shown.forEach(function (c) {
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
          listBox.appendChild(el('div', 'mc-fwd-empty', 'Loading\u2026'));
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
      var mode = modeSel.value || 'high';

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
              if (mode === 'instant') a.instant = true; else a.effort = mode;
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
            if (mode === 'high') wait += ' — on High this usually takes about a minute';
            else if (mode === 'xhigh') wait += ' — at Extra-high this can take a minute or two';
            else if (mode === 'max') wait += ' — at Max this can take a couple of minutes';
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
  /* The routing switch: which librarian answers, Cloudflare (always on) or the
     owner's local machine over Tailscale, with a live online/offline read from
     a quick health ping the worker runs. A hardwire choice, no failover. */
  function renderBackendSwitch(body: any) {
    body.appendChild(el('h3', null, 'Which librarian answers'));
    var wrap = el('div', 'merecat-backends');
    wrap.appendChild(el('p', 'comments-status', 'Checking the backends…'));
    body.appendChild(wrap);
    function save(val: any) {
      var note = el('p', 'comments-status', 'Switching…'); wrap.appendChild(note);
      fetchRetry(MERECAT_API + '/config', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: state.key, config: { backend: val } }) }, [1000])
        .then(function (r) { return r.json(); }).then(function (dd) {
          note.textContent = dd.ok
            ? ('Now routing to ' + (val === 'local' ? 'this machine (local)' : 'Cloudflare') +
               '. Live across the edge within about five minutes.')
            : (dd.error || 'Could not switch.');
        }).catch(function () { note.textContent = 'Could not switch.'; });
    }
    function saveCfg(obj: any, label: any) {
      var note = el('p', 'comments-status', 'Saving…'); wrap.appendChild(note);
      fetchRetry(MERECAT_API + '/config', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: state.key, config: obj }) }, [1000])
        .then(function (r) { return r.json(); }).then(function (dd) {
          note.textContent = dd.ok ? (label + ' saved. Live across the edge within about five minutes.')
            : (dd.error || 'Could not save.');
        }).catch(function () { note.textContent = 'Could not save.'; });
    }
    function draw() {
      fetchRetry(MERECAT_API + '/backends', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: state.key }) }, [1000])
        .then(function (r) { return r.json(); }).then(function (b) {
          wrap.textContent = '';
          if (!b.ok) { wrap.appendChild(el('p', 'comments-status', 'Could not read backend status.')); return; }
          var cf = b.cloudflare || {}, lo = b.local || {};
          var loLine;
          if (!lo.online) {
            loLine = 'offline right now — the machine, Tailscale, or the satellite link';
          } else {
            loLine = 'online · ' + (lo.ms != null ? lo.ms + ' ms · ' : '') +
              (lo.chunks || 0).toLocaleString() + ' passages';
            if (lo.tries > 1) loLine += ' · woke on try ' + lo.tries;
            if (lo.rerank === 'degraded') loLine += ' · reranker degraded, salvage active';
            else if (lo.rerank === 'down') loLine += ' · reranker DOWN';
            if (lo.ready === false) loLine += ' · NOT READY: ' + (lo.why || 'engine fault — asks go to the cloud');
          }
          [['cloudflare', 'Cloudflare (always on)', true,
            'online · ' + (cf.today || 0) + '/' + (cf.gcap || 0) + ' questions used today'],
           ['local', 'This machine, over Tailscale', !!lo.online, loLine]
          ].forEach(function (o) {
            var row = el('label'); row.style.display = 'block'; row.style.margin = '.35em 0';
            var radio = el('input'); radio.type = 'radio'; radio.name = 'mc-backend'; radio.value = o[0];
            radio.checked = (b.backend === o[0]);
            radio.addEventListener('change', function () { if (radio.checked) { applyGate(o[0] === 'local'); save(o[0]); } });
            row.appendChild(radio);
            row.appendChild(el('strong', null, ' ' + o[1] + '  '));
            var dot = el('span', null, o[2] ? '● ' : '○ '); dot.style.color = o[2] ? '#2e7d32' : '#b00';
            row.appendChild(dot);
            row.appendChild(el('span', 'comments-status', o[3] as string));
            wrap.appendChild(row);
          });
          var rp = el('p', 'comments-status');
          var refresh = el('a', 'body-link', 'refresh status'); refresh.href = '#';
          refresh.addEventListener('click', function (e: any) {
            e.preventDefault(); wrap.textContent = '';
            wrap.appendChild(el('p', 'comments-status', 'Checking…')); draw();
          });
          rp.appendChild(refresh); wrap.appendChild(rp);

          var frow = el('p');
          var fchk = el('input'); fchk.type = 'checkbox'; fchk.id = 'mc-failover'; fchk.checked = !!b.failover;
          fchk.addEventListener('change', function () {
            saveCfg({ failover: fchk.checked ? 1 : 0 }, 'Failover ' + (fchk.checked ? 'on' : 'off'));
          });
          frow.appendChild(fchk);
          var flbl = el('label', null, ' Fail over to Cloudflare if the local librarian is offline');
          flbl.htmlFor = 'mc-failover';
          frow.appendChild(flbl);
          wrap.appendChild(frow);

          var mrow = el('p');
          mrow.appendChild(document.createTextNode('@merecat mention reasoning: '));
          var msel = el('select', 'scripture-sel');
          [['instant', 'Instant (Cloudflare)'], ['off', 'Off'], ['low', 'Low'], ['medium', 'Medium'],
           ['high', 'High'], ['xhigh', 'Extra high'], ['max', 'Max']].forEach(function (o) {
            var op = el('option', null, o[1]); op.value = o[0]; msel.appendChild(op);
          });
          msel.value = b.mention_effort || 'high';
          msel.addEventListener('change', function () { saveCfg({ mention_effort: msel.value }, 'Mention reasoning'); });
          mrow.appendChild(msel);
          wrap.appendChild(mrow);

          /* The backend is the top-level gate: on Cloudflare the site behaves
             exactly as it always has, and the settings below (which only shape
             the local librarian) gray out to make that plain. */
          var gateNote = el('p', 'comments-status', '');
          wrap.appendChild(gateNote);
          function applyGate(isLocal: any) {
            fchk.disabled = !isLocal; msel.disabled = !isLocal;
            frow.style.opacity = isLocal ? '' : '0.45';
            mrow.style.opacity = isLocal ? '' : '0.45';
            gateNote.textContent = isLocal
              ? 'Local is the active backend. The settings below apply.'
              : 'Cloudflare is the active backend — the site behaves exactly as before, and the settings below do not apply.';
          }
          applyGate(b.backend === 'local');

          if (!b.configured) wrap.appendChild(el('p', 'comments-status', 'No local URL is configured on the worker yet.'));
        }).catch(function () {
          wrap.textContent = '';
          wrap.appendChild(el('p', 'comments-status', 'Could not reach the status endpoint.'));
        });
    }
    draw();
  }

  /* The platform-settings page, per-SECTION since 2026-08-02: a global panel
     (master switch, absolute ceiling, autocompress, the honest AI notes) and
     one self-contained panel each for the Feed, the Community forum, and the
     Inbox — kinds, voice recorder, AI image screening (the DM box is disabled
     with the honest E2E note: ciphertext cannot be scanned), per-kind sizes,
     voice-note seconds, storage budget with live usage, retention, and a
     one-time purge button per store. Admin-only, server-enforced. */
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
        wrap.appendChild(el('p', 'board-intro', 'Three separate media stores — the public feed, the community forum, and private direct messages — each with its own panel below: what it accepts, size limits, AI screening, its storage budget, retention, and a one-time purge. A control in one never touches the others.'));

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
        dmTtlChoices().forEach(function (o) {
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
            calls_enabled: vcEn.checked ? '1' : '0',
            calls_turn: vcTurn.checked ? '1' : '0',
            calls_idle_hangup: vcIdle.checked ? '1' : '0',
            calls_idle_seconds: vcIdleSecs.value,
            journal_enabled: jEn.checked ? '1' : '0',
            journal_topic: jInp.value,
          };
          Object.assign(set, panelKeys('wall', pWall), panelKeys('board', pBoard), panelKeys('dm', pDm));
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
      renderBackendSwitch(body);
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
      row.appendChild(document.createTextNode(' questions per day. Unchecked, members draw freely until the community budget is spent. Admins are never capped either way. These caps guard the Cloudflare budget and apply only when Cloudflare answers; questions answered by the local librarian are never capped.'));
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
      /* Caps are a strict-Cloudflare-mode concept: when Local is the active
         backend they do not apply, so the whole setting grays out. */
      if (d.backend === 'local') {
        chk.disabled = true; num.disabled = true; save.disabled = true;
        row.style.opacity = '0.5';
        note.textContent = 'Local mode is active — these Cloudflare caps and the community quota do not apply. They govern strict Cloudflare mode only.';
      }
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

  /* The transparency panel's content. Live numbers (the shelf, the counts,
     the persona) come from /about; when that fetch fails the account still
     renders, minus the live parts. Everything is plain createElement. */
  /* The URL→view decision is single-sourced in Domain.Route (parseRoute); this
     is the effect dispatch over its {tag, s, n}. classicRoute below is the exact
     same priority ladder, kept as the no-app fallback (no window.mcCore). */
  function classicRoute(params: any) {
    if (params.get('ipbans')) return { tag: 'IpBans' };
    if (params.get('settings')) return { tag: 'Settings' };
    if (params.get('admins')) return { tag: 'Admins' };
    if (params.get('admin')) return { tag: 'AdminHome' };
    if (params.get('discord')) return { tag: 'Discord' };
    if (params.get('shadowbans')) return { tag: 'Shadowbans' };
    if (params.get('usage')) return { tag: 'Usage' };
    if (params.get('merecatadmin')) return { tag: 'MerecatAdmin' };
    if (params.get('merecatthread')) return { tag: 'MerecatThread', s: params.get('merecatthread') };
    if (params.get('merecatthreads') !== null) return { tag: 'MerecatThreads' };
    if (params.get('merecat')) return { tag: 'Merecat' };
    if (params.get('feed')) return { tag: 'Feed' };
    if (params.get('notifications')) return { tag: 'Notifications' };
    if (params.get('inbox')) return { tag: 'Inbox' };
    if (params.get('users')) return { tag: 'Users' };
    if (params.get('q') !== null) return { tag: 'Search' };
    if (params.get('dm')) return { tag: 'Dm', s: params.get('dm') };
    if (params.get('me')) return { tag: 'Me' };
    if (params.get('profile')) return { tag: 'Profile', s: params.get('profile') };
    if (params.get('post')) return { tag: 'Post', s: params.get('post') };
    if (params.get('audit')) return { tag: 'Audit' };
    var topic = Number(params.get('topic'));
    if (Number.isInteger(topic) && topic > 0) return { tag: 'Topic', n: topic };
    if (params.get('cat')) return { tag: 'Cat', s: params.get('cat') };
    return { tag: 'Index' };
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
      else location.href = 'community.html';
    });
    wrap.appendChild(btn);
    var have = el('p', 'mc-join-havekey');
    have.appendChild(identityAction('I already have a key', function () {
      if (window.mcOnboard) window.mcOnboard(null, { key: true });
      else location.href = 'community.html';
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

  function route() {
    section.textContent = '';
    var params = new URLSearchParams(location.search);
    var page = location.pathname.split('/').pop() || 'index.html';

    /* Pretty profile URL: /@handle is served as profile.html by an edge rewrite,
       so the browser keeps the pretty path. Read the handle straight from it and
       resolve to the member (same path as ?u=<handle>). */
    var atMatch = location.pathname.match(/^\/@([A-Za-z0-9_]+)\/?$/);
    if (atMatch) {
      if (!isMember()) return viewJoin("view members' profiles");
      return viewProfileByHandle(atMatch[1].toLowerCase());
    }

    /* The platform split (2026-08): direct messages, the profile, and the AI each
       live on their own page now. They all boot this same client — route by page. */
    if (page === 'messages.html') {
      if (!isMember()) return viewJoin('read and send messages');
      var dmh = params.get('dm');
      return dmh ? viewDm(dmh) : viewInbox();
    }
    if (page === 'profile.html') {
      var u = params.get('u') || params.get('profile');
      if (!isMember()) return viewJoin(u ? "view members' profiles" : 'set up your profile');
      /* ?u= may carry a 64-hex hash (internal links) OR a custom @handle (a
         shared /@handle link, rewritten to ?u=handle at the edge). A handle is
         resolved to its owner's hash first, so viewProfile + the Lit view stay
         hash-based and unchanged. */
      if (u && !/^[0-9a-f]{64}$/.test(u)) return viewProfileByHandle(u);
      return viewProfile(u || state.myHash);        // members-only: profiles need a login now
    }
    if (page === 'merecat-ai.html') {
      /* Logged-out merecat gets the SAME clean join prompt + registration modal as
         Profile/Inbox — not the old inline identity drawer embedded in the page. */
      if (!isMember()) return viewJoin('ask the librarian');
      return viewMerecat();
    }
    if (page === 'feed.html') {
      /* A single post (?post=<id>) is PUBLIC — anyone may read it and its likes and
         comments; liking or commenting still needs an identity (wallPostNode gates
         the controls). The feed LISTING itself is members-only, guarded like Inbox
         and Profile. */
      var fpost = params.get('post');
      if (fpost) return viewPost(Number(fpost));
      if (!isMember()) return viewJoin('see and post to the community feed');
      return viewFeed();
    }
    if (page === 'journal.html') {
      /* The Mere Catholicity Journal — PUBLIC and shareable (no identity gate).
         ?a=<id> is one article's permalink; bare journal.html is the index. */
      var jart = params.get('a');
      return jart ? viewJournalArticle(Number(jart)) : viewJournal();
    }

    /* Recent activity: the member-safe what-happened-since-I-left list. Routed
       here (a plain query flag) rather than through Domain.Route so the kernel
       stays untouched by a single read-only listing. */
    if (params.get('recent')) return viewRecent(Math.max(1, Math.floor(Number(params.get('p')) || 1)));
    /* Saved posts: the reader's bookmarks, forum topics and feed posts together. */
    if (params.get('saved')) {
      if (!isMember()) return viewJoin('see your saved posts');
      return viewSaved(Math.max(1, Math.floor(Number(params.get('p')) || 1)));
    }

    /* community.html — the forum + its administration. Legacy ?dm/?inbox/?me/
       ?profile/?merecat links (old bookmarks, already-delivered notifications)
       redirect to their new home so nothing that was ever shared breaks. */
    var r = window.mcCore
      ? window.mcCore.parseRoute(function (k) { return params.get(k); })
      : classicRoute(params);
    /* admin.html is the administration area's own page: bare admin.html is the
       hub, and its ?settings=/?discord=/… sub-params route as usual. (Old
       community.html?admin=1 links still resolve to the hub too.) */
    if (page === 'admin.html' && r.tag === 'Index') r = { tag: 'AdminHome' };
    switch (r.tag) {
      case 'Dm': location.replace('messages.html?dm=' + encodeURIComponent(r.s) + location.hash); return;
      case 'Inbox': location.replace('messages.html'); return;
      case 'Me': location.replace('profile.html'); return;
      case 'Profile': location.replace('profile.html?u=' + encodeURIComponent(r.s)); return;
      case 'Merecat': location.replace('merecat-ai.html' + (params.get('chat') ? '?chat=' + encodeURIComponent(params.get('chat') as string) : '')); return;
      case 'IpBans': return viewIpBans();
      case 'Settings': return viewPlatformSettings();
      case 'Admins': return viewAdmins();
      case 'AdminHome': return viewAdminHome();
      case 'Discord': return viewDiscordHooks();
      case 'Shadowbans': return viewShadowbans();
      case 'Usage': return viewUsage();
      case 'MerecatAdmin': return viewMerecatAdmin();
      case 'MerecatThread': return viewMerecatThread(Number(r.s));
      case 'MerecatThreads': return viewMerecatThreads();
      case 'Notifications': return viewNotifications();
      case 'Users': return viewUsers();
      case 'Search': return viewSearch();
      case 'Audit': return viewAudit();
      case 'Feed': location.replace('feed.html' + location.hash); return;
      case 'Post': location.replace('feed.html?post=' + encodeURIComponent(r.s) + location.hash); return;
      case 'Topic': return viewTopic(r.n);
      case 'Cat': return viewCat(r.s);
      default: return viewIndex();
    }
  }

  /* route(), guarded: a view that throws synchronously (a half-arrived
     kernel, an unexpected payload) must never strand the freshly-cleared
     section as a silent blank — render an honest note with a retry that
     re-runs the router in place. */
  function routeSafe() {
    try { route(); } catch (e) {
      section.textContent = '';
      var p = document.createElement('p');
      p.appendChild(document.createTextNode('This page could not be shown. '));
      var again = document.createElement('a');
      again.href = location.href;
      again.textContent = 'Try again';
      again.addEventListener('click', function (ev) { ev.preventDefault(); routeSafe(); });
      p.appendChild(again);
      p.appendChild(document.createTextNode('.'));
      section.appendChild(p);
    }
  }

  /* Device linking: the Settings QR encodes profile.html#key=… — the fragment
     never reaches the server, and it is stripped from the URL the instant we
     read it here. A confirm gates the sign-in so a mis-scanned or hostile link
     never silently replaces the identity on this device. */
  function keyFromFragment() {
    var m = /^#key=([^&]+)/.exec(location.hash || '');
    if (!m) return;
    history.replaceState(history.state, '', location.pathname + location.search);
    var key = '';
    try { key = decodeURIComponent(m[1]).trim(); } catch (e) { return; }
    if (!key || key.length < 16) return;
    if (state.key === key) { if (window.mcToast) window.mcToast('Already signed in on this device.'); return; }
    var msg = state.key
      ? 'Sign in with the scanned key? This device is already signed in as another identity, which will be signed out.'
      : 'Sign in with the scanned key on this device?';
    var confirmFn = window.mcConfirm || function (m2: string) { return Promise.resolve(window.confirm(m2)); };
    confirmFn(msg, { okLabel: 'Sign in' }).then(function (ok: any) {
      if (!ok) return;
      loginWithKey(key).then(function (good: any) {
        if (good) location.reload();
        else if (window.mcToast) window.mcToast('That key was not recognized.');
      });
    });
  }

  /* One quiet, one-time reminder to save the key: a member on their third
     visit who has never opened Show-my-key or saved at onboarding gets a
     dismissible line above the board. Loss is unrecoverable by design, so
     the platform owes the reader one more chance to hear that in time. */
  function keyNudge() {
    if (!state.key) return;
    try {
      if (localStorage.getItem('mc-key-nudged') === '1') return;
      var boots = Number(localStorage.getItem('mc-key-boots') || 0) + 1;
      localStorage.setItem('mc-key-boots', String(boots));
      if (boots < 3) return;
      localStorage.setItem('mc-key-nudged', '1');
    } catch (e) { return; }
    var bar = el('p', 'comments-status');
    bar.appendChild(document.createTextNode('Have you saved your key? It is the only way back into this identity. '));
    var show = el('a', 'body-link', 'Show my key');
    show.setAttribute('href', '#');
    show.addEventListener('click', function (ev: any) {
      ev.preventDefault();
      if (window.mcSheet && window.mcSheet.settings) window.mcSheet.settings();
      bar.remove();
    });
    bar.appendChild(show);
    bar.appendChild(document.createTextNode(' · '));
    var dis = el('a', 'body-link', 'Dismiss');
    dis.setAttribute('href', '#');
    dis.addEventListener('click', function (ev: any) { ev.preventDefault(); bar.remove(); });
    bar.appendChild(dis);
    section.parentNode!.insertBefore(bar, section);
  }

  function startBoard() {
    section.setAttribute('data-nosnippet', '');
    collectAltIps();
    /* Resolve the identity before any view renders, or a keyed visitor
       reads as anonymous and the owner's own links never appear. */
    var ready = state.key ? sha256hex(state.key) : Promise.resolve('');
    ready.then(function (h) {
      state.myHash = h;
      enableMemberLive();
      loadMyProfile();
      dmUnreadCheck();
      notifUnreadCheck();
      routeSafe();
      keyFromFragment();
      keyNudge();
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
    attachDraft(textarea, 'page:' + pagePath());
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
      enableMemberLive();
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

  /* The kit: the per-boot bridge the Lit views (app/views/*) consume — every
     helper stays HERE, proven and singular; the components render, the kit
     acts. Rebuilt each boot so closures always bind the live section and
     state; views receive it by reference at delegation time. */
  window.mcKit = {
    state: state, API: API, CATS: CATS,
    isAdmin: isAdmin, catByKey: catByKey, cachedJson: cachedJson,
    freshParam: freshParam, freshOpts: freshOpts, blockedOut: blockedOut,
    renderIdentity: renderIdentity, indexSearchBox: indexSearchBox,
    displayName: displayName, fmtDateTime: fmtDateTime, fmtTimeCompact: fmtTimeCompact,
    postMenu: postMenu, notifCacheSet: notifCacheSet,
    topicAdminCorner: topicAdminCorner, buildBoardForm: buildBoardForm,
    boardButtons: boardButtons, armBoardForm: armBoardForm,
    attachMentions: attachMentions, attachDraft: attachDraft, boardPost: boardPost,
    stampFresh: stampFresh,
    goIndex: function () { section.textContent = ''; viewIndex(); },
    /* the post renderer's organs (Wave B3b) */
    fetchRetry: fetchRetry,
    isMuted: isMuted, toggleMute: toggleMute,
    /* the unified member block (2026-08-03): one act = DM shadow-block + hide */
    isBlocked: isBlocked, setBlock: setBlock, appConfirm: appConfirm, BLOCK_CONFIRM: BLOCK_CONFIRM,
    authorNode: authorNode, profileHref: profileHref,
    ADMIN_HASHES: ADMIN_HASHES, MERECAT_BOT_HASH: MERECAT_BOT_HASH,
    setStatus: setStatus, startEdit: startEdit,
    quoteGrab: function (c: any) { quotedSelection = selectionInPost(c); },
    quoteTake: function (c: any, quoteCtx: any) {
      var excerpt = quotedSelection || truncate(c.body, 400);
      quotedSelection = '';
      quoteInto(c, excerpt, permalinkFor(c, quoteCtx));
    },
    /* topic + search views (Wave B4/B5) */
    commentNode: commentNode,
    wallMediaNode: wallMediaNode,   // board attachments in the Lit post renderer
    watchToggle: watchToggle, annotateMeta: annotateMeta,
    searchSnippet: searchSnippet, attachAuthorPicker: attachAuthorPicker,
    /* member read views (Wave C-reads) */
    dmScore: dmScore,
    notifClear: function () { try { localStorage.removeItem(NOTIF_CACHE); } catch (e) {} notifUnreadCheck(); },
    /* profile + inbox read views (Wave C-reads 2) */
    el: el,
    renderProfile: renderProfile, adminProfileEditor: adminProfileEditor,
    loadTurnstile: loadTurnstile,
    dmSearchBox: dmSearchBox, dmLabel: dmLabel,
    dmCacheSet: dmCacheSet, dmUnreadCheck: dmUnreadCheck, markThreadRead: markThreadRead,
    mintIdentity: mintIdentity, loginWithKey: loginWithKey,
    /* admin read/observe cluster (Wave C-reads 3) */
    MERECAT_API: MERECAT_API,
    onProfile: function (cb: any) { profileWaiters.push(cb); },
    /* re-render the current view in place (mute and friends must not force a
       full page reload inside the SPA) */
    reroute: function () { if (BOARD) routeSafe(); else location.reload(); },
    bookmarkToggle: bookmarkToggle,
    /* an app-sheet replacement for window.prompt (suppressed in some in-app
       browsers): resolves the entered string, or null on cancel */
    promptSheet: function (message: string, placeholder?: string) {
      if (!window.mcSheet) return Promise.resolve(window.prompt(message));
      return new Promise(function (resolve: any) {
        var done = false;
        var finish = function (v: any) { if (done) return; done = true; window.mcSheet!.close(); resolve(v); };
        var wrap = el('div', 'mc-confirm');
        wrap.appendChild(el('p', 'mc-confirm-msg', message));
        var ta = el('textarea', 'comment-text');
        ta.rows = 3;
        if (placeholder) ta.placeholder = placeholder;
        wrap.appendChild(ta);
        var row = el('div', 'mc-confirm-row');
        var cancel = el('button', 'mc-confirm-btn mc-confirm-cancel', 'Cancel');
        cancel.type = 'button';
        cancel.addEventListener('click', function () { finish(null); });
        var ok = el('button', 'mc-confirm-btn mc-confirm-ok', 'Send');
        ok.type = 'button';
        ok.addEventListener('click', function () { finish(ta.value); });
        row.appendChild(cancel); row.appendChild(ok);
        wrap.appendChild(row);
        window.mcSheet!.open('', wrap, function () { finish(null); });
        setTimeout(function () { try { ta.focus(); } catch (e) {} }, 60);
      });
    },
  };

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
  }   /* end of mcBoot */

  /* The shell's doors: boot on arriving at a swapped-in page that mounts
     the client, tear down on leaving one. Booting directly also covers the
     ordinary hard load below. */
  window.mcCommentsBoot = mcBoot;
  window.mcCommentsTeardown = function () {
    if (mcDown) { var d = mcDown; mcDown = null; try { d(); } catch (e) { /* torn */ } }
  };
  /* Boot ordering: when the shell is expected (the default), wait for its
     ready signal so the Lit views are registered before the first render —
     a dynamically injected app.js is unordered against this deferred file.
     Since Phase 5 the client reads the kernel UNCONDITIONALLY (window.mcCore),
     so booting before app.js has arrived is not a degraded render — it is a
     TypeError and a permanently blank section. (The old 1.5s "boot classic
     anyway" fallback did exactly that on slow networks and PWA cold starts,
     and its once-only flag meant the section stayed blank even after app.js
     landed.) The rule now: with the shell expected, boot only once the kernel
     stands — listen for mc-shell-ready, poll for a missed signal, re-inject
     app.js once if the bundle looks lost, and after a long horizon with
     nothing to show leave an honest reload note instead of silence. */
  (function () {
    var shellComing = false;
    try { shellComing = localStorage.getItem('mc-app') !== '0'; } catch (e) { shellComing = false; }
    if (!shellComing || window.__mcShellReady || window.mcViews) { mcBoot(); return; }
    var booted = false;
    var attempts = 0;
    function go() {
      if (booted || !window.mcCore || attempts >= 3) return;
      attempts += 1;
      try { mcBoot(); booted = true; }
      catch (e) { /* half-booted: flag stays down so a later signal retries */ }
    }
    document.addEventListener('mc-shell-ready', go);
    var waited = 0;
    var reinjected = false;
    var tick = setInterval(function () {
      waited += 250;
      if (!booted && window.mcCore) go();
      if (booted || attempts >= 3) { clearInterval(tick); noteIfBlank(); return; }
      if (waited >= 8000 && !reinjected && !window.mcCore) {
        /* the bundle looks lost (failed fetch, SW limbo): ask for it once more */
        reinjected = true;
        var prior = document.querySelector('script[src*="app.js"]');
        if (prior && prior.getAttribute('src')) {
          var again = document.createElement('script');
          again.src = prior.getAttribute('src') as string;
          again.defer = true;
          document.head.appendChild(again);
        }
      }
      if (waited >= 45000) { clearInterval(tick); noteIfBlank(); }
    }, 250);
    function noteIfBlank() {
      if (booted) return;
      var sec = document.querySelector('.comments');
      if (sec && !sec.firstChild) {
        var p = document.createElement('p');
        p.textContent = 'The app could not load. Check your connection and reload the page.';
        sec.appendChild(p);
      }
    }
  })();
})();
