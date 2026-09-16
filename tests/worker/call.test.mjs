/* The 1v1 call wiring's server-side rules that would break silently:
 *   1. migration 0009 must actually build and carry the FULL kind list plus
 *      'call' AND the index recreation line (the table-swap footgun);
 *   2. the missed-call bell must stay coalesced (one UNREAD row per
 *      recipient+caller) and the answer handler's read-mark must stay
 *      TARGETED (kind+actor) — never the nuke-all read;
 *   3. a blocked caller's offer must keep the fake-success shape.
 * SQL fragments are asserted against the shipping source (drift guards) and
 * the coalescing semantics exercised against the REAL migrated schema. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { handlerBody, routesSource } from '../_support/worker_src.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const migrationsDir = join(root, 'comments-worker', 'migrations');
const libSrc = readFileSync(join(root, 'comments-worker', 'src', 'lib.ts'), 'utf8');
const idxSrc = routesSource();
const doSrc = readFileSync(join(root, 'comments-worker', 'src', 'durable.ts'), 'utf8');

const KINDS = ['reply', 'mention', 'dm', 'wall', 'wall-like', 'merecat', 'call'];

function freshDb() {
  const db = new DatabaseSync(':memory:');
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) db.exec(readFileSync(join(migrationsDir, f), 'utf8'));
  return { db, files };
}

test('0009 builds: kind CHECK carries the full list + call, index recreated', () => {
  const { db, files } = freshDb();
  assert.ok(files.some((f) => f.startsWith('0009_')), 'migration 0009 present');
  const sql0009 = readFileSync(join(migrationsDir, files.find((f) => f.startsWith('0009_'))), 'utf8');
  assert.ok(sql0009.includes("CHECK (kind IN ('" + KINDS.join("','") + "'))"), 'the exact kind list');
  assert.ok(sql0009.includes('CREATE INDEX IF NOT EXISTS notifications_recipient_idx'), 'index recreation (the table-swap footgun)');
  // The CHECK actually enforces on the built schema.
  const ins = db.prepare('INSERT INTO notifications (recipient_hash, kind, topic_id, comment_id, actor_hash, created_at) VALUES (?, ?, 0, 0, ?, 1)');
  ins.run('a'.repeat(64), 'call', 'b'.repeat(64));
  assert.throws(() => ins.run('a'.repeat(64), 'bogus', 'b'.repeat(64)), /CHECK/i, 'unknown kind refused');
  db.close();
});

/* The insert is built from concatenated literals in lib.ts, so the guard
   checks each fragment verbatim (the SWEEP_FRAGMENTS idiom). */
const COALESCE_FRAGMENTS = [
  "SELECT ?1, 'call', ?4, 0, ?2, ?3 WHERE NOT EXISTS (",
  "SELECT 1 FROM notifications WHERE recipient_hash = ?1 AND kind = 'call' AND actor_hash = ?2 AND read_at IS NULL)",
];

test('the missed-call bell (notifyMissedCall) coalescing SQL matches lib.ts verbatim, and coalesces on the real schema', () => {
  for (const frag of COALESCE_FRAGMENTS) assert.ok(libSrc.includes(frag), 'lib.ts carries: ' + frag);
  const { db } = freshDb();
  const a = 'a'.repeat(64), b = 'b'.repeat(64);
  // Same statement with named binds (node:sqlite has no ?N positional support).
  const stmt = db.prepare('INSERT INTO notifications (recipient_hash, kind, topic_id, comment_id, actor_hash, created_at) ' +
    "SELECT :to, 'call', :tid, 0, :from, :now WHERE NOT EXISTS (" +
    "SELECT 1 FROM notifications WHERE recipient_hash = :to AND kind = 'call' AND actor_hash = :from AND read_at IS NULL)");
  stmt.run({ to: a, from: b, now: 1, tid: 7 });
  stmt.run({ to: a, from: b, now: 2, tid: 7 });
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE kind = 'call'").get().n, 1,
    'a ring-burst never piles up rows');
  // read the row, ring again: a NEW unread row may now be minted
  db.prepare('UPDATE notifications SET read_at = 5').run();
  stmt.run({ to: a, from: b, now: 6, tid: 7 });
  assert.equal(db.prepare("SELECT topic_id FROM notifications WHERE kind = 'call' ORDER BY id DESC LIMIT 1").get().topic_id, 7, 'the bell names the pair\'s conversation (0016)');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE kind = 'call'").get().n, 2,
    'a later call after reading rings anew');
  db.close();
});

test('the answer read-mark is TARGETED, never the nuke-all (drift guard)', () => {
  assert.ok(idxSrc.includes("UPDATE notifications SET read_at = ?3 WHERE recipient_hash = ?1 AND kind = 'call' AND actor_hash = ?2 AND read_at IS NULL"),
    'targeted by kind + actor');
});

