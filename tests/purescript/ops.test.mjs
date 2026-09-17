/* Domain.Ops — whom the worker tells, and how it knows something is wrong.
 *
 * The rules exist because the platform logged failures nobody read and backed
 * itself up once a month with no word when it did not (the 2026-09-16
 * review). What would break silently: the channel rule reading an empty field
 * as a channel (an alert "sent" to nobody, counted as sent); the prune keeping
 * daily objects for ever or dropping the monthly history; a never-beaten
 * heartbeat alerting on the first deploy; the fold re-alerting every run while
 * a condition stands (the owner mutes the channel and the next real alert is
 * lost). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Ops from '../../purescript/output/Domain.Ops/index.js';
import * as Maybe from '../../purescript/output/Data.Maybe/index.js';

const just = (m) => (m instanceof Maybe.Just ? m.value0 : null);

test('an email address is one @, no whitespace, two non-empty labels, at most 254 chars', () => {
  for (const ok of ['owner@example.org', 'a.b+tag@sub.example.co.uk', 'x@y.z'])
    assert.equal(Ops.isEmailAddress(ok), true, ok);
  for (const bad of ['', 'owner', 'owner@', '@example.org', 'owner@example', 'owner@.org', 'owner@example.',
    'owner@exa mple.org', 'ow ner@example.org', 'a@@b.c', 'a@b..c', 'a@b.c\n', 'x'.repeat(250) + '@e.io'])
    assert.equal(Ops.isEmailAddress(bad), false, JSON.stringify(bad));
});

test('the channel rule: on AND valid is live; empty, invalid or off is silent; both on is both', () => {
  const ch = (emailOn, emailOk, discordOn, discordOk) => Ops.channelsFrom({ emailOn, emailOk, discordOn, discordOk });
  assert.deepEqual(ch('1', true, '1', true), ['email', 'discord']);
  assert.deepEqual(ch('1', true, '1', false), ['email'], 'an empty or invalid webhook is no channel');
  assert.deepEqual(ch('1', false, '1', true), ['discord'], 'an empty or invalid address is no channel');
  assert.deepEqual(ch('0', true, '1', true), ['discord'], 'the email switch off keeps the address but says nothing');
  assert.deepEqual(ch('1', true, '0', true), ['email']);
  assert.deepEqual(ch('0', true, '0', true), [], 'both off: silent, whatever the fields hold');
  assert.deepEqual(ch('', true, 'true', true), [], 'only the literal 1 is on — the polarity of every other admin switch');
  assert.equal(Ops.switchOn('1'), true);
  assert.equal(Ops.switchOn('true'), false);
});

test('the backup key round-trips its day, and the prune keeps 90 days, first-of-month 400, and anything it does not recognise', () => {
  assert.equal(Ops.backupKey('2026-09-16'), 'backups/comments-2026-09-16.sql.gz');
  assert.equal(just(Ops.dayOfKey('backups/comments-2026-09-16.sql.gz')), '2026-09-16');
  assert.equal(just(Ops.dayOfKey('backups/comments-2026-09-01.sql.gz')), '2026-09-01', 'the monthly objects from before are first-of-month objects under this rule');
  assert.equal(just(Ops.dayOfKey('avatars/abc.png')), null);
  assert.equal(just(Ops.dayOfKey('backups/comments-2026-9-1.sql.gz')), null, 'a malformed day is not ours');
  const keep = (key, ageDays) => Ops.keepBackup({ key, ageDays });
  assert.equal(keep('backups/comments-2026-09-16.sql.gz', 89), true);
  assert.equal(keep('backups/comments-2026-09-16.sql.gz', 90), true);
  assert.equal(keep('backups/comments-2026-09-16.sql.gz', 91), false);
  assert.equal(keep('backups/comments-2026-09-01.sql.gz', 91), true, 'the first of the month lives on');
  assert.equal(keep('backups/comments-2026-09-01.sql.gz', 400), true);
  assert.equal(keep('backups/comments-2026-09-01.sql.gz', 401), false);
  assert.equal(keep('avatars/abc.png', 10_000), true, 'the prune deletes only what the rule names');
  assert.equal(Ops.keepDays, 90);
  assert.equal(Ops.keepMonthlyDays, 400);
  assert.equal(Ops.minBackupBytes, 1024);
});

test('a heartbeat is stale after its period plus slack; one that never beat is not stale', () => {
  assert.equal(Ops.staleAfter('hourly'), 3 * 3600);
  assert.equal(Ops.staleAfter('daily'), 26 * 3600);
  assert.equal(Ops.staleAfter('usage'), 26 * 3600);
  assert.equal(Ops.staleAfter('monthly'), 33 * 86400);
  assert.equal(Ops.staleAfter('unknown'), 26 * 3600);
  const now = 1_800_000_000;
  assert.equal(Ops.isStale({ name: 'hourly', last: now - 3 * 3600, now }), false, 'at the boundary: not yet');
  assert.equal(Ops.isStale({ name: 'hourly', last: now - 3 * 3600 - 1, now }), true);
  assert.equal(Ops.isStale({ name: 'monthly', last: now - 40 * 86400, now }), true);
  assert.equal(Ops.isStale({ name: 'monthly', last: 0, now }), false, 'never beaten: the first beat starts the clock');
});

test('conditions have a key for coalescing and a sentence for a human', () => {
  const miss = Ops.backupMissing('backups/comments-2026-09-16.sql.gz');
  assert.equal(Ops.conditionKey(miss), 'backup_missing:backups/comments-2026-09-16.sql.gz');
  assert.equal(Ops.conditionSubject(miss), 'Backup missing: backups/comments-2026-09-16.sql.gz');
  assert.match(Ops.conditionText(miss), /not in the bucket/);
  const failed = Ops.backupFailed('backups/comments-2026-09-16.sql.gz')('R2 put: 500');
  assert.equal(Ops.conditionSubject(failed), 'Backup failed: backups/comments-2026-09-16.sql.gz');
  assert.match(Ops.conditionText(failed), /R2 put: 500/);
  const stale = Ops.cronStale('hourly')(4 * 3600);
  assert.equal(Ops.conditionKey(stale), 'cron_stale:hourly');
  assert.match(Ops.conditionText(stale), /last beat 4 hours ago; it is presumed dead after 3 hours/);
  const step = Ops.stepFailed('monthly')('pruneComments')('D1_ERROR');
  assert.equal(Ops.conditionKey(step), 'step_failed:monthly/pruneComments');
  assert.match(Ops.conditionText(step), /threw: D1_ERROR\. The other steps of its chain still ran/);
  assert.equal(Ops.recoveredSubject('cron_stale:hourly'), 'Recovered: cron_stale:hourly');
  assert.match(Ops.recoveredText('cron_stale:hourly'), /no longer present/);
});

test('the fold fires a condition once when it opens, clears it once when it closes, and says nothing while it stands', () => {
  const miss = Ops.backupMissing('backups/comments-2026-09-16.sql.gz');
  const stale = Ops.cronStale('hourly')(4 * 3600);
  /* day 1: two new conditions */
  let r = Ops.foldOpsAlerts({ open: [], conditions: [miss, stale, stale] });
  assert.deepEqual(r.fire.map(Ops.conditionKey), [Ops.conditionKey(miss), Ops.conditionKey(stale)], 'each fires once, the duplicate finding folded');
  assert.deepEqual(r.clear, []);
  assert.deepEqual(r.open, ['backup_missing:backups/comments-2026-09-16.sql.gz', 'cron_stale:hourly'], 'canonical: sorted, deduplicated');
  /* day 2: both still standing — silence */
  r = Ops.foldOpsAlerts({ open: r.open, conditions: [stale, miss] });
  assert.deepEqual(r.fire, []);
  assert.deepEqual(r.clear, []);
  /* day 3: the backup is back, the cron still dead */
  r = Ops.foldOpsAlerts({ open: r.open, conditions: [stale] });
  assert.deepEqual(r.fire, []);
  assert.deepEqual(r.clear, ['backup_missing:backups/comments-2026-09-16.sql.gz'], 'recovered once');
  assert.deepEqual(r.open, ['cron_stale:hourly']);
  /* day 4: all well */
  r = Ops.foldOpsAlerts({ open: r.open, conditions: [] });
  assert.deepEqual(r.clear, ['cron_stale:hourly']);
  assert.deepEqual(r.open, []);
  /* a quiet run on a quiet state says nothing at all */
  r = Ops.foldOpsAlerts({ open: [], conditions: [] });
  assert.deepEqual([r.fire, r.clear, r.open], [[], [], []]);
});

