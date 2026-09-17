/* comments-worker/src/routes/board.ts — the forum: the page resolver, the board and topic reads, the post and the edit, the self-delete, the RSS feed, the journal, the fingerprint drawer, search, the back room, moderation and moves, trust, the audit, watch and the read marks, reports, approval and the pending queue.
   Every handler here moved verbatim from index.ts (2026-09-16, the route split);
   index.ts keeps the ROUTES table and imports what it mounts. */
import * as Comments from '../../../purescript/output/Domain.Comments/index.js';
import { ipKey } from '../pure.js';
import { inList, withNames, postCountsFor } from '../db.ts';
import {
  ADMIN_CAT,
  CONTROL_RE,
  IP_SHOW_DAYS,
  MAX_BODY,
  MAX_TITLE,
  MERECAT_BOT,
  SEARCH_PER_PAGE,
  blockedJson,
  blockedReason,
  boardCatPayload,
  boardFloor,
  boardKey,
  commentsJournalOn,
  commentsPageOn,
  broadcastBoard,
  buildMatch,
  cacheHeader,
  cleanFaith,
  deliverNotifications,
  displayName,
  getAppSettings,
  mediaKindsFor,
  isAdminHash,
  isTrusted,
  journalArticle,
  journalKey,
  journalKeyId,
  json,
  keyedGated,
  merecatMentioned,
  metaForHash,
  normalizePage,
  stampReactions,
  parseOS,
  publishLive,
  sendToHub,
  purgeWallMedia,
  recordIps,
  refreshTopicStats,
  requireAdmin,
  shadowExcl,
  isShadowBanned,
  screen,
  sendSystemDm,
  sha256hex,
  siteBase,
  sweepJournalComments,
  topicViewPayload,
  verifyTurnstile,
  viewLink,
  wallClaimMedia,
  xmlEscape,
  deliverDiscordFeedHooks,
  notifUnreadCount,
  notifyDiscordForum,
  gated,
  adminGated,
  readLimited,
  registerMember,
} from '../lib.ts';
import { merecatMentionKick } from './merecat.ts';

/* Resolve a comments read/write target to its page key, or null when the
   caller may not have it: an unknown path, one of the site's own pages whose
   section the admin has switched off, or a 'journal:<id>' whose switch is off
   or whose article is not live in the standing journal. ONE rule for the read,
   the write, the edit and the feed, so no two can disagree — and every caller
   answers null exactly as it answers an unknown page, because a closed section
   must be indistinguishable from a page that never had one. */
async function commentsPageKey(env: any, raw: any): Promise<string | null> {
  const s = await getAppSettings(env);
  const page = normalizePage(raw);
  if (page) return commentsPageOn(s, page) ? page : null;
  const id = journalKeyId(raw);
  if (id == null || !commentsJournalOn(s)) return null;
  return (await journalArticleLive(env, s, id)) ? journalKey(raw) : null;
}

