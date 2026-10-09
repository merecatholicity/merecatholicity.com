/* The page keeps the wire's promise (Domain.Wire, 2026-09-17): an answer whose
 * listed field is neither a list nor null is refused before a view reads it.
 *
 * What would break silently: for six weeks the Recent activity view read an
 * `items` OBJECT as "Nothing here yet" — `d.items.length` is undefined, and
 * undefined reads as empty. Three seams keep the promise: the membrane's
 * `wireBroken` (app/core.ts, over the kernel), the shell's fetch wrapper
 * (app/wirecheck.ts — every /api read, classic or Lit, the store's included:
 * a malformed answer is never cached). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as Core from '../../app/core.ts';
import { wireChecked, installWireCheck, MALFORMED } from '../../app/wirecheck.ts';
import { fetchJson, invalidate, peek, keyFor } from '../../app/store.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const leaked = { ok: true, items: { TURNSTILE_SECRET: 'x', DB: {} }, page: 1, more: false };

test('wireBroken names a listed field that is neither a list nor null, and nothing else', () => {
  assert.deepEqual(Core.wireBroken('GET', '/api/comments/recent', leaked), ['items']);
  assert.deepEqual(Core.wireBroken('GET', 'https://merecatholicity.com/api/comments/recent/?p=2&fresh=1', leaked), ['items'],
    'absolute, with a trailing slash and a query');
  assert.deepEqual(Core.wireBroken('get', '/api/comments/recent', leaked), ['items'], 'the method in any case');
  assert.deepEqual(Core.wireBroken('GET', '/api/comments/recent', { ok: true, items: [] }), []);
  assert.deepEqual(Core.wireBroken('GET', '/api/comments/recent', { ok: true, items: null }), [], 'null is a quirk, not a broken promise');
  assert.deepEqual(Core.wireBroken('GET', '/api/comments/recent', { ok: true }), [], 'absent likewise');
  assert.deepEqual(Core.wireBroken('GET', '/api/comments/recent', { ok: false, error: 'Too many requests.', items: 'x' }), [], 'a refusal promises nothing');
  assert.deepEqual(Core.wireBroken('POST', '/api/comments/recent', leaked), [], 'the method is part of the route');
  assert.deepEqual(Core.wireBroken('GET', '/api/comments/board', { ok: true, cats: 'x' }), [], 'an unlisted field');
  assert.deepEqual(Core.wireBroken('POST', '/api/comments/dm/thread', { ok: true, messages: 'x' }), ['messages']);
  for (const odd of [null, undefined, 'text', 5, [1, 2]]) assert.deepEqual(Core.wireBroken('GET', '/api/comments/recent', odd), []);
});

const response = (body) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });

test('the wrapped json() rejects a broken answer, resolves a sound one, and leaves every other URL alone', async () => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    await assert.rejects(wireChecked(response(leaked), 'GET', '/api/comments/recent?p=1').json(), new RegExp(MALFORMED));
    assert.deepEqual(await wireChecked(response({ ok: true, items: [] }), 'GET', '/api/comments/recent').json(), { ok: true, items: [] });
    assert.deepEqual(await wireChecked(response(leaked), 'GET', '/version.json').json(), leaked, 'not the worker');
    assert.deepEqual(await wireChecked(response(leaked), 'GET', 'https://files.merecatholicity.com/recent').json(), leaked);
  } finally { console.warn = warn; }
});

test('the shell wraps fetch once, reading the method and URL from init or from a Request', async () => {
  const seen = [];
  const w = { fetch: async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    seen.push([url, init && init.method]);
    return response(url.includes('/dm/thread') ? { ok: true, messages: { not: 'a list' } } : leaked);
  } };
  installWireCheck(w);
  const once = w.fetch;
  installWireCheck(w);
  assert.equal(w.fetch, once, 'installed once');
  const warn = console.warn;
  console.warn = () => {};
  try {
    await assert.rejects((await w.fetch('/api/comments/recent')).json(), new RegExp(MALFORMED));
    const r = await w.fetch(new Request('https://merecatholicity.com/api/comments/recent', { method: 'POST', body: '{}' }));
    assert.deepEqual(await r.json(), leaked, 'a POST to the same path is another route');
    await assert.rejects((await w.fetch('/api/comments/dm/thread', { method: 'POST', body: '{}' })).json());
  } finally { console.warn = warn; }
  assert.equal(seen.length, 3, 'every call reached the real fetch');
});

test('the store refuses a broken answer through the wrapped json() and never caches it', async () => {
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  invalidate();
  let calls = 0;
  const warn = console.warn;
  console.warn = () => {};
  try {
    const fetcher = (url, init) => { calls++; return wireChecked(response(leaked), (init && init.method) || 'GET', url); };
    await assert.rejects(fetchJson(fetcher, '/api/comments/recent', undefined, { ttl: 60000 }), new RegExp(MALFORMED));
    assert.equal(peek(keyFor('/api/comments/recent')), null, 'nothing cached');
    await assert.rejects(fetchJson(fetcher, '/api/comments/recent', undefined, { ttl: 60000 }));
    assert.equal(calls, 2, 'asked again, since nothing was kept');
    const sound = (url) => wireChecked(response({ ok: true, items: [{ id: 1 }] }), 'GET', url);
    assert.deepEqual(await fetchJson(sound, '/api/comments/recent', undefined, { ttl: 60000 }), { ok: true, items: [{ id: 1 }] });
  } finally { console.warn = warn; }
});

test('the shell installs the wrapper right after it publishes the kernel', () => {
  const shell = readFileSync(join(root, 'app', 'shell.ts'), 'utf8');
  assert.match(shell, /window\.mcCore = core;\n[^\n]*\ninstallWireCheck\(window\);/);
});
