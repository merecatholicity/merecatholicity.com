/* comments-worker/src/routes/ops.ts — the watchdog's outside legs (2026-09-16).
   One door, for two callers (oidc.ts, since 2026-09-17): the GitHub ops-watch
   workflow, by its OIDC token (Domain.Pipeline's `probe` door), and the dev
   box's nightly webtest, by OPS_REPORT_KEY — a worker secret that opens this
   door and nothing else. An admin key opens it too.
     {probe: true}                       → the health object (ops.ts readOps);
                                           the workflow fails its run on
                                           health.ok === false — GitHub's own
                                           failed-run mail is the alert that
                                           needs no worker
     {source: 'webtest', pass, fail,
      suites, regressions}               → stored as ops_webtest for the health
                                           panel; a regression alerts through
                                           alerts.ts. Not the watchdog's: its
                                           token reads, never reports */
import { json, setOpsState, getOpsState, readLimited } from '../lib.ts';
import { pipelineCaller } from '../oidc.ts';
import { readOps } from '../ops.ts';
import { sendAlert } from '../alerts.ts';
import type { Env } from '../env.ts';

type Report = { key?: unknown; probe?: unknown; source?: unknown; pass?: unknown; fail?: unknown; suites?: unknown; regressions?: unknown };

async function handleOpsReport(request: Request, env: Env) {
  let data: Report;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  if (!data || typeof data !== 'object') return json({ ok: false, error: 'Bad request.' }, 400);
  const caller = await pipelineCaller(request, env, String(data.key || ''), ['probe'], { reportKey: true });
  if (!caller) return json({ ok: false, error: 'No.' }, 403);
  if (data.probe) return json({ ok: true, health: await readOps(env) }, 200);
  if (data.source === 'webtest') {
    if (caller.road === 'oidc') return json({ ok: false, error: 'No.' }, 403);
    const strings = (v: unknown, n: number) => (Array.isArray(v) ? v.slice(0, 40).map((x) => String(x).slice(0, n)) : []);
    const report = {
      at: Math.floor(Date.now() / 1000),
      pass: Math.max(0, Math.floor(Number(data.pass)) || 0),
      fail: Math.max(0, Math.floor(Number(data.fail)) || 0),
      suites: strings(data.suites, 80),
      regressions: strings(data.regressions, 200),
    };
    await setOpsState(env, 'ops_webtest', report);
    let alerted = false;
    if (report.regressions.length) {
      const said = await sendAlert(env, {
        kind: 'webtest',
        subject: 'Nightly webtest: ' + report.regressions.length + ' regression' + (report.regressions.length === 1 ? '' : 's'),
        text: 'The nightly headless run against production found what the baseline did not have:\n\n' + report.regressions.join('\n') + '\n\n' + report.pass + ' passed, ' + report.fail + ' failed.',
      });
      alerted = said.email || said.discord;
    }
    return json({ ok: true, stored: true, alerted }, 200);
  }
  return json({ ok: false, error: 'Bad request.' }, 400);
}

/* The CSP report collector (P2-7, 2026-09-16). The zone's Content-Security-
   Policy is Report-Only and had nowhere to report; this door is its
   `report-uri` / `report-to`. It takes both shapes a browser sends —
   `application/csp-report` ({"csp-report": {...}}) and the Reporting API's
   `application/reports+json` ([{type: "csp-violation", url, body: {...}}]) —
   and TALLIES, never stores a report: one row per (effective directive,
   blocked origin, document path), a count, first and last seen, the top
   hundred kept in app_settings `csp_report_tally` (the Health card reads
   it; the flip to an enforced policy waits on this reading as noise). Keyless
   and public by nature; READ_LIMIT by IP, the body capped at 16 KB, anything
   unreadable answered 204 all the same — a collector never argues. */
type Violation = { directive: string; blocked: string; document: string };
type Tally = { rows: Array<{ key: string; directive: string; blocked: string; document: string; n: number; first: number; last: number }>; total: number; since: number };

function blockedOrigin(u: string): string {
  const v = String(u || '');
  if (!v || v === 'inline' || v === 'eval' || v === 'data' || v === 'blob' || v.indexOf(':') === -1) return v.slice(0, 40) || '(empty)';
  if (/^(chrome|moz|safari)-extension:/.test(v)) return 'extension';
  /* a blob: or data: URL's origin is the page's own (or null); the scheme is the fact that matters */
  if (/^(blob|data|filesystem):/.test(v)) return v.split(':')[0];
  try { return new URL(v).origin; } catch (e) { return v.slice(0, 60); }
}
function documentPath(u: string): string {
  try { return new URL(String(u || '')).pathname.slice(0, 80) || '/'; } catch (e) { return '?'; }
}
function violationsOf(payload: unknown): Violation[] {
  const out: Violation[] = [];
  const one = (b: Record<string, unknown> | null | undefined, doc: unknown) => {
    if (!b || typeof b !== 'object') return;
    const directive = String(b['effective-directive'] || b.effectiveDirective || b['violated-directive'] || b.violatedDirective || '').split(' ')[0].slice(0, 40);
    if (!directive) return;
    out.push({ directive, blocked: blockedOrigin(String(b['blocked-uri'] || b.blockedURL || '')), document: documentPath(String(doc || b['document-uri'] || b.documentURL || '')) });
  };
  if (Array.isArray(payload)) {
    for (const r of payload.slice(0, 20)) {
      if (r && typeof r === 'object' && (r as Record<string, unknown>).type === 'csp-violation') one((r as Record<string, unknown>).body as Record<string, unknown>, (r as Record<string, unknown>).url);
    }
  } else if (payload && typeof payload === 'object') {
    const rep = (payload as Record<string, unknown>)['csp-report'];
    if (rep) one(rep as Record<string, unknown>, undefined);
  }
  return out;
}

async function handleCspReport(request: Request, env: Env) {
  const limited = await readLimited(request, env);
  if (limited instanceof Response) return limited;
  const clen = Number(request.headers.get('Content-Length') || 0);
  if (clen > 16384) return new Response(null, { status: 204 });
  let payload: unknown = null;
  try {
    const text = await request.text();
    if (text.length > 16384) return new Response(null, { status: 204 });
    payload = JSON.parse(text);
  } catch (e) { return new Response(null, { status: 204 }); }
  const found = violationsOf(payload);
  if (!found.length) return new Response(null, { status: 204 });
  const now = Math.floor(Date.now() / 1000);
  const tally = await getOpsState<Tally>(env, 'csp_report_tally', { rows: [], total: 0, since: now });
  for (const v of found) {
    const key = v.directive + '|' + v.blocked + '|' + v.document;
    const row = tally.rows.find((r) => r.key === key);
    if (row) { row.n++; row.last = now; } else tally.rows.push({ key, ...v, n: 1, first: now, last: now });
    tally.total++;
  }
  tally.rows.sort((a, b) => b.n - a.n || b.last - a.last);
  if (tally.rows.length > 100) tally.rows.length = 100;
  try { await setOpsState(env, 'csp_report_tally', tally); } catch (e) { /* a collector never argues */ }
  console.log(JSON.stringify({ event: 'csp_report', n: found.length, first: found[0] }));
  return new Response(null, { status: 204 });
}

export { handleOpsReport, handleCspReport };
