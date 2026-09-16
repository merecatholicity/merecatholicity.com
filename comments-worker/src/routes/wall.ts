/* comments-worker/src/routes/wall.ts — the feed (wall) and the public reactions: the feed and wall reads, a post's page, post, comment, edit and delete, the bookmarks and the recent list, and the one reaction road every public target shares.
   Every handler here moved verbatim from index.ts (2026-09-16, the route split);
   index.ts keeps the ROUTES table and imports what it mounts. */
import * as Wall from '../../../purescript/output/Domain.Wall/index.js';
import { inList, withNames } from '../db.ts';
import {
  ADMIN_CAT,
  CONTROL_RE,
  MAX_BODY,
  MERECAT_BOT,
  WALL_COMMENT_COLS,
  WALL_PER_PAGE,
  WALL_POST_COLS,
  blockedJson,
  blockedReason,
  cacheHeader,
  deliverWallNotifications,
  displayName,
  getAppSettings,
  mediaKindsFor,
  isAdminHash,
  isTrusted,
  json,
  keyedGated,
  notifyReact,
  retractReactNotif,
  reactionOf,
  reactionsFor,
  myReactionsFor,
  isReactTarget,
  publishLive,
  purgeWallMedia,
  shadowExcl,
  isShadowBanned,
  screen,
  sha256hex,
  verifyTurnstile,
  wallClaimMedia,
  wallEnrich,
  wallReader,
  noSuchPage,
  notifUnreadCount,
  notifyDiscordFeed,
  notifyDiscordFeedComment,
  socialOff,
  readLimited,
} from '../lib.ts';

async function handleWallFeed(request: any, env: any) {
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  const r = await wallReader(request, env, data);
  if (r.resp) return r.resp;
  if (await socialOff(env)) return noSuchPage();
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
  if (await socialOff(env)) return noSuchPage();
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
  /* Switched off, a shared feed.html?post=<id> link gets the SAME refusal a
     deleted post gives, byte for byte — the reader cannot tell which it is. */
  if (await socialOff(env)) return json({ ok: false, error: 'That post is gone.' }, 404);
  /* A muted author's post reads as gone to everyone else; and any muted
     commenter's comments are dropped from a post others can still see. */
  const post = await env.DB.prepare('SELECT ' + WALL_POST_COLS + " FROM wall_posts p LEFT JOIN profiles pr ON pr.hash = p.author_hash WHERE p.id = ?1 AND p.status = 'live' AND " + shadowExcl('p')).bind(id).first();
  if (!post) return json({ ok: false, error: 'That post is gone.' }, 404);
  const crows = await env.DB.prepare('SELECT ' + WALL_COMMENT_COLS + " FROM wall_comments c LEFT JOIN profiles pr ON pr.hash = c.author_hash WHERE c.post_id = ?1 AND c.status = 'live' AND " + shadowExcl('c') + " ORDER BY c.id").bind(id).all();
  const enriched = await wallEnrich(env, [post].concat(crows.results || []), me);
  const comments = enriched.slice(1);
  /* Opening the post READS its bells (2026-09-12): a comment on it, a mention
     in it, a like, a reaction — and the fresh count rides back. */
  let notifUnread: number | undefined;
  if (me) {
    await env.DB.prepare(
      "UPDATE notifications SET read_at = ?3 WHERE recipient_hash = ?1 AND kind IN ('wall','wall-like','wall-react') AND comment_id = ?2 AND read_at IS NULL"
    ).bind(me, id, Math.floor(Date.now() / 1000)).run();
    notifUnread = await notifUnreadCount(env, me);
  }
  return json({ ok: true, post: enriched[0], comments, me, notif_unread: notifUnread }, 200);
}

