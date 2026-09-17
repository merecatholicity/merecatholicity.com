/* The BoardHub, sharded and indexed (Domain.Hub, 2026-09-17) — RUN, not read.
 *
 * What would break silently: a private frame reaching a shard that does not
 * hold its member (a DM delivered live to nobody); a presence change seen on
 * one shard only (a watcher elsewhere keeps an "Online" dot for ever); a
 * typist's own keystrokes echoed back; a member's "last socket closed"
 * firing while a tab still lives, or never firing; the in-memory index
 * drifting from the attachments after a wake (a socket the object forgot);
 * the worker fanning a public event to one shard of N, or a private one to
 * every shard. N real instances over fake sockets, wired through a fake
 * namespace so DO-to-DO relays run for real; the last-seen stamp lands in
 * the harness's SQLite. */
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as Hub from '../../purescript/output/Domain.Hub/index.js';
import { loadWorker, makeEnv, freshDb, identity, resetCaches, hubSpy, call } from '../_support/worker.mjs';
import { fakeCtx } from '../_support/hub_runtime.mjs';
import { sendToHub, hubPresenceOf, hubViewersOf, hubDmViewing, hubStats, hubShards } from '../../comments-worker/src/lib.ts';

/* the Workers runtime the hub touches, in Node (FakeSocket, fakeCtx) */
/* N shards, one env, the namespace resolving each shard's name to its instance */
function cluster(BoardHub, n, db) {
  const instances = new Map();
  const ctxs = new Map();
  const namespace = { idFromName: (name) => name, get: (name) => instances.get(name) };
  const env = makeEnv({ db, hub: { namespace }, vars: { HUB_SHARDS: String(n) } });
  for (const name of Hub.shardNames(n)) {
    const ctx = fakeCtx(name);
    ctxs.set(name, ctx);
    instances.set(name, new BoardHub(ctx, env));
  }
  const shard = (i) => instances.get(Hub.shardName(i));
  /* the upgrade, as handleLive forwards it; returns the SERVER socket the hub holds */
  const connect = async (i) => {
    const r = await shard(i).fetch(new Request('https://merecatholicity.com/api/comments/live', { headers: { Upgrade: 'websocket' } }));
    assert.ok(r.upgraded, 'a 101');
    const ctx = ctxs.get(Hub.shardName(i));
    return ctx.sockets[ctx.sockets.length - 1];
  };
  const send = (i, ws, frame) => shard(i).webSocketMessage(ws, JSON.stringify(frame));
  const close = (i, ws) => { const ctx = ctxs.get(Hub.shardName(i)); ctx.sockets.splice(ctx.sockets.indexOf(ws), 1); return shard(i).webSocketClose(ws, 1000, '', true); };
  /* "wake": the object evicted and rebuilt over the same accepted sockets */
  const wake = (i) => { const name = Hub.shardName(i); const inst = new BoardHub(ctxs.get(name), env); instances.set(name, inst); return inst; };
  return { env, shard, connect, send, close, wake, ctxs };
}

const N = 3;
let BoardHub, worker;
/* one identity per shard under N = 3, found by seed */
const home = {};
before(async () => {
  ({ worker, BoardHub } = await loadWorker());
  for (let seed = 0; Object.keys(home).length < N && seed < 500; seed++) {
    const id = await identity('hub-' + seed);
    const i = Hub.shardOf(N)(id.hash);
    if (!home[i]) home[i] = id;
  }
  assert.equal(Object.keys(home).length, N, 'an identity homed on each shard');
});
beforeEach(resetCaches);

test('a shard fans a public event to its subscribers of that scope alone, and a private scope only to its owner', async () => {
  const c = cluster(BoardHub, 1, freshDb());
  const A = home[0], B = home[1];
  const a = await c.connect(0); await c.send(0, a, { t: 'auth', key: A.key }); await c.send(0, a, { t: 'sub', scope: ['user:' + A.hash, 'topic:7'] });
  const b = await c.connect(0); await c.send(0, b, { t: 'auth', key: B.key }); await c.send(0, b, { t: 'sub', scope: ['user:' + B.hash, 'cat:pub'] });
  const anon = await c.connect(0); await c.send(0, anon, { t: 'sub', scope: ['topic:7', 'user:' + A.hash] });
  await c.shard(0).publish({ v: 1, t: 'new-reply', scopes: ['topic:7'], id: 1 });
  await c.shard(0).publish({ v: 1, t: 'dm', scopes: ['user:' + A.hash], id: 2 });
  assert.deepEqual(a.frames('new-reply').map((f) => f.id), [1], 'A watches topic 7');
  assert.deepEqual(anon.frames('new-reply').map((f) => f.id), [1], 'so does the anonymous socket');
  assert.deepEqual(b.frames('new-reply'), [], 'B does not');
  assert.deepEqual(a.frames('dm').map((f) => f.id), [2], 'the private frame reaches A');
  assert.deepEqual(anon.frames('dm'), [], 'never a socket that merely CLAIMED user:A (sanitizeScopes)');
  assert.deepEqual(b.frames('dm'), []);
  const st = await c.shard(0).stats();
  assert.deepEqual(st, { shard: 0, sockets: 3, members: 2 });
  /* a socket whose send throws is dropped from the index */
  b.broken = true;
  await c.shard(0).publish({ v: 1, t: 'new-topic', scopes: ['cat:pub'], id: 3 });
  assert.deepEqual(await c.shard(0).stats(), { shard: 0, sockets: 2, members: 1 }, 'B forgotten after the failed send');
});

