/* The member directory never lists machinery (P3-3, 2026-09-16): the
 * interactive kit's write-bypass identities (the TEST_HASHES secret) and the
 * read-only probes (the HIDDEN_HASHES var — the nightly webtest's, a second
 * agent's) have profile rows and posts like anyone, and the count of members
 * once read 53 for six humans. What would break silently: a probe identity
 * counted as a member, or a hidden list that also hid a real member because
 * the parser accepted a partial hash. */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { loadWorker, makeEnv, freshDb, identity, establish, call, resetCaches } from '../_support/worker.mjs';
import { hiddenHashes } from '../../comments-worker/src/lib.ts';

let worker, ann, bob, probe, kit;
before(async () => {
  ({ worker } = await loadWorker());
  [ann, bob, probe, kit] = await Promise.all(['ann', 'bob', 'probe', 'kit'].map(identity));
});

test('hiddenHashes joins the secret and the var, trims, and keeps only whole hashes', () => {
  assert.deepEqual(hiddenHashes({}), []);
  assert.deepEqual(hiddenHashes({ TEST_HASHES: kit.hash, HIDDEN_HASHES: ' ' + probe.hash + ' , deadbeef,' }), [kit.hash, probe.hash], 'a partial hash is dropped, never matched');
  assert.deepEqual(hiddenHashes({ HIDDEN_HASHES: probe.hash }), [probe.hash]);
});

test('the directory lists the members and never the probes, whichever list names them', async () => {
  resetCaches();
  const db = freshDb();
  for (const who of [ann, bob, probe, kit]) establish(db, who.hash);
  db.prepare("INSERT INTO comments (id, page, author_hash, body, status, created_at) VALUES (1, 'board:pub', ?, 'hello', 'live', 5), (2, 'board:pub', ?, 'probe post', 'live', 6)").run(ann.hash, probe.hash);
  let r = await call(worker, makeEnv({ db }), 'GET', '/api/comments/dm/directory');
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.users.map((u) => u.hash).sort(), [ann.hash, bob.hash, probe.hash, kit.hash].sort(), 'without a hidden list everyone shows');
  resetCaches();
  r = await call(worker, makeEnv({ db, vars: { HIDDEN_HASHES: probe.hash, TEST_HASHES: kit.hash } }), 'GET', '/api/comments/dm/directory');
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.users.map((u) => u.hash).sort(), [ann.hash, bob.hash].sort(), 'the probe (var) and the kit identity (secret) are gone, the members stay');
  db.close();
});
