#!/usr/bin/env python3
"""Rebuild the site menus from nav.yml. Run via: make menu

Reads nav.yml, renders the nav markup the menu system (style.css + nav.js)
expects, writes it to nav.html (used by pandoc when building book.html),
and replaces the inline nav block in every page listed in PAGES.
"""
import html
import os
import re
import sys

import yaml

# nav.yml lives beside this script (in scripts/); read it relative to the
# script's own location, not the cwd.
NAV_YML = os.path.join(os.path.dirname(os.path.abspath(__file__)), "nav.yml")

# Hand-maintained pages whose nav block nav.py still rewrites in place. Every
# rarely-changing content page moved to the content/ pipeline (content.py owns
# its whole page, nav included, read from the generated nav.html) and left this
# list. What remains are the pages content.py deliberately does NOT own: the
# home page (its <head> carries og/twitter meta), the contact form (an async
# Turnstile script the extractor can't see), the dynamic board SPA, and the
# off-site interstitial.
PAGES = ["index.html", "contact.html", "community.html", "admin.html", "journal.html", "feed.html", "messages.html", "profile.html", "merecat-ai.html", "away.html", "kjv.html", "douay-rheims.html", "where-to-begin.html", "the-book.html"]
# The Makefile runs this from the repo root (`python scripts/nav.py`), so these
# paths are relative to the root: docs/ holds the built PAGES, and the generated
# nav fragment lives in partials/. (nav.yml is the exception — see NAV_YML above,
# read from beside this script in scripts/.)
FRAGMENT = "partials/nav.html"

TOGGLE = (
    '<button class="nav-toggle" aria-expanded="false" aria-controls="nav-list">'
    '<span class="nav-icon" aria-hidden="true">&#9776;</span>'
    '<span class="nav-label">Menu</span></button>'
)
BACK_ROW = '<li class="sub-back"><button class="back-btn" type="button">&#8592; Back</button></li>'


def parse_item(item):
    """Return (title, kind, payload, col) for one nav.yml entry."""
    if not isinstance(item, dict) or len(item) != 1:
        sys.exit(f"nav.yml: each item must be a single 'Title: destination' pair, got: {item!r}")
    ((title, val),) = item.items()
    col = 1
    if isinstance(val, dict):
        col = int(val.get("col", 1))
        if "items" in val:
            return title, "sub", val["items"], col
        if "dest" in val:
            return title, "leaf", str(val["dest"]), col
        sys.exit(f"nav.yml: '{title}' needs a 'dest' or 'items' key, got: {val!r}")
    if isinstance(val, list):
        return title, "sub", val, col
    return title, "leaf", str(val), col


def render_leaf(title, dest):
    t = html.escape(str(title))
    if dest.strip().lower() == "soon":
        return [f'<li><span class="soon" title="coming soon">{t}</span></li>']
    return [f'<li><a href="{html.escape(dest, quote=True)}">{t}</a></li>']


def render_sub(title, children):
    t = html.escape(str(title))
    lines = ['<li class="has-sub">']
    lines.append(
        f'<button class="sub-toggle" aria-expanded="false">{t} '
        '<span aria-hidden="true">&#9662;</span></button>'
    )
    lines.append('<ul class="sub">')
    lines.append(BACK_ROW)
    lines.append('<li class="sub-row">')
    cols = {}
    for child in children:
        ctitle, kind, payload, col = parse_item(child)
        rendered = render_leaf(ctitle, payload) if kind == "leaf" else render_sub(ctitle, payload)
        cols.setdefault(col, []).extend(rendered)
    for col in sorted(cols):
        lines.append('<ul class="sub-col">')
        lines.extend(cols[col])
        lines.append("</ul>")
    lines.append("</li>")
    lines.append("</ul>")
    lines.append("</li>")
    return lines


# The horizontal site menu (nav.site) is DISABLED for now: the app shell's left
# app-bar + Home launcher + Settings gear are the platform's navigation. The
# generating code below is intentionally KEPT (good code, the owner may want it
# back) — flip NAV_ENABLED to True and rerun `make menu` to restore it. See
# CLAUDE.md. The soft-nav content anchor (the nav.js <script> + <main>) is emitted
# either way, so nothing downstream breaks.
NAV_ENABLED = False


def build_nav(items):
    if not NAV_ENABLED:
        return '<script defer src="nav.js"></script>\n'
    lines = ['<nav class="site">', TOGGLE, '<ul class="nav-list" id="nav-list">']
    for item in items:
        title, kind, payload, _col = parse_item(item)  # col is ignored on the top bar
        lines.extend(render_leaf(title, payload) if kind == "leaf" else render_sub(title, payload))
    lines.extend(["</ul>", "</nav>", '<script defer src="nav.js"></script>'])
    return "\n".join(lines) + "\n"


def main():
    with open(NAV_YML) as f:
        items = yaml.safe_load(f)
    if not isinstance(items, list):
        sys.exit("nav.yml must be a list of items")
    nav = build_nav(items)
    # The app shell's content region opens right after the nav block on every
    # page (the includes and the block rewrite both carry it); the footer
    # includes and each hand page close it. nav.html is GENERATED — this line
    # is the single source of the <main> open. It carries class="prose", the
    # reading-typography surface (styles/04-base.css); platform component classes
    # override it (:where() keeps prose at zero element specificity).
    nav = nav.rstrip("\n") + '\n<main class="prose">\n'

    with open(FRAGMENT, "w") as f:
        f.write(nav)
    print("wrote", FRAGMENT)

    # Matches the nav block whether or not the <nav class="site"> menu is present
    # (NAV_ENABLED off ⇒ only the script+<main> anchor), so `make menu` stays
    # idempotent across the disable.
    block = re.compile(r'(?:<nav class="site">.*?</nav>\s*)?<script defer src="nav\.js"></script>(?:\s*<main[^>]*>)?', re.S)
    for page in PAGES:
        with open('docs/' + page) as f:
            src = f.read()
        new, n = block.subn(lambda _m: nav.strip(), src)
        if n != 1:
            sys.exit(f"{page}: expected exactly one nav block, found {n}")
        with open('docs/' + page, "w") as f:
            f.write(new)
        print("updated", page)


if __name__ == "__main__":
    main()
