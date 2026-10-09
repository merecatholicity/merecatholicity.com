/* Domain.Emoji — the two custom image packs (memes/pepe) and the named-alias
   token source, single-sourced with the worker's /config copy. A code only
   renders as an image when it is on this whitelist, so the pack sizes and the
   name/emoji pairing are what keep the renderer from naming an arbitrary image. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Emoji from '../../purescript/output/Domain.Emoji/index.js';

test('the image packs are the expected sizes and shape', () => {
  assert.equal(Emoji.packs.memes.length, 33, '33 meme emoji');
  assert.equal(Emoji.packs.pepe.length, 27, '27 pepe emoji');
  assert.deepEqual(Emoji.packs.memes[0], ['cry', 'emoji/memes/cry.webp'], '[code, path] pairs');
});

test('namedTokens: 182 whitespace-separated name/emoji pairs', () => {
  const toks = Emoji.namedTokens.trim().split(/\s+/);
  assert.equal(toks.length % 2, 0, 'tokens pair up (name, emoji)');
  assert.equal(toks.length, 364, '182 pairs');
  assert.equal(toks[0], 'smile');
  assert.equal(toks[1], '\u{1F604}');
});
