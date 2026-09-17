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
   (8 subrequests, far inside the 50 cap). The GraphQL glue itself is
   analytics.ts, shared with the librarian's AI budget guard (quota.ts), which
   reads the neurons dataset through the very same select. */

import * as CallK from '../../purescript/output/Domain.Call/index.js';
import { json, requireAdmin, sendSystemDm, siteBase, MERECAT_BOT, appSettingsCache } from './lib.ts';
import type { Env } from './env.ts';
import { sendAlert } from './alerts.ts';
import { gqlSelect } from './analytics.ts';
import { aiNeuronsSelect } from './quota.ts';
import {
  buildReport, foldUsageAlerts, alertBody, worstPct,
  iso, utcDayStart, utcMonthStart, FREE, PRODUCT_LABELS,
} from './usagecalc.ts';

/* The dataset the usage page and the TURN guard both read: the month's relayed egress. */
export function turnEgressSelect(monthDate: string): string {
  return 'callsTurnUsageAdaptiveGroups(limit: 1000, filter: {date_geq: "' + monthDate + '"}) { sum { egressBytes } }';
}

export async function fetchUsageReport(env: Env) {
  const now = Date.now();
  const day = iso(utcDayStart(now));
  const monDate = iso(utcMonthStart(now)).slice(0, 10);
  /* Storage datasets emit periodic samples whether or not anything moved; a
     72 h window with max() always catches the latest one. */
  const snap = iso(now - 72 * 3600 * 1000);
  const Q: Record<string, string> = {
    workers: 'workersInvocationsAdaptive(limit: 1000, filter: {datetime_geq: "' + day + '"}) { dimensions { scriptName } sum { requests } }',
    ai: aiNeuronsSelect(day),
    d1: 'd1AnalyticsAdaptiveGroups(limit: 1000, filter: {datetime_geq: "' + day + '"}) { dimensions { databaseId } sum { rowsRead rowsWritten } } ' +
        'd1StorageAdaptiveGroups(limit: 1000, filter: {datetime_geq: "' + snap + '"}) { dimensions { databaseId } max { databaseSizeBytes } }',
    r2: 'r2OperationsAdaptiveGroups(limit: 2000, filter: {date_geq: "' + monDate + '"}) { dimensions { actionType bucketName } sum { requests } } ' +
        'r2StorageAdaptiveGroups(limit: 1000, filter: {datetime_geq: "' + snap + '"}) { dimensions { bucketName } max { payloadSize metadataSize } }',
    do: 'durableObjectsInvocationsAdaptiveGroups(limit: 1000, filter: {datetime_geq: "' + day + '"}) { sum { requests } } ' +
        'durableObjectsPeriodicGroups(limit: 1000, filter: {datetime_geq: "' + day + '"}) { sum { activeTime storageReadUnits storageWriteUnits } } ' +
        'durableObjectsSqlStorageGroups(limit: 1000, filter: {datetime_geq: "' + snap + '"}) { max { storedBytes } }',
    vectorize: 'vectorizeV2QueriesAdaptiveGroups(limit: 1000, filter: {date_geq: "' + monDate + '"}) { sum { queriedVectorDimensions } } ' +
        'vectorizeV2StorageAdaptiveGroups(limit: 1000, filter: {datetime_geq: "' + snap + '"}) { max { storedVectorDimensions } }',
    turn: turnEgressSelect(monDate),
    turnstile: 'turnstileAdaptiveGroups(limit: 1000, filter: {date_geq: "' + monDate + '"}) { count }',
  };
  const keys = Object.keys(Q);
  const settled = await Promise.allSettled(keys.map((k) => gqlSelect(env, Q[k])));
  /* One product per settled promise: its datasets, or the one error card. */
  const raw: Record<string, unknown> = {};
  keys.forEach((k, i) => {
    const s = settled[i];
    raw[k] = s.status === 'fulfilled' ? s.value
      : { error: String((s.reason && s.reason.message) || s.reason || 'failed').slice(0, 200) };
  });
  return { rows: buildReport(raw), at: Math.floor(now / 1000) };
}

