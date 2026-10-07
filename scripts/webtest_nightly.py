#!/usr/bin/env python3
"""scripts/webtest_nightly.py run | baseline | compare — the dev box's nightly
headless run against production (2026-09-16), the watchdog's leg that sees
what a probe cannot: pages rendering, the DM views, the shell's journeys.

  baseline   run every suite in SUITES and write webtest/nightly_baseline.json
             (each suite's PASS/FAIL counts and exit code as they stand — the
             known shape, admin-key failures included), in THIS checkout
  run        bring the nightly's own worktree (local/nightly-kit) to main and
             run main's copy of this script there: the suites, compared with
             main's baseline, the verdict printed and POSTed to the worker's
             ops door (the Health card shows it; a regression alerts through
             the Alerts channels). --no-report skips the POST; --here runs THIS
             checkout's kit as it stands instead (a branch's, before it merges)
  compare    (for tests) compare a results JSON with the baseline on stdin

The kit that judges the night is main's, whichever checkout the timer starts
in (2026-10-07, refresh_kit says why). A regression is a suite whose FAIL count
rose above the baseline, or which exited non-zero where the baseline had it
exiting 0 — on two runs running: a regressed suite is run once more, and only a
failure that comes back is told (2026-09-17); a kit that could not be brought
to main is told too, ahead of them. The suites listed are READ-ONLY against
production: they render and read; nothing here posts, messages or moderates.
The report carries the dev box's own narrow key (MC_OPS_REPORT_KEY from
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
    'test_library_parts',    # 2026-09-18: a volume is an index over its parts, and every
                             # address that worked before the split still reaches its text
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


def verdict(baseline, results, kit_note=''):
    """What the night tells: the regressions, led by the kit's note when the
    kit could not be brought to main — the one line that says the night was
    judged by something older than main (alone, it still alerts: a watchdog
    that cannot vouch for its own verdict is news)."""
    return ([kit_note] if kit_note else []) + compare(baseline, results)


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


# ---- the kit (2026-10-07) ---------------------------------------------------
# The timer starts this file in the dev box's own checkout, and that checkout
# moves only when someone pulls it. So a fix to the kit merged on GitHub never
# reached the night it was for: PR #3 named the edge's refused beacon report as
# noise and merged at 08:07 UTC, and the next night sent the same nine
# "regressions", line for line — the old kit's lines (a console list carrying
# cdn-cgi/rum; the hover check's old FAIL), which main's kit cannot write. A
# stale kit judging a newer site can as well pass what main's would fail, and
# nothing said which kit spoke. So `run` judges the night with MAIN's kit: it
# fetches main, rebuilds a worktree of the nightly's own from it, and runs
# main's copy of this file there with --here. This copy is only the door; past
# the refresh everything is main's — the suites, the baseline, this script.
# The shared checkout is never touched, so nothing half-written in it reaches
# the night either. The tree is local/nightly-kit, beside local/wt/ and not in
# it: an agent's worktree (scripts/agent_worktree.sh <name>) can never be the
# directory this deletes.
KIT_TREE = os.path.join('local', 'nightly-kit')
# Where main comes from: the checkout's own origin first, then the public
# repository, which needs no credential — a timer has no SSH agent and no
# terminal, so an origin that wants either still leaves a road to main.
KIT_REMOTES = ('origin', 'https://github.com/merecatholicity/merecatholicity.com.git')
# The git-ignored files the suites read beside their own source (flows.owner_key;
# live_kit and three suites' .testkeys). LINKED into the kit, never copied: one
# copy of a key on the box, and a rotated key is the kit's at once.
KIT_KEYS = ('librarian/.key', 'webtest/.testkeys')
# how a kit note ends when there was nothing better than the checkout itself
RAN_HERE = 'the suites ran in this checkout as it stands'


def git(args, cwd, timeout=120):
    """One git command that never asks for a credential and never holds the
    night past `timeout` (a timer has no terminal; an SSH that wants a
    passphrase fails there, and the public road is next). (True, stdout) when
    it worked, else (False, the first line git said)."""
    env = dict(os.environ, GIT_TERMINAL_PROMPT='0')
    try:
        p = subprocess.run(['git'] + list(args), cwd=cwd, env=env, capture_output=True,
                           text=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as e:
        return False, (str(e) or type(e).__name__).splitlines()[0][:160]
    if p.returncode == 0:
        return True, p.stdout.strip()
    said = [ln.strip() for ln in (p.stderr + '\n' + p.stdout).splitlines() if ln.strip()]
    return False, (said[0] if said else 'git exited %d' % p.returncode)[:160]


def git_home(root):
    """(the shared checkout, its git common dir) for `root` — the checkout
    itself, or the one a worktree hangs off (the reading agent_worktree.sh
    makes); (None, None) outside a repository."""
    ok, common = git(['rev-parse', '--git-common-dir'], root)
    if not ok:
        return None, None
    common = os.path.realpath(os.path.join(root, common))
    return os.path.dirname(common), common


def refresh_kit(root, remotes=KIT_REMOTES, pause=30):
    """Fetch main and rebuild the nightly's own worktree from it, whole: the
    old tree is removed (a file the last night left, an index lock a crash
    left, an edit — none survives) and added again, detached at main, with
    KIT_KEYS linked in from the shared checkout. Returns (tree, sha, note):
    `tree` is where the suites run, None for nowhere better than here; `note`
    is '' when the kit is main as fetched this minute, else the line the
    report leads with — a night judged by anything older is told, never
    passed off as tonight's. A note says its verdict first and git's own words
    last: the ops door keeps 200 characters of a line."""
    home, common = git_home(root)
    if not home:
        return None, None, 'kit NOT main: %s is no git checkout; the suites ran in it as it stands' % root[-80:]
    why = ''
    # every road, twice: a box woken for the timer can be a minute short of a network
    for remote in list(remotes) + ['', *remotes]:
        if not remote:
            time.sleep(pause)
            continue
        ok, said = git(['fetch', '--quiet', remote, '+refs/heads/main:refs/remotes/origin/main'], home)
        if ok:
            why = ''
            break
        why = why or said[:80]
    ok, sha = git(['rev-parse', '--verify', '--quiet', 'refs/remotes/origin/main^{commit}'], home)
    if not ok:
        return None, None, 'kit NOT main: main could not be fetched and this box has none; %s (git: %s)' % (RAN_HERE, why)
    tree = os.path.join(home, KIT_TREE)
    if os.path.lexists(tree):
        # Only ever a worktree of THIS repository whose top is this very path:
        # a plain directory there answers git with the shared checkout's top,
        # and a clone of its own with another common dir. Either is left alone.
        top = git(['rev-parse', '--show-toplevel'], tree)
        own = git(['rev-parse', '--git-common-dir'], tree)
        if not (top[0] and own[0] and os.path.realpath(top[1]) == os.path.realpath(tree)
                and os.path.realpath(os.path.join(tree, own[1])) == common):
            return None, None, 'kit NOT main: %s is not the nightly\'s worktree (move it aside); %s' % (KIT_TREE, RAN_HERE)
        ok, said = git(['worktree', 'remove', '--force', '--force', tree], home)
        if not ok:
            return None, None, 'kit NOT main: the old %s could not be removed; %s (git: %s)' % (KIT_TREE, RAN_HERE, said[:80])
    git(['worktree', 'prune'], home)
    ok, said = git(['worktree', 'add', '--quiet', '--detach', tree, sha], home)
    if not ok:
        return None, None, 'kit NOT main: %s could not be made at main; %s (git: %s)' % (KIT_TREE, RAN_HERE, said[:80])
    for rel in KIT_KEYS:
        src, dst = os.path.join(home, rel), os.path.join(tree, rel)
        if os.path.exists(src) and not os.path.lexists(dst):
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            os.symlink(src, dst)
    if why:
        return tree, sha, 'kit: main as this box last fetched it, %s; tonight\'s fetch failed (git: %s)' % (sha[:7], why)
    return tree, sha, ''


def runs_here(argv, root=ROOT):
    """True when this run judges with the kit it stands in: --here, or this IS
    the nightly's worktree (its copy never refreshes the tree it runs from)."""
    return '--here' in argv or os.path.realpath(root).endswith(os.sep + KIT_TREE)


