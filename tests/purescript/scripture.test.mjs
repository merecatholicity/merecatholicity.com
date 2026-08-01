/* Domain.Scripture — the Bible book table, the autolink regex fragment, and
   verseParts (a validated Scripture reference). This is what turns "Rom 8:28-30"
   in a comment into a link to kjv.html#romans-8-28, so the book map, the regex
   shape, and the reference validation all matter. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Scripture from '../../purescript/output/Domain.Scripture/index.js';
import { orNull } from '../_support/ps.mjs';

const slug = (k) => orNull(Scripture.bookSlug(k));
// verseParts is curried and takes a Nullable range end (null = single verse).
const vp = (b, c, v1, v2) => Scripture.verseParts(b)(c)(v1)(v2 == null ? null : v2);

test('bibleSrc: the autolink regex fragment is byte-stable', () => {
  // Full byte-equality vs a freshly recomputed oracle is checked live in
  // webtest/test_core_rank.py; here we lock length + the load-bearing shape.
  assert.equal(Scripture.bibleSrc.length, 2267, 'bibleSrc length');
  assert.ok(Scripture.bibleSrc.startsWith('(second\\s+thessalonians|'),
    'longest spelling first (stable sort — so "2 thess" never shadows the long form)');
  assert.ok(Scripture.bibleSrc.endsWith(')\\.?[ \\t]+(\\d+):(\\d+)(?:[\\-\\u2013](\\d+))?'),
    'chapter:verse(-verse) tail');
});

test('bookSlug: a normalized reference -> canonical KJV slug, else null', () => {
  const cases = [
    ['1 cor', '1-corinthians'], ['john', 'john'], ['ii samuel', '2-samuel'],
    ['song of solomon', 'song-of-solomon'], ['rev', 'revelation'], ['ps', 'psalms'],
    ['first thessalonians', '1-thessalonians'], ['nope', null], ['so', null],
  ];
  for (const [k, want] of cases) assert.equal(slug(k), want, `bookSlug(${k})`);
});

test("bookSlug: ambiguous 'hb' resolves last-wins to hebrews (map parity)", () => {
  // 'hb' is listed under both Habakkuk and Hebrews; the classic map, the worker,
  // and the no-bundle copy all resolve it to hebrews (last-wins).
  assert.equal(slug('hb'), 'hebrews');
});

test('verseParts: a valid reference yields {slug, ch, v1, v2, href}', () => {
  const r1 = vp('rom', 8, 28, 30);
  assert.ok(r1 && r1.slug === 'romans' && r1.href === 'romans-8-28' && r1.v2 === 30, 'rom 8:28-30');
  const r2 = vp('john', 3, 16, null);
  assert.ok(r2 && r2.href === 'john-3-16' && r2.v2 === 16, 'john 3:16 (no range -> v2 = v1)');
});

test('verseParts: illegal references are unrepresentable (-> null)', () => {
  assert.equal(vp('rom', 0, 0, null), null, 'chapter 0 -> null');
  assert.equal(vp('rom', 5, 0, null), null, 'verse 0 -> null');
  assert.equal(vp('nope', 1, 1, null), null, 'non-book -> null');
  const r3 = vp('rom', 3, 16, 10);
  assert.ok(r3 && r3.v2 === 16 && r3.href === 'romans-3-16', 'backward range collapses to the single verse');
});
