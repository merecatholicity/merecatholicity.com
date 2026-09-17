/* The rate limiter, per member with an address backstop (2026-09-17;
 * lib.ts throttle, Domain.Throttle).
 *
 * What would break silently: members behind one address spending each
 * other's allowance again (a parish Wi-Fi throttled as one reader); a keyless
 * request opening a "member" bucket of its own; key rotation escaping every
 * limit; a new handler calling a limiter directly and keying it by address.
 * So: RUN the limiter and real routes against counting bindings, and sweep the
 * source for any `.limit(` outside `throttle`. */
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadWorker, makeEnv, freshDb, identity, resetCaches, call, limiter } from '../_support/worker.mjs';
import { throttle, sha256hex } from '../../comments-worker/src/lib.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const IP = '198.51.100.20';
let worker, A, B;
before(async () => {
  ({ worker } = await loadWorker());
  [A, B] = await Promise.all(['throttle-a', 'throttle-b'].map(identity));
});
beforeEach(resetCaches);

test('a member counts against their own bucket AND the address backstop; a keyless request against the backstop alone', async () => {
  const env = makeEnv({ db: freshDb() });
  assert.equal(await throttle(env, 'READ_LIMIT', IP, { key: A.key }), true);
  assert.deepEqual(env.limited, [['READ_LIMIT', 'm:' + A.hash], ['READ_IP_LIMIT', IP]]);
  env.limited.length = 0;
  assert.equal(await throttle(env, 'POST_LIMIT', IP, { hash: B.hash }), true, 'a hash stands for the key');
  assert.deepEqual(env.limited, [['POST_LIMIT', 'm:' + B.hash], ['POST_IP_LIMIT', IP]]);
  env.limited.length = 0;
  for (const who of [{}, { key: '' }, { key: null }, { hash: await sha256hex('') }, { hash: 'not-a-hash' }]) {
    assert.equal(await throttle(env, 'CONNECT_LIMIT', IP, who), true);
  }
  assert.deepEqual(env.limited, Array(5).fill(['CONNECT_IP_LIMIT', IP]), 'keyless, the empty key and a bad hint all count at the address only');
});

test('two members behind one address each get their own allowance; the backstop still binds them all', async () => {
  const env = makeEnv({ db: freshDb(), limits: { READ_LIMIT: 3, READ_IP_LIMIT: 7 } });
  const verdicts = [];
  for (let i = 0; i < 3; i++) verdicts.push(await throttle(env, 'READ_LIMIT', IP, { key: A.key }));
  for (let i = 0; i < 3; i++) verdicts.push(await throttle(env, 'READ_LIMIT', IP, { key: B.key }));
  assert.deepEqual(verdicts, Array(6).fill(true), 'A spending three does not touch B');
  assert.equal(await throttle(env, 'READ_LIMIT', IP, { key: A.key }), false, 'A is out');
  assert.equal(await throttle(env, 'READ_LIMIT', '203.0.113.99', { key: A.key }), false, 'from any address: the bucket is the member');
  /* rotating keys: fresh members pass their own bucket, then the address says no */
  const fresh = await Promise.all(['r1', 'r2', 'r3'].map(identity));
  const rot = [];
  for (const f of fresh) rot.push(await throttle(env, 'READ_LIMIT', IP, { key: f.key }));
  assert.deepEqual(rot, [false, false, false], 'the eighth request from this address onward is refused whatever key it names');
  assert.equal(await throttle(env, 'READ_LIMIT', IP), false, 'and keyless too');
});

test('without a backstop binding, a keyless request falls back to the member binding keyed by address', async () => {
  const env = makeEnv({ db: freshDb() });
  delete env.READ_IP_LIMIT;
  env.limited.length = 0;
  assert.equal(await throttle(env, 'READ_LIMIT', IP), true);
  assert.equal(await throttle(env, 'READ_LIMIT', IP, { key: A.key }), true);
  assert.deepEqual(env.limited, [['READ_LIMIT', IP], ['READ_LIMIT', 'm:' + A.hash]]);
});

test('real routes: a keyed read and a keyed write limit the member; the socket upgrade limits the hinted member', async () => {
  const env = makeEnv({ db: freshDb() });
  await call(worker, env, 'POST', '/api/comments/dm/unread', { key: A.key }, { ip: IP });
  assert.deepEqual(env.limited.filter(([n]) => n.startsWith('READ')), [['READ_LIMIT', 'm:' + A.hash], ['READ_IP_LIMIT', IP]]);
  env.limited.length = 0;
  await call(worker, env, 'POST', '/api/comments/react', { key: A.key, target: 'post', id: 1, emoji: '👍' }, { ip: IP });
  assert.deepEqual(env.limited.filter(([n]) => n.startsWith('POST')), [['POST_LIMIT', 'm:' + A.hash], ['POST_IP_LIMIT', IP]]);
  env.limited.length = 0;
  await call(worker, env, 'GET', '/api/comments/board', undefined, { ip: IP });
  assert.deepEqual(env.limited, [['READ_IP_LIMIT', IP]], 'a public GET is keyless');
  env.limited.length = 0;
  const hubless = makeEnv({ db: freshDb() });
  hubless.HUB = { idFromName: (n) => n, get: () => ({ fetch: async () => new Response('hub') }) };
  await call(worker, hubless, 'GET', '/api/comments/live?h=' + B.hash, undefined, { ip: IP, headers: { Upgrade: 'websocket' } });
  assert.deepEqual(hubless.limited, [['CONNECT_LIMIT', 'm:' + B.hash], ['CONNECT_IP_LIMIT', IP]]);
  /* a member out of allowance is refused, a neighbour on the same address is not */
  const tight = makeEnv({ db: freshDb(), limits: { READ_LIMIT: 1 } });
  assert.equal((await call(worker, tight, 'POST', '/api/comments/dm/unread', { key: A.key }, { ip: IP })).status, 200);
  assert.equal((await call(worker, tight, 'POST', '/api/comments/dm/unread', { key: A.key }, { ip: IP })).status, 429);
  assert.equal((await call(worker, tight, 'POST', '/api/comments/dm/unread', { key: B.key }, { ip: IP })).status, 200, 'the parish neighbour reads on');
});

test('the sweep: nothing in the worker calls a limiter except throttle', () => {
  const src = join(root, 'comments-worker', 'src');
  const files = ['index.ts', 'lib.ts', 'durable.ts', 'ops.ts', 'dbsession.ts', ...readdirSync(join(src, 'routes')).map((f) => 'routes/' + f)];
  const offenders = [];
  for (const f of files) {
    let text = readFileSync(join(src, f), 'utf8');
    if (f === 'lib.ts') {
      const a = text.indexOf('export async function throttle(');
      const b = text.indexOf('\n}\n', a);
      text = text.slice(0, a) + text.slice(b);
    }
    text.split('\n').forEach((line, i) => {
      if (/\.limit\(\s*\{/.test(line)) offenders.push(`${f}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(offenders, [], 'call throttle(env, bucket, ip, { key }) instead');
  assert.ok(typeof limiter === 'function');
});
