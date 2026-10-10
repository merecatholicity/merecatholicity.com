#!/usr/bin/env python3
"""scripts/ci_pr_report.py — the pipeline's report on a pull request
(2026-10-09).

One comment per pull request, kept current by EDITING it: the checks on the
PR's head and, once it is merged, what the merge did on main — the deploy
runs, a gate waiting for its reviewer (the review link, the plan, the ask's
issue) and how it ended. `.github/workflows/pr-report.yml` runs this whenever
a pipeline run is requested or completes, and the gates' `ask` and `settle`
jobs run it when a gate starts and stops waiting (no run event marks that).
Each call renders the WHOLE comment from the API, so calls may arrive in any
order and a lost one is repaired by the next.

    scripts/ci_pr_report.py --event FILE   a workflow_run payload ($GITHUB_EVENT_PATH)
    scripts/ci_pr_report.py --sha SHA      every pull request this commit belongs to
    scripts/ci_pr_report.py --pr N         one pull request (by hand: gh workflow run
                                           pr-report.yml -f pr=N, which runs main's copy)
    ... --dry-run                          print the comment, post nothing

It reads the API through `gh` with the token it is handed (the job's: actions
read, pull-requests write) and never checks out or runs a pull request's
code; it holds no secret. Edits never notify (the ask's issue is the one
ping), so nothing here writes an @mention: a reviewer is named bare, and the
log tails sit in code blocks, where GitHub links no mention.

IT QUOTES ONLY A PULL REQUEST'S OWN RUNS (2026-10-09). Those hold no secret
by law (CICD.md principle 3, swept by test_pipeline_workflows.OneCredential),
so their log can carry nothing a credential could leak into. A merge's runs
on main DO hold the credentials: GitHub masks them in the log, but a comment
is emailed and can never be recalled, while a run's log stays in Actions,
where it can be deleted. So a failed deploy is named — its step and its link
— and its log is never copied here.

A FORK'S PULL REQUEST IS NOT REPORTED. Its checks run the workflows as its
author wrote them (a fork can rewrite .github/workflows in its own pull
request, read-only and secret-less but free to name its jobs and print what
it likes), so their names and logs are not repeated under the bot's name;
the checks tab shows them as they are. Only this repository's own branches —
which only its writers can push — get a report.
"""
import argparse
import datetime
import html
import io
import json
import os
import re
import subprocess
import sys
import time
import zipfile

MARKER = '<!-- mc-pipeline-report -->'
SELF = 'PR report'              # this workflow's own name: never reported on
ORDER = ['Build', 'Workers', 'Terraform', 'merecat']
PLAN_ARTIFACT = 'tf-plan-summary'
MAX_FAILED = 3                  # failed jobs whose log tail is shown
TAIL_LINES = 40
TAIL_CHARS = 6000
PLAN_CHARS = 20000
BODY_CHARS = 60000              # GitHub refuses a comment over 65536

REPO = os.environ.get('GITHUB_REPOSITORY') or 'merecatholicity/merecatholicity.com'
SERVER = os.environ.get('GITHUB_SERVER_URL') or 'https://github.com'

ICON = {
    'success': '✅', 'failure': '❌', 'timed_out': '⌛', 'startup_failure': '❌',
    'cancelled': '⚪', 'skipped': '⏭️', 'neutral': '➖', 'stale': '⚪',
    'action_required': '⏸️', 'waiting': '⏸️', 'in_progress': '🔄',
    'queued': '⏳', 'requested': '⏳', 'pending': '⏳',
}
FAILED = {'failure', 'timed_out', 'startup_failure'}


# ---------------------------------------------------------------- the pure half

def state(status, conclusion):
    """One word for a run or a job: its conclusion when completed, else its status."""
    return (conclusion or 'neutral') if status == 'completed' else (status or 'queued')


