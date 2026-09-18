"""The metadata a page owes a reader who is not us — and cannot see it missing.

Four defects shipped on 86% of the site for as long as the corpus has existed,
and every one of them is invisible from a browser that works:

  * `<html lang="">` on 237 of 274 pages. Pandoc writes an empty language
    attribute when the document declares none. A screen reader cannot choose a
    voice from it; a WCAG 3.1.1 (Level A) check fails on it. Nothing renders
    differently, so nothing ever said so.
  * More than one `<h1>` on 230 pages — every LaTeX \\section* became one,
    beside the title block's own.
  * One page in 274 with rel=canonical, on a site that answers at two
    hostnames and at any query string a shared link carries.
  * No skip link on documents that open with several hundred table-of-contents
    entries.

What breaks silently HERE: the demotion is a rewrite of the built page, so a
second pass over an already-shifted page would push the whole corpus down
another level (h2→h3→h4…) with nothing to show for it but a paler heading
each build. The `prose corpus` mark on <main> is the done-mark, and
test_a_second_pass_changes_nothing is the rule that holds it.
"""
import glob
import os
import re
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DOCS = os.path.join(ROOT, 'docs')
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
import page_meta as m  # noqa: E402

CANON_RE = re.compile(r'<link rel="canonical" href="([^"]*)">')
OG_URL_RE = re.compile(r'<meta property="og:url" content="([^"]*)"')

PAGE = ('<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" lang="" xml:lang="">\n'
        '<head>\n<meta name="generator" content="pandoc" />\n<title>A work</title>\n'
        '<meta property="og:url" content="https://merecatholicity.com/a.html">\n'
        '</head>\n<body>\n<main class="prose">\n'
        '<header id="title-block-header">\n<h1 class="title">A work</h1>\n</header>\n'
        '<nav id="TOC" role="doc-toc">\n<ul><li><a href="#one">One</a></li></ul>\n</nav>\n'
        '<h1 class="unnumbered" id="one">One</h1>\n<p>Text.</p>\n'
        '<h2 class="unnumbered" id="two">Two</h2>\n'
        '<h4\nid="three">Three</h4>\n'
        '</main>\n<footer>foot</footer>\n</body>\n</html>\n')


class Language(unittest.TestCase):
    def test_an_empty_lang_becomes_english(self):
        """Both attributes: the corpus pages are XHTML-flavoured and carry
        lang and xml:lang, and a validator reads whichever it prefers."""
        out, did = m.set_lang('<html lang="" xml:lang="">')
        self.assertTrue(did)
        self.assertEqual(out, '<html lang="en" xml:lang="en">')

    def test_a_page_that_names_a_language_keeps_it(self):
        """A Latin or Greek edition may one day say so, and this sweep must
        not overrule it."""
        out, did = m.set_lang('<html lang="la">')
        self.assertFalse(did)
        self.assertEqual(out, '<html lang="la">')

    def test_a_page_with_no_lang_at_all_is_given_one(self):
        out, did = m.set_lang('<html>')
        self.assertTrue(did)
        self.assertEqual(out, '<html lang="en">')


class Canonical(unittest.TestCase):
    def test_the_canonical_is_the_page_s_own_og_url(self):
        """The build has written og:url for years; the canonical is the same
        string, one more tag — so the two can never disagree."""
        out, did = m.set_canonical(
            '<head><meta property="og:url" content="https://x/a.html"></head>')
        self.assertTrue(did)
        self.assertIn('<link rel="canonical" href="https://x/a.html">', out)

    def test_the_canonical_is_never_written_inside_the_card_fence(self):
        """THE placement rule. og:url lives inside inject_social.py's fenced
        card on 235 pages, and the fence is REWRITTEN wholesale every build:
        a canonical placed beside the line it was read from would be deleted
        by the next run of a script that knows nothing about it, on exactly
        the pages that most need one. It goes last in the head."""
        page = ('<head><title>t</title>\n<!--mc-card-->\n'
                '<meta property="og:url" content="https://x/a.html">\n'
                '<!--/mc-card-->\n</head><body></body>')
        out, did = m.set_canonical(page)
        self.assertTrue(did)
        self.assertLess(out.index('<!--/mc-card-->'), out.index('rel="canonical"'))
        self.assertLess(out.index('rel="canonical"'), out.index('</head>'))

    def test_a_head_that_never_closes_is_left_alone(self):
        """No head, no place to put it — and a page that is not a document is
        not worth guessing about."""
        out, did = m.set_canonical('<meta property="og:url" content="https://x/a.html" />')
        self.assertFalse(did)

    def test_an_existing_canonical_is_never_overwritten(self):
        """resources.html points at library.html on purpose: its canonical is
        NOT its own address, and a sweep that asserted og:url would undo the
        one page that already had this right."""
        page = ('<link rel="canonical" href="https://x/library.html">'
                '<meta property="og:url" content="https://x/resources.html">')
        out, did = m.set_canonical(page)
        self.assertFalse(did)
        self.assertEqual(out, page)

    def test_a_page_with_no_og_url_is_left_alone(self):
        out, did = m.set_canonical('<head><title>t</title></head>')
        self.assertFalse(did)


