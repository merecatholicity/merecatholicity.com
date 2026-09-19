/* The hub's wire speaks PUBLIC ids; the hub routes on ACCOUNT hashes (2026-09-19).
 *
 * Everything inside the BoardHub is keyed by the account hash — the socket
 * index, the watch table, `#isOnline`, and the `user:` scopes the worker builds
 * when it publishes. Everything a client says or hears is a public id, because
 * since the L3 flip a client cannot know anyone's account hash but its own.
 *
 * Before that flip the two were the same string, so no translation existed and
 * none was missed. After it, its absence did not throw — it routed into space.
 * A `presence:` subscription named an id the hub never publishes under, so the
 * dot never changed and the thread header sat on a stale "last seen" for ever;
 * a typing frame was fanned to `user:<a public id>`, a scope no socket holds;
 * a call's ICE trickle was addressed to nowhere. Three features went quiet at
 * once and nothing anywhere went red.
 *
 * Nothing went red because hub.test.mjs drives the cluster with NO pepper, and
 * with no pepper `pubid === hash` — every translation is the identity function
 * and every mismatch is invisible. So this file is that file's twin with the
 * pepper SET: the same hub, driven only in public ids, asserting the frames
 * come back in public ids and carry no account hash at all. */
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as Hub from '../../purescript/output/Domain.Hub/index.js';
import { loadWorker, makeEnv, freshDb, identity, resetCaches } from '../_support/worker.mjs';
import { fakeCtx } from '../_support/hub_runtime.mjs';
import { pubidOf } from '../../comments-worker/src/lib.ts';

const PEPPER = 'a-test-pepper-for-the-hub-2026';

function cluster(BoardHub, n, db) {
  const instances = new Map();
  const ctxs = new Map();
  const namespace = { idFromName: (name) => name, get: (name) => instances.get(name) };
  const env = makeEnv({ db, hub: { namespace }, vars: { HUB_SHARDS: String(n), PUBLIC_ID_PEPPER: PEPPER } });
  for (const name of Hub.shardNames(n)) {
    const ctx = fakeCtx(name);
    ctxs.set(name, ctx);
    instances.set(name, new BoardHub(ctx, env));
  }
  const shard = (i) => instances.get(Hub.shardName(i));
  const connect = async (i) => {
    const r = await shard(i).fetch(new Request('https://merecatholicity.com/api/comments/live', { headers: { Upgrade: 'websocket' } }));
    const ctx = ctxs.get(Hub.shardName(i));
    return ctx.sockets[ctx.sockets.length - 1];
  };
  const send = (i, ws, frame) => shard(i).webSocketMessage(ws, JSON.stringify(frame));
  const close = (i, ws) => { const ctx = ctxs.get(Hub.shardName(i)); ctx.sockets.splice(ctx.sockets.indexOf(ws), 1); return shard(i).webSocketClose(ws, 1000, '', true); };
  return { env, shard, connect, send, close };
}

let BoardHub, A, B;
before(async () => {
  ({ BoardHub } = await loadWorker());
  [A, B] = await Promise.all(['hub-pub-a', 'hub-pub-b'].map(identity));
});
beforeEach(resetCaches);

/* the ids as each side knows them */
async function ids(env) {
  const pa = await pubidOf(env, A.hash);
  const pb = await pubidOf(env, B.hash);
  assert.notEqual(pa, A.hash, 'the pepper must actually be in force, or this file proves nothing');
  return { pa, pb };
}

test('a presence subscription names the watched member by their PUBLIC id, and is answered', async () => {
  const c = cluster(BoardHub, 1, freshDb());
  const { pa } = await ids(c.env);
  const b = await c.connect(0);
  await c.send(0, b, { t: 'auth', key: B.key });
  await c.send(0, b, { t: 'sub', scope: ['presence:' + pa] });   // B watches A, by A's PUBLIC id
  const a = await c.connect(0);
  await c.send(0, a, { t: 'auth', key: A.key });                 // A comes online
  const on = b.frames('presence');
  assert.ok(on.length, 'B heard nothing: the sub and the broadcast disagree about which id names A');
  assert.equal(on[on.length - 1].online, true, 'A is online');
  assert.equal(on[on.length - 1].hash, pa, 'named by the PUBLIC id B asked with, never the account hash');
  await c.close(0, a);
  const off = b.frames('presence');
  assert.equal(off[off.length - 1].online, false, 'and the dot goes out when the last socket closes');
  assert.equal(off[off.length - 1].hash, pa);
});