def duration(start, end):
    try:
        a = datetime.datetime.fromisoformat(start.replace('Z', '+00:00'))
        b = datetime.datetime.fromisoformat(end.replace('Z', '+00:00'))
    except (AttributeError, ValueError):
        return ''
    s = max(0, int((b - a).total_seconds()))
    return '%dm %02ds' % (s // 60, s % 60) if s >= 60 else '%ds' % s


_TS = re.compile(r'^\ufeff?\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z ?')
_ANSI = re.compile(r'\x1b\[[0-9;]*[A-Za-z]')


def log_tail(text, lines=TAIL_LINES, chars=TAIL_CHARS):
    """The output of the step that failed, last lines first-to-last: from the
    last `##[error]` back to the step's own start (the `##[endgroup]` that
    closes its command echo), timestamps and colour codes stripped. None when
    the log carries no error line."""
    rows = [_ANSI.sub('', _TS.sub('', ln)) for ln in text.replace('\r\n', '\n').split('\n')]
    errs = [i for i, r in enumerate(rows) if '##[error]' in r]
    if not errs:
        return None
    last = errs[-1]
    start = last
    while start > 0 and last - start < 400:
        if rows[start - 1].startswith(('##[endgroup]', '##[group]')):
            break
        start -= 1
    window = [r.replace('##[error]', 'Error: ', 1) for r in rows[start:last + 1] if r.strip()]
    out = '\n'.join(window[-lines:])
    if len(out) > chars:
        out = '…' + out[-chars:]
    return out


def fence(text, lang='text'):
    """A code block no backtick run inside `text` can close."""
    runs = [len(m) for m in re.findall(r'`+', text)]
    tick = '`' * max(3, max(runs, default=0) + 1)
    return '%s%s\n%s\n%s' % (tick, lang, text, tick)


def bare(s):
    """Text outside a code block: a mention defused, table pipes escaped."""
    return str(s).replace('@', '@\u200b').replace('|', '\\|').replace('\n', ' ')


def headline(runs):
    """The section's verdict over its runs."""
    if not runs:
        return '⏳ no runs yet'
    words = [state(r['status'], r['conclusion']) for r in runs]
    jobs = [state(j['status'], j['conclusion']) for r in runs for j in r['jobs']]
    if any(w in FAILED for w in words + jobs):
        n = sum(1 for r in runs if state(r['status'], r['conclusion']) in FAILED
                or any(state(j['status'], j['conclusion']) in FAILED for j in r['jobs']))
        return '❌ %d failing' % n
    if any(r['pending'] for r in runs) or 'waiting' in jobs:
        return '⏸️ waiting for a reviewer'
    if any(w not in ('success', 'skipped', 'neutral', 'cancelled', 'stale') for w in words):
        return '🔄 running'
    if any(w == 'cancelled' for w in words):
        return '⚪ cancelled (a newer run carries it)'
    return '✅ all green'


def run_row(r):
    jobs = ' · '.join('%s %s' % (bare(j['name']), ICON.get(state(j['status'], j['conclusion']), '•'))
                      for j in r['jobs']) or '—'
    took = duration(r.get('started'), r.get('updated')) if r['status'] == 'completed' else ''
    link = '[#%s](%s)%s' % (r['run_number'], r['url'], (' · ' + took) if took else '')
    return '| %s | %s | %s | %s |' % (ICON.get(state(r['status'], r['conclusion']), '•'),
                                      bare(r['workflow']), jobs, link)


def table(runs):
    return '\n'.join(['| | Workflow | Jobs | Run |', '|:-:|---|---|---|'] + [run_row(r) for r in runs])


def failures(runs, budget):
    """<details> blocks for the failed jobs that carry a log tail, at most `budget`."""
    out = []
    for r in runs:
        for j in r['jobs']:
            if len(out) >= budget:
                return out
            if state(j['status'], j['conclusion']) not in FAILED:
                continue
            step = ' failed at <i>%s</i>' % html.escape(j['failed_step']) if j.get('failed_step') else ' failed'
            head = '<summary>❌ <b>%s › %s</b>%s</summary>' % (html.escape(r['workflow']), html.escape(j['name']), step)
            if j.get('tail'):
                body = fence(j['tail'])
            elif r.get('quotes'):
                body = '_The log has no error line — [open the job](%s)._' % j['url']
            else:
                body = ('_A run on main holds the pipeline\'s credentials, so its log is never copied here — '
                        '[open the job](%s); it stays in Actions._' % j['url'])
            out.append('<details>%s\n\n%s\n\n[the job’s log](%s)\n</details>' % (head, body, j['url']))
    return out


def gate_block(r):
    """A gated job waiting, or how its gate ended."""
    lines = []
    for p in r['pending']:
        who = ', '.join(p['reviewers']) or 'its required reviewer'
        lines += [
            '> [!IMPORTANT]',
            '> **%s waits for its reviewer** at `%s` (%s).' % (bare(r['workflow']), p['environment'], bare(who)),
            '> ### [Review deployments →](%s)' % r['url'],
            '> or `scripts/ci_approve.sh %s --approve "why"`%s' % (
                r['run_id'], (' · the ask: #%s' % r['ask']) if r.get('ask') else ''),
        ]
    if not r['pending'] and r['approvals']:
        a = r['approvals'][-1]
        verb = 'Approved' if a['state'] == 'approved' else 'Rejected'
        icon = '✅' if a['state'] == 'approved' else '⛔'
        line = '%s **%s** by %s at `%s`' % (icon, verb, bare(a['user']), ', '.join(a['environments']) or 'the gate')
        if a.get('comment'):
            line += ' — %s' % bare(a['comment'])
        if r.get('ask'):
            line += ' · the ask: #%s' % r['ask']
        lines.append(line)
    plan = r.get('plan')
    if plan and '\n' not in plan.strip():
        lines += ['', plan.strip()]          # "no changes" is one line
    elif plan:
        if len(plan) > PLAN_CHARS:
            plan = plan[:PLAN_CHARS] + '\n\n…(cut; the run has the whole summary)'
        lines += ['', '<details><summary>The plan under review</summary>\n', plan, '\n</details>']
    return '\n'.join(lines).strip('\n')


def render(pr, checks, deploy, now=None):
    """The whole comment for one pull request."""
    now = now or datetime.datetime.now(datetime.timezone.utc)
    parts = [MARKER, '### Pipeline', '',
             '**Checks** on `%s` — %s' % (pr['head_sha'][:7], headline(checks)), '',
             table(checks) if checks else '_No check has started yet._']
    budget = MAX_FAILED
    fails = failures(checks, budget)
    budget -= len(fails)
    for block in fails:
        parts += ['', block]
    if pr.get('merged'):
        parts += ['', '**Merged** as `%s` → production — %s' % ((pr.get('merge_sha') or '')[:7], headline(deploy)), '',
                  table(deploy) if deploy else '_The merge’s runs have not started yet._']
        for r in deploy:
            block = gate_block(r)
            if block:
                parts += ['', block]
        for block in failures(deploy, budget):
            parts += ['', block]
    elif pr.get('state') == 'closed':
        parts += ['', '_Closed without merging: nothing shipped._']
    parts += ['', '<sub>updated %s · scripts/ci_pr_report.py</sub>' % now.strftime('%Y-%m-%d %H:%M UTC')]
    body = '\n'.join(parts)
    if len(body) > BODY_CHARS:
        body = body[:BODY_CHARS] + '\n\n…(cut at GitHub’s comment limit; the runs have the rest)'
    return body


# ---------------------------------------------------------------- the API half

def gh(path, method='GET', data=None, raw=False, ok404=False):
    """`gh api` — JSON (or bytes when raw); None for a 404 when ok404."""
    cmd = ['gh', 'api', '-X', method, path]
    if data is not None:
        cmd += ['--input', '-']
    p = subprocess.run(cmd, input=json.dumps(data).encode() if data is not None else None,
                       capture_output=True)
    if p.returncode != 0:
        err = p.stderr.decode(errors='replace')
        if ok404 and ('404' in err or 'Not Found' in err):
            return None
        raise RuntimeError('gh api %s %s: %s' % (method, path, err.strip()))
    if raw:
        return p.stdout
    out = p.stdout.decode()
    return json.loads(out) if out.strip() else None


def runs_for(sha, trigger=None, tries=7, pause=10):
    """The workflow runs for one commit, with the run that triggered this report
    as its own event says it is. A `completed` event can arrive before GitHub's
    runs API stops calling that run in progress (2026-10-09: the merge's last
    run, merecat, was reported "running" for good — no later event came to
    repair it), so the API is asked again until it agrees, and the payload
    wins after that. Only `completed` is waited for: a `requested` event is
    routinely behind the API, never ahead of it."""
    waiting = bool(trigger) and trigger.get('head_sha') == sha and trigger.get('status') == 'completed'
    for attempt in range(tries if waiting else 1):
        runs = gh('repos/%s/actions/runs?head_sha=%s&per_page=100' % (REPO, sha))['workflow_runs']
        mine = [r for r in runs if r['id'] == (trigger or {}).get('id')]
        if not waiting or (mine and mine[0]['status'] == 'completed'):
            return runs
        if attempt < tries - 1:
            time.sleep(pause)
    for r in mine:
        r.update({k: trigger[k] for k in ('status', 'conclusion', 'updated_at', 'run_started_at') if k in trigger})
    if not mine:
        runs.append(trigger)
    return runs


def latest_per_workflow(runs, event):
    best = {}
    for r in runs:
        if r.get('event') != event or r.get('name') == SELF:
            continue
        k = r['workflow_id']
        if k not in best or (r['run_number'], r.get('run_attempt', 1)) > (best[k]['run_number'], best[k].get('run_attempt', 1)):
            best[k] = r
    rank = {n: i for i, n in enumerate(ORDER)}
    return sorted(best.values(), key=lambda r: (rank.get(r['name'], len(ORDER)), r['name']))


def failed_step(job):
    for s in job.get('steps') or []:
        if s.get('conclusion') in FAILED:
            return s.get('name')
    return None


def plan_of(run_id):
    arts = gh('repos/%s/actions/runs/%s/artifacts' % (REPO, run_id), ok404=True) or {}
    for a in arts.get('artifacts', []):
        if a.get('name') == PLAN_ARTIFACT and not a.get('expired'):
            blob = gh('repos/%s/actions/artifacts/%s/zip' % (REPO, a['id']), raw=True, ok404=True)
            if blob:
                with zipfile.ZipFile(io.BytesIO(blob)) as z:
                    names = [n for n in z.namelist() if n.endswith('.md')]
                    if names:
                        return z.read(names[0]).decode('utf-8', errors='replace').strip()
    return None


def ask_issue_of(run_id):
    """The "Approval needed" issue scripts/ci_ask_review.sh opened for this run."""
    issues = gh('repos/%s/issues?state=all&creator=%s&sort=created&direction=desc&per_page=30'
                % (REPO, 'github-actions%5Bbot%5D'), ok404=True) or []
    for i in issues:
        if 'pull_request' not in i and ('/actions/runs/%s' % run_id) in (i.get('body') or ''):
            return i['number']
    return None


def view(r, tails_left, pause=5):
    """A run as the renderer reads it; fetches a failed job's log while `tails_left`
    allows — only for a pull request's run, never a deploy's (see the module's head)."""
    quotes = r.get('event') == 'pull_request'
    for attempt in range(4):
        jobs = (gh('repos/%s/actions/runs/%s/jobs?filter=latest&per_page=100' % (REPO, r['id'])) or {}).get('jobs', [])
        # the jobs API can lag its run's completion the same way the runs API lags the event
        if r['status'] != 'completed' or all(j['status'] == 'completed' for j in jobs) or attempt == 3:
            break
        time.sleep(pause)
    out_jobs = []
    for j in jobs:
        js = {'name': j['name'], 'status': j['status'], 'conclusion': j.get('conclusion'),
              'url': j.get('html_url') or r['html_url'], 'failed_step': failed_step(j), 'tail': None}
        # a pull request's runs hold no secret; a merge's runs on main hold them all
        if quotes and state(j['status'], j.get('conclusion')) in FAILED and tails_left[0] > 0:
            tails_left[0] -= 1
            log = gh('repos/%s/actions/jobs/%s/logs' % (REPO, j['id']), raw=True, ok404=True)
            js['tail'] = log_tail(log.decode('utf-8', errors='replace')) if log else None
        out_jobs.append(js)
    pending, approvals, plan, ask = [], [], None, None
    gated = any(j['status'] == 'waiting' for j in jobs) or r.get('status') == 'waiting'
    if gated:
        for p in gh('repos/%s/actions/runs/%s/pending_deployments' % (REPO, r['id']), ok404=True) or []:
            pending.append({'environment': p['environment']['name'],
                            'reviewers': sorted(x['reviewer']['login'] for x in p.get('reviewers', [])
                                                if x.get('type') == 'User')})
    for a in gh('repos/%s/actions/runs/%s/approvals' % (REPO, r['id']), ok404=True) or []:
        approvals.append({'state': a['state'], 'user': a['user']['login'], 'comment': (a.get('comment') or '').strip(),
                          'environments': [e['name'] for e in a.get('environments', [])]})
    if r['name'] == 'Terraform' and r.get('event') == 'push':
        plan = plan_of(r['id'])
    if pending or approvals:
        ask = ask_issue_of(r['id'])
    return {'workflow': r['name'], 'quotes': quotes, 'run_id': r['id'], 'run_number': r['run_number'], 'url': r['html_url'],
            'status': r['status'], 'conclusion': r.get('conclusion'), 'started': r.get('run_started_at'),
            'updated': r.get('updated_at'), 'jobs': out_jobs, 'pending': pending, 'approvals': approvals,
            'plan': plan, 'ask': ask}


def prs_of(sha):
    pulls = gh('repos/%s/commits/%s/pulls' % (REPO, sha), ok404=True) or []
    return [p['number'] for p in pulls if (p.get('base') or {}).get('repo', {}).get('full_name') == REPO]


def report(number, dry_run=False, trigger=None):
    pr = gh('repos/%s/pulls/%s' % (REPO, number))
    if ((pr.get('head') or {}).get('repo') or {}).get('full_name') != REPO:
        print('#%s comes from a fork (or a deleted one) — not reported' % number)
        return
    info = {'number': number, 'head_sha': pr['head']['sha'], 'merged': bool(pr.get('merged')),
            'merge_sha': pr.get('merge_commit_sha'), 'state': pr.get('state')}
    tails = [MAX_FAILED]
    runs = runs_for(info['head_sha'], trigger)
    checks = [view(r, tails) for r in latest_per_workflow(runs, 'pull_request')]
    deploy = []
    if info['merged'] and info['merge_sha']:
        runs = runs_for(info['merge_sha'], trigger)
        deploy = [view(r, tails) for r in latest_per_workflow(runs, 'push')]
    body = render(info, checks, deploy)
    if dry_run:
        print(body)
        return
    upsert(number, body)


def upsert(number, body):
    """Edit the report in place (an edit notifies nobody); create it once."""
    mine = []
    for page in (1, 2, 3):
        batch = gh('repos/%s/issues/%s/comments?per_page=100&page=%d' % (REPO, number, page)) or []
        mine += [c for c in batch if (c.get('body') or '').startswith(MARKER)]
        if len(batch) < 100:
            break
    if not mine:
        c = gh('repos/%s/issues/%s/comments' % (REPO, number), 'POST', {'body': body})
        print('reported on #%s: %s' % (number, c.get('html_url')))
        return
    keep, extra = mine[0], mine[1:]
    if keep.get('body') != body:
        gh('repos/%s/issues/comments/%s' % (REPO, keep['id']), 'PATCH', {'body': body})
    for c in extra:   # two runs raced to create it: one comment stands
        gh('repos/%s/issues/comments/%s' % (REPO, c['id']), 'DELETE', ok404=True)
    print('report on #%s current: %s' % (number, keep.get('html_url')))


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument('--event', help='a workflow_run event payload (GITHUB_EVENT_PATH)')
    g.add_argument('--sha', help='report on every pull request this commit belongs to')
    g.add_argument('--pr', type=int, help='report on one pull request')
    ap.add_argument('--dry-run', action='store_true', help='print the comment instead of posting it')
    a = ap.parse_args(argv)
    trigger = None
    if a.pr:
        numbers = [a.pr]
    elif a.sha:
        numbers = prs_of(a.sha)
    else:
        with open(a.event, encoding='utf-8') as f:
            run = json.load(f).get('workflow_run') or {}
        trigger = run if run.get('id') else None
        numbers = [p['number'] for p in run.get('pull_requests') or []
                   if (p.get('base') or {}).get('repo', {}).get('url', '').endswith('/repos/' + REPO)]
        if not numbers and run.get('head_sha'):
            numbers = prs_of(run['head_sha'])
    if not numbers:
        print('no pull request carries this commit — nothing to report')
        return
    for n in sorted(set(numbers)):
        report(n, a.dry_run, trigger)


if __name__ == '__main__':
    main()
