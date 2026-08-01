/* Domain.Profile — the profile field caps (nick/bio/sig) as a single source, and
   the smart-constructor validators. The caps once DRIFTED (the admin editor let
   bio be 1000 while the worker rejected over 500); this file locks them so the
   client maxLength and the worker MAX_* can never disagree again. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Profile from '../../purescript/output/Domain.Profile/index.js';
import { isRight, isLeft } from '../_support/ps.mjs';

test('limits: the caps are the one true source (40 / 500 / 200)', () => {
  assert.equal(Profile.limits.nick, 40, 'nick cap 40');
  assert.equal(Profile.limits.bio, 500, 'bio cap 500 (drift lock: was 1000 in the admin editor)');
  assert.equal(Profile.limits.sig, 200, 'sig cap 200');
});

test('validators accept at the cap and reject one over', () => {
  assert.ok(isRight(Profile.mkBio('x'.repeat(500))), 'bio of 500 accepted');
  assert.ok(isLeft(Profile.mkBio('x'.repeat(501))), 'bio of 501 rejected');
  assert.ok(isLeft(Profile.mkNick('x'.repeat(41))), 'nick of 41 rejected');
});
