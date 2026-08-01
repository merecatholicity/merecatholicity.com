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
