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
import { orNull } from '../_support/ps.mjs';

const journalKeyId = (k) => orNull(Comments.journalKeyId(k));

const OWN = ['/book.html', '/charting-communions.html', '/free-churches.html',
  '/objections.html', '/credo.html', '/lex-orandi.html', '/about.html'];

test("commentablePaths: the site's own writings, the book first, in console order", () => {
  assert.deepEqual(Comments.commentablePaths, OWN);
  assert.equal(Comments.commentablePages.length, OWN.length);
  for (const pg of Comments.commentablePages) {
    assert.equal(typeof pg.title, 'string');
    assert.ok(pg.title.length > 0, `${pg.path} needs a title for the admin console`);
    assert.ok(OWN.includes(pg.path));
  }
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
  assert.deepEqual(Comments.parseEnabledPages(OWN.slice().reverse().join(',')), OWN, 'order is the list\'s, not the input\'s');
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
