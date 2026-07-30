#!/usr/bin/env python3
"""Build the rarely-changing content pages from decoupled sources.

Each page lives as ONE source file under content/ — `<slug>.md` (YAML
frontmatter + markdown prose) or `<slug>.html` (frontmatter + a raw HTML
body for the dense pages markdown cannot cleanly express). Both render
through the SAME shared skeleton here, so the page chrome (head, the
generated nav + <main>, the footer, and the optional comments widget) is
single-sourced instead of copy-pasted into every hand page.

Build-time by design (the owner's ruling): the output is committed static
HTML, no-JS readable and indexable, soft-loaded by the Lit app shell exactly
like the hand pages it replaces — zero Worker/D1 cost. The nav + <main> come
from nav.html (nav.py's output), so a nav change still flows to every content
page on the next `make menu` (which runs nav.py then this).

Frontmatter keys: title (required), canon (optional epigraph line),
description (optional <meta>), comments (bool → the data-comments widget).
A migrated page is REMOVED from nav.py's PAGES so the two never both write it.
Deterministic (pandoc + fixed assembly) so committed output is byte-stable."""

import os
import subprocess
import sys

import yaml

ROOT = os.path.dirname(os.path.abspath(__file__))
CONTENT_DIR = os.path.join(ROOT, 'content')
# Keep in step with the comments.js cache-bust bump (the wordlists-style
# discipline): a content page with comments carries this exact include.
COMMENTS_V = 151


def split_frontmatter(text):
    """A leading `---\\n … \\n---\\n` YAML block, then the body."""
    if not text.startswith('---\n'):
        return {}, text
    end = text.find('\n---\n', 4)
    if end == -1:
        raise ValueError('unterminated frontmatter')
    fm = yaml.safe_load(text[4:end]) or {}
    return fm, text[end + 5:]


def render_markdown(body):
    """Markdown → HTML5 fragment. auto_identifiers OFF so hand-authored
    `{#id}` anchors stay authoritative (hand pages own their fragment ids;
    deeplink.js only touches the .unnumbered corpus, never these)."""
    r = subprocess.run(
        ['pandoc', '-f', 'markdown-auto_identifiers', '-t', 'html5'],
        input=body, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError('pandoc failed: ' + r.stderr)
    return r.stdout.rstrip('\n')


def build_page(slug, source_path, nav_block, footer_block):
    with open(source_path, encoding='utf-8') as f:
        fm, body = split_frontmatter(f.read())
    title = fm.get('title')
    if not title:
        raise ValueError(slug + ': frontmatter needs a title')
    is_html = source_path.endswith('.html')
    body_html = body.strip('\n') if is_html else render_markdown(body)

    head = (
        '<!doctype html>\n<html lang="en">\n<head>\n'
        '<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
        '<title>' + title + ' | Mere Catholicity</title>\n'
    )
    if fm.get('description'):
        head += ('<meta name="description" content="'
                 + fm['description'].replace('"', '&quot;') + '">\n')
    head += ('<link rel="icon" href="favicon.ico">\n'
             '<link rel="stylesheet" href="style.css">\n</head>\n<body>\n')

    parts = [head, nav_block, '\n']
    parts.append('<h1 class="home-title">' + title + '</h1>\n')
    if fm.get('canon'):
        parts.append('<p class="canon">' + fm['canon'] + '</p>\n')
    parts.append('\n' + body_html + '\n')
    if fm.get('comments'):
        parts.append('\n<section class="comments" data-comments></section>\n'
                     '<script defer src="comments.js?v=' + str(COMMENTS_V) + '"></script>\n')
    parts.append(footer_block + '</body>\n</html>\n')
    return ''.join(parts)


def main():
    only = set(sys.argv[1:])   # optional: build just these slugs
    nav_block = open(os.path.join(ROOT, 'nav.html'), encoding='utf-8').read()
    footer_block = open(os.path.join(ROOT, 'footer.html'), encoding='utf-8').read()
    if not os.path.isdir(CONTENT_DIR):
        print('no content/ dir yet; nothing to build')
        return
    built = []
    for name in sorted(os.listdir(CONTENT_DIR)):
        if not (name.endswith('.md') or name.endswith('.html')):
            continue
        slug = name.rsplit('.', 1)[0]
        if only and slug not in only:
            continue
        page = build_page(slug, os.path.join(CONTENT_DIR, name), nav_block, footer_block)
        out = os.path.join(ROOT, slug + '.html')
        with open(out, 'w', encoding='utf-8') as f:
            f.write(page)
        built.append(slug + '.html')
    print('content.py built:', ', '.join(built) if built else '(none)')


if __name__ == '__main__':
    main()
