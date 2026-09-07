"""The launch splash lives in the inline head script (scripts/inject_social.py),
which runs before the stylesheet and before <body> exists. It is the first thing
anyone sees, and it is drawn OVER the app — so the only properties worth locking
are the ones that decide whether a bad launch is recoverable.

A splash that fails to clear is worse than no splash at all: it hides a working
app behind a picture. These tests hold the three things that make that
impossible, and check the generated script is real JavaScript rather than a
string that merely looks like it.
"""
import re
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
import inject_social as m  # noqa: E402

SCRIPT = m.FLASH_SCRIPT
JS = SCRIPT[len('<script id="mc-fout">'):-len('</script>')]


class SplashSafety(unittest.TestCase):
    def test_it_is_valid_javascript(self):
        """It is assembled from Python string fragments, so a stray quote would
        ship a syntax error into every one of ~272 pages, before anything else
        runs. `node --check` is the only honest way to know."""
        tmp = ROOT / 'scripts' / '.boot-syntax-check.js'
        tmp.write_text(JS)
        try:
            r = subprocess.run(['node', '--check', str(tmp)],
                               capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stderr[:400])
        finally:
            tmp.unlink(missing_ok=True)

    def test_there_is_an_unconditional_deadline(self):
        """The splash must clear even if the app never boots — a broken bundle
        must never leave a reader looking at a launch screen forever."""
        self.assertIn('age<500||(!ready&&age<2200)', JS,
                      'the hard cap on the splash is gone or was rewritten')
        self.assertIn("e.classList.remove('mc-splash','mc-splash-out')", JS)

    def test_a_throw_also_clears_it(self):
        """If anything inside the tick throws, the catch must take the splash
        down rather than leaving it standing."""
        catch = JS[JS.index('}catch(z3)'):]
        self.assertIn('clearInterval(iv)', catch)
        self.assertIn("remove('mc-splash','mc-splash-out')", catch)

    def test_it_can_never_trap_the_reader(self):
        """Belt and braces for the case all three of the above fail: the
        pseudo-elements take no pointer events, so a stuck splash costs the
        reader a view of the app, never the use of it."""
        self.assertEqual(m.SPLASH_CSS.count('pointer-events:none'), 2,
                         'both splash pseudo-elements must be pointer-events:none')

    def test_a_fast_launch_does_not_flash_it(self):
        """Shown and hidden inside a few frames is worse than not shown."""
        self.assertIn('age<500', JS)


class SplashShape(unittest.TestCase):
    def test_home_only(self):
        """start_url is Home, so Home is every launch of the installed app.
        Landing anywhere else is a resume, where a splash would be wrong."""
        self.assertIn("home=(p==='/'||p===''||p.slice(-11)==='/index.html')", JS)
        self.assertIn("if(a&&home){e.classList.add('mc-home-boot');e.classList.add('mc-splash');", JS)

    def test_it_respects_the_app_opt_out(self):
        """?app=0 readers get the plain website, splash included."""
        self.assertIn("a=localStorage.getItem('mc-app')!=='0'", JS)

    def test_it_carries_its_own_reduced_motion_guard(self):
        """style.css has a global guard, but it may not have arrived yet."""
        self.assertIn('prefers-reduced-motion:reduce', m.SPLASH_CSS)

    def test_both_themes_are_painted(self):
        """No paintable moment may be the wrong colour — the whole reason this
        script is inline in the first place."""
        self.assertIn('#0f1113', m.SPLASH_CSS)
        self.assertIn('html.mc-splash[data-theme=light]::before', m.SPLASH_CSS)

    def test_every_served_page_carries_the_current_script(self):
        """inject_social replaces a stale copy in place; a page left behind
        would boot with the previous launch behaviour."""
        pages = list((ROOT / 'docs').glob('*.html'))
        self.assertGreater(len(pages), 200, 'the served tree looks wrong')
        stale = [p.name for p in pages
                 if (mm := re.search(r'<script id="mc-fout">.*?</script>',
                                     p.read_text(encoding='utf-8', errors='replace'), re.S))
                 and mm.group(0) != SCRIPT]
        self.assertEqual(stale, [], 'run `python scripts/inject_social.py`')


if __name__ == '__main__':
    unittest.main()
