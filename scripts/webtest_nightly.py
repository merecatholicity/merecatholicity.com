#!/usr/bin/env python3
"""scripts/webtest_nightly.py run | baseline | compare — the dev box's nightly
headless run against production (2026-09-16), the watchdog's leg that sees
what a probe cannot: pages rendering, the DM views, the shell's journeys.

  baseline   run every suite in SUITES and write webtest/nightly_baseline.json
             (each suite's PASS/FAIL counts and exit code as they stand — the
             known shape, admin-key failures included)
  run        run the suites, compare with the baseline, print the verdict, and
             POST the report to the worker's ops door (the Health card shows
             it; a regression alerts through the Alerts channels). --no-report
             skips the POST.
  compare    (for tests) compare a results JSON with the baseline on stdin

A regression is a suite whose FAIL count rose above the baseline, or which
exited non-zero where the baseline had it exiting 0 — on two runs running: a
regressed suite is run once more, and only a failure that comes back is told
(2026-09-17). The suites listed are READ-ONLY against production: they render
and read; nothing here posts, messages or moderates. The report carries the
dev box's own narrow key (MC_OPS_REPORT_KEY from
~/.config/merecatholicity/ci.env — the worker's OPS_REPORT_KEY, which opens
the ops door and nothing else; 2026-09-17, when the pipeline's shared static
key was retired) and goes to the workers.dev hostname, the front door the
zone's bot rules do not guard."""
import json
import os
import re
import signal
import subprocess
import sys
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASELINE = os.path.join(ROOT, 'webtest', 'nightly_baseline.json')
DOOR = os.environ.get('MC_OPS_DOOR', 'https://merecatholicity-comments.support-609.workers.dev/api/comments/ops/report')
# Cloudflare answers Python-urllib's own user agent with 403 "error code: 1010",
# on the workers.dev host as on the zone: the first scheduled run's report
# (2026-09-17) never reached the door. A browser UA, as publish_pdfs.py sends.
UA = ('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) '
      'Chrome/128.0 Safari/537.36')
SUMMARY = re.compile(r'====\s*(\d+)\s+PASS\s+(\d+)\s+FAIL\s*====')
PASS_LINE = re.compile(r'^(PASS\b|  ok )')
FAIL_LINE = re.compile(r'^FAIL\b')

# read-only suites (webtest/test_*.py): render and read, never write
SUITES = [
    'test_worker_reads', 'test_dm_actions', 'test_topic_search', 'test_member_views',
    'test_hscroll', 'test_core_rank', 'test_richtext', 'test_store', 'test_tap',
    'test_theme_toggle', 'test_about_dialog', 'test_sheet_lock', 'test_ptr',
    'test_zoomproof', 'test_settings_page', 'test_turnstile_mount',
    'test_public_shapes',   # 2026-09-17: public answers keep their committed shape
    'test_badge_freshness',  # 2026-09-17: a fresh open never paints last visit's count
    'test_first_paint',      # 2026-09-17: a phone's first frame is already the app
]


def parse_summary(text):
    """A suite's verdict from its output: the '==== N PASS  M FAIL ====' banner
    where a suite prints one (test_worker_reads), else the count of its
    'PASS <check>' / '  ok <check>' and 'FAIL <check>' lines (every other
    suite's shape). None when the output has neither — the suite crashed
    before it checked anything."""
    text = text or ''
    m = SUMMARY.search(text)
    if m:
        return (int(m.group(1)), int(m.group(2)))
    lines = text.splitlines()
    passed = sum(1 for ln in lines if PASS_LINE.match(ln))
    failed = sum(1 for ln in lines if FAIL_LINE.match(ln))
    return (passed, failed) if (passed or failed) else None


def run_suite(name, timeout=900):
    t0 = time.time()
    # its own process group, so a suite killed at the timeout takes its
    # chromedriver and browser with it (they used to outlive it for hours)
    p = subprocess.Popen([sys.executable, os.path.join(ROOT, 'webtest', name + '.py')],
                         cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                         start_new_session=True)
    try:
        so, se = p.communicate(timeout=timeout)
        out, code = so + se, p.returncode
    except subprocess.TimeoutExpired:
        try:
            os.killpg(p.pid, signal.SIGKILL)
        except OSError:
            pass
        so, se = p.communicate()
        out, code = (so or '') + (se or '') + '\nTIMEOUT', 124
    s = parse_summary(out)
    fails = [ln.strip()[:160] for ln in out.splitlines() if ln.startswith('FAIL')]
    return {'pass': s[0] if s else 0, 'fail': s[1] if s else 0, 'exit': code,
            'summary': s is not None, 'secs': round(time.time() - t0, 1), 'fails': fails[:12]}


