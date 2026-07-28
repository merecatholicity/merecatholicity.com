/* Comments handler. Same-origin API on /api/comments*. A commenter's whole
   account is a random client-side key; the server stores only SHA-256(key),
   so there is nothing here to leak. Turnstile gates every write, the
   rate-limit binding throttles by IP, and Llama Guard screens the text
   (flagged or unscreenable comments are held pending, never dropped).
   The only secret is TURNSTILE_SECRET, the Turnstile server key. */

const PAGES = [
  '/book.html',
  '/charting-communions.html',
  '/free-churches.html',
  '/objections.html',
  '/credo.html',
  '/lex-orandi.html',
  '/about.html',
];

/* The Catholicity Board. A category is a virtual page key, a topic is a
   titled comment with no parent, a reply is a comment whose parent is the
   topic. Everything else, identity, screening, limits, moderation, is the
   one pipeline all comments share. Keys must match CATS in comments.js. */
const BOARD_CATS = ['pub', 'news', 'offtopic', 'theology', 'philosophy', 'history', 'indoeuropean', 'rc', 'eo', 'lutheran', 'anglican', 'presbyterian', 'prot'];

function boardKey(raw) {
  const m = /^board:([a-z]+)$/.exec(String(raw || ''));
  return m && BOARD_CATS.includes(m[1]) ? raw : null;
}

const SITE = 'https://merecatholicity.com';
const MAX_BODY = 4000;
const MAX_TITLE = 120;
/* Known-IPs retention: the fingerprint drawer shows addresses seen inside
   IP_SHOW_DAYS, and the monthly cron deletes rows idle past IP_KEEP_DAYS.
   Banned keys are exempt from both, so a standing ban never loses its row. */
const IP_SHOW_DAYS = 14;
const IP_KEEP_DAYS = 30;
/* Soft-deleted comments vanish from view at once but linger as rows; the
   monthly cron hard-removes any older than DELETED_KEEP_DAYS. The prior
   month's backup, kept ninety days, still holds anything just removed. */
const DELETED_KEEP_DAYS = 30;
/* Read notifications are swept from the store after this many days; the badge
   and list only ever care about the recent and the unread. */
const NOTIFICATIONS_KEEP_DAYS = 30;
const NOTIF_PER_PAGE = 20;
/* The faith declaration every member picks at signup: one of three, stored as
   a short code, its display wording owned by the client. Kept in step with the
   FAITH map in comments.js. */
const FAITHS = ['nicene', 'indo-european', 'seeker'];
function cleanFaith(raw) {
  const v = String(raw || '').trim();
  return FAITHS.includes(v) ? v : null;
}
const CONTROL_RE = /[\u0000-\u0008\u000B-\u001F\u007F]/;

/* Must stay identical to the lists in comments.js, or the name in the
   notification email will not match the name on the page. */
const ADJ = ['Patient','Quiet','Steadfast','Humble','Gentle','Sober','Watchful','Earnest',
  'Merry','Plain','Hidden','Upright','Ancient','Early','Golden','Green',
  'Grey','Amber','Ivory','Deep','Broad','High','Still','Bright',
  'Clear','Kind','Mild','Firm','True','Swift','Careful','Cheerful',
  'Constant','Modest','Peaceful','Prudent','Silent','Simple','Sturdy','Temperate'];
const NOUN = ['Cedar','Harbor','Meadow','River','Garden','Orchard','Bridge','Lantern',
  'Anchor','Well','Spring','Stone','Oak','Olive','Vine','Wheat',
  'Barley','Dove','Sparrow','Heron','Candle','Bell','Tower','Gate',
  'Path','Field','Hill','Valley','Brook','Shore','Island','Harvest',
  'Vineyard','Cypress','Juniper','Almond','Fig','Palm','Elm','Ash'];

function displayName(hash) {
  const b = (i) => parseInt(hash.slice(i * 2, i * 2 + 2), 16);
  const adj = ADJ[((b(4) << 8) | b(5)) % ADJ.length];
  const noun = NOUN[((b(6) << 8) | b(7)) % NOUN.length];
  return adj + '-' + noun + ' ' + hash.slice(0, 4);
}

const enc = new TextEncoder();

async function sha256hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/* Same-origin API. A cross-origin browser POST always carries an Origin, so
   reject any Origin that is not ours; a missing Origin (non-browser clients,
   some same-origin form posts) is allowed through to the usual gates. */
const ALLOWED_ORIGINS = ['https://merecatholicity.com', 'https://www.merecatholicity.com'];
function originOk(request) {
  const o = request.headers.get('Origin');
  return !o || ALLOWED_ORIGINS.includes(o);
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status: status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function parseOS(ua) {
  if (/iphone|ipad|ipod/i.test(ua)) return 'iOS';
  if (/android/i.test(ua)) return 'Android';
  if (/windows nt/i.test(ua)) return 'Windows';
  if (/mac os x/i.test(ua)) return 'macOS';
  if (/cros/i.test(ua)) return 'ChromeOS';
  if (/linux/i.test(ua)) return 'Linux';
  return ua ? 'Other' : '';
}

/* The bootstrap owners, from the ADMIN_HASHES env var. They are only a SEED: the
   admins table is filled from them the first time the console is opened, and they
   re-enable themselves if the table is ever emptied (a fresh or wiped DB), so the
   board can never be permanently locked out. Once the table holds anyone, it is
   the sole authority and every admin is an equal, removable row, owners included. */
function rootAdmins(env) {
  return (env.ADMIN_HASHES || '').split(',').map((s) => s.trim()).filter((h) => /^[0-9a-f]{64}$/.test(h));
}

/* Admin status is membership in the admins table. The env owners count only
   while the table is still empty (bootstrap), so a live board is governed
   entirely by the table and no admin is privileged over another. */
async function isAdminHash(env, hash) {
  if (!hash) return false;
  const row = await env.DB.prepare('SELECT 1 AS a FROM admins WHERE hash = ?1').bind(hash).first();
  if (row) return true;
  if (rootAdmins(env).includes(hash)) {
    const any = await env.DB.prepare('SELECT 1 AS a FROM admins LIMIT 1').first();
    return !any;
  }
  return false;
}

/* Fill the table from the env owners the first time the console needs it, so
   they show as ordinary, removable rows rather than a hidden privileged set. A
   no-op once anyone is in the table (including after owners are removed). */
async function ensureAdminsSeeded(env) {
  const any = await env.DB.prepare('SELECT 1 AS a FROM admins LIMIT 1').first();
  if (any) return;
  const now = Math.floor(Date.now() / 1000);
  for (const h of rootAdmins(env)) {
    await env.DB.prepare('INSERT OR IGNORE INTO admins (hash, added_by, created_at) VALUES (?1, ?2, ?3)')
      .bind(h, 'seed', now).run();
  }
}

function normalizePage(raw) {
  let p = String(raw || '').split('?')[0].split('#')[0];
  if (!p.startsWith('/')) return null;
  if (p.endsWith('/')) p += 'index.html';
  if (!p.endsWith('.html')) p += '.html';
  return PAGES.includes(p) ? p : null;
}

/* Fails closed. A blip reaching siteverify refuses the post rather than
   crashing the worker or waving the post through unverified. */
async function verifyTurnstile(env, token, ip) {
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token, remoteip: ip }),
    });
    const verdict = await res.json();
    if (!verdict.success) return false;
    /* Defense in depth on top of the sitekey's own domain lock: if a host
       allow-list is configured, the token must have been solved on one. */
    const allow = (env.TURNSTILE_HOSTNAMES || '').split(',').map((h) => h.trim()).filter(Boolean);
    if (allow.length && !allow.includes(verdict.hostname)) {
      console.log(JSON.stringify({ event: 'turnstile_hostname', hostname: verdict.hostname }));
      return false;
    }
    return true;
  } catch (err) {
    console.log(JSON.stringify({ event: 'siteverify_failed', error: String(err) }));
    return false;
  }
}

/* The topic row carries denormalized replies and last_at so category
   pages read topic rows alone. Recomputed, never incremented, from the
   indexed replies whenever anything in the thread mutates, so the numbers
   cannot drift. */
async function refreshTopicStats(env, topicId) {
  await env.DB.prepare(
    'UPDATE comments SET ' +
    "replies = (SELECT COUNT(*) FROM comments r WHERE r.parent_id = ?1 AND r.status = 'live'), " +
    "last_at = (SELECT MAX(c2.created_at) FROM comments c2 WHERE (c2.id = ?1 OR c2.parent_id = ?1) AND c2.status = 'live') " +
    'WHERE id = ?1'
  ).bind(topicId).run();
}

async function isTrusted(env, hash) {
  if (!hash) return false;
  const row = await env.DB.prepare('SELECT 1 AS t FROM trusted WHERE hash = ?1').bind(hash).first();
  return !!row;
}

/* ---- IP normalization. A dual-stack user carries both an IPv4 and an IPv6
   address, and their IPv6 interface identifier rotates daily (SLAAC privacy
   extensions) while the /64 the ISP delegates stays fixed. So we ban and match
   on a normalized key: the v4 address as-is, or the v6 /64 prefix. ---- */

function ipFamily(ip) {
  const s = String(ip || '');
  if (s.indexOf(':') !== -1) return 6;
  if (s.indexOf('.') !== -1) return 4;
  return 0;
}

