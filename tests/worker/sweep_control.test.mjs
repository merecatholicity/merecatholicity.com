/* The leak sweep can fail (2026-09-17). A test that asserts ABSENCE passes
 * vacuously when its calls never reach the code or its detectors never look —
 * the first guard written after the /api/comments/recent disclosure did
 * exactly that. So each detector of tests/worker/env_leak.test.mjs is shown
 * here catching a planted leak. The leaks are planted around the worker (a
 * wrapper) and in synthetic sources, never in product code. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { runSweep, secretsIn, forbiddenFor, SECRETS, PRIVATE } from '../_support/sweep.mjs';
import { envFlow } from '../_support/env_flow.mjs';

const quiet = async (f) => {
  const log = console.log;
  console.log = () => {};
  try { return await f(); } finally { console.log = log; }
};
const only = (r) => r.p === '/api/comments/recent' || r.p === '/api/comments/profile' || r.p === '/api/comments/search';

test('a secret in an answer, a private value shown to the wrong reader, and a guard refusal are each caught', async () => {
  const secret = SECRETS.find((s) => s.name === 'TURN_KEY_SECRET');
  assert.ok(secret, 'the sweep sentinels the TURN secret');
  const planted = (worker) => ({
    ...worker,
    fetch: async (request, env, cx) => {
      const url = new URL(request.url);
      /* past the guard: what a guard that failed would let out */
      if (url.pathname === '/api/comments/recent') {
        return new Response(JSON.stringify({ ok: true, items: [], debug: env.TURN_KEY_SECRET }), { headers: { 'Content-Type': 'application/json' } });
      }
      /* an admin-only value, handed to whoever asked */
      if (url.pathname === '/api/comments/profile') {
        return new Response(JSON.stringify({ ok: true, profile: {}, ip: PRIVATE['comments.ip'].value }), { headers: { 'Content-Type': 'application/json' } });
      }
      /* a handler that echoes a secret: the real guard refuses it, and the refusal is recorded */
      if (url.pathname === '/api/comments/search') {
        return worker.fetch(new Request(url.origin + url.pathname + '?q=' + encodeURIComponent(env.TURN_KEY_SECRET), request), env, cx);
      }
      return worker.fetch(request, env, cx);
    },
  });
  const { calls } = await quiet(() => runSweep({ only, wrap: planted }));
  const leaked = calls.filter((c) => secretsIn(c.text).length);
  assert.deepEqual([...new Set(leaked.map((c) => c.p))], ['/api/comments/recent'], 'the secret detector sees the answer that carried one');
  const shown = calls.filter((c) => forbiddenFor(c.as, c.text).length).map((c) => c.as).sort();
  assert.deepEqual([...new Set(shown)], ['anon', 'member', 'outsider'], 'the private detector flags every reader but the admin');
  const refused = calls.filter((c) => c.said.some((e) => e.event === 'egress_blocked'));
  assert.equal(refused.length, 4, 'every search call was refused by the guard, and the sweep sees each refusal');
  assert.deepEqual([...new Set(refused.flatMap((c) => c.said.flatMap((e) => e.names || [])))], ['TURN_KEY_SECRET']);
  assert.ok(calls.some((c) => c.egress.length), 'and the first refusal was noted in the ledger');
});

test('the static law refuses the very bug, a spread, a serializer and a hand-off to a stranger', () => {
  const root = '/planted';
  const src = (rel, code) => ({ file: join(root, rel), rel, code });
  const sources = [
    src('db.ts', 'export function withNames(row, posts) { return Object.assign({}, row, { posts }); }\n'),
    src('routes.ts', [
      "import { withNames } from './db.ts';",
      'export async function handleRecent(request: Request, env: Env) {',
      '  const items: unknown[] = [];',
      '  return withNames(env, items);',
      '}',
      'export function spread(env: Env) { return { ...env }; }',
      'export function stringify(env: Env) { return JSON.stringify({ env }); }',
      'export function fine(env: Env) { return helper(env) + (env && env.SITE); }',
      'function helper(env: Env) { return env.SITE; }',
      'export class Room { env: Env; send() { return log(this.env); } }',
      'function log(value: unknown) { return String(value); }',
      '',
    ].join('\n')),
  ];
  const { checked, bad } = envFlow(sources);
  assert.ok(checked >= 6);
  const lines = bad.map((b) => b.replace(/ in: .*$/, ''));
  assert.deepEqual(lines, ['routes.ts:4 env', 'routes.ts:6 env', 'routes.ts:7 env', 'routes.ts:10 this.env']);
});
