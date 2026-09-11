#!/usr/bin/env python3
"""scripts/writings.py — the detector behind the comments switches.

The admin console offers one switch per page we wrote. That list is not kept
by hand: this script reads the SOURCES — every content/ page unless its
frontmatter opts out with `comments: false`, and every book the root Makefile
builds with pandoc — and writes them as the generated Domain.Writings module
the kernel reads. These tests lock the three rules a human must be able to
trust: which sources count, that a book built without the widget's mount is
refused rather than silently given a dead switch, and that the emitted
PureScript is byte-stable and safely escaped.
"""

import pathlib
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))

import content  # noqa: E402
import writings  # noqa: E402

MK = '''html:
\tcd book && sed -e 's/x/y/' confession.tex | \\
\tpandoc -f latex -t html5 --standalone --toc \\
\t    --metadata title="Mere Catholicity" \\
\t    --css=style.css -B ../partials/nav.html -A ../partials/book-tail.html \\
\t    -o ../docs/book.html
\tpandoc -f latex -t html5 --standalone \\
\t    --metadata title="The bishop and the presbyter, a question recorded" \\
\t    --css=style.css -A ../partials/book-tail.html \\
\t    -o ../docs/bishop-presbyter.html
logos:
\tpandoc -f latex -t docx --metadata title="Mere Catholicity" -o ../docs/Mere_Catholicity_Logos.docx
'''


class Books(unittest.TestCase):
    def test_every_root_pandoc_html_target_is_a_book_in_makefile_order(self):
        self.assertEqual(writings.books_from_makefile(MK), [
            ('/book.html', 'Mere Catholicity'),
            ('/bishop-presbyter.html', 'The bishop and the presbyter, a question recorded'),
        ])

    def test_a_docx_or_other_output_is_not_a_page(self):
        self.assertEqual(writings.books_from_makefile(
            'x:\n\tpandoc -t docx --metadata title="T" -o ../docs/T.docx\n'), [])

    def test_a_book_built_without_the_tail_partial_is_refused(self):
        """A switch for a page with no mount would do nothing — loudly, not quietly."""
        bad = MK.replace('--css=style.css -A ../partials/book-tail.html \\\n\t    -o ../docs/bishop-presbyter.html',
                         '--css=style.css -A ../partials/footer.html \\\n\t    -o ../docs/bishop-presbyter.html')
        with self.assertRaises(ValueError):
            writings.books_from_makefile(bad)

    def test_a_book_without_a_title_is_refused(self):
        with self.assertRaises(ValueError):
            writings.books_from_makefile('h:\n\tpandoc -A ../partials/book-tail.html -o ../docs/x.html\n')


class Articles(unittest.TestCase):
    def test_an_ordinary_page_needs_no_key(self):
        self.assertEqual(writings.article_from_source('credo.html', '---\ntitle: "Credo"\n---\n<p>x</p>\n'),
                         ('/credo.html', 'Credo'))
        self.assertEqual(writings.article_from_source('hours.md', '---\ntitle: The Hours\n---\nprose\n'),
                         ('/hours.html', 'The Hours'))

    def test_an_entity_in_the_title_is_decoded_for_the_console(self):
        self.assertEqual(writings.article_from_source('rosary.html', '---\ntitle: "The Rosary: Mary&rsquo;s Psalter"\n---\n<p>x</p>\n'),
                         ('/rosary.html', 'The Rosary: Mary\u2019s Psalter'))

    def test_comments_false_opts_out(self):
        self.assertIsNone(writings.article_from_source('terms.html', '---\ntitle: Terms\ncomments: false\n---\n<p>x</p>\n'))

    def test_comments_true_is_merely_redundant(self):
        self.assertEqual(writings.article_from_source('about.html', '---\ntitle: About\ncomments: true\n---\n<p>x</p>\n'),
                         ('/about.html', 'About'))

    def test_only_md_and_html_sources_count(self):
        self.assertIsNone(writings.article_from_source('notes.txt', '---\ntitle: T\n---\n'))

    def test_the_rule_is_content_pys_own(self):
        """content.py stamps the mount by carries_comments; the detector reads the
        same function, so a page can never be listed without its section."""
        self.assertTrue(content.carries_comments({}))
        self.assertTrue(content.carries_comments({'comments': True}))
        self.assertFalse(content.carries_comments({'comments': False}))
        self.assertTrue(content.carries_comments({'comments': 'no'}), 'only YAML false opts out')


class Rendering(unittest.TestCase):
    def test_module_is_deterministic_and_escaped(self):
        entries = [('/book.html', 'Say "hi" \\ there', 'book'), ('/a.html', 'A', 'article')]
        a = writings.render_module(entries)
        self.assertEqual(a, writings.render_module(entries))
        self.assertIn('module Domain.Writings (writings) where', a)
        self.assertIn('{ path: "/book.html", title: "Say \\"hi\\" \\\\ there", kind: "book" }', a)
        self.assertTrue(a.endswith('  ]\n'))

    def test_empty_list_is_valid_purescript(self):
        self.assertTrue(writings.render_module([]).endswith('writings =\n  []\n'))


class TheRealTree(unittest.TestCase):
    """The rule applied to this repository: the two books, the essays, and not
    the utility pages or anything from the library."""

    def test_detect(self):
        entries = writings.detect(ROOT)
        paths = {e[0]: e[2] for e in entries}
        self.assertEqual(paths.get('/book.html'), 'book')
        self.assertEqual(paths.get('/bishop-presbyter.html'), 'book')
        self.assertEqual(paths.get('/credo.html'), 'article')
        self.assertEqual(paths.get('/about.html'), 'article')
        for utility in ['/terms.html', '/privacy.html', '/library.html', '/resources.html', '/logos.html', '/hours.html']:
            self.assertNotIn(utility, paths, utility + ' opts out')
        self.assertNotIn('/anf01.html', paths, 'a library work is never ours')
        kinds = [e[2] for e in entries]
        self.assertEqual(kinds, sorted(kinds, key=lambda k: 0 if k == 'book' else 1), 'books first, then the articles')
        self.assertEqual([e[0] for e in entries], list(dict.fromkeys(e[0] for e in entries)), 'no path twice')


if __name__ == '__main__':
    unittest.main()
