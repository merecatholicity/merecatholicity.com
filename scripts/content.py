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

# This script lives in scripts/, so the repo root is one level up. Sources
# (content/, the partials/) and the built site (docs/) hang off the repo root.
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONTENT_DIR = os.path.join(ROOT, 'content')
# Keep in step with the comments.js cache-bust bump (the wordlists-style
# discipline): a content page with comments carries this exact include.
COMMENTS_V = '1247790746'

# Social-sharing defaults (Open Graph / Twitter cards). Every built page carries
# a correct per-page card so a shared link shows what the page IS, not a generic
# site blurb. Per-page overrides ride the frontmatter (`description`, `image`,
# `og_type`); absent those, these apply. The image is the branded book cover as a
# stopgap — a dedicated 1200x630 banner can replace DEFAULT_IMAGE later without
# touching any page.
SITE = 'https://merecatholicity.com'
SITE_NAME = 'Mere Catholicity'
DEFAULT_DESC = 'What has been believed everywhere, always, and by all.'
DEFAULT_IMAGE = 'cover.jpg'


def _esc(s):
    """HTML-attribute-safe escaping for meta content."""
    return (str(s).replace('&', '&amp;').replace('"', '&quot;')
            .replace('<', '&lt;').replace('>', '&gt;'))


def social_head(slug, title, description, image, og_type):
    """The per-page Open Graph + Twitter-card block for one content page.
    og:url is the page's own canonical URL; og:title is the clean title (the
    brand lives in og:site_name), so a shared card reads as the page itself."""
    url = SITE + '/' + slug + '.html'
    img = image if str(image).startswith('http') else SITE + '/' + image
    tags = [
        ('meta name="description"', description),
        ('meta property="og:type"', og_type),
        ('meta property="og:site_name"', SITE_NAME),
        ('meta property="og:title"', title),
        ('meta property="og:description"', description),
        ('meta property="og:url"', url),
        ('meta property="og:image"', img),
        ('meta name="twitter:card"', 'summary_large_image'),
        ('meta name="twitter:title"', title),
        ('meta name="twitter:description"', description),
        ('meta name="twitter:image"', img),
    ]
    return ''.join('<' + attr + ' content="' + _esc(val) + '">\n' for attr, val in tags)


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
    head += social_head(
        slug, title,
        fm.get('description') or DEFAULT_DESC,
        fm.get('image') or DEFAULT_IMAGE,
        fm.get('og_type') or 'article',
    )
    head += ('<link rel="icon" href="favicon.ico">\n'
             '<link rel="stylesheet" href="style.css">\n</head>\n<body>\n')

    parts = [head, nav_block]
    # A MARKDOWN source is pure prose: the template supplies the page's title
    # chrome (the home-title h1 and the optional canon epigraph). An HTML
    # source is a COMPLETE verbatim body that already carries its own h1/canon
    # (the dense doctrinal pages) — the template injects nothing into it, so it
    # renders byte-for-byte as authored. nav_block ends with "<main>\n", so a
    # single leading "\n" gives one blank line before the content either way.
    if not is_html:
        parts.append('\n<h1 class="home-title">' + title + '</h1>\n')
        if fm.get('canon'):
            parts.append('<p class="canon">' + fm['canon'] + '</p>\n')
    parts.append('\n' + body_html + '\n')
    if fm.get('comments'):
        parts.append('\n<section class="comments" data-comments></section>\n'
                     '<script defer src="comments.js?v=' + str(COMMENTS_V) + '"></script>\n')
    # extra per-page scripts (a page's own light JS: flash.js, index.js,
    # bible-reader.js, contact.js…). A string or a list of srcs; each becomes
    # a deferred include just before </main>, exactly as the hand pages carried.
    scripts = fm.get('scripts')
    if scripts:
        if isinstance(scripts, str):
            scripts = [scripts]
        for src in scripts:
            parts.append('<script defer src="' + src + '"></script>\n')
    parts.append(footer_block + '</body>\n</html>\n')
    return ''.join(parts)


def main():
    only = set(sys.argv[1:])   # optional: build just these slugs
    nav_block = open(os.path.join(ROOT, 'partials', 'nav.html'), encoding='utf-8').read()
    footer_block = open(os.path.join(ROOT, 'partials', 'footer.html'), encoding='utf-8').read()
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
        out = os.path.join(ROOT, 'docs', slug + '.html')
        with open(out, 'w', encoding='utf-8') as f:
            f.write(page)
        built.append(slug + '.html')
    print('content.py built:', ', '.join(built) if built else '(none)')


if __name__ == '__main__':
    main()
