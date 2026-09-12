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

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const migrationsDir = join(root, 'comments-worker', 'migrations');
const libSrc = readFileSync(join(root, 'comments-worker', 'src', 'lib.ts'), 'utf8');
const idxSrc = readFileSync(join(root, 'comments-worker', 'src', 'index.ts'), 'utf8');
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
  "SELECT ?1, 'call', 0, 0, ?2, ?3 WHERE NOT EXISTS (",
  "SELECT 1 FROM notifications WHERE recipient_hash = ?1 AND kind = 'call' AND actor_hash = ?2 AND read_at IS NULL)",
];

test('the missed-call bell (notifyMissedCall) coalescing SQL matches lib.ts verbatim, and coalesces on the real schema', () => {
  for (const frag of COALESCE_FRAGMENTS) assert.ok(libSrc.includes(frag), 'lib.ts carries: ' + frag);
  const { db } = freshDb();
  const a = 'a'.repeat(64), b = 'b'.repeat(64);
  // Same statement with named binds (node:sqlite has no ?N positional support).
  const stmt = db.prepare('INSERT INTO notifications (recipient_hash, kind, topic_id, comment_id, actor_hash, created_at) ' +
    "SELECT :to, 'call', 0, 0, :from, :now WHERE NOT EXISTS (" +
    "SELECT 1 FROM notifications WHERE recipient_hash = :to AND kind = 'call' AND actor_hash = :from AND read_at IS NULL)");
  stmt.run({ to: a, from: b, now: 1 });
  stmt.run({ to: a, from: b, now: 2 });
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE kind = 'call'").get().n, 1,
    'a ring-burst never piles up rows');
  // read the row, ring again: a NEW unread row may now be minted
  db.prepare('UPDATE notifications SET read_at = 5').run();
  stmt.run({ to: a, from: b, now: 6 });
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE kind = 'call'").get().n, 2,
    'a later call after reading rings anew');
  db.close();
});

test('the answer read-mark is TARGETED, never the nuke-all (drift guard)', () => {
  assert.ok(idxSrc.includes("UPDATE notifications SET read_at = ?3 WHERE recipient_hash = ?1 AND kind = 'call' AND actor_hash = ?2 AND read_at IS NULL"),
    'targeted by kind + actor');
});

