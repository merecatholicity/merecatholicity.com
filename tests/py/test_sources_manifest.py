"""The corpus sources are fetched, not tracked (P2-6, 2026-09-16):
resources/SOURCES.json names every *-body.tex, *-src.html, *.xml and source
PDF under resources/ with its sha256, none of them is tracked in git, every
shard names a published asset, and any listed file present on this box
matches the manifest. What would break silently: a regenerated body committed
again by habit (the weight comes back); a body regenerated locally and never
re-packed (CI builds from the old bytes); a manifest entry for a file no shard
carries."""
import glob
import json
import os
import subprocess
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
import sources  # noqa: E402


class SourcesManifest(unittest.TestCase):
    def setUp(self):
        with open(sources.MANIFEST, encoding='utf-8') as f:
            self.m = json.load(f)
        self.tracked = set(subprocess.run(['git', 'ls-files', 'resources'], capture_output=True, text=True, cwd=ROOT).stdout.split())

    def test_every_corpus_source_on_disk_is_listed_and_none_is_tracked(self):
        for shard, pats in sources.SHARDS.items():
            for pat in pats:
                for path in glob.glob(os.path.join(sources.RES, pat)):
                    rel = os.path.relpath(path, sources.RES)
                    self.assertIn(rel, self.m['files'], rel + ' is a corpus source with no manifest entry: scripts/sources.py manifest, pack, publish')
                    self.assertNotIn('resources/' + rel, self.tracked, rel + ' is tracked again — the weight comes back; git rm --cached it')
        for rel in self.m['files']:
            self.assertNotIn('resources/' + rel, self.tracked, rel)

    def test_every_shard_names_a_published_asset_and_carries_its_files(self):
        listed = set()
        for shard, s in self.m['shards'].items():
            self.assertTrue(s.get('asset') and s.get('sha256') and s.get('bytes'), shard + ': pack and publish first')
            self.assertTrue(s['asset'].startswith(shard + '-') and s['asset'].endswith('.tar.xz'), s['asset'])
            self.assertTrue(s['files'], shard + ' carries nothing')
            for rel in s['files']:
                self.assertEqual(self.m['files'][rel]['shard'], shard, rel)
            listed |= set(s['files'])
        self.assertEqual(listed, set(self.m['files']), 'every listed file rides exactly one shard')

    def test_a_present_file_matches_its_entry(self):
        present = [rel for rel in self.m['files'] if os.path.exists(os.path.join(sources.RES, rel))]
        if not present:
            self.skipTest('no corpus source on this box (make fetch-sources)')
        bad = sources.verify_files(self.m, present)
        self.assertEqual(bad, [], 'a source differs from the manifest: regenerate it deliberately (manifest, pack, publish) or fetch the published one')


if __name__ == '__main__':
    unittest.main()
