"""A shared link must say WHICH page it is.

Until 2026-09-17, 234 of the site's 274 pages carried the same og:description —
"A primary source in the Mere Catholicity Library." — so a link to Virgil and a
link to Irenaeus read identically below their titles. Nothing was red: every
page HAD a card, and no test asked whether the card said anything. The cards
also came from three owners (two pandoc head partials, content.py, this sweep),
which is why the bishop paper looked like the one page with social markup of its
own.

What would break silently now: a formula that stops naming the shelf (every
Library page back to one sentence); a card that never reaches a pages tree
restored from the build cache (the fence is what makes a rewrite possible); the
legacy shim's bytes drifting from what actually shipped, so the old card is
never found and never removed; and a noindex door page advertising itself.

The sweep is over EVERY page, not a sample: the class of bug here is "one page
was fixed and the other 233 were not".
"""
import glob
import os
import re
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DOCS = os.path.join(ROOT, 'docs')
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
import inject_social as m  # noqa: E402

DESC_RE = re.compile(r'<meta property="og:description" content="([^"]*)">')
TITLE_RE = re.compile(r'<meta property="og:title" content="([^"]*)">')
URL_RE = re.compile(r'<meta property="og:url" content="([^"]*)">')


def pages():
    """Every served page, by name, with its text. Skipped where docs/ is bare."""
    out = {}
    for p in sorted(glob.glob(os.path.join(DOCS, '*.html'))):
        name = os.path.basename(p)
        # turnstile.html is the challenge iframe and the google*.html file is a
        # verification token: neither is a reading, and neither has a <title>.
        if name == 'turnstile.html' or name.startswith('google'):
            continue
        with open(p, encoding='utf-8') as f:
            out[name] = f.read()
    return out


class TheFormula(unittest.TestCase):
    """The description is built, not written. These hold what it must say."""

    WORKS = {'anf01.html': ('Vol. I. The Apostolic Fathers', 'Ante-Nicene Fathers'),
             'aeneid.html': ('The Aeneid of Virgil', 'The philosophers')}

    def test_a_library_page_is_described_by_its_shelf(self):
        """The title says what the work is; only the shelf says why this site
        hosts it. Both, or the card is back to naming the site."""
        d = m.describe('aeneid.html', self.WORKS)
        self.assertIn('The Aeneid of Virgil', d)
        self.assertIn('The philosophers', d)
        self.assertTrue(d.endswith('in the Mere Catholicity Library.'), d)

    def test_a_page_the_catalog_does_not_name_falls_back(self):
        """A work off the shelves (and a tree with no docs/library.html) keeps
        the generic line rather than failing the build over a share card."""
        self.assertEqual(m.describe('nowhere.html', self.WORKS), m.DESC)
        self.assertEqual(m.describe('nowhere.html', {}), m.DESC)

    def test_the_catalog_is_read_from_the_page_that_is_the_catalog(self):
        """library.html is the shelf list a reader browses; the card must come
        from the same place, or the two can disagree."""
        if not os.path.exists(os.path.join(DOCS, 'library.html')):
            self.skipTest('docs/ has not been built here')
        works = m.catalog()
        self.assertGreater(len(works), 200, 'the catalog parsed almost nothing')
        for name, (title, shelf) in works.items():
            self.assertTrue(name.endswith('.html'), name)
            self.assertTrue(title and shelf, name + ': a work with no title or shelf')


