#!/usr/bin/env python3
"""Verify that every internal link and anchor on the site resolves.

Scans every *.html in the repo root for href/src values, checks that each
internal target exists on disk, and checks that each #fragment points at a
real id in its target page. External http(s) links are not checked here
(curl them by hand when auditing; bot-blocking makes automation noisy).

Run: python linkcheck.py   (or: make check)
Exits nonzero listing every missing target with its referring pages, so a
build that leaves a page linking at nothing fails loudly instead of
shipping a 404. Added after Rule_of_St_Benedict.pdf and
Conferences_on_Prayer.pdf shipped as dead links in July 2026.
"""
import collections
import glob
import os
import re
import sys
import urllib.parse

os.chdir(os.path.dirname(os.path.abspath(__file__)))

refs = collections.defaultdict(set)   # target file -> referring pages
frags = collections.defaultdict(set)  # (target file, fragment) -> referrers

for page in sorted(glob.glob("*.html")):
    html = open(page, encoding="utf-8", errors="replace").read()
    for m in re.finditer(r'(?:href|src)\s*=\s*["\']([^"\']+)["\']', html):
        url = m.group(1)
        if url.startswith(("http://", "https://", "mailto:", "data:",
                           "javascript:")):
            continue
        base, _, frag = url.partition("#")
        if base:
            refs[urllib.parse.unquote(base)].add(page)
        if frag:
            target = urllib.parse.unquote(base) if base else page
            frags[(target, frag)].add(page)

failures = []

for target in sorted(refs):
    if not os.path.exists(target):
        failures.append(
            f"missing file: {target}  <- " + ", ".join(sorted(refs[target])))

ids = {}
for (target, frag), pages in sorted(frags.items()):
    if not target.endswith(".html") or not os.path.exists(target):
        continue
    if target not in ids:
        h = open(target, encoding="utf-8", errors="replace").read()
        ids[target] = set(re.findall(r'(?:id|name)\s*=\s*["\']([^"\']+)["\']', h))
    if frag not in ids[target]:
        failures.append(
            f"missing anchor: {target}#{frag}  <- " + ", ".join(sorted(pages)))

if failures:
    print(f"linkcheck: {len(failures)} broken reference(s):")
    for f in failures:
        print(" ", f)
    sys.exit(1)

print(f"linkcheck: OK, {len(refs)} internal targets and "
      f"{len(frags)} anchors verified across {len(glob.glob('*.html'))} pages")
