/* Domain.Ptr — the arithmetic of pull-to-refresh.
 *
 * This gesture is one everyone already knows from other apps, so the numbers
 * are the feature: too heavy and it feels stuck, too light and an ordinary
 * scroll trips it. Checking them here means they can be tuned deliberately
 * rather than by dragging a phone and guessing.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Ptr from '../../purescript/output/Domain.Ptr/index.js';

const stage = (t) => Ptr.stageTag(Ptr.stage(t));
const esc = (n, since) => Ptr.escalates(n)(since);

test('travel: resistance — the pull gets heavier, and it is bounded', () => {
  assert.equal(Ptr.travel(0), 0);
  assert.equal(Ptr.travel(-50), 0, 'pushing up is not a pull');
  const a = Ptr.travel(50), b = Ptr.travel(100), c = Ptr.travel(200);
  assert.ok(a < b && b < c, 'always moves with the finger');
  assert.ok(b - a > c - b, 'but gives less the further it goes');
  assert.ok(Ptr.travel(5000) < Ptr.maxTravel, 'never past the cap, however hard');
});

test('travel: the threshold sits at a comfortable thumb pull', () => {
  /* The tuning that matters in the hand. ~130px of finger travel to arm: a
     natural thumb drag. An earlier curve needed ~250px — nearly half a phone
     screen — which was arithmetically fine and wrong to use. */
  assert.equal(stage(Ptr.travel(120)), 'pulling', 'not yet at 120px of finger');
  assert.equal(stage(Ptr.travel(140)), 'ready', 'armed by 140px');
});

test('stage: a dead zone so a normal scroll from the top shows nothing', () => {
  assert.equal(stage(0), 'idle');
  assert.equal(stage(7), 'idle', 'a few pixels of slop is not a gesture');
  assert.equal(stage(8), 'pulling');
  assert.equal(stage(Ptr.threshold - 0.001), 'pulling');
  assert.equal(stage(Ptr.threshold), 'ready', 'at the threshold, release refreshes');
});

test('escalates: the third quick pull reloads, the first two do not', () => {
  assert.equal(esc(0, 500), false, 'first pull: an ordinary refresh');
  assert.equal(esc(1, 1500), false, 'second: still a refresh');
  assert.equal(esc(2, 2000), true, 'third in a run: the reader means it');
});

test('escalates: three pulls spread out are three refreshes, not a reload', () => {
  /* Count alone would turn a long browsing session into a surprise reload. */
  assert.equal(esc(2, Ptr.escalateWindowMs + 1), false);
  assert.equal(esc(5, 60000), false);
});

test('escalates: a clock that jumps mid-gesture cannot force a reload', () => {
  /* A negative elapsed time is a device correction, not evidence of intent —
     and it must not silently upgrade an ordinary pull into a page reload. */
  assert.equal(esc(2, -1000), true, 'a small backwards jump is still the run');
  assert.equal(esc(2, -60000), false, 'a large one is not');
});

test('the constants are the ones the CSS and the handler were built around', () => {
  assert.equal(Ptr.threshold, 70);
  assert.equal(Ptr.maxTravel, 120);
  assert.equal(Ptr.escalateCount, 3);
  assert.equal(Ptr.escalateWindowMs, 6000);
});
