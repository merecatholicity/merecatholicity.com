/* The member model (migration 0016, 2026-09-13; run through the code since
 * 2026-09-16), on the real ledger: a conversation is a thread with member
 * rows, and every rule about who sees what runs through the viewer's own row
 * — what they may read (unheld or their own; since they joined; after their
 * clear; in a group, not from a sender they blocked), who a word reaches, who
 * may read an attachment, and that a member who left has no seat at all. The
 * pair's room is made on its first word by one upsert that survives the
 * legacy pair index too.
 *
 * What would break silently: a member added later reading the history the
 * crypto denies them; a leaver still counted, fanned to, or served an object;
 * a blocker in a group seeing the blocked member's words (or a pair's stored
 * hold governed by the block instead); an attachment served to a stranger; a
 * pair's room minted twice. The fragments and helpers are lib.ts's own,
 * imported and run on the ledger; the inbox and the thread answer through
 * their handlers (tests/_support/worker.mjs). */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DM_VIS, DM_CLEARED, DM_MINE, dmLive, dmThreadFor, ensurePairThread, dmRecipients, dmMediaReadable } from '../../comments-worker/src/lib.ts';
import { loadWorker, makeEnv, client, freshDb, identity, establish, publishKey, resetCaches, netSpy, hubSpy, routesSource } from '../_support/worker.mjs';

const idxSrc = routesSource();
const KEY = 'dm/' + '1'.repeat(64);

let worker, A, B, C, D, net, who;
before(async () => {
  ({ worker } = await loadWorker());
  [A, B, C, D] = await Promise.all(['a', 'b', 'c', 'd'].map(identity));
  who = Object.fromEntries([[A.hash, 'A'], [B.hash, 'B'], [C.hash, 'C'], [D.hash, 'D']]);
  net = netSpy();
});
after(() => { assert.deepEqual(net.calls, [], 'no request reached the network'); net.restore(); });
beforeEach(resetCaches);
const names = (hashes) => hashes.map((h) => who[h]).sort();

/* A group of three (C added late) and a pair, with a block from A on B. */
function seeded() {
  const db = freshDb();
  db.prepare("INSERT INTO dm_threads (id, kind, pair_key, created_at, last_at, last_sender, msgs) VALUES (1, 1, NULL, 100, 400, ?, 3), (2, 0, ?, 100, 260, ?, 2)").run(C.hash, A.hash + '|' + B.hash, B.hash);
  db.prepare('INSERT INTO dm_members (thread_id, hash, joined_at) VALUES (1, ?, 100), (1, ?, 100), (1, ?, 300), (2, ?, 100), (2, ?, 100)').run(A.hash, B.hash, C.hash, A.hash, B.hash);
  const ins = db.prepare('INSERT INTO dms (id, thread_id, sender_hash, body, created_at, held, enc, media_key) VALUES (?, ?, ?, ?, ?, ?, 3, ?)');
  ins.run(1, 1, A.hash, 'E3.a', 200, null, null);          // before C joined
  ins.run(2, 1, B.hash, 'E3.b', 350, null, KEY);           // B's, with the object — A blocks B
  ins.run(3, 1, C.hash, 'E3.c', 400, null, null);
  ins.run(4, 2, B.hash, 'E1.x', 250, null, null);          // the pair, before the block: unheld
  ins.run(5, 2, B.hash, 'E1.y', 260, 1, null);             // the pair, during the block: held
  db.prepare('INSERT INTO dm_media (key, size, created_at) VALUES (?, 10, 349)').run(KEY);
  db.prepare('INSERT INTO dm_media_refs (key, msg_id) VALUES (?, 2)').run(KEY);
  db.prepare('INSERT INTO dm_blocks (owner_hash, blocked_hash, created_at) VALUES (?, ?, 300)').run(A.hash, B.hash);
  return db;
}
const visible = (db, viewer, thread, now = 1000) => db.prepare(
  'SELECT m.id FROM dms m JOIN dm_threads t ON t.id = m.thread_id JOIN dm_members mb ON mb.thread_id = t.id AND mb.hash = ?1 ' +
  'WHERE m.thread_id = ?2 AND ' + DM_VIS + ' AND ' + DM_CLEARED + ' AND ' + dmLive(now) + ' ORDER BY m.id'
).all(viewer, thread).map((r) => r.id);
const leave = (db, thread, h, at = 500) => db.prepare('UPDATE dm_members SET left_at = ? WHERE thread_id = ? AND hash = ?').run(at, thread, h);

