"""The nightly run (scripts/webtest_nightly.py): the summary line every
webtest prints, the comparison with the baseline that names a regression, and
the kit the night is judged by. What would break silently: a crashed suite
counted as 0 FAIL and passed; a suite whose baseline already fails (an
admin-key suite) alerting every night; a suite the baseline never saw judged
leniently; a failure that did not come back on a re-run told to the owner as a
regression; the report sent with Python's own user agent, which Cloudflare
refuses (error 1010); and the kit itself — a night judged by whatever the dev
box's checkout last held, so a fix merged on GitHub never reaches the run it
was for (2026-10-07: PR #3's, the same nine "regressions" the morning after it
merged). The kit tests build real repositories in a temporary directory: an
origin, an author's clone where main moves, and a box clone that is never
pulled."""
import contextlib
import io
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

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


# git as the fixtures drive it: no global or system config of the box running
# the tests (a signing hook, another default branch), an identity of its own
GIT_ENV = {
    'GIT_CONFIG_GLOBAL': os.devnull, 'GIT_CONFIG_NOSYSTEM': '1',
    'GIT_AUTHOR_NAME': 'kit', 'GIT_AUTHOR_EMAIL': 'kit@example.invalid',
    'GIT_COMMITTER_NAME': 'kit', 'GIT_COMMITTER_EMAIL': 'kit@example.invalid',
}


def sh(cwd, *args):
    return subprocess.run(['git'] + list(args), cwd=cwd, check=True, capture_output=True,
                          text=True).stdout.strip()


