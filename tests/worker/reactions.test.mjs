/* Reactions on public posts (migration 0014, `/react`, `/reacts`, `/react/who`,
 * the `react` / `wall-react` / `dm-react` bells).
 *
 * What would break silently: the feed's old ❤️ likes lost in the move (a like
 * from August that no longer counts); a reaction stored without the kernel's
 * validator; a reaction accepted on a back-room post by an outsider, or the
 * who-reacted read naming a back-room post's reactors; a bell that piles up
 * a row per re-reaction, or one left behind after a withdraw, or one rung for
 * your own post; the notification list joining a DM reaction's message id
 * onto a forum post that shares the number; the wall's bell not hidden with
 * the wall; a deleted post's reactions left in the ledger. So: the ledger
 * builds and 0014 backfills against a genuinely pre-0014 database, the bell's
 * SQL runs on the real ledger, and drift guards stand over the handlers. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const migrationsDir = join(root, 'comments-worker', 'migrations');
const idxSrc = readFileSync(join(root, 'comments-worker', 'src', 'index.ts'), 'utf8');
const libSrc = readFileSync(join(root, 'comments-worker', 'src', 'lib.ts'), 'utf8');

function freshDb(upTo) {
  const db = new DatabaseSync(':memory:');
  let files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  if (upTo) files = files.filter((f) => f.slice(0, 4) <= upTo);
  for (const f of files) db.exec(readFileSync(join(migrationsDir, f), 'utf8'));
  return { db, files };
}
const body = (text, name) => {
  const i = text.indexOf(`async function ${name}(`);
  assert.ok(i > 0, `${name} not found`);
  const j = text.indexOf('\nasync function ', i + 10);
  return text.slice(i, j > i ? j : i + 7000);
};
const me = 'a'.repeat(64), other = 'b'.repeat(64), third = 'c'.repeat(64);

test('the ledger builds through 0014: one reaction per member per target, the notification CHECK widened', () => {
  const { db, files } = freshDb();
  assert.ok(files.some((f) => f.startsWith('0014_reactions')), 'migration 0014 present');
  const cols = db.prepare('PRAGMA table_info(reactions)').all().map((c) => c.name);
  assert.deepEqual(cols, ['target', 'target_id', 'author_hash', 'emoji', 'created_at']);
  const ins = db.prepare('INSERT INTO reactions (target, target_id, author_hash, emoji, created_at) VALUES (?, ?, ?, ?, 1)');
  ins.run('post', 1, me, '👍');
  assert.throws(() => ins.run('post', 1, me, '❤️'), /UNIQUE|PRIMARY/, 'one per member per target');
  assert.throws(() => ins.run('dm', 1, me, '👍'), /CHECK/, 'a DM is not a target');
  const nins = db.prepare('INSERT INTO notifications (recipient_hash, kind, topic_id, comment_id, actor_hash, created_at) VALUES (?, ?, 0, 0, ?, 1)');
  for (const k of ['react', 'wall-react', 'dm-react']) nins.run(me, k, other);
  assert.throws(() => nins.run(me, 'reaction', other), /CHECK/);
  assert.ok(db.prepare("SELECT sql FROM sqlite_master WHERE name = 'notifications_recipient_idx'").get(), 'the index survives the table swap');
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE name = 'wall_likes'").get(), 'the old like tables are left in place — the ledger never drops a table');
  db.close();
});

test('0014 carries every feed like forward as the ❤️ reaction, and nothing else', () => {
  const { db } = freshDb('0013');
  db.exec(`INSERT INTO wall_likes (post_id, author_hash, created_at) VALUES (5, '${me}', 100), (5, '${other}', 101), (6, '${me}', 102)`);
  db.exec(`INSERT INTO wall_comment_likes (comment_id, author_hash, created_at) VALUES (9, '${third}', 103)`);
  db.exec(`INSERT INTO notifications (recipient_hash, kind, topic_id, comment_id, actor_hash, created_at, read_at) VALUES ('${me}', 'wall-like', 0, 5, '${other}', 101, NULL)`);
  db.exec(readFileSync(join(migrationsDir, '0014_reactions.sql'), 'utf8'));
  const rows = db.prepare('SELECT target, target_id, author_hash, emoji, created_at FROM reactions ORDER BY created_at').all().map((r) => ({ ...r }));
  assert.deepEqual(rows, [
    { target: 'wall', target_id: 5, author_hash: me, emoji: '❤️', created_at: 100 },
    { target: 'wall', target_id: 5, author_hash: other, emoji: '❤️', created_at: 101 },
    { target: 'wall', target_id: 6, author_hash: me, emoji: '❤️', created_at: 102 },
    { target: 'wallc', target_id: 9, author_hash: third, emoji: '❤️', created_at: 103 },
  ]);
  assert.equal(rows[0].emoji, '❤️', 'the quick bar\'s heart, U+2764 U+FE0F');
  const n = db.prepare('SELECT kind, read_at FROM notifications').all();
  assert.equal(n.length, 1); assert.equal(n[0].kind, 'wall-like'); assert.equal(n[0].read_at, null, 'the old rows ride the swap unread as they were');
  db.close();
});

/* The bell's SQL, lifted from lib.ts and run on the real ledger: the two
   statements are JS concatenations over o.kind and the EXISTS clause, so they
   are evaluated as the worker evaluates them, never re-typed here. */
