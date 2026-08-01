/* Domain.Mute — the client-only list of hashes whose posts collapse for this
   reader. Bot-exempt (you can never mute the librarian), and toggling is a pure
   add/remove that returns the new list plus whether it was an add. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Mute from '../../purescript/output/Domain.Mute/index.js';

const BOT = 'botHASH';

test('isMuted: non-empty membership, but the bot is never muted', () => {
  assert.equal(Mute.isMuted(BOT)('a')(['a']), true);
  assert.equal(Mute.isMuted(BOT)(BOT)([BOT]), false, 'bot exempt');
  assert.equal(Mute.isMuted(BOT)('')([]), false, 'empty hash');
  assert.equal(Mute.isMuted(BOT)('z')(['a', 'b']), false, 'not in list');
});

test('toggleMute: add when absent, remove when present', () => {
  assert.deepEqual(Mute.toggleMute('x')([]), { list: ['x'], added: true });
  assert.deepEqual(Mute.toggleMute('x')(['x', 'y']), { list: ['y'], added: false });
});
