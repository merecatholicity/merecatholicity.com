/* D1 read replicas through the Sessions API (2026-09-17; dbsession.ts,
 * Domain.Consistency).
 *
 * What would break silently: a write route starting its session on a replica
 * (a purge trusting a stale reference count); a read route never leaving the
 * primary (the replicas idle while the primary queues); a member not seeing
 * their own last write because no bookmark came back; a hostile cookie handed
 * to D1; a listed route that no longer exists, or that grew a write. */
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as Consistency from '../../purescript/output/Domain.Consistency/index.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadWorker, makeEnv, freshDb, identity, resetCaches, call, handlerBody, routesSource } from '../_support/worker.mjs';


const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const routesSnapshot = () => JSON.parse(readFileSync(join(root, 'tests', '_support', 'routes.json'), 'utf8'));

let worker, A;
before(async () => {
  ({ worker } = await loadWorker());
  A = await identity('session-a');
});
beforeEach(resetCaches);

const setCookie = (r) => r.res.headers.get('Set-Cookie') || '';
const BM = '0000002a-00000000-00000000-' + 'b'.repeat(32);

test('a listed read starts anywhere; a route off the list starts at the primary', async () => {
  const env = makeEnv({ db: freshDb() });
  await call(worker, env, 'GET', '/api/comments/board');
  await call(worker, env, 'POST', '/api/comments/dm/unread', { key: A.key });
  await call(worker, env, 'POST', '/api/comments/prefs', { key: A.key });
  await call(worker, env, 'POST', '/api/comments/dm/roster', { key: A.key, thread: 1 });
  assert.deepEqual(env.DB.sessions, ['first-unconstrained', 'first-unconstrained', 'first-primary', 'first-primary']);
});

test('a request that wrote answers with its bookmark; a pure read does not', async () => {
  const env = makeEnv({ db: freshDb() });
  const read = await call(worker, env, 'GET', '/api/comments/board');
  assert.equal(setCookie(read), '', 'no cookie for a read');
  const same = await call(worker, env, 'POST', '/api/comments/prefs', { key: A.key });
  assert.equal(setCookie(same), '', 'a prefs READ writes nothing: no cookie');
  const wrote = await call(worker, env, 'POST', '/api/comments/prefs', { key: A.key, set: { receipts: 'auto' } });
  assert.equal(wrote.status, 200);
  const c = setCookie(wrote);
  assert.match(c, /^mc-d1=[0-9a-f]{8}-[0-9a-f-]+; Path=\/api; Max-Age=300; Secure; HttpOnly; SameSite=Strict$/);
  /* the next listed read starts from it */
  const bm = decodeURIComponent(c.split(';')[0].slice('mc-d1='.length));
  await call(worker, env, 'POST', '/api/comments/dm/unread', { key: A.key }, { headers: { Cookie: 'theme=dark; mc-d1=' + encodeURIComponent(bm) } });
  assert.equal(env.DB.sessions.at(-1), bm, 'read-your-writes: at least as fresh as the member\'s last write');
  /* a write route keeps the primary even with a bookmark */
  await call(worker, env, 'POST', '/api/comments/prefs', { key: A.key }, { headers: { Cookie: 'mc-d1=' + BM } });
  assert.equal(env.DB.sessions.at(-1), 'first-primary');
});

test('a malformed cookie is ignored, and a bookmark D1 refuses falls back to the primary', async () => {
  const env = makeEnv({ db: freshDb() });
  await call(worker, env, 'GET', '/api/comments/board', undefined, { headers: { Cookie: 'mc-d1=first-primary' } });
  await call(worker, env, 'GET', '/api/comments/board', undefined, { headers: { Cookie: 'mc-d1=00000000%3B%20Path%3D%2F' } });
  assert.deepEqual(env.DB.sessions, ['first-unconstrained', 'first-unconstrained'], 'not a bookmark: unconstrained');
  /* the shim throws for this one bookmark-shaped value, as D1 would for a stale or foreign bookmark */
  const real = env.DB.withSession;
  env.DB.withSession = (c) => real(c === BM ? 'refuse-me' : c);
  const r = await call(worker, env, 'GET', '/api/comments/board', undefined, { headers: { Cookie: 'mc-d1=' + BM } });
  assert.equal(r.status, 200);
  assert.equal(env.DB.sessions.at(-1), 'first-primary');
});

test('every listed route is a registered route, and its handler writes only what the list allows', () => {
  const routes = new Map(routesSnapshot().map((r) => [r.m + ' ' + r.p, r.fn]));
  const src = routesSource();
  for (const key of Consistency.replicaRoutes) {
    assert.ok(routes.has(key), key + ' is a route');
    const name = /=> (handle[A-Za-z]+)\(/.exec(routes.get(key))[1];
    const body = handlerBody(name, src);
    const writes = (body.match(/\b(INSERT|UPDATE|DELETE FROM|REPLACE INTO)\b|registerMember\(|notifyDm\(|\.put\(|\.delete\(/g) || []).length;
    assert.equal(writes, 0, `${key} (${name}) writes ${writes} time(s): a route that writes starts at the primary`);
  }
});

test('crons and the ops probe use the plain binding; the probe reports where an unconstrained read ran', async () => {
  const env = makeEnv({ db: freshDb() });
  const { servedBy } = await import('../../comments-worker/src/dbsession.ts');
  const d1 = await servedBy(env);
  assert.deepEqual(d1, { served_by_primary: null, served_by_region: null }, 'the shim carries no meta: nulls, never a throw');
  assert.deepEqual(env.DB.sessions, ['first-unconstrained']);
});
