/* Media hygiene (2026-09-12; run through the roads since 2026-09-16): every
 * road that removes a message — a delete, an expiry, a prune, a purge, a
 * member's deletion — takes the media object (R2) and its accounting row with
 * it, on all three surfaces: the feed, the board, the DMs. The audit the owner
 * asked for, made a standing guard.
 *
 * What would break silently: a delete path that nulls the row's media_key
 * without purging the object (a leak the sweeps cannot see — the row no
 * longer names the key); a hard delete that drops the row before the key was
 * read; a member's deletion that leaves their feed and its media behind (the
 * gap found and closed the same day); a shared object taken while another
 * word still names it, or kept when the last one goes; a sweep dropped from
 * the cron chain. So: each road is driven through the worker over a seeded
 * ledger (tests/_support/worker.mjs) and the R2 spy records every delete WITH
 * a snapshot of what still named the key at that moment — the proof that the
 * key was read before the row went. Only the cron chain stays a source rule. */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { sweepExpiredDms, sweepWallOrphanMedia, runWallPrune } from '../../comments-worker/src/lib.ts';
import { loadWorker, makeEnv, client, freshDb, identity, establish, publishKey, resetCaches, netSpy, routesSource } from '../_support/worker.mjs';

const idx = routesSource();
let worker, A, B, C, ADM, net, who;
before(async () => {
  ({ worker } = await loadWorker());
  [A, B, C, ADM] = await Promise.all(['a', 'b', 'c', 'admin'].map(identity));
  who = Object.fromEntries([[A.hash, 'A'], [B.hash, 'B'], [C.hash, 'C'], [ADM.hash, 'ADM']]);
  net = netSpy();
});
after(() => { assert.deepEqual(net.calls, [], 'no request reached the network'); net.restore(); });
beforeEach(resetCaches);

/* what still names a key, read at the instant the object is deleted */
const naming = (db) => (key) => ({
  board: db.prepare('SELECT status, page FROM comments WHERE media_key = ?').all(key).map((r) => r.status + '@' + r.page),
  posts: db.prepare('SELECT status FROM wall_posts WHERE media_key = ?').all(key).map((r) => r.status),
  wcomments: db.prepare('SELECT status FROM wall_comments WHERE media_key = ?').all(key).map((r) => r.status),
  dms: db.prepare('SELECT COALESCE(redacted, 0) AS r FROM dms WHERE media_key = ?').all(key).map((r) => r.r),
  row: db.prepare('SELECT COUNT(*) AS n FROM wall_media WHERE key = ?').get(key).n + db.prepare('SELECT COUNT(*) AS n FROM dm_media WHERE key = ?').get(key).n,
});
const deletes = (env, bucket) => env.r2.filter((c) => c.op === 'delete' && c.bucket === bucket).map((c) => [c.key, c.at]);
const setup = () => {
  const db = freshDb();
  for (const x of [A, B, C, ADM]) establish(db, x.hash);
  const env = makeEnv({ db, snapshot: naming(db), vars: { ADMIN_HASHES: ADM.hash } });
  return { db, env, api: client(worker, env) };
};
const wallMedia = (db, key, refType, refId, created = 100) => db.prepare('INSERT INTO wall_media (key, size, created_at, ref_type, ref_id) VALUES (?, 10, ?, ?, ?)').run(key, created, refType, refId);