async function handleGet(request: Request, env: any, url: any) {
  const limited = await readLimited(request, env, { limited: 'Too many requests. Slow down.' });
  if (limited instanceof Response) return limited;
  const page = await commentsPageKey(env, url.searchParams.get('page'));
  if (!page) return json({ ok: false, error: 'Unknown page.' }, 400);
  const rows = await env.DB.prepare(
    'SELECT c.id, c.author_hash, pr.nick, pr.signature, pr.avatar, pr.faith, c.body, c.created_at, c.edited_at ' +
    'FROM comments c LEFT JOIN profiles pr ON pr.hash = c.author_hash ' +
    "WHERE c.page = ?1 AND c.status = 'live' AND " + shadowExcl('c') + " ORDER BY c.id LIMIT 500"
  ).bind(page).all();
  const counts = await postCountsFor(env, (rows.results || []).map((r: any) => r.author_hash));
  const comments = (rows.results || []).map((r: any) => withNames(r, counts[r.author_hash] || 0));
  await stampReactions(env, 'post', comments, null);   // the tallies; the viewer's own ride /reacts
  return json({ ok: true, anon: env.ALLOW_ANON === 'true', comments: comments }, 200,
    cacheHeader(url));
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
    /* A site page or a journal article — only with its section open, by the
       same rule the read applies (a closed one reads as unknown). */
    page = await commentsPageKey(env, data.page);
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
     with the admin /api/merecat/mention lever). Deferred, and kicked into the
     ChatRoom DO: the generation must NOT run in this waitUntil, which the
     runtime cancels ~30s after the response while a local-backend answer takes
     minutes (the 2026-08-03 lost-mention postmortem). */
  if (status === 'live' && !muted && authorHash && authorHash !== MERECAT_BOT.hash &&
      merecatMentioned(body)) {
    ctx.waitUntil(merecatMentionKick(env, inserted.id));
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
  /* A deleted journal article takes its comments with it: the head or a reply
     of the journal topic retires every 'journal:<id>' row whose article is
     gone (idempotent; the monthly cron is the backstop). The head deleted is
     the whole journal deleted, so its thread's articles retire too. */
  if (boardKey(row.page)) {
    const jt = Math.floor(Number((await getAppSettings(env)).journal_topic) || 0);
    if (jt > 0 && id === jt) await sweepJournalComments(env, id);
    else if (jt > 0 && Number(row.parent_id) === jt) await sweepJournalComments(env);
  }
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

async function handleFeed(request: Request, env: any, url: any) {
  const limited = await readLimited(request, env, { plain: true });
  if (limited instanceof Response) return limited;
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
    /* A page feed exists only while its section is open (the same rule as the
       read); a journal article's comments feed rides its 'journal:<id>' key. */
    page = cat ? boardKey('board:' + cat) : await commentsPageKey(env, url.searchParams.get('page'));
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
      : name + ' on ' + pageHref;
    return '<item><title>' + xmlEscape(itemTitle) + '</title>' +
      '<link>' + xmlEscape(link) + '</link>' +
      '<guid isPermaLink="true">' + xmlEscape(link) + '</guid>' +
      '<pubDate>' + new Date(c.created_at * 1000).toUTCString() + '</pubDate>' +
      '<description>' + xmlEscape(c.body) + '</description></item>';
  }).join('');
  const isBoard = page.indexOf('board:') === 0;
  const pageHref = Comments.pageHref(page);   // 'journal:<id>' reads as the article's permalink
  const feedTitle = topicRow
    ? topicRow.title + ' - Catholicity Board - merecatholicity.com'
    : isBoard
    ? 'Catholicity Board - ' + page.slice(6) + ' - merecatholicity.com'
    : 'Comments on ' + pageHref + ' - merecatholicity.com';
  const feedLink = topicRow ? siteBase(env) + '/community.html?topic=' + topicRow.id
    : isBoard ? siteBase(env) + '/community.html?cat=' + page.slice(6) : siteBase(env) + pageHref;
  const xml = '<?xml version="1.0" encoding="UTF-8"?>' +
    '<rss version="2.0"><channel>' +
    '<title>' + xmlEscape(feedTitle) + '</title>' +
    '<link>' + xmlEscape(feedLink) + '</link>' +
    '<description>' + xmlEscape(isBoard ? 'Topics and replies' : 'Reader comments on ' + pageHref) + '</description>' +
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
   optional leading-heading title + the rest (journalArticle). Both shapes
   carry `comments`: whether the admin has opened a comments section under
   every article — the client mounts one, keyed 'journal:<id>', on that word
   alone, and the worker's commentsPageKey holds the same rule at the read. */
const JOURNAL_PER_PAGE = 6;

async function handleJournal(request: Request, env: any, url: any) {
  const limited = await readLimited(request, env, { limited: 'Too many requests. Slow down.' });
  if (limited instanceof Response) return limited;
  const s = await getAppSettings(env);
  const topic = await journalTopic(env, s);
  if (!topic) return json({ ok: false, error: 'The journal is not available.' }, 404, cacheHeader(url));
  const topicId = topic.id;
  const commentsOn = commentsJournalOn(s);
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
      ok: true, journal: topic.title, comments: commentsOn,
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
  return json({ ok: true, journal: topic.title, comments: commentsOn, articles, total: totalRow.n, page: p, per: JOURNAL_PER_PAGE },
    200, cacheHeader(url));
}

/* The journal's topic, if the journal stands: journal_enabled on, and the
   topic a live board topic outside the back room by an unmuted author. The
   head row (id, page, title, body, created_at) or null. */
async function journalTopic(env: any, s: any) {
  const topicId = Math.floor(Number(s.journal_topic) || 0);
  if (s.journal_enabled !== '1' || topicId < 1) return null;
  const topic = await env.DB.prepare(
    "SELECT c.id, c.page, c.title, c.body, c.created_at FROM comments c " +
    "WHERE c.id = ?1 AND c.parent_id IS NULL AND c.status = 'live' AND " + shadowExcl('c')
  ).bind(topicId).first();
  if (!topic || !boardKey(topic.page) || topic.page === ADMIN_CAT) return null;
  return topic;
}

/* Is this post a live article of the standing journal — its head, or one of
   its live, unmuted replies? The ONE predicate the journal read and the
   comments gate share, so a section can stand only under an article a reader
   can open; anything else answers as an unknown page. */