test('a chain judges only what it can observe: its own step failures, and the backup and staleness conditions when it ran the self-check', () => {
  const daily = Ops.alertScope({ chain: 'daily', selfCheck: true });
  const hourly = Ops.alertScope({ chain: 'hourly', selfCheck: false });
  assert.equal(daily('step_failed:daily/runBackup'), true);
  assert.equal(daily('step_failed:hourly/sweepExpiredDms'), false, 'another chain\'s failure is not the daily\'s to clear');
  assert.equal(daily('backup_missing:backups/comments-2026-09-16.sql.gz'), true);
  assert.equal(daily('backup_failed:backups/comments-2026-09-16.sql.gz'), true);
  assert.equal(daily('cron_stale:hourly'), true);
  assert.equal(hourly('step_failed:hourly/sweepExpiredDms'), true);
  assert.equal(hourly('backup_missing:backups/comments-2026-09-16.sql.gz'), false, 'the hourly ran no self-check: the missing backup is not its to recover');
  assert.equal(hourly('cron_stale:daily'), false);
  assert.equal(hourly('step_failed:hourlyx/other'), false, 'the prefix is the chain and the slash, not a substring');
});

test('a run\'s digest names the first condition and how many more; every sentence is in the body', () => {
  const miss = Ops.backupMissing('backups/comments-2026-09-16.sql.gz');
  const stale = Ops.cronStale('hourly')(4 * 3600);
  let d = Ops.digest([miss]);
  assert.equal(d.subject, 'Backup missing: backups/comments-2026-09-16.sql.gz');
  assert.match(d.text, /^Backup missing: backups\/comments-2026-09-16\.sql\.gz\nThe backup object/);
  d = Ops.digest([miss, stale]);
  assert.equal(d.subject, 'Backup missing: backups/comments-2026-09-16.sql.gz (+1 more)');
  assert.match(d.text, /\n\nCron stale: hourly\nThe hourly cron last beat 4 hours ago/);
  assert.deepEqual(Ops.digest([]), { subject: '', text: '' });
  const r = Ops.recoveredDigest(['cron_stale:hourly', 'backup_missing:x']);
  assert.equal(r.subject, 'Recovered: cron_stale:hourly (+1 more)');
  assert.equal(r.text, 'The condition cron_stale:hourly is no longer present.\nThe condition backup_missing:x is no longer present.');
});


