/* Comments client. A page opts in with <section class="comments" data-comments>
   before its footer plus this script. The thread loads only when the section
   scrolls into view, so readers who never reach it cost no API request.

   Identity is a random key generated in the browser and kept in localStorage.
   The server stores only SHA-256(key). Everyone else sees a pseudonym derived
   from that hash, so the same person keeps the same name and nobody can
   recover the key from it. Losing the key loses the identity, which is why
   the key is shown once with a copy button. All rendering goes through
   textContent, never innerHTML, so comment text cannot inject markup. */

import { installComposer } from './composer';
import { installProfile } from './profile';
import { installBoard } from './board';
import { installWall } from './wall';
import { installDm } from './dm';
import { installMerecat } from './merecat';
import { installAdmin } from './admin';
import type { Boot } from './boot';

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
  /* mcBoot() IS the whole client body, so everything declared inside it is
     rebuilt on every soft navigation — which quietly made two session-stable
     calls fire on EVERY hop: /dm/pubkey (an idempotent WRITE) and /prefs,
     ~190ms each, measured on prod. Both answers hold for the page's life, so
     their "already done" markers live out here, where a boot cannot reset them.
     Deliberately page-scoped rather than persisted: a fresh load still
     republishes once, so a pubkey row lost server-side heals on the next visit
     instead of never. Both are keyed by identity, so switching accounts
     re-does the work. */
  var mcPubkeyFor: any = null;
  var mcPrefsFor: any = null;
  /* The Turnstile widget and its token live OUT here, above mcBoot, because
     mcBoot runs again on every soft navigation. Kept per-boot, the widget was
     torn down and a fresh Cloudflare challenge iframe built EVERY time a view
     changed — its mount point (.ts-slot) sits inside <main>, which the shell
     replaces wholesale. In an installed iOS app that churn is what takes the
     page down. One widget per DOCUMENT now, in a host that survives the swap. */
  var mcTsWidget: any = null;
  var mcTsToken: { token: any; at: number } | null = null;
  /* The challenge runs inside a same-origin iframe (docs/turnstile.html) so
     that a challenge-platform navigation can only ever take THAT document, not
     the app. Page-scoped like the widget id: one frame for the life of the
     document, never rebuilt by a soft navigation. `mcTsFell` records that the
     frame did not come up and the in-page widget is carrying it instead — the
     old road, kept so no branch of this is worse than what shipped before. */
  var mcTsFrame: HTMLIFrameElement | null = null;
  var mcTsFrameReady = false;
  var mcTsFell = false;
  /* Decrypted DM attachments, as blob: URLs — PAGE-SCOPED, above mcBoot.

     A blob URL pins its bytes in memory until something revokes it, and
     mcBoot() is the whole client: it re-runs on EVERY soft navigation. So a
     cache declared inside it was replaced with a fresh {} on each hop and
     every URL it held was orphaned WITHOUT being revoked — the decrypted
     bytes stayed resident for the life of the document, and a reader moving
     between conversations climbed until the installed app was killed outright.
     From the inside that looks like nothing at all: no pagehide, no
     beforeunload, no error, then a fresh load of the same URL. Which is
     exactly the crumb ring a reader sent on 2026-09-08.

     One store for the document, oldest-untouched out past either budget, and
     eviction actually revokes. An element whose blob was evicted re-requests
     rather than breaking (see dmMediaNode). */
  var MC_DM_BLOB_MAX = 16;
  var MC_DM_BLOB_BYTES = 32 * 1024 * 1024;
  var mcDmBlobs: { key: string; url: string; bytes: number }[] = [];
  function mcDmBlobGet(key: string): string | null {
    for (var i = 0; i < mcDmBlobs.length; i++) {
      if (mcDmBlobs[i].key === key) {
        var hit = mcDmBlobs.splice(i, 1)[0];       // wanted now: it goes to the back
        mcDmBlobs.push(hit);
        return hit.url;
      }
    }
    return null;
  }
  function mcDmBlobPut(key: string, url: string, bytes: number) {
    if (mcDmBlobGet(key)) { try { URL.revokeObjectURL(url); } catch (e) { /* fine */ } return; }
    mcDmBlobs.push({ key: key, url: url, bytes: bytes || 0 });
    var total = 0, i;
    for (i = 0; i < mcDmBlobs.length; i++) total += mcDmBlobs[i].bytes;
    /* Never evict the one just added, however large: a single attachment over
       the whole budget must still be viewable. */
    while (mcDmBlobs.length > 1 && (mcDmBlobs.length > MC_DM_BLOB_MAX || total > MC_DM_BLOB_BYTES)) {
      var out = mcDmBlobs.shift()!;
      total -= out.bytes;
      try { URL.revokeObjectURL(out.url); } catch (e) { /* already gone */ }
    }
  }

  /* A runtime-fetched asset's URL, carrying its current cache key. The keys are
     stamped into nav.js (window.mcAssets), never into this file: a key written
     here would change comments.js, which would change comments.js's own key.
     Bare if nav.js has not arrived — an unkeyed URL still works, it is merely
     cacheable, and the ten-minute Pages TTL heals it. */
  function asset(name: string): string {
    var f = window.mcAsset;
    return f ? f(name) : name;
  }

  function mcBoot() {
  /* The boot object: the root's helpers the feature modules take, filled below
     once they exist; the modules' exports land on it too, and the few pieces
     of state more than one module writes live on it outright (B.x). */
  const B: Boot = Object.create(null) as Boot;
  /* The modules' functions the root calls (the router, the kit): bound after install. */
  let ADMIN_HASHES: any;
  let BLOCK_CONFIRM: any;
  let CATS: any;
  let MERECAT_API: any;
  let MERECAT_BOT_HASH: any;
  let MUTED_STORE: any;
  let NOTIF_CACHE: any;
  let adminProfileEditor: (card: any, hash: any, prof: any) => any;
  let annotateMeta: (forPage?: any) => any;
  let armBoardForm: () => any;
  let attachAuthorPicker: (input: any, actionLabel?: any) => any;
  let attachDraft: (ta: any, ctx: string, titleInput?: any, overwrite?: boolean) => any;
  let attachMentions: (textarea: any) => any;
  let blockedOut: (d: any) => any;
  let boardButtons: (labelBase: any, submit: any) => any;
  let boardPost: (payload: any, onSuccess: any) => any;
  let bookmarkToggle: (kind: any, ref: any, on: any) => any;
  let buildBoardForm: (withTitle: any, heading: any) => any;
  let catByKey: (key: any) => any;
  let commentNode: (c: any, pending: any, quoteCtx: any, reveal?: boolean) => any;
  let dmB64uEnc: (bytes: any) => any;
  let dmCacheSet: (n: any) => any;
  let dmLabel: (hash: any, nick: any) => any;
  let dmScore: (q: any, name: any) => any;
  let dmSearchBox: () => any;
  let dmSeenLabel: (epoch: any) => any;
  let dmUnreadCheck: (force?: boolean) => any;
  let emojiToken: (code: any, raw: any) => any;
  let ensureEmojiStyles: () => any;
  let ensureNacl: () => Promise<any>;
  let faithLabel: (code: any) => any;
  let getMuted: () => any;
  let identityAction: (label: any, onClick: any) => any;
  let indexSearchBox: () => any;
  let isAdmin: () => any;
  let isBlocked: any;
  let isMember: () => any;
  let isMuted: (hash: any) => any;
  let keyFromFragment: () => any;
  let keyNudge: () => any;
  let loadMyProfile: () => any;
  let loginWithKey: (key: any) => any;
  let mdEditor: (textarea: any, titleInput?: any) => any;
  let mintIdentity: (faith: any) => any;
  let myDmKeypair: () => any;
  let notifCacheSet: (n: any) => any;
  let notifUnreadCheck: (force?: boolean) => any;
  let permalinkFor: (c: any, ctx: any) => any;
  let postMenu: (opts: any) => any;
  let profileHref: (hash: any) => any;
  let quoteInto: (c: any, excerpt: any, url: any) => any;
  let renderButtons: () => any;
  let renderIdentity: () => any;
  let renderProfile: (card: any, p: any, editable: any) => any;
  let scriptureDecor: (a: any, url: any) => any;
  let searchSnippet: (snip: any) => any;
  let selectionInPost: (c: any) => any;
  let setBlock: (hash: any, on: any, done?: any) => any;
  let setStatus: (text: any) => any;
  let socialCfg: () => Promise<any>;
  let socialRead: () => any;
  let startEdit: (c: any, article: any) => any;
  let syncMutedUp: () => any;
  let toggleMute: (hash: any) => any;
  let topicAdminCorner: (topic: any, curCat: any) => any;
  let truncate: (s: any, n: any) => any;
  let viewAdminHome: () => any;
  let viewAdmins: () => any;
  let viewAudit: () => any;
  let viewCat: (key: any) => any;
  let viewDiscordHooks: () => any;
  let viewDm: (other: any) => any;
  let viewFeed: () => any;
  let viewInbox: () => any;
  let viewIndex: () => any;
  let viewIpBans: () => any;
  let viewJoin: (what: any) => any;
  let viewJournal: () => any;
  let viewJournalArticle: (id: any) => any;
  let viewMerecat: () => any;
  let viewMerecatAdmin: () => any;
  let viewMerecatThread: (id: any) => any;
  let viewMerecatThreads: () => any;
  let viewNoSuchPage: () => any;
  let viewNotifications: () => any;
  let viewPlatformSettings: () => any;
  let viewPost: (id: any) => any;
  let viewProfile: (hash: any) => any;
  let viewProfileByHandle: (handle: any) => any;
  let viewRecent: (p: any) => any;
  let viewSaved: (p: any) => any;
  let viewSearch: () => any;
  let viewShadowbans: () => any;
  let viewTopic: (id: any) => any;
  let viewUsage: () => any;
  let viewUsers: () => any;
  let wallMediaNode: (mediaKey: any, post: any) => any;
  let watchToggle: (topicId: any) => any;
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


  function displayName(hash: any) {
    return window.mcCore!.displayName(hash);
  }

  function pagePath() {
    var p = location.pathname;
    if (p.slice(-1) === '/') p += 'index.html';
    if (p.slice(-5) !== '.html') p += '.html';
    return p;
  }

  /* The comments section this boot speaks for. Null = the page's own path (an
     article page: the key and the permalink are one). The journal view sets
     both before it mounts a section under an article, where they differ: the
     API key is 'journal:<id>', the permalink '/journal.html?a=<id>'. Declared
     inside the boot on purpose — a soft navigation rebuilds them with the page. */
  B.COMMENTS_KEY = null;
  B.COMMENTS_HREF = null;
  function pageKey() { return B.COMMENTS_KEY || pagePath(); }
  function pageHref() { return B.COMMENTS_HREF || pagePath(); }

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

  function browserTz() {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { return ''; }
  }

  /* A dual-stack browser reaches us on only one address family, so the other
     stays invisible to the server. So we ask two single-family echoes (run by
     Cloudflare, CORS-open) what address each family sees and send them along,
     so a ban can later close both doors. Best-effort and time-boxed: if an echo
     is slow or down we simply lack that family and the post proceeds anyway. */
  /* One family can be genuinely absent: a v4-only network cannot reach
     ipv6.icanhazip.com AT ALL. The browser logs that failed load as a console
     ERROR from its own network stack, before any promise settles, so the
     .catch below cannot silence it — every v6-less reader takes a doomed
     DNS+connect on each boot and each post, and every headless suite's
     console gate fails on it. So remember a family that had no road and skip
     it for a day. Only a real refusal is remembered, never an abort (a slow
     link must not cost a reader their address for a day); a success clears
     the mark at once, so gaining IPv6 heals on the next successful call.
     Blocked storage falls back to always trying — the old behaviour exactly. */
  var ALTIP_SKIP_MS = 86400000;
  function altIpSkipped(fam: string) {
    try {
      var t = Number(localStorage.getItem('mc-altip-fail:' + fam) || 0);
      if (!t) return false;
      if (Date.now() - t < ALTIP_SKIP_MS) return true;
      localStorage.removeItem('mc-altip-fail:' + fam);
    } catch (e) { /* blocked storage: always try */ }
    return false;
  }
  function altIpMark(fam: string, failed: boolean) {
    try {
      if (failed) localStorage.setItem('mc-altip-fail:' + fam, String(Date.now()));
      else localStorage.removeItem('mc-altip-fail:' + fam);
    } catch (e) { /* blocked storage: nothing to remember */ }
  }
  function collectAltIps() {
    ['ipv4', 'ipv6'].forEach(function (fam) {
      if (altIpSkipped(fam)) return;
      var ctl = ('AbortController' in window) ? new AbortController() : null;
      var timer = ctl ? setTimeout(function () { ctl!.abort(); }, 2000) : null;
      fetch('https://' + fam + '.icanhazip.com', ctl ? { signal: ctl.signal } : {})
        /* A non-ok RESPONSE is not a missing road — the host answered — so it
           leaves the mark alone rather than banking a day's skip. */
        .then(function (r) { return r.ok ? r.text() : ''; })
        .then(function (txt) {
          var ip = String(txt || '').trim();
          if (ip && ip.length <= 45 && /^[0-9a-fA-F:.]+$/.test(ip)) {
            (state.altIps as any)[fam] = ip;
            altIpMark(fam, false);
          }
        })
        .catch(function (e: any) {
          if (!e || e.name !== 'AbortError') altIpMark(fam, true);
        })
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

  function sha256hex(text: any): Promise<string> {
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
  var NACL_SRC = asset('tweetnacl.min.js');
  /* Publish my public key once per session (idempotent server-side). Fired when
     an identity goes live, so any active member is reachable for an encrypted DM. */

  function ensureMyPubkey() {
    if (!state.key || !state.myHash || mcPubkeyFor === state.key) return;
    var forKey = state.key;
    mcPubkeyFor = forKey;
    ensureNacl().then(function () {
      return fetch(API + '/dm/pubkey', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: forKey, pubkey: dmB64uEnc(myDmKeypair().publicKey) }),
      });
    }).then(function (r: any) { return r.json(); })
      .then(function (d: any) { if (!d || !d.ok) { if (mcPubkeyFor === forKey) mcPubkeyFor = null; } })
      .catch(function () { if (mcPubkeyFor === forKey) mcPubkeyFor = null; });
  }
  function fmtSecs(s: any) {
    s = Math.max(0, Math.floor(Number(s) || 0));
    return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2);
  }

  var section = document.querySelector('section[data-comments], section[data-board]') as HTMLElement;
  if (!section) return;
  var BOARD = section.hasAttribute('data-board');

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
    profilePresence: null,   // set by renderProfile: the open profile's presence line
  };

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
  /* One host for the life of the document. `data-mc-app` is the shell's own
     marker for furniture that must survive a <main> swap (the progress bar and
     the audio dock use it), so the widget is built once and never churned.
     It shows nothing unless Turnstile asks for a human check, at which point
     before-interactive-callback brings it forward. */
  /* The host's stylesheet, injected the moment the host exists and by nothing
     else. It used to ride in ensureDmStyles(), which only the DM, wall and
     board-media paths inject — so on the profile view the frame had no rule
     at all and stood at the iframe default of 300×150, opaque white in a dark
     theme (2026-09-09: "an out-of-place white box" on the first open of
     Profile). A rule that can be absent while its element is present will be. */
  function ensureTsStyles() {
    if (document.getElementById('mc-ts-css')) return;
    var css = '' +
      /* The single Turnstile host. It is REAL: on screen, laid out, opaque,
         interactable. The previous version parked it at left:-9999px with
         opacity:0 and pointer-events:none, which is the one thing a challenge
         container must never be — Cloudflare's widget hides ITSELF through
         appearance:'interaction-only', and an invisible cross-origin challenge
         iframe in an installed iOS web view is a document that gets taken away
         (2026-09-08: the app died about a second after every mount, with no
         pagehide and no error). So the host is a normal fixed element pinned
         to the bottom edge with nothing visible in it until the widget decides
         otherwise, and `.on` only lifts it clear of the composer so a human
         check can actually be reached. */
      '.mc-ts-frame{border:0;width:300px;max-width:100vw;height:0;display:block}' +
      '.mc-ts-host.on .mc-ts-frame{height:70px}' +
      '.mc-ts-host{position:fixed;left:50%;transform:translateX(-50%);bottom:0;' +
      'z-index:9998;line-height:0;transition:bottom .15s ease}' +
      '.mc-ts-host.on{bottom:calc(env(safe-area-inset-bottom,0px) + 84px);' +
      'padding:10px;border-radius:12px;line-height:normal;' +
      'background:var(--surface,#fffdf7);box-shadow:0 4px 20px rgba(0,0,0,.3)}';
    var st = el('style');
    st.id = 'mc-ts-css';
    st.textContent = css;
    document.head.appendChild(st);
  }
  function tsHost() {
    ensureTsStyles();
    /* Only the document's own host counts. A view that rendered a
       `.mc-ts-host` of its own inside <main> (the Lit profile did, until
       2026-09-09) was found first, took the frame, and lost it with the next
       swap — leaving a handle that read as mounted with nothing behind it. */
    var h = document.querySelector('body > .mc-ts-host[data-mc-app]') as HTMLElement;
    if (h) return h;
    h = el('div', 'mc-ts-host');
    h.setAttribute('data-mc-app', '');
    document.body.appendChild(h);
    return h;
  }
  /* The frame, if it is still in the document. A handle to an iframe that
     something tore out is worse than none: it reads as "mounted" and every
     wait on it runs to its timeout. */
  function tsFrameLive() {
    return !!(mcTsFrame && mcTsFrame.isConnected && mcTsFrame.contentWindow);
  }
  /* Is the challenge mounted and able to answer? Either road counts. */
  function tsMounted() {
    return (mcTsFrameReady && tsFrameLive()) || (!!window.turnstile && mcTsWidget !== null);
  }
  /* Build the isolating frame once. If it cannot report itself ready within a
     few seconds — blocked, offline, an engine that will not run it — the
     in-page widget takes over, which is exactly the behaviour that shipped
     before this, so the frame is only ever an improvement or a no-op. */
  function tsEnsureFrame() {
    if (mcTsFell) return;
    if (mcTsFrame) {
      if (mcTsFrame.isConnected) return;
      /* Torn out of the document — a swapped host, a view that owned it. The
         old handle would sit "ready" for ever with nobody behind it. */
      trace('turnstile: frame was torn out -> rebuilding');
      mcTsFrame = null;
      mcTsFrameReady = false;
      mcTsToken = null;
    }
    var f = document.createElement('iframe');
    f.className = 'mc-ts-frame';
    f.title = 'Verification';
    f.setAttribute('aria-hidden', 'true');
    f.src = asset('turnstile.html');
    mcTsFrame = f;
    tsHost().appendChild(f);
    trace('turnstile: isolating frame requested');
    window.setTimeout(function () {
      if (mcTsFrameReady || mcTsFell) return;
      trace('turnstile: frame never readied -> in-page widget');
      mcTsFell = true;
      renderTurnstileWidget();
    }, 6000);
  }
  /* The in-page widget: the fallback road only. */
  function renderTurnstileWidget() {
    if (!window.turnstile) return;
    var slot = tsHost();
    if (mcTsWidget !== null && slot.querySelector('iframe:not(.mc-ts-frame)')) { state.widgetId = mcTsWidget; return; }
    /* The mount is the challenge, so it is the moment worth naming. Without
       this crumb the ring showed a view rendering and a document dying a
       second later with nothing in between to connect them. */
    trace('turnstile: mounting the widget');
    try {
      /* execution:'execute' is GONE, and that is the whole point (2026-09-08).
         With it, the challenge only ran when turnstile.execute() was called —
         and in the installed iOS app that call took the page down: the document
         was replaced with no pagehide, no error, and no token, which is a web
         view being killed rather than anything navigating. Warming it earlier
         only moved the crash to a nicer moment; it still flashed white while
         the reader was typing.

         Default execution ('render') runs the challenge as the widget MOUNTS,
         through the ordinary embedded path rather than an on-demand
         interstitial, and hands the token to `callback`. Nothing ever calls
         execute() now.

         appearance:'interaction-only' stays: the widget shows nothing unless a
         human check is genuinely needed, so composers look exactly as before. */
      state.widgetId = mcTsWidget = turnstile.render(slot, {
        sitekey: SITEKEY,
        appearance: 'interaction-only',
        'before-interactive-callback': function () {
          /* A human check is wanted: bring the widget where it can be reached.
             Without this it would sit invisible at the foot of the body and the
             reader would simply never be able to finish. */
          trace('turnstile: interaction wanted');
          tsHost().classList.add('on');
        },
        'after-interactive-callback': function () { tsHost().classList.remove('on'); },
        callback: function (token: any) {
          /* Tokens are single-use, so this is a one-deep queue: held until a
             submit spends it, after which reset() earns the next one. */
          mcTsToken = { token: token, at: Date.now() };
          trace('turnstile: token ready');
          if (state.tokenWait) { state.tokenWait.resolve(token); state.tokenWait = null; }
        },
        'error-callback': function () {
          /* Crumb it here, not only on the tokenWait path: a refusal that
             happens while WARMING has no waiter to reject, so it used to leave
             no trace whatsoever — and "no token and no reason" is the hardest
             possible thing to diagnose from a phone. */
          trace('turnstile: challenge refused');
          mcTsToken = null;
          if (state.tokenWait) { state.tokenWait.reject(new Error('challenge failed')); state.tokenWait = null; }
          return true;
        },
        'expired-callback': function () { mcTsToken = null; },
        /* Never re-run the challenge on a timer, and never retry a failed one
           on a loop — see docs/turnstile.html for why. Token freshness is
           getToken()'s business, at the moment of the press. */
        'refresh-expired': 'never',
        retry: 'never',
      });
    } catch (e) { /* a double-render into the same slot throws; ignore */ }
  }

  function loadTurnstile() {
    /* The gate lives HERE, on the one road every mount takes, not only in
       warmToken(): four views were still calling this directly as they opened
       (the board form, the profile, the feed composer, the page comments —
       2026-09-09), which bypassed the sparing entirely and ran the challenge
       for a member who had merely arrived. Whoever asks, a spared identity
       mounts nothing; an unknown one is asked about first. */
    if (mcTsSpared) return;
    if (mcTsSpared === null) {
      tsSkipCfg().then(function (spare: boolean) {
        mcTsSpared = spare;
        if (spare) { trace('turnstile: spared, nothing mounted'); return; }
        loadTurnstile();
      });
      return;
    }
    /* The isolated frame is the road. The parent page never loads Cloudflare's
       script at all unless the frame has failed — that script is what mounts
       the challenge, and the challenge is what was taking the document. */
    if (!mcTsFell) { tsEnsureFrame(); return; }
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
  /* ---- Warming the challenge, so it never runs at the moment of commitment.
     The live evidence (2026-09-08, the owner's crumb ring): the FIRST submit
     wrote `turnstile: execute`, then `turnstile: token ok` never arrived and
     the document was replaced WITHOUT a pagehide — the signature of the
     challenge platform navigating the web view, not of anything this code does.
     A second press always worked, because by then the challenge had run.

     So the challenge is now asked for when the reader FOCUSES a composer —
     before a word is typed, when nothing is at stake — and the press spends the
     token that is already waiting. If the challenge still disturbs the page it
     does so at the harmless moment, and the draft guard covers even that.

     A Turnstile token is single-use server-side, so this is a one-deep queue,
     never a reusable cache: taking it clears it, and a fresh one is warmed
     behind. Tokens are good for a few minutes; an older one is discarded rather
     than spent on a request that would be refused. */
  var TOKEN_FRESH_MS = 240000;
  /* Warming is "mount the widget": in render mode the mount IS the challenge,
     and the token arrives on the callback. An earlier note here claimed that
     therefore none of this could take the page down. That was wrong, and the
     crumb ring said so: the installed app kept dying about a second after the
     mount. The mount is not free — it is the challenge — so it happens on the
     reader's first touch of a composer and nowhere else. Never on merely
     opening a view. */
  function warmToken() {
    if (!state.key) return;
    if (mcTsSpared) return;                    // nothing to warm; nothing to mount
    if (mcTsToken && Date.now() - mcTsToken.at < TOKEN_FRESH_MS) return;
    trace('turnstile: warming');
    loadTurnstile();   // which asks the server first whether this reader needs one at all
  }
  /* After a token is spent (or expires) ask the widget for another. reset()
     re-runs the challenge and fires `callback` again. */
  function ensureFreshToken() {
    try {
      if (mcTsFrameReady && tsFrameLive()) {
        mcTsFrame!.contentWindow!.postMessage({ mcTs: 'reset' }, location.origin);
        return;
      }
      if (window.turnstile && state.widgetId !== null) turnstile.reset(state.widgetId);
    } catch (e) { /* the next warm re-renders it */ }
  }
  /* And the structural net, so coverage is not a list anyone has to maintain.
     Turnstile guards SIX actions, not one: a page/book comment, a forum post,
     a feed post, a direct message, a profile save and an avatar upload. Wiring
     the warm into mdEditor covered the four that are composers and MISSED the
     profile editor entirely, which is exactly the kind of gap a per-site list
     grows. `.ts-slot` is the widget's own mount point, so its presence is the
     honest test of "a challenge will be needed on this view" — and any gated
     surface added later is covered the day it mounts its slot, not the day
     someone remembers this file. */
  document.addEventListener('focusin', function (e: any) {
    var t = e.target;
    if (!t || !t.tagName) return;
    var tag = t.tagName;
    if (tag !== 'TEXTAREA' && !(tag === 'INPUT' && /^(text|search|url|email|)$/.test(t.type || ''))) return;
    if (!document.querySelector('.ts-slot')) return;   // nothing gated on this view
    warmToken();
  }, { signal: bootSig });

  /* The frame speaks; this listens. Boot-scoped, because it resolves THIS
     boot's pending token wait — the frame itself is page-scoped and outlives
     every one of these. */
  window.addEventListener('message', function (e: any) {
    if (e.origin !== location.origin) return;
    var d = e.data;
    if (!d || !d.mcTs) return;
    if (!mcTsFrame || e.source !== mcTsFrame.contentWindow) return;
    if (d.mcTs === 'ready') { mcTsFrameReady = true; trace('turnstile: frame ready'); return; }
    if (d.mcTs === 'token') {
      mcTsToken = { token: d.token, at: Date.now() };
      trace('turnstile: token ready');
      if (state.tokenWait) { state.tokenWait.resolve(d.token); state.tokenWait = null; }
      return;
    }
    if (d.mcTs === 'interactive') {
      /* A human check: bring the frame where it can actually be reached. */
      trace('turnstile: interaction ' + (d.on ? 'wanted' : 'done'));
      if (d.on) tsHost().classList.add('on'); else tsHost().classList.remove('on');
      /* Hidden from assistive tech while it is a 0px box; a check a reader
         must complete is not. */
      if (mcTsFrame) mcTsFrame.setAttribute('aria-hidden', d.on ? 'false' : 'true');
      return;
    }
    if (d.mcTs === 'expired') { mcTsToken = null; return; }
    if (d.mcTs === 'error') {
      trace('turnstile: challenge refused');
      mcTsToken = null;
      if (state.tokenWait) { state.tokenWait.reject(new Error('challenge failed')); state.tokenWait = null; }
    }
  }, { signal: bootSig });

  /* Once the server has said established identities are spared, remember it for
     the page: the challenge is then never mounted at all, which is the only
     thing that reliably stops the installed app being taken down by it. */
  var mcTsSpared: boolean | null = null;
  function getToken(): Promise<any> {
    if (mcTsSpared) { trace('turnstile: not required for this identity'); return Promise.resolve(''); }
    /* Not asked yet — a press that skipped the composer entirely (a voice note,
       an attachment, an avatar). Settle it before mounting anything. */
    if (mcTsSpared === null) {
      return tsSkipCfg().then(function (spare: boolean) {
        mcTsSpared = spare;
        return getToken();
      });
    }
    var w = mcTsToken;
    if (w && Date.now() - w.at < TOKEN_FRESH_MS) {
      mcTsToken = null;                 // single-use: spend it and earn another
      trace('turnstile: spent a ready token');
      setTimeout(ensureFreshToken, 0);
      return Promise.resolve(w.token);
    }
    mcTsToken = null;
    return rawToken();
  }

  function rawToken() {
    /* Both ends are crumbed: this is how the reload was traced to the challenge
       in the first place, and it is how a future one would be. */
    trace('turnstile: token wanted' + (window.turnstile ? '' : ' (script not loaded yet)'));
    return new Promise<any>(function (resolve, reject) {
      loadTurnstile();   // a click may be the first thing that needs it
      var waited = 0;
      var STEP = 150, MAX = 10000;
      function run() {
        if (state.tsError) {
          reject(new Error('Verification could not load. Check your connection and reload the page.'));
          return;
        }
        if (mcTsFell && window.turnstile && state.widgetId === null) renderTurnstileWidget();
        if (!tsMounted()) {
          if (waited >= MAX) {
            reject(new Error('Verification is taking a moment to load. Give it a few seconds and press the button again.'));
            return;
          }
          waited += STEP;
          setTimeout(run, STEP);
          return;
        }
        /* The widget is mounted and solving on its own; all that is left is to
           wait for its callback. Nothing calls execute() — that was the road
           that killed the page. */
        if (mcTsToken) {
          var t = mcTsToken;
          mcTsToken = null;
          trace('turnstile: token ok (was ready)');
          setTimeout(ensureFreshToken, 0);
          resolve(t.token);
          return;
        }
        /* The callback is now the ONLY road a token arrives by, so this wait
           needs its own clock: with execute() gone there is nothing to make a
           stuck challenge fail, and an unbounded wait would hang the submit
           with the button disabled and no way forward. */
        var settled = false;
        var timer = window.setTimeout(function () {
          if (settled) return;
          settled = true;
          state.tokenWait = null;
          /* interaction-only means the widget stays invisible UNLESS a human
             check is wanted — in which case it becomes a visible checkbox and
             waits. Telling that reader to "try again" would be useless advice
             about a control sitting right in front of them, so look at the slot
             and say the true thing. */
          /* The widget lives in the one persistent host now, and it is only
             on screen when Turnstile asked for a human check. */
          var host: any = document.querySelector('.mc-ts-host');
          var showing = !!(host && host.classList.contains('on'));
          trace('turnstile: token timed out' + (showing ? ' (awaiting interaction)' : ''));
          reject(new Error(showing
            ? 'Please complete the verification just above the button, then press it again.'
            : 'Verification is taking a moment. Give it a few seconds and press the button again.'));
        }, MAX);
        state.tokenWait = {
          resolve: function (v: any) {
            if (settled) return;
            settled = true; clearTimeout(timer);
            trace('turnstile: token ok'); mcTsToken = null; resolve(v);
          },
          reject: function (e: any) {
            if (settled) return;
            settled = true; clearTimeout(timer);
            trace('turnstile: token refused'); reject(e);
          },
        };
      }
      run();
    });
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
  function cachedJson(url: any, init: any, ttl: any): Promise<any> {
    if (window.mcStore) {
      return window.mcStore.fetchJson(function (u, i) { return fetchRetry(u, i, [1000, 3000]); },
        url, init, { ttl: ttl, bypass: !!freshOpts() });
    }
    return fetchRetry(url, init, [1000, 3000]).then(function (r) { return r.json(); });
  }

  /* The synchronous half of cachedJson: what do we ALREADY know for this exact
     read? Returns the stored answer (from this tab, or from disk if the reader
     was here before) or null. A view seeds its first render from this, so a
     revisit paints real content in the first frame instead of a placeholder
     that is replaced a moment later — the "it was already there" feel.
     Null whenever the bundle is absent or nothing is stored, so every caller
     falls back to its ordinary loading state. */
  function peekJson(url: any, init?: any): any {
    try {
      var st: any = window.mcStore;
      if (!st || !st.peek || !st.keyFor) return null;
      if (freshOpts()) return null;      // the reader just wrote: never show them stale
      var hit = st.peek(st.keyFor(url, init));
      return hit ? hit.json : null;
    } catch (e) { return null; }
  }

  function load() {
    var list = section.querySelector('.comments-list') as HTMLElement;
    fetchRetry(API + '?page=' + encodeURIComponent(pageKey()) + freshParam('&'), freshOpts(), [1000, 3000],
      function () { setStatus('Network hiccup, retrying...'); })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok) throw new Error(d.error || 'failed');
        state.anonAllowed = !!d.anon;
        renderIdentity();
        list.textContent = '';
        d.comments.forEach(function (c: any) { list.appendChild(commentNode(c, false, { page: pageHref() })); });
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
  /* Authenticate the live socket for this member so DM/notif pushes arrive. */
  function enableMemberLive() {
    /* Bring last visit's pages back into the store the moment the identity is
       known — before any view renders, so a revisit paints real content in its
       first frame instead of a placeholder. Keyed by identity, and idempotent,
       so every road that lands here (boot, sign-in, key import) is covered and
       only the first one does work. */
    try { if (state.myHash && window.mcStore && window.mcStore.hydrate) window.mcStore.hydrate(state.myHash); } catch (e) { /* no bundle: memory only */ }
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
    /* Already fetched for this identity on this page: reuse the answer rather
       than paying a round trip on every navigation. window.mcPrefs outlives the
       boot, so this boot's state is seeded from it directly. */
    if (mcPrefsFor === state.key && window.mcPrefs) { state.prefs = window.mcPrefs; return; }
    mcPrefsFor = state.key;
    var prefsForKey = state.key;
    fetch(API + '/prefs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: state.key }) })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        /* A refusal must not be remembered as done, or the reader would go the
           whole page without their prefs and never retry. */
        if (!d || !d.ok) { if (mcPrefsFor === prefsForKey) mcPrefsFor = null; return; }
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
      .catch(function () { if (mcPrefsFor === prefsForKey) mcPrefsFor = null; });
  }

  /* Which of the site's own writings have a comments section open, and whether
     journal articles do — the worker's word, off the same cached /config read
     as socialCfg() (no extra request). Null when unreachable, or when the
     worker predates the switches: unknown reads as closed. */
  function commentsCfg(): Promise<{ pages: string[]; journal: boolean } | null> {
    return cachedJson(API + '/config', undefined, 300000)
      .then(function (d: any) {
        if (!d || !d.ok || !d.comments) return null;
        return { pages: Array.isArray(d.comments.pages) ? d.comments.pages : [], journal: d.comments.journal === true };
      })
      .catch(function () { return null; });
  }

  /* ================= 1v1 voice calls =================
     The ENGINE lives in the shell bundle now (app/call.ts, 2026-08-03) so a
     receiver rings on ANY page — not just the ones this client boots on, and
     not subject to this boot's teardown cycle. This file keeps only the 📞
     buttons, which delegate to window.mcCall.place(), and the /config gate
     that decides whether to render them. */
  /* Does this reader need to solve a challenge at all? Shares mcStore's cached
     /config with mediaCfg/socialCfg, so it costs no extra request. Advisory:
     the server decides on every write, and refuses a client that guessed. */
  function tsSkipCfg(): Promise<boolean> {
    return cachedJson(API + '/config', undefined, 300000)
      .then(function (d: any) { return !!(d && d.ok && d.turnstile && d.turnstile.skip_established); })
      .catch(function () { return false; });   // unknown: behave as before
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

  /* The placeholder every view stands up while it waits: a spinner, centred in
     the space the content will fill. It replaced shaped grey blocks, which the
     owner reported reading as "no spinner" on exactly the screens that had
     them — a grey block looks like content that failed, a spinner looks like
     work in progress. The 180ms fade-in (styles/main.css .mc-load) means a fast
     load never flickers one, at no cost to the content. */
  function skeleton(kind?: string) {
    var wrap = el('div', 'mc-load' + (kind === 'short' ? ' mc-load-sm' : ''));
    wrap.setAttribute('role', 'status');
    wrap.setAttribute('aria-label', 'Loading');
    return wrap;
  }

  /* Clear a container and stand a skeleton in it — the `node.textContent =
     'Loading…'` sites, which is how most of this file announced a wait. */
  /* Where the words carry information a bare ring cannot — which text is being
     fetched, which file is downloading — keep them and put the spinner beside
     them rather than replacing them with a shape that says less. */
  function loadingLine(text: string, cls?: string) {
    var p = el('p', cls || 'comments-status');
    p.appendChild(el('span', 'mc-load-in'));
    p.appendChild(document.createTextNode(text));
    p.setAttribute('role', 'status');
    return p;
  }

  /* An action that answers nothing while it is in flight reads as ignored, and
     the reader taps again. `busy` is the general answer for the ones that
     cannot be optimistic: it disables the control and shows a ring in place of
     its label, restoring both however the promise settles — including on a
     throw, which is where a hand-rolled version usually leaves a control dead. */
  /* Leave a named trace before anything that unloads or replaces the page. The
     ring already recorded THAT the page went; a live report showed it could not
     say WHY, which is the only part that matters when a submit disappears. */
  function trace(why: string) {
    try { if (window.mcCrumb) window.mcCrumb(why); } catch (e) { /* diagnosis only */ }
  }

  /* Every hop the app makes for the reader. A bare `location.href` is a full
     document load — the white flash, the lost scroll, the torn-down live
     socket — and the app took that road after posting, from the member
     picker, from the profile's Direct Message button and half a dozen other
     places. The shell's soft navigation is the road; without the shell
     (no bundle) the ordinary load is still correct. */
  function go(href: string, replace?: boolean) {
    if (window.mcNav) { window.mcNav(href, replace); return; }
    if (replace) location.replace(href); else location.href = href;
  }

  function busy(el: any, p: Promise<any>) {
    if (!el || el.mcBusy) return p;
    el.mcBusy = true;
    var was = el.textContent;
    var wasDisabled = !!el.disabled;
    el.textContent = '';
    el.appendChild(el2Spin());
    if ('disabled' in el) el.disabled = true;
    function done() {
      el.mcBusy = false;
      el.textContent = was;
      if ('disabled' in el) el.disabled = wasDisabled;
    }
    return p.then(function (v: any) { done(); return v; },
      function (e: any) { done(); throw e; });
  }
  function el2Spin() { return el('span', 'mc-load-in'); }

  function skelInto(node: any, kind?: string) {
    node.textContent = '';
    node.appendChild(skeleton(kind));
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
  function myPostCount() { try { return (state.profile && state.profile.posts) || 0; } catch (e) { return 0; } }

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
         and Profile.

         All of it sits behind the social switch. Off, this page is one the site
         never had — no explanation to probe, matching the worker's own refusals.
         The mirror answers instantly when it already says off (so there is never
         a flash of feed); otherwise /config decides before anything renders —
         one edge-cached GET, usually already in mcStore's per-URL cache. */
      var fpost = params.get('post');
      if (!socialRead()) return viewNoSuchPage();
      section.appendChild(el('p', 'comments-status', 'Loading…'));
      socialCfg().then(function (on: boolean) {
        section.textContent = '';
        if (!on) return viewNoSuchPage();
        if (fpost) return viewPost(Number(fpost));
        if (!isMember()) return viewJoin('see and post to the community feed');
        return viewFeed();
      });
      return;
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
      case 'Dm': go('messages.html?dm=' + encodeURIComponent(r.s) + location.hash, true); return;
      case 'Inbox': go('messages.html', true); return;
      case 'Me': go('profile.html', true); return;
      case 'Profile': go('profile.html?u=' + encodeURIComponent(r.s), true); return;
      case 'Merecat': go('merecat-ai.html' + (params.get('chat') ? '?chat=' + encodeURIComponent(params.get('chat') as string) : ''), true); return;
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
      case 'Feed': go('feed.html' + location.hash, true); return;
      case 'Post': go('feed.html?post=' + encodeURIComponent(r.s) + location.hash, true); return;
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

  function startBoard() {
    section.setAttribute('data-nosnippet', '');
    collectAltIps();
    /* Refresh the social-switch mirror on every platform page (it shares
       mcStore's /config read with mediaCfg/callsCfg, so it costs no request),
       keeping the shell's Feed tab honest wherever the reader goes next. */
    socialCfg();
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

  /* The comments widget itself — title + RSS, the list, the composer —
     appended into `host`: the page's own section on an article page, or the
     wrapper the journal view builds under an article. Keyed by pageKey(); every
     helper it leans on finds its nodes by class under `section`, which the host
     is inside. The caller has resolved the identity (state.myHash) already. */
  function mountComments(host: HTMLElement) {
    var feedUrl = API + '/feed?page=' + encodeURIComponent(pageKey());
    /* One feed link per document: a soft hop between journal articles mounts
       again, and the head is not swapped, so the last mount's link goes first. */
    var prior = document.head.querySelector('link[rel="alternate"][title="Comments feed"]');
    if (prior) prior.remove();
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
    host.appendChild(title);
    host.appendChild(el('div', 'comments-list'));
    host.appendChild(el('p', 'comments-status', 'Loading comments...'));

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
    attachDraft(textarea, 'page:' + pageKey());
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
    host.appendChild(form);

    renderIdentity();
    renderButtons();
    load();

    /* Re-render the buttons whenever identity changes. Cheapest hook: watch
       the identity box for the re-renders triggered above. */
    new MutationObserver(function () { renderButtons(); })
      .observe(form.querySelector('.comment-identity'), { childList: true });
    /* The page comment form carries a .ts-slot, so the focus net covers it;
       loading a page mounts nothing. */
  }

  /* An article page's boot: the section stands only if the admin has opened it
     for THIS page. /config says which (one edge-cached read, shared with every
     other *Cfg() through mcStore); a page not listed mounts nothing at all — no
     widget, no comments read, a page that never had a section. The worker
     refuses the page regardless; this only spares the read. Unknown (config
     unreachable, or a worker without the field) reads as closed too. */
  function start() {
    if (state.started) return;
    state.started = true;
    collectAltIps();

    /* Tell search engines this block is visitor content: keep it out of
       snippets, and never let it read as the site's own words. */
    section.setAttribute('data-nosnippet', '');

    commentsCfg().then(function (cfg) {
      if (!cfg || cfg.pages.indexOf(pageKey()) === -1) return;
      var ready = state.key ? sha256hex(state.key) : Promise.resolve('');
      ready.then(function (h) {
        state.myHash = h;
        enableMemberLive();
        mountComments(section);
        loadMyProfile();
        dmUnreadCheck();
        notifUnreadCheck();
      });
    });
  }
  /* ---- Wave F: the feature modules, installed per boot ---- */
  Object.assign(B, { API, BOARD, NACL_SRC, appConfirm, asset, authorNode, badgeChanged, bootSig, browserTz, busy, cachedJson, clampBody, clearKey, collectAltIps, crumb, displayName, el, enableMemberLive, fetchRetry, fillBody, fmtDateTime, fmtSecs, fmtTimeCompact, freshOpts, freshParam, getToken, go, isSharedV4Client, load, loadingLine, loginToInteract, makeKey, markThreadRead, mcDmBlobGet, mcDmBlobPut, mcDmBlobs, mountComments, myPostCount, pageBar, pageHref, pageKey, rankLine, readEase, readMark, readThrottled, route, section, setKey, sha256hex, skelInto, skeleton, stale, stampFresh, state, trace, warmToken });
  const mods = [installComposer(B), installProfile(B), installBoard(B), installWall(B), installDm(B), installMerecat(B), installAdmin(B)];
  for (const m of mods) Object.assign(B, m.exports);
  ADMIN_HASHES = B.ADMIN_HASHES;
  BLOCK_CONFIRM = B.BLOCK_CONFIRM;
  CATS = B.CATS;
  MERECAT_API = B.MERECAT_API;
  MERECAT_BOT_HASH = B.MERECAT_BOT_HASH;
  MUTED_STORE = B.MUTED_STORE;
  NOTIF_CACHE = B.NOTIF_CACHE;
  adminProfileEditor = B.adminProfileEditor;
  annotateMeta = B.annotateMeta;
  armBoardForm = B.armBoardForm;
  attachAuthorPicker = B.attachAuthorPicker;
  attachDraft = B.attachDraft;
  attachMentions = B.attachMentions;
  blockedOut = B.blockedOut;
  boardButtons = B.boardButtons;
  boardPost = B.boardPost;
  bookmarkToggle = B.bookmarkToggle;
  buildBoardForm = B.buildBoardForm;
  catByKey = B.catByKey;
  commentNode = B.commentNode;
  dmB64uEnc = B.dmB64uEnc;
  dmCacheSet = B.dmCacheSet;
  dmLabel = B.dmLabel;
  dmScore = B.dmScore;
  dmSearchBox = B.dmSearchBox;
  dmSeenLabel = B.dmSeenLabel;
  dmUnreadCheck = B.dmUnreadCheck;
  emojiToken = B.emojiToken;
  ensureEmojiStyles = B.ensureEmojiStyles;
  ensureNacl = B.ensureNacl;
  faithLabel = B.faithLabel;
  getMuted = B.getMuted;
  identityAction = B.identityAction;
  indexSearchBox = B.indexSearchBox;
  isAdmin = B.isAdmin;
  isBlocked = B.isBlocked;
  isMember = B.isMember;
  isMuted = B.isMuted;
  keyFromFragment = B.keyFromFragment;
  keyNudge = B.keyNudge;
  loadMyProfile = B.loadMyProfile;
  loginWithKey = B.loginWithKey;
  mdEditor = B.mdEditor;
  mintIdentity = B.mintIdentity;
  myDmKeypair = B.myDmKeypair;
  notifCacheSet = B.notifCacheSet;
  notifUnreadCheck = B.notifUnreadCheck;
  permalinkFor = B.permalinkFor;
  postMenu = B.postMenu;
  profileHref = B.profileHref;
  quoteInto = B.quoteInto;
  renderButtons = B.renderButtons;
  renderIdentity = B.renderIdentity;
  renderProfile = B.renderProfile;
  scriptureDecor = B.scriptureDecor;
  searchSnippet = B.searchSnippet;
  selectionInPost = B.selectionInPost;
  setBlock = B.setBlock;
  setStatus = B.setStatus;
  socialCfg = B.socialCfg;
  socialRead = B.socialRead;
  startEdit = B.startEdit;
  syncMutedUp = B.syncMutedUp;
  toggleMute = B.toggleMute;
  topicAdminCorner = B.topicAdminCorner;
  truncate = B.truncate;
  viewAdminHome = B.viewAdminHome;
  viewAdmins = B.viewAdmins;
  viewAudit = B.viewAudit;
  viewCat = B.viewCat;
  viewDiscordHooks = B.viewDiscordHooks;
  viewDm = B.viewDm;
  viewFeed = B.viewFeed;
  viewInbox = B.viewInbox;
  viewIndex = B.viewIndex;
  viewIpBans = B.viewIpBans;
  viewJoin = B.viewJoin;
  viewJournal = B.viewJournal;
  viewJournalArticle = B.viewJournalArticle;
  viewMerecat = B.viewMerecat;
  viewMerecatAdmin = B.viewMerecatAdmin;
  viewMerecatThread = B.viewMerecatThread;
  viewMerecatThreads = B.viewMerecatThreads;
  viewNoSuchPage = B.viewNoSuchPage;
  viewNotifications = B.viewNotifications;
  viewPlatformSettings = B.viewPlatformSettings;
  viewPost = B.viewPost;
  viewProfile = B.viewProfile;
  viewProfileByHandle = B.viewProfileByHandle;
  viewRecent = B.viewRecent;
  viewSaved = B.viewSaved;
  viewSearch = B.viewSearch;
  viewShadowbans = B.viewShadowbans;
  viewTopic = B.viewTopic;
  viewUsage = B.viewUsage;
  viewUsers = B.viewUsers;
  wallMediaNode = B.wallMediaNode;
  watchToggle = B.watchToggle;
  for (const m of mods) m.bind();
  for (const m of mods) m.run();

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
    quoteGrab: function (c: any) { B.quotedSelection = selectionInPost(c); },
    quoteTake: function (c: any, quoteCtx: any) {
      var excerpt = B.quotedSelection || truncate(c.body, 400);
      B.quotedSelection = '';
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
    peekJson: peekJson,
    dmSearchBox: dmSearchBox, dmLabel: dmLabel, dmSeenLabel: dmSeenLabel,
    dmCacheSet: dmCacheSet, dmUnreadCheck: dmUnreadCheck, markThreadRead: markThreadRead,
    mintIdentity: mintIdentity, loginWithKey: loginWithKey,
    /* admin read/observe cluster (Wave C-reads 3) */
    MERECAT_API: MERECAT_API,
    onProfile: function (cb: any) { B.profileWaiters.push(cb); },
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