/* The eight hextets of a v6 address, each padded to four nibbles, or null. */
function ipv6Groups(ip) {
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
function ipv6Prefix64(ip) {
  const g = ipv6Groups(ip);
  if (!g) return null;
  return g.slice(0, 4).map((h) => h.replace(/^0+(?=.)/, '')).join(':') + '::/64';
}

/* All 32 nibbles of a v6 address with no separators, for the .ip6.arpa name. */
function ipv6Full(ip) {
  const g = ipv6Groups(ip);
  return g ? g.join('') : null;
}

/* The value stored in and matched against ip_bans: v4 verbatim, v6 as /64. */
function ipKey(ip) {
  const fam = ipFamily(ip);
  if (fam === 4) return String(ip).trim();
  if (fam === 6) return ipv6Prefix64(ip) || String(ip).trim();
  return String(ip || '').trim();
}

/* Turn an admin-supplied string into a ban key: a raw address is normalized,
   an already-stored v6 /64 key passes through so unbanning it still matches. */
function toBanKey(s) {
  s = String(s || '').trim();
  if (looksLikeIp(s)) return ipKey(s);
  if (/^[0-9a-f:]+::\/64$/i.test(s)) return s.toLowerCase();
  return null;
}

/* Carrier-grade NAT (100.64.0.0/10) is shared by many customers, so a v4 ban
   there can hit innocents; the drawer flags it before the admin commits. */
function isSharedV4(ip) {
  const m = /^(\d{1,3})\.(\d{1,3})\./.exec(String(ip || ''));
  if (!m) return false;
  return +m[1] === 100 && +m[2] >= 64 && +m[2] <= 127;
}

/* The reverse-DNS query name for an address, or null. */
function reverseDnsName(ip) {
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

/* Reverse-DNS one address via Cloudflare DoH JSON. Best-effort: the PTR
   hostname without its trailing dot, or null on any failure or timeout. */
async function ptrLookup(ip) {
  const name = reverseDnsName(ip);
  if (!name) return null;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 1500);
  try {
    const r = await fetch('https://cloudflare-dns.com/dns-query?type=PTR&name=' + encodeURIComponent(name),
      { headers: { accept: 'application/dns-json' }, signal: ctl.signal });
    if (!r.ok) return null;
    const j = await r.json();
    const ans = j && j.Answer && j.Answer.find((a) => a.type === 12);
    return ans && ans.data ? String(ans.data).replace(/\.$/, '') : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/* Record the IPs tied to a posting identity: the verified connection address
   (source 'seen', unspoofable) and, when the browser reached a single-family
   echo, the opposite-family address it reported (source 'claimed'). Stored
   under the normalized key so a ban on any one closes every door. Best-effort:
   a failure here must never break a post that already succeeded. */
async function recordIps(env, hash, connIp, data) {
  if (!hash) return;
  const now = Math.floor(Date.now() / 1000);
  const connFam = ipFamily(connIp);
  const list = [];
  if (connFam) list.push({ ip: connIp, source: 'seen' });
  for (const claimed of [data && data.ipv4, data && data.ipv6]) {
    const c = String(claimed || '').trim();
    if (!c || !looksLikeIp(c)) continue;
    const fam = ipFamily(c);
    if (fam !== 4 && fam !== 6) continue;
    if (connFam && fam === connFam) continue; /* accept only the other family */
    list.push({ ip: c, source: 'claimed' });
  }
  for (const item of list) {
    const key = ipKey(item.ip);
    if (!key) continue;
    try {
      await env.DB.prepare(
        'INSERT INTO identity_ips (hash, ip_key, ip_display, family, source, first_seen, last_seen) ' +
        'VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6) ' +
        'ON CONFLICT(hash, ip_key) DO UPDATE SET last_seen = ?6, ip_display = ?3, ' +
        "source = CASE WHEN identity_ips.source = 'seen' OR excluded.source = 'seen' THEN 'seen' ELSE identity_ips.source END"
      ).bind(hash, key, item.ip, ipFamily(item.ip), item.source, now).run();
    } catch (e) {
      /* swallow: the log must not fail the post */
    }
  }
}

/* The one gate every keyed write passes through: a locked identity, a banned
   IP, or a legacy ban. Returns null when clear, else the reason a keyed
   endpoint hands back as {blocked}. Public reads never call this, so cached
   and anonymous browsing is untouched. */
async function blockedReason(env, hash, ip) {
  const row = await env.DB.prepare(
    "SELECT 'locked' AS r FROM locks WHERE hash = ?1 " +
    "UNION ALL SELECT 'ipban' FROM ip_bans WHERE ip = ?2 " +
    "UNION ALL SELECT 'banned' FROM bans WHERE hash = ?1 LIMIT 1"
  ).bind(hash || '-', ipKey(ip) || '-').first();
  return row ? row.r : null;
}

function blockedJson(reason) {
  return json({ ok: false, blocked: reason, error: 'Interaction is not available.' }, 403);
}

/* Returns {status, verdict}. Anything unscreenable is held pending: the
   failure mode must be a delay for the poster, never a silent publish.
   A trusted author skips the screen entirely, though hold-all, the
   emergency brake, still holds everyone, and bans are checked upstream. */
async function screen(env, body, trusted) {
  const mode = env.MODERATION_MODE || 'ai';
  if (mode === 'hold-all') return { status: 'pending', verdict: 'hold-all' };
  if (trusted) return { status: 'live', verdict: 'trusted' };
  if (mode === 'off') return { status: 'live', verdict: 'off' };
  const links = (body.match(/https?:\/\//gi) || []).length;
  if (links >= 3) return { status: 'pending', verdict: 'links:' + links };
  try {
    const result = await env.AI.run('@cf/meta/llama-guard-3-8b', {
      messages: [{ role: 'user', content: body }],
    });
    const text = String(result && result.response != null ? result.response : '').trim();
    if (text.toLowerCase().startsWith('safe')) return { status: 'live', verdict: 'safe' };
    return { status: 'pending', verdict: text.slice(0, 100) || 'unsafe' };
  } catch (err) {
    console.log(JSON.stringify({ event: 'ai_failed', error: String(err) }));
    return { status: 'pending', verdict: 'ai-error' };
  }
}

/* Where a human clicks to see the comment: the page anchor for site
   comments, the topic view for board posts. */
function viewLink(page, id, parentId) {
  if (page.indexOf('board:') === 0) {
    return SITE + '/community.html?topic=' + (parentId || id) + '#comment-' + id;
  }
  return SITE + page + '#comment-' + id;
}

/* Comment email notifications were retired: the owner watches recent activity
   through the RSS feeds and the Activity Audit page instead. viewLink stays,
   the RSS builder still uses it. */

/* Two browser-cache profiles on the read endpoints. Keyed visitors ask
   for the fresh one with ?fresh=1 and live as they always have. Anonymous
   readers ride a five-minute cache, their repeat views never reaching the
   worker at all. */
function cacheHeader(url) {
  return { 'Cache-Control': 'public, max-age=' + (url.searchParams.get('fresh') ? 60 : 300) };
}

async function handleGet(request, env, url) {
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.READ_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests. Slow down.' }, 429);
  const page = normalizePage(url.searchParams.get('page'));
  if (!page) return json({ ok: false, error: 'Unknown page.' }, 400);
  const rows = await env.DB.prepare(
    'SELECT c.id, c.author_hash, pr.nick, pr.signature, pr.avatar, pr.faith, c.body, c.created_at, c.edited_at ' +
    'FROM comments c LEFT JOIN profiles pr ON pr.hash = c.author_hash ' +
    "WHERE c.page = ?1 AND c.status = 'live' ORDER BY c.id LIMIT 500"
  ).bind(page).all();
  const counts = await postCountsFor(env, (rows.results || []).map((r) => r.author_hash));
  const comments = (rows.results || []).map((r) => Object.assign({}, r, { posts: counts[r.author_hash] || 0 }));
  return json({ ok: true, anon: env.ALLOW_ANON === 'true', comments: comments }, 200,
    cacheHeader(url));
}

async function handlePost(request, env, ctx) {
  let data;
  try {
    data = await request.json();
  } catch {
    return json({ ok: false, error: 'Bad request.' }, 400);
  }

  /* Honeypot field. Bots fill it, people never see it. Pretend success. */
  if (data.website) return json({ ok: true, status: 'live' }, 200);

  /* Throttle before any lookup work, so a flood cannot cost a DB read per
     request before the limit engages. */
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.POST_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many comments at once. Wait a minute and try again.' }, 429);

  /* Three targets share this pipeline: a site page, a new board topic
     under a category, or a reply to an existing topic. */
  let page = null;
  let parentId = null;
  let title = null;
  let topicAuthorHash = null;
  if (data.topic != null) {
    const topicId = Number(data.topic);
    if (!Number.isInteger(topicId) || topicId < 1) return json({ ok: false, error: 'Bad request.' }, 400);
    const topic = await env.DB.prepare(
      "SELECT id, page, locked, author_hash FROM comments WHERE id = ?1 AND parent_id IS NULL AND status = 'live'"
    ).bind(topicId).first();
    if (!topic || !boardKey(topic.page)) return json({ ok: false, error: 'No such topic.' }, 404);
    if (topic.locked) return json({ ok: false, error: 'This topic is locked.' }, 403);
    page = topic.page;
    parentId = topic.id;
    topicAuthorHash = topic.author_hash;
  } else if (data.cat != null) {
    page = boardKey('board:' + String(data.cat));
    if (!page) return json({ ok: false, error: 'Unknown category.' }, 400);
    title = String(data.title || '').replace(/\s+/g, ' ').trim();
    if (title.length < 3) return json({ ok: false, error: 'The topic needs a title.' }, 400);
    if (title.length > MAX_TITLE) return json({ ok: false, error: 'The title is too long.' }, 400);
    if (CONTROL_RE.test(title)) return json({ ok: false, error: 'Bad request.' }, 400);
  } else {
    page = normalizePage(data.page);
    if (!page) return json({ ok: false, error: 'Unknown page.' }, 400);
  }

  if (!String(data.key || '') && env.ALLOW_ANON !== 'true') {
    return json({ ok: false, error: 'Comments here need an identity. Create one with the link above the box.' }, 400);
  }

  const body = String(data.body || '').replace(/\r\n?/g, '\n').trim();
  if (!body) return json({ ok: false, error: 'The comment is empty.' }, 400);
  if (body.length > MAX_BODY) return json({ ok: false, error: 'The comment is too long.' }, 400);
  /* Control characters other than newline and tab are nothing a person types. */
  if (CONTROL_RE.test(body)) return json({ ok: false, error: 'Bad request.' }, 400);

  if (!(await verifyTurnstile(env, String(data.token || ''), ip))) {
    return json({ ok: false, error: 'Verification failed. Reload the page and try again.' }, 403);
  }

  const key = String(data.key || '');
  const authorHash = key ? await sha256hex(key) : null;
  const ua = String(request.headers.get('User-Agent') || '').slice(0, 400);
  const os = parseOS(ua);
  const lang = String(request.headers.get('Accept-Language') || '').slice(0, 100);
  const tzRaw = String(data.tz || '');
  const tz = /^[A-Za-z0-9_+\/-]{1,60}$/.test(tzRaw) ? tzRaw : '';

  const gate = await blockedReason(env, authorHash, ip);
  if (gate) return blockedJson(gate);

  /* A topic's title is screened with its body, one judgment for the pair. */
  const { status, verdict } = await screen(env, title ? title + '\n\n' + body : body,
    await isTrusted(env, authorHash));
  const createdAt = Math.floor(Date.now() / 1000);
  const inserted = await env.DB.prepare(
    'INSERT INTO comments (page, parent_id, title, author_hash, body, status, created_at, ai_verdict, ip, ua, os, tz, lang) ' +
    'VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13) RETURNING id'
  ).bind(page, parentId, title, authorHash, body, status, createdAt, verdict, ip || null, ua || null, os || null,
    tz || null, lang || null).first();

  if (boardKey(page)) {
    const topicId = parentId || inserted.id;
    await refreshTopicStats(env, topicId);
    /* A poster has by definition seen their own post, so advance their read
       stamp to it. Only a live post raises the thread's last_at, so only a live
       post can read back as "new since last visit" to its own author; without
       this, returning to the board index counts your own reply as one unread.
       read_at = createdAt (which is the thread's new last_at) suppresses only
       this post — a strictly later reply by anyone else still reads as new. */
    if (authorHash && status === 'live') {
      await env.DB.prepare(
        'INSERT INTO thread_reads (hash, topic_id, read_at) VALUES (?1, ?2, ?3) ' +
        'ON CONFLICT(hash, topic_id) DO UPDATE SET read_at = ?3'
      ).bind(authorHash, topicId, createdAt).run();
    }
  }

  /* Notifications ride the board only: the author quietly watches the thread,
     @mentions and (for a reply) the topic author and every watcher are told.
     Deferred so a wide fan-out never delays the poster's response. */
  if (boardKey(page)) {
    ctx.waitUntil(deliverNotifications(env, {
      authorHash, status,
      topicId: parentId || inserted.id,
      commentId: inserted.id,
      isReply: parentId != null,
      topicAuthorHash,
      mentions: data.mentions,
    }).catch((e) => console.log(JSON.stringify({ event: 'notify_failed', error: String(e) }))));
  }

  /* @merecat summons the librarian to answer in the thread — live posts by a
     real identity only (a held post that is later approved can be re-summoned
     with the admin /api/merecat/mention lever). Deferred: the reply arrives a
     few seconds behind the post. */
  if (status === 'live' && authorHash && authorHash !== MERECAT_BOT.hash &&
      MERECAT_MENTION_RE.test(body)) {
    ctx.waitUntil(merecatMentionReply(env, inserted.id)
      .catch((e) => console.log(JSON.stringify({ event: 'merecat_mention_failed', error: String(e) }))));
  }

  /* Log the IPs behind this identity for the fingerprint drawer and paired
     bans: the verified connection address, and the other-family address the
     client reported. Best-effort, and never alters the reply. */
  await recordIps(env, authorHash, ip, data);

  /* The faith the member declared at signup rides along with every post; the
     first one to carry it fills the profile, and a later post never overwrites
     a value the member has since edited (COALESCE keeps the standing value). */
  const faith = cleanFaith(data.faith);
  if (authorHash && faith) {
    await env.DB.prepare(
      'INSERT INTO profiles (hash, faith, created_at, updated_at) VALUES (?1, ?2, ?3, ?3) ' +
      'ON CONFLICT(hash) DO UPDATE SET faith = COALESCE(faith, ?2)'
    ).bind(authorHash, faith, createdAt).run();
  }

  /* Carry the poster's own nick, signature, and faith back so their fresh
     comment renders with them at once, before any cache refresh. */
  const prof = authorHash ? await env.DB.prepare('SELECT nick, signature, avatar, faith FROM profiles WHERE hash = ?1').bind(authorHash).first() : null;
  return json({ ok: true, status, comment: { id: inserted.id, title, author_hash: authorHash,
    nick: prof && prof.nick || null, signature: prof && prof.signature || null, avatar: prof && prof.avatar || null,
    faith: prof && prof.faith || null,
    body, created_at: createdAt } }, 200);
}

/* Fan notifications out from a fresh board post. The author always comes to
   watch the thread (even a held post, so approval finds them already subscribed).
   Only a live post tells anyone: each validated @mention gets a 'mention', and a
   reply gives the topic author and every watcher a 'reply', minus the replier and
   anyone already mentioned so no one is told twice for one post. One batch write. */
async function deliverNotifications(env, o) {
  const now = Math.floor(Date.now() / 1000);
  const NOTIF = 'INSERT INTO notifications (recipient_hash, kind, topic_id, comment_id, actor_hash, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)';
  const stmts = [];

  if (o.authorHash && o.authorHash !== MERECAT_BOT.hash) {
    stmts.push(env.DB.prepare('INSERT OR IGNORE INTO watches (hash, topic_id, created_at) VALUES (?1, ?2, ?3)')
      .bind(o.authorHash, o.topicId, now));
  }

  if (o.status === 'live') {
    const mentions = [];
    if (Array.isArray(o.mentions)) {
      for (const m of o.mentions) {
        const h = String(m || '').toLowerCase();
        // the librarian holds no inbox: its hash never receives a notification
        if (/^[0-9a-f]{64}$/.test(h) && h !== o.authorHash && h !== MERECAT_BOT.hash &&
            mentions.indexOf(h) === -1) mentions.push(h);
        if (mentions.length >= 10) break;
      }
    }
    for (const h of mentions) stmts.push(env.DB.prepare(NOTIF).bind(h, 'mention', o.topicId, o.commentId, o.authorHash, now));

    if (o.isReply) {
      const skip = new Set(mentions);
      if (o.authorHash) skip.add(o.authorHash);
      skip.add(MERECAT_BOT.hash);
      const recips = new Set();
      if (o.topicAuthorHash) recips.add(o.topicAuthorHash);
      const rows = await env.DB.prepare('SELECT hash FROM watches WHERE topic_id = ?1').bind(o.topicId).all();
      for (const r of (rows.results || [])) recips.add(r.hash);
      for (const h of recips) {
        if (h && !skip.has(h)) stmts.push(env.DB.prepare(NOTIF).bind(h, 'reply', o.topicId, o.commentId, o.authorHash, now));
      }
    }
  }

  if (stmts.length) await env.DB.batch(stmts);
}

async function handleSelfDelete(request, env) {
  let data;
  try {
    data = await request.json();
  } catch {
    return json({ ok: false, error: 'Bad request.' }, 400);
  }
  const id = Number(data.id);
  const key = String(data.key || '');
  if (!Number.isInteger(id) || id < 1 || !key) return json({ ok: false, error: 'Bad request.' }, 400);
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.POST_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests.' }, 429);
  const authorHash = await sha256hex(key);
  const gate = await blockedReason(env, authorHash, ip);
  if (gate) return blockedJson(gate);
  const isAdmin = await isAdminHash(env, authorHash);
  const row = isAdmin
    ? await env.DB.prepare(
        "UPDATE comments SET status = 'deleted' WHERE id = ?1 AND status != 'deleted' RETURNING page, parent_id"
      ).bind(id).first()
    : await env.DB.prepare(
        "UPDATE comments SET status = 'deleted' WHERE id = ?1 AND author_hash = ?2 AND status != 'deleted' RETURNING page, parent_id"
      ).bind(id, authorHash).first();
  if (!row) return json({ ok: false, error: 'Not yours, or already gone.' }, 403);
  if (boardKey(row.page)) await refreshTopicStats(env, row.parent_id || id);
  return json({ ok: true }, 200);
}

function xmlEscape(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/* RSS 2.0 feed of a page's live comments, so anyone can follow a thread
   with a feed reader and nobody has to hand this site an email address. */
async function handleFeed(request, env, url) {
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.READ_LIMIT.limit({ key: ip });
  if (!success) return new Response('Too many requests.', { status: 429 });
  const cat = url.searchParams.get('cat');
  const topicParam = Number(url.searchParams.get('topic'));
  let page, results, topicRow = null;
  if (Number.isInteger(topicParam) && topicParam > 0) {
    /* A single thread's feed: the topic and its live replies, so anyone
       can follow one conversation, their own included. */
    topicRow = await env.DB.prepare(
      "SELECT id, page, title FROM comments WHERE id = ?1 AND parent_id IS NULL AND status = 'live'"
    ).bind(topicParam).first();
    if (!topicRow || !boardKey(topicRow.page)) return new Response('No such topic.', { status: 404 });
    page = topicRow.page;
    const rows = await env.DB.prepare(
      "SELECT c.id, c.parent_id, c.title, c.author_hash, pr.nick, c.body, c.created_at FROM comments c " +
      "LEFT JOIN profiles pr ON pr.hash = c.author_hash " +
      "WHERE (c.id = ?1 OR c.parent_id = ?1) AND c.status = 'live' ORDER BY c.id DESC LIMIT 50"
    ).bind(topicParam).all();
    results = rows.results;
  } else {
    page = cat ? boardKey('board:' + cat) : normalizePage(url.searchParams.get('page'));
    if (!page) return new Response('Unknown page.', { status: 400 });
    const rows = await env.DB.prepare(
      "SELECT c.id, c.parent_id, c.title, c.author_hash, pr.nick, c.body, c.created_at FROM comments c " +
      "LEFT JOIN profiles pr ON pr.hash = c.author_hash WHERE c.page = ?1 AND c.status = 'live' ORDER BY c.id DESC LIMIT 50"
    ).bind(page).all();
    results = rows.results;
  }
  const items = results.map(function (c) {
    const name = c.nick || (c.author_hash ? displayName(c.author_hash) : 'Anonymous');
    const link = viewLink(page, c.id, c.parent_id);
    const itemTitle = c.title ? c.title
      : topicRow ? name + ' re: ' + topicRow.title
      : name + ' on ' + page;
    return '<item><title>' + xmlEscape(itemTitle) + '</title>' +
      '<link>' + xmlEscape(link) + '</link>' +
      '<guid isPermaLink="true">' + xmlEscape(link) + '</guid>' +
      '<pubDate>' + new Date(c.created_at * 1000).toUTCString() + '</pubDate>' +
      '<description>' + xmlEscape(c.body) + '</description></item>';
  }).join('');
  const isBoard = page.indexOf('board:') === 0;
  const feedTitle = topicRow
    ? topicRow.title + ' - Catholicity Board - merecatholicity.com'
    : isBoard
    ? 'Catholicity Board - ' + page.slice(6) + ' - merecatholicity.com'
    : 'Comments on ' + page + ' - merecatholicity.com';
  const feedLink = topicRow ? SITE + '/community.html?topic=' + topicRow.id
    : isBoard ? SITE + '/community.html?cat=' + page.slice(6) : SITE + page;
  const xml = '<?xml version="1.0" encoding="UTF-8"?>' +
    '<rss version="2.0"><channel>' +
    '<title>' + xmlEscape(feedTitle) + '</title>' +
    '<link>' + xmlEscape(feedLink) + '</link>' +
    '<description>' + xmlEscape(isBoard ? 'Topics and replies' : 'Reader comments on ' + page) + '</description>' +
    items + '</channel></rss>';
  return new Response(xml, {
    status: 200,
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8', 'Cache-Control': 'public, max-age=1800' },
  });
}

/* Author-only editing. The key must hash to the comment's own author,
   admins included only for their own comments. Every edit passes the same
   screen as a new post, or a clean comment could be edited into filth
   after approval, and a flagged edit drops the comment to pending. */
async function handleEdit(request, env, ctx) {
  let data;
  try {
    data = await request.json();
  } catch {
    return json({ ok: false, error: 'Bad request.' }, 400);
  }
  const id = Number(data.id);
  const key = String(data.key || '');
  if (!Number.isInteger(id) || id < 1 || !key) return json({ ok: false, error: 'Bad request.' }, 400);
  const body = String(data.body || '').replace(/\r\n?/g, '\n').trim();
  if (!body) return json({ ok: false, error: 'The comment is empty.' }, 400);
  if (body.length > MAX_BODY) return json({ ok: false, error: 'The comment is too long.' }, 400);
  if (CONTROL_RE.test(body)) return json({ ok: false, error: 'Bad request.' }, 400);
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.POST_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many edits at once. Wait a minute and try again.' }, 429);
  const authorHash = await sha256hex(key);
  const gate = await blockedReason(env, authorHash, ip);
  if (gate) return blockedJson(gate);
  const row = await env.DB.prepare(
    "SELECT page, parent_id, title, ip, ua, os, tz, lang, created_at FROM comments WHERE id = ?1 AND author_hash = ?2 AND status != 'deleted'"
  ).bind(id, authorHash).first();
  if (!row) return json({ ok: false, error: 'Not yours, or already gone.' }, 403);
  const { status, verdict } = await screen(env, body, await isTrusted(env, authorHash));
  const editedAt = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    'UPDATE comments SET body = ?1, status = ?2, ai_verdict = ?3, edited_at = ?4 WHERE id = ?5'
  ).bind(body, status, verdict, editedAt, id).run();
  if (boardKey(row.page)) await refreshTopicStats(env, row.parent_id || id);
  return json({ ok: true, status, edited_at: editedAt }, 200);
}

/* Admin-only view of the logged metadata. The public GET never carries
   these fields; this endpoint demands a key hashing into ADMIN_HASHES. */
/* The user-fingerprint for a single identity (the profile drawer): the latest
   post's captured header, the identity-level trust and lock flags, and every
   known IP with its ban state. Same shape as one per-comment meta row so the
   client builds the identical drawer. */
async function metaForHash(env, hash) {
  const last = await env.DB.prepare(
    'SELECT id, ip, ua, os, tz, lang FROM comments WHERE author_hash = ?1 ORDER BY id DESC LIMIT 1'
  ).bind(hash).first();
  const flags = await env.DB.prepare(
    'SELECT (SELECT 1 FROM trusted WHERE hash = ?1) AS trusted, ' +
    '(SELECT 1 FROM locks WHERE hash = ?1) AS locked'
  ).bind(hash).first();
  /* Only the recent window shows, banned keys always. */
  const ipRows = await env.DB.prepare(
    'SELECT ii.ip_key, ii.ip_display, ii.family, ii.source, ' +
    'CASE WHEN ib.ip IS NULL THEN 0 ELSE 1 END AS banned ' +
    'FROM identity_ips ii LEFT JOIN ip_bans ib ON ib.ip = ii.ip_key ' +
    'WHERE ii.hash = ?1 AND (ii.last_seen >= ?2 OR ib.ip IS NOT NULL) ' +
    'ORDER BY ii.family, ii.last_seen DESC'
  ).bind(hash, Math.floor(Date.now() / 1000) - IP_SHOW_DAYS * 86400).all();
  const identities = {};
  identities[hash] = ipRows.results.map((r) => ({
    ip_display: r.ip_display, ip_key: r.ip_key, family: r.family, source: r.source, banned: r.banned,
  }));
  let ipbanned = 0;
  if (last && last.ip) {
    const b = await env.DB.prepare('SELECT 1 FROM ip_bans WHERE ip = ?1').bind(ipKey(last.ip)).first();
    ipbanned = b ? 1 : 0;
  }
  const row = {
    id: last ? last.id : null,
    ip: last ? last.ip : null, ua: last ? last.ua : null,
    os: last ? last.os : null, tz: last ? last.tz : null, lang: last ? last.lang : null,
    author_hash: hash,
    trusted: flags && flags.trusted ? 1 : 0,
    locked: flags && flags.locked ? 1 : 0,
    ipbanned,
  };
  return json({ ok: true, meta: [row], identities }, 200);
}

async function handleMeta(request, env) {
  let data;
  try {
    data = await request.json();
  } catch {
    return json({ ok: false, error: 'Bad request.' }, 400);
  }
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.READ_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests.' }, 429);
  const key = String(data.key || '');
  if (!key) return json({ ok: false, error: 'Bad request.' }, 400);
  if (!(await isAdminHash(env, await sha256hex(key)))) return json({ ok: false, error: 'No.' }, 403);
  /* A profile asks by identity hash, a page by page name. Same drawer either
     way, so both return { meta: [...], identities: {...} }. */
  const hashParam = String(data.hash || '');
  if (/^[0-9a-f]{64}$/.test(hashParam)) return await metaForHash(env, hashParam);
  const page = normalizePage(data.page) || boardKey(data.page);
  if (!page) return json({ ok: false, error: 'Bad request.' }, 400);
  const rows = await env.DB.prepare(
    'SELECT c.id, c.status, c.ai_verdict, c.ip, c.ua, c.os, c.tz, c.lang, c.author_hash, ' +
    'CASE WHEN t.hash IS NULL THEN 0 ELSE 1 END AS trusted, ' +
    'CASE WHEN lk.hash IS NULL THEN 0 ELSE 1 END AS locked, ' +
    'CASE WHEN ib.ip IS NULL THEN 0 ELSE 1 END AS ipbanned ' +
    'FROM comments c LEFT JOIN trusted t ON t.hash = c.author_hash ' +
    'LEFT JOIN locks lk ON lk.hash = c.author_hash ' +
    'LEFT JOIN ip_bans ib ON ib.ip = c.ip ' +
    'WHERE c.page = ?1 ORDER BY c.id LIMIT 500'
  ).bind(page).all();
  const list = rows.results;

  /* ip_bans now stores v6 as a /64 the raw c.ip will not equal, so recompute
     each comment's banned flag against the normalized key. */
  const commentKeys = [...new Set(list.map((r) => ipKey(r.ip)).filter(Boolean))];
  const bannedSet = new Set();
  if (commentKeys.length) {
    const ph = commentKeys.map((_, i) => '?' + (i + 1)).join(',');
    const b = await env.DB.prepare('SELECT ip FROM ip_bans WHERE ip IN (' + ph + ')').bind(...commentKeys).all();
    for (const x of b.results) bannedSet.add(x.ip);
  }
  for (const r of list) r.ipbanned = bannedSet.has(ipKey(r.ip)) ? 1 : 0;

  /* Every IP tied to each identity on the page, each with its ban state, so the
     drawer can show and ban both families of a dual-stack user together. */
  const hashes = [...new Set(list.map((r) => r.author_hash).filter(Boolean))];
  const identities = {};
  if (hashes.length) {
    const ph = hashes.map((_, i) => '?' + (i + 1)).join(',');
    /* Only the recent window shows, banned keys always. */
    const cutoffPh = '?' + (hashes.length + 1);
    const ipRows = await env.DB.prepare(
      'SELECT ii.hash, ii.ip_key, ii.ip_display, ii.family, ii.source, ' +
      'CASE WHEN ib.ip IS NULL THEN 0 ELSE 1 END AS banned ' +
      'FROM identity_ips ii LEFT JOIN ip_bans ib ON ib.ip = ii.ip_key ' +
      'WHERE ii.hash IN (' + ph + ') AND (ii.last_seen >= ' + cutoffPh + ' OR ib.ip IS NOT NULL) ' +
      'ORDER BY ii.family, ii.last_seen DESC'
    ).bind(...hashes, Math.floor(Date.now() / 1000) - IP_SHOW_DAYS * 86400).all();
    for (const r of ipRows.results) {
      (identities[r.hash] = identities[r.hash] || []).push({
        ip_display: r.ip_display, ip_key: r.ip_key, family: r.family,
        source: r.source, banned: r.banned,
      });
    }
  }
  return json({ ok: true, meta: list, identities }, 200);
}

/* The board index: per-category topic and post counts with last activity. */
async function handleBoardIndex(request, env, url) {
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.READ_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests. Slow down.' }, 429);
  /* One pass: per room, window counts plus the newest post whose thread
     is still live, its title borrowed from the thread. */
  const rows = await env.DB.prepare(
    'SELECT page, author_hash, nick, created_at, title, post_id, topic_id, topics, posts FROM (' +
    '  SELECT c.page, c.author_hash, pr.nick AS nick, c.created_at, c.id AS post_id, ' +
    '         COALESCE(c.title, p.title) AS title, ' +
    '         COALESCE(c.parent_id, c.id) AS topic_id, ' +
    '         COUNT(CASE WHEN c.parent_id IS NULL THEN 1 END) OVER (PARTITION BY c.page) AS topics, ' +
    '         COUNT(*) OVER (PARTITION BY c.page) AS posts, ' +
    '         ROW_NUMBER() OVER (PARTITION BY c.page ORDER BY c.id DESC) AS rn ' +
    '  FROM comments c LEFT JOIN comments p ON p.id = c.parent_id ' +
    '         LEFT JOIN profiles pr ON pr.hash = c.author_hash ' +
    "  WHERE c.page LIKE 'board:%' AND c.status = 'live' " +
    "    AND (c.parent_id IS NULL OR p.status = 'live')" +
    ') WHERE rn = 1'
  ).all();
  const cats = {};
  rows.results.forEach(function (r) {
    cats[r.page.slice(6)] = {
      topics: r.topics,
      posts: r.posts,
      last: r.created_at,
      latest: { topic_id: r.topic_id, id: r.post_id, title: r.title, author_hash: r.author_hash, nick: r.nick, created_at: r.created_at },
    };
  });
  return json({ ok: true, cats }, 200, cacheHeader(url));
}

/* One category page: twenty topics by newest activity, read from the
   denormalized topic rows alone, the replies never scanned. */
const TOPICS_PER_PAGE = 20;
async function handleBoardCat(request, env, url) {
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.READ_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests. Slow down.' }, 429);
  const page = boardKey('board:' + url.searchParams.get('cat'));
  if (!page) return json({ ok: false, error: 'Unknown category.' }, 400);
  const p = Math.min(1000, Math.max(1, Math.floor(Number(url.searchParams.get('p')) || 1)));
  const total = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM comments WHERE page = ?1 AND parent_id IS NULL AND status = 'live'"
  ).bind(page).first();
  const rows = await env.DB.prepare(
    'SELECT c.id, c.title, c.author_hash, pr.nick, c.created_at, c.locked, c.sticky, ' +
    'COALESCE(c.replies, 0) AS replies, COALESCE(c.last_at, c.created_at) AS last, ' +
    "(SELECT MAX(m.id) FROM comments m WHERE (m.id = c.id OR m.parent_id = c.id) AND m.status = 'live') AS last_id " +
    'FROM comments c LEFT JOIN profiles pr ON pr.hash = c.author_hash ' +
    "WHERE c.page = ?1 AND c.parent_id IS NULL AND c.status = 'live' " +
    'ORDER BY COALESCE(c.sticky, 0) DESC, last DESC LIMIT ?2 OFFSET ?3'
  ).bind(page, TOPICS_PER_PAGE, (p - 1) * TOPICS_PER_PAGE).all();
  return json({ ok: true, topics: rows.results, total: total.n, page: p, per: TOPICS_PER_PAGE }, 200, cacheHeader(url));
}

/* A member's own recent forum posts, newest first — the "recent posts" list on a
   profile, so a reader can follow a thinker. The same live-and-forum filter the
   board uses, plus an author clause; a reply borrows its topic's title and links
   to the exact post. Public and cacheable like every board read. */
async function handleAuthorPosts(request, env, url) {
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.READ_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests. Slow down.' }, 429);
  const hash = String(url.searchParams.get('hash') || '');
  if (!/^[0-9a-f]{64}$/.test(hash)) return json({ ok: false, error: 'Bad request.' }, 400);
  const p = Math.min(1000, Math.max(1, Math.floor(Number(url.searchParams.get('p')) || 1)));
  const per = 20;
  const where =
    "WHERE c.author_hash = ?1 AND c.page LIKE 'board:%' AND c.status = 'live' " +
    "AND (c.parent_id IS NULL OR t.status = 'live')";
  const total = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM comments c LEFT JOIN comments t ON t.id = COALESCE(c.parent_id, c.id) ' + where
  ).bind(hash).first();
  const rows = await env.DB.prepare(
    'SELECT c.id AS comment_id, COALESCE(c.parent_id, c.id) AS topic_id, ' +
    'COALESCE(c.title, t.title) AS title, c.page, c.created_at, substr(c.body, 1, 160) AS snippet ' +
    'FROM comments c LEFT JOIN comments t ON t.id = COALESCE(c.parent_id, c.id) ' + where +
    ' ORDER BY c.id DESC LIMIT ?2 OFFSET ?3'
  ).bind(hash, per, (p - 1) * per).all();
  const items = (rows.results || []).map((r) => ({
    comment_id: r.comment_id, topic_id: r.topic_id, title: r.title,
    cat: String(r.page).slice(6), created_at: r.created_at, snippet: r.snippet,
  }));
  return json({ ok: true, items, total: (total && total.n) || 0, page: p, per }, 200, cacheHeader(url));
}

/* A member's live-forum post count (topics always, replies only under a live
   topic) for a batch of hashes at once — the same definition handleAuthorPosts
   totals, so the profile figure and the per-post badge always agree. One grouped
   query for every distinct author on a page drives the rank shown by each post. */
async function postCountsFor(env, hashes) {
  const uniq = [...new Set((hashes || []).filter((h) => /^[0-9a-f]{64}$/.test(h)))];
  const out = {};
  if (!uniq.length) return out;
  const ph = uniq.map((_, i) => '?' + (i + 1)).join(',');
  const rows = await env.DB.prepare(
    'SELECT c.author_hash AS h, COUNT(*) AS n FROM comments c ' +
    'LEFT JOIN comments t ON t.id = COALESCE(c.parent_id, c.id) ' +
    'WHERE c.author_hash IN (' + ph + ") AND c.page LIKE 'board:%' AND c.status = 'live' " +
    "AND (c.parent_id IS NULL OR t.status = 'live') GROUP BY c.author_hash"
  ).bind(...uniq).all();
  uniq.forEach((h) => { out[h] = 0; });
  (rows.results || []).forEach((r) => { out[r.h] = r.n; });
  return out;
}

const SEARCH_PER_PAGE = 20;

/* Turn a user query into a safe FTS5 MATCH: pull out "quoted phrases" and bare
   words, double any embedded quote, and wrap every token in quotes so each is a
   literal term or phrase — no FTS5 operator (- * : ^ NEAR AND OR NOT parentheses)
   can be injected. A bare word matches as a stemmed term; a quoted run matches as
   an adjacency phrase. Capped at ten tokens; empty when nothing usable is left. */
function buildMatch(q) {
  const tokens = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m;
  while ((m = re.exec(String(q || ''))) && tokens.length < 10) {
    const raw = (m[1] !== undefined ? m[1] : m[2]).trim();
    if (raw) tokens.push('"' + raw.replace(/"/g, '""') + '"');
  }
  return tokens.join(' ');
}

/* Full-text search over the FORUM only. Live board rows are filtered in at query
   time, so the FTS index can simply mirror all of comments. Narrows by category
   and by author, ranks by relevance (bm25) or recency, marks matched terms with
   control characters for the client to highlight, and is cacheable like every
   public read. An unknown category or malformed author is dropped, not errored,
   so a stray filter never blanks the results. */
async function handleSearch(request, env, url) {
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.READ_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests. Slow down.' }, 429);
  const qRaw = String(url.searchParams.get('q') || '');
  const match = buildMatch(qRaw);
  const p = Math.min(1000, Math.max(1, Math.floor(Number(url.searchParams.get('p')) || 1)));
  const per = SEARCH_PER_PAGE;
  const empty = { ok: true, items: [], total: 0, page: p, per, q: qRaw };
  if (!match) return json(empty, 200, cacheHeader(url));

  const catPage = boardKey('board:' + (url.searchParams.get('cat') || ''));
  const authorRaw = String(url.searchParams.get('author') || '');
  const author = /^[0-9a-f]{64}$/.test(authorRaw) ? authorRaw : null;
  const order = url.searchParams.get('sort') === 'new' ? 'c.id DESC' : 'bm25(comments_fts)';

  const filters = [];
  const binds = [match];
  if (catPage) { binds.push(catPage); filters.push('AND c.page = ?' + binds.length); }
  if (author) { binds.push(author); filters.push('AND c.author_hash = ?' + binds.length); }
  const where =
    "WHERE comments_fts MATCH ?1 AND c.page LIKE 'board:%' AND c.status = 'live' " +
    "AND (c.parent_id IS NULL OR pt.status = 'live') " + filters.join(' ');

  try {
    const rows = await env.DB.prepare(
      'SELECT c.id AS comment_id, COALESCE(c.parent_id, c.id) AS topic_id, ' +
      'COALESCE(c.title, pt.title) AS title, c.author_hash, pr.nick, c.page, c.created_at, ' +
      "snippet(comments_fts, -1, char(2), char(3), '…', 15) AS snip " +
      'FROM comments_fts JOIN comments c ON c.id = comments_fts.rowid ' +
      'LEFT JOIN comments pt ON pt.id = c.parent_id ' +
      'LEFT JOIN profiles pr ON pr.hash = c.author_hash ' +
      where + ' ORDER BY ' + order + ' LIMIT ?' + (binds.length + 1) + ' OFFSET ?' + (binds.length + 2)
    ).bind(...binds, per, (p - 1) * per).all();
    const totalRow = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM comments_fts JOIN comments c ON c.id = comments_fts.rowid ' +
      'LEFT JOIN comments pt ON pt.id = c.parent_id ' + where
    ).bind(...binds).first();
    const items = (rows.results || []).map((r) => ({
      comment_id: r.comment_id, topic_id: r.topic_id, title: r.title,
      author_hash: r.author_hash, nick: r.nick, cat: String(r.page).slice(6),
      created_at: r.created_at, snip: r.snip,
    }));
    return json({ ok: true, items, total: (totalRow && totalRow.n) || 0, page: p, per, q: qRaw }, 200, cacheHeader(url));
  } catch (e) {
    console.log(JSON.stringify({ event: 'search_failed', error: String(e) }));
    return json(empty, 200, cacheHeader(url));
  }
}

/* One topic with its live replies in order. */
async function handleTopicView(request, env, url) {
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.READ_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests. Slow down.' }, 429);
  const id = Number(url.searchParams.get('id'));
  if (!Number.isInteger(id) || id < 1) return json({ ok: false, error: 'Bad request.' }, 400);
  const topic = await env.DB.prepare(
    "SELECT c.id, c.page, c.title, c.author_hash, pr.nick, pr.signature, pr.avatar, pr.faith, c.body, c.created_at, c.edited_at, c.locked, c.sticky, c.replies " +
    "FROM comments c LEFT JOIN profiles pr ON pr.hash = c.author_hash " +
    "WHERE c.id = ?1 AND c.parent_id IS NULL AND c.status = 'live'"
  ).bind(id).first();
  if (!topic || !boardKey(topic.page)) return json({ ok: false, error: 'No such topic.' }, 404);
  /* Twenty replies a page. A permalink arrives with find=<reply id> and
     one indexed count places it on the right page. */
  let p = Math.min(1000, Math.max(1, Math.floor(Number(url.searchParams.get('p')) || 1)));
  const find = Number(url.searchParams.get('find'));
  if (Number.isInteger(find) && find > 0 && !url.searchParams.get('p')) {
    const pos = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM comments WHERE parent_id = ?1 AND status = 'live' AND id < ?2"
    ).bind(id, find).first();
    p = Math.floor(pos.n / TOPICS_PER_PAGE) + 1;
  }
  const replies = await env.DB.prepare(
    "SELECT c.id, c.author_hash, pr.nick, pr.signature, pr.avatar, pr.faith, c.body, c.created_at, c.edited_at FROM comments c " +
    "LEFT JOIN profiles pr ON pr.hash = c.author_hash " +
    "WHERE c.parent_id = ?1 AND c.status = 'live' ORDER BY c.id LIMIT ?2 OFFSET ?3"
  ).bind(id, TOPICS_PER_PAGE, (p - 1) * TOPICS_PER_PAGE).all();
  /* Each post carries its author's total forum-post count, for the rank the
     client shows under the name. One grouped query for every author on the page. */
  const counts = await postCountsFor(env, [topic.author_hash].concat((replies.results || []).map((r) => r.author_hash)));
  return json({
    ok: true,
    anon: env.ALLOW_ANON === 'true',
    cat: topic.page.slice(6),
    topic: { id: topic.id, title: topic.title, author_hash: topic.author_hash, nick: topic.nick, signature: topic.signature, avatar: topic.avatar, faith: topic.faith || null, body: topic.body, created_at: topic.created_at, edited_at: topic.edited_at, locked: topic.locked ? 1 : 0, sticky: topic.sticky ? 1 : 0, posts: counts[topic.author_hash] || 0 },
    replies: (replies.results || []).map((r) => Object.assign({}, r, { posts: counts[r.author_hash] || 0 })),
    total: topic.replies || 0,
    page: p,
    per: TOPICS_PER_PAGE,
  }, 200, cacheHeader(url));
}

/* Admin-only topic moderation from the page: lock and unlock close and
   reopen a thread to new replies, delete takes the topic down. */
async function handleModerate(request, env) {
  let data;
  try {
    data = await request.json();
  } catch {
    return json({ ok: false, error: 'Bad request.' }, 400);
  }
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.READ_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests.' }, 429);
  const key = String(data.key || '');
  const id = Number(data.id);
  const act = String(data.act || '');
  if (!key || !Number.isInteger(id) || id < 1 || !['lock', 'unlock', 'delete', 'sticky', 'unsticky'].includes(act)) {
    return json({ ok: false, error: 'Bad request.' }, 400);
  }
  if (!(await isAdminHash(env, await sha256hex(key)))) return json({ ok: false, error: 'No.' }, 403);
  const topic = await env.DB.prepare(
    "SELECT id, page FROM comments WHERE id = ?1 AND parent_id IS NULL AND status != 'deleted'"
  ).bind(id).first();
  if (!topic || !boardKey(topic.page)) return json({ ok: false, error: 'No such topic.' }, 404);
  if (act === 'delete') {
    await env.DB.prepare("UPDATE comments SET status = 'deleted' WHERE id = ?1").bind(id).run();
    return json({ ok: true, deleted: true }, 200);
  }
  if (act === 'sticky' || act === 'unsticky') {
    const sticky = act === 'sticky' ? 1 : 0;
    await env.DB.prepare('UPDATE comments SET sticky = ?1 WHERE id = ?2').bind(sticky, id).run();
    return json({ ok: true, sticky: sticky }, 200);
  }
  const locked = act === 'lock' ? 1 : 0;
  await env.DB.prepare('UPDATE comments SET locked = ?1 WHERE id = ?2').bind(locked, id).run();
  return json({ ok: true, locked: locked }, 200);
}

/* Admin-only: move a whole thread to another category, then DM the original
   poster an automated notice with a link to its new home. The topic row and
   every reply row carry their own page, so all move together. */
async function handleMove(request, env) {
  let data;
  try {
    data = await request.json();
  } catch {
    return json({ ok: false, error: 'Bad request.' }, 400);
  }
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.READ_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests.' }, 429);
  const key = String(data.key || '');
  const id = Number(data.id);
  if (!key || !Number.isInteger(id) || id < 1) return json({ ok: false, error: 'Bad request.' }, 400);
  const adminHash = await sha256hex(key);
  if (!(await isAdminHash(env, adminHash))) return json({ ok: false, error: 'No.' }, 403);
  const newPage = boardKey('board:' + String(data.cat || ''));
  if (!newPage) return json({ ok: false, error: 'Unknown category.' }, 400);
  const topic = await env.DB.prepare(
    "SELECT id, page, title, author_hash FROM comments WHERE id = ?1 AND parent_id IS NULL AND status != 'deleted'"
  ).bind(id).first();
  if (!topic || !boardKey(topic.page)) return json({ ok: false, error: 'No such topic.' }, 404);
  if (topic.page === newPage) return json({ ok: false, error: 'It is already in that category.' }, 400);
  await env.DB.prepare('UPDATE comments SET page = ?1 WHERE id = ?2 OR parent_id = ?2').bind(newPage, id).run();
  /* Notify the poster, unless the mover is the poster or the topic is anonymous.
     The display name is admin-supplied (untrusted text, so scrubbed and capped);
     the move itself keyed on the validated category. */
  let notified = false;
  if (topic.author_hash && topic.author_hash !== adminHash) {
    const name = String(data.catName || newPage.slice(6)).replace(CONTROL_RE, '').replace(/\s+/g, ' ').trim().slice(0, 60);
    const link = SITE + '/community.html?topic=' + id;
    const body = ('Your topic "' + topic.title + '" was moved to ' + name + '. You can read it here: ' + link).slice(0, MAX_BODY);
    try { notified = await sendSystemDm(env, adminHash, topic.author_hash, body); } catch { notified = false; }
  }
  return json({ ok: true, moved: true, notified }, 200);
}

/* Admin-only trust toggle. A trusted author's posts skip the AI screen.
   The flag lives by fingerprint and its holder never learns it exists. */
async function handleTrust(request, env) {
  let data;
  try {
    data = await request.json();
  } catch {
    return json({ ok: false, error: 'Bad request.' }, 400);
  }
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.READ_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests.' }, 429);
  const key = String(data.key || '');
  const hash = String(data.hash || '');
  if (!key || !/^[0-9a-f]{64}$/.test(hash)) return json({ ok: false, error: 'Bad request.' }, 400);
  if (!(await isAdminHash(env, await sha256hex(key)))) return json({ ok: false, error: 'No.' }, 403);
  if (data.trusted) {
    await env.DB.prepare('INSERT OR IGNORE INTO trusted (hash, created_at) VALUES (?1, ?2)')
      .bind(hash, Math.floor(Date.now() / 1000)).run();
  } else {
    await env.DB.prepare('DELETE FROM trusted WHERE hash = ?1').bind(hash).run();
  }
  return json({ ok: true, trusted: !!data.trusted }, 200);
}

/* Admin-only activity audit: the newest non-deleted post on every site
   page and in every board topic, author and moment, nothing else. Pending
   posts count as activity, they are exactly what an admin wants to see. */
async function handleAudit(request, env) {
  let data;
  try {
    data = await request.json();
  } catch {
    return json({ ok: false, error: 'Bad request.' }, 400);
  }
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.READ_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests.' }, 429);
  const key = String(data.key || '');
  if (!key) return json({ ok: false, error: 'Bad request.' }, 400);
  if (!(await isAdminHash(env, await sha256hex(key)))) return json({ ok: false, error: 'No.' }, 403);
  /* Two weeks of activity in each of the two worlds, newest first, each row
     carrying what the client needs to build a jump link straight to it. A
     generous cap the client shows through a scroll box, so the admin sees the
     latest at a glance and reaches the rest by scrolling. */
  const since = Math.floor(Date.now() / 1000) - 14 * 86400;
  const pages = await env.DB.prepare(
    "SELECT c.id, c.page, c.author_hash, pr.nick, c.created_at, c.status, substr(c.body, 1, 160) AS snippet " +
    "FROM comments c LEFT JOIN profiles pr ON pr.hash = c.author_hash " +
    "WHERE c.page NOT LIKE 'board:%' AND c.status != 'deleted' AND c.created_at > ?1 " +
    "ORDER BY c.id DESC LIMIT 300"
  ).bind(since).all();
  const topics = await env.DB.prepare(
    "SELECT c.id, c.page, c.author_hash, pr.nick, c.created_at, c.status, substr(c.body, 1, 160) AS snippet, " +
    "c.locked, c.sticky, COALESCE(c.parent_id, c.id) AS topic_id, COALESCE(c.title, t.title) AS title " +
    "FROM comments c LEFT JOIN profiles pr ON pr.hash = c.author_hash " +
    "LEFT JOIN comments t ON t.id = COALESCE(c.parent_id, c.id) " +
    "WHERE c.page LIKE 'board:%' AND c.status != 'deleted' AND c.created_at > ?1 " +
    "ORDER BY c.id DESC LIMIT 300"
  ).bind(since).all();
  /* Community reports, one row per reported post: how many reported it, the
     reasons given, and enough to jump to it and act. A reported post stays live
     until an admin decides. Highest count and most recent first. */
  const reports = await env.DB.prepare(
    "SELECT r.comment_id AS id, COUNT(*) AS report_count, GROUP_CONCAT(r.reason, ' | ') AS reasons, " +
    "MAX(r.created_at) AS last_reported, c.page, c.author_hash, pr.nick, c.status, " +
    "substr(c.body, 1, 160) AS snippet, c.locked, c.sticky, COALESCE(c.parent_id, c.id) AS topic_id, COALESCE(c.title, t.title) AS title " +
    "FROM reports r JOIN comments c ON c.id = r.comment_id " +
    "LEFT JOIN profiles pr ON pr.hash = c.author_hash " +
    "LEFT JOIN comments t ON t.id = COALESCE(c.parent_id, c.id) " +
    "WHERE c.status != 'deleted' GROUP BY r.comment_id ORDER BY report_count DESC, last_reported DESC LIMIT 200"
  ).all();
  return json({ ok: true, reports: reports.results, pages: pages.results, topics: topics.results, days: 14 }, 200);
}

const MAX_NICK = 40;
const MAX_BIO = 500;
const MAX_SIG = 200;

/* Public read of a profile: the custom fields plus the assigned pseudonym,
   never any private fingerprint or trust/ban state. Missing profile still
   answers, with null fields, so any hash resolves to at least its name. */
async function handleProfileGet(request, env, url) {
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.READ_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests. Slow down.' }, 429);
  const hash = String(url.searchParams.get('hash') || '');
  if (!/^[0-9a-f]{64}$/.test(hash)) return json({ ok: false, error: 'Bad request.' }, 400);
  const row = await env.DB.prepare('SELECT nick, bio, signature, avatar, faith FROM profiles WHERE hash = ?1').bind(hash).first();
  const counts = await postCountsFor(env, [hash]);
  return json({
    ok: true,
    profile: {
      hash: hash,
      nick: row ? (row.nick || null) : null,
      bio: row ? (row.bio || null) : null,
      signature: row ? (row.signature || null) : null,
      avatar: row ? (row.avatar || null) : null,
      faith: row ? (row.faith || null) : null,
      posts: counts[hash] || 0,
      assigned: displayName(hash),
      admin: await isAdminHash(env, hash),
    },
  }, 200, cacheHeader(url));
}

/* One profile field, normalized like a comment body: CRLF folded, trimmed,
   control characters (bar newline and tab) refused. Empty becomes null,
   which clears the field and falls the name back to the assigned pseudonym. */
function cleanField(raw, max) {
  const v = String(raw || '').replace(/\r\n?/g, '\n').trim();
  if (v.length > max) return { error: true };
  if (CONTROL_RE.test(v)) return { error: true };
  return { value: v || null };
}

/* Owner-writable profile: the key must hash to the profile's own hash, so a
   profile is only ever edited by its holder. The three fields are screened as
   one blob and rejected outright when flagged (a profile has no pending
   state); an unscreenable blob is allowed, being low-risk and admin-clearable. */
async function handleProfileSave(request, env) {
  let data;
  try {
    data = await request.json();
  } catch {
    return json({ ok: false, error: 'Bad request.' }, 400);
  }
  const key = String(data.key || '');
  if (!key) return json({ ok: false, error: 'An identity is required.' }, 400);
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.POST_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many changes at once. Wait a minute and try again.' }, 429);
  /* Same Turnstile gate as posting: a profile is public text a bot could
     otherwise write with a self-made key and no challenge. */
  if (!(await verifyTurnstile(env, String(data.token || ''), ip))) {
    return json({ ok: false, error: 'Verification failed. Reload the page and try again.' }, 403);
  }
  const nick = cleanField(data.nick, MAX_NICK);
  const bio = cleanField(data.bio, MAX_BIO);
  const signature = cleanField(data.signature, MAX_SIG);
  if (nick.error || bio.error || signature.error) {
    return json({ ok: false, error: 'That profile is too long or has stray characters.' }, 400);
  }
  /* The librarian's name is reserved, so the @-mention can never be confused. */
  if (/merecat/i.test(String(nick.value || '').replace(/\s+/g, ''))) {
    return json({ ok: false, error: 'That name belongs to the librarian. Pick another.' }, 400);
  }
  const authorHash = await sha256hex(key);
  const gate = await blockedReason(env, authorHash, ip);
  if (gate) return blockedJson(gate);
  const blob = [nick.value, bio.value, signature.value].filter(Boolean).join('\n');
  if (blob) {
    const { status, verdict } = await screen(env, blob, await isTrusted(env, authorHash));
    if (status !== 'live' && verdict !== 'ai-error') {
      return json({ ok: false, error: 'That text was flagged. Please revise it.' }, 400);
    }
  }
  const faith = cleanFaith(data.faith);
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    'INSERT INTO profiles (hash, nick, bio, signature, faith, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6) ' +
    'ON CONFLICT(hash) DO UPDATE SET nick = ?2, bio = ?3, signature = ?4, faith = COALESCE(?5, faith), updated_at = ?6'
  ).bind(authorHash, nick.value, bio.value, signature.value, faith, now).run();
  /* The text upsert leaves the avatar and faith columns as they stand when not
     given; read them back so the client's re-render keeps both. */
  const av = await env.DB.prepare('SELECT avatar, faith FROM profiles WHERE hash = ?1').bind(authorHash).first();
  return json({
    ok: true,
    profile: { hash: authorHash, nick: nick.value, bio: bio.value, signature: signature.value,
      avatar: av && av.avatar || null, faith: av && av.faith || null,
      assigned: displayName(authorHash), admin: await isAdminHash(env, authorHash) },
  }, 200);
}

/* Admin-only: wipe an abusive profile back to the assigned pseudonym without
   banning the author. Bans still only stop posting. */
async function handleProfileClear(request, env) {
  let data;
  try {
    data = await request.json();
  } catch {
    return json({ ok: false, error: 'Bad request.' }, 400);
  }
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.READ_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests.' }, 429);
  const key = String(data.key || '');
  const hash = String(data.hash || '');
  if (!key || !/^[0-9a-f]{64}$/.test(hash)) return json({ ok: false, error: 'Bad request.' }, 400);
  if (!(await isAdminHash(env, await sha256hex(key)))) return json({ ok: false, error: 'No.' }, 403);
  if (env.AVATARS) await env.AVATARS.delete('avatars/' + hash);
  await env.DB.prepare('UPDATE profiles SET nick = NULL, bio = NULL, signature = NULL, avatar = NULL, updated_at = ?2 WHERE hash = ?1')
    .bind(hash, Math.floor(Date.now() / 1000)).run();
  return json({ ok: true }, 200);
}

/* ---- Direct messages. Strictly 1v1, private to the two keys involved: every
   read is a POST carrying the key, nothing is cacheable, and no admin door
   exists. A thread is unread for me when its last word is someone else's and
   newer than my read stamp. ---- */

const DM_PER_PAGE = 20;

function dmPair(h1, h2) {
  return h1 < h2 ? [h1, h2] : [h2, h1];
}

/* Visibility is per viewer: everyone sees the unheld, and a sender always
   sees their own words, held or not. ?1 must be bound to the viewer's hash
   wherever this fragment appears. */
const DM_VIS = "(COALESCE(m.held, 0) = 0 OR m.sender_hash = ?1)";

/* Unread, per viewer: an unheld message from someone else, newer than my
   read stamp. Held messages can never trip the recipient's badge. */
const DM_UNREAD_EXISTS =
  'EXISTS(SELECT 1 FROM dms m WHERE m.thread_id = t.id AND COALESCE(m.held, 0) = 0 ' +
  'AND m.sender_hash != ?1 ' +
  'AND m.created_at > COALESCE(CASE WHEN t.a_hash = ?1 THEN t.a_read_at ELSE t.b_read_at END, 0) ' +
  'AND m.created_at > COALESCE(CASE WHEN t.a_hash = ?1 THEN t.a_cleared_at ELSE t.b_cleared_at END, 0))';

/* A side that deleted the conversation sees only words newer than its clear
   stamp. ?1 is the viewer; t must be the thread row in scope. */
const DM_CLEARED = 'm.created_at > COALESCE(CASE WHEN t.a_hash = ?1 THEN t.a_cleared_at ELSE t.b_cleared_at END, 0)';

/* Send. The same wall as posting: throttle, ban, Turnstile. A block by the
   recipient does NOT refuse the send: the message is stored held, reads as
   delivered to its sender, and stays invisible to the recipient until an
   unblock releases it. The blocked party is never told. */
async function handleDmSend(request, env) {
  let data;
  try {
    data = await request.json();
  } catch {
    return json({ ok: false, error: 'Bad request.' }, 400);
  }
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.POST_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many messages at once. Wait a minute and try again.' }, 429);
  const key = String(data.key || '');
  const to = String(data.to || '');
  if (!key || !/^[0-9a-f]{64}$/.test(to)) return json({ ok: false, error: 'Bad request.' }, 400);
  const body = String(data.body || '').replace(/\r\n?/g, '\n').trim();
  if (!body) return json({ ok: false, error: 'The message is empty.' }, 400);
  if (body.length > MAX_BODY) return json({ ok: false, error: 'The message is too long.' }, 400);
  if (CONTROL_RE.test(body)) return json({ ok: false, error: 'Bad request.' }, 400);
  const me = await sha256hex(key);
  if (me === to) return json({ ok: false, error: 'That would be a soliloquy.' }, 400);
  if (to === MERECAT_BOT.hash) {
    return json({ ok: false, error: 'merecat is a librarian, not a correspondent. Mention @merecat in a post or comment, or visit the merecat page.' }, 400);
  }
  const gate = await blockedReason(env, me, ip);
  if (gate) return blockedJson(gate);
  const blockRow = await env.DB.prepare('SELECT 1 AS b FROM dm_blocks WHERE owner_hash = ?1 AND blocked_hash = ?2')
    .bind(to, me).first();
  const held = blockRow ? 1 : 0;
  if (!(await verifyTurnstile(env, String(data.token || ''), ip))) {
    return json({ ok: false, error: 'Verification failed. Reload the page and try again.' }, 403);
  }
  const [a, b] = dmPair(me, to);
  const now = Math.floor(Date.now() / 1000);
  const myReadCol = me === a ? 'a_read_at' : 'b_read_at';
  /* A held send must leave the recipient's world untouched: the thread's
     last-word fields stay as they were, so nothing bumps, nothing rings. */
  const thread = held
    ? await env.DB.prepare(
        'INSERT INTO dm_threads (a_hash, b_hash, created_at, last_at, last_sender, msgs) VALUES (?1, ?2, ?3, ?3, ?4, 0) ' +
        'ON CONFLICT(a_hash, b_hash) DO UPDATE SET last_at = last_at RETURNING id'
      ).bind(a, b, now, me).first()
    : await env.DB.prepare(
        'INSERT INTO dm_threads (a_hash, b_hash, created_at, last_at, last_sender, msgs) VALUES (?1, ?2, ?3, ?3, ?4, 0) ' +
        'ON CONFLICT(a_hash, b_hash) DO UPDATE SET last_at = ?3, last_sender = ?4 RETURNING id'
      ).bind(a, b, now, me).first();
  const msg = await env.DB.prepare(
    'INSERT INTO dms (thread_id, sender_hash, body, created_at, held) VALUES (?1, ?2, ?3, ?4, ?5) RETURNING id'
  ).bind(thread.id, me, body, now, held).first();
  if (!held) {
    /* Recomputed, never incremented, over the visible words alone, and the
       sender's own stamp rides along: what you just said is read by you. */
    await env.DB.prepare(
      'UPDATE dm_threads SET msgs = (SELECT COUNT(*) FROM dms WHERE thread_id = ?1 AND COALESCE(held, 0) = 0), ' +
      myReadCol + ' = ?2 WHERE id = ?1'
    ).bind(thread.id, now).run();
  }
  return json({ ok: true, id: msg.id, thread_id: thread.id, created_at: now }, 200);
}

/* Deliver a message from one identity to another with no gate — for automated,
   system-authored notices (e.g. a topic-move notification). Always unheld, so a
   moderation notice reaches its target regardless of blocks, and it post-dates
   any clear stamp so a fresh-started thread resurfaces to carry it. Returns
   whether it delivered. */
async function sendSystemDm(env, fromHash, toHash, body) {
  if (!fromHash || !toHash || fromHash === toHash || !body) return false;
  const [a, b] = dmPair(fromHash, toHash);
  const now = Math.floor(Date.now() / 1000);
  const senderReadCol = fromHash === a ? 'a_read_at' : 'b_read_at';
  const thread = await env.DB.prepare(
    'INSERT INTO dm_threads (a_hash, b_hash, created_at, last_at, last_sender, msgs) VALUES (?1, ?2, ?3, ?3, ?4, 0) ' +
    'ON CONFLICT(a_hash, b_hash) DO UPDATE SET last_at = ?3, last_sender = ?4 RETURNING id'
  ).bind(a, b, now, fromHash).first();
  await env.DB.prepare(
    'INSERT INTO dms (thread_id, sender_hash, body, created_at, held) VALUES (?1, ?2, ?3, ?4, 0)'
  ).bind(thread.id, fromHash, body, now).run();
  await env.DB.prepare(
    'UPDATE dm_threads SET msgs = (SELECT COUNT(*) FROM dms WHERE thread_id = ?1 AND COALESCE(held, 0) = 0), ' +
    senderReadCol + ' = ?2 WHERE id = ?1'
  ).bind(thread.id, now).run();
  return true;
}

/* Inbox: my threads by newest activity, the other party resolved with their
   nick and avatar, and the total unread count riding along so one call feeds
   both the list and the badge. */
async function handleDmThreads(request, env) {
  let data;
  try {
    data = await request.json();
  } catch {
    return json({ ok: false, error: 'Bad request.' }, 400);
  }
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.READ_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests. Slow down.' }, 429);
  const key = String(data.key || '');
  if (!key) return json({ ok: false, error: 'Bad request.' }, 400);
  const me = await sha256hex(key);
  const p = Math.min(1000, Math.max(1, Math.floor(Number(data.p) || 1)));
  /* Everything per viewer: counts and last-activity over the words this
     reader may see, and a thread whose every word is held reads as absent. */
  const inner =
    'SELECT t.id, ' +
    'CASE WHEN t.a_hash = ?1 THEN t.b_hash ELSE t.a_hash END AS other_hash, ' +
    'pr.nick, pr.avatar, ' +
    '(SELECT COUNT(*) FROM dms m WHERE m.thread_id = t.id AND ' + DM_VIS + ' AND ' + DM_CLEARED + ') AS msgs, ' +
    '(SELECT MAX(m.created_at) FROM dms m WHERE m.thread_id = t.id AND ' + DM_VIS + ' AND ' + DM_CLEARED + ') AS last_at, ' +
    'CASE WHEN ' + DM_UNREAD_EXISTS + ' THEN 1 ELSE 0 END AS unread ' +
    'FROM dm_threads t LEFT JOIN profiles pr ON pr.hash = CASE WHEN t.a_hash = ?1 THEN t.b_hash ELSE t.a_hash END ' +
    'WHERE t.a_hash = ?1 OR t.b_hash = ?1';
  const rows = await env.DB.prepare(
    'SELECT * FROM (' + inner + ') WHERE msgs > 0 ORDER BY last_at DESC LIMIT ?2 OFFSET ?3'
  ).bind(me, DM_PER_PAGE, (p - 1) * DM_PER_PAGE).all();
  const totals = await env.DB.prepare(
    'SELECT COUNT(*) AS n, COALESCE(SUM(unread), 0) AS unread FROM (' + inner + ') WHERE msgs > 0'
  ).bind(me).first();
  return json({ ok: true, threads: rows.results, total: totals.n || 0,
    unread_total: totals.unread || 0, page: p, per: DM_PER_PAGE }, 200);
}

/* One conversation, paged by twenty like everything else, defaulting to the
   LAST page so it opens at its newest words. Opening marks it read with at
   most one write, none when nothing was unread. */
async function handleDmThread(request, env) {
  let data;
  try {
    data = await request.json();
  } catch {
    return json({ ok: false, error: 'Bad request.' }, 400);
  }
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.READ_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests. Slow down.' }, 429);
  const key = String(data.key || '');
  const other = String(data.with || '');
  if (!key || !/^[0-9a-f]{64}$/.test(other)) return json({ ok: false, error: 'Bad request.' }, 400);
  const me = await sha256hex(key);
  if (me === other) return json({ ok: false, error: 'Bad request.' }, 400);
  const [a, b] = dmPair(me, other);
  const thread = await env.DB.prepare(
    'SELECT id, msgs, last_at, last_sender, a_read_at, b_read_at, a_cleared_at, b_cleared_at FROM dm_threads WHERE a_hash = ?1 AND b_hash = ?2'
  ).bind(a, b).first();
  const prof = await env.DB.prepare('SELECT nick, avatar FROM profiles WHERE hash = ?1').bind(other).first();
  const iBlocked = await env.DB.prepare('SELECT 1 AS b FROM dm_blocks WHERE owner_hash = ?1 AND blocked_hash = ?2')
    .bind(me, other).first();
  if (!thread) {
    /* No words yet: an empty room, ready for the first message. */
    return json({ ok: true, thread_id: null, other: { hash: other, nick: prof && prof.nick || null, avatar: prof && prof.avatar || null },
      messages: [], total: 0, page: 1, per: DM_PER_PAGE, blocked: iBlocked ? 1 : 0 }, 200);
  }
  /* The total and the pages are the viewer's own: held words count for their
     sender and for nobody else, and a side that deleted the thread sees only
     what arrived after its own clear stamp (a fresh start). */
  const myCleared = (me === a ? thread.a_cleared_at : thread.b_cleared_at) || 0;
  const totRow = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM dms m WHERE m.thread_id = ?2 AND ' + DM_VIS + ' AND m.created_at > ?3'
  ).bind(me, thread.id, myCleared).first();
  const total = totRow.n || 0;
  const lastPage = Math.max(1, Math.ceil(total / DM_PER_PAGE));
  const p = data.p == null ? lastPage : Math.min(1000, Math.max(1, Math.floor(Number(data.p) || 1)));
  const msgs = await env.DB.prepare(
    'SELECT m.id, m.sender_hash, m.body, m.created_at FROM dms m WHERE m.thread_id = ?2 AND ' + DM_VIS +
    ' AND m.created_at > ?5 ORDER BY m.id LIMIT ?3 OFFSET ?4'
  ).bind(me, thread.id, DM_PER_PAGE, (p - 1) * DM_PER_PAGE, myCleared).all();
  const myReadCol = me === a ? 'a_read_at' : 'b_read_at';
  /* One conditional write: only when a visible word from the other side is
     newer than my stamp. Held and cleared words never trigger it. */
  await env.DB.prepare(
    'UPDATE dm_threads SET ' + myReadCol + ' = ?2 WHERE id = ?3 AND EXISTS(' +
    'SELECT 1 FROM dms m WHERE m.thread_id = ?3 AND COALESCE(m.held, 0) = 0 AND m.sender_hash != ?1 ' +
    'AND m.created_at > COALESCE(' + myReadCol + ', 0) AND m.created_at > ?4)'
  ).bind(me, Math.floor(Date.now() / 1000), thread.id, myCleared).run();
  return json({ ok: true, thread_id: thread.id,
    other: { hash: other, nick: prof && prof.nick || null, avatar: prof && prof.avatar || null },
    messages: msgs.results, total: total, page: p, per: DM_PER_PAGE, blocked: iBlocked ? 1 : 0 }, 200);
}

/* The badge count: unread threads, one indexed COUNT. The client asks at most
   once per ninety seconds, so this stays cheap on every side. */
async function handleDmUnread(request, env) {
  let data;
  try {
    data = await request.json();
  } catch {
    return json({ ok: false, error: 'Bad request.' }, 400);
  }
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.READ_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests.' }, 429);
  const key = String(data.key || '');
  if (!key) return json({ ok: false, error: 'Bad request.' }, 400);
  const me = await sha256hex(key);
  /* The reliable catch for a logged-in reader: this poll fires on every keyed
     page load, so a lock or IP ban logs them out on their next page turn. */
  const gate = await blockedReason(env, me, ip);
  if (gate) return blockedJson(gate);
  const row = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM dm_threads t WHERE (t.a_hash = ?1 OR t.b_hash = ?1) AND ' + DM_UNREAD_EXISTS
  ).bind(me).first();
  return json({ ok: true, unread: row.n || 0 }, 200);
}

