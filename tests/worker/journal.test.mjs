/* comments-worker journalArticle: turns a Journal post body into { title, body }.
   The Journal presents forum posts as articles; posts have no title field, so the
   title is derived: an explicit markdown heading, else a short first line used
   verbatim (and dropped from the body), else a trimmed excerpt of a long opening
   line with the whole body kept. Never the old hardcoded "Journal entry". */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { journalArticle } from '../../comments-worker/src/pure.js';

test('an explicit markdown heading becomes the title and is stripped', () => {
  const a = journalArticle('# On the Communion of Saints\n\nThe body follows here.');
  assert.equal(a.title, 'On the Communion of Saints');
  assert.equal(a.body, 'The body follows here.');
  const b = journalArticle('### A smaller head ###\nline two');
  assert.equal(b.title, 'A smaller head');
  assert.equal(b.body, 'line two');
});

test('a short first line is the title verbatim and is dropped from the body', () => {
  const a = journalArticle('My thoughts on grace\n\nGrace is unmerited favour.');
  assert.equal(a.title, 'My thoughts on grace');
  assert.equal(a.body, 'Grace is unmerited favour.');
});

test('a long first line yields a trimmed excerpt title with ellipsis, body kept whole', () => {
  const long = 'This is a rather long opening sentence that keeps going well past any reasonable title length and then some more.';
  const a = journalArticle(long);
  assert.ok(a.title.endsWith('…'), 'excerpt ends with an ellipsis');
  assert.ok(a.title.length <= 72, 'excerpt is a reasonable length');
  assert.ok(!/[\s,.;:!?—–-]…$/.test(a.title), 'no trailing punctuation before the ellipsis');
  assert.ok(long.startsWith(a.title.slice(0, -1)), 'excerpt is the start of the first line');
  assert.equal(a.body, long, 'the full body is preserved when the first line is truncated');
});

test('leading blank lines are skipped; an empty body has no title', () => {
  const a = journalArticle('\n\n   \nReal first line here');
  assert.equal(a.title, 'Real first line here');
  const b = journalArticle('   \n\n  ');
  assert.equal(b.title, null);
});
