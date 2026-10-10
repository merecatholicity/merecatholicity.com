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


def is_asker(job):
    return any(s.get('run') == 'scripts/ci_ask_review.sh' for s in job.get('steps', []))


def is_settler(job):
    return any(s.get('run') == 'scripts/ci_ask_review.sh close' for s in job.get('steps', []))


class EveryGateAsks(unittest.TestCase):
    """A run waiting on a reviewer says so to the reviewer (2026-10-08).

    GitHub notifies nobody of their own activity, and every run here is the
    owner's — so an apply sat at its gate unannounced until someone happened to
    look. Each gated job has a sibling that runs scripts/ci_ask_review.sh under
    the job's own token, and the bot's @mention, an "Approval needed" issue
    (2026-10-09; a commit comment until then), reaches the owner. A `settle`
    job after the gate closes it with the outcome. Both take `issues: write`,
    so each is a sparse checkout of the one script and one step that runs it.

    What would break silently: a new gated job (or a new reviewed environment)
    without its asker; an asker whose condition drifts from its gate's, so it
    asks for a wait that never comes or misses the one that does; an asker
    handed a secret or a write it does not need; an ask nobody settles.
    """

    def reviewed_environments(self):
        tf = read('terraform', 'github.tf')
        blocks = re.findall(r'resource "github_repository_environment" "\w+" \{(.*?)\n\}', tf, re.S)
        return {re.search(r'environment\s*=\s*"([^"]+)"', b).group(1) for b in blocks if 'reviewers {' in b}

    def test_every_gated_job_has_an_asker_with_its_condition(self):
        gated = self.reviewed_environments()
        self.assertEqual(gated, {'terraform-production', 'librarian-config'})
        seen = set()
        for name in sorted(os.listdir(WORKFLOWS)):
            jobs = workflow(name).get('jobs') or {}
            askers = [j for j in jobs.values() if is_asker(j)]
            for job_name, job in jobs.items():
                env = job.get('environment')
                env = env.get('name') if isinstance(env, dict) else env
                if env not in gated:
                    continue
                seen.add(env)
                twins = [a for a in askers if a.get('needs') == job.get('needs') and a.get('if') == job.get('if')]
                self.assertEqual(len(twins), 1, f'{name}: {job_name} waits on {env} and nobody asks')
                ask = next(k for k, j in jobs.items() if j is twins[0])
                self.assertEqual(twins[0]['outputs'], {'issue': '${{ steps.ask.outputs.issue }}'}, name)
                settlers = [j for j in jobs.values() if is_settler(j)
                            and j.get('needs') == [ask, job_name]]
                self.assertEqual(len(settlers), 1, f'{name}: the ask for {job_name} is never settled')
                settle = settlers[0]
                self.assertEqual(settle['if'], f"always() && needs.{ask}.outputs.issue != ''", name)
                env_vars = settle['steps'][1]['env']
                self.assertEqual(env_vars['ISSUE'], f'${{{{ needs.{ask}.outputs.issue }}}}', name)
                self.assertEqual(env_vars['RESULT'], f'${{{{ needs.{job_name}.result }}}}', name)
        self.assertEqual(seen, gated, 'every reviewed environment is waited on somewhere')

    def test_the_asker_holds_the_job_token_and_nothing_more(self):
        swept = 0
        for name in sorted(os.listdir(WORKFLOWS)):
            for job in (workflow(name).get('jobs') or {}).values():
                if not (is_asker(job) or is_settler(job)):
                    continue
                swept += 1
                self.assertNotIn('environment', job, name + ': the asker never waits itself')
                # the issue, and (2026-10-09) the pull request's report showing the wait
                self.assertEqual(job['permissions'], {'issues': 'write', 'pull-requests': 'write', 'actions': 'read'}, name)
                self.assertNotIn('secrets.', yaml.safe_dump(job), name)
                # the writes are for the ask and the report: nothing else runs beside them
                checkout, ask = job['steps']
                self.assertTrue(checkout['uses'].startswith('actions/checkout@'), name)
                self.assertEqual(checkout['with']['sparse-checkout'].split(),
                                 ['scripts/ci_ask_review.sh', 'scripts/ci_pr_report.py'], name)
                self.assertIs(checkout['with']['persist-credentials'], False, name)
                self.assertIn(ask['run'], ('scripts/ci_ask_review.sh', 'scripts/ci_ask_review.sh close'), name)
        self.assertEqual(swept, 4)

    def test_the_ask_shows_in_the_pull_requests_thread_and_never_fails_for_it(self):
        script = read('scripts', 'ci_ask_review.sh')
        self.assertIn('ci_pr_report.py" --sha', script)
        self.assertIn('|| echo "::warning::', script, 'a report that cannot be written never costs the ask')
        self.assertEqual(script.count('report "$'), 2, 'the ask and the settle each re-render the report')
        self.assertIn('${pr:+ · from #$pr}', script, 'the issue names the pull request it came from')

    def test_the_ask_is_an_issue_whose_title_says_so(self):
        script = read('scripts', 'ci_ask_review.sh')
        self.assertIn('title="Approval needed: $name"', script)
        self.assertIn('"repos/$repo/issues"', script)
        self.assertNotIn('/comments', script, 'a commit comment is titled by the commit, not the ask')
        self.assertRegex(read('terraform', 'github.tf'),
                         r'resource "github_repository" "site" \{[^}]*?has_issues\s*=\s*true')


