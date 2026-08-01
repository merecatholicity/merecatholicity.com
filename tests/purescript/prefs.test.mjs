/* Domain.Prefs — the settings-gear preference rules, single-sourced so the
   worker's delivery gating and the client's toggles never disagree. The two
   rules that matter: "off" silences read receipts both ways, and a notify column
   is on unless it is exactly 0 (so the NULL default is on). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Prefs from '../../purescript/output/Domain.Prefs/index.js';

test('receiptsOn: only "off" stops receipts (reciprocal both ways)', () => {
  assert.equal(Prefs.receiptsOn('off'), false);
  assert.equal(Prefs.receiptsOn('auto'), true);
  assert.equal(Prefs.receiptsOn(''), true, 'blank/default -> on');
  assert.equal(Prefs.receiptsOn('anything'), true);
});

test('notifyOn: on by default, off only when the column is exactly 0', () => {
  assert.equal(Prefs.notifyOn(1), true);
  assert.equal(Prefs.notifyOn(0), false);
  assert.equal(Prefs.notifyOn(1), true, 'the NULL-default coerces to 1 -> on');
});

test('notifyKinds: the three switchable kinds', () => {
  assert.deepEqual(Prefs.notifyKinds, ['reply', 'mention', 'dm']);
});
