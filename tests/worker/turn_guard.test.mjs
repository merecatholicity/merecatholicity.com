/* The TURN guard (2026-09-17): the relay switches itself off at the admin's
 * line of the month's free pool, and on again when the month renews.
 *
 * What would break silently: Realtime TURN is free for 1,000 GB of relayed
 * egress a month and then bills per GB with no cap; `calls_turn` is the only
 * brake, and nobody watches the meter at night. A guard that never trips,
 * trips on a missing reading, restores what an admin switched off, or leaves
 * the relay off for ever after a busy month would look exactly like a quiet
 * one. So: RUN the usage chain's step against a stubbed analytics API, the
 * monthly rollover across a month boundary, the settings door's coercion, and
 * /call/turn before and after the switch. The rule is Domain.Call's
 * (tests/purescript/call.test.mjs). */
import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadWorker, makeEnv, freshDb, identity, establish, resetCaches, call, ctx, netSpy } from '../_support/worker.mjs';
import { turnGuard, runTurnGuard, turnGuardRollover } from '../../comments-worker/src/usage.ts';
import { GB } from '../../comments-worker/src/usagecalc.ts';

const SEPT = Date.UTC(2026, 8, 17, 23, 30);
const OCT_FIRST = Date.UTC(2026, 9, 1, 0, 0, 5);
let worker, adm, member, net, relayed, logs, log;

before(async () => {
  ({ worker } = await loadWorker());
  adm = await identity('turn-guard-admin');
  member = await identity('turn-guard-member');
});
beforeEach(() => {
  resetCaches();
  relayed = 0;
  net = netSpy((url, init) => {
    if (url === 'https://api.cloudflare.com/client/v4/graphql') {
      const q = JSON.parse(init.body).query;
      /* the relay's dataset; the usage page's other products are not this test's */
      if (relayed == null || !/callsTurnUsageAdaptiveGroups\(limit: 1000, filter: \{date_geq: "\d{4}-\d{2}-01"\}\)/.test(q)) {
        return Response.json({ errors: [{ message: 'analytics down' }] });
      }
      return Response.json({ data: { viewer: { accounts: [{ callsTurnUsageAdaptiveGroups: [{ sum: { egressBytes: relayed } }] }] } } });
    }
    if (url.startsWith('https://rtc.live.cloudflare.com/')) {
      return Response.json({ iceServers: { urls: ['turn:turn.cloudflare.com:3478'], username: 'u', credential: 'c' } });
    }
    throw new Error('the network was reached from a test: ' + url);
  });
  logs = [];
  log = console.log;
  console.log = (...a) => { logs.push(a.map(String).join(' ')); };
});
afterEach(() => { net.restore(); console.log = log; });

function env(settings = {}, vars = {}) {
  const db = freshDb();
  /* the owner's channel, so a told alert is a mail the test can read */
  for (const [k, v] of Object.entries({ alert_email: 'owner@example.org', ...settings })) {
    db.prepare("INSERT INTO app_settings (k, v, updated_at, updated_by) VALUES (?, ?, 1, 'test')").run(k, v);
  }
  establish(db, member.hash);
  return makeEnv({ db, vars: { CF_USAGE_TOKEN: 'usage-token-for-the-test', CF_ACCOUNT_ID: 'acct', ADMIN_HASHES: adm.hash,
    TURN_KEY_ID: 'turn-key-id', TURN_KEY_SECRET: 'turn-key-secret-for-the-test', ...vars } });
}
const setting = async (e, k) => {
  const r = await e.DB.prepare('SELECT v, updated_by FROM app_settings WHERE k = ?').bind(k).first();
  return r ? r.v : null;
};
const events = () => logs.filter((l) => l.includes('"event":"turn_guard"')).map((l) => JSON.parse(l));

