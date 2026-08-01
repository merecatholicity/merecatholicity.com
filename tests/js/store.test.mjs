/* app/store.js — the client-side read store: a fetch-through memo with TTLs,
   in-flight dedup, and write-through invalidation. This is half of the free-tier
   budget law (rapid view hops render from memory instead of drawing keyed reads
   from the shared bucket), so its cache/dedup/invalidate behaviour is worth
   pinning. The transport is INJECTED, so these tests touch no network. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchJson, invalidate, metrics } from '../../app/store.ts';

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
