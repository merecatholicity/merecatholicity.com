/* Per-message DM reactions (migration 0012, `/dm/react`, the live `dm-react`
 * and `dm-save` events; run through the handlers since 2026-09-16).
 *
 * What would break silently: a reaction stored without the kernel's validator
 * (an inline regex in the worker drifting from the picker's), the old heart
 * lost in the move (a like from August that no longer lights), `/dm/like`
 * answering 404 to a client cached before the picker, a reaction accepted on a
 * message the reactor cannot see (held, expired, redacted, behind their own
 * clear stamp), the other side never hearing a reaction or a save, a bell rung
 * for a word its author has on screen. So: the ledger builds and 0012
 * backfills against a genuinely pre-0012 database, and the roads are driven
 * through the worker over a seeded ledger (tests/_support/worker.mjs), with
 * the hub spy hearing the frames. */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { reactionOf, dmReaction } from '../../comments-worker/src/lib.ts';
import { loadWorker, makeEnv, client, freshDb, identity, resetCaches, netSpy, hubSpy, handlerBody, routesSource } from '../_support/worker.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const migrationsDir = join(root, 'comments-worker', 'migrations');
const idxSrc = routesSource();

/* the ledger as of one migration (the backfill test needs a pre-0012 database) */
function ledgerUpTo(upTo) {
  const db = new DatabaseSync(':memory:');
  let files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  if (upTo) files = files.filter((f) => f.slice(0, 4) <= upTo);
  for (const f of files) db.exec(readFileSync(join(migrationsDir, f), 'utf8'));
  return { db, files };
}

let worker, A, B, C, D, net, who;
before(async () => {
  ({ worker } = await loadWorker());
  [A, B, C, D] = await Promise.all(['a', 'b', 'c', 'd'].map(identity));
  who = Object.fromEntries([[A.hash, 'A'], [B.hash, 'B'], [C.hash, 'C'], [D.hash, 'D']]);
  net = netSpy();
});
after(() => { assert.deepEqual(net.calls, [], 'no request reached the network'); net.restore(); });
beforeEach(resetCaches);

/* A pair (A, B) with B's word 1 and A's word 2, and a group (A, B, C joined late) with words 3 (before C), 4 (held from A? no — in a group B is not held; 4 is expired), 5 live. */
function seeded() {
  const db = freshDb();
  db.prepare("INSERT INTO dm_threads (id, kind, pair_key, created_at, last_at, last_sender, msgs) VALUES (1, 0, ?, 100, 200, ?, 2), (2, 1, NULL, 100, 500, ?, 3)").run(A.hash + '|' + B.hash, A.hash, B.hash);
  db.prepare('INSERT INTO dm_members (thread_id, hash, joined_at) VALUES (1, ?, 100), (1, ?, 100), (2, ?, 100), (2, ?, 100), (2, ?, 400)').run(A.hash, B.hash, A.hash, B.hash, C.hash);
  const ins = db.prepare('INSERT INTO dms (id, thread_id, sender_hash, body, created_at, held, enc, expires_at, opened_at) VALUES (?, ?, ?, ?, ?, ?, 3, ?, ?)');
  ins.run(1, 1, B.hash, 'E3.b1', 150, null, null, null);
  ins.run(2, 1, A.hash, 'E3.a2', 200, null, null, null);
  ins.run(3, 2, B.hash, 'E3.b3', 300, null, null, null);        // before C joined
  ins.run(4, 2, B.hash, 'E3.b4 expired', 450, null, 460, 450);  // opened and long expired
  ins.run(5, 2, B.hash, 'E3.b5', 500, null, null, null);
  return db;
}
const reactions = (db, id) => db.prepare('SELECT hash, emoji FROM dm_reactions WHERE msg_id = ? ORDER BY hash').all(id).map((r) => [who[r.hash], r.emoji]);
const pairCols = (db, id) => ({ ...db.prepare('SELECT react_a, react_b, liked_a, liked_b FROM dms WHERE id = ?').get(id) });

