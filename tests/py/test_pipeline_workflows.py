"""The pipeline's workflows hold no key (2026-09-17).

merecat.yml and ops-watch.yml opened the worker's pipeline doors with one
static secret, MC_INGEST_KEY, until the env disclosure published the worker's
copy of it. Now each job proves itself with the OIDC token GitHub signs for
its run (comments-worker/src/oidc.ts checks it; Domain.Pipeline reads it),
and the worker takes the persona and the dials only from a job that ran in
the `librarian-config` environment, which waits for a reviewer.

What would break silently: a workflow reading the retired secret again (it
works while the worker still honours it, then fails some night); a token
grant on a whole workflow, or on a job that calls no door; the config job
losing its environment, or the corpus job pushing the config again; a pull
request trigger on a workflow that can mint a door's token; the reviewer's
wait holding the daily ingest behind it; the audience or the environment name
drifting between the workflow, the script, the policy and Terraform.
"""
import os
import re
import sys
import unittest

import yaml

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
WORKFLOWS = os.path.join(ROOT, '.github', 'workflows')
sys.path.insert(0, os.path.join(ROOT, 'librarian'))
import ingest  # noqa: E402

# the jobs that call a pipeline door, and so may ask GitHub for a token
DOOR_JOBS = {('merecat.yml', 'ingest'), ('merecat.yml', 'config-status'), ('merecat.yml', 'config'), ('ops-watch.yml', 'probe')}
# and the one that must for GitHub's own sake: actions/deploy-pages proves
# itself to Pages with the job's token (a token our policy refuses: another file)
GITHUB_JOBS = {('build.yml', 'deploy')}


def read(*parts):
    with open(os.path.join(ROOT, *parts), encoding='utf-8') as f:
        return f.read()


def workflow(name):
    return yaml.safe_load(read('.github', 'workflows', name))


def triggers(wf):
    on = wf.get('on', wf.get(True))   # YAML 1.1 reads a bare `on` as true
    return set(on) if isinstance(on, dict) else set([on] if isinstance(on, str) else on)


def steps_text(job):
    return '\n'.join(str(s.get('run', '')) for s in job.get('steps', []))


class NoKey(unittest.TestCase):
    def test_no_workflow_names_the_retired_key(self):
        for name in sorted(os.listdir(WORKFLOWS)):
            self.assertNotIn('MC_INGEST_KEY', read('.github', 'workflows', name), name)

    def test_only_the_jobs_that_call_a_door_may_ask_for_a_token(self):
        granted = set()
        for name in sorted(os.listdir(WORKFLOWS)):
            wf = workflow(name)
            self.assertNotIn('id-token', wf.get('permissions') or {}, name + ': never a whole workflow')
            for job_name, job in (wf.get('jobs') or {}).items():
                if (job.get('permissions') or {}).get('id-token') == 'write':
                    granted.add((name, job_name))
        self.assertEqual(granted, DOOR_JOBS | GITHUB_JOBS)

    def test_no_pull_request_reaches_a_token(self):
        for name in sorted({n for n, _ in DOOR_JOBS}):
            on = triggers(workflow(name))
            self.assertFalse({t for t in on if str(t).startswith('pull_request')}, name)
            self.assertTrue(on <= {'push', 'schedule', 'workflow_dispatch'}, name + ': only the events the policy admits')
        policy = read('purescript', 'src', 'Domain', 'Pipeline.purs')
        self.assertIn('events = [ "push", "schedule", "workflow_dispatch" ]', policy)


class TheReviewer(unittest.TestCase):
    def setUp(self):
        self.wf = workflow('merecat.yml')
        self.jobs = self.wf['jobs']

    def test_the_persona_and_the_dials_wait_for_the_reviewer(self):
        config = self.jobs['config']
        self.assertEqual(config['environment'], 'librarian-config')
        self.assertEqual(config['needs'], 'config-status')
        self.assertIn("needs.config-status.outputs.changed == 'true'", config['if'])
        self.assertRegex(steps_text(config), r'ingest\.py --config --api')
        self.assertRegex(steps_text(self.jobs['config-status']), r'ingest\.py --config-status --api')
        self.assertEqual(self.jobs['config-status']['outputs']['changed'], '${{ steps.status.outputs.changed }}')
        self.assertNotIn('environment', self.jobs['config-status'])
        ingest_run = steps_text(self.jobs['ingest'])
        self.assertIn('--push', ingest_run)
        self.assertNotRegex(ingest_run, r'--config\b', 'the corpus job never pushes the persona or the dials')

    def test_a_dispatchers_text_never_becomes_a_flag(self):
        run = steps_text(self.jobs['ingest'])
        self.assertIn('*[!a-z0-9,-]*) echo "::error::', run, '`only` is refused unless it is work ids')
        self.assertIn('set -- --only "$ONLY"', run)
        self.assertIn('python3 ingest.py --push --api "$MERECAT_API"', run)
        self.assertNotRegex(run, r'ingest\.py \$args', 'no unquoted argument string')
        for job in self.jobs.values():
            for step in job.get('steps', []):
                self.assertNotRegex(str(step.get('run', '')), r'\$\{\{\s*(github\.event\.)?inputs\.',
                                    'an input reaches a script through env, never spliced into it')

    def test_a_waiting_reviewer_never_holds_the_daily_ingest(self):
        self.assertNotIn('concurrency', self.wf, 'no run-wide group')
        self.assertNotEqual(self.jobs['ingest']['concurrency']['group'], self.jobs['config']['concurrency']['group'])
        self.assertIs(self.jobs['ingest']['concurrency']['cancel-in-progress'], False, 'an ingest is never cut off')

    def test_one_name_for_the_environment(self):
        self.assertRegex(read('terraform', 'github.tf'), r'environment\s*=\s*"librarian-config"')
        self.assertIn('"config" -> "librarian-config"', read('purescript', 'src', 'Domain', 'Pipeline.purs'))


