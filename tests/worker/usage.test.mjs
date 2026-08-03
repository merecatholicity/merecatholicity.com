/* The free-tier usage monitor's rulebook (comments-worker/src/usagecalc.ts).
 * Locks the R2 billing-class map, the UTC quota windows, the health bands, the
 * report aggregation (fed synthetic rows in the EXACT shapes the GraphQL
 * Analytics API answered live on 2026-08-03), and the daily check's speak/stay-
 * quiet fold: escalations at once, standing warnings weekly, below-80 forgotten
 * so a later re-cross alerts fresh. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FREE, PRODUCT_LABELS, classifyR2, r2Known, d1Name,
  utcDayStart, utcMonthStart, iso, bandFor,
  buildReport, foldUsageAlerts, worstPct, alertBody, ALERT_RENAG_SECS,
} from '../../comments-worker/src/usagecalc.ts';

test('R2 billing classes: the published map, deletes free, the unknown counts as A', () => {
  assert.equal(classifyR2('PutObject'), 'a');
  assert.equal(classifyR2('ListObjects'), 'a');
  assert.equal(classifyR2('CreateMultipartUpload'), 'a');
  assert.equal(classifyR2('GetObject'), 'b');
  assert.equal(classifyR2('HeadBucket'), 'b');
  assert.equal(classifyR2('HeadObject'), 'b');
  assert.equal(classifyR2('DeleteObject'), 'free');
  assert.equal(classifyR2('AbortMultipartUpload'), 'free');
  // a Cloudflare op we have never heard of must land on the TIGHTER meter,
  // so novelty can only make the bar read worse, never hide usage
  assert.equal(classifyR2('FrobnicateBucket'), 'a');
  assert.equal(r2Known('FrobnicateBucket'), false);
  assert.equal(r2Known('PutObject'), true);
});

test('quota windows are UTC: day and calendar month, ISO without millis', () => {
  const now = Date.UTC(2026, 7, 3, 15, 42, 11, 123); // 2026-08-03T15:42:11.123Z
  assert.equal(iso(utcDayStart(now)), '2026-08-03T00:00:00Z');
  assert.equal(iso(utcMonthStart(now)), '2026-08-01T00:00:00Z');
  // first instant of a month stays in that month
  assert.equal(iso(utcMonthStart(Date.UTC(2026, 7, 1, 0, 0, 0))), '2026-08-01T00:00:00Z');
});

test('health bands: ok < 60 <= watch < 80 <= hot < 100 <= over; no limit = na', () => {
  assert.equal(bandFor(null), 'na');
  assert.equal(bandFor(0), 'ok');
  assert.equal(bandFor(59.9), 'ok');
  assert.equal(bandFor(60), 'watch');
  assert.equal(bandFor(79.9), 'watch');
  assert.equal(bandFor(80), 'hot');
  assert.equal(bandFor(99.9), 'hot');
  assert.equal(bandFor(100), 'over');
  assert.equal(bandFor(250), 'over');
});

/* Synthetic raw in the live-observed shapes. */
function liveish() {
  return {
    workers: { workersInvocationsAdaptive: [
      { dimensions: { scriptName: 'merecatholicity-comments' }, sum: { requests: 3987 } },
      { dimensions: { scriptName: 'merecatholicity-contact' }, sum: { requests: 3 } },
    ] },
    ai: { aiInferenceAdaptiveGroups: [
      { dimensions: { modelId: '@cf/meta/llama-guard-3-8b' }, sum: { totalNeurons: 1076.639352743199 } },
      { dimensions: { modelId: '@cf/qwen/qwen3-30b-a3b-fp8' }, sum: { totalNeurons: 148.56771121546626 } },
    ] },
    d1: {
      d1AnalyticsAdaptiveGroups: [
        { dimensions: { databaseId: 'af00d34a-c1bc-46a3-b51f-1a2fdfec3eb8' }, sum: { rowsRead: 238574, rowsWritten: 1729 } },
        { dimensions: { databaseId: 'c21d00ec-55d3-4288-b462-a373315f95e7' }, sum: { rowsRead: 45795, rowsWritten: 33 } },
      ],
      d1StorageAdaptiveGroups: [
        { dimensions: { databaseId: 'a75f874a-7922-426c-be74-c479f268006e' }, max: { databaseSizeBytes: 424861700 } },
        { dimensions: { databaseId: 'af00d34a-c1bc-46a3-b51f-1a2fdfec3eb8' }, max: { databaseSizeBytes: 610304 } },
      ],
    },
    r2: {
      r2OperationsAdaptiveGroups: [
        { dimensions: { actionType: 'PutObject', bucketName: 'merecatholicity-wall-media' }, sum: { requests: 8 } },
        { dimensions: { actionType: 'GetObject', bucketName: 'merecatholicity-avatars' }, sum: { requests: 100 } },
        { dimensions: { actionType: 'DeleteObject', bucketName: 'merecatholicity-dm-media' }, sum: { requests: 5 } },
        { dimensions: { actionType: 'MysteryOp', bucketName: 'merecatholicity-backups' }, sum: { requests: 2 } },
      ],
      r2StorageAdaptiveGroups: [
        { dimensions: { bucketName: 'merecatholicity-audio' }, max: { payloadSize: 3546112445, metadataSize: 34481 } },
        { dimensions: { bucketName: 'merecatholicity-avatars' }, max: { payloadSize: 5000000, metadataSize: 1000 } },
      ],
    },
    do: {
      durableObjectsInvocationsAdaptiveGroups: [{ sum: { requests: 2204 } }],
      durableObjectsPeriodicGroups: [{ sum: { activeTime: 175850155, storageReadUnits: 12, storageWriteUnits: 3 } }],
      durableObjectsSqlStorageGroups: [{ max: { storedBytes: 245760 } }],
    },
    vectorize: {
      vectorizeV2QueriesAdaptiveGroups: [{ sum: { queriedVectorDimensions: 134144 } }],
      vectorizeV2StorageAdaptiveGroups: [{ max: { storedVectorDimensions: 3955712 } }],
    },
    turn: { callsTurnUsageAdaptiveGroups: [{ sum: { egressBytes: 357360 } }] },
    turnstile: { turnstileAdaptiveGroups: [{ count: 242 }] },
  };
}
const byId = (rows, id) => rows.find((r) => r.id === id);

