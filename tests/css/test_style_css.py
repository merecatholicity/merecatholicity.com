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
        # source(none) is what keeps the file small. Removing it — or otherwise
        # letting utility generation balloon — would blow well past this ceiling:
        # Tailwind scanning ~250 pages of corpus prose adds TENS of KB, so the
        # tripwire stays decisive with plenty of room for hand-CSS.
        #
        # The number tracks reality and has been raised deliberately as the
        # hand-authored CSS grew (the original comment said "~63 KB today" long
        # after the file had passed 89 KB — a stale ceiling comment is how a
        # tripwire quietly turns into a nuisance). 2026-09-06: 91.5 KB after the
        # perceived-speed block (skeletons + tap feedback), ceiling 110 KB.
        size = len(self.css)
        self.assertLess(
            size, 110_000,
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


class SheetOwnsTheScroll(unittest.TestCase):
    """While a sheet is open, the sheet is the only thing that scrolls (2026-09-09).

    The live report, on phones: scrolling the Settings sheet sometimes scrolled
    the page behind it. The source rules are held by tests/js/sheet_lock.test.mjs;
    this class proves the BUILD carries them, since a Tailwind/Lightning pass
    that dropped or rewrote them would ship the bug back silently.
    """

    def setUp(self):
        self.css = read(BUILT)

    def test_document_lock_rule_survives(self):
        self.assertRegex(self.css, r"html\.mc-sheet-open body\{[^}]*position:fixed",
                         "the html.mc-sheet-open body lock did not survive the build")

    def test_sheet_contains_its_overscroll(self):
        # two sheet blocks (phone + desktop) and the desktop account menu: three
        self.assertGreaterEqual(self.css.count("overscroll-behavior:contain"), 3,
                                "overscroll-behavior: contain is missing from a sheet or menu rule")

    def test_scrim_is_inert_to_touch(self):
        self.assertRegex(self.css, r"\.mc-sheet-scrim\{[^}]*touch-action:none",
                         "the scrim lost touch-action: none in the build")


class DmBubbleIsTheMount(unittest.TestCase):
    """The DM bubble (2026-09-10) is the box the reaction pill and the hover ⌄ hang
    from — both absolutely positioned by the injected DM stylesheet, so the base
    card in main.css must be position: relative or they land in the page."""

    def setUp(self):
        self.css = read(BUILT)

    def test_dm_bubble_is_position_relative(self):
        self.assertRegex(self.css, r"\.dm-msg\{[^}]*position:relative",
                         "the .dm-msg card lost position:relative in the build")

    def test_dm_body_has_no_top_margin(self):
        # No author line since 2026-09-10: the body opens the bubble.
        self.assertRegex(self.css, r"\.dm-msg \.comment-body\{margin-top:0\}")


class SentAndReceivedReadApart(unittest.TestCase):
    """DM bubbles (2026-09-11): mine on the surface tinted with the palette's own
    accent by color-mix, theirs on the neutral surface — so every palette gets a
    distinct, sane pair. The tint rules must survive the build, light and dark."""

    def setUp(self):
        self.css = read(BUILT)

    PALETTES = {
        # selector prefix as the minifier writes it → the pair that block defines
        ':root{': ('#efdfdf', '#af8673'),                                     # paper
        ':root[data-theme=dark]{': ('#442c2f', '#694549'),                    # charcoal
        ':root[data-theme=dark][data-dark=slate]{': ('#412b31', '#654249'),
        ':root[data-theme=dark][data-dark=ink]{': ('#482b27', '#6f443e'),
        ':root[data-theme=light][data-light=mist]{': ('#efdfdf', '#beacb2'),
        ':root[data-theme=light][data-light=sepia]{': ('#ebd6c9', '#be9679'),
    }

    def test_the_light_phone_red_fill_is_retired(self):
        # 2026-09-11: "a harsh red against the white" — light phones take the
        # palette-tinted bubble like everywhere else, with the palette's inks
        self.assertNotRegex(self.css, r"data-theme=light\] \.dm-msg\.dm-mine\{[^}]*background:var\(--accent-fill\)")
        self.assertNotRegex(self.css, r"data-theme=light\] \.dm-msg\.dm-mine[^{]*\{[^}]*color:#fff")

    def test_an_unread_inbox_row_draws_the_eye(self):
        self.assertRegex(self.css, r"\.board-topic\.dm-row-unread\{[^}]*border-left:3px solid var\(--maroon\)")
        self.assertRegex(self.css, r"\.dm-unread-badge\{[^}]*background:var\(--maroon\)")

    def test_every_palette_defines_its_sent_bubble_pair(self):
        for prefix, (bg, rule) in self.PALETTES.items():
            i = self.css.find(prefix)
            self.assertGreater(i, -1, "palette block missing: " + prefix)
            block = self.css[i:self.css.find('}', i)]
            self.assertIn('--bubble-mine:' + bg, block, prefix + ' lost its --bubble-mine')
            self.assertIn('--bubble-mine-rule:' + rule, block, prefix + ' lost its --bubble-mine-rule')

    def test_mine_reads_the_tokens_never_color_mix(self):
        # the minifier writes a color-mix fallback from its FIRST color, which
        # would paint a bubble solid maroon in a browser without color-mix
        self.assertRegex(self.css, r"\.dm-msg\.dm-mine\{[^}]*background:var\(--bubble-mine,var\(--cream\)\)")
        self.assertNotRegex(self.css, r"\.dm-msg\.dm-mine\{[^}]*color-mix")

    def test_theirs_stays_neutral(self):
        self.assertRegex(self.css, r"\.dm-msg\{[^}]*background:var\(--surface\)")
        self.assertRegex(self.css, r"\.dm-msg:not\(\.dm-mine\)\{[^}]*background:var\(--cream-2\)")

    def test_the_librarian_takes_the_same_pair(self):
        self.assertRegex(self.css, r"\.merecat-log \.merecat-msg\.you\{[^}]*background:var\(--bubble-mine,var\(--cream\)\)")


class PhonesShowNoFooterAndAboutIsADialog(unittest.TestCase):
    """Phones show no footer except on the home tab (2026-09-11): the footer's
    information lives in Settings → About, a themed dialog that keeps the
    overlay's three layers. Both must survive the build."""

    def setUp(self):
        self.css = read(BUILT)

    def test_phone_footer_rule_survives(self):
        self.assertRegex(self.css, r'body\.mc-app:not\(\[data-mc-tab="?home"?\]\) mc-footer\{display:none\}',
                         "the phone rule hiding mc-footer off the home tab did not survive the build")

    def test_desktop_footer_base_rule_survives(self):
        self.assertIn("mc-footer{display:block}", self.css)

    def test_dialog_scrim_is_inert_and_contained(self):
        self.assertRegex(self.css, r"\.mc-dialog-scrim\{[^}]*touch-action:none")
        self.assertRegex(self.css, r"\.mc-dialog-scrim\{[^}]*overscroll-behavior:contain")
        self.assertRegex(self.css, r"\.mc-dialog\{[^}]*user-select:text")


class NothingScrollsSideways(unittest.TestCase):
    """No page pans sideways on a phone (2026-09-09).

    The owner's report: many pages — the Bible, the articles — scrolled
    horizontally in the installed app. html{overflow-x:hidden} stops a
    scrollbar, not iOS's panning of an over-wide body. A phone-width sweep of
    the built site found three sources, each fixed at its root in
    styles/main.css; this class proves the build carries the fixes.
    """

    def setUp(self):
        self.css = read(BUILT)

    def test_body_clips_sideways_and_pads_by_variable(self):
        # the net under everything, and the padding the edge-to-edge rule mirrors
        body = re.search(r"(?:^|})body\{([^}]*)}", self.css)
        self.assertIsNotNone(body, "no body rule in the build")
        self.assertIn("overflow-x:clip", body.group(1), "the body no longer clips horizontal overflow")
        self.assertIn("--page-pad:1rem", body.group(1), "the body's inline padding is no longer a variable")
        self.assertIn("padding:1.25rem var(--page-pad) 3rem", body.group(1))
        self.assertIn("--page-pad:.8rem", self.css, "the phone override of --page-pad is gone")

    def test_edge_to_edge_article_pulls_out_by_the_body_padding(self):
        # was a hard -1rem against a 0.8rem phone padding: 3px of sideways scroll on every article
        self.assertIn("margin-inline:calc(-1 * var(--page-pad))", self.css,
                      "the art-backed article must pull out by the body's OWN padding, not a guess")
        self.assertNotRegex(self.css, r"main\.prose[^{]*\{[^}]*margin-inline:-1rem",
                            "the hard -1rem edge-to-edge margin is back")

    def test_reading_column_breaks_unbreakable_runs(self):
        # dotted leaders, run-together Greek, rows of '=', a ratio string: all wider than a phone
        self.assertRegex(self.css, r"main\.prose\{[^}]*overflow-wrap:break-word",
                         "main.prose must carry overflow-wrap:break-word (inherited by every paragraph and footnote)")

    def test_bible_bar_wraps_and_the_find_box_shrinks(self):
        self.assertRegex(self.css, r"\.bible-bar\{[^}]*flex-wrap:wrap", "the Bible bar must wrap")
        self.assertRegex(self.css, r"\.bp-row\{[^}]*flex-wrap:wrap", "the player row must wrap")
        find = re.search(r"\.bible-find\{([^}]*)}", self.css)
        self.assertIsNotNone(find, "no .bible-find rule in the build")
        self.assertIn("max-width:100%", find.group(1))
        self.assertIn("flex:", find.group(1), "the find box must be allowed to shrink")
        # and the reader's own injected copy of the rule agrees (it is injected
        # later and wins on equal specificity)
        reader = read(ROOT / "docs" / "bible-reader.js")
        self.assertRegex(reader, r"\.bible-find\{[^}]*flex:1 1 11em;max-width:100%",
                         "docs/bible-reader.js injects a .bible-find rule that no longer lets it shrink")


class AHoldPicksAMessageNeverAWord(unittest.TestCase):
    """On a phone (2026-09-11) the app bar and the tab bar are never selectable
    text: iOS anchors a long-press selection in the nearest selectable text, so
    a hold on a DM bubble beside them would seed a selection there and extend
    it. The chat screen's own rule rides the DM client's injected block
    (tests/js/dm_actions.test.mjs); this is the stylesheet's half."""

    def setUp(self):
        self.css = read(BUILT)

    def test_phone_chrome_is_not_selectable_under_hover_none(self):
        self.assertRegex(self.css, r"\(hover:\s*none\)[^{]*\{[^}]*\.mc-appbar,\s*mc-tabbar,\s*\.mc-tabbar\{[^}]*user-select:none",
                         "the app bar / tab bar lost their user-select:none under (hover: none)")


class SixEqualTabsInTheBottomBar(unittest.TestCase):
    """The bottom bar is six equal tabs (2026-09-11, the owner's ask): Community
    is no longer a raised hero, and no tab may steal its neighbours' width.

    What breaks silently: `flex: 1` alone keeps the default `min-width: auto`, so
    the longest label ("Community", 61px) refuses to shrink and the bar goes
    crooked on a narrow phone — 61px against 49px at a 320px device width, with
    nothing red anywhere. The label must also never wrap: a second line breaks
    the bar's fixed height."""

    def setUp(self):
        self.css = read(BUILT)

    def test_every_tab_is_an_equal_slot_that_may_shrink(self):
        tab = re.search(r"\.mc-tab\{([^}]*)}", self.css)
        self.assertIsNotNone(tab, "no .mc-tab rule in the build")
        self.assertIn("flex:1 1 0", tab.group(1), "the tabs must share the bar equally, from a zero basis")
        self.assertIn("min-width:0", tab.group(1), "without this the widest label eats its neighbours' width")

    def test_the_label_scales_and_never_wraps(self):
        lbl = re.search(r"\.mc-tab-lbl\{([^}]*)}", self.css)
        self.assertIsNotNone(lbl, "no .mc-tab-lbl rule in the build")
        self.assertIn("white-space:nowrap", lbl.group(1))
        self.assertIn("text-overflow:ellipsis", lbl.group(1), "clip the longest word, never wrap it")
        self.assertRegex(self.css, r"\.mc-tab\{[^}]*font-size:clamp\(",
                         "the label size must follow the viewport so it fits the slot on a narrow phone")

    def test_the_raised_hero_is_gone(self):
        self.assertNotIn("mc-tab-hero", self.css,
                         "the raised centre hero came back — six equal tabs is the rule")


if __name__ == "__main__":
    unittest.main()
