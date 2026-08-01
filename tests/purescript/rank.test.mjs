/* Domain.Rank — the scriptorium rank ladder: a member's post count maps to the
   highest rank reached. Single source for the client's RANKS/rankFor and the
   worker's rankFor. These lock the thresholds and the "· N post(s)" line. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Rank from '../../purescript/output/Domain.Rank/index.js';

const label = (n) => Rank.rankLabel(Rank.rankFor(n));

test('rankFor: each threshold maps to the label at/above it', () => {
  const cases = [
    [0, 'Novice'], [9, 'Novice'],
    [10, 'Apprentice'], [49, 'Apprentice'],
    [50, 'Scriptorium Hand'], [99, 'Scriptorium Hand'],
    [100, 'Copyist'], [249, 'Copyist'],
    [250, 'Scribe'], [499, 'Scribe'],
    [500, 'Illuminator'], [999, 'Illuminator'],
    [1000, 'Master Scribe'], [2499, 'Master Scribe'],
    [2500, 'Keeper of Scrolls'], [4999, 'Keeper of Scrolls'],
    [5000, 'Treasury of Wisdom'], [10000, 'Treasury of Wisdom'],
    [-5, 'Novice'], // negatives stay at the seed rank, like the classic JS loop
  ];
  for (const [n, want] of cases) assert.equal(label(n), want, `rankFor(${n})`);
});

test('rankLine: "<label> · <n> post(s)" with singular/plural', () => {
  assert.equal(Rank.rankLine(1), 'Novice · 1 post');
  assert.equal(Rank.rankLine(0), 'Novice · 0 posts');
  assert.equal(Rank.rankLine(10), 'Apprentice · 10 posts');
  assert.equal(Rank.rankLine(250), 'Scribe · 250 posts');
});

test('rankFor is monotonic: more posts never demote (0..6000)', () => {
  const order = [
    'Novice', 'Apprentice', 'Scriptorium Hand', 'Copyist', 'Scribe',
    'Illuminator', 'Master Scribe', 'Keeper of Scrolls', 'Treasury of Wisdom',
  ];
  let prev = -1;
  for (let n = 0; n <= 6000; n++) {
    const idx = order.indexOf(label(n));
    assert.ok(idx >= prev, `rank not monotonic at ${n}`);
    prev = idx;
  }
});
