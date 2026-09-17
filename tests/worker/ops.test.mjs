/* The cron chains, the self-check and the health read (2026-09-16), run:
 * every step in its own try/catch, a heartbeat per chain, conditions folded
 * into at most two alerts a run (trouble, recovered) and coalesced across
 * runs, a chain judging only what it can observe, the watchdog's outside
 * legs (the report door for the GitHub probe and the nightly webtest).
 *
 * What would break silently: a failed prune skipping the backup behind it;
 * a condition re-alerted every run until the owner mutes the channel; the
 * hourly sweeps "recovering" the daily's missing backup; a fresh deploy
 * crying about a backup no cron has yet had the chance to write; a probe
 * that says ok while a heartbeat is a day stale. */
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadWorker, makeEnv, freshDb, identity, resetCaches, netSpy, ctx, call } from '../_support/worker.mjs';
import { runChain, runSelfCheck, readOps } from '../../comments-worker/src/ops.ts';

let worker, adm, net;
before(async () => {
  ({ worker } = await loadWorker());
  adm = await identity('the-admin');
  net = netSpy();
});
after(() => net.restore());
beforeEach(resetCaches);

const today = () => new Date().toISOString().slice(0, 10);
const TODAY_KEY = () => 'backups/comments-' + today() + '.sql.gz';
function seeded() {
  const db = freshDb();
  db.prepare("INSERT INTO app_settings (k, v, updated_at, updated_by) VALUES ('alert_email', 'owner@example.org', 1, 'test')").run();
  return db;
}
const state = (db, k) => { const r = db.prepare('SELECT v FROM app_settings WHERE k = ?').get(k); return r ? JSON.parse(r.v) : null; };
const setState = (db, k, v) => db.prepare("INSERT INTO app_settings (k, v, updated_at, updated_by) VALUES (?, ?, 1, 'test') ON CONFLICT(k) DO UPDATE SET v = excluded.v").run(k, JSON.stringify(v));
const subjects = (env) => env.emails.map((m) => m.subject);

test('the daily chain writes today\'s backup and beats; a fresh deploy alerts about nothing; the health read says ok', async () => {
  const db = seeded();
  const env = makeEnv({ db });
  const c = ctx();
  await worker.scheduled({ cron: '15 3 * * *' }, env, c);
  await c.settle();
  assert.ok(env.BACKUPS.objects.has(TODAY_KEY()), 'the object is in the bucket');
  const hb = state(db, 'ops_heartbeat');
  assert.ok(hb.daily > 0, 'the daily beat');
  assert.deepEqual(subjects(env), [], 'nothing was wrong: nothing was said');
  const h = await readOps(env);
  assert.equal(h.ok, true);
  assert.equal(h.object.key, TODAY_KEY());
  assert.deepEqual(h.never, ['hourly', 'usage', 'monthly'], 'the chains that have not yet run are named, not presumed dead');
  assert.deepEqual(h.stale, []);
  assert.equal(h.backup.key, TODAY_KEY());
  db.close();
});

test('a step that throws does not stop the chain; the failure alerts once, stays quiet while it stands, and is recovered once', async () => {
  const db = seeded();
  const env = makeEnv({ db });
  let ran = 0;
  const boom = async () => { throw new Error('D1_ERROR: no such table: nothing'); };
  const fine = async () => { ran++; };
  let r = await runChain(env, 'monthly', [['boom', boom], ['fine', fine]]);
  assert.equal(ran, 1, 'the step behind the failure still ran');
  assert.deepEqual([r.failed, r.fired, r.cleared], [['monthly/boom'], 1, 0]);
  assert.deepEqual(subjects(env), ['[merecatholicity] Cron step failed: monthly/boom']);
  assert.match(env.emails[0].text, /threw: Error: D1_ERROR: no such table: nothing\. The other steps of its chain still ran/);
  assert.deepEqual(state(db, 'ops_alert_state').open, ['step_failed:monthly/boom']);
  assert.ok(state(db, 'ops_heartbeat').monthly > 0, 'a chain with a failed step still beats — it ran');
  r = await runChain(env, 'monthly', [['boom', boom], ['fine', fine]]);
  assert.deepEqual([r.fired, r.cleared, env.emails.length], [0, 0, 1], 'the same trouble the next run: nothing new to say');
  r = await runChain(env, 'monthly', [['fine', fine]]);
  assert.deepEqual([r.fired, r.cleared], [0, 1]);
  assert.equal(subjects(env)[1], '[merecatholicity] Recovered: step_failed:monthly/boom');
  assert.deepEqual(state(db, 'ops_alert_state').open, []);
  db.close();
});

