/* lib.ts — the comments worker's shared core: constants, crypto, auth,
   validation, and the DB / notification / broadcast helpers. Everything that is
   NOT a request handler, a Durable Object, or the route dispatch. index.ts and
   the route modules import from here — a one-way DAG (core references no handler). */
import * as Rank from '../../purescript/output/Domain.Rank/index.js';
import * as Pseudonym from '../../purescript/output/Domain.Pseudonym/index.js';
import * as Faith from '../../purescript/output/Domain.Faith/index.js';
import * as Profile from '../../purescript/output/Domain.Profile/index.js';
import * as Dm from '../../purescript/output/Domain.Dm/index.js';
import * as Reaction from '../../purescript/output/Domain.Reaction/index.js';
import * as Notif from '../../purescript/output/Domain.Notif/index.js';
import * as Scripture from '../../purescript/output/Domain.Scripture/index.js';
import * as Fts from '../../purescript/output/Domain.Fts/index.js';
import * as Board from '../../purescript/output/Domain.Board/index.js';
import * as Emoji from '../../purescript/output/Domain.Emoji/index.js';
import * as Presence from '../../purescript/output/Domain.Presence/index.js';
import * as Handle from '../../purescript/output/Domain.Handle/index.js';
import * as Links from '../../purescript/output/Domain.Links/index.js';
import * as Wall from '../../purescript/output/Domain.Wall/index.js';
import * as Turnstile from '../../purescript/output/Domain.Turnstile/index.js';
import * as Prefs from '../../purescript/output/Domain.Prefs/index.js';
import * as Media from '../../purescript/output/Domain.Media/index.js';
import * as CallK from '../../purescript/output/Domain.Call/index.js';
import * as Merecat from '../../purescript/output/Domain.Merecat/index.js';
import * as Auth from '../../purescript/output/Domain.Auth/index.js';
import * as Comments from '../../purescript/output/Domain.Comments/index.js';
import * as Ops from '../../purescript/output/Domain.Ops/index.js';
import * as Hub from '../../purescript/output/Domain.Hub/index.js';
import * as Throttle from '../../purescript/output/Domain.Throttle/index.js';
import * as MaybeM from '../../purescript/output/Data.Maybe/index.js';
import type { Env } from './env.ts';
// Pure, dependency-free helpers (IP/ban-key normalization + back-room privacy),
// extracted so they can be unit-tested in plain Node. See src/pure.ts. (pure.ts
// also exports ipv6Groups/ipv6Prefix64/ipv6Full/isSharedV4, used internally
// there or client-side; imported here only what index.js calls directly.)
import {
  ipFamily, ipKey, toBanKey, reverseDnsName, looksLikeIp, boardEventPublic, sanitizeScopes,
  isDiscordWebhook, discordSnippet, shadowExcl, parseFeedScope, scopeLabel, journalArticle,
} from './pure.ts';
export { isDiscordWebhook, discordSnippet, shadowExcl, parseFeedScope, scopeLabel, journalArticle };   // re-exported so index.ts imports them from here
// Real Web Push (VAPID + aes128gcm) on crypto.subtle — no external service.
import { createPusher } from './webpush.ts';
// Repository layer: bind-placeholder helpers + identity mappers (see db.ts).
import { inList, rankFor, withNames, postCountsFor } from './db.ts';
import type { AuthoredRow } from './db.ts';
import type { EnvFree, NotEnv } from './env.ts';
/* The librarian's AI budget guard: its own module (no lib import, Node-
   tested), re-exported below so the ChatRoom and the handlers keep one
   import site for the librarian helpers. */
import { merecatQuota, quotaPublic } from './quota.ts';
export { merecatQuota, quotaPublic };

/* ---- The rate limiter (2026-09-17; the rule is Domain.Throttle) ----
   Every limit in the worker goes through `throttle`. A request that names an
   identity counts against THAT MEMBER's bucket (`bucket`, keyed "m:<hash>"),
   so members behind one address — a parish Wi-Fi, a carrier's shared IP —
   no longer spend each other's allowance; and every request also counts
   against the per-address backstop (`*_IP_LIMIT`, sized for a congregation),
   because the key is only claimed here, not proven: rotating keys escapes a
   member bucket, never the backstop. A keyless request counts against the
   backstop alone; without a backstop binding it falls back to `bucket` keyed
   by address, the behaviour before this change. Nothing else in the worker
   may call `.limit(` (tests/worker/throttle.test.mjs sweeps for it). */
export type Bucket = 'READ_LIMIT' | 'POST_LIMIT' | 'CONNECT_LIMIT';
const BACKSTOP: Record<Bucket, 'READ_IP_LIMIT' | 'POST_IP_LIMIT' | 'CONNECT_IP_LIMIT'> = {
  READ_LIMIT: 'READ_IP_LIMIT', POST_LIMIT: 'POST_IP_LIMIT', CONNECT_LIMIT: 'CONNECT_IP_LIMIT',
};
export type Who = { key?: unknown; hash?: string };
export async function throttle(env: Pick<Env, Bucket> & Partial<Pick<Env, 'READ_IP_LIMIT' | 'POST_IP_LIMIT' | 'CONNECT_IP_LIMIT'>>, bucket: Bucket, ip: string, who: Who = {}): Promise<boolean> {
  const rawKey = who.key == null ? '' : String(who.key);
  const hash = who.hash != null ? String(who.hash) : (rawKey ? await sha256hex(rawKey) : '');
  const member: string | null = psOrNull(Throttle.memberBucket(hash));
  const backstop = env[BACKSTOP[bucket]];
  const checks: Array<Promise<{ success: boolean }>> = [];
  if (member) checks.push(env[bucket].limit({ key: member }));
  if (backstop) checks.push(backstop.limit({ key: ip }));
  else if (!member) checks.push(env[bucket].limit({ key: ip }));
  const verdicts = await Promise.all(checks);
  return verdicts.every((v) => v.success);
}

/* The key floor (the 2026-09-17 review's P0, layer two). The hash the server
   publishes is one unsalted round of SHA-256 over the key, so a guessable key is
   a guessable account — offline, at GPU speed, with no request to rate-limit.
   The server cannot judge a key after the fact; it can judge it at the moment it
   is presented, which is every request, and that is what this is.
   Refused on WRITES only (`POST_LIMIT`): a weak key may still read, so a member
   who has one can sign in, see where they are and be told what to do rather
   than meeting a wall. Strong and generated keys never reach D1 here, so the
   floor costs the ordinary case nothing. `adminGated` reads it too — a cracked
   admin key that cannot write is the whole point, and the console's owner is
   subject to the same floor as everyone. The sentences are the kernel's
   (`Domain.Auth.keyRefusal`), so the client and the worker say the same thing.
   Every write road calls this, whether through the shared preamble or its own
   hand-rolled one (posting a comment, a feed post, a profile edit and the
   uploads keep their own order for a reason and do not use `gated`): the sweep
   in tests/worker/key_floor_reach.test.mjs runs a weak identity down the whole
   POST_LIMIT surface and fails if one road lets it write, because a floor with
   a hole is not a floor. */
export async function keyFloor(env: Env, bucket: Bucket | null | undefined, key: string): Promise<Response | null> {
  /* An EMPTY key is anonymity, not a weak identity: `key: 'optional'` roads let
     it through to hash to the empty identity, and their own rules answer it
     ("Not yours", and the like). Refusing it here would turn every one of those
     handlers' answers into a 400 about key strength. A strong or generated key
     returns before the hash is even computed — the ordinary case is free. */
  if (!key || bucket !== 'POST_LIMIT' || Auth.keyAcceptable(key)) return null;
  const me = await sha256hex(key);
  const known = !!(await env.DB.prepare('SELECT 1 AS v FROM profiles WHERE hash = ?1').bind(me).first());
  if (known && weakKeyTolerated()) return null;
  return json({ ok: false, error: Auth.keyRefusal(!known)(key), weak_key: true }, 400);
}

/* RETIRES 2026-10-18 (tests/_support/retirements.json). Until then a weak key
   with history behind it still writes: the key IS the account, there is no
   rotation road yet, and a member locked out on the day loses their posts,
   their messages and their profile with it. Thirty days is the notice; the
   ledger test goes red that morning so the choice is made deliberately —
   delete this and its caller above, and the floor holds for every write. */
function weakKeyTolerated(): boolean { return true; }

/* Keyed-request preamble, single-sourced. Parse the JSON body, rate-limit
   (per member, with the address backstop) on `bucket`, then require + hash
   the identity key. Returns the resolved
   {ip, data, key, me} or a Response to return early. `keyedGated` adds the
   blocked-identity gate (a locked/banned hash is refused). These replicate,
   verbatim, the preamble that used to open each keyed handler. */

export async function keyed(request: Request, env: Env, bucket: 'POST_LIMIT' | 'READ_LIMIT' | 'CONNECT_LIMIT'): Promise<Response | Gated> {
  const data = await readBody(request);
  if (!data) return json({ ok: false, error: 'Bad request.' }, 400);
  const ip = request.headers.get('CF-Connecting-IP') || '';
  if (!(await throttle(env, bucket, ip, { key: data && data.key }))) return json({ ok: false, error: 'Too many requests.' }, 429);
  const key = String(data.key || '');
  if (!key) return json({ ok: false, error: 'Bad request.' }, 400);
  const me = await sha256hex(key);
  const floor = await keyFloor(env, bucket, key);
  if (floor) return floor;
  return { ip, data, key, me };
}
export async function keyedGated(request: Request, env: Env, bucket: 'POST_LIMIT' | 'READ_LIMIT' | 'CONNECT_LIMIT'): Promise<Response | Gated> {
  const pre = await keyed(request, env, bucket);
  if (pre instanceof Response) return pre;
  const gate = await blockedReason(env, pre.me, pre.ip);
  if (gate) return blockedJson(gate);
  return pre;
}

/* The one preamble, with its variance made explicit (P2-1, 2026-09-16). Eighty
   handlers opened with the same eight lines — parse the body, rate-limit by IP,
   read the key, hash it, maybe the block gate — differing only in the 429
   sentence, whether a missing key is refused (and with what), and whether the
   block gate runs. `gated` takes those as options so a call site reads as what it
   does, and the texts stay exactly what the wire always said; a handler that
   validates BEFORE it rate-limits (a bad id must not cost a limiter token) keeps
   its own order and is not converted. `keyed`/`keyedGated` above are the two
   commonest shapes and stay as they are. */
export type GateOpts = {
  bucket?: 'POST_LIMIT' | 'READ_LIMIT' | null;   // null: no rate limit
  limited?: string;                              // the 429 sentence (default 'Too many requests.')
  key?: 'required' | 'optional';                 // optional: an empty key hashes to the empty identity, as before
  missing?: string;                              // the 400 sentence for a missing key (default 'Bad request.')
  block?: boolean;                               // the lock/ban gate (blockedReason → blockedJson)
};
/* A request body as the wire carries it: an object whose fields are unknown
   until the handler coerces them — which every handler does (String/Number/
   Array.isArray). A handler that parses for itself says `request.json<Body>()`;
   every gate hands one over (2026-09-17). */
export type Body = Record<string, unknown>;

/* The request's JSON body as a Body (a non-object reads as an empty one), or
   null when it does not parse. */
export async function readBody(request: Request): Promise<Body | null> {
  try { return bodyOf(await request.json()); } catch (e) { return null; }
}

/* A nested object in a body (`data.work`, `data.set`, `data.config`): the field
   when it is a plain object, else an empty one — so a string, an array or null
   where an object belongs reads as "nothing given", never as its characters. */
export function bodyOf(v: unknown): Body {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Body) : {};
}

export type Gated = { ip: string; data: Body; key: string; me: string };
export async function gated(request: Request, env: Env, o: GateOpts = {}): Promise<Response | Gated> {
  const data = await readBody(request);
  if (!data) return json({ ok: false, error: 'Bad request.' }, 400);
  const ip = request.headers.get('CF-Connecting-IP') || '';
  if (o.bucket && !(await throttle(env, o.bucket, ip, { key: data && data.key }))) {
    return json({ ok: false, error: o.limited || 'Too many requests.' }, 429);
  }
  const key = String((data && data.key) || '');
  if (o.key !== 'optional' && !key) return json({ ok: false, error: o.missing || 'Bad request.' }, 400);
  const me = await sha256hex(key);
  const floor = await keyFloor(env, o.bucket, key);
  if (floor) return floor;
  if (o.block) {
    const g = await blockedReason(env, me, ip);
    if (g) return blockedJson(g);
  }
  return { ip, data, key, me };
}

/* The admin preamble: parse, an optional limit, `requireAdmin` (403 "No."),
   the admin's own hash for `updated_by`. */
export async function adminGated(request: Request, env: Env, o: { bucket?: 'POST_LIMIT' | 'READ_LIMIT' | null; limited?: string } = {}): Promise<Response | Gated> {
  const data = await readBody(request);
  if (!data) return json({ ok: false, error: 'Bad request.' }, 400);
  const ip = request.headers.get('CF-Connecting-IP') || '';
  if (o.bucket && !(await throttle(env, o.bucket, ip, { key: data && data.key }))) {
    return json({ ok: false, error: o.limited || 'Too many requests.' }, 429);
  }
  const key = String((data && data.key) || '');
  if (!(await requireAdmin(env, key))) return json({ ok: false, error: 'No.' }, 403);
  const floor = await keyFloor(env, o.bucket, key);
  if (floor) return floor;
  return { ip, data, key, me: await sha256hex(key) };
}

/* The keyless read preamble (a GET with URL params): the READ limit alone; the
   refusal is JSON, or plain text where the endpoint has always answered so. */
export async function readLimited(request: Request, env: Env, o: { limited?: string; plain?: boolean } = {}): Promise<Response | string> {
  const ip = request.headers.get('CF-Connecting-IP') || '';
  if (!(await throttle(env, 'READ_LIMIT', ip))) {
    const text = o.limited || 'Too many requests.';
    return o.plain ? new Response(text, { status: 429 }) : json({ ok: false, error: text }, 429);
  }
  return ip;
}

/* Worker environment bindings (D1 databases, R2 buckets, Vectorize, Workers AI,
   Durable Object namespaces, rate limiters) plus string vars/secrets. Typed
   loosely (index signature) on purpose — this is a typing pass, not a
   binding-by-binding audit, and every access site already treats env as
   whatever-shape-it-needs-to-be at runtime. */
/* The commentable pages: the site's OWN writings — the book and the hand
   pages — single-sourced from Domain.Comments (the client's eligible list, the
   admin console and the build-parity test read the same table). A work merely
   hosted in the library is never here. Whether a listed page's section is OPEN
   is the admin's runtime call (commentsPageOn below). */
export const PAGES: string[] = Comments.commentablePaths;

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

export function boardKey(raw: unknown): string | null {
  const page = String(raw || '');
  const m = /^board:([a-z]+)$/.exec(page);
  return m && BOARD_CATS.includes(m[1]) ? page : null;
}

/* The site's own origin, used to build human-facing links (feed items, the
   move-notice DM). Overridable per deployment via the SITE var; the constant is
   the production default so prod behaves identically when the var is unset. */
