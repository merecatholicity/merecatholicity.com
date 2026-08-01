#!/usr/bin/env python3
"""Unit tests for the shared PURE text helpers in the resources/ converters.

These are the small, high-fanout functions the LaTeX converters lean on
everywhere: two different TeX escapers, the heading title-caser, the
cp1252-mojibake repair, pandoc-output cleanup, the Greek/Hebrew-wrapping
finalizer, and the roman-numeral restorer. Each assertion below was derived
by reading the source and running the function, so the tests document what
the code ACTUALLY does (including a couple of subtleties a reader would
otherwise miss).

Covered:
  ccel2tex.esc        - TeX escaper that ALSO remaps U+00A0 (nbsp) -> '~'
  ccel2tex._titlecase - heading title-case with small-word lowering
  docs2tex.esc_tex    - a DIFFERENT TeX escaper (no space remapping)
  docs2tex.fix_mojibake - undoes cp1252-as-utf8 double encoding
  docs2tex.clean      - strips pandoc center-rules, collapses blank lines
  catena2tex.finalize - NFC + debris drop + \\textgreek/\\texthebrew wrapping
  stj2tex.fix_romans  - restores 'Viii' -> 'VIII', leaves real words alone
"""

import pathlib
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'resources'))

import ccel2tex   # noqa: E402
import docs2tex   # noqa: E402
import catena2tex  # noqa: E402
import stj2tex    # noqa: E402


class CcelEsc(unittest.TestCase):
    """ccel2tex.esc: the escaper used across many of the converters. It maps
    each char through TEX_SPECIALS, leaving anything not in the table alone."""

    def test_tex_specials_are_escaped(self):
        """A percent and an ampersand become their backslash-escaped forms."""
        self.assertEqual(ccel2tex.esc('50%'), r'50\%')
        self.assertEqual(ccel2tex.esc('A&B'), r'A\&B')
        self.assertEqual(ccel2tex.esc('a_b'), r'a\_b')

    def test_plain_ascii_word_is_unchanged(self):
        """No special chars means the text passes through verbatim."""
        self.assertEqual(ccel2tex.esc('Hello'), 'Hello')

    def test_plain_ascii_space_is_left_alone(self):
        """The ' ' key in TEX_SPECIALS is NOT a plain space -- an ordinary
        ASCII space (U+0020) is not in the table, so it passes through."""
        self.assertEqual(ccel2tex.esc('a b'), 'a b')

    def test_nonbreaking_space_is_remapped_to_tilde(self):
        """The char that maps to '~' is the NON-BREAKING space (U+00A0), the
        LaTeX unbreakable-space token. This is the 'space -> ~' rule, and it
        is specifically the nbsp, not the ASCII space above."""
        nbsp = ' '
        self.assertEqual(ccel2tex.TEX_SPECIALS.get(nbsp), '~')
        self.assertEqual(ccel2tex.esc('a' + nbsp + 'b'), 'a~b')


class CcelTitlecase(unittest.TestCase):
    """ccel2tex._titlecase: capitalize each word but lowercase the small
    words (of/the/and/...) -- except never lowercase the very first word."""

    def test_lowercases_small_words_but_capitalizes_significant_ones(self):
        self.assertEqual(ccel2tex._titlecase('THE CITY OF GOD'),
                         'The City of God')

    def test_first_word_is_always_capitalized_even_if_a_small_word(self):
        """'of' is a small word, but as word 0 it is still capitalized."""
        self.assertEqual(ccel2tex._titlecase('of mice and men'),
                         'Of Mice and Men')


class DocsEscTex(unittest.TestCase):
    """docs2tex.esc_tex: a DIFFERENT escaper from ccel2tex.esc. Same TeX
    specials, but its map has NO space/nbsp entry, so spacing is untouched."""

    def test_tex_specials_are_escaped(self):
        self.assertEqual(docs2tex.esc_tex('50%'), r'50\%')
        self.assertEqual(docs2tex.esc_tex('A&B'), r'A\&B')

    def test_plain_word_unchanged(self):
        self.assertEqual(docs2tex.esc_tex('Hello'), 'Hello')

    def test_normal_space_is_preserved(self):
        """Contrast ccel2tex.esc: esc_tex leaves an ordinary space alone."""
        self.assertEqual(docs2tex.esc_tex('a b'), 'a b')

    def test_nonbreaking_space_is_also_preserved(self):
        """And unlike ccel2tex.esc, esc_tex does NOT remap the nbsp either --
        it has no space entry at all in its table."""
        nbsp = ' '
        self.assertEqual(docs2tex.esc_tex('a' + nbsp + 'b'), 'a' + nbsp + 'b')


class DocsFixMojibake(unittest.TestCase):
    """docs2tex.fix_mojibake: repairs text whose utf-8 bytes were read as
    cp1252 (the classic 'Cæsar' -> 'CÃ¦sar' corruption). It re-encodes the
    string as cp1252 and decodes as utf-8, or gives up unchanged if that
    round-trip is impossible."""

    def test_repairs_double_encoded_latin1_text(self):
        """The mangled 'CÃ¦sar' is repaired back to 'Cæsar'."""
        mangled = 'CÃ¦sar'          # the literal CÃ¦sar sequence
        # sanity: this really is 'Cæsar' round-tripped through the bad decode
        self.assertEqual('Cæsar'.encode('utf-8').decode('cp1252'),
                         mangled)
        self.assertEqual(docs2tex.fix_mojibake(mangled), 'Cæsar')

    def test_plain_ascii_is_returned_unchanged(self):
        """Text with no high bytes has nothing to repair and passes through."""
        self.assertEqual(docs2tex.fix_mojibake('Hello world'), 'Hello world')


