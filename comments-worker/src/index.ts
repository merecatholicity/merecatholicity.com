/* Comments handler. Same-origin API on /api/comments*. A commenter's whole
   account is a random client-side key; the server stores only SHA-256(key),
   so there is nothing here to leak. Turnstile gates every write, the
   rate-limit binding throttles by IP, and Llama Guard screens the text
   (flagged or unscreenable comments are held pending, never dropped).
   The only secret is TURNSTILE_SECRET, the Turnstile server key. */

import * as Rank from '../../purescript/output/Domain.Rank/index.js';
import * as Scripture from '../../purescript/output/Domain.Scripture/index.js';
import * as Media from '../../purescript/output/Domain.Media/index.js';
import * as CallK from '../../purescript/output/Domain.Call/index.js';
// Pure, dependency-free helpers (IP/ban-key normalization + back-room privacy),
// extracted so they can be unit-tested in plain Node. See src/pure.js. (pure.js
// also exports ipv6Groups/ipv6Prefix64/ipv6Full/isSharedV4, used internally
// there or client-side; imported here only what index.js calls directly.)
import { boardEventPublic, sanitizeScopes } from './pure.js';
// Real Web Push (VAPID + aes128gcm) on crypto.subtle — no external service.
// Repository layer: bind-placeholder helpers + identity mappers (see db.ts).
import { postCountsFor } from './db.ts';

/* Keyed-request preamble, single-sourced. Parse the JSON body, rate-limit by IP
   on `bucket`, then require + hash the identity key. Returns the resolved
   {ip, data, key, me} or a Response to return early. `keyedGated` adds the
   blocked-identity gate (a locked/banned hash is refused). These replicate,
   verbatim, the preamble that used to open each keyed handler. */

import {
  BOARD_CATS,
  CAT_META,
  EMOJI_PACKS,
  FAITHS,
  FAITH_LABELS,
  MERECAT_BOT,
  NAMED_EMOJI,
  PAGES,
  commentsJournalOn,
  commentsPagesOn,
  cacheHeader,
  enforceWallMediaCap,
  getAppSettings,
  mediaAudioSeconds,
  mediaKindMax,
  mediaKindsFor,
  mediaScanEnabled,
  mediaVoiceEnabled,
  socialEnabled,
  turnstileSkipEstablished,
  json,
  keyed,
  keyedGated,
  sweepCalls,
  originOk,
  pruneComments,
  pruneIdentityIps,
  pruneMerecatChats,
  pruneNotifications,
  pruneWallPosts,
  runBackup,
  screen,
  sendToHub,
  sweepDms,
  sweepExpiredDms,
  sweepMediaRetention,
  sweepJournalComments,
  sweepWallOrphanMedia,
  verifyTurnstile,
  noSuchPage,
  socialOff,
} from './lib.ts';
import {
  handleAdmin,
  handleAdminDiscordAdd,
  handleAdminDiscordDelete,
  handleAdminDiscordList,
  handleAdminSettings,
  handleAdmins,
  handleBackup,
  handleDeleteUser,
  handleIpBan,
  handleIpBans,
  handleLock,
  handleRdns,
  handleShadowban,
  handleShadowbanList,
} from './routes/admin.ts';
import {
  handleApprove,
  handleAudit,
  handleAuthorPosts,
  handleBoardAdmin,
  handleBoardCat,
  handleBoardIndex,
  handleBoardRead,
  handleBoardReadAll,
  handleBoardReads,
  handleBoardUnread,
  handleEdit,
  handleFeed,
  handleGet,
  handleJournal,
  handleMeta,
  handleModerate,
  handleMove,
  handlePending,
  handlePost,
  handleReport,
  handleReportDismiss,
  handleSearch,
  handleSelfDelete,
  handleTopicView,
  handleTrust,
  handleWatch,
} from './routes/board.ts';
import {
  handleMerecatAbout,
  handleMerecatAdminThread,
  handleMerecatAdminThreads,
  handleMerecatAskInit,
  handleMerecatBackends,
  handleMerecatChat,
  handleMerecatChatDelete,
  handleMerecatChatSave,
  handleMerecatChats,
  handleMerecatConfigSet,
  handleMerecatForward,
  handleMerecatIngest,
  handleMerecatLive,
  handleMerecatMention,
  handleMerecatStats,
  handleMerecatUsage,
  handleMerecatWorks,
} from './routes/merecat.ts';
import {
  handleDmBlock,
  handleDmBlocked,
  handleDmDelete,
  handleDmDirectory,
  handleDmEdit,
  handleDmForward,
  handleDmGroups,
  handleDmLeave,
  handleDmMediaGet,
  handleDmMediaUpload,
  handleDmMembers,
  handleDmName,
  handleDmPresence,
  handleDmPubkey,
  handleDmReact,
  handleDmRedact,
  handleDmRoster,
  handleDmSave,
  handleDmSeen,
  handleDmSend,
  handleDmThread,
  handleDmThreads,
  handleDmTtl,
  handleDmUnread,
} from './routes/dm.ts';
import {
  handleBookmark,
  handleBookmarks,
  handleReact,
  handleReactMine,
  handleReactWho,
  handleRecent,
  handleWall,
  handleWallComment,
  handleWallDelete,
  handleWallEdit,
  handleWallFeed,
  handleWallPost,
  handleWallPostGet,
} from './routes/wall.ts';
import {
  handleAvatarDelete,
  handleAvatarGet,
  handleAvatarUpload,
  handleHandleCard,
  handlePrefs,
  handleProfileAdminEdit,
  handleProfileClear,
  handleProfileGet,
  handleProfileSave,
} from './routes/profile.ts';
import {
  handleDmMediaPurge,
  handleWallMediaGet,
  handleWallMediaPurge,
  handleWallPrune,
  mediaUpload,
} from './routes/media.ts';
import {
  handleNotifList,
  handleNotifRead,
  handleNotifUnread,
  handlePushRegister,
  handlePushUnregister,
  handleVapidKey,
} from './routes/notify.ts';
import {
  handleCallAnswer,
  handleCallEnd,
  handleCallOffer,
  handleCallPending,
  handleCallTurn,
} from './routes/calls.ts';
import { handleAdminUsage, runUsageCheck } from './usage.ts';

