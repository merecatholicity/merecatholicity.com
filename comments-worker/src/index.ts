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
import * as Handle from '../../purescript/output/Domain.Handle/index.js';
import * as Links from '../../purescript/output/Domain.Links/index.js';
import * as Wall from '../../purescript/output/Domain.Wall/index.js';
import * as Prefs from '../../purescript/output/Domain.Prefs/index.js';
import * as Media from '../../purescript/output/Domain.Media/index.js';
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
import { inList, rankFor, withNames, postCountsFor } from './db.js';

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
  dmPair,
  dmUnreadExists,
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
  gzipBytes,
  isAdminHash,
  isDiscordWebhook,
  parseFeedScope,
  scopeLabel,
  isTrusted,
  journalArticle,
  json,
  keyed,
  keyedGated,
  merecatConfig,
  merecatConfigCache,
  merecatDay,
  merecatEnsureProfile,
  merecatFinishAnswer,
  merecatFold,
  merecatInsertComment,
  merecatLocalFetch,
  merecatLocalRead,
  merecatMatch,
  merecatMentionReply,
  merecatMentioned,
  merecatNames,
  merecatPhrases,
  merecatPrompt,
  merecatRetrieve,
  merecatScrub,
  merecatThinkStripper,
  merecatVerseSeats,
  metaForHash,
  normalizeLinks,
  normalizePage,
  notifyDm,
  notifyEnabled,
  notifyPrefsFor,
  notifyWallLike,
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
  purgeMediaKeys,
  purgeWallMedia,
  randomHex,
  recordIps,
  refreshTopicStats,
  requireAdmin,
  rootAdmins,
  shadowExcl,
  isShadowBanned,
  runBackup,
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
  sweepWallOrphanMedia,
  topicViewPayload,
  verifyTurnstile,
  viewLink,
  wallClaimMedia,
  wallEnrich,
  wallReader,
  xmlEscape,
} from './lib.js';

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

async function handleGet(request: any, env: any, url: any) {
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.READ_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests. Slow down.' }, 429);
  const page = normalizePage(url.searchParams.get('page'));
  if (!page) return json({ ok: false, error: 'Unknown page.' }, 400);
  const rows = await env.DB.prepare(
    'SELECT c.id, c.author_hash, pr.nick, pr.signature, pr.avatar, pr.faith, c.body, c.created_at, c.edited_at ' +
    'FROM comments c LEFT JOIN profiles pr ON pr.hash = c.author_hash ' +
    "WHERE c.page = ?1 AND c.status = 'live' AND " + shadowExcl('c') + " ORDER BY c.id LIMIT 500"
  ).bind(page).all();
  const counts = await postCountsFor(env, (rows.results || []).map((r: any) => r.author_hash));
  const comments = (rows.results || []).map((r: any) => withNames(r, counts[r.author_hash] || 0));
  return json({ ok: true, anon: env.ALLOW_ANON === 'true', comments: comments }, 200,
    cacheHeader(url));
}

/* Announce a fresh LIVE forum post to Discord, if a forum webhook is configured.
   Topics and replies both go (the message distinguishes them); the back room is
   NEVER announced (the caller excludes it). Reads the topic title for a reply so
   the embed can say what thread it landed in. Fire-and-forget: any failure is
   swallowed, so Discord being down or misconfigured never touches the post. */
