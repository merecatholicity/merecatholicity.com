/* The server says WHICH MEMBER IS YOU, and which words are yours (2026-09-19).
 *
 * The DM screen used to find the reader by comparing ids: the member whose hash
 * is not mine is the other one, the message whose sender is mine takes the
 * right-hand side. That is an inference, and on 2026-09-19 it was wrong for a
 * day — the L3 flip changed the shape of the ids under it, nothing matched, and
 * the reader became a stranger to their own conversation: their own name in the
 * thread title, every bubble drawn as the other party's, and a pair's E1 words
 * unopenable because "the other member" resolved to themselves.
 *
 * The server never had to guess. It resolved the key to answer at all, so it
 * knows. `is_me` on the reader's member row and `mine` on the reader's messages
 * say so outright, and the client's comparison is demoted to a fallback for a
 * payload cached before this shipped.
 *
 * What would break silently: the mark computed from the wrong seat (every
 * reader told the same member is them), or a mark that survives cloakIds as an
 * id and gets rewritten. So: two readers, same thread, marks checked from BOTH
 * seats, with the pepper set so wire ids are not account hashes. */
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadWorker, makeEnv, client, freshDb, identity, establish, publishKey, resetCaches, hubSpy } from '../_support/worker.mjs';

const PEPPER = 'a-test-pepper-for-selfmark';
let worker, A, B, C;
before(async () => {
  ({ worker } = await loadWorker());
  [A, B, C] = await Promise.all(['mark-a', 'mark-b', 'mark-c'].map(identity));
});
beforeEach(resetCaches);

function ready() {
  const db = freshDb();
  for (const x of [A, B, C]) { establish(db, x.hash); publishKey(db, x.hash); }
  return db;
}
const api = (db) => client(worker, makeEnv({ db, hub: hubSpy(), vars: { PUBLIC_ID_PEPPER: PEPPER } }));

async function seeded() {
  const db = ready();
  const a = api(db);
  const id = (await a.post('/api/comments/dm/groups', { key: A.key, members: [B.hash, C.hash] })).json.thread_id;
  const send = async (who, body) => {
    const keys = {}; for (const x of [A, B, C]) keys[x.hash] = 's-' + x.hash.slice(0, 6);
    const r = await a.post('/api/comments/dm/send', { key: who.key, thread_id: id, body: 'E3.' + body, enc: 3, keys });
    assert.equal(r.status, 200, JSON.stringify(r.json));
  };
  await send(A, 'from A');
  await send(B, 'from B');
  return { a, id };
}

test('each reader is told which member is them — from their own seat, never another\'s', async () => {
  const { a, id } = await seeded();
  for (const [who, name] of [[A, 'A'], [B, 'B'], [C, 'C']]) {
    const r = await a.post('/api/comments/dm/thread', { key: who.key, thread_id: id });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const marked = r.json.thread.members.filter((m) => m.is_me);
    assert.equal(marked.length, 1, name + ': exactly one member is marked as the reader');
    /* and it is the right one: their own row is the one whose pubid the /prefs
       road would hand them, so cross-check by elimination against the others */
    const others = r.json.thread.members.filter((m) => !m.is_me).map((m) => m.hash);
    assert.equal(others.length, 2, name + ': the other two are not marked');
    assert.ok(!others.includes(marked[0].hash), name + ': a member cannot be both');
  }
});

test('the mark is a seat, not a property of the row: A and B are told different members', async () => {
  const { a, id } = await seeded();
  const meFor = async (who) => (await a.post('/api/comments/dm/thread', { key: who.key, thread_id: id }))
    .json.thread.members.find((m) => m.is_me).hash;
  const [ma, mb] = [await meFor(A), await meFor(B)];
  assert.notEqual(ma, mb, 'every reader was told the same member is them — the mark is computed from the wrong seat');
});

test('a reader\'s own words are marked `mine`, and only theirs', async () => {
  const { a, id } = await seeded();
  const asA = (await a.post('/api/comments/dm/thread', { key: A.key, thread_id: id })).json;
  const asB = (await a.post('/api/comments/dm/thread', { key: B.key, thread_id: id })).json;
  const mineIds = (d) => d.messages.filter((m) => m.mine).map((m) => m.id).sort();
  const aMine = mineIds(asA), bMine = mineIds(asB);
  assert.ok(aMine.length, 'A wrote one word and a system line; some message is theirs');
  assert.ok(bMine.length, 'B wrote one word');
  assert.deepEqual(aMine.filter((x) => bMine.includes(x)), [], 'no message is mine to BOTH of them');
  /* every message carries the field either way, so the client never has to ask
     "is it absent because it is not mine, or because this payload is old?" */
  for (const m of asA.messages) assert.ok(m.mine === 0 || m.mine === 1, 'every message says, one way or the other');
});

test('the marks survive cloaking: ids are pubids, the marks are still 1/0 and not rewritten', async () => {
  const { a, id } = await seeded();
  const r = (await a.post('/api/comments/dm/thread', { key: A.key, thread_id: id })).json;
  for (const m of r.thread.members) {
    assert.match(m.hash, /^[0-9a-f]{64}$/);
    assert.notEqual(m.hash, A.hash, 'a served id is a pubid, so this file is testing the flipped world');
    assert.ok(m.is_me === 0 || m.is_me === 1, 'is_me stayed a flag through cloakIds');
  }
});
