/* comments-worker/src/ops.ts — the cron chains, the self-check and the health
   read (2026-09-16). Before this file the four crons were bare `.then` chains:
   a step that threw took every step behind it with it (the monthly backup
   stood last), sixty-one `*_failed` log lines had no reader, and nothing could
   say whether a cron had run at all. Now every chain runs through `runChain`:
   each step in its own try/catch (`cron_step_failed` logged, the chain goes
   on), the chain's heartbeat stamped in app_settings `ops_heartbeat` at the
   end, and what failed — plus what the self-check found, when the chain ran
   one — folded through `Domain.Ops.foldOpsAlerts` into at most two alerts
   (trouble, recovered) through alerts.ts. The fold coalesces: a condition is
   told once when it opens and once when it closes, never twice a day while it
   stands; and a chain judges only the conditions it can observe
   (`Domain.Ops.alertScope`), so the hourly sweeps finding nothing wrong of
   their own never "recover" the daily's missing backup.

   `runSelfCheck` (a step of the 03:15 backup chain and the 23:30 usage chain)
   is the watchdog inside: today's backup object present and plausible (or the
   recorded failure), every chain's heartbeat fresh (`Domain.Ops.staleAfter`).
   A watchdog inside a dead worker says nothing — the outside leg is
   .github/workflows/ops-watch.yml probing `readOps` through the report door.
   State: app_settings rows only (ops_heartbeat, ops_backup, ops_alert_state,
   ops_webtest, ops_egress, ops_shapes), no table. */
import * as OpsK from '../../purescript/output/Domain.Ops/index.js';
import { sendAlert } from './alerts.ts';
import { getOpsState, setOpsState, hubStats } from './lib.ts';
import { PUBLIC_VARS } from './env.ts';
import type { Env } from './env.ts';
import { servedBy } from './dbsession.ts';
import { shortSecrets } from './egress.ts';

export type Condition = { kind: string; subject: string; detail: string };
export type Step = [string, (env: Env) => Promise<unknown>];
/* the four chains, by the name their heartbeat carries */
export const CHAINS = ['hourly', 'daily', 'usage', 'monthly'];

const today = (nowSecs: number) => new Date(nowSecs * 1000).toISOString().slice(0, 10);

export async function runChain(env: Env, name: string, steps: Step[]) {
  const t0 = Date.now();
  const failures: Condition[] = [];
  let found: Condition[] = [];
  let selfCheck = false;
  for (const [label, fn] of steps) {
    try {
      const r = await fn(env);
      if (label === 'runSelfCheck') {
        selfCheck = true;
        if (Array.isArray(r)) found = found.concat(r as Condition[]);
      }
    } catch (e) {
      const error = String(e).slice(0, 300);
      console.log(JSON.stringify({ event: 'cron_step_failed', chain: name, step: label, error }));
      failures.push(OpsK.stepFailed(name)(label)(error));
    }
  }
  const now = Math.floor(Date.now() / 1000);
  try {
    const hb = await getOpsState<Record<string, number>>(env, 'ops_heartbeat', {});
    hb[name] = now;
    await setOpsState(env, 'ops_heartbeat', hb);
  } catch (e) {
    console.log(JSON.stringify({ event: 'heartbeat_failed', chain: name, error: String(e).slice(0, 200) }));
  }
  const raised = await raiseConditions(env, name, selfCheck, failures.concat(found));
  console.log(JSON.stringify({ event: 'cron_chain', chain: name, steps: steps.length, failed: failures.length, found: found.length, fired: raised.fired, cleared: raised.cleared, ms: Date.now() - t0 }));
  return { chain: name, failed: failures.map((c) => c.subject), found: found.map((c) => OpsK.conditionKey(c)), ...raised };
}

/* The fold and the two alerts. `ops_alert_state.open` is every condition
   already told and still standing; this run may judge only the keys in its
   scope, and hands the rest back untouched. */
