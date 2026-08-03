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

test('notifyCall coalescing SQL matches lib.ts verbatim, and coalesces on the real schema', () => {
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