test('presence crosses shards: a watcher on shard 2 sees a member of shard 0 come and go; the seed on sub asks the home shard', async () => {
  const c = cluster(BoardHub, N, freshDb());
  const A = home[0], W = home[2];
  /* the watcher subscribes first: seeded offline */
  const w = await c.connect(2); await c.send(2, w, { t: 'auth', key: W.key });
  await c.send(2, w, { t: 'sub', scope: ['user:' + W.hash, 'presence:' + A.hash] });
  assert.deepEqual(w.frames('presence'), [{ v: 1, t: 'presence', hash: A.hash, online: false }], 'seeded offline: A holds no socket anywhere');
  const a1 = await c.connect(0); await c.send(0, a1, { t: 'auth', key: A.key });
  assert.deepEqual(w.frames('presence').slice(-1), [{ v: 1, t: 'presence', hash: A.hash, online: true }], 'A online, relayed to shard 2');
  /* a second watcher now: seeded ONLINE from A's home shard, not from its own */
  const w2 = await c.connect(1); await c.send(1, w2, { t: 'sub', scope: ['presence:' + A.hash] });
  assert.deepEqual(w2.frames('presence'), [{ v: 1, t: 'presence', hash: A.hash, online: true }], 'the seed came across from shard 0');
  const a2 = await c.connect(0); await c.send(0, a2, { t: 'auth', key: A.key });
  await c.close(0, a1);
  assert.equal(w.frames('presence').filter((f) => !f.online).length, 1, 'a second tab alive: no offline yet (only the seed)');
  await c.close(0, a2);
  assert.deepEqual(w.frames('presence').slice(-1), [{ v: 1, t: 'presence', hash: A.hash, online: false }], 'the LAST socket closing goes out to shard 2');
  assert.deepEqual(w2.frames('presence').slice(-1), [{ v: 1, t: 'presence', hash: A.hash, online: false }], 'and to shard 1');
  const row = await c.env.DB.prepare('SELECT last_seen_at FROM profiles WHERE hash = ?1').bind(A.hash).first();
  assert.ok(row && Number(row.last_seen_at) > 0, 'one stamp, at the last close');
});

test('typing and call signals reach the recipient on THEIR shard only, never the typist; appear-offline sends nothing', async () => {
  const c = cluster(BoardHub, N, freshDb());
  const A = home[0], B = home[1], Cc = home[2];
  const a = await c.connect(0); await c.send(0, a, { t: 'auth', key: A.key }); await c.send(0, a, { t: 'sub', scope: ['user:' + A.hash] });
  const b = await c.connect(1); await c.send(1, b, { t: 'auth', key: B.key }); await c.send(1, b, { t: 'sub', scope: ['user:' + B.hash] });
  const cc = await c.connect(2); await c.send(2, cc, { t: 'auth', key: Cc.key }); await c.send(2, cc, { t: 'sub', scope: ['user:' + Cc.hash] });
  await c.send(0, a, { t: 'typing', to: [B.hash, Cc.hash, A.hash], thread: 9, state: 'start' });
  assert.deepEqual(b.frames('typing'), [{ v: 1, t: 'typing', from: A.hash, thread: 9, state: 'start' }], 'B, on shard 1');
  assert.deepEqual(cc.frames('typing'), [{ v: 1, t: 'typing', from: A.hash, thread: 9, state: 'start' }], 'C, on shard 2');
  assert.deepEqual(a.frames('typing'), [], 'never the typist');
  await c.send(0, a, { t: 'call-sig', to: B.hash, call: 'c'.repeat(16), kind: 'ice', payload: { x: 1 } });
  assert.deepEqual(b.frames('call-sig'), [{ v: 1, t: 'call-sig', from: A.hash, call: 'c'.repeat(16), kind: 'ice', payload: { x: 1 } }]);
  assert.deepEqual(cc.frames('call-sig'), []);
  /* appear-offline: no keystrokes seen, not online, no stamp */
  await c.send(1, b, { t: 'auth', key: B.key, presence: 'off' });
  await c.send(1, b, { t: 'typing', to: A.hash, thread: 9 });
  assert.deepEqual(a.frames('typing'), []);
  assert.deepEqual(await c.shard(1).presenceOf([B.hash, A.hash]), [], 'B off; A is not this shard\'s to know');
  assert.deepEqual(await c.shard(0).presenceOf([B.hash, A.hash]), [A.hash]);
  await c.close(1, b);
  const row = await c.env.DB.prepare('SELECT last_seen_at FROM profiles WHERE hash = ?1').bind(B.hash).first();
  assert.ok(!row || row.last_seen_at == null, 'no stamp for a member who appears offline');
});

