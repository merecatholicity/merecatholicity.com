/* Board attachments ride the WALL media pipeline (wall_media + WALLMEDIA) under
 * ref_type 'board' — 'comment' means a WALL comment, and the two id spaces are
 * unrelated (both AUTOINCREMENT from 1). These tests lock the two rules that
 * would break silently if someone "simplified" them:
 *   1. the hourly orphan sweep must never reclaim a live/pending board
 *      attachment, and must never confuse a board ref with a wall-comment ref
 *      that happens to share the same integer id;
 *   2. the migration ledger (0000..0005) must actually build — the sweep runs
 *      against the REAL schema here, not a hand-drawn copy.
 * The sweep SQL is asserted against comments-worker/src/lib.ts source text, so
 * the copy exercised here cannot drift from the copy that ships. The DB-coupled
 * upload/claim handlers themselves are exercised live (webtest) — the pure
 * rules under them (kind-of-key, masks, caps, clamps) are the Domain.Media
 * kernel's, spec'd in tests/purescript/media.test.mjs. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const migrationsDir = join(root, 'comments-worker', 'migrations');
const libSrc = readFileSync(join(root, 'comments-worker', 'src', 'lib.ts'), 'utf8');

/* The exact query sweepWallOrphanMedia runs (lib.ts), reassembled. The drift
 * guard below proves each fragment still appears verbatim in the source. */
const SWEEP_FRAGMENTS = [
  'SELECT key FROM wall_media WHERE (ref_id IS NULL AND created_at < ?1) ',
  "OR (ref_type = 'post' AND ref_id NOT IN (SELECT id FROM wall_posts)) ",
  "OR (ref_type = 'comment' AND ref_id NOT IN (SELECT id FROM wall_comments)) ",
  "OR (ref_type = 'board' AND ref_id NOT IN (SELECT id FROM comments WHERE status IN ('live', 'pending'))) LIMIT 2000",
];
const SWEEP_SQL = SWEEP_FRAGMENTS.join('');

function freshDb() {
  const db = new DatabaseSync(':memory:');
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) db.exec(readFileSync(join(migrationsDir, f), 'utf8'));
  return { db, files };
}

test('the migration ledger (0000..0005) builds a working schema', () => {
  const { db, files } = freshDb();
  assert.ok(files.some((f) => f.startsWith('0005_')), 'migration 0005 present');
  // The three media_expired columns and the comments media pointer exist.
  for (const t of ['comments', 'wall_posts', 'wall_comments']) {
    const cols = db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
    assert.ok(cols.includes('media_expired'), `${t}.media_expired`);
  }
  const cCols = db.prepare('PRAGMA table_info(comments)').all().map((c) => c.name);
  assert.ok(cCols.includes('media_key') && cCols.includes('media_size'), 'comments media pointer');
  db.close();
});

test('sweep SQL in this test matches lib.ts verbatim (drift guard)', () => {
  for (const frag of SWEEP_FRAGMENTS) {
    assert.ok(libSrc.includes(frag), 'lib.ts still carries: ' + frag);
  }
  // The 15-minute unlinked-orphan window (not the old hour).
  assert.ok(libSrc.includes('.bind(now - 900).all()'), 'orphan age is 15 minutes');
});

test('the orphan sweep spares live/pending board media and never cross-wires wall-comment ids', () => {
  const { db } = freshDb();
  const now = Math.floor(Date.now() / 1000);
  const hex = (c) => c.repeat(64);
  const key = (kind, c) => `wall/${kind}/${hex(c)}`;

  // A wall post (id 1) and a wall comment (id 1) — alive.
  db.prepare("INSERT INTO wall_posts (id, author_hash, body, created_at, status) VALUES (1, ?, 'p', ?, 'live')").run(hex('f'), now);
  db.prepare("INSERT INTO wall_comments (id, post_id, author_hash, body, created_at, status) VALUES (1, 1, ?, 'c', ?, 'live')").run(hex('f'), now);
  // Board comments: id 1 does NOT exist in comments (only 11/12/13 do) — the
  // collision case: a wall comment with id 1 exists, a board ref_id 1 must not
  // survive because of it.
  db.prepare("INSERT INTO comments (id, page, author_hash, body, status, created_at) VALUES (11, 'board:themes', ?, 'live post', 'live', ?)").run(hex('f'), now);
  db.prepare("INSERT INTO comments (id, page, author_hash, body, status, created_at) VALUES (12, 'board:themes', ?, 'held post', 'pending', ?)").run(hex('f'), now);
  db.prepare("INSERT INTO comments (id, page, author_hash, body, status, created_at) VALUES (13, 'board:themes', ?, 'gone post', 'deleted', ?)").run(hex('f'), now);

  const media = [
    // [key, created_at, ref_type, ref_id, expectSwept]
    [key('i', 'a'), now - 60, null, null, false],       // fresh unlinked: inside the 15-min grace
    [key('i', 'b'), now - 1200, null, null, true],      // stale unlinked: swept
    [key('i', 'c'), now - 9999, 'post', 1, false],      // wall post alive
    [key('i', 'd'), now - 9999, 'post', 999, true],     // wall post gone
    [key('i', 'e'), now - 9999, 'comment', 1, false],   // wall comment alive
    [key('a', '0'), now - 9999, 'board', 11, false],    // board live: spared
    [key('a', '1'), now - 9999, 'board', 12, false],    // board pending: evidence, spared
    [key('a', '2'), now - 9999, 'board', 13, true],     // board soft-deleted: swept
    [key('a', '3'), now - 9999, 'board', 999, true],    // board hard-pruned: swept
    [key('a', '4'), now - 9999, 'board', 1, true],      // board ref_id 1: comments has no id 1 — the wall comment with id 1 must NOT save it
  ];
  const ins = db.prepare('INSERT INTO wall_media (key, size, created_at, ref_type, ref_id) VALUES (?, 100, ?, ?, ?)');
  for (const [k, at, rt, ri] of media) ins.run(k, at, rt, ri);

  const swept = new Set(db.prepare(SWEEP_SQL).all(now - 900).map((r) => r.key));
  for (const [k, , rt, ri, expect] of media) {
    assert.equal(swept.has(k), expect,
      `${k} (${rt || 'unlinked'}:${ri ?? '-'}) should ${expect ? '' : 'NOT '}be swept`);
  }
  db.close();
});

test('handlePost link SQL uses ref_type board with the double-claim guard (drift guard)', () => {
  const idxSrc = readFileSync(join(root, 'comments-worker', 'src', 'index.ts'), 'utf8');
  assert.ok(idxSrc.includes("UPDATE wall_media SET ref_type = 'board', ref_id = ?1 WHERE key = ?2 AND ref_id IS NULL"),
    'the board link keeps the ref_id IS NULL race guard');
  // Live-SUM cap checks at upload time (never the stale sweep counter).
  assert.ok(idxSrc.includes('SELECT COALESCE(SUM(size), 0) AS total FROM wall_media'), 'wall upload live SUM');
  assert.ok(idxSrc.includes('SELECT COALESCE(SUM(size), 0) AS total FROM dm_media'), 'dm upload live SUM');
});