test('blocked offer keeps the fake-success shape; relay branch keeps its guards (drift guards)', () => {
  const body = handlerBody('handleCallOffer', idxSrc);
  assert.ok(body.includes('SELECT 1 AS b FROM dm_blocks WHERE owner_hash = ?1 AND blocked_hash = ?2'), 'block check');
  assert.ok(body.includes('if (blockRow) return json({ ok: true }, 200);'), 'fake success — indistinguishable');
  assert.ok(doSrc.includes("['ice', 'end', 'decline', 'busy', 'taken'].indexOf(kind) === -1"), 'relay kind whitelist');
  assert.ok(doSrc.includes('msg.length > 4096'), 'relay size cap');
});

test("the member's calls-off pref gets the SAME fake success as a block (drift guard + the calls_ok migration)", () => {
  const { db, files } = freshDb();
  // By name, not number: it shipped as a second 0010 beside 0010_dm_likes and
  // was renumbered 0011 on 2026-09-09 (the ledger row renamed to match).
  assert.ok(files.some((f) => /^\d{4}_profile_calls_pref\.sql$/.test(f)), 'profile_calls_pref migration present');
  const cols = db.prepare('PRAGMA table_info(profiles)').all().map((c) => c.name);
  assert.ok(cols.includes('calls_ok'), 'profiles.calls_ok');
  db.close();
  const body = handlerBody('handleCallOffer', idxSrc);
  assert.ok(body.includes('SELECT calls_ok FROM profiles WHERE hash = ?1'), 'pref read');
  assert.ok(body.includes('if (prefRow && prefRow.calls_ok === 0) return json({ ok: true }, 200);'),
    'fake success — "not taking calls" indistinguishable from "did not pick up"');
  /* And the prefs endpoint round-trips it: write branch + served field. */
  assert.ok(idxSrc.includes("if ('calls' in set) { parts.push('calls_ok = ?');"), 'prefs write');
  assert.ok(idxSrc.includes('calls: onOff(row && row.calls_ok)'), 'prefs read-back');
});

/* ---- The answerable ring and the recorded miss (2026-09-12) ----
 * What would break silently: the offer no longer stored (the push would wake
 * a callee to nothing); the bell back at the offer (an answered call leaving
 * a read row; "notify only if missed" is the owner's rule); a miss recorded
 * twice (the caller's report AND the sweep, each adding a line and a bell);
 * a callee's own /call/end recording a miss; the stored offer served to
 * anyone but its callee, or past the ring; the missed-call line ringing a
 * second 'dm' bell; the sweep left out of the cron chain. */
const bodyOf = (name) => handlerBody(name, idxSrc);
const libBodyOf = (name) => {
  const i = libSrc.indexOf(`export async function ${name}(`);
  assert.ok(i > 0, `${name} not found in lib`);
  const j = libSrc.indexOf('\nexport async function ', i + 10);
  return libSrc.slice(i, j > i ? j : i + 6000);
};

test('0015 builds: the pending-call store, one row per call, stamped answered or missed', () => {
  const { db, files } = freshDb();
  assert.ok(files.some((f) => f.startsWith('0015_calls_pending')), 'migration 0015 present');
  assert.deepEqual(db.prepare('PRAGMA table_info(calls_pending)').all().map((c) => c.name).slice(0, 7), ['call', 'from_hash', 'to_hash', 'sdp', 'created_at', 'answered_at', 'missed_at'], '0015\'s columns (0017 adds the log\'s after them)');
  const ins = db.prepare('INSERT INTO calls_pending (call, from_hash, to_hash, sdp, created_at) VALUES (?, ?, ?, ?, ?)');
  ins.run('c1', 'a'.repeat(64), 'b'.repeat(64), 'v=0', 100);
  assert.throws(() => ins.run('c1', 'a'.repeat(64), 'b'.repeat(64), 'v=0', 101), /UNIQUE|PRIMARY/, 'the caller mints the id once');
  db.close();
});

