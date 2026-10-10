"""What a worker is built from, and so when the pipeline ships one (2026-10-09).

scripts/ci_scope.py decides, for .github/workflows/workers.yml, whether a pull
request has a worker to check and whether a merge has one to deploy. Until then
a path filter decided, and it was narrower than the workers: the purs pin that
compiles their kernel, and the content/ pages whose list IS the comments
worker's whitelist (Domain.Writings, compiled into the kernel) — a new article's
comments switch was dropped by the worker in silence until some unrelated
worker change redeployed it. A burst of merges that cancelled a run, or a red
run fixed by a commit elsewhere, left a change undeployed until a hand dispatch.

What would break silently: a worker importing a file outside the scope's lists
(the deploy would miss its changes); the writings comparison going blind; a
re-run of an old commit shipping old code over new; a site-only change
restarting the Durable Objects for nothing.
"""
import os
import re
import subprocess
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
import ci_scope  # noqa: E402

IMPORT = re.compile(r'^\s*(?:import|export)\s+(type\s+)?[^;\'"]*?\bfrom\s*[\'"]([^\'"]+)[\'"]', re.M | re.S)
BARE_IMPORT = re.compile(r'^\s*import\s*[\'"]([^\'"]+)[\'"]', re.M)
DYNAMIC = re.compile(r'\bimport\(\s*[\'"]([^\'"]+)[\'"]\s*\)')


def closure(entry):
    """Every repository file a worker's bundle reads, from its entry: relative
    imports followed (type-only ones are erased from the bytes and skipped);
    the compiled kernel taken as the purescript/ sources it comes from; npm
    packages left to the lockfile."""
    seen, todo, kernel, packages = set(), [entry], False, set()
    while todo:
        rel = todo.pop()
        if rel in seen:
            continue
        seen.add(rel)
        with open(os.path.join(ROOT, rel), encoding='utf-8') as f:
            src = f.read()
        specs = [s for t, s in IMPORT.findall(src) if not t] + BARE_IMPORT.findall(src) + DYNAMIC.findall(src)
        for spec in specs:
            if not spec.startswith('.'):
                packages.add(spec)
                continue
            target = os.path.normpath(os.path.join(os.path.dirname(rel), spec))
            if target.startswith('purescript/output/'):
                kernel = True
                continue
            if os.path.isfile(os.path.join(ROOT, target)):
                todo.append(target)
    return seen, kernel, packages


class WhatAWorkerIsBuiltFrom(unittest.TestCase):
    def test_every_file_the_comments_worker_reads_is_in_scope(self):
        files, kernel, packages = closure('comments-worker/src/index.ts')
        # a sweep that reaches nothing passes for the wrong reason: it must reach the worker's corners
        self.assertGreater(len(files), 20)
        for corner in ('comments-worker/src/lib.ts', 'comments-worker/src/egress.ts', 'comments-worker/src/routes/dm.ts'):
            self.assertIn(corner, files)
        self.assertTrue(kernel, 'the worker imports the compiled kernel')
        outside = sorted(f for f in files if not ci_scope.matches(f, ci_scope.WORKERS))
        self.assertEqual(outside, [], 'a worker input the deploy would never notice: add it to ci_scope.WORKERS')
        self.assertTrue(ci_scope.matches('purescript/src/Domain/Comments.purs', ci_scope.WORKERS))
        for wiring in ('comments-worker/wrangler.jsonc', 'comments-worker/migrations/0001_init.sql',
                       'package-lock.json', 'tests/_support/toolchain.json', 'scripts/writings.py', 'scripts/content.py'):
            self.assertTrue(ci_scope.matches(wiring, ci_scope.WORKERS), wiring)
        self.assertTrue(packages, 'npm packages are the lockfile\'s')

    def test_every_file_the_contact_worker_reads_is_in_its_scope(self):
        files, kernel, _ = closure('contact-worker/src/index.ts')
        self.assertIn('comments-worker/src/egress.ts', files, 'the walk crossed into the seal it borrows')
        outside = sorted(f for f in files if not ci_scope.matches(f, ci_scope.CONTACT))
        self.assertEqual(outside, [], 'a contact worker input the deploy would never notice: add it to ci_scope.CONTACT')
        self.assertFalse(kernel, 'the contact worker took the kernel: purescript/ joins ci_scope.CONTACT')

    def test_the_kernel_carries_the_writings_so_their_sources_are_watched(self):
        with open(os.path.join(ROOT, 'purescript', 'src', 'Domain', 'Comments.purs'), encoding='utf-8') as f:
            comments = f.read()
        self.assertIn('import Domain.Writings', comments, 'if the kernel stops reading the writings, drop the content/ watch')
        for source in ('content/new-article.md', 'Makefile'):
            self.assertTrue(ci_scope.matches(source, ci_scope.WRITINGS_SOURCES), source)