/* The egress guard's notes (2026-09-17, comments-worker/src/egress.ts). What
   would break silently: a leak attempt told on every request (the owner mutes
   the channel), or never told again while it continues; a note that never
   stops keeping the health verdict red; an alert that carries a secret's
   value; a short secret the scan cannot see and nobody names. */
test('a leak note is told at once, then at most hourly while it continues, and keeps the verdict red for a day', () => {
  assert.equal(Ops.leakRetellAfter, 3600);
  assert.equal(Ops.leakWindow, 86400);
  assert.equal(Ops.shouldRetell({ told: 0, now: 1000 }), true, 'never told: tell now');
  assert.equal(Ops.shouldRetell({ told: 1000, now: 1000 + 3599 }), false);
  assert.equal(Ops.shouldRetell({ told: 1000, now: 1000 + 3600 }), true);
  assert.equal(Ops.leakStanding({ last: 0, now: 5 }), false, 'no note, nothing standing');
  assert.equal(Ops.leakStanding({ last: 100, now: 100 + 86399 }), true);
  assert.equal(Ops.leakStanding({ last: 100, now: 100 + 86400 }), false);
});

test('a leak alert names the road and the secrets, never a value, and says what to do', () => {
  const a = Ops.leakDigest({ kind: 'answer', site: 'GET /api/comments/recent', names: ['TURN_KEY_SECRET', 'VAPID_PRIVATE_KEY'], n: 3 });
  assert.equal(a.subject, 'Answer refused (it carried a secret): GET /api/comments/recent');
  assert.match(a.text, /replaced it with a 500\. It carried: TURN_KEY_SECRET, VAPID_PRIVATE_KEY\./);
  assert.match(a.text, /Seen 3 times so far; while it continues you hear of it at most once an hour\./);
  assert.match(a.text, /rotate the named secrets \(CICD\.md §4\)/);
  const f = Ops.leakDigest({ kind: 'frame', site: 'BoardHub', names: ['TURN_KEY_SECRET'], n: 1 });
  assert.equal(f.subject, 'Hub frame refused (it carried a secret): BoardHub');
  assert.match(f.text, /Seen 1 time so far/);
  const e = Ops.leakDigest({ kind: 'enumerated', site: 'cron daily', names: [], n: 2 });
  assert.equal(e.subject, 'The sealed env was enumerated: cron daily');
  assert.ok(!/It carried/.test(e.text), 'an enumeration carried nothing to name');
});

test('a secret too short to guard is a self-check condition the daily and usage chains judge', () => {
  const c = Ops.secretShort('A_SHORT_SECRET');
  assert.equal(Ops.conditionKey(c), 'secret_short:A_SHORT_SECRET');
  assert.equal(Ops.conditionSubject(c), 'Secret too short to guard: A_SHORT_SECRET');
  assert.match(Ops.conditionText(c), /shorter than the egress scan's floor/);
  assert.equal(Ops.alertScope({ chain: 'daily', selfCheck: true })('secret_short:A_SHORT_SECRET'), true);
  assert.equal(Ops.alertScope({ chain: 'hourly', selfCheck: false })('secret_short:A_SHORT_SECRET'), false,
    'a chain without the self-check cannot see a secret, so it never recovers one');
});
