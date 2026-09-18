/* Free-tier usage math — PURE, node-testable (no worker imports; the fetch/DM
   glue lives in usage.ts, the spec in tests/worker/usage.test.mjs). This is the
   monitor's rulebook: every Cloudflare meter the platform rides, the free-plan
   ceiling of each, how raw GraphQL Analytics rows aggregate into health rows,
   and when the daily check speaks. The ceilings are Cloudflare's PUBLISHED
   free-plan numbers, verified 2026-08-03 against the pricing/limits pages named
   beside each group — when Cloudflare moves a limit, this table is the one
   place to edit (and `asOf` the tell that it aged). */

/* Cloudflare bills in decimal units (a GB is 1e9), so the bars do too. */
export const GB = 1_000_000_000;
export const MB = 1_000_000;

export const FREE = {
  asOf: '2026-08',
  /* Workers: developers.cloudflare.com/workers/platform/limits — the whole
     ACCOUNT shares one daily request pool (both our workers + anything else
     on the account), reset 00:00 UTC. */
  workersRequestsDay: 100_000,
  /* Workers AI: /workers-ai/platform/pricing — 10,000 neurons/day. */
  aiNeuronsDay: 10_000,
  /* D1: /d1/platform/pricing — daily rows, total storage; the per-database
     500 MB wall is the practical one (the librarian rooms have hit it live). */
  d1RowsReadDay: 5_000_000,
  d1RowsWrittenDay: 100_000,
  d1StorageBytes: 5 * GB,
  d1PerDbBytes: 500 * MB,
  /* R2: /r2/pricing — monthly ops split by class, 10 GB-month Standard storage. */
  r2ClassAMonth: 1_000_000,
  r2ClassBMonth: 10_000_000,
  r2StorageBytes: 10 * GB,
  /* Durable Objects: /durable-objects/platform/pricing — daily compute +
     SQLite storage rows/bytes (BoardHub + ChatRoom are SQLite-backed). */
  doRequestsDay: 100_000,
  doDurationGbsDay: 13_000,
  doRowsReadDay: 5_000_000,
  doRowsWrittenDay: 100_000,
  doStorageBytes: 5 * GB,
  /* Vectorize: /vectorize/platform/pricing — monthly queried dims, total
     stored dims (the ~4,880-vector budget at 1024 dims). */
  vecQueriedDimsMonth: 30_000_000,
  vecStoredDims: 5_000_000,
  /* Realtime TURN: 1,000 GB/month relayed egress free, then billed per GB
     with no cap (why calls_turn is a kill switch). Only the relayed leg —
     P2P/STUN calls cost nothing. */
  turnEgressBytesMonth: 1000 * GB,
  /* Cron triggers: 5 per account on free; this worker holds four (the hourly
     sweeps, the 03:15 daily backup + self-check, the 23:30 usage check +
     self-check, the monthly housekeeping) — 2026-09-16. */
  cronsUsed: 4,
  cronsLimit: 5,
};

/* Group headers, served with the report so the client never grows its own copy. */
export const PRODUCT_LABELS: Record<string, string> = {
  workers: 'Workers',
  ai: 'Workers AI',
  d1: 'D1 databases',
  do: 'Durable Objects',
  r2: 'R2 storage',
  vectorize: 'Vectorize',
  turn: 'Realtime TURN (voice calls)',
  turnstile: 'Turnstile',
  cron: 'Cron triggers',
};

/* R2 billing classes, from /r2/pricing. Deletes and aborts are free. An action
   we have never heard of counts toward CLASS A (the tighter meter) so a new
   Cloudflare op type can only ever make the bar read worse, not hide usage. */
const R2_A = new Set([
  'ListBuckets', 'PutBucket', 'ListObjects', 'PutObject', 'CopyObject',
  'CompleteMultipartUpload', 'CreateMultipartUpload', 'LifecycleStorageTierTransition',
  'ListMultipartUploads', 'UploadPart', 'UploadPartCopy', 'ListParts',
  'PutBucketEncryption', 'PutBucketCors', 'PutBucketLifecycleConfiguration',
]);
const R2_B = new Set([
  'HeadBucket', 'HeadObject', 'GetObject', 'UsageSummary',
  'GetBucketEncryption', 'GetBucketLocation', 'GetBucketCors', 'GetBucketLifecycleConfiguration',
]);
const R2_FREE = new Set(['DeleteObject', 'DeleteBucket', 'AbortMultipartUpload']);
export function classifyR2(action: string): 'a' | 'b' | 'free' {
  if (R2_A.has(action)) return 'a';
  if (R2_B.has(action)) return 'b';
  if (R2_FREE.has(action)) return 'free';
  return 'a';
}
export function r2Known(action: string): boolean {
  return R2_A.has(action) || R2_B.has(action) || R2_FREE.has(action);
}

