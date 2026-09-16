/* Comments handler. Same-origin API on /api/comments*. A commenter's whole
   account is a random client-side key; the server stores only SHA-256(key),
   so there is nothing here to leak. Turnstile gates every write, the
   rate-limit binding throttles by IP, and Llama Guard screens the text
   (flagged or unscreenable comments are held pending, never dropped).
   The only secret is TURNSTILE_SECRET, the Turnstile server key. */

import * as Merecat from '../../purescript/output/Domain.Merecat/index.js';
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
import * as Media from '../../purescript/output/Domain.Media/index.js';
import * as CallK from '../../purescript/output/Domain.Call/index.js';
import * as MaybeM from '../../purescript/output/Data.Maybe/index.js';
import * as Comments from '../../purescript/output/Domain.Comments/index.js';
// Pure, dependency-free helpers (IP/ban-key normalization + back-room privacy),
// extracted so they can be unit-tested in plain Node. See src/pure.js. (pure.js
// also exports ipv6Groups/ipv6Prefix64/ipv6Full/isSharedV4, used internally
// there or client-side; imported here only what index.js calls directly.)
import {
  ipFamily, ipKey, toBanKey, reverseDnsName, looksLikeIp, boardEventPublic, sanitizeScopes,
} from './pure.js';
// Real Web Push (VAPID + aes128gcm) on crypto.subtle — no external service.
import { createPusher } from './webpush.js';
// Repository layer: bind-placeholder helpers + identity mappers (see db.ts).
import { inList, rankFor, withNames, postCountsFor } from './db.ts';

/* Keyed-request preamble, single-sourced. Parse the JSON body, rate-limit by IP
   on `bucket`, then require + hash the identity key. Returns the resolved
   {ip, data, key, me} or a Response to return early. `keyedGated` adds the
   blocked-identity gate (a locked/banned hash is refused). These replicate,
   verbatim, the preamble that used to open each keyed handler. */