test('what a member may read: since they joined, after their clear, unheld or their own — and in a group never a sender they blocked', () => {
  const db = seeded();
  assert.deepEqual(visible(db, A.hash, 1), [1, 3], 'A: not B\'s word — a blocked sender is silent to the blocker in a group');
  assert.deepEqual(visible(db, B.hash, 1), [1, 2, 3], 'B: everything (the block is A\'s alone)');
  assert.deepEqual(visible(db, C.hash, 1), [2, 3], 'C joined at 300: no history from before');
  assert.deepEqual(visible(db, D.hash, 1), [], 'a stranger has no seat');
  db.prepare('UPDATE dm_members SET cleared_at = 360 WHERE thread_id = 1 AND hash = ?').run(B.hash);
  assert.deepEqual(visible(db, B.hash, 1), [3], 'B cleared at 360: a fresh start');
  /* The pair keeps its stored hold: A still reads B's unheld word from before the block, never the held one; B reads both of their own. */
  assert.deepEqual(visible(db, A.hash, 2), [4], 'a pair: the hold governs, not the block at read time');
  assert.deepEqual(visible(db, B.hash, 2), [4, 5], 'a sender always sees their own words, held or not');
  db.close();
});

test('a member who left has no seat: the thread is nowhere for them (DM_MINE), and dmThreadFor answers by id or by pair from that seat alone', async () => {
  const db = seeded();
  const env = makeEnv({ db });
  const seat = (h, id) => db.prepare('SELECT COUNT(*) AS n FROM dm_threads t ' + DM_MINE + ' WHERE t.id = ?2').get(h, id).n;
  assert.equal(seat(B.hash, 1), 1);
  assert.equal((await dmThreadFor(env, B.hash, { thread_id: 1 })).thread.id, 1, 'B\'s seat finds the group');
  leave(db, 1, B.hash);
  assert.equal(seat(B.hash, 1), 0, 'left: gone');
  assert.equal(await dmThreadFor(env, B.hash, { thread_id: 1 }), null, 'left: no such conversation');
  assert.equal(await dmThreadFor(env, D.hash, { thread_id: 1 }), null, 'a stranger: no such conversation');
  const pair = await dmThreadFor(env, A.hash, { with: B.hash });
  assert.deepEqual({ id: pair.thread.id, other: who[pair.other], read_at: pair.thread.read_at }, { id: 2, other: 'B', read_at: null }, 'by pair: the room, with my own stamps on it');
  assert.deepEqual(await dmThreadFor(env, A.hash, { with: D.hash }), { thread: null, other: D.hash }, 'an unmade pair: no room yet, the other named');
  assert.equal(await dmThreadFor(env, A.hash, { with: 'not-a-hash' }), null, 'a malformed `with` is null, never a room');
  assert.equal(await dmThreadFor(env, A.hash, { with: A.hash }), null, 'and so is a soliloquy');
  db.close();
});

test('who a word reaches (dmRecipients): every current member but the sender, minus any who block them', async () => {
  const db = seeded();
  const env = makeEnv({ db });
  assert.deepEqual(names(await dmRecipients(env, 1, B.hash)), ['C'], 'B\'s word: C alone — A blocks B, A\'s world stays untouched');
  assert.deepEqual(names(await dmRecipients(env, 1, A.hash)), ['B', 'C']);
  leave(db, 1, C.hash);
  assert.deepEqual(names(await dmRecipients(env, 1, A.hash)), ['B'], 'a leaver is reached no more');
  db.close();
});