/* The bindings' database ids (wrangler.jsonc) -> readable names, so the D1
   detail rows speak. An unknown id (some future database) passes through as
   its short id rather than being hidden. */
export const D1_NAMES: Record<string, string> = {
  'af00d34a-c1bc-46a3-b51f-1a2fdfec3eb8': 'merecatholicity-comments',
  'c21d00ec-55d3-4288-b462-a373315f95e7': 'merecat-library',
  'a75f874a-7922-426c-be74-c479f268006e': 'merecat-library-deep',
  '98e30c6d-dacf-4c6b-8417-ee6ad176c9a2': 'merecat-library-deep2',
};
export function d1Name(id: string): string {
  return D1_NAMES[id] || (id ? id.slice(0, 8) + '…' : 'unknown');
}

/* UTC windows: daily quotas reset 00:00 UTC, monthly ones on the calendar
   month. ISO without milliseconds, the form the GraphQL filters take. */
export function utcDayStart(nowMs: number): number {
  const d = new Date(nowMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}
export function utcMonthStart(nowMs: number): number {
  const d = new Date(nowMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}
/* Turnstile's dataset is served a WEEK at a time: the account answers a wider
   filter with "cannot request a time range wider than 1w1h" and the card reads
   "unavailable" — which it did from the 8th of every month until 2026-09-17,
   because the query asked for the calendar month like its neighbours. Six days
   back from today's 00:00 UTC spans at most 6 d 23 h 59 m to now, an hour
   inside the cap. */
export const TURNSTILE_WINDOW_DAYS = 7;
export function turnstileWindowStart(nowMs: number): number {
  return utcDayStart(nowMs) - (TURNSTILE_WINDOW_DAYS - 1) * 86400000;
}
export function iso(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/* Health bands. The bar's color and the alert thresholds are the SAME scale:
   the daily check speaks at hot (80%) and again at over (100%). */
export function bandFor(pct: number | null): string {
  if (pct == null || !isFinite(pct)) return 'na';
  if (pct >= 100) return 'over';
  if (pct >= 80) return 'hot';
  if (pct >= 60) return 'watch';
  return 'ok';
}

type Detail = { label: string; used: number; limit?: number; pct?: number | null };
export type UsageRow = {
  id: string; product: string; label: string;
  used?: number; limit?: number | null; unit?: string;
  period?: 'day' | 'week' | 'month' | 'total'; pct?: number | null; band?: string;
  detail?: Detail[]; note?: string; error?: string;
  /* a count typed into FREE, not a measurement — barred, never alerted */
  declared?: boolean;
};

function row(id: string, product: string, label: string, used: number, limit: number | null,
  unit: string, period: 'day' | 'week' | 'month' | 'total', detail?: Detail[], note?: string): UsageRow {
  const pct = limit ? Math.round((used / limit) * 1000) / 10 : null;
  const r: UsageRow = { id, product, label, used, limit, unit, period, pct, band: bandFor(pct) };
  if (detail && detail.length) r.detail = detail;
  if (note) r.note = note;
  return r;
}
/* The raw answer is Cloudflare's JSON, read through these: a field that is
   missing or of another shape reads as nothing — 0, '' or no rows — and the
   report goes on, where a bare `x.sum.requests` would throw it away. */
type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {});
const at = (v: unknown, ...path: string[]): unknown => path.reduce<unknown>((o, k) => obj(o)[k], v);
const num = (v: unknown) => (typeof v === 'number' && isFinite(v) ? v : 0);
const numAt = (v: unknown, ...path: string[]) => num(at(v, ...path));
const strAt = (v: unknown, ...path: string[]) => { const x = at(v, ...path); return x == null ? '' : String(x); };
const groups = (src: Json, dataset: string): Json[] => { const g = src[dataset]; return Array.isArray(g) ? g.map(obj) : []; };
const sumBy = (rows: Json[], f: (g: Json) => number) => rows.reduce((t, g) => t + num(f(g)), 0);
const desc = (d: Detail[]) => d.sort((a, b) => b.used - a.used);

function errRow(id: string, product: string, label: string, src: unknown): UsageRow {
  return { id, product, label, error: String(obj(src).error || 'unavailable') };
}

/* raw: one entry per product, each either the GraphQL account object (dataset
   name -> rows) or { error } when that fetch failed. Aggregation only — every
   number here is arithmetic over what Cloudflare answered. */
export function buildReport(raw: Json): UsageRow[] {
  const rows: UsageRow[] = [];
  /* a product's account object, or null when it is absent or answered an error */
  const product = (k: string): Json | null => (raw[k] && !obj(raw[k]).error ? obj(raw[k]) : null);

  const w = product('workers');
  if (!w) rows.push(errRow('workers.requests', 'workers', 'Requests today', raw.workers));
  else {
    const g = groups(w, 'workersInvocationsAdaptive');
    rows.push(row('workers.requests', 'workers', 'Requests today',
      sumBy(g, (x) => numAt(x, 'sum', 'requests')), FREE.workersRequestsDay, 'req', 'day',
      desc(g.map((x) => ({ label: strAt(x, 'dimensions', 'scriptName'), used: numAt(x, 'sum', 'requests') }))),
      'Every Worker on the account draws on this one daily pool.'));
  }

  const ai = product('ai');
  if (!ai) rows.push(errRow('ai.neurons', 'ai', 'Neurons today', raw.ai));
  else {
    const g = groups(ai, 'aiInferenceAdaptiveGroups');
    rows.push(row('ai.neurons', 'ai', 'Neurons today',
      Math.round(sumBy(g, (x) => numAt(x, 'sum', 'totalNeurons')) * 10) / 10, FREE.aiNeuronsDay, 'neurons', 'day',
      desc(g.map((x) => ({ label: strAt(x, 'dimensions', 'modelId'), used: Math.round(numAt(x, 'sum', 'totalNeurons') * 10) / 10 }))),
      'Screening (Llama Guard), avatar checks (LLaVA), embeddings, reranking, and cloud-mode merecat all spend from here.'));
  }

  const d1 = product('d1');
  if (!d1) rows.push(errRow('d1.rows_read', 'd1', 'Rows read today', raw.d1));
  else {
    const an = groups(d1, 'd1AnalyticsAdaptiveGroups');
    const st = groups(d1, 'd1StorageAdaptiveGroups');
    rows.push(row('d1.rows_read', 'd1', 'Rows read today',
      sumBy(an, (x) => numAt(x, 'sum', 'rowsRead')), FREE.d1RowsReadDay, 'rows', 'day',
      desc(an.map((x) => ({ label: d1Name(strAt(x, 'dimensions', 'databaseId')), used: numAt(x, 'sum', 'rowsRead') })))));
    rows.push(row('d1.rows_written', 'd1', 'Rows written today',
      sumBy(an, (x) => numAt(x, 'sum', 'rowsWritten')), FREE.d1RowsWrittenDay, 'rows', 'day',
      desc(an.map((x) => ({ label: d1Name(strAt(x, 'dimensions', 'databaseId')), used: numAt(x, 'sum', 'rowsWritten') })))));
    rows.push(row('d1.storage', 'd1', 'Stored bytes',
      sumBy(st, (x) => numAt(x, 'max', 'databaseSizeBytes')), FREE.d1StorageBytes, 'bytes', 'total',
      desc(st.map((x) => {
        const used = numAt(x, 'max', 'databaseSizeBytes');
        return { label: d1Name(strAt(x, 'dimensions', 'databaseId')), used, limit: FREE.d1PerDbBytes,
          pct: Math.round((used / FREE.d1PerDbBytes) * 1000) / 10 };
      })),
      'Each database also has its own 500 MB wall on the free plan — the librarian rooms have hit it before.'));
  }

  const r2 = product('r2');
  if (!r2) rows.push(errRow('r2.storage', 'r2', 'Stored bytes', raw.r2));
  else {
    const ops = groups(r2, 'r2OperationsAdaptiveGroups');
    const st = groups(r2, 'r2StorageAdaptiveGroups');
    let a = 0, b = 0;
    const perA = new Map<string, number>(), perB = new Map<string, number>();
    const strange = new Set<string>();
    for (const g of ops) {
      const action = strAt(g, 'dimensions', 'actionType');
      const bucket = strAt(g, 'dimensions', 'bucketName') || '?';
      const n = numAt(g, 'sum', 'requests');
      const cls = classifyR2(action);
      if (!r2Known(action)) strange.add(action);
      if (cls === 'a') { a += n; perA.set(bucket, (perA.get(bucket) || 0) + n); }
      else if (cls === 'b') { b += n; perB.set(bucket, (perB.get(bucket) || 0) + n); }
    }
    const mapDetail = (m: Map<string, number>) => desc([...m].map(([label, used]) => ({ label, used })));
    const strangeNote = strange.size ? ' Unrecognized op types counted as Class A: ' + [...strange].join(', ') + '.' : '';
    rows.push(row('r2.class_a', 'r2', 'Class A operations this month (writes & lists)',
      a, FREE.r2ClassAMonth, 'ops', 'month', mapDetail(perA),
      'Uploads, lists, and bucket writes. Deletes are free.' + strangeNote));
    rows.push(row('r2.class_b', 'r2', 'Class B operations this month (reads)',
      b, FREE.r2ClassBMonth, 'ops', 'month', mapDetail(perB),
      'Object reads and heads — mostly avatar/media serving that misses the edge cache.'));
    rows.push(row('r2.storage', 'r2', 'Stored bytes',
      sumBy(st, (x) => numAt(x, 'max', 'payloadSize') + numAt(x, 'max', 'metadataSize')), FREE.r2StorageBytes, 'bytes', 'total',
      desc(st.map((x) => ({ label: strAt(x, 'dimensions', 'bucketName'),
        used: numAt(x, 'max', 'payloadSize') + numAt(x, 'max', 'metadataSize') }))),
      'The free tier is 10 GB-month of Standard storage; this bar is the current snapshot. The KJV audio is the fixed resident.'));
  }

  const du = product('do');
  if (!du) rows.push(errRow('do.requests', 'do', 'Requests today', raw.do));
  else {
    const inv = groups(du, 'durableObjectsInvocationsAdaptiveGroups');
    const per = groups(du, 'durableObjectsPeriodicGroups');
    const sql = groups(du, 'durableObjectsSqlStorageGroups');
    rows.push(row('do.requests', 'do', 'Requests today',
      sumBy(inv, (x) => numAt(x, 'sum', 'requests')), FREE.doRequestsDay, 'req', 'day', undefined,
      'Live-forum sockets (BoardHub) and merecat conversations (ChatRoom).'));
    /* activeTime arrives in microseconds; duration bills as GB-seconds at the
       128 MB (1/8 GB) instance size, so GB-s = seconds / 8. */
    const gbs = Math.round((sumBy(per, (x) => numAt(x, 'sum', 'activeTime')) / 1_000_000) * 0.125 * 100) / 100;
    rows.push(row('do.duration', 'do', 'Compute duration today',
      gbs, FREE.doDurationGbsDay, 'gbs', 'day', undefined,
      'Wall-clock while an object is awake. Hibernating WebSockets cost zero here — the design that keeps live forums free.'));
    rows.push(row('do.rows_read', 'do', 'Storage reads today',
      sumBy(per, (x) => numAt(x, 'sum', 'storageReadUnits')), FREE.doRowsReadDay, 'rows', 'day'));
    rows.push(row('do.rows_written', 'do', 'Storage writes today',
      sumBy(per, (x) => numAt(x, 'sum', 'storageWriteUnits')), FREE.doRowsWrittenDay, 'rows', 'day'));
    rows.push(row('do.storage', 'do', 'SQLite stored bytes',
      sumBy(sql, (x) => numAt(x, 'max', 'storedBytes')), FREE.doStorageBytes, 'bytes', 'total', undefined,
      'The hubs keep almost nothing — connections are the state.'));
  }

  const v = product('vectorize');
  if (!v) rows.push(errRow('vectorize.stored', 'vectorize', 'Stored dimensions', raw.vectorize));
  else {
    const q = groups(v, 'vectorizeV2QueriesAdaptiveGroups');
    const st = groups(v, 'vectorizeV2StorageAdaptiveGroups');
    rows.push(row('vectorize.queried', 'vectorize', 'Queried dimensions this month',
      sumBy(q, (x) => numAt(x, 'sum', 'queriedVectorDimensions')), FREE.vecQueriedDimsMonth, 'dims', 'month', undefined,
      'Each merecat semantic lookup reads topK × 1024 dims.'));
    rows.push(row('vectorize.stored', 'vectorize', 'Stored dimensions',
      sumBy(st, (x) => numAt(x, 'max', 'storedVectorDimensions')), FREE.vecStoredDims, 'dims', 'total', undefined,
      'The ~4,880-vector budget at 1024 dims each — why vectorize: flags are rationed in works.yml.'));
  }

  const t = product('turn');
  if (!t) rows.push(errRow('turn.egress', 'turn', 'Relayed egress this month', raw.turn));
  else {
    const g = groups(t, 'callsTurnUsageAdaptiveGroups');
    rows.push(row('turn.egress', 'turn', 'Relayed egress this month',
      sumBy(g, (x) => numAt(x, 'sum', 'egressBytes')), FREE.turnEgressBytesMonth, 'bytes', 'month', undefined,
      'Only calls that need the relay (~15–20%) spend here; P2P and STUN are free. Past the pool it BILLS per GB — calls_turn in Platform settings is the kill switch.'));
  }

  const ts = product('turnstile');
  if (!ts) rows.push(errRow('turnstile.solves', 'turnstile', 'Challenges in the last 7 days', raw.turnstile));
  else {
    const g = groups(ts, 'turnstileAdaptiveGroups');
    rows.push(row('turnstile.solves', 'turnstile', 'Challenges in the last 7 days',
      sumBy(g, (x) => numAt(x, 'count')), null, 'count', 'week', undefined,
      'Unmetered on every plan — shown for the picture, not the budget. Cloudflare serves this one a week at a time, so it is the last seven days and not the month.'));
  }

  /* A DECLARED count, not a measurement: it moves only when wrangler.jsonc
     does, and a sixth cron could not deploy at all — so the bar shows it and
     the daily check never tells it (foldUsageAlerts skips `declared` rows; the
     4-of-5 that would have nagged weekly for ever — 2026-09-16). */
  rows.push({
    ...row('cron.triggers', 'cron', 'Cron triggers (this worker)',
      FREE.cronsUsed, FREE.cronsLimit, 'count', 'total', undefined,
      'The hourly sweeps, the 03:15 daily backup, the 23:30 usage check and the monthly housekeeping — four of the five a free account may hold. A declared count, shown but never alerted: it changes only with a deploy, and a sixth could not deploy at all.'),
    declared: true,
  });

  return rows;
}

/* The daily check's memory: for each metric, the loudest band already told
   (1 = hot, 2 = over) and when. Speak on ESCALATION at once; while a warning
   merely stands, repeat it weekly; below 80% forget it entirely so a later
   re-cross alerts fresh. A `declared` row (the cron slots) is never told and
   leaves no memory: an alert is something a human must act on. Pure fold —
   the cron passes the stored state in and persists what comes back. */
export const ALERT_RENAG_SECS = 7 * 86400;
type Told = { b: number; at: number };
export function foldUsageAlerts(rows: UsageRow[], prev: Json | null, nowSec: number) {
  const state: Record<string, Told> = {};
  const alerts: UsageRow[] = [];
  for (const r of rows || []) {
    if (!r || r.pct == null || r.error || r.declared) continue;
    const band = r.pct >= 100 ? 2 : r.pct >= 80 ? 1 : 0;
    if (band === 0) continue;
    const was = obj(prev && prev[r.id]);
    const p: Told | null = typeof was.b === 'number' ? { b: was.b, at: num(was.at) } : null;
    const escalated = !p || band > p.b;
    const renag = !!p && band <= p.b && nowSec - num(p.at) >= ALERT_RENAG_SECS;
    if (escalated || renag) { alerts.push(r); state[r.id] = { b: band, at: nowSec }; }
    else state[r.id] = p;
  }
  return { alerts, state };
}

/* Measured meters only — a declared count is not a wall anyone is nearing. */
export function worstPct(rows: UsageRow[]): number {
  return (rows || []).reduce((w, r) => (r && !r.declared && r.pct != null && r.pct > w ? r.pct : w), 0);
}

/* The DM the admins get. Plain text (a system DM renders as an Automated
   notice); the numbers are already rounded by the report. */
export function alertBody(alerts: UsageRow[], site: string): string {
  const line = (r: UsageRow) =>
    '- ' + (PRODUCT_LABELS[r.product] || r.product) + ' — ' + r.label + ': ' + r.pct + '% of the free tier' +
    (r.period === 'day' ? ' (resets 00:00 UTC)' : r.period === 'month' ? ' (this month)'
      : r.period === 'week' ? ' (the last 7 days)' : '');
  return 'Cloudflare free-tier check: ' + alerts.length + (alerts.length === 1 ? ' meter needs' : ' meters need') +
    ' attention.\n\n' + alerts.map(line).join('\n') +
    '\n\nHealth bars: ' + site + '/admin.html?usage=1' +
    '\n\nChecked daily at 23:30 UTC. An escalation is told at once; a standing warning repeats weekly.';
}