/* The notification badge count: unread rows for this reader, one indexed COUNT.
   Like the DM poll it fires at most once per ninety seconds and doubles as the
   logout trip for a locked or banned identity. */
async function handleNotifUnread(request, env) {
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.READ_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests.' }, 429);
  const key = String(data.key || '');
  if (!key) return json({ ok: false, error: 'Bad request.' }, 400);
  const me = await sha256hex(key);
  const gate = await blockedReason(env, me, ip);
  if (gate) return blockedJson(gate);
  const row = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM notifications WHERE recipient_hash = ?1 AND read_at IS NULL'
  ).bind(me).first();
  return json({ ok: true, unread: row.n || 0 }, 200);
}

/* The notification list, newest first, paged by twenty. Each row carries the
   thread title, a snippet of the post, and the actor's nick so the client can
   render "X replied/mentioned you in <title>" and jump to the exact comment. */
async function handleNotifList(request, env) {
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.READ_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests. Slow down.' }, 429);
  const key = String(data.key || '');
  if (!key) return json({ ok: false, error: 'Bad request.' }, 400);
  const me = await sha256hex(key);
  const p = Math.min(1000, Math.max(1, Math.floor(Number(data.p) || 1)));
  const rows = await env.DB.prepare(
    'SELECT n.id, n.kind, n.topic_id, n.comment_id, n.actor_hash, n.created_at, n.read_at, ' +
    't.title AS topic_title, pr.nick AS actor_nick, substr(c.body, 1, 140) AS snippet ' +
    'FROM notifications n ' +
    'LEFT JOIN comments t ON t.id = n.topic_id ' +
    'LEFT JOIN comments c ON c.id = n.comment_id ' +
    'LEFT JOIN profiles pr ON pr.hash = n.actor_hash ' +
    'WHERE n.recipient_hash = ?1 ORDER BY n.id DESC LIMIT ?2 OFFSET ?3'
  ).bind(me, NOTIF_PER_PAGE, (p - 1) * NOTIF_PER_PAGE).all();
  const totals = await env.DB.prepare(
    'SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN read_at IS NULL THEN 1 ELSE 0 END), 0) AS unread ' +
    'FROM notifications WHERE recipient_hash = ?1'
  ).bind(me).first();
  return json({ ok: true, items: rows.results, total: totals.n || 0,
    unread_total: totals.unread || 0, page: p, per: NOTIF_PER_PAGE }, 200);
}

