/* Conversations with members (2026-09-13; run through the handlers since
 * 2026-09-16): a group is born with a system line, anyone adds (a pair forks
 * into a new group; a group grows in place, a returning leaver afresh), a
 * member leaves and the last leaver takes the thread with them, any member
 * names it, the roster is read without a mark, and a forward is one gate for
 * up to ten words through the send's own core.
 *
 * What would break silently: a member added without a key (their words
 * unreadable), or one who blocks the adder (told of the block by the
 * refusal's wording); a pair growing in place (its private history inside a
 * group); a re-added member keeping their old stamps (history back); a group
 * outliving its last member; a roster read that marked the thread read; a
 * forward with its own delivery code drifting from the send's. Every road is
 * driven through default.fetch over the real ledger (tests/_support/worker.mjs),
 * with a hub spy for the frames and a fetch spy for Turnstile. */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as Dm from '../../purescript/output/Domain.Dm/index.js';
import { dmEligible, ensurePairThread } from '../../comments-worker/src/lib.ts';
import { loadWorker, makeEnv, client, freshDb, identity, establish, publishKey, resetCaches, netSpy, hubSpy, routesSource } from '../_support/worker.mjs';

const idxSrc = routesSource();
let worker, A, B, C, D, E, net, who;
before(async () => {
  ({ worker } = await loadWorker());
  [A, B, C, D, E] = await Promise.all(['a', 'b', 'c', 'd', 'e'].map(identity));
  who = Object.fromEntries([[A.hash, 'A'], [B.hash, 'B'], [C.hash, 'C'], [D.hash, 'D'], [E.hash, 'E']]);
  net = netSpy();
});
after(() => net.restore());
beforeEach(() => { resetCaches(); net.calls.length = 0; });
const names = (hashes) => hashes.map((h) => who[h]).sort();
const members = (db, id) => db.prepare('SELECT hash, joined_at, left_at, read_at, cleared_at, added_by FROM dm_members WHERE thread_id = ? ORDER BY hash').all(id);
const current = (db, id) => names(members(db, id).filter((m) => m.left_at == null).map((m) => m.hash));
const lines = (db, id) => db.prepare('SELECT sender_hash, body, enc FROM dms WHERE thread_id = ? ORDER BY id').all(id).map((m) => ({ by: who[m.sender_hash], body: m.body, enc: m.enc }));

/* A, B, C, D established with keys; E has no key. */
function ready() {
  const db = freshDb();
  for (const x of [A, B, C, D]) { establish(db, x.hash); publishKey(db, x.hash); }
  establish(db, E.hash);
  return db;
}
const setup = (db) => { const hub = hubSpy(); return { hub, api: client(worker, makeEnv({ db, hub })) }; };

test('the six roads are registered, all under /dm/ (never disk-cached by prefix), each a *Dm* handler the privacy sweep covers', () => {
  for (const [p, fn] of [['roster', 'handleDmRoster(request, env)'], ['groups', 'handleDmGroups(request, env, ctx)'], ['members', 'handleDmMembers(request, env, ctx)'],
    ['leave', 'handleDmLeave(request, env, ctx)'], ['name', 'handleDmName(request, env, ctx)'], ['forward', 'handleDmForward(request, env, ctx)']]) {
    assert.ok(idxSrc.includes(`{ m: 'POST', p: '/api/comments/dm/${p}', fn: (request, env, ctx, url) => ${fn} }`), '/dm/' + p);
  }
});

