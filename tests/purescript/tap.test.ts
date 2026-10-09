/* Domain.Tap — was the finger's lift on the fixed chrome a tap?
 *
 * The shell navigates on click, and a phone synthesizes the click after the
 * finger lifts — or withholds it (iOS: a tap that stops a decelerating page, a
 * tap whose hover it judges to have changed content). The chrome answers the
 * finger's own events instead and asks this module whether the lift was a tap.
 * The numbers are the feature: too tight and a thumb's jitter is a drag, too
 * loose and a scroll that began on the bar navigates.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Tap from '../../purescript/output/Domain.Tap/index.js';

const v = (far, ms) => Tap.verdictTag(Tap.verdict(far)(ms));

test('a press that lifts in place, quickly, is a tap', () => {
  assert.equal(v(0, 80), 'tap');
  assert.equal(v(Tap.slop, 400), 'tap', 'jitter up to the slop is still a tap');
  assert.equal(v(3, Tap.holdMs), 'tap', 'and so is a press held right up to the line');
});

test('a finger that travelled is a drag, however brief — and however long', () => {
  assert.equal(v(Tap.slop + 0.5, 30), 'drag', 'one hair past the slop');
  assert.equal(v(40, 900), 'drag', 'travel is judged before time: a hold that moved is a drag');
});

test('a finger that stayed down is a hold, the platform\'s own gesture', () => {
  assert.equal(v(3, Tap.holdMs + 1), 'hold');
  assert.equal(v(0, 5000), 'hold');
});

test('excursion is the farther axis, whichever way the finger went', () => {
  assert.equal(Tap.excursion(-9)(4), 9);
  assert.equal(Tap.excursion(2)(-15), 15);
  assert.equal(Tap.excursion(0)(0), 0);
});

test('the numbers sit where a thumb and the platforms put them', () => {
  assert.ok(Tap.slop >= 8 && Tap.slop <= 16, 'past tap jitter, inside a scroll\'s first frame');
  assert.ok(Tap.holdMs >= 300 && Tap.holdMs <= 500, 'under iOS\'s link preview, over a slow deliberate press');
  assert.ok(Tap.echoMs > Tap.holdMs && Tap.echoMs >= 350 && Tap.echoMs < 1000,
    'an engine\'s late click (once 300 ms) is still the same press; a second press a second later is not');
});
