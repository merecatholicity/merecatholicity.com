"""A volume is a shelf now — and the ways that would break without a word.

Ninety-one served pages were over a megabyte; `anf03.html` was 5.5 MB of HTML
and 56,425 elements. scripts/split_volumes.py serves each oversized volume as
an index over one page per treatise. Everything about that is a rewrite of
output nobody reads before it ships, so these are the rules that would fail in
silence:

  * An address that worked yesterday. Every deep link ever shared names the
    VOLUME, and merecat's citations are `<volume>.html#<anchor>` by
    construction. The index must still answer for every one of them.
  * The footnotes. Their numbers are literal in the text (`<sup>77</sup>`), so
    a part that takes a subset of the list and lets it renumber from 1
    misnumbers every note on the page — and a note cited by a division's own
    TITLE is the case that got away the first time (15 of them).
  * The canonical and the card. A part inherits the volume's <head>; ten
    thousand pages each claiming to be a copy of anf03.html would hand away
    exactly the standing the split was for.
  * Idempotence. `make html` runs over a tree the CI cache restored, so a
    volume already served as an index must be left alone — and a rebuilt one
    must lose the parts of the build before it.
"""
import json
import os
import re
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DOCS = os.path.join(ROOT, 'docs')
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
import split_volumes as m  # noqa: E402

HEAD = ('<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta name="generator" content="pandoc" />\n'
        '<title>A volume</title>\n'
        '<!--mc-card-->\n<meta property="og:url" content="https://merecatholicity.com/v.html">\n'
        '<!--/mc-card-->\n<link rel="canonical" href="https://merecatholicity.com/v.html">\n'
        '</head>\n<body>\n<main class="prose">\n'
        '<header id="title-block-header">\n<h1 class="title">A volume</h1>\n</header>\n')
TAIL = '</main>\n<footer>foot</footer>\n</body>\n</html>\n'


def volume(divisions, toc=True, notes=0, front='<p>Front matter.</p>\n'):
    """A pandoc-shaped volume: title block, contents, divisions, footnotes."""
    body = front
    entries = []
    for name, level, text in divisions:
        slug = re.sub(r'<[^>]+>', '', name).lower().replace(' ', '-')
        # pandoc strips a footnote mark out of its contents entry, as this does
        plain = re.sub(r'<[^>]+>', '', name)
        entries.append('<li><a href="#%s" id="toc-%s">%s</a></li>' % (slug, slug, plain))
        body += '<h%d class="unnumbered" id="%s">%s</h%d>\n%s' % (level, slug, name, level, text)
    nav = ''
    if toc:
        nav = '<nav id="TOC" role="doc-toc">\n<ul>\n' + '\n'.join(entries) + '\n</ul>\n</nav>\n'
    items = ''.join('<li id="fn%d"><p>Note %d.<a href="#fnref%d" class="footnote-back">↩︎</a></p></li>\n'
                    % (i, i, i) for i in range(1, notes + 1))
    foot = ''
    if notes:
        foot = ('<section id="footnotes" class="footnotes footnotes-end-of-document"\n'
                'role="doc-endnotes">\n<hr />\n<ol>\n' + items + '</ol>\n</section>\n')
    return HEAD + nav + body + foot + TAIL


def long_text(n):
    return ('<p>' + 'word ' * 60 + '</p>\n') * n


class WhatIsSplitAndHowDeep(unittest.TestCase):
    def test_a_volume_that_fits_is_left_whole(self):
        """The threshold is a size, not a shape: a short work served in one
        page is not improved by being served in four."""
        page = volume([('One', 1, '<p>a</p>\n'), ('Two', 1, '<p>b</p>\n')])
        self.assertLess(len(page), m.SPLIT_MIN)

    def test_the_cut_is_the_shallowest_level_whose_parts_fit(self):
        """plutarch.html is 68 lives and no subheadings; npnf108.html is one
        division and 153 subdivisions. One decreed depth would cut one of them
        wrongly, so the depth is chosen per volume."""
        page = m.Page(volume([('One', 1, long_text(3)), ('Two', 1, long_text(3))]))
        level, marks, spans = m.plan(page)
        self.assertEqual(level, 1)
        self.assertEqual(len(spans), 2)

    def test_a_division_too_long_for_one_page_is_cut_again(self):
        """Against Marcion is 1.3 MB inside a 5.5 MB volume: without a second
        cut the split leaves seventeen pages over a megabyte."""
        big = ''.join('<h4 id="c%d">Chapter %d</h4>\n%s' % (i, i, long_text(400))
                      for i in range(1, 8))
        page = m.Page(volume([('One', 1, big), ('Two', 1, long_text(3))]))
        got = m.split('v.html', volume([('One', 1, big), ('Two', 1, long_text(3))]))
        self.assertIsNotNone(got)
        _, parts, entry, _ = got
        self.assertGreater(len(parts), 3, 'the long division was not cut again')
        self.assertTrue(any(p['group'] for p in entry['parts']),
                        'a sub-part must name the division it belongs to')
        del page

    def test_a_group_heading_with_no_text_opens_the_page_that_follows_it(self):
        """'Apologetic.' is a name over a group of treatises, not a page: a
        part that says one word and nothing else is not a page anyone wants."""
        page = volume([('Group', 1, ''), ('Work', 2, long_text(200)),
                       ('Other', 2, long_text(200))])
        got = m.split('v.html', page)
        self.assertIsNotNone(got)
        _, parts, entry, _ = got
        self.assertEqual([p['title'] for p in entry['parts']], ['Group', 'Other'])
        self.assertIn('Work', parts[0][1], 'the group heading swallowed its first work')


