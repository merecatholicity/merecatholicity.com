/* One road registers a member, and the directory lists members (P2-2,
 * 2026-09-16). A keyed read on a fresh identity leaves a profiles row through
 * registerMember — enough to be spared the challenge (isEstablished), not
 * enough to be listed: the directory takes a nick, a live post or a published
 * DM key. What would break silently: every visitor who ever opened the board
 * count listed as a member (the 53 for six humans); or the spare tightening
 * because the row moved roads. */
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadWorker, makeEnv, freshDb, identity, publishKey, call, resetCaches } from '../_support/worker.mjs';
import { isEstablished, registerMember } from '../../comments-worker/src/lib.ts';

let worker, ann, bob, cal, dan, eve;
before(async () => {
  ({ worker } = await loadWorker());
  [ann, bob, cal, dan, eve] = await Promise.all(['ann', 'bob', 'cal', 'dan', 'eve'].map(identity));
});
beforeEach(resetCaches);

test('a keyed read registers the identity once, through the one road — it neither spares nor lists it', async () => {
  const db = freshDb();
  const env = makeEnv({ db });
  assert.equal(await isEstablished(env, dan.hash), false);
  let r = await call(worker, env, 'POST', '/api/comments/prefs', { key: dan.key, set: { receipts: 'off' } });
  assert.equal(r.status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM profiles WHERE hash = ?').get(dan.hash).n, 1, 'the row appeared');
  /* The row says "has acted", never "a person answered for this identity"
     (2026-09-17): for five weeks it said both, so one keyed read spared a
     fresh key the challenge for ever. Establishment is `verified_at` now, and
     only a passed challenge writes it. */
  assert.equal(await isEstablished(env, dan.hash), false, 'a row from a read establishes nothing');
  assert.equal(r.json.turnstile.spared, false, 'and the answer tells the client so');
  await registerMember(env, dan.hash, 5);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM profiles WHERE hash = ?').get(dan.hash).n, 1, 'idempotent');
  r = await call(worker, env, 'GET', '/api/comments/dm/directory');
  assert.deepEqual(r.json.users.map((u) => u.hash), [], 'a bare row is not a member');
  db.close();
});

test('a nick, a live post (forum or feed) or a published key lists a member; a deleted post does not', async () => {
  const db = freshDb();
  const env = makeEnv({ db });
  for (const who of [ann, bob, cal, dan, eve]) await registerMember(env, who.hash, 1);
  db.prepare("UPDATE profiles SET nick = 'Ann' WHERE hash = ?").run(ann.hash);
  db.prepare("INSERT INTO comments (id, page, author_hash, body, status, created_at) VALUES (1, 'board:pub', ?, 'hello', 'live', 5)").run(bob.hash);
  publishKey(db, cal.hash);
  db.prepare("INSERT INTO wall_posts (id, author_hash, body, created_at) VALUES (3, ?, 'a feed post', 1)").run(dan.hash);
  db.prepare("INSERT INTO comments (id, page, author_hash, body, status, created_at) VALUES (2, 'board:pub', ?, 'gone', 'deleted', 5)").run(eve.hash);
  const r = await call(worker, env, 'GET', '/api/comments/dm/directory');
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.users.map((u) => u.hash).sort(), [ann.hash, bob.hash, cal.hash, dan.hash].sort(), 'ann (nick), bob (post), cal (key), dan (feed post) — not eve (only a deleted post)');
  db.close();
});
