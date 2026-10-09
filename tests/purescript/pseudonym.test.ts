/* Domain.Pseudonym — the "Adjective-Noun xxxx" display name derived from an
   identity hash for members with no nick. It is deterministic (hash bytes ->
   wordlist indices + the first four hex chars), duplicated in comments.js and
   the worker, so these golden cases pin the derivation across all three. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Pseudonym from '../../purescript/output/Domain.Pseudonym/index.js';

test('displayName: golden derivations from known hashes', () => {
  assert.equal(
    Pseudonym.displayName('d1915a05c2583f437b1316971563b3c4c404cff016a016770d91af1f2645f7f6'),
    'Constant-Almond d191');
  assert.equal(Pseudonym.displayName('0000000000000000'), 'Patient-Cedar 0000');
  assert.equal(Pseudonym.displayName('ffffffffffffffff'), 'Green-Wheat ffff');
  assert.equal(Pseudonym.displayName('abcdef0123456789aa'), 'Swift-Field abcd');
});