def write(root, rel, text):
    path = os.path.join(root, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w') as f:
        f.write(text)


def read(root, rel):
    with open(os.path.join(root, rel)) as f:
        return f.read()


class NightlyKit(unittest.TestCase):
    """The night is judged by MAIN's kit, in a worktree of its own: never the
    checkout the timer starts in, never that checkout touched."""

    def setUp(self):
        env = mock.patch.dict(os.environ, GIT_ENV)
        env.start()
        self.addCleanup(env.stop)
        self.tmp = os.path.realpath(tempfile.mkdtemp(prefix='nightly-kit-'))
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.origin = os.path.join(self.tmp, 'origin.git')
        sh(self.tmp, 'init', '--quiet', '--bare', self.origin)
        self.author = os.path.join(self.tmp, 'author')
        sh(self.tmp, 'clone', '--quiet', self.origin, self.author)
        self.commit({'.gitignore': 'local/\nlibrarian/.key\nwebtest/.testkeys\n',
                     'librarian/README.md': 'the librarian\n',
                     'webtest/flows.py': "BENIGN = ('static.cloudflareinsights.com',)\n"}, 'the old kit')
        # the dev box's checkout: cloned once, never pulled again, holding the keys
        self.box = os.path.join(self.tmp, 'box')
        sh(self.tmp, 'clone', '--quiet', '--branch', 'main', self.origin, self.box)
        self.old = sh(self.box, 'rev-parse', 'HEAD')
        write(self.box, 'librarian/.key', 'the owner key\n')
        write(self.box, 'webtest/.testkeys', 'ALICE=k\n')
        # and the fix merges on GitHub
        self.new = self.commit({'webtest/flows.py': "BENIGN = ('static.cloudflareinsights.com', 'cdn-cgi/rum')\n"}, 'the fix')

    def commit(self, files, message):
        for rel, text in files.items():
            write(self.author, rel, text)
        sh(self.author, 'add', '-A')
        sh(self.author, 'commit', '--quiet', '-m', message)
        sh(self.author, 'push', '--quiet', 'origin', 'HEAD:refs/heads/main')
        return sh(self.author, 'rev-parse', 'HEAD')

    def refresh(self, *remotes):
        return wn.refresh_kit(self.box, remotes=remotes or ('origin',), pause=0)

    def test_main_s_kit_reaches_the_night_though_the_box_was_never_pulled(self):
        write(self.box, 'webtest/flows.py', 'half-written\n')  # the box's own edit, in flight
        write(self.box, 'notes.txt', 'mine\n')
        tree, sha, note = self.refresh()
        self.assertEqual((tree, sha, note), (os.path.join(self.box, 'local', 'nightly-kit'), self.new, ''))
        self.assertEqual(sh(tree, 'rev-parse', 'HEAD'), self.new,
                         'THE POINT: the kit is main, not the checkout the timer started in')
        self.assertIn('cdn-cgi/rum', read(tree, 'webtest/flows.py'), 'the merged fix is the one that judges')
        self.assertEqual(sh(self.box, 'rev-parse', 'HEAD'), self.old, 'the box checkout is never moved')
        self.assertEqual(read(self.box, 'webtest/flows.py'), 'half-written\n', 'nor its edits touched, nor run')
        self.assertEqual(read(self.box, 'notes.txt'), 'mine\n')
        for rel in wn.KIT_KEYS:
            link = os.path.join(tree, rel)
            self.assertTrue(os.path.islink(link), rel + ': linked, never copied')
            self.assertEqual(os.readlink(link), os.path.join(self.box, rel))
        self.assertEqual(sh(tree, 'status', '--porcelain'), '', 'the linked keys are ignored files: the kit reads clean')

    def test_every_night_is_a_whole_new_tree_and_the_keys_outlive_the_old_one(self):
        tree = self.refresh()[0]
        write(tree, 'stray.txt', 'left by last night\n')
        write(tree, 'webtest/flows.py', 'edited inside the kit\n')
        newer = self.commit({'webtest/test_new.py': 'print(1)\n'}, 'a new suite')
        self.assertEqual(self.refresh(), (tree, newer, ''))
        self.assertFalse(os.path.exists(os.path.join(tree, 'stray.txt')), 'nothing a night leaves survives it')
        self.assertIn('cdn-cgi/rum', read(tree, 'webtest/flows.py'))
        self.assertTrue(os.path.exists(os.path.join(tree, 'webtest', 'test_new.py')))
        self.assertEqual(read(self.box, 'librarian/.key'), 'the owner key\n',
                         'THE POINT: removing the old tree never followed its link into the box')
        self.assertTrue(os.path.islink(os.path.join(tree, 'librarian', '.key')))
        listed = sh(self.box, 'worktree', 'list', '--porcelain').count('worktree ')
        self.assertEqual(listed, 2, 'one kit beside the box, however many nights')

    def test_a_night_main_could_not_be_fetched_for_says_so(self):
        self.refresh()  # the box has seen main once
        self.commit({'webtest/test_new.py': 'print(1)\n'}, 'main moves on, out of reach tonight')
        gone = (os.path.join(self.tmp, 'gone.git'), os.path.join(self.tmp, 'also-gone.git'))
        tree, sha, note = self.refresh(*gone)
        self.assertEqual(sha, self.new, 'the suites run at the last main this box had')
        self.assertTrue(note.startswith('kit: main as this box last fetched it, ' + self.new[:7]), note)
        self.assertIn('(git: ', note)
        self.assertLessEqual(len(note), 200, 'the ops door keeps 200 characters of a line')
        clean = {'test_x': {'pass': 3, 'fail': 0, 'exit': 0, 'summary': True, 'fails': []}}
        self.assertEqual(wn.verdict({}, clean, note), [note],
                         'a clean night judged by an older kit still says so, and alone it alerts')
        self.assertEqual(wn.verdict({}, clean, ''), [], 'a clean night judged by main says nothing')
        lone = os.path.join(self.tmp, 'lone')
        sh(self.tmp, 'init', '--quiet', lone)
        tree, sha, note = wn.refresh_kit(lone, remotes=gone, pause=0)
        self.assertIsNone(tree, 'no main ever fetched: nothing better than here')
        self.assertTrue(note.startswith('kit NOT main: main could not be fetched and this box has none'), note)

    def test_a_stranger_at_the_kit_s_path_is_left_alone(self):
        write(self.box, 'local/nightly-kit/precious.txt', 'not the nightly\'s\n')
        tree, sha, note = self.refresh()
        self.assertIsNone(tree)
        self.assertTrue(note.startswith("kit NOT main: local/nightly-kit is not the nightly's worktree"), note)
        self.assertEqual(read(self.box, 'local/nightly-kit/precious.txt'), "not the nightly's\n")
        shutil.rmtree(os.path.join(self.box, 'local', 'nightly-kit'))
        sh(self.tmp, 'clone', '--quiet', self.origin, os.path.join(self.box, 'local', 'nightly-kit'))
        write(self.box, 'local/nightly-kit/precious.txt', 'a clone of its own\n')
        self.assertIsNone(self.refresh()[0], 'a repository of its own there is not the kit either')
        self.assertEqual(read(self.box, 'local/nightly-kit/precious.txt'), 'a clone of its own\n')
        self.assertFalse(wn.KIT_TREE.startswith(os.path.join('local', 'wt') + os.sep),
                         'the kit is never a path an agent worktree takes')
        with open(os.path.join(os.path.dirname(wn.__file__), 'agent_worktree.sh')) as f:
            self.assertIn('local/wt/$name', f.read())

    def test_the_door_runs_main_s_copy_in_the_kit_and_answers_with_its_verdict(self):
        seen = {}

        def spawn(args, env=None):
            seen['args'], seen['note'] = args, env.get('MC_NIGHTLY_KIT_NOTE')
            return 7

        kit = os.path.join(self.tmp, 'kit')
        write(kit, 'scripts/webtest_nightly.py', '# main\'s copy\n')

        def boom(root):
            raise OSError('No space left on device')

        with contextlib.redirect_stdout(io.StringIO()):
            code, note = wn.run_main_kit(['webtest_nightly.py', 'run', '--no-report'], root=self.box,
                                         refresh=lambda root: (kit, 'a' * 40, ''), spawn=spawn)
            self.assertEqual((code, note), (7, ''), "main's copy's verdict is the night's")
            self.assertEqual(seen['args'][1:], [os.path.join(kit, 'scripts', 'webtest_nightly.py'),
                                                'run', '--no-report', '--here'])
            self.assertEqual(seen['note'], '')
            code, note = wn.run_main_kit(['webtest_nightly.py', 'run'], root=self.box,
                                         refresh=lambda root: (None, None, 'kit NOT main: why'), spawn=None)
            self.assertEqual((code, note), (None, 'kit NOT main: why'), 'no better kit: the run goes on here, told')
            code, note = wn.run_main_kit(['webtest_nightly.py', 'run'], root=self.box, refresh=boom, spawn=None)
            self.assertIsNone(code, 'a door that breaks never costs the night its report')
            self.assertTrue(note.startswith('kit NOT main: the refresh failed (No space left on device)'), note)
            code, note = wn.run_main_kit(['webtest_nightly.py', 'run'], root=self.box,
                                         refresh=lambda root: (self.tmp, 'a' * 40, ''), spawn=None)
            self.assertEqual((code, note), (None, 'kit NOT main: main has no scripts/webtest_nightly.py; '
                                                  + wn.RAN_HERE), 'a main that moved the script is told, not run')
        self.assertTrue(wn.runs_here(['x', 'run', '--here'], root=self.box))
        self.assertTrue(wn.runs_here(['x', 'run'], root=os.path.join(self.box, wn.KIT_TREE)),
                        "the kit's own copy never refreshes the tree it stands in")
        self.assertFalse(wn.runs_here(['x', 'run'], root=self.box))

    def test_one_night_at_a_time(self):
        first = wn.kit_lock(self.box)
        self.assertIsNotNone(first)
        self.addCleanup(first.close)
        self.assertIsNone(wn.kit_lock(self.box), 'a second run stands down while one refreshes or reads the kit')
        first.close()
        again = wn.kit_lock(self.box)
        self.assertIsNotNone(again, 'and the lock is the open file: closed, it is free')
        again.close()


if __name__ == '__main__':
    unittest.main()