test('a wake rebuilds the index from the attachments: the same sockets, the same answers', async () => {
  const c = cluster(BoardHub, N, freshDb());
  const A = home[0];
  const a = await c.connect(0); await c.send(0, a, { t: 'auth', key: A.key });
  await c.send(0, a, { t: 'sub', scope: ['user:' + A.hash, 'dmview:t4', 'board:index'] });
  const anon = await c.connect(0); await c.send(0, anon, { t: 'sub', scope: ['board:index'] });
  const woke = c.wake(0);
  assert.deepEqual(await woke.stats(), { shard: 0, sockets: 2, members: 1 });
  assert.deepEqual(await woke.viewersOf('t4', [A.hash, home[1].hash]), [A.hash]);
  assert.equal(await woke.dmViewing(A.hash, 'x'), false);
  await woke.publish({ v: 1, t: 'topic-stats', scopes: ['board:index'], id: 5 });
  assert.deepEqual(a.frames('topic-stats').map((f) => f.id), [5]);
  assert.deepEqual(anon.frames('topic-stats').map((f) => f.id), [5]);
  await woke.publish({ v: 1, t: 'dm', scopes: ['user:' + A.hash], id: 6 });
  assert.deepEqual(a.frames('dm').map((f) => f.id), [6]);
  assert.deepEqual(anon.frames('dm'), []);
  /* a sub after the wake re-indexes the socket: the old scope is gone */
  await woke.webSocketMessage(a, JSON.stringify({ t: 'sub', scope: ['user:' + A.hash, 'topic:1'] }));
  await woke.publish({ v: 1, t: 'topic-stats', scopes: ['board:index'], id: 7 });
  assert.deepEqual(a.frames('topic-stats').map((f) => f.id), [5], 'A left board:index');
  assert.deepEqual(anon.frames('topic-stats').map((f) => f.id), [5, 7]);
});

test('a member on the wrong shard is accepted and said once; the sub cap closes and forgets the socket', async () => {
  const c = cluster(BoardHub, N, freshDb());
  const B = home[1];
  const said = [];
  const log = console.log;
  console.log = (s) => { said.push(String(s)); };
  try {
    const b = await c.connect(0); await c.send(0, b, { t: 'auth', key: B.key }); await c.send(0, b, { t: 'auth', key: B.key });
    assert.equal(said.filter((s) => s.includes('hub_misrouted')).length, 1, 'once per socket');
    assert.deepEqual(await c.shard(0).presenceOf([B.hash]), [B.hash], 'still served where it sits');
  } finally { console.log = log; }
  const x = await c.connect(2);
  for (let i = 0; i < 500; i++) await c.send(2, x, { t: 'sub', scope: ['board:index'] });
  assert.equal(x.closed, null);
  await c.send(2, x, { t: 'sub', scope: ['board:index'] });
  assert.deepEqual(x.closed, [1008, 'too many']);
  assert.deepEqual(await c.shard(2).stats(), { shard: 2, sockets: 0, members: 0 });
});