import type { Env } from './env.ts';

async function handleConfig(request: any, env: any, url: any) {
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.READ_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests. Slow down.' }, 429);
  const custom: any = {};
  for (const k of Object.keys(EMOJI_PACKS)) for (const [code, path] of (EMOJI_PACKS as any)[k]) custom[code] = path;
  /* The served media limits: every composer gates client-side from THIS (never a
     hardcoded number — the old 60 MB client gate vs 25 MB server refusal bug).
     Cacheable ~5 min like the worker's own settings cache, so a settings change
     converges quickly. DM per-kind limits are advisory (E2E — the server only
     ever sees ciphertext bytes); the wall/board ones are server-enforced too. */
  const s = await getAppSettings(env);
  return json({
    ok: true,
    apiVersion: 1,
    media: {
      /* Legacy fields — computed EXACTLY as before the per-section split (no
         ctx passed), kept so an older cached client keeps working one deploy. */
      enabled: s.media_enabled === '1',
      kinds: { dm: mediaKindsFor(s, 'dm'), wall: mediaKindsFor(s, 'wall'), board: mediaKindsFor(s, 'board') },
      max_bytes: { image: mediaKindMax(s, 'image'), video: mediaKindMax(s, 'video'), audio: mediaKindMax(s, 'audio') },
      audio_max_seconds: Number(s.media_audio_max_seconds) || Number(Media.defaults.audioMaxSeconds),
      autocompress: s.media_image_autocompress === '1',
      /* The per-section policy — the current client reads ONLY this. dm carries
         NO scan field: its media is E2E ciphertext, structurally unscannable —
         the absence IS the statement. */
      sections: {
        dm: {
          kinds: mediaKindsFor(s, 'dm'), voice: mediaVoiceEnabled(s, 'dm'),
          max_bytes: { image: mediaKindMax(s, 'image', 'dm'), video: mediaKindMax(s, 'video', 'dm'), audio: mediaKindMax(s, 'audio', 'dm') },
          audio_max_seconds: mediaAudioSeconds(s, 'dm'),
        },
        wall: {
          kinds: mediaKindsFor(s, 'wall'), voice: mediaVoiceEnabled(s, 'wall'), scan: mediaScanEnabled(s, 'wall'),
          max_bytes: { image: mediaKindMax(s, 'image', 'wall'), video: mediaKindMax(s, 'video', 'wall'), audio: mediaKindMax(s, 'audio', 'wall') },
          audio_max_seconds: mediaAudioSeconds(s, 'wall'),
        },
        board: {
          kinds: mediaKindsFor(s, 'board'), voice: mediaVoiceEnabled(s, 'board'), scan: mediaScanEnabled(s, 'board'),
          max_bytes: { image: mediaKindMax(s, 'image', 'board'), video: mediaKindMax(s, 'video', 'board'), audio: mediaKindMax(s, 'audio', 'board') },
          audio_max_seconds: mediaAudioSeconds(s, 'board'),
        },
      },
    },
    /* The social layer (Feed + member walls). Off, the client hides the Feed tab
       and the profile wall and renders feed.html as a page that never was; the
       worker answers every /wall* surface the same way regardless — this field
       is the client's courtesy copy, not the enforcement. */
    social: { enabled: socialEnabled(s) },
    /* Comments sections: which of the site's own writings have theirs open,
       and whether every journal article carries one. A client mounts no
       widget for a page not listed (and spends no read on it); the worker
       refuses such a page regardless, exactly as it refuses an unknown one. */
    comments: { pages: commentsPagesOn(s), journal: commentsJournalOn(s) },
    /* Advisory only: it tells the client whether a challenge is worth
       mounting. verifyTurnstile decides, every time, on the server. */
    turnstile: { skip_established: turnstileSkipEstablished(s) },
    /* 1v1 voice calls: the 📞 button renders only when enabled (the worker
       refuses /call/* regardless — this is the client's courtesy copy). The
       silence watch is client-run off these two fields, clamped through the
       same Domain.Call rule the settings save applies. */
    calls: {
      enabled: s.calls_enabled === '1',
      idle_hangup: s.calls_idle_hangup !== '0',
      idle_seconds: CallK.idleClampSecs(Math.floor(Number(s.calls_idle_seconds)) || CallK.idleDefaultSecs),
    },
    cats: CAT_META.filter((c) => BOARD_CATS.includes(c[0])).map((c, i) => {
      const o: any = { key: c[0], label: c[1], blurb: c[2], order: i };
      if (c[3]) o.link = { text: c[3], url: c[4] };
      return o;
    }),
    faiths: FAITHS.map((code: any, i: any) => ({ code, label: FAITH_LABELS[code] || code, order: i })),
    ranks: Rank.rankTable,
    pages: PAGES,
    bot_hash: MERECAT_BOT.hash,
    bible: Scripture.bibleSpec,
    emoji: { custom, named: NAMED_EMOJI, data_url: '/emoji/emoji-data.json' },
  }, 200, cacheHeader(url));
}

