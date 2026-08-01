/* Domain.Handle — the format rules for a custom profile @handle (the URL name a
   member may claim, distinct from the free-form display nick). Uniqueness is the
   worker's job (D1); these are the shared FORMAT constraints. This file locks
   them so the client editor and the worker validator can never disagree. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Handle from '../../purescript/output/Domain.Handle/index.js';
import { isRight, isLeft } from '../_support/ps.mjs';

/* Right Handle -> the normalized string; Left -> the error tag string. */
const value = (s) => Handle.unHandle(Handle.mkHandle(s).value0);
const errOf = (s) => {
  const e = Handle.mkHandle(s);
  assert.ok(isLeft(e), JSON.stringify(s) + ' should be rejected');
  return Handle.errorTag(e.value0);
};

test('accepts sane handles', () => {
  for (const s of ['adam', 'adam_s', 'john123', 'a1b', 'x'.repeat(30)]) {
    assert.ok(isRight(Handle.mkHandle(s)), JSON.stringify(s) + ' should be accepted');
  }
});

test('normalizes: lower-cases and trims', () => {
  assert.equal(value('Adam'), 'adam');
  assert.equal(value('  Bob_Roberts  '), 'bob_roberts');
  assert.equal(value('JOHN123'), 'john123');
});

test('length bounds are 3..30', () => {
  assert.equal(errOf('ab'), 'too_short');
  assert.equal(errOf('x'.repeat(31)), 'too_long');
  assert.ok(isRight(Handle.mkHandle('abc')), '3 chars ok');
});

test('charset is [a-z0-9_] only', () => {
  assert.equal(errOf('adam!'), 'bad_chars');
  assert.equal(errOf('a b c'), 'bad_chars');
  assert.equal(errOf('café_x'), 'bad_chars');
  assert.equal(errOf('adam-s'), 'bad_chars');
});

test('must start with a letter', () => {
  assert.equal(errOf('1adam'), 'bad_start');
  assert.equal(errOf('_adam'), 'bad_start');
  assert.equal(errOf('123'), 'bad_start');
});

test('no trailing or doubled underscore', () => {
  assert.equal(errOf('adam_'), 'bad_underscore');
  assert.equal(errOf('ad__am'), 'bad_underscore');
  assert.ok(isRight(Handle.mkHandle('a_b_c')), 'single separated underscores ok');
});

test('reserved names are refused (case-insensitively)', () => {
  for (const s of ['merecat', 'Admin', 'API', 'community', 'profile', 'settings']) {
    assert.equal(errOf(s), 'reserved', JSON.stringify(s) + ' reserved');
  }
});
