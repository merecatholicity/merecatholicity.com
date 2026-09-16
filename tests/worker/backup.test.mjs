/* The backup (2026-09-16: daily, restorable, recorded). The dump is replayed
 * into a fresh SQLite — twice — and must come back the same ledger both
 * times: INSERT OR REPLACE, every index (UNIQUE ones too) IF NOT EXISTS, the
 * search index rebuilt from the restored comments, no FTS shadow table in the
 * file. runBackup writes today's object, prunes by the kernel's rule (90
 * days; a first-of-month object 400; anything it does not recognise kept),
 * and records what it did — or what failed — in app_settings ops_backup.
 *
 * What would break silently: a restore that duplicates rows or dies on the
 * second statement (a plain INSERT, a UNIQUE index without IF NOT EXISTS);
 * a BLOB dumped as "[object ArrayBuffer]"; the monthly history pruned with the
 * dailies; a failed backup that left no record for the self-check to read. */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
import { loadWorker, makeEnv, freshDb, identity, establish, call, resetCaches } from '../_support/worker.mjs';
import { dumpDatabase, runBackup, mirrorAvatars, sqlLit } from '../../comments-worker/src/lib.ts';

let me, ann;
before(async () => { [me, ann] = await Promise.all(['me', 'ann'].map(identity)); });

const QUOTE = "it's a quote — with ''two'' apostrophes, a tab\t, and unicode ✓";
function seeded() {
  const db = freshDb();
  establish(db, me.hash); establish(db, ann.hash);
  db.prepare("INSERT INTO comments (id, page, author_hash, body, status, created_at) VALUES (1, 'board:pub', ?, 'the quick brown fox', 'live', 1), (2, 'board:pub', ?, 'jumps over the lazy dog', 'live', 2)").run(me.hash, ann.hash);
  db.prepare("INSERT INTO dm_threads (id, kind, pair_key, created_at, last_at, last_sender, msgs) VALUES (7, 0, ?, 1, 1, ?, 0)").run([me.hash, ann.hash].sort().join('|'), ann.hash);
  db.prepare('INSERT INTO dm_members (thread_id, hash, joined_at) VALUES (7, ?, 1), (7, ?, 1)').run(me.hash, ann.hash);
  db.prepare("INSERT INTO notifications (recipient_hash, kind, topic_id, comment_id, actor_hash, created_at) VALUES (?, 'dm', 7, 0, ?, 1)").run(me.hash, ann.hash);
  db.prepare('INSERT INTO wall_posts (id, author_hash, body, created_at) VALUES (3, ?, ?, 1)').run(ann.hash, QUOTE);
  db.prepare("INSERT INTO app_settings (k, v, updated_at, updated_by) VALUES ('alert_email', 'owner@example.org', 1, 'test')").run();
  return db;
}
const userTables = (db) => db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'comments_fts%' ORDER BY name").all().map((r) => r.name);
const counts = (db) => Object.fromEntries(userTables(db).map((t) => [t, db.prepare('SELECT COUNT(*) AS n FROM "' + t + '"').get().n]));

