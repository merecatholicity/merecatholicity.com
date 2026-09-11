/* "Comments only under our own writings" is a law with two halves that must
 * agree: the BUILD stamps the widget onto a page (a content source's
 * frontmatter `comments: true`, or the book's tail partial), and the KERNEL
 * lists the pages the worker will serve comments for (Domain.Comments —
 * the admin console's switches and the worker's whitelist). A page with the
 * widget but not in the kernel shows a section the worker refuses; a page in
 * the kernel without the widget is a switch that does nothing; a library
 * volume given the tail partial would open comments under someone else's work.
 * Hermetic over the SOURCES (content/, partials/, the Makefiles), never the
 * built docs/, so it runs on a clean checkout. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as Comments from '../../purescript/output/Domain.Comments/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/* content.py's rule: a page carries the widget iff its frontmatter says
   `comments: true` (YAML true; anything else is off). */
function frontmatterComments(src) {
  if (!src.startsWith('---\n')) return false;
  const end = src.indexOf('\n---\n', 4);
  if (end === -1) return false;
  return /^comments:\s*true\s*$/m.test(src.slice(4, end));
}
const contentDir = join(root, 'content');
const contentPages = readdirSync(contentDir)
  .filter((f) => /\.(md|html)$/.test(f))
  .filter((f) => frontmatterComments(readFileSync(join(contentDir, f), 'utf8')))
  .map((f) => '/' + f.replace(/\.(md|html)$/, '.html'));

/* The Makefile's pandoc calls that end with the book's tail partial (which
   carries the widget), and the page each writes. */
const mk = readFileSync(join(root, 'Makefile'), 'utf8');
const tailPages = [...mk.matchAll(/-A \.\.\/partials\/book-tail\.html[^\n]*\\\n\s*-o \.\.\/docs\/([A-Za-z0-9_-]+)\.html/g)]
  .map((m) => '/' + m[1] + '.html');

test('the tail partial is what carries the widget onto the book', () => {
  const tail = readFileSync(join(root, 'partials', 'book-tail.html'), 'utf8');
  assert.ok(tail.includes('<section class="comments" data-comments></section>'));
  assert.deepEqual(tailPages, ['/book.html'], 'exactly the book is built with the tail partial');
});

test('no library work is ever built with the widget', () => {
  const res = readFileSync(join(root, 'resources', 'Makefile'), 'utf8');
  assert.ok(!res.includes('book-tail'), 'resources/Makefile must never name the tail partial');
  assert.ok(!res.includes('data-comments'), 'nor stamp the widget any other way');
});

test('the build\'s widget pages and the kernel\'s commentable pages are the same set', () => {
  const built = [...new Set([...contentPages, ...tailPages])].sort();
  const kernel = [...Comments.commentablePaths].sort();
  assert.deepEqual(built, kernel,
    'a page joins (or leaves) BOTH the build (frontmatter / partial) and Domain.Comments.commentablePages in one change');
});
