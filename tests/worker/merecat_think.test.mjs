/* The think-stripper: no reasoning ever reaches a reader.
 *
 * qwen3 reasons inside <think>…</think>; merecatThinkStripper() removes those
 * spans from a token stream, across chunk borders, and holds back a small
 * tail so a tag split between deltas is never emitted. These cases were the
 * GPU twin's (tests/py/test_serve_thinkstrip.py, retired 2026-09-10 with the
 * backend); the guarantee now lives in the worker alone, so the cases do too.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { merecatThinkStripper } from '../../comments-worker/src/pure.js';

function stripStream(chunks) {
  const feed = merecatThinkStripper();
  let out = '';
  for (const c of chunks) out += feed(c);
  return out + feed(null);
}

test('a complete span is removed and the surrounding text kept', () => {
  assert.equal(stripStream(['before<think>reasoning</think>after']), 'beforeafter');
  const out = stripStream(['Q: <think>secret chain of thought</think>A']);
  assert.ok(!out.includes('secret') && !out.includes('chain of thought'));
  assert.equal(out, 'Q: A');
});

test('plain text passes through, and a bare < that is not a tag survives a split', () => {
  const msg = 'Hello, this is a plain answer.';
  assert.equal(stripStream([msg]), msg);
  assert.equal(stripStream(['3 ', '<', ' 4 is true']), '3 < 4 is true');
});

test('a tag split across chunks is reassembled, even one character at a time', () => {
  assert.equal(stripStream(['before', '<', 'th', 'ink>', 'reason', '</', 'think>', 'after']), 'beforeafter');
  assert.equal(stripStream('A<think>x</think>B'.split('')), 'AB');
});

test('no intermediate emission ever carries a half-written tag', () => {
  const feed = merecatThinkStripper();
  const emitted = ['before', '<', 'th', 'ink>', 'reason', '</', 'think>', 'after'].map((c) => feed(c));
  emitted.push(feed(null));
  for (const piece of emitted) assert.ok(!piece.includes('<'), `emitted ${JSON.stringify(piece)}`);
  assert.equal(emitted.join(''), 'beforeafter');
});

test('reasoning with no opening tag, ended by a bare </think>, is dropped', () => {
  /* A chat template that pre-opens the think block sends the reasoning first
     and only the close tag; everything before it, still buffered, is dropped. */
  assert.equal(stripStream(['okay let me think</think>The real answer.']), 'The real answer.');
  /* The honest limit: reasoning already emitted cannot be recalled; the tag
     itself is always swallowed and the answer after it always survives. */
  const out = stripStream(['reasoning here', '</', 'think>', 'answer']);
  assert.ok(!out.includes('</think>'));
  assert.ok(out.endsWith('answer'));
});

test('an unterminated span suppresses everything after it, and a held tail is released at the end', () => {
  const feed = merecatThinkStripper();
  assert.equal(feed('visible<think>reasoning that never closes'), 'visible');
  assert.equal(feed(null), '');
  const feed2 = merecatThinkStripper();
  const head = feed2('almost done <');
  assert.ok(!head.includes('<'));
  assert.equal(head + feed2(null), 'almost done <');
});

test('leading whitespace after a think block is trimmed once', () => {
  assert.equal(stripStream(['<think>hmm</think>\n\nThe answer.']), 'The answer.');
});