test('a chain judges only what it can observe: the hourly sweeps never recover the daily\'s missing backup', async () => {
  const db = seeded();
  setState(db, 'ops_alert_state', { open: ['backup_missing:' + TODAY_KEY(), 'step_failed:daily/runBackup'] });
  const env = makeEnv({ db });
  const r = await runChain(env, 'hourly', [['ok', async () => 1]]);
  assert.deepEqual([r.fired, r.cleared, env.emails.length], [0, 0, 0]);
  assert.deepEqual(state(db, 'ops_alert_state').open, ['backup_missing:' + TODAY_KEY(), 'step_failed:daily/runBackup'], 'untouched — not the hourly\'s to clear');
  db.close();
});

test('the self-check: a missing backup (once the daily has ever beaten), a recorded failure, and stale heartbeats — then the recovery', async () => {
  const db = seeded();
  const now = Math.floor(Date.now() / 1000);
  assert.deepEqual(await runSelfCheck(makeEnv({ db })), [], 'no heartbeat yet: nothing is expected');
  setState(db, 'ops_heartbeat', { daily: now - 3600, hourly: now - 4 * 3600, usage: now - 600, monthly: now - 5 * 86400 });
  const env = makeEnv({ db });
  let found = await runSelfCheck(env);
  assert.deepEqual(found.map((c) => c.kind + ':' + c.subject), ['backup_missing:' + TODAY_KEY(), 'cron_stale:hourly']);
  /* the 23:30 chain: the usage check stands down (no token), the self-check speaks */
  const c = ctx();
  await worker.scheduled({ cron: '30 23 * * *' }, env, c);
  await c.settle();
  assert.deepEqual(subjects(env), ['[merecatholicity] Backup missing: ' + TODAY_KEY() + ' (+1 more)']);
  assert.match(env.emails[0].text, /Backup missing: backups\/comments-[0-9-]+\.sql\.gz\nThe backup object .* is not in the bucket/);
  assert.match(env.emails[0].text, /\n\nCron stale: hourly\nThe hourly cron last beat 4 hours ago/);
  assert.deepEqual(state(db, 'ops_alert_state').open, ['backup_missing:' + TODAY_KEY(), 'cron_stale:hourly']);
  assert.ok(state(db, 'ops_heartbeat').usage >= now, 'the usage chain beat');
  /* a recorded failure for today's key reads as failed, not missing */
  setState(db, 'ops_backup', { at: now, key: TODAY_KEY(), error: 'R2 put: 500' });
  found = await runSelfCheck(env);
  assert.deepEqual(found.map((c) => c.kind), ['backup_failed', 'cron_stale']);
  assert.equal(found[0].detail, 'R2 put: 500');
  /* the object appears and the hourly beats again: recovered, once */
  setState(db, 'ops_backup', { at: now, key: TODAY_KEY(), bytes: 2000 });
  await env.BACKUPS.put(TODAY_KEY(), new Uint8Array(2000));
  const hb = state(db, 'ops_heartbeat'); hb.hourly = now; setState(db, 'ops_heartbeat', hb);
  const c2 = ctx();
  await worker.scheduled({ cron: '30 23 * * *' }, env, c2);
  await c2.settle();
  assert.deepEqual(subjects(env).slice(1), ['[merecatholicity] Recovered: backup_missing:' + TODAY_KEY() + ' (+1 more)']);
  assert.deepEqual(state(db, 'ops_alert_state').open, []);
  /* a too-small object is no backup */
  await env.BACKUPS.put(TODAY_KEY(), new Uint8Array(100));
  found = await runSelfCheck(env);
  assert.deepEqual(found.map((c) => c.kind), ['backup_missing']);
  db.close();
});