test('who may read an attachment (dmMediaReadable): a member who can see a live, unredacted word naming it — not a stranger, a leaver, a blocker, or after a redact or an expiry', async () => {
  const db = seeded();
  const env = makeEnv({ db });
  const may = (h, now = 1000) => dmMediaReadable(env, h, KEY, now);
  assert.equal(await may(B.hash), true, 'the sender');
  assert.equal(await may(C.hash), true, 'a member who can see the word');
  assert.equal(await may(A.hash), false, 'a member for whom the sender is silent');
  assert.equal(await may(D.hash), false, 'a stranger');
  leave(db, 1, C.hash);
  assert.equal(await may(C.hash), false, 'a leaver');
  db.prepare('UPDATE dm_media_refs SET msg_id = 4 WHERE key = ?').run(KEY);
  assert.equal(await may(A.hash), true, 'named by the pair\'s unheld word: A reads it there — the hold governs, not the block');
  db.prepare('UPDATE dm_media_refs SET msg_id = 5 WHERE key = ?').run(KEY);
  assert.equal(await may(A.hash), false, 'named only by a held word: not for its target');
  db.prepare('UPDATE dm_media_refs SET msg_id = 2 WHERE key = ?').run(KEY);
  db.prepare('UPDATE dms SET expires_at = 900 WHERE id = 2').run();
  assert.equal(await may(B.hash, 1000), false, 'an expired word names nothing');
  db.prepare('UPDATE dms SET expires_at = NULL, redacted = 1 WHERE id = 2').run();
  assert.equal(await may(B.hash), false, 'a redacted word names nothing');
  /* The media GET and the shared-object send both run the one rule — single-sourced, by text. */
  assert.ok(/if \(!\(await dmMediaReadable\(env, me, mediaKey, now\)\)\) return json\(\{ ok: false, error: 'Not found\.' \}, 404\);/.test(idxSrc), 'the GET');
  assert.ok(/if \(refRow && refRow\.n > 0 && !\(await dmMediaReadable\(env, me, rawMediaKey, now\)\)\) \{/.test(idxSrc), 'a forward names an object again only by a reader of it');
  db.close();
});

test('the pair\'s room is made once (ensurePairThread): the upsert survives the pair index and the legacy one, and heals a room made without its pair_key', async () => {
  const db = freshDb();
  const env = makeEnv({ db });
  const first = (await ensurePairThread(env, A.hash, B.hash, 100, { bump: true, sender: A.hash })).id;
  assert.equal((await ensurePairThread(env, B.hash, A.hash, 200, { bump: true, sender: B.hash })).id, first, 'the same room on the second word, from either side');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM dm_threads').get().n, 1);
  assert.deepEqual({ ...db.prepare('SELECT last_at, last_sender FROM dm_threads WHERE id = ?').get(first) }, { last_at: 200, last_sender: B.hash }, 'bump moves the last-word fields');
  assert.equal((await ensurePairThread(env, A.hash, B.hash, 300, { bump: false })).id, first);
  assert.equal(db.prepare('SELECT last_at FROM dm_threads WHERE id = ?').get(first).last_at, 200, 'a held send bumps nothing');
  assert.deepEqual(names(db.prepare('SELECT hash FROM dm_members WHERE thread_id = ?').all(first).map((r) => r.hash)), ['A', 'B'], 'both seats, once');
  /* A room the pre-0016 worker made in the deploy window: a_hash/b_hash, no pair_key. */
  db.prepare("INSERT INTO dm_threads (kind, created_at, last_at, last_sender, msgs, a_hash, b_hash) VALUES (0, 50, 50, ?, 0, ?, ?)").run(C.hash, A.hash, C.hash);
  const healed = await ensurePairThread(env, A.hash, C.hash, 300, { bump: true, sender: A.hash });
  assert.equal(db.prepare('SELECT pair_key FROM dm_threads WHERE id = ?').get(healed.id).pair_key, [A.hash, C.hash].sort().join('|'), 'healed: the legacy index found it, pair_key filled');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM dm_threads').get().n, 2, 'no second room');
  assert.deepEqual(names(db.prepare('SELECT hash FROM dm_members WHERE thread_id = ?').all(healed.id).map((r) => r.hash)), ['A', 'C'], 'and its seats made');
  db.close();
});

test('the inbox (/dm/threads) from my seat alone: a pair\'s other, a group\'s members and count, the words I may see', async () => {
  const db = seeded();
  const api = client(worker, makeEnv({ db }));
  const rows = async (viewer) => {
    const r = await api.post('/api/comments/dm/threads', { key: viewer.key });
    assert.equal(r.status, 200);
    return r.json.threads.map((t) => ({ id: t.id, kind: t.kind, other: t.other_hash ? who[t.other_hash] : null, members: names(t.members.map((m) => m.hash)), n: t.member_count, msgs: t.msgs, unread: t.unread }));
  };
  assert.deepEqual(await rows(A), [
    { id: 1, kind: 1, other: null, members: ['B', 'C'], n: 3, msgs: 2, unread: 1 },    // A reads 1 and 3; unread: C's (B is silent to A)
    { id: 2, kind: 0, other: 'B', members: ['B'], n: 2, msgs: 1, unread: 1 },          // the pair: B's unheld word
  ]);
  assert.deepEqual(await rows(C), [{ id: 1, kind: 1, other: null, members: ['A', 'B'], n: 3, msgs: 2, unread: 1 }], 'C: nothing from before joining; B\'s word unread');
  leave(db, 1, C.hash);
  assert.deepEqual(await rows(C), [], 'a leaver\'s inbox has no such conversation');
  assert.deepEqual(await rows(D), [], 'a stranger\'s neither');
  db.close();
});

test('the thread tells whether each member reports reads (2026-09-15): a group\'s ✓✓ waits only for those who do, and a newcomer is announced with the same flag', async () => {
  const db = seeded();
  db.prepare("INSERT INTO profiles (hash, created_at, receipts_mode) VALUES (?, 1, 'off')").run(B.hash);
  db.prepare('UPDATE dm_members SET read_at = 380 WHERE thread_id = 1 AND hash = ?').run(B.hash);
  db.prepare('UPDATE dm_members SET read_at = 390 WHERE thread_id = 1 AND hash = ?').run(C.hash);
  const hub = hubSpy();
  const api = client(worker, makeEnv({ db, hub }));
  const r = await api.post('/api/comments/dm/thread', { key: A.key, thread_id: 1 });
  assert.equal(r.status, 200);
  const byName = Object.fromEntries(r.json.thread.members.map((m) => [who[m.hash], { read_at: m.read_at, receipts: m.receipts }]));
  assert.deepEqual(byName.B, { read_at: null, receipts: 0 }, 'receipts off: the stamp is withheld and the flag says so');
  assert.deepEqual(byName.C, { read_at: 390, receipts: 1 }, 'receipts on: the stamp is served');
  assert.equal(byName.A.receipts, 1, 'my own row carries the flag too');
  /* A newcomer is announced with the flag, so an open thread can weigh their ✓✓ at once. */
  establish(db, A.hash);
  publishKey(db, D.hash);
  const add = await api.post('/api/comments/dm/members', { key: A.key, thread_id: 1, add: [D.hash] });
  assert.equal(add.status, 200);
  await add.ctx.settle();
  const ann = hub.frames('dm-members');
  assert.equal(ann.length, 1, 'one roster frame');
  assert.deepEqual(ann[0].added.map((m) => ({ who: who[m.hash], receipts: m.receipts, key: !!m.pubkey })), [{ who: 'D', receipts: 1, key: true }], 'the newcomer, with receipts and their key');
  assert.deepEqual(names(ann[0].scopes.map((s) => s.slice(5))), ['B', 'C', 'D'], 'to every other current member — the newcomer included');
  db.close();
});
