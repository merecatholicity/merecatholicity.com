/* Unread words, counted and named (2026-09-11; run through the handlers since
 * 2026-09-16): every unread number on the site is WORDS, from one fragment —
 * the inbox row's badge, the inbox total, the tab bar's badge — the thread
 * tells what was unread BEFORE the open marked it read, and a member who
 * appears offline is not seen typing.
 *
 * What would break silently: a badge reading "1" for twelve words; the tab
 * badge and the row badges disagreeing because one counts threads and the
 * other counts words; the unread line drawn from the post-open stamp (nothing
 * is ever unread after the open); a held, expired, cleared or pre-joining word
 * counted; the typing frame leaking a hidden member's presence. So: the
 * counting fragment runs on the ledger as lib.ts exports it, and /dm/threads,
 * /dm/unread and /dm/thread answer real requests over a seeded ledger through
 * tests/_support/worker.mjs — the road, not its text. The hub's typing gate
 * stays a source rule (it needs live sockets). */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { dmUnreadCount, DM_MINE } from '../../comments-worker/src/lib.ts';
import { loadWorker, makeEnv, client, freshDb, identity, resetCaches, netSpy } from '../_support/worker.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const hubSrc = readFileSync(join(root, 'comments-worker', 'src', 'durable.ts'), 'utf8');

let worker, A, B, C, D, net;
before(async () => {
  ({ worker } = await loadWorker());
  [A, B, C, D] = await Promise.all(['a', 'b', 'c', 'd'].map(identity));
  net = netSpy();   // every request below passes without a byte of network
});
after(() => { assert.deepEqual(net.calls, [], 'no request reached the network'); net.restore(); });
beforeEach(resetCaches);

/* A pair (A and B) with six words: one A read, two unread, one held, one expired, one A's own. */
function seeded() {
  const db = freshDb();
  db.prepare("INSERT INTO dm_threads (id, kind, pair_key, created_at, last_at, last_sender, msgs) VALUES (1, 0, ?, 100, 1600, ?, 6)").run(A.hash + '|' + B.hash, B.hash);
  db.prepare('INSERT INTO dm_members (thread_id, hash, joined_at, read_at) VALUES (1, ?, 100, 1000), (1, ?, 100, NULL)').run(A.hash, B.hash);
  /* an expired word was OPENED once (that is what started its clock) — an open
     today must not restart it, so the fixture says so */
  const ins = db.prepare('INSERT INTO dms (id, thread_id, sender_hash, body, created_at, held, expires_at, opened_at) VALUES (?, 1, ?, ?, ?, ?, ?, ?)');
  ins.run(1, B.hash, 'read already', 900, null, null, null);
  ins.run(2, B.hash, 'unread', 1100, null, null, null);
  ins.run(3, B.hash, 'held — never counts', 1200, 1, null, null);
  ins.run(4, B.hash, 'expired by now', 1300, null, 1500, 1300);
  ins.run(5, A.hash, 'mine', 1400, null, null, null);
  ins.run(6, B.hash, 'unread too', 1600, null, null, null);
  return db;
}
/* a second conversation — a group of three — two unread words in it (and one held, which never counts) */
function addGroup(db) {
  db.prepare("INSERT INTO dm_threads (id, kind, pair_key, created_at, last_at, last_sender, msgs) VALUES (2, 1, NULL, 100, 1700, ?, 3)").run(B.hash);
  db.prepare('INSERT INTO dm_members (thread_id, hash, joined_at) VALUES (2, ?, 100), (2, ?, 100), (2, ?, 100)').run(A.hash, B.hash, C.hash);
  const ins = db.prepare('INSERT INTO dms (id, thread_id, sender_hash, body, created_at, held, expires_at) VALUES (?, 2, ?, ?, ?, ?, NULL)');
  ins.run(7, B.hash, 'unread', 1650, null);
  ins.run(8, B.hash, 'unread as well', 1700, null);
  ins.run(9, B.hash, 'held — never counts', 1700, 1);
}
const readAt = (db, thread, who, at) => db.prepare('UPDATE dm_members SET read_at = ? WHERE thread_id = ? AND hash = ?').run(at, thread, who);

