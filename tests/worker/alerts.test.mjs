/* The worker's voice (2026-09-16): alerts go out by email, by Discord and as a
 * merecat DM to every admin (2026-09-19) — all three from Platform settings,
 * and the owner picks any of them. Run
 * through the doors on the real ledger: the settings door refuses a bad
 * address or webhook and clears with '', the test door sends through exactly
 * the channels the stored settings open and reports what each said, and a
 * refused mail or a dead webhook is a line in `errors`, never a 500.
 *
 * What would break silently: an alert counted as sent to an empty field; the
 * switch read backwards (an owner who turned email off still mailed); a typo
 * accepted at the door and discovered at the first real alert; a refused
 * destination swallowed as success; the address leaking into /config; and —
 * the 2026-09-19 reason for the DM channel — an alert road that reaches only
 * SOME of the channels the owner believes are open, so a dead cron is told by
 * email while the owner watches their bot inbox. */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadWorker, makeEnv, client, freshDb, identity, resetCaches, netSpy, call } from '../_support/worker.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const lib = readFileSync(join(root, 'comments-worker', 'src', 'lib.ts'), 'utf8');
/* the sender, read from the source so this test cannot drift from it */
const MERECAT = (lib.match(/export const MERECAT_BOT = \{\s*\n\s*hash: '([0-9a-f]{64})'/) || [])[1];

let worker, adm, net;
const HOOK = 'https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-_';
before(async () => {
  ({ worker } = await loadWorker());
  adm = await identity('the-admin');
  /* the webhook answers 204 unless a test swaps the responder */
  net = netSpy((url) => new Response(null, { status: url.indexOf('discord.com') !== -1 ? 204 : 500 }));
});
after(() => net.restore());
beforeEach(() => { resetCaches(); net.calls.length = 0; });

function seeded(settings = {}) {
  const db = freshDb();
  const ins = db.prepare("INSERT INTO app_settings (k, v, updated_at, updated_by) VALUES (?, ?, 1, 'test')");
  for (const [k, v] of Object.entries(settings)) ins.run(k, v);
  return db;
}
const hooks = () => net.calls.filter((c) => c.url.indexOf('discord.com') !== -1);

test('the settings door: a bad address or webhook is refused with its own sentence; a good one is stored; an empty one clears', async () => {
  const db = seeded();
  const api = client(worker, makeEnv({ db, vars: { ADMIN_HASHES: adm.hash } }));
  let r = await api.post('/api/comments/admin/settings', { key: adm.key, set: { alert_email: 'owner@example' } });
  assert.deepEqual([r.status, r.json.error], [400, 'That is not a valid email address.']);
  r = await api.post('/api/comments/admin/settings', { key: adm.key, set: { alert_discord_webhook: 'https://evil.example/hook' } });
  assert.deepEqual([r.status, r.json.error], [400, 'That is not a valid Discord webhook URL.']);
  r = await api.post('/api/comments/admin/settings', { key: adm.key, set: { alert_email: '  owner@example.org ', alert_discord_webhook: HOOK, alert_email_on: 'true', alert_discord_on: '0' } });
  assert.equal(r.status, 200);
  assert.deepEqual([r.json.settings.alert_email, r.json.settings.alert_discord_webhook, r.json.settings.alert_email_on, r.json.settings.alert_discord_on],
    ['owner@example.org', HOOK, '1', '0'], 'trimmed, stored, the switches normalised to 1/0');
  r = await api.post('/api/comments/admin/settings', { key: adm.key, set: { alert_email: '', alert_discord_webhook: '' } });
  assert.deepEqual([r.json.settings.alert_email, r.json.settings.alert_discord_webhook], ['', ''], 'empty clears');
  assert.deepEqual([r.json.settings.alert_email_on, r.json.settings.alert_discord_on], ['1', '0'], 'the switches keep their state');
  db.close();
});

test('the test door sends through exactly the channels the settings open — both, email alone, Discord alone, none — and says which', async () => {
  /* the DM is on by default and its field is the roster, so it rides every
     case that does not switch it off */
  const cases = [
    { set: { alert_email: 'owner@example.org', alert_discord_webhook: HOOK }, want: ['email', 'discord', 'dm'] },
    { set: { alert_email: 'owner@example.org', alert_discord_webhook: '' }, want: ['email', 'dm'] },
    { set: { alert_email: 'owner@example.org', alert_discord_webhook: HOOK, alert_discord_on: '0' }, want: ['email', 'dm'] },
    { set: { alert_email: '', alert_discord_webhook: HOOK }, want: ['discord', 'dm'] },
    { set: { alert_email: 'owner@example.org', alert_email_on: '0', alert_discord_webhook: HOOK }, want: ['discord', 'dm'] },
    { set: { alert_email: 'owner@example.org', alert_email_on: '0', alert_discord_webhook: HOOK, alert_discord_on: '0' }, want: ['dm'] },
    { set: {}, want: ['dm'] },
    { set: { alert_email: 'owner@example.org', alert_discord_webhook: HOOK, alert_dm_on: '0' }, want: ['email', 'discord'] },
    { set: { alert_email_on: '0', alert_dm_on: '0' }, want: [], note: 'every switch off: silent, whatever the roster holds' },
  ];
  for (const c of cases) {
    resetCaches(); net.calls.length = 0;
    const db = seeded(c.set);
    const env = makeEnv({ db, vars: { ADMIN_HASHES: adm.hash } });
    const r = await call(worker, env, 'POST', '/api/comments/admin/alert-test', { key: adm.key });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual(r.json.channels, c.want, JSON.stringify(c.set));
    assert.deepEqual([r.json.email, r.json.discord], [c.want.indexOf('email') !== -1, c.want.indexOf('discord') !== -1]);
    assert.equal(r.json.dm, c.want.indexOf('dm') !== -1 ? 1 : 0, 'the one admin was DMed iff dm is a channel');
    assert.deepEqual(r.json.errors, []);
    assert.equal(env.emails.length, c.want.indexOf('email') !== -1 ? 1 : 0, 'a mail went out iff email is a channel');
    assert.equal(hooks().length, c.want.indexOf('discord') !== -1 ? 1 : 0, 'the webhook was posted iff Discord is a channel');
    if (env.emails.length) {
      const m = env.emails[0];
      assert.equal(m.to, 'owner@example.org');
      assert.deepEqual(m.from, { email: 'alerts@merecatholicity.com', name: 'merecatholicity.com' });
      assert.equal(m.subject, '[merecatholicity] Test alert');
      assert.match(m.text, /A test alert from merecatholicity\.com, sent by /);
    }
    if (hooks().length) {
      const body = JSON.parse(hooks()[0].init.body);
      assert.equal(body.embeds[0].title, 'Test alert');
      assert.deepEqual(body.allowed_mentions, { parse: [] }, 'an alert can never ping the channel');
    }
    db.close();
  }
});

test('a refused mail or a dead webhook is a line in errors, never a 500; a missing binding says so', async () => {
  const db = seeded({ alert_email: 'owner@example.org', alert_discord_webhook: HOOK });
  let env = makeEnv({ db, vars: { ADMIN_HASHES: adm.hash }, emailFail: 'destination address not verified' });
  let r = await call(worker, env, 'POST', '/api/comments/admin/alert-test', { key: adm.key });
  assert.equal(r.status, 200);
  assert.deepEqual([r.json.email, r.json.discord], [false, true]);
  assert.deepEqual(r.json.errors, ['email: test_refused destination address not verified'], 'the code and the message reach the admin');
  /* the webhook answers 500 */
  resetCaches();
  net.restore();
  net = netSpy(() => new Response(null, { status: 500 }));
  env = makeEnv({ db, vars: { ADMIN_HASHES: adm.hash } });
  r = await call(worker, env, 'POST', '/api/comments/admin/alert-test', { key: adm.key });
  assert.deepEqual([r.status, r.json.email, r.json.discord, r.json.errors], [200, true, false, ['discord: the webhook did not accept the post']]);
  net.restore();
  net = netSpy((url) => new Response(null, { status: url.indexOf('discord.com') !== -1 ? 204 : 500 }));
  /* no send_email binding at all */
  resetCaches();
  env = makeEnv({ db, vars: { ADMIN_HASHES: adm.hash }, email: false });
  r = await call(worker, env, 'POST', '/api/comments/admin/alert-test', { key: adm.key });
  assert.deepEqual([r.status, r.json.email, r.json.errors[0]], [200, false, 'email: the worker has no send_email binding']);
  db.close();
});

test('the door is admin-only, and the address never rides the public config', async () => {
  const db = seeded({ alert_email: 'owner@example.org', alert_discord_webhook: HOOK });
  const env = makeEnv({ db, vars: { ADMIN_HASHES: adm.hash } });
  const other = await identity('not-an-admin');
  let r = await call(worker, env, 'POST', '/api/comments/admin/alert-test', { key: other.key });
  assert.deepEqual([r.status, r.json.error], [403, 'No.']);
  assert.equal(env.emails.length, 0);
  r = await call(worker, env, 'GET', '/api/comments/config');
  assert.equal(r.status, 200);
  assert.equal(JSON.stringify(r.json).indexOf('owner@example.org'), -1, 'the owner\'s address is the admin panel\'s alone');
  assert.equal(JSON.stringify(r.json).indexOf('webhooks/123456789012345678'), -1);
  db.close();
});

test('the alert reaches EVERY admin as a merecat DM — the table governs, merecat is never told, and one unreachable seat does not cost the others theirs', async () => {
  assert.match(String(MERECAT), /^[0-9a-f]{64}$/, 'the sender was read from lib.ts');
  const second = await identity('the-other-admin');
  /* email and Discord off, so the DM is the only channel and the count is its own */
  const db = seeded({ alert_email_on: '0', alert_discord_on: '0' });
  const addAdmin = db.prepare("INSERT INTO admins (hash, added_by, created_at) VALUES (?, 'test', 1)");
  for (const h of [adm.hash, second.hash, MERECAT]) addAdmin.run(h);
  const env = makeEnv({ db, vars: { ADMIN_HASHES: adm.hash } });
  const r = await call(worker, env, 'POST', '/api/comments/admin/alert-test', { key: adm.key });
  assert.deepEqual([r.status, r.json.channels, r.json.errors], [200, ['dm'], []]);
  assert.equal(r.json.dm, 2, 'both human admins were told; the bot is the sender, never a recipient');
  const said = db.prepare(
    'SELECT d.body AS body, m.hash AS reader FROM dms d JOIN dm_members m ON m.thread_id = d.thread_id ' +
    'WHERE d.sender_hash = ? AND m.hash != ?').all(MERECAT, MERECAT);
  assert.deepEqual(said.map((x) => x.reader).sort(), [adm.hash, second.hash].sort(), 'one line each, to the two of them');
  for (const row of said) {
    assert.match(row.body, /^Automated notice — Test alert\n\n/, 'the subject leads the line and it says it is automated');
    assert.match(row.body, /A test alert from merecatholicity\.com, sent by /, 'and carries the alert\'s own words');
  }
  db.close();
});

test('the roster falls back to the env owners only while the table is empty — the console\'s removals are obeyed', async () => {
  const second = await identity('removed-later');
  let db = seeded({ alert_email_on: '0', alert_discord_on: '0' });
  /* no rows in admins: the bootstrap owners are who there is to tell */
  let env = makeEnv({ db, vars: { ADMIN_HASHES: adm.hash + ',' + second.hash } });
  let r = await call(worker, env, 'POST', '/api/comments/admin/alert-test', { key: adm.key });
  assert.deepEqual([r.json.channels, r.json.dm], [['dm'], 2], 'a platform nobody has seeded still reaches its owners');
  db.close();
  /* the table, once it has anyone in it, is the whole roster */
  resetCaches();
  db = seeded({ alert_email_on: '0', alert_discord_on: '0' });
  db.prepare("INSERT INTO admins (hash, added_by, created_at) VALUES (?, 'test', 1)").run(adm.hash);
  env = makeEnv({ db, vars: { ADMIN_HASHES: adm.hash + ',' + second.hash } });
  r = await call(worker, env, 'POST', '/api/comments/admin/alert-test', { key: adm.key });
  assert.deepEqual([r.json.channels, r.json.dm], [['dm'], 1], 'the env owner who is not in the table is not told');
  db.close();
});
