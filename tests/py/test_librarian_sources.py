"""The librarian must be able to find the shelf it claims to have read.

The failure this locks down ran silently for six weeks. `librarian/works.yml`
addresses the public works relative to the repo root — `../book.html`,
`../credo.html` — because that is where the built site lived when the manifest
was last edited, on 2026-07-29. The docs/ reorg moved every built page into
`docs/` the following day and nothing updated the manifest.

257 of 288 sources stopped resolving. Nothing failed: `ingest.py` skipped each
one with a mild "waiting (source not yet built)", which is a real and ordinary
state (the Newman corpus genuinely arrived that way), and a skipped work is
never pruned — so the old chunks stayed in D1 and merecat went on answering
from a frozen copy of the entire public shelf, the site's own writings
included, which its persona ranks above everything else.

Two rules come out of that, and both are tested here: sources must resolve, and
a manifest that mostly does not resolve must be an ERROR rather than a quiet
report.
"""
import os
import subprocess
import sys
import tempfile
import shutil
import unittest

import yaml

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
LIB = os.path.join(ROOT, 'librarian')

sys.path.insert(0, LIB)
import ingest  # noqa: E402


# librarian/private/ is a SEPARATE PRIVATE REPOSITORY cloned into place, git
# -ignored here and deliberately absent from any public checkout — including
# CI, where it must never appear. Its 31 works are therefore expected to be
# unresolvable when it is not present, and only then.
HAVE_PRIVATE = os.path.isdir(os.path.join(LIB, 'private'))


def manifest():
    with open(os.path.join(LIB, 'works.yml'), encoding='utf-8') as f:
        works = yaml.safe_load(f)['works']
    if HAVE_PRIVATE:
        return works
    return {w: e for w, e in works.items()
            if not (isinstance(e, dict) and str(e.get('src', '')).startswith('private/'))}


class Sources(unittest.TestCase):
    def test_every_source_in_the_manifest_resolves(self):
        missing = [(w, e['src']) for w, e in manifest().items()
                   if isinstance(e, dict) and 'src' in e
                   and not os.path.exists(ingest.src_path(e['src']))]
        self.assertEqual(missing, [],
                         'sources the librarian cannot read:\n  '
                         + '\n  '.join('%s -> %s' % m for m in missing))

    def test_the_whole_public_shelf_is_reachable_not_just_the_private_one(self):
        """The tell that would have caught this on day one. The private shelves
        live inside librarian/ and were never affected by the reorg, so 'some
        sources resolve' was true throughout — only 31 of 288 did."""
        got = sum(1 for w, e in manifest().items()
                  if isinstance(e, dict) and 'src' in e
                  and os.path.exists(ingest.src_path(e['src'])))
        self.assertGreater(got, 200,
                           'only %d sources resolve — the public shelf is unreachable '
                           'again, which is what six weeks of stale answers looked like' % got)

    def test_the_old_repo_root_spelling_still_finds_the_built_page(self):
        """The manifest keeps its pre-reorg spelling on purpose — redirecting it
        was preferable to rewriting 257 lines — so that redirect has to work."""
        self.assertTrue(os.path.exists(ingest.src_path('../book.html')),
                        '../book.html must resolve into docs/')
        self.assertTrue(ingest.src_path('../book.html').replace('\\', '/').endswith('docs/book.html'))

    @unittest.skipUnless(HAVE_PRIVATE, 'the private shelf is not cloned here')
    def test_the_private_shelf_is_reached_by_its_own_path(self):
        """Its entries address files inside librarian/ and were never touched by
        the docs/ reorg — which is exactly why 31 works kept resolving while the
        other 257 silently did not."""
        with open(os.path.join(LIB, 'works.yml'), encoding='utf-8') as f:
            all_works = yaml.safe_load(f)['works']
        priv = [e['src'] for e in all_works.values()
                if isinstance(e, dict) and str(e.get('src', '')).startswith('private/')]
        self.assertTrue(priv, 'no private works in the manifest at all')
        for rel in priv:
            self.assertTrue(os.path.exists(ingest.src_path(rel)), rel)

    def test_a_path_that_resolves_as_written_still_wins(self):
        """The private shelves address files inside librarian/ and must not be
        redirected anywhere."""
        for rel in ('works.yml', 'persona.md'):
            self.assertEqual(os.path.realpath(ingest.src_path(rel)),
                             os.path.realpath(os.path.join(LIB, rel)))


class Guard(unittest.TestCase):
    def test_a_broken_manifest_is_an_error_not_a_report(self):
        """Run the real script against a tree where nothing resolves — the exact
        2026-07-30 situation — and require a non-zero exit. A few works waiting
        on their build stays ordinary; most of the shelf missing does not."""
        tmp = tempfile.mkdtemp()
        try:
            shutil.copytree(LIB, os.path.join(tmp, 'librarian'),
                            ignore=shutil.ignore_patterns('private', '__pycache__', '.key'))
            os.makedirs(os.path.join(tmp, 'docs'), exist_ok=True)   # empty on purpose
            r = subprocess.run([sys.executable, os.path.join(tmp, 'librarian', 'ingest.py')],
                               capture_output=True, text=True, cwd=tmp)
            self.assertNotEqual(r.returncode, 0,
                                'ingest reported success over a manifest that resolved nothing')
            self.assertIn('REFUSING', r.stderr)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_the_exit_code_reaches_the_shell(self):
        """`main()` used to be called bare, so its return value was discarded and
        `make librarian` would have reported success over the refusal above."""
        with open(os.path.join(LIB, 'ingest.py'), encoding='utf-8') as f:
            src = f.read()
        self.assertIn('sys.exit(main())', src,
                      'a bare main() throws away the refusal exit code')


if __name__ == '__main__':
    unittest.main()