test('buildReport: totals, detail, and percentages are plain arithmetic over the rows', () => {
  const rows = buildReport(liveish());
  const w = byId(rows, 'workers.requests');
  assert.equal(w.used, 3990);
  assert.equal(w.limit, FREE.workersRequestsDay);
  assert.equal(w.pct, 4);
  assert.equal(w.band, 'ok');
  assert.equal(w.detail[0].label, 'merecatholicity-comments', 'detail sorts biggest first');

  const ai = byId(rows, 'ai.neurons');
  assert.equal(ai.used, 1225.2, 'float neurons round to one decimal');

  const dr = byId(rows, 'd1.rows_read');
  assert.equal(dr.used, 238574 + 45795);
  assert.equal(dr.detail[0].label, 'merecatholicity-comments', 'database ids resolve to names');
  const dw = byId(rows, 'd1.rows_written');
  assert.equal(dw.used, 1762);

  const ds = byId(rows, 'd1.storage');
  assert.equal(ds.used, 424861700 + 610304);
  const deep = ds.detail.find((d) => d.label === 'merecat-library-deep');
  assert.equal(deep.limit, FREE.d1PerDbBytes, 'each database carries its own 500 MB wall');
  assert.equal(deep.pct, 85, '424.9 MB of 500 MB');

  const ra = byId(rows, 'r2.class_a');
  assert.equal(ra.used, 10, 'PutObject 8 + the unknown op 2; deletes and reads excluded');
  assert.match(ra.note, /MysteryOp/, 'unrecognized ops are named, not silent');
  const rb = byId(rows, 'r2.class_b');
  assert.equal(rb.used, 100);
  const rs = byId(rows, 'r2.storage');
  assert.equal(rs.used, 3546112445 + 34481 + 5000000 + 1000, 'payload + metadata both count');

  const dur = byId(rows, 'do.duration');
  assert.equal(dur.used, 21.98, '175850155 µs awake × 128 MB = GB-s');
  assert.equal(byId(rows, 'do.requests').used, 2204);
  assert.equal(byId(rows, 'do.rows_read').used, 12);
  assert.equal(byId(rows, 'do.storage').used, 245760);

  assert.equal(byId(rows, 'vectorize.stored').used, 3955712);
  assert.equal(byId(rows, 'vectorize.stored').pct, 79.1, 'the ~4,880-vector budget reads true');
  assert.equal(byId(rows, 'turn.egress').used, 357360);

  const ts = byId(rows, 'turnstile.solves');
  assert.equal(ts.limit, null);
  assert.equal(ts.pct, null);
  assert.equal(ts.band, 'na', 'unmetered rows carry no bar');

  const cron = byId(rows, 'cron.triggers');
  assert.equal(cron.used, FREE.cronsUsed);
  assert.equal(cron.limit, FREE.cronsLimit);
});

