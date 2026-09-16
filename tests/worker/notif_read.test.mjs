/* Reading marks read (2026-09-12; run through the doors since 2026-09-16), on
 * the real ledger: opening a conversation clears every bell it rang the reader
 * — a message, a reaction, a missed call — and no other conversation's (since
 * 0016 a DM bell names its thread; a row from before still names its sender);
 * the seen ping runs the same mark; opening a feed post clears the post's
 * bells and no other post's; and every door hands the fresh count back, so
 * the badge tells the truth at once.
 *
 * What would break silently: a kind left out (a reaction's bell staying lit
 * after the thread was read); a WHERE without the sender (one open clearing
 * every sender's bells); the post's mark keyed on the wrong id; a door
 * answering without notif_unread (the bell staying lit for a thing the reader
 * is looking at). */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadWorker, makeEnv, client, freshDb, identity, resetCaches, netSpy } from '../_support/worker.mjs';

let worker, me, ann, bob, net, who;
before(async () => {
  ({ worker } = await loadWorker());
  [me, ann, bob] = await Promise.all(['me', 'ann', 'bob'].map(identity));
  who = Object.fromEntries([[me.hash, 'me'], [ann.hash, 'ann'], [bob.hash, 'bob']]);
  net = netSpy();
});
after(() => { assert.deepEqual(net.calls, [], 'no request reached the network'); net.restore(); });
beforeEach(resetCaches);

function seeded() {
  const db = freshDb();
  /* thread 7 is the pair with ann, thread 8 a group ann is also in */
  db.prepare("INSERT INTO dm_threads (id, kind, pair_key, created_at, last_at, last_sender, msgs) VALUES (7, 0, ?, 1, 1, ?, 0), (8, 1, NULL, 1, 1, ?, 0)").run([me.hash, ann.hash].sort().join('|'), ann.hash, ann.hash);
  db.prepare('INSERT INTO dm_members (thread_id, hash, joined_at) VALUES (7, ?, 1), (7, ?, 1), (8, ?, 1), (8, ?, 1)').run(me.hash, ann.hash, me.hash, ann.hash);
  /* two feed posts of ann's */
  db.prepare("INSERT INTO wall_posts (id, author_hash, body, created_at) VALUES (3, ?, 'three', 1), (4, ?, 'four', 1)").run(ann.hash, ann.hash);
  const ins = db.prepare('INSERT INTO notifications (recipient_hash, kind, topic_id, comment_id, actor_hash, created_at) VALUES (?, ?, ?, ?, ?, 1)');
  /* Since 0016 a DM bell names its conversation in topic_id; a row from before (0) still names ann alone. */
  ins.run(me.hash, 'dm', 7, 0, ann.hash); ins.run(me.hash, 'dm-react', 7, 44, ann.hash); ins.run(me.hash, 'call', 7, 0, ann.hash);
  ins.run(me.hash, 'dm', 0, 0, ann.hash);                          // a bell from before 0016: no thread on it, matched by its sender
  ins.run(me.hash, 'dm', 8, 0, ann.hash);                          // the group's bell: another conversation, stays
  ins.run(me.hash, 'dm', 0, 0, bob.hash);                          // another sender: stays
  ins.run(me.hash, 'reply', 5, 9, ann.hash);                       // a board bell from ann: not the thread's
  ins.run(me.hash, 'wall', 1, 3, ann.hash); ins.run(me.hash, 'wall-react', 0, 3, bob.hash); ins.run(me.hash, 'wall-like', 0, 4, ann.hash);   // the feed: post 3 twice, post 4 once
  return db;
}
const unread = (db) => db.prepare('SELECT kind, topic_id, actor_hash FROM notifications WHERE read_at IS NULL ORDER BY id').all().map((r) => [r.kind, r.topic_id, who[r.actor_hash]]);

test('opening a conversation reads the three kinds it rang me — by the thread, or by the sender for a bell from before 0016 — and nothing else; the fresh count rides back', async () => {
  const db = seeded();
  const api = client(worker, makeEnv({ db }));
  let r = await api.post('/api/comments/dm/thread', { key: me.key, thread_id: 7 });
  assert.equal(r.status, 200);
  assert.deepEqual(unread(db), [['dm', 8, 'ann'], ['dm', 0, 'bob'], ['reply', 5, 'ann'], ['wall', 1, 'ann'], ['wall-react', 0, 'bob'], ['wall-like', 0, 'ann']],
    'the message, the reaction, the missed call and the old row by its sender are read; the group, the other sender, the board, the feed: untouched');
  assert.equal(r.json.notif_unread, 6, 'the door says the fresh count');
  /* A group has no "other": its open clears by the thread alone. */
  r = await api.post('/api/comments/dm/thread', { key: me.key, thread_id: 8 });
  assert.deepEqual(unread(db).slice(0, 2), [['dm', 0, 'bob'], ['reply', 5, 'ann']], 'the group\'s bell, by its id');
  assert.equal(r.json.notif_unread, 5);
  db.close();
});

test('the seen ping runs the same mark, and answers the count', async () => {
  const db = seeded();
  const api = client(worker, makeEnv({ db }));
  const r = await api.post('/api/comments/dm/seen', { key: me.key, thread_id: 7 });
  assert.equal(r.status, 200);
  assert.deepEqual(unread(db).map((x) => x[0] + ':' + x[1]), ['dm:8', 'dm:0', 'reply:5', 'wall:1', 'wall-react:0', 'wall-like:0'], 'the same four bells read');
  assert.equal(r.json.notif_unread, 6);
  const none = await api.post('/api/comments/dm/seen', { key: me.key, thread_id: 99 });
  assert.deepEqual({ status: none.status, ok: none.json.ok }, { status: 200, ok: true }, 'a conversation that is not mine is a quiet ok, and marks nothing');
  assert.equal(unread(db).length, 6);
  db.close();
});

test('opening a feed post reads its bells and no other post\'s — and a keyless reader marks nothing', async () => {
  const db = seeded();
  const api = client(worker, makeEnv({ db }));
  let r = await api.post('/api/comments/wall/post/get', { id: 3 });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.notif_unread, undefined, 'no key, no count');
  assert.equal(unread(db).length, 10, 'and nothing read');
  r = await api.post('/api/comments/wall/post/get', { key: me.key, id: 3 });
  assert.equal(r.status, 200);
  assert.deepEqual(unread(db).filter((x) => x[0].startsWith('wall')), [['wall-like', 0, 'ann']], 'post 3: the comment and the reaction read; post 4\'s like stays');
  assert.equal(r.json.notif_unread, 8, 'the door says the fresh count');
  db.close();
});