test('the counting fragment counts exactly the unheld, unexpired, uncleared words from the other side newer than my stamp', () => {
  const db = seeded();
  const count = (who, now) => db.prepare('SELECT ' + dmUnreadCount(now) + ' AS unread FROM dm_threads t ' + DM_MINE + ' WHERE t.id = 1').get(who).unread;
  assert.equal(count(A.hash, 2000), 2, 'ids 2 and 6: not the read one, not the held, not the expired, not my own');
  assert.equal(count(B.hash, 2000), 1, 'from their seat (no stamp yet): my one word');
  db.prepare('UPDATE dm_members SET cleared_at = 1150 WHERE thread_id = 1 AND hash = ?').run(A.hash);
  assert.equal(count(A.hash, 2000), 1, 'a cleared member sees only what came after their clear stamp');
  readAt(db, 1, A.hash, 1700);
  assert.equal(count(A.hash, 2000), 0, 'read up to date: nothing');
  db.prepare('UPDATE dm_members SET left_at = 1800 WHERE thread_id = 1 AND hash = ?').run(A.hash);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM dm_threads t ' + DM_MINE + ' WHERE t.id = 1').get(A.hash).n, 0, 'a member who left has no seat: the thread is nowhere for them');
  db.close();
});

test('the inbox rows carry the count, and unread_total sums those same words — not threads', async () => {
  const db = seeded();
  const api = client(worker, makeEnv({ db }));
  let r = await api.post('/api/comments/dm/threads', { key: A.key });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.threads.map((t) => [t.thread_id, t.kind, t.unread]), [[1, 0, 2]], 'the pair\'s row: two unread words');
  assert.equal(r.json.unread_total, 2);
  addGroup(db);
  r = await api.post('/api/comments/dm/threads', { key: A.key });
  assert.deepEqual(r.json.threads.map((t) => [t.thread_id, t.kind, t.unread, t.member_count]), [[2, 1, 2, 3], [1, 0, 2, 2]],
    'newest conversation first; the group\'s two unread words, the held one never');
  assert.equal(r.json.unread_total, 4, 'two plus two — a thread tally would say 2');
  r = await api.post('/api/comments/dm/threads', { key: C.key });
  assert.deepEqual(r.json.threads.map((t) => [t.thread_id, t.unread]), [[2, 2]], 'C is in the group alone');
  db.close();
});

/* The tab bar's badge (2026-09-11): the same words, summed across every thread,
   so "3" on the Inbox tab means three messages waiting — and equals what the
   inbox rows add up to. A thread tally here would silently under-report. */
test('the tab badge counts unread WORDS across all threads, and equals the inbox total', async () => {
  const db = seeded();
  addGroup(db);
  const api = client(worker, makeEnv({ db }));
  const badge = async (who) => { const r = await api.post('/api/comments/dm/unread', { key: who.key }); assert.equal(r.status, 200); return r.json.unread; };
  assert.equal(await badge(A), 4, 'two words in one thread plus two in the other — not "2 threads"');
  const inbox = await api.post('/api/comments/dm/threads', { key: A.key });
  assert.equal(inbox.json.unread_total, await badge(A), 'the tab and the rows it opens onto add up');
  readAt(db, 1, A.hash, 1700);
  assert.equal(await badge(A), 2, 'reading one conversation leaves the other\'s two');
  readAt(db, 2, A.hash, 1700);
  assert.equal(await badge(A), 0, 'all read: no badge');
  assert.equal(await badge(B), 1, 'B has A\'s one word waiting');
  assert.equal(await badge(D), 0, 'a member of nothing has nothing');
  db.close();
});

