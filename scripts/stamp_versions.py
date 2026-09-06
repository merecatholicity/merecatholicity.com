#!/usr/bin/env python3
"""Stamp the ?v= cache keys from the built files' own content hashes.

The manual bump law (edit a bundle, remember to bump its ?v= by hand) caused
several self-inflicted stale-cache incidents. This makes the bump impossible
to forget: each versioned asset's key is a NUMBER derived from its content
(sha256 head as decimal, so sw.js's v=\\d versioned-URL test still matches).
Unchanged content yields the same number, so rebuilds stay byte-identical and
git only churns when a bundle really changed.

Stamps:
  app.js          -> docs/nav.js            (app.js?v=N)
  comments.js     -> docs/*.html            (comments.js?v=N) + scripts/content.py COMMENTS_V
  bible-reader.js -> docs/*.html            (bible-reader.js?v=N)
  deeplink.js     -> docs/nav.js            (deeplink.js?v=N)

Run by `make bundle` after the builds; idempotent and deterministic."""
import hashlib
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PARTIALS = os.path.join(ROOT, 'partials')
DOCS = os.path.join(ROOT, 'docs')


def key_for(path):
    with open(path, 'rb') as f:
        digest = hashlib.sha256(f.read()).hexdigest()
    return str(int(digest[:8], 16))


def sub_file(path, pattern, repl):
    with open(path, encoding='utf-8') as f:
        s = f.read()
    out, n = re.subn(pattern, repl, s)
    if n and out != s:
        with open(path, 'w', encoding='utf-8') as f:
            f.write(out)
        return True
    return False


def main():
    stamps = {
        'app.js': key_for(os.path.join(DOCS, 'app.js')),
        'comments.js': key_for(os.path.join(DOCS, 'comments.js')),
        'bible-reader.js': key_for(os.path.join(DOCS, 'bible-reader.js')),
        'deeplink.js': key_for(os.path.join(DOCS, 'deeplink.js')),
    }
    changed = []

    nav = os.path.join(DOCS, 'nav.js')
    if sub_file(nav, r'app\.js\?v=[0-9a-z]+', 'app.js?v=' + stamps['app.js']):
        changed.append('nav.js: app.js -> ' + stamps['app.js'])
    if sub_file(nav, r'deeplink\.js\?v=[0-9a-z]+', 'deeplink.js?v=' + stamps['deeplink.js']):
        changed.append('nav.js: deeplink.js -> ' + stamps['deeplink.js'])

    page_hits = {'comments.js': 0, 'bible-reader.js': 0}
    # partials/ too: book-tail.html carries its own comments.js?v= key, and a
    # pandoc rebuild copies it straight into docs/book.html. Stamping only docs/
    # meant the two fought every build — the stamp fixed the page, the next
    # `make html` put the stale key back — and book.html shipped comments.js
    # v=199 against a kernel many versions newer.
    targets = [(DOCS, n) for n in sorted(os.listdir(DOCS))]
    targets += [(PARTIALS, n) for n in sorted(os.listdir(PARTIALS))]
    for base, name in targets:
        if not name.endswith('.html'):
            continue
        p = os.path.join(base, name)
        if sub_file(p, r'comments\.js\?v=[0-9a-z]+', 'comments.js?v=' + stamps['comments.js']):
            page_hits['comments.js'] += 1
        if sub_file(p, r'bible-reader\.js\?v=[0-9a-z]+', 'bible-reader.js?v=' + stamps['bible-reader.js']):
            page_hits['bible-reader.js'] += 1
    for k, n in page_hits.items():
        if n:
            changed.append(k + ' -> ' + stamps[k] + ' on ' + str(n) + ' pages')

    # content.py stamps fresh page builds, so its constant must carry the same
    # key (a quoted string constant: the value is opaque to content.py).
    cp = os.path.join(ROOT, 'scripts', 'content.py')
    if sub_file(cp, r"COMMENTS_V = ['\"]?[0-9a-z]+['\"]?",
                "COMMENTS_V = '" + stamps['comments.js'] + "'"):
        changed.append('content.py COMMENTS_V -> ' + stamps['comments.js'])

    print('stamp_versions:', '; '.join(changed) if changed else 'all keys current')
    return 0


if __name__ == '__main__':
    sys.exit(main())
