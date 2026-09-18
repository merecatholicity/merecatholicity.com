/* Key rotation (the P0 chain's last piece, 2026-09-18). A member changes the
 * secret behind their identity and every row moves from the old account hash to
 * the new one, atomically, with the DM key material re-sealed so no conversation
 * goes dark. What would break silently: a new identity column added to the
 * schema but not to REKEY_COLS, so a rotation leaves the member's rows split
 * across two hashes (the "nothing left behind" sweep catches exactly that); a
 * partial move on a mid-batch failure (the batch is atomic); or a rotation that
 * drops a DM because its re-seal was missing (refused, never silent). */
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadWorker, makeEnv, freshDb, identity, establish, publishKey, call, resetCaches } from '../_support/worker.mjs';
import { sha256hex } from '../../comments-worker/src/lib.ts';
import { REKEY_COLS } from '../../comments-worker/src/routes/rekey.ts';

const STRONG = 'a-brand-new-strong-key-2026!';   // 20+ chars, 3 classes: clears the floor
let worker, ann, bob;
before(async () => {
  ({ worker } = await loadWorker());
  [ann, bob] = await Promise.all(['ann', 'bob'].map(identity));
});
beforeEach(resetCaches);

/* ann, established, with a post, a profile, a pair DM with bob (she sent one
   word and holds a sealed key for it), a published pubkey and a reaction. */
function seedAnn(db) {
  establish(db, ann.hash); establish(db, bob.hash);
  publishKey(db, ann.hash); publishKey(db, bob.hash);
  db.prepare("UPDATE profiles SET nick = 'Ann' WHERE hash = ?").run(ann.hash);
  db.prepare("INSERT INTO comments (id, page, author_hash, title, body, status, created_at) VALUES (1, 'board:pub', ?, 'T', 'hi', 'live', 5)").run(ann.hash);
  db.prepare("INSERT INTO reactions (target, target_id, author_hash, emoji, created_at) VALUES ('post', 1, ?, '❤️', 5)").run(ann.hash);
  db.prepare("INSERT INTO bookmarks (hash, kind, ref, created_at) VALUES (?, 'topic', '1', 5)").run(ann.hash);
  const pk = 'ann|' + bob.hash; const [a, b] = [ann.hash, bob.hash].sort(); const pair = a + '|' + b;
  db.prepare("INSERT INTO dm_threads (id, kind, pair_key, created_at, last_at, last_sender, msgs, a_hash, b_hash) VALUES (7, 0, ?, 1, 2, ?, 1, ?, ?)").run(pair, ann.hash, a, b);
  db.prepare("INSERT INTO dm_members (thread_id, hash, joined_at) VALUES (7, ?, 1), (7, ?, 1)").run(ann.hash, bob.hash);
  db.prepare("INSERT INTO dms (id, thread_id, sender_hash, body, enc, created_at) VALUES (9, 7, ?, 'E3.x', 3, 2)").run(ann.hash);
  db.prepare("INSERT INTO dm_keys (msg_id, hash, sealed) VALUES (9, ?, 'oldsealedforann'), (9, ?, 'oldsealedforbob')").run(ann.hash, bob.hash);
  return pair;
}

const rekeyBody = (extra) => ({ key: ann.key, newkey: STRONG, pubkey: 'A'.repeat(43), resealed: { 9: 'S3.newsealed' }, ...extra });

test('a rotation moves EVERY identity column from the old hash to the new — nothing is left behind', async () => {
  const db = freshDb();
  const env = makeEnv({ db });
  seedAnn(db);
  const hNew = await sha256hex(STRONG);
  const r = await call(worker, env, 'POST', '/api/comments/profile/rekey', rekeyBody());
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.hash, hNew, 'the answer is the new account hash (a pubid once a pepper is set)');
  /* the sweep: no identity column anywhere still holds the OLD hash */
  const left = [];
  for (const [tbl, col] of REKEY_COLS) {
    const n = db.prepare('SELECT COUNT(*) AS n FROM ' + tbl + ' WHERE ' + col + ' = ?').get(ann.hash).n;
    if (n) left.push(tbl + '.' + col + '=' + n);
  }
  assert.deepEqual(left, [], 'these columns still name the old hash after a rotation');
  /* and the content is under the new hash */
  assert.equal(db.prepare('SELECT nick FROM profiles WHERE hash = ?').get(hNew).nick, 'Ann', 'the profile moved');
  assert.equal(db.prepare('SELECT author_hash FROM comments WHERE id = 1').get().author_hash, hNew, 'the post moved');
  assert.equal(db.prepare('SELECT hash FROM dm_members WHERE thread_id = 7 AND hash = ?').get(hNew)?.hash, hNew, 'DM membership moved');
  db.close();
});

