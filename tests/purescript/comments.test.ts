/* Domain.Comments — where a comments section may exist, and whether it is open.
   Two rules the worker and the client must share: the site's OWN writings are
   the only pages that may carry a section (a library work never can), and every
   section ships CLOSED — an absent app_settings row opens nothing, and only a
   literal '1' / a listed path opens anything. NOTE the polarity is the OPPOSITE
   of Domain.Wall / Domain.Turnstile (where only a literal '0' turns a thing
   off); that is deliberate and this file is where it is locked. Also the
   'journal:<id>' page-key grammar, strict and canonical, and the permalink
   mapping the audit and the RSS builder use. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Comments from '../../purescript/output/Domain.Comments/index.js';
import { orNull } from '../_support/ps.ts';

const journalKeyId = (k: string) => orNull(Comments.journalKeyId(k));

/* The members come from the generated Domain.Writings (scripts/writings.py
   over content/ and the Makefile); tests/js/commentable_pages.test.ts holds
   them to the sources. Here: the shape and the standing anchors. */
const OWN = Comments.commentablePaths;

test("commentablePages: the site's own writings — books first, every entry titled and kinded", () => {
  assert.ok(OWN.length >= 7, 'the book and the essays at least');
  assert.deepEqual(OWN, Comments.commentablePages.map((p) => p.path));
  assert.equal(OWN[0], '/book.html', 'the book leads');
  assert.ok(OWN.includes('/credo.html'));
  const kinds = Comments.commentablePages.map((p) => p.kind);
  for (const pg of Comments.commentablePages) {
    assert.ok(pg.title.length > 0, `${pg.path} needs a title for the admin console`);
    assert.ok(pg.kind === 'book' || pg.kind === 'article', pg.path);
    assert.ok(/^\/[a-z0-9-]+\.html$/.test(pg.path), `${pg.path} is a served path`);
  }
  assert.deepEqual(kinds, [...kinds].sort((a, b) => (a === b ? 0 : a === 'book' ? -1 : 1)), 'books, then articles');
  assert.equal(new Set(OWN).size, OWN.length, 'no path twice');
});

test('isCommentable: a library work, a board key, a reader page can never carry a section', () => {
  assert.equal(Comments.isCommentable('/credo.html'), true);
  assert.equal(Comments.isCommentable('/book.html'), true);
  for (const p of ['/anf01.html', '/kjv.html', '/summa-1.html', 'board:pub', 'journal:3', '', '/credo', 'credo.html']) {
    assert.equal(Comments.isCommentable(p), false, p);
  }
});

test('the defaults: no page open, the journal off — a fresh database opens nothing', () => {
  assert.equal(Comments.pagesEnabledDefault, '');
  assert.equal(Comments.journalEnabledDefault, false);
  for (const p of OWN) assert.equal(Comments.pageEnabled('')(p), false, `${p} must be closed on an absent row`);
});

test('parseEnabledPages: trims, dedupes, keeps canonical order, drops what is not ours', () => {
  assert.deepEqual(Comments.parseEnabledPages(' /credo.html ,/book.html,/anf01.html,/credo.html'),
    ['/book.html', '/credo.html']);
  assert.deepEqual(Comments.parseEnabledPages(''), []);
  assert.deepEqual(Comments.parseEnabledPages('nonsense'), []);
  assert.deepEqual(Comments.parseEnabledPages([...OWN].reverse().join(',')), OWN, 'order is the list\'s, not the input\'s');
});

test('serializeEnabledPages: the canonical stored form, and a round trip', () => {
  assert.equal(Comments.serializeEnabledPages(['/about.html', '/book.html', '/nope.html']), '/book.html,/about.html');
  assert.equal(Comments.serializeEnabledPages([]), '');
  const csv = Comments.serializeEnabledPages(Comments.parseEnabledPages('/lex-orandi.html, /credo.html'));
  assert.equal(csv, '/credo.html,/lex-orandi.html');
  assert.deepEqual(Comments.parseEnabledPages(csv), ['/credo.html', '/lex-orandi.html']);
});

