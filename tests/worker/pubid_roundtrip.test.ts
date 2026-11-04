/* The pubid flip, end to end (the P0 chain L3, 2026-09-18). The egress sweep
 * (hash_leak) proves no account hash LEAVES; this proves the other direction —
 * that a client sending a PUBID back is resolved to the right member. The
 * hermetic suite otherwise runs without a pepper (the valve, where an id IS the
 * hash), so without this a missing resolveId at an ingress point
 * would pass every other test and silently break that feature for a real client.
 *
 * With PUBLIC_ID_PEPPER set, a member's wire id is pubid = SHA-256(pepper||hash),
 * NOT their account hash — so here every request carries the pubid, and each
 * endpoint must find the member the account hash names. `pubid` is NOT stored:
 * serveId computes it, and resolveId rebuilds the reverse map from READS of the
 * identity columns (so the flip needs no D1 write to run) — a member is
 * resolvable as soon as their hash is in `profiles` (establish) or any author
 * column. */
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { loadWorker, makeEnv, freshDb, identity, establish, publishKey, call, resetCaches } from '../_support/worker.ts';
import { pubidOf, resolveId, clearIdCaches } from '../../comments-worker/src/lib.ts';
import type { Worker, TestEnv, Row } from '../_support/worker.ts';
import type { DatabaseSync } from 'node:sqlite';

type Id = { key: string; hash: string };
/* the env as lib.ts's parameter type reads it */
type LibEnv = Parameters<typeof resolveId>[0];

const PEPPER = 'a-stable-test-pepper-value';
let worker: Worker, ann: Id, bob: Id;
before(async () => {
  ({ worker } = await loadWorker());
  [ann, bob] = await Promise.all(['ann', 'bob'].map(identity));
});
beforeEach(() => { resetCaches(); clearIdCaches(); });

function env(db: DatabaseSync) { return makeEnv({ db, vars: { PUBLIC_ID_PEPPER: PEPPER } }) as TestEnv & LibEnv; }
const pub = (h: string) => pubidOf({ PUBLIC_ID_PEPPER: PEPPER } as unknown as LibEnv, h);

test('a pubid is not the account hash, and resolveId inverts it from a read (no stored column)', async () => {
  const db = freshDb();
  const e = env(db);
  establish(db, ann.hash);   // a profiles row is all the reverse map needs
  const pid = await pub(ann.hash);
  assert.notEqual(pid, ann.hash, 'the wire id is not the account hash');
  assert.match(pid, /^[0-9a-f]{64}$/, 'but it is the same 64-hex shape');
  clearIdCaches();
  assert.equal(await resolveId(e, pid), ann.hash, 'the pubid resolves to the account hash');
  assert.equal(await resolveId(e, ann.hash), null, 'and a raw account hash is nobody (its tolerance retired 2026-11-04)');
  db.close();
});

test('a member registered after the map loaded still resolves: a miss tops it up from the new profiles rows', async () => {
  const db = freshDb();
  const e = env(db);
  establish(db, ann.hash);
  assert.equal(await resolveId(e, await pub(ann.hash)), ann.hash, 'the map is built');
  establish(db, bob.hash);   // bob arrives on another isolate; this one's map has never seen him
  /* his pubid computed apart from lib.ts, so the module's caches never see it before the miss */
  const bobPid = createHash('sha256').update(PEPPER + bob.hash).digest('hex');
  assert.equal(await resolveId(e, bobPid), bob.hash, 'the miss reads the rows made since, and finds him');
  assert.equal(await resolveId(e, bob.hash), null, 'his raw account hash still names nobody');
  db.close();
});

test('a member is added to a group by PUBID: the handler hands dmEligible wire ids, never ones it resolved', async () => {
  const db = freshDb();
  const e = env(db);
  const [cat] = await Promise.all(['cat'].map(identity));
  for (const who of [ann, bob, cat]) { establish(db, who.hash); publishKey(db, who.hash); }
  const g = await call(worker, e, 'POST', '/api/comments/dm/groups', { key: ann.key, members: [await pub(bob.hash), await pub(cat.hash)], name: 'g' });
  assert.equal(g.status, 200, 'the group is made: ' + JSON.stringify(g.json));
  const dan = await identity('dan');
  establish(db, dan.hash); publishKey(db, dan.hash);
  const r = await call(worker, e, 'POST', '/api/comments/dm/members', { key: ann.key, thread_id: g.json.thread_id, add: [await pub(dan.hash)] });
  assert.equal(r.status, 200, 'dan is added by his pubid: ' + JSON.stringify(r.json));
  const members = db.prepare('SELECT hash FROM dm_members WHERE thread_id = ? AND left_at IS NULL').all(g.json.thread_id).map((x: Row) => x.hash);
  assert.ok(members.includes(dan.hash), 'and his ACCOUNT hash is on the roster');
  db.close();
});