export const SITE = 'https://merecatholicity.com';
export function siteBase(env: Env) { return (env && env.SITE) || SITE; }
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
export const FAITHS: string[] = Faith.faithList.map((f: { code: string }) => f.code);   // single-sourced from Domain.Faith
export function cleanFaith(raw: unknown) {
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
export const FAITH_LABELS: Record<string, string> = Object.fromEntries(Faith.faithList.map((f: { code: string; label: string }) => [f.code, f.label]));
/* Emoji packs + named-alias tokens single-sourced from Domain.Emoji (the same
   data the client renders); the building code (whitelist derive, alias pairing)
   is trivial and stays per-consumer. */
export const EMOJI_PACKS = Emoji.packs;
export const NAMED_EMOJI = (() => {
  const out: Record<string, string> = {};
  const toks: string[] = Emoji.namedTokens.trim().split(/\s+/);
  for (let i = 0; i < toks.length; i += 2) out[toks[i]] = toks[i + 1];
  return out;
})();
/* Book spelling/abbreviation -> KJV verse-anchor slug, mirroring BIBLE in
   comments.js. Served so a native renderer can autolink scripture references. */
/* BIBLE_SPEC retired — the book table is single-sourced from the PureScript
   Domain.Scripture.bibleSpec, the same table the client bundles (Phase 6). */

export const enc = new TextEncoder();

export async function sha256hex(text: string) {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/* ================= The public id (the P0 chain, layer three) =================
   A member's PUBLIC identifier is no longer `SHA-256(key)` — the digest the
   server also stores to verify the key, one unsalted round from the key itself.
   It is `pubid = SHA-256(PUBLIC_ID_PEPPER || hash)`: same 64-hex shape, so every
   client-side `[0-9a-f]{64}` check still matches and the client keeps treating a
   member id opaquely, but inverting it needs a secret the edge never serves. The
   account `hash` stays D1's primary key and NEVER crosses the wire.

     serveId(hash)   -> the pubid to PUT ON the wire (egress). Deterministic;
                        also fills the reverse map so resolveId can undo it.
     resolveId(id)   -> the account hash a wire id names (ingress), or null for
                        an id no member wears. Accepts an OLD raw hash too, for
                        one deploy, so shared `?u=<hash>` links do not break.

   SAFETY VALVE: with no pepper set, serveId returns the raw hash and resolveId
   treats its input as one — i.e. exactly the pre-layer-3 behaviour. So the code
   can deploy BEFORE the secret is set (it serves hashes until the pepper lands,
   then flips to pubids on the next request) and a lost/rotated pepper degrades
   to the old exposure rather than breaking every read. `egress.ts` refuses every
   answer carrying the pepper's value (it is not a PUBLIC_VAR). */
const _h2p = new Map<string, string>();   // hash  -> pubid (per isolate)
const _p2h = new Map<string, string>();   // pubid -> hash
let _revLoaded = false;                    // the reverse map is built once per isolate

/* Test seam: the caches persist across a worker instance; a hermetic test that
   swaps the pepper (or the db) must clear them, as it clears appSettingsCache. */
export function clearIdCaches() { _h2p.clear(); _p2h.clear(); _revLoaded = false; }

/* The pubid for a hash — pure and deterministic, cached. No D1. Returns the raw
   hash when no pepper is set (the valve). */
export async function pubidOf(env: Env, hash: string): Promise<string> {
  if (!hash) return hash;
  const pepper = env.PUBLIC_ID_PEPPER ? String(env.PUBLIC_ID_PEPPER) : '';
  if (!pepper) return hash;
  const hit = _h2p.get(hash);
  if (hit) return hit;
  const pid = await sha256hex(pepper + hash);
  _h2p.set(hash, pid);
  _p2h.set(pid, hash);
  return pid;
}

/* Egress: the id to serve for this hash. Pure — `pubidOf` is a deterministic
   function of pepper+hash, so nothing is stored; the reverse map resolveId needs
   is rebuilt from a READ of the identity columns (below), never a write. That is
   what lets the flip run with the D1 daily WRITE budget spent: serving a pubid,
   and inverting one, cost only reads. (A larger shelf would want a stored,
   indexed `pubid` column back — a migration when the write budget allows — and
   resolveId would read it instead of rebuilding the map.) */
export async function serveId(env: Env, hash: string | null | undefined): Promise<string | null> {
  if (!hash) return hash ?? null;
  return pubidOf(env, hash);
}

/* Build the reverse map (pubid -> account hash) once per isolate, from READS of
   every column a member id lives in — no stored column, so no D1 write. Bounded
   by the member count (dozens today). */
async function loadRevMap(env: Env): Promise<void> {
  if (_revLoaded || !env.PUBLIC_ID_PEPPER) return;
  const hashes = new Set<string>();
  const add = (rows: { results?: Array<{ h: string | null }> } | null) => {
    for (const r of (rows && rows.results) || []) if (r.h && /^[0-9a-f]{64}$/.test(r.h)) hashes.add(r.h);
  };
  add(await env.DB.prepare('SELECT hash AS h FROM profiles').all<{ h: string | null }>());
  for (const [tbl, col] of [['comments', 'author_hash'], ['wall_posts', 'author_hash'], ['dms', 'sender_hash'], ['dm_members', 'hash']]) {
    try { add(await env.DB.prepare('SELECT DISTINCT ' + col + ' AS h FROM ' + tbl + ' WHERE ' + col + ' IS NOT NULL').all<{ h: string | null }>()); } catch (e) { /* a table a deployment predates */ }
  }
  for (const h of hashes) { const pid = await pubidOf(env, h); _p2h.set(pid, h); }
  _revLoaded = true;
}

/* Ingress: the account hash a wire id names, or null. A pubid resolves through
   the read-built reverse map; an id absent from it but present as a raw
   `profiles.hash` is honoured for one deploy (an old `?u=<hash>` link) — drop
   that arm once the tolerance is due (tests/_support/retirements.json). With no
   pepper, the id IS the hash. */
export async function resolveId(env: Env, id: string | null | undefined): Promise<string | null> {
  if (!id || !/^[0-9a-f]{64}$/.test(String(id))) return null;
  const wire = String(id);
  if (!env.PUBLIC_ID_PEPPER) return wire;   // the valve: an id is a hash
  await loadRevMap(env);
  const hit = _p2h.get(wire);
  if (hit) return hit;
  /* the tolerance, and a net for a member registered after the map loaded: an
     id that IS a live account hash resolves to itself */
  const row = await env.DB.prepare('SELECT hash FROM profiles WHERE hash = ?1 LIMIT 1').bind(wire).first<{ hash: string }>();
  return row && row.hash ? row.hash : null;
}

/* Fill `profiles.pubid` for every member and every orphan identity (a hash that
   only ever appeared as an author/sender and never got a profiles row), so the
   reverse map is complete without waiting to be served. Bounded by the member
   count; a daily-chain step and a backstop the deploy can call. */
/* Cloak every account hash inside a response body or a hub frame — the id
   fields (single, array, and the `keys` map keyed BY id) named below — into
   pubids, in ONE place so a new frame or row does not have to remember (the P0
   chain L3). Only a 64-hex VALUE in a named id field is touched, so a call id
   (`call`), a media key (`media_key`) or a nick riding an id-named field is
   never mangled. `assigned` is recomputed from the pubid when it sits beside a
   cloaked `hash`/`author_hash`/`sender_hash`, so the pseudonym matches the id.
   Returns a cloaked DEEP COPY; the input is untouched. The hash_leak sweep
   proves the field list is complete. */
const ID_FIELDS = new Set([
  'hash', 'author_hash', 'sender_hash', 'actor_hash', 'from_hash', 'to_hash',
  'other_hash', 'owner_hash', 'blocked_hash', 'from', 'to', 'reader', 'by', 'saved_by', 'me',
]);
const ID_ARRAY_FIELDS = new Set(['left', 'muted', 'mentions', 'blocked', 'added', 'missing', 'online']);
const ID_MAP_FIELDS = new Set(['keys', 'identities', 'seen']);   // OBJECTs keyed by id (dm_keys sealed set; the admin fingerprint; presence last-seen)
/* the pseudonym field beside an id, recomputed from the cloaked id */
const ASSIGNED_BESIDE: Record<string, string> = {
  hash: 'assigned', author_hash: 'assigned', sender_hash: 'assigned', actor_hash: 'actor_assigned',
  /* `other_hash` was missing until 2026-09-19 and the inbox row it names was
     the one surface still calling a member by their PRE-flip pseudonym: the id
     beside it was cloaked, the name was not, so the same person read as
     "Cheerful-Tower ffd9" in the inbox and "Upright-Bell af67" on their
     profile. A pseudonym carries the first four hex of whatever id minted it,
     so this did not merely look wrong — it went on publishing four hex of the
     account hash the flip exists to hide. */
  other_hash: 'assigned',
};
const HEX64 = /^[0-9a-f]{64}$/;
/* The name a member wears in PUBLIC. A nick when they chose one; otherwise the
   pseudonym — and that pseudonym is minted from their PUBLIC id, never the
   account hash. `displayName` puts the id's first four hex in the name, so one
   built from the account hash publishes 16 bits of the digest of their key, on
   a surface as public as the RSS feed, and calls them something no other screen
   calls them. Answers that carry an `assigned` beside a cloaked id are handled
   by cloakIds; this is for the rest — a `nick || displayName(...)` that lands in
   a field of its own (2026-09-19). */
export async function publicName(env: Env, hash: string | null | undefined, nick?: string | null): Promise<string> {
  if (nick) return String(nick);
  if (!hash) return 'Anonymous';
  return Pseudonym.displayName((await serveId(env, hash)) || String(hash));
}

export async function cloakIds<T>(env: Env, node: T): Promise<T> {
  if (!env.PUBLIC_ID_PEPPER) return node;   // the valve: ids ARE hashes
  const walk = async (v: unknown): Promise<unknown> => {
    if (Array.isArray(v)) return Promise.all(v.map(walk));
    if (v && typeof v === 'object') {
      const src = v as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      /* Names minted from a cloaked id, applied AFTER the copy loop. They used
         to be written inline, and a route that listed `assigned` after the id
         it belongs to — which `Object.assign({}, row, { assigned })` always
         does — had the freshly minted name overwritten by the stale one the
         route had computed from the raw hash. Key ORDER decided whether a
         member was called by their public name or their old one, silently, and
         it decided wrong nearly everywhere (2026-09-19). */
      const minted: Record<string, string | null> = {};
      for (const k of Object.keys(src)) {
        const val = src[k];
        if (ID_FIELDS.has(k) && typeof val === 'string' && HEX64.test(val)) {
          const pid = await serveId(env, val);
          out[k] = pid;
          const a = ASSIGNED_BESIDE[k];
          if (a && (a in src)) minted[a] = pid ? Pseudonym.displayName(pid) : null;
        } else if (ID_ARRAY_FIELDS.has(k) && Array.isArray(val)) {
          out[k] = await Promise.all(val.map(async (x) => (typeof x === 'string' && HEX64.test(x) ? await serveId(env, x) : await walk(x))));
        } else if (ID_MAP_FIELDS.has(k) && val && typeof val === 'object' && !Array.isArray(val)) {
          const m: Record<string, unknown> = {};
          for (const kk of Object.keys(val as Record<string, unknown>)) {
            const nk = HEX64.test(kk) ? (await serveId(env, kk)) || kk : kk;
            m[nk] = (val as Record<string, unknown>)[kk];
          }
          out[k] = m;
        } else {
          out[k] = await walk(val);
        }
      }
      /* the second pass: a name minted from a cloaked id WINS, whatever order
         the keys arrived in. A name with no cloaked id beside it was walked
         above as an ordinary value and stands. */
      for (const a of Object.keys(minted)) out[a] = minted[a];
      return out;
    }
    return v;
  };
  return (await walk(node)) as T;
}


/* Same-origin API. A cross-origin browser POST always carries an Origin, so
   reject any Origin that is not ours; a missing Origin (non-browser clients,
   some same-origin form posts) is allowed through to the usual gates. The
   allowlist is overridable per deployment via the ALLOWED_ORIGINS var (comma-
   separated) — e.g. to admit a staging host or a hybrid-app origin — and falls
   back to the production defaults when unset, so prod is unchanged. */
export const DEFAULT_ORIGINS = ['https://merecatholicity.com', 'https://www.merecatholicity.com'];
export function allowedOrigins(env: Env) {
  const v = env && env.ALLOWED_ORIGINS;
  return v ? String(v).split(',').map((s) => s.trim()).filter(Boolean) : DEFAULT_ORIGINS;
}
export function originOk(request: Request, env: Env) {
  const o = request.headers.get('Origin');
  return !o || allowedOrigins(env).includes(o);
}

/* An answer is any object but the env or a copy of it (env.ts EnvFree). */
export function json<T extends object>(body: T & EnvFree<T>, status?: number, headers?: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status: status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

export function parseOS(ua: string) {
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
export function rootAdmins(env: Env) {
  return (env.ADMIN_HASHES || '').split(',').map((s) => s.trim()).filter((h) => /^[0-9a-f]{64}$/.test(h));
}

/* Admin status is membership in the admins table. The env owners count only
   while the table is still empty (bootstrap), so a live board is governed
   entirely by the table and no admin is privileged over another. */
export async function isAdminHash(env: Env, hash: string | null | undefined) {
  if (!hash) return false;
  const row = await env.DB.prepare('SELECT 1 AS a FROM admins WHERE hash = ?1').bind(hash).first();
  if (row) return true;
  if (rootAdmins(env).includes(hash)) {
    const seeded = await env.DB.prepare('SELECT 1 AS a FROM admins LIMIT 1').first();
    return !seeded;
  }
  return false;
}

/* Fill the table from the env owners the first time the console needs it, so
   they show as ordinary, removable rows rather than a hidden privileged set. A
   no-op once anyone is in the table (including after owners are removed). */
export async function ensureAdminsSeeded(env: Env) {
  const seeded = await env.DB.prepare('SELECT 1 AS a FROM admins LIMIT 1').first();
  if (seeded) return;
  const now = Math.floor(Date.now() / 1000);
  for (const h of rootAdmins(env)) {
    await env.DB.prepare('INSERT OR IGNORE INTO admins (hash, added_by, created_at) VALUES (?1, ?2, ?3)')
      .bind(h, 'seed', now).run();
  }
}

export function normalizePage(raw: unknown) {
  let p = String(raw || '').split('?')[0].split('#')[0];
  if (!p.startsWith('/')) return null;
  if (p.endsWith('/')) p += 'index.html';
  if (!p.endsWith('.html')) p += '.html';
  return PAGES.includes(p) ? p : null;
}

/* The identities that are machinery, not members (P3-3, 2026-09-16): the
   HIDDEN_HASHES var — the interactive kit's two test identities, the nightly
   webtest's probe, a second agent's. Never listed in the member directory,
   never counted as a member; their hashes are public by design, like the
   admins'. (The TEST_HASHES secret that also listed the kit's identities
   went with the Turnstile test bypass, 2026-09-17.) */
export function hiddenHashes(env: { HIDDEN_HASHES?: string }): string[] {
  return String(env.HIDDEN_HASHES || '').split(',').map((h) => h.trim()).filter((h) => /^[0-9a-f]{64}$/.test(h));
}

/* Fails closed. A blip reaching siteverify refuses the post rather than
   crashing the worker or waving the post through unverified. */
export async function verifyTurnstile(env: Env, token: string, ip: string, key: string) {
  /* No token offered? An identity that has ALREADY passed a challenge is not
     asked again — the whole reason this path exists (Domain.Turnstile). A token
     that IS offered is still verified normally, so nothing about the existing
     clients changes. Every other gate stands: the key, the block/lock/ban
     check, the per-IP rate limit, the AI screen. */
  if (!token && key) {
    try {
      const s = await getAppSettings(env);
      if (turnstileSkipEstablished(s) && await isEstablished(env, await sha256hex(key))) return true;
    } catch (err) {
      /* Settings or the establishment probe failed: fall through and demand a
         token. Fails CLOSED, like everything else in here. */
    }
  }
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: new URLSearchParams({ secret: String(env.TURNSTILE_SECRET || ''), response: token, remoteip: ip }),
    });
    const verdict = await res.json<{ success?: boolean; hostname?: string }>();
    if (!verdict.success) return false;
    /* Defense in depth on top of the sitekey's own domain lock: if a host
       allow-list is configured, the token must have been solved on one. */
    const allow = (env.TURNSTILE_HOSTNAMES || '').split(',').map((h) => h.trim()).filter(Boolean);
    if (allow.length && !allow.includes(String(verdict.hostname))) {
      console.log(JSON.stringify({ event: 'turnstile_hostname', hostname: verdict.hostname }));
      return false;
    }
    /* Passed. THIS is the moment the record is made (0018): from here on the
       identity is spared, and its uploads, calls and first DM open. A write
       with no key (an anonymous post, where that is allowed) records nothing —
       there is no identity to remember. The verdict is what gates the write,
       so a database that cannot take the record must not turn a challenge a
       person just passed into a refusal: the write lands and the next one is
       challenged again, which is the safe direction. */
    if (key) {
      try {
        await markVerified(env, await sha256hex(key));
      } catch (err) {
        console.log(JSON.stringify({ event: 'verified_stamp_failed', error: String(err) }));
      }
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
   builder (in pure.ts, unit-tested — a typo there would silently un-mute
   everyone); isShadowBanned is the write-side point check. Both hit the tiny
   PK-indexed shadowbans table. */
export async function isShadowBanned(env: Env, hash: string | null | undefined) {
  if (!hash) return false;
  const row = await env.DB.prepare('SELECT 1 AS s FROM shadowbans WHERE hash = ?1').bind(hash).first();
  return !!row;
}

/* The topic row carries denormalized replies and last_at so category
   pages read topic rows alone. Recomputed, never incremented, from the
   indexed replies whenever anything in the thread mutates, so the numbers
   cannot drift. A shadowbanned author's replies are excluded here too, so a
   muted reply never bumps a thread's count or last-activity for anyone. */
export async function refreshTopicStats(env: Env, topicId: number) {
  await env.DB.prepare(
    'UPDATE comments SET ' +
    "replies = (SELECT COUNT(*) FROM comments r WHERE r.parent_id = ?1 AND r.status = 'live' AND " + shadowExcl('r') + '), ' +
    "last_at = (SELECT MAX(c2.created_at) FROM comments c2 WHERE (c2.id = ?1 OR c2.parent_id = ?1) AND c2.status = 'live' AND " + shadowExcl('c2') + ') ' +
    'WHERE id = ?1'
  ).bind(topicId).run();
}

export async function isTrusted(env: Env, hash: string | null | undefined) {
  if (!hash) return false;
  const row = await env.DB.prepare('SELECT 1 AS t FROM trusted WHERE hash = ?1').bind(hash).first();
  return !!row;
}

/* IP normalization + ban-key helpers (ipFamily/ipv6Groups/ipv6Prefix64/
   ipv6Full/ipKey/toBanKey/isSharedV4/reverseDnsName/looksLikeIp) live in
   src/pure.ts, imported at the top — extracted so they can be unit-tested in
   plain Node. A dual-stack user's v6 interface id rotates daily while the /64
   stays fixed, so bans match on a normalized key (v4 verbatim, v6 as /64). */

/* Reverse-DNS one address via Cloudflare DoH JSON. Best-effort: the PTR
   hostname without its trailing dot, or null on any failure or timeout. */
export async function ptrLookup(ip: string) {
  const name = reverseDnsName(ip);
  if (!name) return null;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 1500);
  try {
    const r = await fetch('https://cloudflare-dns.com/dns-query?type=PTR&name=' + encodeURIComponent(name),
      { headers: { accept: 'application/dns-json' }, signal: ctl.signal });
    if (!r.ok) return null;
    const j = await r.json<{ Answer?: { type?: number; data?: string }[] } | null>();
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
export async function recordIps(env: Env, hash: string | null, connIp: string, data: Body | null) {
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
export async function blockedReason(env: Env, hash: string | null, ip: string): Promise<string | null> {
  const row = await env.DB.prepare(
    "SELECT 'locked' AS r FROM locks WHERE hash = ?1 " +
    "UNION ALL SELECT 'ipban' FROM ip_bans WHERE ip = ?2 " +
    "UNION ALL SELECT 'banned' FROM bans WHERE hash = ?1 LIMIT 1"
  ).bind(hash || '-', ipKey(ip) || '-').first<{ r: string }>();
  return row ? row.r : null;
}

export function blockedJson(reason: string) {
  return json({ ok: false, blocked: reason, error: 'Interaction is not available.' }, 403);
}

/* Returns {status, verdict}. Anything unscreenable is held pending: the
   failure mode must be a delay for the poster, never a silent publish.
   A trusted author skips the screen entirely, though hold-all, the
   emergency brake, still holds everyone, and bans are checked upstream. */
export async function screen(env: Env, body: string, trusted: boolean) {
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
export function viewLink(env: Env, page: string, id: number, parentId: number | null) {
  if (page.indexOf('board:') === 0) {
    return siteBase(env) + '/community.html?topic=' + (parentId || id) + '#comment-' + id;
  }
  /* A page comment on its page; a journal comment on the article's permalink
     (Domain.Comments.pageHref turns 'journal:<id>' into /journal.html?a=<id>). */
  return siteBase(env) + Comments.pageHref(String(page)) + '#comment-' + id;
}

/* Comment email notifications were retired: the owner watches recent activity
   through the RSS feeds and the Activity Audit page instead. viewLink stays,
   the RSS builder still uses it. */

/* Two browser-cache profiles on the read endpoints. Keyed visitors ask
   for the fresh one with ?fresh=1 and live as they always have. Anonymous
   readers ride a five-minute cache, their repeat views never reaching the
   worker at all. */
export function cacheHeader(url: URL) {
  return { 'Cache-Control': 'public, max-age=' + (url.searchParams.get('fresh') ? 60 : 300) };
}

/* The shared-constants endpoint: one cacheable read serving the display tables a
   second client (native app, CLI) would otherwise triplicate — category roster,
   faith labels, rank ladder, commentable pages, the bot hash, the scripture
   autolink table, and the emoji whitelists — plus an explicit apiVersion. Public
   and edge-cacheable like every other read. Additive: nothing consumes it yet;
   the web client keeps its inline copies. */
export type PrefRow = { hash: string; notify_reply: number | null; notify_mention: number | null; notify_dm: number | null };
export async function notifyPrefsFor(env: Env, hashes: readonly (string | null | undefined)[]): Promise<Record<string, PrefRow>> {
  const map: Record<string, PrefRow> = {};
  const list = [...new Set(hashes.filter((h): h is string => !!h))];
  for (let i = 0; i < list.length; i += 50) {
    const chunk = list.slice(i, i + 50);
    const ph = inList(chunk.length);
    try {
      const rows = await env.DB.prepare('SELECT hash, notify_reply, notify_mention, notify_dm FROM profiles WHERE hash IN (' + ph + ')').bind(...chunk).all<PrefRow>();
      for (const r of (rows.results || [])) map[r.hash] = r;
    } catch (e) { /* defaults (all on) stand */ }
  }
  return map;
}
/* Is a kind enabled for this recipient? NULL / missing profile = on (default). */
export function notifyEnabled(prefRow: PrefRow | null | undefined, kind: 'reply' | 'mention' | 'dm') {
  if (!prefRow) return true;
  const v = prefRow[`notify_${kind}` as const];
  return v == null ? true : Prefs.notifyOn(Number(v) || 0);
}

/* A board post's notice: who wrote what where, for the fan-out below. */
export type BoardNotice = {
  authorHash: string | null; status: string; page?: string;
  topicId: number; commentId: number; isReply: boolean;
  topicAuthorHash?: string | null; mentions?: unknown;
};
export async function deliverNotifications(env: Env, o: BoardNotice) {
  const now = Math.floor(Date.now() / 1000);
  const NOTIF = 'INSERT INTO notifications (recipient_hash, kind, topic_id, comment_id, actor_hash, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)';
  const stmts: D1PreparedStatement[] = [];
  const pushMention = new Set<string>();   // recipients to nudge by native push, per kind (disjoint sets)
  const pushReply = new Set<string>();
  const liveEvents: HubEvent[] = [];      // per-recipient live 'notification' events (WebSocket)

  if (o.authorHash && o.authorHash !== MERECAT_BOT.hash) {
    stmts.push(env.DB.prepare('INSERT OR IGNORE INTO watches (hash, topic_id, created_at) VALUES (?1, ?2, ?3)')
      .bind(o.authorHash, o.topicId, now));
  }

  if (o.status === 'live') {
    const mentions: string[] = [];
    if (Array.isArray(o.mentions)) {
      for (const m of o.mentions) {
        /* a mention arrives as a pubid (the P0 chain L3) — resolve it to the
           account hash the inbox is keyed by; an unknown id notifies nobody */
        const h = (await resolveId(env, String(m || '').toLowerCase())) || String(m || '').toLowerCase();
        // the librarian holds no inbox: its hash never receives a notification
        if (/^[0-9a-f]{64}$/.test(h) && h !== o.authorHash && h !== MERECAT_BOT.hash &&
            mentions.indexOf(h) === -1) mentions.push(h);
        if (mentions.length >= 10) break;
      }
    }
    /* A post in the back room tells admins alone — a mentioned or watching
       outsider must learn nothing, not even that the thread exists. */
    let admSet: Set<string> | null = null;
    if (o.page === ADMIN_CAT) {
      const admRows = await env.DB.prepare('SELECT hash FROM admins').all<{ hash: string }>();
      admSet = new Set((admRows.results || []).map((r) => r.hash));
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
      const recips = new Set<string>();
      if (o.topicAuthorHash) recips.add(o.topicAuthorHash);
      const rows = await env.DB.prepare('SELECT hash FROM watches WHERE topic_id = ?1').bind(o.topicId).all<{ hash: string }>();
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
export async function notifyDm(env: Env, toHash: string, fromHash: string, threadId?: number) {
  try {
    if (!toHash || !fromHash || toHash === fromHash || fromHash === MERECAT_BOT.hash) return;
    /* "Direct messages" notifications off silences the BELL only — the message
       still arrives (handleDmSend's t:'dm' push) and the inbox unread badge still
       updates; we simply skip the notifications-list row + its ping. */
    const pref = (await notifyPrefsFor(env, [toHash]))[toHash];
    if (!notifyEnabled(pref, 'dm')) return;
    const now = Math.floor(Date.now() / 1000);
    /* Coalesced per CONVERSATION since 0016 (topic_id names the thread): a
       burst in one group surfaces once until read; a row with no thread on
       it still coalesces by its sender. */
    const tid = Math.floor(Number(threadId) || 0);
    const r = await env.DB.prepare(
      "INSERT INTO notifications (recipient_hash, kind, topic_id, comment_id, actor_hash, created_at) " +
      "SELECT ?1, 'dm', ?4, 0, ?2, ?3 WHERE NOT EXISTS (" +
      "SELECT 1 FROM notifications WHERE recipient_hash = ?1 AND kind = 'dm' AND topic_id = ?4 AND (?4 > 0 OR actor_hash = ?2) AND read_at IS NULL)"
    ).bind(toHash, fromHash, now, tid).run();
    /* Ring the notification badge only when a row was actually added (an existing
       unread 'dm' from this conversation already counts). */
    if (r.meta && r.meta.changes > 0) {
      await publishUser(env, [{ v: 1, t: 'notification', scopes: ['user:' + toHash],
        kind: 'dm', topic_id: tid, comment_id: 0, actor_hash: fromHash, created_at: now }]);
    }
  } catch (e) {
    console.log(JSON.stringify({ event: 'notify_dm_failed', error: String(e) }));
  }
}

/* The ring's push (2026-09-12; the missed-call bell moved to the miss): when
   the callee has no live socket (presenceOf — an open tab already rings over
   the wire), their phone is rung by a Web Push whose URL opens the thread WITH
   the call's id, so the app can fetch the stored offer (/call/pending) and
   ring an answerable panel — "swipe open and answer", as far as a web app on
   a phone can go (no CallKit exists for the web; the system notification IS
   the swipe). The push carries no names (the DM-push privacy idiom) and a
   tag per caller, so the miss's push replaces it rather than piling up. Rides
   the notify_dm pref. A ring must never fail because its push did. */
export async function ringCall(env: Env, toHash: string, fromHash: string, callId: string) {
  try {
    if (!toHash || !fromHash || toHash === fromHash || fromHash === MERECAT_BOT.hash) return;
    const pref = (await notifyPrefsFor(env, [toHash]))[toHash];
    if (!notifyEnabled(pref, 'dm')) return;
    /* hubPresenceOf returns the ONLINE SUBSET; a hub it cannot reach answers
       nobody, so the callee is treated as away and the push goes. */
    const online = (await hubPresenceOf(env, [toHash])).indexOf(toHash) !== -1;
    if (!online) {
      await deliverPush(env, [toHash], { kind: 'call', title: 'Incoming call', body: 'Someone is calling you — tap to answer',
        url: '/messages.html?dm=' + fromHash + '&call=' + String(callId || ''), tag: 'call:' + fromHash });
    }
  } catch (e) {
    console.log(JSON.stringify({ event: 'ring_call_failed', error: String(e) }));
  }
}

/* The missed-call bell (notifyDm's sibling), rung ONLY for a call that was
   missed (2026-09-12; it used to ring at the offer, so an answered call left
   a read row behind): one coalesced UNREAD 'call' row per (recipient,
   caller) — a ring-burst never piles up rows — plus the live badge ping, and
   a Web Push ("Missed call", replacing the ring's push by its tag) only when
   the callee has no live socket. Never throws out. */
export async function notifyMissedCall(env: Env, toHash: string, fromHash: string, opts?: { late?: boolean }, threadId?: number) {
  try {
    if (!toHash || !fromHash || toHash === fromHash || fromHash === MERECAT_BOT.hash) return;
    const pref = (await notifyPrefsFor(env, [toHash]))[toHash];
    if (!notifyEnabled(pref, 'dm')) return;
    const now = Math.floor(Date.now() / 1000);
    /* topic_id names the pair's thread since 0016, so the bell opens it by id. */
    const tid = Math.floor(Number(threadId) || 0);
    const r = await env.DB.prepare(
      "INSERT INTO notifications (recipient_hash, kind, topic_id, comment_id, actor_hash, created_at) " +
      "SELECT ?1, 'call', ?4, 0, ?2, ?3 WHERE NOT EXISTS (" +
      "SELECT 1 FROM notifications WHERE recipient_hash = ?1 AND kind = 'call' AND actor_hash = ?2 AND read_at IS NULL)"
    ).bind(toHash, fromHash, now, tid).run();
    if (r.meta && r.meta.changes > 0) {
      await publishUser(env, [{ v: 1, t: 'notification', scopes: ['user:' + toHash],
        kind: 'call', topic_id: tid, comment_id: 0, actor_hash: fromHash, created_at: now }]);
    }
    if (opts && opts.late) return;   // the sweep's backstop: the record, never an hour-late buzz
    const online = (await hubPresenceOf(env, [toHash])).indexOf(toHash) !== -1;
    if (!online) {
      await deliverPush(env, [toHash], { kind: 'call-missed', title: 'Missed call', body: 'You missed a call',
        url: tid > 0 ? '/messages.html?t=' + tid : '/messages.html?dm=' + fromHash, tag: 'call:' + fromHash });
    }
  } catch (e) {
    console.log(JSON.stringify({ event: 'notify_missed_call_failed', error: String(e) }));
  }
}

/* The call log (2026-09-13): a call's outcome, recorded ONCE per call into
   the conversation as a muted event line — the way every chat app writes
   "Missed voice call" / "Voice call · 12 min" into the thread. `ended_at` is
   the lock (the first report from either party, or the sweep's backstop,
   stamps it; every later report changes nothing — a miss also stamps
   missed_at, the pre-0017 rows' own lock, so an old miss is never re-recorded).
   The line is a quiet system DM from the CALLER to the callee (the client
   draws it by side; `Domain.Call.callLineText`): a miss ('missed' — no answer,
   canceled, busy) rings the coalesced 'call' bell and the push below; a
   decline ('declined') is the callee's own act and rings nothing; an answered
   call ('answered') carries its length, ended_at − answered_at, measured here
   so both sides agree; a failed setup ('failed') is stamped and nothing is
   written — no app logs "couldn't connect". Returns whether this call was
   the one that recorded it. */
export async function recordCallEnd(env: Env, row: { call: string; from_hash: string; to_hash: string; answered_at?: number | null }, outcome: string, opts?: { late?: boolean }) {
  const now = Math.floor(Date.now() / 1000);
  const r = await env.DB.prepare(
    'UPDATE calls_pending SET ended_at = ?2, outcome = ?3, missed_at = CASE WHEN ?3 = \'missed\' THEN ?2 ELSE missed_at END ' +
    'WHERE call = ?1 AND ended_at IS NULL AND missed_at IS NULL' + (outcome === 'answered' ? ' AND answered_at IS NOT NULL' : '')
  ).bind(row.call, now, outcome).run();
  if (!(r.meta && r.meta.changes > 0)) return false;
  let line = '';
  if (outcome === 'missed') line = CallK.missedCallLine;
  else if (outcome === 'declined') line = CallK.declinedCallLine;
  else if (outcome === 'answered') line = CallK.answeredCallLine(Math.max(0, now - (Number(row.answered_at) || now)));
  /* The pair's room (made if this call was its first word), so the line and
     the bell both name the conversation (0016). */
  let thread: { id: number } | null = null;
  try { thread = await ensurePairThread(env, row.from_hash, row.to_hash, now, { bump: false, sender: row.from_hash }); } catch (e) { thread = null; }
  if (line && thread) {
    try { await sendSystemDmLine(env, thread.id, row.from_hash, line, { quiet: true }); } catch (e) { console.log(JSON.stringify({ event: 'call_line_failed', outcome, error: String(e) })); }
  }
  if (outcome === 'missed') await notifyMissedCall(env, row.to_hash, row.from_hash, opts, thread ? thread.id : 0);
  return true;
}

/* A miss, by name: the caller's no-answer / cancel / busy, and the sweep. */
export async function recordMissedCall(env: Env, row: { call: string; from_hash: string; to_hash: string }, opts?: { late?: boolean }) {
  return recordCallEnd(env, row, 'missed', opts);
}

/* The hourly backstop: a call neither answered nor ended two minutes on (the
   caller's app died mid-ring) is recorded missed — the line and the bell, no
   push (an hour late is no ring) — and the day's rows go. An answered call
   whose end nobody reported (both apps died) is left alone: its length is
   unknown, and a guessed line is worse than none. */
export async function sweepCalls(env: Env) {
  const now = Math.floor(Date.now() / 1000);
  try {
    const stale = await env.DB.prepare(
      'SELECT call, from_hash, to_hash FROM calls_pending WHERE created_at < ?1 AND answered_at IS NULL AND missed_at IS NULL AND ended_at IS NULL LIMIT 200'
    ).bind(now - 120).all<{ call: string; from_hash: string; to_hash: string }>();
    for (const row of (stale.results || [])) await recordMissedCall(env, row, { late: true });
    const r = await env.DB.prepare('DELETE FROM calls_pending WHERE created_at < ?1').bind(now - 86400).run();
    console.log(JSON.stringify({ event: 'calls_sweep', missed: (stale.results || []).length, deleted: (r.meta && r.meta.changes) || 0 }));
  } catch (e) {
    console.log(JSON.stringify({ event: 'calls_sweep_failed', error: String(e) }));
  }
}

/* Best-effort push fan-out — real Web Push (VAPID + aes128gcm) over crypto.subtle,
   no external service (see webpush.ts). A NO-OP unless PUSH_ENABLED === 'true'
   AND the VAPID keypair is configured (VAPID_PRIVATE_KEY secret + VAPID_PUBLIC_KEY
   var). Looks up each recipient's registered subscriptions and sends `payload`
   (title/body/url, never message content — privacy + E2E). A dead subscription
   (404/410) is pruned. Never throws into the caller (a push failure must never
   affect a post or a DM). */
/* What a push says: never names, never message content (the privacy rule). */
export type PushPayload = { kind: string; title: string; body: string; url: string; tag?: string };
export async function deliverPush(env: Env, hashes: readonly (string | null | undefined)[], payload: PushPayload) {
  try {
    if (env.PUSH_ENABLED !== 'true') return;
    if (!env.VAPID_PRIVATE_KEY || !env.VAPID_PUBLIC_KEY) {
      console.log(JSON.stringify({ event: 'push_unconfigured' }));   // enabled but no keys set yet
      return;
    }
    const uniq = [...new Set(hashes.filter((h): h is string => !!h))];
    if (!uniq.length) return;
    const ph = inList(uniq.length);
    const rows = await env.DB.prepare('SELECT hash, platform, token FROM push_tokens WHERE hash IN (' + ph + ')').bind(...uniq).all<{ hash: string; platform: string; token: string }>();
    const tokens = rows.results || [];
    if (!tokens.length) return;
    const pusher = await createPusher(env);
    const dead: Array<{ hash: string; token: string }> = [];   // rows whose subscription is gone
    let sent = 0;
    /* Twenty at a time, never one after another (2026-09-17): a thread with
       hundreds of watchers used to push serially inside a waitUntil that the
       runtime ends thirty seconds after the response — the tail of the list
       was never told. A send that throws counts as neither sent nor gone. */
    const PUSH_LANE = 20;
    for (let i = 0; i < tokens.length; i += PUSH_LANE) {
      const lane = tokens.slice(i, i + PUSH_LANE);
      const results = await Promise.allSettled(lane.map(async (row) => {
        let sub: { endpoint?: unknown } | null = null;
        try { sub = JSON.parse(row.token); } catch { sub = null; }
        if (!sub || !sub.endpoint) return 'dead';   // unparseable => prune
        const res = await pusher.send(sub, payload);
        return res.ok ? 'sent' : (res.gone ? 'dead' : 'failed');
      }));
      results.forEach((r, k) => {
        if (r.status !== 'fulfilled') return;
        if (r.value === 'sent') sent += 1;
        else if (r.value === 'dead') dead.push(lane[k]);
      });
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
export function xmlEscape(s: unknown) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/* RSS 2.0 feed of a page's live comments, so anyone can follow a thread
   with a feed reader and nobody has to hand this site an email address. */
export async function metaForHash(env: Env, hash: string) {
  const last = await env.DB.prepare(
    'SELECT id, ip, ua, os, tz, lang FROM comments WHERE author_hash = ?1 ORDER BY id DESC LIMIT 1'
  ).bind(hash).first<{ id: number; ip: string | null; ua: string | null; os: string | null; tz: string | null; lang: string | null }>();
  const flags = await env.DB.prepare(
    'SELECT (SELECT 1 FROM trusted WHERE hash = ?1) AS trusted, ' +
    '(SELECT 1 FROM locks WHERE hash = ?1) AS locked, ' +
    '(SELECT 1 FROM shadowbans WHERE hash = ?1) AS shadowbanned'
  ).bind(hash).first<{ trusted: number | null; locked: number | null; shadowbanned: number | null }>();
  /* Only the recent window shows, banned keys always. */
  const ipRows = await env.DB.prepare(
    'SELECT ii.ip_key, ii.ip_display, ii.family, ii.source, ' +
    'CASE WHEN ib.ip IS NULL THEN 0 ELSE 1 END AS banned ' +
    'FROM identity_ips ii LEFT JOIN ip_bans ib ON ib.ip = ii.ip_key ' +
    'WHERE ii.hash = ?1 AND (ii.last_seen >= ?2 OR ib.ip IS NOT NULL) ' +
    'ORDER BY ii.family, ii.last_seen DESC'
  ).bind(hash, Math.floor(Date.now() / 1000) - IP_SHOW_DAYS * 86400).all<{ ip_key: string; ip_display: string; family: number; source: string; banned: number }>();
  const identities: Record<string, Array<{ ip_display: string; ip_key: string; family: number; source: string; banned: number }>> = {};
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
    shadowbanned: flags && flags.shadowbanned ? 1 : 0,
    ipbanned,
  };
  return json(await cloakIds(env, { ok: true, meta: [row], identities }), 200);
}

export const TOPICS_PER_PAGE = 20;
export async function boardCatPayload(env: Env, page: string, p: number, q: unknown) {
  /* Optional title narrowing (the merecat forward picker's type-to-narrow):
     up to five typed words, each a case-insensitive substring of the topic
     title, ANDed in any order. The LIKE walk covers only this category's
     topic rows, so a two-topic room and a two-thousand-topic room both
     answer as one twenty-row page — a client never pulls the whole list. */
  const toks = String(q || '').slice(0, 120).split(/\s+/).filter(Boolean).slice(0, 5);
  /* Shadowbanned authors' topics never list for anyone (shadowExcl). */
  let where = "c.page = ?1 AND c.parent_id IS NULL AND c.status = 'live' AND " + shadowExcl('c');
  const binds: string[] = [page];
  for (const t of toks) {
    binds.push('%' + t.replace(/[\\%_]/g, '\\$&') + '%');
    where += ' AND c.title LIKE ?' + binds.length + " ESCAPE '\\'";
  }
  const total = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM comments c WHERE ' + where
  ).bind(...binds).first<{ n: number }>();
  const rows = await env.DB.prepare(
    'SELECT c.id, c.title, c.author_hash, pr.nick, c.created_at, c.locked, c.sticky, COALESCE(c.readonly, 0) AS readonly, ' +
    'COALESCE(c.replies, 0) AS replies, COALESCE(c.last_at, c.created_at) AS last, ' +
    "(SELECT MAX(m.id) FROM comments m WHERE (m.id = c.id OR m.parent_id = c.id) AND m.status = 'live' AND " + shadowExcl('m') + ') AS last_id ' +
    'FROM comments c LEFT JOIN profiles pr ON pr.hash = c.author_hash ' +
    'WHERE ' + where + ' ' +
    'ORDER BY COALESCE(c.sticky, 0) DESC, last DESC LIMIT ?' + (binds.length + 1) + ' OFFSET ?' + (binds.length + 2)
  ).bind(...binds, TOPICS_PER_PAGE, (p - 1) * TOPICS_PER_PAGE).all<AuthoredRow>();
  const topics = await Promise.all((rows.results || []).map((r) => withNames(r, null, (h) => serveId(env, h))));
  return { ok: true, topics, total: (total && total.n) || 0, page: p, per: TOPICS_PER_PAGE };
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
export function buildMatch(q: unknown): string {
  return Fts.unSafeMatch(Fts.buildMatch(String(q ?? '')));
}

/* Full-text search over the FORUM only. Live board rows are filtered in at query
   time, so the FTS index can simply mirror all of comments. Narrows by category
   and by author, ranks by relevance (bm25) or recency, marks matched terms with
   control characters for the client to highlight, and is cacheable like every
   public read. An unknown category or malformed author is dropped, not errored,
   so a stray filter never blanks the results. */
/* A topic head as the board reads select it. */
export type TopicRow = {
  id: number; page: string; title: string | null; author_hash: string;
  nick?: string | null; signature?: string | null; avatar?: string | null; faith?: string | null;
  body?: string | null; created_at: number; edited_at?: number | null;
  locked?: number | null; sticky?: number | null;
} & Record<string, unknown>;
export async function topicViewPayload(env: Env, topic: TopicRow, pRaw: unknown, findRaw: unknown) {
  const id = topic.id;
  /* Twenty replies a page. A permalink arrives with find=<reply id> and
     one indexed count places it on the right page. */
  let p = Math.min(1000, Math.max(1, Math.floor(Number(pRaw) || 1)));
  const find = Number(findRaw);
  if (Number.isInteger(find) && find > 0 && !pRaw) {
    const pos = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM comments c WHERE c.parent_id = ?1 AND c.status = 'live' AND c.id < ?2 AND " + shadowExcl('c')
    ).bind(id, find).first<{ n: number }>();
    p = Math.floor(((pos && pos.n) || 0) / TOPICS_PER_PAGE) + 1;
  }
  const replies = await env.DB.prepare(
    "SELECT c.id, c.author_hash, pr.nick, pr.signature, pr.avatar, pr.faith, c.body, c.created_at, c.edited_at, c.media_key, c.media_expired FROM comments c " +
    "LEFT JOIN profiles pr ON pr.hash = c.author_hash " +
    "WHERE c.parent_id = ?1 AND c.status = 'live' AND " + shadowExcl('c') + " ORDER BY c.id LIMIT ?2 OFFSET ?3"
  ).bind(id, TOPICS_PER_PAGE, (p - 1) * TOPICS_PER_PAGE).all<AuthoredRow>();
  /* Each post carries its author's total forum-post count, for the rank the
     client shows under the name. One grouped query for every author on the page. */
  const counts = await postCountsFor(env, [topic.author_hash, ...(replies.results || []).map((r) => r.author_hash)]);
  /* The reactions' tallies ride the public payload (a reaction is public); the
     viewer's OWN ride the keyed /reacts read, since this payload is cached. */
  const head = await withNames({ id: topic.id, title: topic.title, author_hash: topic.author_hash, nick: topic.nick, signature: topic.signature, avatar: topic.avatar, faith: topic.faith || null, body: topic.body, created_at: topic.created_at, edited_at: topic.edited_at, locked: topic.locked ? 1 : 0, sticky: topic.sticky ? 1 : 0, readonly: topic.readonly ? 1 : 0, media_key: topic.media_key || null, media_expired: topic.media_expired || 0 }, counts[topic.author_hash] || 0, (h) => serveId(env, h));
  const posts = await Promise.all((replies.results || []).map((r) => withNames(r, counts[r.author_hash || ''] || 0, (h) => serveId(env, h))));
  await stampReactions(env, 'post', [head].concat(posts), null);
  return {
    ok: true,
    anon: env.ALLOW_ANON === 'true',
    cat: topic.page.slice(6),
    topic: head,
    replies: posts,
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
export function cleanField(raw: unknown, max: number): { error: boolean; value: string | null } {
  const v = String(raw || '').replace(/\r\n?/g, '\n').trim();
  if (v.length > max) return { error: true, value: null };
  if (CONTROL_RE.test(v)) return { error: true, value: null };
  return { error: false, value: v || null };
}

/* Parse the stored offsite-links JSON back to an object for the client. */
export function safeParseLinks(s: unknown): Record<string, unknown> | null {
  try { const o: unknown = JSON.parse(String(s)); return (o && typeof o === 'object' && !Array.isArray(o)) ? bodyOf(o) : null; } catch { return null; }
}

/* Sanitize a client-supplied links object to a JSON string of ONLY safe,
   normalized https URLs — Domain.Links drops anything that is not an http(s) URL
   or a normalizable handle. Returns the JSON string, or null when nothing valid
   remains (which clears the column). */
export function normalizeLinks(raw: unknown) {
  const src = bodyOf(raw);
  const out: Record<string, string> = {};
  for (const plat of Links.platforms as string[]) {
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

export function dmPair(h1: string, h2: string): [string, string] {
  return h1 < h2 ? [h1, h2] : [h2, h1];
}

/* The one-thread-per-pair key (migration 0016): the canonical pair joined by
   a bar, unique across dm_threads. A group thread has none. */
export function dmPairKey(h1: string, h2: string) {
  const [a, b] = dmPair(h1, h2);
  return a + '|' + b;
}

/* The other side of a pair key, from my seat ('' when I am not in it, or it
   is a group's). */
export function dmPairOther(pairKey: string | null, me: string) {
  const k = String(pairKey || '');
  if (!k) return '';
  const [a, b] = k.split('|');
  return a === me ? b : (b === me ? a : '');
}

/* Visibility is per viewer: everyone sees the unheld, a sender always sees
   their own words, held or not — and in a GROUP (t.kind = 1) a member who
   blocked the sender does not see the sender's words at all (Snapchat's
   rule: you stay, they go quiet for you; a pair keeps its stored
   shadow-hold). ?1 must be bound to the viewer's hash, and `t` (the thread)
   and `m` (the message) must be in scope wherever this fragment appears. */
export const DM_VIS = "(COALESCE(m.held, 0) = 0 OR m.sender_hash = ?1) AND (t.kind = 0 OR NOT EXISTS (SELECT 1 FROM dm_blocks bk WHERE bk.owner_hash = ?1 AND bk.blocked_hash = m.sender_hash))";

/* A message still lives: not past its disappearing-message expiry. A saved
   message carries expires_at NULL and so is always live. `now` is a server
   integer interpolated straight into the SQL (never a bind param), so this can be
   appended to any DM query without shifting the numbered binds. */
export function dmLive(now: number) { return '(m.expires_at IS NULL OR m.expires_at > ' + Math.floor(Number(now) || 0) + ')'; }

/* Unread, per viewer, COUNTED: unheld, unexpired, uncleared words from someone
   else, newer than my read stamp and no older than my joining. The one
   fragment behind every unread number — the inbox row's badge, the inbox
   total, the thread's unread line, and the tab bar's badge (2026-09-11) — so
   they can never disagree. Held, cleared, pre-joining and expired words never
   count, nor (in a group) a sender I blocked, and so never trip my badge. `t`
   must be the thread and `mb` MY member row (DM_MINE) in scope; ?1 the viewer. */
export function dmUnreadCount(now: number) {
  return '(SELECT COUNT(*) FROM dms m WHERE m.thread_id = t.id AND COALESCE(m.held, 0) = 0 ' +
    'AND m.sender_hash != ?1 ' +
    'AND (t.kind = 0 OR NOT EXISTS (SELECT 1 FROM dm_blocks bk WHERE bk.owner_hash = ?1 AND bk.blocked_hash = m.sender_hash)) ' +
    'AND m.created_at > COALESCE(mb.read_at, 0) AND m.created_at > COALESCE(mb.cleared_at, 0) AND m.created_at >= mb.joined_at ' +
    'AND ' + dmLive(now) + ')';
}

/* A member sees only words newer than their clear stamp (a fresh start) and
   no older than their joining — a member added to a group gets no history,
   the crypto's rule kept here as well. `mb` must be the viewer's member row. */
export const DM_CLEARED = 'm.created_at > COALESCE(mb.cleared_at, 0) AND m.created_at >= mb.joined_at';

/* The viewer's own seat, for every query that filters through DM_CLEARED or
   counts through dmUnreadCount: `t` the thread, ?1 the viewer. A member who
   left has no seat, so the thread is nowhere for them. */
export const DM_MINE = 'JOIN dm_members mb ON mb.thread_id = t.id AND mb.hash = ?1 AND mb.left_at IS NULL';

/* ================= The member model (migration 0016, 2026-09-13) =================
   A conversation is a thread with member rows: a pair is two of them (kind 0,
   keyed by pair_key), a group up to Domain.Dm.maxMembers (kind 1). Every
   per-member stamp lives on the member row; nothing below reads a_hash/b_hash. */

const DM_THREAD_COLS = 't.id, t.kind, t.pair_key, t.name, t.created_at, t.created_by, t.last_at, t.last_sender, t.msgs, t.ttl, ' +
  'mb.joined_at, mb.left_at, mb.read_at, mb.cleared_at';
/* A conversation from the viewer's seat (DM_THREAD_COLS; migration 0016). */
export type DmThreadRow = {
  id: number; kind: number; pair_key: string | null; name: string | null; created_at: number; created_by: string | null;
  last_at: number; last_sender: string; msgs: number; ttl: number | null;
  joined_at: number; left_at: number | null; read_at: number | null; cleared_at: number | null;
};

/* The conversation a request names, from this member's seat: by `thread_id`
   (a current member's thread, else null — a stranger's ask is
   indistinguishable from nonexistence) or by the pair behind `with` (a room
   that may not exist yet: `thread` null with `other` set, so the caller may
   make it). The row carries the viewer's own member stamps. */
export async function dmThreadFor(env: Env, me: string, data: Body | null): Promise<{ thread: DmThreadRow | null; other: string } | null> {
  const id = Math.floor(Number(data && data.thread_id) || 0);
  if (id > 0) {
    const t = await env.DB.prepare('SELECT ' + DM_THREAD_COLS + ' FROM dm_threads t ' + DM_MINE + ' WHERE t.id = ?2').bind(me, id).first<DmThreadRow>();
    if (!t) return null;
    return { thread: t, other: Number(t.kind) === 0 ? dmPairOther(t.pair_key, me) : '' };
  }
  const other = String((data && data.with) || '');
  if (!/^[0-9a-f]{64}$/.test(other) || other === me) return null;
  const t = await env.DB.prepare('SELECT ' + DM_THREAD_COLS + ' FROM dm_threads t ' + DM_MINE + ' WHERE t.pair_key = ?2').bind(me, dmPairKey(me, other)).first<DmThreadRow>();
  return { thread: t || null, other };
}

/* A pair's room, made on its first word (or its first setting) with both
   member rows; an existing one is returned as it stands. `bump` moves the
   last-word fields (never for a held send: the recipient's world stays
   untouched). The legacy a_hash/b_hash are still WRITTEN for a pair — never
   read by this code — so a rolled-back worker would still find the room;
   the target-less ON CONFLICT covers the pair index and the legacy one alike,
   and heals a room the old worker made without its pair_key. */
export async function ensurePairThread(env: Env, h1: string, h2: string, now: number, opts?: { bump?: boolean; sender?: string }) {
  const [a, b] = dmPair(h1, h2);
  const sender = (opts && opts.sender) || h1;
  const row = await env.DB.prepare(
    'INSERT INTO dm_threads (kind, pair_key, created_at, last_at, last_sender, msgs, a_hash, b_hash) VALUES (0, ?1, ?2, ?2, ?3, 0, ?4, ?5) ' +
    (opts && opts.bump
      ? 'ON CONFLICT DO UPDATE SET pair_key = COALESCE(pair_key, excluded.pair_key), last_at = ?2, last_sender = ?3 RETURNING id'
      : 'ON CONFLICT DO UPDATE SET pair_key = COALESCE(pair_key, excluded.pair_key) RETURNING id')
  ).bind(dmPairKey(a, b), now, sender, a, b).first<{ id: number }>() as { id: number };
  await env.DB.prepare('INSERT OR IGNORE INTO dm_members (thread_id, hash, joined_at) VALUES (?1, ?2, ?3)').bind(row.id, a, now).run();
  await env.DB.prepare('INSERT OR IGNORE INTO dm_members (thread_id, hash, joined_at) VALUES (?1, ?2, ?3)').bind(row.id, b, now).run();
  return row;
}

/* The current members of a thread with their published keys, joined-first. */
export async function dmCurrentMembers(env: Env, threadId: number): Promise<{ hash: string; pubkey: string | null }[]> {
  const r = await env.DB.prepare(
    'SELECT mb.hash, pk.pubkey FROM dm_members mb LEFT JOIN dm_pubkeys pk ON pk.hash = mb.hash ' +
    'WHERE mb.thread_id = ?1 AND mb.left_at IS NULL ORDER BY mb.joined_at, mb.hash'
  ).bind(threadId).all<{ hash: string; pubkey: string | null }>();
  return (r.results || []).map((m) => ({ hash: String(m.hash), pubkey: m.pubkey || null }));
}

/* These members' published keys (an unmade pair's room: the two of them). */
export async function dmPubkeysOf(env: Env, hashes: readonly string[]): Promise<{ hash: string; pubkey: string | null }[]> {
  const list = hashes.filter((h) => /^[0-9a-f]{64}$/.test(h));
  if (!list.length) return [];
  const r = await env.DB.prepare('SELECT hash, pubkey FROM dm_pubkeys WHERE hash IN (' + inList(list.length) + ')').bind(...list).all<{ hash: string; pubkey: string }>();
  const by: Record<string, string> = {};
  for (const row of (r.results || [])) by[row.hash] = row.pubkey;
  return list.map((h) => ({ hash: h, pubkey: by[h] || null }));
}

/* Who a word from `me` reaches: every current member but me, minus any who
   block me — their world stays untouched (in a group the block is theirs
   alone; a pair's held send never reaches here). */
export async function dmRecipients(env: Env, threadId: number, me: string): Promise<string[]> {
  const r = await env.DB.prepare(
    'SELECT mb.hash FROM dm_members mb WHERE mb.thread_id = ?1 AND mb.left_at IS NULL AND mb.hash != ?2 ' +
    'AND NOT EXISTS (SELECT 1 FROM dm_blocks b WHERE b.owner_hash = mb.hash AND b.blocked_hash = ?2)'
  ).bind(threadId, me).all<{ hash: string }>();
  return (r.results || []).map((m) => String(m.hash));
}

/* Every member row of a thread, the departed included (their names and keys
   still open the words they sent), with the profile fields the thread shows:
   nick, avatar, the hub's last_seen_at, the receipts mode (a stamp is served
   only under it), and the published key. */
/* A member row as a thread shows it (dmMembersPayload, dmPairRoomRows). */
export type DmMemberRow = {
  hash: string; joined_at: number | null; left_at: number | null; read_at: number | null; added_by: string | null;
  nick: string | null; avatar: string | null; last_seen_at: number | null; receipts_mode: string | null; pubkey: string | null;
};
export async function dmMembersPayload(env: Env, threadId: number): Promise<DmMemberRow[]> {
  const r = await env.DB.prepare(
    'SELECT mb.hash, mb.joined_at, mb.left_at, mb.read_at, mb.added_by, pr.nick, pr.avatar, pr.last_seen_at, pr.receipts_mode, pk.pubkey ' +
    'FROM dm_members mb LEFT JOIN profiles pr ON pr.hash = mb.hash LEFT JOIN dm_pubkeys pk ON pk.hash = mb.hash ' +
    'WHERE mb.thread_id = ?1 ORDER BY mb.joined_at, mb.hash'
  ).bind(threadId).all<DmMemberRow>();
  return r.results || [];
}

/* An unmade pair's room: its two would-be members in the same shape, no stamps. */
export async function dmPairRoomRows(env: Env, me: string, other: string): Promise<DmMemberRow[]> {
  const out: DmMemberRow[] = [];
  for (const h of [me, other]) {
    const pr = await env.DB.prepare('SELECT nick, avatar, last_seen_at, receipts_mode FROM profiles WHERE hash = ?1').bind(h)
      .first<{ nick: string | null; avatar: string | null; last_seen_at: number | null; receipts_mode: string | null }>();
    const pk = await env.DB.prepare('SELECT pubkey FROM dm_pubkeys WHERE hash = ?1').bind(h).first<{ pubkey: string }>();
    out.push({ hash: h, joined_at: null, left_at: null, read_at: null, added_by: null, nick: pr && pr.nick || null, avatar: pr && pr.avatar || null,
      last_seen_at: (pr && pr.last_seen_at) || null, receipts_mode: (pr && pr.receipts_mode) || null, pubkey: pk ? pk.pubkey : null });
  }
  return out;
}

/* May `me` read this object? Iff a live, visible, unredacted message naming
   it stands in a thread where I am a current member — the media GET's rule,
   and the rule a forward must pass to name the object again. */
export async function dmMediaReadable(env: Env, me: string, key: string, now: number) {
  const row = await env.DB.prepare(
    'SELECT 1 AS ok FROM dm_media_refs r JOIN dms m ON m.id = r.msg_id JOIN dm_threads t ON t.id = m.thread_id ' + DM_MINE + ' ' +
    'WHERE r.key = ?2 AND COALESCE(m.redacted, 0) = 0 AND ' + DM_VIS + ' AND ' + DM_CLEARED + ' AND ' + dmLive(now) + ' LIMIT 1'
  ).bind(me, key).first();
  return !!row;
}

/* Disappearing-message + media tunables, and the growing admin key/value store
   behind them (app_settings). A missing key falls back to these defaults; the
   admin console (Phase 3) edits the table and busts this per-isolate cache. */
export const DM_TTLS = Dm.ttlOptions.map((o) => o.secs);   // single-sourced from Domain.Dm
/* The old MEDIA_CAP_BYTES (a flat 10 GB) is GONE: R2's free 10 GB is
   ACCOUNT-WIDE (the audio Bible alone holds ~3.55 GB), so treating the whole
   allowance as a media cap could legally breach the $0 law. Storage is
   bounded by the per-section budgets below (Media.defaults: DM 2 GB + feed
   3 GB + board 1 GB = 6 GB, sized against ~6.3 GB measured headroom on
   2026-08-02) — re-measure with `wrangler r2 bucket info` before raising any
   of them. */
export const APP_SETTING_DEFAULTS = {
  /* Spare an identity that has already passed a challenge (Domain.Turnstile). */
  turnstile_skip_established: Turnstile.skipEstablishedDefault ? '1' : '0',
  media_enabled: '1',
  media_max_bytes: String(25 * 1024 * 1024),   // 25 MB per upload
  dm_default_ttl: String(Dm.defaultTtl),        // 30 days (single-sourced from Domain.Dm)
  dm_backstop_days: '30',                       // unopened-message backstop
  dm_media_bytes: '0',                          // sweep-maintained total, display-only
  /* The social layer's global kill switch (Domain.Wall.enabledFrom is the rule,
     so client and worker read the same polarity). '0' makes the Feed and every
     member wall answer as though they never existed — for everyone, admins
     included — while not one row is deleted: flip it back and the whole stream
     returns exactly as it was. Deliberately NOT gated by it: /wall/delete (an
     author must still be able to retract), the shared GET /wall/media (it serves
     forum attachments too), the admin pending/approve queue, and the storage
     sweeps. */
  social_enabled: '1',
  wall_prune_enabled: '0',                      // public posts persist forever until this is turned on
  wall_prune_days: '365',                       // retention when pruning is enabled
  discord_forum_webhook: '',                    // optional Discord webhook for new forum posts (empty = off)
  discord_feed_webhook: '',                     // optional Discord webhook for new feed posts (empty = off)
  discord_feed_comments: '0',                   // also send comments on feed posts to the feed webhook (noisy at scale)
  journal_topic: '219',                         // the forum topic whose posts become Journal articles
  journal_enabled: '1',                         // whether the Mere Catholicity Journal page is live
  /* Comments sections (Domain.Comments). Both default OFF — the OPPOSITE
     polarity of social_enabled, on purpose: the owner switched the sections
     off, and a fresh database opens none until an admin does. comments_pages
     is the CSV of own-writing paths whose section is open (the kernel drops
     anything else at parse and at save); comments_journal opens a section
     under every journal article ('journal:<article id>' page keys). A closed
     section answers exactly as an unknown page; nothing is deleted by either. */
  comments_pages: Comments.pagesEnabledDefault,
  comments_journal: Comments.journalEnabledDefault ? '1' : '0',
  /* Per-type / per-context media limits (Phase A, single-sourced in Domain.Media).
     media_max_bytes above stays as the absolute per-file ceiling: the effective
     cap for a kind is min(per-kind, ceiling). Kinds masks are CSV of
     image,video,audio; an empty mask turns uploads off for that context. */
  media_image_max_bytes: String(Media.defaults.imageMaxBytes),
  media_video_max_bytes: String(Media.defaults.videoMaxBytes),
  media_audio_max_bytes: String(Media.defaults.audioMaxBytes),
  media_audio_max_seconds: String(Media.defaults.audioMaxSeconds),   // recorder stop; client-advisory (the server cannot decode audio — its wall is bytes)
  media_kinds_dm: Media.defaults.kindsDm,
  media_kinds_wall: Media.defaults.kindsWall,
  media_kinds_board: Media.defaults.kindsBoard,
  media_image_autocompress: '1',                // client-side canvas downscale before upload
  media_cap_dm_bytes: String(Media.defaults.capDmBytes),     // DM media store budget (was a hardcoded 10 GB fantasy)
  media_cap_wall_bytes: String(Media.defaults.capWallBytes), // the FEED's media store budget (board split out 2026-08-02)
  media_cap_board_bytes: String(Media.defaults.capBoardBytes), // the forum's own budget
  wall_media_bytes: '0',                        // sweep-maintained totals, display-only
  board_media_bytes: '0',
  /* Per-section knobs (2026-08-02; key grammar single-sourced in Domain.Media's
     section*Key builders). Scan = the LLaVA image screen per PUBLIC section —
     there is deliberately NO media_scan_dm key: DM media is E2E ciphertext and
     scanning it is structurally impossible. Voice = the 🎙 recorder feature
     flag (client-advisory — the server cannot tell a voice note from a file).
     Retention = media-only age pruning; 0 = keep forever for the public
     sections, while the DM knob (1..90) replaces the old hardcoded 30-day cap.
     The 12 per-section OVERRIDE keys (media_<ctx>_<kind>_max_bytes and
     media_audio_max_seconds_<ctx>) are deliberately NOT seeded here: absence
     means "inherit the legacy global", and seeding them would freeze that
     fallback chain dead. */
  media_scan_wall: '1',
  media_scan_board: '1',
  media_voice_dm: '1',
  media_voice_wall: '1',
  media_voice_board: '1',
  media_wall_retention_days: String(Media.defaults.retentionWallDays),
  media_board_retention_days: String(Media.defaults.retentionBoardDays),
  media_dm_retention_days: String(Dm.mediaMaxSeconds / 86400),   // '30', single-sourced from Domain.Dm
  /* 1v1 voice calls (2026-08-03). calls_enabled is the global kill switch —
     off refuses every /call/* endpoint and hides the 📞 button (served in
     /config). calls_turn governs the TURN relay leg only: off = /call/turn
     serves the free STUN-only fallback (most calls still connect P2P; strict
     networks fail honestly) — the zero-billing-exposure position, since TURN
     past its 1,000 GB/month free pool bills per GB with no cap. */
  calls_enabled: '1',
  calls_turn: '1',
  /* The TURN guard (2026-09-17, usage.ts turnGuard): switch the relay off at
     this share of the month's free pool, back on when the month renews. */
  turn_guard_on: CallK.turnGuardDefaults.on ? '1' : '0',
  turn_guard_pct: String(CallK.turnGuardDefaults.pct),
  /* Silence auto-hangup: an Active call where NEITHER side clears the voice
     floor for this many seconds ends itself (both clients run the watch off
     /config; the default and clamp are Domain.Call's). */
  calls_idle_hangup: '1',
  calls_idle_seconds: String(CallK.idleDefaultSecs),
  /* The worker's voice (2026-09-16, alerts.ts): where a failed cron step, a
     missing backup or a usage alert is reported. A channel speaks when its
     switch is on AND its field holds a valid value (Domain.Ops.channelsFrom) —
     the owner picks email, Discord or both; empty or off is silent. The
     address must be a VERIFIED Email Routing destination (the dashboard). */
  alert_email: '',
  alert_email_on: '1',
  alert_discord_webhook: '',
  alert_discord_on: '1',
};
/* The settings as the table holds them: every value a string. */
export type Settings = Record<string, string>;
export const appSettingsCache: { at: number; s: Settings | null } = { at: 0, s: null };
export async function getAppSettings(env: Env): Promise<Settings> {
  const now = Date.now();
  if (appSettingsCache.s && now - appSettingsCache.at < 300000) return appSettingsCache.s;
  const s: Settings = Object.assign({}, APP_SETTING_DEFAULTS);
  try {
    const rows = await env.DB.prepare('SELECT k, v FROM app_settings').all<{ k: string; v: string }>();
    for (const r of (rows.results || [])) s[r.k] = r.v;
  } catch (e) { /* fresh DB: defaults stand */ }
  appSettingsCache.at = now; appSettingsCache.s = s;
  return s;
}
export function dmDefaultTtl(s: Settings): number { return Number(s.dm_default_ttl) || Dm.defaultTtl; }
export function dmBackstopSeconds(s: Settings) { return (Number(s.dm_backstop_days) || 30) * 86400; }

/* ---- Per-kind media limits and context masks (single-sourced in Domain.Media).
   This is the worker-side membrane over the kernel: Maybe is erased here and
   nowhere else, mirroring app/core.ts on the client side. ---- */
const psOrNull = <T>(m: unknown): T | null => MaybeM.maybe(null)((x: T) => x)(m);

/* One DM reaction, validated by the kernel (Domain.Dm.normalizeReaction):
   exactly one emoji, or one of our own custom-pack :tokens: lower-cased; null
   for anything else. The ONE place the worker erases that Maybe — the client's
   picker runs the same rule through mcCore.dmReaction, so what the store
   accepts the bubble renders, and neither side keeps an inline regex. */
/* The ONE reaction validator (Domain.Reaction.normalizeReaction): exactly one
   emoji or one known custom-pack token, or null. Every store runs it — a DM's
   side (handleDmReact) and the public ledger (handleReact) — never an inline
   regex. `dmReaction` is the same function under the name the DM handler and
   its tests have carried since 2026-09-10. */
export function reactionOf(raw: unknown): string | null {
  return psOrNull<string>(Reaction.normalizeReaction(String(raw == null ? '' : raw)));
}
export const dmReaction = reactionOf;

/* A group's name as stored (Domain.Dm.normalizeGroupName): trimmed, folded,
   cut to the cap, control characters dropped; null when nothing is left. */
export function dmGroupName(raw: unknown): string | null {
  return psOrNull<string>(Dm.normalizeGroupName(String(raw == null ? '' : raw)));
}

/* Who may be added by `me` (2026-09-13): a member with a published key (the
   envelope needs it) who does not block me — the two refusals wear ONE
   generic word at the handler, so a block is indistinguishable from "no key
   yet" (the standing rule). The bot is never a member. */
/* A list in a body: the field when it is an array, else an empty one. */
export function listOf(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

export async function dmEligible(env: Env, me: string, hashes: unknown): Promise<{ ok: string[]; missing: string[] }> {
  /* the ids arrive as pubids (the P0 chain L3) — resolve each to the account
     hash the roster and dm_pubkeys are keyed by; an unknown id is dropped */
  const wire = Array.from(new Set(listOf(hashes).map((h) => String(h || '')).filter((h) => /^[0-9a-f]{64}$/.test(h))));
  const resolved = await Promise.all(wire.map((h) => resolveId(env, h)));
  const want = Array.from(new Set(resolved.filter((h): h is string => !!h && h !== me && h !== MERECAT_BOT.hash)));
  if (!want.length) return { ok: [], missing: [] };
  const r = await env.DB.prepare(
    'SELECT pk.hash FROM dm_pubkeys pk WHERE pk.hash IN (' + inList(want.length, 2) + ') ' +
    'AND NOT EXISTS (SELECT 1 FROM dm_blocks b WHERE b.owner_hash = pk.hash AND b.blocked_hash = ?1)'
  ).bind(me, ...want).all<{ hash: string }>();
  const ok = new Set((r.results || []).map((x) => String(x.hash)));
  return { ok: want.filter((h) => ok.has(h)), missing: want.filter((h) => !ok.has(h)) };
}
export const REACT_TARGETS: string[] = Reaction.targets;
export const isReactTarget = (t: unknown): boolean => Reaction.isTarget(String(t == null ? '' : t));
/* The notification kinds by family, from Domain.Notif.kinds: the kinds whose
   topic_id/comment_id name a board thread and post (joinable to `comments`),
   and the wall's kinds (joinable to `wall_posts`, hidden with the social
   switch). Everything else — dm, call, merecat, dm-react — joins nothing. */
export const NOTIF_KINDS: string[] = Notif.kinds;
export const NOTIF_POST_KINDS = ['reply', 'mention', 'react'];
export const NOTIF_WALL_KINDS = ['wall', 'wall-like', 'wall-react'];
const sqlList = (xs: string[]) => "('" + xs.join("','") + "')";

/* The tallies of a batch of targets, one grouped query: { id: [{e, n}, …] }
   with the most-given first (ties by first given). Public — a reaction is
   public — so the rows are the caller's to serve; only rows for ids the
   caller may show are ever asked for. */
/* the positive whole ids in a list, once each */
function idsOf(ids: readonly unknown[]): number[] {
  return [...new Set(ids.map((x) => Math.floor(Number(x) || 0)).filter((x) => x > 0))];
}
export async function reactionsFor(env: Env, target: string, ids: readonly unknown[]): Promise<Record<string, Array<{ e: string; n: number }>>> {
  const out: Record<string, Array<{ e: string; n: number }>> = {};
  const uniq = idsOf(ids);
  if (!uniq.length || !isReactTarget(target)) return out;
  for (let i = 0; i < uniq.length; i += 80) {
    const chunk = uniq.slice(i, i + 80);
    const rows = await env.DB.prepare(
      'SELECT target_id, emoji, COUNT(*) AS n, MIN(created_at) AS first FROM reactions WHERE target = ?1 AND target_id IN (' + inList(chunk.length, 2) + ') ' +
      'GROUP BY target_id, emoji ORDER BY target_id, n DESC, first'
    ).bind(target, ...chunk).all<{ target_id: number; emoji: string; n: number }>();
    for (const r of (rows.results || [])) {
      (out[String(r.target_id)] = out[String(r.target_id)] || []).push({ e: String(r.emoji), n: Number(r.n) || 0 });
    }
  }
  return out;
}
/* What the viewer put on each of a batch of targets: { id: emoji } for the
   ones they reacted to. One indexed lookup (reactions_author_idx). */
export async function myReactionsFor(env: Env, me: string | null, target: string, ids: readonly unknown[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const uniq = idsOf(ids);
  if (!me || !uniq.length || !isReactTarget(target)) return out;
  for (let i = 0; i < uniq.length; i += 80) {
    const chunk = uniq.slice(i, i + 80);
    const rows = await env.DB.prepare(
      'SELECT target_id, emoji FROM reactions WHERE author_hash = ?1 AND target = ?2 AND target_id IN (' + inList(chunk.length, 3) + ')'
    ).bind(me, target, ...chunk).all<{ target_id: number; emoji: string }>();
    for (const r of (rows.results || [])) out[String(r.target_id)] = String(r.emoji);
  }
  return out;
}
/* Stamp a batch of served rows with their tallies and, for a keyed viewer,
   their own reaction: `reacts` ([{e,n}]) and `react_me` ('' for none) on each
   row whose `id` is a target of `target`. `likes` (the total) and `liked`
   (react_me ? 1 : 0) ride along for one deploy of clients cached before the
   picker. */
export async function stampReactions<R extends Record<string, unknown>>(env: Env, target: string, rows: R[], me: string | null): Promise<R[]> {
  const ids = rows.map((r) => r && r.id);
  const tally = await reactionsFor(env, target, ids);
  const mine: Record<string, string> = me ? await myReactionsFor(env, me, target, ids) : {};
  for (const row of rows) {
    if (!row) continue;
    const r: Record<string, unknown> = row;
    const cells = tally[String(r.id)] || [];
    r.reacts = cells;
    r.react_me = mine[String(r.id)] || '';
    r.likes = cells.reduce((a, c) => a + c.n, 0);
    r.liked = r.react_me ? 1 : 0;
  }
  return rows;
}
/* The kind ('image'|'video'|'audio') encoded in a wall/<i|v|a>/<64hex> object
   key, or null for anything malformed. Strictness lives in the kernel. */
export function mediaKindOfKey(key: unknown) { return psOrNull<string>(Media.kindOfKey(String(key || ''))); }
/* Effective per-file cap for one kind: the per-SECTION override when ctx is
   given and its key is stored, else the admin's legacy global per-kind setting,
   else the kernel default — always bounded by the media_max_bytes ceiling
   (safe-by-default: raising a kind past the ceiling needs both knobs, and the
   settings page says so). Called WITHOUT ctx it behaves exactly as before the
   per-section split — that is what keeps the legacy /config block honest. */
export function mediaKindMax(s: Settings, kind: string, ctx?: string) {
  let stored = 0;
  if (ctx) {
    const sk = psOrNull<string>(Media.sectionKindBytesKey(ctx)(kind));
    if (sk && s[sk] != null) stored = Math.floor(Number(s[sk])) || 0;
  }
  if (!(stored > 0)) stored = Math.floor(Number(s['media_' + kind + '_max_bytes'])) || 0;
  const defaults: Record<string, unknown> = Media.defaults;
  const fallback = Number(defaults[kind + 'MaxBytes']) || (10 * 1024 * 1024);
  const ceiling = Number(s.media_max_bytes) || (25 * 1024 * 1024);
  return Math.min(stored > 0 ? stored : fallback, ceiling);
}
/* The kinds an upload context (dm | wall | board) accepts. Empty = off. */
export function mediaKindsFor(s: Settings, ctx: string): string[] {
  const raw = s['media_kinds_' + ctx];
  return Media.parseKinds(String(raw == null ? '' : raw));
}
/* The largest per-file cap across a context's allowed kinds — the pre-parse
   Content-Length gate (the kind is unknown before the form parses) and the DM
   ciphertext cap (E2E blinds the server to the kind, so the max is the wall). */
export function mediaMaxAcross(s: Settings, kinds: string[], ctx?: string) {
  let m = 0;
  for (const k of kinds) m = Math.max(m, mediaKindMax(s, k, ctx));
  return m;
}
/* Whether a section's image uploads pass the AI screen. The kernel returns no
   key for 'dm' — E2E ciphertext is structurally unscannable — so this is false
   there by construction, not by configuration. */
export function mediaScanEnabled(s: Settings, ctx: string) {
  const k = psOrNull<string>(Media.sectionScanKey(String(ctx || '')));
  return k ? s[k] !== '0' : false;
}
/* The per-section 🎙 voice-recorder feature flag (served in /config; enforced
   client-side — the server cannot tell a voice note from any other audio). */
export function mediaVoiceEnabled(s: Settings, ctx: string) {
  const k = psOrNull<string>(Media.sectionVoiceKey(String(ctx || '')));
  return k ? s[k] !== '0' : false;
}
/* The social layer's on/off state, read through the kernel so the '1'/'0'
   polarity lives in exactly one place (Domain.Wall). Every /wall* gate and the
   /config block below go through this — never a bare string compare. */
export function socialEnabled(s: Settings): boolean { return Wall.enabledFrom(String(s.social_enabled)); }

/* The refusal a disabled feed/wall surface gives: indistinguishable from a path
   the platform never had. */
export const noSuchPage = () => json({ ok: false, error: 'No such page.' }, 404);
export async function socialOff(env: Env) { return !socialEnabled(await getAppSettings(env)); }

/* Wall notifications point at feed posts. With the social layer off those posts
   are unreachable, so counting or listing them would leave a bell the reader can
   never clear. Hide them from every count and from the list; the rows stay in D1
   and come back, read-state intact, the moment the switch goes on again. */
export const notifHideWall = (alias: string) => " AND " + alias + "kind NOT IN ('" + NOTIF_WALL_KINDS.join("','") + "') ";
export async function notifHideWallSql(env: Env, alias: string) {
  return (await socialOff(env)) ? notifHideWall(alias) : '';
}
export async function notifUnreadCount(env: Env, me: string) {
  const row = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM notifications WHERE recipient_hash = ?1 AND read_at IS NULL'
    + await notifHideWallSql(env, '')
  ).bind(me).first<{ n: number }>();
  return (row && row.n) || 0;
}
/* Whether an identity that has already passed a challenge is spared the next
   one (app_settings `turnstile_skip_established`). See Domain.Turnstile for why
   this exists at all: in the installed iOS app, mounting the widget took the
   document down, and a challenge that cannot run is not a gate but an outage. */
export function turnstileSkipEstablished(s: Settings): boolean { return Turnstile.skipFrom(String(s.turnstile_skip_established)); }
/* Comments sections (Domain.Comments). A page's section is open only when its
   path is in the stored CSV; the journal's only on a literal '1' (the kernel
   holds the polarity — see its module note). The worker decides every read
   and write; /config carries the client's courtesy copy. */
export function commentsPagesOn(s: Settings): string[] { return Comments.parseEnabledPages(String(s.comments_pages == null ? '' : s.comments_pages)); }
export function commentsPageOn(s: Settings, page: unknown): boolean { return Comments.pageEnabled(String(s.comments_pages == null ? '' : s.comments_pages))(String(page || '')); }
export function commentsJournalOn(s: Settings): boolean { return Comments.journalEnabledFrom(String(s.comments_journal == null ? '' : s.comments_journal)); }
/* A journal article's comments page key ('journal:<article id>'), vetted by
   the kernel — the canonical key or null, the boardKey idiom. Whether that
   article is LIVE in the current journal topic is a separate question
   (journalArticleLive in index.ts), asked at every read and write. */
export function journalKeyId(raw: unknown): number | null { return psOrNull<number>(Comments.journalKeyId(String(raw || ''))); }
export function journalKey(raw: unknown): string | null {
  const n = journalKeyId(raw);
  return n == null ? null : Comments.journalKey(n);
}
/* The voice-note length limit for a section: per-section override, else the
   legacy global, else the kernel default. Client-advisory, like the global. */
export function mediaAudioSeconds(s: Settings, ctx?: string): number {
  if (ctx) {
    const k = psOrNull<string>(Media.sectionAudioSecondsKey(ctx));
    const sec = k && s[k] != null ? Math.floor(Number(s[k])) || 0 : 0;
    if (sec > 0) return sec;
  }
  return Number(s.media_audio_max_seconds) || Number(Media.defaults.audioMaxSeconds);
}
/* A section's media age retention in days. wall/board: 0 = keep forever (the
   default). dm: the knob replaces the old hardcoded Dm.mediaMaxSeconds 30-day
   hard cap and is clamped 1..90 — DM media can never be "forever". */
export function mediaRetentionDays(s: Settings, ctx: string) {
  const k = psOrNull<string>(Media.sectionRetentionKey(String(ctx || '')));
  if (!k) return 0;
  const n = Math.floor(Number(s[k])) || 0;
  if (ctx === 'dm') return Number(Media.clampDmRetentionDays(n || (Dm.mediaMaxSeconds / 86400)));
  return n > 0 ? Number(Media.clampRetentionDays(n)) : 0;
}

/* ESTABLISHED = has passed a Cloudflare challenge at least once, which is
   `profiles.verified_at` and nothing else (0018, 2026-09-17). It spares the
   challenge (Domain.Turnstile) and it opens what a challenge is the price of:
   uploads (not gated themselves, so a drive-by key could otherwise store
   megabytes in R2), calls, the first DM.

   It USED to read "has a profiles row, a comment or a wall post" — and since
   2026-09-16 any keyed read leaves a profiles row (registerMember), so reading
   the board once established an identity and the challenge asked nothing of
   anybody. The row means "has acted"; only the stamp means "a person answered
   for this identity". */
export async function isEstablished(env: Env, hash: string | null | undefined) {
  if (!hash) return false;
  const p = await env.DB.prepare('SELECT 1 AS v FROM profiles WHERE hash = ?1 AND verified_at IS NOT NULL').bind(hash).first();
  return !!p;
}

/* The stamp, written by verifyTurnstile the moment siteverify says yes. The
   row may not exist yet (a first post from a key that has read nothing), and
   an identity keeps its FIRST verification — a later challenge never moves the
   date. Idempotent, and never undone except by an admin clearing the row. */
export async function markVerified(env: Env, hash: string, now = Math.floor(Date.now() / 1000)) {
  await env.DB.prepare(
    'INSERT INTO profiles (hash, created_at, verified_at) VALUES (?1, ?2, ?2) '
    + 'ON CONFLICT(hash) DO UPDATE SET verified_at = COALESCE(profiles.verified_at, ?2)',
  ).bind(hash, now).run();
}

/* The one road a member row appears by (P2-2, 2026-09-16). A keyed act on a
   fresh identity — the board's unread count, the settings gear, a merecat ask,
   the hub's last-seen stamp — makes the `profiles` row that `isEstablished`
   (the Turnstile spare) reads; four handlers used to write it each on their
   own. The profile save, the avatar upload and the first post write their
   richer rows themselves. Idempotent. A row alone does NOT list an identity in
   the member directory: that takes a nick, a post or a published DM key
   (handleDmDirectory) — the difference between "has acted" and "is someone". */
export async function registerMember(env: Env, hash: string, now = Math.floor(Date.now() / 1000)) {
  await env.DB.prepare('INSERT OR IGNORE INTO profiles (hash, created_at) VALUES (?1, ?2)').bind(hash, now).run();
  /* No pubid is stored: it is a pure function of the pepper and the hash
     (pubidOf), and resolveId rebuilds the reverse map from reads, so a member is
     resolvable the moment their hash is in any identity column (the P0 chain, L3). */
}

/* ================= Discord webhook fan-out =================
   Two OPTIONAL webhooks (forum posts, feed posts) live in app_settings as full
   Discord webhook URLs; empty = off. The URL is validated by isDiscordWebhook
   (pure.ts) so a corrupted/hostile setting can never make the worker POST member
   content to an arbitrary host. Member text rides ONLY in an embed (embeds never
   ping) and allowed_mentions is emptied, so no post body can @everyone or @here
   the channel. Fire-and-forget with a hard timeout: a dead or slow webhook never
   delays or breaks a post. Callers exclude the back room. Answers whether
   Discord accepted the post (the alerts road reports it; the feed hooks
   ignore it, as before). */
export async function sendDiscord(hookUrl: unknown, embed: Record<string, unknown>): Promise<boolean> {
  if (!isDiscordWebhook(hookUrl)) return false;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 5000);
  try {
    const r = await fetch(String(hookUrl).trim(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'Mere Catholicity',
        embeds: [embed],
        allowed_mentions: { parse: [] },
      }),
      signal: ctl.signal,
    });
    return r.ok;
  } catch (e) { return false; /* a dead webhook must never break a post */ }
  finally { clearTimeout(timer); }
}

/* Announce a fresh LIVE forum post to Discord, if a forum webhook is configured.
   Topics and replies both go (the message distinguishes them); the back room is
   NEVER announced (the caller excludes it). Reads the topic title for a reply so
   the embed can say what thread it landed in. Fire-and-forget: any failure is
   swallowed, so Discord being down or misconfigured never touches the post. */
export async function notifyDiscordForum(env: Env, p: {
  page: string; commentId: number; topicId: number; isReply: boolean;
  title: string | null; authorHash: string | null; nick: string | null; body: string; hasMedia?: boolean; createdAt: number;
}) {
  const s = await getAppSettings(env);
  const hook = s.discord_forum_webhook;
  if (!isDiscordWebhook(hook)) return;
  let topicTitle = p.title;
  if (p.isReply || !topicTitle) {
    const t = await env.DB.prepare('SELECT title FROM comments WHERE id = ?1').bind(p.topicId).first<{ title: string | null }>();
    topicTitle = (t && t.title) || 'a thread';
  }
  /* an anonymous post has no hash to name (displayName throws on null) */
  const name = await publicName(env, p.authorHash, p.nick);
  const link = siteBase(env) + '/community.html?topic=' + p.topicId + '#comment-' + p.commentId;
  const heading = p.isReply ? (name + ' replied in “' + topicTitle + '”')
    : (name + ' started a new topic');
  await sendDiscord(hook, {
    title: (topicTitle || 'New forum post').slice(0, 240),
    url: link,
    description: discordSnippet(p.body) || (p.hasMedia ? '(shared an attachment)' : (p.isReply ? '(reply)' : '(new topic)')),
    author: { name: heading.slice(0, 240) },
    color: 0x7a1f2b,
    footer: { text: 'Mere Catholicity · Community' },
    timestamp: new Date(p.createdAt * 1000).toISOString(),
  });
}

/* Announce a fresh LIVE feed (wall) post to Discord, if a feed webhook is set. */
export async function notifyDiscordFeed(env: Env, p: {
  postId: number; authorHash: string; body: string;
  hasMedia: boolean; createdAt: number;
}) {
  const s = await getAppSettings(env);
  const hook = s.discord_feed_webhook;
  if (!isDiscordWebhook(hook)) return;
  const prof = await env.DB.prepare('SELECT nick FROM profiles WHERE hash = ?1').bind(p.authorHash).first<{ nick: string | null }>();
  const name = await publicName(env, p.authorHash, prof && prof.nick);
  const link = siteBase(env) + '/feed.html?post=' + p.postId;
  await sendDiscord(hook, {
    title: 'New post in the feed',
    url: link,
    description: discordSnippet(p.body) || (p.hasMedia ? '(shared an attachment)' : ''),
    author: { name: (name + ' posted').slice(0, 240) },
    color: 0x7a1f2b,
    footer: { text: 'Mere Catholicity · Feed' },
    timestamp: new Date(p.createdAt * 1000).toISOString(),
  });
}

/* Announce a fresh LIVE comment on a feed post to Discord — only when the feed
   webhook is set AND the admin opted in (discord_feed_comments). Handy early on,
   deliberately off by default because it gets noisy as the platform grows. */
export async function notifyDiscordFeedComment(env: Env, p: {
  postId: number; authorHash: string; body: string; createdAt: number;
}) {
  const s = await getAppSettings(env);
  const hook = s.discord_feed_webhook;
  if (s.discord_feed_comments !== '1' || !isDiscordWebhook(hook)) return;
  const prof = await env.DB.prepare('SELECT nick FROM profiles WHERE hash = ?1').bind(p.authorHash).first<{ nick: string | null }>();
  const name = await publicName(env, p.authorHash, prof && prof.nick);
  const link = siteBase(env) + '/feed.html?post=' + p.postId;
  await sendDiscord(hook, {
    title: 'New comment in the feed',
    url: link,
    description: discordSnippet(p.body) || '(a comment)',
    author: { name: (name + ' commented').slice(0, 240) },
    color: 0x7a1f2b,
    footer: { text: 'Mere Catholicity · Feed' },
    timestamp: new Date(p.createdAt * 1000).toISOString(),
  });
}

/* Fan a fresh LIVE post out to every PER-FEED Discord subscription that matches
   it (the discord_hooks table). A board reply matches its thread's `topic:<id>`
   AND its `cat:<key>`; a new topic matches its `cat:<key>`; an article-page
   comment matches `page:<page>`. Independent of the two coarse global webhooks
   above — a post can announce to both. The back room is excluded by the caller.
   Fire-and-forget per subscription so one bad webhook never blocks the others or
   the poster's response. */
export async function deliverDiscordFeedHooks(env: Env, p: {
  commentId: number; parentId: number | null; page: string; isReply: boolean;
  title: string | null; authorHash: string | null; nick: string | null; body: string; hasMedia: boolean; createdAt: number;
}) {
  const scopes: string[] = [];
  const topicId = p.isReply ? Number(p.parentId) : p.commentId;
  if (topicId) scopes.push('topic:' + topicId);
  if (boardKey(p.page)) scopes.push('cat:' + p.page.slice(6));
  else scopes.push('page:' + p.page);
  if (!scopes.length) return;
  const rows = await env.DB.prepare(
    'SELECT id, scope, hook_url FROM discord_hooks WHERE scope IN (' +
    scopes.map((_, i) => '?' + (i + 1)).join(',') + ')'
  ).bind(...scopes).all<{ id: number; scope: string; hook_url: string }>();
  const hooks = (rows && rows.results) || [];
  if (!hooks.length) return;
  const name = await publicName(env, p.authorHash, p.nick);
  const isBoard = boardKey(p.page);
  let topicTitle = p.title;
  if (isBoard && (p.isReply || !topicTitle)) {
    const t = await env.DB.prepare('SELECT title FROM comments WHERE id = ?1').bind(topicId).first<{ title: string | null }>();
    topicTitle = (t && t.title) || 'a thread';
  }
  const link = viewLink(env, p.page, p.commentId, p.isReply ? p.parentId : null);
  const heading = isBoard
    ? (p.isReply ? (name + ' replied in “' + topicTitle + '”') : (name + ' started a new topic'))
    : (name + ' commented');
  /* Dedupe by hook URL so two overlapping subscriptions (e.g. topic AND its
     category) pointing at the SAME channel post only once. */
  const seen = new Set<string>();
  const jobs = hooks
    .filter((h) => { if (seen.has(h.hook_url)) return false; seen.add(h.hook_url); return true; })
    .map((h) => sendDiscord(h.hook_url, {
      title: (isBoard ? (topicTitle || 'New forum post') : 'New comment').slice(0, 240),
      url: link,
      description: discordSnippet(p.body) || (p.hasMedia ? '(shared an attachment)' : (p.isReply ? '(reply)' : '')),
      author: { name: heading.slice(0, 240) },
      color: 0x7a1f2b,
      footer: { text: 'Mere Catholicity · ' + scopeLabel(h.scope) },
      timestamp: new Date(p.createdAt * 1000).toISOString(),
    }).catch((e: unknown) => console.log(JSON.stringify({ event: 'discord_hook_failed', id: h.id, error: String(e) }))));
  await Promise.all(jobs);
}

/* A system line into ONE conversation (2026-09-13): a plaintext (enc 2) word
   the server writes about the thread — a topic-move notice, a call's line,
   "X added Y", "X left", "X named the conversation" — from the actor's seat.
   Always unheld (a moderation notice reaches its target regardless of
   blocks), post-dating any clear stamp so a fresh-started thread resurfaces
   to carry it; counts as unread for everyone else, like any word. Fanned to
   every other current member's own connections; a bell for each unless the
   caller rings its own (a call's line rides the 'call' bell, never a second
   'dm' one). Returns the message id. */
export async function sendSystemDmLine(env: Env, threadId: number, actorHash: string, body: string, opts?: { quiet?: boolean }) {
  if (!threadId || !actorHash || !body) return 0;
  const now = Math.floor(Date.now() / 1000);
  const msg = await env.DB.prepare(
    'INSERT INTO dms (thread_id, sender_hash, body, created_at, held, enc, expires_at) VALUES (?1, ?2, ?3, ?4, 0, 2, ?5) RETURNING id'
  ).bind(threadId, actorHash, body, now, now + dmBackstopSeconds(await getAppSettings(env))).first<{ id: number }>();
  await env.DB.prepare(
    'UPDATE dm_threads SET msgs = (SELECT COUNT(*) FROM dms WHERE thread_id = ?1 AND COALESCE(held, 0) = 0), last_at = ?2, last_sender = ?3 WHERE id = ?1'
  ).bind(threadId, now, actorHash).run();
  await env.DB.prepare('UPDATE dm_members SET read_at = ?2 WHERE thread_id = ?1 AND hash = ?3').bind(threadId, now, actorHash).run();
  const to = await dmRecipients(env, threadId, actorHash);
  /* Nudge every other member's own connections (badge + open thread) like any
     DM — AND the actor's own (2026-09-14): a system line has no local echo
     (the caller's "Voice call · No answer" is written here, seconds after
     they cancelled, into the conversation on their screen), so the actor's
     live sockets must hear it too. The client lets its own enc-2 word through
     where it drops its own echoed messages. */
  const live = to.concat([String(actorHash)]);
  await publishUser(env, [{ v: 1, t: 'dm', scopes: live.map((h) => 'user:' + h), from: actorHash, thread_id: threadId,
    message: { id: (msg && msg.id) || 0, sender_hash: actorHash, body: body, created_at: now, enc: 2 } }]);
  if (!(opts && opts.quiet)) for (const h of to) await notifyDm(env, h, actorHash, threadId);
  return (msg && msg.id) || 0;
}

/* Send a system word from one identity to another, with no gate: the pair's
   room is made on it if need be, then the line rides sendSystemDmLine. The
   callers from before the member model (a topic-move notice, the usage
   alerts) keep this signature. Returns whether it delivered. */
export async function sendSystemDm(env: Env, fromHash: string, toHash: string, body: string, opts?: { quiet?: boolean }) {
  if (!fromHash || !toHash || fromHash === toHash || !body) return false;
  const now = Math.floor(Date.now() / 1000);
  const thread = await ensurePairThread(env, fromHash, toHash, now, { bump: false, sender: fromHash });
  const id = await sendSystemDmLine(env, thread.id, fromHash, body, opts);
  return Number(id) > 0;
}

/* Inbox: my threads by newest activity, the other party resolved with their
   nick and avatar, and the total unread count riding along so one call feeds
   both the list and the badge. */
export async function purgeMediaKeys(env: Env, keys: readonly string[]) {
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

/* An object dies with its LAST reference (2026-09-13): a forwarded attachment
   is not re-uploaded, so one object may be named by several messages in
   several threads (dm_media_refs). Every road that removes a message calls
   this with the rows it is removing — the references go, then only the
   objects nothing names any more are purged (R2 and the accounting row).
   Never purgeMediaKeys straight from a message road. */
/* a message row being removed: its id and the object it names */
export type MediaRef = { id?: unknown; media_key?: unknown } | null;
export async function releaseMediaRefs(env: Env, rows: readonly MediaRef[]) {
  const ids = rows.map((r) => Number(r && r.id) || 0).filter((n) => n > 0);
  const keys: string[] = Array.from(new Set(rows.map((r) => r && r.media_key).filter(Boolean).map(String)));
  if (!ids.length && !keys.length) return;
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    try { await env.DB.prepare('DELETE FROM dm_media_refs WHERE msg_id IN (' + inList(chunk.length) + ')').bind(...chunk).run(); } catch (e) { /* keep going */ }
  }
  const dead: string[] = [];
  for (let i = 0; i < keys.length; i += 50) {
    const chunk = keys.slice(i, i + 50);
    try {
      const r = await env.DB.prepare(
        'SELECT md.key FROM dm_media md WHERE md.key IN (' + inList(chunk.length) + ') AND NOT EXISTS (SELECT 1 FROM dm_media_refs r WHERE r.key = md.key)'
      ).bind(...chunk).all<{ key: string }>();
      for (const row of (r.results || [])) dead.push(String(row.key));
    } catch (e) { /* keep going */ }
  }
  if (dead.length) await purgeMediaKeys(env, dead);
}

/* The messages naming these objects (through the references). */
export async function dmRefMessageIds(env: Env, keys: readonly string[]): Promise<number[]> {
  const ids: number[] = [];
  const list = keys.filter(Boolean);
  for (let i = 0; i < list.length; i += 50) {
    const chunk = list.slice(i, i + 50);
    try {
      const r = await env.DB.prepare('SELECT msg_id FROM dm_media_refs WHERE key IN (' + inList(chunk.length) + ')').bind(...chunk).all<{ msg_id: number }>();
      for (const row of (r.results || [])) ids.push(Number(row.msg_id));
    } catch (e) { /* keep going */ }
  }
  return ids;
}

/* An object taken from under its messages (the retention cap, the LRU
   valve): every message naming it shows the "media expired" placeholder, and
   the references go with the object. */
export async function dmExpireObjects(env: Env, keys: string[]) {
  if (!keys.length) return;
  const ids = await dmRefMessageIds(env, keys);
  await purgeMediaKeys(env, keys);
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    try {
      await env.DB.prepare('UPDATE dms SET media_key = NULL, media_size = NULL, media_expired = 1 WHERE id IN (' + inList(chunk.length) + ')').bind(...chunk).run();
    } catch (e) { /* keep going */ }
  }
  for (let i = 0; i < keys.length; i += 50) {
    const chunk = keys.slice(i, i + 50);
    try { await env.DB.prepare('DELETE FROM dm_media_refs WHERE key IN (' + inList(chunk.length) + ')').bind(...chunk).run(); } catch (e) { /* keep going */ }
  }
}

/* Recompute the total DM-media storage, cache it for the upload gate + admin
   display, and — only if near the 10 GB free-tier wall — emergency-prune the
   oldest media (LRU) until back under 90%, nulling the message's media pointer so
   the client shows it as expired. Normal message-expiry keeps us far from this. */
export async function enforceMediaCap(env: Env) {
  const s = await getAppSettings(env);
  /* The DM store's own budget (admin-set), NOT the whole R2 free tier: the
     account's 10 GB is shared with the KJV audio, backups, avatars, and wall
     media, so the old MEDIA_CAP_BYTES-based gate could legally overrun it. */
  const capBytes = Number(s.media_cap_dm_bytes) || Number(Media.defaults.capDmBytes);
  const totalRow = await env.DB.prepare('SELECT COALESCE(SUM(size), 0) AS total FROM dm_media').first<{ total: number }>();
  let total = (totalRow && totalRow.total) || 0;
  const EMERGENCY = Math.floor(capBytes * 0.95);
  const TARGET = Math.floor(capBytes * 0.90);
  if (total > EMERGENCY) {
    /* Oldest objects first, among those a message still names (an unnamed
       one is the orphan sweep's); each is taken from under EVERY message
       naming it, forwards included (dm_media_refs). */
    const old = await env.DB.prepare(
      'SELECT md.key, md.size FROM dm_media md WHERE EXISTS (SELECT 1 FROM dm_media_refs r WHERE r.key = md.key) ORDER BY md.created_at ASC LIMIT 1000'
    ).all<{ key: string; size: number }>();
    const kill: Array<{ key: string; size: number }> = [];
    for (const r of (old.results || [])) { if (total <= TARGET) break; kill.push(r); total -= (r.size || 0); }
    if (kill.length) await dmExpireObjects(env, kill.map((r) => String(r.key)));
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
export async function sweepExpiredDms(env: Env) {
  const now = Math.floor(Date.now() / 1000);
  const settings = await getAppSettings(env);
  try {
    const gone = await env.DB.prepare(
      'SELECT id, media_key FROM dms WHERE expires_at IS NOT NULL AND expires_at < ?1 AND COALESCE(saved, 0) = 0 AND media_key IS NOT NULL LIMIT 5000'
    ).bind(now).all<{ id: number; media_key: string | null }>();
    const rows = gone.results || [];
    /* The references go first, then only the objects nothing names any more
       (a forward elsewhere keeps its object): an object dies with its last
       reference, never with its first message. */
    if (rows.length) await releaseMediaRefs(env, rows);
    await env.DB.prepare(
      'DELETE FROM dms WHERE expires_at IS NOT NULL AND expires_at < ?1 AND COALESCE(saved, 0) = 0'
    ).bind(now).run();
    /* What hangs off a message goes with it (D1 has no cascade): each
       member's sealed key, the reactions, any reference still standing. */
    for (const tbl of ['dm_keys', 'dm_reactions', 'dm_media_refs']) {
      try { await env.DB.prepare('DELETE FROM ' + tbl + ' WHERE msg_id NOT IN (SELECT id FROM dms)').run(); } catch (e) { /* keep going */ }
    }
  } catch (e) { console.log(JSON.stringify({ event: 'sweep_expired_failed', error: String(e) })); }
  try {
    // Hard media cap (media_dm_retention_days, clamped 1..90, default = the old
    // Dm.mediaMaxSeconds 30 days): NO media attachment persists beyond it, even
    // inside a SAVED message, and it is counted from the UPLOAD — a forward of
    // an old photo dies with the original. On every surviving message naming
    // an aged object, purge the R2 object + row and mark the message
    // media_expired so the client shows a placeholder over any saved
    // text/caption.
    const cap = now - mediaRetentionDays(settings, 'dm') * 86400;
    const capped = await env.DB.prepare(
      'SELECT md.key AS key FROM dm_media md WHERE md.created_at < ?1 AND EXISTS (SELECT 1 FROM dm_media_refs r WHERE r.key = md.key) LIMIT 5000'
    ).bind(cap).all<{ key: string }>();
    const keys = (capped.results || []).map((r) => String(r.key)).filter(Boolean);
    if (keys.length) await dmExpireObjects(env, keys);
  } catch (e) { console.log(JSON.stringify({ event: 'sweep_media_cap_failed', error: String(e) })); }
  try {
    /* 15 minutes, not an hour: a real send links its upload within seconds, so
       anything no message names that long is an abandoned draft or a flood —
       and the shorter window is what makes an upload flood self-cleaning. An
       object whose last message went the way of a purge is caught here too. */
    const orphan = await env.DB.prepare(
      'SELECT key FROM dm_media md WHERE md.created_at < ?1 AND NOT EXISTS (SELECT 1 FROM dm_media_refs r WHERE r.key = md.key) LIMIT 2000'
    ).bind(now - 900).all<{ key: string }>();
    await purgeMediaKeys(env, (orphan.results || []).map((r) => r.key));
  } catch (e) { /* keep going */ }
  try { await sweepDms(env); } catch (e) { /* empty-thread tidy */ }
  try { await enforceMediaCap(env); } catch (e) { /* cap/accounting */ }
}

/* A random opaque R2 object id for a DM media blob. Reveals nothing about who
   uploaded it or to whom, so the bucket cannot be traced to a member. */
export function randomHex(n: number) {
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
/* A post row is told from a comment row by `post_id`: a feed comment carries
   the post it hangs under, a feed post does not — the one shape difference
   stampReactions keys the target on. */
export const WALL_POST_COLS = 'p.id, p.author_hash, pr.nick, pr.avatar, pr.faith, p.body, p.created_at, p.edited_at, p.media_key, p.media_size, p.media_expired, p.comments';
export const WALL_COMMENT_COLS = 'c.id, c.post_id, c.author_hash, pr.nick, pr.avatar, pr.faith, c.body, c.created_at, c.media_key, c.media_size, c.media_expired';

/* Add the author display fields (assigned pseudonym + rank) the client renders,
   mirroring the forum's withNames — nick/avatar/faith are already joined in —
   and the reactions (2026-09-12): every post row is a 'wall' target and every
   comment row a 'wallc' target, each stamped with its tally and the viewer's
   own reaction in two batched reads, the same shape the board's posts carry. */
export async function wallEnrich(env: Env, rows: readonly AuthoredRow[], me: string | null): Promise<AuthoredRow[]> {
  const counts = await postCountsFor(env, rows.map((r) => r.author_hash));
  const out = await Promise.all(rows.map((r) => withNames(r, counts[r.author_hash || ''] || 0, (h) => serveId(env, h))));
  await stampReactions(env, 'wall', out.filter((r) => r.post_id === undefined), me);
  await stampReactions(env, 'wallc', out.filter((r) => r.post_id !== undefined), me);
  return out;
}

/* The wall's own notifications (kind 'wall', comment_id = the post id, jumps to
   ?post=<id>): a comment tells the post author, and an @mention tells the picked
   member. Reuses the private user:<hash> live push. */
export async function deliverWallNotifications(env: Env, o: { authorHash: string; postId: number; postAuthorHash?: string | null; mentions?: unknown }) {
  const now = Math.floor(Date.now() / 1000);
  const NOTIF = 'INSERT INTO notifications (recipient_hash, kind, topic_id, comment_id, actor_hash, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)';
  const stmts: D1PreparedStatement[] = [];
  const live: HubEvent[] = [];
  const pushComment = new Set<string>();   // native-push recipients, split by copy (disjoint via `seen`)
  const pushMention = new Set<string>();
  const seen = new Set<string>([o.authorHash, MERECAT_BOT.hash]);
  // topic_id encodes the wall sub-kind for the label: 1 = a comment on your post,
  // 0 = an @mention. comment_id is always the post id (jumps to ?post=<id>).
  const add = (h: string, commented: boolean) => {
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
      /* a pubid on the wire (L3) -> the account hash the inbox is keyed by */
      const h = (await resolveId(env, String(m || '').toLowerCase())) || String(m || '').toLowerCase();
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
export async function purgeWallMedia(env: Env, keys: readonly string[]) {
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

/* Null the parent pointer + stamp media_expired for a set of wall_media rows
   ({ref_type, ref_id}), batched per table — the one place the shared table
   costs a branch. Shared by the cap valve, the retention sweep, and the
   purge-all endpoints; rows with no known ref_type are skipped (an unlinked
   orphan has no parent to stamp). */
export async function stampWallMediaExpired(env: Env, rows: ReadonlyArray<{ ref_type: string | null; ref_id: number | null }>) {
  const tableFor: Record<string, string> = { post: 'wall_posts', comment: 'wall_comments', board: 'comments' };
  const byTable: Record<string, Array<number | null>> = { wall_posts: [], wall_comments: [], comments: [] };
  for (const r of rows) { const t = tableFor[String(r.ref_type)]; if (t) byTable[t].push(r.ref_id); }
  for (const t of Object.keys(byTable)) {
    const ids = byTable[t];
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50);
      const ph = inList(chunk.length);
      try {
        await env.DB.prepare('UPDATE ' + t + ' SET media_key = NULL, media_size = NULL, media_expired = 1 WHERE id IN (' + ph + ')').bind(...chunk).run();
      } catch (e) { /* keep going */ }
    }
  }
}

/* Reclaim public-media objects with no live owner: an upload that was never
   attached to a post (older than an hour), or one whose post/comment is gone. */
export async function sweepWallOrphanMedia(env: Env) {
  const now = Math.floor(Date.now() / 1000);
  try {
    /* ref_type 'board' = a FORUM comment's attachment (comments.id); 'comment'
       means a WALL comment — the two id spaces are unrelated, so the ref_type
       namespace is load-bearing here. A board attachment outlives only a live
       or pending owner: pending keeps the admin queue's evidence, and a
       soft-deleted or hard-pruned comment's media is reclaimed within the hour
       even when the immediate purge in the delete handler failed. Unlinked
       orphans age out at 15 minutes (a real post links within seconds). */
    const orphan = await env.DB.prepare(
      'SELECT key FROM wall_media WHERE (ref_id IS NULL AND created_at < ?1) ' +
      "OR (ref_type = 'post' AND ref_id NOT IN (SELECT id FROM wall_posts)) " +
      "OR (ref_type = 'comment' AND ref_id NOT IN (SELECT id FROM wall_comments)) " +
      "OR (ref_type = 'board' AND ref_id NOT IN (SELECT id FROM comments WHERE status IN ('live', 'pending'))) LIMIT 2000"
    ).bind(now - 900).all<{ key: string }>();
    await purgeWallMedia(env, (orphan.results || []).map((r) => r.key));
  } catch (e) { /* keep going */ }
}

/* The public media stores' byte accounting and emergency valve, PER SECTION
   since the 2026-08-02 split: the feed (ctx 'wall' → media_cap_wall_bytes →
   wall_media_bytes) and the forum (ctx 'board' → media_cap_board_bytes →
   board_media_bytes) each have their own budget over the shared wall_media
   table. Normal pressure is handled at UPLOAD time (a live per-ctx SUM refuses
   at 90%); this hourly pass keeps the display totals fresh and, only past 95%,
   evicts a section's oldest LINKED media — stamping media_expired on the parent
   row so the client shows an honest placeholder, never a broken tile. Public
   posts are content, not cache: silent LRU is content loss, which is why the
   valve is a last resort and the refusal is the policy (DM media differs —
   ephemeral by contract, so its LRU in enforceMediaCap is honest). */
export async function enforceWallMediaCap(env: Env) {
  const s = await getAppSettings(env);
  const sections = [
    { ctx: 'wall', cap: Number(s.media_cap_wall_bytes) || Number(Media.defaults.capWallBytes), counter: 'wall_media_bytes' },
    { ctx: 'board', cap: Number(s.media_cap_board_bytes) || Number(Media.defaults.capBoardBytes), counter: 'board_media_bytes' },
  ];
  for (const sec of sections) {
    const totalRow = await env.DB.prepare(
      "SELECT COALESCE(SUM(size), 0) AS total FROM wall_media WHERE COALESCE(ctx, 'wall') = ?1"
    ).bind(sec.ctx).first<{ total: number }>();
    let total = (totalRow && totalRow.total) || 0;
    const EMERGENCY = Math.floor(sec.cap * 0.95);
    if (total > EMERGENCY) {
      const TARGET = Math.floor(sec.cap * 0.90);
      const old = await env.DB.prepare(
        "SELECT key, size, ref_type, ref_id FROM wall_media WHERE ref_id IS NOT NULL AND COALESCE(ctx, 'wall') = ?1 ORDER BY created_at ASC LIMIT 200"
      ).bind(sec.ctx).all<{ key: string; size: number; ref_type: string | null; ref_id: number | null }>();
      const kill: Array<{ key: string; size: number; ref_type: string | null; ref_id: number | null }> = [];
      for (const r of (old.results || [])) { if (total <= TARGET) break; kill.push(r); total -= (r.size || 0); }
      if (kill.length) {
        /* Stamp FIRST, purge second: a stamped parent whose object still
           exists self-heals next hour (the row is re-selected and finished),
           while a purged object with no stamp is a permanent broken tile —
           the exact artifact media_expired exists to prevent. */
        await stampWallMediaExpired(env, kill);
        await purgeWallMedia(env, kill.map((r) => r.key));
      }
    }
    try {
      await env.DB.prepare(
        'INSERT INTO app_settings (k, v, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(k) DO UPDATE SET v = ?2, updated_at = ?3'
      ).bind(sec.counter, String(total), Math.floor(Date.now() / 1000)).run();
    } catch (e) { /* display-only cache; ignore */ }
  }
  appSettingsCache.at = 0; appSettingsCache.s = null;
}

/* Media-only age retention for the public sections (media_wall_retention_days /
   media_board_retention_days; 0 = keep forever, the default). Purges the R2
   object + row and stamps media_expired on the parent — the post and its TEXT
   stay (that is wall_prune's separate job). Pending media is deliberately NOT
   spared here (unlike the orphan sweep's evidence-sparing branch): retention is
   a time policy the owner sets, the held TEXT survives for the queue, and the
   parent gets the honest placeholder. LIMIT 200/section keeps a first-enable
   backlog hour inside the cron invocation's budget — 1,000 binding calls
   (D1/R2) on the free plan; the 50 cap is for external fetches — which the
   hourly chain's DM and orphan sweeps share; the backlog self-drains hourly. Stamp
   BEFORE purge: a stamped parent whose object still exists is re-selected and
   finished next hour, while a purged object with no stamp would be a
   permanent broken tile. */
export async function sweepMediaRetention(env: Env) {
  const s = await getAppSettings(env);
  const now = Math.floor(Date.now() / 1000);
  for (const ctx of ['wall', 'board']) {
    const days = mediaRetentionDays(s, ctx);
    if (!days) continue;
    try {
      const old = await env.DB.prepare(
        "SELECT key, ref_type, ref_id FROM wall_media WHERE COALESCE(ctx, 'wall') = ?1 AND created_at < ?2 ORDER BY created_at ASC LIMIT 200"
      ).bind(ctx, now - days * 86400).all<{ key: string; ref_type: string | null; ref_id: number | null }>();
      const rows = old.results || [];
      if (!rows.length) continue;
      await stampWallMediaExpired(env, rows);
      await purgeWallMedia(env, rows.map((r) => r.key));
    } catch (e) { console.log(JSON.stringify({ event: 'sweep_retention_failed', ctx, error: String(e) })); }
  }
}

/* Read gate shared by the members-only feed/wall/post reads. Returns the member
   hash, or a Response to return immediately (401 / blocked / 429). */
export async function wallReader(request: Request, env: Env, data: Body | null): Promise<{ resp: Response } | { me: string }> {
  const ip = request.headers.get('CF-Connecting-IP') || '';
  if (!(await throttle(env, 'READ_LIMIT', ip, { key: data && data.key }))) return { resp: json({ ok: false, error: 'Too many requests. Slow down.' }, 429) };
  const key = String((data && data.key) || '');
  if (!key) return { resp: json({ ok: false, error: 'Sign in to see the feed.' }, 401) };
  const me = await sha256hex(key);
  const gate = await blockedReason(env, me, ip);
  if (gate) return { resp: blockedJson(gate) };
  return { me };
}

/* The reaction bell (2026-09-12; the wall like's coalescing, generalised to
   every target): one row per (recipient, kind, actor, thread, post), so a
   reaction changed or given again never piles up rows. A previously READ row
   from this actor on this post is reopened (a fresh reaction after the author
   saw the last one); else a row is minted only when none exists at all (an
   unread one is left as-is — no re-ring). For the public ledger both writes
   require the reaction to STILL stand (EXISTS reactions), which closes the
   react/withdraw race; a DM reaction has no ledger row to check — its column
   was written by the caller a moment ago, and a withdraw retracts. The bell
   rings only on a row actually reopened or added. Never for your own post,
   never for the bot, and the caller has already dropped a muted reactor. A
   reaction must never fail because its bell did, so this never throws out. */
/* A reaction's bell: who is told, by whom, and where it lands. */
export type ReactBell = { to: string | null; from: string; kind: string; topicId: number; commentId: number; target?: string; targetId?: number };
export async function notifyReact(env: Env, o: ReactBell) {
  try {
    if (!o.to || !o.from || o.to === o.from || o.to === MERECAT_BOT.hash || o.from === MERECAT_BOT.hash) return;
    if (!NOTIF_KINDS.includes(o.kind)) return;
    /* The board's bell prefs: a reaction on a board post rides notify_reply
       (the thread's own bell), a feed one the same, a DM one notify_dm. */
    const pref = (await notifyPrefsFor(env, [o.to]))[o.to];
    if (!notifyEnabled(pref, o.kind === 'dm-react' ? 'dm' : 'reply')) return;
    const now = Math.floor(Date.now() / 1000);
    const stands = o.target ? ' AND EXISTS (SELECT 1 FROM reactions WHERE target = ?6 AND target_id = ?7 AND author_hash = ?3)' : '';
    const binds: Array<string | number | undefined> = o.target ? [o.to, o.commentId, o.from, now, o.topicId, o.target, o.targetId] : [o.to, o.commentId, o.from, now, o.topicId];
    const up = await env.DB.prepare(
      "UPDATE notifications SET read_at = NULL, created_at = ?4 " +
      "WHERE recipient_hash = ?1 AND kind = '" + o.kind + "' AND actor_hash = ?3 AND comment_id = ?2 AND topic_id = ?5 AND read_at IS NOT NULL" + stands
    ).bind(...binds).run();
    let rang = up.meta && up.meta.changes > 0;
    if (!rang) {
      const ins = await env.DB.prepare(
        "INSERT INTO notifications (recipient_hash, kind, topic_id, comment_id, actor_hash, created_at) " +
        "SELECT ?1, '" + o.kind + "', ?5, ?2, ?3, ?4 WHERE NOT EXISTS (" +
        "SELECT 1 FROM notifications WHERE recipient_hash = ?1 AND kind = '" + o.kind + "' AND actor_hash = ?3 AND comment_id = ?2 AND topic_id = ?5)" + stands
      ).bind(...binds).run();
      rang = ins.meta && ins.meta.changes > 0;
    }
    if (rang) {
      await publishUser(env, [{ v: 1, t: 'notification', scopes: ['user:' + o.to],
        kind: o.kind, topic_id: o.topicId, comment_id: o.commentId, actor_hash: o.from, created_at: now }]);
    }
  } catch (e) {
    console.log(JSON.stringify({ event: 'notify_react_failed', error: String(e) }));
  }
}
/* A withdrawn reaction takes back its bell if the author has not seen it yet
   (a read one stays, Facebook style). Never throws out. */
export async function retractReactNotif(env: Env, o: ReactBell) {
  try {
    if (!o.to || !o.from) return;
    await env.DB.prepare(
      "DELETE FROM notifications WHERE recipient_hash = ?1 AND kind = '" + o.kind + "' AND actor_hash = ?2 AND comment_id = ?3 AND topic_id = ?4 AND read_at IS NULL"
    ).bind(o.to, o.from, o.commentId, o.topicId).run();
  } catch (e) { /* never break the withdraw */ }
}

/* Validate an attached media_key: it must be an unlinked wall_media row, and —
   when the DESTINATION context's mask/settings are given — its kind (encoded in
   the key) must be allowed there and its stored size inside that kind's cap.
   Claim-time enforcement is what stops a wall-context upload from smuggling a
   video onto a board whose mask excludes it: upload cannot know its destination.
   Returns { key, size, kind } or null. */
export async function wallClaimMedia(env: Env, mediaKey: unknown, allowedKinds?: readonly string[], settings?: Settings, ctx?: string) {
  if (!mediaKey || !WALL_MEDIA_RE.test(String(mediaKey))) return null;
  const kind = mediaKindOfKey(mediaKey);
  if (!kind) return null;
  /* the key is the pattern's, so a string */
  if (allowedKinds && allowedKinds.indexOf(kind) === -1) return null;
  const mr = await env.DB.prepare('SELECT size FROM wall_media WHERE key = ?1 AND ref_id IS NULL').bind(String(mediaKey)).first<{ size: number }>();
  if (!mr) return null;
  if (settings && (Number(mr.size) || 0) > mediaKindMax(settings, kind, ctx)) return null;
  return { key: String(mediaKey), size: mr.size, kind };
}

/* Create a post on my own wall (author = me), which also lands it in the feed.
   Turnstile + AI screen (held-if-flagged) exactly like a forum comment. */
export async function runWallPrune(env: Env, days: number) {
  const cutoff = Math.floor(Date.now() / 1000) - Wall.clampPruneDays(days) * 86400;
  let deleted = 0;
  try {
    const pm = await env.DB.prepare('SELECT media_key FROM wall_posts WHERE created_at < ?1 AND media_key IS NOT NULL LIMIT 5000').bind(cutoff).all<{ media_key: string }>();
    const keys = (pm.results || []).map((r) => r.media_key);
    const cm = await env.DB.prepare('SELECT media_key FROM wall_comments WHERE media_key IS NOT NULL AND (created_at < ?1 OR post_id IN (SELECT id FROM wall_posts WHERE created_at < ?1)) LIMIT 5000').bind(cutoff).all<{ media_key: string }>();
    (cm.results || []).forEach((r) => keys.push(r.media_key));
    if (keys.length) await purgeWallMedia(env, keys);
    await env.DB.prepare("DELETE FROM reactions WHERE target = 'wallc' AND target_id IN (SELECT id FROM wall_comments WHERE created_at < ?1 OR post_id IN (SELECT id FROM wall_posts WHERE created_at < ?1))").bind(cutoff).run();
    await env.DB.prepare('DELETE FROM wall_comments WHERE created_at < ?1 OR post_id IN (SELECT id FROM wall_posts WHERE created_at < ?1)').bind(cutoff).run();
    await env.DB.prepare("DELETE FROM reactions WHERE target = 'wall' AND target_id IN (SELECT id FROM wall_posts WHERE created_at < ?1)").bind(cutoff).run();
    const del = await env.DB.prepare('DELETE FROM wall_posts WHERE created_at < ?1').bind(cutoff).run();
    deleted = (del.meta && del.meta.changes) || 0;
  } catch (e) { console.log(JSON.stringify({ event: 'prune_wall_failed', error: String(e) })); }
  return deleted;
}

/* Cron entry (monthly chain): prune only when the admin turned it on. */
export async function pruneWallPosts(env: Env) {
  const s = await getAppSettings(env);
  if (s.wall_prune_enabled !== '1') return;
  await runWallPrune(env, Number(s.wall_prune_days) || 365);
}

/* Admin "prune now" — runs regardless of the enabled flag, using the configured
   (or a passed) retention. */
export async function boardFloor(env: Env, me: string): Promise<number | null> {
  const row = await env.DB.prepare('SELECT read_at FROM thread_reads WHERE hash = ?1 AND topic_id = 0').bind(me).first<{ read_at: number }>();
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

export function be16(b: Uint8Array, i: number) { return (b[i] << 8) | b[i + 1]; }

/* Returns {mime, width, height} or null. Only the three raster formats a
   browser canvas emits are recognized; everything else is refused. */
export function sniffImage(b: Uint8Array): { mime: string; width: number; height: number } | null {
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
export async function screenImage(env: Env, bytes: Uint8Array) {
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
export function sqlLit(v: unknown) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  /* A BLOB column (none today) would otherwise be dumped as "[object
     ArrayBuffer]" and restore as garbage — a silent corruption; X'…' is SQL. */
  if (v instanceof ArrayBuffer || ArrayBuffer.isView(v)) {
    const bytes = v instanceof ArrayBuffer ? new Uint8Array(v) : new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
    let hex = '';
    for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
    return "X'" + hex + "'";
  }
  return "'" + String(v).replace(/'/g, "''") + "'";
}

/* A restorable dump: every user table's CREATE (as IF NOT EXISTS) and rows,
   then the indexes. Explicit ids in the INSERTs carry the AUTOINCREMENT
   sequence along on their own. Replaying it is idempotent (2026-09-16):
   INSERT OR REPLACE, and every index — UNIQUE ones too — as IF NOT EXISTS
   (sqlite_master strips the clause, so it is put back here); a second replay
   into the same database changes nothing, which is what a restore drill
   needs. `stats`, if given, is filled with the table and row counts. */
export async function dumpDatabase(env: Env, stats?: { tables: number; rows: number }) {
  const master = await env.DB.prepare(
    "SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL " +
    "AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'comments_fts%' " +
    "ORDER BY type = 'index', name"
  ).all<{ type: string; name: string; sql: string }>();
  const parts = ['-- merecatholicity-comments backup ' + new Date().toISOString()];
  for (const m of master.results) {
    if (m.type === 'table') {
      parts.push(m.sql.replace(/^CREATE TABLE\s+/i, 'CREATE TABLE IF NOT EXISTS ') + ';');
      if (stats) stats.tables++;
      const rows = await env.DB.prepare('SELECT * FROM "' + m.name + '"').all<Record<string, unknown>>();
      const rs = rows.results;
      if (stats) stats.rows += rs.length;
      if (!rs.length) continue;
      const cols = Object.keys(rs[0]);
      const colList = cols.map((c) => '"' + c + '"').join(', ');
      for (let i = 0; i < rs.length; i += 50) {
        const values = rs.slice(i, i + 50)
          .map((r) => '(' + cols.map((c) => sqlLit(r[c])).join(', ') + ')').join(',\n');
        parts.push('INSERT OR REPLACE INTO "' + m.name + '" (' + colList + ') VALUES\n' + values + ';');
      }
    } else if (m.type === 'index') {
      parts.push(m.sql.replace(/^CREATE\s+(UNIQUE\s+)?INDEX\s+/i, 'CREATE $1INDEX IF NOT EXISTS ') + ';');
    }
  }
  /* The search index is derived data — its shadow tables are excluded above.
     Instead emit its virtual table and triggers and a rebuild, so restoring
     this one file brings search back from the restored comments, no extra step. */
  const fts = await env.DB.prepare(
    "SELECT sql FROM sqlite_master WHERE (name = 'comments_fts' OR (type = 'trigger' AND tbl_name = 'comments')) " +
    "AND sql IS NOT NULL ORDER BY type = 'trigger', name"
  ).all<{ sql: string }>();
  for (const f of fts.results) {
    parts.push(f.sql.replace(/^CREATE (VIRTUAL TABLE|TRIGGER)\s+/i, 'CREATE $1 IF NOT EXISTS ') + ';');
  }
  if (fts.results.length) parts.push("INSERT INTO comments_fts(comments_fts) VALUES('rebuild');");
  return parts.join('\n');
}

export async function gzipBytes(text: string) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/* The retention is the kernel's (Domain.Ops.keepBackup: 90 days, a
   first-of-month object 400); this name stays for the readers of the old one. */
export const BACKUP_KEEP_DAYS = Ops.keepDays;

/* The ops state: small JSON values in app_settings (ops_heartbeat, ops_backup,
   ops_alert_state, ops_webtest, csp_report_tally), read and written directly —
   the five-minute settings cache has no business in a cron path. */
export async function getOpsState<T>(env: Env, k: string, fallback: T): Promise<T> {
  try {
    const row = await env.DB.prepare('SELECT v FROM app_settings WHERE k = ?1').bind(k).first<{ v: string | null }>();
    if (row && row.v) return JSON.parse(String(row.v)) as T;
  } catch (e) { /* fresh state */ }
  return fallback;
}
export async function setOpsState(env: Env, k: string, value: unknown) {
  await env.DB.prepare(
    "INSERT INTO app_settings (k, v, updated_at, updated_by) VALUES (?1, ?2, ?3, 'ops') ON CONFLICT(k) DO UPDATE SET v = ?2, updated_at = ?3, updated_by = 'ops'"
  ).bind(k, JSON.stringify(value), Math.floor(Date.now() / 1000)).run();
}

/* The Known-IPs history is not a ledger: rows idle past IP_KEEP_DAYS go, and
   banned keys stay whatever their age so a standing ban keeps its handle in
   the drawer. One statement, once a month, riding the backup cron. */
export async function pruneIdentityIps(env: Env) {
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
export async function pruneComments(env: Env) {
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

/* The comments under a journal article follow the article. When an article (a
   post in the journal topic) is deleted or gone, every row keyed
   'journal:<its id>' is soft-deleted here — one statement, idempotent — and
   pruneComments hard-deletes them thirty days on like any other deleted row.
   Called from every path that deletes a journal article (self-delete, the
   topic-head delete, delete-user) and from the monthly cron as the backstop.
   Only a DELETED or MISSING article retires its comments: a held (pending)
   edit of the article keeps them, and re-pointing journal_topic touches
   nothing — those rows merely become unreachable and return if the topic is
   pointed back, the social switch's rule that a switch deletes nothing. */
export const JOURNAL_SWEEP_SQL = "UPDATE comments SET status = 'deleted' WHERE page LIKE 'journal:%' AND status != 'deleted' AND (CAST(substr(page, 9) AS INTEGER) NOT IN (SELECT id FROM comments WHERE status != 'deleted')";
/* Appended when the journal's own TOPIC was deleted: its replies stay live
   rows (orphans, as a topic delete has always left them) but they are no
   longer articles of anything, so their comments retire with the head's. */
export const JOURNAL_SWEEP_THREAD_SQL = " OR CAST(substr(page, 9) AS INTEGER) IN (SELECT id FROM comments WHERE parent_id = ?1)";
export async function sweepJournalComments(env: Env, deletedTopicId?: number) {
  try {
    const stmt = env.DB.prepare(JOURNAL_SWEEP_SQL + (deletedTopicId ? JOURNAL_SWEEP_THREAD_SQL : '') + ')');
    const r = await (deletedTopicId ? stmt.bind(deletedTopicId) : stmt).run();
    const n = (r.meta && r.meta.changes) || 0;
    if (n) console.log(JSON.stringify({ event: 'journal_comments_swept', deleted: n }));
  } catch (e) {
    console.log(JSON.stringify({ event: 'journal_comments_sweep_failed', error: String(e) }));
  }
}

/* A defensive tidy of direct-message state: messages whose thread is gone and
   threads left with no messages. handleDmDelete purges in two statements, so a
   crash between them could strand one side; this catches that drift. Held
   messages and deleted-identity threads are deliberately left whole. */
export async function sweepDms(env: Env) {
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
  /* A thread with no surviving word is gone, and its members with it: when
     nothing was saved and everything expired, nobody remains (the owner's
     rule, 2026-09-13). The ledgers that hang off a message go the same way. */
  for (const [tbl, col, parent] of [['dm_members', 'thread_id', 'dm_threads'], ['dm_keys', 'msg_id', 'dms'], ['dm_reactions', 'msg_id', 'dms'], ['dm_media_refs', 'msg_id', 'dms']]) {
    try { await env.DB.prepare('DELETE FROM ' + tbl + ' WHERE ' + col + ' NOT IN (SELECT id FROM ' + parent + ')').run(); } catch (e) { /* keep going */ }
  }
}

/* Clear read notifications older than their window, then sweep dead weight: a
   notification whose post is gone, and a watch on a vanished thread. Unread
   notifications are kept however old, since the reader has not seen them yet.
   Each statement is guarded so one failure never stops the backup behind it. */
export async function pruneNotifications(env: Env) {
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
    /* The board kinds (reply, mention, react) name a post in comment_id; sweep
       the rows whose post is gone. The DM kinds (dm, call, dm-react) name no
       row of `comments` and are spared. */
    const r = await env.DB.prepare(
      "DELETE FROM notifications WHERE kind IN " + sqlList(NOTIF_POST_KINDS) + " AND comment_id NOT IN (SELECT id FROM comments)"
    ).run();
    console.log(JSON.stringify({ event: 'notif_orphan_sweep', deleted: r.meta && r.meta.changes || 0 }));
  } catch (e) {
    console.log(JSON.stringify({ event: 'notif_orphan_sweep_failed', error: String(e) }));
  }
  try {
    /* Wall notifications ('wall' comment/mention, 'wall-like', 'wall-react')
       carry comment_id = the post id; sweep any whose post is gone. */
    const r = await env.DB.prepare(
      "DELETE FROM notifications WHERE kind IN " + sqlList(NOTIF_WALL_KINDS) + " AND comment_id NOT IN (SELECT id FROM wall_posts)"
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

/* The daily backup (2026-09-16; monthly before that): the whole ledger as one
   restorable gzip in R2 under Domain.Ops.backupKey(today), then the prune by
   Domain.Ops.keepBackup (90 days; a first-of-month object 400), walking the
   listing to its end. Records what it did — or what failed — in app_settings
   `ops_backup` for the self-check and the health panel, and rethrows so the
   chain runner logs the step. Budget: the dump is ~40 D1 reads and one R2 put
   against the free plan's 1,000 binding calls per invocation (the 50 cap is
   for EXTERNAL fetches). The avatar mirror is its own monthly step. */
export async function runBackup(env: Env) {
  const t0 = Date.now();
  const at = Math.floor(t0 / 1000);
  const key = Ops.backupKey(new Date(t0).toISOString().slice(0, 10));
  try {
    if (!env.BACKUPS) throw new Error('BACKUPS bucket not bound; enable R2 and redeploy.');
    const stats = { tables: 0, rows: 0 };
    const sql = await dumpDatabase(env, stats);
    const gz = await gzipBytes(sql);
    await env.BACKUPS.put(key, gz, { httpMetadata: { contentType: 'application/gzip' } });
    let pruned = 0, kept = 0;
    let cursor: string | undefined;
    do {
      const list = await env.BACKUPS.list({ prefix: 'backups/', cursor });
      for (const obj of list.objects) {
        const ageDays = Math.floor((t0 - new Date(obj.uploaded).getTime()) / 86400000);
        if (obj.key !== key && !Ops.keepBackup({ key: obj.key, ageDays })) {
          await env.BACKUPS.delete(obj.key);
          pruned++;
        } else kept++;
      }
      cursor = list.truncated ? list.cursor : undefined;
    } while (cursor);
    const result = { at, key, bytes: gz.length, sqlBytes: sql.length, tables: stats.tables, rows: stats.rows, kept, pruned, ms: Date.now() - t0 };
    await setOpsState(env, 'ops_backup', result);
    console.log(JSON.stringify({ event: 'backup', ...result }));
    return result;
  } catch (e) {
    const error = String(e).slice(0, 300);
    try { await setOpsState(env, 'ops_backup', { at, key, error, ms: Date.now() - t0 }); } catch (e2) { /* the log below still tells */ }
    console.log(JSON.stringify({ event: 'backup_failed', key, error }));
    throw e;
  }
}

/* Mirror the avatar objects into the backup bucket (the monthly chain), so
   all state rides in one bucket. Cap 300 = 600 binding calls, inside the
   1,000 per invocation; the cap is logged when hit, never silent. Old mirror
   entries are left in place, which for a backup is a feature. */
export async function mirrorAvatars(env: Env, cap = 300) {
  if (!env.AVATARS || !env.BACKUPS) return { mirrored: 0, skipped: 0 };
  const avs = await env.AVATARS.list({ prefix: 'avatars/' });
  let mirrored = 0;
  for (const o of avs.objects.slice(0, cap)) {
    const obj = await env.AVATARS.get(o.key);
    if (!obj) continue;
    await env.BACKUPS.put('avatars-mirror/' + o.key.slice(8), await obj.arrayBuffer(), { httpMetadata: obj.httpMetadata });
    mirrored++;
  }
  const skipped = Math.max(0, avs.objects.length - cap);
  if (skipped) console.log(JSON.stringify({ event: 'backup_avatar_cap', skipped }));
  console.log(JSON.stringify({ event: 'avatars_mirrored', mirrored, skipped }));
  return { mirrored, skipped };
}

/* Admin-only manual run of the same backup the cron performs, so the path
   can be exercised any day, not only on the first of the month. */
export async function requireAdmin(env: Env, key: string) {
  return !!key && (await isAdminHash(env, await sha256hex(key)));
}

/* Lock or unlock an identity: a reversible disable that logs the holder out
   and refuses every keyed interaction until reversed. */
/* A non-streaming chat completion, as the models answer it: `response` on the
   Cloudflare shape, `choices` on the OpenAI-compatible one. */
type AiChat = { response?: unknown; choices?: { message?: { content?: unknown } }[] } | null;

export const MERECAT_DEFAULTS = {
  model: '@cf/qwen/qwen3-30b-a3b-fp8',
  user_cap_on: 0,     // per-member daily cap: 0 = off (community budget is the only wall)
  user_daily: 10,     // questions per member per UTC day, when the cap is on
  global_daily: 150,  // questions across the community per UTC day
  topk: 10,           // chunks handed to the model (the 4-8-citation rule needs headroom)
  max_tokens: 1100,
  /* The dials below come from the kernel (Domain.Merecat), never a literal
     here: the reasoning ladder, its resting values, the sampling temperature
     and the nine band weights are one rule shared with the client. */
  temperature: Merecat.temperatureDefault,
  band_weights: Merecat.bandWeightsCsv(Merecat.bandWeightsDefault),
  reasoning_on: Merecat.reasoningDefaults.on ? 1 : 0,
  reasoning_default: Merecat.reasoningDefaults.deflt,
  reasoning_max: Merecat.reasoningDefaults.max,
  mention_effort: Merecat.reasoningDefaults.mention,
  quota_guard_on: Merecat.quotaGuardDefaults.on ? 1 : 0,   // rest before the Workers AI day is spent (admins too)
  quota_guard_pct: Merecat.quotaGuardDefaults.pct,         // ...at this share of the free day
  last_ingest: '',        // stamped by ingest.py at the end of every push (ISO time)
  last_ingest_by: '',     // the CI run id, or "local"
};
/* The librarian's dials as merecatConfig resolves them. */
export type MerecatCfg = typeof MERECAT_DEFAULTS & { persona: string };
/* The reasoning dials as the client reads them (a courtesy copy: the
   ChatRoom clamps every ask against the same values). */
export function merecatReasoningView(cfg: MerecatCfg) {
  return { on: !!cfg.reasoning_on, default: cfg.reasoning_default, max: cfg.reasoning_max,
    mention: cfg.mention_effort, ladder: Merecat.effortLadder };
}
/* The level an ask may actually run at: the kill switch first, then the
   reader's (or the mention's) choice parsed against the default and clamped
   to the admin's ceiling. Off when the switch is off, whatever was asked. */
export function merecatEffortFor(cfg: MerecatCfg, asked: unknown): string {
  if (!cfg.reasoning_on) return 'off';
  return Merecat.effortClamp(String(cfg.reasoning_max))(Merecat.effortParse(String(cfg.reasoning_default))(asked == null ? '' : String(asked)));
}
/* The prompt's closing: the token that tells Qwen3 whether it may think, and
   the directive for how deeply. `off` is the literal the site always sent. */
export function merecatThinkSuffix(effort: string) {
  return Merecat.effortThinks(String(effort)) ? '\n\n' + Merecat.effortDirective(String(effort)) + '\n/think' : '/no_think';
}
export function merecatHeadroom(effort: string): number { return Merecat.effortHeadroom(String(effort)); }
/* What a resting librarian says — the question cap and the budget guard
   alike: the hours until the day renews at 00:00 UTC (Domain.Merecat). */
export function merecatRestingNote(nowMs = Date.now()) {
  return Merecat.restingNote(Merecat.hoursUntilUtcMidnight(nowMs));
}
export const MERECAT_SITE = 'https://merecatholicity.com/';
/* Six weight bands, the site owner's own ladder: the site's works and its
   catechetical core, the Scriptures, the named works of the Fathers, the
   councils and the schism documents, the deep Schaff/Summa sets, and Newman
   entire. Band feeds the retrieval boost, the prompt label, and the
   transparency panel's grouping. */
export const MERECAT_TIER_LABEL: Record<number, string> = {
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
export function merecatMentioned(body: unknown) {
  const unquoted = String(body || '').split('\n')
    .filter((l) => !/^\s*>/.test(l)).join('\n');
  return MERECAT_MENTION_RE.test(unquoted);
}
export const MERECAT_RV = 16;  // retrieval build: bump when retrieval logic changes

/* Config (persona, model, caps) lives in LIBDB so `make librarian` can change
   the bot's behavior with no redeploy. Cached per isolate for five minutes;
   a config push clears this isolate at once and the rest lag out the TTL. */
export const merecatConfigCache: { at: number; cfg: MerecatCfg | null } = { at: 0, cfg: null };
/* the dials that are plain counts: a bad row reads as the default */
const MERECAT_COUNT_DIALS: Record<string, 'user_daily' | 'global_daily' | 'topk' | 'max_tokens'> = {
  user_daily: 'user_daily', global_daily: 'global_daily', topk: 'topk', max_tokens: 'max_tokens',
};

export async function merecatConfig(env: Env): Promise<MerecatCfg> {
  if (merecatConfigCache.cfg && Date.now() - merecatConfigCache.at < 300000) {
    return merecatConfigCache.cfg;
  }
  const cfg: MerecatCfg = { ...MERECAT_DEFAULTS, persona: '' };
  try {
    const { results } = await env.LIBDB.prepare('SELECT k, v FROM config').all<{ k: string; v: string }>();
    for (const r of results || []) {
      if (r.k === 'persona') cfg.persona = String(r.v);
      else if (r.k === 'model') cfg.model = String(r.v);
      /* every dial reads through the kernel: a bad row yields its default */
      else if (r.k === 'mention_effort') cfg.mention_effort = Merecat.effortParse(Merecat.reasoningDefaults.mention)(String(r.v));
      else if (r.k === 'reasoning_default') cfg.reasoning_default = Merecat.effortParse(Merecat.reasoningDefaults.deflt)(String(r.v));
      else if (r.k === 'reasoning_max') cfg.reasoning_max = Merecat.effortParse(Merecat.reasoningDefaults.max)(String(r.v));
      else if (r.k === 'reasoning_on') cfg.reasoning_on = Merecat.reasoningOnFrom(String(r.v)) ? 1 : 0;
      else if (r.k === 'temperature') cfg.temperature = Merecat.temperatureFrom(String(r.v));
      else if (r.k === 'band_weights') cfg.band_weights = Merecat.bandWeightsCsv(Merecat.bandWeightsFrom(String(r.v)));
      else if (r.k === 'quota_guard_on') cfg.quota_guard_on = Merecat.quotaGuardOnFrom(String(r.v)) ? 1 : 0;
      else if (r.k === 'quota_guard_pct') cfg.quota_guard_pct = Merecat.quotaGuardPctFrom(String(r.v));
      else if (r.k === 'last_ingest' || r.k === 'last_ingest_by') cfg[r.k] = String(r.v).slice(0, 80);
      else if (r.k === 'user_cap_on') cfg.user_cap_on = Number(r.v) ? 1 : 0;
      else if (MERECAT_COUNT_DIALS[r.k]) { const k = MERECAT_COUNT_DIALS[r.k]; cfg[k] = Number(r.v) || MERECAT_DEFAULTS[k]; }
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

/* merecatThinkStripper lives in pure.ts (plain-Node testable); re-exported here so
   durable.ts keeps one import site for the librarian helpers. */
export { merecatThinkStripper } from './pure.ts';

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
export function merecatMatch(q: unknown): string {
  return Fts.unSafeMatch(Fts.merecatMatch(String(q ?? '')));
}

/* The phrase leg: when a question carries a quotation, its own word runs
   are the strongest possible scent — a text that IS the quote nails a
   six-word phrase that texts merely discussing it rarely reproduce. Slide
   windows over the question's tokens (stopwords kept, phrases need them)
   and offer the longest few as FTS phrase alternatives. */
export function merecatPhrases(q: unknown) {
  const words = String(q || '').match(/[A-Za-z0-9À-ɏ'’]+/g) || [];
  if (words.length < 5) return '';
  const phrases: string[] = [];
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
  const spec: Array<[string, string]> = [
    // The 66-book KJV core is single-sourced from Domain.Scripture (the same
    // table the client autolinks against), so the "must stay in step" hazard
    // cannot recur. Only the Vulgate namings and deuterocanon below are added.
    ...Scripture.bibleSpec.map((r: { slug: string; spellings: string[] }): [string, string] => [r.slug, r.spellings.join('|')]),
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
  const map: Record<string, string> = {}; const forms: string[] = [];
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
export const MERECAT_KJV2DR: Record<string, string> = {
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

/* A shelf chunk as retrieval selects it (schema-librarian.sql). */
export type ShelfRow = { cid: string; work_id: string; heading: string | null; anchor: string | null; text: string; title: string; url: string; tier: number };
/* How a leg seats a chunk in the pool: semantic, and a phrase hit. */
type SeatFn = (r: ShelfRow | null | undefined, sem: boolean, phr?: boolean) => void;

export async function merecatVerseSeats(env: Env, q: string, add: SeatFn) {
  const jobs: Array<{ slug: string; ch: number; v: number }> = []; const seen = new Set<string>();
  MERECAT_BIBLE.re.lastIndex = 0;
  let m: RegExpExecArray | null;
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
          ).bind(base, base + '-%').all<ShelfRow>();
          // a chapter packs into a few chunks whose anchors carry their first
          // verse: per work, seat the pack whose start is greatest but <= v
          const byWork = new Map<string, { r: ShelfRow; start: number }>();
          for (const r of rows.results || []) {
            const t = /-(\d+)$/.exec(String(r.anchor).slice(base.length));
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
export function merecatScrub(t: unknown, keepNl?: boolean) {
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
/* A pooled chunk, as the prompt and the sources read it. */
export type PoolChunk = { cid: string; work: string; title: string; url: string; anchor: string; heading: string; tier: number; text: string; sem: boolean; phr: boolean };

export async function merecatRetrieve(env: Env, q: string, cfg: MerecatCfg): Promise<PoolChunk[]> {
  const pool = new Map<string, PoolChunk>(); // cid -> chunk row stub
  const add: SeatFn = (r, sem, phr) => {
    if (!r || !r.cid) return;
    const had = pool.get(r.cid);
    if (had) { if (phr) had.phr = true; return; }
    pool.set(r.cid, { cid: r.cid, work: r.work_id, title: r.title, url: r.url,
      anchor: r.anchor || '', heading: r.heading || '', tier: r.tier || 2,
      text: r.text || '', sem: !!sem, phr: !!phr });
  };

  // Semantic leg: Tier-1 vectors.
  let semIds: string[] = [];
  try {
    const emb = await env.AI.run('@cf/baai/bge-m3', { text: [q] }) as { data?: number[][] };
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
    const byCid: Record<string, ShelfRow> = {};
    const ph = inList(semIds.length);
    for (const db of [env.LIBDB, env.LIBDB2, env.LIBDB3]) {
      if (!db) continue;
      try {
        const rows = await db.prepare(
          'SELECT c.cid, c.work_id, c.heading, c.anchor, c.text, w.title, w.url, w.tier ' +
          'FROM chunks c JOIN works w ON w.id = c.work_id WHERE c.cid IN (' + ph + ')'
        ).bind(...semIds).all<ShelfRow>();
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
          'ORDER BY bm25(chunks_fts) * ' + Merecat.bandCaseSql(Merecat.bandWeightsFrom(String(cfg.band_weights || ''))) + ' ' +
          'LIMIT 18').bind(match).all<ShelfRow>();
        for (const r of weighted.results || []) add(r, false);
        const raw = await db.prepare(SEL +
          'ORDER BY bm25(chunks_fts) LIMIT 12').bind(match).all<ShelfRow>();
        for (const r of raw.results || []) add(r, false);
        if (phr) {
          // a deep LIMIT: bm25 ranks heavy quoters of a phrase above the
          // text that says it once — the reranker and the guaranteed
          // phrase seats sort the pool out
          const hits = await db.prepare(SEL +
            'ORDER BY bm25(chunks_fts) LIMIT 20').bind(phr).all<ShelfRow>();
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
      /* The reranker is not in the binding's generated model catalogue, so its
         id and input shape are stated here rather than inferred. */
      const ai = env.AI as unknown as { run(model: string, input: unknown): Promise<{ response?: { id: number; score: number }[] }> };
      const rr = await ai.run('@cf/baai/bge-reranker-base', { query: q, contexts });
      const scored = (rr && rr.response ? rr.response : [])
        .filter((x) => x && Number.isInteger(x.id) && candidates[x.id])
        .sort((a, b) => b.score - a.score);
      if (scored.length) {
        const seen = new Set<number>();
        const ranked: PoolChunk[] = [];
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
/* A cited source, numbered as the answer cites it. */
export type MerecatSource = { n: number; title: string; heading: string; url: string };
export type ChatTurn = { role: string; content: string };
export async function merecatPrompt(env: Env, q: string, history: readonly ChatTurn[], summary: string, cfg: MerecatCfg, effort = 'off') {
  const chunks = await merecatRetrieve(env, q, cfg);
  const sources: MerecatSource[] = chunks.map((c, i) => ({
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
    '):\n\n' + (srcBlock || '(none)') + merecatThinkSuffix(effort);
  const messages: ChatTurn[] = [{ role: 'system', content: sys }];
  for (const h of history) messages.push(h);
  messages.push({ role: 'user', content: q });
  return { sources, messages };
}


export const MERECAT_WINDOW = 10;   // newest turns sent verbatim
export const MERECAT_FOLD_MIN = 4;  // fold only when this many turns have aged out

export async function merecatFold(env: Env, cfg: MerecatCfg, chatId: number) {
  try {
    const chat = await env.LIBDB.prepare(
      'SELECT summary, summarized_to FROM chats WHERE id = ?1').bind(chatId).first<{ summary: string | null; summarized_to: number | null }>();
    if (!chat) return;
    const all = await env.LIBDB.prepare(
      'SELECT id, role, body FROM chat_msgs WHERE chat_id = ?1 AND COALESCE(done, 1) = 1 ORDER BY id').bind(chatId).all<{ id: number; role: string; body: string }>();
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
    }) as AiChat;
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

export async function pruneMerecatChats(env: Env) {
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
export async function merecatEnsureProfile(env: Env) {
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

export async function merecatNames(env: Env, hashes: readonly unknown[]): Promise<Record<string, string>> {
  const uniq = [...new Set(hashes.filter((h) => h).map(String))];
  const out: Record<string, string> = {};
  if (!uniq.length) return out;
  const ph = inList(uniq.length);
  const rows = await env.DB.prepare(
    'SELECT hash, nick FROM profiles WHERE hash IN (' + ph + ')').bind(...uniq).all<{ hash: string; nick: string | null }>();
  for (const r of rows.results || []) if (r.nick) out[r.hash] = r.nick;
  return out;
}

/* Post the bot's comment: a reply under the topic on the board, a flat (or
   same-parent) comment on an article page. Board replies bump the topic and
   fan out notifications like anyone's reply, so the asker hears back. */
export async function merecatInsertComment(env: Env, src: { page: string; parent_id: number | null }, isBoard: boolean,
  topicId: number, topicAuthorHash: string | null, body: string) {
  await merecatEnsureProfile(env);
  const now = Math.floor(Date.now() / 1000);
  const parent = isBoard ? topicId : (src.parent_id || null);
  const ins = await env.DB.prepare(
    'INSERT INTO comments (page, parent_id, title, author_hash, body, status, created_at, ai_verdict) ' +
    "VALUES (?1, ?2, NULL, ?3, ?4, 'live', ?5, 'merecat') RETURNING id"
  ).bind(src.page, parent, MERECAT_BOT.hash, body, now).first<{ id: number }>() as { id: number };
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
      const prof = await env.DB.prepare('SELECT nick, signature, avatar, faith FROM profiles WHERE hash = ?1').bind(MERECAT_BOT.hash)
        .first<{ nick: string | null; signature: string | null; avatar: string | null; faith: string | null }>();
      const nick = (prof && prof.nick) || null;
      const stat = await env.DB.prepare('SELECT replies, title FROM comments WHERE id = ?1').bind(topicId).first<{ replies: number | null; title: string | null }>();
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
export function merecatFinishAnswer(answer: string, sources: readonly MerecatSource[]) {
  const firstAt = new Map<number, number>();
  answer.replace(/\[(\d+)\]/g, (m: string, n: string, at: number) => {
    const num = Number(n);
    if (sources.some((s) => s.n === num) && !firstAt.has(num)) firstAt.set(num, at);
    return m;
  });
  const order = [...firstAt.keys()].sort((a, b) => (firstAt.get(a) || 0) - (firstAt.get(b) || 0));
  const renum = new Map(order.map((n, i) => [n, i + 1]));
  if (renum.size) {
    answer = answer.replace(/\[(\d+)\]/g, (m: string, n: string) =>
      renum.has(Number(n)) ? '[' + renum.get(Number(n)) + ']' : m);
    const cited = sources.filter((s) => renum.has(s.n))
      .sort((a, b) => (renum.get(a.n) || 0) - (renum.get(b.n) || 0));
    const label = (s: MerecatSource) => merecatScrub(s.title + (s.heading ? ' — ' + s.heading : ''))
      .replace(/\[/g, '(').replace(/\]/g, ')');
    answer += '\n\nSources:\n' + cited.map((s) =>
      '[' + renum.get(s.n) + '] ' + (s.url ? '[' + label(s) + '](' + s.url + ')' : label(s))).join('\n');
  }
  return answer;
}

export async function merecatMentionReply(env: Env, commentId: number) {
  const c = await env.DB.prepare(
    "SELECT id, page, parent_id, title, author_hash, body FROM comments WHERE id = ?1 AND status = 'live'"
  ).bind(commentId).first<{ id: number; page: string; parent_id: number | null; title: string | null; author_hash: string | null; body: string }>();
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
  const g = await env.LIBDB.prepare('SELECT q FROM usage WHERE day = ?1').bind(day).first<{ q: number }>();
  if (!admin && g && g.q >= cfg.global_daily) {
    refuse = merecatRestingNote() + seeWhen;
  }
  /* The account's own wall (quota.ts) binds admins too: at the line the
     mention gets the same no-cost resting note, with the hours. */
  if (!refuse) {
    const quota = await merecatQuota(env, cfg);
    if (quota.resting) refuse = quota.note + seeWhen;
  }
  if (!refuse && !admin && cfg.user_cap_on) {
    const u = await env.LIBDB.prepare('SELECT q FROM user_usage WHERE day = ?1 AND hash = ?2')
      .bind(day, c.author_hash).first<{ q: number }>();
    if (u && u.q >= cfg.user_daily) {
      refuse = 'You have used your ' + cfg.user_daily + ' merecat questions for today.' + seeWhen;
    }
  }

  let topicAuthorHash: string | null = null;
  if (refuse) {
    if (isBoard) {
      const t = await env.DB.prepare('SELECT author_hash FROM comments WHERE id = ?1').bind(topicId).first<{ author_hash: string | null }>();
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
  const talk: [string, string][] = [];        // [hash, text] oldest first
  if (isBoard) {
    const topic = await env.DB.prepare(
      'SELECT id, title, author_hash, body FROM comments WHERE id = ?1').bind(topicId)
      .first<{ id: number; title: string | null; author_hash: string | null; body: string }>();
    topicAuthorHash = topic && topic.author_hash;
    topicTitle = String((topic && topic.title) || '').slice(0, MAX_TITLE);
    where = 'the forum topic “' + topicTitle + '” on this site’s Catholicity Board';
    const replies = await env.DB.prepare(
      "SELECT author_hash, body FROM comments WHERE parent_id = ?1 AND status = 'live' AND id != ?2 " +
      'ORDER BY id DESC LIMIT 12').bind(topicId, c.id).all<{ author_hash: string | null; body: string | null }>();
    for (const r of (replies.results || []).reverse()) talk.push([String(r.author_hash), String(r.body || '')]);
    const names0 = await merecatNames(env, [String((topic && topic.author_hash) || '')]);
    opening = 'TOPIC TITLE: “' + topicTitle + '” (a title often carries the question itself — treat it as part of what is asked)\n' +
      'OPENING POST by ' + ((topic && names0[String(topic.author_hash)]) || 'a member') + ': ' +
      (topic && topic.id === c.id
        ? '(the opening post is the very comment asking you, below)'
        : String((topic && topic.body) || '').slice(0, 1200));
  } else {
    where = 'the comment thread on this site’s own page ' + String(c.page) +
      ' (that page’s text is on your shelf)';
    const recent = await env.DB.prepare(
      "SELECT author_hash, body FROM comments WHERE page = ?1 AND status = 'live' AND id != ?2 " +
      'ORDER BY id DESC LIMIT 10').bind(c.page, c.id).all<{ author_hash: string | null; body: string | null }>();
    for (const r of (recent.results || []).reverse()) talk.push([String(r.author_hash), String(r.body || '')]);
  }
  const names = await merecatNames(env, talk.map((t) => t[0]).concat([String(c.author_hash)]));
  const nameOf = (h: string) => names[h] || (h === MERECAT_BOT.hash ? MERECAT_BOT.nick : 'a member');
  const talkBlock = (opening ? opening + '\n---\n' : '') +
    talk.map((t) => nameOf(t[0]) + ': ' + t[1].slice(0, 700)).join('\n---\n');

  let asked = String(c.body || '').replace(MERECAT_MENTION_RE, '').trim().slice(0, 2000);
  /* A bare "@merecat" under a question-bearing title: the title IS the ask. */
  if (!asked && topicTitle) asked = topicTitle;
  const userMsg = asked || 'Please weigh in on this thread.';
  /* The thread/page brief: where the mention lives, the recent conversation,
     and the reply instructions. */
  const frame = 'You were mentioned by name inside ' + where + '. The recent conversation, oldest first:\n\n' +
    (talkBlock || '(the thread starts with the comment below)') +
    '\n\nThe member ' + nameOf(c.author_hash) + ' has asked you directly, in the comment you are replying to. ' +
    'Write the single comment you will post in reply: answer what was asked, cite sources by their bracketed ' +
    'numbers like [2], stay under 250 words, no greeting and no signature.';

  /* Mentions reason at the admin's mention level, under the same switch and
     ceiling as every other ask. */
  const mentionEffort = merecatEffortFor(cfg, cfg.mention_effort);
  let answer = '';
  let sources = [];
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
    '):\n\n' + (srcBlock || '(none)') + merecatThinkSuffix(mentionEffort);
  const messages = [
    { role: 'system', content: sys },
    { role: 'user', content: userMsg },
  ];
  let res;
  try {
    res = await env.AI.run(cfg.model, { messages, max_tokens: 900 + merecatHeadroom(mentionEffort), temperature: cfg.temperature }) as AiChat;
  } catch (err) {
    console.log(JSON.stringify({ event: 'merecat_mention_ai_failed', error: String(err) }));
    return await merecatInsertComment(env, c, isBoard, topicId, topicAuthorHash,
      MERECAT_RESTING + ' Mention me again then.');
  }
  answer = res == null ? '' : (res.response != null ? String(res.response)
    : (res.choices && res.choices[0] && res.choices[0].message
      ? String(res.choices[0].message.content || '') : ''));
  answer = answer.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  if (!answer) return null;
  answer = merecatFinishAnswer(answer, sources);
  const replyId = await merecatInsertComment(env, c, isBoard, topicId, topicAuthorHash, answer.slice(0, 12000));

  // Mentions are tallied against the caps like any other question.
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
  return replyId;
}

/* Admin lever: run the mention pipeline on any existing comment — the
   manual re-summon for a post that was held and approved later, and the
   test hook. */
/* ---- The hub, sharded (2026-09-17; the law is Domain.Hub) ----
   The BoardHub is HUB_SHARDS Durable Object instances (shard 0 keeps the
   name "board"). A member's sockets all live on ONE shard — the one their
   identity hash names — so a private `user:<hash>` event is routed to that
   shard alone, while a public scope (board, feed, presence watches) is
   fanned to every shard in parallel. These are the only functions that dial
   a hub instance; a route file never spells `idFromName('board')` again. */
export type HubStub = {
  fetch(request: Request): Promise<Response>;
  publish(event: unknown): Promise<void>;
  relay(items: Array<{ scope: string; payload: string }>): Promise<{ idle: string[] } | void>;
  watch(from: number, register: string[], also: string[]): Promise<string[]>;
  presenceOf(hashes: string[]): Promise<string[]>;
  viewersOf(tag: string, hashes: string[]): Promise<string[]>;
  dmViewing(recipient: string, sender: string): Promise<boolean>;
  stats(): Promise<HubShardStats>;
};
export type HubShardStats = { shard: number; sockets: number; members: number };
/* A live event: its schema version, its type, the scopes that receive it, and
   the fields its type carries (API.md §5). */
export type HubEvent = { v: number; t: string; scopes: string[] } & Record<string, unknown> & NotEnv;
type HubEnv = { HUB?: DurableObjectNamespace; HUB_SHARDS?: string };

export function hubShards(env: HubEnv): number {
  return Hub.normalizeShards(String(env.HUB_SHARDS || ''));
}
export function hubShard(env: HubEnv, i: number): HubStub {
  const ns = env.HUB as DurableObjectNamespace;
  return ns.get(ns.idFromName(Hub.shardName(i))) as unknown as HubStub;
}
/* The shard that holds every socket of the member with this hash. */
export function hubHome(env: HubEnv, hash: string): HubStub {
  return hubShard(env, Hub.shardOf(hubShards(env))(hash));
}
/* Group hashes by their home shard: [shard index, the hashes it may hold]. */
function hubGroups(env: HubEnv, hashes: string[]): Array<[number, string[]]> {
  const n = hubShards(env);
  const by = new Map<number, string[]>();
  for (const h of hashes) {
    const i = Hub.shardOf(n)(h);
    const list = by.get(i);
    if (list) list.push(h); else by.set(i, [h]);
  }
  return Array.from(by.entries());
}
/* Publish one event to the shards it belongs on: the home shards of its
   `user:` scopes when every scope is private, all of them otherwise. A shard
   that fails is logged and never fails its siblings. */
export async function sendToHub(env: Env, event: HubEvent) {
  if (!env.HUB || !boardEventPublic(event)) return;
  /* Cloak every account hash in the frame's CONTENT to its pubid (the P0 chain
     L3) — the `scopes` (server-internal routing, `user:<account hash>`) are not
     a 64-hex id field, so cloakIds leaves them, and routing below is unchanged. */
  event = await cloakIds(env, event);
  const n = hubShards(env);
  const routed = Hub.routeScopes(n)(Array.isArray(event.scopes) ? event.scopes.map(String) : []);
  const homes: number[] | null = psOrNull(routed);
  const targets: number[] = homes || Array.from({ length: n }, (_, i) => i);
  const results = await Promise.allSettled(targets.map((i) => hubShard(env, i).publish(event)));
  results.forEach((r, k) => {
    if (r.status === 'rejected') console.log(JSON.stringify({ event: 'publish_failed', shard: targets[k], error: String(r.reason).slice(0, 200) }));
  });
}
/* Of these members, who is online now (honouring appear-offline)? Each home
   shard is asked only about the hashes it can hold; the answer is the union. */
export async function hubPresenceOf(env: HubEnv, hashes: string[]): Promise<string[]> {
  if (!env.HUB || !hashes.length) return [];
  const parts = await Promise.allSettled(hubGroups(env, hashes).map(([i, list]) => hubShard(env, i).presenceOf(list)));
  const out: string[] = [];
  for (const p of parts) if (p.status === 'fulfilled' && Array.isArray(p.value)) out.push(...p.value.map(String));
  return out;
}
/* Of these members, who has the conversation tagged `tag` on screen? */
export async function hubViewersOf(env: HubEnv, tag: string, hashes: string[]): Promise<string[]> {
  if (!env.HUB || !hashes.length) return [];
  const parts = await Promise.allSettled(hubGroups(env, hashes).map(([i, list]) => hubShard(env, i).viewersOf(tag, list)));
  const out: string[] = [];
  for (const p of parts) if (p.status === 'fulfilled' && Array.isArray(p.value)) out.push(...p.value.map(String));
  return out;
}
/* Does `recipient` have the pair with `sender` on screen (the pre-0016 claim,
   honoured one deploy longer)? Their home shard alone can say. */
export async function hubDmViewing(env: HubEnv, recipient: string, sender: string): Promise<boolean> {
  if (!env.HUB) return false;
  try { return !!(await hubHome(env, recipient).dmViewing(recipient, sender)); } catch { return false; }
}
/* Every shard's socket count — the Health card's number for "when to raise
   HUB_SHARDS". A shard that cannot answer reports -1. */
export async function hubStats(env: HubEnv): Promise<HubShardStats[]> {
  if (!env.HUB) return [];
  const n = hubShards(env);
  const parts = await Promise.allSettled(Array.from({ length: n }, (_, i) => hubShard(env, i).stats()));
  return parts.map((p, i) => (p.status === 'fulfilled' && p.value ? { shard: i, sockets: Number(p.value.sockets) || 0, members: Number(p.value.members) || 0 } : { shard: i, sockets: -1, members: -1 }));
}

/* Publish a batch of board events (awaitable), with a cheap page pre-gate (a
   non-board or admins-only page emits nothing). Each event still passes the
   central gate in sendToHub. Shared by broadcastBoard and the bot's inline reply. */
export async function publishBoardEvents(env: Env, page: string, events: HubEvent | HubEvent[]) {
  if (!boardKey(page) || page === ADMIN_CAT) return;
  const list = Array.isArray(events) ? events : [events];
  for (const e of list) await sendToHub(env, e);
}

/* The board-broadcast sink: fire-and-forget, env-guarded, deferred via waitUntil
   so it never delays or breaks the write. `events` is an array, or a function
   returning one (sync or async) for sites that must query per-event data — the
   page pre-gate runs first, so the builder is skipped for the back room. */
export function broadcastBoard(env: Env, ctx: ExecutionContext, page: string,
  events: HubEvent[] | (() => HubEvent[] | Promise<HubEvent[]>)) {
  if (!env.HUB || !boardKey(page) || page === ADMIN_CAT) return;
  ctx.waitUntil((async () => {
    const list = typeof events === 'function' ? await events() : events;
    await publishBoardEvents(env, page, list);
  })().catch((e) => console.log(JSON.stringify({ event: 'publish_failed', error: String(e) }))));
}

/* Fire-and-forget a single live event through the one sink; deferred via
   waitUntil so it never delays or breaks a write. */
export function publishLive(env: Env, ctx: ExecutionContext, event: HubEvent) {
  if (!env.HUB) return;
  ctx.waitUntil(sendToHub(env, event)
    .catch((e: unknown) => console.log(JSON.stringify({ event: 'publish_failed', error: String(e) }))));
}

/* Fire PRIVATE per-member live events (DMs, notifications) through the one hub.
   Each event is scoped to a single 'user:<hash>', which the DO fans only to
   sockets that authenticated as that hash — so a member's own connections alone
   receive it. Awaitable: a caller already inside a waitUntil (deliverNotifications)
   just awaits it; a plain handler passes ctx to publishLive-style fire-and-forget. */
export async function publishUser(env: Env, events: HubEvent | HubEvent[]) {
  if (!env.HUB) return;
  const list = (Array.isArray(events) ? events : [events]).filter(Boolean);
  for (const e of list) await sendToHub(env, e);
}

/* merecat over WebSockets (Phase 2). ask-init mints (or verifies) the
   conversation and returns its id BEFORE the socket opens, so the client adopts
   ?chat=<id> at once and dials the ChatRoom instance that matches the id (the DO
   name = 'chat:'+id, so a reconnect always reaches the same generator). */
export class MetaAttr {
  declare value: string;
  constructor(value: string) { this.value = value; }
  element(el: Element) { el.setAttribute('content', this.value); }
}
export class TitleText {
  declare value: string;
  /* NB: the field is `value`, not `text` — HTMLRewriter treats a `text` field on
     a handler object as a text-node handler (must be a function), so naming it
     `text` makes .on() reject the handler. */
  constructor(value: string) { this.value = value; }
  element(el: Element) { el.setInnerContent(this.value); }
}

/* Serve /@handle: fetch the static profile.html from the origin and inject the
   member's share-card OG (title/description/image/url), so a shared /@handle
   previews as the person. Everyone gets the real page; the client resolves the
   handle from the URL path. Bulletproof: any failure falls back to the plain
   page or a redirect to the ?u= form, so /@handle is never broken. */
