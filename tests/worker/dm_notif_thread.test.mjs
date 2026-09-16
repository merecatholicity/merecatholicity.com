/* A DM bell names its conversation (migration 0016): notifyDm coalesces one
 * UNREAD 'dm' row per (recipient, thread) — a burst in a group of ten
 * surfaces once, whoever spoke — and a row from before, with no thread on
 * it, still coalesces by its sender.
 *
 * What would break silently: a group burying the list (one row per speaker);
 * two conversations sharing one bell; a legacy row swallowing every sender's.
 * The statement is lifted from lib.ts and run on the real ledger. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { routesSource } from '../_support/worker_src.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const migrationsDir = join(root, 'comments-worker', 'migrations');
const libSrc = readFileSync(join(root, 'comments-worker', 'src', 'lib.ts'), 'utf8');
function freshDb() {
  const db = new DatabaseSync(':memory:');
  for (const f of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) db.exec(readFileSync(join(migrationsDir, f), 'utf8'));
  return db;
}
const FRAGMENTS = [
  "SELECT ?1, 'dm', ?4, 0, ?2, ?3 WHERE NOT EXISTS (",
  "SELECT 1 FROM notifications WHERE recipient_hash = ?1 AND kind = 'dm' AND topic_id = ?4 AND (?4 > 0 OR actor_hash = ?2) AND read_at IS NULL)",
];
const me = 'a'.repeat(64), ann = 'b'.repeat(64), bob = 'c'.repeat(64);

test('notifyDm coalesces per conversation, and by sender for a row with no thread on it', () => {
  const body = libSrc.slice(libSrc.indexOf('export async function notifyDm('), libSrc.indexOf('\n}\n', libSrc.indexOf('export async function notifyDm(')));
  for (const f of FRAGMENTS) assert.ok(body.includes(f), 'lib.ts carries: ' + f);
  assert.ok(/kind: 'dm', topic_id: tid, comment_id: 0, actor_hash: fromHash, created_at: now/.test(body), 'the live ping names the thread too');
  const db = freshDb();
  const stmt = db.prepare('INSERT INTO notifications (recipient_hash, kind, topic_id, comment_id, actor_hash, created_at) ' +
    "SELECT :me, 'dm', :tid, 0, :from, :now WHERE NOT EXISTS (" +
    "SELECT 1 FROM notifications WHERE recipient_hash = :me AND kind = 'dm' AND topic_id = :tid AND (:tid > 0 OR actor_hash = :from) AND read_at IS NULL)");
  const n = () => db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE kind = 'dm'").get().n;
  stmt.run({ me, from: ann, now: 1, tid: 7 });
  stmt.run({ me, from: ann, now: 2, tid: 7 });
  assert.equal(n(), 1, 'a burst is one bell');
  stmt.run({ me, from: bob, now: 3, tid: 7 });
  assert.equal(n(), 1, 'a group: whoever spoke, one bell per conversation');
  stmt.run({ me, from: ann, now: 4, tid: 8 });
  assert.equal(n(), 2, 'another conversation: its own bell');
  db.prepare("UPDATE notifications SET read_at = 5 WHERE topic_id = 7").run();
  stmt.run({ me, from: ann, now: 6, tid: 7 });
  assert.equal(n(), 3, 'read, then spoken to again: a new bell');
  stmt.run({ me, from: ann, now: 7, tid: 0 });
  stmt.run({ me, from: bob, now: 8, tid: 0 });
  stmt.run({ me, from: bob, now: 9, tid: 0 });
  assert.equal(n(), 5, 'no thread on the row: one per sender, as before 0016');
  db.close();
});

test('the missed-call bell names the pair\'s conversation and opens it by id', () => {
  const miss = libSrc.slice(libSrc.indexOf('export async function notifyMissedCall('), libSrc.indexOf('\n}\n', libSrc.indexOf('export async function notifyMissedCall(')));
  assert.ok(/url: tid > 0 \? '\/messages\.html\?t=' \+ tid : '\/messages\.html\?dm=' \+ fromHash, tag: 'call:' \+ fromHash/.test(miss), 'the push opens the thread by id when it has one');
  assert.ok(/kind: 'call', topic_id: tid, comment_id: 0, actor_hash: fromHash, created_at: now/.test(miss));
  const send = routesSource();
  assert.ok(/url: '\/messages\.html\?t=' \+ thread\.id \}\);/.test(send), 'a message\'s push opens the conversation by id (the community.html?dm= drift is gone)');
  assert.ok(!/community\.html\?dm=/.test(send), 'no push points at the community page');
});