class TheDecision(unittest.TestCase):
    def never(self):
        raise AssertionError('the writings were compared when nothing called for it')

    def test_a_worker_input_ships_the_worker(self):
        for path in ('comments-worker/src/lib.ts', 'purescript/src/Domain/Dm.purs', 'package-lock.json',
                     'tests/_support/toolchain.json', '.github/workflows/workers.yml', 'scripts/ci_scope.py'):
            workers, _contact, why = ci_scope.decide([path], self.never)
            self.assertTrue(workers, path)
            self.assertIn(path, why)

    def test_the_contact_worker_ships_with_its_own_inputs_only(self):
        self.assertTrue(ci_scope.decide(['comments-worker/src/egress.ts'], self.never)[1])
        self.assertTrue(ci_scope.decide(['contact-worker/src/index.ts'], self.never)[1])
        self.assertFalse(ci_scope.decide(['comments-worker/src/lib.ts'], self.never)[1])
        self.assertFalse(ci_scope.decide(['purescript/src/Domain/Dm.purs'], self.never)[1])

    def test_a_site_change_ships_no_worker(self):
        for path in ('scripts/vendor.ts', 'app/wire.ts', 'client/dm.ts', 'styles/main.css', 'docs/nav.js',
                     'docs/architecture/CICD.md', 'resources/Makefile', 'terraform/github.tf'):
            self.assertEqual(ci_scope.decide([path], self.never)[:2], (False, False), path)

    def test_a_content_change_ships_the_worker_only_when_the_writings_move(self):
        self.assertTrue(ci_scope.decide(['content/new.md'], lambda: (True, 'Domain.Writings changed (new: /new.html)'))[0])
        workers, _c, why = ci_scope.decide(['content/credo.md'], lambda: (False, ''))
        self.assertFalse(workers)
        self.assertIn('did not', why)


def tree(makefile_books, pages):
    """A minimal tree writings.detect() reads: a Makefile and content/."""
    d = tempfile.mkdtemp()
    os.makedirs(os.path.join(d, 'content'))
    calls = ''.join('\tpandoc x.md -o ../docs/%s.html --metadata title="%s" -A ../partials/book-tail.html\n' % b
                    for b in makefile_books)
    with open(os.path.join(d, 'Makefile'), 'w', encoding='utf-8') as f:
        f.write('book:\n' + calls)
    for name, text in pages.items():
        with open(os.path.join(d, 'content', name), 'w', encoding='utf-8') as f:
            f.write(text)
    return d


class TheWritingsComparison(unittest.TestCase):
    BOOK = [('book', 'Mere Catholicity')]
    CREDO = '---\ntitle: The Creed\n---\nWe believe.\n'

    def test_a_new_article_moves_the_list_and_a_typo_does_not(self):
        base = ci_scope.writings_at(tree(self.BOOK, {'credo.md': self.CREDO}))
        typo = ci_scope.writings_at(tree(self.BOOK, {'credo.md': self.CREDO.replace('believe', 'beleive')}))
        new = ci_scope.writings_at(tree(self.BOOK, {'credo.md': self.CREDO, 'altar.md': '---\ntitle: Altar\n---\n'}))
        optout = ci_scope.writings_at(tree(self.BOOK, {'credo.md': '---\ntitle: The Creed\ncomments: false\n---\n'}))
        retitled = ci_scope.writings_at(tree(self.BOOK, {'credo.md': self.CREDO.replace('The Creed', 'The Creeds')}))
        self.assertEqual(base, typo)
        for moved in (new, optout, retitled):
            self.assertNotEqual(base, moved)

    def test_the_base_is_read_from_git(self):
        if subprocess.run(['git', 'diff', '--quiet', 'HEAD', '--', 'content', 'Makefile'], cwd=ROOT).returncode:
            self.skipTest('content/ or the Makefile carries uncommitted changes here')
        self.assertEqual(ci_scope.writings_changed('HEAD'), (False, ''))


class TheBase(unittest.TestCase):
    """scope() against a base: the cases a burst of merges and a re-run make."""

    def fake(self, head, ancestors, diff):
        state = {'git': ci_scope.git, 'git_ok': ci_scope.git_ok}
        def git(*args):
            if args[0] == 'rev-parse':
                return (head if args[1] == 'HEAD' else args[1]) + '\n'
            if args[0] == 'diff':
                return '\n'.join(diff) + '\n'
            raise AssertionError(args)
        def git_ok(*args):
            if args[0] == 'cat-file':
                return not args[2].startswith('gone')
            if args[0] == 'merge-base':
                return (args[2], args[3]) in ancestors
            raise AssertionError(args)
        ci_scope.git, ci_scope.git_ok = git, git_ok
        self.addCleanup(lambda: (setattr(ci_scope, 'git', state['git']), setattr(ci_scope, 'git_ok', state['git_ok'])))

    def test_the_commit_last_shipped_ships_nothing(self):
        self.fake('h', set(), [])
        self.assertEqual(ci_scope.scope('h')[:2], (False, False))

    def test_an_older_commit_never_ships_over_a_newer(self):
        self.fake('old', {('old', 'new')}, ['comments-worker/src/lib.ts'])
        workers, contact, why = ci_scope.scope('new')
        self.assertEqual((workers, contact), (False, False))
        self.assertIn('older', why)

    def test_the_changes_since_the_last_deploy_ship(self):
        self.fake('h', {('b', 'h')}, ['docs/x.md', 'comments-worker/src/lib.ts'])
        self.assertEqual(ci_scope.scope('b')[:2], (True, False))

    def test_a_base_outside_the_history_ships_both(self):
        self.fake('h', set(), [])
        self.assertEqual(ci_scope.scope('gone123')[:2], (True, True))
        self.assertEqual(ci_scope.scope('elsewhere')[:2], (True, True))


if __name__ == '__main__':
    unittest.main()