class NothingEverLinkedMayBreak(unittest.TestCase):
    def setUp(self):
        self.page = volume([('One', 1, long_text(120) + '<h4 id="deep">Deep</h4>\n<p>x</p>\n'),
                            ('Two', 1, long_text(120))])
        self.got = m.split('v.html', self.page)
        self.index, self.parts, self.entry, self.amap = self.got

    def test_a_contents_entry_wears_the_id_it_links_to(self):
        """`v.html#one` must still resolve — for the link checker, for a reader
        with no JavaScript, and as the hop deeplink.js reads. Pandoc's own
        `toc-` prefix is what made room for it, at no cost in bytes."""
        self.assertIn('id="one"', self.index)
        self.assertNotIn('id="toc-one"', self.index)
        self.assertIn('href="v-one.html"', self.index)

    def test_the_anchor_map_names_every_heading_in_the_volume(self):
        """The ids below the contents — a chapter, a paragraph of deeplink's
        own ¶ — are the ones a reader is most likely to have shared."""
        self.assertIn('deep', self.amap['ids'])
        for i, n in self.amap['ids'].items():
            self.assertLess(n, len(self.amap['files']), i + ': no such part')

    def test_the_map_is_a_file_and_not_ten_thousand_stubs(self):
        """Measured: the stub form was 124 KB of a 134 KB index — a Father's
        chapter ids are whole sentences. An index that carries them all is the
        megabyte page again under another name."""
        self.assertIn('data-anchors="v-anchors.json"', self.index)
        self.assertLess(len(self.index), 20000)

    def test_a_reference_into_another_part_is_rewritten(self):
        page = volume([('One', 1, '<p><a href="#two">see</a></p>\n' + long_text(120)),
                       ('Two', 1, long_text(120))])
        _, parts, _, _ = m.split('v.html', page)
        self.assertIn('href="v-two.html#two"', parts[0][1])

    def test_a_reference_inside_the_part_is_left_exactly_as_it_was(self):
        page = volume([('One', 1, '<p><a href="#deep">see</a></p>\n<h4 id="deep">D</h4>\n'
                       + long_text(120)), ('Two', 1, long_text(120))])
        _, parts, _, _ = m.split('v.html', page)
        self.assertIn('href="#deep"', parts[0][1])


class TheFootnotes(unittest.TestCase):
    def test_a_note_follows_its_reference_and_keeps_its_number(self):
        """The superscript in the text is literal. A subset list renumbered
        from 1 misnumbers every note on the page, and nothing says so."""
        ref = '<p>Text<a href="#fn7" class="footnote-ref" id="fnref7"><sup>7</sup></a></p>\n'
        page = volume([('One', 1, long_text(120)), ('Two', 1, ref + long_text(120))], notes=9)
        _, parts, _, _ = m.split('v.html', page)
        two = parts[1][1]
        self.assertIn('<li value="7" id="fn7">', two)
        self.assertNotIn('id="fn6"', two, 'a note nothing on this page cites came along')
        self.assertNotIn('id="fn7"', parts[0][1])

    def test_a_footnote_whose_tag_wraps_a_line_is_still_a_footnote(self):
        """`<li\\nid="fn3517">` is what pandoc writes when the line is long,
        and a pattern that demanded a space found 3,523 of npnf114's notes and
        missed the rest. Fifteen marks on the built site pointed at nothing,
        and only the link checker said so."""
        ref = '<p>T<a href="#fn2" class="footnote-ref" id="fnref2"><sup>2</sup></a></p>\n'
        page = volume([('One', 1, long_text(120)), ('Two', 1, ref + long_text(120))], notes=3)
        page = page.replace('<li id="fn2">', '<li\nid="fn2">')
        _, parts, _, _ = m.split('v.html', page)
        self.assertIn('<li value="2" id="fn2">', parts[1][1])

    def test_a_note_cited_by_the_division_s_own_title_comes_with_it(self):
        """The heading travels into the title block, and the first cut left its
        notes behind: fifteen marks pointing at nothing, found by the link
        checker and by nothing else."""
        page = volume([('One', 1, long_text(120)),
                       ('Two<a href="#fn3" class="footnote-ref" id="fnref3"><sup>3</sup></a>',
                        1, long_text(120))], notes=5)
        _, parts, _, _ = m.split('v.html', page)
        self.assertIn('<li value="3" id="fn3">', parts[1][1])