test('the board: a soft-deleted post, a deleted topic, a move into the back room — every attachment purged while the row still names it, then the pointer nulled', async () => {
  const { db, env, api } = setup();
  const post = db.prepare('INSERT INTO comments (id, page, parent_id, title, author_hash, body, created_at, media_key, media_size) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 10)');
  post.run(1, 'board:pub', null, 'A topic', A.hash, 'head', 100, 'wall/i/t1');
  post.run(2, 'board:pub', 1, null, A.hash, 'reply a', 110, 'wall/i/r2');
  post.run(3, 'board:pub', 1, null, B.hash, 'reply b', 120, 'wall/i/r3');
  post.run(5, 'board:pub', null, 'Another', A.hash, 'head', 130, 'wall/i/t5');
  post.run(6, 'board:pub', 5, null, B.hash, 'reply', 140, 'wall/i/r6');
  for (const [k, id] of [['wall/i/t1', 1], ['wall/i/r2', 2], ['wall/i/r3', 3], ['wall/i/t5', 5], ['wall/i/r6', 6]]) wallMedia(db, k, 'board', id);
  /* the member's own delete (an admin's, by the same road) */
  let r = await api.post('/api/comments/delete', { key: A.key, id: 2 });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(deletes(env, 'WALLMEDIA'), [['wall/i/r2', { board: ['deleted@board:pub'], posts: [], wcomments: [], dms: [], row: 1 }]],
    'the object went while the row still named it (the status and the key flip in one statement) and its accounting row stood');
  assert.deepEqual({ ...db.prepare('SELECT status, media_key, media_size FROM comments WHERE id = 2').get() }, { status: 'deleted', media_key: null, media_size: null }, 'then the pointer is nulled');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM wall_media WHERE key = 'wall/i/r2'").get().n, 0, 'and the accounting row is gone');
  /* a topic delete gathers the thread's keys — head and replies — before the status flips */
  r = await api.post('/api/comments/moderate', { key: ADM.key, id: 1, act: 'delete' });
  assert.deepEqual({ status: r.status, deleted: r.json.deleted }, { status: 200, deleted: true });
  assert.deepEqual(deletes(env, 'WALLMEDIA').slice(1).map(([k, at]) => [k, at.board]).sort(), [['wall/i/r3', ['live@board:pub']], ['wall/i/t1', ['live@board:pub']]], 'the keys read and purged before the status flips');
  assert.deepEqual(db.prepare('SELECT id, status, media_key FROM comments WHERE id IN (1, 3) ORDER BY id').all().map((c) => [c.id, c.status, c.media_key]), [[1, 'deleted', null], [3, 'live', null]], 'the head retired, the reply an orphan — neither names a key');
  /* a move into the back room is a retraction: purged before the page changes */
  r = await api.post('/api/comments/move', { key: ADM.key, id: 5, cat: 'adminsonly' });
  assert.deepEqual({ status: r.status, moved: r.json.moved }, { status: 200, moved: true });
  assert.deepEqual(deletes(env, 'WALLMEDIA').slice(3).map(([k, at]) => [k, at.board]).sort(), [['wall/i/r6', ['live@board:pub']], ['wall/i/t5', ['live@board:pub']]], 'purged while still on the public board');
  assert.deepEqual(db.prepare('SELECT page, media_key FROM comments WHERE id IN (5, 6)').all().map((c) => [c.page, c.media_key]), [['board:adminsonly', null], ['board:adminsonly', null]]);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM wall_media').get().n, 0, 'no accounting row survives its object');
  r = await api.post('/api/comments/moderate', { key: A.key, id: 5, act: 'delete' });
  assert.equal(r.status, 403, 'moderation is an admin\'s');
  db.close();
});