def kit_lock(root):
    """One night at a time: a refresh deletes the tree a running night reads
    from. An exclusive lock beside the tree, held by the returned file for as
    long as it stays open; None when another run holds it."""
    import fcntl  # the dev box and CI are Linux; nothing else runs the nightly
    home = git_home(root)[0] or root
    try:
        os.makedirs(os.path.join(home, 'local'), exist_ok=True)
        lock = open(os.path.join(home, KIT_TREE + '.lock'), 'w')
    except OSError:
        return open(os.devnull)  # nowhere to keep a lock: the night runs unlocked rather than not at all
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        lock.close()
        return None
    return lock


def run_main_kit(argv, root=ROOT, refresh=refresh_kit, spawn=subprocess.call):
    """The door the timer opens: main's kit refreshed, main's copy of this file
    run in it with --here, its exit code returned. Returns (code, note): code
    None means there was no kit better than this checkout, and the run goes on
    here, with `note` leading its regressions."""
    try:
        tree, sha, note = refresh(root)
    except Exception as e:  # a door that fails must not cost the night its report: silence reads as last night's
        tree, sha, note = None, None, 'kit NOT main: the refresh failed (%s); %s' % (str(e)[:80], RAN_HERE)
    script = os.path.join(tree, 'scripts', 'webtest_nightly.py') if tree else ''
    if tree and not os.path.exists(script):
        tree, note = None, 'kit NOT main: main has no scripts/webtest_nightly.py; %s' % RAN_HERE
    if note:
        print(note)
    if tree is None:
        return None, note
    print('kit: main at %s, in %s' % (sha[:12], tree))
    sys.stdout.flush()  # the door's lines land above the night's, not after them
    env = dict(os.environ, MC_NIGHTLY_KIT_NOTE=note)
    return spawn([sys.executable, script] + list(argv[1:]) + ['--here'], env=env), note


def kit_line(root):
    """The commit the suites run at, for the run's own log."""
    ok, out = git(['log', '-1', '--date=short', '--format=%h %cd %s'], root)
    return out[:100] if ok else 'not a git checkout (%s)' % root


def main(argv):
    mode = argv[1] if len(argv) > 1 else 'run'
    if mode == 'compare':
        data = json.load(sys.stdin)
        for line in compare(data.get('baseline', {}), data.get('results', {})):
            print(line)
        return 0
    kit_note = os.environ.get('MC_NIGHTLY_KIT_NOTE', '')
    if mode != 'baseline' and not runs_here(argv):
        lock = kit_lock(ROOT)  # held until main returns, the in-place run included
        if lock is None:
            print('kit: another nightly run holds %s.lock; this one stands down' % KIT_TREE)
            return 1
        code, kit_note = run_main_kit(argv)
        if code is not None:
            return code
    print('kit: ' + kit_line(ROOT))
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
    regressions = verdict(baseline, results, kit_note)
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
