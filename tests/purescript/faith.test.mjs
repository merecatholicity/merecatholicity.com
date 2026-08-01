/* Domain.Faith — the closed set of faith declarations every member picks at
   signup (nicene / indo-european / seeker) and their display labels. Order is
   load-bearing (the signup radios render it), and the codes are duplicated in
   the worker's FAITHS, so this is the single source they must agree with. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Faith from '../../purescript/output/Domain.Faith/index.js';
import { orEmpty } from '../_support/ps.mjs';

const flabel = (c) => orEmpty(Faith.labelForCode(c));

test('faithList: exactly three codes, in signup order', () => {
  assert.equal(Faith.faithList.length, 3);
  assert.deepEqual(Faith.faithList.map((f) => f.code), ['nicene', 'indo-european', 'seeker']);
});

test('labelForCode: each code has its label; an unknown code has none', () => {
  assert.equal(flabel('nicene'), 'Nicene');
  assert.equal(flabel('indo-european'), 'pre-Christian Indo European');
  assert.equal(flabel('seeker'), 'Seeker');
  assert.equal(flabel('bogus'), '', 'unknown faith -> no label');
});