export async function handleAdminUsage(request: Request, env: Env) {
  let data: { key?: unknown } | null = null;
  try { data = await request.json<{ key?: unknown }>(); } catch (e) { return json({ ok: false, error: 'Bad request.' }, 400); }
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
export async function runUsageCheck(env: Env) {
  if (!env.CF_USAGE_TOKEN || !env.CF_ACCOUNT_ID) {
    console.log(JSON.stringify({ event: 'usage_check_skipped', why: 'CF_USAGE_TOKEN / CF_ACCOUNT_ID not set' }));
    return;
  }
  try {
    const rep = await fetchUsageReport(env);
    /* the fold's memory: the loudest band told per metric, and when */
    let prev: Record<string, { b: number; at: number }> = {};
    try {
      const st = await env.DB.prepare("SELECT v FROM app_settings WHERE k = 'usage_alert_state'").first<{ v: string | null }>();
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
    const adm = await env.DB.prepare('SELECT hash FROM admins').all<{ hash: string }>();
    let sent = 0;
    for (const a of adm.results || []) {
      if (!a.hash || a.hash === MERECAT_BOT.hash) continue;
      try { await sendSystemDm(env, MERECAT_BOT.hash, a.hash, body); sent++; } catch (e) { /* next admin */ }
    }
    /* and the owner's channels (alerts.ts — email, Discord or both, from
       Platform settings); the DM above stays for every admin */
    const said = await sendAlert(env, {
      kind: 'usage',
      subject: 'Usage: ' + alerts.length + ' meter' + (alerts.length === 1 ? '' : 's') + ' past a band',
      text: body,
    });
    console.log(JSON.stringify({ event: 'usage_alerts_sent', meters: alerts.length, admins: sent, channels: said.channels }));
  } catch (e) {
    console.log(JSON.stringify({ event: 'usage_check_failed', error: String(e).slice(0, 300) }));
  }
}

/* The TURN guard (2026-09-17; the rule is Domain.Call.turnGuardStep). The
   relay bills per GB past its monthly pool with no cap, and `calls_turn` is
   the only brake, so the usage chain reads the month's relayed egress (one
   select, aggregated by the usage page's own rulebook) and switches the relay
   off at the admin's line — Platform settings: `turn_guard_on`, default on;
   `turn_guard_pct`, default 95 — and tells the owner; the monthly chain
   switches it back on when the new month's pool opens, if the guard switched
   it off and it is still off. The memory is `turn_guard_state` (the month it
   tripped). Settings are read from the table, not the five-minute cache; a
   switch busts this isolate's cache (the others follow within five minutes,
   and /call/turn is their only reader). */
type TurnMeter = { used: number; limit: number };

async function settingRow(env: Env, k: string): Promise<string> {
  const r = await env.DB.prepare('SELECT v FROM app_settings WHERE k = ?1').bind(k).first<{ v: string | null }>();
  return r && r.v != null ? String(r.v) : '';
}

export async function turnGuard(env: Env, meter: TurnMeter | null, nowMs = Date.now()): Promise<string> {
  const [onRaw, pctRaw, relayRaw, stateRaw] = await Promise.all(
    ['turn_guard_on', 'turn_guard_pct', 'calls_turn', 'turn_guard_state'].map((k) => settingRow(env, k)));
  let tripped = '';
  try {
    const st: unknown = stateRaw ? JSON.parse(stateRaw) : null;
    if (st && typeof st === 'object' && typeof (st as { month?: unknown }).month === 'string') tripped = (st as { month: string }).month;
  } catch (e) { /* no memory */ }
  const month = iso(utcMonthStart(nowMs)).slice(0, 7);
  const pct: number = CallK.turnGuardPctFrom(pctRaw);
  const relayOn = (relayRaw || '1') === '1';   // routes/calls.ts: the relay is on only at '1'; absent is the default '1'
  const act: string = CallK.turnGuardStep({
    on: CallK.turnGuardOnFrom(onRaw), pct, relayOn, tripped, month,
    used: meter ? meter.used : 0, limit: meter ? meter.limit : 0,
  });
  if (act === 'stay') return act;
  const now = Math.floor(nowMs / 1000);
  const put = (k: string, v: string) => env.DB.prepare(
    "INSERT INTO app_settings (k, v, updated_at, updated_by) VALUES (?1, ?2, ?3, 'turn-guard') " +
    "ON CONFLICT(k) DO UPDATE SET v = ?2, updated_at = ?3, updated_by = 'turn-guard'").bind(k, v, now);
  const forget = env.DB.prepare("DELETE FROM app_settings WHERE k = 'turn_guard_state'");
  if (act === 'trip' && meter) {
    await env.DB.batch([put('calls_turn', '0'), put('turn_guard_state', JSON.stringify({ month, at: now, pct, used: meter.used, limit: meter.limit }))]);
  } else if (act === 'restore') {
    await env.DB.batch([put('calls_turn', '1'), forget]);
  } else {
    await forget.run();
  }
  if (act !== 'forget') { appSettingsCache.at = 0; appSettingsCache.s = null; }
  console.log(JSON.stringify({ event: 'turn_guard', act, month, pct }));
  if (act === 'trip' && meter) {
    const shown = Math.floor((meter.used * 1000) / meter.limit) / 10;
    const gb = (b: number) => (b / 1e9).toFixed(1) + ' GB';
    await sendAlert(env, {
      kind: 'turn-guard',
      subject: 'TURN relay switched off at ' + shown + '% of the month\'s free pool',
      text: 'Voice calls have relayed ' + gb(meter.used) + ' of the ' + gb(meter.limit) + ' free this month, past the guard\'s line of ' + pct + '%, ' +
        'so the TURN relay is switched off: calls still connect directly where the network allows, and a call on the strictest networks ' +
        'fails and says so. The relay switches back on when the pool renews on the 1st (00:00 UTC).\n\n' +
        'To keep the relay on and pay for what passes the pool: Platform settings → Voice calls, switch the guard off, then the relay on.\n' +
        'A spend this high with few calls may be a leaked TURN key, which is spent without the worker: rotate it (CICD §4).',
    });
  }
  return act;
}

/* The usage chain's step: the month's meter, then the rule. No meter (no
   CF_USAGE_TOKEN / CF_ACCOUNT_ID) is nothing to read; an unreadable one throws,
   so the chain reports the step. */
export async function runTurnGuard(env: Env) {
  if (!env.CF_USAGE_TOKEN || !env.CF_ACCOUNT_ID) return;
  const now = Date.now();
  const acct = await gqlSelect(env, turnEgressSelect(iso(utcMonthStart(now)).slice(0, 10)));
  const row = buildReport({ turn: acct }).find((r) => r.id === 'turn.egress');
  if (!row || row.error || !row.limit) throw new Error((row && row.error) || 'no relayed-egress row');
  await turnGuard(env, { used: row.used || 0, limit: row.limit }, now);
}

/* The monthly chain's step: the new month's pool is open — restore what the
   guard switched off (no meter needed, so it runs without the token too). */
export async function turnGuardRollover(env: Env, nowMs = Date.now()): Promise<string> {
  return turnGuard(env, null, nowMs);
}