/* Opening the list marks everything read, the notifications analogue of opening
   a DM thread. One write; the badge clears on the client's next poll. */
async function handleNotifRead(request, env) {
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.POST_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests.' }, 429);
  const key = String(data.key || '');
  if (!key) return json({ ok: false, error: 'Bad request.' }, 400);
  const me = await sha256hex(key);
  const gate = await blockedReason(env, me, ip);
  if (gate) return blockedJson(gate);
  await env.DB.prepare(
    'UPDATE notifications SET read_at = ?2 WHERE recipient_hash = ?1 AND read_at IS NULL'
  ).bind(me, Math.floor(Date.now() / 1000)).run();
  return json({ ok: true }, 200);
}

/* Watch, unwatch, or read the state of a thread. Posting a reply auto-watches;
   this is the manual toggle in the topic header. 'status' is a cheap read, so it
   rides READ_LIMIT; the mutations ride the stricter write limit. */
async function handleWatch(request, env) {
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  const key = String(data.key || '');
  const topicId = Number(data.topic);
  const act = String(data.act || 'status');
  if (!key || !Number.isInteger(topicId) || topicId < 1) return json({ ok: false, error: 'Bad request.' }, 400);
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const limiter = act === 'status' ? env.READ_LIMIT : env.POST_LIMIT;
  const { success } = await limiter.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests.' }, 429);
  const me = await sha256hex(key);
  const gate = await blockedReason(env, me, ip);
  if (gate) return blockedJson(gate);
  if (act === 'watch') {
    await env.DB.prepare('INSERT OR IGNORE INTO watches (hash, topic_id, created_at) VALUES (?1, ?2, ?3)')
      .bind(me, topicId, Math.floor(Date.now() / 1000)).run();
  } else if (act === 'unwatch') {
    await env.DB.prepare('DELETE FROM watches WHERE hash = ?1 AND topic_id = ?2').bind(me, topicId).run();
  }
  const row = await env.DB.prepare('SELECT 1 AS w FROM watches WHERE hash = ?1 AND topic_id = ?2').bind(me, topicId).first();
  return json({ ok: true, watching: row ? 1 : 0 }, 200);
}

/* Board read state ("new since last visit"). A thread reads as new when its
   last activity is newer than the reader's read stamp for it, or than the floor
   (the topic_id=0 row) when they have never opened it. */
async function boardFloor(env, me) {
  const row = await env.DB.prepare('SELECT read_at FROM thread_reads WHERE hash = ?1 AND topic_id = 0').bind(me).first();
  return row ? row.read_at : null;
}

/* Unread summary for the board index. On a reader's first-ever call the floor is
   set to now, so nothing before this visit reads as new (start-all-read). */
async function handleBoardUnread(request, env) {
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.READ_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests.' }, 429);
  const key = String(data.key || '');
  if (!key) return json({ ok: false, error: 'Bad request.' }, 400);
  const me = await sha256hex(key);
  const gate = await blockedReason(env, me, ip);
  if (gate) return blockedJson(gate);
  let floor = await boardFloor(env, me);
  if (floor === null) {
    floor = Math.floor(Date.now() / 1000);
    try { await env.DB.prepare('INSERT OR IGNORE INTO thread_reads (hash, topic_id, read_at) VALUES (?1, 0, ?2)').bind(me, floor).run(); } catch (e) {}
  }
  const rows = await env.DB.prepare(
    'SELECT c.page AS page, COUNT(*) AS n FROM comments c ' +
    'LEFT JOIN thread_reads tr ON tr.hash = ?1 AND tr.topic_id = c.id ' +
    "WHERE c.parent_id IS NULL AND c.status = 'live' AND c.page LIKE 'board:%' " +
    'AND COALESCE(c.last_at, c.created_at) > COALESCE(tr.read_at, ?2) GROUP BY c.page'
  ).bind(me, floor).all();
  const byCat = {};
  let total = 0;
  for (const r of (rows.results || [])) { byCat[String(r.page).slice(6)] = r.n; total += r.n; }
  return json({ ok: true, total, byCat }, 200);
}

/* The unread topic ids in one category, so the listing can mark them "new". */
async function handleBoardReads(request, env) {
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.READ_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests.' }, 429);
  const key = String(data.key || '');
  const catPage = boardKey('board:' + String(data.cat || ''));
  if (!key || !catPage) return json({ ok: true, unread: [] }, 200);
  const me = await sha256hex(key);
  const gate = await blockedReason(env, me, ip);
  if (gate) return blockedJson(gate);
  const floor = (await boardFloor(env, me)) || 0;
  const rows = await env.DB.prepare(
    'SELECT c.id FROM comments c LEFT JOIN thread_reads tr ON tr.hash = ?1 AND tr.topic_id = c.id ' +
    "WHERE c.page = ?2 AND c.parent_id IS NULL AND c.status = 'live' " +
    'AND COALESCE(c.last_at, c.created_at) > COALESCE(tr.read_at, ?3)'
  ).bind(me, catPage, floor).all();
  return json({ ok: true, unread: (rows.results || []).map((r) => r.id) }, 200);
}

/* Mark one thread read — fired on opening a topic. */
async function handleBoardRead(request, env) {
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.POST_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests.' }, 429);
  const key = String(data.key || '');
  const topicId = Number(data.topic);
  if (!key || !Number.isInteger(topicId) || topicId < 1) return json({ ok: false, error: 'Bad request.' }, 400);
  const me = await sha256hex(key);
  const gate = await blockedReason(env, me, ip);
  if (gate) return blockedJson(gate);
  const now = Math.floor(Date.now() / 1000);
  /* Reading a thread reads its notifications too — however the reader got
     here. The reply carries the remaining unread count so the badge can
     tell the truth on this very page load instead of a cache's old news. */
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO thread_reads (hash, topic_id, read_at) VALUES (?1, ?2, ?3) ON CONFLICT(hash, topic_id) DO UPDATE SET read_at = ?3'
    ).bind(me, topicId, now),
    env.DB.prepare(
      'UPDATE notifications SET read_at = ?3 WHERE recipient_hash = ?1 AND topic_id = ?2 AND read_at IS NULL'
    ).bind(me, topicId, now),
  ]);
  const un = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM notifications WHERE recipient_hash = ?1 AND read_at IS NULL'
  ).bind(me).first();
  return json({ ok: true, notif_unread: (un && un.n) || 0 }, 200);
}

/* Mark everything read: raise the floor to now and drop the per-thread rows it
   now subsumes, so the table stays lean. */
async function handleBoardReadAll(request, env) {
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.POST_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests.' }, 429);
  const key = String(data.key || '');
  if (!key) return json({ ok: false, error: 'Bad request.' }, 400);
  const me = await sha256hex(key);
  const gate = await blockedReason(env, me, ip);
  if (gate) return blockedJson(gate);
  const now = Math.floor(Date.now() / 1000);
  await env.DB.batch([
    env.DB.prepare('INSERT INTO thread_reads (hash, topic_id, read_at) VALUES (?1, 0, ?2) ON CONFLICT(hash, topic_id) DO UPDATE SET read_at = ?2').bind(me, now),
    env.DB.prepare('DELETE FROM thread_reads WHERE hash = ?1 AND topic_id != 0 AND read_at <= ?2').bind(me, now),
    /* Mark ALL read means the notifications too: caught up is caught up. */
    env.DB.prepare('UPDATE notifications SET read_at = ?2 WHERE recipient_hash = ?1 AND read_at IS NULL').bind(me, now),
  ]);
  return json({ ok: true, notif_unread: 0 }, 200);
}

/* Block and unblock, owner-side only. */
async function handleDmBlock(request, env) {
  let data;
  try {
    data = await request.json();
  } catch {
    return json({ ok: false, error: 'Bad request.' }, 400);
  }
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.POST_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests.' }, 429);
  const key = String(data.key || '');
  const hash = String(data.hash || '');
  if (!key || !/^[0-9a-f]{64}$/.test(hash)) return json({ ok: false, error: 'Bad request.' }, 400);
  const me = await sha256hex(key);
  if (data.blocked) {
    await env.DB.prepare('INSERT OR IGNORE INTO dm_blocks (owner_hash, blocked_hash, created_at) VALUES (?1, ?2, ?3)')
      .bind(me, hash, Math.floor(Date.now() / 1000)).run();
  } else {
    /* Unblocking delivers the flood: every word held during the block is
       released with its original timestamp, and the thread's last-word
       fields catch up so the inbox and the badge finally ring. */
    const [a, b] = dmPair(me, hash);
    const t = await env.DB.prepare('SELECT id FROM dm_threads WHERE a_hash = ?1 AND b_hash = ?2').bind(a, b).first();
    if (t) {
      const mn = await env.DB.prepare(
        'SELECT MIN(created_at) AS mn FROM dms WHERE thread_id = ?1 AND sender_hash = ?2 AND COALESCE(held, 0) = 1'
      ).bind(t.id, hash).first();
      await env.DB.prepare(
        'UPDATE dms SET held = 0 WHERE thread_id = ?1 AND sender_hash = ?2 AND COALESCE(held, 0) = 1'
      ).bind(t.id, hash).run();
      /* The released words keep their original times, which may sit behind
         my read stamp; wind the stamp back so the delivery still rings. */
      if (mn && mn.mn != null) {
        const myReadCol = me === a ? 'a_read_at' : 'b_read_at';
        await env.DB.prepare(
          'UPDATE dm_threads SET ' + myReadCol + ' = ?2 WHERE id = ?1 AND ' + myReadCol + ' IS NOT NULL AND ' + myReadCol + ' >= ?2'
        ).bind(t.id, mn.mn - 1).run();
      }
      await env.DB.prepare(
        'UPDATE dm_threads SET ' +
        'msgs = (SELECT COUNT(*) FROM dms WHERE thread_id = ?1 AND COALESCE(held, 0) = 0), ' +
        'last_at = COALESCE((SELECT MAX(created_at) FROM dms WHERE thread_id = ?1 AND COALESCE(held, 0) = 0), last_at), ' +
        'last_sender = COALESCE((SELECT sender_hash FROM dms WHERE thread_id = ?1 AND COALESCE(held, 0) = 0 ORDER BY id DESC LIMIT 1), last_sender) ' +
        'WHERE id = ?1'
      ).bind(t.id).run();
    }
    await env.DB.prepare('DELETE FROM dm_blocks WHERE owner_hash = ?1 AND blocked_hash = ?2').bind(me, hash).run();
  }
  return json({ ok: true, blocked: !!data.blocked }, 200);
}

/* Delete a conversation from my side: a fresh start. My clear stamp hides every
   earlier word from me while the other keeps their copy; when both sides have
   cleared and no word outlives the earlier clear, the thread and all its words
   are purged so nothing persists. Keyed, not admin — you delete your own. */
