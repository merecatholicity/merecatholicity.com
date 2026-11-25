"""The press's RSS feed tells a subscriber when a book goes ON SALE (owner, 2026-11-24).

A title is on sale when it has its paperback's Amazon page (`amazon`) and the date it went on
sale (`released`), always both or neither. `press/scripts/build.ts` feeds only those titles,
dated by `released`, so a coming-soon book enters the feed the week it can be bought. Every
featured slug (the carousel) names a title that exists. See docs/architecture/log/2026-11.md.
"""
import json
import re
import unittest
from pathlib import Path

PRESS = Path(__file__).resolve().parents[2] / "press"
TITLES = json.loads((PRESS / "content/titles.json").read_text(encoding="utf-8"))
PRESS_JSON = json.loads((PRESS / "content/press.json").read_text(encoding="utf-8"))
BUILD = (PRESS / "scripts/build.ts").read_text(encoding="utf-8")


class PressFeed(unittest.TestCase):
    def test_on_sale_has_both_link_and_date(self):
        for t in TITLES:
            self.assertEqual(bool(t.get("amazon")), bool(t.get("released")),
                             f"{t['slug']}: `amazon` and `released` go together")
            if t.get("released"):
                self.assertRegex(t["released"], r"^\d{4}-\d{2}-\d{2}$", t["slug"])

    def test_featured_titles_exist(self):
        slugs = {t["slug"] for t in TITLES}
        for s in PRESS_JSON["featured"]:
            self.assertIn(s, slugs, f"featured {s!r} is not in titles.json")

    def test_feed_carries_only_titles_on_sale(self):
        self.assertRegex(BUILD, r"const onSale = titles\.filter\(t => t\.amazon && t\.released\)")
        self.assertIn("${onSale.map(item).join", BUILD)
        self.assertNotIn("${titles.map(item)", BUILD)
        self.assertIn("<pubDate>${rfc822(t.released!)}</pubDate>", BUILD)
        self.assertTrue(re.search(r'<guid isPermaLink="false">\$\{link\}#available</guid>', BUILD))


if __name__ == "__main__":
    unittest.main()
