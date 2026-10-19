/* Migration 0019 (2026-10-17): the first retire migration, the one
 * non-additive kind (CLAUDE.md, "Additive is not forever"). It drops what
 * tests/_support/retirements.json named on 2026-10-14 and nothing any worker
 * still touches: the ledger is applied BEFORE `wrangler deploy`, so the
 * worker being replaced serves against the new schema for a moment, and a
 * column it writes must outlive it.
 *
 * What would break silently: a drop of a column the outgoing worker still
 * writes (a pair's first word, an upload or a rekey failing in the deploy
 * window); a retired column the new worker still names (every such write
 * failing for ever); a row or a kept column lost in the drop. So: the ledger
 * builds through 0019, applied to a populated pre-0019 database; what is
 * dropped is gone, the three written columns stand, every row survives with
 * its kept fields; and the worker's source names none of the three. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const migrationsDir = join(root, 'comments-worker', 'migrations');
const src = (...p: string[]) => readFileSync(join(root, 'comments-worker', 'src', ...p), 'utf8');

function ledgerUpTo(upTo: string) {
  const db = new DatabaseSync(':memory:');
  for (const f of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql') && f.slice(0, 4) <= upTo).sort()) {
    db.exec(readFileSync(join(migrationsDir, f), 'utf8'));
  }
  return db;
}
const cols = (db: DatabaseSync, t: string) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name as string);
const exists = (db: DatabaseSync, name: string) => !!db.prepare('SELECT 1 FROM sqlite_master WHERE name = ?').get(name);
const A = 'a'.repeat(64), B = 'b'.repeat(64);

test('0019 drops the retired columns, tables and indexes, and keeps every row', () => {
  const db = ledgerUpTo('0018');
  db.exec(`INSERT INTO dm_threads (id, kind, pair_key, created_at, last_at, last_sender, msgs, a_hash, b_hash, a_read_at, b_cleared_at)
           VALUES (1, 0, '${A}|${B}', 10, 20, '${B}', 2, '${A}', '${B}', 15, 12)`);
  db.exec(`INSERT INTO dms (id, thread_id, sender_hash, body, created_at, enc, react_a, liked_b, media_key)
           VALUES (5, 1, '${A}', 'E3.x', 20, 3, '❤️', 1, 'dm/k1')`);
  db.exec(`INSERT INTO dm_media (key, size, created_at, msg_id) VALUES ('dm/k1', 99, 20, 5)`);
  db.exec(`INSERT INTO wall_likes (post_id, author_hash, created_at) VALUES (3, '${A}', 30)`);
  db.exec(readFileSync(join(migrationsDir, '0019_retire_pair_columns.sql'), 'utf8'));

  for (const c of ['a_read_at', 'b_read_at', 'a_cleared_at', 'b_cleared_at']) assert.ok(!cols(db, 'dm_threads').includes(c), 'dm_threads.' + c + ' dropped');
  for (const c of ['react_a', 'react_b', 'liked_a', 'liked_b']) assert.ok(!cols(db, 'dms').includes(c), 'dms.' + c + ' dropped');
  for (const n of ['wall_likes', 'wall_comment_likes', 'dm_threads_ab_idx', 'dm_media_msg_idx']) assert.ok(!exists(db, n), n + ' dropped');
  /* what the outgoing worker still writes stands for one more deploy */
  assert.ok(cols(db, 'dm_threads').includes('a_hash') && cols(db, 'dm_threads').includes('b_hash'), 'a_hash / b_hash outlive the worker that writes them');
  assert.ok(cols(db, 'dm_media').includes('msg_id'), 'dm_media.msg_id outlives the worker that writes it');
  /* the kept fields of every row, unchanged */
  assert.deepEqual({ ...db.prepare('SELECT id, kind, pair_key, last_at, last_sender, msgs FROM dm_threads').get() },
    { id: 1, kind: 0, pair_key: A + '|' + B, last_at: 20, last_sender: B, msgs: 2 });
  assert.deepEqual({ ...db.prepare('SELECT id, thread_id, body, enc, media_key FROM dms').get() },
    { id: 5, thread_id: 1, body: 'E3.x', enc: 3, media_key: 'dm/k1' });
  assert.deepEqual({ ...db.prepare('SELECT key, size FROM dm_media').get() }, { key: 'dm/k1', size: 99 });
  assert.ok(exists(db, 'dm_threads_pair_idx'), 'one room per pair is still the pair_key index');
  db.close();
});

test('the worker names none of the columns the next migration drops', () => {
  const dir = join(root, 'comments-worker', 'src');
  const all = readdirSync(dir).filter((f) => f.endsWith('.ts')).map((f) => src(f))
    .concat(readdirSync(join(dir, 'routes')).filter((f) => f.endsWith('.ts')).map((f) => src('routes', f))).join('\n');
  assert.ok(!/\b[ab]_hash\b/.test(all.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')), 'no code reads or writes dm_threads.a_hash / b_hash');
  assert.ok(!/INSERT INTO dm_media \([^)]*msg_id/.test(all), 'an upload names no msg_id');
  assert.ok(!/FROM dm_media\b[^;'"]*msg_id|dm_media\.msg_id/.test(all), 'nothing reads dm_media.msg_id');
});

/* 0020 (2026-10-19), the second half: with 0019's worker deployed, the three
   columns it stopped writing go, and nothing they held is lost — the pair is
   its pair_key and the object's message its dm_media_refs row. */
test('0020 drops the three legacy columns once nothing writes them, and keeps every row', () => {
  const db = ledgerUpTo('0019');
  db.exec(`INSERT INTO dm_threads (id, kind, pair_key, created_at, last_at, last_sender, msgs, a_hash, b_hash)
           VALUES (1, 0, '${A}|${B}', 10, 20, '${B}', 2, '${A}', '${B}')`);
  db.exec(`INSERT INTO dm_media (key, size, created_at, msg_id) VALUES ('dm/k1', 99, 20, 5)`);
  db.exec(`INSERT INTO dm_media_refs (key, msg_id) VALUES ('dm/k1', 5)`);
  db.exec(readFileSync(join(migrationsDir, '0020_retire_legacy_writes.sql'), 'utf8'));

  for (const c of ['a_hash', 'b_hash']) assert.ok(!cols(db, 'dm_threads').includes(c), 'dm_threads.' + c + ' dropped');
  assert.ok(!cols(db, 'dm_media').includes('msg_id'), 'dm_media.msg_id dropped');
  assert.deepEqual({ ...db.prepare('SELECT id, pair_key, last_sender, msgs FROM dm_threads').get() },
    { id: 1, pair_key: A + '|' + B, last_sender: B, msgs: 2 }, 'the pair is still its pair_key');
  assert.deepEqual({ ...db.prepare('SELECT key, size, created_at FROM dm_media').get() }, { key: 'dm/k1', size: 99, created_at: 20 });
  assert.deepEqual({ ...db.prepare('SELECT key, msg_id FROM dm_media_refs').get() }, { key: 'dm/k1', msg_id: 5 }, 'the object still knows its message');
  db.close();
});
