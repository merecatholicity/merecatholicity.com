/* The Cloudflare free-tier usage monitor (2026-08-03). Two faces over one
   fetch: POST /api/comments/admin/usage (admin-keyed) answers the health-bar
   page live, and runUsageCheck (the 23:30 UTC daily cron) DMs every admin —
   as merecat, an Automated notice — when any meter crosses 80% or its ceiling.

   Everything decidable (limits, aggregation, banding, the alert fold) is pure
   in usagecalc.ts; this file only fetches and delivers. Data comes from the
   GraphQL Analytics API with a READ-ONLY token: the CF_USAGE_TOKEN secret
   (`cd comments-worker && wrangler secret put CF_USAGE_TOKEN`), single scope
   "Account Analytics: Read", beside the CF_ACCOUNT_ID var. Until both stand,
   the endpoint answers configured:false (the page shows the setup steps) and
   the cron no-ops — nothing breaks, nothing pretends. Each product is its own
   GraphQL request so one failing dataset costs one card, never the page
   (8 subrequests, far inside the 50 cap). */

import { json, requireAdmin, sendSystemDm, siteBase, MERECAT_BOT } from './lib.js';
import {
  buildReport, foldUsageAlerts, alertBody, worstPct,
  iso, utcDayStart, utcMonthStart, FREE, PRODUCT_LABELS,
} from './usagecalc.js';

const GRAPHQL = 'https://api.cloudflare.com/client/v4/graphql';

async function gqlSelect(env: any, sel: string) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort('usage-timeout'), 12000);
  try {
    const r = await fetch(GRAPHQL, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + env.CF_USAGE_TOKEN, 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'query { viewer { accounts(filter: {accountTag: "' + env.CF_ACCOUNT_ID + '"}) { ' + sel + ' } } }' }),
      signal: ctl.signal,
    });
    const d: any = await r.json().catch(() => null);
    if (!d) throw new Error('bad analytics response (' + r.status + ')');
    if (d.errors && d.errors.length) throw new Error(String(d.errors[0].message || 'GraphQL error').slice(0, 200));
    const acct = d.data && d.data.viewer && d.data.viewer.accounts && d.data.viewer.accounts[0];
    if (!acct) throw new Error('no account data (is the token Account Analytics: Read on this account?)');
    return acct;
  } finally { clearTimeout(timer); }
}

export async function fetchUsageReport(env: any) {
  const now = Date.now();
  const day = iso(utcDayStart(now));
  const monDate = iso(utcMonthStart(now)).slice(0, 10);
  /* Storage datasets emit periodic samples whether or not anything moved; a
     72 h window with max() always catches the latest one. */
  const snap = iso(now - 72 * 3600 * 1000);
  const Q: Record<string, string> = {
    workers: 'workersInvocationsAdaptive(limit: 1000, filter: {datetime_geq: "' + day + '"}) { dimensions { scriptName } sum { requests } }',
    ai: 'aiInferenceAdaptiveGroups(limit: 1000, filter: {datetime_geq: "' + day + '"}) { dimensions { modelId } sum { totalNeurons } }',
    d1: 'd1AnalyticsAdaptiveGroups(limit: 1000, filter: {datetime_geq: "' + day + '"}) { dimensions { databaseId } sum { rowsRead rowsWritten } } ' +
        'd1StorageAdaptiveGroups(limit: 1000, filter: {datetime_geq: "' + snap + '"}) { dimensions { databaseId } max { databaseSizeBytes } }',
    r2: 'r2OperationsAdaptiveGroups(limit: 2000, filter: {date_geq: "' + monDate + '"}) { dimensions { actionType bucketName } sum { requests } } ' +
        'r2StorageAdaptiveGroups(limit: 1000, filter: {datetime_geq: "' + snap + '"}) { dimensions { bucketName } max { payloadSize metadataSize } }',
    do: 'durableObjectsInvocationsAdaptiveGroups(limit: 1000, filter: {datetime_geq: "' + day + '"}) { sum { requests } } ' +
        'durableObjectsPeriodicGroups(limit: 1000, filter: {datetime_geq: "' + day + '"}) { sum { activeTime storageReadUnits storageWriteUnits } } ' +
        'durableObjectsSqlStorageGroups(limit: 1000, filter: {datetime_geq: "' + snap + '"}) { max { storedBytes } }',
    vectorize: 'vectorizeV2QueriesAdaptiveGroups(limit: 1000, filter: {date_geq: "' + monDate + '"}) { sum { queriedVectorDimensions } } ' +
        'vectorizeV2StorageAdaptiveGroups(limit: 1000, filter: {datetime_geq: "' + snap + '"}) { max { storedVectorDimensions } }',
    turn: 'callsTurnUsageAdaptiveGroups(limit: 1000, filter: {date_geq: "' + monDate + '"}) { sum { egressBytes } }',
    turnstile: 'turnstileAdaptiveGroups(limit: 1000, filter: {date_geq: "' + monDate + '"}) { count }',
  };
  const keys = Object.keys(Q);
  const settled = await Promise.allSettled(keys.map((k) => gqlSelect(env, Q[k])));
  const raw: any = {};
  keys.forEach((k, i) => {
    const s: any = settled[i];
    raw[k] = s.status === 'fulfilled' ? s.value
      : { error: String((s.reason && s.reason.message) || s.reason || 'failed').slice(0, 200) };
  });
  return { rows: buildReport(raw), at: Math.floor(now / 1000) };
}

