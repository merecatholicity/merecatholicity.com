"""The pipeline's report on a pull request (2026-10-09).

scripts/ci_pr_report.py keeps ONE comment per pull request current: the checks
on its head with the failed step's log tail, and once merged, the deploy runs,
a gate waiting for its reviewer (the Review deployments link, the plan, the
ask's issue) and how it ended. It is rendered whole from the API on every call.

What would break silently: a second comment per run (the marker lost); a
mention written into an edit (an edit that adds one notifies — the ask's issue
is the one ping); a log tail whose own backticks close its code block; the
tail missing the error it exists to show; a comment over GitHub's limit,
refused; an older run of a workflow reported over the newer.
"""
import datetime
import os
import re
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
import ci_pr_report as r  # noqa: E402

LOG = '\n'.join([
    '2026-10-09T19:29:58.1Z ##[group]Run make css',
    '2026-10-09T19:29:58.2Z make css',
    '2026-10-09T19:29:58.3Z ##[endgroup]',
    '2026-10-09T19:29:58.4Z > node scripts/vendor.ts',
    '2026-10-09T19:29:59.1Z \x1b[31mError: ENOENT: no such file\x1b[0m, open \'qrcode.js\'',
    '2026-10-09T19:29:59.2Z make: *** [Makefile:33: bundle] Error 1',
    '2026-10-09T19:29:59.3Z ##[error]Process completed with exit code 2.',
    '2026-10-09T19:29:59.4Z Post job cleanup.',
])


def job(name, status='completed', conclusion='success', **kw):
    return dict({'name': name, 'status': status, 'conclusion': conclusion, 'url': 'https://x/job/' + name,
                 'failed_step': None, 'tail': None}, **kw)


def run(workflow, jobs, status='completed', conclusion='success', **kw):
    return dict({'workflow': workflow, 'run_id': 7, 'run_number': 41, 'url': 'https://x/runs/7', 'status': status,
                 'conclusion': conclusion, 'started': '2026-10-09T19:00:00Z', 'updated': '2026-10-09T19:06:02Z',
                 'jobs': jobs, 'pending': [], 'approvals': [], 'plan': None, 'ask': None}, **kw)


def outside_code(body):
    """The comment with every fenced block cut out."""
    return re.sub(r'(`{3,})\w*\n.*?\n\1', '', body, flags=re.S)


NOW = datetime.datetime(2026, 10, 9, 21, 0, tzinfo=datetime.timezone.utc)


class TheTail(unittest.TestCase):
    def test_it_is_the_failed_steps_own_output(self):
        tail = r.log_tail(LOG)
        self.assertEqual(tail.split('\n')[0], '> node scripts/vendor.ts', 'from the end of the step\'s command echo')
        self.assertIn("Error: ENOENT: no such file, open 'qrcode.js'", tail, 'colour codes and timestamps gone')
        self.assertTrue(tail.endswith('Error: Process completed with exit code 2.'))
        self.assertNotIn('Post job cleanup', tail)
        self.assertNotIn('2026-10-09T', tail)

    def test_a_log_without_an_error_has_no_tail(self):
        self.assertIsNone(r.log_tail('2026-10-09T19:29:58.1Z all good\n'))

    def test_a_long_tail_keeps_its_end(self):
        log = '\n'.join(['line %d' % i for i in range(500)] + ['##[error]the end'])
        tail = r.log_tail(log, lines=1000, chars=200)
        self.assertTrue(tail.startswith('…'))
        self.assertTrue(tail.endswith('Error: the end'))
        self.assertLessEqual(len(tail), 201)

    def test_no_backtick_run_in_the_log_closes_its_block(self):
        text = 'a ``` b ```` c'
        block = r.fence(text)
        self.assertTrue(block.startswith('`````text\n'))
        self.assertTrue(block.endswith('\n`````'))