async function raiseConditions(env: Env, chain: string, selfCheck: boolean, conditions: Condition[]) {
  const inScope = OpsK.alertScope({ chain, selfCheck });
  const state = await getOpsState<{ open?: string[] }>(env, 'ops_alert_state', {});
  const open = Array.isArray(state.open) ? state.open.map(String) : [];
  const r = OpsK.foldOpsAlerts({ open: open.filter(inScope), conditions });
  const nextOpen = open.filter((k) => !inScope(k)).concat(r.open).sort();
  try {
    await setOpsState(env, 'ops_alert_state', { open: nextOpen, at: Math.floor(Date.now() / 1000) });
  } catch (e) {
    console.log(JSON.stringify({ event: 'alert_state_failed', error: String(e).slice(0, 200) }));
  }
  if (r.fire.length) {
    const d = OpsK.digest(r.fire);
    await sendAlert(env, { kind: 'trouble', subject: d.subject, text: d.text });
  }
  if (r.clear.length) {
    const d = OpsK.recoveredDigest(r.clear);
    await sendAlert(env, { kind: 'recovered', subject: d.subject, text: d.text });
  }
  return { fired: r.fire.length, cleared: r.clear.length };
}

/* What is wrong right now, as conditions for the chain runner to fold. The
   backup is judged only once the daily chain has beaten at least once —
   before that there is nothing to expect, and a fresh deploy must not cry;
   the health panel shows "never" for a human to judge. */
export async function runSelfCheck(env: Env): Promise<Condition[]> {
  const now = Math.floor(Date.now() / 1000);
  const conds: Condition[] = [];
  const hb = await getOpsState<Record<string, number>>(env, 'ops_heartbeat', {});
  if (hb.daily) {
    const key = OpsK.backupKey(today(now));
    const backup = await getOpsState<{ key?: string; error?: string }>(env, 'ops_backup', {});
    if (backup && backup.key === key && backup.error) conds.push(OpsK.backupFailed(key)(String(backup.error)));
    else {
      let head: { size: number } | null = null;
      try { head = env.BACKUPS ? await env.BACKUPS.head(key) : null; } catch (e) { head = null; }
      if (!head || head.size < OpsK.minBackupBytes) conds.push(OpsK.backupMissing(key));
    }
  }
  for (const name of CHAINS) {
    const last = Number(hb[name] || 0);
    if (OpsK.isStale({ name, last, now })) conds.push(OpsK.cronStale(name)(now - last));
  }
  for (const name of shortSecrets(env, PUBLIC_VARS)) conds.push(OpsK.secretShort(name));
  return conds;
}

/* The guard's notes (2026-09-17): an answer or a hub frame refused for
   carrying a secret, a handler that tried to enumerate or serialize the sealed
   env (egress.ts) — and an answer whose listed field was not a list
   (Domain.Wire). Each kind has one app_settings row, `ops_egress` and
   `ops_shapes`: a row per (kind, site), the NAMES involved (secret names or
   field names, never a value), how many notes, first and last, when it was last
   told. Told at once, then no sooner than its kind's quiet time
   (Domain.Ops.shouldRetell: an hour for a leak; a day for a shape). An isolate
   writes one key at most once a minute, so a road that trips on every request
   cannot turn the note into a D1 write per request; `n` counts notes written,
   not requests. */
export type LeakNote = { kind: 'answer' | 'frame' | 'enumerated'; site: string; names: string[] };
export type ShapeNote = { site: string; fields: string[] };
type NoteRow = { key: string; kind: string; site: string; names: string[]; n: number; first: number; last: number; told: number };
type NoteTally = { rows: NoteRow[] };
const NOTE_ROWS = 50;
const lastNoted = new Map<string, number>();

async function tally(env: Env, state: 'ops_egress' | 'ops_shapes', kind: string, site: string, names: string[],
  quiet: number, tell: (row: NoteRow) => { subject: string; text: string }, alertKind: string) {
  const key = state + ' ' + kind + ' ' + site;
  const ms = Date.now();
  if (ms - (lastNoted.get(key) || 0) < 60000) return;
  lastNoted.set(key, ms);
  const now = Math.floor(ms / 1000);
  try {
    const t = await getOpsState<NoteTally>(env, state, { rows: [] });
    const rows = Array.isArray(t.rows) ? t.rows : [];
    const rowKey = kind + ' ' + site;
    let row = rows.find((r) => r.key === rowKey);
    if (!row) {
      row = { key: rowKey, kind, site, names: [], n: 0, first: now, last: now, told: 0 };
      rows.push(row);
    }
    row.n += 1;
    row.last = now;
    row.names = Array.from(new Set(row.names.concat(names))).sort().slice(0, 12);
    const due = OpsK.shouldRetell({ told: row.told, now, quiet });
    if (due) row.told = now;
    rows.sort((a, b) => b.last - a.last);
    await setOpsState(env, state, { rows: rows.slice(0, NOTE_ROWS) });
    if (due) {
      const d = tell(row);
      await sendAlert(env, { kind: alertKind, subject: d.subject, text: d.text });
    }
  } catch (e) {
    console.log(JSON.stringify({ event: 'ops_note_failed', key, error: String(e).slice(0, 200) }));
  }
}

