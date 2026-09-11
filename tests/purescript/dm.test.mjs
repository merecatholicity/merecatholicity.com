/* Domain.Dm — the direct-message rules the client and the worker share.
   Lifetimes (24h / 7d / 30d): ttlLabel maps a stored TTL to its chooser label,
   defaultTtl is the single source of "the default lifetime" (30d), and
   mediaMaxSeconds is the hard media cap. Reactions (2026-09-10, the WhatsApp
   press-and-hold picker): exactly one emoji or one of our own custom-pack
   tokens per side per message — normalizeReaction is the ONE validator the
   worker's store and the client's picker both run, so what one accepts the
   other renders. Reply quotes: the excerpt rule and the sentinel that opens a
   reply envelope inside the E2E plaintext. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Dm from '../../purescript/output/Domain.Dm/index.js';
import * as Emoji from '../../purescript/output/Domain.Emoji/index.js';
import { orNull } from '../_support/ps.mjs';

const norm = (s) => orNull(Dm.normalizeReaction(s));

test('ttlOptions: the three lifetimes in seconds', () => {
  assert.deepEqual(Dm.ttlOptions.map((o) => o.secs), [86400, 604800, 2592000]);
});

test('ttlLabel: each lifetime labels; off-menu values fall to 7 days', () => {
  assert.equal(Dm.ttlLabel(86400), '24 hours');
  assert.equal(Dm.ttlLabel(604800), '7 days');
  assert.equal(Dm.ttlLabel(2592000), '30 days');
  assert.equal(Dm.ttlLabel(3600), '24 hours'); // <= 86400 threshold
});

test('defaultTtl is 30 days, and it is one of the chooser options', () => {
  assert.equal(Dm.defaultTtl, 2592000, 'default conversation lifetime is 30 days');
  assert.ok(Dm.ttlOptions.some((o) => o.secs === Dm.defaultTtl), 'the default is a selectable option');
});

test('mediaMaxSeconds is the 30-day hard media cap', () => {
  // Media never persists longer than 30 days, even inside a saved message.
  assert.equal(Dm.mediaMaxSeconds, 2592000);
});

test('the quick six are six, each a valid reaction, and the heart is among them', () => {
  assert.equal(Dm.quickReactions.length, 6, 'the press-and-hold bar offers six before the +');
  for (const e of Dm.quickReactions) assert.equal(norm(e), e, `${e} must pass its own validator unchanged`);
  /* Migration 0012 carried every old like forward as this exact string; if the
     heart's bytes change here, old likes stop matching the quick cell. */
  assert.ok(Dm.quickReactions.includes('❤️'), 'the 2026-08-03 heart (U+2764 U+FE0F) is a quick reaction');
  assert.equal(new Set(Dm.quickReactions).size, 6, 'no duplicates');
});

test('normalizeReaction accepts exactly one emoji, in every shape Unicode gives them', () => {
  const ok = [
    '💯',                       // a plain pictograph
    '👍🏽',                     // base + skin tone
    '✌️',                       // base + presentation selector
    '❤️‍🔥',                    // ZWJ sequence with a selector
    '👨‍👩‍👧‍👦',                // a four-person ZWJ family
    '👩🏽‍🦰',                   // skin tone inside a ZWJ sequence
    '🇻🇦',                      // a flag: two regional indicators
    '1️⃣',                      // a keycap
    '🏴󠁧󠁢󠁳󠁣󠁴󠁿',   // a subdivision flag: base + tag sequence
  ];
  for (const e of ok) assert.equal(norm(e), e, `${JSON.stringify(e)} is one emoji`);
  assert.equal(norm('  👍  '), '👍', 'surrounding whitespace is trimmed, not refused');
});

test('normalizeReaction refuses what is not one emoji', () => {
  const bad = [
    '',            // nothing
    '   ',         // only whitespace
    'lol',         // prose
    '1',           // a digit alone is an emoji component, not an emoji
    '#',           // likewise
    '👍❤️',        // two emoji — two reactions
    '👍 nice',     // an emoji with words
    'x👍',         // words with an emoji
  ];
  for (const s of bad) assert.equal(norm(s), null, `${JSON.stringify(s)} is not a reaction`);
  /* A too-long run of components is refused by the unit cap even if it were
     grammatical: the cap is a belt under the grammar. */
  assert.equal(norm('👨‍👩‍👧‍👦'.repeat(4)), null, 'over the unit cap');
  assert.equal(Dm.reactionMaxUnits, 32);
});

test('the bare heart without its selector is still one emoji', () => {
  /* U+2764 alone is Extended_Pictographic; a keyboard that omits FE0F must not
     find its heart refused. It is stored as sent (no normalization to ❤️). */
  assert.equal(norm('❤'), '❤');
});

test('a custom-pack token is a reaction — ours, lower-cased — and an unknown token is not', () => {
  assert.equal(norm(':pepeheart:'), ':pepeheart:');
  assert.equal(norm(':PepeHeart:'), ':pepeheart:', 'tokens compare case-insensitively and store lower-cased');
  assert.equal(norm(':kekw:'), ':kekw:', 'a memes-pack code');
  assert.equal(norm(':nope_not_a_code:'), null, 'an unknown code never becomes an image source');
  assert.equal(norm(':pepeheart'), null, 'a half token is prose');
  assert.equal(norm('pepeheart'), null);
  /* Every code the packs hold passes, so the picker and the store agree pack-wide. */
  for (const [code] of [...Emoji.packs.memes, ...Emoji.packs.pepe]) {
    assert.equal(norm(':' + code + ':'), ':' + code + ':', `pack code ${code}`);
    assert.ok(Dm.isCustomReaction(':' + code + ':'));
  }
});

test('the reply sentinel is U+0001 — untypeable, and refused by the worker in any plaintext it can see', () => {
  assert.equal(Dm.replySentinel, '\u0001');
  assert.equal(Dm.replySentinel.length, 1);
});

test('replyExcerpt folds whitespace, trims, and cuts by code points with an ellipsis', () => {
  assert.equal(Dm.replyExcerpt('  hello\n\n  world \t again  '), 'hello world again');
  assert.equal(Dm.replyExcerptMax, 160);
  const long = 'a'.repeat(200);
  const cut = Dm.replyExcerpt(long);
  assert.equal(cut, 'a'.repeat(160) + '…');
  assert.equal(Dm.replyExcerpt('a'.repeat(160)), 'a'.repeat(160), 'exactly the cap carries no ellipsis');
  /* Code points, not UTF-16 units: 160 emoji are 320 units and must survive whole. */
  const emoji = '😀'.repeat(160);
  assert.equal(Dm.replyExcerpt(emoji), emoji);
  const over = Dm.replyExcerpt('😀'.repeat(161));
  assert.equal(over, '😀'.repeat(160) + '…', 'never split an emoji in half');
  assert.equal(Dm.replyExcerpt('   '), '', 'nothing quotable stays empty');
});