test('the dump is a restorable, idempotent file: OR REPLACE, every index IF NOT EXISTS, the search index rebuilt, no shadow table', async () => {
  const db = seeded();
  const stats = { tables: 0, rows: 0 };
  const sql = await dumpDatabase(makeEnv({ db }), stats);
  assert.match(sql, /^-- merecatholicity-comments backup /);
  assert.equal((sql.match(/^INSERT INTO "/gm) || []).length, 0, 'no plain INSERT — a replay must not duplicate or die');
  assert.ok((sql.match(/^INSERT OR REPLACE INTO "/gm) || []).length >= 6);
  assert.equal((sql.match(/^CREATE (UNIQUE )?INDEX (?!IF NOT EXISTS)/gm) || []).length, 0, 'every index guarded (sqlite_master strips the clause)');
  assert.match(sql, /^CREATE UNIQUE INDEX IF NOT EXISTS profiles_handle ON profiles\(handle\);/m);
  assert.doesNotMatch(sql, /comments_fts_(data|idx|content|docsize|config)/, 'the FTS shadow tables are derived data and would break the replay');
  assert.match(sql, /^CREATE VIRTUAL TABLE IF NOT EXISTS comments_fts /m);
  assert.match(sql, /INSERT INTO comments_fts\(comments_fts\) VALUES\('rebuild'\);$/);
  const src = counts(db);
  assert.equal(stats.tables, Object.keys(src).length, 'every user table dumped');
  assert.equal(stats.rows, Object.values(src).reduce((a, b) => a + b, 0), 'every row counted');
  /* replay, twice */
  const db2 = new DatabaseSync(':memory:');
  db2.exec(sql);
  assert.deepEqual(counts(db2), src, 'the same ledger');
  db2.exec(sql);
  assert.deepEqual(counts(db2), src, 'and the same after a second replay');
  assert.equal(db2.prepare('SELECT body FROM wall_posts WHERE id = 3').get().body, QUOTE, 'quoting round-trips');
  assert.equal(db2.prepare("SELECT COUNT(*) AS n FROM comments_fts WHERE comments_fts MATCH 'lazy'").get().n, 1, 'search works from the rebuilt index');
  db2.close(); db.close();
});

test('a BLOB is dumped as X\'…\', never as an object\'s toString', () => {
  assert.equal(sqlLit(new Uint8Array([0, 15, 255]).buffer), "X'000fff'");
  assert.equal(sqlLit(new Uint8Array([1, 2])), "X'0102'");
  assert.equal(sqlLit("o'k"), "'o''k'");
  assert.equal(sqlLit(null), 'NULL');
  assert.equal(sqlLit(NaN), 'NULL');
});

test('runBackup writes today\'s object, prunes by the kernel\'s rule, and records the run in ops_backup', async () => {
  const db = seeded();
  const env = makeEnv({ db });
  const old = (key, days) => env.BACKUPS.objects.set(key, { bytes: new Uint8Array(2000), meta: {}, uploaded: new Date(Date.now() - days * 86400000) });
  old('backups/comments-2026-06-01.sql.gz', 107);   // the 1st of a month: 400 days
  old('backups/comments-2026-06-15.sql.gz', 93);    // a daily past 90
  old('backups/comments-2026-09-10.sql.gz', 6);     // a recent daily
  old('backups/comments-2025-08-01.sql.gz', 411);   // a 1st past 400
  old('backups/notes.txt', 900);                    // not the rule's: never deleted
  const before = counts(db);                        // the ledger as dumped (runBackup then records itself in app_settings)
  const r = await runBackup(env);
  const today = new Date().toISOString().slice(0, 10);
  assert.equal(r.key, 'backups/comments-' + today + '.sql.gz');
  assert.ok(r.bytes > 1024 && r.tables > 20 && r.rows >= 8, JSON.stringify(r));
  assert.deepEqual([...env.BACKUPS.objects.keys()].sort(), [
    'backups/comments-2026-06-01.sql.gz', 'backups/comments-2026-09-10.sql.gz', r.key, 'backups/notes.txt'].sort());
  assert.deepEqual([r.pruned, r.kept], [2, 4]);
  const put = env.r2.find((c) => c.op === 'put' && c.key === r.key);
  assert.ok(put, 'the object was put');
  const text = gunzipSync(Buffer.from(env.BACKUPS.objects.get(r.key).bytes)).toString('utf8');
  assert.match(text, /^-- merecatholicity-comments backup /);
  const db2 = new DatabaseSync(':memory:'); db2.exec(text);
  assert.deepEqual(counts(db2), before, 'the object in the bucket restores the ledger');
  db2.close();
  const rec = JSON.parse(db.prepare("SELECT v FROM app_settings WHERE k = 'ops_backup'").get().v);
  assert.deepEqual([rec.key, rec.bytes, rec.tables, rec.rows, rec.error], [r.key, r.bytes, r.tables, r.rows, undefined], 'the record the self-check reads');
  db.close();
});

test('a failed backup leaves its record and rethrows; the admin door still answers the documented shape', async () => {
  const db = seeded();
  const env = makeEnv({ db });
  env.BACKUPS = undefined;
  await assert.rejects(runBackup(env), /BACKUPS bucket not bound/);
  const rec = JSON.parse(db.prepare("SELECT v FROM app_settings WHERE k = 'ops_backup'").get().v);
  assert.match(rec.error, /BACKUPS bucket not bound/);
  assert.equal(rec.key, 'backups/comments-' + new Date().toISOString().slice(0, 10) + '.sql.gz');
  const { worker } = await loadWorker();
  resetCaches();
  const adm = await identity('the-admin');
  const env2 = makeEnv({ db, vars: { ADMIN_HASHES: adm.hash } });
  env2.BACKUPS = undefined;
  const r = await call(worker, env2, 'POST', '/api/comments/backup', { key: adm.key });
  assert.equal(r.status, 200);
  assert.match(r.json.backup.error, /BACKUPS bucket not bound/);
  const ok = await call(worker, makeEnv({ db, vars: { ADMIN_HASHES: adm.hash } }), 'POST', '/api/comments/backup', { key: adm.key });
  assert.equal(ok.status, 200);
  assert.ok(ok.json.backup.bytes > 1024 && ok.json.backup.key.startsWith('backups/comments-'), 'Back up now answers the run\'s record');
  db.close();
});

test('the avatar mirror copies up to its cap into the backup bucket and says what it skipped', async () => {
  const env = makeEnv({ db: freshDb() });
  for (const n of ['a', 'b', 'c']) await env.AVATARS.put('avatars/' + n + '.png', new Uint8Array([1, 2, 3]), { httpMetadata: { contentType: 'image/png' } });
  const r = await mirrorAvatars(env, 2);
  assert.deepEqual(r, { mirrored: 2, skipped: 1 });
  assert.deepEqual([...env.BACKUPS.objects.keys()].sort(), ['avatars-mirror/a.png', 'avatars-mirror/b.png']);
  assert.deepEqual(await mirrorAvatars({ ...env, AVATARS: undefined }, 2), { mirrored: 0, skipped: 0 }, 'no avatars bucket: nothing to do, no throw');
});
