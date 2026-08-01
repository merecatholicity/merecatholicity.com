#!/usr/bin/env python3
"""Unit tests for scripts/content.py :: split_frontmatter.

content.py builds the hand-authored content pages from single source files
that open with a YAML frontmatter block. split_frontmatter is the one PURE
function in that module — it peels the leading `---\\n … \\n---\\n` block off a
source and hands back (parsed_frontmatter_dict, remaining_body). Everything
else in content.py shells out to pandoc or reads files, so only this splitter
is unit-testable, and these tests document exactly what it does.

The contract, read straight from the source:
    if not text.startswith('---\\n'): return {}, text
    end = text.find('\\n---\\n', 4)
    if end == -1: raise ValueError('unterminated frontmatter')
    fm = yaml.safe_load(text[4:end]) or {}
    return fm, text[end + 5:]
"""

import pathlib
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))

import content  # noqa: E402


class SplitFrontmatterValidBlock(unittest.TestCase):
    """A document that opens with a proper `---` YAML fence."""

    def test_parses_keys_and_returns_body_after_closing_fence(self):
        """The YAML between the fences becomes a dict; the text after the
        closing `---\\n` is returned verbatim as the body."""
        text = (
            '---\n'
            'title: Credo\n'
            'canon: One holy Church\n'
            'description: A page\n'
            'comments: true\n'
            '---\n'
            'The body starts here.\n'
            '\n'
            'Second paragraph.\n'
        )
        fm, body = content.split_frontmatter(text)

        # every frontmatter key is parsed with its YAML-typed value
        self.assertEqual(fm, {
            'title': 'Credo',
            'canon': 'One holy Church',
            'description': 'A page',
            'comments': True,          # YAML `true` -> Python bool, not a string
        })
        # the body is exactly what follows the closing fence — blank lines and
        # trailing newline preserved, nothing stripped
        self.assertEqual(body, 'The body starts here.\n\nSecond paragraph.\n')

    def test_body_may_contain_later_triple_dash_lines(self):
        """Only the FIRST closing fence ends the frontmatter; a later `---`
        in the prose (e.g. a markdown horizontal rule) stays in the body."""
        text = (
            '---\n'
            'title: X\n'
            '---\n'
            'intro\n'
            '---\n'
            'not frontmatter, a horizontal rule\n'
        )
        fm, body = content.split_frontmatter(text)
        self.assertEqual(fm, {'title': 'X'})
        self.assertEqual(body, 'intro\n---\nnot frontmatter, a horizontal rule\n')

    def test_frontmatter_parsing_to_none_yields_empty_dict(self):
        """An empty frontmatter block makes yaml.safe_load return None; the
        `or {}` guard turns that into an empty dict (never None)."""
        text = '---\n\n---\nbody after empty fm'
        fm, body = content.split_frontmatter(text)
        self.assertEqual(fm, {})
        self.assertEqual(body, 'body after empty fm')


class SplitFrontmatterNoFrontmatter(unittest.TestCase):
    """A document with no leading `---\\n` fence is returned untouched."""

    def test_plain_text_returns_empty_dict_and_original_text(self):
        """No opening fence -> ({}, original_text). Verified against the
        source: the early `return {}, text` returns the SAME string object."""
        text = 'No frontmatter at all.\nJust prose.\n'
        fm, body = content.split_frontmatter(text)
        self.assertEqual(fm, {})
        self.assertEqual(body, text)
        # it hands back the identical object, not a copy — no parsing happened
        self.assertIs(body, text)

    def test_opening_fence_must_be_exactly_triple_dash_newline(self):
        """The guard is `startswith('---\\n')`, so a trailing space, a fourth
        dash, or a `---` not at position 0 all count as NO frontmatter."""
        for text in (
            '--- \ntitle: X\n---\nbody',     # trailing space after the dashes
            '----\ntitle: X\n---\nbody',     # four dashes, not three
            'lead\n---\ntitle: X\n---\nbody',  # fence not at the very start
        ):
            with self.subTest(text=text[:8]):
                fm, body = content.split_frontmatter(text)
                self.assertEqual(fm, {})
                self.assertIs(body, text)


class SplitFrontmatterUnterminated(unittest.TestCase):
    """An opening fence with no matching closing fence is an error."""

    def test_missing_closing_fence_raises_value_error(self):
        """Opening `---\\n` but never a `\\n---\\n` after it raises
        ValueError('unterminated frontmatter')."""
        text = '---\ntitle: Broken\nno closing fence here\n'
        with self.assertRaises(ValueError) as caught:
            content.split_frontmatter(text)
        self.assertEqual(str(caught.exception), 'unterminated frontmatter')


if __name__ == '__main__':
    unittest.main()