test('the worker routes: a private event to its home shards alone, a public one to every shard; presence and viewing are asked of the home shards', async () => {
  const hub = hubSpy({ online: (hs) => hs, viewersOf: (tag, hs) => hs, viewing: () => true });
  const env = makeEnv({ db: freshDb(), hub, vars: { HUB_SHARDS: '4' } });
  assert.equal(hubShards(env), 4);
  const A = home[0], B = home[1];
  const n4 = (h) => Hub.shardName(Hub.shardOf(4)(h));
  await sendToHub(env, { v: 1, t: 'dm', scopes: ['user:' + A.hash, 'user:' + B.hash] });
  assert.deepEqual(hub.names('publish').sort(), [...new Set([n4(A.hash), n4(B.hash)])].sort(), 'the two homes (one call each)');
  hub.calls.length = 0;
  await sendToHub(env, { v: 1, t: 'new-topic', scopes: ['cat:pub', 'board:index'] });
  assert.deepEqual(hub.names('publish'), Hub.shardNames(4), 'all four');
  hub.calls.length = 0;
  await sendToHub(env, { v: 1, t: 'x', scopes: ['user:' + A.hash, 'presence:' + A.hash] });
  assert.deepEqual(hub.names('publish'), Hub.shardNames(4), 'a public scope beside a private one: all');
  hub.calls.length = 0;
  await sendToHub(env, { v: 1, t: 'new-reply', scopes: ['cat:adminsonly'] });
  assert.deepEqual(hub.names('publish'), [], 'the back room never crosses the wire (boardEventPublic)');
  assert.deepEqual((await hubPresenceOf(env, [A.hash, B.hash])).sort(), [A.hash, B.hash].sort());
  assert.deepEqual(hub.names('presenceOf').sort(), [...new Set([n4(A.hash), n4(B.hash)])].sort());
  hub.calls.length = 0;
  assert.deepEqual(await hubViewersOf(env, 't3', [A.hash]), [A.hash]);
  assert.deepEqual(hub.calls.map((c) => [c.name, c.method, c.args]), [[n4(A.hash), 'viewersOf', ['t3', [A.hash]]]]);
  hub.calls.length = 0;
  assert.equal(await hubDmViewing(env, B.hash, A.hash), true);
  assert.deepEqual(hub.names('dmViewing'), [n4(B.hash)]);
  assert.deepEqual(await hubStats(env), [0, 1, 2, 3].map((shard) => ({ shard, sockets: 0, members: 0 })));
  /* no hub: every question answers "nobody" */
  const bare = makeEnv({ db: freshDb() });
  assert.deepEqual(await hubPresenceOf(bare, [A.hash]), []);
  assert.deepEqual(await hubStats(bare), []);
});

test('the upgrade is placed by the hint, or by the address without one; the hint must be a hash', async () => {
  const hub = hubSpy();
  const env = makeEnv({ db: freshDb(), hub, vars: { HUB_SHARDS: '4' } });
  const ws = { headers: { Upgrade: 'websocket' } };
  const A = home[0];
  const r = await call(worker, env, 'GET', '/api/comments/live?h=' + A.hash, undefined, ws);
  assert.equal(r.status, 200);
  assert.deepEqual(hub.fetched, [Hub.shardName(Hub.shardOf(4)(A.hash))], 'the member\'s home');
  hub.fetched.length = 0;
  await call(worker, env, 'GET', '/api/comments/live', undefined, { ...ws, ip: '198.51.100.9' });
  await call(worker, env, 'GET', '/api/comments/live?h=nonsense', undefined, { ...ws, ip: '198.51.100.9' });
  assert.equal(hub.fetched.length, 2);
  assert.equal(hub.fetched[0], hub.fetched[1], 'the same address, the same shard, hint or no hint');
  const spy1 = hubSpy();
  const one = makeEnv({ db: freshDb(), hub: spy1 });
  await call(worker, one, 'GET', '/api/comments/live?h=' + A.hash, undefined, ws);
  assert.equal(hubShards(one), 1);
  assert.deepEqual(spy1.fetched, ['board'], 'no var: one shard, the historic name');
});

/* ---- targeted presence (the watch registry) ---- */

/* count the relays each shard receives */
function countRelays(c, n) {
  const got = Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    const inst = c.shard(i);
    const orig = inst.relay.bind(inst);
    inst.relay = async (items) => { got[i] += 1; return orig(items); };
  }
  return got;
}
const watchRows = (c, i) => c.ctxs.get(Hub.shardName(i)).storage.sql.db.prepare('SELECT hash, shard, n FROM watch ORDER BY shard').all().map((r) => ({ ...r }));

