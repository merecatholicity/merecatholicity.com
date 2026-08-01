/* Comments handler. Same-origin API on /api/comments*. A commenter's whole
   account is a random client-side key; the server stores only SHA-256(key),
   so there is nothing here to leak. Turnstile gates every write, the
   rate-limit binding throttles by IP, and Llama Guard screens the text
   (flagged or unscreenable comments are held pending, never dropped).
   The only secret is TURNSTILE_SECRET, the Turnstile server key. */

import { DurableObject } from 'cloudflare:workers';
import * as Rank from '../../purescript/output/Domain.Rank/index.js';
import * as Pseudonym from '../../purescript/output/Domain.Pseudonym/index.js';
import * as Faith from '../../purescript/output/Domain.Faith/index.js';
import * as Profile from '../../purescript/output/Domain.Profile/index.js';
import * as Dm from '../../purescript/output/Domain.Dm/index.js';
import * as Scripture from '../../purescript/output/Domain.Scripture/index.js';
import * as Fts from '../../purescript/output/Domain.Fts/index.js';
import * as Board from '../../purescript/output/Domain.Board/index.js';
import * as Emoji from '../../purescript/output/Domain.Emoji/index.js';
import * as Presence from '../../purescript/output/Domain.Presence/index.js';
import * as Wall from '../../purescript/output/Domain.Wall/index.js';
// Pure, dependency-free helpers (IP/ban-key normalization + back-room privacy),
// extracted so they can be unit-tested in plain Node. See src/pure.js. (pure.js
// also exports ipv6Groups/ipv6Prefix64/ipv6Full/isSharedV4, used internally
// there or client-side; imported here only what index.js calls directly.)
import {
  ipFamily, ipKey, toBanKey, reverseDnsName, looksLikeIp, boardEventPublic,
} from './pure.js';

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
   one pipeline all comments share. Single-sourced from Domain.Board (the same
   table the client reads), so BOARD_CATS/CAT_META/CATS can no longer drift. */
const BOARD_CATS = Board.catKeys;
/* The back room: a category only admins can see, read, or write. Every public
   read excludes it outright (the board index, listings, topic views, search,
   author histories, post counts, feeds); admins reach it through the keyed
   POST /board/admin. Writes into it demand an admin identity, notifications
   from it reach admins alone, and a topic moved INTO it sends no courtesy DM
   (a retraction from public view, not a move the poster can follow). */
const ADMIN_CAT = Board.adminCat;

function boardKey(raw) {
  const m = /^board:([a-z]+)$/.exec(String(raw || ''));
  return m && BOARD_CATS.includes(m[1]) ? raw : null;
}

/* The site's own origin, used to build human-facing links (feed items, the
   move-notice DM). Overridable per deployment via the SITE var; the constant is
   the production default so prod behaves identically when the var is unset. */
const SITE = 'https://merecatholicity.com';
function siteBase(env) { return (env && env.SITE) || SITE; }
const MAX_BODY = 4000;
/* Ciphertext cap for an end-to-end-encrypted DM: base64url of a MAX_BODY-sized
   plaintext plus the nonce/tag and the "E1." header, with generous headroom. The
   plaintext length is capped in the browser; the server only bounds the blob. */
const DM_ENC_MAX = 24000;
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
const FAITHS = Faith.faithList.map((f) => f.code);   // single-sourced from Domain.Faith
function cleanFaith(raw) {
  const v = String(raw || '').trim();
  return FAITHS.includes(v) ? v : null;
}
const CONTROL_RE = /[\u0000-\u0008\u000B-\u001F\u007F]/;

/* Must stay identical to the lists in comments.js, or a member's assigned
   pseudonym will differ between the server (feed, /config, the `assigned` field)
   and the web client that renders it. Also served verbatim by /api/comments/config. */
/* The pseudonym derivation + its two 40-word lists are single-sourced from the
   PureScript Domain.Pseudonym — the same module the client bundles (Phase 6) —
   retiring the ADJ/NOUN copy that used to live here. */
const displayName = Pseudonym.displayName;

/* The scriptorium rank ladder: standing by total live-forum posts. Thresholds
   ascend; rankFor returns the highest reached. Mirrors RANKS in comments.js; the
   count itself is postCountsFor. Served in /config and stamped on author rows so
   a client need not carry the ladder. */
/* The rank ladder is single-sourced from the PureScript Domain.Rank — the very
   module the client bundles (CLAUDE.md). rankFor erases the Rank
   ADT to its label. This retires the RANKS/rankFor copy that used to live here. */
function rankFor(n) {
  return Rank.rankLabel(Rank.rankFor((Number(n) || 0) | 0));
}

/* Attach server-resolved identity to an author-bearing row: `assigned` is the
   pseudonym the client would otherwise derive itself (displayName), and `rank`
   the ladder label — supplied whenever the post count is known. Additive: the
   existing `nick`/`posts` fields are unchanged. */
function withNames(row, posts) {
  const out = Object.assign({}, row);
  out.assigned = row.author_hash ? displayName(row.author_hash) : null;
  if (posts != null) { out.posts = posts; out.rank = rankFor(posts); }
  return out;
}

/* ---- Served display constants (GET /api/comments/config) ----
   These display-only tables mirror the ones in comments.js. The endpoint makes
   the worker the single SERVED source so a native client fetches them instead of
   triplicating the constants; comments.js keeps its inline copies as a pre-load
   fallback (a later pass can have it read /config). Cat keys are validated
   against BOARD_CATS so the two rosters cannot drift. Single-sourced from
   Domain.Board.catRows, the same table the client renders. */
const CAT_META = Board.catRows;
const FAITH_LABELS = Object.fromEntries(Faith.faithList.map((f) => [f.code, f.label]));
/* Emoji packs + named-alias tokens single-sourced from Domain.Emoji (the same
   data the client renders); the building code (whitelist derive, alias pairing)
   is trivial and stays per-consumer. */
const EMOJI_PACKS = Emoji.packs;
const NAMED_EMOJI = (() => {
  const out = {};
  const toks = Emoji.namedTokens.trim().split(/\s+/);
  for (let i = 0; i < toks.length; i += 2) out[toks[i]] = toks[i + 1];
  return out;
})();
/* Book spelling/abbreviation -> KJV verse-anchor slug, mirroring BIBLE in
   comments.js. Served so a native renderer can autolink scripture references. */
/* BIBLE_SPEC retired — the book table is single-sourced from the PureScript
   Domain.Scripture.bibleSpec, the same table the client bundles (Phase 6). */

const enc = new TextEncoder();

async function sha256hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/* Same-origin API. A cross-origin browser POST always carries an Origin, so
   reject any Origin that is not ours; a missing Origin (non-browser clients,
   some same-origin form posts) is allowed through to the usual gates. The
   allowlist is overridable per deployment via the ALLOWED_ORIGINS var (comma-
   separated) — e.g. to admit a staging host or a hybrid-app origin — and falls
   back to the production defaults when unset, so prod is unchanged. */
