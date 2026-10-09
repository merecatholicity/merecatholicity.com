/* Domain.Throttle — whose bucket a request counts against (2026-09-17).
 *
 * What would break silently: the empty key's hash treated as a member (every
 * keyless request would share one "member" bucket and throttle each other);
 * a malformed hash opening a bucket of its own. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as T from '../../purescript/output/Domain.Throttle/index.js';

const bucket = (h) => T.memberBucket(h).value0 ?? null;

test('the empty key hashes to the constant, and names nobody', () => {
  assert.equal(T.emptyKeyHash, createHash('sha256').update('').digest('hex'));
  assert.equal(bucket(T.emptyKeyHash), null);
});

test('memberBucket: a 64-hex lowercase hash, prefixed; anything else is keyless', () => {
  const h = createHash('sha256').update('someone').digest('hex');
  assert.equal(bucket(h), 'm:' + h);
  for (const bad of ['', 'abc', h.toUpperCase(), h.slice(1), h + '0', 'g'.repeat(64)]) assert.equal(bucket(bad), null, bad);
});
