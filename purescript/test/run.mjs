// Layer 1: PureScript pure-unit tests, run under Node over the compiled ESM
// output (no browser, no framework). `make pstest` builds then runs this.
// Layer 2 (headless delegate/render parity vs the classic JS) lives in webtest/.
//
// This asserts Domain.Rank against the classic docs/comments.js ladder it
// replaces, so the parity gate can license deleting the classic fallback.
import assert from 'node:assert/strict';
import * as Rank from '../output/Domain.Rank/index.js';
import * as Scripture from '../output/Domain.Scripture/index.js';
import * as Profile from '../output/Domain.Profile/index.js';
import * as Maybe from '../output/Data.Maybe/index.js';
import * as Either from '../output/Data.Either/index.js';

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

// --- Domain.Scripture: the book table + autolink regex fragment ---
const slug = (k) => Maybe.maybe(null)((s) => s)(Scripture.bookSlug(k));
// bibleSrc invariants (full byte-equality vs the classic src is verified live in
// webtest/test_core_rank.py against a freshly recomputed oracle).
assert.equal(Scripture.bibleSrc.length, 2267, 'bibleSrc length');
assert.ok(Scripture.bibleSrc.startsWith('(second\\s+thessalonians|'), 'longest spelling first (stable sort)');
assert.ok(Scripture.bibleSrc.endsWith(')\\.?[ \\t]+(\\d+):(\\d+)(?:[\\-\\u2013](\\d+))?'), 'chapter:verse tail');
// bookSlug: a normalized key → canonical KJV slug, or null for a non-book.
const slugCases = [
  ['1 cor', '1-corinthians'], ['john', 'john'], ['ii samuel', '2-samuel'],
  ['song of solomon', 'song-of-solomon'], ['rev', 'revelation'], ['ps', 'psalms'],
  ['first thessalonians', '1-thessalonians'], ['nope', null], ['so', null],
];
for (const [k, want] of slugCases) assert.equal(slug(k), want, `bookSlug(${k})`);
console.log(`pstest: Domain.Scripture OK (bibleSrc 2267 chars + ${slugCases.length} bookSlug cases)`);

// verseParts: a validated reference {slug, ch, v1, v2, href}, or null. Illegal
// refs (chapter/verse below 1, non-book) are unrepresentable — they return null.
const vp = (b, c, v1, v2) => Scripture.verseParts(b)(c)(v1)(v2 == null ? null : v2);
const r1 = vp('rom', 8, 28, 30);
assert.ok(r1 && r1.slug === 'romans' && r1.href === 'romans-8-28' && r1.v2 === 30, 'rom 8:28-30');
const r2 = vp('john', 3, 16, null);
assert.ok(r2 && r2.href === 'john-3-16' && r2.v2 === 16, 'john 3:16 (no range)');
assert.equal(vp('rom', 0, 0, null), null, 'chapter 0 -> null');
assert.equal(vp('rom', 5, 0, null), null, 'verse 0 -> null');
assert.equal(vp('nope', 1, 1, null), null, 'non-book -> null');
const r3 = vp('rom', 3, 16, 10);
assert.ok(r3 && r3.v2 === 16 && r3.href === 'romans-3-16', 'backward range collapses to single verse');
console.log('pstest: Domain.Scripture.verseParts OK (validated refs + rejections)');

// --- Domain.Profile: the field caps (single source) + validators ---
assert.equal(Profile.limits.nick, 40, 'nick cap 40');
assert.equal(Profile.limits.bio, 500, 'bio cap 500 (drift lock: was 1000 in the admin editor)');
assert.equal(Profile.limits.sig, 200, 'sig cap 200');
assert.ok(Profile.mkBio('x'.repeat(500)) instanceof Either.Right, 'bio of 500 accepted');
assert.ok(Profile.mkBio('x'.repeat(501)) instanceof Either.Left, 'bio of 501 rejected');
assert.ok(Profile.mkNick('x'.repeat(41)) instanceof Either.Left, 'nick of 41 rejected');
console.log('pstest: Domain.Profile OK (caps 40/500/200 + validators; bio locked at 500)');
