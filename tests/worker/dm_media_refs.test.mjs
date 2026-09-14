/* An object dies with its LAST reference (2026-09-13): a forwarded attachment
 * is not re-uploaded, so one R2 object may be named by several messages in
 * several threads (dm_media_refs), and it is purged only when nothing names
 * it any more. The retention cap and the LRU valve take an object from under
 * EVERY message naming it; the orphan sweep takes what nothing names.
 *
 * What would break silently: the original's expiry taking the forward's
 * photo with it (a purge keyed on the first message); an object surviving its
 * last reference (a leak the sweeps cannot see); the cap stamping one message
 * and leaving the other pointing at a purged object; a fresh upload swept as
 * an orphan. The statements are lifted from lib.ts and run here in the order
 * the worker runs them. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const migrationsDir = join(root, 'comments-worker', 'migrations');
const libSrc = readFileSync(join(root, 'comments-worker', 'src', 'lib.ts'), 'utf8');

function freshDb() {
  const db = new DatabaseSync(':memory:');
  for (const f of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) db.exec(readFileSync(join(migrationsDir, f), 'utf8'));
  return db;
}
const libBody = (name) => { const i = libSrc.indexOf('async function ' + name + '('); assert.ok(i > 0, name); return libSrc.slice(i, libSrc.indexOf('\n}\n', i)); };
const carries = (body, frags) => { for (const f of frags) assert.ok(body.includes(f), 'carries: ' + f); };

const K = 'dm/' + '1'.repeat(64), L = 'dm/' + '2'.repeat(64), FRESH = 'dm/' + '3'.repeat(64), STALE = 'dm/' + '4'.repeat(64);
const A = 'a'.repeat(64), B = 'b'.repeat(64);

/* K is named by message 1 (thread 1) and its forward, message 2 (thread 2);
   L by message 3 alone; FRESH was uploaded a minute ago and not yet sent;
   STALE an hour ago and abandoned. */
function seeded(now = 10000) {
  const db = freshDb();
  db.exec(`INSERT INTO dm_threads (id, kind, pair_key, created_at, last_at, last_sender, msgs) VALUES (1, 0, '${A}|${B}', 1, 1, '${A}', 1), (2, 1, NULL, 1, 1, '${A}', 1)`);
  const ins = db.prepare('INSERT INTO dms (id, thread_id, sender_hash, body, created_at, enc, media_key, media_size, expires_at) VALUES (?, ?, ?, ?, ?, 3, ?, 10, ?)');
  ins.run(1, 1, A, 'E3.a', 100, K, now - 1);      // expired
  ins.run(2, 2, A, 'E3.b', 200, K, now + 100);    // the forward, live
  ins.run(3, 2, B, 'E3.c', 300, L, now + 100);
  db.exec(`INSERT INTO dm_media (key, size, created_at) VALUES ('${K}', 10, 99), ('${L}', 10, 299), ('${FRESH}', 10, ${now - 60}), ('${STALE}', 10, ${now - 3600})`);
  db.exec(`INSERT INTO dm_media_refs (key, msg_id) VALUES ('${K}', 1), ('${K}', 2), ('${L}', 3)`);
  return db;
}
/* releaseMediaRefs, as the worker runs it: the references of these messages go, then the objects nothing names. */
function release(db, rows) {
  const ids = rows.map((r) => r.id), keys = [...new Set(rows.map((r) => r.media_key))];
  db.prepare('DELETE FROM dm_media_refs WHERE msg_id IN (' + ids.map(() => '?').join(',') + ')').run(...ids);
  const dead = db.prepare('SELECT md.key FROM dm_media md WHERE md.key IN (' + keys.map(() => '?').join(',') + ') AND NOT EXISTS (SELECT 1 FROM dm_media_refs r WHERE r.key = md.key)').all(...keys).map((r) => r.key);
  if (dead.length) db.prepare('DELETE FROM dm_media WHERE key IN (' + dead.map(() => '?').join(',') + ')').run(...dead);
  return dead;
}
const objects = (db) => db.prepare('SELECT key FROM dm_media ORDER BY key').all().map((r) => r.key);

