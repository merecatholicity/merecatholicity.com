/* comments-worker/src/routes/ops.ts — the watchdog's outside legs (2026-09-16).
   One door, keyed like the librarian's pipeline (`requireIngest`: the
   MERECAT_INGEST_KEY worker secret, or an admin key), so the GitHub ops-watch
   workflow and the dev box's nightly webtest need no new credential:
     {probe: true}                       → the health object (ops.ts readOps);
                                           the workflow fails its run on
                                           health.ok === false — GitHub's own
                                           failed-run mail is the alert that
                                           needs no worker
     {source: 'webtest', pass, fail,
      suites, regressions}               → stored as ops_webtest for the health
                                           panel; a regression alerts through
                                           alerts.ts */
import { json, requireIngest, setOpsState } from '../lib.ts';
import { readOps } from '../ops.ts';
import { sendAlert } from '../alerts.ts';
import type { Env } from '../env.ts';

type Report = { key?: unknown; probe?: unknown; source?: unknown; pass?: unknown; fail?: unknown; suites?: unknown; regressions?: unknown };

async function handleOpsReport(request: Request, env: Env) {
  let data: Report;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  if (!(await requireIngest(env, String(data.key || '')))) return json({ ok: false, error: 'No.' }, 403);
  if (data.probe) return json({ ok: true, health: await readOps(env) }, 200);
  if (data.source === 'webtest') {
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

export { handleOpsReport };