def compare(baseline, results):
    """Regressions: FAIL above the baseline's, or a non-zero exit where the
    baseline exited 0, or no summary where the baseline had one. A suite the
    baseline never saw is judged against zero. Returns a list of sentences."""
    out = []
    for name, r in results.items():
        b = baseline.get(name, {'fail': 0, 'exit': 0, 'summary': True})
        if r['fail'] > b.get('fail', 0):
            out.append('%s: %d FAIL (baseline %d): %s' % (name, r['fail'], b.get('fail', 0), '; '.join(r.get('fails') or [])[:300]))
        elif r['exit'] != 0 and b.get('exit', 0) == 0:
            out.append('%s: exited %d (baseline 0)' % (name, r['exit']))
        elif not r['summary'] and b.get('summary', True):
            out.append('%s: no summary line (crashed before the end)' % name)
    return out


def confirm(baseline, results, rerun):
    """Run each regressed suite once more (`rerun(name)`) and judge that run:
    a failure that does not come back (a GitHub Pages 503 minutes after a
    deploy, a tab the box starved) is weather, and the owner is told only what
    a human must act on. A suite clean on its re-run takes the re-run's result,
    keeping the first as `once`; one that fails again keeps its first result,
    so the regression is told in the words first seen. Returns the names clean
    on their re-run."""
    clean = []
    for name in list(results):
        if not compare(baseline, {name: results[name]}):
            continue
        again = rerun(name)
        if not compare(baseline, {name: again}):
            results[name] = dict(again, once=results[name])
            clean.append(name)
    return clean


def suite_line(name, r):
    """A suite as the report names it: `name pass/total`, and the first run's
    count when only its re-run was clean (the door keeps 80 characters)."""
    line = '%s %d/%d' % (name, r['pass'], r['pass'] + r['fail'])
    once = r.get('once')
    if once:
        line += ' (clean on a re-run; first %d/%d)' % (once['pass'], once['pass'] + once['fail'])
    return line


def load_baseline():
    try:
        with open(BASELINE) as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def report(results, regressions, key):
    body = {
        'key': key, 'source': 'webtest',
        'pass': sum(r['pass'] for r in results.values()),
        'fail': sum(r['fail'] for r in results.values()),
        'suites': [suite_line(n, r) for n, r in results.items()],
        'regressions': regressions,
    }
    req = urllib.request.Request(DOOR, data=json.dumps(body).encode(), headers={'Content-Type': 'application/json', 'User-Agent': UA}, method='POST')
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode())


def report_key():
    k = os.environ.get('MC_OPS_REPORT_KEY')
    if k:
        return k
    path = os.environ.get('MC_CI_ENV', os.path.expanduser('~/.config/merecatholicity/ci.env'))
    try:
        with open(path) as f:
            for ln in f:
                m = re.match(r'\s*(?:export\s+)?MC_OPS_REPORT_KEY=["\']?([^"\'\s]+)', ln)
                if m:
                    return m.group(1)
    except OSError:
        pass
    return None


def main(argv):
    mode = argv[1] if len(argv) > 1 else 'run'
    if mode == 'compare':
        data = json.load(sys.stdin)
        for line in compare(data.get('baseline', {}), data.get('results', {})):
            print(line)
        return 0
    results = {}
    for name in SUITES:
        r = run_suite(name)
        results[name] = r
        print('%-24s %3d PASS %3d FAIL  exit %d  %5.1fs%s' % (name, r['pass'], r['fail'], r['exit'], r['secs'], '' if r['summary'] else '  (no summary)'))
    if mode == 'baseline':
        with open(BASELINE, 'w') as f:
            json.dump({n: {'pass': r['pass'], 'fail': r['fail'], 'exit': r['exit'], 'summary': r['summary']} for n, r in results.items()}, f, indent=1, sort_keys=True)
            f.write('\n')
        print('baseline written: ' + BASELINE)
        return 0
    baseline = load_baseline()
    for name in confirm(baseline, results, run_suite):
        first = results[name]['once']
        print('%-24s clean on a re-run; the first run: %d PASS %d FAIL, exit %d%s' % (
            name, first['pass'], first['fail'], first['exit'],
            (': ' + '; '.join(first['fails']))[:300] if first['fails'] else ''))
    regressions = compare(baseline, results)
    total_pass = sum(r['pass'] for r in results.values())
    total_fail = sum(r['fail'] for r in results.values())
    print('%d PASS %d FAIL; %d regression(s)' % (total_pass, total_fail, len(regressions)))
    for line in regressions:
        print('REGRESSION ' + line)
    if '--no-report' not in argv:
        key = report_key()
        if not key:
            print('no MC_OPS_REPORT_KEY: not reported')
        else:
            try:
                print('reported: ' + json.dumps(report(results, regressions, key)))
            except Exception as e:  # the report is best effort; the run's verdict is above
                print('report failed: ' + str(e)[:200])
    return 1 if regressions else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
