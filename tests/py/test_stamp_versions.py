"""The cache-busting invariants.

Stale-cache bugs are silent by nature: nothing errors, the page just runs old
code forever. This file makes them loud.

Two real defects prompted it, one shipped and one caught in the act:

  * index.js, flash.js, contact.js and away.js carried a HARDCODED ?v=1 that
    the stamper never touched. docs/index.js then changed, and every cache
    holding index.js?v=1 served dead code with no path to healing.

  * While extending the stamper, a tightened regex stopped matching nav.js's
    JavaScript reference `s.src = 'app.js?v=N'` — so app.js quietly stopped
    being cache-busted, with the stamper still reporting success. Only
    comparing the stamped key against the file's real hash exposed it. That is
    `test_every_reference_carries_the_current_key` below, and it is the one
    that matters most here.
"""
import hashlib
import json
import glob
import os
import re
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DOCS = os.path.join(ROOT, 'docs')
PARTIALS = os.path.join(ROOT, 'partials')

sys.path.insert(0, os.path.join(ROOT, 'scripts'))
import stamp_versions  # noqa: E402


def key_of(rel):
    with open(os.path.join(DOCS, rel), 'rb') as f:
        return str(int(hashlib.sha256(f.read()).hexdigest()[:8], 16))


# One regex, one pass, one read of each file. The corpus is ~306 MB of served
# HTML (the whole Schaff library, the Bibles, the Summa), so a per-asset scan
# took over two minutes; capturing every reference once and matching against the
# manifest in Python takes seconds. `make tests` has to stay fast enough that
# people actually run it.
def _ref_re():
    """Only OUR assets. A bare (?:src|href)="..." pattern matched every anchor
    in the corpus — a Schaff volume has thousands — and the Python-level loop
    over ~1.4M irrelevant matches took a minute. Naming the assets in the
    pattern lets the C engine reject almost every position."""
    names = sorted(set(stamp_versions.NAV_ASSETS + stamp_versions.PAGE_ASSETS
                       + stamp_versions.RUNTIME_ASSETS), key=len, reverse=True)
    return re.compile((r'(?:src|href)\s*=\s*["\']('
                       + '|'.join(re.escape(n) for n in names)
                       + r')(\?v=[0-9a-z]+)?["\']').encode())


REF_RE = _ref_re()
_refs_cache = None


def all_references():
    """[(file, url)] for every reference to a versioned asset of ours."""
    global _refs_cache
    if _refs_cache is not None:
        return _refs_cache
    out = []
    for base in (DOCS, PARTIALS):
        for name in sorted(os.listdir(base)):
            if not (name.endswith('.html') or name.endswith('.js')):
                continue
            path = os.path.join(base, name)
            rel = os.path.relpath(path, ROOT)
            # Bytes, and only the ends of the file. Asset references live in
            # <head> and in the nav block just under it, or in the tail
            # (book-tail.html's comments.js). The middle of a Schaff volume is
            # megabytes of prose that can only cost time. Reading whole files
            # and decoding them took a minute for 306 MB; this is seconds.
            # The window is SELF-CHECKING: test_every_reference_carries_the_
            # current_key asserts nav.js was found on essentially every page,
            # so a window that started missing references would fail there
            # rather than pass silently.
            with open(path, 'rb') as f:
                head = f.read(128 * 1024)
                size = os.path.getsize(path)
                tail = b''
                if size > len(head):
                    f.seek(max(len(head), size - 32 * 1024))
                    tail = f.read()
            for chunk in (head, tail):
                for m in REF_RE.finditer(chunk):
                    out.append((rel, (m.group(1) + (m.group(2) or b'')).decode()))
    _refs_cache = out
    return out


