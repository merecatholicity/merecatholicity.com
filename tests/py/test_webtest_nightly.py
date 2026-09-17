"""The nightly run's two pure parts (scripts/webtest_nightly.py): the summary
line every webtest prints, and the comparison with the baseline that names a
regression. What would break silently: a crashed suite counted as 0 FAIL and
passed; a suite whose baseline already fails (an admin-key suite) alerting
every night; a suite the baseline never saw judged leniently; a failure that
did not come back on a re-run told to the owner as a regression; the report
sent with Python's own user agent, which Cloudflare refuses (error 1010)."""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'scripts'))
import webtest_nightly as wn  # noqa: E402


class NightlyParse(unittest.TestCase):
    def test_the_summary_line_or_the_check_lines(self):
        self.assertEqual(wn.parse_summary('PASS x\nPASS y\n\n==== 30 PASS  0 FAIL ====\n'), (30, 0), 'the banner wins where a suite prints one')
        self.assertEqual(wn.parse_summary('==== 5 PASS 4 FAIL ===='), (5, 4))
        self.assertEqual(wn.parse_summary('PASS  the jump button counts it\nPASS  typing shows\nFAIL  phone console clean\n'), (2, 1), 'the other suites: one line per check')
        self.assertEqual(wn.parse_summary('  ok anchored\n  ok zoomed\nFAIL pinch\n2/3 passed\n'), (2, 1), 'the "  ok" shape too')
        self.assertEqual(wn.parse_summary('PASSPORT is not a pass\nFAILURE is not a fail\n'), None, 'whole words only')
        self.assertIsNone(wn.parse_summary('Traceback (most recent call last):\n  boom'))
        self.assertIsNone(wn.parse_summary(''))

    def test_regressions_are_a_rise_above_the_baseline_never_the_baseline_itself(self):
        baseline = {
            'test_worker_reads': {'pass': 30, 'fail': 0, 'exit': 0, 'summary': True},
            'test_board_views': {'pass': 1, 'fail': 7, 'exit': 1, 'summary': True},   # the admin-key shape
            'test_profile_inbox': {'pass': 0, 'fail': 0, 'exit': 1, 'summary': False},  # crashes on this box
        }
        ok = {
            'test_worker_reads': {'pass': 30, 'fail': 0, 'exit': 0, 'summary': True, 'fails': []},
            'test_board_views': {'pass': 1, 'fail': 7, 'exit': 1, 'summary': True, 'fails': ['FAIL a'] * 7},
            'test_profile_inbox': {'pass': 0, 'fail': 0, 'exit': 1, 'summary': False, 'fails': []},
        }
        self.assertEqual(wn.compare(baseline, ok), [], 'the known shape is not a regression')
        worse = dict(ok)
        worse['test_worker_reads'] = {'pass': 29, 'fail': 1, 'exit': 1, 'summary': True, 'fails': ['FAIL  config: apiVersion']}
        worse['test_board_views'] = {'pass': 0, 'fail': 8, 'exit': 1, 'summary': True, 'fails': ['FAIL b'] * 8}
        regs = wn.compare(baseline, worse)
        self.assertEqual(len(regs), 2)
        self.assertTrue(regs[0].startswith('test_worker_reads: 1 FAIL (baseline 0): FAIL  config: apiVersion'), regs)
        self.assertTrue(regs[1].startswith('test_board_views: 8 FAIL (baseline 7)'), regs)

    def test_a_crash_is_a_regression_where_the_baseline_finished(self):
        baseline = {'test_hscroll': {'pass': 12, 'fail': 0, 'exit': 0, 'summary': True}}
        crashed = {'test_hscroll': {'pass': 0, 'fail': 0, 'exit': 1, 'summary': False, 'fails': []}}
        self.assertEqual(wn.compare(baseline, crashed), ['test_hscroll: exited 1 (baseline 0)'])
        no_summary = {'test_hscroll': {'pass': 0, 'fail': 0, 'exit': 0, 'summary': False, 'fails': []}}
        self.assertEqual(wn.compare(baseline, no_summary), ['test_hscroll: no summary line (crashed before the end)'])

    def test_a_suite_the_baseline_never_saw_is_judged_against_zero(self):
        new = {'test_new': {'pass': 3, 'fail': 1, 'exit': 1, 'summary': True, 'fails': ['FAIL z']}}
        self.assertEqual(wn.compare({}, new), ['test_new: 1 FAIL (baseline 0): FAIL z'])

    def test_a_failure_is_told_only_when_it_comes_back(self):
        """2026-09-17: one GitHub Pages 503 on dr.json, minutes after a deploy,
        alerted the owner as a regression; the re-run was clean."""
        baseline = {
            'test_hscroll': {'pass': 114, 'fail': 0, 'exit': 0, 'summary': True},
            'test_worker_reads': {'pass': 30, 'fail': 0, 'exit': 0, 'summary': True},
            'test_board_views': {'pass': 1, 'fail': 7, 'exit': 1, 'summary': True},
        }
        first = {'pass': 112, 'fail': 2, 'exit': 2, 'summary': True,
                 'fails': ["FAIL hscroll console: ['https://merecatholicity.com/dr.json - 503']"]}
        results = {
            'test_hscroll': first,
            'test_worker_reads': {'pass': 29, 'fail': 1, 'exit': 1, 'summary': True, 'fails': ['FAIL  config: apiVersion']},
            'test_board_views': {'pass': 1, 'fail': 7, 'exit': 1, 'summary': True, 'fails': ['FAIL a'] * 7},
        }
        again = {
            'test_hscroll': {'pass': 114, 'fail': 0, 'exit': 0, 'summary': True, 'fails': []},
            'test_worker_reads': {'pass': 29, 'fail': 1, 'exit': 1, 'summary': True, 'fails': ['FAIL  config: apiVersion (again)']},
        }
        asked = []

        def rerun(name):
            asked.append(name)
            return dict(again[name])

        clean = wn.confirm(baseline, results, rerun)
        self.assertEqual(asked, ['test_hscroll', 'test_worker_reads'], 'only a regressed suite runs again, once; the known admin-key shape never')
        self.assertEqual(clean, ['test_hscroll'])
        self.assertEqual(results['test_hscroll']['fail'], 0, 'the clean re-run is the verdict')
        self.assertIs(results['test_hscroll']['once'], first, 'and the first run is kept beside it')
        self.assertEqual(wn.compare(baseline, results),
                         ['test_worker_reads: 1 FAIL (baseline 0): FAIL  config: apiVersion'],
                         'a failure that comes back is the regression, told in the words first seen')
        self.assertEqual(wn.suite_line('test_hscroll', results['test_hscroll']), 'test_hscroll 114/114 (clean on a re-run; first 112/114)')
        self.assertEqual(wn.suite_line('test_worker_reads', results['test_worker_reads']), 'test_worker_reads 29/30')
        longest = max(wn.SUITES, key=len)
        self.assertLessEqual(len(wn.suite_line(longest, {'pass': 999, 'fail': 999, 'once': {'pass': 999, 'fail': 999}})), 80,
                             'the ops door keeps 80 characters of a suite line')

    def test_every_listed_suite_exists_and_is_read_only_by_name(self):
        wt = os.path.join(os.path.dirname(__file__), '..', '..', 'webtest')
        for name in wn.SUITES:
            self.assertTrue(os.path.exists(os.path.join(wt, name + '.py')), name)
        for writer in ('test_post', 'test_interactive', 'test_admin_reads', 'test_call', 'test_voice', 'test_merecat_composer'):
            self.assertNotIn(writer, wn.SUITES, writer + ' writes or needs an admin key: not for a nightly')


class NightlyReport(unittest.TestCase):
    def test_the_report_goes_out_as_a_browser(self):
        seen = {}

        class Resp:
            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def read(self):
                return b'{"ok": true, "stored": true}'

        def fake(req, timeout=None):
            seen['ua'] = req.get_header('User-agent')
            seen['url'] = req.full_url
            return Resp()

        real = wn.urllib.request.urlopen
        wn.urllib.request.urlopen = fake
        try:
            out = wn.report({'test_x': {'pass': 1, 'fail': 0, 'exit': 0}}, [], 'k')
        finally:
            wn.urllib.request.urlopen = real
        self.assertEqual(out, {'ok': True, 'stored': True})
        self.assertEqual(seen['url'], wn.DOOR)
        self.assertTrue(seen['ua'].startswith('Mozilla/5.0'), seen['ua'])
        self.assertNotIn('Python-urllib', seen['ua'])


if __name__ == '__main__':
    unittest.main()
