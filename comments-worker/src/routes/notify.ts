/* comments-worker/src/routes/notify.ts — in-app notifications and Web Push: the subscription, the VAPID key, the unread count, the list, the read mark.
   Every handler here moved verbatim from index.ts (2026-09-16, the route split);
   index.ts keeps the ROUTES table and imports what it mounts. */
import {
  NOTIF_PER_PAGE,
  blockedJson,
  blockedReason,
  cacheHeader,
  displayName,
  json,
  keyedGated,
  NOTIF_POST_KINDS,
  NOTIF_WALL_KINDS,
  sha256hex,
  notifHideWall,
  notifHideWallSql,
  notifUnreadCount,
} from '../lib.ts';

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

/* The notification badge count: unread rows for this reader, one indexed COUNT.
   Like the DM poll it fires at most once per ninety seconds and doubles as the
   logout trip for a locked or banned identity. */
async function handleNotifUnread(request: any, env: any) {
  const pre = await keyedGated(request, env, 'READ_LIMIT');
  if (pre instanceof Response) return pre;
  const { ip, data, key, me } = pre;
  return json({ ok: true, unread: await notifUnreadCount(env, me) }, 200);
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
  const hideWall = await notifHideWallSql(env, '');
  /* Each family joins only its own tables (the ids in topic_id/comment_id
     mean different things per kind — a DM reaction's message id must never
     land on a forum post that happens to share the number): the board kinds
     join `comments` for the title and the excerpt, the wall kinds `wall_posts`
     (and, for a reaction on a feed comment, that comment for the excerpt). */
  const postKinds = "('" + NOTIF_POST_KINDS.join("','") + "')", wallKinds = "('" + NOTIF_WALL_KINDS.join("','") + "')";
  const rows = await env.DB.prepare(
    'SELECT n.id, n.kind, n.topic_id, n.comment_id, n.actor_hash, n.created_at, n.read_at, ' +
    "COALESCE(t.title, CASE WHEN dt.kind = 1 THEN COALESCE(dt.name, 'a group') END) AS topic_title, pr.nick AS actor_nick, " +
    "CASE WHEN n.kind = 'wall-react' AND n.topic_id > 0 THEN substr(wc.body, 1, 140) " +
    'WHEN n.kind IN ' + wallKinds + ' THEN substr(wp.body, 1, 140) ELSE substr(c.body, 1, 140) END AS snippet ' +
    'FROM notifications n ' +
    'LEFT JOIN comments t ON t.id = n.topic_id AND n.kind IN ' + postKinds + ' ' +
    'LEFT JOIN comments c ON c.id = n.comment_id AND n.kind IN ' + postKinds + ' ' +
    "LEFT JOIN dm_threads dt ON dt.id = n.topic_id AND n.kind IN ('dm','dm-react','call') " +   // a DM bell names its conversation (0016): a group's name for the sentence
    'LEFT JOIN wall_posts wp ON wp.id = n.comment_id AND n.kind IN ' + wallKinds + ' ' +
    "LEFT JOIN wall_comments wc ON wc.id = n.topic_id AND n.kind = 'wall-react' " +
    'LEFT JOIN profiles pr ON pr.hash = n.actor_hash ' +
    'WHERE n.recipient_hash = ?1' + (hideWall ? notifHideWall('n.') : ' ') +
    'ORDER BY n.id DESC LIMIT ?2 OFFSET ?3'
  ).bind(me, NOTIF_PER_PAGE, (p - 1) * NOTIF_PER_PAGE).all();
  const totals = await env.DB.prepare(
    'SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN read_at IS NULL THEN 1 ELSE 0 END), 0) AS unread ' +
    'FROM notifications WHERE recipient_hash = ?1' + hideWall
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

export {
  handleNotifList,
  handleNotifRead,
  handleNotifUnread,
  handlePushRegister,
  handlePushUnregister,
  handleVapidKey,
};