test('the seed a new subscriber gets is in public ids too, and tells the truth', async () => {
  const c = cluster(BoardHub, 1, freshDb());
  const { pa } = await ids(c.env);
  const a = await c.connect(0);
  await c.send(0, a, { t: 'auth', key: A.key });                 // A is ALREADY online
  const b = await c.connect(0);
  await c.send(0, b, { t: 'auth', key: B.key });
  await c.send(0, b, { t: 'sub', scope: ['presence:' + pa] });
  const seed = b.frames('presence');
  assert.equal(seed.length, 1, 'exactly one seed for the one member watched');
  assert.equal(seed[0].hash, pa);
  assert.equal(seed[0].online, true, 'seeded OFFLINE is the bug: the lookup missed because the id was not translated');
});

test('typing reaches the member it names, and is signed with a public id', async () => {
  const c = cluster(BoardHub, 1, freshDb());
  const { pa, pb } = await ids(c.env);
  const b = await c.connect(0);
  await c.send(0, b, { t: 'auth', key: B.key });
  await c.send(0, b, { t: 'sub', scope: ['user:' + B.hash] });   // the caller's OWN scope is its account hash
  const a = await c.connect(0);
  await c.send(0, a, { t: 'auth', key: A.key });
  await c.send(0, a, { t: 'typing', to: [pb], thread: 7, state: 'start' });
  const t = b.frames('typing');
  assert.equal(t.length, 1, 'fanned to user:<a public id> reaches nobody');
  assert.equal(t[0].from, pa, 'the typist is named by their public id');
  assert.equal(t[0].thread, 7);
  assert.equal(a.frames('typing').length, 0, 'never echoed to the typist');
});

test('a call signal reaches the member it names, and is signed with a public id', async () => {
  const c = cluster(BoardHub, 1, freshDb());
  const { pa, pb } = await ids(c.env);
  const b = await c.connect(0);
  await c.send(0, b, { t: 'auth', key: B.key });
  await c.send(0, b, { t: 'sub', scope: ['user:' + B.hash] });
  const a = await c.connect(0);
  await c.send(0, a, { t: 'auth', key: A.key });
  await c.send(0, a, { t: 'call-sig', to: pb, call: 'abcdef0123456789', kind: 'ice', payload: 'x' });
  const sig = b.frames('call-sig');
  assert.equal(sig.length, 1, 'the ICE trickle went nowhere');
  assert.equal(sig[0].from, pa, 'the caller is named by their public id');
  assert.equal(sig[0].kind, 'ice');
});

test('no account hash rides any frame the hub hands a client', async () => {
  const c = cluster(BoardHub, 1, freshDb());
  const { pa, pb } = await ids(c.env);
  const b = await c.connect(0);
  await c.send(0, b, { t: 'auth', key: B.key });
  await c.send(0, b, { t: 'sub', scope: ['user:' + B.hash, 'presence:' + pa] });
  const a = await c.connect(0);
  await c.send(0, a, { t: 'auth', key: A.key });
  await c.send(0, a, { t: 'typing', to: [pb], thread: 7, state: 'start' });
  await c.send(0, a, { t: 'call-sig', to: pb, call: 'abcdef0123456789', kind: 'end' });
  const text = JSON.stringify(b.sent);   // every frame B was handed, of any kind
  assert.ok(!text.includes(A.hash), 'A\'s account hash reached B through a hub frame');
  assert.ok(!text.includes(B.hash), 'B\'s own account hash rode a frame body');
  assert.ok(text.includes(pa), 'A is present, as a public id');
});