class TheCard(unittest.TestCase):
    def test_the_card_is_fenced_so_a_later_run_can_rewrite_it(self):
        """Without the fence a cached pages tree keeps the card its previous
        formula wrote for ever: every page already has an og:title, so every
        page looks curated. The fence is the whole idempotence story."""
        block = m.card('A work', 'https://merecatholicity.com/x.html', 'Its shelf.')
        self.assertTrue(block.startswith(m.FENCE_OPEN))
        self.assertTrue(block.endswith(m.FENCE_CLOSE))
        page = '<head><title>A work</title>\n' + block + '\n</head>'
        again = m.place_card(page, m.card('A work', 'https://merecatholicity.com/x.html',
                                          'A better shelf.'), '<title>A work</title>')
        self.assertEqual(again.count(m.FENCE_OPEN), 1, 'the fence was duplicated')
        self.assertIn('A better shelf.', again)
        self.assertNotIn('Its shelf.', again)

    def test_a_page_that_goes_noindex_loses_the_card_it_was_given(self):
        """away.html is why: a card outlived the page's reason to have one, and
        kept being re-asserted. Taking it away is one line; forgetting to is six
        weeks of a door advertising itself."""
        block = m.card('A door', 'https://merecatholicity.com/x.html', 'Its shelf.')
        page = '<head><title>A door</title>\n' + block + '\n</head>'
        self.assertEqual(m.uncard(page), '<head><title>A door</title>\n</head>')

    def test_a_description_is_escaped_and_a_title_is_not(self):
        """The title arrives as the document's own <title> text, already
        escaped; the description is plain text out of the catalog. Escaping the
        first twice would ship &amp;amp; into a card."""
        block = m.card('Logos &amp; Verbum', 'https://merecatholicity.com/x.html',
                       'Tom & Jerry')
        self.assertIn('content="Logos &amp; Verbum"', block)
        self.assertIn('content="Tom &amp; Jerry"', block)

    def test_the_two_latex_works_keep_the_card_their_partials_held(self):
        """partials/social.html and partials/social-bishop.html were retired
        into OVERRIDES on 2026-09-17 (pandoc's -H was the only door into a head
        it writes itself). Their curated cards must survive the move: the book
        is a book and carries the cover's true pixels, the bishop paper is an
        article and keeps its own sentence."""
        book = m.OVERRIDES['book.html']
        self.assertEqual(book['og_type'], 'book')
        self.assertIn(('meta property="og:image:width"', '1300'), book['extra'])
        self.assertIn(('meta property="og:image:height"', '1625'), book['extra'])
        bishop = m.OVERRIDES['bishop-presbyter.html']
        self.assertEqual(bishop['og_type'], 'article')
        self.assertIn('bishop and presbyter', bishop['desc'])

    def test_the_shim_reproduces_the_old_card_byte_for_byte(self):
        """The legacy strip works by EXACT match: these are the bytes this
        script wrote before 2026-09-17, and a cached tree is full of them. If
        this text drifts, the old card is never found, never removed, and the
        new one never lands on any page the cache carried."""
        expected = (
            '<meta name="description" content="A primary source in the Mere Catholicity Library.">\n'
            '<meta property="og:type" content="book">\n'
            '<meta property="og:site_name" content="Mere Catholicity">\n'
            '<meta property="og:title" content="A work">\n'
            '<meta property="og:description" content="A primary source in the Mere Catholicity Library.">\n'
            '<meta property="og:url" content="https://merecatholicity.com/x.html">\n'
            '<meta property="og:image" content="https://merecatholicity.com/cover.jpg">\n'
            '<meta name="twitter:card" content="summary_large_image">\n'
            '<meta name="twitter:title" content="A work">\n'
            '<meta name="twitter:description" content="A primary source in the Mere Catholicity Library.">\n'
            '<meta name="twitter:image" content="https://merecatholicity.com/cover.jpg">')
        self.assertEqual(m.legacy_card('A work', 'https://merecatholicity.com/x.html'),
                         expected)


class EveryServedPage(unittest.TestCase):
    """The sweep. One page fixed is not the rule holding."""

    @classmethod
    def setUpClass(cls):
        if not os.path.isdir(DOCS):
            raise unittest.SkipTest('docs/ has not been built here')
        cls.pages = pages()
        if len(cls.pages) < 50:
            raise unittest.SkipTest('docs/ has not been built here')

    def test_every_indexable_page_carries_one_card_naming_itself(self):
        missing, wrong = [], []
        for name, html in self.pages.items():
            if m.NOINDEX_RE.search(html):
                continue
            if not (TITLE_RE.search(html) and DESC_RE.search(html)):
                missing.append(name)
                continue
            self.assertEqual(html.count('<meta property="og:title"'), 1, name)
            url = URL_RE.search(html)
            # index.html is canonical at the bare domain root (gen_sitemap.py
            # emits the same address) — every other page is its own filename.
            want = m.SITE + '/' if name == 'index.html' else m.SITE + '/' + name
            if not url or url.group(1) != want:
                wrong.append(name + ': ' + (url.group(1) if url else 'no og:url'))
        self.assertEqual(missing, [], 'pages with no share card')
        self.assertEqual(wrong, [], 'pages whose og:url is not their own address')

    def test_no_description_is_worn_by_more_than_two_pages(self):
        """The regression this file exists for. Two is the honest ceiling: the
        home page shares the book's line, and the feed shares the board's."""
        seen = {}
        for name, html in self.pages.items():
            d = DESC_RE.search(html)
            if d:
                seen.setdefault(d.group(1), []).append(name)
        crowded = {d: n for d, n in seen.items() if len(n) > 2}
        self.assertEqual(crowded, {}, 'one sentence over many pages')

    def test_every_library_work_says_its_own_shelf(self):
        """The 233 corpus pages are the ones that were all alike. Each must name
        the shelf it stands on — and none may still carry the generic line."""
        works = m.catalog()
        if not works:
            self.skipTest('docs/library.html has not been built here')
        silent, generic = [], []
        for name, html in self.pages.items():
            if name not in works or m.FENCE_OPEN not in html:
                continue          # a curated card (the papers) is its own
            if name in m.OVERRIDES:
                continue          # the book and the bishop paper say their own sentence
            d = DESC_RE.search(html)
            desc = d.group(1) if d else ''
            if works[name][1] not in desc:
                silent.append(name)
            if desc == m.DESC:
                generic.append(name)
        self.assertEqual(silent, [], 'Library pages whose card does not name their shelf')
        self.assertEqual(generic, [], 'Library pages still on the one generic sentence')

    def test_a_noindex_page_is_never_given_a_card(self):
        """away.html is a door and admin.html is a back room; neither is a
        reading anyone shares. A card on a page kept out of every index is
        noise, and away.html spent weeks announcing itself as a primary source
        in the Library."""
        for name, html in self.pages.items():
            if m.NOINDEX_RE.search(html):
                self.assertNotIn(m.FENCE_OPEN, html, name + ': a noindex page was carded')
                self.assertNotIn(m.DESC, html, name + ': a noindex page kept the old card')


if __name__ == '__main__':
    unittest.main()