class Manifest(unittest.TestCase):
    def test_version_json_matches_the_files_on_disk(self):
        """The manifest is what the app compares itself against; if it drifts
        from the bytes actually served, every device is told the wrong thing."""
        with open(os.path.join(DOCS, 'version.json'), encoding='utf-8') as f:
            v = json.load(f)
        self.assertTrue(v.get('build'), 'version.json has no build id')
        for name, key in v['assets'].items():
            self.assertEqual(key, key_of(name),
                             name + ' is stamped ' + key + ' but hashes to ' + key_of(name))

    def test_the_build_id_is_derived_from_content_only(self):
        """No timestamps: builds are pinned to SOURCE_DATE_EPOCH and the
        byte-deterministic double build is a ship gate. A build date here would
        churn every rebuild and break it."""
        with open(os.path.join(DOCS, 'version.json'), encoding='utf-8') as f:
            raw = f.read()
        self.assertNotRegex(raw, r'\d{4}-\d{2}-\d{2}', 'a date leaked into version.json')
        self.assertEqual(sorted(json.loads(raw).keys()), ['assets', 'build'])

    def test_every_asset_that_can_be_versioned_is(self):
        with open(os.path.join(DOCS, 'version.json'), encoding='utf-8') as f:
            have = set(json.load(f)['assets'])
        want = set(stamp_versions.NAV_ASSETS + stamp_versions.PAGE_ASSETS
                   + stamp_versions.RUNTIME_ASSETS)
        self.assertEqual(want - have, set(), 'declared but never stamped')


class References(unittest.TestCase):
    def test_every_reference_carries_the_current_key(self):
        """THE one that catches a stamper that reports success and does
        nothing. Any reference to a versioned asset, anywhere in served HTML or
        JS, must carry that asset's CURRENT hash — not a stale one, and not
        none at all."""
        with open(os.path.join(DOCS, 'version.json'), encoding='utf-8') as f:
            assets = json.load(f)['assets']
        bad = []
        seen = set()
        for path, url in all_references():
            name, _, query = url.partition('?')
            if name not in assets:
                continue                     # not a versioned asset of ours
            got = query[2:] if query.startswith('v=') else ''
            if got != assets[name]:
                bad.append('%s: %s?v=%s (current is %s)'
                           % (path, name, got or 'NONE', assets[name]))
            seen.add(name)
        self.assertEqual(bad, [], 'stale or unversioned references:\n  ' + '\n  '.join(bad))
        # Anti-vacuum, and the windowed read's own proof: nav.js is on every
        # served page, so finding it on fewer than most of them means the scan
        # (or the window above) has stopped seeing what it is meant to check.
        pages = len([n for n in os.listdir(DOCS) if n.endswith('.html')])
        found = len({p for p, u in all_references() if u.startswith('nav.js')})
        self.assertGreater(found, pages - 5,
                           'only %d of %d pages yielded a nav.js reference — the scan '
                           'or its read window has lost its grip' % (found, pages))

    def test_no_hardcoded_key_survives(self):
        """`?v=1` is the signature of a hand-written key nobody maintains —
        exactly what index.js, tweetnacl and lamejs were pinned at for weeks."""
        bad = []
        for path, url in all_references():
            m = re.search(r'\?v=(\d{1,3})$', url)
            if m:
                bad.append('%s: %s' % (path, url))
        self.assertEqual(bad, [], 'suspiciously small (hand-written?) keys:\n  ' + '\n  '.join(bad))

    def test_the_runtime_assets_carry_no_key_in_the_bundle_source(self):
        """The circularity guard. A key written into client/comments.ts changes
        comments.js, which changes comments.js's own key — a fixpoint with no
        solution. Those keys live in nav.js's MC_ASSETS and are read at runtime."""
        for rel in sorted(glob.glob(os.path.join(ROOT, 'client', '*.ts'))) + [os.path.join(ROOT, 'app', 'appchrome.ts'), os.path.join(ROOT, 'app', 'richtext.ts')]:
            with open(rel, encoding='utf-8') as f:
                src = f.read()
            for name in stamp_versions.RUNTIME_ASSETS:
                self.assertNotIn(name + '?v=', src,
                                 rel + ' hardcodes a key for ' + name
                                 + ' — read it from window.mcAsset instead')


