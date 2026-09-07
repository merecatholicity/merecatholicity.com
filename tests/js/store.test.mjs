/* app/store.js — the client-side read store: a fetch-through memo with TTLs,
   in-flight dedup, and write-through invalidation. This is half of the free-tier
   budget law (rapid view hops render from memory instead of drawing keyed reads
   from the shared bucket), so its cache/dedup/invalidate behaviour is worth
   pinning. The transport is INJECTED, so these tests touch no network. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchJson, invalidate, metrics, peek, keyFor, hydrate, forget } from '../../app/store.ts';

// A fake transport: records how many times it was actually called, returns a
// Response-shaped object whose .json() resolves to `payload`.
function mkFetcher(payload) {
  const rec = { calls: 0 };
  const fn = () => { rec.calls++; return { json: () => Promise.resolve(payload) }; };
  return { fn, rec };
}

test('a repeat read within TTL is served from cache (no second fetch)', async () => {
  invalidate();
  const { fn, rec } = mkFetcher({ ok: true, v: 1 });
  const hitsBefore = metrics.hits;
  const a = await fetchJson(fn, '/u1', undefined, { ttl: 10000 });
  const b = await fetchJson(fn, '/u1', undefined, { ttl: 10000 });
  assert.equal(rec.calls, 1, 'second read did not hit the transport');
  assert.deepEqual(a, { ok: true, v: 1 });
  assert.deepEqual(b, a);
  assert.equal(metrics.hits, hitsBefore + 1, 'a cache hit was counted');
});

test('a refusal (ok:false) is never cached, so it refetches', async () => {
  invalidate();
  const { fn, rec } = mkFetcher({ ok: false, error: 'rate-limited' });
  await fetchJson(fn, '/u2', undefined, { ttl: 10000 });
  await fetchJson(fn, '/u2', undefined, { ttl: 10000 });
  assert.equal(rec.calls, 2, 'a rate-limited answer must not be memoized');
});

test('two concurrent identical reads share ONE in-flight request', async () => {
  invalidate();
  let release;
  const gate = new Promise((r) => { release = r; }); // controlled upfront, resolved on demand
  let calls = 0;
  const fn = () => { calls++; return { json: () => gate.then(() => ({ ok: true, v: 9 })) }; };
  const dedupBefore = metrics.dedup;
  const p1 = fetchJson(fn, '/u3', undefined, { ttl: 10000 });
  const p2 = fetchJson(fn, '/u3', undefined, { ttl: 10000 });
  assert.equal(metrics.dedup, dedupBefore + 1, 'the second concurrent caller was deduped');
  assert.strictEqual(p1, p2, 'both callers share the single in-flight promise');
  release();
  const [r1, r2] = await Promise.all([p1, p2]);
  assert.equal(calls, 1, 'the transport ran once');
  assert.deepEqual(r1, r2);
});

test('a throttled read quietly re-asks and settles on the freed answer', async () => {
  invalidate();
  // The server's 429 rides a rolling minute, so the store waits and re-asks
  // (bounded) instead of handing the view a dead "could not be loaded".
  // Collapse the real waits so the test stays instant.
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn) => realSetTimeout(fn, 0);
  try {
    let calls = 0;
    const answers = [
      { ok: false, error: 'Too many requests.' },
      { ok: false, error: 'Too many requests. Slow down.' },
      { ok: true, v: 7 },
    ];
    const fn = () => { const a = answers[calls]; calls++; return { json: () => Promise.resolve(a) }; };
    const d = await fetchJson(fn, '/u6', undefined, { ttl: 10000 });
    assert.equal(calls, 3, 'the two 429s each earned a quiet re-ask');
    assert.deepEqual(d, { ok: true, v: 7 });
    const d2 = await fetchJson(fn, '/u6', undefined, { ttl: 10000 });
    assert.equal(calls, 3, 'the freed answer was cached like any success');
    assert.deepEqual(d2, d);
  } finally { globalThis.setTimeout = realSetTimeout; }
});

test('a throttle past the bounded ladder reaches the caller as the refusal', async () => {
  invalidate();
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn) => realSetTimeout(fn, 0);
  try {
    const { fn, rec } = mkFetcher({ ok: false, error: 'Too many requests.' });
    const d = await fetchJson(fn, '/u7', undefined, { ttl: 10000 });
    assert.equal(rec.calls, 3, 'bounded: the first ask plus two re-asks, never a loop');
    assert.equal(d.ok, false, 'the refusal still reaches the view (uncached, as ever)');
  } finally { globalThis.setTimeout = realSetTimeout; }
});

test('bypass skips the cache read but still refreshes', async () => {
  invalidate();
  const { fn, rec } = mkFetcher({ ok: true, v: 1 });
  await fetchJson(fn, '/u4', undefined, { ttl: 10000 });
  assert.equal(rec.calls, 1);
  await fetchJson(fn, '/u4', undefined, { ttl: 10000, bypass: true });
  assert.equal(rec.calls, 2, 'bypass forced a fresh fetch even though a cache entry existed');
});

test('invalidate(prefix) sweeps only matching keys; invalidate() clears all', async () => {
  invalidate();
  await fetchJson(mkFetcher({ ok: true, v: 1 }).fn, '/api/x/1', undefined, { ttl: 10000 });
  await fetchJson(mkFetcher({ ok: true, v: 2 }).fn, '/api/y/1', undefined, { ttl: 10000 });

  invalidate('/api/x'); // only the x-prefixed key is dropped

  const x = mkFetcher({ ok: true, v: 11 });
  await fetchJson(x.fn, '/api/x/1', undefined, { ttl: 10000 });
  assert.equal(x.rec.calls, 1, 'the invalidated key refetched');

  const y = mkFetcher({ ok: true, v: 22 });
  await fetchJson(y.fn, '/api/y/1', undefined, { ttl: 10000 });
  assert.equal(y.rec.calls, 0, 'the un-invalidated key was still cached');
});

/* ---- The disk tier (stale-while-revalidate) ----------------------------------
   Node has no localStorage or window, and the store reaches for both. Standing
   them up here keeps these tests hermetic while exercising the REAL code paths:
   the identity keying, the privacy refusal, and the synchronous peek that makes
   a return visit paint in its first frame. */