test('a raw account hash on the wire addresses nobody: no profile, no conversation', async () => {
  const db = freshDb();
  const e = env(db);
  for (const who of [ann, bob]) { establish(db, who.hash); publishKey(db, who.hash); }
  db.prepare("UPDATE profiles SET nick = 'Ann' WHERE hash = ?").run(ann.hash);
  const prof = await call(worker, e, 'GET', '/api/comments/profile?hash=' + ann.hash);
  assert.ok(!(prof.json && prof.json.profile && prof.json.profile.nick === 'Ann'), 'the account hash finds no profile: ' + JSON.stringify(prof.json));
  const th = await call(worker, e, 'POST', '/api/comments/dm/thread', { key: bob.key, with: ann.hash });
  assert.equal(th.status, 400, 'and opens no conversation (it names no one, so it is no member id at all): ' + JSON.stringify(th.json));
  const ok = await call(worker, e, 'POST', '/api/comments/dm/thread', { key: bob.key, with: await pub(ann.hash) });
  assert.equal(ok.status, 200, 'while her pubid does: ' + JSON.stringify(ok.json));
  db.close();
});

test('GET /profile?hash=<pubid> finds the member and echoes the pubid, never the account hash', async () => {
  const db = freshDb();
  const e = env(db);
  establish(db, ann.hash);
  db.prepare("UPDATE profiles SET nick = 'Ann' WHERE hash = ?").run(ann.hash);
  const pid = await pub(ann.hash);
  const r = await call(worker, e, 'GET', '/api/comments/profile?hash=' + pid);
  assert.equal(r.status, 200);
  assert.equal(r.json.profile.nick, 'Ann', 'the right member was found by pubid');
  assert.equal(r.json.profile.hash, pid, 'the answer carries the pubid');
  assert.ok(!JSON.stringify(r.json).includes(ann.hash), 'and never the account hash');
  db.close();
});

test('a DM addressed to a pubid reaches the account the hash names', async () => {
  const db = freshDb();
  const e = env(db);
  for (const who of [ann, bob]) { establish(db, who.hash); publishKey(db, who.hash); }
  const annPid = await pub(ann.hash);
  /* bob sends to ann's PUBID, sealing the envelope to ann's pubid + his own */
  const keys: Record<string, string> = {}; keys[annPid] = 'x'.repeat(43); keys[await pub(bob.hash)] = 'y'.repeat(43);
  const r = await call(worker, e, 'POST', '/api/comments/dm/send', { key: bob.key, to: annPid, body: 'E3.hello', enc: 3, keys });
  assert.equal(r.status, 200, 'the send is accepted: ' + JSON.stringify(r.json));
  /* the thread's members are the ACCOUNT hashes (server-internal), and ann is in it */
  const members = db.prepare('SELECT hash FROM dm_members WHERE thread_id = ?').all(r.json.thread_id).map((x: Row) => x.hash).sort();
  assert.deepEqual(members, [ann.hash, bob.hash].sort(), 'the pubid resolved to ann; the roster is account-keyed');
  /* the sealed set stored under ann's ACCOUNT hash, not her pubid */
  const sealed = db.prepare('SELECT hash FROM dm_keys WHERE msg_id = ?').all(r.json.id).map((x: Row) => x.hash).sort();
  assert.deepEqual(sealed, [ann.hash, bob.hash].sort(), 'dm_keys is account-keyed, so each reader gets their own sealed');
  db.close();
});

test('GET /board/author?hash=<pubid> returns that member\'s posts', async () => {
  const db = freshDb();
  const e = env(db);
  establish(db, ann.hash);
  db.prepare("INSERT INTO comments (id, page, author_hash, title, body, status, created_at) VALUES (1, 'board:pub', ?, 'A topic', 'hello', 'live', 5)").run(ann.hash);
  const r = await call(worker, e, 'GET', '/api/comments/board/author?hash=' + (await pub(ann.hash)) + '&p=1');
  assert.equal(r.status, 200);
  assert.equal(r.json.total, 1, 'ann\'s post was found by her pubid');
  assert.ok(!JSON.stringify(r.json).includes(ann.hash), 'and no account hash leaked back');
  db.close();
});