test('who may be added (dmEligible): a published key, and no block on the adder — one generic word for both, the kernel\'s cap, and Turnstile at the door', async () => {
  const db = ready();
  db.prepare('INSERT INTO dm_blocks (owner_hash, blocked_hash, created_at) VALUES (?, ?, 1)').run(C.hash, A.hash);
  const { api } = setup(db);
  const e = await dmEligible(makeEnv({ db }), A.hash, [B.hash, C.hash, E.hash, A.hash, 'junk']);
  assert.deepEqual({ ok: names(e.ok), missing: names(e.missing) }, { ok: ['B'], missing: ['C', 'E'] }, 'B has a key and no block; C blocks A; E has no key; myself and junk are nothing');
  let r = await api.post('/api/comments/dm/groups', { key: A.key, members: [B.hash, C.hash, E.hash] });
  assert.equal(r.status, 400);
  assert.deepEqual({ error: r.json.error, missing: names(r.json.missing) }, { error: 'Some members cannot be added yet.', missing: ['C', 'E'] }, 'the one generic refusal — a block reads exactly like a missing key');
  const many = Array.from({ length: 25 }, (_, i) => (i + 10).toString(16).padStart(2, '0').repeat(32));
  r = await api.post('/api/comments/dm/groups', { key: A.key, members: many });
  assert.equal(r.status, 400);
  assert.equal(r.json.error, 'A conversation holds at most ' + Dm.maxMembers + ' members.', 'the cap is the kernel\'s');
  /* Turnstile stands at the door of a write that reaches other members: an
     identity not yet established, with no token, is sent to the challenge —
     the spy records the siteverify attempt and refuses it. */
  db.prepare('DELETE FROM profiles WHERE hash = ?').run(A.hash);
  r = await api.post('/api/comments/dm/groups', { key: A.key, members: [B.hash] });
  assert.equal(r.status, 403);
  assert.equal(r.json.error, 'Verification failed. Reload the page and try again.');
  assert.equal(net.calls.length, 1, 'the road reached Turnstile, once');
  assert.ok(net.calls[0].url.startsWith('https://challenges.cloudflare.com/turnstile/'), 'siteverify');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM dm_threads').get().n, 0, 'and nothing was made');
  db.close();
});

