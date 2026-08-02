/* lib.ts — the comments worker's shared core: constants, crypto, auth,
   validation, and the DB / notification / broadcast helpers. Everything that is
   NOT a request handler, a Durable Object, or the route dispatch. index.ts and
   the route modules import from here — a one-way DAG (core references no handler). */
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
import * as Handle from '../../purescript/output/Domain.Handle/index.js';
import * as Links from '../../purescript/output/Domain.Links/index.js';
import * as Wall from '../../purescript/output/Domain.Wall/index.js';
import * as Prefs from '../../purescript/output/Domain.Prefs/index.js';
// Pure, dependency-free helpers (IP/ban-key normalization + back-room privacy),
// extracted so they can be unit-tested in plain Node. See src/pure.js. (pure.js
// also exports ipv6Groups/ipv6Prefix64/ipv6Full/isSharedV4, used internally
// there or client-side; imported here only what index.js calls directly.)
import {
  ipFamily, ipKey, toBanKey, reverseDnsName, looksLikeIp, boardEventPublic, sanitizeScopes,
  isDiscordWebhook, discordSnippet, shadowExcl, parseFeedScope, scopeLabel, journalArticle,
} from './pure.js';
export { isDiscordWebhook, discordSnippet, shadowExcl, parseFeedScope, scopeLabel, journalArticle };   // re-exported so index.ts imports them from here
// Real Web Push (VAPID + aes128gcm) on crypto.subtle — no external service.
import { createPusher } from './webpush.js';
// Repository layer: bind-placeholder helpers + identity mappers (see db.ts).
import { inList, rankFor, withNames, postCountsFor } from './db.js';

/* Keyed-request preamble, single-sourced. Parse the JSON body, rate-limit by IP
   on `bucket`, then require + hash the identity key. Returns the resolved
   {ip, data, key, me} or a Response to return early. `keyedGated` adds the
   blocked-identity gate (a locked/banned hash is refused). These replicate,
   verbatim, the preamble that used to open each keyed handler. */

export async function keyed(request: any, env: any, bucket: string): Promise<Response | { ip: string; data: any; key: string; me: string }> {
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env[bucket].limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests.' }, 429);
  const key = String(data.key || '');
  if (!key) return json({ ok: false, error: 'Bad request.' }, 400);
  const me = await sha256hex(key);
  return { ip, data, key, me };
}
export async function keyedGated(request: any, env: any, bucket: string): Promise<Response | { ip: string; data: any; key: string; me: string }> {
  const pre = await keyed(request, env, bucket);
  if (pre instanceof Response) return pre;
  const gate = await blockedReason(env, pre.me, pre.ip);
  if (gate) return blockedJson(gate);
  return pre;
}

/* Worker environment bindings (D1 databases, R2 buckets, Vectorize, Workers AI,
   Durable Object namespaces, rate limiters) plus string vars/secrets. Typed
   loosely (index signature) on purpose — this is a typing pass, not a
   binding-by-binding audit, and every access site already treats env as
   whatever-shape-it-needs-to-be at runtime. */
