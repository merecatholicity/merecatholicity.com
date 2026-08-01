/* Domain.Dm — the disappearing-message lifetimes for direct messages
   (24h / 7d / 30d). The three second-values are duplicated in the client and
   the worker (DM_TTLS); ttlLabel maps a stored TTL to its chooser label, with
   anything else falling to the 7-day default. defaultTtl is the single source of
   "the default lifetime" (30d), and mediaMaxSeconds is the hard media cap. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Dm from '../../purescript/output/Domain.Dm/index.js';

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