test('blocked offer keeps the fake-success shape; relay branch keeps its guards (drift guards)', () => {
  const at = idxSrc.indexOf('handleCallOffer');
  assert.ok(at !== -1);
  const body = idxSrc.slice(at, idxSrc.indexOf('handleCallAnswer'));
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
  const at = idxSrc.indexOf('handleCallOffer');
  const body = idxSrc.slice(at, idxSrc.indexOf('handleCallAnswer'));
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
const bodyOf = (name) => {
  const i = idxSrc.indexOf(`async function ${name}(`);
  assert.ok(i > 0, `${name} not found`);
  const j = idxSrc.indexOf('\nasync function ', i + 10);
  return idxSrc.slice(i, j > i ? j : i + 6000);
};
const libBodyOf = (name) => {
  const i = libSrc.indexOf(`export async function ${name}(`);
  assert.ok(i > 0, `${name} not found in lib`);
  const j = libSrc.indexOf('\nexport async function ', i + 10);
  return libSrc.slice(i, j > i ? j : i + 6000);
};

test('0015 builds: the pending-call store, one row per call, stamped answered or missed', () => {
  const { db, files } = freshDb();
  assert.ok(files.some((f) => f.startsWith('0015_calls_pending')), 'migration 0015 present');
  assert.deepEqual(db.prepare('PRAGMA table_info(calls_pending)').all().map((c) => c.name), ['call', 'from_hash', 'to_hash', 'sdp', 'created_at', 'answered_at', 'missed_at']);
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

test('the miss is recorded ONCE on the real ledger — the stamp is the lock; the line rides the thread quietly', () => {
  const rec = libBodyOf('recordMissedCall');
  const m = rec.match(/'(UPDATE calls_pending SET missed_at = \?2 WHERE call = \?1 AND missed_at IS NULL AND answered_at IS NULL)'/);
  assert.ok(m, 'the one UPDATE');
  assert.ok(/sendSystemDm\(env, row\.from_hash, row\.to_hash, 'call:missed', \{ quiet: true \}\)/.test(rec), 'the thread\'s line, from the caller, quiet');
  assert.ok(/await notifyMissedCall\(env, row\.to_hash, row\.from_hash, opts\);/.test(rec), 'then the bell');
  const { db } = freshDb();
  db.prepare('INSERT INTO calls_pending (call, from_hash, to_hash, sdp, created_at) VALUES (?, ?, ?, ?, ?)').run('c1', 'a'.repeat(64), 'b'.repeat(64), 'v=0', 100);
  const upd = db.prepare(m[1].replace('?1', ':call').replace('?2', ':now'));
  assert.equal(upd.run({ call: 'c1', now: 150 }).changes, 1, 'the first report records');
  assert.equal(upd.run({ call: 'c1', now: 160 }).changes, 0, 'a second report (or the sweep after it) changes nothing');
  db.prepare('INSERT INTO calls_pending (call, from_hash, to_hash, sdp, created_at, answered_at) VALUES (?, ?, ?, ?, ?, ?)').run('c2', 'a'.repeat(64), 'b'.repeat(64), 'v=0', 100, 120);
  assert.equal(upd.run({ call: 'c2', now: 150 }).changes, 0, 'an answered call is never a miss');
  db.close();
  const sys = libBodyOf('sendSystemDm');
  assert.ok(/if \(!\(opts && opts\.quiet\)\) await notifyDm\(env, toHash, fromHash\);/.test(sys), 'a quiet system DM rings no dm bell');
});

test('/call/pending serves the offer to its callee alone, fresh and untaken; /call/end records a miss from the caller alone', () => {
  const pend = bodyOf('handleCallPending');
  assert.ok(/FROM calls_pending WHERE call = \?1 AND to_hash = \?2/.test(pend), 'the callee\'s own');
  assert.ok(/\(now - Number\(row\.created_at\)\) <= CallK\.ringTimeoutSecs \+ 15;/.test(pend), 'fresh: the ring plus the push\'s latency');
  assert.ok(/if \(!row \|\| row\.answered_at \|\| row\.missed_at \|\| !fresh\) \{\s*return json\(\{ ok: true, pending: false, answered: !!\(row && row\.answered_at\) \}, 200\);/.test(pend), 'taken or gone: pending false, with the word');
  const end = bodyOf('handleCallEnd');
  assert.ok(/\['noanswer', 'canceled', 'hangup', 'declined', 'failed'\]\.indexOf\(reason\) === -1/.test(end), 'the reasons');
  assert.ok(/if \(!row \|\| \(row\.from_hash !== me && row\.to_hash !== me\)\) return json\(\{ ok: true \}, 200\);/.test(end), 'a stranger says nothing');
  assert.ok(/if \(row\.from_hash === me && \(reason === 'noanswer' \|\| reason === 'canceled'\)\) \{\s*const rec = recordMissedCall\(env, row\);/.test(end), 'only the caller\'s no-answer or cancel is a miss');
  assert.ok(/UPDATE calls_pending SET answered_at = \?2 WHERE call = \?1 AND answered_at IS NULL AND missed_at IS NULL/.test(end), 'every other end stamps the row so the sweep never counts it');
  const ans = bodyOf('handleCallAnswer');
  assert.ok(/late: data\.late \? 1 : 0/.test(ans), 'the answer says whether it came from the store');
  assert.ok(/UPDATE calls_pending SET answered_at = \?2 WHERE call = \?1 AND to_hash = \?3 AND answered_at IS NULL/.test(ans));
  assert.ok(idxSrc.includes("{ m: 'POST', p: '/api/comments/call/pending', fn: (request, env, ctx, url) => handleCallPending(request, env) },") &&
    idxSrc.includes("{ m: 'POST', p: '/api/comments/call/end', fn: (request, env, ctx, url) => handleCallEnd(request, env, ctx) },"), 'both routes');
  assert.ok(/\.then\(\(\) => sweepCalls\(env\)\)/.test(idxSrc), 'the sweep is in the hourly chain');
  const sweep = libBodyOf('sweepCalls');
  assert.ok(/created_at < \?1 AND answered_at IS NULL AND missed_at IS NULL LIMIT 200/.test(sweep) && /recordMissedCall\(env, row, \{ late: true \}\)/.test(sweep), 'the backstop, late');
});
