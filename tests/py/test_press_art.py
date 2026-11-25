"""The press's painting turns through merecatholicity.com's paintings (owner, 2026-11-24).

`press/src/art.ts` names each painting; a name without its two files under `press/static/art/`
(`-d` for a desktop, `-m` for a phone) would fail in silence, a blank fade every lap. Augustine
leads, because the stylesheet draws it before any script runs.
"""
import re
import unittest
from pathlib import Path

PRESS = Path(__file__).resolve().parents[2] / "press"
ART = (PRESS / "src/art.ts").read_text(encoding="utf-8")


class PressArt(unittest.TestCase):
    def test_every_painting_has_both_files(self):
        block = re.search(r"const PAINTINGS[^=]*=\s*\[(.*?)\];", ART, re.S).group(1)
        names = re.findall(r'\["([a-z-]+)",\s*(?:true|false)\]', block)
        self.assertGreater(len(names), 1)
        self.assertEqual(names[0], "augustine", "Augustine leads: the stylesheet draws it first")
        self.assertEqual(len(names), len(set(names)))
        for n in names:
            for size in ("d", "m"):
                self.assertTrue((PRESS / f"static/art/{n}-{size}.webp").is_file(), f"{n}-{size}.webp")


if __name__ == "__main__":
    unittest.main()
