/* Domain.Consistency — which requests may read a D1 replica (2026-09-17).
 *
 * What would break silently: a write route reading a replica (a purge that
 * trusts a stale reference count; a roster check against a stale roster); a
 * write statement judged a read (no bookmark cookie, so a member reads a
 * replica that has not yet seen their own words); a hostile cookie handed to
 * the database as a bookmark. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../../purescript/output/Domain.Consistency/index.js';

test('the cookie: named, and kept five minutes', () => {
  assert.equal(C.cookieName, 'mc-d1');
  assert.equal(C.cookieMaxAge, 300);
});

test('readsReplica: the listed reads only, by method and path', () => {
  assert.equal(C.readsReplica('GET')('/api/comments/board'), true);
  assert.equal(C.readsReplica('POST')('/api/comments/dm/unread'), true);
  assert.equal(C.readsReplica('POST')('/api/comments/board'), false, 'the method is part of the key');
  assert.equal(C.readsReplica('GET')('/api/comments/board/'), false, 'exact paths only');
  for (const p of ['/api/comments/dm/send', '/api/comments/dm/thread', '/api/comments/dm/roster', '/api/comments/dm/media/get', '/api/comments/dm/media/purge',
    '/api/comments/call/pending', '/api/comments/prefs', '/api/comments/dm/pubkey', '/api/comments/board/unread', '/api/comments']) {
    assert.equal(C.readsReplica('POST')(p), false, p + ' stays on the primary');
  }
  assert.equal(new Set(C.replicaRoutes).size, C.replicaRoutes.length, 'no duplicates');
  for (const r of C.replicaRoutes) assert.match(r, /^(GET|POST) \/api\/comments(\/[a-z/-]+)?$/);
});

test('isWriteSql: only SELECT and PRAGMA read; everything else counts as a write', () => {
  for (const s of ['SELECT 1', '  select * from t', '\nSELECT x', 'PRAGMA table_info(works)'])
    assert.equal(C.isWriteSql(s), false, JSON.stringify(s));
  for (const s of ['INSERT INTO t VALUES (1)', 'UPDATE t SET a = 1', 'DELETE FROM t', 'REPLACE INTO t VALUES (1)',
    'insert or ignore into profiles (hash) values (?1)', 'WITH x AS (SELECT 1) DELETE FROM t', 'ALTER TABLE t ADD c', '', 'SELECTED'])
    assert.equal(C.isWriteSql(s), true, JSON.stringify(s));
});

test('bookmarkOk: hex groups and dashes, of a sane length', () => {
  assert.equal(C.bookmarkOk('00000085-0000024c-00004c6d-8e61117bf38d7adb71b934ebbf891683'), true);
  assert.equal(C.bookmarkOk('ABCDEF01'), true);
  for (const b of ['', 'abc', 'x'.repeat(10), '0000-0000; Path=/', 'first-primary', '0'.repeat(201)])
    assert.equal(C.bookmarkOk(b), false, JSON.stringify(b));
});
