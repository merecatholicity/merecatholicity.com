/* Domain.Reaction — the ONE reaction grammar (2026-09-12), shared by a direct
   message's side and the public ledger (board posts, feed posts, feed
   comments). It was Domain.Dm's on 2026-09-10 and moved when the board and the
   feed gained the same picker; Domain.Dm re-exports it so nothing that read it
   there moved. The grammar itself is proved in dm.test.mjs against the
   re-export; here: the two are the same function, the ledger's targets, and
   the bell each target rings. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Reaction from '../../purescript/output/Domain.Reaction/index.js';
import * as Dm from '../../purescript/output/Domain.Dm/index.js';
import { orNull } from '../_support/ps.mjs';

test('Domain.Dm re-exports the grammar: one validator, one quick six, one cap', () => {
  assert.equal(Dm.normalizeReaction, Reaction.normalizeReaction, 'the same function object — not a copy');
  assert.equal(Dm.quickReactions, Reaction.quickReactions);
  assert.equal(Dm.reactionMaxUnits, Reaction.reactionMaxUnits);
  assert.equal(Dm.isCustomReaction, Reaction.isCustomReaction);
});

test('the grammar, briefly: one emoji or one known token, nothing else', () => {
  const norm = (s) => orNull(Reaction.normalizeReaction(s));
  assert.equal(norm('❤️'), '❤️');
  assert.equal(norm('👍🏽'), '👍🏽', 'a skin tone rides its base');
  assert.equal(norm(':PepeHeart:'), ':pepeheart:', 'a token comes back lower-cased');
  assert.equal(norm('👍👍'), null, 'two emoji are two reactions');
  assert.equal(norm('nice'), null);
  assert.equal(norm(''), null);
});

test('the public ledger has exactly three targets, and a DM is not one', () => {
  assert.deepEqual(Reaction.targets, ['post', 'wall', 'wallc']);
  for (const t of Reaction.targets) assert.equal(Reaction.isTarget(t), true);
  assert.equal(Reaction.isTarget('dm'), false, 'a DM reaction lives on the message row, in the pair\'s thread');
  assert.equal(Reaction.isTarget(''), false);
  assert.equal(Reaction.isTarget('posts'), false);
});

test('each target rings its own bell: a board post `react`, the feed `wall-react`', () => {
  assert.equal(orNull(Reaction.notifKind('post')), 'react');
  assert.equal(orNull(Reaction.notifKind('wall')), 'wall-react', 'hidden with the wall\'s other bells when the switch is off');
  assert.equal(orNull(Reaction.notifKind('wallc')), 'wall-react');
  assert.equal(orNull(Reaction.notifKind('dm')), null);
});
