/* Domain.Dm — the disappearing-message lifetimes for direct messages
   (24h / 7d / 30d). The three second-values are duplicated in the client and
   the worker (DM_TTLS); ttlLabel maps a stored TTL to its chooser label, with
   anything else falling to the 7-day default. */
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
