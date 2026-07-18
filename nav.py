#!/usr/bin/env python3
"""Rebuild the site menus from nav.yml. Run via: make menu

Reads nav.yml, renders the nav markup the menu system (style.css + nav.js)
expects, writes it to nav.html (used by pandoc when building book.html),
and replaces the inline nav block in every page listed in PAGES.
"""
import html
import re
import sys

import yaml

PAGES = ["index.html", "resources.html"]
FRAGMENT = "nav.html"

TOGGLE = (
    '<button class="nav-toggle" aria-expanded="false" aria-controls="nav-list">'
    '<span class="nav-icon" aria-hidden="true">&#9776;</span>'
    '<span class="nav-label">Menu</span></button>'
)
BACK_ROW = '<li class="sub-back"><button class="back-btn" type="button">&#8592; Back</button></li>'


def render_items(items):
    out = []
    for item in items:
        if not isinstance(item, dict) or len(item) != 1:
            sys.exit(f"nav.yml: each item must be a single 'Title: destination' pair, got: {item!r}")
        ((title, dest),) = item.items()
        t = html.escape(str(title))
        if isinstance(dest, list):
            out.append('<li class="has-sub">')
            out.append(
                f'<button class="sub-toggle" aria-expanded="false">{t} '
                '<span aria-hidden="true">&#9662;</span></button>'
            )
            out.append('<ul class="sub">')
            out.append(BACK_ROW)
            out.extend(render_items(dest))
            out.append("</ul>")
            out.append("</li>")
        elif str(dest).strip().lower() == "soon":
            out.append(f'<li><span class="soon" title="coming soon">{t}</span></li>')
        else:
            out.append(f'<li><a href="{html.escape(str(dest), quote=True)}">{t}</a></li>')
    return out


def build_nav(items):
    lines = ['<nav class="site">', TOGGLE, '<ul class="nav-list" id="nav-list">']
    lines.extend(render_items(items))
    lines.extend(["</ul>", "</nav>", '<script defer src="nav.js"></script>'])
    return "\n".join(lines) + "\n"


def main():
    with open("nav.yml") as f:
        items = yaml.safe_load(f)
    if not isinstance(items, list):
        sys.exit("nav.yml must be a list of items")
    nav = build_nav(items)

    with open(FRAGMENT, "w") as f:
        f.write(nav)
    print("wrote", FRAGMENT)

    block = re.compile(r'<nav class="site">.*?<script defer src="nav\.js"></script>', re.S)
    for page in PAGES:
        with open(page) as f:
            src = f.read()
        new, n = block.subn(lambda _m: nav.strip(), src)
        if n != 1:
            sys.exit(f"{page}: expected exactly one nav block, found {n}")
        with open(page, "w") as f:
            f.write(new)
        print("updated", page)


if __name__ == "__main__":
    main()