export async function handleAdminUsage(request: any, env: any) {
  let data: any = null;
  try { data = await request.json(); } catch (e) { return json({ ok: false, error: 'Bad request.' }, 400); }
  if (!(await requireAdmin(env, String((data && data.key) || '')))) return json({ ok: false, error: 'No.' }, 403);
  if (!env.CF_USAGE_TOKEN || !env.CF_ACCOUNT_ID) {
    return json({ ok: true, configured: false, products: PRODUCT_LABELS, free_as_of: FREE.asOf });
  }
  const rep = await fetchUsageReport(env);
  return json({ ok: true, configured: true, at: rep.at, rows: rep.rows, products: PRODUCT_LABELS, free_as_of: FREE.asOf, check_utc: '23:30' });
}

/* The daily cron. Alert state (loudest band told per metric + when) lives in
   app_settings under 'usage_alert_state', read/written directly — the 5-minute
   getAppSettings cache has no business in a once-a-day path. Failures log and
   stand down; the next day tries again. */
export async function runUsageCheck(env: any) {
  if (!env.CF_USAGE_TOKEN || !env.CF_ACCOUNT_ID) {
    console.log(JSON.stringify({ event: 'usage_check_skipped', why: 'CF_USAGE_TOKEN / CF_ACCOUNT_ID not set' }));
    return;
  }
  try {
    const rep = await fetchUsageReport(env);
    let prev: any = {};
    try {
      const st: any = await env.DB.prepare("SELECT v FROM app_settings WHERE k = 'usage_alert_state'").first();
      if (st && st.v) prev = JSON.parse(st.v);
    } catch (e) { /* fresh state */ }
    const { alerts, state } = foldUsageAlerts(rep.rows, prev, rep.at);
    await env.DB.prepare(
      "INSERT INTO app_settings (k, v, updated_at, updated_by) VALUES ('usage_alert_state', ?1, ?2, 'usage-cron') " +
      "ON CONFLICT(k) DO UPDATE SET v = ?1, updated_at = ?2, updated_by = 'usage-cron'"
    ).bind(JSON.stringify(state), rep.at).run();
    if (!alerts.length) {
      console.log(JSON.stringify({ event: 'usage_check_ok', worst_pct: worstPct(rep.rows) }));
      return;
    }
    const body = alertBody(alerts, siteBase(env));
    const adm = await env.DB.prepare('SELECT hash FROM admins').all();
    let sent = 0;
    for (const a of (adm.results || []) as any[]) {
      if (!a.hash || a.hash === MERECAT_BOT.hash) continue;
      try { await sendSystemDm(env, MERECAT_BOT.hash, a.hash, body); sent++; } catch (e) { /* next admin */ }
    }
    console.log(JSON.stringify({ event: 'usage_alerts_sent', meters: alerts.length, admins: sent }));
  } catch (e) {
    console.log(JSON.stringify({ event: 'usage_check_failed', error: String(e).slice(0, 300) }));
  }
}
