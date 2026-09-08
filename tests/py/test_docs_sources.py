"""Everything the site serves must be either tracked in git or rebuildable.

`docs/` is a MIXTURE, and getting that wrong cost two broken builds on
2026-09-08. When the built site left git so that Pages could be deployed from
CI's artifact, a blanket `docs/` ignore took 581 files with it — including
nav.js and sw.js, which hold the entire PWA update lifecycle and exist nowhere
else. Narrowing it to `docs/*.html` then took the fifteen HAND-WRITTEN pages:
the whole app (index, community, messages, profile, feed, admin, merecat-ai,
journal), contact, away, the two prose pages, the Turnstile iframe, and
Google's site-verification file. None of those has a generator.

Both times the build failed rather than the site, because a failed build skips
the deploy. But both times the repository had genuinely lost source, and only a
CI run said so. This says so before the commit.

The rule: a file under docs/ is legitimately absent from git ONLY if something
can rebuild it. Otherwise it is source and must be tracked.
"""
import os
import subprocess
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DOCS = os.path.join(ROOT, 'docs')


def tracked():
    out = subprocess.run(['git', 'ls-files', 'docs'], capture_output=True,
                         text=True, cwd=ROOT).stdout.split()
    return {os.path.relpath(os.path.join(ROOT, p), DOCS) for p in out}


def buildable():
    """What some part of the build can regenerate, by where its source lives."""
    names = set()
    # content.py renders content/*.html into docs/
    content = os.path.join(ROOT, 'content')
    if os.path.isdir(content):
        names |= {n for n in os.listdir(content) if n.endswith('.html')}
    # The resources converters render <id>.tex into docs/<id>.html — but NOT
    # every .tex has an HTML stanza. kjv.tex and douay-rheims.tex build only
    # their PDFs; the pages of those names are small hand-written landing pages
    # whose text is fetched client-side from kjv.json/dr.json. Assuming the
    # mapping held is how they were nearly lost.
    PDF_ONLY = {'kjv.html', 'douay-rheims.html'}
    res = os.path.join(ROOT, 'resources')
    if os.path.isdir(res):
        names |= {n[:-4] + '.html' for n in os.listdir(res)
                  if n.endswith('.tex') and n[:-4] + '.html' not in PDF_ONLY}
    # the book, the bundles, the stylesheet and the generated data files
    names |= {'book.html', 'bishop-presbyter.html', 'app.js', 'comments.js',
              'style.css', 'version.json', 'pdfs.txt', 'sitemap.xml',
              'library-order.json', 'kjv.json', 'dr.json',
              os.path.join('emoji', 'emoji-data.json'),
              os.path.join('avatars', 'presets', 'index.json')}
    return names


class DocsIsSourceOrOutput(unittest.TestCase):
    def test_nothing_served_is_both_untracked_and_unbuildable(self):
        if not os.path.isdir(DOCS):
            self.skipTest('docs/ has not been built here')
        have, can = tracked(), buildable()
        orphans = []
        for root, dirs, files in os.walk(DOCS):
            dirs[:] = [d for d in dirs if d != '.git']
            for name in files:
                rel = os.path.relpath(os.path.join(root, name), DOCS)
                if rel in have or rel.replace(os.sep, '/') in have:
                    continue
                if name in can or rel in can:
                    continue
                if name.endswith('.pdf'):
                    continue        # published to R2; docs/pdfs.txt is the record
                orphans.append(rel)
        self.assertEqual(sorted(orphans), [],
                         'served files that are neither tracked nor rebuildable — '
                         'they are source and .gitignore is eating them:\n  '
                         + '\n  '.join(sorted(orphans)))

    def test_the_hand_written_pages_are_tracked(self):
        """Named explicitly, because losing them is what broke the build: none
        has a generator, and the app is unusable without them."""
        have = tracked()
        for page in ('index.html', 'community.html', 'messages.html', 'profile.html',
                     'feed.html', 'admin.html', 'merecat-ai.html', 'journal.html',
                     'contact.html', 'away.html', 'turnstile.html',
                     'kjv.html', 'douay-rheims.html'):
            self.assertIn(page, have, page + ' is hand-written and must stay in git')

    def test_the_unbundled_client_scripts_are_tracked(self):
        """nav.js and sw.js carry the whole PWA update lifecycle and live ONLY
        here — deliberately outside the bundle, so a page running a stale app.js
        can still pump updates. They are not output."""
        have = tracked()
        for js in ('nav.js', 'sw.js', 'index.js', 'flash.js', 'contact.js', 'away.js',
                   'deeplink.js', 'bible-reader.js',
                   'tweetnacl.min.js', 'lamejs.min.js', 'qr.min.js'):
            self.assertIn(js, have, 'docs/' + js + ' is source, not build output')

    def test_the_things_that_bind_the_domain_are_tracked(self):
        """Losing CNAME from the served folder once unbound the custom domain
        and 404'd the whole site."""
        have = tracked()
        self.assertIn('CNAME', have)
        self.assertIn('.nojekyll', have)


if __name__ == '__main__':
    unittest.main()
