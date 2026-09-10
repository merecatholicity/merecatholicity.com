/* The librarian's AI budget guard (comments-worker/src/quota.ts).
 *
 * The rule the guard must keep: read the account's Workers AI meter, rest
 * merecat at the admin's line, and never let a monitor outage take the
 * librarian down. Driven here with a stubbed fetch — the module has no worker
 * imports on purpose — so the cache, the stale window, the backoff and the
 * fail-open are proven as behaviour, not read as text.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  merecatQuota, quotaPublic, quotaCache, aiNeuronsSelect, fetchAiNeurons,
  QUOTA_FRESH_MS, QUOTA_STALE_MS, QUOTA_FETCH_TIMEOUT_MS,
} from '../../comments-worker/src/quota.ts';
import { FREE } from '../../comments-worker/src/usagecalc.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ENV = { CF_USAGE_TOKEN: 't', CF_ACCOUNT_ID: 'a' };
const CFG = { quota_guard_on: 1, quota_guard_pct: 95 };
const T0 = Date.UTC(2026, 8, 10, 4, 15, 9);   // 2026-09-10T04:15:09Z: 20 h to the renewal

/* A fetch that answers the neurons dataset with `neurons` spent (null = the
   analytics API is down), counting calls and keeping the last query. */
let calls = 0;
let answer = null;
let lastQuery = '';
function stubFetch(neurons) {
  calls = 0; answer = neurons;
  globalThis.fetch = async (url, init) => {
    calls++;
    lastQuery = JSON.parse(init.body).query;
    if (answer == null) throw new Error('analytics down');
    return { status: 200, json: async () => ({ data: { viewer: { accounts: [{ aiInferenceAdaptiveGroups: [
      { dimensions: { modelId: '@cf/qwen/qwen3-30b-a3b-fp8' }, sum: { totalNeurons: answer } }] }] } } }) };
  };
}
const realLog = console.log;
const quiet = () => { console.log = () => {}; };   // the unread log line is not the test's output
beforeEach(() => { quotaCache.reading = null; quotaCache.failedAt = 0; console.log = realLog; });

test('off means no meter read and never resting; unconfigured means the same, and says so', async () => {
  stubFetch(9999);
  const off = await merecatQuota(ENV, { quota_guard_on: 0, quota_guard_pct: 95 }, T0);
  assert.equal(off.on, false); assert.equal(off.resting, false); assert.equal(calls, 0);
  const bare = await merecatQuota({}, CFG, T0);
  assert.equal(bare.configured, false); assert.equal(bare.resting, false); assert.equal(calls, 0);
  assert.equal(bare.reset_in_h, 20, 'the hours ride even when the meter cannot');
  assert.match(bare.note, /in about 20 hours/);
});

test('at the line the librarian rests, admins or not — the view knows no caller at all', async () => {
  stubFetch(9500);
  const v = await merecatQuota(ENV, CFG, T0);
  assert.equal(v.configured, true);
  assert.equal(v.used, 9500); assert.equal(v.limit, FREE.aiNeuronsDay); assert.equal(v.meter_pct, 95);
  assert.equal(v.resting, true);
  assert.equal(v.reset_in_h, 20);
  assert.equal(calls, 1);
  assert.equal(merecatQuota.length, 2, 'env and cfg, no identity and no admin flag: the guard binds everyone');
  assert.match(lastQuery, /aiInferenceAdaptiveGroups/, 'the guard reads the neurons dataset');
  assert.doesNotMatch(lastQuery, /workersInvocationsAdaptive|d1AnalyticsAdaptiveGroups/, '...and nothing else');
});

test('below the line it answers; the admin\'s line is read through the kernel', async () => {
  stubFetch(9850);
  assert.equal((await merecatQuota(ENV, CFG, T0)).resting, true, '98.5% rests at a 95 line');
  quotaCache.reading = null;
  assert.equal((await merecatQuota(ENV, { quota_guard_on: 1, quota_guard_pct: 99 }, T0)).resting, false, '...but not at a 99 line');
  quotaCache.reading = null;
  const v = await merecatQuota(ENV, { quota_guard_on: 1, quota_guard_pct: '150' }, T0);
  assert.equal(v.pct, 99, 'a line past the wall clamps to 99');
});