test('a group is born with its line, and every newcomer hears of it: /dm/groups, the ledger, the frames, the bells', async () => {
  const db = ready();
  const { api, hub } = setup(db);
  const r = await api.post('/api/comments/dm/groups', { key: A.key, members: [B.hash, C.hash], name: '  Pals \t of  the  road   ' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const id = r.json.thread_id;
  assert.equal(r.json.name, 'Pals of the road', 'the name is the kernel\'s normalisation');
  const t = db.prepare('SELECT kind, pair_key, name, created_by FROM dm_threads WHERE id = ?').get(id);
  assert.deepEqual({ ...t, created_by: who[t.created_by] }, { kind: 1, pair_key: null, name: 'Pals of the road', created_by: 'A' }, 'kind 1, no pair key');
  assert.deepEqual(current(db, id), ['A', 'B', 'C']);
  assert.deepEqual(members(db, id).filter((m) => m.hash !== A.hash).map((m) => who[m.added_by]), ['A', 'A'], 'the newcomers know who brought them');
  assert.deepEqual(lines(db, id), [{ by: 'A', body: Dm.sysAddLine([B.hash, C.hash]), enc: 2 }], 'the first word is "A added B and C", a system line in the clear');
  await r.ctx.settle();
  const word = hub.frames('dm');
  assert.equal(word.length, 1);
  assert.deepEqual(names(word[0].scopes.map((s) => s.slice(5))), ['A', 'B', 'C'], 'the line reaches every member\'s sockets — the actor\'s own too (no local echo for a system line)');
  assert.deepEqual(names(hub.frames('dm-members')[0].added.map((m) => m.hash)), ['B', 'C'], 'the roster frame names the newcomers');
  const bells = db.prepare("SELECT recipient_hash, topic_id FROM notifications WHERE kind = 'dm'").all();
  assert.deepEqual(bells.map((b) => [who[b.recipient_hash], b.topic_id]).sort(), [['B', id], ['C', id]], 'each newcomer\'s bell rings, by the conversation — this is how they learn of the group');
  assert.equal(hub.frames('notification').length, 2, 'and their badges are nudged');
  db.close();
});

test('a pair forks: adding to a conversation of two makes a new group of the three, and the pair keeps its private history', async () => {
  const db = ready();
  const pair = (await ensurePairThread(makeEnv({ db }), A.hash, B.hash, 100, { bump: true, sender: A.hash })).id;
  db.prepare("INSERT INTO dms (thread_id, sender_hash, body, created_at, enc) VALUES (?, ?, 'E1.secret', 100, 1)").run(pair, A.hash);
  const { api } = setup(db);
  const r = await api.post('/api/comments/dm/members', { key: A.key, thread_id: pair, add: [C.hash] });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual({ forked: r.json.forked, added: names(r.json.added) }, { forked: 1, added: ['C'] });
  assert.notEqual(r.json.thread_id, pair, 'a new conversation');
  assert.deepEqual(current(db, r.json.thread_id), ['A', 'B', 'C'], 'the other and the newcomer, in a group of their own');
  assert.deepEqual(lines(db, r.json.thread_id), [{ by: 'A', body: Dm.sysAddLine([B.hash, C.hash]), enc: 2 }], 'born with its line naming both');
  assert.deepEqual(current(db, pair), ['A', 'B'], 'the pair is as it was');
  assert.deepEqual(lines(db, pair).map((l) => l.body), ['E1.secret'], 'and its history stays where it was');
  db.close();
});

test('a group grows in place, and a returning leaver starts afresh; a current member asked again is nothing; the eligibility rule stands at this door too', async () => {
  const db = ready();
  const { api } = setup(db);
  const id = (await api.post('/api/comments/dm/groups', { key: A.key, members: [B.hash] })).json.thread_id;
  db.prepare('UPDATE dm_members SET left_at = 40, read_at = 30, cleared_at = 20 WHERE thread_id = ? AND hash = ?').run(id, B.hash);
  const r = await api.post('/api/comments/dm/members', { key: A.key, thread_id: id, add: [B.hash] });
  assert.equal(r.status, 200);
  assert.deepEqual({ forked: r.json.forked, added: names(r.json.added) }, { forked: 0, added: ['B'] }, 'in place');
  const b = members(db, id).find((m) => m.hash === B.hash);
  assert.deepEqual({ left: b.left_at, read: b.read_at, cleared: b.cleared_at, by: who[b.added_by], fresh: b.joined_at > 40 }, { left: null, read: null, cleared: null, by: 'A', fresh: true }, 'back, from now: no history, no stamps');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM dm_threads').get().n, 1, 'no fork for a group');
  const again = await api.post('/api/comments/dm/members', { key: A.key, thread_id: id, add: [B.hash] });
  assert.deepEqual({ status: again.status, error: again.json.error }, { status: 400, error: 'Bad request.' }, 'a current member asked again is nothing to add');
  db.prepare('INSERT INTO dm_blocks (owner_hash, blocked_hash, created_at) VALUES (?, ?, 1)').run(C.hash, A.hash);
  const refused = await api.post('/api/comments/dm/members', { key: A.key, thread_id: id, add: [C.hash, E.hash] });
  assert.deepEqual({ status: refused.status, error: refused.json.error, missing: names(refused.json.missing) }, { status: 400, error: 'Some members cannot be added yet.', missing: ['C', 'E'] });
  const stranger = await api.post('/api/comments/dm/members', { key: D.key, thread_id: id, add: [C.hash] });
  assert.deepEqual({ status: stranger.status, error: stranger.json.error }, { status: 404, error: 'No such conversation.' }, 'only a current member adds');
  db.close();
});

test('leaving: the line, the stamp, the announcement — and the last one out takes the thread, its words and its objects', async () => {
  const db = ready();
  const { api, hub } = setup(db);
  const id = (await api.post('/api/comments/dm/groups', { key: A.key, members: [B.hash, C.hash] })).json.thread_id;
  const KEY = 'dm/' + '2'.repeat(64);
  db.prepare('INSERT INTO dm_media (key, size, created_at) VALUES (?, 10, 1)').run(KEY);
  db.prepare("INSERT INTO dms (id, thread_id, sender_hash, body, created_at, enc, media_key) VALUES (99, ?, ?, 'E3.photo', 200, 3, ?)").run(id, B.hash, KEY);
  db.prepare('INSERT INTO dm_media_refs (key, msg_id) VALUES (?, 99)').run(KEY);
  const env = makeEnv({ db, hub });
  const api2 = client(worker, env);
  const bellsBefore = db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE kind = 'dm'").get().n;
  let r = await api2.post('/api/comments/dm/leave', { key: C.key, thread_id: id });
  assert.deepEqual({ status: r.status, purged: r.json.purged }, { status: 200, purged: false });
  assert.deepEqual(current(db, id), ['A', 'B'], 'C\'s seat is stamped');
  assert.deepEqual(lines(db, id).slice(-1), [{ by: 'C', body: Dm.sysLeaveLine, enc: 2 }], '"C left" is their last word in it');
  await r.ctx.settle();
  assert.deepEqual(hub.frames('dm-members').slice(-1)[0].left.map((h) => who[h]), ['C'], 'the roster frame says who went');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE kind = 'dm'").get().n, bellsBefore, 'a leaving line rings no bell (quiet)');
  const inbox = await api2.post('/api/comments/dm/threads', { key: C.key });
  assert.deepEqual(inbox.json.threads, [], 'the chat leaves their list');
  r = await api2.post('/api/comments/dm/leave', { key: B.key, thread_id: id });
  assert.equal(r.json.purged, false);
  r = await api2.post('/api/comments/dm/leave', { key: A.key, thread_id: id });
  assert.deepEqual({ status: r.status, purged: r.json.purged }, { status: 200, purged: true }, 'the last one out');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM dm_threads WHERE id = ?').get(id).n, 0, 'the thread is gone');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM dms WHERE thread_id = ?').get(id).n, 0, 'and its words');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM dm_members WHERE thread_id = ?').get(id).n, 0, 'and its seats');
  assert.deepEqual(env.r2.filter((c) => c.op === 'delete').map((c) => [c.bucket, c.key]), [['MEDIA', KEY]], 'and the object nothing names any more');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM dm_media_refs WHERE key = ?').get(KEY).n, 0);
  /* a pair is not left, and a stranger has nothing to leave */
  const pair = (await ensurePairThread(env, A.hash, B.hash, 100, { bump: true, sender: A.hash })).id;
  r = await api2.post('/api/comments/dm/leave', { key: A.key, thread_id: pair });
  assert.deepEqual({ status: r.status, error: r.json.error }, { status: 400, error: 'A conversation with one person is deleted, not left.' });
  r = await api2.post('/api/comments/dm/leave', { key: D.key, thread_id: pair });
  assert.equal(r.status, 404);
  db.close();
});

