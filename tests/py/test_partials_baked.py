#!/usr/bin/env python3
"""Guards that the BUILT pages still agree with the partials they were built from.

`partials/footer.html` is pandoc's `-A` include: its text is baked into every
generated page at build time, so editing the partial changes nothing that is
already on disk until `make html` regenerates the corpus. Nothing else in the
repo notices the gap — a stale page is valid HTML, every link in it resolves,
so `make check` passes and no unit test is any the wiser.

That is not hypothetical. The Privacy link was added to the footer partial in
`6ca88bd`; the ~236 generated corpus pages were not rebuilt behind it, and the
whole library — Fathers, Schaff, Newman, the classics, the Summa — served a
footer the partial had stopped describing for over a month, until a full
rebuild on 2026-09-05 surfaced it as a 236-file diff.

These tests close that hole: they compare the partial on disk against the text
actually baked into `docs/`, so the next such drift fails `make tests` in the
same change that causes it, instead of waiting to be noticed.

The pages are read as bytes and compared literally — the partial's own entities
(`&middot;`, `&amp;`) survive pandoc verbatim, so an exact substring match is
the right test and is what the build actually produces.
"""
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
DOCS = ROOT / "docs"
FOOTER_PARTIAL = ROOT / "partials" / "footer.html"

# Pages that legitimately carry no site chrome, and so are exempt:
#   google*.html  — a Search Console verification token, must stay bare.
#   _libfix.html  — an orphan markup fragment referenced by nothing.
EXEMPT = {"_libfix.html"}


def _partial_lines():
    """The two visible lines of partials/footer.html: the foot-nav paragraph
    and the `merecatholicity.com · Terms · Privacy` tail. Structural lines
    (`</main>`, `<footer>`, `</footer>`) are skipped — they are not identity."""
    out = []
    for line in FOOTER_PARTIAL.read_text(encoding="utf-8").splitlines():
        s = line.strip()
        if s and s not in ("</main>", "<footer>", "</footer>"):
            out.append(s)
    return out


def _pages():
    """Every built page, minus the exempt ones."""
    return [p for p in sorted(DOCS.glob("*.html"))
            if p.name not in EXEMPT and not p.name.startswith("google")]


class FooterPartialShape(unittest.TestCase):
    """The partial is the source of truth; confirm it looks like we think."""

    def test_partial_has_exactly_two_visible_lines(self):
        lines = _partial_lines()
        self.assertEqual(len(lines), 2, lines)
        self.assertIn('class="foot-nav"', lines[0])
        self.assertTrue(lines[1].startswith("merecatholicity.com"), lines[1])

    def test_partial_carries_the_five_foot_nav_destinations(self):
        """The no-JS visitor's only navigation. Losing one is a silent regression."""
        nav_line = _partial_lines()[0]
        for dest in ("index.html", "library.html", "community.html",
                     "about.html", "contact.html"):
            self.assertIn('href="%s"' % dest, nav_line)


class BakedFooterMatchesPartial(unittest.TestCase):
    """Every page carrying the footer must carry the CURRENT partial's text."""

    def test_every_page_with_a_foot_nav_matches_the_partial_line(self):
        nav_line = _partial_lines()[0]
        stale = [p.name for p in _pages()
                 if b'class="foot-nav"' in p.read_bytes()
                 and nav_line.encode("utf-8") not in p.read_bytes()]
        self.assertEqual(stale, [], "stale foot-nav — run `make html`: %s" % stale[:10])

    def test_every_page_with_a_footer_tail_matches_the_partial_line(self):
        """The line that actually drifted: the Terms/Privacy tail."""
        tail = _partial_lines()[1].encode("utf-8")
        marker = b"merecatholicity.com &middot;"
        stale = [p.name for p in _pages()
                 if marker in p.read_bytes() and tail not in p.read_bytes()]
        self.assertEqual(stale, [], "stale footer tail — run `make html`: %s" % stale[:10])

    def test_the_corpus_is_actually_covered(self):
        """The anti-vacuum guard, and the point of the whole file.

        Both checks above iterate the pages that HAVE a footer; if that set were
        ever empty — a renamed class, a changed marker — they would pass while
        proving nothing, which is the exact shape of the bug they exist to catch.
        The real corpus is ~270 pages, so hold a floor well under that but far
        above zero."""
        with_footer = [p.name for p in _pages()
                       if b'class="foot-nav"' in p.read_bytes()]
        self.assertGreater(len(with_footer), 250, len(with_footer))


if __name__ == "__main__":
    unittest.main(verbosity=2)
