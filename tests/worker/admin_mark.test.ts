/* The "(admin)" mark is the worker's word on the row (2026-11-04) — RUN, not read.
 *
 * What broke silently: the client stamped "(admin)" by looking a row's
 * author_hash up in its built-in ADMIN_HASHES. That list holds ACCOUNT hashes,
 * and since the P0 chain (2026-09-19) a row's author_hash is the PUBLIC id, so
 * the lookup missed for every post and no admin was marked for seven weeks. A
 * client never sees an account hash, so it cannot decide this; the worker does,
 * from the admins table, before it cloaks the id. With a pepper set, as in
 * production, the id on the row is not the account hash — the case the hermetic
 * suite otherwise skips. */
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadWorker, makeEnv, freshDb, identity, establish, call, resetCaches } from '../_support/worker.ts';
import { clearIdCaches } from '../../comments-worker/src/lib.ts';
import type { Worker, Row } from '../_support/worker.ts';
import type { DatabaseSync } from 'node:sqlite';

type Id = { key: string; hash: string };
const PEPPER = 'a-stable-test-pepper-value';
let worker: Worker, adm: Id, bob: Id;
before(async () => {
  ({ worker } = await loadWorker());
  [adm, bob] = await Promise.all(['adm', 'bob'].map(identity));
});
beforeEach(() => { resetCaches(); clearIdCaches(); });

function board() {
  const db = freshDb();
  for (const who of [adm, bob]) establish(db, who.hash);
  db.prepare('INSERT INTO admins (hash, added_by, created_at) VALUES (?, ?, 1)').run(adm.hash, 'seed');
  const topic = db.prepare("INSERT INTO comments (page, parent_id, title, author_hash, body, status, created_at) VALUES ('board:pub', NULL, 'A thread', ?, 'the opening post', 'live', 10)")
    .run(adm.hash).lastInsertRowid;
  db.prepare("INSERT INTO comments (page, parent_id, author_hash, body, status, created_at) VALUES ('board:pub', ?, ?, 'a member replies', 'live', 11)")
    .run(topic, bob.hash);
  db.prepare("INSERT INTO comments (page, parent_id, author_hash, body, status, created_at) VALUES ('board:pub', ?, ?, 'the admin replies', 'live', 12)")
    .run(topic, adm.hash);
  return { db, topic: Number(topic), env: makeEnv({ db, vars: { PUBLIC_ID_PEPPER: PEPPER } }) };
}
const marks = (rows: Row[]) => rows.map((r) => [r.body, r.author_admin]);

test('a thread marks its admin\'s posts, and no one else\'s, though the row\'s id is no account hash', async () => {
  const { db, topic, env } = board();
  const r = await call(worker, env, 'GET', '/api/comments/board/topic?id=' + topic);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.notEqual(r.json.topic.author_hash, adm.hash, 'the head carries the public id, as in production');
  assert.equal(r.json.topic.author_admin, true, 'and is still marked: the worker looked it up before cloaking');
  assert.deepEqual(marks(r.json.replies), [['a member replies', false], ['the admin replies', true]]);
  db.close();
});

test('a removed admin\'s posts lose the mark on the next read: the table governs, not a list', async () => {
  const { db, topic, env } = board();
  db.prepare('INSERT INTO admins (hash, added_by, created_at) VALUES (?, ?, 1)').run(bob.hash, 'adm');
  db.prepare('DELETE FROM admins WHERE hash = ?').run(adm.hash);
  const r = await call(worker, env, 'GET', '/api/comments/board/topic?id=' + topic);
  assert.equal(r.json.topic.author_admin, false);
  assert.deepEqual(marks(r.json.replies), [['a member replies', true], ['the admin replies', false]]);
  db.close();
});

test('the feed marks its admin\'s posts', async () => {
  const { db, env } = board();
  for (const [who, body] of [[adm, 'from the house'], [bob, 'from a member']] as const) {
    db.prepare("INSERT INTO wall_posts (author_hash, body, created_at, status) VALUES (?, ?, 20, 'live')").run(who.hash, body);
  }
  const r = await call(worker, env, 'POST', '/api/comments/wall/feed', { key: bob.key });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(marks(r.json.posts), [['from a member', false], ['from the house', true]]);
  db.close();
});

test('an admin\'s fresh reply is marked in its own answer, as the next read will mark it', async () => {
  const { db, topic, env } = board();
  db.prepare("INSERT INTO app_settings (k, v, updated_at, updated_by) VALUES ('turnstile_skip_established', '1', 1, 'test')").run();
  const r = await call(worker, env, 'POST', '/api/comments', { key: adm.key, topic, body: 'one more from the house' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.comment.author_admin, true);
  const m = await call(worker, env, 'POST', '/api/comments', { key: bob.key, topic, body: 'one more from a member' });
  assert.equal(m.json.comment.author_admin, false);
  db.close();
});