test('at the line the relay is switched off, the month remembered, the owner told — and /call/turn serves STUN only', async () => {
  const e = env();
  let r = await call(worker, e, 'POST', '/api/comments/call/turn', { key: member.key });
  assert.deepEqual([r.status, r.json.relay], [200, true], 'the relay serves before the line');
  relayed = 949 * GB;
  await runTurnGuard(e);
  assert.equal(await setting(e, 'calls_turn'), null, 'under the line nothing is written');
  assert.equal(e.emails.length, 0);
  relayed = 951 * GB;
  await runTurnGuard(e);
  assert.equal(await setting(e, 'calls_turn'), '0');
  const row = await e.DB.prepare("SELECT updated_by FROM app_settings WHERE k = 'calls_turn'").first();
  assert.equal(row.updated_by, 'turn-guard', 'the switch says who threw it');
  const st = JSON.parse(await setting(e, 'turn_guard_state'));
  assert.equal(st.month, new Date().toISOString().slice(0, 7));
  assert.deepEqual([st.pct, st.used, st.limit], [95, 951 * GB, 1000 * GB]);
  assert.equal(e.emails.length, 1);
  assert.match(e.emails[0].subject, /TURN relay switched off at 95\.1% of the month's free pool/);
  assert.match(e.emails[0].text, /951\.0 GB of the 1000\.0 GB/);
  assert.match(e.emails[0].text, /switch the guard off, then the relay on/);
  assert.match(e.emails[0].text, /leaked TURN key/);
  r = await call(worker, e, 'POST', '/api/comments/call/turn', { key: member.key });
  assert.deepEqual([r.status, r.json.relay], [200, false], 'the brake holds at once in this isolate');
  assert.equal(net.calls.filter((c) => c.url.startsWith('https://rtc.live')).length, 1, 'no credential minted after the switch');
  /* a second night past the line: nothing more, nothing told */
  relayed = 990 * GB;
  await runTurnGuard(e);
  assert.equal(e.emails.length, 1);
  assert.deepEqual(events().map((x) => x.act), ['trip']);
});

test('the new month switches back on only what the guard switched off, and only once the month has turned', async () => {
  const e = env();
  await turnGuard(e, { used: 960 * GB, limit: 1000 * GB }, SEPT);
  assert.equal(await setting(e, 'calls_turn'), '0');
  assert.equal(await turnGuardRollover(e, SEPT + 60_000), 'stay');
  assert.equal(await setting(e, 'calls_turn'), '0', 'the same month: still off');
  assert.equal(await turnGuardRollover(e, OCT_FIRST), 'restore');
  assert.equal(await setting(e, 'calls_turn'), '1');
  assert.equal(await setting(e, 'turn_guard_state'), null, 'the memory is spent');
  assert.equal(e.emails.length, 1, 'the restore tells nobody: nothing to act on');
  /* an admin's own switch-off is never the guard's to undo */
  const mine = env({ calls_turn: '0' });
  assert.equal(await turnGuard(mine, null, OCT_FIRST), 'stay');
  assert.equal(await turnGuard(mine, { used: 999 * GB, limit: 1000 * GB }, OCT_FIRST), 'stay');
  assert.equal(await setting(mine, 'calls_turn'), '0');
});

test('an admin who switches the relay back on is not overruled that night, but the line still holds after', async () => {
  const e = env();
  await turnGuard(e, { used: 960 * GB, limit: 1000 * GB }, SEPT);
  await e.DB.prepare("UPDATE app_settings SET v = '1', updated_by = 'an-admin' WHERE k = 'calls_turn'").run();
  assert.equal(await turnGuard(e, { used: 970 * GB, limit: 1000 * GB }, SEPT), 'forget');
  assert.equal(await setting(e, 'calls_turn'), '1');
  assert.equal(await setting(e, 'turn_guard_state'), null);
  assert.equal(await turnGuard(e, { used: 971 * GB, limit: 1000 * GB }, SEPT + 86_400_000), 'trip', 'the guard is on: the next night trips again');
  /* switched off, the guard does nothing: that is how the relay is kept on past the line */
  const off = env({ turn_guard_on: '0' });
  assert.equal(await turnGuard(off, { used: 1400 * GB, limit: 1000 * GB }, SEPT), 'stay');
  assert.equal(await setting(off, 'calls_turn'), null);
  /* the admin's own line */
  const low = env({ turn_guard_pct: '50' });
  assert.equal(await turnGuard(low, { used: 499 * GB, limit: 1000 * GB }, SEPT), 'stay');
  assert.equal(await turnGuard(low, { used: 500 * GB, limit: 1000 * GB }, SEPT), 'trip');
});

test('no meter, no read; a meter that cannot be read fails the step, never trips', async () => {
  const bare = env({}, { CF_USAGE_TOKEN: undefined });
  await runTurnGuard(bare);
  assert.equal(net.calls.length, 0, 'nothing to read without the token');
  const e = env();
  relayed = null;
  await assert.rejects(runTurnGuard(e), /analytics down/);
  assert.equal(await setting(e, 'calls_turn'), null);
  assert.equal(await turnGuard(e, null, SEPT), 'stay', 'no reading is no trip');
});

test('the chains run it: the 23:30 usage chain trips, the monthly chain restores', async () => {
  const e = env();
  relayed = 999 * GB;
  const c = ctx();
  await worker.scheduled({ cron: '30 23 * * *' }, e, c);
  await c.settle();
  assert.equal(await setting(e, 'calls_turn'), '0');
  assert.ok(e.emails.some((m) => /TURN relay switched off/.test(m.subject)));
  /* pretend the trip was last month's; the 1st's chain puts the relay back */
  await e.DB.prepare("UPDATE app_settings SET v = '{\"month\":\"2020-01\"}' WHERE k = 'turn_guard_state'").run();
  const c2 = ctx();
  await worker.scheduled({ cron: '0 0 1 * *' }, e, c2);
  await c2.settle();
  assert.equal(await setting(e, 'calls_turn'), '1');
});

test('the settings door: the guard is default-on (only an explicit no is off), the line clamped by the kernel', async () => {
  const e = env();
  let r = await call(worker, e, 'POST', '/api/comments/admin/settings', { key: adm.key });
  assert.deepEqual([r.json.settings.turn_guard_on, r.json.settings.turn_guard_pct], ['1', '95'], 'the defaults are served');
  for (const [on, pct, wantOn, wantPct] of [['0', '80', '0', '80'], ['garbage', '150', '1', '99'], ['false', 'abc', '0', '95'], ['1', '3', '1', '10']]) {
    r = await call(worker, e, 'POST', '/api/comments/admin/settings', { key: adm.key, set: { turn_guard_on: on, turn_guard_pct: pct } });
    assert.equal(r.status, 200);
    assert.deepEqual([r.json.settings.turn_guard_on, r.json.settings.turn_guard_pct], [wantOn, wantPct], on + ' / ' + pct);
  }
  r = await call(worker, e, 'POST', '/api/comments/admin/settings', { key: adm.key, set: { turn_guard_state: '{"month":"2026-09"}' } });
  assert.equal(await setting(e, 'turn_guard_state'), null, 'the memory is the guard\'s, never the door\'s');
});