/* ---- Reactions on public posts (2026-09-12) ----
   ONE handler for every target the ledger knows: 'post' (a row of `comments`
   — a topic head, a reply, an article-page comment), 'wall' (a feed post),
   'wallc' (a feed comment). {key, target, id, emoji}: `emoji` is exactly one
   emoji or one custom-pack token (Domain.Reaction.normalizeReaction, the same
   rule a DM reaction runs), '' withdraws; a different emoji replaces (one
   reaction per member per target). Your own post may be reacted to (the
   owner's ruling) — it just rings no bell. The old like roads are aliases
   ({post|comment, like:<bool>} = the ❤️ reaction), kept one deploy for cached
   clients, and the answer carries the old {liked, likes} beside the tally.
   Visibility is the target's own: a live row; a back-room post only to an
   admin (else the same 404 a missing post gives — indistinguishable); the
   wall's targets behind the social switch. POST_LIMIT like a DM reaction, no
   Turnstile, gated like any write. The tally goes out live over the target's
   own scope, so every open page repaints the pill. */
function reactAlias(data: any) {
  if (data.target != null) return { target: String(data.target || ''), id: Math.floor(Number(data.id) || 0), raw: data.emoji != null ? String(data.emoji) : '' };
  const like = !(data.like === false || data.like === 0 || data.like === 'false');
  if (data.comment != null) return { target: 'wallc', id: Math.floor(Number(data.comment) || 0), raw: like ? '❤️' : '' };
  return { target: 'wall', id: Math.floor(Number(data.post || data.id) || 0), raw: like ? '❤️' : '' };
}

/* The row a target names, as the viewer may see it: its author, the bell to
   ring, the thread/post pair the bell carries, and the live scope the tally
   goes out on. null = not visible to this viewer (= not there). */
async function reactTarget(env: any, target: string, id: number, me: string) {
  if (target === 'post') {
    const row = await env.DB.prepare("SELECT id, author_hash, parent_id, page FROM comments WHERE id = ?1 AND status = 'live'").bind(id).first();
    if (!row) return null;
    if (row.page === ADMIN_CAT && !(await isAdminHash(env, me))) return null;
    const topicId = row.parent_id || row.id;
    return { author: row.author_hash, kind: 'react', topicId, commentId: row.id, scopes: ['topic:' + topicId] };
  }
  if (await socialOff(env)) return null;
  if (target === 'wall') {
    const row = await env.DB.prepare("SELECT id, author_hash FROM wall_posts WHERE id = ?1 AND status = 'live'").bind(id).first();
    if (!row) return null;
    return { author: row.author_hash, kind: 'wall-react', topicId: 0, commentId: row.id, scopes: ['feed:global'] };
  }
  if (target === 'wallc') {
    const row = await env.DB.prepare("SELECT id, post_id, author_hash FROM wall_comments WHERE id = ?1 AND status = 'live'").bind(id).first();
    if (!row) return null;
    return { author: row.author_hash, kind: 'wall-react', topicId: row.id, commentId: row.post_id, scopes: ['feed:global'] };
  }
  return null;
}

async function handleReact(request: any, env: any, ctx: any) {
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.POST_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests. Slow down.' }, 429);
  const key = String(data.key || '');
  if (!key) return json({ ok: false, error: 'Sign in to react.' }, 401);
  const { target, id, raw } = reactAlias(data);
  const emoji: string | null = raw.trim() ? reactionOf(raw) : '';
  if (!isReactTarget(target) || id < 1 || emoji === null) return json({ ok: false, error: 'Bad request.' }, 400);
  const me = await sha256hex(key);
  const gate = await blockedReason(env, me, ip);
  if (gate) return blockedJson(gate);
  const t = await reactTarget(env, target, id, me);
  if (!t) return json({ ok: false, error: 'That post is gone.' }, 404);
  const now = Math.floor(Date.now() / 1000);
  const bell = { to: t.author, from: me, kind: t.kind, topicId: t.topicId, commentId: t.commentId };
  if (emoji) {
    await env.DB.prepare(
      'INSERT INTO reactions (target, target_id, author_hash, emoji, created_at) VALUES (?1, ?2, ?3, ?4, ?5) ' +
      'ON CONFLICT (target, target_id, author_hash) DO UPDATE SET emoji = excluded.emoji, created_at = excluded.created_at'
    ).bind(target, id, me, emoji, now).run();
    /* Never for your own post, never the bot, and never from a muted
       (shadowbanned) reactor, whose engagement must reach no one. */
    if (t.author && t.author !== me && t.author !== MERECAT_BOT.hash && !(await isShadowBanned(env, me))) {
      const ring = notifyReact(env, Object.assign({ target, targetId: id }, bell));
      if (ctx) ctx.waitUntil(ring); else await ring;
    }
  } else {
    await env.DB.prepare('DELETE FROM reactions WHERE target = ?1 AND target_id = ?2 AND author_hash = ?3').bind(target, id, me).run();
    await retractReactNotif(env, bell);
  }
  const tally = await reactionsFor(env, target, [id]);
  const reacts = tally[String(id)] || [];
  if (ctx) publishLive(env, ctx, { v: 1, t: 'react', scopes: t.scopes, target, id, reacts });
  return json({ ok: true, target, id, emoji, reacts, liked: emoji ? 1 : 0, likes: reacts.reduce((a: number, c: any) => a + c.n, 0) }, 200);
}