/* Admin-only view of the logged metadata. The public GET never carries
   these fields; this endpoint demands a key hashing into ADMIN_HASHES. */

/* postCountsFor — a member's live-forum post count (topics always, replies only
   under a live topic) for a batch of hashes, the same definition handleAuthorPosts
   totals — now lives in the repository layer, ./db.ts (imported at the top). */

/* ---- Direct messages. Strictly 1v1, private to the two keys involved: every
   read is a POST carrying the key, nothing is cacheable, and no admin door
   exists. A thread is unread for me when its last word is someone else's and
   newer than my read stamp. ---- */

/* ================= 1v1 voice calls =================
   Media is peer-to-peer DTLS-SRTP (genuinely end-to-end — the operator relays
   only setup metadata; even a TURN relay carries opaque ciphertext). Setup
   rides these gated POSTs, where the DM privacy rules already live; the
   transient ICE/end/decline words ride the BoardHub 'call-sig' relay
   (durable.ts). The offer is KEPT for the ring (calls_pending, 2026-09-12) so
   a callee reached by the ring's push can fetch it and answer; the outcome is
   recorded once (0017) as the thread's own event line — missed, declined, or
   answered with its length — the coalesced bell and the push riding a miss.
   calls_enabled (app_settings) is the global kill switch,
   enforced here, server-authoritative. */

/* ================= Public posting: walls + the global feed =================
   A member's "wall" is their own stream of public posts; the "feed" is every
   member's posts together. Public + UNencrypted (unlike DMs), reusing the forum's
   Turnstile + AI screen (held-if-flagged) + @mention notifications. Media rides a
   public R2 bucket (WALLMEDIA), served same-origin like avatars. Posts persist
   until the admin auto-prune (Phase D) removes them. All members-only to read.

   THE WHOLE LAYER HAS A GLOBAL KILL SWITCH: app_settings `social_enabled`, read
   through the kernel by `socialOff` below. When it is off every surface here
   answers as though it never existed — the back room's posture, so a prober
   learns nothing and no "turned off" copy invites a retry — while not one row is
   deleted. Deliberately still open when off: /wall/delete (an author or admin
   must always be able to retract), the shared GET /wall/media (it serves forum
   attachments too), the admin pending/approve queue (so held content is never
   stranded), and every storage sweep. */

/* One post plus all its live comments (the ?post=<id> detail + mention target). */

/* ---- Avatars. One 400x400 raster image per identity, stored in R2 under
   avatars/<hash>, so an upload overwrites the old file and storage stays
   pruned by construction. The server trusts nothing from the client: bytes
   are sniffed for PNG/JPEG/WebP magic (never SVG, which can carry script),
   dimensions are read from the image header itself, and the stored
   content-type is the sniffed one. ---- */

