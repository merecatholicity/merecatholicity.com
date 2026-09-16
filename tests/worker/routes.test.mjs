/* The route table's parity and dispatch (2026-09-16).
 *
 * The ROUTES table in comments-worker/src/index.ts is the worker's
 * composition root: (method, path) → handler. As the handlers move out into
 * comments-worker/src/routes/*.ts, two things must hold on every commit:
 *  - the table itself is unchanged — the same 125 (method, path, thunk)
 *    triples, in the same order, as tests/_support/routes.json records (a
 *    route added or renamed on purpose updates the snapshot in that commit);
 *  - every entry still dispatches — the worker, loaded in Node with the
 *    ledger behind the D1 shim, answers each registered pair with the
 *    handler's own reply, never the router's 500 (a handler left unimported
 *    or misnamed after a move throws TypeError at call time, which fetch's
 *    catch turns into "Server hiccup"). The two WebSocket doors and the
 *    /@handle card are the four branches fetch keeps outside the table; they
 *    are probed too. */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadWorker, makeEnv, call, netSpy, resetCaches, hubSpy } from '../_support/worker.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const snapshot = JSON.parse(readFileSync(join(root, 'tests', '_support', 'routes.json'), 'utf8'));
const indexSrc = readFileSync(join(root, 'comments-worker', 'src', 'index.ts'), 'utf8');

function tableTriples(src) {
  const i = src.indexOf('const ROUTES: Route[] = [');
  const j = src.indexOf('\n];', i);
  assert.ok(i > 0 && j > i, 'the ROUTES table is in index.ts');
  /* one entry per line: method, path, and the thunk's text verbatim (a trailing comment allowed) */
  const re = /^\s*\{ m: '(GET|POST)', p: '([^']+)', fn: (.*?) \},?\s*(?:\/\/.*)?$/gm;
  return [...src.slice(i, j).matchAll(re)].map((m) => ({ m: m[1], p: m[2], fn: m[3] }));
}

test('the ROUTES table is the committed snapshot: 125 (method, path, thunk) triples, in order, every pair unique', () => {
  const triples = tableTriples(indexSrc);
  assert.deepEqual(triples, snapshot, 'tests/_support/routes.json records the table; a deliberate change updates it in the same commit');
  assert.equal(new Set(triples.map((r) => r.m + ' ' + r.p)).size, triples.length, 'every (method, path) pair is unique');
  const one = indexSrc.slice(indexSrc.indexOf('const ROUTES: Route[] = ['), indexSrc.indexOf('\n];', indexSrc.indexOf('const ROUTES: Route[] = [')));
  assert.equal((one.match(/^\s*\{ m: '/gm) || []).length, triples.length, 'every entry is one line the parser reads');
});

let worker, env, hub, net;
before(async () => {
  ({ worker } = await loadWorker());
  hub = hubSpy();
  env = makeEnv({ hub, vars: { ADMIN_HASHES: 'none' } });
  net = netSpy();
  resetCaches();
});

test('every registered route dispatches to a live handler (no entry answers with the router\'s 500)', async () => {
  const hiccups = [];
  for (const r of snapshot) {
    const { status, json } = await call(worker, env, r.m, r.p, r.m === 'POST' ? {} : undefined);
    if (status === 500) hiccups.push(`${r.m} ${r.p} → 500 ${json && json.error}`);
  }
  assert.deepEqual(hiccups, [], 'a 500 here is a handler that threw on entry — unimported after a move, or reaching a binding the harness does not stub');
  net.restore();
});

test('the four doors outside the table still answer: the two WebSocket upgrades, the origin guard, and /@handle', async () => {
  const ws = { headers: { Upgrade: 'websocket' } };
  const live = await call(worker, env, 'GET', '/api/comments/live', undefined, ws);
  assert.notEqual(live.status, 404, 'the board hub upgrade is routed before the table');
  assert.notEqual(live.status, 500);
  const chat = await call(worker, env, 'GET', '/api/merecat/live?chat=1', undefined, ws);
  assert.notEqual(chat.status, 404, 'the merecat upgrade is routed after the table');
  assert.notEqual(chat.status, 500);
  const bad = await call(worker, env, 'POST', '/api/comments/dm/unread', {}, { origin: 'https://evil.example' });
  assert.equal(bad.status, 403, 'a POST from a foreign origin is refused before any handler');
  const nf = await call(worker, env, 'GET', '/api/comments/no-such-road');
  assert.equal(nf.status, 404, 'an unknown path is the router\'s 404');
  assert.equal(nf.json.error, 'Not found.');
});