/* The viewer's own reactions over a batch of targets — the board's public
   payloads are cached, so "mine" rides this keyed read: {key, target, ids}
   → {ok, mine: {id: emoji}}. Sixty ids a call (three pages of replies). A
   member's own reactions are theirs to see; the back room's ids answer
   nothing to a non-admin (they hold nothing of theirs). */
async function handleReactMine(request: any, env: any) {
  const pre = await keyedGated(request, env, 'READ_LIMIT');
  if (pre instanceof Response) return pre;
  const { data, me } = pre;
  const target = String(data.target || '');
  const ids = (Array.isArray(data.ids) ? data.ids : []).slice(0, 60);
  if (!isReactTarget(target)) return json({ ok: false, error: 'Bad request.' }, 400);
  let mine = await myReactionsFor(env, me, target, ids);
  if (target === 'post' && Object.keys(mine).length && !(await isAdminHash(env, me))) {
    const keep = await env.DB.prepare("SELECT id FROM comments WHERE page != ?1 AND id IN (" + inList(Object.keys(mine).length, 2) + ')').bind(ADMIN_CAT, ...Object.keys(mine).map(Number)).all();
    const ok = new Set((keep.results || []).map((r: any) => String(r.id)));
    mine = Object.fromEntries(Object.entries(mine).filter(([k]) => ok.has(k)));
  }
  return json({ ok: true, target, mine }, 200);
}

/* Who reacted, and with what (the "who reacted" popover): {target, id} →
   {ok, who:[{hash, nick, avatar, emoji}], more}. Public — anyone may see who
   reacted to a public post — capped so a viral post never returns thousands.
   Muted (shadowbanned) reactors are hidden from everyone but themselves, like
   all their public activity. A back-room post answers the empty list a post
   that never existed answers; so do the wall's targets with the social layer
   off. The old {post|comment} body is an alias; `likers` rides beside `who`
   for one deploy of cached clients. */