/* ---- Backups. A monthly cron dumps the whole database to one SQL file,
   gzips it, and drops it in the BACKUPS R2 bucket, keeping ninety days.
   Restore: download, gunzip, then
   deno run -A npm:wrangler d1 execute merecatholicity-comments --remote --file backup.sql
   The dump carries the search index's virtual table and triggers and rebuilds
   it from the restored rows, so the one file brings search back on its own. ---- */

/* ---- In-platform moderation. Every control demands a key hashing into
   ADMIN_HASHES; the old signed email links are gone entirely. ---- */

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

/* /api/merecat/store was the HTTP era's answer callback. The ChatRoom Durable
   Object has been the sole D1 writer since 2026-07-30; the kept-for-one-deploy
   no-op is now deleted and the route 404s like any unknown path. */

/* Drain the model's SSE stream into the client stream: preamble first (the
   thread id and the sources), then deltas with think spans stripped. When
   the stream ends: bump the usage counters, store the answer on the thread,
   and fold aged turns into the thread's condensed summary. */

/* ---- @merecat in the comments and the forum ----------------------------
   A live post containing @merecat summons the librarian to answer in the
   thread itself. The brief is deliberately light, as the corpus already
   holds every page's own text: where the thread lives (the page or the
   topic), the recent conversation, and the asking comment — retrieval
   supplies the shelf. The reply posts as a fresh comment by the bot
   identity, and the cost lands on the mentioner's own daily count (admins
   uncapped as everywhere). */

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
/* sanitizeScopes (the WebSocket subscription allowlist) lives in src/pure.js —
   security-critical and unit-tested there. BOARD_CATS is passed in so the pure
   helper stays dependency-free. */

/* The two Durable Objects live in ./durable.ts; re-exported so wrangler
   finds BoardHub/ChatRoom on the main module. */
