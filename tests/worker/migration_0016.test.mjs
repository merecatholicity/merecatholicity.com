/* One member model (migration 0016): every conversation is a thread with
 * member rows — a pair is two of them — plus the per-member reaction ledger,
 * the per-message sealed keys of envelope v2, and the media reference ledger
 * behind forwarding.
 *
 * What would break silently: a pair whose stamps did not cross into its
 * member rows (its unread count and its clear would reset); a reaction lost
 * in the move; an attachment left without a reference (the orphan sweep would
 * take it); the AUTOINCREMENT high-water mark lost in the table swap (a
 * deleted thread's id minted again, so its stray messages and bells re-attach
 * to a stranger's thread); a bell that lost its conversation; a legacy column
 * dropped; two groups colliding on the pair index. So: the ledger builds, and
 * 0016 is applied against a genuinely pre-0016 database seeded with each case. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const migrationsDir = join(root, 'comments-worker', 'migrations');

function freshDb(upTo) {
  const db = new DatabaseSync(':memory:');
  let files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  if (upTo) files = files.filter((f) => f.slice(0, 4) <= upTo);
  for (const f of files) db.exec(readFileSync(join(migrationsDir, f), 'utf8'));
  return { db, files };
}
const cols = (db, table) => db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
const rows = (db, sql, ...args) => db.prepare(sql).all(...args).map((r) => ({ ...r }));   // node:sqlite rows have a null prototype

const A = 'a'.repeat(64), B = 'b'.repeat(64), C = 'c'.repeat(64), X = 'x'.repeat(64), Y = 'y'.repeat(64);
const KEY = 'dm/' + '1'.repeat(64), LOOSE = 'dm/' + '2'.repeat(64);

/* A pre-0016 database with one live pair (stamps, reactions, an attachment,
   bells), one pair deleted after it was minted (the sequence stands above the
   surviving MAX id), an unclaimed upload, and a bell from a pair that no
   longer exists. */
function seeded() {
  const { db } = freshDb('0015');
  db.exec(`INSERT INTO dm_threads (a_hash, b_hash, created_at, last_at, last_sender, msgs, a_read_at, b_read_at, a_cleared_at, ttl)
           VALUES ('${A}', '${B}', 100, 130, '${B}', 2, 105, 107, 103, 86400)`);
  db.exec(`INSERT INTO dm_threads (a_hash, b_hash, created_at, last_at, last_sender, msgs) VALUES ('${A}', '${C}', 110, 110, '${A}', 0)`);
  db.exec('DELETE FROM dm_threads WHERE id = 2');
  db.exec(`INSERT INTO dms (thread_id, sender_hash, body, created_at, enc, react_a, react_b) VALUES (1, '${A}', 'E1.x', 120, 1, '❤️', '👍')`);
  db.exec(`INSERT INTO dms (thread_id, sender_hash, body, created_at, enc, media_key, media_size, react_a) VALUES (1, '${B}', 'E1.y', 130, 1, '${KEY}', 10, '')`);
  db.exec(`INSERT INTO dm_media (key, size, created_at, msg_id) VALUES ('${KEY}', 10, 129, 2)`);
  db.exec(`INSERT INTO dm_media (key, size, created_at, msg_id) VALUES ('${LOOSE}', 10, 131, NULL)`);
  db.exec(`INSERT INTO notifications (recipient_hash, kind, topic_id, comment_id, actor_hash, created_at) VALUES
           ('${B}', 'dm', 0, 0, '${A}', 121),
           ('${A}', 'dm-react', 0, 1, '${B}', 122),
           ('${B}', 'call', 0, 0, '${A}', 123),
           ('${X}', 'dm', 0, 0, '${Y}', 124),
           ('${B}', 'reply', 7, 9, '${A}', 125)`);
  db.exec(readFileSync(join(migrationsDir, '0016_dm_members.sql'), 'utf8'));
  return db;
}

test('the ledger builds through 0016: the member model, the four ledgers, saved_by, and every legacy column still there', () => {
  const { db, files } = freshDb();
  assert.ok(files.some((f) => f.startsWith('0016_dm_members')), 'migration 0016 present');
  const t = cols(db, 'dm_threads');
  for (const c of ['id', 'kind', 'pair_key', 'name', 'created_at', 'created_by', 'last_at', 'last_sender', 'msgs', 'ttl',
    'a_hash', 'b_hash', 'a_read_at', 'b_read_at', 'a_cleared_at', 'b_cleared_at']) assert.ok(t.includes(c), 'dm_threads.' + c);
  assert.deepEqual(cols(db, 'dm_members'), ['thread_id', 'hash', 'joined_at', 'left_at', 'read_at', 'cleared_at', 'added_by']);
  assert.deepEqual(cols(db, 'dm_reactions'), ['msg_id', 'hash', 'emoji', 'created_at']);
  assert.deepEqual(cols(db, 'dm_keys'), ['msg_id', 'hash', 'sealed']);
  assert.deepEqual(cols(db, 'dm_media_refs'), ['key', 'msg_id']);
  assert.ok(cols(db, 'dms').includes('saved_by'), 'dms.saved_by');
  assert.ok(cols(db, 'dm_media').includes('msg_id'), 'dm_media.msg_id is retired, never dropped');
  const idx = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'dm_threads'").all().map((r) => r.name);
  assert.ok(idx.includes('dm_threads_pair_idx') && idx.includes('dm_threads_last_idx') && idx.includes('dm_threads_ab_idx'),
    'the pair, last-activity and legacy-pair indexes: ' + idx.join(','));
  db.close();
});