async function handleReactWho(request: any, env: any) {
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const { success } = await env.READ_LIMIT.limit({ key: ip });
  if (!success) return json({ ok: false, error: 'Too many requests. Slow down.' }, 429);
  const { target, id } = reactAlias(data);
  if (!isReactTarget(target) || id < 1) return json({ ok: false, error: 'Bad request.' }, 400);
  const LIMIT = 60;
  const none = json({ ok: true, target, id, who: [], likers: [], more: false }, 200);
  if (target === 'post') {
    const row = await env.DB.prepare("SELECT page FROM comments WHERE id = ?1 AND status = 'live'").bind(id).first();
    if (!row || row.page === ADMIN_CAT) return none;
  } else if (await socialOff(env)) return none;
  const rows = await env.DB.prepare(
    'SELECT r.author_hash, r.emoji, pr.nick, pr.avatar FROM reactions r LEFT JOIN profiles pr ON pr.hash = r.author_hash ' +
    'WHERE r.target = ?1 AND r.target_id = ?2 AND ' + shadowExcl('r') + ' ORDER BY r.created_at DESC LIMIT ?3'
  ).bind(target, id, LIMIT + 1).all();
  const all = rows.results || [];
  const more = all.length > LIMIT;
  const who = all.slice(0, LIMIT).map((r: any) => ({
    hash: r.author_hash, nick: r.nick || displayName(r.author_hash), avatar: r.avatar || null, emoji: String(r.emoji || ''),
  }));
  return json({ ok: true, target, id, who, likers: who, more }, 200);
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
  if (await socialOff(env)) return noSuchPage();
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
  if (await socialOff(env)) return noSuchPage();
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
  if (await socialOff(env)) return noSuchPage();
  const id = Math.floor(Number(data.id) || 0);
  const isComment = !!data.comment;
  if (id < 1) return json({ ok: false, error: 'Bad request.' }, 400);
  const body = String(data.body || '').replace(/\r\n?/g, '\n').trim();
  if (!body) return json({ ok: false, error: 'The post is empty.' }, 400);
  if (body.length > MAX_BODY) return json({ ok: false, error: 'That is too long.' }, 400);
  if (CONTROL_RE.test(body)) return json({ ok: false, error: 'Bad request.' }, 400);
  const table = isComment ? 'wall_comments' : 'wall_posts';
  /* Yours, or any when you are an admin (2026-09-12), as on the board. */
  const row = await env.DB.prepare(
    'SELECT id, author_hash FROM ' + table + " WHERE id = ?1 AND status != 'deleted'"
  ).bind(id).first();
  const asAdmin = !!row && row.author_hash !== me;
  if (!row || (asAdmin && !(await isAdminHash(env, me)))) return json({ ok: false, error: 'Not yours, or already gone.' }, 403);
  if (asAdmin) console.log(JSON.stringify({ event: 'admin_post_edit', id, page: table, author: row.author_hash, by: me }));
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
  /* With the social layer off, 'wall' stops being a valid kind and falls into
     the SAME 'Bad request.' an unknown kind has always got. */
  const kindOk = kind === 'topic' || (kind === 'wall' && !(await socialOff(env)));
  if (!kindOk || ref < 1) return json({ ok: false, error: 'Bad request.' }, 400);
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
  const socialOn = !(await socialOff(env));
  const rows = await env.DB.prepare(
    'SELECT b.kind, b.ref, b.created_at, ' +
    "  CASE b.kind WHEN 'topic' THEN c.title ELSE substr(w.body, 1, 140) END AS label " +
    'FROM bookmarks b ' +
    "LEFT JOIN comments c ON b.kind = 'topic' AND c.id = b.ref AND c.status = 'live' " +
    "LEFT JOIN wall_posts w ON b.kind = 'wall' AND w.id = b.ref AND w.status = 'live' " +
    'WHERE b.hash = ?1 AND (c.id IS NOT NULL OR w.id IS NOT NULL) ' +
    /* Social off: saved feed posts drop out of the list. The bookmark rows are
       untouched in D1 and return exactly as they were with the switch. */
    (socialOn ? '' : "AND b.kind <> 'wall' ") +
    'ORDER BY b.created_at DESC LIMIT ?2 OFFSET ?3'
  ).bind(me, PER + 1, (p - 1) * PER).all();
  const items = (rows.results || []).slice(0, PER);
  return json({ ok: true, items, page: p, more: (rows.results || []).length > PER }, 200);
}

/* A member-safe recent-activity window: the last live forum posts across the
   PUBLIC rooms (never the back room), each under its topic's title. Cacheable,
   keyless, one query — "what happened since I left" for everyone. */
async function handleRecent(request: Request, env: any, url: any) {
  const limited = await readLimited(request, env, { limited: 'Too many requests. Slow down.' });
  if (limited instanceof Response) return limited;
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
    await env.DB.prepare("DELETE FROM reactions WHERE target = 'wallc' AND target_id = ?1").bind(id).run();
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
  await env.DB.prepare("DELETE FROM reactions WHERE target = 'wallc' AND target_id IN (SELECT id FROM wall_comments WHERE post_id = ?1)").bind(id).run();
  await env.DB.prepare('DELETE FROM wall_comments WHERE post_id = ?1').bind(id).run();
  await env.DB.prepare("DELETE FROM reactions WHERE target = 'wall' AND target_id = ?1").bind(id).run();
  await env.DB.prepare('DELETE FROM wall_posts WHERE id = ?1').bind(id).run();
  return json({ ok: true }, 200);
}

export {
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
  reactAlias,
  reactTarget,
};
