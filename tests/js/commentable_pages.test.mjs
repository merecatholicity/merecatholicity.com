/* "Comments only under our own writings" — DETECTED, not listed. Three things
 * must agree: the BUILD stamps the widget's mount onto a page (content.py, by
 * `carries_comments`: every content/ page unless its frontmatter says
 * `comments: false`; the books, by the tail partial), the DETECTOR
 * (scripts/writings.py) turns the same sources into the generated
 * Domain.Writings, and the KERNEL (Domain.Comments.commentablePages) is what
 * the worker whitelists and the admin console offers switches for. A page with
 * the mount but not in the kernel shows a section the worker refuses; a page in
 * the kernel without the mount is a switch that does nothing; a library volume
 * built with the tail partial would open comments under someone else's work.
 *
 * This derives the set a SECOND way, in JS over the sources — never the built
 * docs/, so it runs on a clean checkout — and holds the kernel to it. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as Comments from '../../purescript/output/Domain.Comments/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/* content.py's rule, re-derived: the mount is stamped unless the frontmatter
   says `comments: false` (YAML false, exactly). */
function optsOut(src) {
  if (!src.startsWith('---\n')) return false;
  const end = src.indexOf('\n---\n', 4);
  if (end === -1) return false;
  return /^comments:\s*false\s*$/m.test(src.slice(4, end));
}
const contentDir = join(root, 'content');
const articles = readdirSync(contentDir)
  .filter((f) => /\.(md|html)$/.test(f))
  .filter((f) => !optsOut(readFileSync(join(contentDir, f), 'utf8')))
  .map((f) => '/' + f.replace(/\.(md|html)$/, '.html'));

/* The root Makefile's pandoc calls that write docs/<name>.html: the books. */
const mk = readFileSync(join(root, 'Makefile'), 'utf8').replace(/\\\n/g, ' ');
const bookCalls = [...mk.matchAll(/pandoc\s[^\n]*/g)].map((m) => m[0])
  .filter((c) => /-o \.\.\/docs\/[A-Za-z0-9_-]+\.html(\s|$)/.test(c));
const books = bookCalls.map((c) => '/' + /-o \.\.\/docs\/([A-Za-z0-9_-]+)\.html/.exec(c)[1] + '.html');

test('the tail partial is what carries the widget onto a book, and every book is built with it', () => {
  const tail = readFileSync(join(root, 'partials', 'book-tail.html'), 'utf8');
  assert.ok(tail.includes('<section class="comments" data-comments></section>'));
  assert.ok(books.length >= 2, 'the book and the memorandum at least');
  for (const c of bookCalls) {
    assert.ok(c.includes('-A ../partials/book-tail.html'),
      `a book built without the tail partial would give the admin a dead switch: ${c.slice(0, 80)}`);
  }
});

test('no library work is ever built with the widget', () => {
  const res = readFileSync(join(root, 'resources', 'Makefile'), 'utf8');
  assert.ok(!res.includes('book-tail'), 'resources/Makefile must never name the tail partial');
  assert.ok(!res.includes('data-comments'), 'nor stamp the widget any other way');
});

test('the sources and the kernel name the same writings, with the same kinds', () => {
  const kernel = Comments.commentablePages;
  assert.deepEqual([...kernel.map((p) => p.path)].sort(), [...new Set([...books, ...articles])].sort(),
    'the generated Domain.Writings must be what the sources say (run `make writings`; psbuild does)');
  for (const p of kernel) {
    assert.equal(p.kind, books.includes(p.path) ? 'book' : 'article', p.path);
    assert.ok(p.title && typeof p.title === 'string', `${p.path} has a title for the console`);
  }
  /* The rule's two halves in this tree: an essay is in, a utility page and a
     library volume are out. */
  assert.ok(kernel.some((p) => p.path === '/credo.html'));
  assert.ok(kernel.some((p) => p.path === '/book.html' && p.kind === 'book'));
  assert.ok(!kernel.some((p) => p.path === '/terms.html'), 'terms opts out');
  assert.ok(!kernel.some((p) => p.path === '/anf01.html'), 'the library is never ours');
});

test('the build stamps the mount by the one rule content.py exports', () => {
  const py = readFileSync(join(root, 'scripts', 'content.py'), 'utf8');
  assert.ok(py.includes("def carries_comments(fm):"), 'the rule must be a named function');
  assert.ok(py.includes("return fm.get('comments') is not False"), 'only YAML false opts out');
  assert.ok(py.includes('if carries_comments(fm):'), 'and build_page must stamp by it');
  const det = readFileSync(join(root, 'scripts', 'writings.py'), 'utf8');
  assert.ok(det.includes('content.carries_comments(fm)'), 'the detector reads the same function');
});