test('pageEnabled: only a listed, commentable path is open', () => {
  assert.equal(Comments.pageEnabled('/credo.html')('/credo.html'), true);
  assert.equal(Comments.pageEnabled('/credo.html')('/book.html'), false);
  assert.equal(Comments.pageEnabled('/anf01.html')('/anf01.html'), false, 'a library path listed by hand is still not open');
});

test("journalEnabledFrom: ONLY a literal '1' opens the journal's sections (the opposite polarity of the social switch)", () => {
  assert.equal(Comments.journalEnabledFrom('1'), true);
  for (const v of ['', '0', 'true', 'on', 'yes', '01', '1 ', 'nonsense']) {
    assert.equal(Comments.journalEnabledFrom(v), false, JSON.stringify(v));
  }
});

test('journalKey / journalKeyId: strict, canonical, and a round trip', () => {
  assert.equal(Comments.journalKey(12), 'journal:12');
  assert.equal(journalKeyId('journal:12'), 12);
  assert.equal(journalKeyId(Comments.journalKey(7)), 7);
  for (const k of ['journal:0', 'journal:012', 'journal:1a', 'Journal:1', 'journal:', 'journal: 1',
    'journal:+1', 'journal:-1', 'journal:99999999999', '/book.html', 'board:pub', '', 'journal:1.5']) {
    assert.equal(journalKeyId(k), null, k);
  }
});

test("pageHref: a journal key maps to the article's permalink; anything else passes through", () => {
  assert.equal(Comments.pageHref('journal:12'), '/journal.html?a=12');
  assert.equal(Comments.pageHref('/book.html'), '/book.html');
  assert.equal(Comments.pageHref('board:pub'), 'board:pub');
});

test('the journal overview shows a teaser: whole paragraphs while they fit', () => {
  const t = (n: number, s: string) => Comments.journalTeaser(n)(s);
  assert.deepEqual(t(400, 'One short entry.'), { text: 'One short entry.', more: false });
  assert.deepEqual(t(400, '  \n'), { text: '', more: false });
  const two = 'First paragraph.\n\nSecond paragraph.';
  assert.deepEqual(t(400, two), { text: two, more: false }, 'a short entry is whole, no "Continue reading"');
  const p = 'x'.repeat(250);
  assert.deepEqual(t(400, p + '\n\n' + p + '\n\n' + p), { text: p, more: true }, 'paragraphs stop at the limit');
  assert.equal(t(400, 'a\n \t\nb').text, 'a\n\nb', 'a blank line with spaces is still a paragraph break');
});

test('a long first paragraph is cut at a sentence, never inside a link', () => {
  const t = (n: number, s: string) => Comments.journalTeaser(n)(s);
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
  assert.equal((Comments.journalTeaser(150)(bold).text.match(/\*\*/g) || []).length % 2, 0, 'no unclosed **');
  const angle = 'word '.repeat(28) + '<https://press.merecatholicity.com/titles/machines-of-borrowed-grace/> ' + 'x '.repeat(80);
  assert.doesNotMatch(Comments.journalTeaser(150)(angle).text, /<[^>]*$/, 'no half-open <url>');
});

test('a one-line opening is followed by the start of the next paragraph', () => {
  const body = '[Lérins Press](https://press.merecatholicity.com/) is the new publishing arm.\n\n' +
    'The name comes from the small island off the coast of Cannes. Early in the fifth century Honoratus founded a monastery there. ' +
    'Bishops came out of it, and so did books. '.repeat(10);
  const r = Comments.journalTeaser(300)(body);
  assert.equal(r.more, true);
  const [first, second] = r.text.split('\n\n');
  assert.equal(first, '[Lérins Press](https://press.merecatholicity.com/) is the new publishing arm.');
  assert.ok(second.startsWith('The name comes from') && /\.$/.test(second) && r.text.length <= 300, r.text);
});