export { BoardHub, ChatRoom } from './durable.ts';
async function handleLive(request: any, env: any) {
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

/* Declarative route table (was a 91-branch if-chain in fetch). Every entry
   is (method, exact path, handler thunk); the fn copies the original call
   verbatim so args are identical. Matched in order, but every (method,path)
   pair is unique so order is immaterial. The 4 special branches (/@ prefix,
   POST origin guard, the two websocket upgrades) stay explicit in fetch. */
type Route = { m: string; p: string;
  fn: (request: Request, env: Env, ctx: ExecutionContext, url: URL) => Promise<Response> | Response };
const INGEST_DOORS = ['/api/merecat/works', '/api/merecat/config', '/api/merecat/ingest'];

const ROUTES: Route[] = [
  { m: 'GET', p: '/api/comments', fn: (request, env, ctx, url) => handleGet(request, env, url) },
  { m: 'GET', p: '/api/comments/config', fn: (request, env, ctx, url) => handleConfig(request, env, url) },
  { m: 'POST', p: '/api/comments', fn: (request, env, ctx, url) => handlePost(request, env, ctx) },
  { m: 'POST', p: '/api/comments/delete', fn: (request, env, ctx, url) => handleSelfDelete(request, env, ctx) },
  { m: 'POST', p: '/api/comments/edit', fn: (request, env, ctx, url) => handleEdit(request, env, ctx) },
  { m: 'POST', p: '/api/comments/meta', fn: (request, env, ctx, url) => handleMeta(request, env) },
  { m: 'POST', p: '/api/comments/audit', fn: (request, env, ctx, url) => handleAudit(request, env) },
  { m: 'POST', p: '/api/comments/trust', fn: (request, env, ctx, url) => handleTrust(request, env) },
  { m: 'POST', p: '/api/comments/moderate', fn: (request, env, ctx, url) => handleModerate(request, env, ctx) },
  { m: 'POST', p: '/api/comments/move', fn: (request, env, ctx, url) => handleMove(request, env, ctx) },
  { m: 'GET', p: '/api/comments/feed', fn: (request, env, ctx, url) => handleFeed(request, env, url) },
  { m: 'GET', p: '/api/comments/journal', fn: (request, env, ctx, url) => handleJournal(request, env, url) },
  { m: 'GET', p: '/api/comments/board', fn: (request, env, ctx, url) => handleBoardIndex(request, env, url) },
  { m: 'GET', p: '/api/comments/board/cat', fn: (request, env, ctx, url) => handleBoardCat(request, env, url) },
  { m: 'GET', p: '/api/comments/board/author', fn: (request, env, ctx, url) => handleAuthorPosts(request, env, url) },
  { m: 'GET', p: '/api/comments/board/topic', fn: (request, env, ctx, url) => handleTopicView(request, env, url) },
  { m: 'POST', p: '/api/comments/board/admin', fn: (request, env, ctx, url) => handleBoardAdmin(request, env) },
  { m: 'GET', p: '/api/comments/search', fn: (request, env, ctx, url) => handleSearch(request, env, url) },
  { m: 'GET', p: '/api/comments/profile', fn: (request, env, ctx, url) => handleProfileGet(request, env, url) },
  { m: 'POST', p: '/api/comments/profile', fn: (request, env, ctx, url) => handleProfileSave(request, env) },
  { m: 'POST', p: '/api/comments/profile/admin', fn: (request, env, ctx, url) => handleProfileAdminEdit(request, env) },
  { m: 'POST', p: '/api/comments/profile/clear', fn: (request, env, ctx, url) => handleProfileClear(request, env) },
  { m: 'POST', p: '/api/comments/backup', fn: (request, env, ctx, url) => handleBackup(request, env) },
  { m: 'POST', p: '/api/comments/dm/send', fn: (request, env, ctx, url) => handleDmSend(request, env, ctx) },
  { m: 'POST', p: '/api/comments/dm/threads', fn: (request, env, ctx, url) => handleDmThreads(request, env) },
  { m: 'POST', p: '/api/comments/dm/thread', fn: (request, env, ctx, url) => handleDmThread(request, env, ctx) },
  { m: 'POST', p: '/api/comments/dm/unread', fn: (request, env, ctx, url) => handleDmUnread(request, env) },
  { m: 'POST', p: '/api/comments/dm/presence', fn: (request, env, ctx, url) => handleDmPresence(request, env) },
  { m: 'POST', p: '/api/comments/dm/blocked', fn: (request, env, ctx, url) => handleDmBlocked(request, env) },
  { m: 'POST', p: '/api/comments/prefs', fn: (request, env, ctx, url) => handlePrefs(request, env) },
  { m: 'POST', p: '/api/comments/call/offer', fn: (request, env, ctx, url) => handleCallOffer(request, env, ctx) },
  { m: 'POST', p: '/api/comments/call/answer', fn: (request, env, ctx, url) => handleCallAnswer(request, env, ctx) },
  { m: 'POST', p: '/api/comments/call/pending', fn: (request, env, ctx, url) => handleCallPending(request, env) },
  { m: 'POST', p: '/api/comments/call/end', fn: (request, env, ctx, url) => handleCallEnd(request, env, ctx) },
  { m: 'POST', p: '/api/comments/call/turn', fn: (request, env, ctx, url) => handleCallTurn(request, env) },
  { m: 'POST', p: '/api/comments/dm/block', fn: (request, env, ctx, url) => handleDmBlock(request, env) },
  { m: 'POST', p: '/api/comments/dm/delete', fn: (request, env, ctx, url) => handleDmDelete(request, env) },
  { m: 'GET', p: '/api/comments/dm/directory', fn: (request, env, ctx, url) => handleDmDirectory(request, env, url) },
  { m: 'POST', p: '/api/comments/dm/pubkey', fn: (request, env, ctx, url) => handleDmPubkey(request, env) },
  { m: 'POST', p: '/api/comments/dm/ttl', fn: (request, env, ctx, url) => handleDmTtl(request, env, ctx) },
  { m: 'POST', p: '/api/comments/dm/save', fn: (request, env, ctx, url) => handleDmSave(request, env, ctx) },
  { m: 'POST', p: '/api/comments/dm/react', fn: (request, env, ctx, url) => handleDmReact(request, env, ctx) },
  { m: 'POST', p: '/api/comments/dm/like', fn: (request, env, ctx, url) => handleDmReact(request, env, ctx) },   // the 2026-08-03 heart, one deploy for cached clients
  { m: 'POST', p: '/api/comments/dm/seen', fn: (request, env, ctx, url) => handleDmSeen(request, env, ctx) },
  { m: 'POST', p: '/api/comments/dm/edit', fn: (request, env, ctx, url) => handleDmEdit(request, env, ctx) },
  { m: 'POST', p: '/api/comments/dm/redact', fn: (request, env, ctx, url) => handleDmRedact(request, env, ctx) },
  { m: 'POST', p: '/api/comments/dm/media', fn: (request, env, ctx, url) => handleDmMediaUpload(request, env) },
  { m: 'POST', p: '/api/comments/dm/media/get', fn: (request, env, ctx, url) => handleDmMediaGet(request, env) },
  { m: 'POST', p: '/api/comments/dm/media/purge', fn: (request, env, ctx, url) => handleDmMediaPurge(request, env) },
  { m: 'POST', p: '/api/comments/dm/roster', fn: (request, env, ctx, url) => handleDmRoster(request, env) },
  { m: 'POST', p: '/api/comments/dm/groups', fn: (request, env, ctx, url) => handleDmGroups(request, env, ctx) },
  { m: 'POST', p: '/api/comments/dm/members', fn: (request, env, ctx, url) => handleDmMembers(request, env, ctx) },
  { m: 'POST', p: '/api/comments/dm/leave', fn: (request, env, ctx, url) => handleDmLeave(request, env, ctx) },
  { m: 'POST', p: '/api/comments/dm/name', fn: (request, env, ctx, url) => handleDmName(request, env, ctx) },
  { m: 'POST', p: '/api/comments/dm/forward', fn: (request, env, ctx, url) => handleDmForward(request, env, ctx) },
  { m: 'POST', p: '/api/comments/admin/settings', fn: (request, env, ctx, url) => handleAdminSettings(request, env) },
  { m: 'POST', p: '/api/comments/admin/discord/list', fn: (request, env, ctx, url) => handleAdminDiscordList(request, env) },
  { m: 'POST', p: '/api/comments/admin/discord/add', fn: (request, env, ctx, url) => handleAdminDiscordAdd(request, env) },
  { m: 'POST', p: '/api/comments/admin/discord/delete', fn: (request, env, ctx, url) => handleAdminDiscordDelete(request, env) },
  { m: 'POST', p: '/api/comments/admin/usage', fn: (request, env, ctx, url) => handleAdminUsage(request, env) },
  { m: 'POST', p: '/api/comments/notifications/unread', fn: (request, env, ctx, url) => handleNotifUnread(request, env) },
  { m: 'POST', p: '/api/comments/notifications/read', fn: (request, env, ctx, url) => handleNotifRead(request, env) },
  { m: 'POST', p: '/api/comments/notifications', fn: (request, env, ctx, url) => handleNotifList(request, env) },
  { m: 'POST', p: '/api/comments/watch', fn: (request, env, ctx, url) => handleWatch(request, env) },
  { m: 'POST', p: '/api/comments/board/unread', fn: (request, env, ctx, url) => handleBoardUnread(request, env) },
  { m: 'POST', p: '/api/comments/board/reads', fn: (request, env, ctx, url) => handleBoardReads(request, env) },
  { m: 'POST', p: '/api/comments/board/read', fn: (request, env, ctx, url) => handleBoardRead(request, env) },
  { m: 'POST', p: '/api/comments/board/read-all', fn: (request, env, ctx, url) => handleBoardReadAll(request, env) },
  { m: 'GET', p: '/api/comments/avatar', fn: (request, env, ctx, url) => handleAvatarGet(request, env, url) },
  { m: 'POST', p: '/api/comments/avatar', fn: (request, env, ctx, url) => handleAvatarUpload(request, env) },
  { m: 'POST', p: '/api/comments/avatar/delete', fn: (request, env, ctx, url) => handleAvatarDelete(request, env) },
  { m: 'POST', p: '/api/comments/wall/feed', fn: (request, env, ctx, url) => handleWallFeed(request, env) },
  { m: 'POST', p: '/api/comments/wall/post', fn: (request, env, ctx, url) => handleWallPost(request, env, ctx) },
  { m: 'POST', p: '/api/comments/wall/post/get', fn: (request, env, ctx, url) => handleWallPostGet(request, env) },
  { m: 'POST', p: '/api/comments/wall/comment', fn: (request, env, ctx, url) => handleWallComment(request, env, ctx) },
  { m: 'POST', p: '/api/comments/wall/delete', fn: (request, env, ctx, url) => handleWallDelete(request, env) },
  { m: 'POST', p: '/api/comments/wall/edit', fn: (request, env, ctx, url) => handleWallEdit(request, env) },
  { m: 'POST', p: '/api/comments/bookmark', fn: (request, env, ctx, url) => handleBookmark(request, env) },
  { m: 'POST', p: '/api/comments/bookmarks', fn: (request, env, ctx, url) => handleBookmarks(request, env) },
  { m: 'GET', p: '/api/comments/recent', fn: (request, env, ctx, url) => handleRecent(request, env, url) },
  /* Reactions (2026-09-12): one road for every public target; the three like
     roads are aliases of it (the ❤️ reaction), kept one deploy for cached clients. */
  { m: 'POST', p: '/api/comments/react', fn: (request, env, ctx, url) => handleReact(request, env, ctx) },
  { m: 'POST', p: '/api/comments/reacts', fn: (request, env, ctx, url) => handleReactMine(request, env) },
  { m: 'POST', p: '/api/comments/react/who', fn: (request, env, ctx, url) => handleReactWho(request, env) },
  { m: 'POST', p: '/api/comments/wall/like', fn: (request, env, ctx, url) => handleReact(request, env, ctx) },
  { m: 'POST', p: '/api/comments/wall/comment/like', fn: (request, env, ctx, url) => handleReact(request, env, ctx) },
  { m: 'POST', p: '/api/comments/wall/likers', fn: (request, env, ctx, url) => handleReactWho(request, env) },
  { m: 'POST', p: '/api/comments/wall/prune', fn: (request, env, ctx, url) => handleWallPrune(request, env) },
  { m: 'GET', p: '/api/comments/wall/media', fn: (request, env, ctx, url) => handleWallMediaGet(request, env, url, ctx) },
  /* Gated at the ROUTE, not inside mediaUpload — the board route below shares
     that handler and must keep working when the social layer is off. */
  { m: 'POST', p: '/api/comments/wall/media', fn: async (request, env, ctx, url) => (await socialOff(env)) ? noSuchPage() : mediaUpload(request, env, 'wall') },
  { m: 'POST', p: '/api/comments/board/media', fn: (request, env, ctx, url) => mediaUpload(request, env, 'board') },
  { m: 'POST', p: '/api/comments/wall/media/purge', fn: (request, env, ctx, url) => handleWallMediaPurge(request, env, 'wall') },
  { m: 'POST', p: '/api/comments/board/media/purge', fn: (request, env, ctx, url) => handleWallMediaPurge(request, env, 'board') },
  { m: 'POST', p: '/api/comments/wall', fn: (request, env, ctx, url) => handleWall(request, env) },
  { m: 'POST', p: '/api/comments/lock', fn: (request, env, ctx, url) => handleLock(request, env) },
  { m: 'POST', p: '/api/comments/shadowban', fn: (request, env, ctx, url) => handleShadowban(request, env) },
  { m: 'POST', p: '/api/comments/shadowban/list', fn: (request, env, ctx, url) => handleShadowbanList(request, env) },
  { m: 'POST', p: '/api/comments/deleteuser', fn: (request, env, ctx, url) => handleDeleteUser(request, env) },
  { m: 'POST', p: '/api/comments/ipban', fn: (request, env, ctx, url) => handleIpBan(request, env) },
  { m: 'POST', p: '/api/comments/ipbans', fn: (request, env, ctx, url) => handleIpBans(request, env) },
  { m: 'POST', p: '/api/comments/rdns', fn: (request, env, ctx, url) => handleRdns(request, env) },
  { m: 'POST', p: '/api/comments/approve', fn: (request, env, ctx, url) => handleApprove(request, env, ctx) },
  { m: 'POST', p: '/api/comments/pending', fn: (request, env, ctx, url) => handlePending(request, env) },
  { m: 'POST', p: '/api/comments/report', fn: (request, env, ctx, url) => handleReport(request, env) },
  { m: 'POST', p: '/api/comments/report/dismiss', fn: (request, env, ctx, url) => handleReportDismiss(request, env) },
  { m: 'POST', p: '/api/comments/admins', fn: (request, env, ctx, url) => handleAdmins(request, env) },
  { m: 'POST', p: '/api/comments/admin', fn: (request, env, ctx, url) => handleAdmin(request, env) },
  { m: 'POST', p: '/api/comments/push/register', fn: (request, env, ctx, url) => handlePushRegister(request, env) },
  { m: 'POST', p: '/api/comments/push/unregister', fn: (request, env, ctx, url) => handlePushUnregister(request, env) },
  { m: 'GET', p: '/api/comments/push/vapid-key', fn: (request, env, ctx, url) => handleVapidKey(request, env, url) },
  { m: 'POST', p: '/api/merecat/ask-init', fn: (request, env, ctx, url) => handleMerecatAskInit(request, env) },
  { m: 'POST', p: '/api/merecat/about', fn: (request, env, ctx, url) => handleMerecatAbout(request, env) },
  { m: 'POST', p: '/api/merecat/backends', fn: (request, env, ctx, url) => handleMerecatBackends(request, env) },
  { m: 'POST', p: '/api/merecat/usage', fn: (request, env, ctx, url) => handleMerecatUsage(request, env) },
  { m: 'POST', p: '/api/merecat/forward', fn: (request, env, ctx, url) => handleMerecatForward(request, env) },
  { m: 'POST', p: '/api/merecat/mention', fn: (request, env, ctx, url) => handleMerecatMention(request, env) },
  { m: 'POST', p: '/api/merecat/chats', fn: (request, env, ctx, url) => handleMerecatChats(request, env) },
  { m: 'POST', p: '/api/merecat/chat', fn: (request, env, ctx, url) => handleMerecatChat(request, env) },
  { m: 'POST', p: '/api/merecat/chat/delete', fn: (request, env, ctx, url) => handleMerecatChatDelete(request, env) },
  { m: 'POST', p: '/api/merecat/admin/threads', fn: (request, env, ctx, url) => handleMerecatAdminThreads(request, env) },
  { m: 'POST', p: '/api/merecat/admin/thread', fn: (request, env, ctx, url) => handleMerecatAdminThread(request, env) },
  { m: 'POST', p: '/api/merecat/chat/save', fn: (request, env, ctx, url) => handleMerecatChatSave(request, env) },
  { m: 'POST', p: '/api/merecat/ingest', fn: (request, env, ctx, url) => handleMerecatIngest(request, env) },
  { m: 'POST', p: '/api/merecat/works', fn: (request, env, ctx, url) => handleMerecatWorks(request, env) },
  { m: 'POST', p: '/api/merecat/config', fn: (request, env, ctx, url) => handleMerecatConfigSet(request, env) },
  { m: 'POST', p: '/api/merecat/stats', fn: (request, env, ctx, url) => handleMerecatStats(request, env) },
];

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    try {
      const url = new URL(request.url);
      const path = url.pathname.replace(/\/+$/, '') || '/';

      /* The workers.dev hostname exists for ONE caller: the pipeline's ingest,
         which the zone's Bot Fight Mode would turn away at merecatholicity.com
         (it cannot be skipped by any rule on the Free plan, and a GitHub runner
         is exactly what it fights). That second front door opens onto nothing
         but the three librarian endpoints, each of which demands the ingest
         key; every other path answers 404 there as though the worker did not
         exist. The site's own origin is untouched. */
      if (url.hostname.endsWith('.workers.dev') &&
          !(request.method === 'POST' && INGEST_DOORS.indexOf(path) !== -1)) {
        return json({ ok: false, error: 'Not found.' }, 404);
      }

      /* Pretty profile URLs: /@handle is served by this worker — it fetches the
         static profile.html from the origin (which is NOT routed here, so no loop)
         and injects the member's share-card OG (name, avatar, bio), so a shared
         /@handle previews as the person. Humans get the same page; the client
         resolves the handle from the path. Only /@* reaches the worker. */
      if (path.startsWith('/@') && request.method === 'GET') return await handleHandleCard(request, env, url);

      if (request.method === 'POST' && !originOk(request, env)) {
        return json({ ok: false, error: 'Bad origin.' }, 403);
      }

      /* Live updates: the WebSocket upgrade to the board hub (a GET, so it never
         hits the POST origin guard above; handleLive does its own origin check). */
      if (path === '/api/comments/live' && request.method === 'GET' &&
          (request.headers.get('Upgrade') || '').toLowerCase() === 'websocket') {
        return await handleLive(request, env);
      }

      for (const r of ROUTES) {
        if (request.method === r.m && path === r.p) return await r.fn(request, env, ctx, url);
      }
      /* merecat live chat WebSocket upgrade (GET, so it skips the POST origin
         guard; handleMerecatLive does its own auth). */
      if (path === '/api/merecat/live' && request.method === 'GET' &&
          (request.headers.get('Upgrade') || '').toLowerCase() === 'websocket') return await handleMerecatLive(request, env);
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
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    /* Hourly: only sweep expired disappearing DMs + their media (cheap, frequent,
       the reclamation pass behind the instant read-time hiding). Monthly (any
       other schedule): the sweep plus the full housekeeping + backup chain. */
    if (event && event.cron === '0 * * * *') {
      ctx.waitUntil(sweepExpiredDms(env)
        .then(() => sweepWallOrphanMedia(env))
        .then(() => sweepMediaRetention(env))
        .then(() => enforceWallMediaCap(env)));
      return;
    }
    /* Daily (23:30 UTC — late in the UTC day, so the day-quota meters read
       near-complete): the Cloudflare free-tier usage check. DMs every admin
       (as merecat, an Automated notice) when a meter crosses 80% or its
       ceiling; no-ops until the CF_USAGE_TOKEN secret is set. */
    if (event && event.cron === '30 23 * * *') {
      ctx.waitUntil(runUsageCheck(env));
      return;
    }
    ctx.waitUntil(
      sweepExpiredDms(env)
        .then(() => pruneIdentityIps(env))
        .then(() => pruneComments(env))
        .then(() => sweepJournalComments(env))
        .then(() => sweepDms(env))
        .then(() => sweepCalls(env))
        .then(() => pruneNotifications(env))
        .then(() => pruneMerecatChats(env))
        .then(() => sweepWallOrphanMedia(env))
        .then(() => sweepMediaRetention(env))
        .then(() => enforceWallMediaCap(env))
        .then(() => pruneWallPosts(env))
        .then(() => runBackup(env))
    );
  },
};

