"""The doors to Lérins Press on the corpus pages (scripts/inject_support.py): one box
after the title block, rewritten in place on a second run, nothing on a page without a
title block; the catechisms box is never an affiliate link of its own, and the edition
card for our own book carries no affiliate words at all."""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'scripts'))
import inject_support as m  # noqa: E402

PAGE = ('<body>\n<main class="prose corpus">\n<header id="title-block-header">\n'
        '<h1 class="title">The Westminster Confession</h1>\n</header>\n<nav id="TOC"></nav>\n')


class InjectSupport(unittest.TestCase):
    def test_one_box_after_the_title_block(self):
        out = m.inject(PAGE, m.CATECHISMS)
        self.assertEqual(out.count('class="mc-support"'), 1)
        self.assertLess(out.index('</header>'), out.index('mc-support'))
        self.assertLess(out.index('mc-support'), out.index('<nav id="TOC">'))
        self.assertIn('https://press.merecatholicity.com/catechisms/', out)

    def test_a_second_run_changes_nothing(self):
        for box in set(m.PAGES.values()):
            once = m.inject(PAGE, box)
            self.assertEqual(m.inject(once, box), once)

    def test_a_changed_box_replaces_the_old_one(self):
        catena = m.PAGES['catena-matthew.html']
        out = m.inject(m.inject(PAGE, m.CATECHISMS), catena)
        self.assertNotIn('mc-support', out)
        self.assertEqual(out.count('class="mc-edition"'), 1)

    def test_a_page_without_a_title_block_is_left_alone(self):
        bare = '<body><main><p>No header here.</p></main></body>'
        self.assertEqual(m.inject(bare, m.CATECHISMS), bare)

    def test_only_the_summa_box_is_an_amazon_link(self):
        # the others open the press's own pages, whose Amazon links carry the tag
        for box in m.PAGES.values():
            if any(box is a for a in m.AFFILIATE):
                continue
            self.assertNotIn('amazon.com', box)
            self.assertNotIn('tag=', box)

    def test_the_summa_box_is_marked_and_disclosed(self):
        self.assertIn('https://www.amazon.com/dp/0870610635?', m.SUMMA)
        self.assertIn('tag=lerinspress-20', m.SUMMA)
        self.assertIn('rel="sponsored noopener"', m.SUMMA)
        self.assertIn('Affiliate link.', m.SUMMA)
        self.assertIn('As an Amazon Associate we earn from qualifying purchases.', m.SUMMA)
        for part in ('fp', 'fs', 'ss', 'tp', 'xp'):
            self.assertIs(m.PAGES[f'summa-{part}.html'], m.SUMMA)

    def test_the_catena_cards_name_their_own_editions(self):
        for gospel in ('matthew', 'mark', 'luke', 'john'):
            box = m.PAGES[f'catena-{gospel}.html']
            self.assertIn(f'https://press.merecatholicity.com/titles/catena-aurea-on-st-{gospel}/', box)
            self.assertNotIn('affiliate', box.lower())

    def test_every_newman_work_carries_the_essay(self):
        pages = m.newman_pages()
        self.assertGreater(len(pages), 50)
        self.assertIn('development.html', pages)
        for page in pages:
            self.assertIs(m.PAGES[page], m.NEWMAN_OWN.get(page, m.NEWMAN), page)
        self.assertIn('dp/0140433740?', m.PAGES['apologia.html'])
        self.assertIn('dp/0268010005?', m.PAGES['grammar.html'])
        for box in m.AFFILIATE:
            self.assertIn('tag=lerinspress-20', box)
            self.assertIn('rel="sponsored noopener"', box)
            self.assertIn('Affiliate link. As an Amazon Associate we earn from qualifying purchases.', box)
        self.assertIn('https://www.amazon.com/dp/026800921X?', m.NEWMAN)
        self.assertIn('tag=lerinspress-20', m.NEWMAN)
        self.assertIn('rel="sponsored noopener"', m.NEWMAN)
        self.assertIn('As an Amazon Associate we earn from qualifying purchases.', m.NEWMAN)


if __name__ == '__main__':
    unittest.main()