test('a pair crosses over whole: kind 0, the canonical pair_key, and its two member rows carrying the read and clear stamps', () => {
  const db = seeded();
  assert.deepEqual(rows(db, 'SELECT id, kind, pair_key, name, created_at, created_by, last_at, last_sender, msgs, ttl, a_hash, b_hash FROM dm_threads'), [
    { id: 1, kind: 0, pair_key: A + '|' + B, name: null, created_at: 100, created_by: null, last_at: 130, last_sender: B, msgs: 2, ttl: 86400, a_hash: A, b_hash: B },
  ]);
  assert.deepEqual(rows(db, 'SELECT thread_id, hash, joined_at, left_at, read_at, cleared_at, added_by FROM dm_members ORDER BY hash'), [
    { thread_id: 1, hash: A, joined_at: 100, left_at: null, read_at: 105, cleared_at: 103, added_by: null },
    { thread_id: 1, hash: B, joined_at: 100, left_at: null, read_at: 107, cleared_at: null, added_by: null },
  ]);
  db.close();
});

test('every reaction crosses into dm_reactions, dated by its message; an empty slot leaves no row', () => {
  const db = seeded();
  assert.deepEqual(rows(db, 'SELECT msg_id, hash, emoji, created_at FROM dm_reactions ORDER BY msg_id, hash'), [
    { msg_id: 1, hash: A, emoji: '❤️', created_at: 120 },
    { msg_id: 1, hash: B, emoji: '👍', created_at: 120 },
  ]);
  db.close();
});

test('every attachment gets its reference; an unclaimed upload gets none (the orphan sweep still takes it)', () => {
  const db = seeded();
  assert.deepEqual(rows(db, 'SELECT key, msg_id FROM dm_media_refs'), [{ key: KEY, msg_id: 2 }]);
  db.close();
});

test('the AUTOINCREMENT high-water mark survives the swap: a deleted thread\'s id is never minted again', () => {
  const db = seeded();
  const seq = db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'dm_threads'").get();
  assert.equal(seq && seq.seq, 2, 'the sequence stands at the deleted thread, above the surviving MAX id');
  const r = db.prepare(`INSERT INTO dm_threads (kind, pair_key, created_at, last_at, last_sender) VALUES (0, '${A}|${C}', 200, 200, '${A}')`).run();
  assert.equal(Number(r.lastInsertRowid), 3, 'the next thread is 3, not the recycled 2');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM dm_threads WHERE last_sender = ''").get().n, 0, 'the sentinel is gone');
  db.close();
});

test('pair_key is unique; groups (NULL pair_key) never collide on it', () => {
  const db = seeded();
  db.exec(`INSERT INTO dm_threads (a_hash, b_hash, created_at, last_at, last_sender, msgs) VALUES ('${A}', '${C}', 150, 150, '${A}', 0) ON CONFLICT(a_hash, b_hash) DO UPDATE SET last_at = 150`);   // the pre-0016 worker's upsert still runs
  db.exec(`INSERT INTO dm_threads (kind, pair_key, name, created_at, created_by, last_at, last_sender) VALUES (1, NULL, 'Choir', 300, '${A}', 300, '${A}')`);
  db.exec(`INSERT INTO dm_threads (kind, pair_key, name, created_at, created_by, last_at, last_sender) VALUES (1, NULL, NULL, 301, '${B}', 301, '${B}')`);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM dm_threads WHERE kind = 1').get().n, 2);
  assert.throws(() => db.exec(`INSERT INTO dm_threads (kind, pair_key, created_at, last_at, last_sender) VALUES (0, '${A}|${B}', 400, 400, '${A}')`),
    /UNIQUE/, 'a second thread for the same pair is refused');
  db.close();
});

test('bells learn their conversation: dm and call by the pair, dm-react by its message; a bell from a vanished pair stays 0; a board bell is untouched', () => {
  const db = seeded();
  assert.deepEqual(rows(db, 'SELECT recipient_hash, kind, topic_id, comment_id FROM notifications ORDER BY id'), [
    { recipient_hash: B, kind: 'dm', topic_id: 1, comment_id: 0 },
    { recipient_hash: A, kind: 'dm-react', topic_id: 1, comment_id: 1 },
    { recipient_hash: B, kind: 'call', topic_id: 1, comment_id: 0 },
    { recipient_hash: X, kind: 'dm', topic_id: 0, comment_id: 0 },
    { recipient_hash: B, kind: 'reply', topic_id: 7, comment_id: 9 },
  ]);
  db.close();
});