class WhateverPandocCallsIt(unittest.TestCase):
    def test_the_footnotes_block_is_found_under_either_tag(self):
        """The dev box's pandoc writes <section id="footnotes">; the runner's
        writes <aside>. Knowing only one of them found no notes at all, moved
        none into the parts, and left 358,049 marks pointing at nothing — the
        CI link check was the first and only thing that said so."""
        ref = '<p>T<a href="#fn1" class="footnote-ref" id="fnref1"><sup>1</sup></a></p>\n'
        page = volume([('One', 1, ref + long_text(120)), ('Two', 1, long_text(120))], notes=2)
        page = page.replace('<section id="footnotes"', '<aside id="footnotes"')
        page = page.replace('</section>', '</aside>')
        _, parts, _, _ = m.split('v.html', page)
        self.assertIn('<aside id="footnotes"', parts[0][1])
        self.assertIn('</aside>', parts[0][1])
        self.assertIn('<li value="1" id="fn1">', parts[0][1])

    def test_a_volume_it_cannot_serve_whole_is_left_whole(self):
        """THE safety valve. Every rewrite here is invisible until a reader
        clicks, so each part is asked whether it can answer its own references
        before anything is written. An oversized page is a disappointment; a
        page of dead links is a lie."""
        page = volume([('One', 1, '<p><a href="#ghost">nowhere</a></p>\n' + long_text(120)),
                       ('Two', 1, long_text(120))])
        self.assertIsNone(m.split('v.html', page))

    def test_an_id_that_stays_on_the_index_is_reachable_from_a_part(self):
        """The front matter does not travel: a part pointing at it must be sent
        back to the volume, not left with a fragment it cannot answer."""
        page = volume([('One', 1, '<p><a href="#front-note">above</a></p>\n' + long_text(120)),
                       ('Two', 1, long_text(120))],
                      front='<h4 id="front-note">A note</h4>\n<p>Front matter.</p>\n')
        got = m.split('v.html', page)
        self.assertIsNotNone(got)
        self.assertIn('href="v.html#front-note"', got[1][0][1])


class APartIsItsOwnPage(unittest.TestCase):
    def setUp(self):
        page = volume([('One', 1, long_text(120)), ('Two', 1, long_text(120))])
        self.index, self.parts, self.entry, _ = m.split('v.html', page)

    def test_a_part_does_not_claim_the_volume_s_address(self):
        """Ten thousand pages each telling a search engine they are a copy of
        anf03.html is the opposite of what the split is for."""
        for name, text in self.parts:
            self.assertNotIn('rel="canonical"', text, name)

    def test_a_part_does_not_wear_the_volume_s_share_card(self):
        for name, text in self.parts:
            self.assertNotIn('<!--mc-card-->', text, name)

    def test_a_part_is_titled_by_its_division_and_placed_by_its_volume(self):
        self.assertIn('<title>One — A volume</title>', self.parts[0][1])

    def test_a_part_carries_the_way_back_and_the_way_on(self):
        """At the head, where a reader arriving from search needs to know where
        they are, and at the foot, where one who has finished needs what is
        next — and OUTSIDE the title block, which the app shell hides."""
        first = self.parts[0][1]
        self.assertEqual(first.count('class="mc-partnav'), 2)
        self.assertIn('rel="next"', first)
        self.assertNotIn('rel="prev"', first)
        self.assertIn('rel="prev"', self.parts[1][1])
        self.assertLess(first.index('</header>'), first.index('mc-partnav'))

    def test_a_part_says_which_volume_it_belongs_to_in_its_own_bytes(self):
        """The mark is how a later run knows a page is a part rather than a
        volume — read from the WHOLE file, because the anti-flash script and
        the card put it several kilobytes down and a 4 KB sniff found nothing."""
        for n, (name, text) in enumerate(self.parts, 1):
            mk = m.PART_MARK_RE.search(text)
            self.assertIsNotNone(mk, name)
            self.assertEqual(mk.group(1), 'v.html')
            self.assertEqual(int(mk.group(2)), n)