class DocsClean(unittest.TestCase):
    """docs2tex.clean: post-pandoc tidy -- drop the center-rule pandoc emits
    for a horizontal rule, squeeze 3+ blank lines to one, strip, trailing \\n."""

    def test_strips_pandoc_center_rule(self):
        """A `\\begin{center}\\rule{..}{..}\\end{center}` block is removed."""
        tex = r'A\begin{center}\rule{0.5\linewidth}{0.5pt}\end{center}B'
        self.assertEqual(docs2tex.clean(tex), 'AB\n')

    def test_collapses_runs_of_blank_lines_and_adds_trailing_newline(self):
        """Four blank lines collapse to a single blank line; output ends \\n."""
        self.assertEqual(docs2tex.clean('x\n\n\n\n\ny'), 'x\n\ny\n')

    def test_strips_surrounding_whitespace(self):
        self.assertEqual(docs2tex.clean('   hi   '), 'hi\n')


class CatenaFinalize(unittest.TestCase):
    """catena2tex.finalize: NFC-normalize, drop bidi controls and orphan
    combining marks the LGR path cannot set, then wrap each Greek run in
    \\textgreek{...} and each Hebrew run in \\texthebrew{...}."""

    def test_greek_run_is_wrapped(self):
        """A Greek word is enclosed in a single \\textgreek macro."""
        self.assertEqual(catena2tex.finalize('λόγος'),
                         '\\textgreek{λόγος}')

    def test_greek_run_keeps_internal_spacing_but_not_trailing_period(self):
        """The run spans letters + internal spaces/punct; a trailing '.'
        (which cannot END a run) stays OUTSIDE the wrap."""
        # 'ὁ λόγος.' -> \textgreek{ὁ λόγος}.
        out = catena2tex.finalize('ὁ λόγος.')
        self.assertEqual(out, '\\textgreek{ὁ λόγος}.')

    def test_hebrew_run_is_wrapped(self):
        """A Hebrew run gets \\texthebrew; surrounding Latin stays put."""
        out = catena2tex.finalize('word שלום')
        self.assertEqual(out, 'word \\texthebrew{שלום}')

    def test_plain_latin_text_is_left_alone(self):
        """No Greek or Hebrew -> no macros inserted."""
        self.assertEqual(catena2tex.finalize('Hello world'), 'Hello world')

    def test_nfc_composition_is_applied(self):
        """A decomposed base+combining-acute is composed to a single char.
        Because NFC runs BEFORE the combining-mark drop, the accent survives
        (composed into 'é') rather than being stripped as orphan debris."""
        decomposed = 'é'                 # 'e' + COMBINING ACUTE ACCENT
        self.assertEqual(len(decomposed), 2)
        result = catena2tex.finalize(decomposed)
        self.assertEqual(result, 'é')     # 'é', one code point
        self.assertEqual(len(result), 1)

    def test_orphan_combining_mark_is_dropped(self):
        """A combining mark with no base to compose onto is removed (it is in
        the U+0300-036F range the LGR path cannot render)."""
        orphan = 'x ̀y'                    # combining grave after a space
        self.assertEqual(catena2tex.finalize(orphan), 'x y')

    def test_bidi_control_is_stripped(self):
        """A stray directional-formatting control (LRM) is deleted."""
        self.assertEqual(catena2tex.finalize('a‎b'), 'ab')


class StjFixRomans(unittest.TestCase):
    """stj2tex.fix_romans: after _titlecase folds 'BOOK VIII' to 'Book Viii',
    restore the tokens that are genuine multi-letter roman numerals to upper
    case, while leaving ordinary words that merely resemble numerals alone."""

    def test_restores_a_title_cased_roman_numeral(self):
        """'Viii' is a valid roman numeral (VIII) -> uppercased."""
        self.assertEqual(stj2tex.fix_romans('Book Viii'), 'Book VIII')

    def test_restores_two_letter_numeral(self):
        self.assertEqual(stj2tex.fix_romans('Ii'), 'II')

    def test_restores_numeral_embedded_in_a_heading(self):
        self.assertEqual(stj2tex.fix_romans('Chapter Xiv'), 'Chapter XIV')

    def test_leaves_real_words_that_look_roman_ish_alone(self):
        """'Mix', 'Did', 'Civil' are made of roman-numeral letters but are
        not valid numerals, so the strict regex leaves them as words."""
        self.assertEqual(stj2tex.fix_romans('Mix'), 'Mix')
        self.assertEqual(stj2tex.fix_romans('Did'), 'Did')
        self.assertEqual(stj2tex.fix_romans('Civil'), 'Civil')

    def test_single_letter_tokens_are_not_touched(self):
        """The regex requires two or more letters, so a lone 'I' (e.g. the
        pronoun) is never mistaken for a numeral."""
        self.assertEqual(stj2tex.fix_romans('I am here'), 'I am here')


if __name__ == '__main__':
    unittest.main()
