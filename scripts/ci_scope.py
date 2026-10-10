#!/usr/bin/env python3
"""scripts/ci_scope.py workers (--base SHA | --all) — does this run have a
worker to check and deploy? (2026-10-09)

Prints `workers=yes|no`, `contact=yes|no` and `why=…`, and appends them to
$GITHUB_OUTPUT when Actions sets it. .github/workflows/workers.yml runs it in
its `scope` job against a base the workflow chooses:

  * a pull request: the base it merges into (the merge commit's first parent);
  * a push to main: the commit of the LAST SUCCESSFUL Workers run on main —
    not the previous push. A run cancelled in a burst of merges, or a red one
    fixed by a commit that touches nothing here, is carried by the next push
    instead of waiting for the next worker change (2026-10-09: a fix to
    scripts/ left a wrangler bump undeployed until a hand dispatch). A run
    whose commit is OLDER than that (a re-run of an old failure) deploys
    nothing: it would put old code over new;
  * a dispatch: --all, both workers (it is how a hand redeploy is asked for).

What a worker is built from — more than its own directory, which is why the
old path filter missed two of these:

  * comments-worker/, contact-worker/ — the workers (and the D1 migrations);
  * purescript/ — the kernel the comments worker imports;
  * package.json, package-lock.json — wrangler and esbuild bundle them;
  * tsconfig.json, globals.d.ts — the check's type gate;
  * tests/_support/toolchain.json, scripts/toolchain.py — the purs that
    compiles the kernel;
  * scripts/writings.py, scripts/content.py — they generate Domain.Writings,
    which is compiled INTO the kernel: the comments whitelist
    (Domain.Comments.commentablePaths, the worker's PAGES);
  * content/, Makefile — what Domain.Writings is DETECTED from. Those change
    often and rarely change the list, so the list itself is compared at both
    ends: a new article (or a `comments: false`, a retitled page, a new book)
    redeploys the worker, whose comments switch would otherwise drop the new
    path in silence until some unrelated worker change; a typo fix does not
    restart the Durable Objects for nothing;
  * .github/workflows/workers.yml and this script — the road itself.

The contact worker is contact-worker/, the egress seal it imports from the
comments worker (comments-worker/src/egress.ts), the npm toolchain and the
road. tests/py/test_ci_scope.py walks both workers' import graphs and fails
when a file either imports lies outside these lists.
"""
import argparse
import os
import re
import subprocess
import sys
import tarfile
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

ROAD = (r'\.github/workflows/workers\.yml$', r'scripts/ci_scope\.py$')
TOOLCHAIN = (r'package\.json$', r'package-lock\.json$')
WORKERS = ROAD + TOOLCHAIN + (
    r'comments-worker/', r'contact-worker/', r'purescript/',
    r'tsconfig\.json$', r'globals\.d\.ts$',
    r'tests/_support/toolchain\.json$', r'scripts/toolchain\.py$',
    r'scripts/writings\.py$', r'scripts/content\.py$',
)
CONTACT = ROAD + TOOLCHAIN + (r'contact-worker/', r'comments-worker/src/egress\.ts$')
# what Domain.Writings is detected from (scripts/writings.py: detect)
WRITINGS_SOURCES = (r'content/', r'Makefile$')


def matches(path, patterns):
    return any(re.match(p, path) for p in patterns)


def git(*args):
    return subprocess.run(('git',) + args, cwd=ROOT, check=True, capture_output=True, text=True).stdout


def git_ok(*args):
    return subprocess.run(('git',) + args, cwd=ROOT, capture_output=True).returncode == 0


def writings_at(tree):
    """Domain.Writings' entries as detected from `tree` (a directory holding a
    Makefile and content/), by this checkout's own detector."""
    sys.path.insert(0, os.path.join(ROOT, 'scripts'))
    import writings  # noqa: E402  (imports content, which needs pyyaml)
    return writings.detect(tree)


def writings_changed(base):
    """Does the generated Domain.Writings differ between `base` and HEAD?"""
    with tempfile.TemporaryDirectory() as tmp:
        tar = subprocess.run(['git', 'archive', '--format=tar', base, '--', 'Makefile', 'content'],
                             cwd=ROOT, check=True, capture_output=True).stdout
        with tempfile.TemporaryFile() as f:
            f.write(tar)
            f.seek(0)
            with tarfile.open(fileobj=f) as t:
                t.extractall(tmp, filter='data')
        try:
            before = writings_at(tmp)
        except ValueError as e:
            return True, 'the base\'s writings did not detect (%s)' % e
    now = writings_at(ROOT)   # a ValueError here is the build's own error: let it fail the run
    if before != now:
        gone = sorted({p for p, _t, _k in before} - {p for p, _t, _k in now})
        new = sorted({p for p, _t, _k in now} - {p for p, _t, _k in before})
        bits = (['new: ' + ', '.join(new)] if new else []) + (['gone: ' + ', '.join(gone)] if gone else [])
        return True, 'Domain.Writings changed (%s)' % ('; '.join(bits) or 'a title or kind')
    return False, ''


def decide(changed, writings_check):
    """(workers, contact, why) for a list of changed paths. `writings_check` is
    called (no arguments) only when a writings source changed and nothing
    else has already decided; it answers (changed, why)."""
    direct = [p for p in changed if matches(p, WORKERS)]
    contact = any(matches(p, CONTACT) for p in changed)
    if direct:
        more = ' and %d more' % (len(direct) - 1) if len(direct) > 1 else ''
        return True, contact, 'a worker input changed: %s%s' % (direct[0], more)
    if any(matches(p, WRITINGS_SOURCES) for p in changed):
        changed_list, why = writings_check()
        if changed_list:
            return True, contact, why
        return False, contact, 'content/ or the Makefile changed, and the writings the worker whitelists did not'
    return False, contact, 'nothing a worker is built from changed'


def scope(base):
    """(workers, contact, why) for HEAD against `base`."""
    head = git('rev-parse', 'HEAD').strip()
    if not git_ok('cat-file', '-e', base + '^{commit}'):
        return True, True, 'the base %s is not in this history — shipping both' % base[:12]
    base = git('rev-parse', base).strip()
    if base == head:
        return False, False, 'this commit is the one last shipped'
    if git_ok('merge-base', '--is-ancestor', head, base):
        return False, False, 'this commit is older than the last one shipped (%s) — never old code over new' % base[:12]
    if not git_ok('merge-base', '--is-ancestor', base, head):
        return True, True, 'the base %s is not an ancestor of this commit — shipping both' % base[:12]
    changed = [p for p in git('diff', '--name-only', base, head).split('\n') if p]
    return decide(changed, lambda: writings_changed(base))


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('what', choices=['workers'])
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument('--base', help='decide against BASE..HEAD')
    g.add_argument('--all', action='store_true', help='everything (a dispatch)')
    a = ap.parse_args(argv)
    if a.all:
        workers, contact, why = True, True, 'a dispatch ships both workers'
    else:
        workers, contact, why = scope(a.base)
    out = 'workers=%s\ncontact=%s\nwhy=%s\n' % ('yes' if workers else 'no', 'yes' if contact else 'no', why)
    sys.stdout.write(out)
    if os.environ.get('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'], 'a', encoding='utf-8') as f:
            f.write(out)


if __name__ == '__main__':
    main()