test('the feed: a deleted comment takes its media, a deleted post its comments\' too, the prune everything past the line — keys read before rows go', async () => {
  const { db, env, api } = setup();
  const now = Math.floor(Date.now() / 1000);
  db.prepare("INSERT INTO wall_posts (id, author_hash, body, created_at, media_key, comments) VALUES (1, ?, 'mine', ?, 'wall/i/p1', 2), (2, ?, 'old', 1, 'wall/i/old', 1), (3, ?, 'new', ?, 'wall/i/new', 0)").run(A.hash, now - 100, A.hash, B.hash, now - 50);
  db.prepare("INSERT INTO wall_comments (id, post_id, author_hash, body, created_at, media_key) VALUES (10, 1, ?, 'on it', ?, 'wall/i/c10'), (11, 1, ?, 'me too', ?, NULL), (20, 2, ?, 'on the old', 2, 'wall/i/oldc')").run(B.hash, now - 90, A.hash, now - 80, B.hash);
  for (const [k, t, id] of [['wall/i/p1', 'post', 1], ['wall/i/c10', 'comment', 10], ['wall/i/old', 'post', 2], ['wall/i/oldc', 'comment', 20], ['wall/i/new', 'post', 3]]) wallMedia(db, k, t, id);
  let r = await api.post('/api/comments/wall/delete', { key: B.key, kind: 'comment', id: 10 });
  assert.equal(r.status, 200);
  assert.deepEqual(deletes(env, 'WALLMEDIA'), [['wall/i/c10', { board: [], posts: [], wcomments: ['live'], dms: [], row: 1 }]], 'a comment: purged while its row stood, then the row went');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM wall_comments WHERE id = 10').get().n, 0);
  assert.equal(db.prepare('SELECT comments FROM wall_posts WHERE id = 1').get().comments, 1, 'the post\'s count follows');
  r = await api.post('/api/comments/wall/delete', { key: C.key, id: 1 });
  assert.equal(r.status, 403, 'not mine, not an admin');
  r = await api.post('/api/comments/wall/delete', { key: A.key, id: 1 });
  assert.equal(r.status, 200);
  assert.deepEqual(deletes(env, 'WALLMEDIA').slice(1).map(([k, at]) => [k, at.posts]), [['wall/i/p1', ['live']]], 'a post: its key read and purged before the rows go');
  assert.deepEqual(db.prepare('SELECT COUNT(*) AS n FROM wall_posts WHERE id = 1').get().n + db.prepare('SELECT COUNT(*) AS n FROM wall_comments WHERE post_id = 1').get().n, 0, 'the post and every comment under it');
  /* the prune: everything past the line, keys first */
  const pruned = await runWallPrune(env, 30);
  assert.equal(pruned, 1, 'the old post');
  assert.deepEqual(deletes(env, 'WALLMEDIA').slice(2).map(([k, at]) => [k, at.posts.concat(at.wcomments)]).sort(), [['wall/i/old', ['live']], ['wall/i/oldc', ['live']]], 'the old post\'s and its comment\'s objects, purged while the rows stood');
  assert.deepEqual(db.prepare('SELECT id FROM wall_posts ORDER BY id').all().map((p) => p.id), [3], 'the new post stays, with its object');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM wall_media WHERE key = 'wall/i/new'").get().n, 1);
  db.close();
});

