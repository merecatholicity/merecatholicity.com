/* No answer the worker gives ever carries the worker's own env (2026-09-17).
 *
 * The bug this locks out, found by the Env typing pass and live on production
 * from 2026-08-02 to 2026-09-17: `GET /api/comments/recent` — public, keyless,
 * `Cache-Control: public, max-age=300` — ended with
 *
 *     items = await withNames(env, items);
 *
 * two arguments handed to db.ts's `withNames(row, posts)` mapper. So the ROW it
 * copied (`Object.assign({}, row)`) was the worker's `env`, and the endpoint
 * served every binding and every secret string it holds — TURNSTILE_SECRET,
 * VAPID_PRIVATE_KEY, TURN_KEY_SECRET, CF_USAGE_TOKEN, MERECAT_INGEST_KEY,
 * ADMIN_HASHES, the lot — to anyone who asked. Nothing was red: `withNames`
 * took `any`, the handler took `env: any`, and no test read a response body for
 * anything it should not contain.
 *
 * The guard is a SWEEP, not a line: every route in the table is called against
 * an env whose vars and secrets are sentinel strings, and no response body —
 * JSON or not — may contain one, nor any binding's name as a key. A handler
 * that serializes `env`, or a piece of it, fails here whatever road it took.
 *
 * (`VAPID_PUBLIC_KEY` is public by design — /push/key exists to serve it — so it
 * carries no sentinel; every other var and secret does.) */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadWorker, makeEnv, call, netSpy, resetCaches, hubSpy } from '../_support/worker.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const snapshot = JSON.parse(readFileSync(join(root, 'tests', '_support', 'routes.json'), 'utf8'));

/* Every var and secret comments-worker/src/env.ts declares, except the one that
   is public on purpose. The value is a sentinel so a leak is unmistakable. */
const SECRET_VARS = [
  'ADMIN_HASHES', 'HIDDEN_HASHES', 'TURNSTILE_HOSTNAMES', 'ALLOWED_ORIGINS', 'SITE',
  'TURN_KEY_ID', 'CF_ACCOUNT_ID', 'ALERT_FROM', 'VAPID_SUBJECT',
  'TURNSTILE_SECRET', 'VAPID_PRIVATE_KEY', 'TURN_KEY_SECRET', 'CF_USAGE_TOKEN',
  'MERECAT_INGEST_KEY', 'MC_TEST_BYPASS', 'TEST_HASHES',
];
const SENTINEL = 'mc-env-sentinel-';
const vars = Object.fromEntries(SECRET_VARS.map((k) => [k, SENTINEL + k]));

/* The binding names that would appear as KEYS if an env object were serialized
   whole (a leak whose values the harness stubs, so the sentinel sweep alone
   would not see it). */
const BINDINGS = ['DB', 'LIBDB', 'LIBDB2', 'LIBDB3', 'MERECAT_INDEX', 'AI', 'HUB', 'CHAT',
  'BACKUPS', 'AVATARS', 'MEDIA', 'WALLMEDIA', 'POST_LIMIT', 'READ_LIMIT', 'CONNECT_LIMIT',
  'POST_IP_LIMIT', 'READ_IP_LIMIT', 'CONNECT_IP_LIMIT'];

let worker, env, net;
before(async () => {
  ({ worker } = await loadWorker());
  env = makeEnv({ hub: hubSpy(), vars });
  net = netSpy();
  resetCaches();
});

test('no route\'s answer carries a var, a secret, or a binding of the worker env', async () => {
  const leaks = [];
  for (const r of snapshot) {
    const { text, json } = await call(worker, env, r.m, r.p, r.m === 'POST' ? {} : undefined);
    const body = text || '';
    const hit = SECRET_VARS.find((k) => body.includes(SENTINEL + k));
    if (hit) leaks.push(`${r.m} ${r.p} → the value of ${hit}`);
    /* a whole env serialized shows up as its bindings' names, keyed */
    if (json) {
      const keys = new Set();
      const walk = (v, depth) => {
        if (!v || typeof v !== 'object' || depth > 4) return;
        if (Array.isArray(v)) { v.slice(0, 5).forEach((x) => walk(x, depth + 1)); return; }
        for (const k of Object.keys(v)) { keys.add(k); walk(v[k], depth + 1); }
      };
      walk(json, 0);
      const named = BINDINGS.filter((b) => keys.has(b));
      if (named.length >= 3) leaks.push(`${r.m} ${r.p} → the bindings ${named.slice(0, 4).join(', ')}`);
    }
  }
  assert.deepEqual(leaks, [], 'a handler put the env (or a piece of it) in its answer');
  net.restore();
});

test('the recent list is a LIST of posts — the shape the leak destroyed', async () => {
  const { status, json } = await call(worker, env, 'GET', '/api/comments/recent');
  assert.equal(status, 200);
  assert.ok(Array.isArray(json.items), 'items is an array of rows, never one object');
  /* the enrichment the handler is there to do, on whatever rows the ledger holds */
  for (const it of json.items) {
    assert.ok('id' in it && 'author_hash' in it, 'a row of the forum, not something else');
    assert.ok('assigned' in it, 'each row carries its author\'s assigned pseudonym');
  }
});

/* the house spelling (tests/worker/merecat.test.mjs): a law is about code, and
   a comment that quotes the bug must not read as the bug */
const uncommented = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/.*$/gm, '$1');

test('withNames is never handed the env: it maps a ROW, and its first argument says so', () => {
  const bad = [];
  for (const f of ['lib.ts', 'db.ts', 'index.ts', 'routes/board.ts', 'routes/wall.ts',
    'routes/dm.ts', 'routes/profile.ts', 'routes/admin.ts', 'routes/merecat.ts']) {
    const src = uncommented(readFileSync(join(root, 'comments-worker', 'src', f), 'utf8'));
    for (const m of src.matchAll(/withNames\(\s*([A-Za-z_$][\w$]*)/g)) {
      if (m[1] === 'env') bad.push(`${f}: withNames(env, …)`);
    }
  }
  assert.deepEqual(bad, [], 'withNames(row, posts) maps one row; handing it `env` copies the bindings into the answer');
});
