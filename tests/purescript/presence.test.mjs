/* Domain.Presence — the online-presence policy for DMs. The mode set + the
   visibility rule are single-sourced here (worker + client both read them);
   the DO's socket enumeration is the imperative half. These lock the two rules
   that matter: what counts as a valid mode, and when a member shows as online. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Presence from '../../purescript/output/Domain.Presence/index.js';

test('modes: exactly auto and off, in UI order', () => {
  assert.deepEqual(Presence.modes, ['auto', 'off']);
});

test('normalizeMode: only "off" is appear-offline; everything else is "auto"', () => {
  assert.equal(Presence.normalizeMode('off'), 'off');
  assert.equal(Presence.normalizeMode('auto'), 'auto');
  assert.equal(Presence.normalizeMode(''), 'auto', 'blank -> auto');
  assert.equal(Presence.normalizeMode('bogus'), 'auto', 'unknown -> auto');
  assert.equal(Presence.normalizeMode('OFF'), 'auto', 'case-sensitive: only exact "off"');
});

test('isVisible: online iff a socket is held AND mode is not off', () => {
  assert.equal(Presence.isVisible('auto')(true), true, 'auto + socket -> online');
  assert.equal(Presence.isVisible('auto')(false), false, 'no socket -> offline');
  assert.equal(Presence.isVisible('off')(true), false, 'appear-offline wins even with a socket');
  assert.equal(Presence.isVisible('off')(false), false);
});
