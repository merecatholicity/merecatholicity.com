/* No answer the worker gives ever carries a secret, and no reader sees a
 * private value that is not theirs (2026-09-17).
 *
 * The bug this locks out, live on production from 2026-08-02 to 2026-09-17:
 * `GET /api/comments/recent` — public, keyless, cacheable — ended with
 *
 *     items = await withNames(env, items);
 *
 * two arguments handed to db.ts's `withNames(row, posts)`, whose first act is
 * `Object.assign({}, row)`: the endpoint served every binding and secret the
 * worker holds. Nothing was red — both sides took `any`, the route answered
 * 200, no test read an answer for what it must NOT contain.
 *
 * The first guard written for it proved nothing for most routes: it called
 * each one anonymously with an empty body and a SENTINEL ALLOWED_ORIGINS, so
 * 114 of its 129 calls were refused at the origin gate before a handler ran.
 * This one takes every road as four identities against a seeded ledger
 * (tests/_support/sweep.mjs), counts what it reached, and fails when the
 * count falls — plus a static law over every worker file: the env flows only
 * into parameters named env. The egress guard (egress.ts) would refuse a
 * leaking answer in production; here a refusal is itself a failure, so the
 * guard never hides a handler bug from CI. */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { runSweep, secretsIn, forbiddenFor, privatesIn, SECRETS, ROUTES, INGEST_DOORS } from '../_support/sweep.mjs';
import { envFlow, workerFiles } from '../_support/env_flow.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/* Measured 2026-09-17 (200-answers per identity over the route table). A
   floor may rise; lowering one is a decision stated in the commit, because a
   falling count is a sweep going hollow. */
const FLOORS = { anon: 19, member: 84, outsider: 63, admin: 123 };

let sweep;
before(async () => {
  const log = console.log;
  console.log = () => {};   // hundreds of handler log lines; the assertions say what matters
  try { sweep = await runSweep(); } finally { console.log = log; }
});

const label = (c) => `${c.m} ${c.p} as ${c.as}${c.road === 'table' ? '' : ' (' + c.road + ')'} → ${c.status}`;

test('no answer, alert, Discord post, hub event or backup carries a secret', () => {
  assert.ok(SECRETS.length >= 5, 'the env declares its secrets');
  const leaks = [];
  for (const c of sweep.calls) {
    const found = secretsIn(c.text + '\n' + JSON.stringify(c.events) + '\n' + JSON.stringify(c.emails));
    if (found.length) leaks.push(label(c) + ': ' + found.join(', '));
    /* a whole env serialized shows up as its binding names, keyed */
    if (c.json && typeof c.json === 'object') {
      const keys = new Set();
      const walk = (v, depth) => {
        if (!v || typeof v !== 'object' || depth > 5) return;
        if (Array.isArray(v)) { v.slice(0, 8).forEach((x) => walk(x, depth + 1)); return; }
        for (const k of Object.keys(v)) { keys.add(k); walk(v[k], depth + 1); }
      };
      walk(c.json, 0);
      const bindings = ['DB', 'LIBDB', 'MERECAT_INDEX', 'HUB', 'CHAT', 'BACKUPS', 'AVATARS', 'READ_LIMIT'].filter((b) => keys.has(b));
      if (bindings.length >= 2) leaks.push(label(c) + ': binding names as keys ' + bindings.join(', '));
    }
  }
  for (const cr of sweep.crons) {
    const found = secretsIn(JSON.stringify(cr.emails) + JSON.stringify(cr.discord) + cr.backups.map((b) => b.text).join('\n'));
    if (found.length) leaks.push('cron ' + cr.cron + ': ' + found.join(', '));
  }
  assert.deepEqual(leaks, [], 'a road put a secret where someone can read it');
});

test('no reader sees a private value that is not theirs', () => {
  const seen = [];
  for (const c of sweep.calls) {
    const bad = forbiddenFor(c.as, c.text);
    if (bad.length) seen.push(label(c) + ': ' + bad.join(', '));
  }
  assert.deepEqual(seen, [], 'a road showed a reader what only someone else may see');
  /* the sentinels are reachable at all: an admin reads the private columns
     somewhere, and a member reads their own conversation — so a clean run
     above means refused, not unreachable */
  const adminSaw = new Set(sweep.calls.filter((c) => c.as === 'admin').flatMap((c) => privatesIn(c.text)));
  for (const k of ['comments.ip', 'identity_ips.ip_display', 'ip_bans.ip', 'app_settings.alert_email', 'held post body', 'back room title', 'reports.reason']) {
    assert.ok(adminSaw.has(k), 'the sweep never showed an admin ' + k + ': the seed or the hints went stale');
  }
  const memberSaw = new Set(sweep.calls.filter((c) => c.as === 'member').flatMap((c) => privatesIn(c.text)));
  for (const k of ['dms.body', 'dm_keys.sealed (member)', 'calls_pending.sdp', 'merecat chat_msgs.body']) {
    assert.ok(memberSaw.has(k), 'the sweep never showed the member their own ' + k);
  }
});