test('the ledger builds through 0012 and dms carries one reaction column per side', () => {
  const { db, files } = ledgerUpTo();
  assert.ok(files.some((f) => f.startsWith('0012_dm_reactions')), 'migration 0012 present');
  const cols = db.prepare('PRAGMA table_info(dms)').all().map((c) => c.name);
  assert.ok(cols.includes('react_a') && cols.includes('react_b'), 'dms.react_a / dms.react_b');
  assert.ok(cols.includes('liked_a') && cols.includes('liked_b'), 'the old flags are left in place — the ledger never drops a column');
  db.close();
});

test('0012 carries every old like forward as the ❤️ reaction, and nothing else', () => {
  const { db } = ledgerUpTo('0011');
  db.exec("INSERT INTO dm_threads (a_hash, b_hash, created_at, last_at, last_sender, msgs) VALUES ('a', 'b', 1, 1, 'a', 3)");
  const ins = db.prepare('INSERT INTO dms (thread_id, sender_hash, body, created_at, liked_a, liked_b) VALUES (1, ?, ?, 1, ?, ?)');
  ins.run('a', 'one', 1, null);    // a hearted it
  ins.run('b', 'two', null, 1);    // b hearted it
  ins.run('a', 'three', 1, 1);     // both
  ins.run('b', 'four', 0, null);   // nobody
  db.exec(readFileSync(join(migrationsDir, '0012_dm_reactions.sql'), 'utf8'));
  const rows = db.prepare('SELECT body, react_a, react_b FROM dms ORDER BY id').all().map((r) => ({ ...r }));   // node:sqlite rows have a null prototype
  assert.deepEqual(rows, [
    { body: 'one', react_a: '❤️', react_b: null },
    { body: 'two', react_a: null, react_b: '❤️' },
    { body: 'three', react_a: '❤️', react_b: '❤️' },
    { body: 'four', react_a: null, react_b: null },
  ]);
  /* The backfilled bytes are the quick bar's heart: U+2764 U+FE0F. */
  assert.equal(rows[0].react_a, '❤️');
  db.close();
});

