/* The sweep (2026-09-17): every road into the worker, taken as four identities
   against a ledger seeded with SENTINELS — a distinctive value in every secret
   the env holds and in every private column the ledger keeps — so a test can
   say, for every answer, what it carried and whether that reader was allowed
   to see it.

   Why it exists: for six weeks `GET /api/comments/recent` answered with the
   worker's whole env, and the first guard written for it called every route
   anonymously, with an empty body and a sentinel ALLOWED_ORIGINS — so 114 of
   its 129 calls were refused at the origin gate before any handler ran. This
   one keeps the gates real (a real origin; ADMIN_HASHES is the admin identity;
   the members are established) and COUNTS what it reached, so a test can fail
   when a sweep goes hollow.

   Roads taken: the ROUTES table (tests/_support/routes.json) as anon, member,
   outsider and admin; the workers.dev front door, and each of its doors as
   the GitHub job whose token opens it (`pipeline`); `/@handle`; the two
   WebSocket upgrades; the four cron chains (their alert mail, their Discord
   posts, the backup object). Every call runs against a fresh ledger, so a
   write in one never feeds the next.

   Used by tests/worker/env_leak.test.mjs (nothing leaks, and the calls reached
   the handlers) and scripts/response_shapes.mjs (what each answer looks
   like). */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  loadWorker, makeEnv, freshDb, freshLibDb, call, ctx, netSpy, resetCaches, hubSpy, identity, establish, publishKey,
} from './worker.mjs';
import { PUBLIC_VARS } from '../../comments-worker/src/env.ts';
import { githubIssuer } from './github_oidc.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');

export const ROUTES = JSON.parse(read('tests/_support/routes.json'));

/* the doors the workers.dev hostname opens (index.ts INGEST_DOORS) */
export const INGEST_DOORS = (() => {
  const m = /const INGEST_DOORS = \[([^\]]*)\]/.exec(read('comments-worker/src/index.ts'));
  return m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : [];
})();

/* ---- the sentinels -------------------------------------------------------- */

/* Every string the Env declares that is not a public var — the worker's
   secrets, whatever their names — each given a value no answer could hold by
   chance. Long enough for the egress guard to scan for (egress.ts). */
export function secretNames() {
  const src = read('comments-worker/src/env.ts');
  const start = src.indexOf('export interface Env {');
  const body = src.slice(start, src.indexOf('\n}\n', start));
  return [...body.matchAll(/^\s*([A-Z][A-Z0-9_]*)\??: string;/gm)].map((m) => m[1]).filter((k) => !PUBLIC_VARS.includes(k));
}
export const sentinel = (name) => 'mc-sentinel-' + name.toLowerCase().replace(/_/g, '-') + '-7f3a';
export const SECRETS = secretNames().map((name) => ({ name, value: sentinel(name) }));

/* Every private value the ledger keeps, and who may read it back. `who` is
   permission, not obligation: a reader outside it must never see the value;
   a reader inside it may. */
const p = (value, who) => ({ value, who });
export const PRIVATE = {
  'comments.ip': p('198.51.100.99', ['admin']),
  'comments.ip_hash': p('mc-private-iphash-5b1c', ['admin']),
  'comments.ua': p('mc-private-useragent-5b1c', ['admin']),
  'comments.tz': p('mc-private-timezone-5b1c', ['admin']),
  'comments.lang': p('mc-private-language-5b1c', ['admin']),
  'comments.ai_verdict': p('mc-private-verdict-5b1c', ['admin']),
  'identity_ips.ip_display': p('198.51.100.98', ['admin']),
  'ip_bans.ip': p('198.51.100.97', ['admin']),
  'push_tokens.token': p('https://push.example/mc-private-pushtoken-5b1c', []),
  'app_settings.alert_email': p('mc-private-alert-5b1c@example.org', ['admin']),
  'app_settings.alert_discord_webhook': p('mc-private-alerthook-5b1c', ['admin']),
  'app_settings.discord_forum_webhook': p('mc-private-forumhook-5b1c', ['admin']),
  'app_settings.discord_feed_webhook': p('mc-private-feedhook-5b1c', ['admin']),
  'discord_hooks.hook_url': p('mc-private-scopedhook-5b1c', ['admin']),
  'reports.reason': p('mc-private-reportreason-5b1c', ['admin']),
  'held post title': p('mc-private-heldtitle-5b1c', ['admin']),
  'held post body': p('mc-private-heldbody-5b1c', ['admin']),
  'back room title': p('mc-private-backroomtitle-5b1c', ['admin']),
  'back room body': p('mc-private-backroombody-5b1c', ['admin']),
  'calls_pending.sdp': p('mc-private-sdp-5b1c', ['member', 'admin']),
  'calls_pending.sdp address': p('198.51.100.96', ['member', 'admin']),
  'dms.body': p('E3.mc-private-dmcipher-5b1c', ['member', 'admin']),
  'dm_keys.sealed (member)': p('mc-private-sealed-member-5b1c', ['member']),
  'dm_keys.sealed (admin)': p('mc-private-sealed-admin-5b1c', ['admin']),
  'dm_media.key': p('dm/' + '5b1cd00d'.repeat(8), ['member', 'admin']),
  'merecat chat_msgs.body': p('mc-private-chatbody-5b1c', ['member', 'admin']),
  'back room media bytes': p('mc-private-backroommedia-5b1c', ['admin']),
};
/* the public wall attachment, and the one hung on a back-room post */
export const WALL_MEDIA = { open: 'wall/i/' + 'a1'.repeat(32), back: 'wall/i/' + 'b2'.repeat(32) };
const discordHook = (tag) => 'https://discord.com/api/webhooks/1234567890/' + tag;

