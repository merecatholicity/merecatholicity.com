"""Invariants for the committed Tailwind build, docs/style.css.

The site's single stylesheet is compiled by `npm run build:css` (`make css`) from
the Tailwind v4 entry point styles/main.css into the committed, minified,
UNversioned docs/style.css that every page links. These tests read the
ALREADY-BUILT, committed file (they never rebuild — a unit test must not mutate a
tracked artifact) and lock the build's load-bearing choices so a regression that
would otherwise ship silently fails here instead.

The three things most likely to break silently, and what each test guards:

  * source(none) on the utilities import — Tailwind does NOT scan the ~250
    generated corpus pages for class names, so ordinary English words in the
    reading prose ("table", "block", "hidden") never mint spurious utility rules
    and the file stays small. Removing source(none) would balloon the file and
    emit those utilities. Guarded by the absence of `.table{` / `.block{` /
    `.hidden{` / `.flex{` / `.grid{` and by a byte-size ceiling.
  * Preflight is deliberately NOT imported — the site carries its own base reset
    (01-tokens.css / 04-base.css), and importing Preflight would reset the tuned
    reading typography across every generated page. Guarded by the absence of
    Preflight's signature rules.
  * the design tokens survive the build — the hand-authored, UNLAYERED CSS
    (tokens, .prose surface, components) is carried through verbatim. Guarded by
    the presence of the raw `--maroon` token, its light/dark values, and the
    hand-authored surfaces.

Every expected value below was read out of the real committed file (see the
inline notes); the assertions document ACTUAL behavior, not a wish.
"""

import pathlib
import re
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
BUILT = ROOT / "docs" / "style.css"          # committed, minified build output
ENTRY = ROOT / "styles" / "main.css"          # the Tailwind v4 CSS-first entry


def read(path):
    return path.read_text(encoding="utf-8")


class BuildOutputPresent(unittest.TestCase):
    """The committed artifacts we assert against actually exist and are non-trivial."""

    def test_built_stylesheet_exists(self):
        self.assertTrue(BUILT.is_file(), f"missing committed build output: {BUILT}")
        self.assertGreater(len(read(BUILT)), 10_000,
                           "style.css is suspiciously small — a broken/empty build?")

    def test_entry_source_exists(self):
        self.assertTrue(ENTRY.is_file(), f"missing Tailwind entry: {ENTRY}")


class VersionPin(unittest.TestCase):
    """The build header names the Tailwind version, so a silent major bump is visible."""

    def test_header_names_tailwind_v4(self):
        # docs/style.css opens with:
        #   /*! tailwindcss v4.3.3 | MIT License | https://tailwindcss.com */
        css = read(BUILT)
        self.assertIn("tailwindcss v4", css,
                      "expected a Tailwind v4 build header; a major-version bump changed it")

    def test_header_names_exact_pinned_version(self):
        # The exact version currently committed. If a deliberate upgrade lands,
        # this line is the one to update — which is the point: the bump is reviewed.
        css = read(BUILT)
        self.assertIn("tailwindcss v4.3.3", css)


class SourceNoneRegressionGuard(unittest.TestCase):
    """styles/main.css imports the utilities layer with source(none):

        @import "tailwindcss/utilities.css" layer(utilities) source(none);

    so Tailwind does NOT auto-scan content for class names. The generated reading
    corpus is full of English words that are also Tailwind utility names ("table",
    "block", "hidden", ...); without source(none) Tailwind would emit a rule for
    each. These tests fail if that scanning is ever re-enabled.
    """

    def setUp(self):
        self.css = read(BUILT)

    def test_entry_still_declares_source_none(self):
        # Lock the CAUSE too, so the guard below has a named reason. The utilities
        # import must carry source(none); dropping it is exactly the regression.
        entry = read(ENTRY)
        self.assertRegex(
            entry,
            r'@import\s+"tailwindcss/utilities\.css"\s+layer\(utilities\)\s+source\(none\)\s*;',
            "styles/main.css must import the utilities layer with source(none)",
        )

    def test_no_spurious_utility_rules_for_corpus_words(self):
        # Each of these is a real Tailwind utility whose class name is also a
        # common English word (or layout name) appearing throughout the prose.
        # With source(none) NONE of them is generated. The exact `.word{` form is
        # the minified utility rule; it cannot false-match the hand-authored
        # `.table-wrap{` / `.table-note{` (different next character).
        for utility in (".table{", ".block{", ".hidden{", ".flex{", ".grid{"):
            self.assertNotIn(
                utility, self.css,
                f"found generated utility rule {utility!r} — has source(none) been removed "
                "from the utilities import? Tailwind is scanning the corpus prose again.",
            )

    def test_hand_authored_table_classes_are_present(self):
        # Sanity floor for the check above: the file is NOT simply devoid of
        # everything table-shaped. The hand-authored .table-wrap / .table-note
        # classes DO ship — proving the absence of `.table{` is meaningful, not
        # an artifact of an empty stylesheet.
        self.assertIn(".table-wrap{", self.css)
        self.assertIn(".table-note{", self.css)

    def test_byte_size_stays_under_ceiling(self):
        # source(none) is what keeps the file small (~63 KB committed today).
        # Removing it — or otherwise letting utility generation balloon — would
        # blow well past this generous ceiling. This is a coarse tripwire, not a
        # pin: it has ~25 KB of headroom for ordinary hand-CSS growth.
        size = len(self.css)
        self.assertLess(
            size, 90_000,
            f"style.css grew to {size} bytes; a source(none) removal or a utility "
            "explosion is the usual cause of a jump this large.",
        )
        # Guard the other direction loosely too: it should not collapse tiny.
        self.assertGreater(size, 40_000, "style.css shrank unexpectedly — truncated build?")