class OneH1(unittest.TestCase):
    def test_the_title_stays_the_only_h1(self):
        out, _ = m.process(PAGE)
        self.assertEqual(len(re.findall(r'<h1\b', out)), 1)
        self.assertIn('<h1 class="title">A work</h1>', out)

    def test_every_division_moves_down_exactly_one(self):
        out, _ = m.process(PAGE)
        self.assertIn('<h2 class="unnumbered" id="one">One</h2>', out)
        self.assertIn('<h3 class="unnumbered" id="two">Two</h3>', out)

    def test_a_heading_whose_attributes_wrap_a_line_is_demoted_too(self):
        """Pandoc wraps long tags: 524 of anf03's 774 chapter headings are
        `<h4\\nid="...">`. A regex that stopped at the newline would have
        demoted a third of the page and left the rest — a document ranked two
        ways at once, and the sweep would have reported success."""
        out, _ = m.process(PAGE)
        self.assertIn('<h5\nid="three">Three</h5>', out)
        self.assertNotIn('<h4\nid="three">', out)

    def test_the_ids_are_untouched(self):
        """Every deep link ever shared, every TOC entry, and every citation
        merecat has ever given points at one of these ids."""
        before = set(re.findall(r'id="([^"]*)"', PAGE))
        out, _ = m.process(PAGE)
        self.assertTrue(before.issubset(set(re.findall(r'id="([^"]*)"', out))))

    def test_a_second_pass_changes_nothing(self):
        """THE rule of this file. The demotion rewrites the built page, and
        `make html` runs over a tree the CI cache restored — an unmarked
        second pass would shift every heading down again, every build, until
        the Fathers were ranked h6 and the stylesheet had nothing to say."""
        once, did = m.process(PAGE)
        self.assertIn('headings', did)
        twice, did2 = m.process(once)
        self.assertEqual(twice, once)
        self.assertEqual(did2, [])

    def test_a_hand_page_is_not_touched(self):
        """Only pandoc pages are demoted: the hand pages already carry one h1
        and a heading scale the stylesheet styles directly."""
        hand = ('<html lang="en"><head><meta property="og:url" content="https://x/a.html">'
                '</head><body><main class="prose"><h1>Title</h1><h2>A part</h2>'
                '</main></body></html>')
        out, did = m.process(hand)
        self.assertNotIn('corpus', out)
        self.assertIn('<h2>A part</h2>', out)
        self.assertEqual(did, ['canonical'])


class TheSkipLink(unittest.TestCase):
    def test_the_link_comes_first_inside_main_and_its_target_after_the_toc(self):
        """Both inside <main>, because the app shell replaces the whole <main>
        element on a soft navigation: a link left outside would survive a hop
        into a page whose target it no longer has."""
        out, _ = m.process(PAGE)
        main = out.index('<main class="prose corpus">')
        link = out.index('class="mc-skip"')
        toc = out.index('</nav>')
        target = out.index('id="mc-text"')
        self.assertLess(main, link)
        self.assertLess(link, toc)
        self.assertLess(toc, target)

    def test_a_page_with_no_table_of_contents_gets_no_skip_link(self):
        """There is nothing to skip: a few of the shorter works (consulting)
        are a title and their text."""
        page = PAGE.replace('<nav id="TOC" role="doc-toc">\n<ul><li><a href="#one">One</a></li></ul>\n</nav>\n', '')
        out, did = m.process(page)
        self.assertNotIn('mc-skip', out)
        self.assertNotIn('skip', did)


class EveryServedPage(unittest.TestCase):
    """The sweep. The class of bug here is 'one page was fixed'."""

    @classmethod
    def setUpClass(cls):
        names = sorted(os.path.basename(p) for p in glob.glob(os.path.join(DOCS, '*.html')))
        if len(names) < 50:
            raise unittest.SkipTest('docs/ has not been built here')
        cls.pages = {}
        for n in names:
            if n.startswith('google') or n in m.SKIP:
                continue
            with open(os.path.join(DOCS, n), encoding='utf-8', errors='replace') as f:
                cls.pages[n] = f.read()

    def test_every_page_declares_english(self):
        bad = [n for n, h in self.pages.items() if 'lang="en"' not in h]
        self.assertEqual(bad, [], 'pages with no language')

    def test_no_page_declares_an_empty_language(self):
        bad = [n for n, h in self.pages.items() if 'lang=""' in h]
        self.assertEqual(bad, [], 'pages whose lang is empty')

    def test_every_page_has_exactly_one_h1(self):
        bad = {n: len(re.findall(r'<h1\b', h)) for n, h in self.pages.items()
               if len(re.findall(r'<h1\b', h)) != 1}
        self.assertEqual(bad, {}, 'pages that are not headed once')

    def test_every_page_names_its_canonical_address(self):
        """A canonical that is not an address of this site is worse than none:
        it hands the page's standing to somewhere else."""
        missing, foreign = [], []
        for n, h in self.pages.items():
            c = CANON_RE.search(h)
            if not c:
                missing.append(n)
            elif not c.group(1).startswith(m.SITE + '/'):
                foreign.append(n + ': ' + c.group(1))
        # away.html is the outbound interstitial: noindex, out of the sitemap,
        # and no canonical is owed to a door.
        self.assertEqual([n for n in missing if n != 'away.html'], [])
        self.assertEqual(foreign, [])

    def test_a_corpus_page_with_a_contents_can_be_skipped(self):
        bad = [n for n, h in self.pages.items()
               if 'class="prose corpus"' in h and 'id="TOC"' in h and 'mc-skip' not in h]
        self.assertEqual(bad, [], 'corpus pages a keyboard must walk the contents of')

    def test_the_corpus_is_marked_and_the_hand_pages_are_not(self):
        """The mark is what the stylesheet keys the reading scale to, and what
        the demotion reads as 'already done'."""
        for n, h in self.pages.items():
            pandoc = '<meta name="generator" content="pandoc"' in h
            self.assertEqual(pandoc, 'class="prose corpus"' in h,
                             n + ': the corpus mark and the generator disagree')


if __name__ == '__main__':
    unittest.main()