import {
  ADMIN_CAT,
  APP_SETTING_DEFAULTS,
  AVATAR_MAX,
  AVATAR_MIN,
  BACKUP_KEEP_DAYS,
  BOARD_CATS,
  CAT_META,
  CONTROL_RE,
  DEFAULT_ORIGINS,
  DELETED_KEEP_DAYS,
  DM_CLEARED,
  DM_ENC_MAX,
  DM_PER_PAGE,
  DM_TTLS,
  DM_VIS,
  dmThreadFor, ensurePairThread, dmCurrentMembers, dmRecipients, dmMembersPayload, dmPairRoomRows, dmPubkeysOf, dmMediaReadable, releaseMediaRefs, dmPairKey,
  dmGroupName, dmEligible, sendSystemDmLine,
  EMOJI_PACKS,
  FAITHS,
  FAITH_LABELS,
  IP_KEEP_DAYS,
  IP_SHOW_DAYS,
  MAX_AVATAR_BYTES,
  MAX_BIO,
  MAX_BODY,
  MAX_NICK,
  MAX_SIG,
  MAX_TITLE,
  MERECAT_BIBLE,
  MERECAT_BOT,
  MERECAT_CHAT_DAYS,
  MERECAT_DEFAULTS,
  MERECAT_FOLD_MIN,
  MERECAT_KJV2DR,
  MERECAT_MENTION_RE,
  MERECAT_RESTING,
  MERECAT_RV,
  MERECAT_SITE,
  MERECAT_TIER_LABEL,
  MERECAT_WINDOW,
  MetaAttr,
  NAMED_EMOJI,
  NOTIFICATIONS_KEEP_DAYS,
  NOTIF_PER_PAGE,
  PAGES,
  SEARCH_PER_PAGE,
  SITE,
  TOPICS_PER_PAGE,
  TitleText,
  WALL_COMMENT_COLS,
  WALL_MEDIA_RE,
  WALL_PER_PAGE,
  WALL_POST_COLS,
  allowedOrigins,
  appSettingsCache,
  be16,
  blockedJson,
  blockedReason,
  boardCatPayload,
  boardFloor,
  boardKey,
  commentsJournalOn,
  commentsPageOn,
  commentsPagesOn,
  broadcastBoard,
  buildMatch,
  cacheHeader,
  cleanFaith,
  cleanField,
  deliverNotifications,
  deliverPush,
  deliverWallNotifications,
  displayName,
  dmBackstopSeconds,
  dmDefaultTtl,
  dmLive,
  dmUnreadCount,
  dumpDatabase,
  enc,
  discordSnippet,
  enforceMediaCap,
  enforceWallMediaCap,
  ensureAdminsSeeded,
  getAppSettings,
  isEstablished,
  mediaAudioSeconds,
  mediaKindMax,
  mediaKindsFor,
  mediaMaxAcross,
  mediaScanEnabled,
  mediaVoiceEnabled,
  socialEnabled,
  turnstileSkipEstablished,
  gzipBytes,
  isAdminHash,
  isDiscordWebhook,
  parseFeedScope,
  scopeLabel,
  isTrusted,
  journalArticle,
  journalKey,
  journalKeyId,
  json,
  keyed,
  keyedGated,
  merecatConfig,
  merecatConfigCache,
  merecatDay,
  merecatEnsureProfile,
  merecatReasoningView,
  merecatFinishAnswer,
  merecatFold,
  merecatInsertComment,
  merecatMatch,
  merecatMentionReply,
  merecatMentioned,
  merecatNames,
  merecatPhrases,
  merecatPrompt,
  merecatQuota,
  merecatRetrieve,
  merecatScrub,
  merecatVerseSeats,
  metaForHash,
  normalizeLinks,
  normalizePage,
  ringCall,
  notifyMissedCall,
  recordMissedCall,
  recordCallEnd,
  sweepCalls,
  notifyDm,
  notifyEnabled,
  notifyPrefsFor,
  notifyReact,
  retractReactNotif,
  reactionOf,
  reactionsFor,
  myReactionsFor,
  stampReactions,
  isReactTarget,
  NOTIF_POST_KINDS,
  NOTIF_WALL_KINDS,
  originOk,
  parseOS,
  pruneComments,
  pruneIdentityIps,
  pruneMerecatChats,
  pruneNotifications,
  pruneWallPosts,
  ptrLookup,
  publishBoardEvents,
  publishLive,
  publishUser,
  quotaPublic,
  purgeMediaKeys,
  purgeWallMedia,
  randomHex,
  recordIps,
  refreshTopicStats,
  requireAdmin,
  requireIngest,
  rootAdmins,
  shadowExcl,
  isShadowBanned,
  runBackup,
  dmReaction,
  runWallPrune,
  safeParseLinks,
  screen,
  screenImage,
  sendDiscord,
  sendSystemDm,
  sendToHub,
  sha256hex,
  siteBase,
  sniffImage,
  sqlLit,
  sweepDms,
  sweepExpiredDms,
  sweepMediaRetention,
  sweepJournalComments,
  sweepWallOrphanMedia,
  topicViewPayload,
  verifyTurnstile,
  viewLink,
  wallClaimMedia,
  wallEnrich,
  wallReader,
  xmlEscape,
  deliverDiscordFeedHooks,
  noSuchPage,
  notifHideWall,
  notifHideWallSql,
  notifUnreadCount,
  notifyDiscordFeed,
  notifyDiscordFeedComment,
  notifyDiscordForum,
  socialOff,
} from './lib.ts';
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
  merecatMentionKick,
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

interface Env {
  [key: string]: any;
}

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

/* Admin platform settings: read them (with the current media usage), and set the
   tunable ones with sanity clamps. The growing home for site-wide toggles. */
