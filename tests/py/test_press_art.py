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
    def test_every_ring_has_both_files(self):
        """Each ring a shelf may turn to (Lérins America's and Lérins Reformation's, 2026-11-26) is
        held to the same rule, and its first painting is the stylesheet's."""
        css = (PRESS / "src/press.css").read_text(encoding="utf-8")
        for ring in ("AMERICA", "REFORMATION", "CLASSICS"):
            block = re.search(rf"const {ring}[^=]*=\s*\[(.*?)\];", ART, re.S).group(1)
            names = re.findall(r'\["([a-z-]+)",\s*(?:true|false)\]', block)
            self.assertGreater(len(names), 1, ring)
            for n in names:
                for size in ("d", "m"):
                    self.assertTrue((PRESS / f"static/art/{n}-{size}.webp").is_file(), f"{n}-{size}.webp")
            self.assertIn(f"/art/{names[0]}-m.webp", css)
            self.assertIn(f"/art/{names[0]}-d.webp", css)
        # the corner paintings, outside the rings: America's sky, Geneva's Wall, Cugat's Eyes (2026-11-26)
        for corner in ("am-sky", "geneva", "cl-eyes"):
            for size in ("d", "m"):
                self.assertTrue((PRESS / f"static/art/{corner}-{size}.webp").is_file())
                self.assertIn(f"/art/{corner}-{size}.webp", css)

    def test_every_painting_keeps_its_feather(self):
        """The feather is baked into each painting's alpha, never a CSS mask (press.css), so a
        recompression that drops it fails in silence: the Deësis Christ lost its feather to one
        (2026-11-26, #97) and stood in the corner of All as a hard-edged block on every screen.
        A lossy WebP keeps its alpha in an ALPH chunk; a solid opaque plane compresses to under
        100 bytes, every feathered painting's to over 3,500. No decoder needed."""
        for p in sorted((PRESS / "static/art").glob("*.webp")):
            chunks, b, i = {}, p.read_bytes(), 12
            self.assertEqual((b[:4], b[8:12]), (b"RIFF", b"WEBP"), p.name)
            while i + 8 <= len(b):
                n = int.from_bytes(b[i + 4:i + 8], "little")
                chunks[b[i:i + 4]] = n
                i += 8 + n + (n & 1)
            if b"VP8L" in chunks:   # lossless: the alpha rides inside the image data
                continue
            self.assertGreater(chunks.get(b"ALPH", 0), 1000,
                               f"{p.name}: no feathered alpha (opaque, or its alpha dropped)")

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
