"""The Library's doors to print (scripts/inject_support.py, content/affiliate.json): every
Library work and every shelf overview resolves to a box or an edition card; every Amazon box
is a marked, disclosed SiteStripe link with the press's tag; a box lands once, after the
title block (or a content page's <h1>), and a second run changes nothing."""
import os
import re
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'scripts'))
import inject_support as m  # noqa: E402

PANDOC = ('<body>\n<main class="prose corpus">\n<header id="title-block-header">\n'
          '<h1 class="title">The Westminster Confession</h1>\n</header>\n<nav id="TOC"></nav>\n')
CONTENT = '<body>\n<main class="prose">\n<h1 class="home-title">The Rosary</h1>\n<p>Text.</p>\n'
LEDGER = m.load()
SHELVES = m.library_shelves()


class Ledger(unittest.TestCase):
    def test_every_name_the_ledger_uses_exists(self):
        keys = set(LEDGER['books']) | set(LEDGER['doors'])
        titles, _ = m.press_catalogue()
        for shelf, key in LEDGER['shelves'].items():
            self.assertIn(shelf, SHELVES, f'no Library shelf "{shelf}"')
            if key.startswith('lerins:'):
                self.assertIn(key[len('lerins:'):], titles, shelf)
            else:
                self.assertIn(key, keys, shelf)
        for page, own in LEDGER['works'].items():
            if isinstance(own, str):
                self.assertIn(own, keys, page)
            else:
                self.assertTrue({'hand', 'lerins', 'miss'} & set(own), page)
                if 'lerins' in own:
                    self.assertIn(own['lerins'], titles, page)

    def test_every_amazon_book_is_a_tagged_sitestripe_link(self):
        for key, book in LEDGER['books'].items():
            self.assertRegex(book['asin'], r'^[0-9A-Z]{10}$', key)
            self.assertRegex(book['link_id'], r'^[0-9a-f]{20,}$', key)
            box = m.affiliate(book)
            self.assertIn(f'https://www.amazon.com/dp/{book["asin"]}?', box)
            self.assertIn('tag=lerinspress-20', box)
            self.assertIn('rel="sponsored noopener"', box)
            self.assertIn('Affiliate link. As an Amazon Associate we earn from qualifying purchases.', box)

    def test_a_door_and_an_edition_card_are_never_amazon_links(self):
        titles, _ = m.press_catalogue()
        cards = [m.door(d) for d in LEDGER['doors'].values()]
        cards += [m.edition(own['lerins']) for own in LEDGER['works'].values()
                  if isinstance(own, dict) and 'lerins' in own]
        for box in cards:
            self.assertNotIn('amazon.com', box)
            self.assertNotIn('tag=', box)
        for box in cards[len(LEDGER['doors']):]:
            self.assertNotIn('affiliate', box.lower())

    def test_every_page_a_shelf_with_a_catch_all_lists_carries_a_box(self):
        pages = m.resolve(LEDGER)
        hand = {p for p, o in LEDGER['works'].items() if isinstance(o, dict) and 'hand' in o}
        for shelf in LEDGER['shelves']:
            for page in SHELVES[shelf]:
                if page not in hand:
                    self.assertTrue(page in pages, f'{page} on {shelf} carries no box')

    def test_a_work_s_own_entry_beats_its_shelf(self):
        pages = m.resolve(LEDGER)
        self.assertIn('dp/163941035X?', pages['guettee.html'])
        self.assertIn('titles/newman-idea/', pages['idea.html'])
        self.assertIn('In print: <em>An Essay on the Development', pages['verses.html'])
        self.assertIn('class="mc-edition"', pages['catena-john.html'])
        self.assertIn('This work in print: <em>Mere Catholicity</em>', pages['book.html'])
        self.assertIn('In print: <em>Mere Catholicity</em>', pages['charting-communions.html'])


class Placement(unittest.TestCase):
    def test_one_box_after_the_title_block(self):
        out = m.inject(PANDOC, m.door(LEDGER['doors']['press-catechisms']))
        self.assertEqual(out.count('class="mc-support"'), 1)
        self.assertLess(out.index('</header>'), out.index('mc-support'))
        self.assertLess(out.index('mc-support'), out.index('<nav id="TOC">'))

    def test_a_content_page_takes_it_after_its_h1(self):
        out = m.inject(CONTENT, m.affiliate(LEDGER['books']['city-of-god-bettenson']))
        self.assertLess(out.index('</h1>'), out.index('mc-support'))
        self.assertLess(out.index('mc-support'), out.index('<p>Text.</p>'))

    def test_a_second_run_changes_nothing_and_a_new_box_replaces_the_old(self):
        a = m.affiliate(LEDGER['books']['city-of-god-bettenson'])
        b = m.door(LEDGER['doors']['press-bibles'])
        once = m.inject(PANDOC, a)
        self.assertEqual(m.inject(once, a), once)
        swapped = m.inject(once, b)
        self.assertEqual(swapped.count(m.FENCE_OPEN), 1)
        self.assertNotIn('0140448942', swapped)

    def test_a_page_with_no_title_is_left_alone(self):
        bare = '<body><p>No header here.</p></body>'
        self.assertEqual(m.inject(bare, 'x'), bare)

    def test_the_library_overviews_follow_their_shelves(self):
        lib = ('<main><h2 id="fathers">F</h2><ul class="library"><li>a</li></ul>\n'
               '<h2 id="classics">C</h2><ul class="library"><li>b</li></ul>\n</main>')
        out = m.inject_library(lib, {'fathers': 'BOX-F'})
        self.assertLess(out.index('</ul>'), out.index('BOX-F'))
        self.assertLess(out.index('BOX-F'), out.index('<h2 id="classics">'))
        self.assertEqual(m.inject_library(out, {'fathers': 'BOX-F'}), out)


if __name__ == '__main__':
    unittest.main()
