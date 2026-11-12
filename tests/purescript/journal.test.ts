/* Domain.Journal — the teaser the journal's overview shows of an entry (2026-11-11).
   Whole paragraphs while they fit; a long one cut at a sentence; and never a cut that
   leaves markup open, which the renderer would show raw. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Journal from '../../purescript/output/Domain.Journal/index.js';

test('the journal overview shows a teaser: whole paragraphs while they fit', () => {
  const t = (n: number, s: string) => Journal.journalTeaser(n)(s);
  assert.deepEqual(t(400, 'One short entry.'), { text: 'One short entry.', more: false });
  assert.deepEqual(t(400, '  \n'), { text: '', more: false });
  const two = 'First paragraph.\n\nSecond paragraph.';
  assert.deepEqual(t(400, two), { text: two, more: false }, 'a short entry is whole, no "Continue reading"');
  const p = 'x'.repeat(250);
  assert.deepEqual(t(400, p + '\n\n' + p + '\n\n' + p), { text: p, more: true }, 'paragraphs stop at the limit');
  assert.equal(t(400, 'a\n \t\nb').text, 'a\n\nb', 'a blank line with spaces is still a paragraph break');
});

test('a long first paragraph is cut at a sentence, never inside a link', () => {
  const t = (n: number, s: string) => Journal.journalTeaser(n)(s);
  /* entry 238's shape: a run-together paragraph that opens with a link */
  const long = '[Lérins Press](https://press.merecatholicity.com/) is the new publishing arm. ' +
    'The name comes from the small island off the coast of Cannes. ' + 'Early in the fifth century Honoratus founded a monastery there. '.repeat(8);
  const r = t(200, long);
  assert.equal(r.more, true);
  assert.ok(r.text.startsWith('[Lérins Press](https://press.merecatholicity.com/)'), r.text);
  assert.ok(/\.$/.test(r.text) && r.text.length <= 200, 'ends on a whole sentence: ' + r.text);
  /* no sentence end to cut at: a word boundary and an ellipsis, a half link dropped */
  const words = 'word '.repeat(30) + 'see [the press](https://press.merecatholicity.com/) ' + 'more '.repeat(40);
  const w = t(170, words);
  assert.ok(w.text.endsWith('…'), w.text);
  assert.doesNotMatch(w.text, /\[[^\]]*$|\]\([^)]*$/, 'no half-open link: ' + w.text);
  const bold = 'word '.repeat(25) + '**a bold run that goes on ' + 'and on '.repeat(30) + '**';
  assert.equal((Journal.journalTeaser(150)(bold).text.match(/\*\*/g) || []).length % 2, 0, 'no unclosed **');
  const angle = 'word '.repeat(28) + '<https://press.merecatholicity.com/titles/machines-of-borrowed-grace/> ' + 'x '.repeat(80);
  assert.doesNotMatch(Journal.journalTeaser(150)(angle).text, /<[^>]*$/, 'no half-open <url>');
});

test('a one-line opening is followed by the start of the next paragraph', () => {
  const body = '[Lérins Press](https://press.merecatholicity.com/) is the new publishing arm.\n\n' +
    'The name comes from the small island off the coast of Cannes. Early in the fifth century Honoratus founded a monastery there. ' +
    'Bishops came out of it, and so did books. '.repeat(10);
  const r = Journal.journalTeaser(300)(body);
  assert.equal(r.more, true);
  const [first, second] = r.text.split('\n\n');
  assert.equal(first, '[Lérins Press](https://press.merecatholicity.com/) is the new publishing arm.');
  assert.ok(second.startsWith('The name comes from') && /\.$/.test(second) && r.text.length <= 300, r.text);
});
