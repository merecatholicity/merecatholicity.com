#!/usr/bin/env python3
"""Unit tests for scripts/nav.py — the site-navigation generator.

These tests document and guard the PURE building blocks of the menu
generator (parse_item / render_leaf / render_sub) and the load-bearing
NAV_ENABLED flag that keeps the whole horizontal menu as intentionally
dead code. Every expected value here was read out of the source and
confirmed by running the functions, so the assertions describe ACTUAL
behavior rather than a guess.
"""
import sys
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))

import nav  # noqa: E402


class ParseItemTests(unittest.TestCase):
    """parse_item(item) -> (title, kind, payload, col) for one nav.yml entry."""

    def test_string_value_is_a_leaf(self):
        """{"Title": "x.html"} classifies as a leaf whose payload is the dest string."""
        title, kind, payload, col = nav.parse_item({"Home": "index.html"})
        self.assertEqual(title, "Home")
        self.assertEqual(kind, "leaf")
        self.assertEqual(payload, "index.html")
        self.assertEqual(col, 1)  # default column when none is given

    def test_list_value_is_a_submenu(self):
        """A list value is a submenu; the payload is the children list verbatim."""
        children = [{"A": "a.html"}]
        title, kind, payload, col = nav.parse_item({"Papers": children})
        self.assertEqual(title, "Papers")
        self.assertEqual(kind, "sub")
        self.assertEqual(payload, children)
        self.assertEqual(col, 1)

    def test_leaf_and_submenu_are_classified_differently(self):
        """The 'kind' discriminant is what tells a leaf apart from a submenu."""
        _, leaf_kind, _, _ = nav.parse_item({"Home": "index.html"})
        _, sub_kind, _, _ = nav.parse_item({"Papers": [{"A": "a.html"}]})
        self.assertEqual(leaf_kind, "leaf")
        self.assertEqual(sub_kind, "sub")
        self.assertNotEqual(leaf_kind, sub_kind)

    def test_dict_with_items_is_a_submenu_and_reads_col(self):
        """A dict value carrying 'items' is a submenu; 'col' is parsed as an int."""
        title, kind, payload, col = nav.parse_item(
            {"Papers": {"col": 2, "items": [{"A": "a.html"}]}}
        )
        self.assertEqual(title, "Papers")
        self.assertEqual(kind, "sub")
        self.assertEqual(payload, [{"A": "a.html"}])
        self.assertEqual(col, 2)

    def test_dict_with_dest_is_a_leaf_and_reads_col(self):
        """A dict value carrying 'dest' is a leaf; 'col' rides along on the tuple."""
        title, kind, payload, col = nav.parse_item({"X": {"dest": "x.html", "col": 3}})
        self.assertEqual(title, "X")
        self.assertEqual(kind, "leaf")
        self.assertEqual(payload, "x.html")
        self.assertEqual(col, 3)

    def test_non_single_pair_dict_exits(self):
        """Each entry must be exactly one 'Title: value' pair — anything else aborts."""
        with self.assertRaises(SystemExit):
            nav.parse_item({"a": 1, "b": 2})

    def test_non_dict_entry_exits(self):
        """A bare (non-dict) entry is malformed and aborts the build."""
        with self.assertRaises(SystemExit):
            nav.parse_item("not-a-dict")

    def test_dict_value_without_dest_or_items_exits(self):
        """A dict value must carry 'dest' or 'items'; neither one aborts the build."""
        with self.assertRaises(SystemExit):
            nav.parse_item({"X": {"foo": "bar"}})


class RenderLeafTests(unittest.TestCase):
    """render_leaf(title, dest) -> a one-element list[str] of <li>…</li> markup."""

    def test_returns_single_element_list(self):
        """The renderer returns a list (so callers can .extend it), of length one."""
        out = nav.render_leaf("Home", "index.html")
        self.assertIsInstance(out, list)
        self.assertEqual(len(out), 1)

    def test_normal_leaf_is_an_anchor(self):
        """A normal leaf renders an <a href=…> inside an <li>."""
        self.assertEqual(
            nav.render_leaf("Home", "index.html"),
            ['<li><a href="index.html">Home</a></li>'],
        )

    def test_title_is_html_escaped(self):
        """The title text is HTML-escaped so '&' cannot break the markup."""
        self.assertEqual(
            nav.render_leaf("Tom & Jerry", "a.html"),
            ['<li><a href="a.html">Tom &amp; Jerry</a></li>'],
        )

    def test_dest_is_attribute_escaped(self):
        """The dest is escaped for an attribute context (quote=True), so '&' -> '&amp;'."""
        self.assertEqual(
            nav.render_leaf("Q", "a.html?x=1&y=2"),
            ['<li><a href="a.html?x=1&amp;y=2">Q</a></li>'],
        )

    def test_soon_dest_renders_a_placeholder_span_not_a_link(self):
        """dest == 'soon' emits a non-clickable 'coming soon' span instead of an anchor."""
        self.assertEqual(
            nav.render_leaf("Later", "soon"),
            ['<li><span class="soon" title="coming soon">Later</span></li>'],
        )

    def test_soon_is_matched_case_and_whitespace_insensitively(self):
        """'soon' is recognized after .strip().lower(), so ' SOON ' also matches."""
        self.assertEqual(
            nav.render_leaf("Later", " SOON "),
            ['<li><span class="soon" title="coming soon">Later</span></li>'],
        )