async function handleAdminSettings(request: any, env: any) {
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  const key = String(data.key || '');
  if (!(await requireAdmin(env, key))) return json({ ok: false, error: 'No.' }, 403);
  if (data.set && typeof data.set === 'object') {
    const now = Math.floor(Date.now() / 1000);
    const me = await sha256hex(key);
    const allowed: any = { media_enabled: 1, media_max_bytes: 1, dm_default_ttl: 1, dm_backstop_days: 1, wall_prune_enabled: 1, wall_prune_days: 1, discord_forum_webhook: 1, discord_feed_webhook: 1, discord_feed_comments: 1, journal_topic: 1, journal_enabled: 1, comments_pages: 1, comments_journal: 1,
      media_image_max_bytes: 1, media_video_max_bytes: 1, media_audio_max_bytes: 1, media_audio_max_seconds: 1,
      media_kinds_dm: 1, media_kinds_wall: 1, media_kinds_board: 1, media_image_autocompress: 1,
      media_cap_dm_bytes: 1, media_cap_wall_bytes: 1, media_cap_board_bytes: 1,
      media_scan_wall: 1, media_scan_board: 1, media_voice_dm: 1, media_voice_wall: 1, media_voice_board: 1,
      media_wall_retention_days: 1, media_board_retention_days: 1, media_dm_retention_days: 1,
      media_dm_image_max_bytes: 1, media_dm_video_max_bytes: 1, media_dm_audio_max_bytes: 1,
      media_wall_image_max_bytes: 1, media_wall_video_max_bytes: 1, media_wall_audio_max_bytes: 1,
      media_board_image_max_bytes: 1, media_board_video_max_bytes: 1, media_board_audio_max_bytes: 1,
      media_audio_max_seconds_dm: 1, media_audio_max_seconds_wall: 1, media_audio_max_seconds_board: 1,
      calls_enabled: 1, calls_turn: 1, calls_idle_hangup: 1, calls_idle_seconds: 1,
      social_enabled: 1, turnstile_skip_established: 1 };
    /* The 12 per-section OVERRIDE keys: an EMPTY value deletes the stored row —
       back to "inherit the legacy global" — because absence is what the
       fallback chain reads. Without this the chain would be one-way. */
    const overrideKeys: any = {
      media_dm_image_max_bytes: 1, media_dm_video_max_bytes: 1, media_dm_audio_max_bytes: 1,
      media_wall_image_max_bytes: 1, media_wall_video_max_bytes: 1, media_wall_audio_max_bytes: 1,
      media_board_image_max_bytes: 1, media_board_video_max_bytes: 1, media_board_audio_max_bytes: 1,
      media_audio_max_seconds_dm: 1, media_audio_max_seconds_wall: 1, media_audio_max_seconds_board: 1 };
    const stmts = [];
    for (const k of Object.keys(data.set)) {
      if (!allowed[k]) continue;
      let v = String(data.set[k]);
      if (overrideKeys[k] && v.trim() === '') {
        stmts.push(env.DB.prepare('DELETE FROM app_settings WHERE k = ?1').bind(k));
        continue;
      }
      if (k === 'media_enabled' || k === 'wall_prune_enabled' || k === 'media_image_autocompress'
        || k === 'media_scan_wall' || k === 'media_scan_board'
        || k === 'media_voice_dm' || k === 'media_voice_wall' || k === 'media_voice_board'
        || k === 'calls_enabled' || k === 'calls_turn' || k === 'calls_idle_hangup'
        || k === 'social_enabled' || k === 'turnstile_skip_established' || k === 'comments_journal') v = (v === '1' || v === 'true') ? '1' : '0';
      else if (k === 'calls_idle_seconds') v = String(CallK.idleClampSecs(Math.floor(Number(v)) || CallK.idleDefaultSecs));
      else if (k === 'media_max_bytes') v = String(Math.max(65536, Math.min(100 * 1024 * 1024, Math.floor(Number(v)) || (25 * 1024 * 1024))));
      /* Per-kind caps, the recorder stop, the store budgets, the retention
         windows, and the context kinds masks all clamp/normalize through the
         Domain.Media kernel — the same rules the client reads via mcCore,
         single-sourced. An empty kinds mask is legal (= that context's uploads
         are off). NOTE the retention clamps use `|| 0`, NOT a defaults
         fallback: 0 is a legal, meaningful value (keep forever). */
      else if (k === 'media_image_max_bytes' || k === 'media_video_max_bytes' || k === 'media_audio_max_bytes') v = String(Media.clampKindBytes(Math.floor(Number(v)) || Number((APP_SETTING_DEFAULTS as any)[k])));
      else if (overrideKeys[k] && k.indexOf('_max_bytes') !== -1) {
        /* Garbage input on a per-section byte override falls back to ITS kind's
           legacy global default (the key ends media_<ctx>_<kind>_max_bytes). */
        const kindWord = k.split('_').slice(-3)[0];
        v = String(Media.clampKindBytes(Math.floor(Number(v)) || Number((APP_SETTING_DEFAULTS as any)['media_' + kindWord + '_max_bytes']) || Number(APP_SETTING_DEFAULTS.media_image_max_bytes)));
      }
      else if (k === 'media_audio_max_seconds' || k.indexOf('media_audio_max_seconds_') === 0) v = String(Media.clampAudioSeconds(Math.floor(Number(v)) || Number(APP_SETTING_DEFAULTS.media_audio_max_seconds)));
      else if (k === 'media_cap_dm_bytes' || k === 'media_cap_wall_bytes' || k === 'media_cap_board_bytes') v = String(Media.clampCapBytes(Math.floor(Number(v)) || Number((APP_SETTING_DEFAULTS as any)[k])));
      else if (k === 'media_wall_retention_days' || k === 'media_board_retention_days') v = String(Media.clampRetentionDays(Math.floor(Number(v)) || 0));
      else if (k === 'media_dm_retention_days') v = String(Media.clampDmRetentionDays(Math.floor(Number(v)) || Number(APP_SETTING_DEFAULTS.media_dm_retention_days)));
      else if (k === 'media_kinds_dm' || k === 'media_kinds_wall' || k === 'media_kinds_board') v = Media.serializeKinds(Media.parseKinds(v));
      else if (k === 'dm_default_ttl') v = String(DM_TTLS.indexOf(Math.floor(Number(v))) !== -1 ? Math.floor(Number(v)) : Dm.defaultTtl);
      else if (k === 'dm_backstop_days') v = String(Math.max(1, Math.min(365, Math.floor(Number(v)) || 30)));
      else if (k === 'wall_prune_days') v = String(Wall.clampPruneDays(Math.floor(Number(v)) || 365));
      else if (k === 'journal_enabled' || k === 'discord_feed_comments') v = (v === '1' || v === 'true') ? '1' : '0';
      else if (k === 'journal_topic') v = String(Math.max(0, Math.floor(Number(v)) || 0));
      /* The open-sections list is re-parsed through the kernel: only the site's
         own writings survive, deduped, canonical order — a path that is not
         commentable can never be stored as open. */
      else if (k === 'comments_pages') v = Comments.serializeEnabledPages(Comments.parseEnabledPages(v));
      else if (k === 'discord_forum_webhook' || k === 'discord_feed_webhook') {
        /* Empty clears (turns the webhook off); anything else must be a genuine
           Discord webhook URL, so a typo or hostile value is never stored/POSTed. */
        v = v.trim();
        if (v && !isDiscordWebhook(v)) return json({ ok: false, error: 'That is not a valid Discord webhook URL.' }, 400);
      }
      stmts.push(env.DB.prepare(
        'INSERT INTO app_settings (k, v, updated_at, updated_by) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(k) DO UPDATE SET v = ?2, updated_at = ?3, updated_by = ?4'
      ).bind(k, v, now, me));
    }
    if (stmts.length) { await env.DB.batch(stmts); appSettingsCache.at = 0; appSettingsCache.s = null; }
  }
  const settings = await getAppSettings(env);
  return json({ ok: true, settings, ttls: DM_TTLS, wall_prune_options: Wall.pruneDayOptions }, 200);
}