test('buildReport: one failed product costs one card, never the report', () => {
  const raw = liveish();
  raw.vectorize = { error: 'token missing Vectorize scope' };
  delete raw.turn; // a product that never answered at all
  const rows = buildReport(raw);
  const v = byId(rows, 'vectorize.stored');
  assert.equal(v.error, 'token missing Vectorize scope');
  assert.equal(v.pct, undefined, 'an error row carries no percentage');
  assert.equal(byId(rows, 'turn.egress').error, 'unavailable');
  assert.equal(byId(rows, 'workers.requests').used, 3990, 'the rest of the report stands');
});

test('every report row belongs to a labeled product group', () => {
  for (const r of buildReport(liveish())) {
    assert.ok(PRODUCT_LABELS[r.product], r.id + ' -> ' + r.product);
  }
});

function rowAt(pct, id = 'r2.storage') {
  return { id, product: 'r2', label: 'Stored bytes', used: 1, limit: 100, unit: 'bytes', period: 'total', pct, band: bandFor(pct) };
}

test('the daily check speaks on first crossing and on escalation, at once', () => {
  const t0 = 1_800_000_000;
  const fresh = foldUsageAlerts([rowAt(85)], {}, t0);
  assert.equal(fresh.alerts.length, 1, 'a new 80%+ warning speaks');
  assert.deepEqual(fresh.state['r2.storage'], { b: 1, at: t0 });
  const esc = foldUsageAlerts([rowAt(104)], fresh.state, t0 + 86400);
  assert.equal(esc.alerts.length, 1, 'hot -> over escalates immediately');
  assert.equal(esc.state['r2.storage'].b, 2);
});

test('a standing warning stays quiet for a week, then repeats', () => {
  const t0 = 1_800_000_000;
  const state = { 'r2.storage': { b: 1, at: t0 } };
  const day2 = foldUsageAlerts([rowAt(86)], state, t0 + 86400);
  assert.equal(day2.alerts.length, 0, 'the same warning does not nag daily');
  assert.equal(day2.state['r2.storage'].at, t0, 'the old stamp stands so the week matures');
  const day8 = foldUsageAlerts([rowAt(86)], state, t0 + ALERT_RENAG_SECS);
  assert.equal(day8.alerts.length, 1, 'a week on, the standing warning repeats');
  assert.equal(day8.state['r2.storage'].at, t0 + ALERT_RENAG_SECS);
});

test('dropping below 80 forgets the metric, so a later re-cross alerts fresh', () => {
  const t0 = 1_800_000_000;
  const state = { 'r2.storage': { b: 2, at: t0 } };
  const calm = foldUsageAlerts([rowAt(42)], state, t0 + 86400);
  assert.equal(calm.alerts.length, 0);
  assert.equal(calm.state['r2.storage'], undefined, 'below the line the memory clears');
  const again = foldUsageAlerts([rowAt(81)], calm.state, t0 + 2 * 86400);
  assert.equal(again.alerts.length, 1, 're-crossing after a calm spell speaks again');
});

test('error rows and unmetered rows never alert', () => {
  const t0 = 1_800_000_000;
  const rows = [
    { id: 'x.err', product: 'r2', label: 'broken', error: 'nope', pct: 120 },
    { id: 'x.na', product: 'turnstile', label: 'solves', used: 5, limit: null, pct: null },
  ];
  const out = foldUsageAlerts(rows, {}, t0);
  assert.equal(out.alerts.length, 0);
  assert.deepEqual(out.state, {});
});

test('worstPct and the DM body', () => {
  const rows = [rowAt(42, 'a'), rowAt(91.5, 'b'), rowAt(null, 'c')];
  assert.equal(worstPct(rows), 91.5);
  const body = alertBody([rowAt(91.5)], 'https://merecatholicity.com');
  assert.match(body, /1 meter needs attention/);
  assert.match(body, /R2 storage — Stored bytes: 91\.5% of the free tier/);
  assert.match(body, /https:\/\/merecatholicity\.com\/admin\.html\?usage=1/);
  const two = alertBody([rowAt(91.5), rowAt(101, 'd')], 'https://x');
  assert.match(two, /2 meters need attention/);
});