test('a presence change is relayed only to the shards that watch the member, and a watch that ended is forgotten', async () => {
  const c = cluster(BoardHub, N, freshDb());
  const A = home[0], W = home[2];
  const got = countRelays(c, N);
  const w = await c.connect(2); await c.send(2, w, { t: 'auth', key: W.key });
  await c.send(2, w, { t: 'sub', scope: ['user:' + W.hash, 'presence:' + A.hash] });
  assert.deepEqual(watchRows(c, 0), [{ hash: A.hash, shard: 2, n: N }], 'shard 0 knows shard 2 watches A');
  got.fill(0);
  const a = await c.connect(0); await c.send(0, a, { t: 'auth', key: A.key });
  assert.deepEqual(got, [0, 0, 1], 'A online: one relay, to shard 2 only');
  assert.deepEqual(w.frames('presence').slice(-1), [{ v: 1, t: 'presence', hash: A.hash, online: true }]);
  /* W moves on: the next change finds shard 2 idle, and the row goes */
  await c.send(2, w, { t: 'sub', scope: ['user:' + W.hash, 'board:index'] });
  got.fill(0);
  await c.close(0, a);
  assert.deepEqual(got, [0, 0, 1], 'one relay, answered idle');
  assert.deepEqual(watchRows(c, 0), [], 'the ended watch is forgotten');
  got.fill(0);
  const a2 = await c.connect(0); await c.send(0, a2, { t: 'auth', key: A.key });
  assert.deepEqual(got, [0, 0, 0], 'nobody watches: no relay at all');
  /* W watches again: shard 2 registers afresh, though it had registered once */
  await c.send(2, w, { t: 'sub', scope: ['user:' + W.hash, 'presence:' + A.hash] });
  assert.deepEqual(w.frames('presence').slice(-1), [{ v: 1, t: 'presence', hash: A.hash, online: true }], 'the seed');
  assert.deepEqual(watchRows(c, 0), [{ hash: A.hash, shard: 2, n: N }]);
  got.fill(0);
  await c.close(0, a2);
  assert.deepEqual(got, [0, 0, 1]);
  assert.deepEqual(w.frames('presence').slice(-1), [{ v: 1, t: 'presence', hash: A.hash, online: false }]);
});

test('a registration that lands while an idle answer is in flight survives it', async () => {
  const c = cluster(BoardHub, N, freshDb());
  const A = home[0], W = home[2];
  const w = await c.connect(2); await c.send(2, w, { t: 'auth', key: W.key });
  await c.send(2, w, { t: 'sub', scope: ['presence:' + A.hash] });
  await c.send(2, w, { t: 'sub', scope: [] });   // the watch ends; the row still stands
  const s2 = c.shard(2);
  const orig = s2.relay.bind(s2);
  s2.relay = async (items) => {
    const answer = await orig(items);                         // idle: nobody watches A here…
    await c.send(2, w, { t: 'sub', scope: ['presence:' + A.hash] });   // …and a watcher returns before the answer lands
    return answer;
  };
  const a = await c.connect(0); await c.send(0, a, { t: 'auth', key: A.key });
  assert.deepEqual(watchRows(c, 0), [{ hash: A.hash, shard: 2, n: N }], 'the fresh registration was not deleted by the stale idle');
  s2.relay = orig;
  await c.close(0, a);
  assert.deepEqual(w.frames('presence').slice(-1), [{ v: 1, t: 'presence', hash: A.hash, online: false }], 'and the returning watcher hears the change');
});

test('one shard never touches storage; a misrouted member is relayed to every sibling; a reshard\'s rows go on wake', async () => {
  const one = cluster(BoardHub, 1, freshDb());
  const A = home[0];
  const x = await one.connect(0); await one.send(0, x, { t: 'auth', key: A.key });
  await one.send(0, x, { t: 'sub', scope: ['presence:' + home[1].hash, 'user:' + A.hash] });
  await one.close(0, x);
  assert.deepEqual(one.ctxs.get('board').storage.sql.calls, [], 'HUB_SHARDS=1: no storage at all');

  const c = cluster(BoardHub, N, freshDb());
  const got = countRelays(c, N);
  const B = home[1];
  const b = await c.connect(0); await c.send(0, b, { t: 'auth', key: B.key });   // B's home is shard 1
  assert.deepEqual(got, [0, 1, 1], 'off its home shard: every sibling hears, as before the registry');

  /* rows written under another shard count are dropped the next time the shard wakes */
  const sql = c.ctxs.get('board').storage.sql;
  sql.exec("INSERT INTO watch (hash, shard, n, at) VALUES (?, 5, 8, 1)", A.hash);
  sql.exec("INSERT INTO watch (hash, shard, n, at) VALUES (?, 2, ?, 2)", A.hash, N);
  const woke = c.wake(0);
  await woke.watch(1, [], []);
  assert.deepEqual(watchRows(c, 0), [{ hash: A.hash, shard: 2, n: N }], 'the n=8 row went, the current one stayed');
  assert.deepEqual(await woke.watch(0, [A.hash], []), [], 'a shard never registers itself');
  assert.equal(watchRows(c, 0).length, 1);
});
