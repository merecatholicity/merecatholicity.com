#!/usr/bin/env python3
"""Guards that every page in docs/ is reachable from somewhere.

`docs/` is the served folder: anything committed there is published at the
domain root, whether or not the site ever links to it. A stray page is
therefore not inert — it is live, indexable, and ages badly, because nothing
rebuilds or reviews a file no page points at.

That is not hypothetical either. `docs/_libfix.html` was a CSS scratch fixture
committed by accident in `a1e0ca9` while the Library cards were being styled.
It sat at merecatholicity.com/_libfix.html serving a stub with dead `href="#"`
links until it was found and removed on 2026-09-05. Nothing caught it: it is
valid HTML, it links nowhere, so linkcheck had no broken target to report.

This test fails when a page in docs/ is referenced by no other page, by no
build script, and is not on the small exemption list below.

SCOPE: HTML pages only. Non-HTML assets (emoji packs, preset avatars, the
Bible JSON, PDFs) are frequently referenced only from JavaScript that builds
URLs at runtime, so a reference scan cannot decide them without false alarms.
Pages are the case that is reliably decidable, and the case that actually bit.
"""
import re
import pathlib
import unittest
from functools import lru_cache

ROOT = pathlib.Path(__file__).resolve().parents[2]
DOCS = ROOT / "docs"

# Pages that are unreachable BY DESIGN and must stay that way.
EXEMPT_EXACT = set()
EXEMPT_PREFIX = (
    "google",   # Search Console verification tokens: fetched directly by
                # Google at a known path, never linked. Linking one would be
                # the bug.
)

# Where a page may earn its keep: any other page, the sitemap, the generated
# catalogs, and the build/runtime sources that name pages in code.
SCAN_DIRS = ("docs", "scripts", "partials", "app", "client")

# The two built bundles are skipped: they are minified megabytes whose page
# references all come from app/**.ts and client/comments.ts, which ARE scanned.
# Reading them here doubled the test's runtime and added nothing.
BUILT = {"app.js", "comments.js"}

HREF = re.compile(r'(?:href|src)="([^"#?]+)"')
BARE = re.compile(r'([A-Za-z0-9._-]+\.html)')


@lru_cache(maxsize=1)
def _referenced():
    """Every .html basename named anywhere the site or its build can reach."""
    seen = set()
    for d in SCAN_DIRS:
        base = ROOT / d
        if not base.is_dir():
            continue
        for path in base.rglob("*"):
            if not path.is_file() or path.suffix not in (
                    ".html", ".xml", ".json", ".py", ".ts", ".js", ".css"):
                continue
            if path.name in BUILT:
                continue
            try:
                text = path.read_text(encoding="utf-8", errors="ignore")
            except OSError:
                continue
            here = path.name
            for m in HREF.finditer(text):
                target = m.group(1).split("/")[-1]
                if target.endswith(".html") and target != here:
                    seen.add(target)
            # Pages named in code (nav.py's PAGES, routes, redirects) carry no
            # href; a bare filename literal counts, but never the file's own.
            if path.suffix in (".py", ".ts", ".js"):
                for m in BARE.finditer(text):
                    if m.group(1) != here:
                        seen.add(m.group(1))
    return seen


def _pages():
    return sorted(p.name for p in DOCS.glob("*.html"))


class DocsHasNoOrphans(unittest.TestCase):

    def test_every_page_is_referenced_somewhere(self):
        refs = _referenced()
        orphans = [n for n in _pages()
                   if n not in refs
                   and n not in EXEMPT_EXACT
                   and not n.startswith(EXEMPT_PREFIX)]
        self.assertEqual(
            orphans, [],
            "unreferenced page(s) in docs/ — link them, or delete them, or "
            "add them to EXEMPT_* with the reason: %s" % orphans)

    def test_the_scan_actually_sees_the_site(self):
        """Anti-vacuum guard: if the reference scan silently collected nothing
        (a moved directory, a changed suffix list), the check above would pass
        while proving nothing — the same shape as the bug it guards."""
        self.assertGreater(len(_referenced()), 100)
        self.assertGreater(len(_pages()), 250)

    def test_the_exempt_pages_still_exist(self):
        """An exemption for a page that is gone is dead weight; drop it."""
        names = set(_pages())
        for n in EXEMPT_EXACT:
            self.assertIn(n, names, "stale exemption: %s" % n)


if __name__ == "__main__":
    unittest.main(verbosity=2)
