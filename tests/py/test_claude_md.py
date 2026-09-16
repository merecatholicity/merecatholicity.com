"""CLAUDE.md is the rulebook and the map, kept short on purpose (P2-3 of the
2026-09-16 review: it had reached 436 lines, laws of thirty lines, a "next
migration" number that drifted twice in a week). The ceilings here are a
ratchet: the file at most 280 lines, no bullet longer than six lines, no kept
"next: NNNN" (the number is derived — `make migration`), and the pointer to
the long-form log present. A law that needs more than six lines states its
rule here and puts the rest in the log as a dated passage."""
import os
import re
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CLAUDE = os.path.join(ROOT, 'CLAUDE.md')
MAX_LINES = 280
MAX_BULLET = 6


def bullets(lines):
    out, cur = [], None
    for i, ln in enumerate(lines, start=1):
        if re.match(r'^(- |\d+\. )', ln):
            cur = [i, 1, ln[:70]]
            out.append(cur)
        elif cur and ln.startswith('  ') and ln.strip():
            cur[1] += 1
        else:
            cur = None
    return out


class ClaudeMd(unittest.TestCase):
    def setUp(self):
        with open(CLAUDE, encoding='utf-8') as f:
            self.text = f.read()
        self.lines = self.text.split('\n')

    def test_the_file_stays_short(self):
        self.assertLessEqual(len(self.lines), MAX_LINES, 'CLAUDE.md grew past %d lines: move the prose to the log (a dated passage), keep the rule' % MAX_LINES)

    def test_no_bullet_is_longer_than_six_lines(self):
        long = ['line %d: %d lines — %s' % (b[0], b[1], b[2]) for b in bullets(self.lines) if b[1] > MAX_BULLET]
        self.assertEqual(long, [], 'a law states its rule here in six lines at most; the rest is a passage in the log')

    def test_the_next_migration_number_is_derived_not_kept(self):
        self.assertIsNone(re.search(r'\(next:\s*\d{4}\)', self.text), 'a kept "next: NNNN" drifts — `make migration` derives it')
        self.assertIn('make migration NAME=', self.text)

    def test_the_pointer_to_the_log_stands(self):
        self.assertIn('docs/architecture/log/YYYY-MM.md', self.text)
        self.assertIn('scripts/infra_index.py --write', self.text)


if __name__ == '__main__':
    unittest.main()
