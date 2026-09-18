#!/usr/bin/env python3
"""An article page carries the comments MOUNT, never its 227 KB client
(2026-09-18).

A comments section on one of the site's own writings is admin-switched and ships
CLOSED — `Domain.Comments`, whose polarity is deliberate: only a listed path
opens anything. Until this change every such page carried an eager
`<script src="comments.js">`, so a reader of `credo.html` downloaded the whole
forum / DM / composer client, whereupon comments.js read `/config`, found its
path unlisted and rendered nothing. Measured on the day the change was made,
`comments.pages` was EMPTY: seven content pages were paying in full for nothing.

The decision now happens ahead of the download, in `app/shell.ts`
(`commentsClientIfOpen`), off the same edge-cached `/config` read comments.js
used to make for itself afterwards.

What breaks silently if this is not swept: a generator quietly re-adds the eager
tag (the two generators are `scripts/content.py` and `partials/book-tail.html`,
and the latter has fought the stamper before), and the regression is invisible —
the page works exactly as well, it just costs 227 KB more."""
import os
import re
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DOCS = os.path.join(ROOT, 'docs')

# The hand-written app pages: these ARE the client's pages and keep the eager
# tag. Every one is listed in .gitignore's tracked set and in scripts/nav.py.
APP_PAGES = {'admin.html', 'community.html', 'feed.html', 'journal.html',
             'merecat-ai.html', 'messages.html', 'profile.html'}

SCRIPT_RE = re.compile(r'<script[^>]+src=["\']comments\.js')


def served_pages():
    return sorted(n for n in os.listdir(DOCS) if n.endswith('.html'))


class CommentsClientIsLazy(unittest.TestCase):

    def test_only_the_app_pages_carry_the_client_eagerly(self):
        carriers = {n for n in served_pages()
                    if SCRIPT_RE.search(open(os.path.join(DOCS, n), encoding='utf-8',
                                             errors='replace').read())}
        self.assertGreater(len(served_pages()), 200, 'the served tree looks wrong')
        extra = sorted(carriers - APP_PAGES)
        self.assertEqual(extra, [], 
                         'these pages ship the 227 KB classic client eagerly for a comments '
                         'section that is admin-switched and ships closed — the shell loads it '
                         'only when /config lists the path (app/shell.ts commentsClientIfOpen):\n  '
                         + '\n  '.join(extra))
        missing = sorted(APP_PAGES - carriers)
        self.assertEqual(missing, [],
                         'an app page LOST its client — these are the client\'s own pages and '
                         'must carry it eagerly: ' + ', '.join(missing))

    def test_neither_generator_writes_the_tag(self):
        """content.py builds the ~21 content pages; book-tail.html is pandoc's
        tail for book.html. Either one re-adding the tag undoes this silently."""
        for rel in ('scripts/content.py', 'partials/book-tail.html'):
            src = open(os.path.join(ROOT, rel), encoding='utf-8').read()
            self.assertIsNone(SCRIPT_RE.search(src),
                              rel + ' writes an eager comments.js tag again — an article page '
                              'must carry the mount alone')
            self.assertIn('data-comments', src, rel + ' must still emit the MOUNT')

    def test_the_shell_can_name_the_script_at_runtime(self):
        """Injecting it needs its current ?v= key, which rides MC_ASSETS in
        nav.js (CLAUDE.md: runtime keys via window.mcAsset). Without the entry
        the shell would inject an unkeyed URL — it would work, and quietly lose
        cache-busting on the one file the reader is most likely to have stale."""
        stamper = open(os.path.join(ROOT, 'scripts', 'stamp_versions.py'), encoding='utf-8').read()
        runtime = re.search(r'RUNTIME_ASSETS = \[(.*?)\]', stamper, re.S)
        self.assertIsNotNone(runtime, 'RUNTIME_ASSETS not found in the stamper')
        self.assertIn("'comments.js'", runtime.group(1),
                      "comments.js must be a RUNTIME asset so window.mcAsset('comments.js') "
                      'can name it with its key')
        shell = open(os.path.join(ROOT, 'app', 'shell.ts'), encoding='utf-8').read()
        self.assertIn("mcAsset('comments.js')", shell,
                      'the shell must name the script through window.mcAsset')
        self.assertIn('commentsClientIfOpen', shell)


if __name__ == '__main__':
    unittest.main(verbosity=2)