const DEFAULT_ORIGINS = ['https://merecatholicity.com', 'https://www.merecatholicity.com'];
function allowedOrigins(env) {
  const v = env && env.ALLOWED_ORIGINS;
  return v ? String(v).split(',').map((s) => s.trim()).filter(Boolean) : DEFAULT_ORIGINS;
}
function originOk(request, env) {
  const o = request.headers.get('Origin');
  return !o || allowedOrigins(env).includes(o);
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
async function verifyTurnstile(env, token, ip, key) {
  /* TEST BYPASS (interactive regression kit, webtest/live_kit.py): a designated
     throwaway test identity may skip Turnstile by presenting the shared secret as
     its token, so the two-user cloakbrowser suite can drive real writes (headless
     browsers cannot solve the production managed challenge). INERT unless BOTH
     env secrets are set (MC_TEST_BYPASS + TEST_HASHES); gated to the listed
     hashes; every other gate (rate-limit, AI screen, IP/identity blocks) still
     applies. Without the secrets set this whole branch is dead code. */
  if (env.MC_TEST_BYPASS && key && token === 'TEST:' + env.MC_TEST_BYPASS) {
    const h = await sha256hex(key);
    if ((env.TEST_HASHES || '').split(',').map((s) => s.trim()).includes(h)) return true;
  }
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

/* IP normalization + ban-key helpers (ipFamily/ipv6Groups/ipv6Prefix64/
   ipv6Full/ipKey/toBanKey/isSharedV4/reverseDnsName/looksLikeIp) live in
   src/pure.js, imported at the top — extracted so they can be unit-tested in
   plain Node. A dual-stack user's v6 interface id rotates daily while the /64
   stays fixed, so bans match on a normalized key (v4 verbatim, v6 as /64). */

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
function viewLink(env, page, id, parentId) {
  if (page.indexOf('board:') === 0) {
    return siteBase(env) + '/community.html?topic=' + (parentId || id) + '#comment-' + id;
  }
  return siteBase(env) + page + '#comment-' + id;
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

/* The shared-constants endpoint: one cacheable read serving the display tables a
   second client (native app, CLI) would otherwise triplicate — category roster,
   faith labels, rank ladder, commentable pages, the bot hash, the scripture
   autolink table, and the emoji whitelists — plus an explicit apiVersion. Public
   and edge-cacheable like every other read. Additive: nothing consumes it yet;
   the web client keeps its inline copies. */
async function handleConfig(request, env, url) {
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.READ_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests. Slow down.' }, 429);
  const custom = {};
  for (const k of Object.keys(EMOJI_PACKS)) for (const [code, path] of EMOJI_PACKS[k]) custom[code] = path;
  return json({
    ok: true,
    apiVersion: 1,
    cats: CAT_META.filter((c) => BOARD_CATS.includes(c[0])).map((c, i) => {
      const o = { key: c[0], label: c[1], blurb: c[2], order: i };
      if (c[3]) o.link = { text: c[3], url: c[4] };
      return o;
    }),
    faiths: FAITHS.map((code, i) => ({ code, label: FAITH_LABELS[code] || code, order: i })),
    ranks: Rank.rankTable,
    pages: PAGES,
    bot_hash: MERECAT_BOT.hash,
    bible: Scripture.bibleSpec,
    emoji: { custom, named: NAMED_EMOJI, data_url: '/emoji/emoji-data.json' },
  }, 200, cacheHeader(url));
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
  const comments = (rows.results || []).map((r) => withNames(r, counts[r.author_hash] || 0));
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

  if (!(await verifyTurnstile(env, String(data.token || ''), ip, String(data.key || '')))) {
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

  /* The back room: writing anywhere in it — a topic or a reply — needs an
     admin identity. The public can neither see it nor post into it. */
  if (page === ADMIN_CAT && !(await isAdminHash(env, authorHash))) {
    return json({ ok: false, error: 'That room is for admins only.' }, 403);
  }

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
      authorHash, status, page,
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
      merecatMentioned(body)) {
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

  /* Live push: broadcast the fresh post to everyone watching this scope through
     the one board sink (broadcastBoard gates the back room). Only a live post is
     announced; the builder queries the topic's stats for a reply. */
  if (status === 'live') {
    const catKey = page.slice(6);
    const topicId = parentId || inserted.id;
    const nick = prof && prof.nick || null;
    broadcastBoard(env, ctx, page, async () => {
      if (parentId == null) {
        return [{ v: 1, t: 'new-topic', scopes: ['cat:' + catKey, 'board:index'], cat: catKey,
          topic: { id: inserted.id, title, author_hash: authorHash, nick, created_at: createdAt,
            locked: 0, sticky: 0, replies: 0, last: createdAt, last_id: inserted.id } }];
      }
      const stat = await env.DB.prepare('SELECT replies, title FROM comments WHERE id = ?1').bind(topicId).first();
      return [
        { v: 1, t: 'new-reply', scopes: ['topic:' + topicId], topic_id: topicId,
          comment: { id: inserted.id, author_hash: authorHash, nick,
            signature: prof && prof.signature || null, avatar: prof && prof.avatar || null,
            faith: prof && prof.faith || null, body, created_at: createdAt } },
        { v: 1, t: 'topic-stats', scopes: ['cat:' + catKey, 'board:index'], cat: catKey,
          topic_id: topicId, title: (stat && stat.title) || null, replies: (stat && stat.replies) || 0,
          last: createdAt, last_id: inserted.id, author_hash: authorHash, nick },
      ];
    });
  }

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
  const pushTo = new Set();   // recipients to also nudge by push (scaffold; gated off)
  const liveEvents = [];      // per-recipient live 'notification' events (WebSocket)

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
    /* A post in the back room tells admins alone — a mentioned or watching
       outsider must learn nothing, not even that the thread exists. */
    let admSet = null;
    if (o.page === ADMIN_CAT) {
      const admRows = await env.DB.prepare('SELECT hash FROM admins').all();
      admSet = new Set((admRows.results || []).map((r) => r.hash));
    }
    for (const h of mentions) {
      if (admSet && !admSet.has(h)) continue;
      stmts.push(env.DB.prepare(NOTIF).bind(h, 'mention', o.topicId, o.commentId, o.authorHash, now));
      pushTo.add(h);
      liveEvents.push({ v: 1, t: 'notification', scopes: ['user:' + h], kind: 'mention', topic_id: o.topicId, comment_id: o.commentId, actor_hash: o.authorHash, created_at: now });
    }

    if (o.isReply) {
      const skip = new Set(mentions);
      if (o.authorHash) skip.add(o.authorHash);
      skip.add(MERECAT_BOT.hash);
      const recips = new Set();
      if (o.topicAuthorHash) recips.add(o.topicAuthorHash);
      const rows = await env.DB.prepare('SELECT hash FROM watches WHERE topic_id = ?1').bind(o.topicId).all();
      for (const r of (rows.results || [])) recips.add(r.hash);
      for (const h of recips) {
        if (admSet && !admSet.has(h)) continue;
        if (h && !skip.has(h)) {
          stmts.push(env.DB.prepare(NOTIF).bind(h, 'reply', o.topicId, o.commentId, o.authorHash, now));
          pushTo.add(h);
          liveEvents.push({ v: 1, t: 'notification', scopes: ['user:' + h], kind: 'reply', topic_id: o.topicId, comment_id: o.commentId, actor_hash: o.authorHash, created_at: now });
        }
      }
    }
  }

  if (stmts.length) await env.DB.batch(stmts);
  /* Instant per-member push over the private user:<hash> scope (badge + list),
     alongside the (gated-off) native push scaffold. Both no-op without the DO. */
  if (liveEvents.length) await publishUser(env, liveEvents);
  if (pushTo.size) await deliverPush(env, [...pushTo], { kind: o.isReply ? 'reply' : 'mention', topic_id: o.topicId, comment_id: o.commentId, actor_hash: o.authorHash });
}

/* A direct message is a notification-worthy event, so it also lands in the
   notifications list (not only the inbox badge). Coalesced: one UNREAD 'dm'
   notification per (recipient, sender), so a burst of messages surfaces once as
   "X sent you a message" until it is read, rather than burying the list. A 'dm'
   notification carries no topic/comment (both 0) and jumps to the conversation.
   A DM must never fail because its notification did, so this never throws out. */
async function notifyDm(env, toHash, fromHash) {
  try {
    if (!toHash || !fromHash || toHash === fromHash || fromHash === MERECAT_BOT.hash) return;
    const now = Math.floor(Date.now() / 1000);
    const r = await env.DB.prepare(
      "INSERT INTO notifications (recipient_hash, kind, topic_id, comment_id, actor_hash, created_at) " +
      "SELECT ?1, 'dm', 0, 0, ?2, ?3 WHERE NOT EXISTS (" +
      "SELECT 1 FROM notifications WHERE recipient_hash = ?1 AND kind = 'dm' AND actor_hash = ?2 AND read_at IS NULL)"
    ).bind(toHash, fromHash, now).run();
    /* Ring the notification badge only when a row was actually added (an existing
       unread 'dm' from this sender already counts). */
    if (r.meta && r.meta.changes > 0) {
      await publishUser(env, [{ v: 1, t: 'notification', scopes: ['user:' + toHash],
        kind: 'dm', topic_id: 0, comment_id: 0, actor_hash: fromHash, created_at: now }]);
    }
  } catch (e) {
    console.log(JSON.stringify({ event: 'notify_dm_failed', error: String(e) }));
  }
}

/* Best-effort push fan-out — the mobile-notification landing pad. A NO-OP unless
   PUSH_ENABLED === 'true'; even then it only delivers when a provider is wired,
   which it is not yet (no app, no APNs/FCM/VAPID creds). It looks up each
   recipient's registered device tokens and records intent; the app team fills in
   the actual provider send. Never throws into the caller (a push failure must
   never affect a post or a DM). */
async function deliverPush(env, hashes, payload) {
  try {
    if (env.PUSH_ENABLED !== 'true') return;
    const uniq = [...new Set((hashes || []).filter(Boolean))];
    if (!uniq.length) return;
    const ph = uniq.map((_, i) => '?' + (i + 1)).join(',');
    const rows = await env.DB.prepare('SELECT hash, platform, token FROM push_tokens WHERE hash IN (' + ph + ')').bind(...uniq).all();
    const tokens = rows.results || [];
    if (!tokens.length) return;
    /* TODO(app): deliver `payload` to each { platform, token } via APNs (HTTP/2),
       FCM, or Web Push (VAPID). Until a provider is configured, record intent so
       the wiring is verifiable end-to-end without losing anything. */
    console.log(JSON.stringify({ event: 'push_pending', recipients: tokens.length, kind: payload && payload.kind }));
  } catch (e) {
    console.log(JSON.stringify({ event: 'push_failed', error: String(e) }));
  }
}

/* Register a device's push token to the caller's identity (one row per token, so
   re-registering the same token just refreshes it). Additive and gated: it fills
   push_tokens, which deliverPush reads only when PUSH_ENABLED is on. */
async function handlePushRegister(request, env) {
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.POST_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests.' }, 429);
  const key = String(data.key || '');
  const platform = String(data.platform || '');
  const token = String(data.token || '').slice(0, 4096);
  if (!key || !token || !/^[a-z0-9_-]{1,20}$/i.test(platform)) return json({ ok: false, error: 'Bad request.' }, 400);
  const me = await sha256hex(key);
  const gate = await blockedReason(env, me, ip);
  if (gate) return blockedJson(gate);
  await env.DB.prepare('INSERT OR REPLACE INTO push_tokens (hash, platform, token, created_at) VALUES (?1, ?2, ?3, ?4)')
    .bind(me, platform, token, Math.floor(Date.now() / 1000)).run();
  return json({ ok: true }, 200);
}

/* Drop one device token (logout / uninstall). */
async function handlePushUnregister(request, env) {
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.POST_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests.' }, 429);
  const key = String(data.key || '');
  const token = String(data.token || '');
  if (!key || !token) return json({ ok: false, error: 'Bad request.' }, 400);
  const me = await sha256hex(key);
  await env.DB.prepare('DELETE FROM push_tokens WHERE hash = ?1 AND token = ?2').bind(me, token).run();
  return json({ ok: true }, 200);
}

async function handleSelfDelete(request, env, ctx) {
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
  /* Live push of the removal (Phase 1b): a reply vanishes from its thread; a
     whole topic drops from its category and the index. Back room stays silent. */
  if (env.HUB && boardKey(row.page) && row.page !== ADMIN_CAT) {
    const catKey = row.page.slice(6);
    if (row.parent_id == null) {
      publishLive(env, ctx, { v: 1, t: 'moderation', act: 'delete', id, topic_id: id, cat: catKey,
        scopes: ['topic:' + id, 'cat:' + catKey, 'board:index'] });
    } else {
      publishLive(env, ctx, { v: 1, t: 'moderation', act: 'delete', id, topic_id: row.parent_id, cat: catKey,
        scopes: ['topic:' + row.parent_id] });
    }
  }
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
    if (!topicRow || !boardKey(topicRow.page) || topicRow.page === ADMIN_CAT) {
      return new Response('No such topic.', { status: 404 });
    }
    page = topicRow.page;
    const rows = await env.DB.prepare(
      "SELECT c.id, c.parent_id, c.title, c.author_hash, pr.nick, c.body, c.created_at FROM comments c " +
      "LEFT JOIN profiles pr ON pr.hash = c.author_hash " +
      "WHERE (c.id = ?1 OR c.parent_id = ?1) AND c.status = 'live' ORDER BY c.id DESC LIMIT 50"
    ).bind(topicParam).all();
    results = rows.results;
  } else {
    page = cat ? boardKey('board:' + cat) : normalizePage(url.searchParams.get('page'));
    if (!page || page === ADMIN_CAT) return new Response('Unknown page.', { status: 400 });
    const rows = await env.DB.prepare(
      "SELECT c.id, c.parent_id, c.title, c.author_hash, pr.nick, c.body, c.created_at FROM comments c " +
      "LEFT JOIN profiles pr ON pr.hash = c.author_hash WHERE c.page = ?1 AND c.status = 'live' ORDER BY c.id DESC LIMIT 50"
    ).bind(page).all();
    results = rows.results;
  }
  const items = results.map(function (c) {
    const name = c.nick || (c.author_hash ? displayName(c.author_hash) : 'Anonymous');
    const link = viewLink(env, page, c.id, c.parent_id);
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
  const feedLink = topicRow ? siteBase(env) + '/community.html?topic=' + topicRow.id
    : isBoard ? siteBase(env) + '/community.html?cat=' + page.slice(6) : siteBase(env) + page;
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
  /* Live: an edit to a live PUBLIC board post updates its text for everyone
     watching the thread at once. A re-screen that held the edit (pending) never
     broadcasts, and the back room never crosses the wire. */
  if (env.HUB && status === 'live' && boardKey(row.page) && row.page !== ADMIN_CAT) {
    const topicId = row.parent_id || id;
    publishLive(env, ctx, { v: 1, t: 'edited', topic_id: topicId, id, body, edited_at: editedAt,
      scopes: ['topic:' + topicId] });
  }
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
    "  WHERE c.page LIKE 'board:%' AND c.page != 'board:adminsonly' AND c.status = 'live' " +
    "    AND (c.parent_id IS NULL OR p.status = 'live')" +
    ') WHERE rn = 1'
  ).all();
  const cats = {};
  rows.results.forEach(function (r) {
    cats[r.page.slice(6)] = {
      topics: r.topics,
      posts: r.posts,
      last: r.created_at,
      latest: withNames({ topic_id: r.topic_id, id: r.post_id, title: r.title, author_hash: r.author_hash, nick: r.nick, created_at: r.created_at }),
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
  /* answer exactly as if the category did not exist: a prober learns nothing */
  if (page === ADMIN_CAT) return json({ ok: false, error: 'Unknown category.' }, 400, cacheHeader(url));
  const p = Math.min(1000, Math.max(1, Math.floor(Number(url.searchParams.get('p')) || 1)));
  return json(await boardCatPayload(env, page, p, url.searchParams.get('q')), 200, cacheHeader(url));
}

async function boardCatPayload(env, page, p, q) {
  /* Optional title narrowing (the merecat forward picker's type-to-narrow):
     up to five typed words, each a case-insensitive substring of the topic
     title, ANDed in any order. The LIKE walk covers only this category's
     topic rows, so a two-topic room and a two-thousand-topic room both
     answer as one twenty-row page — a client never pulls the whole list. */
  const toks = String(q || '').slice(0, 120).split(/\s+/).filter(Boolean).slice(0, 5);
  let where = "c.page = ?1 AND c.parent_id IS NULL AND c.status = 'live'";
  const binds = [page];
  for (const t of toks) {
    binds.push('%' + t.replace(/[\\%_]/g, '\\$&') + '%');
    where += ' AND c.title LIKE ?' + binds.length + " ESCAPE '\\'";
  }
  const total = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM comments c WHERE ' + where
  ).bind(...binds).first();
  const rows = await env.DB.prepare(
    'SELECT c.id, c.title, c.author_hash, pr.nick, c.created_at, c.locked, c.sticky, ' +
    'COALESCE(c.replies, 0) AS replies, COALESCE(c.last_at, c.created_at) AS last, ' +
    "(SELECT MAX(m.id) FROM comments m WHERE (m.id = c.id OR m.parent_id = c.id) AND m.status = 'live') AS last_id " +
    'FROM comments c LEFT JOIN profiles pr ON pr.hash = c.author_hash ' +
    'WHERE ' + where + ' ' +
    'ORDER BY COALESCE(c.sticky, 0) DESC, last DESC LIMIT ?' + (binds.length + 1) + ' OFFSET ?' + (binds.length + 2)
  ).bind(...binds, TOPICS_PER_PAGE, (p - 1) * TOPICS_PER_PAGE).all();
  return { ok: true, topics: (rows.results || []).map((r) => withNames(r)), total: total.n, page: p, per: TOPICS_PER_PAGE };
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
    "WHERE c.author_hash = ?1 AND c.page LIKE 'board:%' AND c.page != 'board:adminsonly' AND c.status = 'live' " +
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
    'WHERE c.author_hash IN (' + ph + ") AND c.page LIKE 'board:%' AND c.page != 'board:adminsonly' AND c.status = 'live' " +
    "AND (c.parent_id IS NULL OR t.status = 'live') GROUP BY c.author_hash"
  ).bind(...uniq).all();
  uniq.forEach((h) => { out[h] = 0; });
  (rows.results || []).forEach((r) => { out[r.h] = r.n; });
  return out;
}

const SEARCH_PER_PAGE = 20;

/* Turn a user query into a safe FTS5 MATCH. The logic — pull out "quoted phrases"
   and bare words, double any embedded quote, wrap every token in quotes so no FTS5
   operator (- * : ^ NEAR AND OR NOT parentheses) can be injected, cap at ten — is
   single-sourced in Domain.Fts, which returns a `SafeMatch` whose only exit is
   `unSafeMatch`. The injection guarantee lives in that type, not here. */
function buildMatch(q) {
  return Fts.unSafeMatch(Fts.buildMatch(String(q ?? '')));
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

  let catPage = boardKey('board:' + (url.searchParams.get('cat') || ''));
  if (catPage === ADMIN_CAT) catPage = null;
  const authorRaw = String(url.searchParams.get('author') || '');
  const author = /^[0-9a-f]{64}$/.test(authorRaw) ? authorRaw : null;
  const order = url.searchParams.get('sort') === 'new' ? 'c.id DESC' : 'bm25(comments_fts)';

  const filters = [];
  const binds = [match];
  if (catPage) { binds.push(catPage); filters.push('AND c.page = ?' + binds.length); }
  if (author) { binds.push(author); filters.push('AND c.author_hash = ?' + binds.length); }
  const where =
    "WHERE comments_fts MATCH ?1 AND c.page LIKE 'board:%' AND c.page != 'board:adminsonly' AND c.status = 'live' " +
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
    const items = (rows.results || []).map((r) => withNames({
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
  /* answer exactly as if the topic did not exist: a prober learns nothing */
  if (topic.page === ADMIN_CAT) return json({ ok: false, error: 'No such topic.' }, 404, cacheHeader(url));
  return json(await topicViewPayload(env, topic, url.searchParams.get('p'), url.searchParams.get('find')), 200, cacheHeader(url));
}

async function topicViewPayload(env, topic, pRaw, findRaw) {
  const id = topic.id;
  /* Twenty replies a page. A permalink arrives with find=<reply id> and
     one indexed count places it on the right page. */
  let p = Math.min(1000, Math.max(1, Math.floor(Number(pRaw) || 1)));
  const find = Number(findRaw);
  if (Number.isInteger(find) && find > 0 && !pRaw) {
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
  return {
    ok: true,
    anon: env.ALLOW_ANON === 'true',
    cat: topic.page.slice(6),
    topic: withNames({ id: topic.id, title: topic.title, author_hash: topic.author_hash, nick: topic.nick, signature: topic.signature, avatar: topic.avatar, faith: topic.faith || null, body: topic.body, created_at: topic.created_at, edited_at: topic.edited_at, locked: topic.locked ? 1 : 0, sticky: topic.sticky ? 1 : 0 }, counts[topic.author_hash] || 0),
    replies: (replies.results || []).map((r) => withNames(r, counts[r.author_hash] || 0)),
    total: topic.replies || 0,
    page: p,
    per: TOPICS_PER_PAGE,
  };
}

/* The admins' door to the back room: the same listing and topic payloads the
   public GETs serve, behind the admin key and never cached. Strict: it serves
   the admins-only category and its topics alone — everything public stays on
   the public path. */
async function handleBoardAdmin(request, env) {
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.READ_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests. Slow down.' }, 429);
  if (!(await isAdminHash(env, await sha256hex(String(data.key || ''))))) {
    return json({ ok: false, error: 'No.' }, 403);
  }
  if (data.id != null) {
    const id = Number(data.id);
    if (!Number.isInteger(id) || id < 1) return json({ ok: false, error: 'Bad request.' }, 400);
    const topic = await env.DB.prepare(
      "SELECT c.id, c.page, c.title, c.author_hash, pr.nick, pr.signature, pr.avatar, pr.faith, c.body, c.created_at, c.edited_at, c.locked, c.sticky, c.replies " +
      "FROM comments c LEFT JOIN profiles pr ON pr.hash = c.author_hash " +
      "WHERE c.id = ?1 AND c.parent_id IS NULL AND c.status = 'live'"
    ).bind(id).first();
    if (!topic || topic.page !== ADMIN_CAT) return json({ ok: false, error: 'No such topic.' }, 404);
    return json(await topicViewPayload(env, topic, data.p, data.find), 200);
  }
  const p = Math.min(1000, Math.max(1, Math.floor(Number(data.p) || 1)));
  return json(await boardCatPayload(env, ADMIN_CAT, p, data.q), 200);
}

/* Admin-only topic moderation from the page: lock and unlock close and
   reopen a thread to new replies, delete takes the topic down. */
async function handleModerate(request, env, ctx) {
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
  /* Live push of the moderation (Phase 1b): gated out for the back room. */
  const catKey = topic.page.slice(6);
  const emit = (ev) => { if (topic.page !== ADMIN_CAT) publishLive(env, ctx, ev); };
  if (act === 'delete') {
    await env.DB.prepare("UPDATE comments SET status = 'deleted' WHERE id = ?1").bind(id).run();
    emit({ v: 1, t: 'moderation', act: 'delete', id, topic_id: id, cat: catKey,
      scopes: ['topic:' + id, 'cat:' + catKey, 'board:index'] });
    return json({ ok: true, deleted: true }, 200);
  }
  if (act === 'sticky' || act === 'unsticky') {
    const sticky = act === 'sticky' ? 1 : 0;
    await env.DB.prepare('UPDATE comments SET sticky = ?1 WHERE id = ?2').bind(sticky, id).run();
    emit({ v: 1, t: 'moderation', act, id, topic_id: id, cat: catKey, sticky,
      scopes: ['cat:' + catKey, 'board:index'] });
    return json({ ok: true, sticky: sticky }, 200);
  }
  const locked = act === 'lock' ? 1 : 0;
  await env.DB.prepare('UPDATE comments SET locked = ?1 WHERE id = ?2').bind(locked, id).run();
  emit({ v: 1, t: 'moderation', act, id, topic_id: id, cat: catKey, locked,
    scopes: ['topic:' + id, 'cat:' + catKey] });
  return json({ ok: true, locked: locked }, 200);
}

/* Admin-only: move a whole thread to another category, then DM the original
   poster an automated notice with a link to its new home. The topic row and
   every reply row carry their own page, so all move together. */
async function handleMove(request, env, ctx) {
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
  if (topic.author_hash && topic.author_hash !== adminHash && newPage !== ADMIN_CAT) {
    const name = String(data.catName || newPage.slice(6)).replace(CONTROL_RE, '').replace(/\s+/g, ' ').trim().slice(0, 60);
    const link = siteBase(env) + '/community.html?topic=' + id;
    const body = ('Your topic "' + topic.title + '" was moved to ' + name + '. You can read it here: ' + link).slice(0, MAX_BODY);
    try { notified = await sendSystemDm(env, adminHash, topic.author_hash, body); } catch { notified = false; }
  }
  /* Live push of the move (Phase 1b): it leaves its old category (and any open
     reader of it) and appears in the new one. Moving INTO the back room emits
     only the leaving to the public source; moving OUT emits only the arrival. */
  if (env.HUB && topic.page !== ADMIN_CAT) {
    const oldCat = topic.page.slice(6);
    publishLive(env, ctx, { v: 1, t: 'moved', id, from: oldCat,
      scopes: ['topic:' + id, 'cat:' + oldCat, 'board:index'] });
  }
  if (env.HUB && newPage !== ADMIN_CAT) {
    ctx.waitUntil((async () => {
      const c = await env.DB.prepare(
        'SELECT c.id, c.title, c.author_hash, pr.nick, c.created_at, c.locked, c.sticky, c.replies, ' +
        'COALESCE(c.last_at, c.created_at) AS last FROM comments c LEFT JOIN profiles pr ON pr.hash = c.author_hash ' +
        'WHERE c.id = ?1').bind(id).first();
      if (!c) return;
      const lastRow = await env.DB.prepare(
        "SELECT MAX(id) AS m FROM comments WHERE (id = ?1 OR parent_id = ?1) AND status = 'live'").bind(id).first();
      const newCat = newPage.slice(6);
      await env.HUB.get(env.HUB.idFromName('board')).publish({ v: 1, t: 'new-topic',
        scopes: ['cat:' + newCat, 'board:index'], cat: newCat,
        topic: { id: c.id, title: c.title, author_hash: c.author_hash, nick: c.nick || null,
          created_at: c.created_at, locked: c.locked || 0, sticky: c.sticky || 0, replies: c.replies || 0,
          last: c.last, last_id: (lastRow && lastRow.m) || c.id } });
    })().catch((e) => console.log(JSON.stringify({ event: 'publish_failed', error: String(e) }))));
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

const MAX_NICK = Profile.limits.nick;
const MAX_BIO = Profile.limits.bio;
const MAX_SIG = Profile.limits.sig;

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
      rank: rankFor(counts[hash] || 0),
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
  if (!(await verifyTurnstile(env, String(data.token || ''), ip, String(data.key || '')))) {
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

/* A message still lives: not past its disappearing-message expiry. A saved
   message carries expires_at NULL and so is always live. `now` is a server
   integer interpolated straight into the SQL (never a bind param), so this can be
   appended to any DM query without shifting the numbered binds. */
function dmLive(now) { return '(m.expires_at IS NULL OR m.expires_at > ' + Math.floor(Number(now) || 0) + ')'; }

/* Unread, per viewer: an unheld, unexpired message from someone else, newer than
   my read stamp. Held and expired messages never trip the recipient's badge. */
function dmUnreadExists(now) {
  return 'EXISTS(SELECT 1 FROM dms m WHERE m.thread_id = t.id AND COALESCE(m.held, 0) = 0 ' +
    'AND m.sender_hash != ?1 ' +
    'AND m.created_at > COALESCE(CASE WHEN t.a_hash = ?1 THEN t.a_read_at ELSE t.b_read_at END, 0) ' +
    'AND m.created_at > COALESCE(CASE WHEN t.a_hash = ?1 THEN t.a_cleared_at ELSE t.b_cleared_at END, 0) ' +
    'AND ' + dmLive(now) + ')';
}

/* A side that deleted the conversation sees only words newer than its clear
   stamp. ?1 is the viewer; t must be the thread row in scope. */
const DM_CLEARED = 'm.created_at > COALESCE(CASE WHEN t.a_hash = ?1 THEN t.a_cleared_at ELSE t.b_cleared_at END, 0)';

/* Disappearing-message + media tunables, and the growing admin key/value store
   behind them (app_settings). A missing key falls back to these defaults; the
   admin console (Phase 3) edits the table and busts this per-isolate cache. */
const DM_TTLS = Dm.ttlOptions.map((o) => o.secs);   // single-sourced from Domain.Dm
const MEDIA_CAP_BYTES = 10 * 1024 * 1024 * 1024;   // R2 free tier: 10 GB
const APP_SETTING_DEFAULTS = {
  media_enabled: '1',
  media_max_bytes: String(25 * 1024 * 1024),   // 25 MB per upload
  dm_default_ttl: String(Dm.defaultTtl),        // 30 days (single-sourced from Domain.Dm)
  dm_backstop_days: '30',                       // unopened-message backstop
  dm_media_bytes: '0',                          // sweep-maintained total, display-only
  wall_prune_enabled: '0',                      // public posts persist forever until this is turned on
  wall_prune_days: '365',                       // retention when pruning is enabled
};
let appSettingsCache = { at: 0, s: null };
async function getAppSettings(env) {
  const now = Date.now();
  if (appSettingsCache.s && now - appSettingsCache.at < 300000) return appSettingsCache.s;
  const s = Object.assign({}, APP_SETTING_DEFAULTS);
  try {
    const rows = await env.DB.prepare('SELECT k, v FROM app_settings').all();
    for (const r of (rows.results || [])) s[r.k] = r.v;
  } catch (e) { /* fresh DB: defaults stand */ }
  appSettingsCache = { at: now, s };
  return s;
}
function dmDefaultTtl(s) { return Number(s.dm_default_ttl) || Dm.defaultTtl; }
function dmBackstopSeconds(s) { return (Number(s.dm_backstop_days) || 30) * 86400; }

/* Send. The same wall as posting: throttle, ban, Turnstile. A block by the
   recipient does NOT refuse the send: the message is stored held, reads as
   delivered to its sender, and stays invisible to the recipient until an
   unblock releases it. The blocked party is never told. */
async function handleDmSend(request, env, ctx) {
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
  /* enc = 1: the body is an opaque end-to-end-encrypted blob the server must not
     touch beyond bounding its size; enc = 0: a legacy/plain body. Either way the
     store is verbatim — the server never reads the message content. */
  const enc = (data.enc === 1 || data.enc === true) ? 1 : 0;
  const body = String(data.body || '').replace(/\r\n?/g, '\n').trim();
  if (!body) return json({ ok: false, error: 'The message is empty.' }, 400);
  if (body.length > (enc ? DM_ENC_MAX : MAX_BODY)) return json({ ok: false, error: 'The message is too long.' }, 400);
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
  if (!(await verifyTurnstile(env, String(data.token || ''), ip, String(data.key || '')))) {
    return json({ ok: false, error: 'Verification failed. Reload the page and try again.' }, 403);
  }
  /* An optional media attachment: the client uploaded the ciphertext to R2 first
     and passes its opaque key here. Validate it exists and is unused; it is linked
     to this message below so the sweep can reclaim the R2 object on expiry. */
  let mediaKey = null, mediaSize = null;
  const rawMediaKey = String(data.media_key || '');
  if (rawMediaKey) {
    if (!/^dm\/[0-9a-f]{64}$/.test(rawMediaKey)) return json({ ok: false, error: 'Bad request.' }, 400);
    const mrow = await env.DB.prepare('SELECT size, msg_id FROM dm_media WHERE key = ?1').bind(rawMediaKey).first();
    if (!mrow || mrow.msg_id) return json({ ok: false, error: 'That attachment is not available.' }, 400);
    mediaKey = rawMediaKey;
    mediaSize = mrow.size;
  }
  const [a, b] = dmPair(me, to);
  const now = Math.floor(Date.now() / 1000);
  /* A fresh message counts down from the unopened backstop; when the recipient
     opens it, handleDmThread rebases the clock to opened_at + the conversation
     ttl (so "expires N days after opening"). */
  const msgExpires = now + dmBackstopSeconds(await getAppSettings(env));
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
    'INSERT INTO dms (thread_id, sender_hash, body, created_at, held, enc, expires_at, media_key, media_size) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9) RETURNING id'
  ).bind(thread.id, me, body, now, held, enc, msgExpires, mediaKey, mediaSize).first();
  if (mediaKey) await env.DB.prepare('UPDATE dm_media SET msg_id = ?1 WHERE key = ?2').bind(msg.id, mediaKey).run();
  if (!held) {
    /* Recomputed, never incremented, over the visible words alone, and the
       sender's own stamp rides along: what you just said is read by you. */
    await env.DB.prepare(
      'UPDATE dm_threads SET msgs = (SELECT COUNT(*) FROM dms WHERE thread_id = ?1 AND COALESCE(held, 0) = 0), ' +
      myReadCol + ' = ?2 WHERE id = ?1'
    ).bind(thread.id, now).run();
    /* Instant delivery to the recipient's own connections over the private
       user:<to> scope — their open thread drops it in, their badge rings — plus
       the (gated-off) native push nudge. A HELD message does neither: the
       recipient must never learn of a shadow-blocked send. */
    if (ctx) {
      publishLive(env, ctx, { v: 1, t: 'dm', scopes: ['user:' + to], from: me, thread_id: thread.id,
        message: { id: msg.id, sender_hash: me, body: body, created_at: now, enc: enc, media_key: mediaKey } });
    }
    /* A DM also lands in the recipient's notifications list (the inbox badge is
       not the only place it should show). */
    await notifyDm(env, to, me);
    await deliverPush(env, [to], { kind: 'dm', thread_id: thread.id });
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
  const msg = await env.DB.prepare(
    'INSERT INTO dms (thread_id, sender_hash, body, created_at, held, enc, expires_at) VALUES (?1, ?2, ?3, ?4, 0, 2, ?5) RETURNING id'
  ).bind(thread.id, fromHash, body, now, now + dmBackstopSeconds(await getAppSettings(env))).first();
  await env.DB.prepare(
    'UPDATE dm_threads SET msgs = (SELECT COUNT(*) FROM dms WHERE thread_id = ?1 AND COALESCE(held, 0) = 0), ' +
    senderReadCol + ' = ?2 WHERE id = ?1'
  ).bind(thread.id, now).run();
  /* Nudge the recipient's own connections (badge + open thread) like any DM. */
  await publishUser(env, [{ v: 1, t: 'dm', scopes: ['user:' + toHash], from: fromHash, thread_id: thread.id,
    message: { id: (msg && msg.id) || 0, sender_hash: fromHash, body: body, created_at: now, enc: 2 } }]);
  /* A system DM (e.g. a topic-move notice) is notification-worthy too. */
  await notifyDm(env, toHash, fromHash);
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
  const now = Math.floor(Date.now() / 1000);
  const p = Math.min(1000, Math.max(1, Math.floor(Number(data.p) || 1)));
  /* Everything per viewer: counts and last-activity over the words this reader
     may see (unheld or their own, uncleared, UNEXPIRED); a thread whose every
     visible word has expired or is held reads as absent. */
  const inner =
    'SELECT t.id, ' +
    'CASE WHEN t.a_hash = ?1 THEN t.b_hash ELSE t.a_hash END AS other_hash, ' +
    'pr.nick, pr.avatar, ' +
    '(SELECT COUNT(*) FROM dms m WHERE m.thread_id = t.id AND ' + DM_VIS + ' AND ' + DM_CLEARED + ' AND ' + dmLive(now) + ') AS msgs, ' +
    '(SELECT MAX(m.created_at) FROM dms m WHERE m.thread_id = t.id AND ' + DM_VIS + ' AND ' + DM_CLEARED + ' AND ' + dmLive(now) + ') AS last_at, ' +
    'CASE WHEN ' + dmUnreadExists(now) + ' THEN 1 ELSE 0 END AS unread ' +
    'FROM dm_threads t LEFT JOIN profiles pr ON pr.hash = CASE WHEN t.a_hash = ?1 THEN t.b_hash ELSE t.a_hash END ' +
    'WHERE t.a_hash = ?1 OR t.b_hash = ?1';
  const rows = await env.DB.prepare(
    'SELECT * FROM (' + inner + ') WHERE msgs > 0 ORDER BY last_at DESC LIMIT ?2 OFFSET ?3'
  ).bind(me, DM_PER_PAGE, (p - 1) * DM_PER_PAGE).all();
  const totals = await env.DB.prepare(
    'SELECT COUNT(*) AS n, COALESCE(SUM(unread), 0) AS unread FROM (' + inner + ') WHERE msgs > 0'
  ).bind(me).first();
  const threads = (rows.results || []).map((r) => Object.assign({}, r,
    { assigned: r.other_hash ? displayName(r.other_hash) : null }));
  return json({ ok: true, threads, total: totals.n || 0,
    unread_total: totals.unread || 0, page: p, per: DM_PER_PAGE }, 200);
}

/* One conversation, paged by twenty like everything else, defaulting to the
   LAST page so it opens at its newest words. Opening marks it read with at
   most one write, none when nothing was unread. */
async function handleDmThread(request, env, ctx) {
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
  const now = Math.floor(Date.now() / 1000);
  const settings = await getAppSettings(env);
  const thread = await env.DB.prepare(
    'SELECT id, msgs, last_at, last_sender, a_read_at, b_read_at, a_cleared_at, b_cleared_at, ttl FROM dm_threads WHERE a_hash = ?1 AND b_hash = ?2'
  ).bind(a, b).first();
  const prof = await env.DB.prepare('SELECT nick, avatar FROM profiles WHERE hash = ?1').bind(other).first();
  /* The correspondent's published X25519 public key, so the client can encrypt
     to them and decrypt this pair's messages. Null until they have signed in once
     under the encrypted-inbox client (the client then blocks the send with a
     notice rather than falling back to plaintext). */
  const otherPubRow = await env.DB.prepare('SELECT pubkey FROM dm_pubkeys WHERE hash = ?1').bind(other).first();
  const otherPub = otherPubRow ? otherPubRow.pubkey : null;
  const iBlocked = await env.DB.prepare('SELECT 1 AS b FROM dm_blocks WHERE owner_hash = ?1 AND blocked_hash = ?2')
    .bind(me, other).first();
  const ttl = (thread && thread.ttl) || dmDefaultTtl(settings);
  if (!thread) {
    /* No words yet: an empty room, ready for the first message. */
    return json({ ok: true, thread_id: null, ttl, other: { hash: other, nick: prof && prof.nick || null, avatar: prof && prof.avatar || null, assigned: displayName(other), pubkey: otherPub },
      messages: [], total: 0, page: 1, per: DM_PER_PAGE, blocked: iBlocked ? 1 : 0 }, 200);
  }
  /* The total and the pages are the viewer's own: held words count for their
     sender and for nobody else, and a side that deleted the thread sees only
     what arrived after its own clear stamp (a fresh start). */
  const myCleared = (me === a ? thread.a_cleared_at : thread.b_cleared_at) || 0;
  const totRow = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM dms m WHERE m.thread_id = ?2 AND ' + DM_VIS + ' AND m.created_at > ?3 AND ' + dmLive(now)
  ).bind(me, thread.id, myCleared).first();
  const total = totRow.n || 0;
  const lastPage = Math.max(1, Math.ceil(total / DM_PER_PAGE));
  const p = data.p == null ? lastPage : Math.min(1000, Math.max(1, Math.floor(Number(data.p) || 1)));
  const msgs = await env.DB.prepare(
    'SELECT m.id, m.sender_hash, m.body, m.created_at, COALESCE(m.enc, 0) AS enc, COALESCE(m.saved, 0) AS saved, m.media_key, m.media_size, COALESCE(m.media_expired, 0) AS media_expired, m.opened_at, m.expires_at FROM dms m WHERE m.thread_id = ?2 AND ' + DM_VIS +
    ' AND m.created_at > ?5 AND ' + dmLive(now) + ' ORDER BY m.id LIMIT ?3 OFFSET ?4'
  ).bind(me, thread.id, DM_PER_PAGE, (p - 1) * DM_PER_PAGE, myCleared).all();
  const myReadCol = me === a ? 'a_read_at' : 'b_read_at';
  /* One conditional write: only when a visible word from the other side is
     newer than my stamp. Held and cleared words never trigger it. */
  await env.DB.prepare(
    'UPDATE dm_threads SET ' + myReadCol + ' = ?2 WHERE id = ?3 AND EXISTS(' +
    'SELECT 1 FROM dms m WHERE m.thread_id = ?3 AND COALESCE(m.held, 0) = 0 AND m.sender_hash != ?1 ' +
    'AND m.created_at > COALESCE(' + myReadCol + ', 0) AND m.created_at > ?4)'
  ).bind(me, now, thread.id, myCleared).run();
  /* Start the disappearing-message clock. The messages this viewer is the
     recipient of, and is opening for the first time, get opened_at = now and a
     fresh expires_at = now + the conversation ttl, overriding the unopened
     backstop. Idempotent (opened_at IS NULL); saved messages are left alone so a
     save survives an open. This is why a message "expires N days after opening". */
  const openRes = await env.DB.prepare(
    'UPDATE dms SET opened_at = ?2, expires_at = ?2 + ?5 WHERE thread_id = ?3 AND sender_hash != ?1 ' +
    'AND COALESCE(held, 0) = 0 AND opened_at IS NULL AND COALESCE(saved, 0) = 0 AND created_at > ?4'
  ).bind(me, now, thread.id, myCleared, ttl).run();
  /* Read receipt: if I just opened messages the OTHER side sent, tell the SENDER
     (their user:<hash> sockets) that everything up to `now` has been seen, so
     their open thread flips those bubbles to "Seen" live. One event per open. */
  if (openRes && openRes.meta && openRes.meta.changes > 0) {
    const ev = { v: 1, t: 'dm-read', scopes: ['user:' + other], thread_id: thread.id, reader: me, at: now };
    if (ctx) publishLive(env, ctx, ev); else await publishUser(env, [ev]);
  }
  return json({ ok: true, thread_id: thread.id, ttl,
    other: { hash: other, nick: prof && prof.nick || null, avatar: prof && prof.avatar || null, assigned: displayName(other), pubkey: otherPub },
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
  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM dm_threads t WHERE (t.a_hash = ?1 OR t.b_hash = ?1) AND ' + dmUnreadExists(now)
  ).bind(me).first();
  return json({ ok: true, unread: row.n || 0 }, 200);
}

/* The batched inbox presence check: given a list of correspondent hashes, which
   are online right now (honouring appear-offline)? One keyed request per inbox
   load, answered by the BoardHub DO's live socket set — no polling. */
async function handleDmPresence(request, env) {
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
  const hashes = (Array.isArray(data.hashes) ? data.hashes : [])
    .filter((h) => /^[0-9a-f]{64}$/.test(String(h))).slice(0, 50);
  if (!hashes.length || !env.HUB) return json({ ok: true, online: [] }, 200);
  let online = [];
  try { online = await env.HUB.get(env.HUB.idFromName('board')).presenceOf(hashes); } catch { online = []; }
  return json({ ok: true, online: Array.isArray(online) ? online : [] }, 200);
}

/* Set the per-conversation disappearing-message lifetime. Either participant may
   change it and the LAST write wins for both — it is a single column. Changing it
   rebases every opened, unsaved message to the new lifetime, and the other party
   is told live so their header updates. Upserts the thread if it does not exist
   yet (a still-empty room, invisible in the inbox), so the choice sticks before
   the first message is even sent. */
async function handleDmTtl(request, env, ctx) {
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.POST_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests. Slow down.' }, 429);
  const key = String(data.key || '');
  const other = String(data.with || '');
  const ttl = Math.floor(Number(data.ttl) || 0);
  if (!key || !/^[0-9a-f]{64}$/.test(other) || DM_TTLS.indexOf(ttl) === -1) return json({ ok: false, error: 'Bad request.' }, 400);
  const me = await sha256hex(key);
  if (me === other) return json({ ok: false, error: 'Bad request.' }, 400);
  const gate = await blockedReason(env, me, ip);
  if (gate) return blockedJson(gate);
  const [a, b] = dmPair(me, other);
  const now = Math.floor(Date.now() / 1000);
  const thread = await env.DB.prepare(
    'INSERT INTO dm_threads (a_hash, b_hash, created_at, last_at, last_sender, msgs, ttl) VALUES (?1, ?2, ?3, ?3, ?4, 0, ?5) ' +
    'ON CONFLICT(a_hash, b_hash) DO UPDATE SET ttl = ?5 RETURNING id'
  ).bind(a, b, now, me, ttl).first();
  await env.DB.prepare(
    'UPDATE dms SET expires_at = opened_at + ?1 WHERE thread_id = ?2 AND opened_at IS NOT NULL AND COALESCE(saved, 0) = 0'
  ).bind(ttl, thread.id).run();
  if (ctx) publishLive(env, ctx, { v: 1, t: 'dm-ttl', scopes: ['user:' + other], from: me, thread_id: thread.id, ttl });
  return json({ ok: true, ttl }, 200);
}

/* Save or unsave one message (either participant). A saved message is exempt from
   auto-expiry for BOTH sides (expires_at NULL), so a save keeps it for everyone —
   which is how expiry stays identical for both. Unsaving resumes the clock. */
async function handleDmSave(request, env) {
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.POST_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests. Slow down.' }, 429);
  const key = String(data.key || '');
  const other = String(data.with || '');
  const id = Math.floor(Number(data.id) || 0);
  const saved = data.saved ? 1 : 0;
  if (!key || !/^[0-9a-f]{64}$/.test(other) || id < 1) return json({ ok: false, error: 'Bad request.' }, 400);
  const me = await sha256hex(key);
  const gate = await blockedReason(env, me, ip);
  if (gate) return blockedJson(gate);
  const [a, b] = dmPair(me, other);
  /* The message must belong to this pair's thread; then either party may act. */
  const row = await env.DB.prepare(
    'SELECT d.id, d.created_at, d.opened_at, t.ttl FROM dms d JOIN dm_threads t ON t.id = d.thread_id ' +
    'WHERE d.id = ?1 AND t.a_hash = ?2 AND t.b_hash = ?3'
  ).bind(id, a, b).first();
  if (!row) return json({ ok: false, error: 'No such message.' }, 404);
  const settings = await getAppSettings(env);
  const ttl = row.ttl || dmDefaultTtl(settings);
  const expires = saved ? null : (row.opened_at ? (row.opened_at + ttl) : (row.created_at + dmBackstopSeconds(settings)));
  await env.DB.prepare('UPDATE dms SET saved = ?1, expires_at = ?2 WHERE id = ?3').bind(saved, expires, id).run();
  return json({ ok: true, saved, expires_at: expires }, 200);
}

/* Delete a set of media objects from R2 and their dm_media rows. R2 delete takes
   up to 1000 keys per call; the D1 delete is chunked to stay under the 50-subrequest
   budget. Keys are opaque server-minted ids. */
async function purgeMediaKeys(env, keys) {
  if (!keys || !keys.length) return;
  if (env.MEDIA) {
    for (let i = 0; i < keys.length; i += 1000) {
      try { await env.MEDIA.delete(keys.slice(i, i + 1000)); } catch (e) { /* keep going */ }
    }
  }
  for (let i = 0; i < keys.length; i += 50) {
    const chunk = keys.slice(i, i + 50);
    const ph = chunk.map((_, j) => '?' + (j + 1)).join(',');
    try { await env.DB.prepare('DELETE FROM dm_media WHERE key IN (' + ph + ')').bind(...chunk).run(); } catch (e) { /* keep going */ }
  }
}

/* Recompute the total DM-media storage, cache it for the upload gate + admin
   display, and — only if near the 10 GB free-tier wall — emergency-prune the
   oldest media (LRU) until back under 90%, nulling the message's media pointer so
   the client shows it as expired. Normal message-expiry keeps us far from this. */
async function enforceMediaCap(env) {
  const totalRow = await env.DB.prepare('SELECT COALESCE(SUM(size), 0) AS total FROM dm_media').first();
  let total = totalRow.total || 0;
  const EMERGENCY = Math.floor(MEDIA_CAP_BYTES * 0.95);
  const TARGET = Math.floor(MEDIA_CAP_BYTES * 0.90);
  if (total > EMERGENCY) {
    const old = await env.DB.prepare(
      'SELECT key, size, msg_id FROM dm_media WHERE msg_id IS NOT NULL ORDER BY created_at ASC LIMIT 1000'
    ).all();
    const kill = [];
    for (const r of (old.results || [])) { if (total <= TARGET) break; kill.push(r); total -= (r.size || 0); }
    if (kill.length) {
      await purgeMediaKeys(env, kill.map((r) => r.key));
      const ids = kill.map((r) => r.msg_id).filter(Boolean);
      for (let i = 0; i < ids.length; i += 50) {
        const chunk = ids.slice(i, i + 50);
        const ph = chunk.map((_, j) => '?' + (j + 1)).join(',');
        try { await env.DB.prepare('UPDATE dms SET media_key = NULL, media_size = NULL WHERE id IN (' + ph + ')').bind(...chunk).run(); } catch (e) { /* keep going */ }
      }
    }
  }
  try {
    await env.DB.prepare(
      "INSERT INTO app_settings (k, v, updated_at) VALUES ('dm_media_bytes', ?1, ?2) ON CONFLICT(k) DO UPDATE SET v = ?1, updated_at = ?2"
    ).bind(String(total), Math.floor(Date.now() / 1000)).run();
    appSettingsCache = { at: 0, s: null };
  } catch (e) { /* display-only cache; ignore */ }
}

/* The hourly sweep: hard-delete expired, unsaved messages (and their R2 media),
   prune orphaned/dangling media, tidy empty threads, and keep the media total
   fresh. Read-time filtering already hides expired messages instantly; this is
   the storage-reclamation pass. Each step is isolated so one failure never stops
   the rest. */
async function sweepExpiredDms(env) {
  const now = Math.floor(Date.now() / 1000);
  try {
    const gone = await env.DB.prepare(
      'SELECT media_key FROM dms WHERE expires_at IS NOT NULL AND expires_at < ?1 AND COALESCE(saved, 0) = 0 AND media_key IS NOT NULL LIMIT 5000'
    ).bind(now).all();
    const keys = (gone.results || []).map((r) => r.media_key).filter(Boolean);
    if (keys.length) await purgeMediaKeys(env, keys);
    await env.DB.prepare(
      'DELETE FROM dms WHERE expires_at IS NOT NULL AND expires_at < ?1 AND COALESCE(saved, 0) = 0'
    ).bind(now).run();
  } catch (e) { console.log(JSON.stringify({ event: 'sweep_expired_failed', error: String(e) })); }
  try {
    // Hard media cap (Domain.Dm.mediaMaxSeconds): NO media attachment persists
    // beyond 30 days, even inside a SAVED message. On a surviving message whose
    // media has aged out, purge the R2 object + row and mark the message
    // media_expired so the client shows a placeholder over any saved text/caption.
    const cap = now - Dm.mediaMaxSeconds;
    const capped = await env.DB.prepare(
      'SELECT md.key AS key, md.msg_id AS msg_id FROM dm_media md JOIN dms d ON d.id = md.msg_id ' +
      'WHERE md.created_at < ?1 AND d.media_key IS NOT NULL LIMIT 5000'
    ).bind(cap).all();
    const rows = capped.results || [];
    if (rows.length) {
      await purgeMediaKeys(env, rows.map((r) => r.key).filter(Boolean));
      const ids = rows.map((r) => r.msg_id).filter(Boolean);
      for (let i = 0; i < ids.length; i += 50) {
        const chunk = ids.slice(i, i + 50);
        const ph = chunk.map((_, j) => '?' + (j + 1)).join(',');
        try {
          await env.DB.prepare('UPDATE dms SET media_key = NULL, media_size = NULL, media_expired = 1 WHERE id IN (' + ph + ')').bind(...chunk).run();
        } catch (e) { /* keep going */ }
      }
    }
  } catch (e) { console.log(JSON.stringify({ event: 'sweep_media_cap_failed', error: String(e) })); }
  try {
    const orphan = await env.DB.prepare(
      'SELECT key FROM dm_media WHERE (msg_id IS NULL AND created_at < ?1) OR (msg_id IS NOT NULL AND msg_id NOT IN (SELECT id FROM dms)) LIMIT 2000'
    ).bind(now - 3600).all();
    await purgeMediaKeys(env, (orphan.results || []).map((r) => r.key));
  } catch (e) { /* keep going */ }
  try { await sweepDms(env); } catch (e) { /* empty-thread tidy */ }
  try { await enforceMediaCap(env); } catch (e) { /* cap/accounting */ }
}

/* A random opaque R2 object id for a DM media blob. Reveals nothing about who
   uploaded it or to whom, so the bucket cannot be traced to a member. */
function randomHex(n) {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('');
}

/* Upload one end-to-end-encrypted media blob. The bytes are ALREADY client-side
   ciphertext (AES-256-GCM; the key lives only inside the E2E message body), so the
   server stores an opaque blob under a random key and never sees the content.
   Keyed + throttled + enabled/size/storage-cap gated; the Turnstile-gated /dm/send
   that follows links it to its message. An unlinked upload is an orphan the hourly
   sweep prunes after an hour. */
async function handleDmMediaUpload(request, env) {
  if (!env.MEDIA) return json({ ok: false, error: 'Media storage is not available.' }, 503);
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.POST_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many uploads at once. Wait a minute.' }, 429);
  const settings = await getAppSettings(env);
  if (settings.media_enabled !== '1') return json({ ok: false, error: 'Media sharing is turned off.' }, 403);
  const maxBytes = Number(settings.media_max_bytes) || (25 * 1024 * 1024);
  const declared = Number(request.headers.get('Content-Length') || 0);
  if (declared && declared > maxBytes + 8192) return json({ ok: false, error: 'That file is too large.' }, 413);
  let form;
  try { form = await request.formData(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  const key = String(form.get('key') || '');
  if (!key) return json({ ok: false, error: 'Bad request.' }, 400);
  const me = await sha256hex(key);
  const gate = await blockedReason(env, me, ip);
  if (gate) return blockedJson(gate);
  const file = form.get('file');
  if (!file || typeof file.arrayBuffer !== 'function') return json({ ok: false, error: 'No file.' }, 400);
  if (file.size > maxBytes) return json({ ok: false, error: 'That file is too large.' }, 413);
  const usedNow = Number(settings.dm_media_bytes) || 0;
  if (usedNow + file.size > Math.floor(MEDIA_CAP_BYTES * 0.90)) {
    return json({ ok: false, error: 'Media storage is full right now — older files clear soon, try again later.' }, 507);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length > maxBytes) return json({ ok: false, error: 'That file is too large.' }, 413);
  const mediaKey = 'dm/' + randomHex(32);
  await env.MEDIA.put(mediaKey, bytes, { httpMetadata: { contentType: 'application/octet-stream' } });
  await env.DB.prepare('INSERT INTO dm_media (key, size, created_at, msg_id) VALUES (?1, ?2, ?3, NULL)')
    .bind(mediaKey, bytes.length, Math.floor(Date.now() / 1000)).run();
  return json({ ok: true, media_key: mediaKey, size: bytes.length }, 200);
}

/* Stream one media object's ciphertext to a thread participant. Membership is
   verified against the live, unexpired message that references it; a stranger or an
   expired reference gets an indistinguishable 404. The bytes are opaque ciphertext,
   useless without the key the recipient holds from the E2E message body. */
async function handleDmMediaGet(request, env) {
  if (!env.MEDIA) return json({ ok: false, error: 'Media storage is not available.' }, 503);
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.READ_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests. Slow down.' }, 429);
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  const key = String(data.key || '');
  const mediaKey = String(data.media_key || '');
  if (!key || !/^dm\/[0-9a-f]{64}$/.test(mediaKey)) return json({ ok: false, error: 'Bad request.' }, 400);
  const me = await sha256hex(key);
  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare(
    'SELECT t.a_hash, t.b_hash FROM dm_media md JOIN dms d ON d.id = md.msg_id JOIN dm_threads t ON t.id = d.thread_id ' +
    'WHERE md.key = ?1 AND (d.expires_at IS NULL OR d.expires_at > ?2)'
  ).bind(mediaKey, now).first();
  if (!row || (row.a_hash !== me && row.b_hash !== me)) return json({ ok: false, error: 'Not found.' }, 404);
  const obj = await env.MEDIA.get(mediaKey);
  if (!obj) return json({ ok: false, error: 'Not found.' }, 404);
  return new Response(obj.body, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Cache-Control': 'private, max-age=86400',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
    },
  });
}

/* Admin platform settings: read them (with the current media usage), and set the
   tunable ones with sanity clamps. The growing home for site-wide toggles. */
async function handleAdminSettings(request, env) {
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  const key = String(data.key || '');
  if (!(await requireAdmin(env, key))) return json({ ok: false, error: 'No.' }, 403);
  if (data.set && typeof data.set === 'object') {
    const now = Math.floor(Date.now() / 1000);
    const me = await sha256hex(key);
    const allowed = { media_enabled: 1, media_max_bytes: 1, dm_default_ttl: 1, dm_backstop_days: 1, wall_prune_enabled: 1, wall_prune_days: 1 };
    const stmts = [];
    for (const k of Object.keys(data.set)) {
      if (!allowed[k]) continue;
      let v = String(data.set[k]);
      if (k === 'media_enabled' || k === 'wall_prune_enabled') v = (v === '1' || v === 'true') ? '1' : '0';
      else if (k === 'media_max_bytes') v = String(Math.max(65536, Math.min(100 * 1024 * 1024, Math.floor(Number(v)) || (25 * 1024 * 1024))));
      else if (k === 'dm_default_ttl') v = String(DM_TTLS.indexOf(Math.floor(Number(v))) !== -1 ? Math.floor(Number(v)) : Dm.defaultTtl);
      else if (k === 'dm_backstop_days') v = String(Math.max(1, Math.min(365, Math.floor(Number(v)) || 30)));
      else if (k === 'wall_prune_days') v = String(Wall.clampPruneDays(Math.floor(Number(v)) || 365));
      stmts.push(env.DB.prepare(
        'INSERT INTO app_settings (k, v, updated_at, updated_by) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(k) DO UPDATE SET v = ?2, updated_at = ?3, updated_by = ?4'
      ).bind(k, v, now, me));
    }
    if (stmts.length) { await env.DB.batch(stmts); appSettingsCache = { at: 0, s: null }; }
  }
  const settings = await getAppSettings(env);
  return json({ ok: true, settings, cap_bytes: MEDIA_CAP_BYTES, ttls: DM_TTLS, wall_prune_options: Wall.pruneDayOptions }, 200);
}

/* Purge ALL DM media from the bucket (admin, destructive). Cursor-paginated list +
   batched delete, then clear the pointers and the usage counter. Message text is
   untouched; only the shared attachments are removed. */
async function handleDmMediaPurge(request, env) {
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  const key = String(data.key || '');
  if (!(await requireAdmin(env, key))) return json({ ok: false, error: 'No.' }, 403);
  let deleted = 0;
  if (env.MEDIA) {
    let cursor;
    do {
      const list = await env.MEDIA.list({ prefix: 'dm/', cursor, limit: 1000 });
      const keys = (list.objects || []).map((o) => o.key);
      if (keys.length) { try { await env.MEDIA.delete(keys); } catch (e) { /* keep going */ } deleted += keys.length; }
      cursor = list.truncated ? list.cursor : null;
    } while (cursor);
  }
  await env.DB.prepare('DELETE FROM dm_media').run();
  await env.DB.prepare('UPDATE dms SET media_key = NULL, media_size = NULL WHERE media_key IS NOT NULL').run();
  await env.DB.prepare(
    "INSERT INTO app_settings (k, v, updated_at) VALUES ('dm_media_bytes', '0', ?1) ON CONFLICT(k) DO UPDATE SET v = '0', updated_at = ?1"
  ).bind(Math.floor(Date.now() / 1000)).run();
  appSettingsCache = { at: 0, s: null };
  return json({ ok: true, deleted }, 200);
}

/* ================= Public posting: walls + the global feed =================
   A member's "wall" is their own stream of public posts; the "feed" is every
   member's posts together. Public + UNencrypted (unlike DMs), reusing the forum's
   Turnstile + AI screen (held-if-flagged) + @mention notifications. Media rides a
   public R2 bucket (WALLMEDIA), served same-origin like avatars. Posts persist
   until the admin auto-prune (Phase D) removes them. All members-only to read. */

const WALL_PER_PAGE = 20;
// Object-key shape: wall/<kind>/<64hex>, kind i=image v=video a=audio (the client
// picks <img>/<video>/<audio> from the kind — no mime column or JOIN needed).
const WALL_MEDIA_RE = /^wall\/[iva]\/[0-9a-f]{64}$/;
const WALL_POST_COLS = 'p.id, p.author_hash, pr.nick, pr.avatar, pr.faith, p.body, p.created_at, p.edited_at, p.media_key, p.media_size, p.comments';
const WALL_COMMENT_COLS = 'c.id, c.post_id, c.author_hash, pr.nick, pr.avatar, pr.faith, c.body, c.created_at, c.media_key, c.media_size';

/* Add the author display fields (assigned pseudonym + rank) the client renders,
   mirroring the forum's withNames. nick/avatar/faith are already joined in. */
async function wallEnrich(env, rows) {
  const list = rows || [];
  const counts = await postCountsFor(env, list.map((r) => r.author_hash));
  return list.map((r) => withNames(r, counts[r.author_hash] || 0));
}

/* The wall's own notifications (kind 'wall', comment_id = the post id, jumps to
   ?post=<id>): a comment tells the post author, and an @mention tells the picked
   member. Reuses the private user:<hash> live push. */
async function deliverWallNotifications(env, o) {
  const now = Math.floor(Date.now() / 1000);
  const NOTIF = 'INSERT INTO notifications (recipient_hash, kind, topic_id, comment_id, actor_hash, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)';
  const stmts = [];
  const live = [];
  const seen = new Set([o.authorHash, MERECAT_BOT.hash]);
  // topic_id encodes the wall sub-kind for the label: 1 = a comment on your post,
  // 0 = an @mention. comment_id is always the post id (jumps to ?post=<id>).
  const add = (h, commented) => {
    const flag = commented ? 1 : 0;
    stmts.push(env.DB.prepare(NOTIF).bind(h, 'wall', flag, o.postId, o.authorHash, now));
    live.push({ v: 1, t: 'notification', scopes: ['user:' + h], kind: 'wall', topic_id: flag, comment_id: o.postId, actor_hash: o.authorHash, created_at: now });
    seen.add(h);
  };
  if (o.postAuthorHash && !seen.has(o.postAuthorHash)) add(o.postAuthorHash, true);
  if (Array.isArray(o.mentions)) {
    let count = 0;
    for (const m of o.mentions) {
      const h = String(m || '').toLowerCase();
      if (/^[0-9a-f]{64}$/.test(h) && !seen.has(h) && count < 10) { add(h, false); count += 1; }
    }
  }
  if (stmts.length) await env.DB.batch(stmts);
  if (live.length) await publishUser(env, live);
}

/* Shared R2 purge for public post/comment media (mirror of purgeMediaKeys). */
async function purgeWallMedia(env, keys) {
  if (!keys || !keys.length) return;
  if (env.WALLMEDIA) {
    for (let i = 0; i < keys.length; i += 1000) {
      try { await env.WALLMEDIA.delete(keys.slice(i, i + 1000)); } catch (e) { /* keep going */ }
    }
  }
  for (let i = 0; i < keys.length; i += 50) {
    const chunk = keys.slice(i, i + 50);
    const ph = chunk.map((_, j) => '?' + (j + 1)).join(',');
    try { await env.DB.prepare('DELETE FROM wall_media WHERE key IN (' + ph + ')').bind(...chunk).run(); } catch (e) { /* keep going */ }
  }
}

/* Reclaim public-media objects with no live owner: an upload that was never
   attached to a post (older than an hour), or one whose post/comment is gone. */
async function sweepWallOrphanMedia(env) {
  const now = Math.floor(Date.now() / 1000);
  try {
    const orphan = await env.DB.prepare(
      'SELECT key FROM wall_media WHERE (ref_id IS NULL AND created_at < ?1) ' +
      "OR (ref_type = 'post' AND ref_id NOT IN (SELECT id FROM wall_posts)) " +
      "OR (ref_type = 'comment' AND ref_id NOT IN (SELECT id FROM wall_comments)) LIMIT 2000"
    ).bind(now - 3600).all();
    await purgeWallMedia(env, (orphan.results || []).map((r) => r.key));
  } catch (e) { /* keep going */ }
}

/* Read gate shared by the members-only feed/wall/post reads. Returns the member
   hash, or a Response to return immediately (401 / blocked / 429). */
async function wallReader(request, env, data) {
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.READ_LIMIT.limit({ key: ip });
  if (!success) return { resp: json({ ok: false, error: 'Too many requests. Slow down.' }, 429) };
  const key = String((data && data.key) || '');
  if (!key) return { resp: json({ ok: false, error: 'Sign in to see the feed.' }, 401) };
  const me = await sha256hex(key);
  const gate = await blockedReason(env, me, ip);
  if (gate) return { resp: blockedJson(gate) };
  return { me };
}

/* GET-style read (POST body, keyed): the global feed, newest first, keyset cursor
   (id < cursor) for infinite scroll. */
async function handleWallFeed(request, env) {
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  const r = await wallReader(request, env, data);
  if (r.resp) return r.resp;
  const cursor = Math.floor(Number(data.cursor) || 0);
  const rows = cursor > 0
    ? await env.DB.prepare('SELECT ' + WALL_POST_COLS + " FROM wall_posts p LEFT JOIN profiles pr ON pr.hash = p.author_hash WHERE p.status = 'live' AND p.id < ?1 ORDER BY p.id DESC LIMIT ?2").bind(cursor, WALL_PER_PAGE).all()
    : await env.DB.prepare('SELECT ' + WALL_POST_COLS + " FROM wall_posts p LEFT JOIN profiles pr ON pr.hash = p.author_hash WHERE p.status = 'live' ORDER BY p.id DESC LIMIT ?1").bind(WALL_PER_PAGE).all();
  const list = rows.results || [];
  const posts = await wallEnrich(env, list);
  const next = list.length === WALL_PER_PAGE ? list[list.length - 1].id : 0;
  return json({ ok: true, posts, next, me: r.me }, 200);
}

/* One member's wall (their own posts), keyset-paged like the feed. */
async function handleWall(request, env) {
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  const r = await wallReader(request, env, data);
  if (r.resp) return r.resp;
  const hash = String(data.hash || '');
  if (!/^[0-9a-f]{64}$/.test(hash)) return json({ ok: false, error: 'No such member.' }, 400);
  const cursor = Math.floor(Number(data.cursor) || 0);
  const rows = cursor > 0
    ? await env.DB.prepare('SELECT ' + WALL_POST_COLS + " FROM wall_posts p LEFT JOIN profiles pr ON pr.hash = p.author_hash WHERE p.author_hash = ?1 AND p.status = 'live' AND p.id < ?2 ORDER BY p.id DESC LIMIT ?3").bind(hash, cursor, WALL_PER_PAGE).all()
    : await env.DB.prepare('SELECT ' + WALL_POST_COLS + " FROM wall_posts p LEFT JOIN profiles pr ON pr.hash = p.author_hash WHERE p.author_hash = ?1 AND p.status = 'live' ORDER BY p.id DESC LIMIT ?2").bind(hash, WALL_PER_PAGE).all();
  const list = rows.results || [];
  const posts = await wallEnrich(env, list);
  const next = list.length === WALL_PER_PAGE ? list[list.length - 1].id : 0;
  return json({ ok: true, posts, next, me: r.me, hash }, 200);
}

/* One post plus all its live comments (the ?post=<id> detail + mention target). */
async function handleWallPostGet(request, env) {
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  const r = await wallReader(request, env, data);
  if (r.resp) return r.resp;
  const id = Math.floor(Number(data.id) || 0);
  const post = await env.DB.prepare('SELECT ' + WALL_POST_COLS + " FROM wall_posts p LEFT JOIN profiles pr ON pr.hash = p.author_hash WHERE p.id = ?1 AND p.status = 'live'").bind(id).first();
  if (!post) return json({ ok: false, error: 'That post is gone.' }, 404);
  const crows = await env.DB.prepare('SELECT ' + WALL_COMMENT_COLS + " FROM wall_comments c LEFT JOIN profiles pr ON pr.hash = c.author_hash WHERE c.post_id = ?1 AND c.status = 'live' ORDER BY c.id").bind(id).all();
  const enriched = await wallEnrich(env, [post].concat(crows.results || []));
  return json({ ok: true, post: enriched[0], comments: enriched.slice(1), me: r.me }, 200);
}

/* Validate an attached media_key: it must be an unlinked wall_media row. Returns
   { key, size } or null. */
async function wallClaimMedia(env, mediaKey) {
  if (!mediaKey || !WALL_MEDIA_RE.test(String(mediaKey))) return null;
  const mr = await env.DB.prepare('SELECT size FROM wall_media WHERE key = ?1 AND ref_id IS NULL').bind(String(mediaKey)).first();
  return mr ? { key: String(mediaKey), size: mr.size } : null;
}

/* Create a post on my own wall (author = me), which also lands it in the feed.
   Turnstile + AI screen (held-if-flagged) exactly like a forum comment. */
async function handleWallPost(request, env, ctx) {
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  if (String(data.website || '')) return json({ ok: true }, 200);   // honeypot
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.POST_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests. Slow down.' }, 429);
  const key = String(data.key || '');
  if (!key) return json({ ok: false, error: 'Sign in to post.' }, 401);
  const body = String(data.body || '').replace(/\r\n?/g, '\n').trim();
  const media = await wallClaimMedia(env, data.media_key);
  if (!body && !media) return json({ ok: false, error: 'Say something or attach something.' }, 400);
  if (body.length > MAX_BODY) return json({ ok: false, error: 'That is too long.' }, 400);
  if (CONTROL_RE.test(body)) return json({ ok: false, error: 'Bad request.' }, 400);
  if (!(await verifyTurnstile(env, String(data.token || ''), ip, key))) {
    return json({ ok: false, error: 'Verification failed. Reload the page and try again.' }, 403);
  }
  const me = await sha256hex(key);
  const gate = await blockedReason(env, me, ip);
  if (gate) return blockedJson(gate);
  const { status } = await screen(env, body || '(media post)', await isTrusted(env, me));
  const now = Math.floor(Date.now() / 1000);
  const ins = await env.DB.prepare(
    'INSERT INTO wall_posts (author_hash, body, created_at, status, media_key, media_size) VALUES (?1, ?2, ?3, ?4, ?5, ?6) RETURNING id'
  ).bind(me, body, now, status, media ? media.key : null, media ? media.size : null).first();
  if (media) await env.DB.prepare("UPDATE wall_media SET ref_type = 'post', ref_id = ?1 WHERE key = ?2").bind(ins.id, media.key).run();
  if (status === 'live') {
    if (ctx) ctx.waitUntil(deliverWallNotifications(env, { authorHash: me, postId: ins.id, mentions: data.mentions }));
    publishLive(env, ctx, { v: 1, t: 'wall-post', scopes: ['feed:global'], id: ins.id });
  }
  return json({ ok: true, id: ins.id, status }, 200);
}

/* Comment on a post (text + optional media). Notifies the post author + mentions. */
async function handleWallComment(request, env, ctx) {
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  if (String(data.website || '')) return json({ ok: true }, 200);   // honeypot
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.POST_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests. Slow down.' }, 429);
  const key = String(data.key || '');
  if (!key) return json({ ok: false, error: 'Sign in to comment.' }, 401);
  const postId = Math.floor(Number(data.post) || 0);
  const post = await env.DB.prepare("SELECT id, author_hash FROM wall_posts WHERE id = ?1 AND status = 'live'").bind(postId).first();
  if (!post) return json({ ok: false, error: 'That post is gone.' }, 404);
  const body = String(data.body || '').replace(/\r\n?/g, '\n').trim();
  const media = await wallClaimMedia(env, data.media_key);
  if (!body && !media) return json({ ok: false, error: 'Say something or attach something.' }, 400);
  if (body.length > MAX_BODY) return json({ ok: false, error: 'That is too long.' }, 400);
  if (CONTROL_RE.test(body)) return json({ ok: false, error: 'Bad request.' }, 400);
  if (!(await verifyTurnstile(env, String(data.token || ''), ip, key))) {
    return json({ ok: false, error: 'Verification failed. Reload the page and try again.' }, 403);
  }
  const me = await sha256hex(key);
  const gate = await blockedReason(env, me, ip);
  if (gate) return blockedJson(gate);
  const { status } = await screen(env, body || '(media comment)', await isTrusted(env, me));
  const now = Math.floor(Date.now() / 1000);
  const ins = await env.DB.prepare(
    'INSERT INTO wall_comments (post_id, author_hash, body, created_at, status, media_key, media_size) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) RETURNING id'
  ).bind(postId, me, body, now, status, media ? media.key : null, media ? media.size : null).first();
  if (media) await env.DB.prepare("UPDATE wall_media SET ref_type = 'comment', ref_id = ?1 WHERE key = ?2").bind(ins.id, media.key).run();
  if (status === 'live') {
    await env.DB.prepare('UPDATE wall_posts SET comments = comments + 1 WHERE id = ?1').bind(postId).run();
    if (ctx) ctx.waitUntil(deliverWallNotifications(env, { authorHash: me, postId: postId, mentions: data.mentions, postAuthorHash: post.author_hash }));
    publishLive(env, ctx, { v: 1, t: 'wall-comment', scopes: ['feed:global'], post: postId });
  }
  return json({ ok: true, id: ins.id, status }, 200);
}

/* Delete a post (and its comments + all their media) or a single comment. Author
   or admin only (Domain.Wall.canDelete). Hard delete — public content, no soft
   state to keep. */
async function handleWallDelete(request, env) {
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  const key = String(data.key || '');
  if (!key) return json({ ok: false, error: 'Bad request.' }, 400);
  const me = await sha256hex(key);
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const gate = await blockedReason(env, me, ip);
  if (gate) return blockedJson(gate);
  const admin = await isAdminHash(env, me);
  const id = Math.floor(Number(data.id) || 0);
  if (data.kind === 'comment') {
    const row = await env.DB.prepare('SELECT post_id, author_hash, media_key FROM wall_comments WHERE id = ?1').bind(id).first();
    if (!row) return json({ ok: true }, 200);
    if (!Wall.canDelete(row.author_hash)(me)(admin)) return json({ ok: false, error: 'No.' }, 403);
    if (row.media_key) await purgeWallMedia(env, [row.media_key]);
    await env.DB.prepare('DELETE FROM wall_comments WHERE id = ?1').bind(id).run();
    await env.DB.prepare('UPDATE wall_posts SET comments = MAX(0, comments - 1) WHERE id = ?1').bind(row.post_id).run();
    return json({ ok: true }, 200);
  }
  const row = await env.DB.prepare('SELECT author_hash, media_key FROM wall_posts WHERE id = ?1').bind(id).first();
  if (!row) return json({ ok: true }, 200);
  if (!Wall.canDelete(row.author_hash)(me)(admin)) return json({ ok: false, error: 'No.' }, 403);
  const keys = [];
  if (row.media_key) keys.push(row.media_key);
  const cm = await env.DB.prepare('SELECT media_key FROM wall_comments WHERE post_id = ?1 AND media_key IS NOT NULL').bind(id).all();
  (cm.results || []).forEach((r) => keys.push(r.media_key));
  if (keys.length) await purgeWallMedia(env, keys);
  await env.DB.prepare('DELETE FROM wall_comments WHERE post_id = ?1').bind(id).run();
  await env.DB.prepare('DELETE FROM wall_posts WHERE id = ?1').bind(id).run();
  return json({ ok: true }, 200);
}

/* Upload public post/comment media. Images are AI-screened (LLaVA, like avatars);
   video/audio are validated by declared type + size only. Stored UNencrypted; the
   object key encodes the kind so the client can render it. Linked to its post/
   comment by handleWallPost/Comment; orphans (unlinked) are pruned. */
async function handleWallMediaUpload(request, env) {
  if (!env.WALLMEDIA) return json({ ok: false, error: 'Media is unavailable.' }, 503);
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.POST_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests. Slow down.' }, 429);
  const settings = await getAppSettings(env);
  if (settings.media_enabled !== '1') return json({ ok: false, error: 'Media uploads are turned off.' }, 403);
  const maxBytes = Number(settings.media_max_bytes) || (25 * 1024 * 1024);
  const clen = Number(request.headers.get('Content-Length') || 0);
  if (clen && clen > maxBytes + 8192) return json({ ok: false, error: 'That file is too large.' }, 413);
  let form;
  try { form = await request.formData(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  const key = String(form.get('key') || '');
  if (!key) return json({ ok: false, error: 'Bad request.' }, 400);
  const me = await sha256hex(key);
  const gate = await blockedReason(env, me, ip);
  if (gate) return blockedJson(gate);
  const file = form.get('file');
  if (!file || typeof file === 'string') return json({ ok: false, error: 'No file.' }, 400);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!bytes.length) return json({ ok: false, error: 'Empty file.' }, 400);
  if (bytes.length > maxBytes) return json({ ok: false, error: 'That file is too large.' }, 413);
  const declared = String(file.type || '');
  let kind = '', mime = '';
  const img = sniffImage(bytes);
  if (img && (!declared || declared.startsWith('image/'))) {
    if (!(await screenImage(env, bytes))) return json({ ok: false, error: 'That image was declined by the safety check.' }, 422);
    kind = 'i'; mime = img.mime;
  } else if (declared.startsWith('video/')) { kind = 'v'; mime = declared.slice(0, 60); }
  else if (declared.startsWith('audio/')) { kind = 'a'; mime = declared.slice(0, 60); }
  else return json({ ok: false, error: 'Only images, video, and audio can be shared.' }, 400);
  const objKey = 'wall/' + kind + '/' + randomHex(32);
  try { await env.WALLMEDIA.put(objKey, bytes, { httpMetadata: { contentType: mime } }); }
  catch { return json({ ok: false, error: 'Upload failed.' }, 500); }
  await env.DB.prepare('INSERT INTO wall_media (key, size, created_at) VALUES (?1, ?2, ?3)')
    .bind(objKey, bytes.length, Math.floor(Date.now() / 1000)).run();
  return json({ ok: true, media_key: objKey, size: bytes.length }, 200);
}

/* Serve public post media, keyless + cacheable, same-origin (like avatars). */
async function handleWallMediaGet(request, env, url) {
  if (!env.WALLMEDIA) return new Response('gone', { status: 404 });
  const k = String(url.searchParams.get('key') || '');
  if (!WALL_MEDIA_RE.test(k)) return new Response('bad request', { status: 400 });
  const obj = await env.WALLMEDIA.get(k);
  if (!obj) return new Response('not found', { status: 404, headers: { 'Cache-Control': 'public, max-age=300' } });
  return new Response(obj.body, { headers: {
    'Content-Type': (obj.httpMetadata && obj.httpMetadata.contentType) || 'application/octet-stream',
    'Cache-Control': 'public, max-age=86400',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'",
  } });
}

/* Delete public posts/comments older than `days` and purge their media. Shared by
   the cron (only when auto-prune is enabled) and the admin "prune now" button. */
async function runWallPrune(env, days) {
  const cutoff = Math.floor(Date.now() / 1000) - Wall.clampPruneDays(days) * 86400;
  let deleted = 0;
  try {
    const pm = await env.DB.prepare('SELECT media_key FROM wall_posts WHERE created_at < ?1 AND media_key IS NOT NULL LIMIT 5000').bind(cutoff).all();
    const keys = (pm.results || []).map((r) => r.media_key);
    const cm = await env.DB.prepare('SELECT media_key FROM wall_comments WHERE media_key IS NOT NULL AND (created_at < ?1 OR post_id IN (SELECT id FROM wall_posts WHERE created_at < ?1)) LIMIT 5000').bind(cutoff).all();
    (cm.results || []).forEach((r) => keys.push(r.media_key));
    if (keys.length) await purgeWallMedia(env, keys);
    await env.DB.prepare('DELETE FROM wall_comments WHERE created_at < ?1 OR post_id IN (SELECT id FROM wall_posts WHERE created_at < ?1)').bind(cutoff).run();
    const del = await env.DB.prepare('DELETE FROM wall_posts WHERE created_at < ?1').bind(cutoff).run();
    deleted = (del.meta && del.meta.changes) || 0;
  } catch (e) { console.log(JSON.stringify({ event: 'prune_wall_failed', error: String(e) })); }
  return deleted;
}

/* Cron entry (monthly chain): prune only when the admin turned it on. */
async function pruneWallPosts(env) {
  const s = await getAppSettings(env);
  if (s.wall_prune_enabled !== '1') return;
  await runWallPrune(env, Number(s.wall_prune_days) || 365);
}

/* Admin "prune now" — runs regardless of the enabled flag, using the configured
   (or a passed) retention. */
async function handleWallPrune(request, env) {
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  if (!(await requireAdmin(env, String(data.key || '')))) return json({ ok: false, error: 'No.' }, 403);
  const s = await getAppSettings(env);
  const deleted = await runWallPrune(env, Number(data.days) || Number(s.wall_prune_days) || 365);
  return json({ ok: true, deleted }, 200);
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
    't.title AS topic_title, pr.nick AS actor_nick, ' +
    "CASE WHEN n.kind = 'wall' THEN substr(wp.body, 1, 140) ELSE substr(c.body, 1, 140) END AS snippet " +
    'FROM notifications n ' +
    "LEFT JOIN comments t ON t.id = n.topic_id AND n.kind != 'wall' " +
    "LEFT JOIN comments c ON c.id = n.comment_id AND n.kind != 'wall' " +
    "LEFT JOIN wall_posts wp ON wp.id = n.comment_id AND n.kind = 'wall' " +
    'LEFT JOIN profiles pr ON pr.hash = n.actor_hash ' +
    'WHERE n.recipient_hash = ?1 ORDER BY n.id DESC LIMIT ?2 OFFSET ?3'
  ).bind(me, NOTIF_PER_PAGE, (p - 1) * NOTIF_PER_PAGE).all();
  const totals = await env.DB.prepare(
    'SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN read_at IS NULL THEN 1 ELSE 0 END), 0) AS unread ' +
    'FROM notifications WHERE recipient_hash = ?1'
  ).bind(me).first();
  const items = (rows.results || []).map((r) => Object.assign({}, r,
    { actor_assigned: r.actor_hash ? displayName(r.actor_hash) : null }));
  return json({ ok: true, items, total: totals.n || 0,
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
  /* A keyed board visit registers the member too (see the ask-side note). */
  await env.DB.prepare('INSERT OR IGNORE INTO profiles (hash, created_at) VALUES (?1, ?2)')
    .bind(me, Math.floor(Date.now() / 1000)).run();
  let floor = await boardFloor(env, me);
  if (floor === null) {
    floor = Math.floor(Date.now() / 1000);
    try { await env.DB.prepare('INSERT OR IGNORE INTO thread_reads (hash, topic_id, read_at) VALUES (?1, 0, ?2)').bind(me, floor).run(); } catch (e) {}
  }
  const adm = await isAdminHash(env, me);
  const rows = await env.DB.prepare(
    'SELECT c.page AS page, COUNT(*) AS n FROM comments c ' +
    'LEFT JOIN thread_reads tr ON tr.hash = ?1 AND tr.topic_id = c.id ' +
    "WHERE c.parent_id IS NULL AND c.status = 'live' AND c.page LIKE 'board:%' " +
    (adm ? '' : "AND c.page != 'board:adminsonly' ") +
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
  if (catPage === ADMIN_CAT && !(await isAdminHash(env, me))) return json({ ok: true, unread: [] }, 200);
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
      /* Reclaim any R2 media the purged messages carried (D1 can't cascade to R2). */
      const media = await env.DB.prepare('SELECT media_key FROM dms WHERE thread_id = ?1 AND media_key IS NOT NULL').bind(thread.id).all();
      await purgeMediaKeys(env, (media.results || []).map((r) => r.media_key).filter(Boolean));
      await env.DB.prepare('DELETE FROM dms WHERE thread_id = ?1').bind(thread.id).run();
      await env.DB.prepare('DELETE FROM dm_threads WHERE id = ?1').bind(thread.id).run();
      purged = true;
    }
  }
  return json({ ok: true, purged }, 200);
}

/* The autocomplete corpus: every hash that has ever appeared publicly, with
   its nick when one is set and its server-resolved `assigned` pseudonym (the web
   client derives the same value from the hash; native clients read it here).
   Public-by-construction data, cacheable. */
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
  const users = (rows.results || []).map((r) => Object.assign({}, r,
    { assigned: r.hash ? displayName(r.hash) : null }));
  return json({ ok: true, users }, 200, cacheHeader(url));
}

/* Publish this member's X25519 public key for the end-to-end-encrypted inbox.
   The client derives its keypair deterministically from the secret behind its
   identity hash and sends only the PUBLIC half; the server stores it so a
   correspondent can encrypt to it. Keyed (proves ownership of the hash), and
   idempotent — keygen is deterministic, so re-publishing the same key is a
   no-op, and only the key's owner can ever change the row. The server never sees
   or can derive the private key from the hash it holds. */
async function handleDmPubkey(request, env) {
  let data;
  try {
    data = await request.json();
  } catch {
    return json({ ok: false, error: 'Bad request.' }, 400);
  }
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.POST_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests. Slow down.' }, 429);
  const key = String(data.key || '');
  const pubkey = String(data.pubkey || '');
  if (!key) return json({ ok: false, error: 'Bad request.' }, 400);
  /* 32 raw bytes as unpadded base64url is exactly 43 chars over [A-Za-z0-9_-]. */
  if (!/^[A-Za-z0-9_-]{43}$/.test(pubkey)) return json({ ok: false, error: 'Bad request.' }, 400);
  const me = await sha256hex(key);
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    'INSERT INTO dm_pubkeys (hash, pubkey, created_at, updated_at) VALUES (?1, ?2, ?3, ?3) ' +
    'ON CONFLICT(hash) DO UPDATE SET pubkey = ?2, updated_at = ?3'
  ).bind(me, pubkey, now).run();
  return json({ ok: true }, 200);
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
/* Admin defense: edit or clean ANY member's profile in place — the middle
   ground between doing nothing and lock/ban/delete, for removing something
   at once while sparing the member. Admin-keyed like /moderate (no Turnstile,
   no AI screen: the admin IS the moderator), the same field limits and the
   librarian's reserved-name guard, empty fields clearing their columns, and
   clear_avatar removing both the R2 object and the column. Only admins pass;
   a regular key is refused before anything is read. */
async function handleProfileAdminEdit(request, env) {
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.READ_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests.' }, 429);
  const key = String(data.key || '');
  const target = String(data.hash || '');
  if (!key || !/^[0-9a-f]{64}$/.test(target)) return json({ ok: false, error: 'Bad request.' }, 400);
  if (!(await isAdminHash(env, await sha256hex(key)))) return json({ ok: false, error: 'No.' }, 403);
  if (target === MERECAT_BOT.hash) return json({ ok: false, error: 'The librarian keeps its own desk.' }, 400);
  const nick = cleanField(data.nick, MAX_NICK);
  const bio = cleanField(data.bio, MAX_BIO);
  const signature = cleanField(data.signature, MAX_SIG);
  if (nick.error || bio.error || signature.error) {
    return json({ ok: false, error: 'That profile is too long or has stray characters.' }, 400);
  }
  if (/merecat/i.test(String(nick.value || '').replace(/\s+/g, ''))) {
    return json({ ok: false, error: 'That name belongs to the librarian. Pick another.' }, 400);
  }
  const now = Math.floor(Date.now() / 1000);
  const res = await env.DB.prepare(
    'UPDATE profiles SET nick = ?2, bio = ?3, signature = ?4, updated_at = ?5 WHERE hash = ?1'
  ).bind(target, nick.value, bio.value, signature.value, now).run();
  if (!res.meta || !res.meta.changes) return json({ ok: false, error: 'No such member.' }, 404);
  if (data.clear_avatar) {
    if (env.AVATARS) await env.AVATARS.delete('avatars/' + target);
    await env.DB.prepare('UPDATE profiles SET avatar = NULL WHERE hash = ?1').bind(target).run();
  }
  // a visible line in the tail, since moderation leaves no other trace
  console.log(JSON.stringify({ event: 'admin_profile_edit', target, cleared_avatar: !!data.clear_avatar }));
  return json({ ok: true }, 200);
}

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
  if (!(await verifyTurnstile(env, String(form.get('token') || ''), ip, String(form.get('key') || '')))) {
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
    /* 'dm' notifications carry no comment (comment_id 0) and must be spared this
       orphan sweep, which only clears reply/mention rows whose post is gone. */
    const r = await env.DB.prepare(
      "DELETE FROM notifications WHERE kind IN ('reply','mention') AND comment_id NOT IN (SELECT id FROM comments)"
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
  const target = await env.DB.prepare("SELECT page FROM comments WHERE id = ?1 AND status = 'live'").bind(id).first();
  /* A live back-room post answers exactly as a nonexistent id does, so a keyed
     prober cannot detect which ids are back-room posts. */
  if (!target || target.page === ADMIN_CAT) return json({ ok: false, error: 'No such post.' }, 404);
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
async function handleApprove(request, env, ctx) {
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
  /* Live push (Phase 1b): a held post, once approved, enters the stream — the
     one place besides handlePost where a post becomes live. Same events, so the
     forum views merge it exactly as a fresh post. Back room stays silent
     (broadcastBoard gates it). */
  if (row) {
    broadcastBoard(env, ctx, row.page, async () => {
      const c = await env.DB.prepare(
        'SELECT c.id, c.page, c.parent_id, c.title, c.author_hash, pr.nick, pr.signature, pr.avatar, pr.faith, ' +
        'c.body, c.created_at FROM comments c LEFT JOIN profiles pr ON pr.hash = c.author_hash WHERE c.id = ?1'
      ).bind(id).first();
      if (!c) return [];
      const catKey = c.page.slice(6);
      const topicId = c.parent_id || c.id;
      if (c.parent_id == null) {
        const t = await env.DB.prepare('SELECT replies, COALESCE(last_at, created_at) AS last FROM comments WHERE id = ?1').bind(c.id).first();
        return [{ v: 1, t: 'new-topic', scopes: ['cat:' + catKey, 'board:index'], cat: catKey,
          topic: { id: c.id, title: c.title, author_hash: c.author_hash, nick: c.nick || null,
            created_at: c.created_at, locked: 0, sticky: 0, replies: (t && t.replies) || 0,
            last: (t && t.last) || c.created_at, last_id: c.id } }];
      }
      const t = await env.DB.prepare('SELECT replies, title, COALESCE(last_at, created_at) AS last FROM comments WHERE id = ?1').bind(topicId).first();
      return [
        { v: 1, t: 'new-reply', scopes: ['topic:' + topicId], topic_id: topicId,
          comment: { id: c.id, author_hash: c.author_hash, nick: c.nick || null, signature: c.signature || null,
            avatar: c.avatar || null, faith: c.faith || null, body: c.body, created_at: c.created_at } },
        { v: 1, t: 'topic-stats', scopes: ['cat:' + catKey, 'board:index'], cat: catKey,
          topic_id: topicId, title: (t && t.title) || null, replies: (t && t.replies) || 0,
          last: (t && t.last) || c.created_at, last_id: c.id, author_hash: c.author_hash, nick: c.nick || null },
      ];
    });
  }
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
  topk: 10,           // chunks handed to the model (the 4-8-citation rule needs headroom)
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
  7: 'the Roman world', 8: 'the worldview shelf', 9: "the scholars' shelf",
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
/* A mention inside a quoted line is someone else's words: quoting a summons
   must not resummon (nor charge the quoter a question). Only unquoted text
   can call the librarian. */
function merecatMentioned(body) {
  const unquoted = String(body || '').split('\n')
    .filter((l) => !/^\s*>/.test(l)).join('\n');
  return MERECAT_MENTION_RE.test(unquoted);
}
const MERECAT_RV = 15;  // retrieval build: bump when retrieval logic changes

/* Config (persona, model, caps) lives in LIBDB so `make librarian` can change
   the bot's behavior with no redeploy. Cached per isolate for five minutes;
   a config push clears this isolate at once and the rest lag out the TTL. */
let merecatConfigCache = { at: 0, cfg: null };

async function merecatConfig(env) {
  if (merecatConfigCache.cfg && Date.now() - merecatConfigCache.at < 300000) {
    return merecatConfigCache.cfg;
  }
  const cfg = { ...MERECAT_DEFAULTS, persona: '', backend: 'cloudflare', failover: 0, mention_effort: 'high' };
  try {
    const { results } = await env.LIBDB.prepare('SELECT k, v FROM config').all();
    for (const r of results || []) {
      if (r.k === 'persona') cfg.persona = String(r.v);
      else if (r.k === 'model') cfg.model = String(r.v);
      else if (r.k === 'backend') cfg.backend = String(r.v) === 'local' ? 'local' : 'cloudflare';
      else if (r.k === 'failover') cfg.failover = Number(r.v) ? 1 : 0;
      else if (r.k === 'mention_effort') cfg.mention_effort = String(r.v);
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
   matches. Every token is double-quoted, so no FTS5 operator can ride in. The
   stopword set, the sub-2-char/dedup filter, and the quoting are single-sourced
   in Domain.Fts (a `SafeMatch`, injection-proof by construction). */
function merecatMatch(q) {
  return Fts.unSafeMatch(Fts.merecatMatch(String(q ?? '')));
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

/* Scripture-reference seats, the fifth retrieval leg. A chapter:verse written
   in the question ("Gen 3:15", "Isaias 53:5", "Tobias 4:16") fetches that very
   verse's chunk from every Bible on the shelf directly by anchor, because BM25
   ranks essays ABOUT a passage above the passage itself and the model then
   answers a rendering question from memory, wrongly. The 66-book KJV spellings
   are single-sourced from Domain.Scripture (the same table the client autolinks
   against), so they can no longer drift; only the Vulgate namings and the
   deuterocanon are worker-only additions layered on top. */
const MERECAT_BIBLE = (() => {
  const spec = [
    // The 66-book KJV core is single-sourced from Domain.Scripture (the same
    // table the client autolinks against), so the "must stay in step" hazard
    // cannot recur. Only the Vulgate namings and deuterocanon below are added.
    ...Scripture.bibleSpec.map((r) => [r.slug, r.spellings.join('|')]),
    // Vulgate namings and the deuterocanon, resolved to the canonical slug
    ['joshua', 'josue'], ['ezra', '1 esdras'], ['nehemiah', '2 esdras'],
    ['1-chronicles', '1 paralipomenon|i paralipomenon'],
    ['2-chronicles', '2 paralipomenon|ii paralipomenon'],
    ['song-of-solomon', 'canticle of canticles'], ['isaiah', 'isaias'],
    ['jeremiah', 'jeremias'], ['ezekiel', 'ezechiel'], ['hosea', 'osee'],
    ['jonah', 'jonas'], ['micah', 'micheas'], ['habakkuk', 'habacuc'],
    ['zephaniah', 'sophonias'], ['haggai', 'aggeus'], ['zechariah', 'zacharias'],
    ['malachi', 'malachias'], ['obadiah', 'abdias'],
    ['tobias', 'tobias|tobit|tob|tb'], ['judith', 'judith|jdt'],
    ['wisdom', 'wisdom|wisdom of solomon|wis|wisd'],
    ['ecclesiasticus', 'ecclesiasticus|sirach|sir|ecclus'],
    ['baruch', 'baruch|bar'],
    ['1-machabees', '1 machabees|1 maccabees|1 macc|1 mac|i machabees|i maccabees|first machabees'],
    ['2-machabees', '2 machabees|2 maccabees|2 macc|2 mac|ii machabees|ii maccabees|second machabees']
  ];
  const map = {}; const forms = [];
  for (const row of spec) for (let f of row[1].split('|')) {
    f = f.trim(); if (f) { map[f] = row[0]; forms.push(f); }
  }
  forms.sort((a, b) => b.length - a.length);
  const alt = forms.map((f) =>
    f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+')).join('|');
  return { map, re: new RegExp('\\b(' + alt + ')\\.?[ \\t]+(\\d{1,3}):(\\d{1,3})', 'gi') };
})();
/* The DR names its books in the Vulgate way and its 1-4 Kings are NOT the
   KJV's: canonical (KJV-side) slug -> the slug dr.json uses. Identity where
   the two agree. */
const MERECAT_KJV2DR = {
  'joshua': 'josue', '1-samuel': '1-kings', '2-samuel': '2-kings',
  '1-kings': '3-kings', '2-kings': '4-kings',
  '1-chronicles': '1-paralipomenon', '2-chronicles': '2-paralipomenon',
  'ezra': '1-esdras', 'nehemiah': '2-esdras',
  'song-of-solomon': 'canticle-of-canticles', 'isaiah': 'isaias',
  'jeremiah': 'jeremias', 'ezekiel': 'ezechiel', 'hosea': 'osee',
  'jonah': 'jonas', 'micah': 'micheas', 'habakkuk': 'habacuc',
  'zephaniah': 'sophonias', 'haggai': 'aggeus', 'zechariah': 'zacharias',
  'malachi': 'malachias', 'obadiah': 'abdias', 'revelation': 'apocalypse',
};

async function merecatVerseSeats(env, q, add) {
  const jobs = []; const seen = new Set();
  MERECAT_BIBLE.re.lastIndex = 0;
  let m;
  while ((m = MERECAT_BIBLE.re.exec(q)) && jobs.length < 4) {
    const slug = MERECAT_BIBLE.map[m[1].toLowerCase().replace(/\s+/g, ' ')];
    if (!slug) continue;
    const k = slug + '-' + m[2];
    if (seen.has(k)) continue;
    seen.add(k);
    jobs.push({ slug, ch: +m[2], v: +m[3] });
  }
  if (!jobs.length) return;
  for (const db of [env.LIBDB, env.LIBDB2, env.LIBDB3]) {
    if (!db) continue;
    for (const j of jobs) {
      for (const s of new Set([j.slug, MERECAT_KJV2DR[j.slug] || j.slug])) {
        try {
          const base = s + '-' + j.ch;
          const rows = await db.prepare(
            'SELECT c.cid, c.work_id, c.heading, c.anchor, c.text, w.title, w.url, w.tier ' +
            "FROM chunks c JOIN works w ON w.id = c.work_id WHERE w.kind LIKE 'bible%' " +
            'AND (c.anchor = ?1 OR c.anchor LIKE ?2) LIMIT 12'
          ).bind(base, base + '-%').all();
          // a chapter packs into a few chunks whose anchors carry their first
          // verse: per work, seat the pack whose start is greatest but <= v
          const byWork = new Map();
          for (const r of rows.results || []) {
            const t = /-(\d+)$/.exec(r.anchor.slice(base.length));
            const start = t ? +t[1] : 1;
            if (start > j.v) continue;
            const had = byWork.get(r.work_id);
            if (!had || start > had.start) byWork.set(r.work_id, { r, start });
          }
          for (const { r } of byWork.values()) add(r, false, true);
        } catch (err) {
          console.log(JSON.stringify({ event: 'merecat_verse_failed', error: String(err) }));
        }
      }
    }
  }
}

/* Converted shelf texts can carry residual HTML tags and entities; labels
   and prompt windows must read as plain text wherever they surface (the
   footer, the board, the model's own eyes) — including sources stored in
   old chats before the ingest-side scrub existed. */
function merecatScrub(t, keepNl) {
  let x = String(t || '').replace(/<\/?[a-zA-Z][^>]{0,300}?>/g, ' ')
    .replace(/&#x([0-9a-fA-F]{1,6});/g, (m, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch { return ' '; } })
    .replace(/&#(\d{1,7});/g, (m, n) => { try { return String.fromCodePoint(+n); } catch { return ' '; } })
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ');
  return (keepNl ? x.replace(/[ \t]{2,}/g, ' ') : x.replace(/\s+/g, ' ')).trim();
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
    // hydrate matches from whichever room holds them: vectorized works may
    // live in any database (the worldview core rides deep2)
    const byCid = {};
    const ph = semIds.map((_, i) => '?' + (i + 1)).join(',');
    for (const db of [env.LIBDB, env.LIBDB2, env.LIBDB3]) {
      if (!db) continue;
      try {
        const rows = await db.prepare(
          'SELECT c.cid, c.work_id, c.heading, c.anchor, c.text, w.title, w.url, w.tier ' +
          'FROM chunks c JOIN works w ON w.id = c.work_id WHERE c.cid IN (' + ph + ')'
        ).bind(...semIds).all();
        for (const r of rows.results || []) byCid[r.cid] = r;
      } catch (err) {
        console.log(JSON.stringify({ event: 'merecat_semfetch_failed', error: String(err) }));
      }
    }
    for (const cid of semIds) add(byCid[cid], true); // keep Vectorize's order
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
    const phr = merecatPhrases(q);
    // both rooms, same legs: a chunk carries its band wherever it lives, so
    // the ladder weights identically across databases, and the reranker
    // judges the merged pool blind to which shelf a page came from
    for (const db of [env.LIBDB, env.LIBDB2, env.LIBDB3]) {
      if (!db) continue;
      try {
        // bm25 is negative-better, so a bigger multiplier boosts a band. The
        // owner's ladder: site core, then the Scriptures with Newman just
        // beneath them, the named Fathers, the councils, the deep shelf,
        // and the Roman world at the very bottom of the totem.
        const weighted = await db.prepare(SEL +
          'ORDER BY bm25(chunks_fts) * (CASE w.tier WHEN 1 THEN 1.6 WHEN 2 THEN 1.45 WHEN 6 THEN 1.4 WHEN 3 THEN 1.35 WHEN 4 THEN 1.25 WHEN 9 THEN 1.3 WHEN 8 THEN 1.55 WHEN 7 THEN 0.9 ELSE 1.0 END) ' +
          'LIMIT 18').bind(match).all();
        for (const r of weighted.results || []) add(r, false);
        const raw = await db.prepare(SEL +
          'ORDER BY bm25(chunks_fts) LIMIT 12').bind(match).all();
        for (const r of raw.results || []) add(r, false);
        if (phr) {
          // a deep LIMIT: bm25 ranks heavy quoters of a phrase above the
          // text that says it once — the reranker and the guaranteed
          // phrase seats sort the pool out
          const hits = await db.prepare(SEL +
            'ORDER BY bm25(chunks_fts) LIMIT 20').bind(phr).all();
          for (const r of hits.results || []) add(r, false, true);
        }
      } catch (err) {
        console.log(JSON.stringify({ event: 'merecat_fts_failed', error: String(err) }));
      }
    }
  }

  // Verse-reference seats ride the phrase guarantee: the reader named the
  // very verse, so its own text must be in the pool before anyone judges.
  await merecatVerseSeats(env, q, add);

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
/* Retrieval + prompt build for the cloud model, shared by the ask's cloud
   tail and the proxy pump's mid-flight failover, so the two can never drift:
   persona, the thread's condensed summary when one exists, the numbered
   sources, the recent turns verbatim, the question. */
async function merecatPrompt(env, q, history, summary, cfg) {
  const chunks = await merecatRetrieve(env, q, cfg);
  const sources = chunks.map((c, i) => ({
    n: i + 1, title: merecatScrub(c.title), heading: merecatScrub(c.heading),
    url: !c.url ? '' : /^https?:\/\//.test(c.url) ? c.url : MERECAT_SITE + c.url + (c.anchor ? '#' + c.anchor : ''),
  }));
  let srcBlock = '';
  chunks.forEach((c, i) => {
    srcBlock += '[' + (i + 1) + '] (' + (MERECAT_TIER_LABEL[c.tier] || 'shelf') + ') ' + merecatScrub(c.title) +
      (c.heading ? ' — ' + merecatScrub(c.heading) : '') + '\n' + merecatScrub(c.text.slice(0, 2800), true) + '\n\n';
  });
  const sys = (cfg.persona || 'You are merecat, the librarian of merecatholicity.com. Answer from the sources given, citing each by its bracketed number, like [2].') +
    (summary ? '\n\nTHE CONVERSATION SO FAR, condensed (the newest turns follow verbatim):\n' + summary : '') +
    '\n\nSOURCES (cite by bracketed number, like [3] — write the digit; cite 2-4 distinct sources for an answer of 250-500 words and 4-8 for 500 words and beyond, spreading them across every source that genuinely informed the answer rather than leaning on one or two; these are the only citable sources this turn' +
    (srcBlock ? '' : '; none were retrieved, so say the shelf does not cover this directly and answer from general knowledge, labeled as such') +
    '):\n\n' + (srcBlock || '(none)') + '/no_think';
  const messages = [{ role: 'system', content: sys }];
  for (const h of history) messages.push(h);
  messages.push({ role: 'user', content: q });
  return { sources, messages };
}

/* Local backend: proxy the question to the owner's machine over Tailscale
   Funnel and relay its stream. The local server does retrieval + generation
   and returns one JSON line of sources, a blank line, then answer tokens. */
/* POST a question to the local bot over the Funnel with the shared key. Returns
   the streaming Response, or null on any failure (offline, refused, queue full)
   so the caller can fail over to the cloud when that is enabled. */
async function merecatLocalFetch(env, body, ctl) {
  const base = String(env.MERECAT_LOCAL_URL || '').replace(/\/$/, '');
  if (!base) return null;
  // serve.py sends headers at once (before its GPU wait), so a slow header is a
  // wedged machine, not a busy one — never let it park the worker: 15s and out.
  // The timer is cleared the moment headers land so the body may stream for
  // minutes. A caller needing a whole-call deadline passes its own controller.
  /* The Funnel leg rides Starlink, where a COLD path (relay TCP+TLS setup, a
     satellite handoff, a lost SYN) fails fast and transiently while the
     machine is perfectly up — so a QUICK failure retries, twice, with a
     breath between, the failed try itself having warmed the route. A SLOW
     failure never retries: 15s of header silence is a wedged machine (cut it
     loose — with failover on, that is the cloud's cue), an abort is never
     ours to retry, serve.py's own non-busy 503 is the engine speaking
     (failover now), and busy is the truth — a full queue, not a fault. A
     5xx from the relay itself (502/504, the road not the machine) retries
     like a quick fault. */
  const ownCtl = ctl || new AbortController();
  for (let attempt = 0; ; attempt++) {
    const t0 = Date.now();
    let retriable = false;
    const headerTimer = setTimeout(() => { try { ownCtl.abort(); } catch { /* raced */ } }, 15000);
    try {
      const r = await fetch(base + '/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Merecat-Key': env.MERECAT_LOCAL_KEY || '' },
        body: JSON.stringify(body),
        signal: ownCtl.signal,
      });
      clearTimeout(headerTimer);
      if (r.status === 503) {
        // full queue, not a dead machine — let the caller say so honestly
        let refuse = null;
        try { refuse = await r.json(); } catch { /* not JSON */ }
        if (refuse && refuse.busy) return { busy: true };
        return null;
      }
      if (r.ok && r.body) return r;
      retriable = r.status >= 500;
      console.log(JSON.stringify({ event: 'merecat_local_unreachable', status: r.status, attempt }));
    } catch (err) {
      clearTimeout(headerTimer);
      retriable = (Date.now() - t0) < 5000 && !(err && err.name === 'AbortError');
      console.log(JSON.stringify({ event: 'merecat_local_unreachable', error: String(err), attempt }));
    }
    if (!retriable || attempt >= 2) return null;
    await new Promise((res) => setTimeout(res, 400 + attempt * 500));
  }
}

/* Read a local answer fully — for @merecat mentions, which post a comment
   rather than stream to a browser. Skips any leading {queue} notices, reads
   the {sources} header, and returns { sources, answer } or null. */
async function merecatLocalRead(env, body) {
  // A whole-call deadline: a mention read runs inside waitUntil, where a hung
  // local stream would otherwise park until the runtime kills the invocation.
  const ctl = new AbortController();
  const resp = await merecatLocalFetch(env, body, ctl);
  if (!resp || resp.busy) return resp;   // null offline, {busy} full queue
  const deadline = setTimeout(() => { try { ctl.abort(); } catch { /* raced */ } }, 600000);
  let full = '';
  try {
    const reader = resp.body.getReader();
    const dec = new TextDecoder();
    for (;;) { const { done, value } = await reader.read(); if (done) break; full += dec.decode(value, { stream: true }); }
  } catch { clearTimeout(deadline); return null; }
  clearTimeout(deadline);
  let rest = full;
  let sources = [];
  for (;;) {
    const nl = rest.indexOf('\n\n');
    if (nl === -1) break;
    let head; try { head = JSON.parse(rest.slice(0, nl)); } catch { break; }
    rest = rest.slice(nl + 2);
    if (head && head.sources) { sources = head.sources; break; }
    // else a {queue} notice — skip and keep reading
  }
  rest = rest.replace(/\u0002/g, '');
  const mark = rest.indexOf('\u0003');
  if (mark !== -1) rest = rest.slice(0, mark);
  return { sources, answer: rest.trim() };
}

async function handleMerecatStore(request, env) {
  /* Retired: the ChatRoom Durable Object is the sole D1 writer now (the WS
     path calls serve.py without chat/msg, so serve.py never calls back
     here). Kept as a no-op so any in-flight callback from a pre-cutover
     request 200s instead of erroring; removable in a later deploy. */
  return json({ ok: true });
}

/* ---- Admin observation of merecat Q&A (2026-07-29). The terms disclose that
   questions may be reviewed for the improvement of the service; these two
   admin-keyed, READ-ONLY endpoints let an admin observe how members use the
   librarian (to guide what to teach it next) WITHOUT participating. They only
   ever SELECT — no prune, no write, nothing touched. This deliberately adds
   the admin-read path the design once withheld, now that the terms allow it. */
async function handleMerecatAdminThreads(request, env) {
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.READ_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests. Slow down.' }, 429);
  if (!(await requireAdmin(env, String(data.key || '')))) return json({ ok: false, error: 'No.' }, 403);
  const per = 30;
  const pg = Math.min(1000, Math.max(1, Math.floor(Number(data.p) || 1)));
  /* A rolling thirty-day window, matching the thread expiry: this is a bird's
     eye view of recent use, not a keep. A saved thread is exempt from expiry
     (it lives on in its owner's list), but past thirty days it drops OFF this
     admin view all the same — the owner's word. A deleted thread is gone from
     chats outright, so it never appears here either. */
  const cut = Math.floor(Date.now() / 1000) - MERECAT_CHAT_DAYS * 86400;
  const total = await env.LIBDB.prepare('SELECT COUNT(*) AS n FROM chats WHERE last_at >= ?1').bind(cut).first();
  const rows = await env.LIBDB.prepare(
    'SELECT id, hash, title, COALESCE(msgs, 0) AS msgs, created_at, last_at, COALESCE(saved, 0) AS saved ' +
    'FROM chats WHERE last_at >= ?1 ORDER BY last_at DESC LIMIT ?2 OFFSET ?3'
  ).bind(cut, per, (pg - 1) * per).all();
  const threads = rows.results || [];
  /* Nicks live in the comments DB, not LIBDB — resolve them in one batch. */
  const hashes = [...new Set(threads.map((t) => t.hash).filter(Boolean))];
  const nicks = {};
  if (hashes.length) {
    const ph = hashes.map((_, i) => '?' + (i + 1)).join(',');
    const prof = await env.DB.prepare('SELECT hash, nick FROM profiles WHERE hash IN (' + ph + ')').bind(...hashes).all();
    for (const r of (prof.results || [])) nicks[r.hash] = r.nick;
  }
  for (const t of threads) t.nick = nicks[t.hash] || null;
  return json({ ok: true, threads, total: (total && total.n) || 0, page: pg, per }, 200);
}

async function handleMerecatAdminThread(request, env) {
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.READ_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests. Slow down.' }, 429);
  if (!(await requireAdmin(env, String(data.key || '')))) return json({ ok: false, error: 'No.' }, 403);
  const id = Number(data.id);
  if (!Number.isInteger(id) || id < 1) return json({ ok: false, error: 'Bad request.' }, 400);
  const cut = Math.floor(Date.now() / 1000) - MERECAT_CHAT_DAYS * 86400;
  const chat = await env.LIBDB.prepare(
    'SELECT id, hash, title, COALESCE(msgs, 0) AS msgs, created_at, last_at, COALESCE(saved, 0) AS saved FROM chats WHERE id = ?1 AND last_at >= ?2'
  ).bind(id, cut).first();
  if (!chat) return json({ ok: false, error: 'No such conversation.' }, 404);
  const msgs = await env.LIBDB.prepare(
    'SELECT id, role, body, sources, created_at, COALESCE(done, 1) AS done FROM chat_msgs WHERE chat_id = ?1 ORDER BY id LIMIT 400'
  ).bind(id).all();
  const prof = await env.DB.prepare('SELECT nick FROM profiles WHERE hash = ?1').bind(chat.hash).first();
  chat.nick = (prof && prof.nick) || null;
  return json({ ok: true, chat, msgs: msgs.results || [] }, 200);
}

/* Backend status for the admin page: is the local librarian reachable right
   now, and where does the cloud stand against its daily budget. Admin only.
   The probe is PATIENT: a cold Funnel path over Starlink can need seconds of
   relay TLS setup, and the old 450ms×3 read a healthy machine as offline
   until a refresh rode the warmed route. Escalating tries — each failure
   warms the way for the next — and the answer carries what /health knows:
   readiness, the reranker canary, and the measured round trip. */
async function handleMerecatBackends(request, env) {
  let data = {};
  try { data = await request.json(); } catch { return json({ ok: false, error: 'No.' }, 403); }
  if (!(await requireAdmin(env, String(data.key || '')))) return json({ ok: false, error: 'No.' }, 403);
  const cfg = await merecatConfig(env);
  const day = merecatDay();
  const g = await env.LIBDB.prepare('SELECT q FROM usage WHERE day = ?1').bind(day).first();
  const today = (g && g.q) || 0;
  let local = { online: false };
  const base = String(env.MERECAT_LOCAL_URL || '').replace(/\/$/, '');
  if (base) {
    const budgets = [1500, 3000, 5000];
    for (let i = 0; i < budgets.length && !local.online; i++) {
      const t0 = Date.now();
      try {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), budgets[i]);
        const r = await fetch(base + '/health', { signal: ctl.signal });
        clearTimeout(timer);
        if (r.ok) {
          const h = await r.json();
          local = { online: true, ms: Date.now() - t0, tries: i + 1,
            chunks: h.chunks || 0, model: h.model || '',
            ready: h.ready !== false, why: h.why || '',
            rerank: typeof h.rerank === 'string' ? h.rerank : '' };
        }
      } catch { /* cold or cut: escalate and try again */ }
    }
  }
  return json({ ok: true, backend: cfg.backend, failover: cfg.failover, mention_effort: cfg.mention_effort,
    configured: !!base, local, cloudflare: { online: true, today, gcap: cfg.global_daily } }, 200);
}

/* Drain the model's SSE stream into the client stream: preamble first (the
   thread id and the sources), then deltas with think spans stripped. When
   the stream ends: bump the usage counters, store the answer on the thread,
   and fold aged turns into the thread's condensed summary. */
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
      'SELECT id, role, body FROM chat_msgs WHERE chat_id = ?1 AND COALESCE(done, 1) = 1 ORDER BY id').bind(chatId).all();
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
  // saved threads are kept permanently: the expiry sweeps pass them by
  await env.LIBDB.batch([
    env.LIBDB.prepare(
      'DELETE FROM chat_msgs WHERE chat_id IN (SELECT id FROM chats WHERE hash = ?1 AND last_at < ?2 AND COALESCE(saved, 0) = 0)'
    ).bind(me, cut),
    env.LIBDB.prepare('DELETE FROM chats WHERE hash = ?1 AND last_at < ?2 AND COALESCE(saved, 0) = 0').bind(me, cut),
  ]);
  const rows = await env.LIBDB.prepare(
    'SELECT id, title, msgs, last_at, COALESCE(saved, 0) AS saved FROM chats WHERE hash = ?1 ORDER BY last_at DESC LIMIT 50'
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
    'SELECT id, role, body, sources, created_at, COALESCE(done, 1) AS done FROM chat_msgs WHERE chat_id = ?1 ORDER BY id LIMIT 400'
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

/* Save (or unsave) a conversation: a saved thread is exempt from the
   thirty-day expiry — both the listing's opportunistic prune and the monthly
   cron pass it by — until its owner unsaves or deletes it. Unsaving a thread
   already past the cut lets the next sweep take it, which the client warns of. */
async function handleMerecatChatSave(request, env) {
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  const ip = request.headers.get('CF-Connecting-IP') || '';
  // READ_LIMIT, not POST_LIMIT: a save is a metadata toggle, and a burst of
  // save/unsave clicks is legitimate — the 5-writes-a-minute throttle once
  // 429'd a retried save that the first (response-lost) attempt had already
  // landed, which the client then swallowed in silence.
  const { success } = await env.READ_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests. Slow down.' }, 429);
  const key = String(data.key || '');
  const id = Number(data.id);
  if (!key || !Number.isInteger(id) || id < 1) return json({ ok: false, error: 'Bad request.' }, 400);
  const me = await sha256hex(key);
  const gate = await blockedReason(env, me, ip);
  if (gate) return blockedJson(gate);
  const save = data.save ? 1 : 0;
  const own = await env.LIBDB.prepare('SELECT id FROM chats WHERE id = ?1 AND hash = ?2')
    .bind(id, me).first();
  if (!own) return json({ ok: false, error: 'No such conversation.' }, 404);
  await env.LIBDB.prepare('UPDATE chats SET saved = ?2 WHERE id = ?1').bind(id, save).run();
  return json({ ok: true, id, saved: save }, 200);
}

/* Monthly sweep of expired threads (the opportunistic per-owner prune in
   handleMerecatChats covers everyone who returns; this catches the rest).
   Self-contained like every prune, so a failure never stops the backup. */
async function pruneMerecatChats(env) {
  try {
    const cut = Math.floor(Date.now() / 1000) - MERECAT_CHAT_DAYS * 86400;
    await env.LIBDB.batch([
      env.LIBDB.prepare(
        'DELETE FROM chat_msgs WHERE chat_id IN (SELECT id FROM chats WHERE last_at < ?1 AND COALESCE(saved, 0) = 0)').bind(cut),
      env.LIBDB.prepare('DELETE FROM chats WHERE last_at < ?1 AND COALESCE(saved, 0) = 0').bind(cut),
      /* a done=0 partial older than a day is a generation that died forever
         (normal completion sweeps its strays; every live generation ends
         inside minutes) — without this, a resumed thread would read it as
         "still writing" until the thread itself expires */
      env.LIBDB.prepare('DELETE FROM chat_msgs WHERE done = 0 AND created_at < ?1')
        .bind(Math.floor(Date.now() / 1000) - 86400),
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
  // which room: works.yml store: deep -> LIBDB2, deep2 -> LIBDB3, else room one
  const st = String(data.store || work.store || '');
  const LIB = (st === 'deep2' && env.LIBDB3) ? env.LIBDB3
    : (st === 'deep' && env.LIBDB2) ? env.LIBDB2 : env.LIBDB;

  if (mode === 'begin' || mode === 'delete') {
    /* Sweep BOTH rooms, not just the target: when a work's store flag flips
       rooms, the old room would otherwise keep a stale twin — same cids, so
       the first room searched shadows the fresh text out of the retrieval
       pool, and the /works union carries two hashes for one id, which makes
       ingest re-push the work on every run. Vectors are cleared over the
       union of both rooms' cids (only Tier-1 works ever have them). */
    const cidset = new Set();
    for (const db of [env.LIBDB, env.LIBDB2, env.LIBDB3]) {
      if (!db) continue;
      try {
        const olds = await db.prepare('SELECT cid FROM chunks WHERE work_id = ?1').bind(id).all();
        for (const r of olds.results || []) cidset.add(r.cid);
      } catch (err) {
        console.log(JSON.stringify({ event: 'merecat_clear_failed', error: String(err) }));
      }
    }
    const cids = [...cidset];
    // deleteByIds has a LOW per-call id cap (a 257-id call fails outright, a
    // 50-id call succeeds) — the old 1000-per-call batching made every sweep
    // of a real-sized work fail silently into this catch, which is how two
    // de-vectorized works kept their stale vectors (found 2026-07-28).
    for (let i = 0; i < cids.length; i += 50) {
      try { await env.MERECAT_INDEX.deleteByIds(cids.slice(i, i + 50)); }
      catch (err) { console.log(JSON.stringify({ event: 'merecat_vecdel_failed', error: String(err) })); }
      // breathe between batches: a multi-work prune once fired ~60 calls
      // back-to-back and the API rate-limited some sweeps into the catch
      if (i + 50 < cids.length) await new Promise((res) => setTimeout(res, 250));
    }
    for (const db of [env.LIBDB, env.LIBDB2, env.LIBDB3]) {
      if (!db) continue;
      try {
        if (db === LIB && mode !== 'delete') {
          // the target room keeps its works row for the upsert below
          await db.prepare('DELETE FROM chunks WHERE work_id = ?1').bind(id).run();
        } else {
          await db.batch([
            db.prepare('DELETE FROM chunks WHERE work_id = ?1').bind(id),
            db.prepare('DELETE FROM works WHERE id = ?1').bind(id),
          ]);
        }
      } catch (err) {
        console.log(JSON.stringify({ event: 'merecat_sweep_failed', error: String(err) }));
      }
    }
    if (mode === 'delete') return json({ ok: true, deleted: id }, 200);
    await LIB.prepare(
      'INSERT INTO works (id, title, url, tier, kind, hash, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6) ' +
      'ON CONFLICT(id) DO UPDATE SET title = ?2, url = ?3, tier = ?4, kind = ?5, hash = NULL, updated_at = ?6'
    ).bind(id, String(work.title || id), String(work.url || ''),
      Math.min(9, Math.max(1, Number(work.tier) || 3)), String(work.kind || ''),
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
      stmts.push(LIB.prepare(
        'INSERT OR REPLACE INTO chunks (cid, work_id, seq, heading, anchor, text) VALUES ' + values
      ).bind(...binds));
    }
    await LIB.batch(stmts);
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
    await LIB.prepare('UPDATE works SET hash = ?2, chunks = ?3, updated_at = ?4 WHERE id = ?1')
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
    'page (merecat-ai.html). I hold the faith of the Nicene Creed and the positions of ' +
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
    /* Live push: the bot's public reply (an @merecat answer or a forwarded one)
       appears for everyone watching the thread and the index at once, exactly as
       a member's reply does in handlePost. Routed through the one board sink so
       the back-room gate is central (publishBoardEvents no-ops for it). */
    try {
      const catKey = src.page.slice(6);
      const prof = await env.DB.prepare('SELECT nick, signature, avatar, faith FROM profiles WHERE hash = ?1').bind(MERECAT_BOT.hash).first();
      const nick = (prof && prof.nick) || null;
      const stat = await env.DB.prepare('SELECT replies, title FROM comments WHERE id = ?1').bind(topicId).first();
      await publishBoardEvents(env, src.page, [
        { v: 1, t: 'new-reply', scopes: ['topic:' + topicId], topic_id: topicId,
          comment: { id: ins.id, author_hash: MERECAT_BOT.hash, nick,
            signature: (prof && prof.signature) || null, avatar: (prof && prof.avatar) || null,
            faith: (prof && prof.faith) || null, body, created_at: now } },
        { v: 1, t: 'topic-stats', scopes: ['cat:' + catKey, 'board:index'], cat: catKey,
          topic_id: topicId, title: (stat && stat.title) || null, replies: (stat && stat.replies) || 0,
          last: now, last_id: ins.id, author_hash: MERECAT_BOT.hash, nick },
      ]);
    } catch (e) { console.log(JSON.stringify({ event: 'merecat_publish_failed', error: String(e) })); }
  }
  return ins.id;
}

/* Finish an answer for public posting: renumber the body's [n] markers and
   the cited-only footer to a clean 1..k in order of first appearance, with
   footer labels bracket-sanitized (a heading like "[The Contemporary
   Review]" nested in [text](url) breaks the markdown link and prints raw).
   Shared by @merecat thread replies and forwarded chat answers. */
function merecatFinishAnswer(answer, sources) {
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
    const label = (s) => merecatScrub(s.title + (s.heading ? ' — ' + s.heading : ''))
      .replace(/\[/g, '(').replace(/\]/g, ')');
    answer += '\n\nSources:\n' + cited.map((s) =>
      '[' + renum.get(s.n) + '] ' + (s.url ? '[' + label(s) + '](' + s.url + ')' : label(s))).join('\n');
  }
  return answer;
}

async function merecatMentionReply(env, commentId) {
  const c = await env.DB.prepare(
    "SELECT id, page, parent_id, title, author_hash, body FROM comments WHERE id = ?1 AND status = 'live'"
  ).bind(commentId).first();
  if (!c || !c.author_hash || c.author_hash === MERECAT_BOT.hash) return null;
  if (!merecatMentioned(c.body)) return null;
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
    MERECAT_SITE + 'merecat-ai.html) to see the renewal time on your own clock.';
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
  const userMsg = asked || 'Please weigh in on this thread.';
  /* The thread/page brief, shared by both backends so the answer sees the same
     context either way: where the mention lives, the recent conversation, and
     the reply instructions. */
  const frame = 'You were mentioned by name inside ' + where + '. The recent conversation, oldest first:\n\n' +
    (talkBlock || '(the thread starts with the comment below)') +
    '\n\nThe member ' + nameOf(c.author_hash) + ' has asked you directly, in the comment you are replying to. ' +
    'Write the single comment you will post in reply: answer what was asked, cite sources by their bracketed ' +
    'numbers like [2], stay under 250 words, no greeting and no signature.';

  /* Mention reasoning is an admin setting (default high). 'instant' routes a
     mention to the cloud even when local is the backend; otherwise local does
     the retrieval and generation at the chosen depth, and failover (if on)
     drops to the cloud when local is down. */
  const mentionEffort = cfg.mention_effort || 'high';
  let answer = '';
  let sources = [];
  if (cfg.backend === 'local' && env.MERECAT_LOCAL_URL && mentionEffort !== 'instant') {
    const loc = await merecatLocalRead(env, { q: userMsg, context: frame, effort: mentionEffort });
    if (loc && loc.answer) { answer = loc.answer; sources = loc.sources; }
    else if (!cfg.failover) {
      return await merecatInsertComment(env, c, isBoard, topicId, topicAuthorHash,
        loc && loc.busy
          ? 'merecat is answering others right now. Mention me again in a few minutes.'
          : 'merecat is resting (the local librarian is offline). Mention me again shortly.');
    }
    // else failover on: fall through to the cloud below
  }
  if (!answer) {
    const retrievalQ = ((topicTitle ? topicTitle + ' ' : '') + (c.title && c.title !== topicTitle ? c.title + ' ' : '') + asked)
      .slice(0, 2000) || 'this site';
    const chunks = await merecatRetrieve(env, retrievalQ, cfg);
    sources = chunks.map((cc, i) => ({
      n: i + 1, title: merecatScrub(cc.title), heading: merecatScrub(cc.heading),
      url: !cc.url ? '' : /^https?:\/\//.test(cc.url) ? cc.url : MERECAT_SITE + cc.url + (cc.anchor ? '#' + cc.anchor : ''),
    }));
    let srcBlock = '';
    chunks.forEach((cc, i) => {
      srcBlock += '[' + (i + 1) + '] (' + (MERECAT_TIER_LABEL[cc.tier] || 'shelf') + ') ' + merecatScrub(cc.title) +
        (cc.heading ? ' — ' + merecatScrub(cc.heading) : '') + '\n' + merecatScrub(cc.text.slice(0, 2800), true) + '\n\n';
    });
    const sys = (cfg.persona || 'You are merecat, the librarian of merecatholicity.com.') +
      '\n\n' + frame +
      '\n\nSOURCES (cite by bracketed number, like [3] — write the digit; cite 2-4 distinct sources for an answer of 250-500 words and 4-8 for 500 words and beyond, spreading them across every source that genuinely informed the answer rather than leaning on one or two; these are the only citable sources' +
      (srcBlock ? '' : '; none were retrieved, so say the shelf does not cover this directly and answer from general knowledge, labeled as such') +
      '):\n\n' + (srcBlock || '(none)') + '/no_think';
    const messages = [
      { role: 'system', content: sys },
      { role: 'user', content: userMsg },
    ];
    let res;
    try {
      res = await env.AI.run(cfg.model, { messages, max_tokens: 900, temperature: 0.35 });
    } catch (err) {
      console.log(JSON.stringify({ event: 'merecat_mention_ai_failed', error: String(err) }));
      return await merecatInsertComment(env, c, isBoard, topicId, topicAuthorHash,
        MERECAT_RESTING + ' Mention me again then.');
    }
    answer = res == null ? '' : (res.response != null ? String(res.response)
      : (res.choices && res.choices[0] && res.choices[0].message
        ? String(res.choices[0].message.content || '') : ''));
    answer = answer.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  }
  if (!answer) return null;
  answer = merecatFinishAnswer(answer, sources);
  const replyId = await merecatInsertComment(env, c, isBoard, topicId, topicAuthorHash, answer.slice(0, 12000));

  // Mentions are tallied against the caps only in strict Cloudflare mode.
  if (cfg.backend === 'cloudflare') {
    const inTok = Math.ceil((frame.length + userMsg.length) / 4);
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
  }
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

/* Forward one private answer to a public topic, by the thread's owner and
   nobody else. The post goes up under the librarian's own name, marked as
   forwarded by the member, with the question quoted and the cited-sources
   footer rebuilt — bot words stay under the bot's name, and nothing private
   goes public except by the owner's hand. */
async function handleMerecatForward(request, env) {
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.POST_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests. Slow down.' }, 429);
  const key = String(data.key || '');
  const chatId = Number(data.chat);
  const topicId = Number(data.topic);
  if (!key || !Number.isInteger(chatId) || chatId < 1 || !Number.isInteger(topicId) || topicId < 1) {
    return json({ ok: false, error: 'Bad request.' }, 400);
  }
  const me = await sha256hex(key);
  const gate = await blockedReason(env, me, ip);
  if (gate) return blockedJson(gate);
  const own = await env.LIBDB.prepare('SELECT id FROM chats WHERE id = ?1 AND hash = ?2')
    .bind(chatId, me).first();
  if (!own) return json({ ok: false, error: 'No such conversation.' }, 404);
  const msg = data.msg === 'last'
    ? await env.LIBDB.prepare(
        "SELECT id, body, sources FROM chat_msgs WHERE chat_id = ?1 AND role = 'assistant' ORDER BY id DESC LIMIT 1"
      ).bind(chatId).first()
    : await env.LIBDB.prepare(
        "SELECT id, body, sources FROM chat_msgs WHERE id = ?1 AND chat_id = ?2 AND role = 'assistant'"
      ).bind(Number(data.msg), chatId).first();
  if (!msg) return json({ ok: false, error: 'No such answer in that conversation.' }, 404);
  const topic = await env.DB.prepare(
    "SELECT id, page, locked, author_hash FROM comments WHERE id = ?1 AND parent_id IS NULL AND status = 'live'"
  ).bind(topicId).first();
  if (!topic || !boardKey(topic.page)) return json({ ok: false, error: 'No such topic.' }, 404);
  if (topic.page === ADMIN_CAT && !(await isAdminHash(env, me))) {
    return json({ ok: false, error: 'That topic is for admins only.' }, 403);
  }
  if (topic.locked) return json({ ok: false, error: 'That topic is locked.' }, 403);

  const q = await env.LIBDB.prepare(
    "SELECT body FROM chat_msgs WHERE chat_id = ?1 AND role = 'user' AND id < ?2 ORDER BY id DESC LIMIT 1"
  ).bind(chatId, msg.id).first();
  const prof = await env.DB.prepare('SELECT nick FROM profiles WHERE hash = ?1').bind(me).first();
  const who = (prof && prof.nick) || 'a member';
  let srcs = [];
  try { srcs = JSON.parse(msg.sources || '[]'); } catch { /* footer just stays off */ }
  let finished = merecatFinishAnswer(String(msg.body || ''), srcs);
  const head = 'Forwarded from the librarian\u2019s desk by ' + who + '.' +
    (q && q.body ? '\n\n> ' + String(q.body).replace(/\s+/g, ' ').slice(0, 300) : '') + '\n\n';
  // fit the board's body cap, trimming the answer, never the footer
  const room = MAX_BODY - head.length;
  if (finished.length > room) {
    const cut = finished.lastIndexOf('\n\nSources:\n');
    if (cut !== -1 && cut < room - 40) {
      const footer = finished.slice(cut);
      finished = finished.slice(0, room - footer.length - 6).trimEnd() + ' [\u2026]' + footer;
    } else {
      finished = finished.slice(0, room - 6).trimEnd() + ' [\u2026]';
    }
  }
  const replyId = await merecatInsertComment(env, { page: topic.page, parent_id: null },
    true, topicId, topic.author_hash, head + finished);
  return json({ ok: true, id: replyId, topic: topicId }, 200);
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
    backend: cfg.backend,
  }, 200);
}

/* Full disclosure for the merecat page's "How merecat works" panel: the
   model id, the caps, the persona verbatim, the whole shelf with per-work
   chunk counts, today's community usage, and the asker's own count when a
   key rides along. Everything here is public site content or the reader's
   own number — no per-question data exists to disclose, since the server
   keeps counters only. */
async function handleMerecatAbout(request, env) {
  /* Admin-only since the public transparency panel retired (2026-07-28):
     this returns the persona verbatim and the whole roster, and the owner
     wills neither public. The administration page is the one consumer. */
  let data = {};
  try { data = await request.json(); } catch { return json({ ok: false, error: 'No.' }, 403); }
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.READ_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests. Slow down.' }, 429);
  if (!(await requireAdmin(env, String(data.key || '')))) return json({ ok: false, error: 'No.' }, 403);
  const cfg = await merecatConfig(env);
  const day = merecatDay();
  // per-work counts live on the works row (stamped at ingest end) so this
  // stays a 91-row read, not a scan of the whole chunk store
  const works = await env.LIBDB.prepare(
    'SELECT id, title, url, tier, chunks FROM works ORDER BY tier, title'
  ).all();
  // url-less works are the private shelves; the panel lists them under an
  // "additional works" heading with no links (the owner's standing word,
  // reversed 2026-07-28 from the earlier omission rule)
  const list = works.results || [];
  for (const db of [env.LIBDB2, env.LIBDB3]) {
    if (!db) continue;
    try {
      const deep = await db.prepare(
        'SELECT id, title, url, tier, chunks FROM works ORDER BY tier, title').all();
      for (const r of deep.results || []) list.push(r);
    } catch (err) {
      console.log(JSON.stringify({ event: 'merecat_about2_failed', error: String(err) }));
    }
  }
  const g = await env.LIBDB.prepare('SELECT q FROM usage WHERE day = ?1').bind(day).first();
  const out = {
    ok: true,
    model: cfg.model, topk: cfg.topk,
    user_daily: cfg.user_daily, user_cap_on: cfg.user_cap_on, global_daily: cfg.global_daily,
    backend: cfg.backend,
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
  const works = [];
  let tb1 = 0, tb2 = 0;
  const rows = await env.LIBDB.prepare(
    'SELECT id, title, tier, kind, hash, chunks FROM works ORDER BY tier, id').all();
  for (const r of rows.results || []) works.push(r);
  const t1 = await env.LIBDB.prepare(
    "SELECT SUM(LENGTH(text) + LENGTH(COALESCE(heading, ''))) AS b FROM chunks").first();
  tb1 = (t1 && t1.b) || 0;
  let tb3 = 0;
  for (const [db, tag] of [[env.LIBDB2, 2], [env.LIBDB3, 3]]) {
    if (!db) continue;
    try {
      const rows2 = await db.prepare(
        'SELECT id, title, tier, kind, hash, chunks FROM works ORDER BY tier, id').all();
      for (const r of rows2.results || []) works.push(r);
      const t2 = await db.prepare(
        "SELECT SUM(LENGTH(text) + LENGTH(COALESCE(heading, ''))) AS b FROM chunks").first();
      if (tag === 2) tb2 = (t2 && t2.b) || 0; else tb3 = (t2 && t2.b) || 0;
    } catch (err) {
      console.log(JSON.stringify({ event: 'merecat_works' + tag + '_failed', error: String(err) }));
    }
  }
  const pfh = await env.LIBDB.prepare(
    "SELECT v FROM config WHERE k = 'persona_file_hash'").first();
  return json({ ok: true, works, text_bytes: tb1, text_bytes_deep: tb2, text_bytes_deep2: tb3,
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
  for (const k of ['model', 'backend', 'failover', 'mention_effort', 'user_cap_on', 'user_daily', 'global_daily', 'topk', 'max_tokens', 'persona_file_hash']) {
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
  let deepN = 0;
  for (const db of [env.LIBDB2, env.LIBDB3]) {
    if (!db) continue;
    try {
      const d2 = await db.prepare('SELECT COUNT(*) AS n FROM chunks').first();
      deepN += (d2 && d2.n) || 0;
    } catch { /* the first room still reports */ }
  }
  const byDay = {};
  for (const r of users.results || []) byDay[r.day] = r.users;
  const days = (use.results || []).map((r) => ({ ...r, users: byDay[r.day] || 0 }));
  return json({ ok: true, days, chunks: ((total && total.n) || 0) + deepN }, 200);
}

/* ---- Live updates over WebSockets (Phase 1) ----
   The BoardHub is ONE global Durable Object (getByName('board')) that fans a
   fresh board post out to every browser watching the affected scope, over a
   hibernatable WebSocket. Connections are the only state: each socket's
   subscriptions live in its serializeAttachment (survives hibernation), so the
   object uses no ctx.storage and NO timers (either would block hibernation and
   start billing idle duration). The socket is READ-ONLY — it carries {t:'sub'}
   (and, for a member, {t:'auth'}) up and broadcast events down; every write
   stays on the authenticated, Turnstile-gated, rate-limited HTTP path. The back
   room never crosses the wire (sanitizeScopes refuses cat:adminsonly; the worker
   emits nothing for it). A member may authenticate to add a PRIVATE
   'user:<hash>' scope — kept only for the hash their key proves — over which the
   worker pushes that member's own DMs and notifications (nobody else's socket
   can hold that scope, so the private events reach their connections alone). */

/* A subscription scope is one of 'board:index', 'cat:<key>' (never the back
   room), 'topic:<positive int>', or the PRIVATE 'user:<hash>' — kept ONLY when
   the socket authenticated as that exact hash (`me`), so a member's DM and
   notification pushes reach their own connections alone. Anything else is
   dropped; at most 5 kept (one private + up to four forum scopes). */
function sanitizeScopes(raw, me) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const s of raw) {
    if (typeof s !== 'string' || out.length >= 5) continue;
    if (s === 'board:index') { out.push(s); continue; }
    if (s.startsWith('cat:')) {
      const k = s.slice(4);
      if (k !== 'adminsonly' && BOARD_CATS.includes(k)) out.push(s);
      continue;
    }
    if (/^topic:[1-9][0-9]*$/.test(s)) { out.push(s); continue; }
    if (s.startsWith('presence:')) {
      const h = s.slice(9);
      if (/^[0-9a-f]{64}$/.test(h)) out.push(s);   // anyone may watch anyone's online state
      continue;
    }
    if (s.startsWith('feed:global')) { out.push('feed:global'); continue; }   // the public feed's live channel
    if (s.startsWith('user:')) {
      const h = s.slice(5);
      if (me && h === me && /^[0-9a-f]{64}$/.test(h)) out.push(s);   // only your own
    }
  }
  return out;
}

export class BoardHub extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    /* The client's {t:'ping'} is answered {t:'pong'} by the runtime without
       waking the object, so a hibernating socket stays warm at zero cost. */
    this.ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair(JSON.stringify({ t: 'ping' }), JSON.stringify({ t: 'pong' })));
  }

  async fetch(request) {
    if ((request.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') {
      return new Response('expected websocket', { status: 426 });
    }
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server, ['v1']);   // hibernation-eligible; one static tag
    server.serializeAttachment({ subs: [], n: 0 });
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, msg) {
    let m;
    try { m = JSON.parse(typeof msg === 'string' ? msg : ''); } catch { return; }
    if (!m) return;   // a stray {t:'ping'} is handled by the auto-responder
    let a;
    try { a = ws.deserializeAttachment(); } catch { a = null; }
    /* A member authenticates so this socket may subscribe to its own private
       user:<hash> scope (DMs, notifications). The key rides the frame, never the
       URL; the hash is stored on the attachment and gates every later sub. The
       auth frame also carries the member's presence mode ("auto"/"off") so the
       DO can honour appear-offline without a DB read, and coming online (or
       going appear-offline) is broadcast to anyone watching this member. */
    if (m.t === 'auth') {
      const key = String(m.key || '');
      const me = key ? await sha256hex(key) : '';
      const presenceMode = Presence.normalizeMode(String(m.presence || 'auto'));
      ws.serializeAttachment({ subs: (a && a.subs) || [], n: (a && a.n) || 0, me, presenceMode });
      if (me) this.#broadcastPresence(me, this.#isOnline(me));
      return;
    }
    /* A transient typing signal (client → client, no storage): fan it to the
       recipient's own sockets only, tagged with the authenticated sender. */
    if (m.t === 'typing') {
      const me = (a && a.me) || '';
      const to = String(m.to || '');
      if (!me || !/^[0-9a-f]{64}$/.test(to)) return;
      this.#fan('user:' + to, JSON.stringify({ v: 1, t: 'typing', from: me, state: m.state === 'stop' ? 'stop' : 'start' }));
      return;
    }
    if (m.t !== 'sub') return;
    const me = (a && a.me) || '';
    const subs = sanitizeScopes(m.scope, me);
    const n = ((a && a.n) || 0) + 1;
    if (n > 500) { try { ws.close(1008, 'too many'); } catch { /* gone */ } return; }
    ws.serializeAttachment({ subs, n, me, presenceMode: (a && a.presenceMode) || 'auto' });
    /* Seed each newly-watched member's current presence to this socket. */
    for (const s of subs) {
      if (s.startsWith('presence:')) {
        const h = s.slice(9);
        try { ws.send(JSON.stringify({ v: 1, t: 'presence', hash: h, online: this.#isOnline(h) })); } catch { /* gone */ }
      }
    }
  }

  /* A socket dropped: if it was the member's last online connection, tell anyone
     watching that they went offline. (webSocketError has no such last-socket
     meaning; it just logs.) */
  webSocketClose(ws) {
    let a;
    try { a = ws.deserializeAttachment(); } catch { a = null; }
    const me = a && a.me;
    if (!me) return;
    if (!this.#isOnline(me, ws)) this.#broadcastPresence(me, false);
  }

  webSocketError(ws, err) {
    console.log(JSON.stringify({ event: 'hub_ws_error', error: String(err) }));
  }

  /* Is <hash> online? True iff some live socket authenticated as that hash with a
     non-"off" presence mode. `exclude` skips one socket (the one closing). */
  #isOnline(hash, exclude) {
    for (const s of this.ctx.getWebSockets()) {
      if (exclude && s === exclude) continue;
      let a;
      try { a = s.deserializeAttachment(); } catch { a = null; }
      if (a && a.me === hash && a.presenceMode !== 'off') return true;
    }
    return false;
  }

  /* Send a frame to every socket subscribed to `scope`. */
  #fan(scope, payload) {
    for (const s of this.ctx.getWebSockets()) {
      let a;
      try { a = s.deserializeAttachment(); } catch { a = null; }
      if (a && Array.isArray(a.subs) && a.subs.includes(scope)) {
        try { s.send(payload); } catch { /* dropped */ }
      }
    }
  }

  #broadcastPresence(hash, online) {
    this.#fan('presence:' + hash, JSON.stringify({ v: 1, t: 'presence', hash, online: !!online }));
  }

  /* RPC for the batched inbox check: of these hashes, which are online now
     (honouring appear-offline)? One request per inbox load. */
  async presenceOf(hashes) {
    const live = new Set();
    for (const s of this.ctx.getWebSockets()) {
      let a;
      try { a = s.deserializeAttachment(); } catch { a = null; }
      if (a && a.me && a.presenceMode !== 'off') live.add(a.me);
    }
    return (Array.isArray(hashes) ? hashes : []).filter((h) => live.has(h));
  }

  /* RPC, called by the worker on every live public board mutation. */
  async publish(event) {
    if (!event || !Array.isArray(event.scopes)) return;
    const payload = JSON.stringify(event);
    for (const ws of this.ctx.getWebSockets()) {
      let a;
      try { a = ws.deserializeAttachment(); } catch { a = null; }
      if (a && Array.isArray(a.subs) && a.subs.some((s) => event.scopes.includes(s))) {
        try { ws.send(payload); } catch { /* a dropped socket; the close handler cleans up */ }
      }
    }
  }
}

/* ---- merecat as a state machine (Phase 2): the ChatRoom Durable Object ----
   One instance per conversation (getByName('chat:'+id)). It OWNS the generation
   and is the single D1 writer for its thread, so the disconnect contract is
   structural: it keeps generating whether or not a reader is attached, persists
   the growing answer to chat_msgs (done=0 → done=1), and on (re)connect replays
   the current state + answer-so-far via a `hello` frame — which replaces the
   whole polling resume/reconcile/recover machinery. States: idle → queued →
   thinking → streaming → done | error. It drives the local box (serve.py via
   merecatLocalFetch, relayed by #relayLocal) with failover to the cloud model
   (env.AI) into the same stream, or the cloud model directly — whichever the
   live config names. Auth is the member's key in the auth frame (same trust as
   a POST body), never in the URL. Reuses merecatConfig/merecatPrompt/
   merecatThinkStripper/merecatFold verbatim. This is now the ONLY merecat
   generation path — the HTTP /ask streaming endpoint and its store callback
   were retired once this was proven live. */
export class ChatRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.phase = 'idle';
    this.chatId = 0;
    this.gen = null;   // in-flight: { userMsgId, answer, sources, used, startedAtMs, backend }
    this.ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair(JSON.stringify({ t: 'ping' }), JSON.stringify({ t: 'pong' })));
  }

  /* Broadcast a frame to the OWNER's sockets only. Every state/meta/tokens frame
     carries the in-flight answer, so it must never reach an unauthenticated (or
     someone-else's) socket — only #auth, which checks chats(id, hash=me), can set
     auth:true, so the authed set is exactly the owner's connections. The hello
     resume frame is sent per-socket from #auth, not here. */
  #emit(obj) {
    const s = JSON.stringify(obj);
    for (const ws of this.ctx.getWebSockets()) {
      let a; try { a = ws.deserializeAttachment(); } catch { a = null; }
      if (!a || a.auth !== true) continue;
      try { ws.send(s); } catch { /* dropped */ }
    }
  }

  async fetch(request) {
    if ((request.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') return new Response('expected websocket', { status: 426 });
    const cid = Number(new URL(request.url).searchParams.get('chat')) || 0;
    /* CF-Connecting-IP survives the forward from handleMerecatLive (stub.fetch
       forwards the request headers), so the WS ask can re-check IP bans — the
       HTTP path only checks them at ask-init. */
    const ip = request.headers.get('CF-Connecting-IP') || '';
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1], ['v1']);
    pair[1].serializeAttachment({ auth: false, chatId: cid, ip });
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async webSocketMessage(ws, msg) {
    let m;
    try { m = JSON.parse(typeof msg === 'string' ? msg : ''); } catch { return; }
    if (!m) return;
    if (m.t === 'auth') return this.#auth(ws, m);
    if (m.t === 'ask') return this.#ask(ws, m);
  }

  webSocketError(ws, err) { console.log(JSON.stringify({ event: 'chat_ws_error', error: String(err) })); }
  /* A closing reader does NOT stop the generation — that is the whole point. */

  #hello(ws) {
    const g = this.gen;
    ws.send(JSON.stringify({ t: 'hello', chatId: this.chatId, phase: this.phase,
      answer: (g && g.answer) || '', sources: (g && g.sources) || [], used: (g && g.used) || null,
      startedAtMs: (g && g.startedAtMs) || 0, backend: (g && g.backend) || 'cloudflare' }));
  }

  async #auth(ws, m) {
    const a = ws.deserializeAttachment() || {};
    const fail = (err) => { try { ws.send(JSON.stringify({ t: 'state', phase: 'error', error: err })); } catch { /* gone */ }
      try { ws.close(1008, 'unauthorized'); } catch { /* gone */ } };
    const key = String(m.key || '');
    if (!key) { fail('Missing key.'); return; }
    const me = await sha256hex(key);
    const cid = a.chatId || Number(m.chat) || 0;
    if (cid) {
      const own = await this.env.LIBDB.prepare('SELECT id FROM chats WHERE id = ?1 AND hash = ?2').bind(cid, me).first();
      if (!own) { fail('No such conversation.'); return; }
      this.chatId = cid;
    }
    const admin = await isAdminHash(this.env, me);
    ws.serializeAttachment({ auth: true, me, admin, chatId: cid, ip: a.ip || '' });
    this.#hello(ws);
  }

  async #ask(ws, m) {
    const a = ws.deserializeAttachment() || {};
    if (!a.auth) { ws.send('{"t":"state","phase":"error","error":"Authenticate first."}'); return; }
    if (this.phase === 'thinking' || this.phase === 'streaming' || this.phase === 'queued') {
      ws.send('{"t":"state","phase":"busy"}'); return;   // single-flight per conversation
    }
    const q = String(m.q || '').trim().slice(0, 2000);
    if (!q) return;
    const me = a.me;
    const admin = !!a.admin;
    const gate = await blockedReason(this.env, me, a.ip || '');
    if (gate) { ws.send('{"t":"state","phase":"error","error":"blocked"}'); return; }
    const cfg = await merecatConfig(this.env);
    const day = merecatDay();
    const capsApply = cfg.backend === 'cloudflare';
    let youQ = 0; let todayQ = 0;
    try {
      const g = await this.env.LIBDB.prepare('SELECT q FROM usage WHERE day = ?1').bind(day).first();
      todayQ = (g && g.q) || 0;
      if (capsApply && !admin && todayQ >= cfg.global_daily) {
        ws.send(JSON.stringify({ t: 'state', phase: 'error', resting: true, error: MERECAT_RESTING })); return;
      }
      const u = await this.env.LIBDB.prepare('SELECT q FROM user_usage WHERE day = ?1 AND hash = ?2').bind(day, me).first();
      youQ = (u && u.q) || 0;
      if (capsApply && !admin && cfg.user_cap_on && youQ >= cfg.user_daily) {
        ws.send(JSON.stringify({ t: 'state', phase: 'error', capped: true,
          error: 'You have used your ' + cfg.user_daily + ' questions for today. The counter resets at midnight UTC.' }));
        return;
      }
    } catch (err) { console.log(JSON.stringify({ event: 'chat_caps_failed', error: String(err) })); }

    /* Mint the thread + question row BEFORE generating (the thread must outlive a
       fragile stream). A fresh conversation gets its id here and rides the first
       frame back so the client adopts ?chat=<id> at once. */
    const now = Math.floor(Date.now() / 1000);
    let history = []; let summary = '';
    if (!this.chatId) {
      const ins = await this.env.LIBDB.prepare(
        'INSERT INTO chats (hash, title, created_at, last_at, msgs) VALUES (?1, ?2, ?3, ?3, 0) RETURNING id'
      ).bind(me, q.slice(0, 90), now).first();
      this.chatId = ins.id;
    } else {
      const own = await this.env.LIBDB.prepare('SELECT summary FROM chats WHERE id = ?1').bind(this.chatId).first();
      summary = String((own && own.summary) || '');
      const rows = await this.env.LIBDB.prepare(
        'SELECT role, body FROM chat_msgs WHERE chat_id = ?1 AND COALESCE(done, 1) = 1 ORDER BY id DESC LIMIT ' + MERECAT_WINDOW
      ).bind(this.chatId).all();
      history = (rows.results || []).reverse().map((r) => ({ role: r.role, content: String(r.body).slice(0, 1200) }));
    }
    const urs = await this.env.LIBDB.batch([
      this.env.LIBDB.prepare("INSERT INTO chat_msgs (chat_id, role, body, created_at) VALUES (?1, 'user', ?2, ?3) RETURNING id").bind(this.chatId, q, now),
      this.env.LIBDB.prepare('UPDATE chats SET last_at = ?2, msgs = msgs + 1 WHERE id = ?1').bind(this.chatId, now),
    ]);
    const userMsgId = (urs && urs[0] && urs[0].results && urs[0].results[0] && urs[0].results[0].id) || 0;

    const useLocal = cfg.backend === 'local' && this.env.MERECAT_LOCAL_URL && !m.instant;
    const backend0 = useLocal ? 'local' : 'cloudflare';
    const used = { you: youQ + 1, cap: cfg.user_daily, cap_on: cfg.user_cap_on,
      today: todayQ + 1, gcap: cfg.global_daily, admin, backend: backend0 };
    this.gen = { userMsgId, answer: '', sources: [], used, startedAtMs: Date.now(),
      backend: backend0, effort: String(m.effort || 'high'), instant: !!m.instant };
    this.phase = 'thinking';
    this.#emit({ t: 'state', phase: 'thinking', chatId: this.chatId, used });
    this.ctx.storage.setAlarm(Date.now() + 30000);   // keep-alive through silent gaps
    this.#generate(q, history, summary, cfg, me, day).catch((err) => {
      console.log(JSON.stringify({ event: 'chat_generate_failed', error: String(err) }));
      this.phase = 'error';
      this.#emit({ t: 'state', phase: 'error', resting: true, error: MERECAT_RESTING });
    });
  }

  async #generate(q, history, summary, cfg, me, day) {
    /* Shared token sink: batch to the socket (~60ms) and persist the growing
       answer to D1 (done=0) every few seconds. The DO is the SOLE writer — the
       local box is called WITHOUT chat/msg, so serve.py streams only and never
       /stores, which removes the old two-writer race entirely. */
    let batch = ''; let lastSend = 0; let lastPersist = 0;
    let sources = [];
    const sendBatch = () => { if (batch) { this.#emit({ t: 'tokens', d: batch }); batch = ''; lastSend = Date.now(); } };
    const persist = async () => {
      const body = this.gen.answer.trim();
      if (!body || !this.gen.userMsgId) return;
      lastPersist = Date.now();
      try {
        const row = await this.env.LIBDB.prepare("SELECT id FROM chat_msgs WHERE chat_id = ?1 AND role = 'assistant' AND answers = ?2 LIMIT 1").bind(this.chatId, this.gen.userMsgId).first();
        if (row) { await this.env.LIBDB.prepare('UPDATE chat_msgs SET body = ?2 WHERE id = ?1').bind(row.id, body).run(); }
        else {
          const t = Math.floor(Date.now() / 1000);
          await this.env.LIBDB.prepare("INSERT INTO chat_msgs (chat_id, role, body, sources, created_at, answers, done) VALUES (?1, 'assistant', ?2, ?3, ?4, ?5, 0)").bind(this.chatId, body, JSON.stringify(sources), t, this.gen.userMsgId).run();
          await this.env.LIBDB.prepare('UPDATE chats SET last_at = ?2, msgs = msgs + 1 WHERE id = ?1').bind(this.chatId, t).run();
        }
      } catch { /* a failed flush just waits for the next */ }
    };
    const onToken = async (vis) => {
      if (this.phase !== 'streaming') { this.phase = 'streaming'; this.#emit({ t: 'state', phase: 'streaming' }); }
      this.gen.answer += vis; batch += vis;
      if (Date.now() - lastSend > 60) sendBatch();
      if (Date.now() - lastPersist > 6000) await persist();
    };

    let usage = null;
    let backend = this.gen.backend;   // 'local' or 'cloudflare' (decided in #ask)

    /* LOCAL: relay serve.py's stream. A pre-preamble death (or offline/busy)
       with failover on falls through to the cloud INTO the same generation. */
    if (backend === 'local') {
      let failover = false;
      const resp = await merecatLocalFetch(this.env, { q, history, summary, effort: this.gen.effort || 'high' });
      if (!resp || resp.busy) {
        if (cfg.failover) failover = true;
        else {
          this.phase = 'error';
          this.#emit({ t: 'state', phase: 'error', resting: true,
            error: (resp && resp.busy) ? 'The local librarian is answering others right now. Try again in a moment.' : MERECAT_RESTING });
          this.gen = null; return;
        }
      } else {
        const r = await this.#relayLocal(resp, onToken, (s) => {
          sources = s; this.gen.sources = s;
          this.#emit({ t: 'meta', sources: s, used: this.gen.used, rv: MERECAT_RV, backend: 'local', chatId: this.chatId });
        });
        if (r.failover && cfg.failover) failover = true;
        /* r.ok, or a post-preamble death: keep whatever streamed */
      }
      if (failover) { backend = 'cloudflare'; this.gen.backend = 'cloudflare'; this.gen.used.backend = 'cloudflare'; sources = []; this.gen.answer = ''; }
    }

    /* CLOUD: a fresh cloud ask, or a failover into the same generation. */
    if (backend === 'cloudflare') {
      const built = await merecatPrompt(this.env, q, history, summary, cfg);
      sources = built.sources; this.gen.sources = sources;
      this.gen._msgLen = JSON.stringify(built.messages).length;
      this.#emit({ t: 'meta', sources, used: this.gen.used, rv: MERECAT_RV, backend: 'cloudflare', chatId: this.chatId });
      const aiStream = await this.env.AI.run(cfg.model, { messages: built.messages, stream: true, max_tokens: cfg.max_tokens, temperature: 0.35 });
      const strip = merecatThinkStripper();
      const reader = aiStream.getReader(); const dec = new TextDecoder(); let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n'); buf = lines.pop();
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6).trim();
          if (payload === '[DONE]') continue;
          try {
            const obj = JSON.parse(payload);
            if (obj.usage) usage = obj.usage;
            const delta = obj.response == null ? '' : String(obj.response);
            if (delta) { const vis = strip(delta); if (vis) await onToken(vis); }
          } catch { /* partial/non-JSON line */ }
        }
      }
      const tail = strip(null); if (tail) await onToken(tail);
    }

    sendBatch();
    if (!this.gen.answer.trim()) this.gen.answer = 'The librarian could not draw an answer this time. Ask again shortly.';

    /* Finalize: one authoritative write (done=1), tally (cloud only), fold. */
    const answer = this.gen.answer.trim();
    const nowS = Math.floor(Date.now() / 1000);
    const stmts = [];
    if (backend === 'cloudflare') {
      const inTok = usage && usage.prompt_tokens ? usage.prompt_tokens : Math.ceil((this.gen._msgLen || answer.length) / 4);
      const outTok = usage && usage.completion_tokens ? usage.completion_tokens : Math.ceil(answer.length / 4);
      stmts.push(this.env.LIBDB.prepare('INSERT INTO usage (day, q, in_tok, out_tok) VALUES (?1, 1, ?2, ?3) ON CONFLICT(day) DO UPDATE SET q = q + 1, in_tok = in_tok + ?2, out_tok = out_tok + ?3').bind(day, inTok, outTok));
      stmts.push(this.env.LIBDB.prepare('INSERT INTO user_usage (day, hash, q) VALUES (?1, ?2, 1) ON CONFLICT(day, hash) DO UPDATE SET q = q + 1').bind(day, me));
    }
    const existing = this.gen.userMsgId ? await this.env.LIBDB.prepare("SELECT id FROM chat_msgs WHERE chat_id = ?1 AND role = 'assistant' AND answers = ?2 LIMIT 1").bind(this.chatId, this.gen.userMsgId).first() : null;
    if (existing) {
      stmts.push(this.env.LIBDB.prepare('UPDATE chat_msgs SET body = ?2, sources = ?3, done = 1 WHERE id = ?1').bind(existing.id, answer, JSON.stringify(sources)));
      stmts.push(this.env.LIBDB.prepare('UPDATE chats SET last_at = ?2 WHERE id = ?1').bind(this.chatId, nowS));
    } else {
      stmts.push(this.env.LIBDB.prepare("INSERT INTO chat_msgs (chat_id, role, body, sources, created_at, answers, done) VALUES (?1, 'assistant', ?2, ?3, ?4, ?5, 1)").bind(this.chatId, answer, JSON.stringify(sources), nowS, this.gen.userMsgId || null));
      stmts.push(this.env.LIBDB.prepare('UPDATE chats SET last_at = ?2, msgs = msgs + 1 WHERE id = ?1').bind(this.chatId, nowS));
    }
    await this.env.LIBDB.batch(stmts);
    this.phase = 'done';
    this.#emit({ t: 'state', phase: 'done', chatId: this.chatId });
    try { await merecatFold(this.env, cfg, this.chatId); } catch { /* fold waits for next turn */ }
  }

  /* Relay serve.py's stream to the socket: {queue} → state:queued, {sources} →
     onMeta, answer bytes → onToken (STX heartbeats stripped, ETX = clean end).
     Returns {ok} once the preamble was seen (finished or died after it — keep
     what streamed), or {failover} if it died before the preamble. */
  async #relayLocal(resp, onToken, onMeta) {
    const reader = resp.body.getReader();
    const dec = new TextDecoder();
    let buf = ''; let headerDone = false;
    for (;;) {
      let deadTimer;
      const step = await Promise.race([
        reader.read().then((x) => ({ read: x }), (e) => ({ err: e })),
        new Promise((res) => { deadTimer = setTimeout(() => res({ silent: true }), 35000); }),
      ]);
      clearTimeout(deadTimer);
      if (step.silent || step.err) { try { reader.cancel(); } catch { /* severed */ } return headerDone ? { ok: true } : { failover: true }; }
      const { done, value } = step.read;
      if (done) break;
      buf += dec.decode(value, { stream: true });
      while (!headerDone) {
        const nl = buf.indexOf('\n\n'); if (nl === -1) break;
        let head; try { head = JSON.parse(buf.slice(0, nl)); } catch { head = null; }
        buf = buf.slice(nl + 2);
        if (head && head.queue != null) { this.phase = 'queued'; this.#emit({ t: 'state', phase: 'queued', place: head.queue, backend: 'local' }); continue; }
        onMeta((head && head.sources) || []);
        headerDone = true;
      }
      if (headerDone && buf) {
        const clean = buf.replace(/\u0002/g, '');
        const etx = clean.indexOf('\u0003');
        const vis = etx === -1 ? clean : clean.slice(0, etx);
        buf = '';
        if (vis) await onToken(vis);
        if (etx !== -1) { try { reader.cancel(); } catch { /* done */ } return { ok: true }; }
      }
    }
    return headerDone ? { ok: true } : { failover: true };
  }

  async alarm() {
    /* Keep the object alive through silent generation gaps (it idle-evicts at
       ~70-140s); clear once done/error so it hibernates at zero cost. */
    if (this.phase === 'thinking' || this.phase === 'streaming' || this.phase === 'queued') {
      this.ctx.storage.setAlarm(Date.now() + 30000);
    }
  }
}

/* The WebSocket upgrade endpoint. NOT gated by READ_LIMIT — a connection is not
   a poll; a dedicated CONNECT_LIMIT bucket absorbs reconnect storms without
   starving normal reads. env-guarded so a deploy without the binding just 503s. */
async function handleLive(request, env) {
  if (!originOk(request, env)) return new Response('bad origin', { status: 403 });
  if (!env.HUB) return new Response('unavailable', { status: 503 });
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.CONNECT_LIMIT.limit({ key: ip });
  if (!success) return new Response('slow down', { status: 429 });
  return env.HUB.get(env.HUB.idFromName('board')).fetch(request);
}

/* boardEventPublic — the back-room privacy gate for live events — lives in
   src/pure.js (imported at top): the ONE predicate every emit path runs through,
   so a future emit site cannot leak the admins-only room. sendToHub is its use. */

/* The single send primitive: EVERY board event reaches the hub through here, so
   the back-room privacy gate is one predicate in one place and a future
   subscriber (webhook / Discord / Matrix) is a single addition here — no forum
   handler ever changes. Returns a promise; env-guarded (no-op without the DO). */
function sendToHub(env, event) {
  if (!env.HUB || !boardEventPublic(event)) return Promise.resolve();
  return env.HUB.get(env.HUB.idFromName('board')).publish(event);
}

/* Publish a batch of board events (awaitable), with a cheap page pre-gate (a
   non-board or admins-only page emits nothing). Each event still passes the
   central gate in sendToHub. Shared by broadcastBoard and the bot's inline reply. */
async function publishBoardEvents(env, page, events) {
  if (!boardKey(page) || page === ADMIN_CAT) return;
  const list = Array.isArray(events) ? events : [events];
  for (const e of list) await sendToHub(env, e);
}

/* The board-broadcast sink: fire-and-forget, env-guarded, deferred via waitUntil
   so it never delays or breaks the write. `events` is an array, or a function
   returning one (sync or async) for sites that must query per-event data — the
   page pre-gate runs first, so the builder is skipped for the back room. */
function broadcastBoard(env, ctx, page, events) {
  if (!env.HUB || !boardKey(page) || page === ADMIN_CAT) return;
  ctx.waitUntil((async () => {
    const list = typeof events === 'function' ? await events() : events;
    await publishBoardEvents(env, page, list);
  })().catch((e) => console.log(JSON.stringify({ event: 'publish_failed', error: String(e) }))));
}

/* Fire-and-forget a single live event through the one sink; deferred via
   waitUntil so it never delays or breaks a write. */
function publishLive(env, ctx, event) {
  if (!env.HUB) return;
  ctx.waitUntil(sendToHub(env, event)
    .catch((e) => console.log(JSON.stringify({ event: 'publish_failed', error: String(e) }))));
}

/* Fire PRIVATE per-member live events (DMs, notifications) through the one hub.
   Each event is scoped to a single 'user:<hash>', which the DO fans only to
   sockets that authenticated as that hash — so a member's own connections alone
   receive it. Awaitable: a caller already inside a waitUntil (deliverNotifications)
   just awaits it; a plain handler passes ctx to publishLive-style fire-and-forget. */
async function publishUser(env, events) {
  if (!env.HUB) return;
  const list = (Array.isArray(events) ? events : [events]).filter(Boolean);
  for (const e of list) await sendToHub(env, e);
}

/* merecat over WebSockets (Phase 2). ask-init mints (or verifies) the
   conversation and returns its id BEFORE the socket opens, so the client adopts
   ?chat=<id> at once and dials the ChatRoom instance that matches the id (the DO
   name = 'chat:'+id, so a reconnect always reaches the same generator). */
async function handleMerecatAskInit(request, env) {
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.POST_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many questions at once. Wait a minute.' }, 429);
  const key = String(data.key || '');
  if (!key) return json({ ok: false, error: 'Bad request.' }, 400);
  const me = await sha256hex(key);
  const gate = await blockedReason(env, me, ip);
  if (gate) return blockedJson(gate);
  await env.DB.prepare('INSERT OR IGNORE INTO profiles (hash, created_at) VALUES (?1, ?2)')
    .bind(me, Math.floor(Date.now() / 1000)).run();
  let chatId = Number(data.chat) || 0;
  if (chatId) {
    const own = await env.LIBDB.prepare('SELECT id FROM chats WHERE id = ?1 AND hash = ?2').bind(chatId, me).first();
    if (!own) return json({ ok: false, error: 'No such conversation.' }, 404);
  } else {
    const title = String(data.q || '').replace(/\s+/g, ' ').trim().slice(0, 90) || 'New conversation';
    const now = Math.floor(Date.now() / 1000);
    const ins = await env.LIBDB.prepare(
      'INSERT INTO chats (hash, title, created_at, last_at, msgs) VALUES (?1, ?2, ?3, ?3, 0) RETURNING id'
    ).bind(me, title, now).first();
    chatId = ins.id;
  }
  const cfg = await merecatConfig(env);
  const day = merecatDay();
  const admin = await isAdminHash(env, me);
  let youQ = 0; let todayQ = 0;
  try {
    const g = await env.LIBDB.prepare('SELECT q FROM usage WHERE day = ?1').bind(day).first();
    todayQ = (g && g.q) || 0;
    const u = await env.LIBDB.prepare('SELECT q FROM user_usage WHERE day = ?1 AND hash = ?2').bind(day, me).first();
    youQ = (u && u.q) || 0;
  } catch { /* preview only */ }
  return json({ ok: true, chatId, backend: cfg.backend,
    used: { you: youQ, cap: cfg.user_daily, cap_on: cfg.user_cap_on, today: todayQ, gcap: cfg.global_daily, admin } }, 200);
}

/* The merecat WebSocket upgrade → the per-conversation ChatRoom (getByName by id
   so it is the same instance the ask-init minted). Not READ_LIMIT-gated. */
async function handleMerecatLive(request, env) {
  if (!originOk(request, env)) return new Response('bad origin', { status: 403 });
  if (!env.CHAT) return new Response('unavailable', { status: 503 });
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.CONNECT_LIMIT.limit({ key: ip });
  if (!success) return new Response('slow down', { status: 429 });
  const cid = Number(new URL(request.url).searchParams.get('chat')) || 0;
  if (!cid) return new Response('need a conversation id (call ask-init first)', { status: 400 });
  return env.CHAT.get(env.CHAT.idFromName('chat:' + cid)).fetch(request);
}

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      const path = url.pathname.replace(/\/+$/, '') || '/';

      if (request.method === 'POST' && !originOk(request, env)) {
        return json({ ok: false, error: 'Bad origin.' }, 403);
      }

      /* Live updates: the WebSocket upgrade to the board hub (a GET, so it never
         hits the POST origin guard above; handleLive does its own origin check). */
      if (path === '/api/comments/live' && request.method === 'GET' &&
          (request.headers.get('Upgrade') || '').toLowerCase() === 'websocket') {
        return await handleLive(request, env);
      }

      if (path === '/api/comments' && request.method === 'GET') return await handleGet(request, env, url);
      if (path === '/api/comments/config' && request.method === 'GET') return await handleConfig(request, env, url);
      if (path === '/api/comments' && request.method === 'POST') return await handlePost(request, env, ctx);
      if (path === '/api/comments/delete' && request.method === 'POST') return await handleSelfDelete(request, env, ctx);
      if (path === '/api/comments/edit' && request.method === 'POST') return await handleEdit(request, env, ctx);
      if (path === '/api/comments/meta' && request.method === 'POST') return await handleMeta(request, env);
      if (path === '/api/comments/audit' && request.method === 'POST') return await handleAudit(request, env);
      if (path === '/api/comments/trust' && request.method === 'POST') return await handleTrust(request, env);
      if (path === '/api/comments/moderate' && request.method === 'POST') return await handleModerate(request, env, ctx);
      if (path === '/api/comments/move' && request.method === 'POST') return await handleMove(request, env, ctx);
      if (path === '/api/comments/feed' && request.method === 'GET') return await handleFeed(request, env, url);
      if (path === '/api/comments/board' && request.method === 'GET') return await handleBoardIndex(request, env, url);
      if (path === '/api/comments/board/cat' && request.method === 'GET') return await handleBoardCat(request, env, url);
      if (path === '/api/comments/board/author' && request.method === 'GET') return await handleAuthorPosts(request, env, url);
      if (path === '/api/comments/board/topic' && request.method === 'GET') return await handleTopicView(request, env, url);
      if (path === '/api/comments/board/admin' && request.method === 'POST') return await handleBoardAdmin(request, env);
      if (path === '/api/comments/search' && request.method === 'GET') return await handleSearch(request, env, url);
      if (path === '/api/comments/profile' && request.method === 'GET') return await handleProfileGet(request, env, url);
      if (path === '/api/comments/profile' && request.method === 'POST') return await handleProfileSave(request, env);
      if (path === '/api/comments/profile/admin' && request.method === 'POST') return await handleProfileAdminEdit(request, env);
      if (path === '/api/comments/profile/clear' && request.method === 'POST') return await handleProfileClear(request, env);
      if (path === '/api/comments/backup' && request.method === 'POST') return await handleBackup(request, env);
      if (path === '/api/comments/dm/send' && request.method === 'POST') return await handleDmSend(request, env, ctx);
      if (path === '/api/comments/dm/threads' && request.method === 'POST') return await handleDmThreads(request, env);
      if (path === '/api/comments/dm/thread' && request.method === 'POST') return await handleDmThread(request, env, ctx);
      if (path === '/api/comments/dm/unread' && request.method === 'POST') return await handleDmUnread(request, env);
      if (path === '/api/comments/dm/presence' && request.method === 'POST') return await handleDmPresence(request, env);
      if (path === '/api/comments/dm/block' && request.method === 'POST') return await handleDmBlock(request, env);
      if (path === '/api/comments/dm/delete' && request.method === 'POST') return await handleDmDelete(request, env);
      if (path === '/api/comments/dm/directory' && request.method === 'GET') return await handleDmDirectory(request, env, url);
      if (path === '/api/comments/dm/pubkey' && request.method === 'POST') return await handleDmPubkey(request, env);
      if (path === '/api/comments/dm/ttl' && request.method === 'POST') return await handleDmTtl(request, env, ctx);
      if (path === '/api/comments/dm/save' && request.method === 'POST') return await handleDmSave(request, env);
      if (path === '/api/comments/dm/media' && request.method === 'POST') return await handleDmMediaUpload(request, env);
      if (path === '/api/comments/dm/media/get' && request.method === 'POST') return await handleDmMediaGet(request, env);
      if (path === '/api/comments/dm/media/purge' && request.method === 'POST') return await handleDmMediaPurge(request, env);
      if (path === '/api/comments/admin/settings' && request.method === 'POST') return await handleAdminSettings(request, env);
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
      // Public posting: walls + the global feed (all members-only reads).
      if (path === '/api/comments/wall/feed' && request.method === 'POST') return await handleWallFeed(request, env);
      if (path === '/api/comments/wall/post' && request.method === 'POST') return await handleWallPost(request, env, ctx);
      if (path === '/api/comments/wall/post/get' && request.method === 'POST') return await handleWallPostGet(request, env);
      if (path === '/api/comments/wall/comment' && request.method === 'POST') return await handleWallComment(request, env, ctx);
      if (path === '/api/comments/wall/delete' && request.method === 'POST') return await handleWallDelete(request, env);
      if (path === '/api/comments/wall/prune' && request.method === 'POST') return await handleWallPrune(request, env);
      if (path === '/api/comments/wall/media' && request.method === 'GET') return await handleWallMediaGet(request, env, url);
      if (path === '/api/comments/wall/media' && request.method === 'POST') return await handleWallMediaUpload(request, env);
      if (path === '/api/comments/wall' && request.method === 'POST') return await handleWall(request, env);
      if (path === '/api/comments/lock' && request.method === 'POST') return await handleLock(request, env);
      if (path === '/api/comments/deleteuser' && request.method === 'POST') return await handleDeleteUser(request, env);
      if (path === '/api/comments/ipban' && request.method === 'POST') return await handleIpBan(request, env);
      if (path === '/api/comments/ipbans' && request.method === 'POST') return await handleIpBans(request, env);
      if (path === '/api/comments/rdns' && request.method === 'POST') return await handleRdns(request, env);
      if (path === '/api/comments/approve' && request.method === 'POST') return await handleApprove(request, env, ctx);
      if (path === '/api/comments/pending' && request.method === 'POST') return await handlePending(request, env);
      if (path === '/api/comments/report' && request.method === 'POST') return await handleReport(request, env);
      if (path === '/api/comments/report/dismiss' && request.method === 'POST') return await handleReportDismiss(request, env);
      if (path === '/api/comments/admins' && request.method === 'POST') return await handleAdmins(request, env);
      if (path === '/api/comments/admin' && request.method === 'POST') return await handleAdmin(request, env);
      if (path === '/api/comments/push/register' && request.method === 'POST') return await handlePushRegister(request, env);
      if (path === '/api/comments/push/unregister' && request.method === 'POST') return await handlePushUnregister(request, env);
      if (path === '/api/merecat/ask-init' && request.method === 'POST') return await handleMerecatAskInit(request, env);
      if (path === '/api/merecat/live' && request.method === 'GET' &&
          (request.headers.get('Upgrade') || '').toLowerCase() === 'websocket') return await handleMerecatLive(request, env);
      if (path === '/api/merecat/about' && request.method === 'POST') return await handleMerecatAbout(request, env);
      if (path === '/api/merecat/backends' && request.method === 'POST') return await handleMerecatBackends(request, env);
      if (path === '/api/merecat/store' && request.method === 'POST') return await handleMerecatStore(request, env);
      if (path === '/api/merecat/usage' && request.method === 'POST') return await handleMerecatUsage(request, env);
      if (path === '/api/merecat/forward' && request.method === 'POST') return await handleMerecatForward(request, env);
      if (path === '/api/merecat/mention' && request.method === 'POST') return await handleMerecatMention(request, env);
      if (path === '/api/merecat/chats' && request.method === 'POST') return await handleMerecatChats(request, env);
      if (path === '/api/merecat/chat' && request.method === 'POST') return await handleMerecatChat(request, env);
      if (path === '/api/merecat/chat/delete' && request.method === 'POST') return await handleMerecatChatDelete(request, env);
      if (path === '/api/merecat/admin/threads' && request.method === 'POST') return await handleMerecatAdminThreads(request, env);
      if (path === '/api/merecat/admin/thread' && request.method === 'POST') return await handleMerecatAdminThread(request, env);
      if (path === '/api/merecat/chat/save' && request.method === 'POST') return await handleMerecatChatSave(request, env);
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
    /* Hourly: only sweep expired disappearing DMs + their media (cheap, frequent,
       the reclamation pass behind the instant read-time hiding). Monthly (any
       other schedule): the sweep plus the full housekeeping + backup chain. */
    if (event && event.cron === '0 * * * *') {
      ctx.waitUntil(sweepExpiredDms(env).then(() => sweepWallOrphanMedia(env)));
      return;
    }
    ctx.waitUntil(
      sweepExpiredDms(env)
        .then(() => pruneIdentityIps(env))
        .then(() => pruneComments(env))
        .then(() => sweepDms(env))
        .then(() => pruneNotifications(env))
        .then(() => pruneMerecatChats(env))
        .then(() => sweepWallOrphanMedia(env))
        .then(() => pruneWallPosts(env))
        .then(() => runBackup(env))
    );
  },
};
