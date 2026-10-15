"""The Bible text is fetched by its stamped address, and that address is the one
the edge caches (2026-10-15). kjv.json and dr.json are 4 MB each; Cloudflare
caches no .json by default, and the reader asked for the bare `kjv.json`, so
every Bible page and the first Scripture hover of a session fetched the whole
text from GitHub Pages — the nightly's verse timeouts. What would break
silently: a reader or hover fetching the bare name again (the edge rule then
matches nothing and every reader pays the origin), the cache rule losing either
file or its `?v=` condition (an unkeyed .json held for 30 days would serve old
bytes after a deploy), or stamp_versions.py dropping the two from MC_ASSETS
(mcAsset then returns the bare name, and the rule quietly stops matching)."""
import os
import re
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def read(*parts):
    with open(os.path.join(ROOT, *parts), encoding='utf-8') as f:
        return f.read()


class BibleCache(unittest.TestCase):
    def test_every_bible_fetch_takes_the_stamped_address(self):
        reader = read('pagejs', 'bible-reader.ts')
        self.assertRegex(reader, r'window\.mcAsset\(JSON_URL\)')
        self.assertNotRegex(reader, r'fetch\(JSON_URL\)', 'the reader fetches the bare name again')
        for path in (('app', 'richtext.ts'), ('client', 'composer.ts')):
            src = read(*path)
            for name in ('kjv.json', 'dr.json'):
                for m in re.finditer(r'fetch\(([^)]*)\b' + re.escape(name), src):
                    self.assertIn('sset(', m.group(1), '%s fetches %s unstamped' % ('/'.join(path), name))

    def test_both_files_are_runtime_assets(self):
        stamp = read('scripts', 'stamp_versions.py')
        self.assertIn("'kjv.json'", stamp)
        self.assertIn("'dr.json'", stamp)

    def test_the_edge_rule_holds_only_the_stamped_text(self):
        tf = read('terraform', 'cache.tf')
        rules = re.split(r'\n    \{\n', tf)
        bible = [r for r in rules if '/kjv.json' in r]
        self.assertEqual(len(bible), 1, 'one cache rule names the Bible text')
        rule = bible[0]
        expr = re.search(r'expression\s*=\s*"(.*)"\n', rule).group(1)
        self.assertIn('\\"/kjv.json\\"', expr)
        self.assertIn('\\"/dr.json\\"', expr)
        self.assertIn('starts_with(http.request.uri.query, \\"v=\\")', expr,
                      'only the content-keyed address may sit in the edge cache')
        self.assertNotIn(' or ', expr, 'the rule matches the two stamped files and nothing else')
        self.assertRegex(rule, r'\n\s*cache\s*=\s*true\n')
        self.assertRegex(rule, r'edge_ttl = \{\s*default = \d+\s*mode\s*= "override_origin"')
        ttl = int(re.search(r'browser_ttl = \{\s*default = (\d+)', rule).group(1))
        self.assertLessEqual(ttl, 86400, 'a browser cache cannot be purged: one day at most')


if __name__ == '__main__':
    unittest.main()
