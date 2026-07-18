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


def build_nav(items):
    lines = ['<nav class="site">', TOGGLE, '<ul class="nav-list" id="nav-list">']
    for item in items:
        title, kind, payload, _col = parse_item(item)  # col is ignored on the top bar
        lines.extend(render_leaf(title, payload) if kind == "leaf" else render_sub(title, payload))
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
