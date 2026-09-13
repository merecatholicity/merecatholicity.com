/* Reading marks read (2026-09-12), on the real ledger: opening a conversation
 * clears every bell its sender rang the reader — a message, a reaction, a
 * missed call — and no other sender's; opening a feed post clears the post's
 * bells and no other post's. The statements are lifted from the handlers.
 *
 * What would break silently: a kind left out (a reaction's bell staying lit
 * after the thread was read); a WHERE without the sender (one open clearing
 * every sender's bells); the post's mark keyed on the wrong id. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const migrationsDir = join(root, 'comments-worker', 'migrations');
const idxSrc = readFileSync(join(root, 'comments-worker', 'src', 'index.ts'), 'utf8');
function freshDb() {
  const db = new DatabaseSync(':memory:');
  for (const f of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) db.exec(readFileSync(join(migrationsDir, f), 'utf8'));
  return db;
}
const body = (name) => {
  const i = idxSrc.indexOf(`async function ${name}(`);
  assert.ok(i > 0, `${name} not found`);
  const j = idxSrc.indexOf('\nasync function ', i + 10);
  return idxSrc.slice(i, j > i ? j : i + 8000);
};
const me = 'a'.repeat(64), ann = 'b'.repeat(64), bob = 'c'.repeat(64);
function seeded() {
  const db = freshDb();
  const ins = db.prepare('INSERT INTO notifications (recipient_hash, kind, topic_id, comment_id, actor_hash, created_at) VALUES (?, ?, ?, ?, ?, 1)');
  ins.run(me, 'dm', 0, 0, ann); ins.run(me, 'dm-react', 0, 44, ann); ins.run(me, 'call', 0, 0, ann);
  ins.run(me, 'dm', 0, 0, bob);                       // another sender: stays
  ins.run(me, 'reply', 5, 9, ann);                    // a board bell from ann: not the thread's
  ins.run(me, 'wall', 1, 3, ann); ins.run(me, 'wall-react', 0, 3, bob); ins.run(me, 'wall-like', 0, 4, ann);   // the feed: post 3 twice, post 4 once
  return db;
}
const named = (sql) => sql.replace('?1', ':me').replace('?2', ':who').replace('?3', ':now');

test('opening a conversation reads the three kinds its sender rang me, and nothing else', () => {
  const m = body('handleDmThread').match(/"(UPDATE notifications SET read_at = \?3 WHERE recipient_hash = \?1 AND kind IN \('dm','dm-react','call'\) AND actor_hash = \?2 AND read_at IS NULL)"/);
  assert.ok(m, 'the statement');
  const db = seeded();
  assert.equal(db.prepare(named(m[1])).run({ me, who: ann, now: 50 }).changes, 3, 'the message, the reaction, the missed call');
  const left = db.prepare('SELECT kind, actor_hash FROM notifications WHERE read_at IS NULL ORDER BY id').all().map((r) => [r.kind, r.actor_hash === ann ? 'ann' : 'bob']);
  assert.deepEqual(left, [['dm', 'bob'], ['reply', 'ann'], ['wall', 'ann'], ['wall-react', 'bob'], ['wall-like', 'ann']], 'the other sender, the board, the feed: untouched');
  const seen = body('handleDmSeen').match(/"(UPDATE notifications SET read_at = \?3 WHERE recipient_hash = \?1 AND kind IN \('dm','dm-react','call'\) AND actor_hash = \?2 AND read_at IS NULL)"/);
  assert.ok(seen, 'the seen ping runs the same statement');
  db.close();
});

test('opening a feed post reads its bells and no other post\'s', () => {
  const m = body('handleWallPostGet').match(/"(UPDATE notifications SET read_at = \?3 WHERE recipient_hash = \?1 AND kind IN \('wall','wall-like','wall-react'\) AND comment_id = \?2 AND read_at IS NULL)"/);
  assert.ok(m, 'the statement');
  const db = seeded();
  assert.equal(db.prepare(named(m[1])).run({ me, who: 3, now: 50 }).changes, 2, 'post 3: the comment and the reaction');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE read_at IS NULL AND kind IN ('wall','wall-like','wall-react')").get().n, 1, 'post 4\'s like stays');
  db.close();
});
