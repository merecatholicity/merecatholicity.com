/* app/api.js — the client SDK: one named function per operation over the LIVE
   Worker. Reads route through the store (cached), writes go direct and INVALIDATE
   the reads they change. The transport is injected via configure(), so these
   tests assert the wire each call produces (URL / method / body / key injection)
   and the read-cache + write-invalidation contract — with no network. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as api from '../../app/api.ts';
import * as store from '../../app/store.ts';

// Wire a recording transport and a fixed identity key; start from a clean store.
function harness(reply) {
  const calls = [];
  const tx = (url, init) => { calls.push({ url, init }); return { json: () => Promise.resolve(reply || { ok: true }) }; };
  api.configure({ tx, key: () => 'MYKEY', fresh: () => false });
  store.invalidate();
  return { calls, last: () => calls[calls.length - 1] };
}

test('cached GET reads build the documented URLs', async () => {
  const h = harness();
  await api.category('pub', 2);
  assert.equal(h.last().url, '/api/comments/board/cat?cat=pub&p=2');
  await api.boardIndex();
  assert.equal(h.last().url, '/api/comments/board');
  await api.topic(5, '&find=9');
  assert.equal(h.last().url, '/api/comments/board/topic?id=5&find=9');
  await api.search('q=grace&cat=rc');
  assert.equal(h.last().url, '/api/comments/search?q=grace&cat=rc');
  await api.pageComments('/credo.html');
  assert.equal(h.last().url, '/api/comments?page=%2Fcredo.html');
  await api.profile('deadbeef');
  assert.equal(h.last().url, '/api/comments/profile?hash=deadbeef');
});

test('a keyed POST-read carries the identity key in the body', async () => {
  const h = harness();
  await api.backroomCat(3);
  const c = h.last();
  assert.equal(c.url, '/api/comments/board/admin');
  assert.equal(c.init.method, 'POST');
  assert.deepEqual(JSON.parse(c.init.body), { key: 'MYKEY', p: 3 });
});

test('a write injects the key and posts to the right endpoint', async () => {
  const h = harness();
  await api.post({ page: '', body: 'hi', token: 't' });
  const c = h.last();
  assert.equal(c.url, '/api/comments');
  assert.equal(c.init.method, 'POST');
  const body = JSON.parse(c.init.body);
  assert.equal(body.key, 'MYKEY');
  assert.equal(body.body, 'hi');
});

test('reads are cached; a full-invalidating write forces the next read to refetch', async () => {
  const h = harness();
  await api.category('pub', 1);
  const afterFirst = h.calls.length;
  await api.category('pub', 1);
  assert.equal(h.calls.length, afterFirst, 'the identical read was served from the store');
  await api.post({ page: '', body: 'x' }); // invalidates '' -> the whole store
  const afterPost = h.calls.length;
  await api.category('pub', 1);
  assert.ok(h.calls.length > afterPost, 'after a post, the read refetched');
});

test('a targeted write invalidates only its prefix (markRead: board, not profile)', async () => {
  const h = harness();
  await api.boardIndex();     // caches /api/comments/board
  await api.profile('h1');    // caches /api/comments/profile?hash=h1
  const base = h.calls.length;
  await api.markRead(5);      // write -> invalidates ['/api/comments/board'] only
  await api.boardIndex();     // board was invalidated -> refetch
  await api.profile('h1');    // profile untouched -> still cached
  assert.equal(h.calls.length, base + 2, 'markRead + one board refetch; profile stayed cached');
});
