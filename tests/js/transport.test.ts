/* app/transport.ts — the read transport, out of the boot (the write-path port's
 * P1, 2026-09-17). Two of the rules it carries break SILENTLY, so they are
 * swept here rather than left to review:
 *
 *  1. ONE STORE. client/ and app/ are separate esbuild graphs (two entries in
 *     package.json's build:js / build:client). A static import of app/store.ts
 *     — or of app/transport.ts, which imports it — from anywhere under client/
 *     bundles a SECOND copy of the cache into docs/comments.js. Nothing throws;
 *     the two caches simply never invalidate each other, and the symptom is a
 *     stale read weeks later. The classic client must reach this module through
 *     window.mcTransport, which is why the delegating helpers exist.
 *  2. NEVER CAPTURE `fetch`. The shell installs a wrapper over window.fetch
 *     (app/wirecheck.ts: an /api/ answer whose listed field is neither a list
 *     nor null makes json() reject). A module-level `const f = fetch` would
 *     freeze the unwrapped one and quietly opt every read out of the check.
 *
 * The behaviour below is the ladder the classic client shipped for years,
 * moved verbatim; these assertions are what "verbatim" means. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as transport from '../../app/transport.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const clientFiles = readdirSync(join(root, 'client')).filter((f) => f.endsWith('.ts'));

test('no file under client/ imports a RUNTIME value from the app bundle — one store, one cache', () => {
  const bad = [];
  for (const f of clientFiles) {
    const src = readFileSync(join(root, 'client', f), 'utf8');
    /* Any static import that climbs out of client/ into app/. `import type` is
       fine and is used (client/dm-inbox.ts takes DmThreadsRow from app/wire.ts,
       which declares no runtime value at all): a type import is erased before
       esbuild sees it, so it bundles nothing. A VALUE import is the bug. */
    for (const m of src.matchAll(/^\s*import\s+(type\s+)?[^;]*?from\s*['"]([^'"]+)['"]/gm)) {
      if (!m[1] && /(^|\/)\.\.\/app\//.test(m[2])) bad.push(f + ' -> ' + m[2]);
    }
  }
  assert.deepEqual(bad, [], 'client/ must reach the shell through window.*, never by value import — '
    + 'one here bundles a second app/store.ts into docs/comments.js, and two caches that never '
    + 'invalidate each other have no symptom until a stale read: ' + bad.join(', '));
});

test('app/wire.ts stays types-only, which is what makes that one import safe', () => {
  const src = readFileSync(join(root, 'app', 'wire.ts'), 'utf8');
  const values = [...src.matchAll(/^export\s+(const|function|class|let|var)\s+([A-Za-z_$][\w$]*)/gm)];
  assert.deepEqual(values.map((m) => m[2]), [],
    'app/wire.ts gained a runtime export — client/dm-inbox.ts imports from it, and a value there '
    + 'would start pulling the app graph into docs/comments.js');
});

test('app/transport.ts calls fetch, and never captures it', () => {
  const src = readFileSync(join(root, 'app', 'transport.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
  assert.match(src, /\bfetch\(/, 'transport must actually call fetch');
  /* an alias of the global: `= fetch`, `= window.fetch`, `= globalThis.fetch` */
  assert.doesNotMatch(src, /=\s*(window\.|globalThis\.)?fetch\s*[;,)]/,
    'transport captured a fetch reference — the shell wrapper (app/wirecheck.ts) would be bypassed');
});

test('fetchRetry: an HTTP status is final — the server spoke, so never retry it', async () => {
  let calls = 0;
  globalThis.fetch = () => { calls++; return Promise.resolve({ status: 500, ok: false }); };
  const res = await transport.fetchRetry('/x', undefined, [1, 1]);
  assert.equal(calls, 1, 'a 500 is an answer, not a network failure');
  assert.equal(res.status, 500);
});

test('fetchRetry: a rejected fetch rides the ladder, then gives the reader a sentence', async () => {
  let calls = 0;
  const seen = [];
  globalThis.fetch = () => { calls++; return Promise.reject(new Error('offline')); };
  await assert.rejects(
    transport.fetchRetry('/x', undefined, [1, 1], () => seen.push(calls)),
    /Network error\. Check your connection and try again\./);
  assert.equal(calls, 3, 'the first attempt plus one per delay');
  assert.deepEqual(seen, [1, 2], 'onRetry fires before each retry, never after the last failure');
});

test('fetchRetry: a caller that brought its own signal keeps it (no timeout is imposed)', async () => {
  const ctrl = new AbortController();
  let got;
  globalThis.fetch = (_u, init) => { got = init; return Promise.resolve({ ok: true }); };
  await transport.fetchRetry('/x', { signal: ctrl.signal }, []);
  assert.equal(got.signal, ctrl.signal, 'the caller\'s own AbortSignal is passed through untouched');
});

test('freshParam follows the configured key, and asks for nothing without one', () => {
  transport.configure({ key: () => '' });
  assert.equal(transport.freshParam('&'), '', 'an anonymous reader rides the browser cache');
  transport.configure({ key: () => 'MYKEY' });
  assert.equal(transport.freshParam('&'), '&fresh=1');
  assert.equal(transport.freshParam('?'), '?fresh=1', 'the separator is the caller\'s');
});
