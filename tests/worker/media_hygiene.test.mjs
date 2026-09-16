/* Media hygiene (2026-09-12): every road that removes a message — a delete,
 * an expiry, a prune, a purge, a member's deletion — takes the media object
 * (R2) and its accounting row with it, on all three surfaces: the feed, the
 * board, the DMs. The audit the owner asked for, made a standing guard.
 *
 * What would break silently: a delete path that nulls the row's media_key
 * without purging the object (a leak the sweeps cannot see — the row no
 * longer names the key); a hard delete that drops the row before the key was
 * read; a member's deletion that leaves their feed and its media behind (the
 * gap found and closed the same day); a sweep dropped from the cron chain.
 * Every check reads the sources; the delete-user road runs on the ledger. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { handlerBody, routesSource } from '../_support/worker_src.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const migrationsDir = join(root, 'comments-worker', 'migrations');
const idx = routesSource();
const lib = readFileSync(join(root, 'comments-worker', 'src', 'lib.ts'), 'utf8');
const body = (src, name) => handlerBody(name, src);
const before = (text, a, b) => { const i = text.indexOf(a), j = text.indexOf(b); assert.ok(i > 0 && j > 0, a + ' / ' + b); return i < j; };

test('the board: a soft-deleted post, a deleted topic, a move into the back room, a deleted member — every attachment purged, never left named by a row', () => {
  const del = body(idx, 'handleSelfDelete');   // the member's own delete (and an admin's, by the same road)
  assert.ok(/await purgeWallMedia\(env, \[row\.media_key\]\);\s*await env\.DB\.prepare\('UPDATE comments SET media_key = NULL, media_size = NULL WHERE id = \?1'\)/.test(del), 'purge, then null');
  const mod = body(idx, 'handleModerate'), move = body(idx, 'handleMove');
  const gather = /SELECT media_key FROM comments WHERE \(id = \?1 OR parent_id = \?1\) AND media_key IS NOT NULL/;
  assert.ok(gather.test(mod) && gather.test(move), 'a topic delete and a move into the back room both gather the thread\'s keys');
  assert.ok(before(mod, 'await purgeWallMedia(env, keys);', "UPDATE comments SET status = 'deleted' WHERE id = ?1"), 'the keys are read and purged before the status flips');
  assert.ok(before(move, 'await purgeWallMedia(env, keys);', 'UPDATE comments SET page = '), 'and before the move lands in the back room');
  const du = body(idx, 'handleDeleteUser');
  assert.ok(/SELECT media_key FROM comments WHERE author_hash = \?1 AND media_key IS NOT NULL/.test(du) && before(du, 'await purgeWallMedia(env, keys);', "UPDATE comments SET status = 'deleted' WHERE author_hash = ?1"), 'their attachments go before their posts are retired');
});

test('the feed: a deleted post takes its comments\' media, a deleted comment its own, the prune everything past the line — keys read before rows go', () => {
  const wd = body(idx, 'handleWallDelete');
  assert.ok(/if \(row\.media_key\) await purgeWallMedia\(env, \[row\.media_key\]\);\s*await env\.DB\.prepare\('DELETE FROM wall_comments WHERE id = \?1'\)/.test(wd), 'a comment: purge, then delete');
  assert.ok(/SELECT media_key FROM wall_comments WHERE post_id = \?1 AND media_key IS NOT NULL/.test(wd) && before(wd, 'if (keys.length) await purgeWallMedia(env, keys);', "DELETE FROM wall_comments WHERE post_id = ?1"), 'a post: its comments\' keys and its own, purged before the rows go');
  const prune = lib.slice(lib.indexOf('export async function runWallPrune('), lib.indexOf('\nexport async function ', lib.indexOf('export async function runWallPrune(') + 10));
  assert.ok(before(prune, 'if (keys.length) await purgeWallMedia(env, keys);', 'DELETE FROM wall_comments WHERE created_at < ?1'), 'the prune purges before it deletes');
});

test('the DMs: a redacted message, a purged conversation, an expired message, an aged attachment, an orphan — each lets go of its object, which dies with its LAST reference (0016)', () => {
  const red = body(idx, 'handleDmRedact');
  assert.ok(before(red, 'if (row.media_key) await releaseMediaRefs(env, [{ id: row.id, media_key: row.media_key }]);', "UPDATE dms SET redacted = 1"), 'a redact lets go before it blanks');
  const conv = body(idx, 'handleDmDelete');
  assert.ok(/SELECT id, media_key FROM dms WHERE thread_id = \?1 AND media_key IS NOT NULL/.test(conv) && before(conv, 'await releaseMediaRefs(env, (media.results || []) as any[]);', 'DELETE FROM dms WHERE thread_id = ?1'), 'a purged conversation: the references first');
  const sweep = lib.slice(lib.indexOf('export async function sweepExpiredDms('), lib.indexOf('\nexport async function ', lib.indexOf('export async function sweepExpiredDms(') + 10));
  assert.ok(before(sweep, 'if (rows.length) await releaseMediaRefs(env, rows);', 'DELETE FROM dms WHERE expires_at IS NOT NULL AND expires_at < ?1'), 'expiry: the references before the rows');
  assert.ok(/NOT EXISTS \(SELECT 1 FROM dm_media_refs r WHERE r\.key = md\.key\) LIMIT 2000/.test(sweep), 'orphans: nothing names it, past the window');
  assert.ok(/mediaRetentionDays\(settings, 'dm'\)/.test(sweep) && /await dmExpireObjects\(env, keys\)/.test(sweep), 'the retention cap takes the object from under EVERY message naming it');
  const expire = lib.slice(lib.indexOf('async function dmExpireObjects('), lib.indexOf('\n}\n', lib.indexOf('async function dmExpireObjects(')));
  assert.ok(/UPDATE dms SET media_key = NULL, media_size = NULL, media_expired = 1/.test(expire) && before(expire, 'await purgeMediaKeys(env, keys);', 'DELETE FROM dm_media_refs WHERE key IN'), 'purge, stamp every message, drop the references');
  const rel = lib.slice(lib.indexOf('export async function releaseMediaRefs('), lib.indexOf('\n}\n', lib.indexOf('export async function releaseMediaRefs(')));
  assert.ok(/DELETE FROM dm_media_refs WHERE msg_id IN/.test(rel) && /NOT EXISTS \(SELECT 1 FROM dm_media_refs r WHERE r\.key = md\.key\)/.test(rel) && /if \(dead\.length\) await purgeMediaKeys\(env, dead\);/.test(rel), 'the references go, then only the objects nothing names');
  const roads = idx + lib;
  const bare = (roads.match(/await purgeMediaKeys\(env, /g) || []).length;
  assert.equal(bare, 3, 'purgeMediaKeys is called from releaseMediaRefs, dmExpireObjects and the orphan sweep alone — never straight from a message road (found ' + bare + ')');
  const pm = lib.slice(lib.indexOf('export async function purgeMediaKeys('), lib.indexOf('\nexport async function ', lib.indexOf('export async function purgeMediaKeys(') + 10));
  const pw = lib.slice(lib.indexOf('export async function purgeWallMedia('), lib.indexOf('\nexport async function ', lib.indexOf('export async function purgeWallMedia(') + 10));
  assert.ok(/env\.MEDIA\.delete\(/.test(pm) && /DELETE FROM dm_media WHERE key IN/.test(pm) && /env\.WALLMEDIA\.delete\(/.test(pw) && /DELETE FROM wall_media WHERE key IN/.test(pw), 'both purges take the object AND the accounting row');
});

test('the backstops stand in the cron chain, and the board orphan rule spares only a live or pending owner', () => {
  const sched = idx.slice(idx.indexOf('async scheduled('));
  for (const fn of ['sweepExpiredDms(env)', 'sweepWallOrphanMedia(env)', 'sweepMediaRetention(env)']) assert.ok(sched.includes(fn), fn + ' is scheduled');
  const orphan = lib.slice(lib.indexOf('export async function sweepWallOrphanMedia('), lib.indexOf('\nexport async function ', lib.indexOf('export async function sweepWallOrphanMedia(') + 10));
  assert.ok(/ref_type = 'board' AND ref_id NOT IN \(SELECT id FROM comments WHERE status IN \('live', 'pending'\)\)/.test(orphan), 'a soft-deleted post\'s attachment is reclaimed within the hour even when the immediate purge failed');
});

test('delete user, on the ledger: their feed posts (with everyone\'s comments under them), their comments elsewhere, the reactions, the counts — and every key gathered for the purge', () => {
  const du = body(idx, 'handleDeleteUser');
  assert.ok(/SELECT id, media_key FROM wall_posts WHERE author_hash = \?1/.test(du) && /SELECT id, post_id, media_key FROM wall_comments WHERE author_hash = \?1/.test(du), 'their posts and their comments');
  assert.ok(before(du, 'if (keys.length) await purgeWallMedia(env, keys);', 'await sweepJournalComments(env);') && before(du, "DELETE FROM wall_posts WHERE id IN (", 'if (keys.length) await purgeWallMedia(env, keys);'), 'keys gathered from the rows, the rows deleted, the objects purged');
  /* the statements, run on the real ledger */
  const db = new DatabaseSync(':memory:');
  for (const f of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) db.exec(readFileSync(join(migrationsDir, f), 'utf8'));
  const gone = 'g'.repeat(64), other = 'o'.repeat(64);
  db.exec(`INSERT INTO wall_posts (id, author_hash, body, created_at, media_key, comments) VALUES (1, '${gone}', 'mine', 1, 'wall/i/aa', 2), (2, '${other}', 'theirs', 1, 'wall/i/bb', 1)`);
  db.exec(`INSERT INTO wall_comments (id, post_id, author_hash, body, created_at, media_key) VALUES (10, 1, '${other}', 'on mine', 2, 'wall/i/cc'), (11, 1, '${gone}', 'me on mine', 3, NULL), (12, 2, '${gone}', 'me on theirs', 4, 'wall/i/dd'), (13, 2, '${other}', 'them on theirs', 5, NULL)`);
  db.exec(`INSERT INTO reactions (target, target_id, author_hash, emoji, created_at) VALUES ('wall', 1, '${other}', '👍', 1), ('wallc', 12, '${other}', '❤️', 1), ('wall', 2, '${gone}', '😂', 1)`);
  const keys = [];
  const mine = db.prepare('SELECT id, media_key FROM wall_posts WHERE author_hash = ?').all(gone);
  const postIds = mine.map((r) => r.id); mine.forEach((r) => { if (r.media_key) keys.push(r.media_key); });
  const ph = postIds.map(() => '?').join(',');
  db.prepare('SELECT media_key FROM wall_comments WHERE post_id IN (' + ph + ') AND media_key IS NOT NULL').all(...postIds).forEach((r) => keys.push(r.media_key));
  db.prepare("DELETE FROM reactions WHERE target = 'wallc' AND target_id IN (SELECT id FROM wall_comments WHERE post_id IN (" + ph + '))').run(...postIds);
  db.prepare('DELETE FROM wall_comments WHERE post_id IN (' + ph + ')').run(...postIds);
  db.prepare("DELETE FROM reactions WHERE target = 'wall' AND target_id IN (" + ph + ')').run(...postIds);
  db.prepare('DELETE FROM wall_posts WHERE id IN (' + ph + ')').run(...postIds);
  const theirs = db.prepare('SELECT id, post_id, media_key FROM wall_comments WHERE author_hash = ?').all(gone);
  const cIds = theirs.map((r) => r.id); theirs.forEach((r) => { if (r.media_key) keys.push(r.media_key); });
  const ph2 = cIds.map(() => '?').join(',');
  db.prepare("DELETE FROM reactions WHERE target = 'wallc' AND target_id IN (" + ph2 + ')').run(...cIds);
  db.prepare('DELETE FROM wall_comments WHERE id IN (' + ph2 + ')').run(...cIds);
  db.prepare("UPDATE wall_posts SET comments = (SELECT COUNT(*) FROM wall_comments WHERE post_id = wall_posts.id AND status = 'live') WHERE id IN (?)").run(2);
  assert.deepEqual(keys.sort(), ['wall/i/aa', 'wall/i/cc', 'wall/i/dd'], 'my post\'s image, the comment\'s image under it, my comment\'s image under theirs — and not their post\'s');
  assert.deepEqual(db.prepare('SELECT id FROM wall_posts ORDER BY id').all().map((r) => r.id), [2], 'their post stays');
  assert.deepEqual(db.prepare('SELECT id FROM wall_comments ORDER BY id').all().map((r) => r.id), [13], 'only their own comment under their own post stays');
  assert.equal(db.prepare('SELECT comments FROM wall_posts WHERE id = 2').get().comments, 1, 'the surviving post\'s count is recomputed');
  assert.deepEqual(db.prepare('SELECT target, target_id FROM reactions').all().map((r) => r.target + ':' + r.target_id), ['wall:2'], 'the reactions on what went, gone; my reaction on their post stays with it');
  db.close();
});
