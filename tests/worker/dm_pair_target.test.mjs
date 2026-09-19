/* The first word of a new conversation (2026-09-19, a live report: "bad
 * request trying to send a message from a brand new user").
 *
 * A pair's room is made BY its first word, so until that word lands there is
 * no thread_id and the only way to name the correspondent is the target the
 * client builds — `{with: <id>}` (client/dm-thread.ts `ctx.target()`,
 * app/api.ts `dmTarget`). /dm/send read `to` ALONE from 2026-09-13, so that
 * word was answered `400 Bad request.`, no room was ever made, and no later
 * word could carry a thread_id either: NOBODY could start a conversation, for
 * six days, and every test was green because every test addressed the road the
 * way the server wanted rather than the way the client speaks.
 *
 * So this sweep asks the contract which roads take a pair by `with`
 * (comments-worker/API.md, the wire's one home) and proves each of them does —
 * addressed as production addresses it, by PUBID, under a pepper. A road that
 * gains a `with` in the table is covered the day it is documented.
 */
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadWorker, makeEnv, freshDb, identity, establish, publishKey, call, resetCaches } from '../_support/worker.mjs';
import { pubidOf, clearIdCaches } from '../../comments-worker/src/lib.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');

const PEPPER = 'a-stable-test-pepper-value';
let worker, ann, bob;
before(async () => {
  ({ worker } = await loadWorker());
  [ann, bob] = await Promise.all(['ann', 'bob'].map(identity));
});
beforeEach(() => { resetCaches(); clearIdCaches(); });

const pub = (h) => pubidOf({ PUBLIC_ID_PEPPER: PEPPER }, h);

/* Every documented POST road under /dm whose request shape offers `with`. */
const PAIR_ROADS = [...read('comments-worker/API.md')
  .matchAll(/^\| `POST (\/api\/comments\/dm\/[a-z/]+)` \| `([^`]*)`/gm)]
  .filter((m) => /\bwith\?/.test(m[2]))
  .map((m) => m[1]);

/* What each road needs besides the target, so the call reaches its work. */
const EXTRA = {
  '/api/comments/dm/send': (ids) => ({ body: 'E3.the-first-word', enc: 3, keys: { [ids.ann]: 'x'.repeat(43), [ids.bob]: 'y'.repeat(43) } }),
  '/api/comments/dm/ttl': () => ({ ttl: 86400 }),
};

async function pairEnv() {
  const db = freshDb();
  const env = makeEnv({ db, vars: { PUBLIC_ID_PEPPER: PEPPER } });
  for (const who of [ann, bob]) { establish(db, who.hash); publishKey(db, who.hash); }
  return { db, env, ids: { ann: await pub(ann.hash), bob: await pub(bob.hash) } };
}

test('the contract names the pair roads, and there are several', () => {
  assert.ok(PAIR_ROADS.includes('/api/comments/dm/send'),
    'API.md no longer says /dm/send takes a pair by `with` — if the client stopped sending it, ' +
    'say so here; if the row was merely reworded, restore the shape (the table is the wire\'s one home)');
  assert.ok(PAIR_ROADS.length >= 5, 'the sweep went hollow: ' + JSON.stringify(PAIR_ROADS));
});

test('both halves of the client address a pair by the same name the contract does', () => {
  /* One UI, two clients: the classic write half builds the target in
     dm-thread.ts, the Lit read half in api.ts. A rename in either that the
     worker has not heard about is this bug again, so the name is read from
     the source rather than assumed. */
  const classic = /target: function \(\) \{ return threadId \? \{ thread_id: threadId \} : \{ (\w+): other \}; \}/.exec(read('client/dm-thread.ts'));
  assert.ok(classic, 'client/dm-thread.ts no longer builds ctx.target() — find where a pair is addressed now');
  assert.equal(classic[1], 'with', 'the classic client renamed the pair target; API.md and the worker must follow');
  const lit = /const dmTarget = .*?\{ (\w+): t \}/.exec(read('app/api.ts'));
  assert.ok(lit && lit[1] === 'with', 'app/api.ts renamed the pair target; API.md and the worker must follow');
});

for (const path of PAIR_ROADS) {
  test(`POST ${path} takes the client's own target: a pair, by pubid, with no room yet`, async () => {
    const { db, env, ids } = await pairEnv();
    const body = { key: bob.key, with: ids.ann, ...((EXTRA[path] || (() => ({})))(ids)) };
    const r = await call(worker, env, 'POST', path, body);
    assert.equal(r.status, 200, `${path} refused the client's target: ${r.status} ${r.text.slice(0, 200)}`);
    assert.notEqual(r.json && r.json.error, 'Bad request.', `${path} does not read \`with\``);
    db.close();
  });
}

test('the first word makes the pair\'s room, and the roster behind it is account-keyed', async () => {
  const { db, env, ids } = await pairEnv();
  const r = await call(worker, env, 'POST', '/api/comments/dm/send',
    { key: bob.key, with: ids.ann, ...EXTRA['/api/comments/dm/send'](ids) });
  assert.equal(r.status, 200, 'the first word: ' + r.text.slice(0, 200));
  const members = db.prepare('SELECT hash FROM dm_members WHERE thread_id = ?').all(r.json.thread_id).map((x) => x.hash).sort();
  assert.deepEqual(members, [ann.hash, bob.hash].sort(), 'the pubid in `with` resolved to ann; the room holds both');
  db.close();
});

test('/dm/roster answers an unmade pair with both published keys', async () => {
  /* dmThreadFor hunted for a pair_key built from the PUBID — an id no ledger
     row holds — so the roster of a room that does not exist yet came back with
     the correspondent's key null, and the composer of a brand-new conversation
     said "waiting for this member to sign in once to set up encryption" about
     someone who had signed in. The resolve lives in dmThreadFor now, where
     every caller takes it. */
  const { db, env, ids } = await pairEnv();
  const r = await call(worker, env, 'POST', '/api/comments/dm/roster', { key: bob.key, with: ids.ann });
  assert.equal(r.status, 200, r.text.slice(0, 200));
  assert.equal(r.json.thread_id, null, 'no room yet');
  const keys = Object.fromEntries(r.json.members.map((m) => [m.hash, m.pubkey]));
  assert.ok(keys[ids.ann], 'the correspondent is named by pubid and carries their published key');
  assert.ok(keys[ids.bob], 'and so does the sender, who seals to themselves too');
  db.close();
});

test('`to` still names a pair, for /dm/forward\'s items and any client that sends it', async () => {
  const { db, env, ids } = await pairEnv();
  const r = await call(worker, env, 'POST', '/api/comments/dm/send',
    { key: bob.key, to: ids.ann, ...EXTRA['/api/comments/dm/send'](ids) });
  assert.equal(r.status, 200, 'the documented alias: ' + r.text.slice(0, 200));
  db.close();
});