test('the name is any member\'s, the roster is read without a mark, and the forward is one gate for ten words through the send\'s own core', async () => {
  const db = ready();
  const { api, hub } = setup(db);
  const id = (await api.post('/api/comments/dm/groups', { key: A.key, members: [B.hash] })).json.thread_id;
  /* the name */
  let r = await api.post('/api/comments/dm/name', { key: B.key, thread_id: id, name: '  The \t Long  Road  ' });
  assert.deepEqual({ status: r.status, name: r.json.name }, { status: 200, name: 'The Long Road' }, 'any member; the kernel\'s normalisation');
  assert.equal(db.prepare('SELECT name FROM dm_threads WHERE id = ?').get(id).name, 'The Long Road');
  assert.deepEqual(lines(db, id).slice(-1), [{ by: 'B', body: Dm.sysNameLine('The Long Road'), enc: 2 }]);
  await r.ctx.settle();
  assert.deepEqual(hub.frames('dm-name').map((f) => [f.name, who[f.by], names(f.scopes.map((s) => s.slice(5)))]), [['The Long Road', 'B', ['A']]], 'told to the others');
  r = await api.post('/api/comments/dm/name', { key: A.key, thread_id: id, name: '   ' });
  assert.equal(r.status, 400, 'nothing left of a name is no name');
  const pair = (await ensurePairThread(makeEnv({ db }), A.hash, C.hash, 100, { bump: true, sender: A.hash })).id;
  r = await api.post('/api/comments/dm/name', { key: A.key, thread_id: pair, name: 'Us' });
  assert.equal(r.status, 400, 'a pair has no name');
  /* the roster: a read, never a write */
  const before = JSON.stringify([members(db, id), lines(db, id)]);
  r = await api.post('/api/comments/dm/roster', { key: A.key, thread_id: id });
  assert.equal(r.status, 200);
  assert.deepEqual({ id: r.json.thread_id, kind: r.json.kind, name: r.json.name, members: r.json.members.map((m) => [who[m.hash], !!m.pubkey]).sort() },
    { id, kind: 1, name: 'The Long Road', members: [['A', true], ['B', true]] }, 'the current members with their keys');
  assert.equal(JSON.stringify([members(db, id), lines(db, id)]), before, 'nothing marked, nothing written');
  r = await api.post('/api/comments/dm/roster', { key: A.key, with: E.hash });
  assert.deepEqual({ id: r.json.thread_id, kind: r.json.kind, members: r.json.members.map((m) => [who[m.hash], m.pubkey]) }, { id: null, kind: 0, members: [['A', r.json.members[0].pubkey], ['E', null]] }, 'an unmade pair: the two of them, E\'s key not yet published');
  r = await api.post('/api/comments/dm/roster', { key: D.key, thread_id: id });
  assert.equal(r.status, 404, 'a stranger reads nothing');
  /* the forward: one gate, at most ten, each word through deliverDmWord — the send's core */
  assert.ok(/return deliverDmWord\(env, ctx, me, data, Math\.floor\(Date\.now\(\) \/ 1000\)\);/.test(idxSrc), 'the send is the same core behind its gate (by text: one road)');
  r = await api.post('/api/comments/dm/forward', { key: A.key, items: [] });
  assert.equal(r.status, 400, 'nothing to forward');
  r = await api.post('/api/comments/dm/forward', { key: A.key, items: Array.from({ length: 11 }, () => ({ thread_id: id, body: 'E3.x', enc: 3, keys: {} })) });
  assert.equal(r.status, 400, 'at most ten');
  const sealed = (to) => Object.fromEntries(to.map((h) => [h, 'k_' + who[h]]));
  r = await api.post('/api/comments/dm/forward', { key: A.key, items: [
    { thread_id: id, body: 'E3.n.one', enc: 3, keys: sealed([A.hash, B.hash]) },
    { thread_id: id, body: 'E3.n.stale', enc: 3, keys: sealed([A.hash]) },
    { thread_id: pair, body: 'E3.n.two', enc: 3, keys: sealed([A.hash, C.hash]) },
  ] });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json.results.map((x) => [x.status, x.error || null]), [[200, null], [409, 'roster'], [200, null]], 'each word answered on its own; a stale roster is answered with the fresh one');
  assert.deepEqual(names(r.json.results[1].members.map((m) => m.hash)), ['A', 'B'], 'the fresh roster rides the 409');
  assert.deepEqual(db.prepare('SELECT thread_id, body, enc FROM dms WHERE enc = 3 ORDER BY id').all().map((m) => ({ ...m })), [{ thread_id: id, body: 'E3.n.one', enc: 3 }, { thread_id: pair, body: 'E3.n.two', enc: 3 }], 'two words landed, in two conversations');
  assert.deepEqual(db.prepare('SELECT hash, sealed FROM dm_keys WHERE msg_id = (SELECT id FROM dms WHERE body = ?) ORDER BY hash').all('E3.n.one').map((k) => [who[k.hash], k.sealed]).sort(), [['A', 'k_A'], ['B', 'k_B']], 'each member\'s sealed key beside the word');
  db.close();
});
