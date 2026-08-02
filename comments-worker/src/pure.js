/* comments-worker/src/pure.js — pure, dependency-free worker helpers extracted
   from index.js so they can be unit-tested in plain Node (index.js itself can't
   be imported outside workerd: it imports `cloudflare:workers`). These are the
   security-critical bits worth guarding directly — IP/ban-key normalization and
   the back-room privacy predicate — so a change that would silently let a ban be
   evaded or leak the admins-only room fails a test, not production.

   Nothing here touches env, D1, R2, crypto, or the network. index.js imports
   these back; behavior is byte-identical to when they lived inline. Tests:
   tests/worker/pure.test.mjs. */

/* ---- IP normalization. A dual-stack user carries both an IPv4 and an IPv6
   address, and their IPv6 interface identifier rotates daily (SLAAC privacy
   extensions) while the /64 the ISP delegates stays fixed. So we ban and match
   on a normalized key: the v4 address as-is, or the v6 /64 prefix. ---- */

export function ipFamily(ip) {
  const s = String(ip || '');
  if (s.indexOf(':') !== -1) return 6;
  if (s.indexOf('.') !== -1) return 4;
  return 0;
}

/* The eight hextets of a v6 address, each padded to four nibbles, or null. */
export function ipv6Groups(ip) {
  let s = String(ip || '').trim().toLowerCase().replace(/^\[/, '').replace(/\]$/, '').replace(/%.*$/, '');
  if (s.indexOf(':') === -1) return null;
  const dbl = s.indexOf('::');
  let head, tail;
  if (dbl !== -1) {
    head = s.slice(0, dbl) ? s.slice(0, dbl).split(':') : [];
    tail = s.slice(dbl + 2) ? s.slice(dbl + 2).split(':') : [];
  } else {
    head = s.split(':');
    tail = [];
  }
  const fill = 8 - head.length - tail.length;
  if (fill < 0) return null;
  const groups = head.concat(Array(fill).fill('0'), tail);
  if (groups.length !== 8) return null;
  for (const g of groups) if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
  return groups.map((g) => g.padStart(4, '0'));
}

/* Canonical /64 prefix, e.g. 2605:59ca:39db:4308::/64, or null. */
export function ipv6Prefix64(ip) {
  const g = ipv6Groups(ip);
  if (!g) return null;
  return g.slice(0, 4).map((h) => h.replace(/^0+(?=.)/, '')).join(':') + '::/64';
}

/* All 32 nibbles of a v6 address with no separators, for the .ip6.arpa name. */
export function ipv6Full(ip) {
  const g = ipv6Groups(ip);
  return g ? g.join('') : null;
}

/* The value stored in and matched against ip_bans: v4 verbatim, v6 as /64. */
export function ipKey(ip) {
  const fam = ipFamily(ip);
  if (fam === 4) return String(ip).trim();
  if (fam === 6) return ipv6Prefix64(ip) || String(ip).trim();
  return String(ip || '').trim();
}

/* Turn an admin-supplied string into a ban key: a raw address is normalized,
   an already-stored v6 /64 key passes through so unbanning it still matches. */
export function toBanKey(s) {
  s = String(s || '').trim();
  if (looksLikeIp(s)) return ipKey(s);
  if (/^[0-9a-f:]+::\/64$/i.test(s)) return s.toLowerCase();
  return null;
}

/* Carrier-grade NAT (100.64.0.0/10) is shared by many customers, so a v4 ban
   there can hit innocents; the drawer flags it before the admin commits. */
export function isSharedV4(ip) {
  const m = /^(\d{1,3})\.(\d{1,3})\./.exec(String(ip || ''));
  if (!m) return false;
  return +m[1] === 100 && +m[2] >= 64 && +m[2] <= 127;
}

/* The reverse-DNS query name for an address, or null. */
export function reverseDnsName(ip) {
  const fam = ipFamily(ip);
  if (fam === 4) {
    const p = String(ip).trim().split('.');
    if (p.length !== 4) return null;
    return p.reverse().join('.') + '.in-addr.arpa';
  }
  if (fam === 6) {
    const full = ipv6Full(ip);
    if (!full) return null;
    return full.split('').reverse().join('.') + '.ip6.arpa';
  }
  return null;
}

export function looksLikeIp(s) {
  return /^[0-9a-fA-F:.]{3,45}$/.test(s) && (s.indexOf('.') !== -1 || s.indexOf(':') !== -1);
}

/* The back-room privacy gate for live events, in ONE place: nothing whose cat is
   the admins-only room (or whose scopes name it) ever crosses the anonymous
   board socket. Every emit path runs through this, so a future emit site cannot
   leak the back room by forgetting a local guard. A subscriber fan-out
   (webhook/Discord/etc.) would hook in here too, once, without touching any
   forum handler. */
export function boardEventPublic(event) {
  return !!event && event.cat !== 'adminsonly' &&
    !(Array.isArray(event.scopes) && event.scopes.includes('cat:adminsonly'));
}

/* The WebSocket subscription allowlist — SECURITY-critical: it decides which
   scopes a socket may listen on, and it is the ONLY thing stopping a member from
   subscribing to someone else's private events. Allowed: 'board:index'; a real
   'cat:<key>' (never the admins-only back room); 'topic:<positive int>';
   'presence:<64hex>' (anyone may watch anyone's online state); 'feed:global' (the
   public feed channel); and the PRIVATE 'user:<hash>' ONLY when the socket
   authenticated as that exact hash (`me`). Anything else is dropped, at most 5
   kept. `boardCats` is the worker's BOARD_CATS (passed in so this stays pure). */