test('the DMs: a redacted message, an expired one, an aged attachment, an orphan, a purged conversation — each lets go of its object, which dies with its LAST reference (0016)', async () => {
  const { db, env, api } = setup();
  publishKey(db, A.hash); publishKey(db, B.hash);
  const now = Math.floor(Date.now() / 1000);
  const K = (n) => 'dm/' + String(n).repeat(64);
  db.prepare("INSERT INTO dm_threads (id, kind, pair_key, created_at, last_at, last_sender, msgs) VALUES (1, 0, ?, 1, 140, ?, 3), (2, 1, NULL, 1, 130, ?, 2)").run([A.hash, B.hash].sort().join('|'), A.hash, A.hash);
  db.prepare('INSERT INTO dm_members (thread_id, hash, joined_at) VALUES (1, ?, 1), (1, ?, 1), (2, ?, 1), (2, ?, 1), (2, ?, 1)').run(A.hash, B.hash, A.hash, B.hash, C.hash);
  const ins = db.prepare('INSERT INTO dms (id, thread_id, sender_hash, body, created_at, enc, media_key, media_size, saved, expires_at) VALUES (?, ?, ?, ?, ?, 3, ?, 10, ?, ?)');
  ins.run(1, 1, A.hash, 'E3.1', 100, K(1), 0, null);
  ins.run(2, 1, B.hash, 'E3.2', 110, K(2), 0, null);           // the original of a forward
  ins.run(3, 2, B.hash, 'E3.3 forwarded', 120, K(2), 0, null); // names the SAME object
  ins.run(4, 2, A.hash, 'E3.4 saved', 130, K(3), 1, null);     // saved — but its object is aged past the cap
  ins.run(5, 1, A.hash, 'E3.5', 140, K(5), 0, now - 10);       // expired
  const media = db.prepare('INSERT INTO dm_media (key, size, created_at) VALUES (?, 10, ?)');
  media.run(K(1), now - 100); media.run(K(2), now - 100); media.run(K(3), 1); media.run(K(5), now - 100);
  media.run(K(4), now - 1000);   // an orphan past the window: nothing names it
  media.run(K(6), now - 10);     // a fresh upload not yet linked: spared
  const refs = db.prepare('INSERT INTO dm_media_refs (key, msg_id) VALUES (?, ?)');
  refs.run(K(1), 1); refs.run(K(2), 2); refs.run(K(2), 3); refs.run(K(3), 4); refs.run(K(5), 5);
  db.prepare("INSERT INTO dm_keys (msg_id, hash, sealed) VALUES (1, ?, 'ka'), (1, ?, 'kb')").run(A.hash, B.hash);
  /* a redact lets go before it blanks */
  let r = await api.post('/api/comments/dm/redact', { key: A.key, id: 1 });
  assert.deepEqual({ status: r.status, redacted: r.json.redacted }, { status: 200, redacted: true });
  assert.deepEqual(deletes(env, 'MEDIA'), [[K(1), { board: [], posts: [], wcomments: [], dms: [0], row: 1 }]], 'the object went while the word still named it, unredacted');
  assert.deepEqual({ ...db.prepare('SELECT body, redacted, media_key FROM dms WHERE id = 1').get() }, { body: '', redacted: 1, media_key: null }, 'then the word is blanked');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM dm_keys WHERE msg_id = 1').get().n, 0, 'nothing is left to open');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM dm_media WHERE key = ?').get(K(1)).n, 0, 'the accounting row went with it');
  /* a shared object: the redact of one word leaves the object to the other */
  r = await api.post('/api/comments/dm/redact', { key: B.key, id: 2 });
  assert.equal(r.status, 200);
  assert.equal(deletes(env, 'MEDIA').length, 1, 'no object deleted — the forward still names it');
  assert.deepEqual(db.prepare('SELECT msg_id FROM dm_media_refs WHERE key = ?').all(K(2)).map((x) => x.msg_id), [3], 'only this word\'s reference went');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM dm_media WHERE key = ?').get(K(2)).n, 1);
  r = await api.post('/api/comments/dm/redact', { key: C.key, id: 3 });
  assert.equal(r.status, 404, 'only the sender redacts');
  /* the hourly sweep: expiry lets go before the rows go; the cap takes an aged object from under every word naming it; an orphan past the window goes, a fresh one is spared */
  await sweepExpiredDms(env);
  const swept = deletes(env, 'MEDIA').slice(1);
  assert.deepEqual(swept.map(([k]) => k).sort(), [K(3), K(4), K(5)].sort(), 'the expired word\'s object, the aged object, the old orphan — and neither the shared object nor the fresh upload');
  assert.deepEqual(swept.find(([k]) => k === K(5))[1].dms, [0], 'expiry: the reference let go while the row still stood');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM dms WHERE id = 5').get().n, 0, 'then the expired word is gone');
  assert.deepEqual({ ...db.prepare('SELECT media_key, media_expired, saved FROM dms WHERE id = 4').get() }, { media_key: null, media_expired: 1, saved: 1 }, 'the aged object taken from under the saved word, which stays and says so');
  assert.deepEqual(db.prepare('SELECT key FROM dm_media ORDER BY key').all().map((x) => x.key), [K(2), K(6)], 'the shared object and the fresh upload remain');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM dm_media_refs WHERE key IN (?, ?)').get(K(3), K(5)).n, 0, 'no reference outlives its object');
  /* a purged conversation: the references first, and the last reference takes the object */
  r = await api.post('/api/comments/dm/delete', { key: A.key, thread_id: 2 });
  assert.deepEqual({ status: r.status, purged: r.json.purged }, { status: 200, purged: false }, 'B and C have not cleared: nothing is destroyed');
  await api.post('/api/comments/dm/delete', { key: B.key, thread_id: 2 });
  r = await api.post('/api/comments/dm/delete', { key: C.key, thread_id: 2 });
  assert.equal(r.json.purged, true, 'every member cleared and no word outlives the earliest clear');
  const last = deletes(env, 'MEDIA').slice(-1)[0];
  assert.deepEqual([last[0], last[1].dms], [K(2), [0]], 'the forward was the last word naming the shared object: it goes now, read before the row');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM dms WHERE thread_id = 2').get().n + db.prepare('SELECT COUNT(*) AS n FROM dm_threads WHERE id = 2').get().n, 0, 'the conversation is gone');
  assert.deepEqual(db.prepare('SELECT key FROM dm_media').all().map((x) => x.key), [K(6)], 'only the fresh upload remains, for the next sweep to judge');
  db.close();
});