async function journalArticleLive(env: any, s: any, id: number) {
  const topic = await journalTopic(env, s);
  if (!topic) return false;
  if (id === topic.id) return true;
  const row = await env.DB.prepare(
    "SELECT c.id FROM comments c WHERE c.id = ?1 AND c.parent_id = ?2 AND c.status = 'live' AND " + shadowExcl('c')
  ).bind(id, topic.id).first();
  return !!row;
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
  /* Yours, or any post when you are an admin (2026-09-12: an admin keeps edit
     AND delete over every member's post, as over every profile). The refusal
     is one string for "not yours" and "gone" alike. */
  const row = await env.DB.prepare(
    "SELECT page, parent_id, title, author_hash, ip, ua, os, tz, lang, created_at FROM comments WHERE id = ?1 AND status != 'deleted'"
  ).bind(id).first();
  const asAdmin = !!row && row.author_hash !== authorHash;
  if (!row || (asAdmin && !(await isAdminHash(env, authorHash)))) return json({ ok: false, error: 'Not yours, or already gone.' }, 403);
  /* A comment under a CLOSED section cannot be edited either — closed is closed
     to its author too — and the refusal is the one a missing row gives, so
     nothing about the switch is announced. Forum posts are not sections. */
  if (!boardKey(row.page) && !(await commentsPageKey(env, row.page))) {
    return json({ ok: false, error: 'Not yours, or already gone.' }, 403);
  }
  const { status, verdict } = await screen(env, body, await isTrusted(env, authorHash));
  const editedAt = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    'UPDATE comments SET body = ?1, status = ?2, ai_verdict = ?3, edited_at = ?4 WHERE id = ?5'
  ).bind(body, status, verdict, editedAt, id).run();
  if (asAdmin) console.log(JSON.stringify({ event: 'admin_post_edit', id, page: row.page, author: row.author_hash, by: authorHash }));
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
  const page = normalizePage(data.page) || boardKey(data.page) || journalKey(data.page);
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
async function handleBoardIndex(request: Request, env: any, url: any) {
  const limited = await readLimited(request, env, { limited: 'Too many requests. Slow down.' });
  if (limited instanceof Response) return limited;
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
async function handleBoardCat(request: Request, env: any, url: any) {
  const limited = await readLimited(request, env, { limited: 'Too many requests. Slow down.' });
  if (limited instanceof Response) return limited;
  const page = boardKey('board:' + url.searchParams.get('cat'));
  if (!page) return json({ ok: false, error: 'Unknown category.' }, 400);
  /* answer exactly as if the category did not exist: a prober learns nothing */
  if (page === ADMIN_CAT) return json({ ok: false, error: 'Unknown category.' }, 400, cacheHeader(url));
  const p = Math.min(1000, Math.max(1, Math.floor(Number(url.searchParams.get('p')) || 1)));
  return json(await boardCatPayload(env, page, p, url.searchParams.get('q')), 200, cacheHeader(url));
}

async function handleAuthorPosts(request: Request, env: any, url: any) {
  const limited = await readLimited(request, env, { limited: 'Too many requests. Slow down.' });
  if (limited instanceof Response) return limited;
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

async function handleSearch(request: Request, env: any, url: any) {
  const limited = await readLimited(request, env, { limited: 'Too many requests. Slow down.' });
  if (limited instanceof Response) return limited;
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
async function handleTopicView(request: Request, env: any, url: any) {
  const limited = await readLimited(request, env, { limited: 'Too many requests. Slow down.' });
  if (limited instanceof Response) return limited;
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

async function handleBoardAdmin(request: Request, env: any) {
  const pre = await adminGated(request, env, { bucket: 'READ_LIMIT', limited: 'Too many requests. Slow down.' });
  if (pre instanceof Response) return pre;
  const { data } = pre;
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
    /* Deleting the journal's own topic is deleting every article in it: the
       comments under the head AND under each reply retire now (the reply rows
       themselves stay, as orphans, exactly as before). */
    const jt = Math.floor(Number((await getAppSettings(env)).journal_topic) || 0);
    if (jt > 0 && id === jt) await sweepJournalComments(env, id);
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
      await sendToHub(env, { v: 1, t: 'new-topic',
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
  await registerMember(env, me);
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
async function handleBoardRead(request: Request, env: any) {
  const pre = await gated(request, env, { bucket: 'POST_LIMIT' });
  if (pre instanceof Response) return pre;
  const { ip, data, me } = pre;
  const topicId = Number(data.topic);
  if (!Number.isInteger(topicId) || topicId < 1) return json({ ok: false, error: 'Bad request.' }, 400);
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
  return json({ ok: true, notif_unread: await notifUnreadCount(env, me) }, 200);
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

/* A member reports a post to the moderators. The post stays live; the report
   only surfaces it in the Activity audit's Reported queue. One report per member
   per post (INSERT OR IGNORE against the UNIQUE), so no brigade can inflate a
   count or hide anything. An optional short reason rides along. */
async function handleReport(request: Request, env: any) {
  const pre = await gated(request, env, { bucket: 'POST_LIMIT', limited: 'Too many reports at once. Wait a minute.' });
  if (pre instanceof Response) return pre;
  const { ip, data, me } = pre;
  const id = Number(data.id);
  if (!Number.isInteger(id) || id < 1) return json({ ok: false, error: 'Bad request.' }, 400);
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
async function handlePending(request: Request, env: any) {
  const pre = await adminGated(request, env, { bucket: 'READ_LIMIT' });
  if (pre instanceof Response) return pre;
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

export {
  JOURNAL_PER_PAGE,
  commentsPageKey,
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
  journalArticleLive,
  journalTopic,
};