/* ---- the ledger ----------------------------------------------------------- */

export const IDENTITIES = ['anon', 'member', 'outsider', 'admin'];
let people = null;
export async function identities() {
  if (!people) {
    people = {
      member: await identity('sweep-member'),
      outsider: await identity('sweep-outsider'),
      admin: await identity('sweep-admin'),
      author: await identity('sweep-author'),   // owns what nobody but an admin may read
    };
  }
  return people;
}

/* A fresh ledger (and librarian room) with every private value in place.
   Returns the ids a request needs to reach them. */
export function seed(who) {
  const db = freshDb();
  const lib = freshLibDb();
  const now = Math.floor(Date.now() / 1000);
  const v = (k) => PRIVATE[k].value;
  for (const x of [who.member, who.outsider, who.admin, who.author]) {
    establish(db, x.hash, now - 30 * 86400);
    publishKey(db, x.hash, now - 30 * 86400);
  }
  db.prepare("UPDATE profiles SET nick = 'Sweep Member', handle = 'sweepmember', bio = 'a public bio' WHERE hash = ?").run(who.member.hash);
  const set = db.prepare("INSERT INTO app_settings (k, v, updated_at, updated_by) VALUES (?, ?, 1, 'sweep')");
  for (const [k, val] of [
    ['alert_email', v('app_settings.alert_email')], ['alert_email_on', '1'],
    ['alert_discord_webhook', discordHook(v('app_settings.alert_discord_webhook'))], ['alert_discord_on', '1'],
    ['discord_forum_webhook', discordHook(v('app_settings.discord_forum_webhook'))],
    ['discord_feed_webhook', discordHook(v('app_settings.discord_feed_webhook'))],
    ['social_enabled', '1'], ['comments_pages', '/credo.html'], ['comments_journal', '1'],
    ['media_enabled', '1'], ['calls_enabled', '1'], ['journal_enabled', '1'],
    /* uploads are swept without the Workers AI image screen (the harness has no AI) */
    ['media_scan_wall', '0'], ['media_scan_board', '0'],
  ]) set.run(k, val);
  db.prepare("INSERT INTO discord_hooks (scope, feed_url, hook_url, label, created_at, created_by) VALUES ('cat:pub', 'https://merecatholicity.com/api/comments/feed?cat=pub', ?, 'sweep', 1, ?)")
    .run(discordHook(v('discord_hooks.hook_url')), who.admin.hash);
  /* the monthly chain beat 40 days ago: a self-check that runs finds it stale
     and ALERTS, so the sweep reads a real alert's mail and Discord post */
  set.run('ops_heartbeat', JSON.stringify({ monthly: now - 40 * 86400 }));

  const post = db.prepare(
    'INSERT INTO comments (page, parent_id, title, author_hash, body, status, created_at, ip_hash, ai_verdict, ip, ua, os, tz, lang, last_at, replies) ' +
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Linux', ?, ?, ?, ?)");
  const fp = [v('comments.ip_hash'), v('comments.ai_verdict'), v('comments.ip'), v('comments.ua'), v('comments.tz'), v('comments.lang')];
  const topic = Number(post.run('board:pub', null, 'A sweep topic', who.member.hash, 'the topic body', 'live', now - 100, ...fp, now - 50, 1).lastInsertRowid);
  const reply = Number(post.run('board:pub', topic, null, who.member.hash, 'a reply body', 'live', now - 50, ...fp, now - 50, 0).lastInsertRowid);
  const pageComment = Number(post.run('/credo.html', null, null, who.member.hash, 'a page comment', 'live', now - 40, ...fp, now - 40, 0).lastInsertRowid);
  /* someone else's reply, after the member's first board visit: something unread */
  post.run('board:pub', topic, null, who.author.hash, 'a reply from someone else', 'live', now - 35, ...fp, now - 35, 0);
  db.prepare('INSERT INTO thread_reads (hash, topic_id, read_at) VALUES (?, 0, ?)').run(who.member.hash, now - 3600);
  const held = Number(post.run('board:pub', null, v('held post title'), who.author.hash, v('held post body'), 'pending', now - 30, ...fp, now - 30, 0).lastInsertRowid);
  const back = Number(post.run('board:adminsonly', null, v('back room title'), who.admin.hash, v('back room body'), 'live', now - 20, ...fp, now - 20, 0).lastInsertRowid);
  set.run('journal_topic', String(topic));
  db.prepare('INSERT INTO reports (comment_id, reporter_hash, reason, created_at) VALUES (?, ?, ?, ?)').run(reply, who.outsider.hash, v('reports.reason'), now - 10);
  db.prepare("INSERT INTO identity_ips (hash, ip_key, ip_display, family, source, first_seen, last_seen) VALUES (?, ?, ?, 4, 'seen', ?, ?)")
    .run(who.member.hash, v('identity_ips.ip_display'), v('identity_ips.ip_display'), now, now);
  db.prepare('INSERT INTO ip_bans (ip, created_at) VALUES (?, ?)').run(v('ip_bans.ip'), now);
  db.prepare("INSERT INTO push_tokens (hash, platform, token, created_at) VALUES (?, 'web', ?, ?)").run(who.member.hash, v('push_tokens.token'), now);

  const wallPost = Number(db.prepare("INSERT INTO wall_posts (author_hash, body, created_at, status, comments) VALUES (?, 'a wall post', ?, 'live', 1)")
    .run(who.member.hash, now - 10).lastInsertRowid);
  const wallComment = Number(db.prepare("INSERT INTO wall_comments (post_id, author_hash, body, created_at, status) VALUES (?, ?, 'a wall comment', ?, 'live')")
    .run(wallPost, who.outsider.hash, now - 9).lastInsertRowid);
  db.prepare("INSERT INTO bookmarks (hash, kind, ref, created_at) VALUES (?, 'topic', ?, ?)").run(who.member.hash, topic, now - 8);
  db.prepare("INSERT INTO wall_media (key, size, created_at, ref_type, ref_id, ctx) VALUES (?, 17, ?, 'wall', ?, 'wall'), (?, 29, ?, 'board', ?, 'board')")
    .run(WALL_MEDIA.open, now - 8, wallPost, WALL_MEDIA.back, now - 8, back);
  db.prepare("INSERT INTO notifications (recipient_hash, kind, topic_id, comment_id, actor_hash, created_at) VALUES (?, 'reply', ?, ?, ?, ?)")
    .run(who.member.hash, topic, reply, who.outsider.hash, now - 7);

  /* a conversation between the admin and the member, one message with an attachment */
  const call_ = 'c0ffee00c0ffee00c0ffee00c0ffee00';
  db.prepare('INSERT INTO calls_pending (call, from_hash, to_hash, sdp, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(call_, who.admin.hash, who.member.hash, 'v=0 ' + v('calls_pending.sdp') + ' c=IN IP4 ' + v('calls_pending.sdp address'), now - 5);
  const pair = [who.admin.hash, who.member.hash].sort().join('|');
  const thread = Number(db.prepare('INSERT INTO dm_threads (kind, pair_key, created_at, last_at, last_sender, msgs) VALUES (0, ?, ?, ?, ?, 1)')
    .run(pair, now - 6, now - 4, who.admin.hash).lastInsertRowid);
  db.prepare('INSERT INTO dm_members (thread_id, hash, joined_at) VALUES (?, ?, ?), (?, ?, ?)')
    .run(thread, who.admin.hash, now - 6, thread, who.member.hash, now - 6);
  const dm = Number(db.prepare('INSERT INTO dms (thread_id, sender_hash, body, created_at, enc, media_key, media_size) VALUES (?, ?, ?, ?, 3, ?, 64)')
    .run(thread, who.admin.hash, v('dms.body'), now - 4, v('dm_media.key')).lastInsertRowid);
  db.prepare('INSERT INTO dm_keys (msg_id, hash, sealed) VALUES (?, ?, ?), (?, ?, ?)')
    .run(dm, who.member.hash, v('dm_keys.sealed (member)'), dm, who.admin.hash, v('dm_keys.sealed (admin)'));
  db.prepare('INSERT INTO dm_media (key, size, created_at, msg_id) VALUES (?, 64, ?, ?)').run(v('dm_media.key'), now - 4, dm);
  db.prepare('INSERT INTO dm_media_refs (key, msg_id) VALUES (?, ?)').run(v('dm_media.key'), dm);
  /* a group the member and the admin are in, and the outsider is not */
  const group = Number(db.prepare("INSERT INTO dm_threads (kind, pair_key, name, created_at, created_by, last_at, last_sender, msgs) VALUES (1, NULL, 'a sweep group', ?, ?, ?, ?, 0)")
    .run(now - 6, who.admin.hash, now - 6, who.admin.hash).lastInsertRowid);
  db.prepare('INSERT INTO dm_members (thread_id, hash, joined_at, added_by) VALUES (?, ?, ?, ?), (?, ?, ?, ?), (?, ?, ?, ?)')
    .run(group, who.admin.hash, now - 6, who.admin.hash, group, who.member.hash, now - 6, who.admin.hash, group, who.author.hash, now - 6, who.admin.hash);

  /* the member's conversation with the librarian */
  const chat = Number(lib.prepare("INSERT INTO chats (hash, title, created_at, last_at, msgs) VALUES (?, 'a sweep chat', ?, ?, 1)")
    .run(who.member.hash, now - 3, now - 3).lastInsertRowid);
  const asked = Number(lib.prepare("INSERT INTO chat_msgs (chat_id, role, body, created_at, done) VALUES (?, 'user', ?, ?, 1)")
    .run(chat, v('merecat chat_msgs.body'), now - 3).lastInsertRowid);
  const answer = Number(lib.prepare("INSERT INTO chat_msgs (chat_id, role, body, sources, created_at, answers, done) VALUES (?, 'assistant', 'a sweep answer', '[]', ?, ?, 1)")
    .run(chat, now - 2, asked).lastInsertRowid);

  return { db, lib, ids: { topic, reply, pageComment, held, back, wallPost, wallComment, thread, group, dm, call: call_, chat, answer, handle: 'sweepmember' } };
}

/* What the ledger's rows name in the buckets: the member's avatar, the two
   wall attachments. Called on each fresh env. */
export async function stock(env, who) {
  await env.AVATARS.put('avatars/' + who.member.hash, 'avatar-bytes', { httpMetadata: { contentType: 'image/jpeg' } });
  await env.WALLMEDIA.put(WALL_MEDIA.open, 'public-wall-media', { httpMetadata: { contentType: 'image/webp' } });
  await env.WALLMEDIA.put(WALL_MEDIA.back, PRIVATE['back room media bytes'].value, { httpMetadata: { contentType: 'image/webp' } });
  await env.MEDIA.put(PRIVATE['dm_media.key'].value, 'dm-ciphertext-bytes', { httpMetadata: { contentType: 'application/octet-stream' } });
}

/* a 1x1 PNG, for the four upload roads (multipart: the key and the file) */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
/* the start of a 128x128 JPEG: enough for the avatar road's sniff (a square
   JPEG between its bounds); its image screen fails open without Workers AI */
const JPEG = Buffer.from([0xFF, 0xD8, 0xFF, 0xC0, 0x00, 0x11, 0x08, 0x00, 0x80, 0x00, 0x80, 0x03,
  0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, 0xFF, 0xD9]);
export const UPLOADS = {
  'POST /api/comments/dm/media': 'file',
  'POST /api/comments/wall/media': 'file',
  'POST /api/comments/board/media': 'file',
  'POST /api/comments/avatar': 'avatar',
};

/* ---- the requests --------------------------------------------------------- */

/* Extra body fields the generic body lacks, per route, so a call reaches the
   handler's work instead of its first refusal. A function gets (ids, who, me). */
const pairKeys = (a, b) => ({ [a.hash]: 'sealedforone', [b.hash]: 'sealedfortwo' });
const otherOf = (who, me) => (me === who.member ? who.admin : who.member);
export const ROUTE_HINTS = {
  'POST /api/comments': (ids) => ({ topic: ids.topic, body: 'a sweep reply', title: '' }),
  'POST /api/comments/edit': (ids) => ({ id: ids.reply, body: 'an edited reply' }),
  'POST /api/comments/moderate': (ids) => ({ id: ids.topic, act: 'sticky' }),
  'POST /api/comments/move': (ids) => ({ id: ids.topic, cat: 'news' }),
  'POST /api/comments/board/admin': (ids) => ({ id: ids.back }),
  /* `with` on the send, `to` on the forward's items: each is addressed the way
     its OWN client addresses it (client/dm-thread.ts `ctx.target()`;
     client/dm-pickers.ts). The sweep cannot PROVE that — `base` above names a
     member under every field any road might read, and carries a thread_id
     besides, so every road here finds something to answer whatever it reads.
     That is right for a leak sweep and useless for a wire mismatch: /dm/send
     read `to` alone for six days while every client sent `with`, and this
     line, saying `to`, was green throughout. The road that proves the shape is
     tests/worker/dm_pair_target.test.mjs (2026-09-19). */
  'POST /api/comments/dm/send': (ids, who, me) => (me ? { with: otherOf(who, me).hash, body: 'E3.sweepword', enc: 3, keys: pairKeys(me, otherOf(who, me)) } : {}),
  'POST /api/comments/dm/forward': (ids, who, me) => (me ? { items: [{ to: otherOf(who, me).hash, body: 'E3.sweepforward', enc: 3, keys: pairKeys(me, otherOf(who, me)) }] } : {}),
  'POST /api/comments/dm/edit': (ids) => ({ id: ids.dm, body: 'E3.sweepedit', enc: 3 }),
  'POST /api/comments/dm/pubkey': () => ({ pubkey: 'A'.repeat(43) }),
  'POST /api/comments/profile/rekey': (ids) => ({ newkey: 'sweep-rekey-new-key-2026!', pubkey: 'A'.repeat(43), resealed: { [ids.dm]: 'S3.sweepreseal' } }),
  'POST /api/comments/dm/presence': (ids, who, me) => (me ? { hashes: [who.member.hash, who.outsider.hash, who.admin.hash].filter((h) => h !== me.hash) } : {}),
  'POST /api/comments/dm/ttl': (ids) => ({ thread_id: ids.thread, ttl: 86400 }),
  'POST /api/comments/dm/media/get': () => ({ media_key: PRIVATE['dm_media.key'].value }),
  'POST /api/comments/dm/groups': (ids, who, me) => (me ? { members: [who.member.hash, who.outsider.hash, who.admin.hash].filter((h) => h !== me.hash), name: 'a new group' } : {}),
  'POST /api/comments/dm/members': (ids, who) => ({ thread_id: ids.group, add: [who.outsider.hash] }),
  'POST /api/comments/dm/leave': (ids) => ({ thread_id: ids.group }),
  'POST /api/comments/dm/name': (ids) => ({ thread_id: ids.group, name: 'a renamed group' }),
  'POST /api/comments/call/offer': (ids, who, me) => ({ to: otherOf(who, me).hash, call: 'feedface00000000feedface00000000', sdp: 'v=0 a sweep offer' }),
  'POST /api/comments/call/answer': (ids, who) => ({ to: who.admin.hash, call: ids.call, sdp: 'v=0 a sweep answer' }),
  'POST /api/comments/call/end': (ids) => ({ call: ids.call, reason: 'hangup' }),
  'POST /api/comments/admin/discord/add': () => ({ feed_url: 'https://merecatholicity.com/api/comments/feed?cat=pub', hook_url: 'https://discord.com/api/webhooks/1234567890/sweep-added-hook', label: 'sweep' }),
  'POST /api/comments/ops/report': () => ({ probe: true }),
  'POST /api/comments/wall/post': () => ({ body: 'a sweep wall post' }),
  'POST /api/comments/wall/comment': (ids) => ({ post: ids.wallPost, body: 'a sweep wall comment' }),
  'POST /api/comments/wall/edit': (ids) => ({ id: ids.wallPost, comment: undefined, body: 'an edited wall post' }),
  'POST /api/comments/react': (ids) => ({ target: 'wall', id: ids.wallPost, emoji: '❤️' }),
  'POST /api/comments/reacts': (ids) => ({ target: 'wall', ids: [ids.wallPost] }),
  'POST /api/comments/react/who': (ids) => ({ target: 'wall', id: ids.wallPost }),
  'POST /api/comments/wall/like': (ids) => ({ target: undefined, comment: undefined, post: ids.wallPost }),
  'POST /api/comments/wall/comment/like': (ids) => ({ target: undefined, comment: ids.wallComment }),
  'POST /api/comments/wall/likers': (ids) => ({ target: 'wall', id: ids.wallPost }),
  'POST /api/comments/ipban': () => ({ ip: '203.0.113.50', banned: true }),
  'POST /api/comments/push/register': () => ({ platform: 'web', token: 'https://push.example/a-sweep-subscription' }),
  'POST /api/comments/push/unregister': () => ({ token: 'https://push.example/a-sweep-subscription' }),
  'POST /api/merecat/forward': (ids) => ({ chat: ids.chat, msg: ids.answer, topic: ids.topic }),
  'POST /api/merecat/ingest': () => ({ mode: 'begin', work: { id: 'sweep-work', title: 'A sweep work', url: '/sweep.html', tier: 1 } }),
  'POST /api/merecat/config': () => ({ config: { topk: 8 } }),
};

/* a public read's other modes, each asked for alone */
export const GET_MODES = [
  ['/api/comments/feed', () => ({ cat: 'pub' })],
  ['/api/comments/feed', () => ({ page: '/credo.html' })],
  ['/api/comments/feed', (ids) => ({ topic: String(ids.topic) })],
  ['/api/comments', (ids) => ({ page: 'journal:' + ids.reply })],
  ['/api/comments/journal', () => ({ p: '1' })],
  ['/api/comments/journal', (ids) => ({ id: String(ids.reply) })],
  ['/api/comments/board/topic', (ids) => ({ id: String(ids.topic), find: String(ids.reply) })],
  ['/api/comments/search', () => ({ q: 'body', sort: 'new' })],
  ['/api/comments/search', (ids, who) => ({ author: who.member.hash })],
  ['/api/comments/profile', (ids) => ({ handle: ids.handle || 'sweepmember' })],
  ['/api/comments/board/cat', () => ({ cat: 'pub', q: 'sweep' })],
];

function query(ids, who) {
  const q = new URLSearchParams({
    id: String(ids.topic), topic: String(ids.topic), page: '/credo.html', cat: 'pub', p: '1', q: 'body',
    hash: who.member.hash, author: who.member.hash, handle: ids.handle, u: who.member.hash, post: String(ids.wallPost),
    key: WALL_MEDIA.open,
  });
  return '?' + q.toString();
}
function body(route, as, ids, who) {
  const me = who[as];
  const field = UPLOADS[route.m + ' ' + route.p];
  if (field) {
    const form = new FormData();
    if (me) form.append('key', me.key);
    form.append(field, field === 'avatar' ? new Blob([JPEG], { type: 'image/jpeg' }) : new Blob([PNG], { type: 'image/png' }), 'sweep');
    return form;
  }
  const base = {
    id: ids.topic, topic: ids.topic, topic_id: ids.topic, comment_id: ids.reply, post: ids.wallPost, post_id: ids.wallPost,
    comment: ids.wallComment, thread: ids.thread, thread_id: ids.thread, msg: ids.dm, msg_id: ids.dm, hash: who.member.hash,
    to: who.member.hash, with: who.member.hash, peer: who.member.hash, target: who.member.hash, page: 'board:pub',
    cat: 'pub', p: 1, q: 'body', call: ids.call, chat: ids.chat, kind: 'topic', ref: ids.topic,
  };
  if (me) base.key = me.key;
  const hint = ROUTE_HINTS[route.m + ' ' + route.p];
  return { ...base, ...(typeof hint === 'function' ? hint(ids, who, me) : (hint || {})) };
}

/* ---- the network, the page and the rewriter the worker expects -------------- */

const PROFILE_HTML = '<!doctype html><html><head><title>Profile</title>' +
  '<meta property="og:title" content=""><meta name="twitter:title" content="">' +
  '<meta property="og:description" content=""><meta name="twitter:description" content="">' +
  '<meta name="description" content=""><meta property="og:image" content="">' +
  '<meta name="twitter:image" content=""><meta property="og:url" content=""><meta property="og:type" content="">' +
  '</head><body></body></html>';

/* community.html as the origin serves it: the head the thread page rewrites
   and the one section it fills. */
const COMMUNITY_HTML = '<!doctype html><html><head><title>Community</title>' +
  '<meta name="description" content=""><meta property="og:title" content=""><meta name="twitter:title" content="">' +
  '<meta property="og:description" content=""><meta name="twitter:description" content="">' +
  '<meta property="og:url" content=""><meta property="og:type" content="">' +
  '</head><body><section class="comments board" data-board></section></body></html>';

export function responder(url) {
  if (/\/profile\.html$/.test(url)) return new Response(PROFILE_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  if (/\/community\.html$/.test(url)) return new Response(COMMUNITY_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  if (url.startsWith('https://discord.com/api/webhooks/')) return new Response(null, { status: 204 });
  if (url.startsWith('https://challenges.cloudflare.com/')) return Response.json({ success: false, 'error-codes': ['invalid-input-response'] });
  throw new Error('the network was reached from the sweep: ' + url);
}

/* HTMLRewriter is a Workers global. The handle card needs `on(selector,
   handler).transform(response)` with `setAttribute` and `setInnerContent`; the
   thread page (routes/seo.ts) adds `prepend` and a `{ html: true }` content.
   This does that much over the page text, escaping what it writes unless the
   handler said the value is already html. */
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
class MiniRewriter {
  constructor() { this.rules = []; }
  on(selector, handler) { this.rules.push([selector, handler]); return this; }
  transform(res) {
    const rules = this.rules;
    const rewrite = async () => {
      let html = await res.text();
      for (const [selector, handler] of rules) {
        const m = /^(\w+)(?:\[([\w:-]+)(?:="([^"]*)")?\])?$/.exec(selector);
        if (!m) continue;
        const [, tag, attr, want] = m;
        html = html.replace(new RegExp('<' + tag + '\\b([^>]*)>(?:([^<]*)</' + tag + '>)?', 'gi'), (whole, attrs, inner) => {
          if (attr && want === undefined && !new RegExp('\\b' + attr + '\\b').test(attrs)) return whole;
          if (attr && want !== undefined && !new RegExp('\\b' + attr + '="' + want + '"').test(attrs)) return whole;
          let a = attrs;
          let content = inner;
          let pre = '';
          handler.element({
            setAttribute: (name, value) => {
              const re = new RegExp('\\b' + name + '="[^"]*"');
              a = re.test(a) ? a.replace(re, name + '="' + esc(value) + '"') : a + ' ' + name + '="' + esc(value) + '"';
            },
            setInnerContent: (text, opts) => { content = opts && opts.html ? String(text) : esc(text); },
            prepend: (text, opts) => { pre += opts && opts.html ? String(text) : esc(text); },
          });
          return '<' + tag + a + '>' + pre + (content === undefined ? '' : content + '</' + tag + '>');
        });
      }
      return html;
    };
    return new Response(new ReadableStream({
      async start(c) { c.enqueue(new TextEncoder().encode(await rewrite())); c.close(); },
    }), { status: res.status, headers: res.headers });
  }
}
if (!globalThis.HTMLRewriter) globalThis.HTMLRewriter = MiniRewriter;

/* ---- the sweep ------------------------------------------------------------ */

const egressRows = (db) => {
  const row = db.prepare("SELECT v FROM app_settings WHERE k = 'ops_egress'").get();
  return row ? JSON.parse(row.v).rows : [];
};

async function one(worker, who, vars, road) {
  resetCaches();
  const { db, lib, ids } = seed(who);
  const hub = hubSpy();
  const env = makeEnv({ db, libdb: lib, hub, vars });
  await stock(env, who);
  const opts = road.opts ? road.opts(ids, who) : {};
  const path = typeof road.path === 'function' ? road.path(ids, who) : road.path;
  const b = road.body ? road.body(ids, who) : undefined;
  /* what the worker said about itself during the call: every refusal and
     every trip logs (the D1 note is throttled per isolate; the log is not) */
  const said = [];
  const log = console.log;
  console.log = (...a) => {
    const t = a.map(String).join(' ');
    if (/"event":"(egress_blocked|env_enumerated|unhandled)"/.test(t)) {
      try { said.push(JSON.parse(t)); } catch (e) { said.push({ event: 'unparsed', text: t }); }
    }
    log(...a);
  };
  let r;
  try {
    r = await call(worker, env, road.m, path, b, opts);
    await r.ctx.settle();
  } catch (e) {
    return { ...road.meta, status: 0, text: '', json: null, threw: String(e), events: hub.events, emails: env.emails, egress: egressRows(db), said, ids };
  } finally {
    console.log = log;
  }
  const contentType = (r.res.headers.get('Content-Type') || 'none').split(';')[0].trim();
  return { ...road.meta, status: r.status, text: r.text || '', json: r.json, contentType, events: hub.events, emails: env.emails, egress: egressRows(db), said, ids };
}

/* Every road, every identity. Returns { calls, crons, net }: a call is
   { m, p, as, road, status, text, json, events, emails, egress, said }; a cron is
   { cron, emails, discord, backups, egress }. `only` narrows the routes (a
   test of one road); `wrap` hands back a worker to use instead. */
export async function runSweep({ only, wrap } = {}) {
  const loaded = (await loadWorker()).worker;
  /* `wrap` lets the control test put a planted leak around the worker */
  const worker = wrap ? wrap(loaded) : loaded;
  const who = await identities();
  const vars = { ...Object.fromEntries(SECRETS.map((s) => [s.name, s.value])), ADMIN_HASHES: who.admin.hash };
  /* GitHub's stand-in: the pipeline road's tokens, and the key set the worker asks for */
  const github = await githubIssuer();
  const net = netSpy((url, init) => github.serves(url) || responder(url, init));
  const calls = [];
  const crons = [];
  try {
    for (const route of ROUTES) {
      if (only && !only(route)) continue;
      for (const as of IDENTITIES) {
        calls.push(await one(worker, who, vars, {
          meta: { m: route.m, p: route.p, as, road: 'table' },
          m: route.m,
          path: route.m === 'GET' ? (ids) => route.p + query(ids, who) : route.p,
          body: route.m === 'POST' ? (ids) => body(route, as, ids, who) : undefined,
        }));
      }
    }
    if (!only) {
      /* the workers.dev front door: its own doors, and nothing else */
      for (const door of INGEST_DOORS) {
        for (const as of ['anon', 'admin']) {
          calls.push(await one(worker, who, vars, {
            meta: { m: 'POST', p: door, as, road: 'workers.dev' },
            m: 'POST', path: door,
            body: () => ({ ...(as === 'admin' ? { key: who.admin.key } : {}), probe: true }),
            opts: () => ({ host: 'https://merecatholicity-comments.sweep.workers.dev', origin: null }),
          }));
        }
      }
      /* the same doors as the job that may open each (oidc.ts, Domain.Pipeline) */
      for (const door of INGEST_DOORS) {
        const job = door === '/api/comments/ops/report' ? 'probe' : door === '/api/merecat/config' ? 'config' : 'ingest';
        const token = await github.token(job);
        const hint = ROUTE_HINTS['POST ' + door];
        calls.push(await one(worker, who, vars, {
          meta: { m: 'POST', p: door, as: 'pipeline', road: 'pipeline' },
          m: 'POST', path: door,
          body: (ids) => ({ ...(hint ? hint(ids, who) : {}), probe: true }),
          opts: () => ({ host: 'https://merecatholicity-comments.sweep.workers.dev', origin: null, headers: { Authorization: 'Bearer ' + token } }),
        }));
      }
      calls.push(await one(worker, who, vars, {
        meta: { m: 'GET', p: '/api/comments/recent', as: 'anon', road: 'workers.dev' },
        m: 'GET', path: '/api/comments/recent', opts: () => ({ host: 'https://merecatholicity-comments.sweep.workers.dev' }),
      }));
      /* the public reads whose MODE is chosen by their query (the table's call
         sends every parameter at once, so one mode wins): each other mode alone */
      for (const [path, variant] of GET_MODES) {
        calls.push(await one(worker, who, vars, {
          meta: { m: 'GET', p: path, as: 'anon', road: 'mode ' + Object.keys(variant({}, who)).join('+') },
          m: 'GET', path: (ids) => path + '?' + new URLSearchParams(variant(ids, who)).toString(),
        }));
      }
      /* the back room's attachment, asked for by anyone */
      for (const as of ['anon', 'admin']) {
        calls.push(await one(worker, who, vars, {
          meta: { m: 'GET', p: '/api/comments/wall/media', as, road: 'back room media' },
          m: 'GET', path: '/api/comments/wall/media?key=' + WALL_MEDIA.back,
        }));
      }
      /* the handle card, a known handle and an unknown one */
      for (const handle of ['sweepmember', 'nobody-here']) {
        calls.push(await one(worker, who, vars, { meta: { m: 'GET', p: '/@' + handle, as: 'anon', road: 'handle' }, m: 'GET', path: '/@' + handle }));
      }
      /* the public roads a stranger arrives by (2026-09-17): a thread at its
         own URL — the live one, a held post and the back room's topic, which
         must read as nothing at all — the site feed, and the thread sitemap */
      for (const [road, path] of [
        ['thread', (ids) => '/t/' + ids.topic + '-a-sweep-topic'],
        ['thread held', (ids) => '/t/' + ids.held],
        ['thread back room', (ids) => '/t/' + ids.back],
        ['site feed', () => '/feed.xml'],
        ['thread sitemap', () => '/sitemap-threads.xml'],
      ]) {
        calls.push(await one(worker, who, vars, {
          meta: { m: 'GET', p: road === 'thread' ? '/t/<id>' : road, as: 'anon', road: road },
          m: 'GET', path,
        }));
      }

      /* the two upgrades */
      for (const as of ['anon', 'member']) {
        calls.push(await one(worker, who, vars, {
          meta: { m: 'GET', p: '/api/comments/live', as, road: 'upgrade' },
          m: 'GET', path: '/api/comments/live' + (as === 'member' ? '?h=' + who.member.hash : ''),
          opts: () => ({ headers: { Upgrade: 'websocket' } }),
        }));
        calls.push(await one(worker, who, vars, {
          meta: { m: 'GET', p: '/api/merecat/live', as, road: 'upgrade' },
          m: 'GET', path: (ids) => '/api/merecat/live?chat=' + ids.chat,
          opts: () => ({ headers: { Upgrade: 'websocket' } }),
        }));
      }
      /* the four cron chains */
      for (const cron of ['0 * * * *', '15 3 * * *', '30 23 * * *', '0 0 1 * *']) {
        resetCaches();
        const { db, lib } = seed(who);
        const env = makeEnv({ db, libdb: lib, hub: hubSpy(), vars });
        await stock(env, who);
        const before = net.calls.length;
        const cx = ctx();
        await worker.scheduled({ cron }, env, cx);
        await cx.settle();
        const backups = [];
        for (const [key, o] of env.BACKUPS.objects) {
          let text = '';
          try { text = gunzipSync(Buffer.from(o.bytes)).toString('utf8'); } catch (e) { text = Buffer.from(o.bytes).toString('utf8'); }
          backups.push({ key, text });
        }
        const discord = net.calls.slice(before).filter((c) => c.url.startsWith('https://discord.com/'))
          .map((c) => ({ url: c.url, body: String((c.init && c.init.body) || '') }));
        crons.push({ cron, emails: env.emails, discord, backups, egress: egressRows(db) });
      }
    }
  } finally {
    net.restore();
  }
  return { calls, crons, who };
}

/* ---- what an answer carried ------------------------------------------------ */

export const secretsIn = (text) => SECRETS.filter((s) => String(text).includes(s.value)).map((s) => s.name);
export const privatesIn = (text) => Object.entries(PRIVATE).filter(([, x]) => String(text).includes(x.value)).map(([k]) => k);
/* the private values a reader saw that were not theirs to see */
export const forbiddenFor = (as, text) => privatesIn(text).filter((k) => !PRIVATE[k].who.includes(as));
