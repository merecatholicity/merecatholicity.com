/* Domain.Live — the pure decisions behind the real-time forum: how a category's
   topics sort (stickies first, then most-recent) and which page a new reply
   lands on. The DOM/WebSocket effects stay in the views; only the math is here. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Live from '../../purescript/output/Domain.Live/index.js';

const tc = (a, b) => Live.topicCompare(a)(b);

test('topicCompare: stickies first, then more-recent first (Array.sort order)', () => {
  // comparator < 0 => the first argument sorts before the second.
  assert.equal(Math.sign(tc({ sticky: 1, last: 10 }, { sticky: 0, last: 99 })), -1, 'sticky sorts first');
  assert.equal(Math.sign(tc({ sticky: 0, last: 5 }, { sticky: 0, last: 9 })), 1, 'more recent sorts first');
  assert.equal(tc({ sticky: 0, last: 9 }, { sticky: 0, last: 9 }), 0, 'equal keeps order');
});

test('replyPage: the 1-based page a reply lands on = ceil(total/per)', () => {
  assert.equal(Live.replyPage(21)(20), 2);
  assert.equal(Live.replyPage(20)(20), 1);
  assert.equal(Live.replyPage(1)(20), 1);
});