class RenderSubTests(unittest.TestCase):
    """render_sub(title, children) -> list[str] grouping children into columns."""

    def test_returns_list_with_expected_shell(self):
        """A submenu opens has-sub/sub-toggle and includes the shared Back row."""
        out = nav.render_sub("Papers", [{"A": "a.html"}])
        self.assertIsInstance(out, list)
        self.assertEqual(out[0], '<li class="has-sub">')
        self.assertIn(nav.BACK_ROW, out)
        # The toggle button carries the (escaped) title.
        self.assertTrue(any('class="sub-toggle"' in line and "Papers" in line for line in out))

    def test_children_group_into_columns_by_col_key(self):
        """Children bucket by 'col'; each bucket becomes one <ul class="sub-col">,
        columns emitted in ascending col order, items kept in source order."""
        children = [
            {"A": {"dest": "a.html", "col": 1}},
            {"B": {"dest": "b.html", "col": 2}},
            {"C": {"dest": "c.html", "col": 1}},
        ]
        out = nav.render_sub("Papers", children)

        # Exactly two column wrappers (col 1 and col 2).
        self.assertEqual(out.count('<ul class="sub-col">'), 2)

        # Column 1 holds A then C (source order); column 2 holds B — and column 1
        # is emitted before column 2 (sorted(cols)).
        a = out.index('<li><a href="a.html">A</a></li>')
        c = out.index('<li><a href="c.html">C</a></li>')
        b = out.index('<li><a href="b.html">B</a></li>')
        self.assertLess(a, c)   # A before C within the same column
        self.assertLess(c, b)   # column 1 (A,C) entirely before column 2 (B)

    def test_single_column_when_no_col_given(self):
        """With no explicit col, every child lands in the default column 1 -> one sub-col."""
        out = nav.render_sub("Papers", [{"A": "a.html"}, {"B": "b.html"}])
        self.assertEqual(out.count('<ul class="sub-col">'), 1)


class BuildNavFlagTests(unittest.TestCase):
    """build_nav(items) branches on the module-global NAV_ENABLED flag."""

    def test_default_flag_is_disabled(self):
        """The horizontal menu ships DISABLED — this is the intended dead-code state."""
        self.assertFalse(nav.NAV_ENABLED)

    def test_disabled_branch_emits_only_the_soft_nav_anchor(self):
        """With NAV_ENABLED False, build_nav returns exactly the nav.js script anchor
        (the soft-nav content hook), with a trailing newline and no menu markup."""
        out = nav.build_nav([{"Home": "index.html"}, {"Papers": [{"A": "a.html"}]}])
        self.assertEqual(out, '<script defer src="nav.js"></script>\n')

    def test_enabled_branch_emits_the_full_menu_markup(self):
        """Flipping NAV_ENABLED True revives the real <nav class="site"> menu.
        We save/restore the flag so the module stays in its shipped state."""
        saved = nav.NAV_ENABLED
        try:
            nav.NAV_ENABLED = True
            out = nav.build_nav([{"Home": "index.html"}, {"Papers": [{"A": "a.html"}]}])
        finally:
            nav.NAV_ENABLED = saved

        self.assertFalse(nav.NAV_ENABLED)  # restored
        # The enabled branch produces the whole menu skeleton...
        self.assertIn('<nav class="site">', out)
        self.assertIn('id="nav-list"', out)
        self.assertIn(nav.TOGGLE, out)
        # ...with the leaf and submenu rendered inside it...
        self.assertIn('<li><a href="index.html">Home</a></li>', out)
        self.assertIn('class="sub-toggle"', out)
        # ...and still carries the soft-nav script anchor at the tail.
        self.assertIn('<script defer src="nav.js"></script>', out)


class PagesConstantTests(unittest.TestCase):
    """PAGES is the list of hand-authored pages whose nav block nav.py rewrites."""

    def test_pages_is_a_list(self):
        self.assertIsInstance(nav.PAGES, list)

    def test_known_stable_pages_are_present(self):
        """The home page and the forum SPA are deliberately owned by nav.py, not content.py."""
        self.assertIn("index.html", nav.PAGES)
        self.assertIn("community.html", nav.PAGES)

    def test_pages_are_all_html_and_unique(self):
        """Every rewritten page is an .html file, listed once."""
        self.assertTrue(all(p.endswith(".html") for p in nav.PAGES))
        self.assertEqual(len(nav.PAGES), len(set(nav.PAGES)))


if __name__ == "__main__":
    unittest.main()