def tf_block(kind, name):
    """The body of one Terraform resource block in terraform/github.tf."""
    m = re.search(r'^resource "%s" "%s" \{\n(.*?)^\}' % (kind, name), read('terraform', 'github.tf'), re.S | re.M)
    assert m, 'no resource %s.%s' % (kind, name)
    return m.group(1)


def workflow_names():
    return {workflow(n)['name']: n for n in sorted(os.listdir(WORKFLOWS))}


class ThePullRequestRoad(unittest.TestCase):
    """main takes no direct push; every change is a pull request (2026-10-09).

    A red Dependabot PR was merged with the ordinary button and took the Build on
    main down with it, and an agent's push went straight to production. Now a
    ruleset (terraform/github.tf) requires a pull request whose three checks
    passed, scripts/ship.sh is the road, and scripts/ci_pr_report.py keeps one
    report per PR from a workflow_run that never runs a PR's code.

    What would break silently: a required check whose workflow a path filter
    skips (the PR waits at "Expected" for ever, and someone reaches for a
    bypass); a required job that a failed `needs` skips into a pass; a check
    pinned to no app, so any commit status of that name passes it; a bypass
    actor appearing; a PR's check queued behind a deploy, or cancelled by
    another PR's; the report checking out a PR's code, holding a secret, or
    missing a workflow the merge runs.
    """

    def setUp(self):
        self.ruleset = tf_block('github_repository_ruleset', 'main')

    def required(self):
        return re.findall(r'required_check \{\s*context\s*=\s*"([^"]+)"\s*integration_id\s*=\s*(\d+)', self.ruleset)

    def test_main_takes_no_direct_push(self):
        for line in ('enforcement = "active"', 'include = ["~DEFAULT_BRANCH"]', 'deletion         = true',
                     'non_fast_forward = true', 'pull_request {', 'required_status_checks {'):
            self.assertIn(line, self.ruleset)
        self.assertNotIn('bypass_actors', self.ruleset, 'no bypass: the owner and the agents get the same rule')
        site = tf_block('github_repository', 'site')
        self.assertRegex(site, r'allow_auto_merge\s*=\s*true', 'scripts/ship.sh arms auto-merge')
        self.assertRegex(site, r'delete_branch_on_merge\s*=\s*true')

    def test_each_required_check_is_github_actions_own(self):
        checks = self.required()
        self.assertEqual(sorted(c for c, _ in checks), ['build', 'check', 'plan'])
        self.assertEqual({i for _, i in checks}, {'15368'}, 'a status of that name from anywhere else passes nothing')

    def test_every_required_check_reports_on_every_pull_request(self):
        owners = {}
        for name in sorted(os.listdir(WORKFLOWS)):
            wf = workflow(name)
            on = wf.get('on', wf.get(True))
            if not isinstance(on, dict) or 'pull_request' not in on:
                continue
            for job_name, job in wf['jobs'].items():
                owners.setdefault(job_name, []).append((name, on['pull_request'] or {}, job))
        for check, _ in self.required():
            self.assertEqual(len(owners.get(check, [])), 1, check + ': exactly one job a pull request runs carries this name')
            name, pr_filter, job = owners[check][0]
            self.assertFalse(set(pr_filter) & {'paths', 'paths-ignore', 'branches', 'branches-ignore'},
                             name + ': a filtered workflow never reports, and the PR waits at "Expected" for ever')
            if 'needs' in job:
                # a job whose need failed is SKIPPED, and GitHub counts a skip as a pass
                self.assertIn('!cancelled()', job['if'], name + ': a failed need must not skip it into a pass')
                self.assertNotIn("== 'yes'", job['if'], name + ': it runs unless told no, never only when told yes')

    def test_a_pull_requests_runs_are_its_own(self):
        for name in sorted(os.listdir(WORKFLOWS)):
            wf = workflow(name)
            if 'pull_request' not in triggers(wf):
                continue
            group = str((wf.get('concurrency') or {}).get('group', ''))
            self.assertIn('github.ref', group, name + ': a PR never queues behind a deploy or another PR')

    def test_the_workers_deploy_only_what_scope_said(self):
        jobs = workflow('workers.yml')['jobs']
        self.assertIn("needs.scope.outputs.workers == 'yes'", jobs['deploy']['if'])
        self.assertIn("needs.check.result == 'success'", jobs['deploy']['if'])
        self.assertIn('scripts/ci_scope.py workers', steps_text(jobs['scope']))
        (ship,) = [st for st in jobs['deploy']['steps'] if 'CONTACT' in (st.get('env') or {})]
        self.assertEqual(ship['env']['CONTACT'], '${{ needs.scope.outputs.contact }}')

    def test_the_report_runs_mains_code_and_holds_no_secret(self):
        wf = workflow('pr-report.yml')
        self.assertEqual(triggers(wf), {'workflow_run', 'workflow_dispatch'})
        self.assertEqual(wf['permissions'], {})
        self.assertNotIn('secrets.', read('.github', 'workflows', 'pr-report.yml'))
        (job,) = wf['jobs'].values()
        # a dispatch runs the chosen ref's code: only main's may hold the write token
        self.assertEqual(job['if'], "github.event_name == 'workflow_run' || github.ref == 'refs/heads/main'")
        self.assertEqual(job['permissions'], {'contents': 'read', 'actions': 'read', 'issues': 'read', 'pull-requests': 'write'})
        checkout, run = job['steps']
        self.assertTrue(checkout['uses'].startswith('actions/checkout@'))
        self.assertEqual(checkout['with'], {'persist-credentials': False, 'sparse-checkout': 'scripts/ci_pr_report.py',
                                            'sparse-checkout-cone-mode': False}, 'never a ref: never a pull request\'s code')
        self.assertIn('python3 scripts/ci_pr_report.py --event "$GITHUB_EVENT_PATH"', run['run'])
        self.assertIn("case \"$PR\" in ''|*[!0-9]*) echo \"::error::", run['run'], 'a dispatcher\'s text reaches the script only as a number')
        self.assertEqual(run['env']['PR'], '${{ inputs.pr }}', 'an input reaches the script through env, never spliced into it')
        self.assertNotRegex(run['run'], r'\$\{\{\s*(github\.event\.)?inputs\.')

    def test_the_report_hears_every_workflow_a_change_runs(self):
        wf = workflow('pr-report.yml')
        on = wf.get('on', wf.get(True))
        heard = set(on['workflow_run']['workflows'])
        runs = {n for n, f in workflow_names().items()
                if triggers(workflow(f)) & {'pull_request', 'push'} and f != 'pr-report.yml'}
        self.assertEqual(heard, runs)
        self.assertEqual(set(on['workflow_run']['types']), {'requested', 'completed'})

    def test_the_road_is_written_down(self):
        self.assertTrue('scripts/ship.sh' in read('CLAUDE.md'), 'CLAUDE.md names the road')
        ship = read('scripts', 'ship.sh')
        self.assertIn('refusing to ship from main', ship)
        self.assertIn('--auto', ship)
        self.assertNotIn('HEAD:main', ship)
        self.assertNotIn('HEAD:main', read('scripts', 'agent_worktree.sh'), 'no worktree is told to push to main')


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

    One Cloudflare credential, `CLOUDFLARE_ROOT_TOKEN`, and one GitHub credential,
    `GH_ROOT_TOKEN`. The narrower tokens they replaced did not cover Cache Rules,
    D1 write, Web Analytics write or Actions secrets, so those roads could not run
    at all and each gap cost a hand-minted credential.

    What would break silently: a retired name read again — the secret is gone, so
    the expression is the empty string and the road skips; a secret left unblanked
    in a workflow a pull request can trigger; an absent token answered with a
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

    def test_one_github_credential_in_the_whole_pipeline(self):
        names = set()
        for name in sorted(os.listdir(WORKFLOWS)):
            names |= set(re.findall(r'secrets\.(GH_\w+|TF_\w+|GITHUB_\w+)',
                                    read('.github', 'workflows', name)))
        self.assertEqual(names, {'GH_ROOT_TOKEN'})

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