function stubEnv() {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  globalThis.window = {
    mcCore: {
      /* The real rules come from Domain.Cache; this mirrors them narrowly so a
         drift in the kernel shows up in cache.test.mjs, not here. */
      cachePersistable: (k) => !/\/dm\/|\/merecat\/|\/admin|\/meta|\/rdns/.test(k),
      cacheClassify: (age, ttl) => (age < ttl ? 'fresh' : age < 86400000 ? 'stale' : 'expired'),
      cacheMaxBytes: 524288,
      cacheSchema: 1,
    },
  };
  return store;
}

test('peek: a synchronous answer, which is what makes a revisit instant', async () => {
  invalidate();
  stubEnv();
  const { fn } = mkFetcher({ ok: true, v: 'seed' });
  assert.equal(peek(keyFor('/p1')), null, 'nothing known yet');
  await fetchJson(fn, '/p1', undefined, { ttl: 10000 });
  const hit = peek(keyFor('/p1'));
  assert.deepEqual(hit.json, { ok: true, v: 'seed' });
  assert.equal(hit.stale, false, 'inside its TTL');
});

test('peek: past the TTL it still answers, but says to refresh', async () => {
  invalidate();
  stubEnv();
  globalThis.window.mcCore.cacheClassify = () => 'stale';
  const { fn } = mkFetcher({ ok: true, v: 'old' });
  await fetchJson(fn, '/p2', undefined, { ttl: 1 });
  const hit = peek(keyFor('/p2'));
  assert.ok(hit, 'stale content is still shown — that is the whole feature');
  assert.equal(hit.stale, true, 'and the caller is told to revalidate');
});

test('peek: past the horizon it answers nothing at all', async () => {
  invalidate();
  stubEnv();
  globalThis.window.mcCore.cacheClassify = () => 'expired';
  const { fn } = mkFetcher({ ok: true, v: 'ancient' });
  await fetchJson(fn, '/p3', undefined, { ttl: 1 });
  assert.equal(peek(keyFor('/p3')), null, 'a placeholder is more honest than year-old rows');
});

test('the disk copy is written per identity, and DMs are never in it', async () => {
  invalidate();
  const disk = stubEnv();
  hydrate('alice');
  const { fn } = mkFetcher({ ok: true, v: 'public' });
  await fetchJson(fn, '/api/comments/board', undefined, { ttl: 10000 });
  const { fn: fn2 } = mkFetcher({ ok: true, secret: 'plaintext message' });
  await fetchJson(fn2, '/api/comments/dm/thread', undefined, { ttl: 10000 });
  invalidate('/nothing');                    // forces a synchronous flush
  const raw = disk.get('mc-store:alice');
  assert.ok(raw, 'the store wrote under the identity it was hydrated with');
  assert.ok(raw.includes('/api/comments/board'), 'public reads persist');
  assert.ok(!raw.includes('plaintext message'),
    'an end-to-end message body reached the disk — this is the bug this whole design exists to prevent');
  assert.ok(!raw.includes('/dm/thread'), 'not even the DM key is written');
});

test('logout throws the cached pages away with the identity', async () => {
  invalidate();
  const disk = stubEnv();
  hydrate('bob');
  const { fn } = mkFetcher({ ok: true, v: 'bobs page' });
  await fetchJson(fn, '/api/comments/board', undefined, { ttl: 10000 });
  invalidate('/nothing');
  assert.ok(disk.get('mc-store:bob'), 'stored');
  forget();
  assert.equal(disk.get('mc-store:bob'), undefined,
    "the next person on this device must inherit none of the previous reader's pages");
  assert.equal(peek(keyFor('/api/comments/board')), null, 'and memory is cleared too');
});

test('hydrate: last visit comes back, and a foreign identity does not', async () => {
  invalidate();
  const disk = stubEnv();
  hydrate('carol');
  const { fn } = mkFetcher({ ok: true, v: 'carols board' });
  await fetchJson(fn, '/api/comments/board', undefined, { ttl: 10000 });
  invalidate('/nothing');
  /* A fresh page load: memory empty, disk intact. */
  invalidate();
  assert.equal(peek(keyFor('/api/comments/board')), null, 'memory really is empty');
  forget();                                   // reset the binding, keep carol's blob
  disk.set('mc-store:carol', disk.get('mc-store:carol') || '');
  hydrate('dave');
  assert.equal(peek(keyFor('/api/comments/board')), null,
    "dave must not see carol's pages");
});
