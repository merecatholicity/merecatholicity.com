/* Domain.Wall — permissions + retention policy for the public walls/feed. The
   rules a human needs to trust: who can read, post, comment, and delete, and how
   the admin retention value is clamped. Single-sourced into the worker + client. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Wall from '../../purescript/output/Domain.Wall/index.js';

test('canView / canPost / canComment: membership required (a non-empty hash)', () => {
  assert.equal(Wall.canView('abc'), true);
  assert.equal(Wall.canView(''), false, 'logged-out cannot view the feed/walls');
  assert.equal(Wall.canPost('abc'), true);
  assert.equal(Wall.canPost(''), false);
  assert.equal(Wall.canComment('abc'), true);
  assert.equal(Wall.canComment(''), false);
});

test('canDelete: author or admin only', () => {
  const cd = (a, m, ad) => Wall.canDelete(a)(m)(ad);
  assert.equal(cd('me', 'me', false), true, 'own post');
  assert.equal(cd('x', 'me', false), false, 'not yours, not admin');
  assert.equal(cd('x', 'me', true), true, 'admin deletes any');
  assert.equal(cd('me', '', false), false, 'keyless cannot delete even a matching empty author');
});

test('pruneDayOptions: the retention chooser (90/180/365)', () => {
  assert.deepEqual(Wall.pruneDayOptions, [90, 180, 365]);
});

test('clampPruneDays: bounded to 1..3650 days', () => {
  assert.equal(Wall.clampPruneDays(180), 180);
  assert.equal(Wall.clampPruneDays(0), 1, 'floor');
  assert.equal(Wall.clampPruneDays(-5), 1);
  assert.equal(Wall.clampPruneDays(99999), 3650, 'ceiling (10 years)');
});