function bellSql() {
  const src = body(libSrc, 'notifyReact');
  const stands = src.match(/const stands = o\.target \? ('[^']*') : '';/);
  const up = src.match(/const up = await env\.DB\.prepare\(([\s\S]*?)\)\.bind\(\.\.\.binds\)\.run\(\);/);
  const ins = src.match(/const ins = await env\.DB\.prepare\(([\s\S]*?)\)\.bind\(\.\.\.binds\)\.run\(\);/);
  assert.ok(stands && up && ins, 'the two writes and the EXISTS clause, as the worker builds them');
  const build = (expr) => new Function('o', 'stands', 'return (' + expr + ');');   // parenthesised: a newline after `return` would return nothing
  return { standsExpr: stands[1], up: build(up[1]), ins: build(ins[1]) };
}
function bell(db, o) {
  const { standsExpr, up, ins } = bellSql();
  const st = o.target ? new Function('return (' + standsExpr + ');')() : '';
  const binds = o.target ? [o.to, o.commentId, o.from, o.now, o.topicId, o.target, o.targetId] : [o.to, o.commentId, o.from, o.now, o.topicId];
  const r1 = db.prepare(up(o, st)).run(...binds);
  if (r1.changes > 0) return 'reopened';
  const r2 = db.prepare(ins(o, st)).run(...binds);
  return r2.changes > 0 ? 'rang' : 'quiet';
}

test('the bell on the real ledger: rings once, re-reacting is quiet while unread, reopens after read, needs the reaction to stand', () => {
  const { db } = freshDb();
  db.exec(`INSERT INTO reactions (target, target_id, author_hash, emoji, created_at) VALUES ('post', 9, '${other}', '👍', 100)`);
  const o = { to: me, from: other, kind: 'react', topicId: 5, commentId: 9, target: 'post', targetId: 9, now: 100 };
  assert.equal(bell(db, o), 'rang');
  assert.equal(bell(db, { ...o, now: 101 }), 'quiet', 'a changed emoji while the last bell is unread rings nothing');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM notifications').get().n, 1, 'one row, never a pile');
  db.exec('UPDATE notifications SET read_at = 150');
  assert.equal(bell(db, { ...o, now: 200 }), 'reopened', 'a fresh reaction after the author saw the last one');
  assert.equal(db.prepare('SELECT read_at, created_at FROM notifications').get().read_at, null);
  db.exec('UPDATE notifications SET read_at = 250');
  db.exec('DELETE FROM reactions');
  assert.equal(bell(db, { ...o, now: 300 }), 'quiet', 'a withdrawn reaction rings nothing — the race is closed by EXISTS');
  /* the DM bell has no ledger row to check */
  assert.equal(bell(db, { to: me, from: other, kind: 'dm-react', topicId: 0, commentId: 44, now: 300 }), 'rang');
  /* two posts by the same reactor are two rows; a post and its feed comment too (topic_id apart) */
  db.exec(`INSERT INTO reactions (target, target_id, author_hash, emoji, created_at) VALUES ('wall', 3, '${other}', '😂', 100), ('wallc', 7, '${other}', '😂', 100)`);
  assert.equal(bell(db, { to: me, from: other, kind: 'wall-react', topicId: 0, commentId: 3, target: 'wall', targetId: 3, now: 400 }), 'rang');
  assert.equal(bell(db, { to: me, from: other, kind: 'wall-react', topicId: 7, commentId: 3, target: 'wallc', targetId: 7, now: 401 }), 'rang');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE kind = 'wall-react'").get().n, 2);
  db.close();
});

test('the handler: the kernel validates, a back-room post is invisible to an outsider, your own post rings nothing, a withdraw retracts', () => {
  const h = body(idxSrc, 'handleReact');
  assert.ok(/const emoji: string \| null = raw\.trim\(\) \? reactionOf\(raw\) : '';/.test(h), 'validated through the one membrane; an empty string withdraws');
  assert.ok(/if \(!isReactTarget\(target\) \|\| id < 1 \|\| emoji === null\) return json\(\{ ok: false, error: 'Bad request\.' \}, 400\);/.test(h));
  assert.ok(!/Extended_Pictographic|\\p\{Emoji/.test(h), 'no emoji regex re-inlined in the handler');
  assert.ok(/ON CONFLICT \(target, target_id, author_hash\) DO UPDATE SET emoji = excluded\.emoji/.test(h), 'one reaction per member per target: a new emoji replaces');
  assert.ok(/if \(t\.author && t\.author !== me && t\.author !== MERECAT_BOT\.hash && !\(await isShadowBanned\(env, me\)\)\)/.test(h), 'never for your own post, the bot, or from a muted reactor');
  assert.ok(/await retractReactNotif\(env, bell\);/.test(h), 'a withdraw takes an unheard bell back');
  assert.ok(/publishLive\(env, ctx, \{ v: 1, t: 'react', scopes: t\.scopes, target, id, reacts \}\);/.test(h), 'the tally goes out live on the target\'s scope');
  const rt = body(idxSrc, 'reactTarget');
  assert.ok(/if \(row\.page === ADMIN_CAT && !\(await isAdminHash\(env, me\)\)\) return null;/.test(rt), 'a back-room post is no target for an outsider');
  assert.ok(/status = 'live'/.test(rt), 'only a live row');
  assert.ok(/scopes: \['topic:' \+ topicId\]/.test(rt) && /scopes: \['feed:global'\]/.test(rt));
  const who = body(idxSrc, 'handleReactWho');
  assert.ok(/if \(!row \|\| row\.page === ADMIN_CAT\) return none;/.test(who), 'who reacted to a back-room post is the empty list a missing post gives');
  assert.ok(/shadowExcl\('r'\)/.test(who), 'muted reactors are hidden');
  const mine = body(idxSrc, 'handleReactMine');
  assert.ok(/page != \?1/.test(mine) && /ADMIN_CAT/.test(mine), 'a non-admin\'s own-reactions read never names a back-room id');
  /* the three like roads are aliases of the one handler */
  for (const p of ['/api/comments/wall/like', '/api/comments/wall/comment/like']) assert.ok(idxSrc.includes(`{ m: 'POST', p: '${p}', fn: (request, env, ctx, url) => handleReact(request, env, ctx) }`), p);
  assert.ok(idxSrc.includes("{ m: 'POST', p: '/api/comments/wall/likers', fn: (request, env, ctx, url) => handleReactWho(request, env) }"));
  const alias = idxSrc.slice(idxSrc.indexOf('function reactAlias('), idxSrc.indexOf('async function reactTarget('));
  assert.ok(/raw: like \? '❤️' : ''/.test(alias), 'like:true is the heart, like:false withdraws');
  assert.ok(!/wall_likes|wall_comment_likes/.test(idxSrc) && !/wall_likes|wall_comment_likes/.test(libSrc), 'the frozen like tables are read by nothing');
});

test('the DM reaction rings the other side, only for THEIR message; the row is read with its sender', () => {
  const h = body(idxSrc, 'handleDmReact');
  assert.ok(/SELECT d\.id, d\.thread_id, d\.sender_hash, COALESCE\(d\.redacted, 0\) AS redacted/.test(h));
  assert.ok(/if \(row\.sender_hash === other\) \{/.test(h), 'my own message rings nothing');
  assert.ok(/kind: 'dm-react', topicId: 0, commentId: id/.test(h) && /if \(!onScreen\) \{ const ring = notifyReact\(env, bell\);/.test(h) && /else await retractReactNotif\(env, bell\);/.test(h),
    'rung unless the word is on their screen (the send\'s quiet bell, mirrored 2026-09-12); a withdraw retracts');
});

test('the notification list joins each family to its own tables, and the wall\'s bells hide with the wall', () => {
  const list = body(idxSrc, 'handleNotifList');
  assert.ok(/LEFT JOIN comments t ON t\.id = n\.topic_id AND n\.kind IN ' \+ postKinds/.test(list) && /LEFT JOIN comments c ON c\.id = n\.comment_id AND n\.kind IN ' \+ postKinds/.test(list),
    'a DM reaction\'s message id never lands on a forum post that shares the number');
  assert.ok(/LEFT JOIN wall_comments wc ON wc\.id = n\.topic_id AND n\.kind = 'wall-react'/.test(list), 'a reaction on a feed comment excerpts the comment');
  assert.ok(libSrc.includes("export const NOTIF_POST_KINDS = ['reply', 'mention', 'react'];") && libSrc.includes("export const NOTIF_WALL_KINDS = ['wall', 'wall-like', 'wall-react'];"));
  const prune = body(libSrc, 'pruneNotifications');
  assert.ok(/kind IN " \+ sqlList\(NOTIF_POST_KINDS\) \+ " AND comment_id NOT IN \(SELECT id FROM comments\)/.test(prune), 'a reaction on a deleted board post is swept');
  assert.ok(/kind IN " \+ sqlList\(NOTIF_WALL_KINDS\) \+ " AND comment_id NOT IN \(SELECT id FROM wall_posts\)/.test(prune));
});

test('the tally: one grouped read, most-given first; a deleted feed post takes its reactions with it', () => {
  const { db } = freshDb();
  const ins = db.prepare('INSERT INTO reactions (target, target_id, author_hash, emoji, created_at) VALUES (?, ?, ?, ?, ?)');
  ins.run('post', 1, me, '👍', 1); ins.run('post', 1, other, '❤️', 2); ins.run('post', 1, third, '❤️', 3); ins.run('post', 2, me, '😂', 4);
  const q = body(libSrc, 'reactionsFor').match(/'(SELECT target_id, emoji, COUNT\(\*\) AS n, MIN\(created_at\) AS first FROM reactions WHERE target = \?1 AND target_id IN \()' \+ inList\(chunk\.length, 2\) \+ '(\) ' \+\s*'GROUP BY target_id, emoji ORDER BY target_id, n DESC, first)'/);
  assert.ok(q, 'the grouped query as the worker builds it');
  const rows = db.prepare(q[1] + '?2, ?3' + q[2].replace("' +\n      '", '')).all('post', 1, 2).map((r) => [r.target_id, r.emoji, r.n]);
  assert.deepEqual(rows, [[1, '❤️', 2], [1, '👍', 1], [2, '😂', 1]], 'per target, the most-given emoji first');
  const del = body(idxSrc, 'handleWallDelete');
  assert.ok(/DELETE FROM reactions WHERE target = 'wallc' AND target_id IN \(SELECT id FROM wall_comments WHERE post_id = \?1\)/.test(del) && /DELETE FROM reactions WHERE target = 'wall' AND target_id = \?1/.test(del));
  assert.ok(/DELETE FROM reactions WHERE target = 'wallc' AND target_id = \?1/.test(del), 'a deleted feed comment too');
  db.close();
});