test('the DM key material is re-sealed: the moved dm_keys row carries the new seal, not the old', async () => {
  const db = freshDb();
  const env = makeEnv({ db });
  seedAnn(db);
  const hNew = await sha256hex(STRONG);
  const r = await call(worker, env, 'POST', '/api/comments/profile/rekey', rekeyBody());
  assert.equal(r.status, 200);
  const row = db.prepare('SELECT sealed FROM dm_keys WHERE msg_id = 9 AND hash = ?').get(hNew);
  assert.equal(row.sealed, 'S3.newsealed', 'ann\'s sealed key was replaced with her re-seal under the new key');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM dm_keys WHERE hash = ?").get(ann.hash).n, 0, 'none left under the old hash');
  /* bob\'s key is untouched — only the rotating member\'s is re-sealed */
  assert.equal(db.prepare('SELECT sealed FROM dm_keys WHERE msg_id = 9 AND hash = ?').get(bob.hash).sealed, 'oldsealedforbob');
  /* the new pubkey is published */
  assert.equal(db.prepare('SELECT pubkey FROM dm_pubkeys WHERE hash = ?').get(hNew).pubkey, 'A'.repeat(43));
  db.close();
});

test('the pair_key is re-sorted so the conversation is still found under the new hash', async () => {
  const db = freshDb();
  const env = makeEnv({ db });
  seedAnn(db);
  const hNew = await sha256hex(STRONG);
  await call(worker, env, 'POST', '/api/comments/profile/rekey', rekeyBody());
  const [a, b] = [hNew, bob.hash].sort();
  assert.equal(db.prepare('SELECT pair_key FROM dm_threads WHERE id = 7').get().pair_key, a + '|' + b, 'pair_key recomputed from the new hash');
  db.close();
});

test('an incomplete re-seal is refused — a rotation never drops a conversation', async () => {
  const db = freshDb();
  const env = makeEnv({ db });
  seedAnn(db);
  const r = await call(worker, env, 'POST', '/api/comments/profile/rekey', rekeyBody({ resealed: {} }));
  assert.equal(r.status, 409);
  assert.equal(r.json.error, 'reseal-incomplete');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM comments WHERE author_hash = ?').get(ann.hash).n, 1, 'nothing moved — the batch never ran');
  db.close();
});

test('a weak new key is refused (the floor), and a colliding new hash is refused', async () => {
  const db = freshDb();
  const env = makeEnv({ db });
  seedAnn(db);
  const weak = await call(worker, env, 'POST', '/api/comments/profile/rekey', rekeyBody({ newkey: 'short' }));
  assert.equal(weak.status, 400);
  assert.equal(weak.json.weak_key, true, 'the new key must clear the floor');
  /* a new key whose hash already belongs to bob → collision */
  const bobKeyBody = rekeyBody({ newkey: bob.key });
  const clash = await call(worker, env, 'POST', '/api/comments/profile/rekey', bobKeyBody);
  assert.equal(clash.status, 409, 'a new hash that is already in use is refused');
  db.close();
});

test('the same key is refused (a rotation must change the secret)', async () => {
  const db = freshDb();
  const env = makeEnv({ db });
  seedAnn(db);
  const r = await call(worker, env, 'POST', '/api/comments/profile/rekey', rekeyBody({ newkey: ann.key }));
  assert.equal(r.status, 400);
  db.close();
});
