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

  /* The scriptorium rank ladder: a member's standing by total live forum posts.
     Thresholds ascend; rankFor returns the highest one reached. The count itself
     rides each post and the profile from the worker (postCountsFor). */
  var RANKS = [
    [0, 'Novice'], [10, 'Apprentice'], [50, 'Scriptorium Hand'], [100, 'Copyist'],
    [250, 'Scribe'], [500, 'Illuminator'], [1000, 'Master Scribe'],
    [2500, 'Keeper of Scrolls'], [5000, 'Treasury of Wisdom']
  ];
  function rankFor(n) {
    n = Number(n) || 0;
    var name = RANKS[0][1];
    for (var i = 0; i < RANKS.length; i++) { if (n >= RANKS[i][0]) name = RANKS[i][1]; }
    return name;
  }
  function rankLine(posts) {
    return rankFor(posts) + ' · ' + posts + (posts === 1 ? ' post' : ' posts');
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
  var EMOJI_PACKS = {
    memes: [['cry','emoji/memes/cry.webp'],['pogging','emoji/memes/pogging.webp'],['bonk','emoji/memes/bonk.webp'],['catkiss','emoji/memes/catkiss.webp'],['crythumbsup','emoji/memes/crythumbsup.webp'],['catjam','emoji/memes/catjam.webp'],['megareverse-1','emoji/memes/megareverse-1.webp'],['shrug','emoji/memes/shrug.webp'],['kekw','emoji/memes/kekw.webp'],['boohoo','emoji/memes/boohoo.webp'],['laughing-hard','emoji/memes/laughing-hard.webp'],['bruh','emoji/memes/bruh.webp'],['pepecringe','emoji/memes/pepecringe.webp'],['kitty-happy','emoji/memes/kitty-happy.webp'],['catsneeze','emoji/memes/catsneeze.webp'],['cutecatstare','emoji/memes/cutecatstare.webp'],['catsmile','emoji/memes/catsmile.webp'],['catstare','emoji/memes/catstare.webp'],['cat-laughing','emoji/memes/cat-laughing.webp'],['soldjacat','emoji/memes/soldjacat.webp'],['crycat','emoji/memes/crycat.webp'],['bingus-shush','emoji/memes/bingus-shush.webp'],['huhcat','emoji/memes/huhcat.webp'],['catno','emoji/memes/catno.webp'],['seriously','emoji/memes/seriously.webp'],['cat-sleep','emoji/memes/cat-sleep.webp'],['crisiscat','emoji/memes/crisiscat.webp'],['huhcat-2','emoji/memes/huhcat-2.webp'],['cat-kiss','emoji/memes/cat-kiss.webp'],['catfunny','emoji/memes/catfunny.webp'],['happy','emoji/memes/happy.webp'],['laughing-cat','emoji/memes/laughing-cat.webp'],['kitty-sad','emoji/memes/kitty-sad.webp']],
    pepe: [['pepecross','emoji/pepe/pepecross.webp'],['pepetyping','emoji/pepe/pepetyping.webp'],['pepeheart','emoji/pepe/pepeheart.webp'],['pepelaugh','emoji/pepe/pepelaugh.webp'],['pepeperfect','emoji/pepe/pepeperfect.webp'],['strongpepe','emoji/pepe/strongpepe.webp'],['pepebanger','emoji/pepe/pepebanger.webp'],['pepeclap','emoji/pepe/pepeclap.webp'],['pepetorchfire','emoji/pepe/pepetorchfire.webp'],['pepeblink','emoji/pepe/pepeblink.webp'],['pepeuwu','emoji/pepe/pepeuwu.webp'],['pepeokay','emoji/pepe/pepeokay.webp'],['pepepug','emoji/pepe/pepepug.webp'],['kingpepe','emoji/pepe/kingpepe.webp'],['kingpepe-2','emoji/pepe/kingpepe-2.webp'],['nou','emoji/pepe/nou.webp'],['peperain','emoji/pepe/peperain.webp'],['peperich','emoji/pepe/peperich.webp'],['pepehacker','emoji/pepe/pepehacker.webp'],['pepeclap-2','emoji/pepe/pepeclap-2.webp'],['pepe-blushy','emoji/pepe/pepe-blushy.webp'],['pepe-sad','emoji/pepe/pepe-sad.webp'],['pepehug','emoji/pepe/pepehug.webp'],['pepe-hehe','emoji/pepe/pepe-hehe.webp'],['pepes','emoji/pepe/pepes.webp'],['sleepypepe','emoji/pepe/sleepypepe.webp'],['pepohappy','emoji/pepe/pepohappy.webp']]
  };
  var CUSTOM_EMOJI = {};
  Object.keys(EMOJI_PACKS).forEach(function (k) {
    EMOJI_PACKS[k].forEach(function (e) { CUSTOM_EMOJI[e[0]] = e[1]; });
  });
  /* Tab 1 of the picker: the common Unicode emoji, inserted as characters and
     stored as UTF-8 like any other text. Split on spaces (no emoji holds one). */
  var STANDARD_EMOJI = ('😀 😃 😄 😁 😆 😅 😂 🤣 🙂 🙃 😉 😊 😇 🥰 😍 🤩 😘 😗 😚 😙 😋 😛 😜 🤪 😝 🤗 🤭 🤫 🤔 🤐 🤨 😐 😑 😶 😏 😒 🙄 😬 😌 😔 😪 🤤 😴 😷 🤒 🤕 🤢 🤮 🤧 🥵 🥶 🥴 😵 🤯 🤠 🥳 😎 🤓 🧐 😕 😟 🙁 😮 😯 😲 😳 🥺 😦 😧 😨 😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 🥱 😤 😡 😠 🤬 😈 👿 💀 💩 🤡 👻 👽 🤖 😺 😸 😹 😻 😼 😽 🙀 😿 😾 👋 🤚 ✋ 🖖 👌 🤌 🤏 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ 👍 👎 ✊ 👊 🤛 🤜 👏 🙌 👐 🤲 🙏 🤝 💪 🖕 ❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 💕 💞 💓 💗 💖 💘 💝 💯 💢 💥 💫 💦 💨 💬 💭 💤 🔥 ⭐ 🌟 ✨ ⚡ 💧 🌈 ☀️ 🎉 🎊 🎁 🏆 🥇 🎯 ✅ ❌ ⭕ ❗ ❓ ⚠️ 🔔 💡 🔑 🔒 🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🙈 🙉 🙊 🐔 🐧 🐦 🦆 🦉 🐺 🐗 🐴 🦄 🐝 🐛 🦋 🐌 🐢 🐍 🐙 🦀 🐟 🐬 🐳 🍎 🍌 🍉 🍇 🍓 🍒 🍑 🍍 🥝 🍅 🥑 🌽 🍄 🍞 🧀 🍔 🍟 🍕 🌭 🌮 🍿 🍩 🍪 🎂 🍰 🍫 🍬 🍭 🍺 🍻 🥂 🍷 ☕ 🍵').split(' ');
  /* Named standard emoji: the subset reachable by a :shortcode:, so the : helper
     and manual typing resolve common names (:fire:, :joy:) to a character, the
     same path custom pack codes take. name/char pairs, char never holding a
     space. A :code: matches a custom image first, then a name here, else stays
     literal text. */
  var NAMED_EMOJI = {};
  ('smile 😄 smiley 😃 grin 😁 laughing 😆 joy 😂 rofl 🤣 sweat_smile 😅 slight_smile 🙂 upside_down 🙃 wink 😉 blush 😊 innocent 😇 heart_eyes 😍 star_struck 🤩 kissing_heart 😘 yum 😋 stuck_out_tongue 😛 zany 🤪 thinking 🤔 shush 🤫 hand_over_mouth 🤭 neutral 😐 expressionless 😑 no_mouth 😶 smirk 😏 unamused 😒 rolling_eyes 🙄 relieved 😌 pensive 😔 sleepy 😪 sleeping 😴 mask 😷 nauseated 🤢 vomiting 🤮 sneeze 🤧 hot 🥵 cold 🥶 dizzy_face 😵 exploding_head 🤯 cowboy 🤠 partying 🥳 sunglasses 😎 nerd 🤓 monocle 🧐 confused 😕 worried 😟 frowning 🙁 open_mouth 😮 astonished 😲 flushed 😳 pleading 🥺 fearful 😨 cold_sweat 😰 cry 😢 sob 😭 scream 😱 confounded 😖 disappointed 😞 weary 😩 tired 😫 yawn 🥱 triumph 😤 rage 😡 angry 😠 cursing 🤬 smiling_imp 😈 imp 👿 skull 💀 poop 💩 clown 🤡 ghost 👻 alien 👽 robot 🤖 wave 👋 ok_hand 👌 v ✌️ crossed_fingers 🤞 love_you 🤟 call_me 🤙 point_up ☝️ thumbsup 👍 thumbsdown 👎 fist ✊ punch 👊 clap 👏 raised_hands 🙌 pray 🙏 handshake 🤝 muscle 💪 middle_finger 🖕 heart ❤️ orange_heart 🧡 yellow_heart 💛 green_heart 💚 blue_heart 💙 purple_heart 💜 black_heart 🖤 broken_heart 💔 two_hearts 💕 sparkling_heart 💖 100 💯 anger 💢 boom 💥 sweat_drops 💦 dash 💨 fire 🔥 star ⭐ star2 🌟 sparkles ✨ zap ⚡ rainbow 🌈 sunny ☀️ tada 🎉 confetti 🎊 gift 🎁 trophy 🏆 dart 🎯 white_check_mark ✅ x ❌ o ⭕ exclamation ❗ question ❓ warning ⚠️ bell 🔔 bulb 💡 key 🔑 lock 🔒 dog 🐶 cat 🐱 mouse 🐭 hamster 🐹 rabbit 🐰 fox 🦊 bear 🐻 panda 🐼 koala 🐨 tiger 🐯 lion 🦁 cow 🐮 pig 🐷 frog 🐸 monkey 🐵 chicken 🐔 penguin 🐧 bird 🐦 unicorn 🦄 bee 🐝 butterfly 🦋 snail 🐌 turtle 🐢 snake 🐍 octopus 🐙 whale 🐳 apple 🍎 banana 🍌 watermelon 🍉 grapes 🍇 strawberry 🍓 cherries 🍒 peach 🍑 avocado 🥑 corn 🌽 mushroom 🍄 bread 🍞 cheese 🧀 hamburger 🍔 fries 🍟 pizza 🍕 hotdog 🌭 taco 🌮 popcorn 🍿 doughnut 🍩 cookie 🍪 cake 🍰 chocolate 🍫 candy 🍬 lollipop 🍭 beer 🍺 beers 🍻 wine 🍷 coffee ☕ tea 🍵').trim().split(/\s+/).forEach(function (tok, i, a) { if (i % 2 === 0) NAMED_EMOJI[tok] = a[i + 1]; });

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
    var map = {}, forms = [];
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

  /* The base inline grammar; the scripture group (book=6, chapter=7, verse=8) is
     appended so a reference becomes a same-site verse link in appendRich. */
  var INLINE_BASE = /\*\*([^\n]+?)\*\*|\*(\S[^*\n]*?)\*|\[([^\]\n]+)\]\((https?:\/\/[^\s<>"')]+)\)|https?:\/\/[^\s<>"']+|:([a-z0-9_+-]{1,40}):/gi;
  var INLINE_MD = new RegExp(INLINE_BASE.source + '|' + BIBLE.src, 'gi');

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
  function authorNode(hash, nick, withSub, faith, posts) {
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
    /* The rank and post count sit under that, when the caller has the count (a
       post or comment). Reuses the muted faith-line styling. */
    if (posts != null) wrap.appendChild(el('span', 'comment-faith comment-rank', rankLine(Number(posts) || 0)));
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
  /* The librarian cannot be muted: it speaks only when summoned, so a muted
     bot would read as a broken summons (a stale stored mute is ignored too). */
  function isMuted(hash) {
    if (hash === MERECAT_BOT_HASH) return false;
    return !!hash && getMuted().indexOf(hash) !== -1;
  }
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

  /* Admin status comes from the server (state.myAdmin, off your own profile).
     Before that profile has loaded the built-in list is only a hint, so a known
     admin's controls are not withheld for a beat; once it loads the server is
     the sole authority, so an admin removed elsewhere loses the controls here
     too. The board re-renders when the answer changes (see loadMyProfile). */
  function isAdmin() {
    if (!state.key) return false;
    if (state.profileLoaded) return state.myAdmin;
    return state.myAdmin || ADMIN_HASHES.indexOf(state.myHash) !== -1;
  }

  /* Callbacks waiting on the reader's own profile fetch, so a view that renders
     before admin status is known can redraw once it lands. */
  var profileWaiters = [];

  /* Guard for an admin-only view. Owners pass at once. If we cannot yet tell (a
     key is present but its profile has not loaded), show a neutral wait and
     redraw when it does, rather than flash a false "not for you". With no key,
     or once the profile is in, the answer is certain. Returns true when the
     caller should stop. */
  function adminGate(rerender) {
    if (isAdmin()) return false;
    if (!state.key || state.profileLoaded) {
      section.appendChild(el('p', 'comments-status', 'This page is for the admins.'));
      return true;
    }
    section.appendChild(el('p', 'comments-status', 'Loading...'));
    if (rerender) profileWaiters.push(function () { section.textContent = ''; rerender(); });
    return true;
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
    myAdmin: false,
    profileLoaded: false,
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
  function emojiToken(code, raw) {
    var c = code.toLowerCase();
    if (CUSTOM_EMOJI[c]) return emojiImg(CUSTOM_EMOJI[c], c);
    if (NAMED_EMOJI[c]) return document.createTextNode(NAMED_EMOJI[c]);
    return document.createTextNode(raw);
  }
  function emojiImg(path, code) {
    ensureEmojiStyles();
    var img = el('img', 'mc-emoji');
    img.src = path;
    img.alt = ':' + code + ':';
    img.title = ':' + code + ':';
    img.loading = 'lazy';
    img.decoding = 'async';
    return img;
  }

  var emojiData = null, emojiDataPromise = null;
  function loadEmojiData() {
    if (emojiDataPromise) return emojiDataPromise;
    emojiDataPromise = fetch('emoji/emoji-data.json').then(function (r) { return r.json(); })
      .then(function (d) {
        var flat = [];
        (d.groups || []).forEach(function (g) { g.e.forEach(function (e) { flat.push({ c: e[0], a: e[1], k: e[2] }); }); });
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
  var avatarPresetsPromise = null;
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
  function emojiSearch(q, limit) {
    q = String(q).toLowerCase();
    if (!q) return [];
    var pre = [], sub = [], seen = {};
    Object.keys(EMOJI_PACKS).forEach(function (pk) {
      EMOJI_PACKS[pk].forEach(function (e) {
        var i = e[0].indexOf(q);
        if (i === 0) pre.push({ kind: 'img', code: e[0], path: e[1] });
        else if (i > 0) sub.push({ kind: 'img', code: e[0], path: e[1] });
      });
    });
    if (emojiData && emojiData.flat.length) {
      emojiData.flat.forEach(function (e) {
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
    var out = [];
    pre.concat(sub).forEach(function (it) {
      var key = it.kind === 'img' ? 'i' + it.code : 'c' + it.char;
      if (seen[key] || out.length >= limit) return;
      seen[key] = 1; out.push(it);
    });
    return out;
  }

  function insertAtCaret(ta, text) {
    var s = ta.value, a = ta.selectionStart, b = ta.selectionEnd;
    ta.value = s.slice(0, a) + text + s.slice(b);
    var np = a + text.length;
    try { ta.setSelectionRange(np, np); } catch (e) {}
    afterEdit(ta);
  }
  function insertEmojiItem(ta, it) {
    insertAtCaret(ta, it.kind === 'img' ? ':' + it.code + ':' : it.char);
  }

  /* The : autocomplete, the sibling of attachMentions: an @ picks a member, a :
     picks an emoji. Triggered by ":" plus a code start at the caret; Enter/Tab or
     tap inserts. Works the same on desktop and mobile. */
  function attachEmoji(textarea) {
    if (!textarea || textarea.dataset.emojiac) return;
    textarea.dataset.emojiac = '1';
    var sug = el('div', 'mention-suggest emoji-suggest');
    sug.hidden = true;
    textarea.parentNode.insertBefore(sug, textarea.nextSibling);
    var current = [], sel = 0, at = -1, timer = null;
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
        r.addEventListener('mousedown', function (e) { e.preventDefault(); pick(it); });
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
    function pick(it) {
      if (at < 0) return;
      var caret = textarea.selectionStart, v = textarea.value;
      var ins = it.kind === 'img' ? ':' + it.code + ':' : it.char;
      textarea.value = v.slice(0, at) + ins + ' ' + v.slice(caret);
      var np = at + ins.length + 1;
      try { textarea.setSelectionRange(np, np); } catch (e) {}
      current = []; at = -1; sug.hidden = true; afterEdit(textarea);
    }
    textarea.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(scan, 100); });
    textarea.addEventListener('keydown', function (e) {
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
  function buildEmojiPanel(textarea) {
    ensureEmojiStyles();
    var panel = el('div', 'emoji-panel');
    panel.hidden = true;
    var search = el('input', 'emoji-search');
    search.type = 'search'; search.placeholder = 'Search emoji...';
    var srow = el('div', 'emoji-search-row'); srow.appendChild(search); panel.appendChild(srow);
    var tabs = el('div', 'emoji-tabs'), body = el('div', 'emoji-body');
    var TABS = [['standard', 'Emoji'], ['memes', 'Memes'], ['pepe', 'Pepe']];
    var active = 'standard', tabBtns = {};
    TABS.forEach(function (t) {
      var b = el('button', 'emoji-tab', t[1]); b.type = 'button';
      b.addEventListener('click', function () { active = t[0]; search.value = ''; mark(); draw(); });
      tabBtns[t[0]] = b; tabs.appendChild(b);
    });
    panel.appendChild(tabs); panel.appendChild(body);
    function mark() { TABS.forEach(function (t) { tabBtns[t[0]].className = 'emoji-tab' + (t[0] === active ? ' emoji-tab-on' : ''); }); }
    function put(it) { insertEmojiItem(textarea, it); textarea.focus(); }
    function cellChar(ch, label) {
      var b = el('button', 'emoji-cell'); b.type = 'button'; b.textContent = ch; b.title = ':' + label + ':';
      b.addEventListener('click', function () { put({ kind: 'char', char: ch }); });
      return b;
    }
    function cellImg(code, path) {
      var b = el('button', 'emoji-cell'); b.type = 'button'; b.title = ':' + code + ':';
      b.appendChild(emojiImg(path, code));
      b.addEventListener('click', function () { put({ kind: 'img', code: code }); });
      return b;
    }
    function gridImgs(pairs) { var g = el('div', 'emoji-grid'); pairs.forEach(function (e) { g.appendChild(cellImg(e[0], e[1])); }); return g; }
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
        emojiData.groups.forEach(function (grp) {
          body.appendChild(el('div', 'emoji-group-head', grp.g));
          var g = el('div', 'emoji-grid');
          grp.e.forEach(function (e) { g.appendChild(cellChar(e[0], e[1])); });
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
  var kjvData = null, kjvPromise = null;
  function loadKjv() {
    if (kjvPromise) return kjvPromise;
    kjvPromise = fetch('kjv.json').then(function (r) { return r.json(); })
      .then(function (d) { kjvData = d; return d; })
      .catch(function () { kjvData = { books: [] }; return kjvData; });
    return kjvPromise;
  }

  /* The Scripture picker: choose a book, chapter, and a verse (or a span of
     verses), and drop the passage into the box as a blockquote with the
     reference — which the renderer then autolinks back to the exact verse. */
  function buildScripturePanel(textarea) {
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

    function opts(sel, n, label) {
      sel.textContent = '';
      for (var i = 1; i <= n; i++) {
        var o = el('option'); o.value = i; o.textContent = label ? label + ' ' + i : i;
        sel.appendChild(o);
      }
    }
    function curBook() { return kjvData.books[bookSel.value ? +bookSel.value - 1 : 0]; }
    function fillBooks() {
      bookSel.textContent = '';
      kjvData.books.forEach(function (b, i) {
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
    bookSel.addEventListener('change', fillChapters);
    chapSel.addEventListener('change', fillVerses);
    v1Sel.addEventListener('change', drawPreview);
    v2Sel.addEventListener('change', drawPreview);
    insert.addEventListener('click', function () {
      insertAtCaret(textarea, passage());
      textarea.focus();
      panel.closePanel();
    });

    panel.openPanel = function () {
      panel.hidden = false;
      if (kjvData) { status.hidden = true; fillBooks(); }
      else {
        status.hidden = false;
        loadKjv().then(function () {
          if (kjvData.books.length) { status.hidden = true; fillBooks(); }
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
  (function scriptureHover() {
    try { if (!window.matchMedia || !window.matchMedia('(hover: hover)').matches) return; } catch (e) { return; }
    var tip = null, slugMap = null, hideTimer = null, CAP = 30;
    function bySlug(slug) {
      if (!slugMap && kjvData) { slugMap = {}; kjvData.books.forEach(function (b) { slugMap[b.slug] = b; }); }
      return slugMap ? slugMap[slug] : null;
    }
    function place(a) {
      var r = a.getBoundingClientRect();
      tip.style.left = Math.max(6, Math.min(r.left, window.innerWidth - tip.offsetWidth - 10)) + 'px';
      var below = r.bottom + 8;
      if (below + tip.offsetHeight > window.innerHeight && r.top - tip.offsetHeight - 8 > 0)
        tip.style.top = (r.top - tip.offsetHeight - 8) + 'px';
      else tip.style.top = below + 'px';
    }
    function show(a) {
      loadKjv().then(function () {
        var b = bySlug(a.getAttribute('data-slug')); if (!b) return;
        var c = +a.getAttribute('data-ch'), ch = b.chapters[c - 1]; if (!ch) return;
        var v1 = +a.getAttribute('data-v1'), v2 = +a.getAttribute('data-v2');
        if (!tip) { tip = el('div', 'scripture-tip'); document.body.appendChild(tip); }
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
        place(a);
      });
    }
    document.addEventListener('mouseover', function (e) {
      var a = e.target && e.target.closest && e.target.closest('a.scripture-link');
      if (!a) return;
      clearTimeout(hideTimer);
      show(a);
    });
    document.addEventListener('mouseout', function (e) {
      var a = e.target && e.target.closest && e.target.closest('a.scripture-link');
      if (!a) return;
      hideTimer = setTimeout(function () { if (tip) tip.hidden = true; }, 160);
    });
  })();

  /* The avatar preset gallery: the same panel chrome as the emoji picker (search
     box, pack tabs, inner-scrolling grid), but each tile is a bigger image on the
     parchment tile so it previews the avatar it will become. onPick(path, name)
     fires with the chosen image. The manifest loads lazily on first open. */
  function buildAvatarGallery(onPick) {
    ensureEmojiStyles();
    var panel = el('div', 'emoji-panel av-panel');
    panel.hidden = true;
    var search = el('input', 'emoji-search');
    search.type = 'search'; search.placeholder = 'Search avatars...';
    var srow = el('div', 'emoji-search-row'); srow.appendChild(search); panel.appendChild(srow);
    var tabs = el('div', 'emoji-tabs'), body = el('div', 'emoji-body av-body');
    panel.appendChild(tabs); panel.appendChild(body);
    var packs = null, active = null, tabBtns = {};
    function tile(name, path) {
      var b = el('button', 'emoji-cell av-cell'); b.type = 'button'; b.title = name;
      var im = el('img'); im.src = path; im.alt = name; im.loading = 'lazy';
      b.appendChild(im);
      b.addEventListener('click', function () { onPick(path, name); });
      return b;
    }
    function grid(items) { var g = el('div', 'emoji-grid av-grid'); items.forEach(function (it) { g.appendChild(tile(it[0], it[1])); }); return g; }
    function mark() { if (packs) packs.forEach(function (p) { tabBtns[p.slug].className = 'emoji-tab' + (p.slug === active ? ' emoji-tab-on' : ''); }); }
    function draw() {
      body.textContent = '';
      if (!packs) { body.appendChild(el('p', 'emoji-empty', 'Loading gallery...')); return; }
      var q = search.value.trim().toLowerCase();
      if (q) {
        var res = [];
        packs.forEach(function (p) { p.items.forEach(function (it) { if (it[0].indexOf(q) !== -1) res.push(it); }); });
        if (!res.length) { body.appendChild(el('p', 'emoji-empty', 'No matches.')); return; }
        body.appendChild(grid(res.slice(0, 300)));
        return;
      }
      var pack = null;
      packs.forEach(function (p) { if (p.slug === active) pack = p; });
      if (pack) body.appendChild(grid(pack.items));
    }
    function build() {
      tabs.textContent = '';
      packs.forEach(function (p) {
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
        loadAvatarPresets().then(function (pk) { packs = pk; build(); })
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
    if (document.getElementById('mc-emoji-css')) return;
    var css = '' +
      '.mc-emoji{height:1.35em;width:auto;vertical-align:-0.28em;margin:0 .04em}' +
      '.emoji-suggest{max-height:15em;overflow-y:auto}' +
      'a.emoji-suggest-row{align-items:center}' +
      '.emoji-suggest-glyph{display:inline-flex;align-items:center;justify-content:center;min-width:1.6em;font-size:1.15rem}' +
      '.emoji-suggest-glyph .mc-emoji{height:1.4em}' +
      '.emoji-panel{margin:.45em 0 0;border:1px solid var(--rule);border-radius:8px;background:#fff;box-shadow:0 2px 10px rgba(0,0,0,.08);overflow:hidden}' +
      '.emoji-search-row{padding:.5em;border-bottom:1px solid var(--rule)}' +
      '.emoji-search{width:100%;box-sizing:border-box;padding:.4em .6em;border:1px solid var(--rule);border-radius:6px;font:inherit}' +
      '.emoji-tabs{display:flex;gap:.3em;flex-wrap:wrap;padding:.45em .5em 0}' +
      '.emoji-tab{font:inherit;font-size:.92rem;padding:.25em .8em;border:1px solid var(--rule);border-bottom:none;border-radius:6px 6px 0 0;background:#f7f1e3;color:var(--faint);cursor:pointer}' +
      '.emoji-tab-on{background:#fff;color:var(--maroon);font-weight:600}' +
      '.emoji-body{max-height:15em;overflow-y:auto;padding:.4em .5em .6em}' +
      '.emoji-group-head{position:sticky;top:0;background:#fff;color:var(--faint);font-size:.75rem;text-transform:uppercase;letter-spacing:.04em;padding:.4em .15em .2em}' +
      '.emoji-grid{display:flex;flex-wrap:wrap;gap:.1em}' +
      '.emoji-cell{width:2em;height:2em;display:inline-flex;align-items:center;justify-content:center;border:none;background:none;border-radius:6px;cursor:pointer;font-size:1.25rem;line-height:1;padding:0}' +
      '.emoji-cell:hover{background:#f9f3e6}' +
      '.emoji-cell .mc-emoji{height:1.5em}' +
      '.emoji-empty{color:var(--faint);padding:.5em;margin:0}' +
      '.av-body{max-height:17em}' +
      '.av-grid{gap:.35em}' +
      '.av-cell{width:3em;height:3em;padding:2px;border:1px solid var(--rule);background:#faf6ee;border-radius:8px}' +
      '.av-cell:hover{background:#f2e7d0;border-color:var(--maroon)}' +
      '.av-cell img{max-width:100%;max-height:100%;width:auto;height:auto;object-fit:contain;display:block;margin:0}' +
      '.btn-gallery{display:inline-block;margin:.15em 0 .1em}' +
      /* Scripture picker + autolink + hover preview */
      '.scripture-panel{padding:.6em}' +
      '.scripture-row{display:flex;flex-wrap:wrap;align-items:center;gap:.25em}' +
      '.scripture-sel{font:inherit;font-size:.95rem;padding:.15em .3em;border:1px solid var(--rule);border-radius:5px;background:#faf6ee;color:var(--ink);max-width:14em}' +
      '.scripture-sel-sm{max-width:6em}' +
      '.scripture-colon,.scripture-dash{color:var(--faint);padding:0 .05em}' +
      '.scripture-status{color:var(--faint);font-size:.9rem;padding:.4em 0}' +
      '.scripture-preview{margin:.6em 0;padding:.4em .7em;border-left:3px solid var(--rule);color:var(--ink-soft);font-size:.95rem;max-height:9em;overflow:auto}' +
      '.scripture-insert{font:inherit;cursor:pointer;margin-top:.3em;padding:.3em .8em;border:1px solid var(--maroon);border-radius:6px;background:var(--maroon);color:#faf6ee}' +
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
      '.btn-preview:hover{background:var(--maroon);color:#fff}' +
      '.btn-preview:disabled{opacity:.6;cursor:default}' +
      '@media (max-width:620px){.emoji-body,.emoji-suggest{max-height:40vh}.emoji-cell{width:2.4em;height:2.4em;font-size:1.45rem}.av-cell{width:3.4em;height:3.4em}.scripture-sel{max-width:9em}}';
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

  function draftRead(ctx) {
    try {
      var d = JSON.parse(localStorage.getItem(DRAFT_NS + ctx));
      return d && typeof d.body === 'string' ? d : null;
    } catch (e) { return null; }
  }

  function draftClear(ctx) {
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
        try { d = JSON.parse(localStorage.getItem(k)); } catch (e2) {}
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
  function attachDraft(ta, ctx, titleInput, overwrite) {
    var muted = false;
    var timer = null;
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
    });
    addEventListener('pagehide', save);
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
  function mdEditor(textarea, titleInput) {
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
    var pvBox = null;
    var pvBtns = [];
    textarea.mcPreview = {
      active: false,
      bind: function (btn) {
        pvBtns.push(btn);
        btn.textContent = this.active ? 'Edit' : 'Preview';
      },
      toggle: function () { this.set(!this.active); },
      off: function () { this.set(false); },
      set: function (on) {
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
  function previewButton(ta) {
    if (!ta || !ta.mcPreview) return null;
    var btn = el('button', 'btn btn-preview', 'Preview');
    btn.type = 'button';
    btn.title = 'Read the post as it will look';
    btn.addEventListener('click', function () { ta.mcPreview.toggle(); });
    ta.mcPreview.bind(btn);
    return btn;
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
    var author = authorNode(c.author_hash, c.nick, true, c.faith, c.posts);
    author.setAttribute('itemprop', 'author');
    head.appendChild(author);
    /* The house speaks under its own colors. */
    if (c.author_hash && ADMIN_HASHES.indexOf(c.author_hash) !== -1) {
      head.appendChild(el('span', 'comment-admin', '(admin)'));
    }
    /* A door to a private word with the author, for keyed readers only.
       The librarian holds no inbox: its posts carry no DM link. */
    if (c.author_hash && state.myHash && c.author_hash !== state.myHash &&
        c.author_hash !== MERECAT_BOT_HASH) {
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
      /* Members flag a post for the moderators; admins act directly and don't
         see this. Reporting never hides the post — it only queues it for review. */
      if (!isAdmin()) {
        var reportLink = el('a', 'comment-quote-link', 'report');
        reportLink.href = '#';
        reportLink.title = 'Report this post to the moderators';
        reportLink.addEventListener('click', function (e) {
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
        head.appendChild(reportLink);
      }
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
    if (state.myHash && (c.author_hash === state.myHash || isAdmin())) {
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
    ta.rows = 5;
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
    if (!isAdmin()) return;
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
      /* First line: where to go, grouped — your activity (the two badge feeds),
         then people (you, then the roster), then search over it all. */
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
      line.appendChild(document.createTextNode(' · '));
      var merecatLink = el('a', 'identity-action', '🐈 merecat');
      merecatLink.href = 'community.html?merecat=1';
      merecatLink.title = 'Ask the librarian';
      line.appendChild(merecatLink);
      line.appendChild(document.createTextNode(' · '));
      /* Same line now: who you are, then the account actions, after the nav. */
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
    /* Scoped to the form: an open edit box in the list also wears
       .comment-text, and the first match must not win. */
    var textarea = section.querySelector('.comment-form .comment-text');
    var status = section.querySelector('.form-status');
    var body = textarea.value.replace(/\s+$/, '');
    if (!body.trim()) {
      if (textarea.mcPreview) textarea.mcPreview.off();
      textarea.focus();
      return;
    }
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
      if (textarea.mcDraftDone) textarea.mcDraftDone();
      if (textarea.mcPreview) textarea.mcPreview.off();
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
    /* A muted word on who we are, for the newcomer who lands here. One paragraph. */
    var introP = el('p', 'board-intro');
    introP.appendChild(el('small', null,
      'A board for exploring what it means to be merely catholic. ' +
      'If you hold the Nicene Creed you are welcome. Or if you are a seeker, or if you keep one of the old pre-Christian Indo-European ways, you are also welcome as our guest in the conversation. ' +
      'This is not a forum for debating non-Christian religions, or atheism / agnosticism. Comparative religion discussion is welcome from a Christian perspective.'));
    section.appendChild(introP);
    /* The identity drawer lives on the front page too, so a reader can
       create, show, or swap a key before ever entering a room. */
    section.appendChild(el('div', 'comment-identity'));
    var keyBox = el('div', 'key-box');
    keyBox.hidden = true;
    section.appendChild(keyBox);
    renderIdentity();
    /* Admins alone see the door to the console. The server would refuse anyone
       else anyway, so hiding it is courtesy, not the lock. One link now, to a
       page that gathers the audit, the IP bans, and the admin roster. */
    var auditSlot = el('p', 'board-audit-link');
    function ensureAuditLink() {
      auditSlot.textContent = '';
      if (!isAdmin()) return;
      var a = el('a', 'identity-action', 'Administrative options');
      a.href = 'community.html?admin=1';
      auditSlot.appendChild(a);
    }
    ensureAuditLink();
    new MutationObserver(ensureAuditLink)
      .observe(section.querySelector('.comment-identity'), { childList: true });
    /* Search is a members' feature, so the box only shows once you are logged in. */
    if (state.key && state.myHash) section.appendChild(indexSearchBox());
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

  /* The full admin corner for one topic: a Move dropdown plus sticky, lock, and
     delete. Shared by the category listing and the moderation console, so a topic
     is governed the same way wherever it shows. `curCat` is the topic's own
     category key, greyed in the Move list. Every act reloads the view on success. */
  function topicAdminCorner(topic, curCat) {
    var admin = el('span', 'board-admin-links board-admin-corner');
    var moveSel = el('select', 'board-move');
    var movePh = el('option', null, 'Move'); movePh.value = ''; moveSel.appendChild(movePh);
    CATS.forEach(function (c) {
      var o = el('option', null, c[1]); o.value = c[0];
      if (c[0] === curCat) o.disabled = true;
      moveSel.appendChild(o);
    });
    moveSel.addEventListener('change', function () {
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
    });
    admin.appendChild(moveSel);
    admin.appendChild(document.createTextNode(' '));
    admin.appendChild(modLinkEl(topic.id, topic.sticky ? 'unsticky' : 'sticky', topic.sticky ? '(unsticky)' : '(sticky)'));
    admin.appendChild(document.createTextNode(' '));
    admin.appendChild(modLinkEl(topic.id, topic.locked ? 'unlock' : 'lock', topic.locked ? '(unlock)' : '(lock)'));
    admin.appendChild(document.createTextNode(' '));
    admin.appendChild(modLinkEl(topic.id, 'delete', '(delete)'));
    return admin;
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
          if (isAdmin()) row.appendChild(topicAdminCorner(t, key));
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
        /* Opening a thread marks it read for the "new since last visit" state
           AND reads its notifications — however you got here. The reply's
           fresh unread count corrects the badge on this very page. */
        if (state.key) {
          fetch(API + '/board/read', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: state.key, topic: d.topic.id }),
          }).then(function (r) { return r.json(); })
            .then(function (rd) {
              if (rd && rd.ok && typeof rd.notif_unread === 'number') notifCacheSet(rd.notif_unread);
            })
            .catch(function () {});
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
  /* The moderation console. Three actionable sections — reported posts, the
     review queue, and recent activity — each row governable in place, so an
     admin never has to leave to act. The in-context controls on the board stay;
     this is the one place that gathers everything waiting on a moderator. */
  /* The admin hub: one door from the board that gathers the three admin pages,
     so a member of staff picks a task rather than hunting scattered links. */
  function viewAdminHome() {
    document.title = 'Administrative options | Catholicity Board';
    crumb([['Catholicity Board', 'community.html'], ['Administrative options']]);
    if (adminGate(viewAdminHome)) return;
    section.appendChild(el('p', 'board-intro',
      'Everything that governs the board sits behind these doors. Each is admin-only, here and at the server.'));
    var wrap = el('div', 'board-cats');
    [
      ['Activity audit', 'community.html?audit=1', 'Reported posts, the review queue, and the last two weeks of activity, every row actionable.'],
      ['IP ban list', 'community.html?ipbans=1', 'Every banned address, added and removed by hand.'],
      ['Add / Remove Admins', 'community.html?admins=1', 'Grant a member admin powers, or take them back.'],
      ['merecat administration', 'community.html?merecatadmin=1', 'The librarian’s dials: the per-member daily cap, on or off, and how many.']
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

  /* Add or remove admins. Owners (set in the worker config) show as permanent;
     everyone else carries a (remove). Adding is by the same @-mention picker as
     the rest of the site: type a name, pick a member, add. */
  function viewAdmins() {
    document.title = 'Add / Remove Admins | Catholicity Board';
    crumb([['Catholicity Board', 'community.html'], ['Administrative options', 'community.html?admin=1'], ['Add / Remove Admins']]);
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
          d.admins.forEach(function (a) {
            var r = el('div', 'board-topic');
            var mine = a.hash === state.myHash;
            var who = el('a', 'board-topic-title', (a.nick || a.assigned) + (mine ? ' (you)' : ''));
            who.href = profileHref(a.hash);
            r.appendChild(who);
            var rm = el('a', 'trust-toggle', '(remove)');
            rm.href = '#';
            rm.addEventListener('click', function (e) {
              e.preventDefault();
              if (!confirm(mine
                ? 'Remove your own admin powers? You will lose admin access here.'
                : 'Remove admin powers from ' + (a.nick || a.assigned) + '?')) return;
              fetch(API + '/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key: state.key, hash: a.hash, admin: false }) })
                .then(function (x) { return x.json(); })
                /* Removing yourself ends your access, so leave for the board as a
                   plain member rather than reload a list you can no longer see. */
                .then(function (x) { if (x.ok) { if (mine) { location.href = 'community.html'; } else { load(); } } else { addNote.textContent = x.error || 'Could not remove.'; } })
                .catch(function () { addNote.textContent = 'Network error. Try again.'; });
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
    document.title = 'Activity audit | Catholicity Board';
    crumb([['Catholicity Board', 'community.html'], ['Administrative options', 'community.html?admin=1'], ['Activity audit']]);
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
    function deleteCommentLink(id, row) {
      var a = el('a', 'trust-toggle danger', '(delete)');
      a.href = '#';
      a.addEventListener('click', function (e) {
        e.preventDefault();
        if (!confirm('Delete this post?')) return;
        fetch(API + '/delete', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: state.key, id: id }),
        }).then(function (r) { return r.json(); }).then(function (r) { if (r.ok) row.remove(); }).catch(function () {});
      });
      return a;
    }
    /* A lazy admin drawer for the row's author: the same fingerprint panel as the
       fingerprint dropdown, fetched only when opened (no /meta per row up front). */
    function authorDrawerLink(hash, host) {
      var a = el('a', 'trust-toggle', '(author ▾)');
      a.href = '#';
      a.addEventListener('click', function (e) {
        e.preventDefault();
        annotateProfileMeta(hash, host);
      });
      return a;
    }
    /* One activity/reported row with its actions: a topic head gets the full
       topic corner (move/sticky/lock/delete); any other post gets a plain delete.
       Every row gets a lazy author drawer, and callers may prepend more via
       extraActs(actsEl, rowEl). */
    function actionRow(linkUrl, where, r, extraActs) {
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
    renderPending(function (n) { counts.pending = n; renderSummary(); });

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
        reports.forEach(function (r) {
          var isForum = String(r.page).indexOf('board:') === 0;
          var where = isForum
            ? ((catByKey(String(r.page).slice(6)) || [])[1] || r.page) + (r.title ? ' › ' + r.title : '')
            : r.page;
          var linkUrl = isForum
            ? 'community.html?topic=' + r.topic_id + '#comment-' + r.id
            : r.page + '#comment-' + r.id;
          var row = actionRow(linkUrl, where, r, function (acts, line) {
            /* Dismiss clears this post's flags but leaves the post itself. */
            var dis = el('a', 'trust-toggle', '(dismiss)');
            dis.href = '#';
            dis.addEventListener('click', function (e) {
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
        d.pages.forEach(function (r) {
          pagesBox.appendChild(actionRow(r.page + '#comment-' + r.id, r.page, r));
        });
        pagesScroll.appendChild(pagesBox);
        section.appendChild(pagesScroll);

        section.appendChild(el('h3', 'board-form-head', 'Forums · last ' + days + ' days'));
        var topicsScroll = el('div', 'audit-scroll');
        var topicsBox = el('div', 'board-topics');
        if (!d.topics.length) topicsBox.appendChild(el('p', 'comments-status', 'No recent forum posts.'));
        d.topics.forEach(function (r) {
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
  function renderPending(onCount) {
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
        if (onCount) onCount(d.pending.length);
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
      .catch(function () { if (onCount) onCount(0); box.textContent = ''; box.appendChild(el('p', 'comments-status', 'The pending queue could not be loaded.')); });
  }

  /* The admin IP-ban list: add or remove IPv4/IPv6 entries by hand, beside the
     one-click bans from the fingerprint dropdown. */
  function viewIpBans() {
    document.title = 'IP ban list | Catholicity Board';
    crumb([['Catholicity Board', 'community.html'], ['Administrative options', 'community.html?admin=1'], ['IP ban list']]);
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
    card.appendChild(el('h3', 'profile-label', 'Recent posts'));
    var wrap = el('div', 'profile-posts');
    card.appendChild(wrap);
    /* Deferred behind a click: a profile view costs no worker call for the post
       history unless the reader actually asks to see it. */
    var reveal = el('a', 'identity-action', 'Show recent posts');
    reveal.href = '#';
    wrap.appendChild(reveal);
    reveal.addEventListener('click', function (e) {
      e.preventDefault();
      reveal.remove();
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
    });
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
    /* Standing on the board: the total post count and the rank it earns. */
    if (p.posts != null) names.appendChild(el('div', 'profile-faith profile-rank', rankLine(Number(p.posts) || 0)));
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
      /* The librarian gets neither door: no DMs (it holds no inbox) and no
         mute (it speaks only when summoned). */
      if (p.hash !== MERECAT_BOT_HASH) {
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
    function pushAvatar(img, mode) {
      var iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
      if (!iw || !ih) { avNote.textContent = 'That image could not be read. Try another.'; return; }
      var c = document.createElement('canvas');
      c.width = 400;
      c.height = 400;
      var ctx = c.getContext('2d');
      if (mode === 'contain') {
        ctx.fillStyle = '#faf6ee';
        ctx.fillRect(0, 0, 400, 400);
        var box = 400 * 0.82;
        var s = Math.min(box / iw, box / ih);
        var cw = iw * s, ch = ih * s;
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, (400 - cw) / 2, (400 - ch) / 2, cw, ch);
      } else {
        var scale = Math.max(400 / iw, 400 / ih);
        var w = iw * scale, h = ih * scale;
        ctx.drawImage(img, (400 - w) / 2, (400 - h) / 2, w, h);
      }
      /* JPEG, so the stored bytes decode cleanly for both the AI vision screen
         and every browser; a lower-quality second pass is the net for the rare
         frame that overruns the cap. */
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
    var gallery = buildAvatarGallery(function (path) {
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
      'Upload a JPEG (cropped square to 400 by 400 pixels, 500 KB at most) or pick a ready-made from the gallery. ' +
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
        r.addEventListener('mousedown', function (e) { e.preventDefault(); pick(u); });
        sug.appendChild(r);
      });
      sug.hidden = false;
    }
    function pick(u) {
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
  function attachAuthorPicker(input, actionLabel) {
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
        r.appendChild(el('span', 'dm-suggest-go', actionLabel || 'filter'));
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
    /* Search is for logged-in members only. A logged-out visitor who lands on a
       shared ?q= link is told to log in rather than shown the search UI. */
    if (!(state.key && state.myHash)) {
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
      '.merecat-about{border:1px solid var(--rule);border-radius:6px;background:var(--surface);margin:.6rem 0;padding:.1rem .9rem}' +
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
      '.merecat-quota{color:var(--faint);font-size:.85rem;margin:.15rem 0 .9rem}' +
      '.merecat-persona-edit{width:100%;min-height:26em;font:inherit;font-size:.9rem;color:var(--ink);background:var(--surface);border:1px solid var(--rule);border-radius:6px;padding:.6rem .7rem;margin:.4rem 0;resize:vertical;white-space:pre-wrap}' +
      '.merecat-quota strong{color:var(--maroon)}' +
      '@media (max-width:620px){.merecat-msg{max-width:100%}.merecat-form{flex-direction:column;align-items:stretch}}';
    var st = el('style');
    st.id = 'mc-merecat-css';
    st.textContent = css;
    document.head.appendChild(st);
  }

  function viewMerecat() {
    document.title = 'Ask Merecat AI | Mere Catholicity';
    crumb([['Catholicity Board', 'community.html'], ['merecat']]);
    /* The page is open to everyone; asking needs a free identity, made in
       one click right above the question box. */
    var loggedIn = !!(state.key && state.myHash);
    ensureMerecatStyles();

    var intro = el('div', 'merecat-intro');
    intro.appendChild(el('span', 'merecat-cat', '🐈'));
    var ib = el('div');
    var p1 = el('p');
    p1.appendChild(el('strong', null, 'merecat'));
    p1.appendChild(document.createTextNode(
      ' is the Mere Catholicity community’s own dedicated AI assistant, the librarian of the whole shelf. Ask a real research question and it answers from the Library itself, the book, the papers, the Fathers, the councils, the Scriptures, and Newman entire, citing the exact paragraphs it stands on.'));
    ib.appendChild(p1);
    ib.appendChild(el('p', null,
      'It is one of the first dedicated Christian AIs in existence, and it is built on a different idea: not an oracle that guesses, but a librarian with a library, grounded in the vast resources this site hosts, every answer carrying its sources as links you can check. The whole community shares one free daily budget, shown beneath the question box.'));
    intro.appendChild(ib);
    section.appendChild(intro);

    /* Full disclosure, one toggle away: how the bot is assembled, what is on
       its shelf right now, exactly how it is biased (the standing
       instructions shown verbatim), what it remembers, and today's usage.
       The live facts load from /about on first open. */
    var about = el('details', 'merecat-about');
    about.appendChild(el('summary', null,
      'How merecat works: what it knows, how it is biased, and what it remembers'));
    var aBody = el('div', 'merecat-about-body');
    about.appendChild(aBody);
    var aboutLoaded = false;
    about.addEventListener('toggle', function () {
      if (!about.open || aboutLoaded) return;
      aboutLoaded = true;
      aBody.textContent = 'Fetching the full account…';
      fetch(MERECAT_API + '/about', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: state.key }),
      }).then(function (r) { return r.json(); })
        .then(function (d) { renderMerecatAbout(aBody, d && d.ok ? d : null); })
        .catch(function () { renderMerecatAbout(aBody, null); });
    });
    section.appendChild(about);

    /* Saved conversations, the DM idiom: each thread keeps for thirty days
       from its last message, owner-keyed, deletable at once. Arriving with
       ?chat=<id> reopens a thread, and a fresh question mints one whose id
       the answer's preamble carries back. */
    var chatId = Number(new URLSearchParams(location.search).get('chat')) || 0;

    var past = el('details', 'merecat-about');
    if (!loggedIn) past.hidden = true;
    past.appendChild(el('summary', null, 'Past conversations (kept thirty days)'));
    var pastBody = el('div', 'merecat-about-body');
    past.appendChild(pastBody);
    var pastLoaded = false;
    past.addEventListener('toggle', function () {
      if (!past.open || pastLoaded) return;
      pastLoaded = true;
      pastBody.textContent = 'Loading…';
      fetchRetry(MERECAT_API + '/chats', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: state.key }),
      }, [1000, 3000]).then(function (r) { return r.json(); }).then(function (d) {
        if (blockedOut(d)) return;
        pastBody.textContent = '';
        if (!d.ok || !d.chats || !d.chats.length) {
          pastBody.appendChild(el('p', null, 'No saved conversations yet. Threads appear here as you ask, and expire thirty days after their last message.'));
          return;
        }
        d.chats.forEach(function (c) {
          var row = el('p');
          var a = el('a', 'body-link', c.title || ('Conversation ' + c.id));
          a.href = 'community.html?merecat=1&chat=' + c.id;
          row.appendChild(a);
          row.appendChild(document.createTextNode(
            ' · ' + c.msgs + (c.msgs === 1 ? ' message · ' : ' messages · ') +
            new Date(c.last_at * 1000).toLocaleDateString() + ' · '));
          var del = el('a', 'body-link', 'delete');
          del.href = '#';
          del.addEventListener('click', function (e) {
            e.preventDefault();
            if (!confirm('Delete this conversation outright? There is no undo.')) return;
            fetchRetry(MERECAT_API + '/chat/delete', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ key: state.key, id: c.id }),
            }, [1000]).then(function (r) { return r.json(); }).then(function (dd) {
              if (dd.ok) {
                row.remove();
                if (c.id === chatId) location.href = 'community.html?merecat=1';
              }
            }).catch(function () {});
          });
          row.appendChild(del);
          pastBody.appendChild(row);
        });
      }).catch(function () { pastBody.textContent = 'Could not load the list. Reopen to retry.'; });
    });
    section.appendChild(past);

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
    if (!loggedIn) {
      q.disabled = true;
      send.disabled = true;
      q.placeholder = 'Create your free identity above, and ask away…';
    }

    /* The quota line: always visible so a member can ration for the
       community's sake, refreshed from /usage on open and from every
       answer's preamble. Admins read their true count against the cap
       they are allowed to pass. */
    var quota = el('p', 'merecat-quota');
    section.appendChild(quota);
    function renderQuota(u) {
      if (!u) return;
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

    function bubble(who) {
      var m = el('div', 'merecat-msg ' + (who === 'you' ? 'you' : 'cat'));
      m.appendChild(el('div', 'merecat-who', who === 'you'
        ? (state.myNick || displayName(state.myHash))
        : '🐈 merecat'));
      var body = el('div', 'merecat-body');
      m.appendChild(body);
      log.appendChild(m);
      m.scrollIntoView({ block: 'nearest' });
      return { msg: m, body: body };
    }

    /* Only the sources the answer actually cited make the footer, and the
       body's [n] markers renumber with it to a clean 1..k in order of first
       appearance — the model reads its full list, the reader gets a tidy
       one. The same helper runs at stream-finish and at thread-reopen, so a
       saved conversation reads back exactly as it streamed. */
    function citeRenumber(text, sources) {
      text = String(text || '');
      if (!sources || !sources.length) return { text: text, sources: [] };
      var firstAt = {};
      text.replace(/\[(\d+)\]/g, function (m, n, at) {
        var num = Number(n);
        var known = sources.some(function (s) { return s.n === num; });
        if (known && firstAt[num] === undefined) firstAt[num] = at;
        return m;
      });
      var order = Object.keys(firstAt).map(Number).sort(function (a, b) { return firstAt[a] - firstAt[b]; });
      if (!order.length) return { text: text, sources: [] };
      var renum = {};
      order.forEach(function (n, i) { renum[n] = i + 1; });
      var out = text.replace(/\[(\d+)\]/g, function (m, n) {
        return renum[Number(n)] ? '[' + renum[Number(n)] + ']' : m;
      });
      var used = sources.filter(function (s) { return renum[s.n]; })
        .map(function (s) { return { n: renum[s.n], title: s.title, heading: s.heading, url: s.url }; })
        .sort(function (a, b) { return a.n - b.n; });
      return { text: out, sources: used };
    }

    /* Forward one answer to a public topic: the owner's choice alone. The
       post goes up under the librarian's name, marked forwarded-by, so bot
       words never wear a member's face. */
    function attachForward(bubbleMsg, msgSel) {
      if (!state.key) return;
      var whoDiv = bubbleMsg.querySelector('.merecat-who');
      if (!whoDiv) return;
      whoDiv.appendChild(document.createTextNode(' · '));
      var f = el('a', 'identity-action', 'forward to the board');
      f.href = '#';
      f.addEventListener('click', function (e) {
        e.preventDefault();
        if (!chatId) return;
        var t = prompt('Forward this answer publicly into which topic? Paste the topic link, or just its number:');
        if (!t) return;
        var m = /(?:topic=)?(\d+)/.exec(t.trim());
        if (!m) { alert('Could not read a topic number from that.'); return; }
        var topicId = Number(m[1]);
        if (!confirm('Post this answer publicly to topic #' + topicId + ', under the librarian\u2019s name, marked as forwarded by you?')) return;
        f.textContent = 'forwarding\u2026';
        fetchRetry(MERECAT_API + '/forward', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: state.key, chat: chatId, msg: msgSel, topic: topicId }),
        }, [1000]).then(function (r) { return r.json(); }).then(function (d) {
          if (d.ok) {
            var v = el('a', 'identity-action', 'forwarded \u2713 view it');
            v.href = 'community.html?topic=' + d.topic + '#comment-' + d.id;
            whoDiv.replaceChild(v, f);
          } else {
            f.textContent = d.error || 'forward failed';
            setTimeout(function () { f.textContent = 'forward to the board'; }, 3000);
          }
        }).catch(function () { f.textContent = 'forward to the board'; alert('Network hiccup. Try again.'); });
      });
      whoDiv.appendChild(f);
    }

    function srcFooter(node, sources) {
      if (!sources || !sources.length) return;
      var f = el('div', 'merecat-srcs');
      f.appendChild(el('strong', null, 'Sources: '));
      sources.forEach(function (s) {
        var a = el('a', 'body-link',
          '[' + s.n + '] ' + s.title + (s.heading ? ' — ' + s.heading : ''));
        a.href = s.url;
        f.appendChild(a);
      });
      node.appendChild(f);
    }

    function ask(text) {
      bubble('you').body.textContent = text;
      var cat = bubble('cat');
      cat.body.appendChild(el('span', 'merecat-wait', '…the librarian is looking…'));
      send.disabled = true;
      var payload = { key: state.key, q: text, chat: chatId || 0 };
      fetch(MERECAT_API + '/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).then(function (res) {
        var ct = res.headers.get('Content-Type') || '';
        if (ct.indexOf('application/json') !== -1) {
          /* A refusal: rate limit, daily caps, resting, or a blocked key. */
          return res.json().then(function (d) {
            if (blockedOut(d)) return;
            cat.body.textContent = '';
            cat.body.appendChild(el('span', 'merecat-note',
              (d.resting ? '🐈 ' : '') + (d.error || 'merecat could not answer. Try again shortly.') +
              (d.resting || d.capped ? ' That is ' + merecatResetLocal() + ' your time.' : '')));
          });
        }
        var reader = res.body.getReader();
        var dec = new TextDecoder();
        var pre = '', acc = '', sources = null;
        function finish() {
          acc = acc.replace(/\s+$/, '');
          cat.body.textContent = '';
          if (acc) {
            var rr = citeRenumber(acc, sources);
            fillBody(cat.body, rr.text);
            srcFooter(cat.body, rr.sources);
            attachForward(cat.msg, 'last');
          } else {
            cat.body.appendChild(el('span', 'merecat-note', 'merecat had nothing to say. Try rephrasing.'));
          }
          cat.msg.scrollIntoView({ block: 'nearest' });
        }
        function pump() {
          return reader.read().then(function (r) {
            if (r.done) { finish(); return; }
            var chunk = dec.decode(r.value, { stream: true });
            if (sources === null) {
              pre += chunk;
              var cut = pre.indexOf('\n\n');
              if (cut === -1) return pump();
              var head = {};
              try { head = JSON.parse(pre.slice(0, cut)) || {}; } catch (e) {}
              sources = head.sources || [];
              /* A fresh question minted a thread: adopt its id so the next
                 ask continues it and a reload comes back to it. */
              if (head.chat && head.chat !== chatId) {
                chatId = head.chat;
                if (history.replaceState) {
                  history.replaceState(null, '', location.pathname + '?merecat=1&chat=' + chatId);
                }
              }
              if (head.used) renderQuota(head.used);
              acc = pre.slice(cut + 2);
            } else {
              acc += chunk;
            }
            if (acc) cat.body.textContent = acc;
            return pump();
          });
        }
        return pump();
      }).catch(function () {
        cat.body.textContent = '';
        cat.body.appendChild(el('span', 'merecat-note', 'Network hiccup. Ask again.'));
      }).then(function () {
        send.disabled = false;
        q.focus();
      });
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var text = q.value.trim();
      if (!text || send.disabled) return;
      q.value = '';
      ask(text);
    });
    q.addEventListener('keydown', function (e) {
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
      fetchRetry(MERECAT_API + '/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: state.key, id: chatId }),
      }, [1000, 3000]).then(function (r) { return r.json(); }).then(function (d) {
        if (blockedOut(d)) return;
        loadNote.remove();
        if (!d.ok) {
          chatId = 0;
          if (history.replaceState) history.replaceState(null, '', location.pathname + '?merecat=1');
          log.appendChild(el('p', 'comments-status', 'That conversation is gone (expired or deleted). This is a fresh one.'));
          return;
        }
        (d.msgs || []).forEach(function (m) {
          var b = bubble(m.role === 'user' ? 'you' : 'cat');
          if (m.role === 'user') {
            b.body.textContent = m.body;
          } else {
            var srcs = [];
            try { srcs = JSON.parse(m.sources || '[]'); } catch (e) {}
            var rr = citeRenumber(m.body, srcs);
            fillBody(b.body, rr.text);
            srcFooter(b.body, rr.sources);
            if (m.id) attachForward(b.msg, m.id);
          }
        });
        q.focus();
      }).catch(function () {
        loadNote.textContent = 'Could not reopen the conversation. Reload to retry.';
      });
    } else {
      q.focus();
    }
  }

  /* The librarian's administration page: one dial for now, the per-member
     daily cap, on or off and how many. Off means members draw freely until
     the community's shared daily budget answers for everyone. Saved through
     the admin-keyed /config, the same door the make-librarian push uses;
     other edge isolates pick a change up within about five minutes. */
  function viewMerecatAdmin() {
    document.title = 'merecat administration | Catholicity Board';
    crumb([['Catholicity Board', 'community.html'], ['Administrative options', 'community.html?admin=1'], ['merecat']]);
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
      row.appendChild(document.createTextNode(' questions per day. Unchecked, members draw freely until the community budget is spent. Admins are never capped either way.'));
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
        if (text.length < 200 && !confirm('These instructions are very short. Replace the librarian’s whole standing instructions with them?')) return;
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
  function renderMerecatAbout(node, d) {
    node.textContent = '';
    function h3(t) { node.appendChild(el('h3', null, t)); }
    function p(t) { node.appendChild(el('p', null, t)); }

    h3('What this is');
    p('merecat is a research tool for digging through this site’s Library, not an oracle. Every question runs the same way: the librarian searches the shelf, gathers the ' +
      (d ? d.topk : 'eight') + ' most relevant passages, and hands them to a language model with standing instructions to answer from them and to cite them. Every work it cites is self-hosted here, and the whole shelf is anchored deep: every Bible verse and every father, book, chapter, section, and paragraph of the corpus has its own address, so a citation does not just name a work, it lands you very close to the exact place. The numbered links under each answer are the passages the answer actually stands on, few for a simple question and as many as a broad one genuinely needs, chosen from everything the librarian read. When the shelf does not cover a question it is instructed to say so and to label what follows as general knowledge.');
    p('The model is ' + (d ? d.model : 'an open-weights model') +
      ', running on Cloudflare Workers AI, the same service that runs this board’s own machinery. Your question is processed there and nowhere else, and the librarian can still err, which is why every answer carries its sources: check them. Treat merecat as a fast index to the shelf, not as the shelf itself.');
    p('You can also summon the librarian in public: write @merecat in a forum post or an article-page comment and it answers right there in the thread, briefed on the page, the recent conversation, and your comment. A mention spends one of your daily questions like any question here would.');

    h3('What it knows');
    var pk = el('p');
    pk.appendChild(document.createTextNode(
      'Only this site’s own published library, weighted by the owner’s ladder: the site’s works and their catechetical core first, then the King James Scriptures with the Deuterocanon carried from the Douay-Rheims, and the collected works of Newman entire set directly beneath them, the interpretive companion the site reads the Fathers with, then the named works of the Fathers with the Catena, the great Augustine and Athanasius singles, St. John of Damascus, and the ancient Liturgies, then the seven councils with the documents of the schism and the confessional standards of the communions this site engages in their own words, Trent beside Westminster, Luther beside Jewel, the Book of Concord entire, the Books of Common Prayer of 1559, 1662, and 1928 with the Thirty-Nine Articles, Guettée’s case against the papal claims, the Eastern Patriarchs’ replies to Rome of 1848 and 1895, and the Anglican orders controversy in both its voices, Apostolicae Curae beside Saepius Officio, and the deep shelf beneath all, the complete Schaff library with his History of the Christian Church and Creeds of Christendom beside the Summa, the whole Douay-Rheims for the Vulgate tradition’s rendering, Hooker’s Laws of Ecclesiastical Polity, Calvin’s Institutes, Luther’s Bondage of the Will, Keble and Andrewes for the devotional life, the modern apologetics of Chesterton and Gibbons, and beneath everything, weighted at the very bottom and kept in a second database of its own, the Roman world for background: Gibbon entire in Bury’s edition, Cassius Dio, Tacitus, Suetonius, Ammianus, Zosimus, and Bury’s Later Roman Empire. When the librarian steelmans Rome, Orthodoxy, the Reformation, or the free churches, it can quote their own standards, not a paraphrase. A few works on the shelf are under copyright and are not hosted here: the librarian knows them, quotes them briefly with attribution, and their citation links go to where the book can be bought. The shelf is still growing, and the librarian’s index is refreshed as new works land, so the counts below are live.' +
      (d ? ' Right now that is ' + d.chunks.toLocaleString() + ' indexed passages across ' + d.works.length + ' works. ' : ' ')));
    var libA = el('a', 'body-link', 'The Library');
    libA.href = 'library.html';
    pk.appendChild(libA);
    pk.appendChild(document.createTextNode(
      ' is the human catalog of the same shelf, and it keeps growing: as works come onto the Library the librarian’s context is updated to make use of them.'));
    node.appendChild(pk);
    if (d && d.works && d.works.length) {
      var shelf = el('details', 'merecat-shelf');
      shelf.appendChild(el('summary', null, 'The full shelf, work by work'));
      var tiers = {
        1: 'The site’s voice and its catechetical core',
        2: 'The Scriptures',
        6: 'Newman, the interpretive companion',
        3: 'The named works of the Fathers',
        4: 'The councils, the confessions, and the schism',
        5: 'The deep shelf',
        7: 'The Roman world, for background',
      };
      [1, 2, 6, 3, 4, 5, 7].forEach(function (t) {
        var rows = d.works.filter(function (w) { return w.tier === t; });
        if (!rows.length) return;
        shelf.appendChild(el('p', null, tiers[t]));
        var ul = el('ul');
        rows.forEach(function (w) {
          var li = el('li');
          var a = el('a', 'body-link', w.title);
          a.href = w.url;
          li.appendChild(a);
          li.appendChild(document.createTextNode(' · ' + w.chunks.toLocaleString() + ' passages'));
          ul.appendChild(li);
        });
        shelf.appendChild(ul);
      });
      node.appendChild(shelf);
    }

    h3('How it is biased');
    p('Deliberately, in the open, and by the site owner’s own ladder. The shelf is weighted from the site’s own works and their catechetical core at the top, then the Scriptures with Newman set directly beneath them as the interpretive companion the Fathers are read with, then the named works of the Fathers, the councils and the documents of the schism, and the deep sets beneath all. The top band is searched semantically as well as by keyword, weighted highest, and named to the model as the positions of this site.');
    p('Above the weights sits the lens. The librarian is instructed to read everything through this site’s confession and its long conversation with Newman: to treat him as the site’s friend in both his ages, to follow his notes of development with the book’s own added tests laid over them, and to follow the book’s model of authority where the two part ways. It is instructed to defend the site’s positions with real arguments, to steelman Rome, Orthodoxy, the Reformation, and the free churches honestly, to distinguish what this site argues from what the record shows from what is contested, and never to manufacture a consensus that is not there. Bias here means emphasis and voice, never blinders: every band is searched on every question.');
    if (d && d.persona) {
      var pd = el('details', 'merecat-shelf');
      pd.appendChild(el('summary', null, 'The standing instructions, verbatim, as the model receives them'));
      pd.appendChild(el('div', 'merecat-persona', d.persona));
      node.appendChild(pd);
    }

    h3('What it remembers about you');
    p('Your conversations are saved as threads, the way your direct messages are: each conversation is its own thread, kept for thirty days from its last message so you can leave and pick it back up, then expired and removed. Threads belong to your pseudonymous identity alone. Only your key can list, read, continue, or delete them, deletion is immediate and outright, and no admin tool for reading them exists. You can forward any single answer to a public topic on the board, where it posts under the librarian\u2019s own name marked as forwarded by you, so nothing you ask goes public except by your own hand.');
    p('Within a thread the librarian remembers the whole conversation: the newest turns ride along word for word, and everything older is folded into a running condensed summary the thread carries, so a long conversation stays coherent without burning the community’s shared budget. The model itself learns nothing from you and keeps nothing between threads. Beyond your threads the server holds counters only, the day, your identity hash, and how many questions you have asked, so the daily caps can work. You ask under the same pseudonymous key you post with, and the server sees only its hash.');

    h3('Usage');
    p('The whole community shares one free daily budget with the board’s own moderation machinery. ' +
      (d
        ? (d.user_cap_on
          ? 'Each member gets ' + d.user_daily + ' questions a day and the community together ' + d.global_daily +
            '. Today you have used ' + (d.you != null ? d.you : 0) + ' of ' + d.user_daily +
            ', and the community ' + d.today + ' of ' + d.global_daily + '.'
          : 'Members draw freely on the community\u2019s shared budget of ' + d.global_daily +
            ' questions a day. Today the community has used ' + d.today + ' of ' + d.global_daily +
            (d.you != null ? ', of which you asked ' + d.you : '') + '.')
        : 'Members share one community budget of questions a day.') +
      (d && d.admin ? ' You are an admin: the per-member cap does not stop you, though your use still counts in every tally.' : '') +
      ' Counters renew at midnight UTC, which is ' + merecatResetLocal() + ' on your clock. When the budget is spent the librarian rests until then rather than degrade.');
  }

  /* Dispatch the board to the view its query string names. Clears the section
     first so it can be called again to re-render in place (loadMyProfile does
     this once a runtime admin's status arrives, to reveal the admin controls). */
  function route() {
    section.textContent = '';
    var params = new URLSearchParams(location.search);
    if (params.get('ipbans')) return viewIpBans();
    if (params.get('admins')) return viewAdmins();
    if (params.get('admin')) return viewAdminHome();
    if (params.get('merecatadmin')) return viewMerecatAdmin();
    if (params.get('merecat')) return viewMerecat();
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
      route();
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