test('the sweep reached the handlers: real origins everywhere, and the reach floors hold', () => {
  const table = sweep.calls.filter((c) => c.road === 'table');
  assert.equal(table.length, ROUTES.length * 4, 'every route, four identities');
  assert.deepEqual(table.filter((c) => c.json && c.json.error === 'Bad origin.').map(label), [], 'no call may stop at the origin gate');
  assert.deepEqual(sweep.calls.filter((c) => c.threw).map((c) => label(c) + ' ' + c.threw), [], 'a road threw in the harness');
  const ok = {};
  for (const c of table) if (c.status === 200) ok[c.as] = (ok[c.as] || 0) + 1;
  const low = Object.entries(FLOORS).filter(([as, floor]) => (ok[as] || 0) < floor)
    .map(([as, floor]) => `${as} reached ${ok[as] || 0} (floor ${floor})`);
  assert.deepEqual(low, [], 'a sweep below its floor went hollow (the seed, the hints, or a gate): ' + JSON.stringify(ok));
  /* every route answers SOME identity with success: a new route brings its
     hint (tests/_support/sweep.mjs ROUTE_HINTS) or its seed in the same commit */
  const reachedByNobody = new Set(ROUTES.map((r) => r.m + ' ' + r.p));
  for (const c of table) if (c.status >= 200 && c.status < 300) reachedByNobody.delete(c.m + ' ' + c.p);
  assert.deepEqual([...reachedByNobody], [], 'routes the sweep never got past their first refusal');
});

test('nothing the sweep did tripped the egress guard or threw: in CI a refusal is a handler bug, never a pass', () => {
  const tripped = sweep.calls.filter((c) => c.egress.length || c.said.some((e) => e.event !== 'unhandled'))
    .map((c) => label(c) + ' ' + JSON.stringify(c.said.length ? c.said : c.egress));
  const cronTripped = sweep.crons.filter((c) => c.egress.length).map((c) => c.cron + ' ' + JSON.stringify(c.egress));
  assert.deepEqual(tripped.concat(cronTripped), [], 'the guard refused an answer or the seal a copy');
  const threw = sweep.calls.filter((c) => c.said.some((e) => e.event === 'unhandled'))
    .map((c) => label(c) + ' ' + c.said.filter((e) => e.event === 'unhandled').map((e) => e.error).join('; '));
  assert.deepEqual(threw, [], 'a handler threw on a realistic request (the usual 500)');
});

test('the other roads: workers.dev opens only its doors, the back room keeps its attachment, the crons speak without secrets', () => {
  const dev = sweep.calls.filter((c) => c.road === 'workers.dev');
  assert.equal(dev.filter((c) => c.p !== '/api/comments/recent').length, INGEST_DOORS.length * 2);
  for (const c of dev) {
    if (c.p === '/api/comments/recent') assert.equal(c.status, 404, 'a read on workers.dev does not exist');
    else if (c.as === 'anon') assert.equal(c.status, 403, label(c));
  }
  /* each door opened for the GitHub job whose token it takes, so its answer was swept */
  const pipeline = sweep.calls.filter((c) => c.road === 'pipeline');
  assert.deepEqual(pipeline.map((c) => c.p).sort(), [...INGEST_DOORS].sort());
  assert.deepEqual(pipeline.filter((c) => c.status !== 200).map(label), [], 'a pipeline door refused its own job');
  const back = sweep.calls.filter((c) => c.road === 'back room media');
  assert.equal(back.find((c) => c.as === 'anon').status, 404, 'the back room\'s attachment answers as if absent');
  const card = sweep.calls.find((c) => c.road === 'handle' && c.p === '/@sweepmember');
  assert.equal(card.status, 200);
  assert.match(card.text, /Sweep Member \(@sweepmember\)/, 'the card was rendered, so its injection was swept');
  /* every other mode of a public read answers (the category feed threw for
     months: a reply's title read a const declared below it) */
  const modes = sweep.calls.filter((c) => c.road.startsWith('mode '));
  assert.ok(modes.length >= 10);
  assert.deepEqual(modes.filter((c) => c.status !== 200).map(label), [], 'a public read failed in one of its modes');
  const daily = sweep.crons.find((c) => c.cron === '15 3 * * *');
  assert.ok(daily.backups.length === 1, 'the daily chain wrote its backup, and the sweep read it');
  assert.ok(daily.emails.length >= 1 && daily.discord.length >= 1, 'the self-check alerted (a stale monthly heartbeat), so its words were swept');
});

test('the recent list is a LIST of posts — the shape the leak destroyed', () => {
  const recent = sweep.calls.find((c) => c.road === 'table' && c.p === '/api/comments/recent' && c.as === 'anon');
  assert.equal(recent.status, 200);
  assert.ok(Array.isArray(recent.json.items) && recent.json.items.length >= 1, 'items is an array of rows, never one object');
  for (const it of recent.json.items) {
    assert.ok('id' in it && 'author_hash' in it, 'a row of the forum, not something else');
    assert.ok('assigned' in it, 'each row carries its author\'s assigned pseudonym');
  }
});

/* ---- the static law -------------------------------------------------------- */

/* The seal's own module handles the raw env by design; the two other shapes
   are named here with their reasons. */
const EXEMPT = new Set(['comments-worker/src/egress.ts']);
const ALLOWED = [
  ['comments-worker/src/dbsession.ts', /^return \{ env, wrote/, 'the session record hands the unchanged env back to the router'],
  ['comments-worker/src/ops.ts', /^fn\(env\)$/, 'a cron Step is (env: Env) => Promise'],
];

test('the env flows only into parameters named env, in every file of both workers', () => {
  const sources = workerFiles(root).map((file) => ({ file, rel: relative(root, file), code: readFileSync(file, 'utf8') }));
  const { checked, bad, used } = envFlow(sources, { exempt: EXEMPT, allowed: ALLOWED });
  assert.ok(checked > 500, 'the law read the worker (' + checked + ' value uses)');
  assert.deepEqual(bad, [], 'the env went somewhere other than an env parameter — a copy, a spread, a serializer, a row mapper');
  /* an allowance nothing uses any more is a stale one: drop it */
  assert.deepEqual(ALLOWED.filter((a) => !used.has(a)).map(([f, , why]) => f + ' (' + why + ')'), []);
});
