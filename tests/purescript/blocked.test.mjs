/* Domain.Blocked — the flash-banner message a moderation block shows. Only an
   'ipban' says the network is banned; everything else (locked/banned/unknown)
   reads as an identity lock. messageFor is the raw-code entry point the client
   uses when the server returns a block reason. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Blocked from '../../purescript/output/Domain.Blocked/index.js';

test('messageFor: ipban is network-banned; all else is identity-locked', () => {
  assert.ok(Blocked.messageFor('ipban').startsWith('Your network is banned'));
  assert.ok(Blocked.messageFor('locked').startsWith('This identity has been locked'));
  assert.ok(Blocked.messageFor('banned').startsWith('This identity has been locked'));
  assert.ok(Blocked.messageFor('unknown').startsWith('This identity has been locked'),
    'unknown code -> identity lock (the classic else branch)');
});