class TheWords(unittest.TestCase):
    def test_a_mention_is_defused_and_a_pipe_kept_out_of_the_table(self):
        self.assertEqual(r.bare('@a-schaefers | ok'), '@​a-schaefers \\| ok')

    def test_the_headline_follows_the_worst_state(self):
        ok = run('Build', [job('build')])
        bad = run('Build', [job('build', conclusion='failure')], conclusion='failure')
        going = run('Workers', [job('check', 'in_progress', None)], 'in_progress', None)
        waiting = run('Terraform', [job('apply', 'waiting', None)], 'waiting', None,
                      pending=[{'environment': 'terraform-production', 'reviewers': ['a-schaefers']}])
        self.assertTrue(r.headline([ok]).startswith('✅'))
        self.assertTrue(r.headline([ok, bad]).startswith('❌ 1 failing'))
        self.assertTrue(r.headline([ok, going]).startswith('🔄'))
        self.assertTrue(r.headline([ok, waiting]).startswith('⏸️'))
        self.assertTrue(r.headline([]).startswith('⏳'))


class TheComment(unittest.TestCase):
    PR = {'number': 14, 'head_sha': 'abc1234def', 'merged': True, 'merge_sha': 'fed9876abc', 'state': 'closed'}

    def comment(self):
        checks = [run('Build', [job('build', conclusion='failure', failed_step='Build the client', tail='Error: `x`\n```')],
                      conclusion='failure'),
                  run('Workers', [job('scope'), job('check', conclusion='skipped')])]
        deploy = [run('Terraform', [job('plan'), job('ask'), job('apply', 'waiting', None)], 'waiting', None,
                      pending=[{'environment': 'terraform-production', 'reviewers': ['a-schaefers']}],
                      plan='**Terraform plan: 1 change(s)**\n\n| a | b |\n|---|---|', ask=9)]
        return r.render(self.PR, checks, deploy, NOW)

    def test_one_comment_found_again_by_its_marker(self):
        self.assertTrue(self.comment().startswith(r.MARKER + '\n'))

    def test_it_shows_the_checks_the_failure_and_the_wait(self):
        body = self.comment()
        self.assertIn('**Checks** on `abc1234` — ❌ 1 failing', body)
        self.assertIn('| ❌ | Build | build ❌ | [#41](https://x/runs/7) · 6m 02s |', body)
        self.assertIn('failed at <i>Build the client</i>', body)
        self.assertIn('**Merged** as `fed9876` → production — ⏸️ waiting for a reviewer', body)
        self.assertIn('> ### [Review deployments →](https://x/runs/7)', body)
        self.assertIn('scripts/ci_approve.sh 7 --approve', body)
        self.assertIn('the ask: #9', body)
        self.assertIn('<details><summary>The plan under review</summary>', body)

    def test_it_writes_no_mention(self):
        body = outside_code(self.comment())
        self.assertNotRegex(body, r'@(?!​)\w', 'an edit that adds a mention notifies; the issue is the one ping')
        self.assertIn('a-schaefers', body, 'the reviewer is named, bare')

    def test_an_unmerged_pull_request_shows_its_checks_alone(self):
        body = r.render(dict(self.PR, merged=False, state='open'), [run('Build', [job('build')])], [], NOW)
        self.assertNotIn('**Merged**', body)
        self.assertIn('✅ all green', body)
        body = r.render(dict(self.PR, merged=False, state='closed'), [], [], NOW)
        self.assertIn('Closed without merging', body)

    def test_the_outcome_replaces_the_wait(self):
        done = run('Terraform', [job('plan'), job('apply')], approvals=[
            {'state': 'approved', 'user': 'a-schaefers', 'comment': 'one ruleset, as @reviewed', 'environments': ['terraform-production']}],
            plan='**Terraform plan: no changes.** Infrastructure matches the configuration.', ask=9)
        block = r.gate_block(done)
        self.assertIn('✅ **Approved** by a-schaefers at `terraform-production` — one ruleset, as @​reviewed · the ask: #9', block)
        self.assertNotIn('Review deployments', block)
        self.assertIn('**Terraform plan: no changes.**', block)
        self.assertNotIn('<details>', block, 'a one-line plan stands as a line')

    def test_it_stays_under_githubs_limit(self):
        huge = run('Terraform', [job('apply', 'waiting', None)], 'waiting', None,
                   pending=[{'environment': 'terraform-production', 'reviewers': []}], plan='x\n' * 200000)
        body = r.render(self.PR, [], [huge] * 5, NOW)
        self.assertLessEqual(len(body), r.BODY_CHARS + 200)