async function handleDmDelete(request, env) {
  let data;
  try {
    data = await request.json();
  } catch {
    return json({ ok: false, error: 'Bad request.' }, 400);
  }
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.POST_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests.' }, 429);
  const key = String(data.key || '');
  const other = String(data.with || '');
  if (!key || !/^[0-9a-f]{64}$/.test(other)) return json({ ok: false, error: 'Bad request.' }, 400);
  const me = await sha256hex(key);
  if (me === other) return json({ ok: false, error: 'Bad request.' }, 400);
  const gate = await blockedReason(env, me, ip);
  if (gate) return blockedJson(gate);
  const [a, b] = dmPair(me, other);
  const thread = await env.DB.prepare(
    'SELECT id, a_cleared_at, b_cleared_at FROM dm_threads WHERE a_hash = ?1 AND b_hash = ?2'
  ).bind(a, b).first();
  if (!thread) return json({ ok: true, purged: false }, 200);
  const now = Math.floor(Date.now() / 1000);
  const myCol = me === a ? 'a_cleared_at' : 'b_cleared_at';
  await env.DB.prepare('UPDATE dm_threads SET ' + myCol + ' = ?1 WHERE id = ?2').bind(now, thread.id).run();
  /* Purge when both sides have cleared and no word outlives the earlier clear,
     so neither side can still see anything. Held words count too, erring toward
     never destroying a word its sender might still see. */
  const aC = me === a ? now : (thread.a_cleared_at || 0);
  const bC = me === b ? now : (thread.b_cleared_at || 0);
  let purged = false;
  if (aC && bC) {
    const surv = await env.DB.prepare('SELECT COUNT(*) AS n FROM dms WHERE thread_id = ?1 AND created_at > ?2')
      .bind(thread.id, Math.min(aC, bC)).first();
    if (!surv.n) {
      await env.DB.prepare('DELETE FROM dms WHERE thread_id = ?1').bind(thread.id).run();
      await env.DB.prepare('DELETE FROM dm_threads WHERE id = ?1').bind(thread.id).run();
      purged = true;
    }
  }
  return json({ ok: true, purged }, 200);
}

/* The autocomplete corpus: every hash that has ever appeared publicly, with
   its nick when one is set. Assigned names are derived client-side from the
   hash, so they are not sent. Public-by-construction data, cacheable. */
async function handleDmDirectory(request, env, url) {
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.READ_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests. Slow down.' }, 429);
  /* Each member with the moment they first appeared (earliest live comment or
     profile creation), newest first, so the member list leads with the latest
     to join. The DM autocomplete ignores the order and the extra column. */
  const rows = await env.DB.prepare(
    'SELECT u.hash, u.joined, pr.nick FROM (' +
    '  SELECT hash, MIN(joined) AS joined FROM (' +
    "    SELECT author_hash AS hash, MIN(created_at) AS joined FROM comments WHERE author_hash IS NOT NULL AND status != 'deleted' GROUP BY author_hash " +
    '    UNION ALL SELECT hash, created_at AS joined FROM profiles' +
    '  ) GROUP BY hash' +
    ') u LEFT JOIN profiles pr ON pr.hash = u.hash ' +
    /* The librarian and its machinery identities (merecat-named, which the
       nick guard denies to members) belong in no roster or picker. */
    "WHERE u.hash != ?1 AND (pr.nick IS NULL OR pr.nick NOT LIKE 'merecat%') " +
    'ORDER BY u.joined DESC LIMIT 2000'
  ).bind(MERECAT_BOT.hash).all();
  return json({ ok: true, users: rows.results }, 200, cacheHeader(url));
}

/* ---- Avatars. One 400x400 raster image per identity, stored in R2 under
   avatars/<hash>, so an upload overwrites the old file and storage stays
   pruned by construction. The server trusts nothing from the client: bytes
   are sniffed for PNG/JPEG/WebP magic (never SVG, which can carry script),
   dimensions are read from the image header itself, and the stored
   content-type is the sniffed one. ---- */

const MAX_AVATAR_BYTES = 500 * 1024;
const AVATAR_SIZE = 400;

function be16(b, i) { return (b[i] << 8) | b[i + 1]; }

/* Returns {mime, width, height} or null. Only the three raster formats a
   browser canvas emits are recognized; everything else is refused. */
function sniffImage(b) {
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47 &&
      b[4] === 0x0D && b[5] === 0x0A && b[6] === 0x1A && b[7] === 0x0A) {
    return { mime: 'image/png',
      width: (b[16] << 24 | b[17] << 16 | b[18] << 8 | b[19]) >>> 0,
      height: (b[20] << 24 | b[21] << 16 | b[22] << 8 | b[23]) >>> 0 };
  }
  if (b.length > 4 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xFF) return null;
      const marker = b[i + 1];
      if (marker === 0xFF) { i++; continue; }
      if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
        return { mime: 'image/jpeg', width: be16(b, i + 7), height: be16(b, i + 5) };
      }
      if (marker === 0xD8 || (marker >= 0xD0 && marker <= 0xD7)) { i += 2; continue; }
      i += 2 + be16(b, i + 2);
    }
    return null;
  }
  if (b.length > 30 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
    const tag = String.fromCharCode(b[12], b[13], b[14], b[15]);
    if (tag === 'VP8 ' && b[23] === 0x9D && b[24] === 0x01 && b[25] === 0x2A) {
      return { mime: 'image/webp', width: (b[26] | (b[27] << 8)) & 0x3FFF, height: (b[28] | (b[29] << 8)) & 0x3FFF };
    }
    if (tag === 'VP8L' && b[20] === 0x2F) {
      const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
      return { mime: 'image/webp', width: (bits & 0x3FFF) + 1, height: ((bits >> 14) & 0x3FFF) + 1 };
    }
    if (tag === 'VP8X') {
      return { mime: 'image/webp',
        width: ((b[24] | (b[25] << 8) | (b[26] << 16)) + 1),
        height: ((b[27] | (b[28] << 8) | (b[29] << 16)) + 1) };
    }
  }
  return null;
}

/* Best-effort image moderation, the visual counterpart to the Llama Guard
   text screen. Returns true to allow, false to reject. Fails OPEN on an AI
   error: a throttled or broken model must not block every avatar, and the
   owner still sees and can clear any that slip through. Not a guarantee, and
   never a substitute for CSAM hash-scanning, which is a separate control. */
async function screenImage(env, bytes) {
  try {
    const result = await env.AI.run('@cf/llava-hf/llava-1.5-7b-hf', {
      image: [...bytes],
      prompt: 'You are moderating a profile avatar. Does this image contain nudity, ' +
        'sexual or pornographic content, or graphic violence or gore? Answer with only ' +
        'one word: unsafe if it does, otherwise safe.',
      max_tokens: 16,
    });
    const text = String(result && result.description != null ? result.description : '').toLowerCase();
    return text.indexOf('unsafe') === -1;
  } catch (err) {
    console.log(JSON.stringify({ event: 'avatar_ai_failed', error: String(err) }));
    return true;
  }
}

/* Owner-only upload, multipart. The same gates as posting: rate limit, key,
   ban, Turnstile, and an AI vision screen. The write is a fixed-key overwrite,
   so the previous avatar is replaced in the same act and no orphan objects
   can accumulate. */
async function handleAvatarUpload(request, env) {
  if (!env.AVATARS) return json({ ok: false, error: 'Avatars are not enabled yet. Soon.' }, 503);
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.POST_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests. Wait a minute and try again.' }, 429);
  const declared = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > MAX_AVATAR_BYTES + 8192) {
    return json({ ok: false, error: 'The image is too large. 500 KB at most.' }, 413);
  }
  let form;
  try {
    form = await request.formData();
  } catch {
    return json({ ok: false, error: 'Bad request.' }, 400);
  }
  const key = String(form.get('key') || '');
  if (!key) return json({ ok: false, error: 'An identity is required.' }, 400);
  const authorHash = await sha256hex(key);
  const gate = await blockedReason(env, authorHash, ip);
  if (gate) return blockedJson(gate);
  if (!(await verifyTurnstile(env, String(form.get('token') || ''), ip))) {
    return json({ ok: false, error: 'Verification failed. Reload the page and try again.' }, 403);
  }
  const file = form.get('avatar');
  if (!file || typeof file.arrayBuffer !== 'function') return json({ ok: false, error: 'No image arrived.' }, 400);
  if (file.size > MAX_AVATAR_BYTES) return json({ ok: false, error: 'The image is too large. 500 KB at most.' }, 413);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length > MAX_AVATAR_BYTES) return json({ ok: false, error: 'The image is too large. 500 KB at most.' }, 413);
  /* JPEG alone is stored, whatever any client claims or an old cached
     client sends. The canvas step upstream re-encodes every source to JPEG,
     so an honest upload always passes; everything else is refused here. */
  const img = sniffImage(bytes);
  if (!img || img.mime !== 'image/jpeg') return json({ ok: false, error: 'Avatars must be JPEG.' }, 400);
  if (img.width !== AVATAR_SIZE || img.height !== AVATAR_SIZE) {
    return json({ ok: false, error: 'The avatar must be exactly 400 by 400 pixels.' }, 400);
  }
  if (!(await screenImage(env, bytes))) {
    return json({ ok: false, error: 'That image was flagged and cannot be used as an avatar. Please choose another.' }, 400);
  }
  await env.AVATARS.put('avatars/' + authorHash, bytes, { httpMetadata: { contentType: img.mime } });
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    'INSERT INTO profiles (hash, avatar, created_at, updated_at) VALUES (?1, ?2, ?3, ?3) ' +
    'ON CONFLICT(hash) DO UPDATE SET avatar = ?2, updated_at = ?3'
  ).bind(authorHash, String(now), now).run();
  return json({ ok: true, avatar: String(now) }, 200);
}

/* Owner removes their own avatar: the object is deleted and the profile flag
   cleared. Same gates as self-deleting a comment. */
async function handleAvatarDelete(request, env) {
  if (!env.AVATARS) return json({ ok: false, error: 'Avatars are not enabled yet. Soon.' }, 503);
  let data;
  try {
    data = await request.json();
  } catch {
    return json({ ok: false, error: 'Bad request.' }, 400);
  }
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.POST_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests.' }, 429);
  const key = String(data.key || '');
  if (!key) return json({ ok: false, error: 'Bad request.' }, 400);
  const authorHash = await sha256hex(key);
  await env.AVATARS.delete('avatars/' + authorHash);
  await env.DB.prepare('UPDATE profiles SET avatar = NULL, updated_at = ?2 WHERE hash = ?1')
    .bind(authorHash, Math.floor(Date.now() / 1000)).run();
  return json({ ok: true }, 200);
}

/* Public read. Served with the content-type sniffed at upload, nosniff, and
   a deny-all CSP, so the bytes can never run as anything. Long browser cache;
   the URL carries the upload stamp as a cache-buster, so a new avatar is a
   new URL. No rate limiter: one page can hold many authors. */
async function handleAvatarGet(request, env, url) {
  if (!env.AVATARS) return new Response('No avatar.', { status: 404 });
  const hash = String(url.searchParams.get('hash') || '');
  if (!/^[0-9a-f]{64}$/.test(hash)) return new Response('Bad request.', { status: 400 });
  const obj = await env.AVATARS.get('avatars/' + hash);
  if (!obj) return new Response('No avatar.', { status: 404, headers: { 'Cache-Control': 'public, max-age=300' } });
  return new Response(obj.body, {
    status: 200,
    headers: {
      'Content-Type': (obj.httpMetadata && obj.httpMetadata.contentType) || 'application/octet-stream',
      'Cache-Control': 'public, max-age=86400',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
    },
  });
}

/* ---- Backups. A monthly cron dumps the whole database to one SQL file,
   gzips it, and drops it in the BACKUPS R2 bucket, keeping ninety days.
   Restore: download, gunzip, then
   deno run -A npm:wrangler d1 execute merecatholicity-comments --remote --file backup.sql
   The dump carries the search index's virtual table and triggers and rebuilds
   it from the restored rows, so the one file brings search back on its own. ---- */