/* ================= Per-feed Discord subscriptions (admin CRUD) =================
   Admin-only. A subscription maps one of our feed URLs (parsed to a scope) to a
   Discord channel webhook; deliverDiscordFeedHooks fires it on a matching live
   post. Both the feed URL and the webhook URL are validated before storage — the
   webhook by isDiscordWebhook (the SSRF gate), the feed by parseFeedScope (only
   our own /api/comments/feed, only a real selector). */
async function handleAdminDiscordList(request: any, env: any) {
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  const key = String(data.key || '');
  if (!(await requireAdmin(env, key))) return json({ ok: false, error: 'No.' }, 403);
  const rows = await env.DB.prepare(
    'SELECT id, scope, feed_url, hook_url, label, created_at FROM discord_hooks ORDER BY id DESC'
  ).all();
  const hooks = ((rows && rows.results) || []).map((h: any) => ({
    id: h.id, scope: h.scope, scope_label: scopeLabel(h.scope), feed_url: h.feed_url,
    /* Never echo the full webhook (it is a bearer secret); a masked tail is
       enough for an admin to tell two subscriptions apart. */
    hook_hint: maskWebhook(h.hook_url), label: h.label || '', created_at: h.created_at,
  }));
  return json({ ok: true, hooks }, 200);
}