class TheLag(unittest.TestCase):
    """A run's `completed` event can arrive before the runs API stops calling it
    in progress; the merge's last run was reported "running" for good (2026-10-09)."""

    def fake_api(self, statuses):
        """The runs API answering each call with the next status for run 7."""
        calls = []
        def gh(path, *a, **kw):
            calls.append(path)
            st = statuses[min(len(calls), len(statuses)) - 1]
            return {'workflow_runs': [{'id': 7, 'status': st, 'conclusion': None if st != 'completed' else 'success'},
                                      {'id': 8, 'status': 'completed', 'conclusion': 'success'}]}
        old = r.gh
        r.gh = gh
        self.addCleanup(setattr, r, 'gh', old)
        return calls

    TRIGGER = {'id': 7, 'head_sha': 'abc', 'status': 'completed', 'conclusion': 'failure', 'updated_at': 'T',
               'name': 'merecat', 'workflow_id': 3, 'run_number': 9, 'event': 'push', 'html_url': 'u'}

    def test_the_api_is_asked_again_until_it_agrees(self):
        calls = self.fake_api(['in_progress', 'in_progress', 'completed'])
        runs = r.runs_for('abc', self.TRIGGER, pause=0)
        self.assertEqual(len(calls), 3)
        self.assertEqual([x['status'] for x in runs if x['id'] == 7], ['completed'])

    def test_the_payload_wins_when_the_api_never_does(self):
        self.fake_api(['in_progress'])
        (mine,) = [x for x in r.runs_for('abc', self.TRIGGER, tries=3, pause=0) if x['id'] == 7]
        self.assertEqual((mine['status'], mine['conclusion']), ('completed', 'failure'))

    def test_a_requested_event_or_another_commit_is_never_waited_for(self):
        calls = self.fake_api(['in_progress'])
        r.runs_for('abc', dict(self.TRIGGER, status='requested'), pause=0)
        r.runs_for('other-sha', self.TRIGGER, pause=0)
        r.runs_for('abc', None, pause=0)
        self.assertEqual(len(calls), 3, 'one call each: only a completed event on this commit waits')


class TheRuns(unittest.TestCase):
    def test_the_newest_run_of_each_workflow_on_the_event(self):
        runs = [
            {'id': 1, 'name': 'Build', 'workflow_id': 10, 'run_number': 5, 'run_attempt': 1, 'event': 'pull_request'},
            {'id': 2, 'name': 'Build', 'workflow_id': 10, 'run_number': 6, 'run_attempt': 1, 'event': 'pull_request'},
            {'id': 3, 'name': 'Build', 'workflow_id': 10, 'run_number': 6, 'run_attempt': 2, 'event': 'pull_request'},
            {'id': 4, 'name': 'Workers', 'workflow_id': 11, 'run_number': 9, 'run_attempt': 1, 'event': 'push'},
            {'id': 5, 'name': 'PR report', 'workflow_id': 12, 'run_number': 3, 'run_attempt': 1, 'event': 'pull_request'},
            {'id': 6, 'name': 'Terraform', 'workflow_id': 13, 'run_number': 2, 'run_attempt': 1, 'event': 'pull_request'},
        ]
        got = r.latest_per_workflow(runs, 'pull_request')
        self.assertEqual([x['id'] for x in got], [3, 6], 'the re-run attempt, ordered Build first, never itself')


if __name__ == '__main__':
    unittest.main()