function sqlLit(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  return "'" + String(v).replace(/'/g, "''") + "'";
}

/* A restorable dump: every user table's CREATE (as IF NOT EXISTS) and rows,
   then the indexes. Explicit ids in the INSERTs carry the AUTOINCREMENT
   sequence along on their own. */
async function dumpDatabase(env) {
  const master = await env.DB.prepare(
    "SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL " +
    "AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'comments_fts%' " +
    "ORDER BY type = 'index', name"
  ).all();
  const parts = ['-- merecatholicity-comments backup ' + new Date().toISOString()];
  for (const m of master.results) {
    if (m.type === 'table') {
      parts.push(m.sql.replace(/^CREATE TABLE\s+/i, 'CREATE TABLE IF NOT EXISTS ') + ';');
      const rows = await env.DB.prepare('SELECT * FROM "' + m.name + '"').all();
      const rs = rows.results;
      if (!rs.length) continue;
      const cols = Object.keys(rs[0]);
      const colList = cols.map((c) => '"' + c + '"').join(', ');
      for (let i = 0; i < rs.length; i += 50) {
        const values = rs.slice(i, i + 50)
          .map((r) => '(' + cols.map((c) => sqlLit(r[c])).join(', ') + ')').join(',\n');
        parts.push('INSERT INTO "' + m.name + '" (' + colList + ') VALUES\n' + values + ';');
      }
    } else if (m.type === 'index') {
      parts.push(m.sql.replace(/^CREATE INDEX\s+/i, 'CREATE INDEX IF NOT EXISTS ') + ';');
    }
  }
  /* The search index is derived data — its shadow tables are excluded above.
     Instead emit its virtual table and triggers and a rebuild, so restoring
     this one file brings search back from the restored comments, no extra step. */
  const fts = await env.DB.prepare(
    "SELECT sql FROM sqlite_master WHERE (name = 'comments_fts' OR (type = 'trigger' AND tbl_name = 'comments')) " +
    "AND sql IS NOT NULL ORDER BY type = 'trigger', name"
  ).all();
  for (const f of fts.results) {
    parts.push(f.sql.replace(/^CREATE (VIRTUAL TABLE|TRIGGER)\s+/i, 'CREATE $1 IF NOT EXISTS ') + ';');
  }
  if (fts.results.length) parts.push("INSERT INTO comments_fts(comments_fts) VALUES('rebuild');");
  return parts.join('\n');
}

async function gzipBytes(text) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const BACKUP_KEEP_DAYS = 90;

/* The Known-IPs history is not a ledger: rows idle past IP_KEEP_DAYS go, and
   banned keys stay whatever their age so a standing ban keeps its handle in
   the drawer. One statement, once a month, riding the backup cron. */
async function pruneIdentityIps(env) {
  const cutoff = Math.floor(Date.now() / 1000) - IP_KEEP_DAYS * 86400;
  try {
    const r = await env.DB.prepare(
      'DELETE FROM identity_ips WHERE last_seen < ?1 AND ip_key NOT IN (SELECT ip FROM ip_bans)'
    ).bind(cutoff).run();
    console.log(JSON.stringify({ event: 'ip_prune', deleted: r.meta && r.meta.changes || 0 }));
  } catch (e) {
    /* A failed prune must never stop the backup behind it. */
    console.log(JSON.stringify({ event: 'ip_prune_failed', error: String(e) }));
  }
}

/* Comments are only ever soft-deleted by the request paths, never physically
   removed, so the monthly cron clears the deleted rows once past their window,
   then sweeps the live replies stranded when a topic was deleted (topic delete
   does not cascade to its replies). Pending rows are left for the admin queue,
   and each statement is guarded so a failure can't stop the backup behind it. */
async function pruneComments(env) {
  const cutoff = Math.floor(Date.now() / 1000) - DELETED_KEEP_DAYS * 86400;
  try {
    const r = await env.DB.prepare(
      "DELETE FROM comments WHERE status = 'deleted' AND created_at < ?1"
    ).bind(cutoff).run();
    console.log(JSON.stringify({ event: 'comment_prune', deleted: r.meta && r.meta.changes || 0 }));
  } catch (e) {
    console.log(JSON.stringify({ event: 'comment_prune_failed', error: String(e) }));
  }
  /* A live reply whose parent no longer exists is invisible everywhere but
     immortal; clear those the deleted-comment prune above just orphaned, plus
     any left by an earlier topic delete. Scoped to live so a pending reply
     under a removed topic still waits on the admin. */
  try {
    const r = await env.DB.prepare(
      "DELETE FROM comments WHERE status = 'live' AND parent_id IS NOT NULL AND parent_id NOT IN (SELECT id FROM comments)"
    ).run();
    console.log(JSON.stringify({ event: 'orphan_prune', deleted: r.meta && r.meta.changes || 0 }));
  } catch (e) {
    console.log(JSON.stringify({ event: 'orphan_prune_failed', error: String(e) }));
  }
}

/* A defensive tidy of direct-message state: messages whose thread is gone and
   threads left with no messages. handleDmDelete purges in two statements, so a
   crash between them could strand one side; this catches that drift. Held
   messages and deleted-identity threads are deliberately left whole. */
async function sweepDms(env) {
  try {
    const r = await env.DB.prepare(
      'DELETE FROM dms WHERE thread_id NOT IN (SELECT id FROM dm_threads)'
    ).run();
    console.log(JSON.stringify({ event: 'dm_orphan_sweep', deleted: r.meta && r.meta.changes || 0 }));
  } catch (e) {
    console.log(JSON.stringify({ event: 'dm_orphan_sweep_failed', error: String(e) }));
  }
  try {
    const r = await env.DB.prepare(
      'DELETE FROM dm_threads WHERE id NOT IN (SELECT DISTINCT thread_id FROM dms)'
    ).run();
    console.log(JSON.stringify({ event: 'dm_empty_sweep', deleted: r.meta && r.meta.changes || 0 }));
  } catch (e) {
    console.log(JSON.stringify({ event: 'dm_empty_sweep_failed', error: String(e) }));
  }
}

/* Clear read notifications older than their window, then sweep dead weight: a
   notification whose post is gone, and a watch on a vanished thread. Unread
   notifications are kept however old, since the reader has not seen them yet.
   Each statement is guarded so one failure never stops the backup behind it. */
async function pruneNotifications(env) {
  const cutoff = Math.floor(Date.now() / 1000) - NOTIFICATIONS_KEEP_DAYS * 86400;
  try {
    const r = await env.DB.prepare(
      'DELETE FROM notifications WHERE read_at IS NOT NULL AND created_at < ?1'
    ).bind(cutoff).run();
    console.log(JSON.stringify({ event: 'notif_prune', deleted: r.meta && r.meta.changes || 0 }));
  } catch (e) {
    console.log(JSON.stringify({ event: 'notif_prune_failed', error: String(e) }));
  }
  try {
    const r = await env.DB.prepare(
      'DELETE FROM notifications WHERE comment_id NOT IN (SELECT id FROM comments)'
    ).run();
    console.log(JSON.stringify({ event: 'notif_orphan_sweep', deleted: r.meta && r.meta.changes || 0 }));
  } catch (e) {
    console.log(JSON.stringify({ event: 'notif_orphan_sweep_failed', error: String(e) }));
  }
  try {
    const r = await env.DB.prepare(
      'DELETE FROM watches WHERE topic_id NOT IN (SELECT id FROM comments WHERE parent_id IS NULL)'
    ).run();
    console.log(JSON.stringify({ event: 'watch_orphan_sweep', deleted: r.meta && r.meta.changes || 0 }));
  } catch (e) {
    console.log(JSON.stringify({ event: 'watch_orphan_sweep_failed', error: String(e) }));
  }
  /* Board read stamps for vanished threads (the floor row, topic_id 0, is kept). */
  try {
    const r = await env.DB.prepare(
      'DELETE FROM thread_reads WHERE topic_id != 0 AND topic_id NOT IN (SELECT id FROM comments WHERE parent_id IS NULL)'
    ).run();
    console.log(JSON.stringify({ event: 'thread_reads_sweep', deleted: r.meta && r.meta.changes || 0 }));
  } catch (e) {
    console.log(JSON.stringify({ event: 'thread_reads_sweep_failed', error: String(e) }));
  }
  /* Reports whose post is gone (hard-deleted). */
  try {
    const r = await env.DB.prepare('DELETE FROM reports WHERE comment_id NOT IN (SELECT id FROM comments)').run();
    console.log(JSON.stringify({ event: 'reports_sweep', deleted: r.meta && r.meta.changes || 0 }));
  } catch (e) {
    console.log(JSON.stringify({ event: 'reports_sweep_failed', error: String(e) }));
  }
}

async function runBackup(env) {
  if (!env.BACKUPS) return { error: 'BACKUPS bucket not bound; enable R2 and redeploy.' };
  const sql = await dumpDatabase(env);
  const gz = await gzipBytes(sql);
  const key = 'backups/comments-' + new Date().toISOString().slice(0, 10) + '.sql.gz';
  await env.BACKUPS.put(key, gz, { httpMetadata: { contentType: 'application/gzip' } });
  const list = await env.BACKUPS.list({ prefix: 'backups/' });
  const cutoff = Date.now() - BACKUP_KEEP_DAYS * 86400 * 1000;
  let pruned = 0;
  for (const obj of list.objects) {
    if (obj.key !== key && obj.uploaded.getTime() < cutoff) {
      await env.BACKUPS.delete(obj.key);
      pruned++;
    }
  }
  /* Mirror the avatar objects too, so all state rides in one bucket. Capped
     well under the free plan's per-invocation subrequest budget; the cap is
     logged when hit, never silent. Old mirror entries are left in place,
     which for a backup is a feature. */
  let avatarsMirrored = 0, avatarsSkipped = 0;
  if (env.AVATARS) {
    const avs = await env.AVATARS.list({ prefix: 'avatars/' });
    const MIRROR_CAP = 15;
    for (const o of avs.objects.slice(0, MIRROR_CAP)) {
      const obj = await env.AVATARS.get(o.key);
      if (!obj) continue;
      await env.BACKUPS.put('avatars-mirror/' + o.key.slice(8),
        await obj.arrayBuffer(), { httpMetadata: obj.httpMetadata });
      avatarsMirrored++;
    }
    avatarsSkipped = Math.max(0, avs.objects.length - MIRROR_CAP);
    if (avatarsSkipped) console.log(JSON.stringify({ event: 'backup_avatar_cap', skipped: avatarsSkipped }));
  }
  const result = { key, sqlBytes: sql.length, gzBytes: gz.length, kept: list.objects.length - pruned, pruned, avatarsMirrored, avatarsSkipped };
  console.log(JSON.stringify({ event: 'backup', ...result }));
  return result;
}

/* Admin-only manual run of the same backup the cron performs, so the path
   can be exercised any day, not only on the first of the month. */
async function handleBackup(request, env) {
  let data;
  try {
    data = await request.json();
  } catch {
    return json({ ok: false, error: 'Bad request.' }, 400);
  }
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.READ_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests.' }, 429);
  const key = String(data.key || '');
  if (!key) return json({ ok: false, error: 'Bad request.' }, 400);
  if (!(await isAdminHash(env, await sha256hex(key)))) return json({ ok: false, error: 'No.' }, 403);
  const result = await runBackup(env);
  return json({ ok: true, backup: result }, 200);
}

/* ---- In-platform moderation. Every control demands a key hashing into
   ADMIN_HASHES; the old signed email links are gone entirely. ---- */

async function requireAdmin(env, key) {
  return !!key && (await isAdminHash(env, await sha256hex(key)));
}

/* Lock or unlock an identity: a reversible disable that logs the holder out
   and refuses every keyed interaction until reversed. */
async function handleLock(request, env) {
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.READ_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests.' }, 429);
  const key = String(data.key || '');
  const hash = String(data.hash || '');
  if (!/^[0-9a-f]{64}$/.test(hash)) return json({ ok: false, error: 'Bad request.' }, 400);
  if (!(await requireAdmin(env, key))) return json({ ok: false, error: 'No.' }, 403);
  if (data.locked) {
    await env.DB.prepare('INSERT OR IGNORE INTO locks (hash, created_at) VALUES (?1, ?2)')
      .bind(hash, Math.floor(Date.now() / 1000)).run();
  } else {
    await env.DB.prepare('DELETE FROM locks WHERE hash = ?1').bind(hash).run();
  }
  return json({ ok: true, locked: !!data.locked }, 200);
}

/* Delete a user and all their public posts: comments go to 'deleted', the
   profile and avatar are removed, and the identity is locked so the same key
   cannot post again. Private DMs are left untouched. */
async function handleDeleteUser(request, env) {
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.POST_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests.' }, 429);
  const key = String(data.key || '');
  const hash = String(data.hash || '');
  if (!/^[0-9a-f]{64}$/.test(hash)) return json({ ok: false, error: 'Bad request.' }, 400);
  if (!(await requireAdmin(env, key))) return json({ ok: false, error: 'No.' }, 403);
  const affected = await env.DB.prepare(
    "SELECT DISTINCT COALESCE(parent_id, id) AS topic FROM comments " +
    "WHERE author_hash = ?1 AND page LIKE 'board:%' AND status != 'deleted'"
  ).bind(hash).all();
  await env.DB.prepare("UPDATE comments SET status = 'deleted' WHERE author_hash = ?1 AND status != 'deleted'")
    .bind(hash).run();
  await env.DB.prepare('DELETE FROM profiles WHERE hash = ?1').bind(hash).run();
  if (env.AVATARS) await env.AVATARS.delete('avatars/' + hash);
  await env.DB.prepare('INSERT OR IGNORE INTO locks (hash, created_at) VALUES (?1, ?2)')
    .bind(hash, Math.floor(Date.now() / 1000)).run();
  for (const r of affected.results) await refreshTopicStats(env, r.topic);
  return json({ ok: true }, 200);
}

function looksLikeIp(s) {
  return /^[0-9a-fA-F:.]{3,45}$/.test(s) && (s.indexOf('.') !== -1 || s.indexOf(':') !== -1);
}

/* Ban or unban IPs. Accepts a single `ip` (the manual list page) or an `ips`
   array (ban-all from the fingerprint drawer). Each is normalized to its ban
   key: a v4 address verbatim, a v6 address to its /64 prefix, so one row holds
   a whole rotating /64 and banning an identity's addresses shuts both families
   at once. */
async function handleIpBan(request, env) {
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  const cip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.READ_LIMIT.limit({ key: cip });
  if (!success) return json({ ok: false, error: 'Too many requests.' }, 429);
  const key = String(data.key || '');
  const raw = Array.isArray(data.ips) ? data.ips : [data.ip];
  const keys = [...new Set(raw.map(toBanKey).filter(Boolean))];
  if (!keys.length) return json({ ok: false, error: 'That is not a valid IP address.' }, 400);
  if (!(await requireAdmin(env, key))) return json({ ok: false, error: 'No.' }, 403);
  const now = Math.floor(Date.now() / 1000);
  for (const k of keys) {
    if (data.banned) {
      await env.DB.prepare('INSERT OR IGNORE INTO ip_bans (ip, created_at) VALUES (?1, ?2)').bind(k, now).run();
    } else {
      await env.DB.prepare('DELETE FROM ip_bans WHERE ip = ?1').bind(k).run();
    }
  }
  return json({ ok: true, banned: !!data.banned, keys }, 200);
}

/* Lazy, admin-only reverse-DNS for the IPs of one fingerprint, fetched when a
   drawer opens. Kept off the bulk meta path and the poster's write path; a
   handful of DoH lookups per call, well under the free-tier subrequest cap. */
async function handleRdns(request, env) {
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.READ_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests.' }, 429);
  if (!(await requireAdmin(env, String(data.key || '')))) return json({ ok: false, error: 'No.' }, 403);
  const ips = Array.isArray(data.ips) ? data.ips.slice(0, 8) : [];
  const rdns = {};
  await Promise.all(ips.map(async (raw) => {
    const s = String(raw || '').trim();
    if (looksLikeIp(s)) rdns[s] = await ptrLookup(s);
  }));
  return json({ ok: true, rdns }, 200);
}

/* The banned-IP list for the admin page. */
async function handleIpBans(request, env) {
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.READ_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests.' }, 429);
  if (!(await requireAdmin(env, String(data.key || '')))) return json({ ok: false, error: 'No.' }, 403);
  const rows = await env.DB.prepare('SELECT ip, created_at FROM ip_bans ORDER BY created_at DESC LIMIT 1000').all();
  return json({ ok: true, ips: rows.results }, 200);
}

/* A member reports a post to the moderators. The post stays live; the report
   only surfaces it in the Activity audit's Reported queue. One report per member
   per post (INSERT OR IGNORE against the UNIQUE), so no brigade can inflate a
   count or hide anything. An optional short reason rides along. */
async function handleReport(request, env) {
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.POST_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many reports at once. Wait a minute.' }, 429);
  const key = String(data.key || '');
  const id = Number(data.id);
  if (!key || !Number.isInteger(id) || id < 1) return json({ ok: false, error: 'Bad request.' }, 400);
  const me = await sha256hex(key);
  const gate = await blockedReason(env, me, ip);
  if (gate) return blockedJson(gate);
  const target = await env.DB.prepare("SELECT 1 AS ok FROM comments WHERE id = ?1 AND status = 'live'").bind(id).first();
  if (!target) return json({ ok: false, error: 'No such post.' }, 404);
  let reason = String(data.reason || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (CONTROL_RE.test(reason)) reason = '';
  await env.DB.prepare(
    'INSERT OR IGNORE INTO reports (comment_id, reporter_hash, reason, created_at) VALUES (?1, ?2, ?3, ?4)'
  ).bind(id, me, reason || null, Math.floor(Date.now() / 1000)).run();
  return json({ ok: true }, 200);
}

/* An admin dismisses a post's reports, clearing it from the Reported queue while
   leaving the post itself alone. */
async function handleReportDismiss(request, env) {
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.READ_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests.' }, 429);
  const key = String(data.key || '');
  const id = Number(data.id);
  if (!(await requireAdmin(env, key))) return json({ ok: false, error: 'No.' }, 403);
  if (!Number.isInteger(id) || id < 1) return json({ ok: false, error: 'Bad request.' }, 400);
  await env.DB.prepare('DELETE FROM reports WHERE comment_id = ?1').bind(id).run();
  return json({ ok: true }, 200);
}

/* Approve a held comment: the in-platform replacement for the old email link. */
async function handleApprove(request, env) {
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.READ_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests.' }, 429);
  const key = String(data.key || '');
  const id = Number(data.id);
  if (!Number.isInteger(id) || id < 1) return json({ ok: false, error: 'Bad request.' }, 400);
  if (!(await requireAdmin(env, key))) return json({ ok: false, error: 'No.' }, 403);
  const row = await env.DB.prepare(
    "UPDATE comments SET status = 'live' WHERE id = ?1 AND status = 'pending' RETURNING page, parent_id"
  ).bind(id).first();
  if (row && boardKey(row.page)) await refreshTopicStats(env, row.parent_id || id);
  return json({ ok: true, approved: !!row }, 200);
}

/* The pending-review queue: every held comment, newest first. */
async function handlePending(request, env) {
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.READ_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests.' }, 429);
  if (!(await requireAdmin(env, String(data.key || '')))) return json({ ok: false, error: 'No.' }, 403);
  const rows = await env.DB.prepare(
    "SELECT c.id, c.page, c.parent_id, c.title, c.author_hash, pr.nick, c.body, c.created_at, c.ai_verdict " +
    "FROM comments c LEFT JOIN profiles pr ON pr.hash = c.author_hash " +
    "WHERE c.status = 'pending' ORDER BY c.id DESC LIMIT 200"
  ).all();
  return json({ ok: true, pending: rows.results }, 200);
}

/* The admin roster for the console: every admin, equal, each removable, carried
   with the name they post under so the list reads in people, not hashes. Seeded
   from the env owners on first view so they appear as ordinary rows. */
async function handleAdmins(request, env) {
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.READ_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests.' }, 429);
  if (!(await requireAdmin(env, String(data.key || '')))) return json({ ok: false, error: 'No.' }, 403);
  await ensureAdminsSeeded(env);
  const dyn = await env.DB.prepare('SELECT hash, created_at FROM admins ORDER BY created_at, hash').all();
  const list = (dyn.results || []).map((r) => ({ hash: r.hash, created_at: r.created_at }));
  /* Resolve each admin's chosen nick in one query; the assigned pseudonym is
     pure from the hash, so it fills the rest. */
  if (list.length) {
    const ph = list.map((_, i) => '?' + (i + 1)).join(',');
    const rows = await env.DB.prepare('SELECT hash, nick FROM profiles WHERE hash IN (' + ph + ')')
      .bind(...list.map((a) => a.hash)).all();
    const nick = {};
    for (const r of (rows.results || [])) nick[r.hash] = r.nick;
    for (const a of list) { a.nick = nick[a.hash] || null; a.assigned = displayName(a.hash); }
  }
  return json({ ok: true, admins: list }, 200);
}

/* Grant or revoke admin. Every admin is equal: any admin may promote a member
   (picked by @-mention in the console) or drop any admin, owners and themselves
   included. The one guard is a rule about count, not about who — the last admin
   cannot be removed, so the board is never left with none, an irreversible
   lockout. Add another first, then step down. */
async function handleAdmin(request, env) {
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.READ_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests.' }, 429);
  const key = String(data.key || '');
  const hash = String(data.hash || '');
  if (!/^[0-9a-f]{64}$/.test(hash)) return json({ ok: false, error: 'Bad request.' }, 400);
  const me = key ? await sha256hex(key) : '';
  if (!(await isAdminHash(env, me))) return json({ ok: false, error: 'No.' }, 403);
  await ensureAdminsSeeded(env);
  if (data.admin) {
    await env.DB.prepare('INSERT OR IGNORE INTO admins (hash, added_by, created_at) VALUES (?1, ?2, ?3)')
      .bind(hash, me, Math.floor(Date.now() / 1000)).run();
    return json({ ok: true, admin: true }, 200);
  }
  const present = await env.DB.prepare('SELECT 1 AS a FROM admins WHERE hash = ?1').bind(hash).first();
  if (present) {
    const cnt = await env.DB.prepare('SELECT COUNT(*) AS n FROM admins').first();
    if (cnt && cnt.n <= 1) {
      return json({ ok: false, error: 'This is the last admin. Add another before removing this one.' }, 400);
    }
  }
  await env.DB.prepare('DELETE FROM admins WHERE hash = ?1').bind(hash).run();
  return json({ ok: true, admin: false }, 200);
}

/* ============================== merecat ==================================
   The librarian bot: members-only RAG over the site corpus. The corpus lives
   in LIBDB (chunks + an FTS5 index over all of it) with a Vectorize index
   (MERECAT_INDEX) holding semantic vectors for the Tier-1 works only — the
   free plan stores ~4,880 vectors at 1024 dims, so the deep shelf rides BM25.
   Retrieval is hybrid: embed the question (bge-m3), query Vectorize, BM25 the
   whole corpus with tier-weighted rank, rerank the merged pool
   (bge-reranker-base), and hand the top chunks to the chat model with the
   persona from config. Answers stream back as plain text behind a one-line
   JSON preamble carrying the numbered sources. Questions are never stored —
   usage tables hold counters only. All of LIBDB is derived data rebuilt by
   librarian/ingest.py, which is why the backup cron ignores it. */

const MERECAT_DEFAULTS = {
  model: '@cf/qwen/qwen3-30b-a3b-fp8',
  user_cap_on: 0,     // per-member daily cap: 0 = off (community budget is the only wall)
  user_daily: 10,     // questions per member per UTC day, when the cap is on
  global_daily: 150,  // questions across the community per UTC day
  topk: 8,            // chunks handed to the model
  max_tokens: 1100,
};
const MERECAT_SITE = 'https://merecatholicity.com/';
/* Six weight bands, the site owner's own ladder: the site's works and its
   catechetical core, the Scriptures, the named works of the Fathers, the
   councils and the schism documents, the deep Schaff/Summa sets, and Newman
   entire. Band feeds the retrieval boost, the prompt label, and the
   transparency panel's grouping. */
const MERECAT_TIER_LABEL = {
  1: 'site position', 2: 'scripture', 3: 'the Fathers',
  4: 'councils, confessions, and the schism', 5: 'deep shelf', 6: 'Newman',
  7: 'the Roman world',
};
const MERECAT_RESTING =
  'merecat is resting. The community’s shared daily budget is spent. It resets at midnight UTC.';

/* The librarian's public face on the board: a pseudo-member that exists only
   as this fixed hash (the preimage was random and discarded, so no key can
   ever produce it — nobody can post as the bot). It holds no subscriptions,
   cannot be DMed (handleDmSend refuses, the directory omits it), and is
   summoned one way: writing @merecat in a live forum post or article-page
   comment, which runs merecatMentionReply. */
const MERECAT_BOT = {
  hash: 'efb94d8de69dc537e2bba1facbd9db3f849f3927593488d19c07629ce35f54cc',
  nick: 'merecat 🐈 AI BOT',
};
const MERECAT_MENTION_RE = /@merecat\b/i;
const MERECAT_RV = 7;   // retrieval build: bump when retrieval logic changes

/* Config (persona, model, caps) lives in LIBDB so `make librarian` can change
   the bot's behavior with no redeploy. Cached per isolate for five minutes;
   a config push clears this isolate at once and the rest lag out the TTL. */
let merecatConfigCache = { at: 0, cfg: null };

async function merecatConfig(env) {
  if (merecatConfigCache.cfg && Date.now() - merecatConfigCache.at < 300000) {
    return merecatConfigCache.cfg;
  }
  const cfg = { ...MERECAT_DEFAULTS, persona: '' };
  try {
    const { results } = await env.LIBDB.prepare('SELECT k, v FROM config').all();
    for (const r of results || []) {
      if (r.k === 'persona') cfg.persona = String(r.v);
      else if (r.k === 'model') cfg.model = String(r.v);
      else if (r.k === 'user_cap_on') cfg.user_cap_on = Number(r.v) ? 1 : 0;
      else if (r.k in MERECAT_DEFAULTS) cfg[r.k] = Number(r.v) || MERECAT_DEFAULTS[r.k];
    }
  } catch (err) {
    console.log(JSON.stringify({ event: 'merecat_config_failed', error: String(err) }));
  }
  merecatConfigCache = { at: Date.now(), cfg };
  return cfg;
}

function merecatDay() {
  return new Date().toISOString().slice(0, 10);
}

/* Strip <think>...</think> spans from a token stream, across chunk borders.
   qwen3 is a reasoning model with no documented off switch on Workers AI, so
   the persona carries /no_think and this filter guarantees no reasoning ever
   reaches the client either way. Holds back a small tail in case a tag is
   split between deltas; flush(null) drains it. */
function merecatThinkStripper() {
  let carry = '';
  let inThink = false;
  let started = false; // trim leading whitespace once, after any think block
  return function feed(delta) {
    if (delta != null) carry += delta;
    let out = '';
    for (;;) {
      if (inThink) {
        const close = carry.indexOf('</think>');
        if (close === -1) { carry = carry.slice(-8); break; }
        carry = carry.slice(close + 8);
        inThink = false;
        continue;
      }
      const open = carry.indexOf('<think>');
      if (open !== -1) {
        out += carry.slice(0, open);
        carry = carry.slice(open + 7);
        inThink = true;
        continue;
      }
      if (delta == null) { out += carry; carry = ''; }
      else { out += carry.slice(0, Math.max(0, carry.length - 7)); carry = carry.slice(-7); }
      break;
    }
    if (!started && out) { out = out.replace(/^\s+/, ''); if (out) started = true; }
    return out;
  };
}

/* A question is not a search string. The forum's buildMatch ANDs its first
   ten tokens — right for terse searches, fatal for natural questions, whose
   opening tokens are mostly filler: the AND then demands words like "where"
   and "newman" of texts that never say them, and the informative tail is
   truncated away. So merecat translates a question itself: drop the filler,
   keep up to sixteen informative tokens (user-quoted phrases preserved),
   and join with OR so bm25 ranks by how much of the MEANING a chunk
   matches. Every token is double-quoted, so no FTS5 operator can ride in. */
const MERECAT_STOP = new Set(('a about all an and any are as at be been but by can could did do does for from had has have ' +
  'he her his how i if in into is it its just like me my no not of on one or our out over say says said she should so some ' +
  'than that the their them then there these they this to under up us was we were what when where which who why will with ' +
  'would you your').split(' '));

function merecatMatch(q) {
  const out = [];
  const seen = new Set();
  const re = /"([^"]*)"|([A-Za-z0-9À-ɏ'’]+)/g;
  let m;
  while ((m = re.exec(String(q || ''))) && out.length < 16) {
    if (m[1] !== undefined) {
      const p = m[1].trim();
      if (p) out.push('"' + p.replace(/"/g, '""') + '"');
      continue;
    }
    const w = m[2].toLowerCase().replace(/[’']/g, '');
    if (w.length < 2 || MERECAT_STOP.has(w) || seen.has(w)) continue;
    seen.add(w);
    out.push('"' + w.replace(/"/g, '""') + '"');
  }
  return out.join(' OR ');
}

/* The phrase leg: when a question carries a quotation, its own word runs
   are the strongest possible scent — a text that IS the quote nails a
   six-word phrase that texts merely discussing it rarely reproduce. Slide
   windows over the question's tokens (stopwords kept, phrases need them)
   and offer the longest few as FTS phrase alternatives. */
function merecatPhrases(q) {
  const words = String(q || '').match(/[A-Za-z0-9À-ɏ'’]+/g) || [];
  if (words.length < 5) return '';
  const phrases = [];
  // EVERY contiguous five-gram, stride one: any strided comb leaves gaps
  // (a stride-three comb twice straddled "the souls of the just" and the
  // primary text went unfound). A quotation of five words or more in the
  // question is thereby guaranteed one exact-phrase alternative.
  for (let i = 0; i + 5 <= words.length && phrases.length < 20; i += 1) {
    phrases.push('"' + words.slice(i, i + 5).join(' ').replace(/"/g, '""') + '"');
  }
  return phrases.join(' OR ');
}

/* Hybrid retrieval: returns up to cfg.topk chunks, each
   { cid, title, url, anchor, heading, tier, text }. Every leg fails soft so a
   broken index degrades the answer instead of killing it. */
async function merecatRetrieve(env, q, cfg) {
  const pool = new Map(); // cid -> chunk row stub
  const add = (r, sem, phr) => {
    if (!r || !r.cid) return;
    const had = pool.get(r.cid);
    if (had) { if (phr) had.phr = true; return; }
    pool.set(r.cid, { cid: r.cid, work: r.work_id, title: r.title, url: r.url,
      anchor: r.anchor || '', heading: r.heading || '', tier: r.tier || 2,
      text: r.text || '', sem: !!sem, phr: !!phr });
  };

  // Semantic leg: Tier-1 vectors.
  let semIds = [];
  try {
    const emb = await env.AI.run('@cf/baai/bge-m3', { text: [q] });
    const vec = emb && emb.data && emb.data[0];
    if (vec) {
      const res = await env.MERECAT_INDEX.query(vec, { topK: 8, returnMetadata: 'none' });
      semIds = (res && res.matches ? res.matches : []).map((m) => m.id);
    }
  } catch (err) {
    console.log(JSON.stringify({ event: 'merecat_semantic_failed', error: String(err) }));
  }
  if (semIds.length) {
    try {
      const ph = semIds.map((_, i) => '?' + (i + 1)).join(',');
      const rows = await env.LIBDB.prepare(
        'SELECT c.cid, c.work_id, c.heading, c.anchor, c.text, w.title, w.url, w.tier ' +
        'FROM chunks c JOIN works w ON w.id = c.work_id WHERE c.cid IN (' + ph + ')'
      ).bind(...semIds).all();
      const byCid = {};
      for (const r of rows.results || []) byCid[r.cid] = r;
      for (const cid of semIds) add(byCid[cid], true); // keep Vectorize's order
    } catch (err) {
      console.log(JSON.stringify({ event: 'merecat_semfetch_failed', error: String(err) }));
    }
  }

  // BM25 legs: one tier-weighted toward the primary works (the owner's
  // ladder), and one on raw relevance alone — so a verbatim hit deep on the
  // shelf can never be crowded out of the pool by boosted works that merely
  // quote the same words. The reranker judges the merged pool afterward.
  const match = merecatMatch(q);
  if (match) {
    const SEL =
      'SELECT c.cid, c.work_id, c.heading, c.anchor, c.text, w.title, w.url, w.tier ' +
      'FROM chunks_fts JOIN chunks c ON c.id = chunks_fts.rowid ' +
      'JOIN works w ON w.id = c.work_id WHERE chunks_fts MATCH ?1 ';
    try {
      // bm25 is negative-better, so a bigger multiplier boosts a band. The
      // owner's ladder: site core, then the Scriptures with Newman just
      // beneath them (the interpretive companion the Fathers are read
      // with), then the named Fathers, the councils, the deep shelf.
      const weighted = await env.LIBDB.prepare(SEL +
        'ORDER BY bm25(chunks_fts) * (CASE w.tier WHEN 1 THEN 1.6 WHEN 2 THEN 1.45 WHEN 6 THEN 1.4 WHEN 3 THEN 1.35 WHEN 4 THEN 1.25 WHEN 7 THEN 0.9 ELSE 1.0 END) ' +
        'LIMIT 18').bind(match).all();
      for (const r of weighted.results || []) add(r, false);
      const raw = await env.LIBDB.prepare(SEL +
        'ORDER BY bm25(chunks_fts) LIMIT 12').bind(match).all();
      for (const r of raw.results || []) add(r, false);
      const phr = merecatPhrases(q);
      if (phr) {
        // a deep LIMIT: bm25 ranks heavy quoters of a phrase above the text
        // that says it once, so the primary source can sit well down this
        // list — the reranker and the guaranteed phrase seats sort it out
        const hits = await env.LIBDB.prepare(SEL +
          'ORDER BY bm25(chunks_fts) LIMIT 20').bind(phr).all();
        for (const r of hits.results || []) add(r, false, true);
      }
    } catch (err) {
      console.log(JSON.stringify({ event: 'merecat_fts_failed', error: String(err) }));
    }
  }

  let candidates = [...pool.values()];
  if (!candidates.length) return [];

  // Rerank the merged pool against the question; fall back to merge order
  // (semantic hits first) if the reranker misbehaves.
  if (candidates.length > cfg.topk) {
    try {
      const contexts = candidates.map((c) => ({
        text: (c.heading ? c.heading + ': ' : '') + c.text.slice(0, 1500),
      }));
      const rr = await env.AI.run('@cf/baai/bge-reranker-base', { query: q, contexts });
      const scored = (rr && rr.response ? rr.response : [])
        .filter((s) => s && Number.isInteger(s.id) && candidates[s.id])
        .sort((a, b) => b.score - a.score);
      if (scored.length) {
        const seen = new Set();
        const ranked = [];
        for (const s of scored) {
          if (seen.has(s.id)) continue;
          seen.add(s.id);
          ranked.push(candidates[s.id]);
        }
        candidates = ranked;
      }
    } catch (err) {
      console.log(JSON.stringify({ event: 'merecat_rerank_failed', error: String(err) }));
      candidates.sort((a, b) => (b.sem ? 1 : 0) - (a.sem ? 1 : 0));
    }
  }
  /* A phrase hit matched the question's own words verbatim — stronger
     evidence than a rerank score computed on a window that can miss the
     match — so the best couple of phrase hits always keep a seat. */
  const chosen = candidates.slice(0, cfg.topk);
  const owed = candidates.filter((c) => c.phr && chosen.indexOf(c) === -1).slice(0, 2);
  for (const p of owed) {
    for (let i = chosen.length - 1; i >= 0; i--) {
      if (!chosen[i].phr) { chosen[i] = p; break; }
    }
  }
  return chosen;
}

/* The librarian answers. Auth is the board's own (any identity key, the
   blocked gate, per-IP throttle) plus two daily caps guarding the shared
   Workers AI budget. Refusals are JSON; an answer is a text/plain stream:
   one JSON line {sources:[...]}, a blank line, then the tokens. */
async function handleMerecatAsk(request, env, ctx) {
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.POST_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many questions at once. Wait a minute.' }, 429);
  const key = String(data.key || '');
  let q = String(data.q || '').trim().slice(0, 2000);
  if (!key || !q) return json({ ok: false, error: 'Bad request.' }, 400);
  const me = await sha256hex(key);
  const gate = await blockedReason(env, me, ip);
  if (gate) return blockedJson(gate);

  const cfg = await merecatConfig(env);
  const day = merecatDay();
  /* Admins are never capped — their use still counts in every tally, and the
     page shows an over-the-line 12/10 plainly — the true wall for them is
     the free budget itself (any Workers AI refusal reads as resting). */
  const admin = await isAdminHash(env, me);
  let youQ = 0;
  let todayQ = 0;
  try {
    const g = await env.LIBDB.prepare('SELECT q FROM usage WHERE day = ?1').bind(day).first();
    todayQ = (g && g.q) || 0;
    if (!admin && todayQ >= cfg.global_daily) {
      return json({ ok: false, resting: true, error: MERECAT_RESTING }, 429);
    }
    const u = await env.LIBDB.prepare('SELECT q FROM user_usage WHERE day = ?1 AND hash = ?2')
      .bind(day, me).first();
    youQ = (u && u.q) || 0;
    if (!admin && cfg.user_cap_on && youQ >= cfg.user_daily) {
      return json({
        ok: false, capped: true,
        error: 'You have used your ' + cfg.user_daily + ' questions for today. The counter resets at midnight UTC.',
      }, 429);
    }
  } catch (err) {
    console.log(JSON.stringify({ event: 'merecat_caps_failed', error: String(err) }));
  }

  /* The conversation thread (the DM idiom): an id continues the caller's own
     saved thread, no id means a new thread, created once the model accepts
     the question. The thread is the memory — the client never supplies
     history. Context is the newest MERECAT_WINDOW turns word for word plus
     the running condensed summary of everything older (maintained after
     each answer by merecatFold), so a long thread stays coherent at a
     bounded cost. */
  let chatId = Number(data.chat) || 0;
  let history = [];
  let summary = '';
  if (chatId) {
    const own = await env.LIBDB.prepare('SELECT id, summary FROM chats WHERE id = ?1 AND hash = ?2')
      .bind(chatId, me).first();
    if (!own) return json({ ok: false, error: 'No such conversation.' }, 404);
    summary = String(own.summary || '');
    const rows = await env.LIBDB.prepare(
      'SELECT role, body FROM chat_msgs WHERE chat_id = ?1 ORDER BY id DESC LIMIT ' + MERECAT_WINDOW
    ).bind(chatId).all();
    history = (rows.results || []).reverse()
      .map((r) => ({ role: r.role, content: String(r.body).slice(0, 1200) }));
  }

  const chunks = await merecatRetrieve(env, q, cfg);

  // Build the prompt: persona, the thread's condensed summary when one
  // exists, the numbered sources, the recent turns verbatim, the question.
  const sources = chunks.map((c, i) => ({
    n: i + 1, title: c.title, heading: c.heading,
    url: MERECAT_SITE + c.url + (c.anchor ? '#' + c.anchor : ''),
  }));
  let srcBlock = '';
  chunks.forEach((c, i) => {
    srcBlock += '[' + (i + 1) + '] (' + (MERECAT_TIER_LABEL[c.tier] || 'shelf') + ') ' + c.title +
      (c.heading ? ' — ' + c.heading : '') + '\n' + c.text.slice(0, 2800) + '\n\n';
  });
  const sys = (cfg.persona || 'You are merecat, the librarian of merecatholicity.com. Answer from the sources given, citing each by its bracketed number, like [2].') +
    (summary ? '\n\nTHE CONVERSATION SO FAR, condensed (the newest turns follow verbatim):\n' + summary : '') +
    '\n\nSOURCES (cite by bracketed number, like [3] — write the digit; cite what carries weight — a few for a simple question, more when the question truly spans the shelf; these are the only citable sources this turn' +
    (srcBlock ? '' : '; none were retrieved, so say the shelf does not cover this directly and answer from general knowledge, labeled as such') +
    '):\n\n' + (srcBlock || '(none)') + '/no_think';
  const messages = [{ role: 'system', content: sys }];
  for (const h of history) messages.push(h);
  messages.push({ role: 'user', content: q });

  let aiStream;
  try {
    aiStream = await env.AI.run(cfg.model, {
      messages, stream: true, max_tokens: cfg.max_tokens, temperature: 0.35,
    });
  } catch (err) {
    console.log(JSON.stringify({ event: 'merecat_ai_failed', error: String(err) }));
    return json({ ok: false, resting: true, error: MERECAT_RESTING }, 503);
  }

  /* The model accepted the question: now the thread exists and the question
     is on it (so an interrupted stream still leaves the thread coherent). */
  const now = Math.floor(Date.now() / 1000);
  if (!chatId) {
    const ins = await env.LIBDB.prepare(
      'INSERT INTO chats (hash, title, created_at, last_at, msgs) VALUES (?1, ?2, ?3, ?3, 0) RETURNING id'
    ).bind(me, q.slice(0, 90), now).first();
    chatId = ins.id;
  }
  await env.LIBDB.batch([
    env.LIBDB.prepare("INSERT INTO chat_msgs (chat_id, role, body, created_at) VALUES (?1, 'user', ?2, ?3)")
      .bind(chatId, q, now),
    env.LIBDB.prepare('UPDATE chats SET last_at = ?2, msgs = msgs + 1 WHERE id = ?1').bind(chatId, now),
  ]);

  const inTokEst = Math.ceil(JSON.stringify(messages).length / 4);
  // the quota line's fresh numbers, counting the question now being answered
  const used = {
    you: youQ + 1, cap: cfg.user_daily, cap_on: cfg.user_cap_on,
    today: todayQ + 1, gcap: cfg.global_daily, admin,
  };
  const { readable, writable } = new TransformStream();
  ctx.waitUntil(
    merecatPump(env, cfg, aiStream, writable, sources, me, day, inTokEst, chatId, used)
      .catch((err) => console.log(JSON.stringify({ event: 'merecat_pump_failed', error: String(err) })))
  );
  return new Response(readable, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

/* Drain the model's SSE stream into the client stream: preamble first (the
   thread id and the sources), then deltas with think spans stripped. When
   the stream ends: bump the usage counters, store the answer on the thread,
   and fold aged turns into the thread's condensed summary. */
async function merecatPump(env, cfg, aiStream, writable, sources, me, day, inTokEst, chatId, used) {
  const writer = writable.getWriter();
  const encode = (s) => enc.encode(s);
  const strip = merecatThinkStripper();
  let text = '';
  let usage = null;
  try {
    // rv marks the retrieval build that answered, so a live test can prove
    // which deployed code served it (isolates lag deploys by minutes)
    await writer.write(encode(JSON.stringify({ chat: chatId, sources, used, rv: MERECAT_RV }) + '\n\n'));
    const reader = aiStream.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();
        if (payload === '[DONE]') continue;
        try {
          const obj = JSON.parse(payload);
          if (obj.usage) usage = obj.usage;
          // a purely numeric token arrives as a JSON number, not a string —
          // coerce, or years and [n] citation digits vanish from answers
          const delta = obj.response == null ? '' : String(obj.response);
          if (delta) {
            const vis = strip(delta);
            if (vis) { text += vis; await writer.write(encode(vis)); }
          }
        } catch { /* partial or non-JSON line: skip */ }
      }
    }
    const tail = strip(null);
    if (tail) { text += tail; await writer.write(encode(tail)); }
  } finally {
    try { await writer.close(); } catch { /* client gone */ }
  }
  const inTok = usage && usage.prompt_tokens ? usage.prompt_tokens : inTokEst;
  const outTok = usage && usage.completion_tokens ? usage.completion_tokens : Math.ceil(text.length / 4);
  const stmts = [
    env.LIBDB.prepare(
      'INSERT INTO usage (day, q, in_tok, out_tok) VALUES (?1, 1, ?2, ?3) ' +
      'ON CONFLICT(day) DO UPDATE SET q = q + 1, in_tok = in_tok + ?2, out_tok = out_tok + ?3'
    ).bind(day, inTok, outTok),
    env.LIBDB.prepare(
      'INSERT INTO user_usage (day, hash, q) VALUES (?1, ?2, 1) ' +
      'ON CONFLICT(day, hash) DO UPDATE SET q = q + 1'
    ).bind(day, me),
  ];
  const answer = text.trim();
  if (chatId && answer) {
    const now = Math.floor(Date.now() / 1000);
    stmts.push(env.LIBDB.prepare(
      "INSERT INTO chat_msgs (chat_id, role, body, sources, created_at) VALUES (?1, 'assistant', ?2, ?3, ?4)"
    ).bind(chatId, answer, JSON.stringify(sources), now));
    stmts.push(env.LIBDB.prepare('UPDATE chats SET last_at = ?2, msgs = msgs + 1 WHERE id = ?1')
      .bind(chatId, now));
  }
  await env.LIBDB.batch(stmts);
  if (chatId && answer) await merecatFold(env, cfg, chatId);
}

/* Keep a long thread rememberable at a bounded cost: once turns age past
   the verbatim window, condense them into the thread's running summary with
   one cheap model call, made after the answer is already on its way so it
   never adds latency. A failed fold just waits for the next turn. */
const MERECAT_WINDOW = 10;   // newest turns sent verbatim
const MERECAT_FOLD_MIN = 4;  // fold only when this many turns have aged out

async function merecatFold(env, cfg, chatId) {
  try {
    const chat = await env.LIBDB.prepare(
      'SELECT summary, summarized_to FROM chats WHERE id = ?1').bind(chatId).first();
    if (!chat) return;
    const all = await env.LIBDB.prepare(
      'SELECT id, role, body FROM chat_msgs WHERE chat_id = ?1 ORDER BY id').bind(chatId).all();
    const rows = all.results || [];
    if (rows.length <= MERECAT_WINDOW) return;
    const cutoff = rows[rows.length - MERECAT_WINDOW].id;
    const aged = rows.filter((r) => r.id < cutoff && r.id > (chat.summarized_to || 0));
    if (aged.length < MERECAT_FOLD_MIN) return;
    const notes = aged.map((r) =>
      (r.role === 'user' ? 'Reader: ' : 'Librarian: ') + String(r.body).slice(0, 800)).join('\n');
    const res = await env.AI.run(cfg.model, {
      messages: [
        { role: 'system', content:
          'You condense a running conversation log. Reply with only the updated summary, ' +
          'under 220 words of plain prose, keeping the reader’s aims, the positions ' +
          'discussed, every work or reference cited, and any open questions. /no_think' },
        { role: 'user', content:
          'Current summary:\n' + (chat.summary || '(none yet)') +
          '\n\nNew turns to fold in:\n' + notes },
      ],
      max_tokens: 420, temperature: 0.2,
    });
    let s = res == null ? '' : (res.response != null ? String(res.response)
      : (res.choices && res.choices[0] && res.choices[0].message
        ? String(res.choices[0].message.content || '') : ''));
    s = s.replace(/<think>[\s\S]*?<\/think>/g, '').trim().slice(0, 1600);
    if (s) {
      await env.LIBDB.prepare('UPDATE chats SET summary = ?2, summarized_to = ?3 WHERE id = ?1')
        .bind(chatId, s, aged[aged.length - 1].id).run();
    }
  } catch (err) {
    console.log(JSON.stringify({ event: 'merecat_fold_failed', error: String(err) }));
  }
}

/* The saved-thread trio, each strictly owner-keyed. Listing also prunes the
   caller's expired threads, so the thirty-day promise is enforced the
   moment anyone looks; the monthly cron sweeps the never-returning rest. */
const MERECAT_CHAT_DAYS = 30;

async function handleMerecatChats(request, env) {
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.READ_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests. Slow down.' }, 429);
  const key = String(data.key || '');
  if (!key) return json({ ok: false, error: 'Bad request.' }, 400);
  const me = await sha256hex(key);
  const gate = await blockedReason(env, me, ip);
  if (gate) return blockedJson(gate);
  const cut = Math.floor(Date.now() / 1000) - MERECAT_CHAT_DAYS * 86400;
  await env.LIBDB.batch([
    env.LIBDB.prepare(
      'DELETE FROM chat_msgs WHERE chat_id IN (SELECT id FROM chats WHERE hash = ?1 AND last_at < ?2)'
    ).bind(me, cut),
    env.LIBDB.prepare('DELETE FROM chats WHERE hash = ?1 AND last_at < ?2').bind(me, cut),
  ]);
  const rows = await env.LIBDB.prepare(
    'SELECT id, title, msgs, last_at FROM chats WHERE hash = ?1 ORDER BY last_at DESC LIMIT 50'
  ).bind(me).all();
  return json({ ok: true, chats: rows.results || [] }, 200);
}

async function handleMerecatChat(request, env) {
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.READ_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests. Slow down.' }, 429);
  const key = String(data.key || '');
  const id = Number(data.id);
  if (!key || !Number.isInteger(id) || id < 1) return json({ ok: false, error: 'Bad request.' }, 400);
  const me = await sha256hex(key);
  const gate = await blockedReason(env, me, ip);
  if (gate) return blockedJson(gate);
  const chat = await env.LIBDB.prepare(
    'SELECT id, title, msgs, created_at, last_at FROM chats WHERE id = ?1 AND hash = ?2'
  ).bind(id, me).first();
  if (!chat) return json({ ok: false, error: 'No such conversation.' }, 404);
  const msgs = await env.LIBDB.prepare(
    'SELECT role, body, sources, created_at FROM chat_msgs WHERE chat_id = ?1 ORDER BY id LIMIT 400'
  ).bind(id).all();
  return json({ ok: true, chat, msgs: msgs.results || [] }, 200);
}

async function handleMerecatChatDelete(request, env) {
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.POST_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests. Slow down.' }, 429);
  const key = String(data.key || '');
  const id = Number(data.id);
  if (!key || !Number.isInteger(id) || id < 1) return json({ ok: false, error: 'Bad request.' }, 400);
  const me = await sha256hex(key);
  const gate = await blockedReason(env, me, ip);
  if (gate) return blockedJson(gate);
  const own = await env.LIBDB.prepare('SELECT id FROM chats WHERE id = ?1 AND hash = ?2')
    .bind(id, me).first();
  if (!own) return json({ ok: false, error: 'No such conversation.' }, 404);
  await env.LIBDB.batch([
    env.LIBDB.prepare('DELETE FROM chat_msgs WHERE chat_id = ?1').bind(id),
    env.LIBDB.prepare('DELETE FROM chats WHERE id = ?1').bind(id),
  ]);
  return json({ ok: true, deleted: id }, 200);
}

/* Monthly sweep of expired threads (the opportunistic per-owner prune in
   handleMerecatChats covers everyone who returns; this catches the rest).
   Self-contained like every prune, so a failure never stops the backup. */
async function pruneMerecatChats(env) {
  try {
    const cut = Math.floor(Date.now() / 1000) - MERECAT_CHAT_DAYS * 86400;
    await env.LIBDB.batch([
      env.LIBDB.prepare(
        'DELETE FROM chat_msgs WHERE chat_id IN (SELECT id FROM chats WHERE last_at < ?1)').bind(cut),
      env.LIBDB.prepare('DELETE FROM chats WHERE last_at < ?1').bind(cut),
    ]);
  } catch (err) {
    console.log(JSON.stringify({ event: 'merecat_chatprune_failed', error: String(err) }));
  }
}

/* Corpus push, admin-keyed, driven by librarian/ingest.py. A work arrives as
   begin (upsert the works row, clear its old chunks and vectors), one or more
   append batches (rows, and vectors for Tier-1 works), then end (stamp the
   content hash — the completeness marker an interrupted push never reaches,
   so the next run redoes that work). mode delete removes a work outright. */
async function handleMerecatIngest(request, env) {
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  if (!(await requireAdmin(env, String(data.key || '')))) return json({ ok: false, error: 'No.' }, 403);
  const mode = String(data.mode || '');
  const work = data.work || {};
  const id = String(work.id || '');
  if (!id || !/^[a-z0-9-]{1,40}$/.test(id)) return json({ ok: false, error: 'Bad work id.' }, 400);

  if (mode === 'begin' || mode === 'delete') {
    // Clear the work's vectors (only Tier-1 works ever have them) and rows.
    try {
      const olds = await env.LIBDB.prepare('SELECT cid FROM chunks WHERE work_id = ?1').bind(id).all();
      const cids = (olds.results || []).map((r) => r.cid);
      for (let i = 0; i < cids.length; i += 1000) {
        try { await env.MERECAT_INDEX.deleteByIds(cids.slice(i, i + 1000)); }
        catch (err) { console.log(JSON.stringify({ event: 'merecat_vecdel_failed', error: String(err) })); }
      }
    } catch (err) {
      console.log(JSON.stringify({ event: 'merecat_clear_failed', error: String(err) }));
    }
    await env.LIBDB.prepare('DELETE FROM chunks WHERE work_id = ?1').bind(id).run();
    if (mode === 'delete') {
      await env.LIBDB.prepare('DELETE FROM works WHERE id = ?1').bind(id).run();
      return json({ ok: true, deleted: id }, 200);
    }
    await env.LIBDB.prepare(
      'INSERT INTO works (id, title, url, tier, kind, hash, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6) ' +
      'ON CONFLICT(id) DO UPDATE SET title = ?2, url = ?3, tier = ?4, kind = ?5, hash = NULL, updated_at = ?6'
    ).bind(id, String(work.title || id), String(work.url || ''),
      Math.min(7, Math.max(1, Number(work.tier) || 3)), String(work.kind || ''),
      Math.floor(Date.now() / 1000)).run();
    return json({ ok: true, began: id }, 200);
  }

  if (mode === 'append') {
    const rows = Array.isArray(data.chunks) ? data.chunks : [];
    if (!rows.length || rows.length > 480) return json({ ok: false, error: 'Bad batch size.' }, 400);
    // Multi-row inserts: 6 params a row, 16 rows a statement, well inside
    // D1's 100-bound-params and 50-queries-per-invocation limits.
    const stmts = [];
    for (let i = 0; i < rows.length; i += 16) {
      const slice = rows.slice(i, i + 16);
      const values = slice.map(() => '(?, ?, ?, ?, ?, ?)').join(',');
      const binds = [];
      for (const r of slice) {
        binds.push(String(r.cid || ''), id, Number(r.seq) || 0,
          String(r.heading || ''), String(r.anchor || ''), String(r.text || ''));
      }
      stmts.push(env.LIBDB.prepare(
        'INSERT OR REPLACE INTO chunks (cid, work_id, seq, heading, anchor, text) VALUES ' + values
      ).bind(...binds));
    }
    await env.LIBDB.batch(stmts);
    let vectored = 0;
    if (data.vectorize) {
      const meta = { title: String(work.title || id), url: String(work.url || ''), tier: Number(work.tier) || 1 };
      // small slices, one retry each, and a failed slice degrades to BM25-only
      // instead of failing the whole push — the next content-hash push heals it
      for (let i = 0; i < rows.length; i += 40) {
        const slice = rows.slice(i, i + 40);
        let vecs = null;
        for (let attempt = 0; attempt < 2 && !vecs; attempt++) {
          try {
            const emb = await env.AI.run('@cf/baai/bge-m3', {
              text: slice.map((r) => (r.heading ? r.heading + ': ' : '') + String(r.text || '').slice(0, 1800)),
            });
            vecs = (emb && emb.data) || null;
          } catch (err) {
            console.log(JSON.stringify({ event: 'merecat_embed_failed', work: id, at: i, attempt, error: String(err) }));
          }
        }
        if (!vecs) continue;
        const upserts = [];
        for (let j = 0; j < slice.length; j++) {
          if (!vecs[j]) continue;
          upserts.push({
            id: String(slice[j].cid), values: vecs[j],
            metadata: { work: id, title: meta.title, tier: meta.tier,
              url: meta.url + (slice[j].anchor ? '#' + slice[j].anchor : '') },
          });
        }
        if (upserts.length) {
          try { await env.MERECAT_INDEX.upsert(upserts); vectored += upserts.length; }
          catch (err) {
            console.log(JSON.stringify({ event: 'merecat_upsert_failed', work: id, at: i, error: String(err) }));
          }
        }
      }
    }
    return json({ ok: true, inserted: rows.length, vectored }, 200);
  }

  if (mode === 'end') {
    // the chunk count stamps the works row here so roster reads never scan
    await env.LIBDB.prepare('UPDATE works SET hash = ?2, chunks = ?3, updated_at = ?4 WHERE id = ?1')
      .bind(id, String(work.hash || ''), Number(work.chunks) || 0, Math.floor(Date.now() / 1000)).run();
    return json({ ok: true, ended: id }, 200);
  }

  return json({ ok: false, error: 'Bad mode.' }, 400);
}

/* ---- @merecat in the comments and the forum ----------------------------
   A live post containing @merecat summons the librarian to answer in the
   thread itself. The brief is deliberately light, as the corpus already
   holds every page's own text: where the thread lives (the page or the
   topic), the recent conversation, and the asking comment — retrieval
   supplies the shelf. The reply posts as a fresh comment by the bot
   identity, and the cost lands on the mentioner's own daily count (admins
   uncapped as everywhere). */

/* The bot's whole public profile is hardcoded here (the avatar object sits in
   R2 under its hash like anyone's): Nicene by confession, bio and signature
   fixed, upserted on every reply so this code stays the source of truth. The
   avatar column is left alone — it carries the upload stamp. */
async function merecatEnsureProfile(env) {
  const now = Math.floor(Date.now() / 1000);
  const bio =
    'The librarian. I keep the front desk of this site’s Library: the Scriptures in two editions, ' +
    'the Fathers entire, the seven councils, the Summa, the Catena, and the site’s own papers, ' +
    'every shelf anchored down to the paragraph. Mention @merecat in a post or a comment and I ' +
    'answer in the thread, with sources you can check. I am a research tool, not a member: my ' +
    'standing instructions, my shelf, my memory, and my limits are all published on the merecat ' +
    'page (community.html?merecat=1). I hold the faith of the Nicene Creed and the positions of ' +
    'this site, and I am under orders to show my work.';
  const signature = 'Quod ubique, quod semper, quod ab omnibus. Bring your citations, I will bring mine. 🐈';
  await env.DB.prepare(
    'INSERT INTO profiles (hash, nick, bio, signature, faith, created_at, updated_at) ' +
    "VALUES (?1, ?2, ?3, ?4, 'nicene', ?5, ?5) " +
    'ON CONFLICT(hash) DO UPDATE SET nick = ?2, bio = ?3, signature = ?4, faith = \'nicene\', updated_at = ?5'
  ).bind(MERECAT_BOT.hash, MERECAT_BOT.nick, bio, signature, now).run();
}

async function merecatNames(env, hashes) {
  const uniq = [...new Set(hashes.filter((h) => h))];
  const out = {};
  if (!uniq.length) return out;
  const ph = uniq.map((_, i) => '?' + (i + 1)).join(',');
  const rows = await env.DB.prepare(
    'SELECT hash, nick FROM profiles WHERE hash IN (' + ph + ')').bind(...uniq).all();
  for (const r of rows.results || []) if (r.nick) out[r.hash] = r.nick;
  return out;
}

/* Post the bot's comment: a reply under the topic on the board, a flat (or
   same-parent) comment on an article page. Board replies bump the topic and
   fan out notifications like anyone's reply, so the asker hears back. */
async function merecatInsertComment(env, src, isBoard, topicId, topicAuthorHash, body) {
  await merecatEnsureProfile(env);
  const now = Math.floor(Date.now() / 1000);
  const parent = isBoard ? topicId : (src.parent_id || null);
  const ins = await env.DB.prepare(
    'INSERT INTO comments (page, parent_id, title, author_hash, body, status, created_at, ai_verdict) ' +
    "VALUES (?1, ?2, NULL, ?3, ?4, 'live', ?5, 'merecat') RETURNING id"
  ).bind(src.page, parent, MERECAT_BOT.hash, body, now).first();
  if (isBoard) {
    await refreshTopicStats(env, topicId);
    await deliverNotifications(env, {
      authorHash: MERECAT_BOT.hash, status: 'live', topicId, commentId: ins.id,
      isReply: true, topicAuthorHash, mentions: [],
    }).catch((e) => console.log(JSON.stringify({ event: 'merecat_reply_notify_failed', error: String(e) })));
  }
  return ins.id;
}

async function merecatMentionReply(env, commentId) {
  const c = await env.DB.prepare(
    "SELECT id, page, parent_id, title, author_hash, body FROM comments WHERE id = ?1 AND status = 'live'"
  ).bind(commentId).first();
  if (!c || !c.author_hash || c.author_hash === MERECAT_BOT.hash) return null;
  if (!MERECAT_MENTION_RE.test(String(c.body || ''))) return null;
  const cfg = await merecatConfig(env);
  const day = merecatDay();
  const admin = await isAdminHash(env, c.author_hash);
  const isBoard = !!boardKey(c.page);
  const topicId = c.parent_id || c.id;

  /* The mention spends the mentioner's own questions. At a cap the bot still
     answers the summons, with the no-cost resting note, so a mention is
     never silently ignored. */
  let refuse = null;
  const seeWhen = ' Mention me again after it renews, or open [the merecat page](' +
    MERECAT_SITE + 'community.html?merecat=1) to see the renewal time on your own clock.';
  const g = await env.LIBDB.prepare('SELECT q FROM usage WHERE day = ?1').bind(day).first();
  if (!admin && g && g.q >= cfg.global_daily) {
    refuse = 'merecat is resting. The community’s shared daily budget is spent.' + seeWhen;
  }
  if (!refuse && !admin && cfg.user_cap_on) {
    const u = await env.LIBDB.prepare('SELECT q FROM user_usage WHERE day = ?1 AND hash = ?2')
      .bind(day, c.author_hash).first();
    if (u && u.q >= cfg.user_daily) {
      refuse = 'You have used your ' + cfg.user_daily + ' merecat questions for today.' + seeWhen;
    }
  }

  let topicAuthorHash = null;
  if (refuse) {
    if (isBoard) {
      const t = await env.DB.prepare('SELECT author_hash FROM comments WHERE id = ?1').bind(topicId).first();
      topicAuthorHash = t && t.author_hash;
    }
    return await merecatInsertComment(env, c, isBoard, topicId, topicAuthorHash, refuse);
  }

  /* The brief: where we are, the topic head in full (the title and opening
     post ALWAYS ride, whatever the reply window drops — sometimes the whole
     question lives in the title), the recent conversation, the asking
     comment. */
  let where = '';
  let opening = '';       // the topic head, labeled, never windowed out
  let topicTitle = '';
  const talk = [];        // [hash, text] oldest first
  if (isBoard) {
    const topic = await env.DB.prepare(
      'SELECT id, title, author_hash, body FROM comments WHERE id = ?1').bind(topicId).first();
    topicAuthorHash = topic && topic.author_hash;
    topicTitle = String((topic && topic.title) || '').slice(0, MAX_TITLE);
    where = 'the forum topic “' + topicTitle + '” on this site’s Catholicity Board';
    const replies = await env.DB.prepare(
      "SELECT author_hash, body FROM comments WHERE parent_id = ?1 AND status = 'live' AND id != ?2 " +
      'ORDER BY id DESC LIMIT 12').bind(topicId, c.id).all();
    for (const r of (replies.results || []).reverse()) talk.push([r.author_hash, String(r.body || '')]);
    const names0 = await merecatNames(env, [topic && topic.author_hash]);
    opening = 'TOPIC TITLE: “' + topicTitle + '” (a title often carries the question itself — treat it as part of what is asked)\n' +
      'OPENING POST by ' + ((topic && names0[topic.author_hash]) || 'a member') + ': ' +
      (topic && topic.id === c.id
        ? '(the opening post is the very comment asking you, below)'
        : String((topic && topic.body) || '').slice(0, 1200));
  } else {
    where = 'the comment thread on this site’s own page ' + String(c.page) +
      ' (that page’s text is on your shelf)';
    const recent = await env.DB.prepare(
      "SELECT author_hash, body FROM comments WHERE page = ?1 AND status = 'live' AND id != ?2 " +
      'ORDER BY id DESC LIMIT 10').bind(c.page, c.id).all();
    for (const r of (recent.results || []).reverse()) talk.push([r.author_hash, String(r.body || '')]);
  }
  const names = await merecatNames(env, talk.map((t) => t[0]).concat([c.author_hash]));
  const nameOf = (h) => names[h] || (h === MERECAT_BOT.hash ? MERECAT_BOT.nick : 'a member');
  const talkBlock = (opening ? opening + '\n---\n' : '') +
    talk.map((t) => nameOf(t[0]) + ': ' + t[1].slice(0, 700)).join('\n---\n');

  let asked = String(c.body || '').replace(MERECAT_MENTION_RE, '').trim().slice(0, 2000);
  /* A bare "@merecat" under a question-bearing title: the title IS the ask. */
  if (!asked && topicTitle) asked = topicTitle;
  const retrievalQ = ((topicTitle ? topicTitle + ' ' : '') + (c.title && c.title !== topicTitle ? c.title + ' ' : '') + asked)
    .slice(0, 2000) || 'this site';
  const chunks = await merecatRetrieve(env, retrievalQ, cfg);
  const sources = chunks.map((cc, i) => ({
    n: i + 1, title: cc.title, heading: cc.heading,
    url: MERECAT_SITE + cc.url + (cc.anchor ? '#' + cc.anchor : ''),
  }));
  let srcBlock = '';
  chunks.forEach((cc, i) => {
    srcBlock += '[' + (i + 1) + '] (' + (MERECAT_TIER_LABEL[cc.tier] || 'shelf') + ') ' + cc.title +
      (cc.heading ? ' — ' + cc.heading : '') + '\n' + cc.text.slice(0, 2800) + '\n\n';
  });
  const sys = (cfg.persona || 'You are merecat, the librarian of merecatholicity.com.') +
    '\n\nYou were mentioned by name inside ' + where + '. The recent conversation, oldest first:\n\n' +
    (talkBlock || '(the thread starts with the comment below)') +
    '\n\nThe member ' + nameOf(c.author_hash) + ' has asked you directly, in the comment you are replying to. ' +
    'Write the single comment you will post in reply: answer what was asked, cite sources by their bracketed ' +
    'numbers like [2], stay under 250 words, no greeting and no signature.' +
    '\n\nSOURCES (cite by bracketed number, like [3] — write the digit; cite what carries weight — a few for a simple question, more when the question truly spans the shelf; these are the only citable sources' +
    (srcBlock ? '' : '; none were retrieved, so say the shelf does not cover this directly and answer from general knowledge, labeled as such') +
    '):\n\n' + (srcBlock || '(none)') + '/no_think';
  const messages = [
    { role: 'system', content: sys },
    { role: 'user', content: asked || 'Please weigh in on this thread.' },
  ];

  let res;
  try {
    res = await env.AI.run(cfg.model, { messages, max_tokens: 900, temperature: 0.35 });
  } catch (err) {
    console.log(JSON.stringify({ event: 'merecat_mention_ai_failed', error: String(err) }));
    return await merecatInsertComment(env, c, isBoard, topicId, topicAuthorHash,
      MERECAT_RESTING + ' Mention me again then.');
  }
  let answer = res == null ? '' : (res.response != null ? String(res.response)
    : (res.choices && res.choices[0] && res.choices[0].message
      ? String(res.choices[0].message.content || '') : ''));
  answer = answer.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  if (!answer) return null;
  /* The footer lists only the sources the answer actually cited, renumbered
     with the body's markers to a clean 1..k in order of first appearance —
     the model read its full list, the reader gets a tidy one. Labels are
     bracket-sanitized: a heading like "[The Contemporary Review]" nested in
     [text](url) breaks the markdown link and prints raw. */
  const firstAt = new Map();
  answer.replace(/\[(\d+)\]/g, (m, n, at) => {
    const num = Number(n);
    if (sources.some((s) => s.n === num) && !firstAt.has(num)) firstAt.set(num, at);
    return m;
  });
  const order = [...firstAt.keys()].sort((a, b) => firstAt.get(a) - firstAt.get(b));
  const renum = new Map(order.map((n, i) => [n, i + 1]));
  if (renum.size) {
    answer = answer.replace(/\[(\d+)\]/g, (m, n) =>
      renum.has(Number(n)) ? '[' + renum.get(Number(n)) + ']' : m);
    const cited = sources.filter((s) => renum.has(s.n))
      .sort((a, b) => renum.get(a.n) - renum.get(b.n));
    const label = (s) => (s.title + (s.heading ? ' — ' + s.heading : ''))
      .replace(/\[/g, '(').replace(/\]/g, ')');
    answer += '\n\nSources:\n' + cited.map((s) =>
      '[' + renum.get(s.n) + '] [' + label(s) + '](' + s.url + ')').join('\n');
  }
  const replyId = await merecatInsertComment(env, c, isBoard, topicId, topicAuthorHash, answer.slice(0, 12000));

  const inTok = Math.ceil(JSON.stringify(messages).length / 4);
  const outTok = Math.ceil(answer.length / 4);
  await env.LIBDB.batch([
    env.LIBDB.prepare(
      'INSERT INTO usage (day, q, in_tok, out_tok) VALUES (?1, 1, ?2, ?3) ' +
      'ON CONFLICT(day) DO UPDATE SET q = q + 1, in_tok = in_tok + ?2, out_tok = out_tok + ?3'
    ).bind(day, inTok, outTok),
    env.LIBDB.prepare(
      'INSERT INTO user_usage (day, hash, q) VALUES (?1, ?2, 1) ' +
      'ON CONFLICT(day, hash) DO UPDATE SET q = q + 1'
    ).bind(day, c.author_hash),
  ]);
  return replyId;
}

/* Admin lever: run the mention pipeline on any existing comment — the
   manual re-summon for a post that was held and approved later, and the
   test hook. */
async function handleMerecatMention(request, env) {
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  if (!(await requireAdmin(env, String(data.key || '')))) return json({ ok: false, error: 'No.' }, 403);
  const id = Number(data.id);
  if (!Number.isInteger(id) || id < 1) return json({ ok: false, error: 'Bad request.' }, 400);
  const replied = await merecatMentionReply(env, id);
  return json({ ok: true, replied: replied || null }, 200);
}

/* The quota line's feed: a few tiny reads so the page can always show
   "you have used N of M today" the moment it opens (the ask preamble keeps
   it fresh afterward). Admins read their true count against the same cap
   they are allowed to exceed. */
async function handleMerecatUsage(request, env) {
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.READ_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests. Slow down.' }, 429);
  const key = String(data.key || '');
  if (!key) return json({ ok: false, error: 'Bad request.' }, 400);
  const me = await sha256hex(key);
  const cfg = await merecatConfig(env);
  const day = merecatDay();
  const g = await env.LIBDB.prepare('SELECT q FROM usage WHERE day = ?1').bind(day).first();
  const u = await env.LIBDB.prepare('SELECT q FROM user_usage WHERE day = ?1 AND hash = ?2')
    .bind(day, me).first();
  return json({
    ok: true,
    you: (u && u.q) || 0, cap: cfg.user_daily, cap_on: cfg.user_cap_on,
    today: (g && g.q) || 0, gcap: cfg.global_daily,
    admin: await isAdminHash(env, me),
  }, 200);
}

/* Full disclosure for the merecat page's "How merecat works" panel: the
   model id, the caps, the persona verbatim, the whole shelf with per-work
   chunk counts, today's community usage, and the asker's own count when a
   key rides along. Everything here is public site content or the reader's
   own number — no per-question data exists to disclose, since the server
   keeps counters only. */
async function handleMerecatAbout(request, env) {
  let data = {};
  try { data = await request.json(); } catch { /* key is optional */ }
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.READ_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests. Slow down.' }, 429);
  const cfg = await merecatConfig(env);
  const day = merecatDay();
  // per-work counts live on the works row (stamped at ingest end) so this
  // stays a 91-row read, not a scan of the whole chunk store
  const works = await env.LIBDB.prepare(
    'SELECT id, title, url, tier, chunks FROM works ORDER BY tier, title'
  ).all();
  const list = works.results || [];
  const g = await env.LIBDB.prepare('SELECT q FROM usage WHERE day = ?1').bind(day).first();
  const out = {
    ok: true,
    model: cfg.model, topk: cfg.topk,
    user_daily: cfg.user_daily, user_cap_on: cfg.user_cap_on, global_daily: cfg.global_daily,
    persona: cfg.persona,
    chunks: list.reduce((n, w) => n + (w.chunks || 0), 0),
    works: list,
    today: (g && g.q) || 0,
  };
  const key = String(data.key || '');
  if (key) {
    const me = await sha256hex(key);
    const u = await env.LIBDB.prepare('SELECT q FROM user_usage WHERE day = ?1 AND hash = ?2')
      .bind(day, me).first();
    out.you = (u && u.q) || 0;
    out.admin = await isAdminHash(env, me);
  }
  return json(out, 200);
}

/* Works roster + content hashes, so ingest.py can skip unchanged works. */
async function handleMerecatWorks(request, env) {
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  if (!(await requireAdmin(env, String(data.key || '')))) return json({ ok: false, error: 'No.' }, 403);
  const rows = await env.LIBDB.prepare(
    'SELECT id, title, tier, kind, hash, chunks FROM works ORDER BY tier, id'
  ).all();
  // stored text volume, so the daily ingest can project database size
  // against D1's 500 MB free cap and warn before the wall
  const tb = await env.LIBDB.prepare(
    "SELECT SUM(LENGTH(text) + LENGTH(COALESCE(heading, ''))) AS b FROM chunks").first();
  const pfh = await env.LIBDB.prepare(
    "SELECT v FROM config WHERE k = 'persona_file_hash'").first();
  return json({ ok: true, works: rows.results || [], text_bytes: (tb && tb.b) || 0,
    persona_file_hash: (pfh && pfh.v) || '' }, 200);
}

/* Persona / model / caps push from librarian/config.yml + persona.md. */
async function handleMerecatConfigSet(request, env) {
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  if (!(await requireAdmin(env, String(data.key || '')))) return json({ ok: false, error: 'No.' }, 403);
  const stmts = [];
  const put = (k, v) => stmts.push(env.LIBDB.prepare(
    'INSERT INTO config (k, v) VALUES (?1, ?2) ON CONFLICT(k) DO UPDATE SET v = ?2').bind(k, String(v)));
  if (typeof data.persona === 'string' && data.persona) put('persona', data.persona);
  const cfg = data.config || {};
  for (const k of ['model', 'user_cap_on', 'user_daily', 'global_daily', 'topk', 'max_tokens', 'persona_file_hash']) {
    if (cfg[k] != null) put(k, cfg[k]);
  }
  if (!stmts.length) return json({ ok: false, error: 'Nothing to set.' }, 400);
  await env.LIBDB.batch(stmts);
  merecatConfigCache = { at: 0, cfg: null }; // this isolate refreshes now; others lag out the 5-min TTL
  return json({ ok: true, set: stmts.length }, 200);
}

/* Usage counters for the admin: the last fourteen days, questions and rough
   token spend, distinct askers per day. Counters only — no question text. */
async function handleMerecatStats(request, env) {
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  if (!(await requireAdmin(env, String(data.key || '')))) return json({ ok: false, error: 'No.' }, 403);
  const use = await env.LIBDB.prepare(
    'SELECT day, q, in_tok, out_tok FROM usage ORDER BY day DESC LIMIT 14').all();
  const users = await env.LIBDB.prepare(
    'SELECT day, COUNT(*) AS users FROM user_usage GROUP BY day ORDER BY day DESC LIMIT 14').all();
  const total = await env.LIBDB.prepare('SELECT COUNT(*) AS n FROM chunks').first();
  const byDay = {};
  for (const r of users.results || []) byDay[r.day] = r.users;
  const days = (use.results || []).map((r) => ({ ...r, users: byDay[r.day] || 0 }));
  return json({ ok: true, days, chunks: (total && total.n) || 0 }, 200);
}

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      const path = url.pathname.replace(/\/+$/, '') || '/';

      if (request.method === 'POST' && !originOk(request)) {
        return json({ ok: false, error: 'Bad origin.' }, 403);
      }

      if (path === '/api/comments' && request.method === 'GET') return await handleGet(request, env, url);
      if (path === '/api/comments' && request.method === 'POST') return await handlePost(request, env, ctx);
      if (path === '/api/comments/delete' && request.method === 'POST') return await handleSelfDelete(request, env);
      if (path === '/api/comments/edit' && request.method === 'POST') return await handleEdit(request, env, ctx);
      if (path === '/api/comments/meta' && request.method === 'POST') return await handleMeta(request, env);
      if (path === '/api/comments/audit' && request.method === 'POST') return await handleAudit(request, env);
      if (path === '/api/comments/trust' && request.method === 'POST') return await handleTrust(request, env);
      if (path === '/api/comments/moderate' && request.method === 'POST') return await handleModerate(request, env);
      if (path === '/api/comments/move' && request.method === 'POST') return await handleMove(request, env);
      if (path === '/api/comments/feed' && request.method === 'GET') return await handleFeed(request, env, url);
      if (path === '/api/comments/board' && request.method === 'GET') return await handleBoardIndex(request, env, url);
      if (path === '/api/comments/board/cat' && request.method === 'GET') return await handleBoardCat(request, env, url);
      if (path === '/api/comments/board/author' && request.method === 'GET') return await handleAuthorPosts(request, env, url);
      if (path === '/api/comments/board/topic' && request.method === 'GET') return await handleTopicView(request, env, url);
      if (path === '/api/comments/search' && request.method === 'GET') return await handleSearch(request, env, url);
      if (path === '/api/comments/profile' && request.method === 'GET') return await handleProfileGet(request, env, url);
      if (path === '/api/comments/profile' && request.method === 'POST') return await handleProfileSave(request, env);
      if (path === '/api/comments/profile/clear' && request.method === 'POST') return await handleProfileClear(request, env);
      if (path === '/api/comments/backup' && request.method === 'POST') return await handleBackup(request, env);
      if (path === '/api/comments/dm/send' && request.method === 'POST') return await handleDmSend(request, env);
      if (path === '/api/comments/dm/threads' && request.method === 'POST') return await handleDmThreads(request, env);
      if (path === '/api/comments/dm/thread' && request.method === 'POST') return await handleDmThread(request, env);
      if (path === '/api/comments/dm/unread' && request.method === 'POST') return await handleDmUnread(request, env);
      if (path === '/api/comments/dm/block' && request.method === 'POST') return await handleDmBlock(request, env);
      if (path === '/api/comments/dm/delete' && request.method === 'POST') return await handleDmDelete(request, env);
      if (path === '/api/comments/dm/directory' && request.method === 'GET') return await handleDmDirectory(request, env, url);
      if (path === '/api/comments/notifications/unread' && request.method === 'POST') return await handleNotifUnread(request, env);
      if (path === '/api/comments/notifications/read' && request.method === 'POST') return await handleNotifRead(request, env);
      if (path === '/api/comments/notifications' && request.method === 'POST') return await handleNotifList(request, env);
      if (path === '/api/comments/watch' && request.method === 'POST') return await handleWatch(request, env);
      if (path === '/api/comments/board/unread' && request.method === 'POST') return await handleBoardUnread(request, env);
      if (path === '/api/comments/board/reads' && request.method === 'POST') return await handleBoardReads(request, env);
      if (path === '/api/comments/board/read' && request.method === 'POST') return await handleBoardRead(request, env);
      if (path === '/api/comments/board/read-all' && request.method === 'POST') return await handleBoardReadAll(request, env);
      if (path === '/api/comments/avatar' && request.method === 'GET') return await handleAvatarGet(request, env, url);
      if (path === '/api/comments/avatar' && request.method === 'POST') return await handleAvatarUpload(request, env);
      if (path === '/api/comments/avatar/delete' && request.method === 'POST') return await handleAvatarDelete(request, env);
      if (path === '/api/comments/lock' && request.method === 'POST') return await handleLock(request, env);
      if (path === '/api/comments/deleteuser' && request.method === 'POST') return await handleDeleteUser(request, env);
      if (path === '/api/comments/ipban' && request.method === 'POST') return await handleIpBan(request, env);
      if (path === '/api/comments/ipbans' && request.method === 'POST') return await handleIpBans(request, env);
      if (path === '/api/comments/rdns' && request.method === 'POST') return await handleRdns(request, env);
      if (path === '/api/comments/approve' && request.method === 'POST') return await handleApprove(request, env);
      if (path === '/api/comments/pending' && request.method === 'POST') return await handlePending(request, env);
      if (path === '/api/comments/report' && request.method === 'POST') return await handleReport(request, env);
      if (path === '/api/comments/report/dismiss' && request.method === 'POST') return await handleReportDismiss(request, env);
      if (path === '/api/comments/admins' && request.method === 'POST') return await handleAdmins(request, env);
      if (path === '/api/comments/admin' && request.method === 'POST') return await handleAdmin(request, env);
      if (path === '/api/merecat/ask' && request.method === 'POST') return await handleMerecatAsk(request, env, ctx);
      if (path === '/api/merecat/about' && request.method === 'POST') return await handleMerecatAbout(request, env);
      if (path === '/api/merecat/usage' && request.method === 'POST') return await handleMerecatUsage(request, env);
      if (path === '/api/merecat/mention' && request.method === 'POST') return await handleMerecatMention(request, env);
      if (path === '/api/merecat/chats' && request.method === 'POST') return await handleMerecatChats(request, env);
      if (path === '/api/merecat/chat' && request.method === 'POST') return await handleMerecatChat(request, env);
      if (path === '/api/merecat/chat/delete' && request.method === 'POST') return await handleMerecatChatDelete(request, env);
      if (path === '/api/merecat/ingest' && request.method === 'POST') return await handleMerecatIngest(request, env);
      if (path === '/api/merecat/works' && request.method === 'POST') return await handleMerecatWorks(request, env);
      if (path === '/api/merecat/config' && request.method === 'POST') return await handleMerecatConfigSet(request, env);
      if (path === '/api/merecat/stats' && request.method === 'POST') return await handleMerecatStats(request, env);
      return json({ ok: false, error: 'Not found.' }, 404);
    } catch (err) {
      console.log(JSON.stringify({ event: 'unhandled', error: String(err) }));
      return json({ ok: false, error: 'Server hiccup. Please try again shortly.' }, 500);
    }
  },
  /* Monthly cron (1st, 00:00 UTC): prune the idle Known-IPs rows, clear
     soft-deleted comments past their window and the replies they orphaned,
     sweep stray DM rows, clear read notifications and their dead weight, then
     back the database up to R2 so the dump reflects the cleaned state (the prior
     month's backup, kept ninety days, still holds what was just removed). */
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      pruneIdentityIps(env)
        .then(() => pruneComments(env))
        .then(() => sweepDms(env))
        .then(() => pruneNotifications(env))
        .then(() => pruneMerecatChats(env))
        .then(() => runBackup(env))
    );
  },
};