test('one reading answers every ask for a minute, then a fresh one is taken', async () => {
  stubFetch(1000);
  await merecatQuota(ENV, CFG, T0);
  await merecatQuota(ENV, CFG, T0 + QUOTA_FRESH_MS - 1);
  assert.equal(calls, 1, 'within the minute the cache answers');
  answer = 9700;
  const v = await merecatQuota(ENV, CFG, T0 + QUOTA_FRESH_MS);
  assert.equal(calls, 2, 'at the minute a fresh read is taken');
  assert.equal(v.resting, true, '...and the fresh figure decides');
});

test('a failed read keeps a reading up to fifteen minutes old, marked stale, and backs off a minute', async () => {
  quiet();
  stubFetch(9600);
  await merecatQuota(ENV, CFG, T0);
  answer = null;   // the analytics API goes down
  const v = await merecatQuota(ENV, CFG, T0 + 2 * QUOTA_FRESH_MS);
  assert.equal(calls, 2, 'a fresh read was attempted');
  assert.equal(v.stale, true); assert.equal(v.resting, true, 'the old reading still guards');
  assert.equal(v.unread, false);
  await merecatQuota(ENV, CFG, T0 + 2 * QUOTA_FRESH_MS + 1000);
  assert.equal(calls, 2, 'no retry inside the backoff minute: a dead API costs one timeout, not one per ask');
  const late = await merecatQuota(ENV, CFG, T0 + QUOTA_STALE_MS + 1);
  assert.equal(calls, 3, 'after the backoff a read is tried again');
  assert.equal(late.unread, true); assert.equal(late.resting, false, 'past the stale window with no read, the guard stands open');
});

test('with no reading at all the guard stands OPEN and says unread: a monitor outage never rests the librarian', async () => {
  quiet();
  stubFetch(null);
  const v = await merecatQuota(ENV, CFG, T0);
  assert.equal(v.unread, true); assert.equal(v.resting, false);
  assert.equal(v.used, null); assert.equal(v.meter_pct, null);
  assert.equal(quotaCache.failedAt, T0, 'the failure is remembered for the backoff');
});

test('the member-facing slice carries the day\'s share and the note, never the raw counts', async () => {
  stubFetch(4100);
  const v = await merecatQuota(ENV, CFG, T0);
  const p = quotaPublic(v);
  assert.deepEqual(Object.keys(p).sort(), ['configured', 'meter_pct', 'note', 'on', 'pct', 'reset_in_h', 'resting', 'unread']);
  assert.equal(p.meter_pct, 41); assert.equal(p.resting, false); assert.equal(p.pct, 95);
});

test('the guard and the health bar read the same dataset, aggregated by the same rulebook', async () => {
  const usage = readFileSync(join(root, 'comments-worker', 'src', 'usage.ts'), 'utf8');
  assert.ok(/ai: aiNeuronsSelect\(day\),/.test(usage), 'usage.ts must take its AI select from quota.ts');
  assert.ok(!/aiInferenceAdaptiveGroups/.test(usage), 'no second copy of the query');
  assert.match(aiNeuronsSelect('2026-09-10T00:00:00Z'), /^aiInferenceAdaptiveGroups\(limit: 1000, filter: \{datetime_geq: "2026-09-10T00:00:00Z"\}\)/);
  stubFetch(1234.56);
  const r = await fetchAiNeurons(ENV, T0);
  assert.equal(r.used, 1234.6, 'rounded as the health bar rounds');
  assert.equal(r.limit, FREE.aiNeuronsDay);
  assert.ok(QUOTA_FETCH_TIMEOUT_MS <= 5000, 'an ask never waits long on the meter');
});