export async function noteLeak(env: Env, note: LeakNote) {
  await tally(env, 'ops_egress', note.kind, note.site, note.names, OpsK.leakRetellAfter,
    (row) => OpsK.leakDigest({ kind: row.kind, site: row.site, names: row.names, n: row.n }), 'egress');
}

export async function noteShape(env: Env, note: ShapeNote) {
  await tally(env, 'ops_shapes', 'shape', note.site, note.fields, OpsK.shapeRetellAfter,
    (row) => OpsK.shapeDigest({ site: row.site, fields: row.names, n: row.n }), 'shape');
}

/* the health card's view of a tally: the rows, and whether each still stands */
async function notes(env: Env, state: 'ops_egress' | 'ops_shapes', now: number) {
  const t = await getOpsState<NoteTally>(env, state, { rows: [] });
  return (Array.isArray(t.rows) ? t.rows : []).map((r) => ({
    kind: r.kind, site: r.site, names: r.names, n: r.n, first: r.first, last: r.last,
    standing: OpsK.noteStanding({ last: Number(r.last) || 0, now }),
  }));
}

/* The health object: the admin panel's card and the report door's probe.
   `ok` is the outside watchdog's verdict — no stale heartbeat, no open
   condition, and (once the daily has ever run) a plausible backup object for
   today or yesterday in the bucket. */
export async function readOps(env: Env) {
  const now = Math.floor(Date.now() / 1000);
  const hb = await getOpsState<Record<string, number>>(env, 'ops_heartbeat', {});
  const backup = await getOpsState<Record<string, unknown> | null>(env, 'ops_backup', null);
  const alerts = await getOpsState<{ open?: string[]; at?: number }>(env, 'ops_alert_state', {});
  const webtest = await getOpsState<Record<string, unknown> | null>(env, 'ops_webtest', null);
  const csp = await getOpsState<Record<string, unknown> | null>(env, 'csp_report_tally', null);
  const heartbeat = CHAINS.map((name) => {
    const last = Number(hb[name] || 0);
    return { name, last, age: last ? now - last : null, stale: OpsK.isStale({ name, last, now }), stale_after: OpsK.staleAfter(name) };
  });
  const stale = heartbeat.filter((h) => h.stale).map((h) => h.name);
  const never = heartbeat.filter((h) => !h.last).map((h) => h.name);
  let object: { key: string; size: number } | null = null;
  try {
    if (env.BACKUPS) {
      const h = (await env.BACKUPS.head(OpsK.backupKey(today(now)))) || (await env.BACKUPS.head(OpsK.backupKey(today(now - 86400))));
      if (h) object = { key: h.key, size: h.size };
    }
  } catch (e) { object = null; }
  const open = Array.isArray(alerts.open) ? alerts.open.map(String) : [];
  const backupOk = !hb.daily || (!!object && object.size >= OpsK.minBackupBytes);
  /* the guard's notes — one from the last day keeps the verdict red */
  const egress = await notes(env, 'ops_egress', now);
  const shapes = await notes(env, 'ops_shapes', now);
  const noted = egress.concat(shapes).some((r) => r.standing);
  const ok = stale.length === 0 && open.length === 0 && backupOk && !noted;
  /* The live hub, shard by shard (2026-09-17): how many sockets each holds
     is the number that says when to raise HUB_SHARDS. Shown, never told. */
  let hub: Awaited<ReturnType<typeof hubStats>> = [];
  try { hub = await hubStats(env); } catch (e) { hub = []; }
  /* where one unconstrained D1 read ran (2026-09-17): replicas at work, or not */
  const d1 = await servedBy(env);
  return { now, ok, heartbeat, stale, never, backup, object, backup_ok: backupOk, open, alerts_at: alerts.at || null, webtest, csp, hub, d1, egress, shapes };
}
