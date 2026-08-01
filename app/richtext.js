/* The richtext spine (interior campaign, Wave B3a): the body renderer and
   everything it stands on, extracted BYTE-VERBATIM from comments.js — the
   inline grammar, the emoji whitelists, appendRich/fillBody, the verse hover,
   and the injected emoji styles. The Scripture autolink table now lives in the
   PureScript Domain.Scripture (via the app/core.js barrel, imported below);
   the frozen fallback copy in comments.js and MERECAT_BIBLE in the worker are
   the two remaining copies (Phase 1b / Phase 6). comments.js defers here
   whenever the bundle stands (the default for everyone), keeping ONE living
   source; its own copies serve only the no-bundle fallback and retire at
   Wave F. Assigned to window.mcRich. */

import * as Core from './core.js';

function el(tag, cls, text) {
  var node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

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
  // The Scripture spelling table and its autolink regex fragment now come from
  // the PureScript Domain.Scripture, through the app/core.js barrel:
  // Core.bibleSrc is byte-identical to the former BIBLE.src (golden-tested), and
  // Core.bookSlug(normalizedKey) replaces the former BIBLE.map lookup.

  /* Any anchor whose href lands on a KJV verse gets the hover-preview data,
     however the anchor was born: a plain written reference, a markdown link
     (merecat writes those), or a sources-footer entry. The slug is greedy, so
     1-corinthians-6-9 splits book/chapter/verse correctly; a chapter-only
     hash (no verse) stays undecorated since there is nothing to preview. */
  function scriptureDecor(a, url) {
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
  var INLINE_MD = new RegExp(INLINE_BASE.source + '|' + Core.bibleSrc, 'gi');
  /* Append rich inline text to a node: the marked spans above become <strong>,
     <em>, and same-site <a> nodes, everything else plain text. Emphasis nests
     (a link inside bold works) by recursing on the strictly-shorter inner text.
     Shared by the body renderer and each quoted/list line. */
  function appendRich(target, str, plain) {
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
        var slug = Core.bookSlug(m[6].toLowerCase().replace(/\s+/g, ' '));
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
  function fillBody(node, text, plain) {
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
        var hm = /^(#{1,5}) +(.*)$/.exec(lines[i]);
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
  var kjvData = null, kjvPromise = null;
  function loadKjv() {
    if (kjvPromise) return kjvPromise;
    kjvPromise = fetch('kjv.json').then(function (r) { return r.json(); })
      .then(function (d) { kjvData = d; return d; })
      .catch(function () { kjvData = { books: [] }; return kjvData; });
    return kjvPromise;
  }
  var drData = null, drPromise = null;
  function loadDr() {
    if (drPromise) return drPromise;
    drPromise = fetch('dr.json').then(function (r) { return r.json(); })
      .then(function (d) { drData = d; return d; })
      .catch(function () { drData = { books: [] }; return drData; });
    return drPromise;
  }
  function ensureEmojiStyles() {
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
      /* display is set explicitly: a site-wide `img{display:block}` (05-home.css)
         would otherwise drop every inline emoji onto its own line. */
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
      '@media (max-width:620px){.emoji-body,.emoji-suggest{max-height:40vh}.emoji-cell{width:2.4em;height:2.4em;font-size:1.45rem}.av-cell{width:3.4em;height:3.4em}.scripture-sel{max-width:9em}}';
    var st = el('style'); st.id = 'mc-emoji-css'; st.textContent = css;
    document.head.appendChild(st);
  }
function initScriptureHover(signal) {
  (function scriptureHover() {
    try { if (!window.matchMedia || !window.matchMedia('(hover: hover)').matches) return; } catch (e) { return; }
    var tip = null, maps = {}, hideTimer = null, CAP = 30;
    function bySlug(which, data, slug) {
      if (!maps[which] && data) {
        maps[which] = {};
        data.books.forEach(function (b) { maps[which][b.slug] = b; });
      }
      return maps[which] ? maps[which][slug] : null;
    }
    function place(a, ex, ey) {
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
    function show(a, ex, ey) {
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
      var a = e.target && e.target.closest && e.target.closest('a.scripture-link');
      if (!a) return;
      clearTimeout(hideTimer);
      show(a, e.clientX, e.clientY);
    }, { signal: signal });
    document.addEventListener('mouseout', function (e) {
      var a = e.target && e.target.closest && e.target.closest('a.scripture-link');
      if (!a) return;
      hideTimer = setTimeout(function () { if (tip) tip.hidden = true; }, 160);
    }, { signal: signal });
  })();
}

window.mcRich = {
  appendRich: appendRich,
  fillBody: fillBody,
  scriptureDecor: scriptureDecor,
  ensureEmojiStyles: ensureEmojiStyles,
  initScriptureHover: initScriptureHover,
  CUSTOM_EMOJI: CUSTOM_EMOJI,
  NAMED_EMOJI: NAMED_EMOJI,
  STANDARD_EMOJI: STANDARD_EMOJI,
  EMOJI_PACKS: EMOJI_PACKS,
};