test('the backstops stand in the cron chain, and the board orphan rule spares only a live or pending owner', async () => {
  /* since 2026-09-16 the chains are step lists ops.ts runs (each step in its own try/catch) */
  const sched = idx.slice(idx.indexOf('const HOURLY_STEPS'), idx.indexOf('export default {'));
  for (const fn of ['sweepExpiredDms', 'sweepWallOrphanMedia', 'sweepMediaRetention']) assert.ok(sched.includes("['" + fn + "', " + fn + "]"), fn + ' is scheduled');
  const { db, env } = setup();
  const now = Math.floor(Date.now() / 1000);
  const post = db.prepare("INSERT INTO comments (id, page, author_hash, body, status, created_at, media_key) VALUES (?, 'board:pub', ?, 'x', ?, 1, ?)");
  post.run(1, A.hash, 'live', 'wall/i/b1'); post.run(2, A.hash, 'deleted', 'wall/i/b2'); post.run(3, A.hash, 'pending', 'wall/i/b3');
  wallMedia(db, 'wall/i/b1', 'board', 1); wallMedia(db, 'wall/i/b2', 'board', 2); wallMedia(db, 'wall/i/b3', 'board', 3);
  wallMedia(db, 'wall/i/u1', null, null, now - 1000);   // unlinked, past the window
  wallMedia(db, 'wall/i/u2', null, null, now - 10);     // unlinked, fresh
  wallMedia(db, 'wall/i/p99', 'post', 99);              // its post is gone
  await sweepWallOrphanMedia(env);
  assert.deepEqual(deletes(env, 'WALLMEDIA').map(([k]) => k).sort(), ['wall/i/b2', 'wall/i/p99', 'wall/i/u1'], 'a soft-deleted post\'s attachment, a postless one, an abandoned upload — reclaimed within the hour');
  assert.deepEqual(db.prepare('SELECT key FROM wall_media ORDER BY key').all().map((x) => x.key), ['wall/i/b1', 'wall/i/b3', 'wall/i/u2'], 'a live owner, a pending owner (the admin queue\'s evidence), a fresh upload: spared');
  db.close();
});