async function notifyDiscordForum(env: any, p: {
  page: string; commentId: number; topicId: number; isReply: boolean;
  title: any; authorHash: any; nick: any; body: any; hasMedia?: boolean; createdAt: number;
}) {
  const s = await getAppSettings(env);
  const hook = s.discord_forum_webhook;
  if (!isDiscordWebhook(hook)) return;
  let topicTitle = p.title;
  if (p.isReply || !topicTitle) {
    const t = await env.DB.prepare('SELECT title FROM comments WHERE id = ?1').bind(p.topicId).first();
    topicTitle = (t && t.title) || 'a thread';
  }
  const name = p.nick || displayName(p.authorHash);
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
async function notifyDiscordFeed(env: any, p: {
  postId: number; authorHash: string; body: string;
  hasMedia: boolean; createdAt: number;
}) {
  const s = await getAppSettings(env);
  const hook = s.discord_feed_webhook;
  if (!isDiscordWebhook(hook)) return;
  const prof = await env.DB.prepare('SELECT nick FROM profiles WHERE hash = ?1').bind(p.authorHash).first();
  const name = (prof && prof.nick) || displayName(p.authorHash);
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
async function notifyDiscordFeedComment(env: any, p: {
  postId: number; authorHash: string; body: string; createdAt: number;
}) {
  const s = await getAppSettings(env);
  const hook = s.discord_feed_webhook;
  if (s.discord_feed_comments !== '1' || !isDiscordWebhook(hook)) return;
  const prof = await env.DB.prepare('SELECT nick FROM profiles WHERE hash = ?1').bind(p.authorHash).first();
  const name = (prof && prof.nick) || displayName(p.authorHash);
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
async function deliverDiscordFeedHooks(env: any, p: {
  commentId: number; parentId: any; page: string; isReply: boolean;
  title: any; authorHash: any; nick: any; body: any; hasMedia: boolean; createdAt: number;
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
  ).bind(...scopes).all();
  const hooks = (rows && rows.results) || [];
  if (!hooks.length) return;
  const name = p.nick || (p.authorHash ? displayName(p.authorHash) : 'Anonymous');
  const isBoard = boardKey(p.page);
  let topicTitle = p.title;
  if (isBoard && (p.isReply || !topicTitle)) {
    const t = await env.DB.prepare('SELECT title FROM comments WHERE id = ?1').bind(topicId).first();
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
    .filter((h: any) => { if (seen.has(h.hook_url)) return false; seen.add(h.hook_url); return true; })
    .map((h: any) => sendDiscord(h.hook_url, {
      title: (isBoard ? (topicTitle || 'New forum post') : 'New comment').slice(0, 240),
      url: link,
      description: discordSnippet(p.body) || (p.hasMedia ? '(shared an attachment)' : (p.isReply ? '(reply)' : '')),
      author: { name: heading.slice(0, 240) },
      color: 0x7a1f2b,
      footer: { text: 'Mere Catholicity · ' + scopeLabel(h.scope) },
      timestamp: new Date(p.createdAt * 1000).toISOString(),
    }).catch((e: any) => console.log(JSON.stringify({ event: 'discord_hook_failed', id: h.id, error: String(e) }))));
  await Promise.all(jobs);
}

async function handlePost(request: any, env: any, ctx: any) {
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
  let topicReadonly = false;
  if (data.topic != null) {
    const topicId = Number(data.topic);
    if (!Number.isInteger(topicId) || topicId < 1) return json({ ok: false, error: 'Bad request.' }, 400);
    const topic = await env.DB.prepare(
      "SELECT id, page, locked, COALESCE(readonly, 0) AS readonly, author_hash FROM comments WHERE id = ?1 AND parent_id IS NULL AND status = 'live'"
    ).bind(topicId).first();
    if (!topic || !boardKey(topic.page)) return json({ ok: false, error: 'No such topic.' }, 404);
    if (topic.locked) return json({ ok: false, error: 'This topic is locked.' }, 403);
    page = topic.page;
    parentId = topic.id;
    topicAuthorHash = topic.author_hash;
    topicReadonly = !!topic.readonly;   // gated below, once the author's admin status is known
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
  /* An optional attachment — board topics and replies only in v1: never an
     article page (no render surface there yet) and never the back room (no
     board media key may EVER be back-room-linked, which is what lets the public
     media GET stay keyless). Claimed before Turnstile like the wall's, and
     validated against the BOARD mask + per-kind caps AT CLAIM TIME — the upload
     context cannot be trusted, since an upload does not know its destination. */
  let media: any = null;
  if (String(data.media_key || '')) {
    if (!boardKey(page)) return json({ ok: false, error: 'Attachments live on the forum only.' }, 400);
    if (page === ADMIN_CAT) return json({ ok: false, error: 'No attachments in this room.' }, 400);
    const settings = await getAppSettings(env);
    media = await wallClaimMedia(env, data.media_key, mediaKindsFor(settings, 'board'), settings, 'board');
    if (!media) return json({ ok: false, error: 'That attachment is gone, too large, or not allowed here.' }, 400);
  }
  if (!body && !media) return json({ ok: false, error: 'The comment is empty.' }, 400);
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

  /* Shadow ban (global mute): a muted author posts normally (this succeeds, the
     row stores live), but nothing about the post reaches anyone else — no live
     broadcast, no notification/mention, no Discord, no @merecat. The read paths
     hide the post itself; these gates keep it from ANNOUNCING itself. They are
     never told they are muted. */
  const muted = authorHash ? await isShadowBanned(env, authorHash) : false;

  /* The back room: writing anywhere in it — a topic or a reply — needs an
     admin identity. The public can neither see it nor post into it. */
  if (page === ADMIN_CAT && !(await isAdminHash(env, authorHash))) {
    return json({ ok: false, error: 'That room is for admins only.' }, 403);
  }

  /* A read-only topic accepts replies from admins alone (the Journal is one).
     Unlike lock, which closes a thread to everyone, this keeps admins posting. */
  if (topicReadonly && !(await isAdminHash(env, authorHash))) {
    return json({ ok: false, error: 'This topic is read-only.' }, 403);
  }

  /* A topic's title is screened with its body, one judgment for the pair. A
     media-only post screens the wall's '(media post)' placeholder. */
  const screenText = body || '(media post)';
  const { status, verdict } = await screen(env, title ? title + '\n\n' + screenText : screenText,
    await isTrusted(env, authorHash));
  const createdAt = Math.floor(Date.now() / 1000);
  const inserted = await env.DB.prepare(
    'INSERT INTO comments (page, parent_id, title, author_hash, body, status, created_at, ai_verdict, ip, ua, os, tz, lang, media_key, media_size) ' +
    'VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15) RETURNING id'
  ).bind(page, parentId, title, authorHash, body, status, createdAt, verdict, ip || null, ua || null, os || null,
    tz || null, lang || null, media ? media.key : null, media ? media.size : null).first();

  /* Link the attachment as ref_type 'board' ('comment' means a WALL comment —
     the two id spaces are unrelated). The ref_id IS NULL guard closes the
     double-claim race: when two concurrent posts claim one upload, the loser
     silently carries no media. */
  if (media) {
    const link = await env.DB.prepare(
      "UPDATE wall_media SET ref_type = 'board', ref_id = ?1, ctx = 'board' WHERE key = ?2 AND ref_id IS NULL"
    ).bind(inserted.id, media.key).run();
    if (!link.meta || !link.meta.changes) {
      media = null;
      await env.DB.prepare('UPDATE comments SET media_key = NULL, media_size = NULL WHERE id = ?1').bind(inserted.id).run();
    }
  }

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
     Deferred so a wide fan-out never delays the poster's response. A muted
     author notifies no one — else the notification would point at a post the
     recipient cannot find, betraying the mute. */
  if (boardKey(page) && !muted) {
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
  if (status === 'live' && !muted && authorHash && authorHash !== MERECAT_BOT.hash &&
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
  if (status === 'live' && !muted) {
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
            faith: prof && prof.faith || null, body, created_at: createdAt,
            media_key: media ? media.key : null } },
        { v: 1, t: 'topic-stats', scopes: ['cat:' + catKey, 'board:index'], cat: catKey,
          topic_id: topicId, title: (stat && stat.title) || null, replies: (stat && stat.replies) || 0,
          last: createdAt, last_id: inserted.id, author_hash: authorHash, nick },
      ];
    });
  }

  /* Mirror a live forum post to Discord if a forum webhook is configured — topics
     and replies both, never the back room. Deferred so a webhook never delays the
     poster's response. */
  if (status === 'live' && !muted && boardKey(page) && page !== ADMIN_CAT) {
    ctx.waitUntil(notifyDiscordForum(env, {
      page, commentId: inserted.id, topicId: parentId || inserted.id, isReply: parentId != null,
      title, authorHash, nick: prof && prof.nick || null, body, hasMedia: !!media, createdAt,
    }).catch((e) => console.log(JSON.stringify({ event: 'discord_forum_failed', error: String(e) }))));
  }

  /* Fan a live post out to any matching PER-FEED Discord subscription (board
     topics/replies AND article-page comments; never the back room). */
  if (status === 'live' && !muted && page !== ADMIN_CAT) {
    ctx.waitUntil(deliverDiscordFeedHooks(env, {
      commentId: inserted.id, parentId, page, isReply: parentId != null,
      title, authorHash, nick: prof && prof.nick || null, body, hasMedia: !!media, createdAt,
    }).catch((e) => console.log(JSON.stringify({ event: 'discord_hooks_failed', error: String(e) }))));
  }

  return json({ ok: true, status, comment: { id: inserted.id, title, author_hash: authorHash,
    nick: prof && prof.nick || null, signature: prof && prof.signature || null, avatar: prof && prof.avatar || null,
    faith: prof && prof.faith || null,
    body, created_at: createdAt, media_key: media ? media.key : null } }, 200);
}

/* Fan notifications out from a fresh board post. The author always comes to
   watch the thread (even a held post, so approval finds them already subscribed).
   Only a live post tells anyone: each validated @mention gets a 'mention', and a
   reply gives the topic author and every watcher a 'reply', minus the replier and
   anyone already mentioned so no one is told twice for one post. One batch write. */
/* Batch-load the per-type notification prefs for a set of recipients. A member
   with no profile row (or a NULL column) keeps the default (on). */
async function handlePushRegister(request: any, env: any) {
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
async function handlePushUnregister(request: any, env: any) {
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

/* Serve the VAPID public key so the client can call pushManager.subscribe with it
   as the applicationServerKey. The value is public by design (it is in every push
   subscription); cacheable like the other constant reads. Rotating the keypair
   means swapping this var + the VAPID_PRIVATE_KEY secret; an already-subscribed
   client re-subscribes with the new key on its next Settings open (_reflectPush
   compares this against its subscription's key). */
async function handleVapidKey(request: any, env: any, url: any) {
  return json({ ok: true, key: String(env.VAPID_PUBLIC_KEY || '') }, 200, cacheHeader(url));
}

async function handleSelfDelete(request: any, env: any, ctx: any) {
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
        "UPDATE comments SET status = 'deleted' WHERE id = ?1 AND status != 'deleted' RETURNING page, parent_id, media_key"
      ).bind(id).first()
    : await env.DB.prepare(
        "UPDATE comments SET status = 'deleted' WHERE id = ?1 AND author_hash = ?2 AND status != 'deleted' RETURNING page, parent_id, media_key"
      ).bind(id, authorHash).first();
  if (!row) return json({ ok: false, error: 'Not yours, or already gone.' }, 403);
  /* Retraction semantics: the attachment's bytes go NOW, not at the row's
     30-day hard prune (the soft-deleted text row never renders anyway). The
     hourly board orphan sweep is the backstop if this purge fails. */
  if (row.media_key) {
    try {
      await purgeWallMedia(env, [row.media_key]);
      await env.DB.prepare('UPDATE comments SET media_key = NULL, media_size = NULL WHERE id = ?1').bind(id).run();
    } catch (e) { /* the sweep reclaims it */ }
  }
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

async function handleFeed(request: any, env: any, url: any) {
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
      "SELECT c.id, c.page, c.title FROM comments c WHERE c.id = ?1 AND c.parent_id IS NULL AND c.status = 'live' AND " + shadowExcl('c')
    ).bind(topicParam).first();
    if (!topicRow || !boardKey(topicRow.page) || topicRow.page === ADMIN_CAT) {
      return new Response('No such topic.', { status: 404 });
    }
    page = topicRow.page;
    const rows = await env.DB.prepare(
      "SELECT c.id, c.parent_id, c.title, c.author_hash, pr.nick, c.body, c.created_at FROM comments c " +
      "LEFT JOIN profiles pr ON pr.hash = c.author_hash " +
      "WHERE (c.id = ?1 OR c.parent_id = ?1) AND c.status = 'live' AND " + shadowExcl('c') + " ORDER BY c.id DESC LIMIT 50"
    ).bind(topicParam).all();
    results = rows.results;
  } else {
    page = cat ? boardKey('board:' + cat) : normalizePage(url.searchParams.get('page'));
    if (!page || page === ADMIN_CAT) return new Response('Unknown page.', { status: 400 });
    const rows = await env.DB.prepare(
      "SELECT c.id, c.parent_id, c.title, c.author_hash, pr.nick, c.body, c.created_at FROM comments c " +
      "LEFT JOIN comments pt ON pt.id = c.parent_id " +
      "LEFT JOIN profiles pr ON pr.hash = c.author_hash WHERE c.page = ?1 AND c.status = 'live' AND " + shadowExcl('c') +
      " AND (c.parent_id IS NULL OR " + shadowExcl('pt') + ") ORDER BY c.id DESC LIMIT 50"
    ).bind(page).all();
    results = rows.results;
  }
  const items = results.map(function (c: any) {
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

/* The Mere Catholicity Journal: the posts of one configured forum topic
   (app_settings.journal_topic, default 219) presented as journal articles.
   PUBLIC + cacheable — anyone can read and share an entry — so the admin marks
   that topic read-only to keep members from posting into it. Two shapes:
     ?id=<n>  -> one article (for the shareable journal.html?a=<n> permalink)
     (else)   -> the articles newest-first, paginated (the journal index).
   The topic head and every reply are entries; each body is split into an
   optional leading-heading title + the rest (journalArticle). */
const JOURNAL_PER_PAGE = 6;
async function handleJournal(request: any, env: any, url: any) {
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.READ_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests. Slow down.' }, 429);
  const s = await getAppSettings(env);
  const topicId = Math.floor(Number(s.journal_topic) || 0);
  if (s.journal_enabled !== '1' || topicId < 1) {
    return json({ ok: false, error: 'The journal is not available.' }, 404, cacheHeader(url));
  }
  const topic = await env.DB.prepare(
    "SELECT c.id, c.title, c.body, c.created_at FROM comments c " +
    "WHERE c.id = ?1 AND c.parent_id IS NULL AND c.status = 'live' AND " + shadowExcl('c')
  ).bind(topicId).first();
  if (!topic || !boardKey(await journalTopicPage(env, topicId))) {
    return json({ ok: false, error: 'The journal is not available.' }, 404, cacheHeader(url));
  }
  const artId = Number(url.searchParams.get('id'));
  if (Number.isInteger(artId) && artId > 0) {
    const row = await env.DB.prepare(
      "SELECT c.id, c.author_hash, pr.nick, c.body, c.created_at, c.edited_at FROM comments c " +
      "LEFT JOIN profiles pr ON pr.hash = c.author_hash " +
      "WHERE c.id = ?1 AND (c.id = ?2 OR c.parent_id = ?2) AND c.status = 'live' AND " + shadowExcl('c')
    ).bind(artId, topicId).first();
    if (!row) return json({ ok: false, error: 'No such entry.' }, 404, cacheHeader(url));
    const a = journalArticle(row.body);
    return json({
      ok: true, journal: topic.title,
      article: { id: row.id, title: a.title, body: a.body, author: row.nick || displayName(row.author_hash),
        created_at: row.created_at, edited_at: row.edited_at },
    }, 200, cacheHeader(url));
  }
  const p = Math.min(1000, Math.max(1, Math.floor(Number(url.searchParams.get('p')) || 1)));
  const totalRow = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM comments c WHERE (c.id = ?1 OR c.parent_id = ?1) AND c.status = 'live' AND " + shadowExcl('c')
  ).bind(topicId).first();
  const rows = await env.DB.prepare(
    "SELECT c.id, c.author_hash, pr.nick, c.body, c.created_at, c.edited_at FROM comments c " +
    "LEFT JOIN profiles pr ON pr.hash = c.author_hash " +
    "WHERE (c.id = ?1 OR c.parent_id = ?1) AND c.status = 'live' AND " + shadowExcl('c') +
    " ORDER BY c.id DESC LIMIT ?2 OFFSET ?3"
  ).bind(topicId, JOURNAL_PER_PAGE, (p - 1) * JOURNAL_PER_PAGE).all();
  const articles = (rows.results || []).map((r: any) => {
    const a = journalArticle(r.body);
    return { id: r.id, title: a.title, body: a.body, author: r.nick || displayName(r.author_hash),
      created_at: r.created_at, edited_at: r.edited_at };
  });
  return json({ ok: true, journal: topic.title, articles, total: totalRow.n, page: p, per: JOURNAL_PER_PAGE },
    200, cacheHeader(url));
}

/* The journal topic must be a real board topic (never an article page or the
   back room); returns its page so boardKey can vet it. */
async function journalTopicPage(env: any, topicId: number) {
  const r = await env.DB.prepare(
    "SELECT page FROM comments WHERE id = ?1 AND parent_id IS NULL AND status = 'live'"
  ).bind(topicId).first();
  return r && r.page !== ADMIN_CAT ? r.page : '';
}

/* Author-only editing. The key must hash to the comment's own author,
   admins included only for their own comments. Every edit passes the same
   screen as a new post, or a clean comment could be edited into filth
   after approval, and a flagged edit drops the comment to pending. */
async function handleEdit(request: any, env: any, ctx: any) {
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
  if (env.HUB && status === 'live' && boardKey(row.page) && row.page !== ADMIN_CAT &&
      !(await isShadowBanned(env, authorHash))) {
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
async function handleMeta(request: any, env: any) {
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
    'CASE WHEN sh.hash IS NULL THEN 0 ELSE 1 END AS shadowbanned, ' +
    'CASE WHEN ib.ip IS NULL THEN 0 ELSE 1 END AS ipbanned ' +
    'FROM comments c LEFT JOIN trusted t ON t.hash = c.author_hash ' +
    'LEFT JOIN locks lk ON lk.hash = c.author_hash ' +
    'LEFT JOIN shadowbans sh ON sh.hash = c.author_hash ' +
    'LEFT JOIN ip_bans ib ON ib.ip = c.ip ' +
    'WHERE c.page = ?1 ORDER BY c.id LIMIT 500'
  ).bind(page).all();
  const list = rows.results;

  /* ip_bans now stores v6 as a /64 the raw c.ip will not equal, so recompute
     each comment's banned flag against the normalized key. */
  const commentKeys = [...new Set(list.map((r: any) => ipKey(r.ip)).filter(Boolean))];
  const bannedSet = new Set();
  if (commentKeys.length) {
    const ph = inList(commentKeys.length);
    const b = await env.DB.prepare('SELECT ip FROM ip_bans WHERE ip IN (' + ph + ')').bind(...commentKeys).all();
    for (const x of b.results) bannedSet.add(x.ip);
  }
  for (const r of list) r.ipbanned = bannedSet.has(ipKey(r.ip)) ? 1 : 0;

  /* Every IP tied to each identity on the page, each with its ban state, so the
     drawer can show and ban both families of a dual-stack user together. */
  const hashes = [...new Set(list.map((r: any) => r.author_hash).filter(Boolean))];
  const identities: any = {};
  if (hashes.length) {
    const ph = inList(hashes.length);
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
async function handleBoardIndex(request: any, env: any, url: any) {
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
    "    AND (c.parent_id IS NULL OR p.status = 'live') " +
    /* Muted authors, and every post under a muted author's thread, vanish from
       the index counts and the latest-poster for everyone. */
    '    AND ' + shadowExcl('c') + ' AND (c.parent_id IS NULL OR ' + shadowExcl('p') + ')' +
    ') WHERE rn = 1'
  ).all();
  const cats: any = {};
  rows.results.forEach(function (r: any) {
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
async function handleBoardCat(request: any, env: any, url: any) {
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

async function handleAuthorPosts(request: any, env: any, url: any) {
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.READ_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests. Slow down.' }, 429);
  const hash = String(url.searchParams.get('hash') || '');
  if (!/^[0-9a-f]{64}$/.test(hash)) return json({ ok: false, error: 'Bad request.' }, 400);
  const p = Math.min(1000, Math.max(1, Math.floor(Number(url.searchParams.get('p')) || 1)));
  const per = 20;
  /* A muted author's post history reads as empty to everyone (shadowExcl on
     c.author_hash, which IS the queried hash, yields nothing when muted). */
  const where =
    "WHERE c.author_hash = ?1 AND c.page LIKE 'board:%' AND c.page != 'board:adminsonly' AND c.status = 'live' " +
    "AND (c.parent_id IS NULL OR t.status = 'live') AND " + shadowExcl('c');
  const total = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM comments c LEFT JOIN comments t ON t.id = COALESCE(c.parent_id, c.id) ' + where
  ).bind(hash).first();
  const rows = await env.DB.prepare(
    'SELECT c.id AS comment_id, COALESCE(c.parent_id, c.id) AS topic_id, ' +
    'COALESCE(c.title, t.title) AS title, c.page, c.created_at, substr(c.body, 1, 160) AS snippet ' +
    'FROM comments c LEFT JOIN comments t ON t.id = COALESCE(c.parent_id, c.id) ' + where +
    ' ORDER BY c.id DESC LIMIT ?2 OFFSET ?3'
  ).bind(hash, per, (p - 1) * per).all();
  const items = (rows.results || []).map((r: any) => ({
    comment_id: r.comment_id, topic_id: r.topic_id, title: r.title,
    cat: String(r.page).slice(6), created_at: r.created_at, snippet: r.snippet,
  }));
  return json({ ok: true, items, total: (total && total.n) || 0, page: p, per }, 200, cacheHeader(url));
}

/* postCountsFor — a member's live-forum post count (topics always, replies only
   under a live topic) for a batch of hashes, the same definition handleAuthorPosts
   totals — now lives in the repository layer, ./db.ts (imported at the top). */

async function handleSearch(request: any, env: any, url: any) {
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
    "AND (c.parent_id IS NULL OR pt.status = 'live') " +
    /* Muted authors' posts, and posts under a muted author's thread, never match. */
    'AND ' + shadowExcl('c') + ' AND (c.parent_id IS NULL OR ' + shadowExcl('pt') + ') ' + filters.join(' ');

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
    const items = (rows.results || []).map((r: any) => withNames({
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
async function handleTopicView(request: any, env: any, url: any) {
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.READ_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests. Slow down.' }, 429);
  const id = Number(url.searchParams.get('id'));
  if (!Number.isInteger(id) || id < 1) return json({ ok: false, error: 'Bad request.' }, 400);
  const topic = await env.DB.prepare(
    "SELECT c.id, c.page, c.title, c.author_hash, pr.nick, pr.signature, pr.avatar, pr.faith, c.body, c.created_at, c.edited_at, c.locked, c.sticky, COALESCE(c.readonly, 0) AS readonly, c.replies, c.media_key, c.media_expired " +
    "FROM comments c LEFT JOIN profiles pr ON pr.hash = c.author_hash " +
    "WHERE c.id = ?1 AND c.parent_id IS NULL AND c.status = 'live' AND " + shadowExcl('c')
  ).bind(id).first();
  /* A muted author's whole thread reads as absent to everyone else. */
  if (!topic || !boardKey(topic.page)) return json({ ok: false, error: 'No such topic.' }, 404);
  /* answer exactly as if the topic did not exist: a prober learns nothing */
  if (topic.page === ADMIN_CAT) return json({ ok: false, error: 'No such topic.' }, 404, cacheHeader(url));
  return json(await topicViewPayload(env, topic, url.searchParams.get('p'), url.searchParams.get('find')), 200, cacheHeader(url));
}

async function handleBoardAdmin(request: any, env: any) {
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
      "SELECT c.id, c.page, c.title, c.author_hash, pr.nick, pr.signature, pr.avatar, pr.faith, c.body, c.created_at, c.edited_at, c.locked, c.sticky, COALESCE(c.readonly, 0) AS readonly, c.replies, c.media_key, c.media_expired " +
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
async function handleModerate(request: any, env: any, ctx: any) {
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
  if (!key || !Number.isInteger(id) || id < 1 || !['lock', 'unlock', 'delete', 'sticky', 'unsticky', 'readonly', 'unreadonly'].includes(act)) {
    return json({ ok: false, error: 'Bad request.' }, 400);
  }
  if (!(await isAdminHash(env, await sha256hex(key)))) return json({ ok: false, error: 'No.' }, 403);
  const topic = await env.DB.prepare(
    "SELECT id, page FROM comments WHERE id = ?1 AND parent_id IS NULL AND status != 'deleted'"
  ).bind(id).first();
  if (!topic || !boardKey(topic.page)) return json({ ok: false, error: 'No such topic.' }, 404);
  /* Live push of the moderation (Phase 1b): gated out for the back room. */
  const catKey = topic.page.slice(6);
  const emit = (ev: any) => { if (topic.page !== ADMIN_CAT) publishLive(env, ctx, ev); };
  if (act === 'delete') {
    /* A topic delete leaves its replies as live orphans (existing behavior),
       but every attachment in the thread — head and replies — is purged now:
       nothing in the thread will ever render again from the public board. */
    try {
      const mk = await env.DB.prepare(
        'SELECT media_key FROM comments WHERE (id = ?1 OR parent_id = ?1) AND media_key IS NOT NULL'
      ).bind(id).all();
      const keys = (mk.results || []).map((r: any) => r.media_key).filter(Boolean);
      if (keys.length) {
        await purgeWallMedia(env, keys);
        await env.DB.prepare('UPDATE comments SET media_key = NULL, media_size = NULL WHERE id = ?1 OR parent_id = ?1').bind(id).run();
      }
    } catch (e) { /* the hourly sweep reclaims it */ }
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
  if (act === 'readonly' || act === 'unreadonly') {
    const readonly = act === 'readonly' ? 1 : 0;
    await env.DB.prepare('UPDATE comments SET readonly = ?1 WHERE id = ?2').bind(readonly, id).run();
    emit({ v: 1, t: 'moderation', act, id, topic_id: id, cat: catKey, readonly,
      scopes: ['topic:' + id, 'cat:' + catKey] });
    return json({ ok: true, readonly: readonly }, 200);
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
async function handleMove(request: any, env: any, ctx: any) {
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
  /* Moving INTO the back room is a retraction from public view, and the back
     room carries no attachments by rule (handlePost refuses them there) — so
     the thread's media is purged outright rather than left fetchable at its
     capability URL from browser/edge caches' long tail. Moving back out later
     simply has no media to relight. */
  if (newPage === ADMIN_CAT) {
    try {
      const mk = await env.DB.prepare(
        'SELECT media_key FROM comments WHERE (id = ?1 OR parent_id = ?1) AND media_key IS NOT NULL'
      ).bind(id).all();
      const keys = (mk.results || []).map((r: any) => r.media_key).filter(Boolean);
      if (keys.length) {
        await purgeWallMedia(env, keys);
        await env.DB.prepare('UPDATE comments SET media_key = NULL, media_size = NULL WHERE id = ?1 OR parent_id = ?1').bind(id).run();
      }
    } catch (e) { /* the GET's back-room gate still refuses; the sweep reclaims */ }
  }
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
async function handleTrust(request: any, env: any) {
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
async function handleAudit(request: any, env: any) {
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
    "c.locked, c.sticky, c.media_key, COALESCE(c.parent_id, c.id) AS topic_id, COALESCE(c.title, t.title) AS title " +
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
    "substr(c.body, 1, 160) AS snippet, c.locked, c.sticky, c.media_key, COALESCE(c.parent_id, c.id) AS topic_id, COALESCE(c.title, t.title) AS title " +
    "FROM reports r JOIN comments c ON c.id = r.comment_id " +
    "LEFT JOIN profiles pr ON pr.hash = c.author_hash " +
    "LEFT JOIN comments t ON t.id = COALESCE(c.parent_id, c.id) " +
    "WHERE c.status != 'deleted' GROUP BY r.comment_id ORDER BY report_count DESC, last_reported DESC LIMIT 200"
  ).all();
  return json({ ok: true, reports: reports.results, pages: pages.results, topics: topics.results, days: 14 }, 200);
}

async function handleProfileGet(request: any, env: any, url: any) {
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.READ_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests. Slow down.' }, 429);
  /* Address a profile by its 64-hex hash OR by a custom ?handle=<name> (the URL
     name a member claimed). A handle resolves to its owner's hash; an unclaimed
     handle is an ordinary "not found" (an empty profile, like a hashless hash). */
  let hash = String(url.searchParams.get('hash') || '');
  const handleParam = String(url.searchParams.get('handle') || '');
  if (!hash && handleParam) {
    const v = Handle.validate(handleParam);
    if (v.ok) {
      const owner = await env.DB.prepare('SELECT hash FROM profiles WHERE handle = ?1').bind(v.handle).first();
      if (owner && owner.hash) hash = owner.hash;
    }
    if (!hash) return json({ ok: false, error: 'No such profile.' }, 404, cacheHeader(url));
  }
  if (!/^[0-9a-f]{64}$/.test(hash)) return json({ ok: false, error: 'Bad request.' }, 400);
  const row = await env.DB.prepare('SELECT nick, bio, signature, avatar, faith, handle, links FROM profiles WHERE hash = ?1').bind(hash).first();
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
      handle: row ? (row.handle || null) : null,
      links: row && row.links ? safeParseLinks(row.links) : null,
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
async function handleProfileSave(request: any, env: any) {
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
  /* Custom @handle (the profile URL name), validated against the shared kernel
     and checked for uniqueness before any write. Absent key = leave unchanged;
     empty string = clear it; a claimed name someone else holds = 409. */
  const handleProvided = Object.prototype.hasOwnProperty.call(data, 'handle');
  let handleVal = null;
  if (handleProvided) {
    const raw = String(data.handle == null ? '' : data.handle).trim();
    if (raw !== '') {
      const v = Handle.validate(raw);
      if (!v.ok) return json({ ok: false, error: handleErrorMessage(v.error), handle_error: v.error }, 400);
      const taken = await env.DB.prepare('SELECT hash FROM profiles WHERE handle = ?1 AND hash != ?2').bind(v.handle, authorHash).first();
      if (taken) return json({ ok: false, error: 'That @handle is taken. Pick another.', handle_error: 'taken' }, 409);
      handleVal = v.handle;
    }
  }
  /* Offsite links (website + socials) sanitized to safe https URLs (invalid ones
     dropped). Absent key = leave unchanged; an all-empty object clears them. */
  const linksProvided = Object.prototype.hasOwnProperty.call(data, 'links');
  const linksVal = linksProvided ? normalizeLinks(data.links) : null;
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
  /* Handle is written separately so an absent key leaves it untouched (an empty
     string clears it). The UNIQUE INDEX is the real guard: on the rare same-instant
     race past the check above it throws, which we surface as the same 409. */
  if (handleProvided) {
    try {
      await env.DB.prepare('UPDATE profiles SET handle = ?2, updated_at = ?3 WHERE hash = ?1')
        .bind(authorHash, handleVal, now).run();
    } catch {
      return json({ ok: false, error: 'That @handle is taken. Pick another.', handle_error: 'taken' }, 409);
    }
  }
  /* Links written separately (an absent key leaves them untouched). */
  if (linksProvided) {
    await env.DB.prepare('UPDATE profiles SET links = ?2, updated_at = ?3 WHERE hash = ?1')
      .bind(authorHash, linksVal, now).run();
  }
  /* The text upsert leaves the avatar and faith columns as they stand when not
     given; read them back (with the handle + links) so the client's re-render keeps them. */
  const av = await env.DB.prepare('SELECT avatar, faith, handle, links FROM profiles WHERE hash = ?1').bind(authorHash).first();
  return json({
    ok: true,
    profile: { hash: authorHash, nick: nick.value, bio: bio.value, signature: signature.value,
      avatar: av && av.avatar || null, faith: av && av.faith || null, handle: av && av.handle || null,
      links: av && av.links ? safeParseLinks(av.links) : null,
      assigned: displayName(authorHash), admin: await isAdminHash(env, authorHash) },
  }, 200);
}

/* Map a Domain.Handle rejection tag to a member-facing message. */
function handleErrorMessage(tag: any) {
  switch (tag) {
    case 'too_short': return 'That handle is too short (3 to 30 characters).';
    case 'too_long': return 'That handle is too long (3 to 30 characters).';
    case 'bad_chars': return 'A handle can use only lowercase letters, numbers, and underscore.';
    case 'bad_start': return 'A handle must start with a letter.';
    case 'bad_underscore': return 'A handle cannot end with, or repeat, an underscore.';
    case 'reserved': return 'That handle is reserved. Pick another.';
    default: return 'That handle is not allowed.';
  }
}

/* Admin-only: wipe an abusive profile back to the assigned pseudonym without
   banning the author. Bans still only stop posting. */
async function handleProfileClear(request: any, env: any) {
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

async function handleDmSend(request: any, env: any, ctx: any) {
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
       the native Web Push nudge. A HELD message does neither: the recipient must
       never learn of a shadow-blocked send. */
    if (ctx) {
      publishLive(env, ctx, { v: 1, t: 'dm', scopes: ['user:' + to], from: me, thread_id: thread.id,
        message: { id: msg.id, sender_hash: me, body: body, created_at: now, enc: enc, media_key: mediaKey } });
    }
    /* A DM also lands in the recipient's notifications list (the inbox badge is
       not the only place it should show). */
    await notifyDm(env, to, me);
    /* Native push nudge, DEFERRED (like the reply/mention/wall paths) so a slow
       push service never delays the sender's response — but only if the recipient
       hasn't turned DM notifications off ("the bell only — messages still
       arrive"); a push is the loudest bell, so it honors that opt-out too. Carries
       NO message content (DMs are E2E; the server never sees the plaintext). */
    const pushDm = async () => {
      const dmPref = (await notifyPrefsFor(env, [to]))[to];
      if (notifyEnabled(dmPref, 'dm')) {
        await deliverPush(env, [to], { kind: 'dm', title: 'New message', body: 'You have a new message', url: '/community.html?dm=' + me });
      }
    };
    if (ctx) ctx.waitUntil(pushDm()); else await pushDm();
  }
  return json({ ok: true, id: msg.id, thread_id: thread.id, created_at: now }, 200);
}

/* Deliver a message from one identity to another with no gate — for automated,
   system-authored notices (e.g. a topic-move notification). Always unheld, so a
   moderation notice reaches its target regardless of blocks, and it post-dates
   any clear stamp so a fresh-started thread resurfaces to carry it. Returns
   whether it delivered. */
async function handleDmThreads(request: any, env: any) {
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
  const threads = (rows.results || []).map((r: any) => Object.assign({}, r,
    { assigned: r.other_hash ? displayName(r.other_hash) : null }));
  return json({ ok: true, threads, total: totals.n || 0,
    unread_total: totals.unread || 0, page: p, per: DM_PER_PAGE }, 200);
}

/* One conversation, paged by twenty like everything else, defaulting to the
   LAST page so it opens at its newest words. Opening marks it read with at
   most one write, none when nothing was unread. */
async function handleDmThread(request: any, env: any, ctx: any) {
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
    'SELECT m.id, m.sender_hash, m.body, m.created_at, COALESCE(m.enc, 0) AS enc, COALESCE(m.saved, 0) AS saved, m.media_key, m.media_size, COALESCE(m.media_expired, 0) AS media_expired, COALESCE(m.redacted, 0) AS redacted, m.edited_at, m.opened_at, m.expires_at FROM dms m WHERE m.thread_id = ?2 AND ' + DM_VIS +
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
    /* Reciprocal read receipts: a reader who set receipts to "off" sends none
       (and, client-side, sees none), so we only emit when their mode allows it. */
    const myPref = await env.DB.prepare('SELECT receipts_mode FROM profiles WHERE hash = ?1').bind(me).first();
    if (Prefs.receiptsOn((myPref && myPref.receipts_mode) || 'auto')) {
      const ev = { v: 1, t: 'dm-read', scopes: ['user:' + other], thread_id: thread.id, reader: me, at: now };
      if (ctx) publishLive(env, ctx, ev); else await publishUser(env, [ev]);
    }
  }
  return json({ ok: true, thread_id: thread.id, ttl,
    other: { hash: other, nick: prof && prof.nick || null, avatar: prof && prof.avatar || null, assigned: displayName(other), pubkey: otherPub },
    messages: msgs.results, total: total, page: p, per: DM_PER_PAGE, blocked: iBlocked ? 1 : 0 }, 200);
}

/* The badge count: unread threads, one indexed COUNT. The client asks at most
   once per ninety seconds, so this stays cheap on every side. */
async function handleDmUnread(request: any, env: any) {
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
async function handleDmPresence(request: any, env: any) {
  const pre = await keyedGated(request, env, 'READ_LIMIT');
  if (pre instanceof Response) return pre;
  const { ip, data, key, me } = pre;
  const hashes = (Array.isArray(data.hashes) ? data.hashes : [])
    .filter((h: any) => /^[0-9a-f]{64}$/.test(String(h))).slice(0, 50);
  if (!hashes.length || !env.HUB) return json({ ok: true, online: [] }, 200);
  let online = [];
  try { online = await env.HUB.get(env.HUB.idFromName('board')).presenceOf(hashes); } catch { online = []; }
  return json({ ok: true, online: Array.isArray(online) ? online : [] }, 200);
}

/* Settings-gear preferences (keyed + private): read your own read-receipts mode
   and per-type notification switches, and set them. Never exposed on the public
   profile read. */
async function handlePrefs(request: any, env: any) {
  const pre = await keyedGated(request, env, 'READ_LIMIT');
  if (pre instanceof Response) return pre;
  const { ip, data, key, me } = pre;
  const now = Math.floor(Date.now() / 1000);
  if (data.set && typeof data.set === 'object') {
    await env.DB.prepare('INSERT OR IGNORE INTO profiles (hash, created_at) VALUES (?1, ?2)').bind(me, now).run();
    const set = data.set;
    const parts = [];
    const vals = [];
    if ('receipts' in set) { parts.push('receipts_mode = ?'); vals.push(String(set.receipts) === 'off' ? 'off' : 'auto'); }
    for (const k of ['reply', 'mention', 'dm']) {
      const sk = 'notify_' + k;
      if (sk in set) { parts.push(sk + ' = ?'); vals.push((set[sk] === false || set[sk] === 0 || set[sk] === '0') ? 0 : 1); }
    }
    /* The mute list follows the member across devices (the client merges and
       writes through). Hashes only, clamped, stored as a JSON array. */
    if ('muted' in set && Array.isArray(set.muted)) {
      const clean = set.muted.filter((h: any) => /^[0-9a-f]{64}$/.test(String(h))).slice(0, 300);
      parts.push('muted = ?'); vals.push(JSON.stringify(clean));
    }
    if (parts.length) {
      parts.push('updated_at = ?'); vals.push(now);
      await env.DB.prepare('UPDATE profiles SET ' + parts.join(', ') + ' WHERE hash = ?').bind(...vals, me).run();
    }
  }
  const row = await env.DB.prepare('SELECT receipts_mode, notify_reply, notify_mention, notify_dm, muted FROM profiles WHERE hash = ?1').bind(me).first();
  const onOff = (v: any) => (v == null ? 1 : (v ? 1 : 0));
  let muted: any = [];
  try { muted = row && row.muted ? JSON.parse(row.muted) : []; } catch { muted = []; }
  return json({ ok: true, prefs: {
    receipts: (row && row.receipts_mode === 'off') ? 'off' : 'auto',
    notify_reply: onOff(row && row.notify_reply),
    notify_mention: onOff(row && row.notify_mention),
    notify_dm: onOff(row && row.notify_dm),
    muted: Array.isArray(muted) ? muted : [],
  } }, 200);
}

/* The blocked-members roster for the settings gear: the members this reader has
   blocked, so they can be seen and unblocked from one place (unblocking reuses
   the existing /dm/block with blocked:false). Keyed + private. */
async function handleDmBlocked(request: any, env: any) {
  const pre = await keyedGated(request, env, 'READ_LIMIT');
  if (pre instanceof Response) return pre;
  const { ip, data, key, me } = pre;
  const rows = await env.DB.prepare(
    'SELECT b.blocked_hash AS hash, pr.nick AS nick, pr.avatar AS avatar FROM dm_blocks b ' +
    'LEFT JOIN profiles pr ON pr.hash = b.blocked_hash WHERE b.owner_hash = ?1 ORDER BY b.created_at DESC LIMIT 200'
  ).bind(me).all();
  const blocked = (rows.results || []).map((r: any) => ({ hash: r.hash, nick: r.nick || null, avatar: r.avatar || null, assigned: displayName(r.hash) }));
  return json({ ok: true, blocked }, 200);
}

/* Set the per-conversation disappearing-message lifetime. Either participant may
   change it and the LAST write wins for both — it is a single column. Changing it
   rebases every opened, unsaved message to the new lifetime, and the other party
   is told live so their header updates. Upserts the thread if it does not exist
   yet (a still-empty room, invisible in the inbox), so the choice sticks before
   the first message is even sent. */
async function handleDmTtl(request: any, env: any, ctx: any) {
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
async function handleDmSave(request: any, env: any) {
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

/* Edit one of your OWN messages. DMs are end-to-end encrypted, so the server is
   blind: the client re-encrypts the new plaintext to the same pair secret and
   sends the fresh ciphertext, which simply replaces the stored body; edited_at
   is stamped so both sides show an "(edited)" marker. Everything else — the
   expiry clock, opened_at, saved, any media pointer — is untouched. Only the
   sender may edit, only a live (unexpired), un-redacted, non-system message. */
async function handleDmEdit(request: any, env: any, ctx: any) {
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.POST_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many edits at once. Wait a minute and try again.' }, 429);
  const key = String(data.key || '');
  const other = String(data.with || '');
  const id = Math.floor(Number(data.id) || 0);
  if (!key || !/^[0-9a-f]{64}$/.test(other) || id < 1) return json({ ok: false, error: 'Bad request.' }, 400);
  const enc = (data.enc === 1 || data.enc === true) ? 1 : 0;
  const body = String(data.body || '').replace(/\r\n?/g, '\n').trim();
  if (!body) return json({ ok: false, error: 'The message is empty.' }, 400);
  if (body.length > (enc ? DM_ENC_MAX : MAX_BODY)) return json({ ok: false, error: 'The message is too long.' }, 400);
  if (CONTROL_RE.test(body)) return json({ ok: false, error: 'Bad request.' }, 400);
  const me = await sha256hex(key);
  if (me === other) return json({ ok: false, error: 'Bad request.' }, 400);
  const gate = await blockedReason(env, me, ip);
  if (gate) return blockedJson(gate);
  const [a, b] = dmPair(me, other);
  const now = Math.floor(Date.now() / 1000);
  /* Mine, in this pair's thread, still live, not redacted, not a system notice. */
  const row = await env.DB.prepare(
    'SELECT d.id, d.thread_id, COALESCE(d.enc, 0) AS enc, COALESCE(d.redacted, 0) AS redacted, d.expires_at ' +
    'FROM dms d JOIN dm_threads t ON t.id = d.thread_id ' +
    'WHERE d.id = ?1 AND d.sender_hash = ?2 AND t.a_hash = ?3 AND t.b_hash = ?4'
  ).bind(id, me, a, b).first();
  if (!row) return json({ ok: false, error: 'No such message.' }, 404);
  if (row.redacted) return json({ ok: false, error: 'That message was deleted.' }, 409);
  if (Number(row.enc) === 2) return json({ ok: false, error: 'That message cannot be edited.' }, 403);
  if (row.expires_at != null && row.expires_at <= now) return json({ ok: false, error: 'That message has expired.' }, 410);
  await env.DB.prepare('UPDATE dms SET body = ?1, enc = ?2, edited_at = ?3 WHERE id = ?4').bind(body, enc, now, id).run();
  /* Push the new ciphertext to the recipient's open thread so their bubble
     re-renders (decrypts) live and shows "(edited)". */
  if (ctx) publishLive(env, ctx, { v: 1, t: 'dm-edit', scopes: ['user:' + other], from: me, thread_id: row.thread_id,
    message: { id, body, enc, edited_at: now } });
  return json({ ok: true, id, edited_at: now }, 200);
}

/* Delete (redact) one of your OWN messages. Not a hard delete: the ciphertext
   body and any media are cleared and a redacted flag is set, but the row is KEPT
   with its ORIGINAL expires_at, so a "<redacted>" placeholder stands where the
   message was until the moment it would have disappeared anyway — then the
   ordinary sweep removes it. Only the sender may redact, and only once. */
async function handleDmRedact(request: any, env: any, ctx: any) {
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.POST_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests. Wait a minute and try again.' }, 429);
  const key = String(data.key || '');
  const other = String(data.with || '');
  const id = Math.floor(Number(data.id) || 0);
  if (!key || !/^[0-9a-f]{64}$/.test(other) || id < 1) return json({ ok: false, error: 'Bad request.' }, 400);
  const me = await sha256hex(key);
  if (me === other) return json({ ok: false, error: 'Bad request.' }, 400);
  const gate = await blockedReason(env, me, ip);
  if (gate) return blockedJson(gate);
  const [a, b] = dmPair(me, other);
  const row = await env.DB.prepare(
    'SELECT d.id, d.thread_id, d.media_key, COALESCE(d.redacted, 0) AS redacted ' +
    'FROM dms d JOIN dm_threads t ON t.id = d.thread_id ' +
    'WHERE d.id = ?1 AND d.sender_hash = ?2 AND t.a_hash = ?3 AND t.b_hash = ?4'
  ).bind(id, me, a, b).first();
  if (!row) return json({ ok: false, error: 'No such message.' }, 404);
  if (row.redacted) return json({ ok: true, id, redacted: true }, 200);   // already gone; idempotent
  /* Reclaim any R2 media at once (D1 can't cascade to R2); the byte counter
     self-heals on the next hourly sweep, exactly as conversation-delete does. */
  if (row.media_key) await purgeMediaKeys(env, [row.media_key]);
  await env.DB.prepare(
    "UPDATE dms SET redacted = 1, body = '', enc = 0, media_key = NULL, media_size = NULL WHERE id = ?1"
  ).bind(id).run();
  if (ctx) publishLive(env, ctx, { v: 1, t: 'dm-redact', scopes: ['user:' + other], from: me, thread_id: row.thread_id,
    message: { id } });
  return json({ ok: true, id, redacted: true }, 200);
}

/* Delete a set of media objects from R2 and their dm_media rows. R2 delete takes
   up to 1000 keys per call; the D1 delete is chunked to stay under the 50-subrequest
   budget. Keys are opaque server-minted ids. */
async function handleDmMediaUpload(request: any, env: any) {
  if (!env.MEDIA) return json({ ok: false, error: 'Media storage is not available.' }, 503);
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.POST_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many uploads at once. Wait a minute.' }, 429);
  const settings = await getAppSettings(env);
  if (settings.media_enabled !== '1') return json({ ok: false, error: 'Media sharing is turned off.' }, 403);
  /* The bytes are E2E ciphertext, so the server can never know the KIND — the
     enforceable wall is the largest per-kind cap the DM context allows (plus a
     small ciphertext allowance); per-kind DM limits are client-side advisory,
     served via /config. An empty DM kinds mask turns attachments off. */
  const dmKinds = mediaKindsFor(settings, 'dm');
  if (!dmKinds.length) return json({ ok: false, error: 'Media sharing is turned off.' }, 403);
  const maxBytes = mediaMaxAcross(settings, dmKinds, 'dm') + 4096;
  const declared = Number(request.headers.get('Content-Length') || 0);
  if (declared && declared > maxBytes + 8192) return json({ ok: false, error: 'That file is too large.' }, 413);
  let form;
  try { form = await request.formData(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  const key = String(form.get('key') || '');
  if (!key) return json({ ok: false, error: 'Bad request.' }, 400);
  const me = await sha256hex(key);
  const gate = await blockedReason(env, me, ip);
  if (gate) return blockedJson(gate);
  if (!(await isEstablished(env, me))) {
    return json({ ok: false, error: 'Attachments unlock after your first post or profile save.' }, 403);
  }
  const file = form.get('file');
  if (!file || typeof file.arrayBuffer !== 'function') return json({ ok: false, error: 'No file.' }, 400);
  if (file.size > maxBytes) return json({ ok: false, error: 'That file is too large.' }, 413);
  /* LIVE byte accounting at upload time — the sweep-maintained counter is up to
     an hour stale, which a flood laughs at. One cheap indexed SUM. */
  const usedRow = await env.DB.prepare('SELECT COALESCE(SUM(size), 0) AS total FROM dm_media').first();
  const capDm = Number(settings.media_cap_dm_bytes) || Number(Media.defaults.capDmBytes);
  if ((usedRow.total || 0) + file.size > Math.floor(capDm * 0.90)) {
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
async function handleDmMediaGet(request: any, env: any) {
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
async function handleAdminSettings(request: any, env: any) {
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  const key = String(data.key || '');
  if (!(await requireAdmin(env, key))) return json({ ok: false, error: 'No.' }, 403);
  if (data.set && typeof data.set === 'object') {
    const now = Math.floor(Date.now() / 1000);
    const me = await sha256hex(key);
    const allowed: any = { media_enabled: 1, media_max_bytes: 1, dm_default_ttl: 1, dm_backstop_days: 1, wall_prune_enabled: 1, wall_prune_days: 1, discord_forum_webhook: 1, discord_feed_webhook: 1, discord_feed_comments: 1, journal_topic: 1, journal_enabled: 1,
      media_image_max_bytes: 1, media_video_max_bytes: 1, media_audio_max_bytes: 1, media_audio_max_seconds: 1,
      media_kinds_dm: 1, media_kinds_wall: 1, media_kinds_board: 1, media_image_autocompress: 1,
      media_cap_dm_bytes: 1, media_cap_wall_bytes: 1, media_cap_board_bytes: 1,
      media_scan_wall: 1, media_scan_board: 1, media_voice_dm: 1, media_voice_wall: 1, media_voice_board: 1,
      media_wall_retention_days: 1, media_board_retention_days: 1, media_dm_retention_days: 1,
      media_dm_image_max_bytes: 1, media_dm_video_max_bytes: 1, media_dm_audio_max_bytes: 1,
      media_wall_image_max_bytes: 1, media_wall_video_max_bytes: 1, media_wall_audio_max_bytes: 1,
      media_board_image_max_bytes: 1, media_board_video_max_bytes: 1, media_board_audio_max_bytes: 1,
      media_audio_max_seconds_dm: 1, media_audio_max_seconds_wall: 1, media_audio_max_seconds_board: 1 };
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
        || k === 'media_voice_dm' || k === 'media_voice_wall' || k === 'media_voice_board') v = (v === '1' || v === 'true') ? '1' : '0';
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

/* Purge ALL DM media from the bucket (admin, destructive). Cursor-paginated list +
   batched delete, then clear the pointers and the usage counter. Message text is
   untouched; only the shared attachments are removed. */
async function handleDmMediaPurge(request: any, env: any) {
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  const key = String(data.key || '');
  if (!(await requireAdmin(env, key))) return json({ ok: false, error: 'No.' }, 403);
  let deleted = 0;
  if (env.MEDIA) {
    let cursor: any;
    do {
      const list = await env.MEDIA.list({ prefix: 'dm/', cursor, limit: 1000 });
      const keys = (list.objects || []).map((o: any) => o.key);
      if (keys.length) { try { await env.MEDIA.delete(keys); } catch (e) { /* keep going */ } deleted += keys.length; }
      cursor = list.truncated ? list.cursor : null;
    } while (cursor);
  }
  await env.DB.prepare('DELETE FROM dm_media').run();
  await env.DB.prepare('UPDATE dms SET media_key = NULL, media_size = NULL WHERE media_key IS NOT NULL').run();
  await env.DB.prepare(
    "INSERT INTO app_settings (k, v, updated_at) VALUES ('dm_media_bytes', '0', ?1) ON CONFLICT(k) DO UPDATE SET v = '0', updated_at = ?1"
  ).bind(Math.floor(Date.now() / 1000)).run();
  appSettingsCache.at = 0; appSettingsCache.s = null;
  return json({ ok: true, deleted }, 200);
}

/* ================= Public posting: walls + the global feed =================
   A member's "wall" is their own stream of public posts; the "feed" is every
   member's posts together. Public + UNencrypted (unlike DMs), reusing the forum's
   Turnstile + AI screen (held-if-flagged) + @mention notifications. Media rides a
   public R2 bucket (WALLMEDIA), served same-origin like avatars. Posts persist
   until the admin auto-prune (Phase D) removes them. All members-only to read. */

async function handleWallFeed(request: any, env: any) {
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  const r = await wallReader(request, env, data);
  if (r.resp) return r.resp;
  const cursor = Math.floor(Number(data.cursor) || 0);
  /* Muted authors' posts never appear in anyone else's feed. */
  const rows = cursor > 0
    ? await env.DB.prepare('SELECT ' + WALL_POST_COLS + " FROM wall_posts p LEFT JOIN profiles pr ON pr.hash = p.author_hash WHERE p.status = 'live' AND " + shadowExcl('p') + " AND p.id < ?1 ORDER BY p.id DESC LIMIT ?2").bind(cursor, WALL_PER_PAGE).all()
    : await env.DB.prepare('SELECT ' + WALL_POST_COLS + " FROM wall_posts p LEFT JOIN profiles pr ON pr.hash = p.author_hash WHERE p.status = 'live' AND " + shadowExcl('p') + " ORDER BY p.id DESC LIMIT ?1").bind(WALL_PER_PAGE).all();
  const list = rows.results || [];
  const posts = await wallEnrich(env, list, r.me);
  const next = list.length === WALL_PER_PAGE ? list[list.length - 1].id : 0;
  return json({ ok: true, posts, next, me: r.me }, 200);
}

/* One member's wall (their own posts), keyset-paged like the feed. */
async function handleWall(request: any, env: any) {
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  const r = await wallReader(request, env, data);
  if (r.resp) return r.resp;
  const hash = String(data.hash || '');
  if (!/^[0-9a-f]{64}$/.test(hash)) return json({ ok: false, error: 'No such member.' }, 400);
  const cursor = Math.floor(Number(data.cursor) || 0);
  /* A muted member's own wall reads as empty to everyone else. */
  const rows = cursor > 0
    ? await env.DB.prepare('SELECT ' + WALL_POST_COLS + " FROM wall_posts p LEFT JOIN profiles pr ON pr.hash = p.author_hash WHERE p.author_hash = ?1 AND p.status = 'live' AND " + shadowExcl('p') + " AND p.id < ?2 ORDER BY p.id DESC LIMIT ?3").bind(hash, cursor, WALL_PER_PAGE).all()
    : await env.DB.prepare('SELECT ' + WALL_POST_COLS + " FROM wall_posts p LEFT JOIN profiles pr ON pr.hash = p.author_hash WHERE p.author_hash = ?1 AND p.status = 'live' AND " + shadowExcl('p') + " ORDER BY p.id DESC LIMIT ?2").bind(hash, WALL_PER_PAGE).all();
  const list = rows.results || [];
  const posts = await wallEnrich(env, list, r.me);
  const next = list.length === WALL_PER_PAGE ? list[list.length - 1].id : 0;
  return json({ ok: true, posts, next, me: r.me, hash }, 200);
}

/* One post plus all its live comments (the ?post=<id> detail + mention target). */
/* A single post is PUBLIC (unlike the feed listing, which stays members-only via
   wallReader): anyone may read a post and its likes/comments so a shared
   feed.html?post=<id> link works logged-out. Rate-limited by IP. A key is
   OPTIONAL — when supplied it resolves the reader's like-state and is still
   refused if blocked; without one, me is null (no personal like flags). Returns
   only public post/comment content (no IPs, no keys). */
async function handleWallPostGet(request: any, env: any) {
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.READ_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests. Slow down.' }, 429);
  let me = null;
  const key = String((data && data.key) || '');
  if (key) {
    me = await sha256hex(key);
    const gate = await blockedReason(env, me, ip);
    if (gate) return blockedJson(gate);
  }
  const id = Math.floor(Number(data.id) || 0);
  /* A muted author's post reads as gone to everyone else; and any muted
     commenter's comments are dropped from a post others can still see. */
  const post = await env.DB.prepare('SELECT ' + WALL_POST_COLS + " FROM wall_posts p LEFT JOIN profiles pr ON pr.hash = p.author_hash WHERE p.id = ?1 AND p.status = 'live' AND " + shadowExcl('p')).bind(id).first();
  if (!post) return json({ ok: false, error: 'That post is gone.' }, 404);
  const crows = await env.DB.prepare('SELECT ' + WALL_COMMENT_COLS + " FROM wall_comments c LEFT JOIN profiles pr ON pr.hash = c.author_hash WHERE c.post_id = ?1 AND c.status = 'live' AND " + shadowExcl('c') + " ORDER BY c.id").bind(id).all();
  const enriched = await wallEnrich(env, [post].concat(crows.results || []), me);
  const comments = enriched.slice(1);
  /* Comment likes: each comment carries its `clikes` count; add the viewer's own
     like flag with one batched point-lookup, and normalise to {likes, liked} like
     a post so the client renders the two the same way. */
  let cliked: Set<any> = new Set();
  if (me && comments.length) {
    const cids = comments.map((c: any) => c.id);
    const lr = await env.DB.prepare('SELECT comment_id FROM wall_comment_likes WHERE author_hash = ?1 AND comment_id IN (' + inList(cids.length, 2) + ')').bind(me, ...cids).all();
    cliked = new Set((lr.results || []).map((x: any) => x.comment_id));
  }
  comments.forEach((c: any) => { c.likes = Number(c.clikes) || 0; c.liked = cliked.has(c.id) ? 1 : 0; delete c.clikes; });
  return json({ ok: true, post: enriched[0], comments, me }, 200);
}

/* Like or unlike a public post — a lightweight toggle: READ_LIMIT (not the post
   budget), no Turnstile, gated like any write (key + blockedReason). Liking
   notifies the post author (coalesced, Facebook style); unliking before it is
   read retracts that notification. Returns the fresh {liked, likes}. */
async function handleWallLike(request: any, env: any, ctx: any) {
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.READ_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests. Slow down.' }, 429);
  const key = String(data.key || '');
  if (!key) return json({ ok: false, error: 'Sign in to like.' }, 401);
  const me = await sha256hex(key);
  const gate = await blockedReason(env, me, ip);
  if (gate) return blockedJson(gate);
  const postId = Math.floor(Number(data.post || data.id) || 0);
  const post = await env.DB.prepare("SELECT id, author_hash FROM wall_posts WHERE id = ?1 AND status = 'live'").bind(postId).first();
  if (!post) return json({ ok: false, error: 'That post is gone.' }, 404);
  const want = !(data.like === false || data.like === 0 || data.like === 'false');   // default: like
  const now = Math.floor(Date.now() / 1000);
  if (want) {
    const r = await env.DB.prepare('INSERT OR IGNORE INTO wall_likes (post_id, author_hash, created_at) VALUES (?1, ?2, ?3)').bind(postId, me, now).run();
    /* Notify only on a genuinely NEW like (changes>0, not a repeat), never for
       your own post, never the bot — and never from a muted (shadowbanned)
       liker, whose engagement must reach no one. */
    if (r.meta && r.meta.changes > 0 && post.author_hash && post.author_hash !== me && post.author_hash !== MERECAT_BOT.hash &&
        !(await isShadowBanned(env, me))) {
      if (ctx) ctx.waitUntil(notifyWallLike(env, post.author_hash, me, postId));
      else await notifyWallLike(env, post.author_hash, me, postId);
    }
  } else {
    await env.DB.prepare('DELETE FROM wall_likes WHERE post_id = ?1 AND author_hash = ?2').bind(postId, me).run();
    /* Retract the like-notification if the author has not seen it yet (a read one
       stays, Facebook style). */
    try {
      await env.DB.prepare("DELETE FROM notifications WHERE recipient_hash = ?1 AND kind = 'wall-like' AND actor_hash = ?2 AND comment_id = ?3 AND read_at IS NULL")
        .bind(post.author_hash, me, postId).run();
    } catch (e) { /* never break the unlike */ }
  }
  const c = await env.DB.prepare('SELECT COUNT(*) AS n FROM wall_likes WHERE post_id = ?1').bind(postId).first();
  return json({ ok: true, liked: want ? 1 : 0, likes: (c && c.n) || 0 }, 200);
}

/* Like or unlike a public COMMENT — the twin of handleWallLike over
   wall_comment_likes. No notification (kept lightweight; the count updates in
   place). Returns the fresh {liked, likes}. */
async function handleWallCommentLike(request: any, env: any) {
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.READ_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests. Slow down.' }, 429);
  const key = String(data.key || '');
  if (!key) return json({ ok: false, error: 'Sign in to like.' }, 401);
  const me = await sha256hex(key);
  const gate = await blockedReason(env, me, ip);
  if (gate) return blockedJson(gate);
  const commentId = Math.floor(Number(data.comment || data.id) || 0);
  const cm = await env.DB.prepare("SELECT id FROM wall_comments WHERE id = ?1 AND status = 'live'").bind(commentId).first();
  if (!cm) return json({ ok: false, error: 'That comment is gone.' }, 404);
  const want = !(data.like === false || data.like === 0 || data.like === 'false');
  const now = Math.floor(Date.now() / 1000);
  if (want) {
    await env.DB.prepare('INSERT OR IGNORE INTO wall_comment_likes (comment_id, author_hash, created_at) VALUES (?1, ?2, ?3)').bind(commentId, me, now).run();
  } else {
    await env.DB.prepare('DELETE FROM wall_comment_likes WHERE comment_id = ?1 AND author_hash = ?2').bind(commentId, me).run();
  }
  const c = await env.DB.prepare('SELECT COUNT(*) AS n FROM wall_comment_likes WHERE comment_id = ?1').bind(commentId).first();
  return json({ ok: true, liked: want ? 1 : 0, likes: (c && c.n) || 0 }, 200);
}

/* Who liked a public post or comment (the "who liked it" popover). Public read —
   anyone can see the likers of a public post — capped so a viral post never
   returns thousands. Muted (shadowbanned) likers are hidden from everyone but
   themselves, like all their public activity. Returns display names + avatars. */
async function handleWallLikers(request: any, env: any) {
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.READ_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests. Slow down.' }, 429);
  const postId = Math.floor(Number(data.post) || 0);
  const commentId = Math.floor(Number(data.comment) || 0);
  const LIMIT = 60;
  let rows;
  if (commentId > 0) {
    rows = await env.DB.prepare(
      'SELECT l.author_hash, pr.nick, pr.avatar FROM wall_comment_likes l LEFT JOIN profiles pr ON pr.hash = l.author_hash ' +
      'WHERE l.comment_id = ?1 AND ' + shadowExcl('l') + ' ORDER BY l.created_at DESC LIMIT ?2'
    ).bind(commentId, LIMIT + 1).all();
  } else if (postId > 0) {
    rows = await env.DB.prepare(
      'SELECT l.author_hash, pr.nick, pr.avatar FROM wall_likes l LEFT JOIN profiles pr ON pr.hash = l.author_hash ' +
      'WHERE l.post_id = ?1 AND ' + shadowExcl('l') + ' ORDER BY l.created_at DESC LIMIT ?2'
    ).bind(postId, LIMIT + 1).all();
  } else {
    return json({ ok: false, error: 'Bad request.' }, 400);
  }
  const all = rows.results || [];
  const more = all.length > LIMIT;
  const likers = all.slice(0, LIMIT).map((r: any) => ({
    hash: r.author_hash, nick: r.nick || displayName(r.author_hash), avatar: r.avatar || null,
  }));
  return json({ ok: true, likers, more }, 200);
}

/* Coalesced like-notification (mirror of notifyDm): one unread row per
   (recipient, actor, post), so re-liking while unread never duplicates, but two
   different posts liked by the same person are two rows. Bell rings only on a
   fresh insert; a live push tells the author's open tab. */
async function handleWallPost(request: any, env: any, ctx: any) {
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  if (String(data.website || '')) return json({ ok: true }, 200);   // honeypot
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.POST_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests. Slow down.' }, 429);
  const key = String(data.key || '');
  if (!key) return json({ ok: false, error: 'Sign in to post.' }, 401);
  const body = String(data.body || '').replace(/\r\n?/g, '\n').trim();
  const wallSettings = await getAppSettings(env);
  const media = await wallClaimMedia(env, data.media_key, mediaKindsFor(wallSettings, 'wall'), wallSettings, 'wall');
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
  if (media) {
    /* ref_id IS NULL closes the double-claim race (the board path's guard, now
       uniform); ctx re-stamps to follow the claiming parent, so accounting
       always tracks where the media actually lives. The race loser clears its
       own pointer rather than pointing at media it does not own. */
    const link = await env.DB.prepare(
      "UPDATE wall_media SET ref_type = 'post', ref_id = ?1, ctx = 'wall' WHERE key = ?2 AND ref_id IS NULL"
    ).bind(ins.id, media.key).run();
    if (!link.meta || !link.meta.changes) {
      await env.DB.prepare('UPDATE wall_posts SET media_key = NULL, media_size = NULL WHERE id = ?1').bind(ins.id).run();
    }
  }
  /* A muted author's wall post is stored live but reaches no one: no feed
     broadcast, no @mention notifications, no Discord (the feed reads hide it). */
  if (status === 'live' && !(await isShadowBanned(env, me))) {
    if (ctx) ctx.waitUntil(deliverWallNotifications(env, { authorHash: me, postId: ins.id, mentions: data.mentions }));
    publishLive(env, ctx, { v: 1, t: 'wall-post', scopes: ['feed:global'], id: ins.id });
    if (ctx) ctx.waitUntil(notifyDiscordFeed(env, {
      postId: ins.id, authorHash: me, body, hasMedia: !!media, createdAt: now,
    }).catch((e) => console.log(JSON.stringify({ event: 'discord_feed_failed', error: String(e) }))));
  }
  return json({ ok: true, id: ins.id, status }, 200);
}

/* Comment on a post (text + optional media). Notifies the post author + mentions. */
async function handleWallComment(request: any, env: any, ctx: any) {
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
  const wallSettings = await getAppSettings(env);
  const media = await wallClaimMedia(env, data.media_key, mediaKindsFor(wallSettings, 'wall'), wallSettings, 'wall');
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
  if (media) {
    /* Same double-claim guard + ctx re-stamp as the post path above. */
    const link = await env.DB.prepare(
      "UPDATE wall_media SET ref_type = 'comment', ref_id = ?1, ctx = 'wall' WHERE key = ?2 AND ref_id IS NULL"
    ).bind(ins.id, media.key).run();
    if (!link.meta || !link.meta.changes) {
      await env.DB.prepare('UPDATE wall_comments SET media_key = NULL, media_size = NULL WHERE id = ?1').bind(ins.id).run();
    }
  }
  /* A muted commenter's comment is stored live but invisible to others: it must
     not bump the post's comment count (a ghost count betrays the mute), notify,
     or broadcast. The post-detail read hides the comment itself. */
  if (status === 'live' && !(await isShadowBanned(env, me))) {
    await env.DB.prepare('UPDATE wall_posts SET comments = comments + 1 WHERE id = ?1').bind(postId).run();
    if (ctx) ctx.waitUntil(deliverWallNotifications(env, { authorHash: me, postId: postId, mentions: data.mentions, postAuthorHash: post.author_hash }));
    publishLive(env, ctx, { v: 1, t: 'wall-comment', scopes: ['feed:global'], post: postId });
    /* opt-in: mirror feed-post comments to the Discord feed webhook too */
    if (ctx) ctx.waitUntil(notifyDiscordFeedComment(env, { postId, authorHash: me, body, createdAt: now })
      .catch((e) => console.log(JSON.stringify({ event: 'discord_feed_comment_failed', error: String(e) }))));
  }
  return json({ ok: true, id: ins.id, status }, 200);
}

/* Edit your own wall post or comment in place (the forum and even the E2E DMs
   already edit; delete-only walls were the inconsistency). Same re-screen as a
   fresh post, so an edit cannot smuggle past the safety check. */
async function handleWallEdit(request: any, env: any) {
  const pre = await keyedGated(request, env, 'POST_LIMIT');
  if (pre instanceof Response) return pre;
  const { data, me } = pre;
  const id = Math.floor(Number(data.id) || 0);
  const isComment = !!data.comment;
  if (id < 1) return json({ ok: false, error: 'Bad request.' }, 400);
  const body = String(data.body || '').replace(/\r\n?/g, '\n').trim();
  if (!body) return json({ ok: false, error: 'The post is empty.' }, 400);
  if (body.length > MAX_BODY) return json({ ok: false, error: 'That is too long.' }, 400);
  if (CONTROL_RE.test(body)) return json({ ok: false, error: 'Bad request.' }, 400);
  const table = isComment ? 'wall_comments' : 'wall_posts';
  const row = await env.DB.prepare(
    'SELECT id FROM ' + table + " WHERE id = ?1 AND author_hash = ?2 AND status != 'deleted'"
  ).bind(id, me).first();
  if (!row) return json({ ok: false, error: 'Not yours, or already gone.' }, 403);
  const { status } = await screen(env, body, await isTrusted(env, me));
  const editedAt = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    'UPDATE ' + table + ' SET body = ?1, status = ?2, edited_at = ?3 WHERE id = ?4'
  ).bind(body, status, editedAt, id).run();
  return json({ ok: true, status, edited_at: editedAt }, 200);
}

/* Saved posts: one row per member per item, toggled on and off. kind 'topic'
   is a forum topic, 'wall' a feed post. The list joins the source tables so
   dead items fall away naturally. */
async function handleBookmark(request: any, env: any) {
  const pre = await keyedGated(request, env, 'POST_LIMIT');
  if (pre instanceof Response) return pre;
  const { data, me } = pre;
  const kind = String(data.kind || '');
  const ref = Math.floor(Number(data.ref) || 0);
  if ((kind !== 'topic' && kind !== 'wall') || ref < 1) return json({ ok: false, error: 'Bad request.' }, 400);
  if (data.on) {
    await env.DB.prepare(
      'INSERT OR IGNORE INTO bookmarks (hash, kind, ref, created_at) VALUES (?1, ?2, ?3, ?4)'
    ).bind(me, kind, ref, Math.floor(Date.now() / 1000)).run();
  } else {
    await env.DB.prepare('DELETE FROM bookmarks WHERE hash = ?1 AND kind = ?2 AND ref = ?3').bind(me, kind, ref).run();
  }
  return json({ ok: true, on: !!data.on }, 200);
}

async function handleBookmarks(request: any, env: any) {
  const pre = await keyedGated(request, env, 'READ_LIMIT');
  if (pre instanceof Response) return pre;
  const { data, me } = pre;
  const p = Math.max(1, Math.floor(Number(data.p) || 1));
  const PER = 20;
  const rows = await env.DB.prepare(
    'SELECT b.kind, b.ref, b.created_at, ' +
    "  CASE b.kind WHEN 'topic' THEN c.title ELSE substr(w.body, 1, 140) END AS label " +
    'FROM bookmarks b ' +
    "LEFT JOIN comments c ON b.kind = 'topic' AND c.id = b.ref AND c.status = 'live' " +
    "LEFT JOIN wall_posts w ON b.kind = 'wall' AND w.id = b.ref AND w.status = 'live' " +
    'WHERE b.hash = ?1 AND (c.id IS NOT NULL OR w.id IS NOT NULL) ' +
    'ORDER BY b.created_at DESC LIMIT ?2 OFFSET ?3'
  ).bind(me, PER + 1, (p - 1) * PER).all();
  const items = (rows.results || []).slice(0, PER);
  return json({ ok: true, items, page: p, more: (rows.results || []).length > PER }, 200);
}

/* A member-safe recent-activity window: the last live forum posts across the
   PUBLIC rooms (never the back room), each under its topic's title. Cacheable,
   keyless, one query — "what happened since I left" for everyone. */
async function handleRecent(request: any, env: any, url: any) {
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.READ_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests. Slow down.' }, 429);
  const p = Math.max(1, Math.floor(Number(url.searchParams.get('p')) || 1));
  const PER = 20;
  const rows = await env.DB.prepare(
    'SELECT c.id, c.page, c.parent_id, c.author_hash, c.created_at, substr(c.body, 1, 200) AS body, ' +
    '  COALESCE(t.title, c.title) AS topic_title, COALESCE(t.id, c.id) AS topic_id ' +
    'FROM comments c LEFT JOIN comments t ON t.id = c.parent_id ' +
    "WHERE c.page LIKE 'board:%' AND c.page != ?1 AND c.status = 'live' " +
    "  AND (c.parent_id IS NULL OR t.status = 'live') " +
    'ORDER BY c.id DESC LIMIT ?2 OFFSET ?3'
  ).bind(ADMIN_CAT, PER + 1, (p - 1) * PER).all();
  let items = (rows.results || []).slice(0, PER);
  items = await withNames(env, items);
  return json({ ok: true, items, page: p, more: (rows.results || []).length > PER },
    200, cacheHeader(url));
}

/* Delete a post (and its comments + all their media) or a single comment. Author
   or admin only (Domain.Wall.canDelete). Hard delete — public content, no soft
   state to keep. */
async function handleWallDelete(request: any, env: any) {
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
    const row = await env.DB.prepare('SELECT post_id, author_hash, media_key, status FROM wall_comments WHERE id = ?1').bind(id).first();
    if (!row) return json({ ok: true }, 200);
    if (!Wall.canDelete(row.author_hash)(me)(admin)) return json({ ok: false, error: 'No.' }, 403);
    if (row.media_key) await purgeWallMedia(env, [row.media_key]);
    await env.DB.prepare('DELETE FROM wall_comments WHERE id = ?1').bind(id).run();
    await env.DB.prepare('DELETE FROM wall_comment_likes WHERE comment_id = ?1').bind(id).run();
    /* Decrement ONLY what was counted: the increment fires for a live,
       non-shadowbanned comment alone (handleWallComment / handleApprove), so
       discarding a held one — the pending_wall queue's routine action — must
       not steal a live comment from the post's count. */
    if (row.status === 'live' && !(await isShadowBanned(env, row.author_hash))) {
      await env.DB.prepare('UPDATE wall_posts SET comments = MAX(0, comments - 1) WHERE id = ?1').bind(row.post_id).run();
    }
    return json({ ok: true }, 200);
  }
  const row = await env.DB.prepare('SELECT author_hash, media_key FROM wall_posts WHERE id = ?1').bind(id).first();
  if (!row) return json({ ok: true }, 200);
  if (!Wall.canDelete(row.author_hash)(me)(admin)) return json({ ok: false, error: 'No.' }, 403);
  const keys = [];
  if (row.media_key) keys.push(row.media_key);
  const cm = await env.DB.prepare('SELECT media_key FROM wall_comments WHERE post_id = ?1 AND media_key IS NOT NULL').bind(id).all();
  (cm.results || []).forEach((r: any) => keys.push(r.media_key));
  if (keys.length) await purgeWallMedia(env, keys);
  await env.DB.prepare('DELETE FROM wall_comment_likes WHERE comment_id IN (SELECT id FROM wall_comments WHERE post_id = ?1)').bind(id).run();
  await env.DB.prepare('DELETE FROM wall_comments WHERE post_id = ?1').bind(id).run();
  await env.DB.prepare('DELETE FROM wall_likes WHERE post_id = ?1').bind(id).run();
  await env.DB.prepare('DELETE FROM wall_posts WHERE id = ?1').bind(id).run();
  return json({ ok: true }, 200);
}

/* Upload public post/comment/board media — ONE handler, parameterized by the
   upload context ('wall' | 'board'), each with its own admin kinds mask,
   per-kind byte caps (per-section override → legacy global), storage budget,
   and AI-scan toggle. Images are magic-byte-sniffed and — when the section's
   media_scan_* setting stands — AI-screened (LLaVA, like avatars, fail-open);
   video/audio are validated against the Domain.Media exact-mime whitelist
   (declared type — a container cannot be cheaply sniffed; the serving path
   defends with nosniff + a deny-all CSP). Stored UNencrypted under
   wall/<i|v|a>/<64hex> with the section stamped in wall_media.ctx (the
   accounting dimension; re-stamped at claim to follow the parent). Hardening
   (all of it load-bearing): the uploader must be an ESTABLISHED identity
   (uploads are not Turnstile-gated — the linking post is), and the store
   budget is checked with a LIVE per-section SUM so a flood is refused rather
   than discovered by a stale counter an hour later. */
async function mediaUpload(request: any, env: any, ctxKind: string) {
  if (!env.WALLMEDIA) return json({ ok: false, error: 'Media is unavailable.' }, 503);
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.POST_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests. Slow down.' }, 429);
  const settings = await getAppSettings(env);
  if (settings.media_enabled !== '1') return json({ ok: false, error: 'Media uploads are turned off.' }, 403);
  const allowed = mediaKindsFor(settings, ctxKind);
  if (!allowed.length) return json({ ok: false, error: 'Media uploads are turned off here.' }, 403);
  /* Pre-parse gate on the declared length: the kind is unknown until the form
     parses, so the ceiling is the largest cap among this context's kinds. */
  const maxPre = mediaMaxAcross(settings, allowed, ctxKind);
  const clen = Number(request.headers.get('Content-Length') || 0);
  if (clen && clen > maxPre + 8192) return json({ ok: false, error: 'That file is too large.' }, 413);
  let form;
  try { form = await request.formData(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  const key = String(form.get('key') || '');
  if (!key) return json({ ok: false, error: 'Bad request.' }, 400);
  const me = await sha256hex(key);
  const gate = await blockedReason(env, me, ip);
  if (gate) return blockedJson(gate);
  if (!(await isEstablished(env, me))) {
    return json({ ok: false, error: 'Attachments unlock after your first post or profile save.' }, 403);
  }
  const file = form.get('file');
  if (!file || typeof file === 'string') return json({ ok: false, error: 'No file.' }, 400);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!bytes.length) return json({ ok: false, error: 'Empty file.' }, 400);
  if (bytes.length > maxPre) return json({ ok: false, error: 'That file is too large.' }, 413);
  const declared = String(file.type || '');
  let kind = '', word = '', mime = '';
  const img = sniffImage(bytes);
  if (img && (!declared || declared.startsWith('image/'))) {
    /* The AI screen is a per-section admin toggle (media_scan_wall/_board; on
       by default). Fail-open inside screenImage is unchanged — the toggle only
       decides whether the screen runs at all. */
    if (mediaScanEnabled(settings, ctxKind) && !(await screenImage(env, bytes))) {
      return json({ ok: false, error: 'That image was declined by the safety check.' }, 422);
    }
    kind = 'i'; word = 'image'; mime = img.mime;
  } else if (Media.mimeAllowed('video')(declared)) { kind = 'v'; word = 'video'; mime = declared.slice(0, 60); }
  else if (Media.mimeAllowed('audio')(declared)) { kind = 'a'; word = 'audio'; mime = declared.slice(0, 60); }
  else return json({ ok: false, error: 'That file type cannot be shared here.' }, 400);
  if (allowed.indexOf(word) === -1) {
    return json({ ok: false, error: 'Only ' + allowed.join(', ') + ' can be shared here.' }, 400);
  }
  if (bytes.length > mediaKindMax(settings, word, ctxKind)) {
    return json({ ok: false, error: 'That ' + word + ' is over the ' + Math.floor(mediaKindMax(settings, word, ctxKind) / (1024 * 1024)) + ' MB limit.' }, 413);
  }
  /* LIVE store-budget check, scoped to THIS section's budget (the feed and the
     forum each own one since the 2026-08-02 split). Refusal is the policy; the
     95% valve in enforceWallMediaCap is only the emergency. */
  const used = await env.DB.prepare(
    "SELECT COALESCE(SUM(size), 0) AS total FROM wall_media WHERE COALESCE(ctx, 'wall') = ?1"
  ).bind(ctxKind).first();
  const cap = ctxKind === 'board'
    ? (Number(settings.media_cap_board_bytes) || Number(Media.defaults.capBoardBytes))
    : (Number(settings.media_cap_wall_bytes) || Number(Media.defaults.capWallBytes));
  if ((used.total || 0) + bytes.length > Math.floor(cap * 0.90)) {
    return json({ ok: false, error: 'Media storage is full right now. Try again later.' }, 507);
  }
  const objKey = 'wall/' + kind + '/' + randomHex(32);
  try { await env.WALLMEDIA.put(objKey, bytes, { httpMetadata: { contentType: mime } }); }
  catch { return json({ ok: false, error: 'Upload failed.' }, 500); }
  await env.DB.prepare('INSERT INTO wall_media (key, size, created_at, ctx) VALUES (?1, ?2, ?3, ?4)')
    .bind(objKey, bytes.length, Math.floor(Date.now() / 1000), ctxKind).run();
  return json({ ok: true, media_key: objKey, size: bytes.length, kind: word }, 200);
}

/* Serve public post media, keyless + cacheable, same-origin (like avatars).
   Board attachments ride the same door with one gate: a key whose linked
   comment sits in the back room answers the BYTE-IDENTICAL 404 a missing
   object gets (the standing indistinguishability law) — defense-in-depth, since
   handlePost refuses back-room attachments and a move-in purges, so normally no
   such key exists. caches.default saves R2 reads/CPU/latency on repeats (NOT
   worker invocations — a route's worker runs in front of the cache; the request
   budget's real protector is the browser cache via max-age). Only gate-passing
   2xx responses are ever put, so a cache hit can never leak a gated object. */
async function handleWallMediaGet(request: any, env: any, url: any, ctx?: any) {
  if (!env.WALLMEDIA) return new Response('gone', { status: 404 });
  const k = String(url.searchParams.get('key') || '');
  if (!WALL_MEDIA_RE.test(k)) return new Response('bad request', { status: 400 });
  const notFound = () => new Response('not found', { status: 404, headers: { 'Cache-Control': 'public, max-age=300' } });
  const cache = (caches as any).default;
  try { const hit = await cache.match(request); if (hit) return hit; } catch (e) { /* cache is best-effort */ }
  const obj = await env.WALLMEDIA.get(k);
  if (!obj) return notFound();
  try {
    const lk = await env.DB.prepare('SELECT ref_type, ref_id FROM wall_media WHERE key = ?1').bind(k).first();
    if (lk && lk.ref_type === 'board' && lk.ref_id != null) {
      const c = await env.DB.prepare('SELECT page FROM comments WHERE id = ?1').bind(lk.ref_id).first();
      if (c && c.page === ADMIN_CAT) return notFound();
    }
  } catch (e) { /* a failed linkage read must not take public media down */ }
  const resp = new Response(obj.body, { headers: {
    'Content-Type': (obj.httpMetadata && obj.httpMetadata.contentType) || 'application/octet-stream',
    'Cache-Control': 'public, max-age=86400',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'",
    'Cross-Origin-Resource-Policy': 'same-origin',
  } });
  if (ctx) { try { ctx.waitUntil(cache.put(request, resp.clone())); } catch (e) { /* best-effort */ } }
  return resp;
}

/* Delete public posts/comments older than `days` and purge their media. Shared by
   the cron (only when auto-prune is enabled) and the admin "prune now" button. */
async function handleWallPrune(request: any, env: any) {
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  if (!(await requireAdmin(env, String(data.key || '')))) return json({ ok: false, error: 'No.' }, 403);
  const s = await getAppSettings(env);
  const deleted = await runWallPrune(env, Number(data.days) || Number(s.wall_prune_days) || 365);
  return json({ ok: true, deleted }, 200);
}

/* Admin: purge EVERY media object belonging to one public section — 'wall'
   (the feed + member walls) or 'board' (the forum) — the sibling of the DM
   purge-all. The route names the section (no typo'd string ever reaches SQL),
   and because claim-time re-stamps ctx to follow ref_type, stamping every
   media-carrying parent row in the section's own tables is exact. The R2
   prefix is shared ('wall/'), so keys come from D1, not a bucket listing.
   Posts and their text stay — this retracts the BYTES, with the honest
   media_expired placeholder left behind. Progress commits PER BATCH (rows are
   deleted only after their R2 batch succeeded — an R2 failure keeps the D1
   handle, so nothing can leak unrecoverably), and each click is BOUNDED to
   stay inside the free-tier subrequest budget: a huge section reports
   `remaining` and the admin clicks again, each click making real progress.
   Parents are stamped and the counter zeroed only once the section is empty
   (a partial run must not orphan the surviving rows' pointers). Edge/browser
   caches may serve purged bytes up to a day, the standing property of every
   delete path. */
async function handleWallMediaPurge(request: any, env: any, section: string) {
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  if (!(await requireAdmin(env, String(data.key || '')))) return json({ ok: false, error: 'No.' }, 403);
  let deleted = 0;
  /* ~12 subrequests per 500-key batch (1 SELECT + 1 R2 delete + 10 row
     DELETEs); two batches per click keeps the whole request — including the
     final click's parent stamps — comfortably under the ~50 free-tier wall. */
  for (let round = 0; round < 2; round++) {
    const batch = await env.DB.prepare(
      "SELECT key FROM wall_media WHERE COALESCE(ctx, 'wall') = ?1 ORDER BY key LIMIT 500"
    ).bind(section).all();
    const keys = (batch.results || []).map((o: any) => o.key);
    if (!keys.length) break;
    try { if (env.WALLMEDIA) await env.WALLMEDIA.delete(keys); }
    catch (e) { break; /* keep these rows — the D1 handle IS the retry state */ }
    for (let i = 0; i < keys.length; i += 50) {
      const chunk = keys.slice(i, i + 50);
      const ph = inList(chunk.length);
      try { await env.DB.prepare('DELETE FROM wall_media WHERE key IN (' + ph + ')').bind(...chunk).run(); } catch (e) { /* re-tried next click */ }
    }
    deleted += keys.length;
  }
  const left = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM wall_media WHERE COALESCE(ctx, 'wall') = ?1"
  ).bind(section).first();
  const remaining = (left && left.n) || 0;
  if (!remaining) {
    if (section === 'board') {
      await env.DB.prepare('UPDATE comments SET media_key = NULL, media_size = NULL, media_expired = 1 WHERE media_key IS NOT NULL').run();
    } else {
      await env.DB.prepare('UPDATE wall_posts SET media_key = NULL, media_size = NULL, media_expired = 1 WHERE media_key IS NOT NULL').run();
      await env.DB.prepare('UPDATE wall_comments SET media_key = NULL, media_size = NULL, media_expired = 1 WHERE media_key IS NOT NULL').run();
    }
    const counter = section === 'board' ? 'board_media_bytes' : 'wall_media_bytes';
    try {
      await env.DB.prepare(
        'INSERT INTO app_settings (k, v, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(k) DO UPDATE SET v = ?2, updated_at = ?3'
      ).bind(counter, '0', Math.floor(Date.now() / 1000)).run();
    } catch (e) { /* display-only */ }
    appSettingsCache.at = 0; appSettingsCache.s = null;
  }
  return json({ ok: true, deleted, remaining }, 200);
}

/* The notification badge count: unread rows for this reader, one indexed COUNT.
   Like the DM poll it fires at most once per ninety seconds and doubles as the
   logout trip for a locked or banned identity. */
async function handleNotifUnread(request: any, env: any) {
  const pre = await keyedGated(request, env, 'READ_LIMIT');
  if (pre instanceof Response) return pre;
  const { ip, data, key, me } = pre;
  const row = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM notifications WHERE recipient_hash = ?1 AND read_at IS NULL'
  ).bind(me).first();
  return json({ ok: true, unread: row.n || 0 }, 200);
}

/* The notification list, newest first, paged by twenty. Each row carries the
   thread title, a snippet of the post, and the actor's nick so the client can
   render "X replied/mentioned you in <title>" and jump to the exact comment. */
async function handleNotifList(request: any, env: any) {
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
    "CASE WHEN n.kind IN ('wall','wall-like') THEN substr(wp.body, 1, 140) ELSE substr(c.body, 1, 140) END AS snippet " +
    'FROM notifications n ' +
    "LEFT JOIN comments t ON t.id = n.topic_id AND n.kind NOT IN ('wall','wall-like') " +
    "LEFT JOIN comments c ON c.id = n.comment_id AND n.kind NOT IN ('wall','wall-like') " +
    "LEFT JOIN wall_posts wp ON wp.id = n.comment_id AND n.kind IN ('wall','wall-like') " +
    'LEFT JOIN profiles pr ON pr.hash = n.actor_hash ' +
    'WHERE n.recipient_hash = ?1 ORDER BY n.id DESC LIMIT ?2 OFFSET ?3'
  ).bind(me, NOTIF_PER_PAGE, (p - 1) * NOTIF_PER_PAGE).all();
  const totals = await env.DB.prepare(
    'SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN read_at IS NULL THEN 1 ELSE 0 END), 0) AS unread ' +
    'FROM notifications WHERE recipient_hash = ?1'
  ).bind(me).first();
  const items = (rows.results || []).map((r: any) => Object.assign({}, r,
    { actor_assigned: r.actor_hash ? displayName(r.actor_hash) : null }));
  return json({ ok: true, items, total: totals.n || 0,
    unread_total: totals.unread || 0, page: p, per: NOTIF_PER_PAGE }, 200);
}

/* Opening the list marks everything read, the notifications analogue of opening
   a DM thread. One write; the badge clears on the client's next poll. */
async function handleNotifRead(request: any, env: any) {
  const pre = await keyedGated(request, env, 'POST_LIMIT');
  if (pre instanceof Response) return pre;
  const { ip, data, key, me } = pre;
  await env.DB.prepare(
    'UPDATE notifications SET read_at = ?2 WHERE recipient_hash = ?1 AND read_at IS NULL'
  ).bind(me, Math.floor(Date.now() / 1000)).run();
  return json({ ok: true }, 200);
}

/* Watch, unwatch, or read the state of a thread. Posting a reply auto-watches;
   this is the manual toggle in the topic header. 'status' is a cheap read, so it
   rides READ_LIMIT; the mutations ride the stricter write limit. */
async function handleWatch(request: any, env: any) {
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
async function handleBoardUnread(request: any, env: any) {
  const pre = await keyedGated(request, env, 'READ_LIMIT');
  if (pre instanceof Response) return pre;
  const { ip, data, key, me } = pre;
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
  const byCat: any = {};
  let total = 0;
  for (const r of (rows.results || [])) { byCat[String(r.page).slice(6)] = r.n; total += r.n; }
  return json({ ok: true, total, byCat }, 200);
}

/* The unread topic ids in one category, so the listing can mark them "new". */
async function handleBoardReads(request: any, env: any) {
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
  return json({ ok: true, unread: (rows.results || []).map((r: any) => r.id) }, 200);
}

/* Mark one thread read — fired on opening a topic. */
async function handleBoardRead(request: any, env: any) {
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
async function handleBoardReadAll(request: any, env: any) {
  const pre = await keyedGated(request, env, 'POST_LIMIT');
  if (pre instanceof Response) return pre;
  const { ip, data, key, me } = pre;
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
async function handleDmBlock(request: any, env: any) {
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
async function handleDmDelete(request: any, env: any) {
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
      await purgeMediaKeys(env, (media.results || []).map((r: any) => r.media_key).filter(Boolean));
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
async function handleDmDirectory(request: any, env: any, url: any) {
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
  const users = (rows.results || []).map((r: any) => Object.assign({}, r,
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
async function handleDmPubkey(request: any, env: any) {
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

async function handleProfileAdminEdit(request: any, env: any) {
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

async function handleAvatarUpload(request: any, env: any) {
  if (!env.AVATARS) return json({ ok: false, error: 'Avatars are not enabled yet. Soon.' }, 503);
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.POST_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests. Wait a minute and try again.' }, 429);
  const declared = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > MAX_AVATAR_BYTES + 8192) {
    return json({ ok: false, error: 'The image is too large. 1 MB at most.' }, 413);
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
  if (file.size > MAX_AVATAR_BYTES) return json({ ok: false, error: 'The image is too large. 1 MB at most.' }, 413);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length > MAX_AVATAR_BYTES) return json({ ok: false, error: 'The image is too large. 1 MB at most.' }, 413);
  /* JPEG alone is stored, whatever any client claims or an old cached
     client sends. The canvas step upstream re-encodes every source to JPEG,
     so an honest upload always passes; everything else is refused here. */
  const img = sniffImage(bytes);
  if (!img || img.mime !== 'image/jpeg') return json({ ok: false, error: 'Avatars must be JPEG.' }, 400);
  if (img.width !== img.height || img.width < AVATAR_MIN || img.width > AVATAR_MAX) {
    return json({ ok: false, error: 'The avatar must be square, between ' + AVATAR_MIN + ' and ' + AVATAR_MAX + ' pixels.' }, 400);
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
async function handleAvatarDelete(request: any, env: any) {
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
async function handleAvatarGet(request: any, env: any, url: any) {
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

/* A member reports a post to the moderators. The post stays live; the report
   only surfaces it in the Activity audit's Reported queue. One report per member
   per post (INSERT OR IGNORE against the UNIQUE), so no brigade can inflate a
   count or hide anything. An optional short reason rides along. */
async function handleReport(request: any, env: any) {
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
async function handleReportDismiss(request: any, env: any) {
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
async function handleApprove(request: any, env: any, ctx: any) {
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.READ_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests.' }, 429);
  const key = String(data.key || '');
  const id = Number(data.id);
  if (!Number.isInteger(id) || id < 1) return json({ ok: false, error: 'Bad request.' }, 400);
  if (!(await requireAdmin(env, key))) return json({ ok: false, error: 'No.' }, 403);
  /* Held FEED content (wall_posts / wall_comments — surfaced in the queue as
     pending_wall since 2026-08-02; before that a held wall post vanished into
     limbo, stored pending but shown nowhere). kind names the table; absent =
     the classic comments path below, byte-identical. Approval mirrors the
     posting path exactly: the comment-count bump and the live broadcast fire
     only for a live, non-shadowbanned author (a muted bump betrays the mute),
     reusing the same wall-post/wall-comment events open feeds already merge. */
  const wkind = String(data.kind || '');
  if (wkind === 'wall-post' || wkind === 'wall-comment') {
    if (wkind === 'wall-comment') {
      const row = await env.DB.prepare(
        "UPDATE wall_comments SET status = 'live' WHERE id = ?1 AND status = 'pending' RETURNING id, post_id, author_hash"
      ).bind(id).first();
      if (row && !(await isShadowBanned(env, row.author_hash))) {
        await env.DB.prepare('UPDATE wall_posts SET comments = comments + 1 WHERE id = ?1').bind(row.post_id).run();
        publishLive(env, ctx, { v: 1, t: 'wall-comment', scopes: ['feed:global'], post: row.post_id });
      }
      return json({ ok: true, approved: !!row }, 200);
    }
    const row = await env.DB.prepare(
      "UPDATE wall_posts SET status = 'live' WHERE id = ?1 AND status = 'pending' RETURNING id, author_hash"
    ).bind(id).first();
    if (row && !(await isShadowBanned(env, row.author_hash))) {
      publishLive(env, ctx, { v: 1, t: 'wall-post', scopes: ['feed:global'], id });
    }
    return json({ ok: true, approved: !!row }, 200);
  }
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
        'c.body, c.created_at, c.media_key FROM comments c LEFT JOIN profiles pr ON pr.hash = c.author_hash WHERE c.id = ?1'
      ).bind(id).first();
      if (!c) return [];
      /* A muted author's approved post enters the stream silently — the read
         paths already hide it; it must not announce itself either. */
      if (await isShadowBanned(env, c.author_hash)) return [];
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
            avatar: c.avatar || null, faith: c.faith || null, body: c.body, created_at: c.created_at,
            media_key: c.media_key || null } },
        { v: 1, t: 'topic-stats', scopes: ['cat:' + catKey, 'board:index'], cat: catKey,
          topic_id: topicId, title: (t && t.title) || null, replies: (t && t.replies) || 0,
          last: (t && t.last) || c.created_at, last_id: c.id, author_hash: c.author_hash, nick: c.nick || null },
      ];
    });
  }
  return json({ ok: true, approved: !!row }, 200);
}

/* The pending-review queue: every held comment, newest first. */
async function handlePending(request: any, env: any) {
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.READ_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests.' }, 429);
  if (!(await requireAdmin(env, String(data.key || '')))) return json({ ok: false, error: 'No.' }, 403);
  const rows = await env.DB.prepare(
    "SELECT c.id, c.page, c.parent_id, c.title, c.author_hash, pr.nick, c.body, c.created_at, c.ai_verdict, c.media_key " +
    "FROM comments c LEFT JOIN profiles pr ON pr.hash = c.author_hash " +
    "WHERE c.status = 'pending' ORDER BY c.id DESC LIMIT 200"
  ).all();
  /* Held FEED content rides beside (never inside) `pending`: an old cached
     client ignores the unknown field, while merging wall rows into `pending`
     would send their ids down the comments approve path — a cross-table id
     collision. kind 'post'|'comment' names the wall table; approve takes it
     back as 'wall-post'/'wall-comment', delete rides the existing /wall/delete. */
  const wp = await env.DB.prepare(
    "SELECT id, kind, post_id, author_hash, nick, body, created_at, media_key FROM (" +
    "SELECT p.id, 'post' AS kind, NULL AS post_id, p.author_hash, pr.nick, p.body, p.created_at, p.media_key " +
    "FROM wall_posts p LEFT JOIN profiles pr ON pr.hash = p.author_hash WHERE p.status = 'pending' " +
    "UNION ALL " +
    "SELECT c.id, 'comment' AS kind, c.post_id, c.author_hash, pr.nick, c.body, c.created_at, c.media_key " +
    "FROM wall_comments c LEFT JOIN profiles pr ON pr.hash = c.author_hash WHERE c.status = 'pending'" +
    ") ORDER BY created_at DESC LIMIT 200"
  ).all();
  return json({ ok: true, pending: rows.results, pending_wall: wp.results || [] }, 200);
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

/* ---- Admin observation of merecat Q&A (2026-07-29). The terms disclose that
   questions may be reviewed for the improvement of the service; these two
   admin-keyed, READ-ONLY endpoints let an admin observe how members use the
   librarian (to guide what to teach it next) WITHOUT participating. They only
   ever SELECT — no prune, no write, nothing touched. This deliberately adds
   the admin-read path the design once withheld, now that the terms allow it. */
async function handleMerecatAdminThreads(request: any, env: any) {
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
  const hashes = [...new Set(threads.map((t: any) => t.hash).filter(Boolean))];
  const nicks: any = {};
  if (hashes.length) {
    const ph = inList(hashes.length);
    const prof = await env.DB.prepare('SELECT hash, nick FROM profiles WHERE hash IN (' + ph + ')').bind(...hashes).all();
    for (const r of (prof.results || [])) nicks[r.hash] = r.nick;
  }
  for (const t of threads) t.nick = nicks[t.hash] || null;
  return json({ ok: true, threads, total: (total && total.n) || 0, page: pg, per }, 200);
}

async function handleMerecatAdminThread(request: any, env: any) {
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
async function handleMerecatBackends(request: any, env: any) {
  let data: any = {};
  try { data = await request.json(); } catch { return json({ ok: false, error: 'No.' }, 403); }
  if (!(await requireAdmin(env, String(data.key || '')))) return json({ ok: false, error: 'No.' }, 403);
  const cfg = await merecatConfig(env);
  const day = merecatDay();
  const g = await env.LIBDB.prepare('SELECT q FROM usage WHERE day = ?1').bind(day).first();
  const today = (g && g.q) || 0;
  let local: any = { online: false };
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
          const h: any = await r.json();
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
async function handleMerecatChats(request: any, env: any) {
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

async function handleMerecatChat(request: any, env: any) {
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

async function handleMerecatChatDelete(request: any, env: any) {
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
async function handleMerecatChatSave(request: any, env: any) {
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
async function handleMerecatIngest(request: any, env: any) {
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
              text: slice.map((r: any) => (r.heading ? r.heading + ': ' : '') + String(r.text || '').slice(0, 1800)),
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
async function handleMerecatMention(request: any, env: any) {
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
async function handleMerecatForward(request: any, env: any) {
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
async function handleMerecatUsage(request: any, env: any) {
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
async function handleMerecatAbout(request: any, env: any) {
  /* Admin-only since the public transparency panel retired (2026-07-28):
     this returns the persona verbatim and the whole roster, and the owner
     wills neither public. The administration page is the one consumer. */
  let data: any = {};
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
  const out: any = {
    ok: true,
    model: cfg.model, topk: cfg.topk,
    user_daily: cfg.user_daily, user_cap_on: cfg.user_cap_on, global_daily: cfg.global_daily,
    backend: cfg.backend,
    persona: cfg.persona,
    chunks: list.reduce((n: any, w: any) => n + (w.chunks || 0), 0),
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
async function handleMerecatWorks(request: any, env: any) {
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
async function handleMerecatConfigSet(request: any, env: any) {
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  if (!(await requireAdmin(env, String(data.key || '')))) return json({ ok: false, error: 'No.' }, 403);
  const stmts: any[] = [];
  const put = (k: any, v: any) => stmts.push(env.LIBDB.prepare(
    'INSERT INTO config (k, v) VALUES (?1, ?2) ON CONFLICT(k) DO UPDATE SET v = ?2').bind(k, String(v)));
  if (typeof data.persona === 'string' && data.persona) put('persona', data.persona);
  const cfg = data.config || {};
  for (const k of ['model', 'backend', 'failover', 'mention_effort', 'user_cap_on', 'user_daily', 'global_daily', 'topk', 'max_tokens', 'persona_file_hash']) {
    if (cfg[k] != null) put(k, cfg[k]);
  }
  if (!stmts.length) return json({ ok: false, error: 'Nothing to set.' }, 400);
  await env.LIBDB.batch(stmts);
  merecatConfigCache.at = 0; merecatConfigCache.cfg = null; // this isolate refreshes now; others lag out the 5-min TTL
  return json({ ok: true, set: stmts.length }, 200);
}

/* Usage counters for the admin: the last fourteen days, questions and rough
   token spend, distinct askers per day. Counters only — no question text. */
async function handleMerecatStats(request: any, env: any) {
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
  const byDay: any = {};
  for (const r of users.results || []) byDay[r.day] = r.users;
  const days = (use.results || []).map((r: any) => ({ ...r, users: byDay[r.day] || 0 }));
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
/* sanitizeScopes (the WebSocket subscription allowlist) lives in src/pure.js —
   security-critical and unit-tested there. BOARD_CATS is passed in so the pure
   helper stays dependency-free. */

/* The two Durable Objects live in ./durable.ts; re-exported so wrangler
   finds BoardHub/ChatRoom on the main module. */
export { BoardHub, ChatRoom } from './durable.js';
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

/* The single send primitive: EVERY board event reaches the hub through here, so
   the back-room privacy gate is one predicate in one place and a future
   subscriber (webhook / Discord / Matrix) is a single addition here — no forum
   handler ever changes. Returns a promise; env-guarded (no-op without the DO). */
async function handleMerecatAskInit(request: any, env: any) {
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
async function handleMerecatLive(request: any, env: any) {
  if (!originOk(request, env)) return new Response('bad origin', { status: 403 });
  if (!env.CHAT) return new Response('unavailable', { status: 503 });
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.CONNECT_LIMIT.limit({ key: ip });
  if (!success) return new Response('slow down', { status: 429 });
  const cid = Number(new URL(request.url).searchParams.get('chat')) || 0;
  if (!cid) return new Response('need a conversation id (call ask-init first)', { status: 400 });
  return env.CHAT.get(env.CHAT.idFromName('chat:' + cid)).fetch(request);
}

/* Sets one attribute on a matched element (HTMLRewriter handler). Used to
   overwrite the static profile.html OG tags with per-profile values. */
async function handleHandleCard(request: any, env: any, url: any) {
  const raw = decodeURIComponent(url.pathname.slice(2)).replace(/\/+$/, '');
  const pageReq = new URL('/profile.html', url.origin).toString();
  try {
    const originResp = await fetch(pageReq, { headers: { Accept: 'text/html' } });
    if (!originResp.ok) return originResp;
    let prof = null;
    const v = Handle.validate(raw);
    if (v.ok) {
      const row = await env.DB.prepare('SELECT hash, nick, bio, avatar, handle FROM profiles WHERE handle = ?1').bind(v.handle).first();
      if (row && row.hash) prof = row;
    }
    if (!prof) return originResp;   // unknown handle: the plain page (client shows "No such profile")
    const name = prof.nick || displayName(prof.hash);
    const title = name + ' (@' + prof.handle + ')';
    const desc = (prof.bio ? String(prof.bio).replace(/\s+/g, ' ').trim().slice(0, 200) : '')
      || ('A member of the Mere Catholicity community. @' + prof.handle);
    const image = prof.avatar
      ? url.origin + '/api/comments/avatar?hash=' + prof.hash + '&v=' + encodeURIComponent(prof.avatar)
      : url.origin + '/cover.jpg';
    const pageUrl = url.origin + '/@' + prof.handle;
    return new HTMLRewriter()
      .on('meta[property="og:title"]', new MetaAttr(title))
      .on('meta[name="twitter:title"]', new MetaAttr(title))
      .on('meta[property="og:description"]', new MetaAttr(desc))
      .on('meta[name="twitter:description"]', new MetaAttr(desc))
      .on('meta[name="description"]', new MetaAttr(desc))
      .on('meta[property="og:image"]', new MetaAttr(image))
      .on('meta[name="twitter:image"]', new MetaAttr(image))
      .on('meta[property="og:url"]', new MetaAttr(pageUrl))
      .on('meta[property="og:type"]', new MetaAttr('profile'))
      .on('title', new TitleText(title + ' | Mere Catholicity'))
      .transform(originResp);
  } catch {
    /* Never break /@handle: serve the plain page, or redirect to the ?u= form. */
    try {
      return await fetch(pageReq, { headers: { Accept: 'text/html' } });
    } catch {
      return Response.redirect(new URL('/profile.html?u=' + encodeURIComponent(raw), url.origin).toString(), 302);
    }
  }
}

/* Declarative route table (was a 91-branch if-chain in fetch). Every entry
   is (method, exact path, handler thunk); the fn copies the original call
   verbatim so args are identical. Matched in order, but every (method,path)
   pair is unique so order is immaterial. The 4 special branches (/@ prefix,
   POST origin guard, the two websocket upgrades) stay explicit in fetch. */
type Route = { m: string; p: string;
  fn: (request: Request, env: Env, ctx: ExecutionContext, url: URL) => Promise<Response> | Response };
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
  { m: 'POST', p: '/api/comments/dm/block', fn: (request, env, ctx, url) => handleDmBlock(request, env) },
  { m: 'POST', p: '/api/comments/dm/delete', fn: (request, env, ctx, url) => handleDmDelete(request, env) },
  { m: 'GET', p: '/api/comments/dm/directory', fn: (request, env, ctx, url) => handleDmDirectory(request, env, url) },
  { m: 'POST', p: '/api/comments/dm/pubkey', fn: (request, env, ctx, url) => handleDmPubkey(request, env) },
  { m: 'POST', p: '/api/comments/dm/ttl', fn: (request, env, ctx, url) => handleDmTtl(request, env, ctx) },
  { m: 'POST', p: '/api/comments/dm/save', fn: (request, env, ctx, url) => handleDmSave(request, env) },
  { m: 'POST', p: '/api/comments/dm/edit', fn: (request, env, ctx, url) => handleDmEdit(request, env, ctx) },
  { m: 'POST', p: '/api/comments/dm/redact', fn: (request, env, ctx, url) => handleDmRedact(request, env, ctx) },
  { m: 'POST', p: '/api/comments/dm/media', fn: (request, env, ctx, url) => handleDmMediaUpload(request, env) },
  { m: 'POST', p: '/api/comments/dm/media/get', fn: (request, env, ctx, url) => handleDmMediaGet(request, env) },
  { m: 'POST', p: '/api/comments/dm/media/purge', fn: (request, env, ctx, url) => handleDmMediaPurge(request, env) },
  { m: 'POST', p: '/api/comments/admin/settings', fn: (request, env, ctx, url) => handleAdminSettings(request, env) },
  { m: 'POST', p: '/api/comments/admin/discord/list', fn: (request, env, ctx, url) => handleAdminDiscordList(request, env) },
  { m: 'POST', p: '/api/comments/admin/discord/add', fn: (request, env, ctx, url) => handleAdminDiscordAdd(request, env) },
  { m: 'POST', p: '/api/comments/admin/discord/delete', fn: (request, env, ctx, url) => handleAdminDiscordDelete(request, env) },
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
  { m: 'POST', p: '/api/comments/wall/like', fn: (request, env, ctx, url) => handleWallLike(request, env, ctx) },
  { m: 'POST', p: '/api/comments/wall/comment/like', fn: (request, env, ctx, url) => handleWallCommentLike(request, env) },
  { m: 'POST', p: '/api/comments/wall/likers', fn: (request, env, ctx, url) => handleWallLikers(request, env) },
  { m: 'POST', p: '/api/comments/wall/prune', fn: (request, env, ctx, url) => handleWallPrune(request, env) },
  { m: 'GET', p: '/api/comments/wall/media', fn: (request, env, ctx, url) => handleWallMediaGet(request, env, url, ctx) },
  { m: 'POST', p: '/api/comments/wall/media', fn: (request, env, ctx, url) => mediaUpload(request, env, 'wall') },
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
    ctx.waitUntil(
      sweepExpiredDms(env)
        .then(() => pruneIdentityIps(env))
        .then(() => pruneComments(env))
        .then(() => sweepDms(env))
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