class ASecondBuildFindsWhatTheFirstMade(unittest.TestCase):
    """`make html` runs over a tree the CI cache restored, so the SECOND run is
    the ordinary one and the first is the exception."""

    def setUp(self):
        import tempfile
        self.dir = tempfile.mkdtemp()
        self.docs, self.manifest = m.DOCS, m.MANIFEST
        m.DOCS = self.dir
        m.MANIFEST = os.path.join(self.dir, 'library-parts.json')
        big = ''.join('<h4 id="c%d">Chapter %d</h4>\n%s' % (i, i, long_text(400))
                      for i in range(1, 8))
        with open(os.path.join(self.dir, 'v.html'), 'w', encoding='utf-8') as f:
            f.write(volume([('One', 1, big), ('Two', 1, long_text(200))]))

    def tearDown(self):
        import shutil
        shutil.rmtree(self.dir, ignore_errors=True)
        m.DOCS, m.MANIFEST = self.docs, self.manifest

    def read_manifest(self):
        with open(m.MANIFEST, encoding='utf-8') as f:
            return json.load(f)

    def test_the_manifest_survives_a_build_that_finds_the_tree_already_split(self):
        """An index is 10 KB — smaller than the threshold that made it. A run
        that looked for volumes BY SIZE never saw one again and wrote an empty
        manifest, which is inject_social's card formula and the librarian's
        source list gone in one line of output nobody reads."""
        m.main([])
        first = self.read_manifest()
        self.assertIn('v.html', first['volumes'])
        m.main([])
        second = self.read_manifest()
        self.assertEqual(sorted(second['parts']), sorted(first['parts']))
        self.assertEqual(second['volumes']['v.html']['title'],
                         first['volumes']['v.html']['title'])

    def test_a_sub_part_still_names_its_division_on_the_second_run(self):
        """The group rides IN THE PART'S MARK, because the manifest is rebuilt
        from the pages and there is nowhere else for it to come from."""
        m.main([])
        m.main([])
        groups = {v['group'] for v in self.read_manifest()['parts'].values() if v['group']}
        self.assertTrue(groups, 'every sub-part forgot which division it belongs to')


class TheBuiltTree(unittest.TestCase):
    """The sweep, over whatever the build actually wrote."""

    @classmethod
    def setUpClass(cls):
        try:
            with open(os.path.join(DOCS, 'library-parts.json'), encoding='utf-8') as f:
                cls.manifest = json.load(f)
        except (OSError, ValueError):
            raise unittest.SkipTest('the corpus has not been split here')
        if not cls.manifest.get('parts'):
            raise unittest.SkipTest('the corpus has not been split here')

    def test_every_part_in_the_manifest_is_a_page_on_disk(self):
        missing = [f for f in self.manifest['parts'] if not os.path.exists(os.path.join(DOCS, f))]
        self.assertEqual(missing[:10], [])

    def test_every_volume_is_an_index_and_names_its_anchor_map(self):
        for vol in self.manifest['volumes']:
            with open(os.path.join(DOCS, vol), encoding='utf-8') as f:
                html = f.read()
            self.assertIn(m.SPLIT_MARK, html, vol)
            self.assertIn('data-anchors="' + vol[:-5] + '-anchors.json"', html, vol)
            self.assertTrue(os.path.exists(os.path.join(DOCS, vol[:-5] + '-anchors.json')), vol)

    def test_no_volume_is_still_a_megabyte(self):
        """The measurement the whole change exists for."""
        big = [v for v in self.manifest['volumes']
               if os.path.getsize(os.path.join(DOCS, v)) > m.SPLIT_MIN]
        self.assertEqual(big, [], 'volumes that were split and are still oversized')

    def test_the_parts_of_a_volume_are_a_chain(self):
        """n of M, in order, each numbered once: the prev/next a reader walks."""
        for vol, entry in self.manifest['volumes'].items():
            seen = [self.manifest['parts'][p['file']]['n'] for p in entry['parts']]
            self.assertEqual(seen, list(range(1, len(entry['parts']) + 1)), vol)

    def test_an_anchor_map_points_at_parts_that_exist(self):
        for vol in sorted(self.manifest['volumes'])[:20]:
            with open(os.path.join(DOCS, vol[:-5] + '-anchors.json'), encoding='utf-8') as f:
                amap = json.load(f)
            for f2 in amap['files']:
                self.assertTrue(os.path.exists(os.path.join(DOCS, f2)), vol + ' -> ' + f2)
            self.assertTrue(amap['ids'], vol + ': an empty anchor map')


if __name__ == '__main__':
    unittest.main()