test('delete user, through the road: their feed posts (with everyone\'s comments under them), their comments elsewhere, their board attachments, the reactions, the counts — every key gathered and purged, the profile and the avatar gone, the hash locked', async () => {
  const { db, env, api } = setup();
  const gone = B, other = C;
  db.prepare("INSERT INTO wall_posts (id, author_hash, body, created_at, media_key, comments) VALUES (1, ?, 'mine', 1, 'wall/i/aa', 2), (2, ?, 'theirs', 1, 'wall/i/bb', 1)").run(gone.hash, other.hash);
  db.prepare("INSERT INTO wall_comments (id, post_id, author_hash, body, created_at, media_key) VALUES (10, 1, ?, 'on mine', 2, 'wall/i/cc'), (11, 1, ?, 'me on mine', 3, NULL), (12, 2, ?, 'me on theirs', 4, 'wall/i/dd'), (13, 2, ?, 'them on theirs', 5, NULL)").run(other.hash, gone.hash, gone.hash, other.hash);
  db.prepare("INSERT INTO reactions (target, target_id, author_hash, emoji, created_at) VALUES ('wall', 1, ?, '👍', 1), ('wallc', 12, ?, '❤️', 1), ('wall', 2, ?, '😂', 1)").run(other.hash, other.hash, gone.hash);
  db.prepare("INSERT INTO comments (id, page, author_hash, body, created_at, media_key) VALUES (7, 'board:pub', ?, 'a board post', 1, 'wall/i/board')").run(gone.hash);
  for (const [k, t, id] of [['wall/i/aa', 'post', 1], ['wall/i/bb', 'post', 2], ['wall/i/cc', 'comment', 10], ['wall/i/dd', 'comment', 12], ['wall/i/board', 'board', 7]]) wallMedia(db, k, t, id);
  let r = await api.post('/api/comments/deleteuser', { key: A.key, hash: gone.hash });
  assert.equal(r.status, 403, 'an admin\'s road');
  r = await api.post('/api/comments/deleteuser', { key: ADM.key, hash: gone.hash });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const dels = deletes(env, 'WALLMEDIA');
  assert.deepEqual(dels.map(([k]) => k).sort(), ['wall/i/aa', 'wall/i/board', 'wall/i/cc', 'wall/i/dd'], 'my post\'s image, the comment\'s image under it, my comment\'s image under theirs, my board attachment — and not their post\'s');
  /* The feed road gathers the keys from the rows, deletes the rows, then purges — the
     order the 2026-09-12 audit fixed; what proves the keys were read first is that the
     purge happened at all, each object going with its accounting row still standing. */
  assert.ok(dels.every(([, at]) => at.row === 1), 'each object purged with its accounting row still standing');
  assert.deepEqual(dels.find(([k]) => k === 'wall/i/board')[1].board, ['live@board:pub'], 'the board attachment went before the post was retired');
  assert.deepEqual(db.prepare('SELECT id FROM wall_posts ORDER BY id').all().map((p) => p.id), [2], 'their post stays');
  assert.deepEqual(db.prepare('SELECT id FROM wall_comments ORDER BY id').all().map((c) => c.id), [13], 'only their own comment under their own post stays');
  assert.equal(db.prepare('SELECT comments FROM wall_posts WHERE id = 2').get().comments, 1, 'the surviving post\'s count is recomputed');
  assert.deepEqual(db.prepare('SELECT target, target_id FROM reactions').all().map((x) => x.target + ':' + x.target_id), ['wall:2'], 'the reactions on what went, gone; my reaction on their post stays with it');
  assert.deepEqual({ ...db.prepare('SELECT status, media_key FROM comments WHERE id = 7').get() }, { status: 'deleted', media_key: null }, 'the board post retired, its pointer nulled');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM wall_media').get().n, 1, 'one accounting row left: their post\'s');
  assert.deepEqual(deletes(env, 'AVATARS').map(([k]) => k), ['avatars/' + gone.hash], 'the avatar goes too');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM profiles WHERE hash = ?').get(gone.hash).n, 0, 'the profile is gone');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM locks WHERE hash = ?').get(gone.hash).n, 1, 'and the hash is locked');
  db.close();
});