test('the statements are the worker\'s own', () => {
  carries(libBody('releaseMediaRefs'), ["'DELETE FROM dm_media_refs WHERE msg_id IN ('", "AND NOT EXISTS (SELECT 1 FROM dm_media_refs r WHERE r.key = md.key)'", 'if (dead.length) await purgeMediaKeys(env, dead);']);
  carries(libBody('dmExpireObjects'), ['const ids = await dmRefMessageIds(env, keys);', 'await purgeMediaKeys(env, keys);', "'UPDATE dms SET media_key = NULL, media_size = NULL, media_expired = 1 WHERE id IN ('", "'DELETE FROM dm_media_refs WHERE key IN ('"]);
  carries(libBody('sweepExpiredDms'), ["'SELECT id, media_key FROM dms WHERE expires_at IS NOT NULL AND expires_at < ?1 AND COALESCE(saved, 0) = 0 AND media_key IS NOT NULL LIMIT 5000'",
    'if (rows.length) await releaseMediaRefs(env, rows);', "'SELECT key FROM dm_media md WHERE md.created_at < ?1 AND NOT EXISTS (SELECT 1 FROM dm_media_refs r WHERE r.key = md.key) LIMIT 2000'",
    "'SELECT md.key AS key FROM dm_media md WHERE md.created_at < ?1 AND EXISTS (SELECT 1 FROM dm_media_refs r WHERE r.key = md.key) LIMIT 5000'", 'if (keys.length) await dmExpireObjects(env, keys);']);
  carries(libBody('enforceMediaCap'), ["'SELECT md.key, md.size FROM dm_media md WHERE EXISTS (SELECT 1 FROM dm_media_refs r WHERE r.key = md.key) ORDER BY md.created_at ASC LIMIT 1000'", 'if (kill.length) await dmExpireObjects(env, kill.map((r) => String(r.key)));']);
});

test('the original expires: its reference goes, the forward keeps the object; the forward goes: the object dies', () => {
  const db = seeded();
  const gone = db.prepare('SELECT id, media_key FROM dms WHERE expires_at IS NOT NULL AND expires_at < ?1 AND COALESCE(saved, 0) = 0 AND media_key IS NOT NULL LIMIT 5000').all(10000);
  assert.deepEqual(gone.map((r) => r.id), [1]);
  assert.deepEqual(release(db, gone), [], 'nothing purged: the forward still names K');
  assert.deepEqual(objects(db), [K, L, FRESH, STALE].sort());
  assert.deepEqual(release(db, [{ id: 2, media_key: K }]), [K], 'the last reference: K dies');
  assert.deepEqual(objects(db), [L, FRESH, STALE].sort());
  db.close();
});

test('a redacted forward lets go of its reference alone (the original keeps the object), and delete-conversation releases by the same road', () => {
  const db = seeded();
  assert.deepEqual(release(db, [{ id: 2, media_key: K }]), []);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM dm_media_refs WHERE key = ?').get(K).n, 1, 'the original\'s reference stands');
  assert.ok(/if \(row\.media_key\) await releaseMediaRefs\(env, \[\{ id: row\.id, media_key: row\.media_key \}\]\);/.test(readFileSync(join(root, 'comments-worker', 'src', 'index.ts'), 'utf8')), 'a redact releases its own reference');
  db.close();
});

test('the retention cap and the valve take an object from under EVERY message naming it: both stamped, the references gone, no message left pointing at a purged object', () => {
  const db = seeded();
  const aged = db.prepare('SELECT md.key AS key FROM dm_media md WHERE md.created_at < ?1 AND EXISTS (SELECT 1 FROM dm_media_refs r WHERE r.key = md.key) LIMIT 5000').all(150).map((r) => r.key);
  assert.deepEqual(aged, [K], 'K was uploaded before the cap; L after');
  const ids = db.prepare('SELECT msg_id FROM dm_media_refs WHERE key IN (?)').all(K).map((r) => r.msg_id);
  assert.deepEqual(ids.sort(), [1, 2], 'the original and the forward');
  db.prepare('DELETE FROM dm_media WHERE key IN (?)').run(K);
  db.prepare('UPDATE dms SET media_key = NULL, media_size = NULL, media_expired = 1 WHERE id IN (?, ?)').run(...ids);
  db.prepare('DELETE FROM dm_media_refs WHERE key IN (?)').run(K);
  assert.deepEqual(db.prepare('SELECT id, media_key, media_expired FROM dms ORDER BY id').all().map((r) => [r.id, r.media_key ? 'K/L' : null, r.media_expired]), [[1, null, 1], [2, null, 1], [3, 'K/L', null]]);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM dm_media_refs WHERE key = ?').get(K).n, 0);
  db.close();
});

test('the orphan sweep takes what nothing names past the window — never a fresh upload, never a named object', () => {
  const db = seeded();
  const orphans = db.prepare('SELECT key FROM dm_media md WHERE md.created_at < ?1 AND NOT EXISTS (SELECT 1 FROM dm_media_refs r WHERE r.key = md.key) LIMIT 2000').all(10000 - 900).map((r) => r.key);
  assert.deepEqual(orphans, [STALE], 'the abandoned upload; not the fresh one, not K or L');
  db.close();
});
