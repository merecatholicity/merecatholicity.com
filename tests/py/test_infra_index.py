"""The infrastructure log's index and rules (P2-4 of the 2026-09-16 review):
the passages live in docs/architecture/log/YYYY-MM.md, the index of every
bold lead-in is generated into docs/architecture/INFRASTRUCTURE.md, and
scripts/infra_index.py --check is the judge — a stale index, a duplicated
lead-in, a passage under no section heading, or a prose line over 100 columns
fails here. What would break silently: two agents appending passages and the
index naming neither; a lead-in reused so a grep lands on the wrong passage;
a 30,000-column line nobody can diff again."""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'scripts'))
import infra_index as ix  # noqa: E402


class InfraIndex(unittest.TestCase):
    def test_the_committed_index_is_the_generated_one_and_every_rule_holds(self):
        problems = ix.check()
        self.assertEqual(problems, [], 'run scripts/infra_index.py --check')

    def test_the_log_has_passages_in_every_section_the_index_orders(self):
        seen = set()
        for path in ix.log_files():
            for section, lead, _line in ix.passages(path)[0]:
                seen.add(section)
                self.assertTrue(lead.strip(), path)
        self.assertTrue(seen, 'no passages found under docs/architecture/log/')
        unknown = sorted(s for s in seen if s not in ix.SECTION_ORDER)
        self.assertEqual(unknown, [], 'a new section: add it to SECTION_ORDER (its place in the index) in scripts/infra_index.py')

    def test_the_preamble_stands_above_the_index(self):
        with open(ix.INDEX, encoding='utf-8') as f:
            text = f.read()
        parts = ix.split_index(text)
        self.assertIsNotNone(parts)
        self.assertIn('**Deploy authorization (standing).**', parts[0], 'the standing rules stay in the index file, above the generated block')
        self.assertIn('docs/architecture/log/YYYY-MM.md', parts[0])


if __name__ == '__main__':
    unittest.main()