class InvisibleToMake(unittest.TestCase):
    """A stamped file keeps its modification time.

    make rebuilds a target when a prerequisite is strictly newer. The stamp
    rewrites pages, partials, nav.js and content.py for their cache keys only
    — nothing built FROM them changes — so if the write bumped their mtimes,
    make would take a freshly stamped corpus page for a freshly built one. It
    did (2026-09-09): a commit changed a corpus .tex and the stylesheet, the
    bundle's stamp touched all 272 pages, and `make html` a minute later left
    the two changed pages unbuilt. This holds the stamp invisible to make.
    """
    def test_a_rewrite_keeps_the_mtime(self):
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, 'page.html')
            with open(path, 'w', encoding='utf-8') as f:
                f.write('<script src="nav.js?v=1"></script>')
            old = 946684800  # 2000-01-01, the flattened mtime CI gives every file
            os.utime(path, (old, old))
            stamp_versions.write_keeping_mtime(path, '<script src="nav.js?v=2"></script>')
            with open(path, encoding='utf-8') as f:
                self.assertIn('nav.js?v=2', f.read(), 'the content must still be rewritten')
            self.assertEqual(int(os.stat(path).st_mtime), old,
                             'a stamped file must keep its mtime, or make mistakes it for a fresh build')

    def test_sub_file_goes_through_the_keeper(self):
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, 'content.py')
            with open(path, 'w', encoding='utf-8') as f:
                f.write("COMMENTS_V = '111'\n")
            old = 946684800
            os.utime(path, (old, old))
            self.assertTrue(stamp_versions.sub_file(path, r"COMMENTS_V = ['\"]?[0-9a-z]+['\"]?", "COMMENTS_V = '222'"))
            self.assertEqual(int(os.stat(path).st_mtime), old)

    def test_the_page_pass_uses_the_keeper_too(self):
        src = open(os.path.join(ROOT, 'scripts', 'stamp_versions.py'), encoding='utf-8').read()
        body = src[src.index('def main('):]
        self.assertIn('write_keeping_mtime(path, after)', body,
                      'the page pass must write through write_keeping_mtime')
        self.assertNotIn("open(path, 'w'", body.split('# ---- 5.')[0],
                         'a page write that bypasses the keeper bumps its mtime')


class Patterns(unittest.TestCase):
    """The substitution itself, on strings small enough to read.

    Hermetic on purpose: the earlier version of this class ran the real stamper
    twice as a subprocess, which meant a test that REWROTE 273 pages of the
    repo to check itself. The fixpoint property is already proven for real by
    test_every_reference_carries_the_current_key — if every reference on disk
    already carries the current key, another run cannot change anything.
    """
    def sub(self, name, key, text):
        return re.sub(stamp_versions.asset_pattern(name),
                      r'\g<1>' + name + '?v=' + key + r'\g<2>', text)

    def test_it_stamps_a_bare_reference_and_restamps_a_stale_one(self):
        bare = '<script defer src="nav.js"></script>'
        once = self.sub('nav.js', '123', bare)
        self.assertEqual(once, '<script defer src="nav.js?v=123"></script>')
        self.assertEqual(self.sub('nav.js', '123', once), once, 'not idempotent')
        self.assertEqual(self.sub('nav.js', '456', once),
                         '<script defer src="nav.js?v=456"></script>')

    def test_the_key_survives_intact(self):
        """Every key starts with a digit, and `\\1` followed by digits is read as
        an OCTAL ESCAPE — r'\\1' + '1544806402' produced 'M44806402', destroying
        the src= attribute on 273 pages while the script reported success. The
        replacements use \\g<1>, and this is what holds them to it."""
        for key in ('1544806402', '0', '7', '999', '1602106099'):
            out = self.sub('style.css', key, '<link href="style.css">')
            self.assertEqual(out, '<link href="style.css?v=' + key + '">',
                             'key ' + key + ' was mangled — check for \\1 vs \\g<1>')

    def test_a_javascript_reference_is_a_reference_too(self):
        """nav.js injects its two scripts from JS, not markup. A pattern that
        demanded src=" matched neither, and app.js silently stopped being
        cache-busted while the stamper still said it had worked."""
        js = "    s.src = 'app.js?v=111';"
        self.assertEqual(self.sub('app.js', '222', js), "    s.src = 'app.js?v=222';")

    def test_prose_is_never_rewritten(self):
        """The first version matched a bare word and turned the sentence "no
        nav.js, no app shell" in docs/turnstile.html into
        "no nav.js?v=879907213"."""
        for prose in ('<!-- standalone: no nav.js, no app shell -->',
                      '/* referenced as turnstile.html?v=N from the client */',
                      '{"turnstile.html":"3089112556"}'):
            for name in ('nav.js', 'turnstile.html'):
                self.assertEqual(self.sub(name, '9', prose), prose,
                                 'rewrote prose: ' + prose)


if __name__ == '__main__':
    unittest.main()