class TheAudience(unittest.TestCase):
    def test_one_audience_everywhere(self):
        policy = read('purescript', 'src', 'Domain', 'Pipeline.purs')
        self.assertIn('audience = "merecatholicity-comments"', policy)
        self.assertEqual(ingest.OIDC_AUDIENCE, 'merecatholicity-comments')
        watch = read('.github', 'workflows', 'ops-watch.yml')
        self.assertIn('&audience=merecatholicity-comments', watch)

    def test_the_watchdog_sends_its_token_to_the_worker_alone(self):
        job = workflow('ops-watch.yml')['jobs']['probe']
        run = steps_text(job)
        self.assertIn('if [ "$HOST" != "$WORKER" ]; then', run)
        self.assertIn('echo "::add-mask::$tok"', run)
        self.assertEqual(re.findall(r'--data-binary (\S+)', run), ["'{\"probe\":true}'"], 'no key in the body')


class OneCredential(unittest.TestCase):
    """Every Cloudflare road runs on ONE account token (2026-09-19).

    Three scoped tokens plus a derived R2 pair became one, `CLOUDFLARE_ROOT_TOKEN`,
    so an agent never has to ask for a new grant: the Terraform token was blind to
    Cache Rules, D1 and Web Analytics, and each gap cost a hand-made credential.

    What would break silently: a retired name (`CLOUDFLARE_SITE_TOKEN`,
    `CLOUDFLARE_WORKERS_TOKEN`, `CLOUDFLARE_API_TOKEN`, `AWS_ACCESS_KEY_ID`) read
    again — the secret is gone, so the expression is the empty string and the road
    skips; an unblanked secret in a workflow a pull request can trigger, which now
    hands PR-authored code the whole account; an absent token answered with a
    notice and `exit 0`, which is a green run that shipped nothing.
    """

    # every secret a pull request must never reach, blanked in its own expression
    EXPR = re.compile(r'\$\{\{(.*?)\}\}', re.S)

    def test_one_cloudflare_credential_in_the_whole_pipeline(self):
        names = set()
        for name in sorted(os.listdir(WORKFLOWS)):
            names |= set(re.findall(r'secrets\.(CLOUDFLARE_\w+|AWS_\w+)',
                                    read('.github', 'workflows', name)))
        self.assertEqual(names, {'CLOUDFLARE_ROOT_TOKEN'})

    def test_a_pull_request_reaches_no_secret(self):
        swept = 0
        for name in sorted(os.listdir(WORKFLOWS)):
            if not {t for t in triggers(workflow(name)) if str(t).startswith('pull_request')}:
                continue
            for expr in self.EXPR.findall(read('.github', 'workflows', name)):
                if 'secrets.' not in expr:
                    continue
                swept += 1
                where = f'{name}: ${{{{{expr.strip()}}}}}'
                self.assertIn('github.event_name', expr, where)
                self.assertIn("|| ''", expr, where)
        # a sweep that reaches nothing passes for the wrong reason
        self.assertGreaterEqual(swept, 15, 'the sweep found no secret to check')

    def test_an_absent_token_is_red_and_never_quiet(self):
        seen = 0
        for name in sorted(os.listdir(WORKFLOWS)):
            for job in (workflow(name)['jobs'] or {}).values():
                for step in job.get('steps', []):
                    run = str(step.get('run', ''))
                    if 'CLOUDFLARE_ROOT_TOKEN not set' not in run:
                        continue
                    seen += 1
                    self.assertIn('::error::', run, name)
                    self.assertNotIn('exit 0', run, name + ': a green run that shipped nothing')
        self.assertGreaterEqual(seen, 4, 'every road that can find the token absent says so')


if __name__ == '__main__':
    unittest.main()