export function sanitizeScopes(raw, me, boardCats) {
  if (!Array.isArray(raw)) return [];
  const cats = Array.isArray(boardCats) ? boardCats : [];
  const out = [];
  for (const s of raw) {
    if (typeof s !== 'string' || out.length >= 5) continue;
    if (s === 'board:index') { out.push(s); continue; }
    if (s.startsWith('cat:')) {
      const k = s.slice(4);
      if (k !== 'adminsonly' && cats.includes(k)) out.push(s);
      continue;
    }
    if (/^topic:[1-9][0-9]*$/.test(s)) { out.push(s); continue; }
    if (s.startsWith('presence:')) {
      const h = s.slice(9);
      if (/^[0-9a-f]{64}$/.test(h)) out.push(s);   // anyone may watch anyone's online state
      continue;
    }
    if (s === 'feed:global') { out.push('feed:global'); continue; }   // the public feed's live channel
    if (s.startsWith('user:')) {
      const h = s.slice(5);
      if (me && h === me && /^[0-9a-f]{64}$/.test(h)) out.push(s);   // only your own
    }
  }
  return out;
}

/* ================= Discord webhook helpers (pure) =================
   isDiscordWebhook is a SECURITY validator: only a genuine Discord webhook
   endpoint is ever accepted, so a corrupted or hostile app_setting can never
   make the worker POST member content to an arbitrary host. discordSnippet
   turns a post body into a safe one-embed excerpt (control chars stripped so our
   highlight sentinels never reach Discord; capped at a comfortable length). */
export function isDiscordWebhook(u) {
  if (typeof u !== 'string') return false;
  return /^https:\/\/(?:discord|discordapp)\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+$/.test(u.trim());
}

/* ================= Per-feed Discord subscriptions (pure) =================
   parseFeedScope turns one of OUR feed URLs — the exact thing an admin pastes
   when creating a per-feed Discord subscription — into the normalized trigger
   scope a fresh post is matched against. It accepts only our /api/comments/feed
   endpoint (absolute or relative) and reads the same selectors handleFeed serves:
     ?topic=<id>   -> 'topic:<id>'   (a single thread: fires on its replies)
     ?cat=<key>    -> 'cat:<key>'    (a board category: topics + replies)
     ?page=<page>  -> 'page:<page>'  (one article page's comments)
   Anything else (a non-feed URL, a bogus selector, an external host) returns null
   so the add is refused — the worker only ever fans out our own board activity.
   Pure + tested because it is the gate on what an admin can subscribe to. */
export function parseFeedScope(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s) return null;
  let u;
  try {
    /* Relative paste ("/api/comments/feed?topic=219") resolves against a
       throwaway base; an absolute paste keeps its own host. */
    u = new URL(s, 'https://merecatholicity.com');
  } catch (e) { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (u.pathname.replace(/\/+$/, '') !== '/api/comments/feed') return null;
  const topic = u.searchParams.get('topic');
  if (topic != null && /^\d+$/.test(topic) && Number(topic) > 0) {
    return 'topic:' + Number(topic);
  }
  const cat = u.searchParams.get('cat');
  if (cat != null) {
    const key = cat.trim().toLowerCase();
    if (/^[a-z0-9-]{1,40}$/.test(key)) return 'cat:' + key;
    return null;
  }
  const page = u.searchParams.get('page');
  if (page != null) {
    const p = page.trim();
    if (/^\/[A-Za-z0-9._/-]{1,120}$/.test(p)) return 'page:' + p;
    return null;
  }
  return null;
}

/* A human label for a scope, used in the admin list and the Discord embed footer
   so a subscription reads plainly ("Topic #219", "Category: general"). */
export function scopeLabel(scope) {
  if (typeof scope !== 'string') return '';
  if (scope.indexOf('topic:') === 0) return 'Topic #' + scope.slice(6);
  if (scope.indexOf('cat:') === 0) return 'Category: ' + scope.slice(4);
  if (scope.indexOf('page:') === 0) return 'Page: ' + scope.slice(5);
  return scope;
}

/* ================= Shadow ban (global mute) — read filter =================
   shadowExcl builds the ONE SQL fragment that hides a shadowbanned identity's
   public content from every other reader. Appended to a query's WHERE, it drops
   rows whose <alias>.author_hash is in the shadowbans table. SECURITY/behaviour
   note: this is what makes the mute real, so a typo (wrong alias, wrong table,
   dropped NOT) would silently un-mute everyone — hence it is pure and tested.
   The per-call subquery alias (sb_<alias>) lets two of these coexist in one
   query, e.g. a reply AND its topic owner. */
export function shadowExcl(alias) {
  return 'NOT EXISTS (SELECT 1 FROM shadowbans sb_' + alias +
    ' WHERE sb_' + alias + '.hash = ' + alias + '.author_hash)';
}

export function discordSnippet(body, max = 500) {
  let s = String(body == null ? '' : body)
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '')   // control chars, keep \n (U+000A)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (s.length > max) s = s.slice(0, max - 1).trimEnd() + '\u2026';
  return s;
}