test('the offer is kept for the ring, and the bell moved from the offer to the miss', () => {
  const offer = bodyOf('handleCallOffer');
  assert.ok(/INSERT OR REPLACE INTO calls_pending \(call, from_hash, to_hash, sdp, created_at\) VALUES \(\?1, \?2, \?3, \?4, \?5\)/.test(offer), 'stored before the fan-out');
  assert.ok(/ctx\.waitUntil\(ringCall\(env, to, me, call\)\)/.test(offer), 'the ring\'s push, not a bell');
  assert.ok(!/notifyCall\(|notifyMissedCall\(/.test(offer), 'no bell at the offer');
  const ring = libBodyOf('ringCall');
  assert.ok(/kind: 'call', title: 'Incoming call'/.test(ring) && /url: '\/messages\.html\?dm=' \+ fromHash \+ '&call=' \+ String\(callId \|\| ''\), tag: 'call:' \+ fromHash/.test(ring),
    'the push opens the thread WITH the call, tagged per caller');
  assert.ok(!/INSERT INTO notifications/.test(ring), 'the ring writes no bell row');
  const miss = libBodyOf('notifyMissedCall');
  assert.ok(/kind: 'call-missed', title: 'Missed call'/.test(miss) && /tag: 'call:' \+ fromHash/.test(miss), 'the miss\'s push replaces the ring\'s by its tag');
  assert.ok(/if \(opts && opts\.late\) return;/.test(miss), 'the sweep\'s backstop rings no hour-late push');
});

test('0017 builds: the call log — ended_at the lock, outcome the word; every earlier column stands', () => {
  const { db, files } = freshDb();
  assert.ok(files.some((f) => f.startsWith('0017_calls_log')), 'migration 0017 present');
  assert.deepEqual(db.prepare('PRAGMA table_info(calls_pending)').all().map((c) => c.name), ['call', 'from_hash', 'to_hash', 'sdp', 'created_at', 'answered_at', 'missed_at', 'ended_at', 'outcome']);
  db.close();
});

/* The lock's SQL is concatenated in lib.ts; the guard rebuilds it as the
   worker does and runs it on the real ledger. */
const LOCK_SQL = "'UPDATE calls_pending SET ended_at = ?2, outcome = ?3, missed_at = CASE WHEN ?3 = \\'missed\\' THEN ?2 ELSE missed_at END ' +\n    'WHERE call = ?1 AND ended_at IS NULL AND missed_at IS NULL' + (outcome === 'answered' ? ' AND answered_at IS NOT NULL' : '')";

test('the outcome is recorded ONCE on the real ledger — ended_at is the lock; the line rides the thread quietly; only a miss rings', () => {
  const rec = libBodyOf('recordCallEnd');
  assert.ok(rec.includes(LOCK_SQL), 'the one UPDATE, verbatim');
  assert.ok(/if \(outcome === 'missed'\) line = CallK\.missedCallLine;\s*else if \(outcome === 'declined'\) line = CallK\.declinedCallLine;\s*else if \(outcome === 'answered'\) line = CallK\.answeredCallLine\(Math\.max\(0, now - \(Number\(row\.answered_at\) \|\| now\)\)\);/.test(rec),
    'the line by outcome, Domain.Call\'s grammar; an answered call\'s length is the server\'s measure');
  assert.ok(/ensurePairThread\(env, row\.from_hash, row\.to_hash, now, \{ bump: false, sender: row\.from_hash \}\)/.test(rec), 'the pair\'s room, made if this call was its first word (0016)');
  assert.ok(/sendSystemDmLine\(env, thread\.id, row\.from_hash, line, \{ quiet: true \}\)/.test(rec), 'the thread\'s line, from the caller, quiet');
  assert.ok(/if \(outcome === 'missed'\) await notifyMissedCall\(env, row\.to_hash, row\.from_hash, opts, thread \? thread\.id : 0\);/.test(rec), 'the bell rings for a miss alone, naming the conversation');
  assert.ok(/export async function recordMissedCall\([^)]*\) \{\s*return recordCallEnd\(env, row, 'missed', opts\);/.test(libSrc), 'the miss is the general record by name');
  const { db } = freshDb();
  const run = (call, now, outcome) => db.prepare(
    'UPDATE calls_pending SET ended_at = :now, outcome = :outcome, missed_at = CASE WHEN :outcome = \'missed\' THEN :now ELSE missed_at END ' +
    'WHERE call = :call AND ended_at IS NULL AND missed_at IS NULL' + (outcome === 'answered' ? ' AND answered_at IS NOT NULL' : '')
  ).run({ call, now, outcome }).changes;
  const ins = db.prepare('INSERT INTO calls_pending (call, from_hash, to_hash, sdp, created_at, answered_at, missed_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
  ins.run('c1', 'a'.repeat(64), 'b'.repeat(64), 'v=0', 100, null, null);
  assert.equal(run('c1', 150, 'missed'), 1, 'the first report records');
  assert.equal(run('c1', 160, 'missed'), 0, 'a second report (or the sweep after it) changes nothing');
  assert.equal(run('c1', 160, 'declined'), 0, 'nor a different word after it');
  assert.deepEqual({ ...db.prepare('SELECT missed_at, ended_at, outcome FROM calls_pending WHERE call = ?').get('c1') }, { missed_at: 150, ended_at: 150, outcome: 'missed' }, 'a miss stamps both');
  ins.run('c2', 'a'.repeat(64), 'b'.repeat(64), 'v=0', 100, 120, null);
  assert.equal(run('c2', 150, 'missed'), 1, 'the SQL does not know the rule (callOutcome does); it only locks');
  ins.run('c3', 'a'.repeat(64), 'b'.repeat(64), 'v=0', 100, null, null);
  assert.equal(run('c3', 150, 'answered'), 0, 'an unanswered call is never an answered line');
  ins.run('c4', 'a'.repeat(64), 'b'.repeat(64), 'v=0', 100, 120, null);
  assert.equal(run('c4', 150, 'declined'), 1, 'the first end wins');
  assert.equal(run('c4', 151, 'answered'), 0, 'the other side\'s hangup a moment later changes nothing');
  assert.deepEqual({ ...db.prepare('SELECT missed_at, ended_at, outcome FROM calls_pending WHERE call = ?').get('c4') }, { missed_at: null, ended_at: 150, outcome: 'declined' }, 'only a miss stamps missed_at');
  ins.run('c5', 'a'.repeat(64), 'b'.repeat(64), 'v=0', 100, null, 130);
  assert.equal(run('c5', 150, 'missed'), 0, 'a pre-0017 miss (missed_at, no ended_at) is never re-recorded');
  db.close();
  const sys = libBodyOf('sendSystemDmLine');
  assert.ok(/const live = to\.concat\(\[String\(actorHash\)\]\);\s*await publishUser\(env, \[\{ v: 1, t: 'dm', scopes: live\.map\(\(h\) => 'user:' \+ h\)/.test(sys),
    'the line is published to the actor\'s own sockets too — the caller sees their outcome land without a reload (2026-09-14)');
  assert.ok(/if \(!\(opts && opts\.quiet\)\) for \(const h of to\) await notifyDm\(env, h, actorHash, threadId\);/.test(sys), 'a quiet system line rings no dm bell; a loud one rings every other member\'s, by the conversation (0016)');
});

test('/call/pending serves the offer to its callee alone, fresh and untaken; /call/end records by the one rule, through the one lock', () => {
  const pend = bodyOf('handleCallPending');
  assert.ok(/FROM calls_pending WHERE call = \?1 AND to_hash = \?2/.test(pend), 'the callee\'s own');
  assert.ok(/\(now - Number\(row\.created_at\)\) <= CallK\.ringTimeoutSecs \+ 15;/.test(pend), 'fresh: the ring plus the push\'s latency');
  assert.ok(/if \(!row \|\| row\.answered_at \|\| row\.missed_at \|\| row\.ended_at \|\| !fresh\) \{\s*return json\(\{ ok: true, pending: false, answered: !!\(row && row\.answered_at\) \}, 200\);/.test(pend), 'taken or gone: pending false, with the word');
  const end = bodyOf('handleCallEnd');
  assert.ok(/CallK\.endReasons\.indexOf\(reason\) === -1/.test(end), 'the reasons are Domain.Call\'s');
  assert.ok(/if \(!row \|\| \(row\.from_hash !== me && row\.to_hash !== me\)\) return json\(\{ ok: true \}, 200\);/.test(end), 'a stranger says nothing');
  assert.ok(/CallK\.callOutcome\(\{ caller: row\.from_hash === me, answered: !!row\.answered_at, reason \}\)/.test(end), 'what a report records is Domain.Call\'s one rule');
  assert.ok(/if \(!outcome\) return json\(\{ ok: true \}, 200\);\s*const rec = recordCallEnd\(env, row, outcome\);/.test(end), 'a word that records nothing is dropped; the rest goes through the one lock');
  assert.ok(!/SET answered_at/.test(end), 'the end never forges an answer');
  const ans = bodyOf('handleCallAnswer');
  assert.ok(/late: data\.late \? 1 : 0/.test(ans), 'the answer says whether it came from the store');
  assert.ok(/UPDATE calls_pending SET answered_at = \?2 WHERE call = \?1 AND to_hash = \?3 AND answered_at IS NULL/.test(ans));
  assert.ok(idxSrc.includes("{ m: 'POST', p: '/api/comments/call/pending', fn: (request, env, ctx, url) => handleCallPending(request, env) },") &&
    idxSrc.includes("{ m: 'POST', p: '/api/comments/call/end', fn: (request, env, ctx, url) => handleCallEnd(request, env, ctx) },"), 'both routes');
  assert.ok(/\.then\(\(\) => sweepCalls\(env\)\)/.test(idxSrc), 'the sweep is in the hourly chain');
  const sweep = libBodyOf('sweepCalls');
  assert.ok(/created_at < \?1 AND answered_at IS NULL AND missed_at IS NULL AND ended_at IS NULL LIMIT 200/.test(sweep) && /recordMissedCall\(env, row, \{ late: true \}\)/.test(sweep), 'the backstop, late — never a call already ended');
});
