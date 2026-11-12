/* comments-worker journalArticle: turns a Journal post body into { title, body }.
   The Journal presents forum posts as articles; posts have no title field, so the
   title is derived: an explicit markdown heading, else a short first line (dropped
   from the body unless it carries a link), else a trimmed excerpt of a long opening
   line with the whole body kept. Always plain text, never markdown. Never the old
   hardcoded "Journal entry". */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { journalArticle, plainInline } from '../../comments-worker/src/pure.ts';

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
  assert.ok(a.title!.endsWith('…'), 'excerpt ends with an ellipsis');
  assert.ok(a.title!.length <= 72, 'excerpt is a reasonable length');
  assert.ok(!/[\s,.;:!?—–-]…$/.test(a.title!), 'no trailing punctuation before the ellipsis');
  assert.ok(long.startsWith(a.title!.slice(0, -1)), 'excerpt is the start of the first line');
  assert.equal(a.body, long, 'the full body is preserved when the first line is truncated');
});

test('leading blank lines are skipped; an empty body has no title', () => {
  const a = journalArticle('\n\n   \nReal first line here');
  assert.equal(a.title, 'Real first line here');
  const b = journalArticle('   \n\n  ');
  assert.equal(b.title, null);
});

test('a title is plain text: an opening link gives its words, never its markdown', () => {
  // the live case (2026-11-11): a long opening line that starts with a link
  const post = '[Lérins Press](https://press.merecatholicity.com/) is the new publishing arm of merecatholicity.com, and this sentence runs on well past a title.';
  const a = journalArticle(post);
  assert.ok(a.title!.startsWith('Lérins Press is the new publishing arm'), a.title!);
  assert.ok(!/[[\]()]|https?:/.test(a.title!), 'no bracket, parenthesis or address in the title: ' + a.title);
  assert.equal(a.body, post, 'the body keeps the link');
  // a short linked line: the plain words are the title, and the line stays so the link survives
  const b = journalArticle('Read [the book](https://merecatholicity.com/the-book.html) first\n\nThen this.');
  assert.equal(b.title, 'Read the book first');
  assert.ok(b.body.startsWith('Read [the book]('), 'the link is not lost from the body');
  // a short line with emphasis only is still a title dropped from the body
  const c = journalArticle('**On grace**\n\nGrace is unmerited favour.');
  assert.equal(c.title, 'On grace');
  assert.equal(c.body, 'Grace is unmerited favour.');
  const d = journalArticle('## The [Commonitory](https://example.org/c) of *Vincent*\nbody');
  assert.equal(d.title, 'The Commonitory of Vincent');
});

test('plainInline reduces inline markdown to its words and spares snake_case', () => {
  assert.equal(plainInline('![a shield](/s.png) and [a link](https://x.y/z)'), 'a shield and a link');
  assert.equal(plainInline('**bold**, *italic*, _under_, ~~gone~~ and `code`'), 'bold, italic, under, gone and code');
  assert.equal(plainInline('see <https://merecatholicity.com>'), 'see https://merecatholicity.com');
  assert.equal(plainInline('the journal_topic setting'), 'the journal_topic setting');
});
