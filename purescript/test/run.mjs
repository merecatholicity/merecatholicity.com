// Layer 1: PureScript pure-unit tests, run under Node over the compiled ESM
// output (no browser, no framework). `make pstest` builds then runs this.
// Layer 2 (headless delegate/render parity vs the classic JS) lives in webtest/.
//
// This asserts Domain.Rank against the classic docs/comments.js ladder it
// replaces, so the parity gate can license deleting the classic fallback.
import assert from 'node:assert/strict';
import * as Rank from '../output/Domain.Rank/index.js';

const label = (n) => Rank.rankLabel(Rank.rankFor(n));

// The classic RANKS ladder (docs/comments.js:53-57): highest label reached.
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
  [-5, 'Novice'], // negatives stay at the seed rank, like the JS loop
];
for (const [n, want] of cases) assert.equal(label(n), want, `rankFor(${n})`);

// rankLine formatting + singular/plural (docs/comments.js:65).
assert.equal(Rank.rankLine(1), 'Novice · 1 post');
assert.equal(Rank.rankLine(0), 'Novice · 0 posts');
assert.equal(Rank.rankLine(10), 'Apprentice · 10 posts');
assert.equal(Rank.rankLine(250), 'Scribe · 250 posts');

// Monotonic: a higher count never yields a lower rank (by ladder index).
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

console.log(`pstest: Domain.Rank OK (${cases.length} ladder cases + rankLine + monotonicity 0..6000)`);