test('the health read: stale, never, the object, and ok as the outside watchdog\'s verdict', async () => {
  const db = seeded();
  const now = Math.floor(Date.now() / 1000);
  setState(db, 'ops_heartbeat', { daily: now - 30 * 3600, hourly: now - 60, usage: now - 60, monthly: now - 60 });
  const env = makeEnv({ db });
  let h = await readOps(env);
  assert.deepEqual([h.ok, h.stale, h.never, h.backup_ok, h.object], [false, ['daily'], [], false, null]);
  const daily = h.heartbeat.find((x) => x.name === 'daily');
  assert.deepEqual([daily.stale, daily.stale_after, daily.age >= 30 * 3600], [true, 26 * 3600, true]);
  /* yesterday's object counts for the panel's truth */
  const y = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  await env.BACKUPS.put('backups/comments-' + y + '.sql.gz', new Uint8Array(4000));
  setState(db, 'ops_heartbeat', { daily: now - 60, hourly: now - 60, usage: now - 60, monthly: now - 60 });
  h = await readOps(env);
  assert.deepEqual([h.ok, h.stale, h.backup_ok, h.object.key], [true, [], true, 'backups/comments-' + y + '.sql.gz']);
  setState(db, 'ops_alert_state', { open: ['step_failed:monthly/pruneComments'], at: now });
  h = await readOps(env);
  assert.deepEqual([h.ok, h.open], [false, ['step_failed:monthly/pruneComments']], 'an open condition is not ok');
  db.close();
});

test('the report door: the nightly\'s key (from any origin) probes the health and stores the nightly webtest, a regression alerts; the admin health door', async () => {
  const db = seeded();
  const env = makeEnv({ db, vars: { OPS_REPORT_KEY: 'report-secret', ADMIN_HASHES: adm.hash } });
  /* the pipeline's shape: a curl from a runner — no Origin — at the workers.dev front door */
  const DEV = { origin: null, host: 'https://merecatholicity-comments.support-609.workers.dev' };
  let r = await call(worker, env, 'POST', '/api/comments/ops/report', { key: 'nope', probe: true }, DEV);
  assert.deepEqual([r.status, r.json.error], [403, 'No.']);
  r = await call(worker, env, 'POST', '/api/comments/dm/unread', { key: 'report-secret' }, DEV);
  assert.equal(r.status, 404, 'the front door opens onto the ingest doors alone');
  r = await call(worker, env, 'POST', '/api/comments/ops/report', { key: 'report-secret', probe: true }, DEV);
  assert.equal(r.status, 200, 'the report door is a pipeline door: reachable where the librarian\'s pipeline is');
  assert.equal(typeof r.json.health.ok, 'boolean');
  assert.equal(r.json.health.heartbeat.length, 4);
  r = await call(worker, env, 'POST', '/api/comments/ops/report', { key: 'report-secret', source: 'webtest', pass: 30, fail: 0, suites: ['worker_reads', 'audit'], regressions: [] });
  assert.deepEqual([r.status, r.json.stored, r.json.alerted], [200, true, false]);
  assert.deepEqual(env.emails.length, 0, 'a clean night says nothing');
  r = await call(worker, env, 'POST', '/api/comments/ops/report', { key: 'report-secret', source: 'webtest', pass: 29, fail: 1, suites: ['worker_reads'], regressions: ['test_worker_reads: config apiVersion FAIL'] });
  assert.deepEqual([r.status, r.json.alerted], [200, true]);
  assert.deepEqual(subjects(env), ['[merecatholicity] Nightly webtest: 1 regression']);
  assert.match(env.emails[0].text, /config apiVersion FAIL/);
  const w = state(db, 'ops_webtest');
  assert.deepEqual([w.pass, w.fail, w.regressions], [29, 1, ['test_worker_reads: config apiVersion FAIL']]);
  r = await call(worker, env, 'POST', '/api/comments/ops/report', { key: 'report-secret' });
  assert.equal(r.status, 400, 'neither a probe nor a report');
  /* the admin's health card */
  r = await call(worker, env, 'POST', '/api/comments/admin/health', { key: adm.key });
  assert.equal(r.status, 200);
  assert.equal(r.json.health.webtest.fail, 1);
  const other = await identity('not-an-admin');
  r = await call(worker, env, 'POST', '/api/comments/admin/health', { key: other.key });
  assert.equal(r.status, 403);
  db.close();
});
