/* Domain.Cache — what the client may keep on the reader's disk, and how long a
 * kept answer may stand in for the truth.
 *
 * Two of these rules are not really about caching:
 *
 *   persistable is a PRIVACY rule. Direct messages are end-to-end encrypted so
 *   that the operator holds only ciphertext; writing decrypted threads into
 *   localStorage would undo that at the one point where it is easy to undo.
 *   It refuses by PREFIX rather than by allowlist omission, so a DM endpoint
 *   added next year is excluded the day it is written.
 *
 *   classify is an HONESTY rule. Showing last visit's page instantly is kind
 *   while "last visit" was recent; presenting week-old rows as current is not.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Cache from '../../purescript/output/Domain.Cache/index.js';

const tag = (age, ttl) => Cache.freshnessTag(Cache.classify(age)(ttl));

test('classify: three rungs, not two — stale is the whole feature', () => {
  assert.equal(tag(10, 100), 'fresh', 'inside its TTL: serve it, ask nothing');
  assert.equal(tag(100, 100), 'stale', 'exactly at the TTL is past it');
  assert.equal(tag(5000, 100), 'stale', 'serve it AND refresh behind it');
  assert.equal(tag(Cache.staleMaxMs - 1, 100), 'stale', 'right up to the horizon');
  assert.equal(tag(Cache.staleMaxMs, 100), 'expired', 'at the horizon it stops standing in');
});

test('classify: a clock that moved backwards does not punish the reader', () => {
  /* Devices do this — a timezone change, an NTP correction between visits.
     Reading a negative age as Expired would throw away a perfectly good page. */
  assert.equal(tag(-60000, 100), 'fresh');
});

test('staleMaxMs is a day: instant tomorrow, never mysteriously ancient', () => {
  assert.equal(Cache.staleMaxMs, 86400000);
});

test('persistable: public, re-fetchable content only', () => {
  const yes = [
    '/api/comments/board|',
    '/api/comments/board/cat?cat=pub&p=1|',
    '/api/comments/board/topic?id=9|',
    '/api/comments/profile?hash=abc|',
    '/api/comments/config|',
  ];
  for (const k of yes) assert.equal(Cache.persistable(k), true, k);
});

test('persistable: end-to-end plaintext can never reach disk', () => {
  /* The load-bearing assertion in this file. Every DM route, present and
     future, is refused by the shared /dm/ prefix. */
  const no = [
    '/api/comments/dm/thread|{"key":"k","with":"x"}',
    '/api/comments/dm/threads|{"key":"k"}',
    '/api/comments/dm/directory|',
    '/api/comments/dm/pubkey|{}',
    '/api/comments/dm/media/get|{}',
    '/api/comments/dm/anything-invented-later|',
  ];
  for (const k of no) assert.equal(Cache.persistable(k), false, k);
});

test('persistable: private and moderation surfaces stay off the device', () => {
  const no = [
    '/api/merecat/chat|{}',            // private conversations with the librarian
    '/api/comments/board/admin|{}',    // the back room
    '/api/comments/admin/settings|{}',
    '/api/comments/meta|{}',           // the admin identity drawer: IP history
    '/api/comments/rdns?ip=1.2.3.4|',
  ];
  for (const k of no) assert.equal(Cache.persistable(k), false, k);
});

test('the store has a ceiling and a schema stamp', () => {
  /* The ceiling keeps the synchronous hydrate cheap; the schema lets a deploy
     discard a shape it can no longer read instead of interpreting it. */
  assert.equal(Cache.maxBytes, 524288);
  assert.equal(typeof Cache.schema, 'number');
  assert.ok(Cache.schema >= 1);
});