test('the reaction is validated by the kernel, in the one worker membrane: the handler answers exactly as reactionOf does', async () => {
  /* Since 2026-09-12 the grammar is Domain.Reaction (shared with the board and
     the feed); dmReaction is that one validator under its DM-era name. */
  assert.equal(dmReaction, reactionOf, 'dmReaction is the same validator');
  assert.deepEqual(['👍', '❤️', ':pepecross:', '🤡🤡', 'abc', ''].map(reactionOf), ['👍', '❤️', ':pepecross:', null, null, null], 'one emoji or one custom token; anything else is nothing');
  assert.ok(!/Extended_Pictographic|\\p\{Emoji/.test(handlerBody('handleDmReact', idxSrc)), 'no emoji regex re-inlined in the handler — the kernel decides');
  const db = seeded();
  const api = client(worker, makeEnv({ db }));
  const react = (viewer, id, emoji) => api.post('/api/comments/dm/react', { key: viewer.key, id, emoji });
  let r = await react(A, 1, '🤡🤡');
  assert.deepEqual({ status: r.status, error: r.json.error }, { status: 400, error: 'Bad request.' }, 'an invalid reaction is a 400, not stored');
  assert.deepEqual(reactions(db, 1), []);
  r = await react(A, 1, '👍');
  assert.deepEqual({ status: r.status, emoji: r.json.emoji }, { status: 200, emoji: '👍' });
  assert.deepEqual(reactions(db, 1), [['A', '👍']]);
  r = await react(A, 1, ':pepecross:');
  assert.deepEqual(reactions(db, 1), [['A', ':pepecross:']], 'a different emoji replaces — one per member per message');
  r = await react(B, 1, '❤️');
  assert.deepEqual(reactions(db, 1).map((x) => x[1]).sort(), [':pepecross:', '❤️'], 'each member their own');
  r = await react(A, 1, '');
  assert.deepEqual({ status: r.status, emoji: r.json.emoji }, { status: 200, emoji: '' }, 'an empty string withdraws');
  assert.deepEqual(reactions(db, 1), [['B', '❤️']], 'a withdrawn reaction is no row at all');
  assert.deepEqual(pairCols(db, 1), { react_a: null, react_b: null, liked_a: null, liked_b: null }, 'the pair columns are never written again');
  db.close();
});

test('the old heart rides the new road: /dm/like is the react handler with ❤️ or nothing', async () => {
  const db = seeded();
  const api = client(worker, makeEnv({ db }));
  let r = await api.post('/api/comments/dm/like', { key: A.key, id: 1, like: 1 });
  assert.equal(r.status, 200, 'a client cached before the picker still lands its heart');
  assert.deepEqual(reactions(db, 1), [['A', '❤️']], '{like:1} is the ❤️ reaction');
  r = await api.post('/api/comments/dm/like', { key: A.key, id: 1, like: 0 });
  assert.equal(r.status, 200);
  assert.deepEqual(reactions(db, 1), [], '{like:0} withdraws');
  db.close();
});

test('a reaction lands only on a message the reactor can see, never a redacted one — from my own seat, since I joined, after my clear, live', async () => {
  const db = seeded();
  const api = client(worker, makeEnv({ db }));
  const react = (viewer, id, emoji = '👍') => api.post('/api/comments/dm/react', { key: viewer.key, id, emoji });
  const refused = async (viewer, id, status, error) => { const r = await react(viewer, id); assert.deepEqual({ status: r.status, error: r.json.error }, { status, error }, `${who[viewer.hash]} on ${id}`); };
  await refused(D, 1, 404, 'No such message.');            // a stranger has no seat
  await refused(C, 3, 404, 'No such message.');            // C joined at 400: word 3 is history denied
  await refused(A, 4, 404, 'No such message.');            // expired
  assert.equal((await react(C, 5)).status, 200, 'C may react to the word since they joined');
  db.prepare('UPDATE dm_members SET cleared_at = 510 WHERE thread_id = 2 AND hash = ?').run(A.hash);
  await refused(A, 5, 404, 'No such message.');            // behind my own clear stamp
  db.prepare('UPDATE dm_members SET left_at = 600 WHERE thread_id = 2 AND hash = ?').run(B.hash);
  await refused(B, 5, 404, 'No such message.');            // a leaver
  db.prepare('UPDATE dms SET held = 1 WHERE id = 1').run();
  await refused(A, 1, 404, 'No such message.');            // held from me: I never see it
  assert.equal((await react(B, 1)).status, 200, 'its sender sees their own held word');
  db.prepare('UPDATE dms SET held = NULL, redacted = 1 WHERE id = 2').run();
  await refused(B, 2, 409, 'That message was deleted.');
  db.close();
});

test('the thread tells every viewer the reactions as the ledger holds them (react_me / react_other derived for a pair, one deploy), every other member hears reactions and saves live, and the bell is quiet for a word on screen', async () => {
  const db = seeded();
  let onScreen = [];
  const hub = hubSpy({ viewersOf: (tag, hashes) => onScreen.filter((h) => hashes.includes(h)) });   // who, of those asked about, has the thread open
  const api = client(worker, makeEnv({ db, hub }));
  let r = await api.post('/api/comments/dm/react', { key: A.key, id: 1, emoji: '👍' });
  assert.equal(r.status, 200);
  await r.ctx.settle();
  assert.deepEqual(hub.frames('dm-react').map((f) => [f.thread_id, f.message, f.scopes]), [[1, { id: 1, emoji: '👍', by: A.hash }, ['user:' + B.hash]]], 'dm-react to the other member, naming who');
  let bells = db.prepare("SELECT kind, topic_id, comment_id, actor_hash FROM notifications WHERE recipient_hash = ?").all(B.hash).map((b) => ({ ...b, actor_hash: who[b.actor_hash] }));
  assert.deepEqual(bells, [{ kind: 'dm-react', topic_id: 1, comment_id: 1, actor_hash: 'A' }], 'a reaction to another\'s word rings their bell, on the message');
  r = await api.post('/api/comments/dm/react', { key: A.key, id: 1, emoji: '' });
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE recipient_hash = ? AND kind = 'dm-react'").get(B.hash).n, 0, 'a withdraw takes an unheard bell back');
  onScreen = [B.hash];
  r = await api.post('/api/comments/dm/react', { key: A.key, id: 1, emoji: '😂' });
  await r.ctx.settle();
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE recipient_hash = ? AND kind = 'dm-react'").get(B.hash).n, 0, 'the quiet bell: B has the thread on screen — the pill lights in front of them, no bell');
  assert.deepEqual(hub.viewersOf.slice(-1), [['t1', [B.hash]]], 'asked of the hub by the thread');
  r = await api.post('/api/comments/dm/react', { key: B.key, id: 2, emoji: '❤️' });
  await r.ctx.settle();
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE recipient_hash = ? AND kind = 'dm-react'").get(A.hash).n, 1, 'A is not on screen: their bell rings');
  r = await api.post('/api/comments/dm/react', { key: A.key, id: 2, emoji: '👍' });
  await r.ctx.settle();
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE kind = 'dm-react'").get().n, 1, 'reacting to my own word rings nothing');
  /* the thread payload */
  r = await api.post('/api/comments/dm/thread', { key: A.key, thread_id: 1 });
  const m1 = r.json.messages.find((m) => m.id === 1), m2 = r.json.messages.find((m) => m.id === 2);
  assert.deepEqual(m1.reactions, [{ hash: A.hash, emoji: '😂' }], 'the ledger\'s rows beside the word');
  assert.deepEqual({ me: m1.react_me, other: m1.react_other, liked_me: m1.liked_me, liked_other: m1.liked_other }, { me: '😂', other: '', liked_me: 1, liked_other: 0 }, 'a pair still reads react_me / react_other and the heart fields, one deploy');
  assert.deepEqual(m2.reactions.map((x) => [who[x.hash], x.emoji]).sort(), [['A', '👍'], ['B', '❤️']]);
  assert.deepEqual({ me: m2.react_me, other: m2.react_other }, { me: '👍', other: '❤️' });
  assert.equal(m1.reactions_json, undefined, 'the raw column never leaves');
  /* a save is for all, and names the saver */
  r = await api.post('/api/comments/dm/save', { key: B.key, id: 2, saved: 1 });
  assert.deepEqual({ status: r.status, saved: r.json.saved, by: who[r.json.saved_by], expires: r.json.expires_at }, { status: 200, saved: 1, by: 'B', expires: null });
  assert.deepEqual({ ...db.prepare('SELECT saved, saved_by, expires_at FROM dms WHERE id = 2').get() }, { saved: 1, saved_by: B.hash, expires_at: null }, 'kept for everyone, the saver written');
  await r.ctx.settle();
  assert.deepEqual(hub.frames('dm-save').map((f) => [f.thread_id, f.message, f.scopes]), [[1, { id: 2, saved: 1, by: B.hash }, ['user:' + A.hash]]], 'dm-save to every other member, naming the saver');
  r = await api.post('/api/comments/dm/save', { key: A.key, id: 2, saved: 0 });
  assert.deepEqual({ ...db.prepare('SELECT saved, saved_by FROM dms WHERE id = 2').get() }, { saved: 0, saved_by: null }, 'any member may unsave; the clock runs again');
  assert.ok(db.prepare('SELECT expires_at FROM dms WHERE id = 2').get().expires_at > 0);
  r = await api.post('/api/comments/dm/save', { key: D.key, id: 2, saved: 1 });
  assert.equal(r.status, 404, 'a stranger saves nothing');
  db.close();
});