class BrandTokensSurvive(unittest.TestCase):
    """The hand-authored, UNLAYERED design tokens are carried into the build verbatim.

    Note the asymmetry this documents: the RAW `--maroon` custom property (defined
    in the inlined 01-tokens.css :root block) ships, but the Tailwind @theme
    MAPPING `--color-maroon: var(--maroon)` does NOT — with source(none) no
    utility references it, so Tailwind tree-shakes the whole @theme color ramp out
    of the output. Both facts are locked below.
    """

    def setUp(self):
        self.css = read(BUILT)

    def test_raw_maroon_token_light_value(self):
        # From the :root light block: --maroon: #8b1a1a (minified, no spaces).
        self.assertIn("--maroon:#8b1a1a", self.css,
                      "the raw --maroon brand token (light value) did not survive the build")

    def test_raw_maroon_token_dark_override(self):
        # The dark theme lightens the accent for contrast: --maroon: #ef6b6b.
        # Its presence proves the theme-switching token blocks survived too.
        self.assertIn("--maroon:#ef6b6b", self.css,
                      "the dark-mode --maroon override did not survive the build")

    def test_dark_theme_selector_present(self):
        # The reader's explicit dark choice keys on this selector.
        self.assertIn("data-theme=dark", self.css)

    def test_theme_color_mapping_is_tree_shaken_out(self):
        # Consequence of source(none): because no bg-*/text-*/border-* utility is
        # generated, Tailwind emits NO --color-* @theme variables at all. If this
        # ever starts failing, an @source line has begun generating color
        # utilities — a deliberate build change, not a silent one.
        self.assertNotIn("--color-maroon", self.css,
                         "--color-maroon appeared: color utilities are now being generated "
                         "(an @source line was added). Review the build-size impact.")
        self.assertNotIn("--color-", self.css)

    def test_entry_defines_the_theme_mapping(self):
        # The mapping exists in SOURCE (so utilities *could* be turned on per
        # surface later); it is simply tree-shaken from the current output.
        entry = read(ENTRY)
        self.assertIn("--color-maroon: var(--maroon);", entry)


class NoPreflightLeak(unittest.TestCase):
    """Preflight is intentionally NOT imported (styles/main.css imports only the
    theme + utilities layers). These assert the absence of Preflight's most
    distinctive rules — signatures the site's own reset never emits, so their
    absence robustly proves Preflight stayed out.
    """

    def setUp(self):
        self.css = read(BUILT)

    def test_no_preflight_html_root_reset(self):
        # Preflight's html/:host rule sets these; the site's reset does not.
        self.assertNotIn("-webkit-text-size-adjust", self.css,
                         "a Preflight html-root reset leaked in")
        self.assertNotIn("tab-size:4", self.css,
                         "a Preflight tab-size reset leaked in")

    def test_no_preflight_button_appearance_reset(self):
        # Preflight normalizes button/input appearance with this grouped selector.
        self.assertNotIn("button,[type=button]", self.css,
                         "a Preflight button-appearance reset leaked in")

    def test_no_preflight_blockquote_figure_margin_reset(self):
        # Preflight zeroes margins on this grouped selector; the site keeps its own
        # reading margins on blockquote/figure, so this signature must be absent.
        self.assertNotIn("blockquote,figure", self.css,
                         "a Preflight margin reset leaked in")


class NoCompileDirectivesLeak(unittest.TestCase):
    """Tailwind at-rules are compile-time directives; none may survive into the
    served CSS (a browser cannot act on them). Their presence would mean the file
    is raw source, not the compiled artifact.
    """

    def setUp(self):
        self.css = read(BUILT)

    def test_no_unresolved_at_rules(self):
        for directive in ("@import", "@tailwind", "@source", "source(none)", "@apply"):
            self.assertNotIn(
                directive, self.css,
                f"unresolved {directive!r} in the built CSS — is docs/style.css the "
                "compiled output, or was raw source committed by mistake?",
            )

    def test_hand_authored_surfaces_are_present(self):
        # Positive floor: the compiled file DOES carry the hand-authored surfaces
        # (the .prose reading scope and the reception matrix), so the negatives
        # above are about compilation, not an empty/wrong file.
        self.assertIn(".prose ", self.css)
        self.assertIn("table.reception", self.css)


if __name__ == "__main__":
    unittest.main()