test('the thread names what was unread BEFORE the open marks it read: the count, the first unread id, and the fresh bell count', async () => {
  const db = seeded();
  const api = client(worker, makeEnv({ db }));
  const open = (who, target) => api.post('/api/comments/dm/thread', { key: who.key, ...target });
  let r = await open(A, { thread_id: 1 });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.messages.map((m) => m.id), [1, 2, 5, 6], 'the held and the expired words are not served');
  assert.deepEqual({ unread: r.json.unread, from: r.json.unread_from, bells: r.json.notif_unread }, { unread: 2, from: 2, bells: 0 },
    'two unread, the line stands above id 2; the bell count rides along');
  assert.ok(db.prepare('SELECT read_at FROM dm_members WHERE thread_id = 1 AND hash = ?').get(A.hash).read_at > 1000, 'the open advanced my stamp');
  r = await open(A, { thread_id: 1 });
  assert.deepEqual({ unread: r.json.unread, from: r.json.unread_from }, { unread: 0, from: null }, 'nothing is unread after the open');
  /* a member who joined at 1200 sees nothing from before their joining */
  db.prepare('INSERT INTO dm_members (thread_id, hash, joined_at) VALUES (1, ?, 1200)').run(C.hash);
  r = await open(C, { thread_id: 1 });
  assert.deepEqual(r.json.messages.map((m) => m.id), [5, 6], 'the words since they joined (the held and the expired still not)');
  assert.deepEqual({ unread: r.json.unread, from: r.json.unread_from }, { unread: 2, from: 5 }, 'both later words are unread to the newcomer');
  /* the empty room: an unmade pair says so, with the bells */
  r = await open(A, { with: D.hash });
  assert.equal(r.status, 200);
  assert.deepEqual({ id: r.json.thread_id, msgs: r.json.messages, unread: r.json.unread, from: r.json.unread_from, bells: r.json.notif_unread },
    { id: null, msgs: [], unread: 0, from: null, bells: 0 });
  /* a stranger to the conversation finds nothing */
  r = await open(D, { thread_id: 1 });
  assert.equal(r.status, 404);
  assert.equal(r.json.error, 'No such conversation.');
  /* in a group, a sender I blocked has no unread words for me; in a pair the stored hold governs, not the block */
  db.prepare('INSERT INTO dm_blocks (owner_hash, blocked_hash, created_at) VALUES (?, ?, 1)').run(A.hash, B.hash);
  readAt(db, 1, A.hash, null);
  db.prepare('UPDATE dm_threads SET kind = 1, pair_key = NULL WHERE id = 1').run();
  r = await open(A, { thread_id: 1 });
  assert.deepEqual({ unread: r.json.unread, ids: r.json.messages.map((m) => m.id) }, { unread: 0, ids: [5] }, 'group: B is silent to A — nothing unread, nothing served');
  readAt(db, 1, A.hash, null);
  db.prepare('UPDATE dm_threads SET kind = 0, pair_key = ? WHERE id = 1').run(A.hash + '|' + B.hash);
  r = await open(A, { thread_id: 1 });
  assert.deepEqual({ unread: r.json.unread, from: r.json.unread_from, blocked: r.json.blocked }, { unread: 3, from: 1, blocked: 1 },
    'pair: ids 1, 2 and 6 — the hold stored at send time governs, and the room says I block them');
  db.close();
});

test('a member who appears offline is not seen typing: the hub drops their signal by the kernel\'s own rule', () => {
  const typing = hubSrc.slice(hubSrc.indexOf("if (m.t === 'typing')"), hubSrc.indexOf("await this.#toUsers(Array.from(new Set(list)).map((to) => ({ scope: 'user:' + to, payload: frame })));"));
  assert.ok(typing.length > 0, 'the typing branch fans to each named member');
  assert.ok(/if \(!Presence\.isVisible\(\(a && a\.presenceMode\) \|\| 'auto'\)\(true\)\) return;/.test(typing),
    'the same rule that hides their socket hides their keystrokes (Domain.Presence.isVisible)');
});