export const PAGES = [
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
export const BOARD_CATS = Board.catKeys;
/* The back room: a category only admins can see, read, or write. Every public
   read excludes it outright (the board index, listings, topic views, search,
   author histories, post counts, feeds); admins reach it through the keyed
   POST /board/admin. Writes into it demand an admin identity, notifications
   from it reach admins alone, and a topic moved INTO it sends no courtesy DM
   (a retraction from public view, not a move the poster can follow). */
export const ADMIN_CAT = Board.adminCat;

export function boardKey(raw: any) {
  const m = /^board:([a-z]+)$/.exec(String(raw || ''));
  return m && BOARD_CATS.includes(m[1]) ? raw : null;
}

/* The site's own origin, used to build human-facing links (feed items, the
   move-notice DM). Overridable per deployment via the SITE var; the constant is
   the production default so prod behaves identically when the var is unset. */
export const SITE = 'https://merecatholicity.com';
export function siteBase(env: any) { return (env && env.SITE) || SITE; }
export const MAX_BODY = 4000;
/* Ciphertext cap for an end-to-end-encrypted DM: base64url of a MAX_BODY-sized
   plaintext plus the nonce/tag and the "E1." header, with generous headroom. The
   plaintext length is capped in the browser; the server only bounds the blob. */
export const DM_ENC_MAX = 24000;
export const MAX_TITLE = 120;
/* Known-IPs retention: the fingerprint drawer shows addresses seen inside
   IP_SHOW_DAYS, and the monthly cron deletes rows idle past IP_KEEP_DAYS.
   Banned keys are exempt from both, so a standing ban never loses its row. */
export const IP_SHOW_DAYS = 14;
export const IP_KEEP_DAYS = 30;
/* Soft-deleted comments vanish from view at once but linger as rows; the
   monthly cron hard-removes any older than DELETED_KEEP_DAYS. The prior
   month's backup, kept ninety days, still holds anything just removed. */
export const DELETED_KEEP_DAYS = 30;
/* Read notifications are swept from the store after this many days; the badge
   and list only ever care about the recent and the unread. */
export const NOTIFICATIONS_KEEP_DAYS = 30;
export const NOTIF_PER_PAGE = 20;
/* The faith declaration every member picks at signup: one of three, stored as
   a short code, its display wording owned by the client. Kept in step with the
   FAITH map in comments.js. */
export const FAITHS = Faith.faithList.map((f: any) => f.code);   // single-sourced from Domain.Faith
export function cleanFaith(raw: any) {
  const v = String(raw || '').trim();
  return FAITHS.includes(v) ? v : null;
}
export const CONTROL_RE = /[\u0000-\u0008\u000B-\u001F\u007F]/;

/* Must stay identical to the lists in comments.js, or a member's assigned
   pseudonym will differ between the server (feed, /config, the `assigned` field)
   and the web client that renders it. Also served verbatim by /api/comments/config. */
/* The pseudonym derivation + its two 40-word lists are single-sourced from the
   PureScript Domain.Pseudonym — the same module the client bundles (Phase 6) —
   retiring the ADJ/NOUN copy that used to live here. */
export const displayName = Pseudonym.displayName;

/* The scriptorium rank ladder: standing by total live-forum posts. Thresholds
   ascend; rankFor returns the highest reached. Mirrors RANKS in comments.js; the
   count itself is postCountsFor. Served in /config and stamped on author rows so
   a client need not carry the ladder. */
/* rankFor and withNames (and postCountsFor, below) now live in the repository
   layer, ./db.ts — imported at the top. rankFor erases the Domain.Rank ADT to
   its label; withNames attaches the server-resolved `assigned` pseudonym + rank
   to an author row (single-sourced from Domain.Rank/Pseudonym, the same modules
   the client bundles). */

/* ---- Served display constants (GET /api/comments/config) ----
   These display-only tables mirror the ones in comments.js. The endpoint makes
   the worker the single SERVED source so a native client fetches them instead of
   triplicating the constants; comments.js keeps its inline copies as a pre-load
   fallback (a later pass can have it read /config). Cat keys are validated
   against BOARD_CATS so the two rosters cannot drift. Single-sourced from
   Domain.Board.catRows, the same table the client renders. */
export const CAT_META = Board.catRows;
export const FAITH_LABELS = Object.fromEntries(Faith.faithList.map((f: any) => [f.code, f.label]));
/* Emoji packs + named-alias tokens single-sourced from Domain.Emoji (the same
   data the client renders); the building code (whitelist derive, alias pairing)
   is trivial and stays per-consumer. */
export const EMOJI_PACKS = Emoji.packs;
export const NAMED_EMOJI = (() => {
  const out: any = {};
  const toks = Emoji.namedTokens.trim().split(/\s+/);
  for (let i = 0; i < toks.length; i += 2) out[toks[i]] = toks[i + 1];
  return out;
})();
/* Book spelling/abbreviation -> KJV verse-anchor slug, mirroring BIBLE in
   comments.js. Served so a native renderer can autolink scripture references. */
/* BIBLE_SPEC retired — the book table is single-sourced from the PureScript
   Domain.Scripture.bibleSpec, the same table the client bundles (Phase 6). */

export const enc = new TextEncoder();

export async function sha256hex(text: any) {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/* Same-origin API. A cross-origin browser POST always carries an Origin, so
   reject any Origin that is not ours; a missing Origin (non-browser clients,
   some same-origin form posts) is allowed through to the usual gates. The
   allowlist is overridable per deployment via the ALLOWED_ORIGINS var (comma-
   separated) — e.g. to admit a staging host or a hybrid-app origin — and falls
   back to the production defaults when unset, so prod is unchanged. */
export const DEFAULT_ORIGINS = ['https://merecatholicity.com', 'https://www.merecatholicity.com'];
export function allowedOrigins(env: any) {
  const v = env && env.ALLOWED_ORIGINS;
  return v ? String(v).split(',').map((s) => s.trim()).filter(Boolean) : DEFAULT_ORIGINS;
}
export function originOk(request: any, env: any) {
  const o = request.headers.get('Origin');
  return !o || allowedOrigins(env).includes(o);
}

export function json(body: any, status?: any, headers?: any) {
  return new Response(JSON.stringify(body), {
    status: status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

export function parseOS(ua: any) {
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
export function rootAdmins(env: any) {
  return (env.ADMIN_HASHES || '').split(',').map((s: any) => s.trim()).filter((h: any) => /^[0-9a-f]{64}$/.test(h));
}

/* Admin status is membership in the admins table. The env owners count only
   while the table is still empty (bootstrap), so a live board is governed
   entirely by the table and no admin is privileged over another. */
export async function isAdminHash(env: any, hash: any) {
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
export async function ensureAdminsSeeded(env: any) {
  const any = await env.DB.prepare('SELECT 1 AS a FROM admins LIMIT 1').first();
  if (any) return;
  const now = Math.floor(Date.now() / 1000);
  for (const h of rootAdmins(env)) {
    await env.DB.prepare('INSERT OR IGNORE INTO admins (hash, added_by, created_at) VALUES (?1, ?2, ?3)')
      .bind(h, 'seed', now).run();
  }
}

export function normalizePage(raw: any) {
  let p = String(raw || '').split('?')[0].split('#')[0];
  if (!p.startsWith('/')) return null;
  if (p.endsWith('/')) p += 'index.html';
  if (!p.endsWith('.html')) p += '.html';
  return PAGES.includes(p) ? p : null;
}

/* Fails closed. A blip reaching siteverify refuses the post rather than
   crashing the worker or waving the post through unverified. */
export async function verifyTurnstile(env: any, token: any, ip: any, key: any) {
  /* TEST BYPASS (interactive regression kit, webtest/live_kit.py): a designated
     throwaway test identity may skip Turnstile by presenting the shared secret as
     its token, so the two-user cloakbrowser suite can drive real writes (headless
     browsers cannot solve the production managed challenge). INERT unless BOTH
     env secrets are set (MC_TEST_BYPASS + TEST_HASHES); gated to the listed
     hashes; every other gate (rate-limit, AI screen, IP/identity blocks) still
     applies. Without the secrets set this whole branch is dead code. */
  if (env.MC_TEST_BYPASS && key && token === 'TEST:' + env.MC_TEST_BYPASS) {
    const h = await sha256hex(key);
    if ((env.TEST_HASHES || '').split(',').map((s: any) => s.trim()).includes(h)) return true;
  }
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token, remoteip: ip }),
    });
    const verdict: any = await res.json();
    if (!verdict.success) return false;
    /* Defense in depth on top of the sitekey's own domain lock: if a host
       allow-list is configured, the token must have been solved on one. */
    const allow = (env.TURNSTILE_HOSTNAMES || '').split(',').map((h: any) => h.trim()).filter(Boolean);
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

/* ---- Shadow ban (admin global mute) -------------------------------------
   A shadowbanned identity keeps posting (submits succeed, rows store
   status='live'), but its public content is excluded from every OTHER reader's
   view, and it fans out nothing (no live broadcast, notification, Discord, or
   @merecat). It is NOT a blockedReason — the author is never logged out or
   refused — so they are not really aware of it. shadowExcl(alias) is the ONE
   read-side filter, appended to a query's WHERE to drop rows whose <alias>.author_hash
   is shadowbanned; the per-call subquery table alias (sb_<alias>) keeps two of
   them side by side (a reply AND its topic owner). shadowExcl is the pure SQL
   builder (in pure.js, unit-tested — a typo there would silently un-mute
   everyone); isShadowBanned is the write-side point check. Both hit the tiny
   PK-indexed shadowbans table. */
export async function isShadowBanned(env: any, hash: any) {
  if (!hash) return false;
  const row = await env.DB.prepare('SELECT 1 AS s FROM shadowbans WHERE hash = ?1').bind(hash).first();
  return !!row;
}

/* The topic row carries denormalized replies and last_at so category
   pages read topic rows alone. Recomputed, never incremented, from the
   indexed replies whenever anything in the thread mutates, so the numbers
   cannot drift. A shadowbanned author's replies are excluded here too, so a
   muted reply never bumps a thread's count or last-activity for anyone. */
export async function refreshTopicStats(env: any, topicId: any) {
  await env.DB.prepare(
    'UPDATE comments SET ' +
    "replies = (SELECT COUNT(*) FROM comments r WHERE r.parent_id = ?1 AND r.status = 'live' AND " + shadowExcl('r') + '), ' +
    "last_at = (SELECT MAX(c2.created_at) FROM comments c2 WHERE (c2.id = ?1 OR c2.parent_id = ?1) AND c2.status = 'live' AND " + shadowExcl('c2') + ') ' +
    'WHERE id = ?1'
  ).bind(topicId).run();
}

export async function isTrusted(env: any, hash: any) {
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
export async function ptrLookup(ip: any) {
  const name = reverseDnsName(ip);
  if (!name) return null;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 1500);
  try {
    const r = await fetch('https://cloudflare-dns.com/dns-query?type=PTR&name=' + encodeURIComponent(name),
      { headers: { accept: 'application/dns-json' }, signal: ctl.signal });
    if (!r.ok) return null;
    const j: any = await r.json();
    const ans = j && j.Answer && j.Answer.find((a: any) => a.type === 12);
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
export async function recordIps(env: any, hash: any, connIp: any, data: any) {
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
export async function blockedReason(env: any, hash: any, ip: any) {
  const row = await env.DB.prepare(
    "SELECT 'locked' AS r FROM locks WHERE hash = ?1 " +
    "UNION ALL SELECT 'ipban' FROM ip_bans WHERE ip = ?2 " +
    "UNION ALL SELECT 'banned' FROM bans WHERE hash = ?1 LIMIT 1"
  ).bind(hash || '-', ipKey(ip) || '-').first();
  return row ? row.r : null;
}

export function blockedJson(reason: any) {
  return json({ ok: false, blocked: reason, error: 'Interaction is not available.' }, 403);
}

/* Returns {status, verdict}. Anything unscreenable is held pending: the
   failure mode must be a delay for the poster, never a silent publish.
   A trusted author skips the screen entirely, though hold-all, the
   emergency brake, still holds everyone, and bans are checked upstream. */
export async function screen(env: any, body: any, trusted: any) {
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
export function viewLink(env: any, page: any, id: any, parentId: any) {
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
export function cacheHeader(url: any) {
  return { 'Cache-Control': 'public, max-age=' + (url.searchParams.get('fresh') ? 60 : 300) };
}

/* The shared-constants endpoint: one cacheable read serving the display tables a
   second client (native app, CLI) would otherwise triplicate — category roster,
   faith labels, rank ladder, commentable pages, the bot hash, the scripture
   autolink table, and the emoji whitelists — plus an explicit apiVersion. Public
   and edge-cacheable like every other read. Additive: nothing consumes it yet;
   the web client keeps its inline copies. */
export async function notifyPrefsFor(env: any, hashes: any) {
  const map: any = {};
  const list = [...new Set((hashes || []).filter(Boolean))];
  for (let i = 0; i < list.length; i += 50) {
    const chunk = list.slice(i, i + 50);
    const ph = inList(chunk.length);
    try {
      const rows = await env.DB.prepare('SELECT hash, notify_reply, notify_mention, notify_dm FROM profiles WHERE hash IN (' + ph + ')').bind(...chunk).all();
      for (const r of (rows.results || [])) map[r.hash] = r;
    } catch (e) { /* defaults (all on) stand */ }
  }
  return map;
}
/* Is a kind enabled for this recipient? NULL / missing profile = on (default). */
export function notifyEnabled(prefRow: any, kind: any) {
  if (!prefRow) return true;
  const v = prefRow['notify_' + kind];
  return v == null ? true : Prefs.notifyOn(Number(v) || 0);
}

export async function deliverNotifications(env: any, o: any) {
  const now = Math.floor(Date.now() / 1000);
  const NOTIF = 'INSERT INTO notifications (recipient_hash, kind, topic_id, comment_id, actor_hash, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)';
  const stmts = [];
  const pushMention = new Set();   // recipients to nudge by native push, per kind (disjoint sets)
  const pushReply = new Set();
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
      admSet = new Set((admRows.results || []).map((r: any) => r.hash));
    }
    const mPrefs = await notifyPrefsFor(env, mentions);
    for (const h of mentions) {
      if (admSet && !admSet.has(h)) continue;
      if (!notifyEnabled(mPrefs[h], 'mention')) continue;   // recipient turned mentions off
      stmts.push(env.DB.prepare(NOTIF).bind(h, 'mention', o.topicId, o.commentId, o.authorHash, now));
      pushMention.add(h);
      liveEvents.push({ v: 1, t: 'notification', scopes: ['user:' + h], kind: 'mention', topic_id: o.topicId, comment_id: o.commentId, actor_hash: o.authorHash, created_at: now });
    }

    if (o.isReply) {
      const skip = new Set(mentions);
      if (o.authorHash) skip.add(o.authorHash);
      skip.add(MERECAT_BOT.hash);
      const recips: any = new Set();
      if (o.topicAuthorHash) recips.add(o.topicAuthorHash);
      const rows = await env.DB.prepare('SELECT hash FROM watches WHERE topic_id = ?1').bind(o.topicId).all();
      for (const r of (rows.results || [])) recips.add(r.hash);
      const rPrefs = await notifyPrefsFor(env, [...recips]);
      for (const h of recips) {
        if (admSet && !admSet.has(h)) continue;
        if (h && !skip.has(h) && notifyEnabled(rPrefs[h], 'reply')) {   // recipient's reply pref
          stmts.push(env.DB.prepare(NOTIF).bind(h, 'reply', o.topicId, o.commentId, o.authorHash, now));
          pushReply.add(h);
          liveEvents.push({ v: 1, t: 'notification', scopes: ['user:' + h], kind: 'reply', topic_id: o.topicId, comment_id: o.commentId, actor_hash: o.authorHash, created_at: now });
        }
      }
    }
  }

  if (stmts.length) await env.DB.batch(stmts);
  /* Instant per-member push over the private user:<hash> scope (badge + list),
     alongside the native Web Push nudge. The live event no-ops without the DO;
     the push no-ops unless PUSH_ENABLED + VAPID keys are set. */
  if (liveEvents.length) await publishUser(env, liveEvents);
  const topicUrl = '/community.html?topic=' + o.topicId + '#comment-' + o.commentId;
  if (pushMention.size) {
    await deliverPush(env, [...pushMention], { kind: 'mention', title: 'You were mentioned', body: 'Someone mentioned you', url: topicUrl });
  }
  if (pushReply.size) {
    await deliverPush(env, [...pushReply], { kind: 'reply', title: 'New reply', body: 'Someone replied to your thread', url: topicUrl });
  }
}

/* A direct message is a notification-worthy event, so it also lands in the
   notifications list (not only the inbox badge). Coalesced: one UNREAD 'dm'
   notification per (recipient, sender), so a burst of messages surfaces once as
   "X sent you a message" until it is read, rather than burying the list. A 'dm'
   notification carries no topic/comment (both 0) and jumps to the conversation.
   A DM must never fail because its notification did, so this never throws out. */
export async function notifyDm(env: any, toHash: any, fromHash: any) {
  try {
    if (!toHash || !fromHash || toHash === fromHash || fromHash === MERECAT_BOT.hash) return;
    /* "Direct messages" notifications off silences the BELL only — the message
       still arrives (handleDmSend's t:'dm' push) and the inbox unread badge still
       updates; we simply skip the notifications-list row + its ping. */
    const pref = (await notifyPrefsFor(env, [toHash]))[toHash];
    if (!notifyEnabled(pref, 'dm')) return;
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

/* Best-effort push fan-out — real Web Push (VAPID + aes128gcm) over crypto.subtle,
   no external service (see webpush.js). A NO-OP unless PUSH_ENABLED === 'true'
   AND the VAPID keypair is configured (VAPID_PRIVATE_KEY secret + VAPID_PUBLIC_KEY
   var). Looks up each recipient's registered subscriptions and sends `payload`
   (title/body/url, never message content — privacy + E2E). A dead subscription
   (404/410) is pruned. Never throws into the caller (a push failure must never
   affect a post or a DM). */
export async function deliverPush(env: any, hashes: any, payload: any) {
  try {
    if (env.PUSH_ENABLED !== 'true') return;
    if (!env.VAPID_PRIVATE_KEY || !env.VAPID_PUBLIC_KEY) {
      console.log(JSON.stringify({ event: 'push_unconfigured' }));   // enabled but no keys set yet
      return;
    }
    const uniq = [...new Set((hashes || []).filter(Boolean))];
    if (!uniq.length) return;
    const ph = inList(uniq.length);
    const rows = await env.DB.prepare('SELECT hash, platform, token FROM push_tokens WHERE hash IN (' + ph + ')').bind(...uniq).all();
    const tokens = rows.results || [];
    if (!tokens.length) return;
    const pusher = await createPusher(env);
    const dead = [];   // { hash, token } rows whose subscription is gone
    let sent = 0;
    for (const row of tokens) {
      let sub = null;
      try { sub = JSON.parse(row.token); } catch { sub = null; }
      if (!sub || !sub.endpoint) { dead.push(row); continue; }   // unparseable => prune
      const res = await pusher.send(sub, payload);
      if (res.ok) sent += 1;
      else if (res.gone) dead.push(row);
    }
    /* Prune expired/removed subscriptions so the table doesn't accrete dead rows
       (a browser that unsubscribes or an OS that rotates the endpoint). */
    if (dead.length) {
      const stmts = dead.map((r) => env.DB.prepare('DELETE FROM push_tokens WHERE hash = ?1 AND token = ?2').bind(r.hash, r.token));
      try { await env.DB.batch(stmts); } catch (e) { /* pruning is best-effort */ }
    }
    console.log(JSON.stringify({ event: 'push_sent', kind: payload && payload.kind, sent, pruned: dead.length, total: tokens.length }));
  } catch (e) {
    console.log(JSON.stringify({ event: 'push_failed', error: String(e) }));
  }
}

/* Register a device's push token to the caller's identity (one row per token, so
   re-registering the same token just refreshes it). Additive and gated: it fills
   push_tokens, which deliverPush reads only when PUSH_ENABLED is on. */
export function xmlEscape(s: any) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/* RSS 2.0 feed of a page's live comments, so anyone can follow a thread
   with a feed reader and nobody has to hand this site an email address. */
export async function metaForHash(env: any, hash: any) {
  const last = await env.DB.prepare(
    'SELECT id, ip, ua, os, tz, lang FROM comments WHERE author_hash = ?1 ORDER BY id DESC LIMIT 1'
  ).bind(hash).first();
  const flags = await env.DB.prepare(
    'SELECT (SELECT 1 FROM trusted WHERE hash = ?1) AS trusted, ' +
    '(SELECT 1 FROM locks WHERE hash = ?1) AS locked, ' +
    '(SELECT 1 FROM shadowbans WHERE hash = ?1) AS shadowbanned'
  ).bind(hash).first();
  /* Only the recent window shows, banned keys always. */
  const ipRows = await env.DB.prepare(
    'SELECT ii.ip_key, ii.ip_display, ii.family, ii.source, ' +
    'CASE WHEN ib.ip IS NULL THEN 0 ELSE 1 END AS banned ' +
    'FROM identity_ips ii LEFT JOIN ip_bans ib ON ib.ip = ii.ip_key ' +
    'WHERE ii.hash = ?1 AND (ii.last_seen >= ?2 OR ib.ip IS NOT NULL) ' +
    'ORDER BY ii.family, ii.last_seen DESC'
  ).bind(hash, Math.floor(Date.now() / 1000) - IP_SHOW_DAYS * 86400).all();
  const identities: any = {};
  identities[hash] = ipRows.results.map((r: any) => ({
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
    shadowbanned: flags && flags.shadowbanned ? 1 : 0,
    ipbanned,
  };
  return json({ ok: true, meta: [row], identities }, 200);
}

export const TOPICS_PER_PAGE = 20;
export async function boardCatPayload(env: any, page: any, p: any, q: any) {
  /* Optional title narrowing (the merecat forward picker's type-to-narrow):
     up to five typed words, each a case-insensitive substring of the topic
     title, ANDed in any order. The LIKE walk covers only this category's
     topic rows, so a two-topic room and a two-thousand-topic room both
     answer as one twenty-row page — a client never pulls the whole list. */
  const toks = String(q || '').slice(0, 120).split(/\s+/).filter(Boolean).slice(0, 5);
  /* Shadowbanned authors' topics never list for anyone (shadowExcl). */
  let where = "c.page = ?1 AND c.parent_id IS NULL AND c.status = 'live' AND " + shadowExcl('c');
  const binds = [page];
  for (const t of toks) {
    binds.push('%' + t.replace(/[\\%_]/g, '\\$&') + '%');
    where += ' AND c.title LIKE ?' + binds.length + " ESCAPE '\\'";
  }
  const total = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM comments c WHERE ' + where
  ).bind(...binds).first();
  const rows = await env.DB.prepare(
    'SELECT c.id, c.title, c.author_hash, pr.nick, c.created_at, c.locked, c.sticky, COALESCE(c.readonly, 0) AS readonly, ' +
    'COALESCE(c.replies, 0) AS replies, COALESCE(c.last_at, c.created_at) AS last, ' +
    "(SELECT MAX(m.id) FROM comments m WHERE (m.id = c.id OR m.parent_id = c.id) AND m.status = 'live' AND " + shadowExcl('m') + ') AS last_id ' +
    'FROM comments c LEFT JOIN profiles pr ON pr.hash = c.author_hash ' +
    'WHERE ' + where + ' ' +
    'ORDER BY COALESCE(c.sticky, 0) DESC, last DESC LIMIT ?' + (binds.length + 1) + ' OFFSET ?' + (binds.length + 2)
  ).bind(...binds, TOPICS_PER_PAGE, (p - 1) * TOPICS_PER_PAGE).all();
  return { ok: true, topics: (rows.results || []).map((r: any) => withNames(r)), total: total.n, page: p, per: TOPICS_PER_PAGE };
}

/* A member's own recent forum posts, newest first — the "recent posts" list on a
   profile, so a reader can follow a thinker. The same live-and-forum filter the
   board uses, plus an author clause; a reply borrows its topic's title and links
   to the exact post. Public and cacheable like every board read. */
export const SEARCH_PER_PAGE = 20;

/* Turn a user query into a safe FTS5 MATCH. The logic — pull out "quoted phrases"
   and bare words, double any embedded quote, wrap every token in quotes so no FTS5
   operator (- * : ^ NEAR AND OR NOT parentheses) can be injected, cap at ten — is
   single-sourced in Domain.Fts, which returns a `SafeMatch` whose only exit is
   `unSafeMatch`. The injection guarantee lives in that type, not here. */
export function buildMatch(q: any) {
  return Fts.unSafeMatch(Fts.buildMatch(String(q ?? '')));
}

/* Full-text search over the FORUM only. Live board rows are filtered in at query
   time, so the FTS index can simply mirror all of comments. Narrows by category
   and by author, ranks by relevance (bm25) or recency, marks matched terms with
   control characters for the client to highlight, and is cacheable like every
   public read. An unknown category or malformed author is dropped, not errored,
   so a stray filter never blanks the results. */
export async function topicViewPayload(env: any, topic: any, pRaw: any, findRaw: any) {
  const id = topic.id;
  /* Twenty replies a page. A permalink arrives with find=<reply id> and
     one indexed count places it on the right page. */
  let p = Math.min(1000, Math.max(1, Math.floor(Number(pRaw) || 1)));
  const find = Number(findRaw);
  if (Number.isInteger(find) && find > 0 && !pRaw) {
    const pos = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM comments c WHERE c.parent_id = ?1 AND c.status = 'live' AND c.id < ?2 AND " + shadowExcl('c')
    ).bind(id, find).first();
    p = Math.floor(pos.n / TOPICS_PER_PAGE) + 1;
  }
  const replies = await env.DB.prepare(
    "SELECT c.id, c.author_hash, pr.nick, pr.signature, pr.avatar, pr.faith, c.body, c.created_at, c.edited_at FROM comments c " +
    "LEFT JOIN profiles pr ON pr.hash = c.author_hash " +
    "WHERE c.parent_id = ?1 AND c.status = 'live' AND " + shadowExcl('c') + " ORDER BY c.id LIMIT ?2 OFFSET ?3"
  ).bind(id, TOPICS_PER_PAGE, (p - 1) * TOPICS_PER_PAGE).all();
  /* Each post carries its author's total forum-post count, for the rank the
     client shows under the name. One grouped query for every author on the page. */
  const counts = await postCountsFor(env, [topic.author_hash].concat((replies.results || []).map((r: any) => r.author_hash)));
  return {
    ok: true,
    anon: env.ALLOW_ANON === 'true',
    cat: topic.page.slice(6),
    topic: withNames({ id: topic.id, title: topic.title, author_hash: topic.author_hash, nick: topic.nick, signature: topic.signature, avatar: topic.avatar, faith: topic.faith || null, body: topic.body, created_at: topic.created_at, edited_at: topic.edited_at, locked: topic.locked ? 1 : 0, sticky: topic.sticky ? 1 : 0, readonly: topic.readonly ? 1 : 0 }, counts[topic.author_hash] || 0),
    replies: (replies.results || []).map((r: any) => withNames(r, counts[r.author_hash] || 0)),
    total: topic.replies || 0,
    page: p,
    per: TOPICS_PER_PAGE,
  };
}

/* The admins' door to the back room: the same listing and topic payloads the
   public GETs serve, behind the admin key and never cached. Strict: it serves
   the admins-only category and its topics alone — everything public stays on
   the public path. */
export const MAX_NICK = Profile.limits.nick;
export const MAX_BIO = Profile.limits.bio;
export const MAX_SIG = Profile.limits.sig;

/* Public read of a profile: the custom fields plus the assigned pseudonym,
   never any private fingerprint or trust/ban state. Missing profile still
   answers, with null fields, so any hash resolves to at least its name. */
export function cleanField(raw: any, max: any) {
  const v = String(raw || '').replace(/\r\n?/g, '\n').trim();
  if (v.length > max) return { error: true };
  if (CONTROL_RE.test(v)) return { error: true };
  return { value: v || null };
}

/* Parse the stored offsite-links JSON back to an object for the client. */
export function safeParseLinks(s: any) {
  try { const o = JSON.parse(s); return (o && typeof o === 'object' && !Array.isArray(o)) ? o : null; } catch { return null; }
}

/* Sanitize a client-supplied links object to a JSON string of ONLY safe,
   normalized https URLs — Domain.Links drops anything that is not an http(s) URL
   or a normalizable handle. Returns the JSON string, or null when nothing valid
   remains (which clears the column). */
export function normalizeLinks(raw: any) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out: any = {};
  for (const plat of Links.platforms) {
    const v = src[plat];
    if (v == null || String(v).trim() === '') continue;
    const n = Links.normalize(plat)(String(v));
    if (n.ok && n.url) out[plat] = n.url;
  }
  return Object.keys(out).length ? JSON.stringify(out) : null;
}

/* Owner-writable profile: the key must hash to the profile's own hash, so a
   profile is only ever edited by its holder. The three fields are screened as
   one blob and rejected outright when flagged (a profile has no pending
   state); an unscreenable blob is allowed, being low-risk and admin-clearable. */
export const DM_PER_PAGE = 20;

export function dmPair(h1: any, h2: any) {
  return h1 < h2 ? [h1, h2] : [h2, h1];
}

/* Visibility is per viewer: everyone sees the unheld, and a sender always
   sees their own words, held or not. ?1 must be bound to the viewer's hash
   wherever this fragment appears. */
export const DM_VIS = "(COALESCE(m.held, 0) = 0 OR m.sender_hash = ?1)";

/* A message still lives: not past its disappearing-message expiry. A saved
   message carries expires_at NULL and so is always live. `now` is a server
   integer interpolated straight into the SQL (never a bind param), so this can be
   appended to any DM query without shifting the numbered binds. */
export function dmLive(now: any) { return '(m.expires_at IS NULL OR m.expires_at > ' + Math.floor(Number(now) || 0) + ')'; }

/* Unread, per viewer: an unheld, unexpired message from someone else, newer than
   my read stamp. Held and expired messages never trip the recipient's badge. */
export function dmUnreadExists(now: any) {
  return 'EXISTS(SELECT 1 FROM dms m WHERE m.thread_id = t.id AND COALESCE(m.held, 0) = 0 ' +
    'AND m.sender_hash != ?1 ' +
    'AND m.created_at > COALESCE(CASE WHEN t.a_hash = ?1 THEN t.a_read_at ELSE t.b_read_at END, 0) ' +
    'AND m.created_at > COALESCE(CASE WHEN t.a_hash = ?1 THEN t.a_cleared_at ELSE t.b_cleared_at END, 0) ' +
    'AND ' + dmLive(now) + ')';
}

/* A side that deleted the conversation sees only words newer than its clear
   stamp. ?1 is the viewer; t must be the thread row in scope. */
export const DM_CLEARED = 'm.created_at > COALESCE(CASE WHEN t.a_hash = ?1 THEN t.a_cleared_at ELSE t.b_cleared_at END, 0)';

/* Disappearing-message + media tunables, and the growing admin key/value store
   behind them (app_settings). A missing key falls back to these defaults; the
   admin console (Phase 3) edits the table and busts this per-isolate cache. */
export const DM_TTLS = Dm.ttlOptions.map((o) => o.secs);   // single-sourced from Domain.Dm
export const MEDIA_CAP_BYTES = 10 * 1024 * 1024 * 1024;   // R2 free tier: 10 GB
export const APP_SETTING_DEFAULTS = {
  media_enabled: '1',
  media_max_bytes: String(25 * 1024 * 1024),   // 25 MB per upload
  dm_default_ttl: String(Dm.defaultTtl),        // 30 days (single-sourced from Domain.Dm)
  dm_backstop_days: '30',                       // unopened-message backstop
  dm_media_bytes: '0',                          // sweep-maintained total, display-only
  wall_prune_enabled: '0',                      // public posts persist forever until this is turned on
  wall_prune_days: '365',                       // retention when pruning is enabled
  discord_forum_webhook: '',                    // optional Discord webhook for new forum posts (empty = off)
  discord_feed_webhook: '',                     // optional Discord webhook for new feed posts (empty = off)
  journal_topic: '219',                         // the forum topic whose posts become Journal articles
  journal_enabled: '1',                         // whether the Mere Catholicity Journal page is live
};
export const appSettingsCache: { at: number; s: any } = { at: 0, s: null };
export async function getAppSettings(env: any) {
  const now = Date.now();
  if (appSettingsCache.s && now - appSettingsCache.at < 300000) return appSettingsCache.s;
  const s: any = Object.assign({}, APP_SETTING_DEFAULTS);
  try {
    const rows = await env.DB.prepare('SELECT k, v FROM app_settings').all();
    for (const r of (rows.results || [])) s[r.k] = r.v;
  } catch (e) { /* fresh DB: defaults stand */ }
  appSettingsCache.at = now; appSettingsCache.s = s;
  return s;
}
export function dmDefaultTtl(s: any) { return Number(s.dm_default_ttl) || Dm.defaultTtl; }
export function dmBackstopSeconds(s: any) { return (Number(s.dm_backstop_days) || 30) * 86400; }

/* ================= Discord webhook fan-out =================
   Two OPTIONAL webhooks (forum posts, feed posts) live in app_settings as full
   Discord webhook URLs; empty = off. The URL is validated by isDiscordWebhook
   (pure.js) so a corrupted/hostile setting can never make the worker POST member
   content to an arbitrary host. Member text rides ONLY in an embed (embeds never
   ping) and allowed_mentions is emptied, so no post body can @everyone or @here
   the channel. Fire-and-forget with a hard timeout: a dead or slow webhook never
   delays or breaks a post. Callers exclude the back room. */
export async function sendDiscord(hookUrl: any, embed: any): Promise<void> {
  if (!isDiscordWebhook(hookUrl)) return;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 5000);
  try {
    await fetch(hookUrl.trim(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'Mere Catholicity',
        embeds: [embed],
        allowed_mentions: { parse: [] },
      }),
      signal: ctl.signal,
    });
  } catch (e) { /* a dead webhook must never break a post */ }
  finally { clearTimeout(timer); }
}

/* Send. The same wall as posting: throttle, ban, Turnstile. A block by the
   recipient does NOT refuse the send: the message is stored held, reads as
   delivered to its sender, and stays invisible to the recipient until an
   unblock releases it. The blocked party is never told. */
export async function sendSystemDm(env: any, fromHash: any, toHash: any, body: any) {
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
export async function purgeMediaKeys(env: any, keys: any) {
  if (!keys || !keys.length) return;
  if (env.MEDIA) {
    for (let i = 0; i < keys.length; i += 1000) {
      try { await env.MEDIA.delete(keys.slice(i, i + 1000)); } catch (e) { /* keep going */ }
    }
  }
  for (let i = 0; i < keys.length; i += 50) {
    const chunk = keys.slice(i, i + 50);
    const ph = inList(chunk.length);
    try { await env.DB.prepare('DELETE FROM dm_media WHERE key IN (' + ph + ')').bind(...chunk).run(); } catch (e) { /* keep going */ }
  }
}

/* Recompute the total DM-media storage, cache it for the upload gate + admin
   display, and — only if near the 10 GB free-tier wall — emergency-prune the
   oldest media (LRU) until back under 90%, nulling the message's media pointer so
   the client shows it as expired. Normal message-expiry keeps us far from this. */
export async function enforceMediaCap(env: any) {
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
        const ph = inList(chunk.length);
        try { await env.DB.prepare('UPDATE dms SET media_key = NULL, media_size = NULL WHERE id IN (' + ph + ')').bind(...chunk).run(); } catch (e) { /* keep going */ }
      }
    }
  }
  try {
    await env.DB.prepare(
      "INSERT INTO app_settings (k, v, updated_at) VALUES ('dm_media_bytes', ?1, ?2) ON CONFLICT(k) DO UPDATE SET v = ?1, updated_at = ?2"
    ).bind(String(total), Math.floor(Date.now() / 1000)).run();
    appSettingsCache.at = 0; appSettingsCache.s = null;
  } catch (e) { /* display-only cache; ignore */ }
}

/* The hourly sweep: hard-delete expired, unsaved messages (and their R2 media),
   prune orphaned/dangling media, tidy empty threads, and keep the media total
   fresh. Read-time filtering already hides expired messages instantly; this is
   the storage-reclamation pass. Each step is isolated so one failure never stops
   the rest. */
export async function sweepExpiredDms(env: any) {
  const now = Math.floor(Date.now() / 1000);
  try {
    const gone = await env.DB.prepare(
      'SELECT media_key FROM dms WHERE expires_at IS NOT NULL AND expires_at < ?1 AND COALESCE(saved, 0) = 0 AND media_key IS NOT NULL LIMIT 5000'
    ).bind(now).all();
    const keys = (gone.results || []).map((r: any) => r.media_key).filter(Boolean);
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
      await purgeMediaKeys(env, rows.map((r: any) => r.key).filter(Boolean));
      const ids = rows.map((r: any) => r.msg_id).filter(Boolean);
      for (let i = 0; i < ids.length; i += 50) {
        const chunk = ids.slice(i, i + 50);
        const ph = inList(chunk.length);
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
    await purgeMediaKeys(env, (orphan.results || []).map((r: any) => r.key));
  } catch (e) { /* keep going */ }
  try { await sweepDms(env); } catch (e) { /* empty-thread tidy */ }
  try { await enforceMediaCap(env); } catch (e) { /* cap/accounting */ }
}

/* A random opaque R2 object id for a DM media blob. Reveals nothing about who
   uploaded it or to whom, so the bucket cannot be traced to a member. */
export function randomHex(n: any) {
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
export const WALL_PER_PAGE = 20;
// Object-key shape: wall/<kind>/<64hex>, kind i=image v=video a=audio (the client
// picks <img>/<video>/<audio> from the kind — no mime column or JOIN needed).
export const WALL_MEDIA_RE = /^wall\/[iva]\/[0-9a-f]{64}$/;
export const WALL_POST_COLS = 'p.id, p.author_hash, pr.nick, pr.avatar, pr.faith, p.body, p.created_at, p.edited_at, p.media_key, p.media_size, p.comments, (SELECT COUNT(*) FROM wall_likes wl WHERE wl.post_id = p.id) AS likes';
export const WALL_COMMENT_COLS = 'c.id, c.post_id, c.author_hash, pr.nick, pr.avatar, pr.faith, c.body, c.created_at, c.media_key, c.media_size';

/* Add the author display fields (assigned pseudonym + rank) the client renders,
   mirroring the forum's withNames. nick/avatar/faith are already joined in. */
export async function wallEnrich(env: any, rows: any, me: any) {
  const list = rows || [];
  const counts = await postCountsFor(env, list.map((r: any) => r.author_hash));
  /* Which of these POST rows the viewer has liked. A post row carries the `likes`
     COUNT (from WALL_POST_COLS); a comment row does not, so it never gets a like
     flag. One batched point-lookup over the post ids. */
  let liked = new Set();
  const postIds = list.filter((r: any) => r.likes !== undefined && r.likes !== null).map((r: any) => r.id);
  if (me && postIds.length) {
    const ph = inList(postIds.length, 2);
    const lr = await env.DB.prepare('SELECT post_id FROM wall_likes WHERE author_hash = ?1 AND post_id IN (' + ph + ')').bind(me, ...postIds).all();
    liked = new Set((lr.results || []).map((x: any) => x.post_id));
  }
  return list.map((r: any) => {
    const out = withNames(r, counts[r.author_hash] || 0);
    if (r.likes !== undefined && r.likes !== null) { out.likes = Number(r.likes) || 0; out.liked = liked.has(r.id) ? 1 : 0; }
    return out;
  });
}

/* The wall's own notifications (kind 'wall', comment_id = the post id, jumps to
   ?post=<id>): a comment tells the post author, and an @mention tells the picked
   member. Reuses the private user:<hash> live push. */
export async function deliverWallNotifications(env: any, o: any) {
  const now = Math.floor(Date.now() / 1000);
  const NOTIF = 'INSERT INTO notifications (recipient_hash, kind, topic_id, comment_id, actor_hash, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)';
  const stmts: any[] = [];
  const live: any[] = [];
  const pushComment = new Set();   // native-push recipients, split by copy (disjoint via `seen`)
  const pushMention = new Set();
  const seen = new Set([o.authorHash, MERECAT_BOT.hash]);
  // topic_id encodes the wall sub-kind for the label: 1 = a comment on your post,
  // 0 = an @mention. comment_id is always the post id (jumps to ?post=<id>).
  const add = (h: any, commented: any) => {
    const flag = commented ? 1 : 0;
    stmts.push(env.DB.prepare(NOTIF).bind(h, 'wall', flag, o.postId, o.authorHash, now));
    live.push({ v: 1, t: 'notification', scopes: ['user:' + h], kind: 'wall', topic_id: flag, comment_id: o.postId, actor_hash: o.authorHash, created_at: now });
    (commented ? pushComment : pushMention).add(h);
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
  const postUrl = '/feed.html?post=' + o.postId;
  if (pushComment.size) {
    await deliverPush(env, [...pushComment], { kind: 'wall', title: 'New comment', body: 'Someone commented on your post', url: postUrl });
  }
  if (pushMention.size) {
    await deliverPush(env, [...pushMention], { kind: 'wall', title: 'You were mentioned', body: 'Someone mentioned you in a post', url: postUrl });
  }
}

/* Shared R2 purge for public post/comment media (mirror of purgeMediaKeys). */
export async function purgeWallMedia(env: any, keys: any) {
  if (!keys || !keys.length) return;
  if (env.WALLMEDIA) {
    for (let i = 0; i < keys.length; i += 1000) {
      try { await env.WALLMEDIA.delete(keys.slice(i, i + 1000)); } catch (e) { /* keep going */ }
    }
  }
  for (let i = 0; i < keys.length; i += 50) {
    const chunk = keys.slice(i, i + 50);
    const ph = inList(chunk.length);
    try { await env.DB.prepare('DELETE FROM wall_media WHERE key IN (' + ph + ')').bind(...chunk).run(); } catch (e) { /* keep going */ }
  }
}

/* Reclaim public-media objects with no live owner: an upload that was never
   attached to a post (older than an hour), or one whose post/comment is gone. */
export async function sweepWallOrphanMedia(env: any) {
  const now = Math.floor(Date.now() / 1000);
  try {
    const orphan = await env.DB.prepare(
      'SELECT key FROM wall_media WHERE (ref_id IS NULL AND created_at < ?1) ' +
      "OR (ref_type = 'post' AND ref_id NOT IN (SELECT id FROM wall_posts)) " +
      "OR (ref_type = 'comment' AND ref_id NOT IN (SELECT id FROM wall_comments)) LIMIT 2000"
    ).bind(now - 3600).all();
    await purgeWallMedia(env, (orphan.results || []).map((r: any) => r.key));
  } catch (e) { /* keep going */ }
}

/* Read gate shared by the members-only feed/wall/post reads. Returns the member
   hash, or a Response to return immediately (401 / blocked / 429). */
export async function wallReader(request: any, env: any, data: any) {
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
export async function notifyWallLike(env: any, toHash: any, fromHash: any, postId: any) {
  try {
    if (!toHash || !fromHash || toHash === fromHash) return;
    const now = Math.floor(Date.now() / 1000);
    /* First reopen a previously-READ like-notification from this liker on this post
       (a fresh like after the author already saw the last one) rather than minting a
       new row — so re-liking can never pile up rows: there is ever at most ONE
       (recipient, actor, post) row. Both writes require the like to STILL exist
       (EXISTS wall_likes), which closes the like/unlike race: if a concurrent unlike
       already removed the like, neither fires and no orphan notification is left. */
    const up = await env.DB.prepare(
      "UPDATE notifications SET read_at = NULL, created_at = ?4 " +
      "WHERE recipient_hash = ?1 AND kind = 'wall-like' AND actor_hash = ?3 AND comment_id = ?2 AND read_at IS NOT NULL " +
      "AND EXISTS (SELECT 1 FROM wall_likes WHERE post_id = ?2 AND author_hash = ?3)"
    ).bind(toHash, postId, fromHash, now).run();
    let rang = up.meta && up.meta.changes > 0;
    if (!rang) {
      /* No read row to reopen: insert one, but only if the like stands AND there is
         no existing row at all (an already-unread one is left as-is — no re-ring). */
      const ins = await env.DB.prepare(
        "INSERT INTO notifications (recipient_hash, kind, topic_id, comment_id, actor_hash, created_at) " +
        "SELECT ?1, 'wall-like', 0, ?2, ?3, ?4 WHERE " +
        "EXISTS (SELECT 1 FROM wall_likes WHERE post_id = ?2 AND author_hash = ?3) AND " +
        "NOT EXISTS (SELECT 1 FROM notifications WHERE recipient_hash = ?1 AND kind = 'wall-like' AND actor_hash = ?3 AND comment_id = ?2)"
      ).bind(toHash, postId, fromHash, now).run();
      rang = ins.meta && ins.meta.changes > 0;
    }
    if (rang) {
      await publishUser(env, [{ v: 1, t: 'notification', scopes: ['user:' + toHash],
        kind: 'wall-like', topic_id: 0, comment_id: postId, actor_hash: fromHash, created_at: now }]);
    }
  } catch (e) {
    console.log(JSON.stringify({ event: 'notify_wall_like_failed', error: String(e) }));
  }
}

/* Validate an attached media_key: it must be an unlinked wall_media row. Returns
   { key, size } or null. */
export async function wallClaimMedia(env: any, mediaKey: any) {
  if (!mediaKey || !WALL_MEDIA_RE.test(String(mediaKey))) return null;
  const mr = await env.DB.prepare('SELECT size FROM wall_media WHERE key = ?1 AND ref_id IS NULL').bind(String(mediaKey)).first();
  return mr ? { key: String(mediaKey), size: mr.size } : null;
}

/* Create a post on my own wall (author = me), which also lands it in the feed.
   Turnstile + AI screen (held-if-flagged) exactly like a forum comment. */
export async function runWallPrune(env: any, days: any) {
  const cutoff = Math.floor(Date.now() / 1000) - Wall.clampPruneDays(days) * 86400;
  let deleted = 0;
  try {
    const pm = await env.DB.prepare('SELECT media_key FROM wall_posts WHERE created_at < ?1 AND media_key IS NOT NULL LIMIT 5000').bind(cutoff).all();
    const keys = (pm.results || []).map((r: any) => r.media_key);
    const cm = await env.DB.prepare('SELECT media_key FROM wall_comments WHERE media_key IS NOT NULL AND (created_at < ?1 OR post_id IN (SELECT id FROM wall_posts WHERE created_at < ?1)) LIMIT 5000').bind(cutoff).all();
    (cm.results || []).forEach((r: any) => keys.push(r.media_key));
    if (keys.length) await purgeWallMedia(env, keys);
    await env.DB.prepare('DELETE FROM wall_comments WHERE created_at < ?1 OR post_id IN (SELECT id FROM wall_posts WHERE created_at < ?1)').bind(cutoff).run();
    await env.DB.prepare('DELETE FROM wall_likes WHERE post_id IN (SELECT id FROM wall_posts WHERE created_at < ?1)').bind(cutoff).run();
    const del = await env.DB.prepare('DELETE FROM wall_posts WHERE created_at < ?1').bind(cutoff).run();
    deleted = (del.meta && del.meta.changes) || 0;
  } catch (e) { console.log(JSON.stringify({ event: 'prune_wall_failed', error: String(e) })); }
  return deleted;
}

/* Cron entry (monthly chain): prune only when the admin turned it on. */
export async function pruneWallPosts(env: any) {
  const s = await getAppSettings(env);
  if (s.wall_prune_enabled !== '1') return;
  await runWallPrune(env, Number(s.wall_prune_days) || 365);
}

/* Admin "prune now" — runs regardless of the enabled flag, using the configured
   (or a passed) retention. */
export async function boardFloor(env: any, me: any) {
  const row = await env.DB.prepare('SELECT read_at FROM thread_reads WHERE hash = ?1 AND topic_id = 0').bind(me).first();
  return row ? row.read_at : null;
}

/* Unread summary for the board index. On a reader's first-ever call the floor is
   set to now, so nothing before this visit reads as new (start-all-read). */
export const MAX_AVATAR_BYTES = 1024 * 1024;
/* Avatars are square (round display, one R2 key per identity) but no longer a
   fixed 400px: any square in this range is stored as-is and the CSS caps the
   display size. Historical 400x400 avatars sit comfortably inside the range. */
export const AVATAR_MIN = 96;
export const AVATAR_MAX = 1024;

export function be16(b: any, i: any) { return (b[i] << 8) | b[i + 1]; }

/* Returns {mime, width, height} or null. Only the three raster formats a
   browser canvas emits are recognized; everything else is refused. */
export function sniffImage(b: any) {
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
export async function screenImage(env: any, bytes: any) {
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
export function sqlLit(v: any) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  return "'" + String(v).replace(/'/g, "''") + "'";
}

/* A restorable dump: every user table's CREATE (as IF NOT EXISTS) and rows,
   then the indexes. Explicit ids in the INSERTs carry the AUTOINCREMENT
   sequence along on their own. */
export async function dumpDatabase(env: any) {
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
          .map((r: any) => '(' + cols.map((c) => sqlLit(r[c])).join(', ') + ')').join(',\n');
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

export async function gzipBytes(text: any) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export const BACKUP_KEEP_DAYS = 90;

/* The Known-IPs history is not a ledger: rows idle past IP_KEEP_DAYS go, and
   banned keys stay whatever their age so a standing ban keeps its handle in
   the drawer. One statement, once a month, riding the backup cron. */
export async function pruneIdentityIps(env: any) {
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
export async function pruneComments(env: any) {
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
export async function sweepDms(env: any) {
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
export async function pruneNotifications(env: any) {
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
    /* Wall notifications ('wall' comment/mention, 'wall-like') carry comment_id =
       the post id; sweep any whose post is gone. */
    const r = await env.DB.prepare(
      "DELETE FROM notifications WHERE kind IN ('wall','wall-like') AND comment_id NOT IN (SELECT id FROM wall_posts)"
    ).run();
    console.log(JSON.stringify({ event: 'notif_wall_orphan_sweep', deleted: r.meta && r.meta.changes || 0 }));
  } catch (e) {
    console.log(JSON.stringify({ event: 'notif_wall_orphan_sweep_failed', error: String(e) }));
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

export async function runBackup(env: any) {
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
export async function requireAdmin(env: any, key: any) {
  return !!key && (await isAdminHash(env, await sha256hex(key)));
}

/* Lock or unlock an identity: a reversible disable that logs the holder out
   and refuses every keyed interaction until reversed. */
export const MERECAT_DEFAULTS = {
  model: '@cf/qwen/qwen3-30b-a3b-fp8',
  user_cap_on: 0,     // per-member daily cap: 0 = off (community budget is the only wall)
  user_daily: 10,     // questions per member per UTC day, when the cap is on
  global_daily: 150,  // questions across the community per UTC day
  topk: 10,           // chunks handed to the model (the 4-8-citation rule needs headroom)
  max_tokens: 1100,
};
export const MERECAT_SITE = 'https://merecatholicity.com/';
/* Six weight bands, the site owner's own ladder: the site's works and its
   catechetical core, the Scriptures, the named works of the Fathers, the
   councils and the schism documents, the deep Schaff/Summa sets, and Newman
   entire. Band feeds the retrieval boost, the prompt label, and the
   transparency panel's grouping. */
export const MERECAT_TIER_LABEL = {
  1: 'site position', 2: 'scripture', 3: 'the Fathers',
  4: 'councils, confessions, and the schism', 5: 'deep shelf', 6: 'Newman',
  7: 'the Roman world', 8: 'the worldview shelf', 9: "the scholars' shelf",
};
export const MERECAT_RESTING =
  'merecat is resting. The community’s shared daily budget is spent. It resets at midnight UTC.';

/* The librarian's public face on the board: a pseudo-member that exists only
   as this fixed hash (the preimage was random and discarded, so no key can
   ever produce it — nobody can post as the bot). It holds no subscriptions,
   cannot be DMed (handleDmSend refuses, the directory omits it), and is
   summoned one way: writing @merecat in a live forum post or article-page
   comment, which runs merecatMentionReply. */
export const MERECAT_BOT = {
  hash: 'efb94d8de69dc537e2bba1facbd9db3f849f3927593488d19c07629ce35f54cc',
  nick: 'merecat 🐈 AI BOT',
};
export const MERECAT_MENTION_RE = /@merecat\b/i;
/* A mention inside a quoted line is someone else's words: quoting a summons
   must not resummon (nor charge the quoter a question). Only unquoted text
   can call the librarian. */
export function merecatMentioned(body: any) {
  const unquoted = String(body || '').split('\n')
    .filter((l) => !/^\s*>/.test(l)).join('\n');
  return MERECAT_MENTION_RE.test(unquoted);
}
export const MERECAT_RV = 15;  // retrieval build: bump when retrieval logic changes

/* Config (persona, model, caps) lives in LIBDB so `make librarian` can change
   the bot's behavior with no redeploy. Cached per isolate for five minutes;
   a config push clears this isolate at once and the rest lag out the TTL. */
export const merecatConfigCache: { at: number; cfg: any } = { at: 0, cfg: null };

export async function merecatConfig(env: any) {
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
      else if (r.k in MERECAT_DEFAULTS) (cfg as any)[r.k] = Number(r.v) || (MERECAT_DEFAULTS as any)[r.k];
    }
  } catch (err) {
    console.log(JSON.stringify({ event: 'merecat_config_failed', error: String(err) }));
  }
  merecatConfigCache.at = Date.now(); merecatConfigCache.cfg = cfg;
  return cfg;
}

export function merecatDay() {
  return new Date().toISOString().slice(0, 10);
}

/* Strip <think>...</think> spans from a token stream, across chunk borders.
   qwen3 is a reasoning model with no documented off switch on Workers AI, so
   the persona carries /no_think and this filter guarantees no reasoning ever
   reaches the client either way. Holds back a small tail in case a tag is
   split between deltas; flush(null) drains it. */
export function merecatThinkStripper() {
  let carry = '';
  let inThink = false;
  let started = false; // trim leading whitespace once, after any think block
  return function feed(delta: any) {
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
export function merecatMatch(q: any) {
  return Fts.unSafeMatch(Fts.merecatMatch(String(q ?? '')));
}

/* The phrase leg: when a question carries a quotation, its own word runs
   are the strongest possible scent — a text that IS the quote nails a
   six-word phrase that texts merely discussing it rarely reproduce. Slide
   windows over the question's tokens (stopwords kept, phrases need them)
   and offer the longest few as FTS phrase alternatives. */
export function merecatPhrases(q: any) {
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
export const MERECAT_BIBLE = (() => {
  const spec = [
    // The 66-book KJV core is single-sourced from Domain.Scripture (the same
    // table the client autolinks against), so the "must stay in step" hazard
    // cannot recur. Only the Vulgate namings and deuterocanon below are added.
    ...Scripture.bibleSpec.map((r: any) => [r.slug, r.spellings.join('|')]),
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
  const map: any = {}; const forms = [];
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
export const MERECAT_KJV2DR = {
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

export async function merecatVerseSeats(env: any, q: any, add: any) {
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
      for (const s of new Set([j.slug, (MERECAT_KJV2DR as any)[j.slug] || j.slug])) {
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
export function merecatScrub(t: any, keepNl?: any) {
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
export async function merecatRetrieve(env: any, q: any, cfg: any) {
  const pool = new Map(); // cid -> chunk row stub
  const add = (r: any, sem: any, phr?: any) => {
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
      semIds = (res && res.matches ? res.matches : []).map((m: any) => m.id);
    }
  } catch (err) {
    console.log(JSON.stringify({ event: 'merecat_semantic_failed', error: String(err) }));
  }
  if (semIds.length) {
    // hydrate matches from whichever room holds them: vectorized works may
    // live in any database (the worldview core rides deep2)
    const byCid: any = {};
    const ph = inList(semIds.length);
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
        .filter((s: any) => s && Number.isInteger(s.id) && candidates[s.id])
        .sort((a: any, b: any) => b.score - a.score);
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
export async function merecatPrompt(env: any, q: any, history: any, summary: any, cfg: any) {
  const chunks = await merecatRetrieve(env, q, cfg);
  const sources = chunks.map((c, i) => ({
    n: i + 1, title: merecatScrub(c.title), heading: merecatScrub(c.heading),
    url: !c.url ? '' : /^https?:\/\//.test(c.url) ? c.url : MERECAT_SITE + c.url + (c.anchor ? '#' + c.anchor : ''),
  }));
  let srcBlock = '';
  chunks.forEach((c, i) => {
    srcBlock += '[' + (i + 1) + '] (' + ((MERECAT_TIER_LABEL as any)[c.tier] || 'shelf') + ') ' + merecatScrub(c.title) +
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
export async function merecatLocalFetch(env: any, body: any, ctl?: any) {
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
        let refuse: any = null;
        try { refuse = await r.json(); } catch { /* not JSON */ }
        if (refuse && refuse.busy) return { busy: true };
        return null;
      }
      if (r.ok && r.body) return r;
      retriable = r.status >= 500;
      console.log(JSON.stringify({ event: 'merecat_local_unreachable', status: r.status, attempt }));
    } catch (err) {
      clearTimeout(headerTimer);
      retriable = (Date.now() - t0) < 5000 && !(err && (err as any).name === 'AbortError');
      console.log(JSON.stringify({ event: 'merecat_local_unreachable', error: String(err), attempt }));
    }
    if (!retriable || attempt >= 2) return null;
    await new Promise((res) => setTimeout(res, 400 + attempt * 500));
  }
}

/* Read a local answer fully — for @merecat mentions, which post a comment
   rather than stream to a browser. Skips any leading {queue} notices, reads
   the {sources} header, and returns { sources, answer } or null. */
export async function merecatLocalRead(env: any, body: any) {
  // A whole-call deadline: a mention read runs inside waitUntil, where a hung
  // local stream would otherwise park until the runtime kills the invocation.
  const ctl = new AbortController();
  const resp: any = await merecatLocalFetch(env, body, ctl);
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

export const MERECAT_WINDOW = 10;   // newest turns sent verbatim
export const MERECAT_FOLD_MIN = 4;  // fold only when this many turns have aged out

export async function merecatFold(env: any, cfg: any, chatId: any) {
  try {
    const chat = await env.LIBDB.prepare(
      'SELECT summary, summarized_to FROM chats WHERE id = ?1').bind(chatId).first();
    if (!chat) return;
    const all = await env.LIBDB.prepare(
      'SELECT id, role, body FROM chat_msgs WHERE chat_id = ?1 AND COALESCE(done, 1) = 1 ORDER BY id').bind(chatId).all();
    const rows = all.results || [];
    if (rows.length <= MERECAT_WINDOW) return;
    const cutoff = rows[rows.length - MERECAT_WINDOW].id;
    const aged = rows.filter((r: any) => r.id < cutoff && r.id > (chat.summarized_to || 0));
    if (aged.length < MERECAT_FOLD_MIN) return;
    const notes = aged.map((r: any) =>
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
export const MERECAT_CHAT_DAYS = 30;

export async function pruneMerecatChats(env: any) {
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
export async function merecatEnsureProfile(env: any) {
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

export async function merecatNames(env: any, hashes: any) {
  const uniq = [...new Set(hashes.filter((h: any) => h))];
  const out: any = {};
  if (!uniq.length) return out;
  const ph = inList(uniq.length);
  const rows = await env.DB.prepare(
    'SELECT hash, nick FROM profiles WHERE hash IN (' + ph + ')').bind(...uniq).all();
  for (const r of rows.results || []) if (r.nick) out[r.hash] = r.nick;
  return out;
}

/* Post the bot's comment: a reply under the topic on the board, a flat (or
   same-parent) comment on an article page. Board replies bump the topic and
   fan out notifications like anyone's reply, so the asker hears back. */
export async function merecatInsertComment(env: any, src: any, isBoard: any, topicId: any, topicAuthorHash: any, body: any) {
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
export function merecatFinishAnswer(answer: any, sources: any) {
  const firstAt = new Map();
  answer.replace(/\[(\d+)\]/g, (m: any, n: any, at: any) => {
    const num = Number(n);
    if (sources.some((s: any) => s.n === num) && !firstAt.has(num)) firstAt.set(num, at);
    return m;
  });
  const order = [...firstAt.keys()].sort((a, b) => firstAt.get(a) - firstAt.get(b));
  const renum = new Map(order.map((n, i) => [n, i + 1]));
  if (renum.size) {
    answer = answer.replace(/\[(\d+)\]/g, (m: any, n: any) =>
      renum.has(Number(n)) ? '[' + renum.get(Number(n)) + ']' : m);
    const cited = sources.filter((s: any) => renum.has(s.n))
      .sort((a: any, b: any) => renum.get(a.n)! - renum.get(b.n)!);
    const label = (s: any) => merecatScrub(s.title + (s.heading ? ' — ' + s.heading : ''))
      .replace(/\[/g, '(').replace(/\]/g, ')');
    answer += '\n\nSources:\n' + cited.map((s: any) =>
      '[' + renum.get(s.n) + '] ' + (s.url ? '[' + label(s) + '](' + s.url + ')' : label(s))).join('\n');
  }
  return answer;
}

export async function merecatMentionReply(env: any, commentId: any) {
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
  const nameOf = (h: any) => names[h] || (h === MERECAT_BOT.hash ? MERECAT_BOT.nick : 'a member');
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
      srcBlock += '[' + (i + 1) + '] (' + ((MERECAT_TIER_LABEL as any)[cc.tier] || 'shelf') + ') ' + merecatScrub(cc.title) +
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
export function sendToHub(env: any, event: any) {
  if (!env.HUB || !boardEventPublic(event)) return Promise.resolve();
  return env.HUB.get(env.HUB.idFromName('board')).publish(event);
}

/* Publish a batch of board events (awaitable), with a cheap page pre-gate (a
   non-board or admins-only page emits nothing). Each event still passes the
   central gate in sendToHub. Shared by broadcastBoard and the bot's inline reply. */
export async function publishBoardEvents(env: any, page: any, events: any) {
  if (!boardKey(page) || page === ADMIN_CAT) return;
  const list = Array.isArray(events) ? events : [events];
  for (const e of list) await sendToHub(env, e);
}

/* The board-broadcast sink: fire-and-forget, env-guarded, deferred via waitUntil
   so it never delays or breaks the write. `events` is an array, or a function
   returning one (sync or async) for sites that must query per-event data — the
   page pre-gate runs first, so the builder is skipped for the back room. */
export function broadcastBoard(env: any, ctx: any, page: any, events: any) {
  if (!env.HUB || !boardKey(page) || page === ADMIN_CAT) return;
  ctx.waitUntil((async () => {
    const list = typeof events === 'function' ? await events() : events;
    await publishBoardEvents(env, page, list);
  })().catch((e) => console.log(JSON.stringify({ event: 'publish_failed', error: String(e) }))));
}

/* Fire-and-forget a single live event through the one sink; deferred via
   waitUntil so it never delays or breaks a write. */
export function publishLive(env: any, ctx: any, event: any) {
  if (!env.HUB) return;
  ctx.waitUntil(sendToHub(env, event)
    .catch((e: any) => console.log(JSON.stringify({ event: 'publish_failed', error: String(e) }))));
}

/* Fire PRIVATE per-member live events (DMs, notifications) through the one hub.
   Each event is scoped to a single 'user:<hash>', which the DO fans only to
   sockets that authenticated as that hash — so a member's own connections alone
   receive it. Awaitable: a caller already inside a waitUntil (deliverNotifications)
   just awaits it; a plain handler passes ctx to publishLive-style fire-and-forget. */
export async function publishUser(env: any, events: any) {
  if (!env.HUB) return;
  const list = (Array.isArray(events) ? events : [events]).filter(Boolean);
  for (const e of list) await sendToHub(env, e);
}

/* merecat over WebSockets (Phase 2). ask-init mints (or verifies) the
   conversation and returns its id BEFORE the socket opens, so the client adopts
   ?chat=<id> at once and dials the ChatRoom instance that matches the id (the DO
   name = 'chat:'+id, so a reconnect always reaches the same generator). */
export class MetaAttr {
  declare value: any;
  constructor(value: any) { this.value = value; }
  element(el: any) { el.setAttribute('content', this.value); }
}
export class TitleText {
  declare value: any;
  /* NB: the field is `value`, not `text` — HTMLRewriter treats a `text` field on
     a handler object as a text-node handler (must be a function), so naming it
     `text` makes .on() reject the handler. */
  constructor(value: any) { this.value = value; }
  element(el: any) { el.setInnerContent(this.value); }
}

/* Serve /@handle: fetch the static profile.html from the origin and inject the
   member's share-card OG (title/description/image/url), so a shared /@handle
   previews as the person. Everyone gets the real page; the client resolves the
   handle from the URL path. Bulletproof: any failure falls back to the plain
   page or a redirect to the ?u= form, so /@handle is never broken. */