async function handleAdminDiscordAdd(request: any, env: any) {
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  const key = String(data.key || '');
  if (!(await requireAdmin(env, key))) return json({ ok: false, error: 'No.' }, 403);
  const feedUrl = String(data.feed_url || '').trim();
  const hookUrl = String(data.hook_url || '').trim();
  const label = String(data.label || '').trim().slice(0, 120);
  const scope = parseFeedScope(feedUrl);
  if (!scope) return json({ ok: false, error: 'That is not one of our feed URLs. Paste a /api/comments/feed link with a ?topic=, ?cat=, or ?page= selector.' }, 400);
  if (!isDiscordWebhook(hookUrl)) return json({ ok: false, error: 'That is not a valid Discord webhook URL.' }, 400);
  const now = Math.floor(Date.now() / 1000);
  const me = await sha256hex(key);
  /* An exact (scope + webhook) pair twice is pointless; refuse the duplicate. */
  const dup = await env.DB.prepare('SELECT id FROM discord_hooks WHERE scope = ?1 AND hook_url = ?2').bind(scope, hookUrl).first();
  if (dup) return json({ ok: false, error: 'That feed already posts to that Discord channel.' }, 409);
  await env.DB.prepare(
    'INSERT INTO discord_hooks (scope, feed_url, hook_url, label, created_at, created_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6)'
  ).bind(scope, feedUrl, hookUrl, label || null, now, me).run();
  return json({ ok: true, scope, scope_label: scopeLabel(scope) }, 200);
}

async function handleAdminDiscordDelete(request: any, env: any) {
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  const key = String(data.key || '');
  if (!(await requireAdmin(env, key))) return json({ ok: false, error: 'No.' }, 403);
  const id = Math.floor(Number(data.id) || 0);
  if (id < 1) return json({ ok: false, error: 'Bad request.' }, 400);
  await env.DB.prepare('DELETE FROM discord_hooks WHERE id = ?1').bind(id).run();
  return json({ ok: true, id }, 200);
}

/* Mask a webhook URL for display: keep the host + a short tail of the token,
   hide the id and the rest of the secret. Never returns the full URL. */
function maskWebhook(u: any) {
  const s = String(u || '');
  const m = s.match(/^https:\/\/(discord|discordapp)\.com\/api\/webhooks\/(\d+)\/([A-Za-z0-9_-]+)/);
  if (!m) return 'webhook';
  const tail = m[3].slice(-6);
  return 'discord.com/…/…' + tail;
}

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

async function handleBackup(request: any, env: any) {
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

async function handleLock(request: any, env: any) {
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

/* Shadow ban (global mute), the quiet cousin of lock: on inserts a shadowbans
   row, off deletes it. A muted identity keeps posting (never logged out, never
   refused — this is NOT a blockedReason), but the read paths hide its public
   content from everyone else and the write paths announce nothing on its behalf.
   Refreshing every affected topic's denormalized stats is unnecessary: the read
   filters recompute visibility live, and refreshTopicStats already re-excludes a
   muted author whenever the thread next mutates. Admin-only, like lock. */
async function handleShadowban(request: any, env: any) {
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.READ_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests.' }, 429);
  const key = String(data.key || '');
  const hash = String(data.hash || '');
  if (!/^[0-9a-f]{64}$/.test(hash)) return json({ ok: false, error: 'Bad request.' }, 400);
  if (!(await requireAdmin(env, key))) return json({ ok: false, error: 'No.' }, 403);
  /* Never mute the librarian, and never mute an admin (a mute an admin can't
     see would be a foot-gun); the roster stays legible. */
  if (hash === MERECAT_BOT.hash || (await isAdminHash(env, hash))) {
    return json({ ok: false, error: 'That identity cannot be shadow banned.' }, 400);
  }
  const on = !!(data.on === true || data.on === 1 || data.on === '1' || data.shadowbanned);
  if (on) {
    await env.DB.prepare('INSERT OR IGNORE INTO shadowbans (hash, created_at, added_by) VALUES (?1, ?2, ?3)')
      .bind(hash, Math.floor(Date.now() / 1000), await sha256hex(key)).run();
  } else {
    await env.DB.prepare('DELETE FROM shadowbans WHERE hash = ?1').bind(hash).run();
  }
  return json({ ok: true, shadowbanned: on }, 200);
}

/* The whole shadow-ban roster, for the management page on admin.html (the twin
   of the IP ban list). Admin-only. Each row carries the muted identity's
   assigned/chosen name and when it was muted, so an admin can lift a mute
   without hunting for the post that set it. */
async function handleShadowbanList(request: any, env: any) {
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  if (!(await requireAdmin(env, String(data.key || '')))) return json({ ok: false, error: 'No.' }, 403);
  const rows = await env.DB.prepare(
    'SELECT s.hash, s.created_at, pr.nick FROM shadowbans s LEFT JOIN profiles pr ON pr.hash = s.hash ORDER BY s.created_at DESC'
  ).all();
  const bans = (rows.results || []).map((r: any) => ({
    hash: r.hash, nick: r.nick || displayName(r.hash), created_at: r.created_at,
  }));
  return json({ ok: true, bans }, 200);
}

/* Delete a user and all their public posts: comments go to 'deleted', the
   profile and avatar are removed, and the identity is locked so the same key
   cannot post again. Private DMs are left untouched. */
async function handleDeleteUser(request: any, env: any) {
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
  /* Their attachments' bytes go with them (retraction semantics, same as a
     single delete); the hourly sweep is the backstop if this purge fails. */
  try {
    const mk = await env.DB.prepare(
      'SELECT media_key FROM comments WHERE author_hash = ?1 AND media_key IS NOT NULL'
    ).bind(hash).all();
    const keys = (mk.results || []).map((r: any) => r.media_key).filter(Boolean);
    if (keys.length) {
      await purgeWallMedia(env, keys);
      await env.DB.prepare('UPDATE comments SET media_key = NULL, media_size = NULL WHERE author_hash = ?1').bind(hash).run();
    }
  } catch (e) { /* the sweep reclaims it */ }
  await env.DB.prepare("UPDATE comments SET status = 'deleted' WHERE author_hash = ?1 AND status != 'deleted'")
    .bind(hash).run();
  /* Their FEED goes with them too (2026-09-12; the feed came after this
     handler and had been left out): every post of theirs — with the comments
     under it, everyone's — and every comment of theirs under others' posts,
     hard-deleted the way /wall/delete deletes, every attachment's bytes purged
     with the rows, the reactions on them gone, and the surviving posts'
     comment counts recomputed. The hourly orphan sweep is the backstop. */
  try {
    const keys: string[] = [];
    const mine = await env.DB.prepare('SELECT id, media_key FROM wall_posts WHERE author_hash = ?1').bind(hash).all();
    const postIds = (mine.results || []).map((r: any) => r.id);
    (mine.results || []).forEach((r: any) => { if (r.media_key) keys.push(r.media_key); });
    if (postIds.length) {
      const ph = inList(postIds.length);
      const under = await env.DB.prepare('SELECT media_key FROM wall_comments WHERE post_id IN (' + ph + ') AND media_key IS NOT NULL').bind(...postIds).all();
      (under.results || []).forEach((r: any) => { if (r.media_key) keys.push(r.media_key); });
      await env.DB.prepare("DELETE FROM reactions WHERE target = 'wallc' AND target_id IN (SELECT id FROM wall_comments WHERE post_id IN (" + ph + '))').bind(...postIds).run();
      await env.DB.prepare('DELETE FROM wall_comments WHERE post_id IN (' + ph + ')').bind(...postIds).run();
      await env.DB.prepare("DELETE FROM reactions WHERE target = 'wall' AND target_id IN (" + ph + ')').bind(...postIds).run();
      await env.DB.prepare('DELETE FROM wall_posts WHERE id IN (' + ph + ')').bind(...postIds).run();
    }
    const theirs = await env.DB.prepare('SELECT id, post_id, media_key FROM wall_comments WHERE author_hash = ?1').bind(hash).all();
    const cIds = (theirs.results || []).map((r: any) => r.id);
    const touched = [...new Set((theirs.results || []).map((r: any) => r.post_id))];
    (theirs.results || []).forEach((r: any) => { if (r.media_key) keys.push(r.media_key); });
    if (cIds.length) {
      const ph2 = inList(cIds.length);
      await env.DB.prepare("DELETE FROM reactions WHERE target = 'wallc' AND target_id IN (" + ph2 + ')').bind(...cIds).run();
      await env.DB.prepare('DELETE FROM wall_comments WHERE id IN (' + ph2 + ')').bind(...cIds).run();
    }
    for (let i = 0; i < touched.length; i += 50) {
      const chunk = touched.slice(i, i + 50);
      await env.DB.prepare("UPDATE wall_posts SET comments = (SELECT COUNT(*) FROM wall_comments WHERE post_id = wall_posts.id AND status = 'live') WHERE id IN (" + inList(chunk.length) + ')').bind(...chunk).run();
    }
    if (keys.length) await purgeWallMedia(env, keys);
  } catch (e) { console.log(JSON.stringify({ event: 'delete_user_feed_failed', hash, error: String(e) })); }
  /* Any journal article of theirs is deleted now, so its comments retire too. */
  await sweepJournalComments(env);
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
async function handleIpBan(request: any, env: any) {
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
async function handleRdns(request: any, env: any) {
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.READ_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests.' }, 429);
  if (!(await requireAdmin(env, String(data.key || '')))) return json({ ok: false, error: 'No.' }, 403);
  const ips = Array.isArray(data.ips) ? data.ips.slice(0, 8) : [];
  const rdns: any = {};
  await Promise.all(ips.map(async (raw: any) => {
    const s = String(raw || '').trim();
    if (looksLikeIp(s)) rdns[s] = await ptrLookup(s);
  }));
  return json({ ok: true, rdns }, 200);
}

/* The banned-IP list for the admin page. */
async function handleIpBans(request: any, env: any) {
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.READ_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests.' }, 429);
  if (!(await requireAdmin(env, String(data.key || '')))) return json({ ok: false, error: 'No.' }, 403);
  const rows = await env.DB.prepare('SELECT ip, created_at FROM ip_bans ORDER BY created_at DESC LIMIT 1000').all();
  return json({ ok: true, ips: rows.results }, 200);
}

/* The admin roster for the console: every admin, equal, each removable, carried
   with the name they post under so the list reads in people, not hashes. Seeded
   from the env owners on first view so they appear as ordinary rows. */
async function handleAdmins(request: any, env: any) {
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.READ_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests.' }, 429);
  if (!(await requireAdmin(env, String(data.key || '')))) return json({ ok: false, error: 'No.' }, 403);
  await ensureAdminsSeeded(env);
  const dyn = await env.DB.prepare('SELECT hash, created_at FROM admins ORDER BY created_at, hash').all();
  const list = (dyn.results || []).map((r: any) => ({ hash: r.hash, created_at: r.created_at }));
  /* Resolve each admin's chosen nick in one query; the assigned pseudonym is
     pure from the hash, so it fills the rest. */
  if (list.length) {
    const ph = inList(list.length);
    const rows = await env.DB.prepare('SELECT hash, nick FROM profiles WHERE hash IN (' + ph + ')')
      .bind(...list.map((a: any) => a.hash)).all();
    const nick: any = {};
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
async function handleAdmin(request: any, env: any) {
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

