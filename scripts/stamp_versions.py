#!/usr/bin/env python3
"""Stamp the ?v= cache keys from every served asset's own content hash.

The manual bump law (edit a file, remember to bump its ?v= by hand) caused
several self-inflicted stale-cache incidents, so this makes the bump impossible
to forget: each versioned asset's key is a NUMBER derived from its content
(sha256 head as decimal, so sw.js's v=\\d versioned-URL test still matches).
Unchanged content yields the same number, so rebuilds stay byte-identical and
git only churns when a file really changed.

WHY IT COVERS EVERYTHING NOW (2026-09-08). The first version stamped four
bundles and left the rest, and the rest quietly rotted: index.js, flash.js,
contact.js and away.js carried a HARDCODED `?v=1` written on 2026-07-30, and
docs/index.js then changed on 2026-08-01 — so every browser and edge cache
holding index.js?v=1 from before that date served dead code, permanently, with
no path to healing. tweetnacl.min.js and lamejs.min.js sat under the same trap.
GitHub Pages serves everything `max-age=600`, and an edge purge does nothing
about a phone's own cache: a URL that changes is the only real control, so
every asset that can carry a key now does.

Deliberately NOT versioned: sw.js (its URL is its registration identity, and
nav.js registers it with updateViaCache:'none', which bypasses the HTTP cache
for the worker script) and the HTML documents themselves (cf-cache-status
DYNAMIC — Cloudflare does not edge-cache them).

NO TIMESTAMPS ANYWHERE. Builds are pinned to SOURCE_DATE_EPOCH and the
byte-deterministic double build is a ship gate, so every value here is derived
from content alone. A build date would churn every rebuild.

Run by `make bundle` AND at the end of `make html`: the generators (content.py,
nav.py, pandoc's --css=, the resources converters) emit the BARE `style.css` /
`nav.js` form, so the stamp has to be the last word or the two fight — exactly
the partials/book-tail.html incident recorded in CLAUDE.md. The page patterns
below therefore match the key as OPTIONAL, so a freshly generated bare
reference and an already-stamped one are both healed to the current key.
"""
import hashlib
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PARTIALS = os.path.join(ROOT, 'partials')
DOCS = os.path.join(ROOT, 'docs')

# Stamped into docs/nav.js's own source: nav.js injects these itself.
NAV_ASSETS = ['app.js', 'deeplink.js']

# Stamped into every HTML page (docs/ + partials/). The key is optional in the
# match so a generator's bare reference is adopted rather than fought.
PAGE_ASSETS = ['comments.js', 'bible-reader.js', 'index.js', 'flash.js',
               'contact.js', 'away.js', 'style.css', 'nav.js']

# Never written in markup: fetched or injected at runtime by the client, which
# reads their keys from window.mcAssets (the MC_ASSETS map in nav.js). Keeping
# them OUT of client/comments.ts is what breaks the circularity — a key in the
# bundle's source would change the bundle, which would change its own key.
RUNTIME_ASSETS = ['qr.min.js', 'tweetnacl.min.js', 'lamejs.min.js',
                  'turnstile.html', 'kjv.json', 'dr.json',
                  'emoji/emoji-data.json', 'avatars/presets/index.json']


def key_for(path):
    with open(path, 'rb') as f:
        digest = hashlib.sha256(f.read()).hexdigest()
    return str(int(digest[:8], 16))


def write_keeping_mtime(path, text):
    """Rewrite a file WITHOUT touching its modification time.

    The stamp changes cache keys, never content that anything downstream is
    built from — and it updates every consumer itself, in one pass. So a
    stamped file is exactly as fresh, relative to its sources, as it was
    before; letting the write bump its mtime told make otherwise. The live
    case (2026-09-09): a commit changed a corpus source AND the stylesheet,
    `make bundle`'s stamp rewrote all 272 pages with the new style key, and
    `make html` a minute later found the two pages whose .tex had changed
    "up to date" — the stale pages shipped. Preserving mtimes keeps the
    stamp invisible to make, which is what it is."""
    st = os.stat(path)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(text)
    os.utime(path, (st.st_atime, st.st_mtime))


def sub_file(path, pattern, repl):
    """NOTE the replacements below use \\g<1>, never \\1. Every key here begins
    with a digit, and `\\1` followed by digits is parsed as an OCTAL ESCAPE — so
    r'\\1' + '1544806402' silently produced 'M44806402', corrupting the key on
    273 pages while the script reported success. Caught by
    tests/py/test_stamp_versions.py comparing each stamped key to the file's
    real hash."""
    with open(path, encoding='utf-8') as f:
        s = f.read()
    out, n = re.subn(pattern, repl, s)
    if n and out != s:
        write_keeping_mtime(path, out)
        return True
    return False


def asset_pattern(name):
    """`name` as an actual REFERENCE — inside a src= or href= attribute — with
    or without an existing ?v= key. The optional key is what lets a generator's
    bare reference be adopted instead of fought.

    Requiring the attribute is not fussiness: the first version matched a bare
    word and rewrote the sentence "no nav.js, no app shell" inside an HTML
    comment in docs/turnstile.html into "no nav.js?v=879907213". A pattern this
    file applies to 273 pages has to mean a reference and nothing else.

    The whitespace around `=` is equally load-bearing, in the other direction:
    nav.js references its two injected scripts from JAVASCRIPT — `s.src =
    'app.js?v=N'` — and a pattern demanding `src="` matched neither, so app.js
    silently stopped being cache-busted at all. Caught by comparing the stamped
    key against the file's real hash; `tests/py/test_stamp_versions.py` now
    makes that comparison every run."""
    return (r'((?:src|href)\s*=\s*["\'])' + re.escape(name)
            + r'(?:\?v=[0-9a-z]+)?(["\'])')


def html_targets():
    out = [(DOCS, n) for n in sorted(os.listdir(DOCS))]
    # partials/ too: book-tail.html carries its own comments.js?v= key, and a
    # pandoc rebuild copies it straight into docs/book.html. Stamping only docs/
    # meant the two fought every build — the stamp fixed the page, the next
    # `make html` put the stale key back — and book.html shipped comments.js
    # v=199 against a kernel many versions newer.
    out += [(PARTIALS, n) for n in sorted(os.listdir(PARTIALS))]
    return [os.path.join(b, n) for b, n in out if n.endswith('.html')]


def main():
    def present(name):
        return os.path.exists(os.path.join(DOCS, name))

    # ---- 1. Hash everything EXCEPT nav.js, whose content is not final yet.
    stamps = {}
    for name in NAV_ASSETS + RUNTIME_ASSETS + [a for a in PAGE_ASSETS if a != 'nav.js']:
        if present(name):
            stamps[name] = key_for(os.path.join(DOCS, name))
    changed = []

    # ---- 2. nav.js: the two scripts it injects, and the runtime asset map.
    nav = os.path.join(DOCS, 'nav.js')
    for name in NAV_ASSETS:
        if name in stamps and sub_file(nav, asset_pattern(name), r'\g<1>' + name + '?v=' + stamps[name] + r'\g<2>'):
            changed.append('nav.js: ' + name + ' -> ' + stamps[name])
    runtime = {n: stamps[n] for n in RUNTIME_ASSETS if n in stamps}
    # One line, sorted, no spaces: deterministic, and a single regex target.
    line = 'var MC_ASSETS = ' + json.dumps(runtime, sort_keys=True, separators=(',', ':')) + ';'
    if sub_file(nav, r'var MC_ASSETS = \{[^\n]*\};', line):
        changed.append('nav.js: MC_ASSETS (' + str(len(runtime)) + ' runtime assets)')

    # ---- 3. nav.js is final now, so its own key can be taken BEFORE the page
    #         pass — which lets every page be read and written exactly once.
    #         The naive version re-read each file per asset: 274 pages x 8
    #         assets x two passes is over a gigabyte of I/O on a corpus whose
    #         Schaff volumes run to 5 MB each, and it put a minute into every
    #         `make bundle`.
    stamps['nav.js'] = key_for(nav)

    hits = {}
    for path in html_targets():
        with open(path, encoding='utf-8') as f:
            before = f.read()
        after = before
        for name in PAGE_ASSETS:
            if name not in stamps:
                continue
            # A plain substring test before the regex. Most pages mention only
            # nav.js and style.css; scanning a 5 MB Schaff volume with a full
            # pattern for comments.js it cannot contain is pure cost, and `in`
            # is answered in C.
            if name not in after:
                continue
            was = after
            after = re.sub(asset_pattern(name),
                           r'\g<1>' + name + '?v=' + stamps[name] + r'\g<2>', after)
            # Count a CHANGE, not a match: re.subn reports a substitution even
            # when it writes back the identical text, which made every run
            # report the same "N pages" and made the script look non-idempotent
            # to anything reading its output.
            if after != was:
                hits[name] = hits.get(name, 0) + 1
        if after != before:
            write_keeping_mtime(path, after)
    for name, n in sorted(hits.items()):
        changed.append(name + ' -> ' + stamps[name] + ' on ' + str(n) + ' pages')

    # content.py stamps fresh page builds, so its constant must carry the same
    # key (a quoted string constant: the value is opaque to content.py).
    cp = os.path.join(ROOT, 'scripts', 'content.py')
    if sub_file(cp, r"COMMENTS_V = ['\"]?[0-9a-z]+['\"]?",
                "COMMENTS_V = '" + stamps['comments.js'] + "'"):
        changed.append('content.py COMMENTS_V -> ' + stamps['comments.js'])

    # ---- 5. The manifest the app reads to know whether it is current.
    #        `build` changes when any asset changes, and only then.
    manifest = dict(sorted(stamps.items()))
    blob = '\n'.join(k + '=' + v for k, v in manifest.items())
    build = hashlib.sha256(blob.encode()).hexdigest()[:12]
    doc = json.dumps({'build': build, 'assets': manifest},
                     sort_keys=True, indent=1) + '\n'
    vpath = os.path.join(DOCS, 'version.json')
    old = ''
    if os.path.exists(vpath):
        with open(vpath, encoding='utf-8') as f:
            old = f.read()
    if doc != old:
        with open(vpath, 'w', encoding='utf-8') as f:
            f.write(doc)
        changed.append('version.json build -> ' + build)

    print('stamp_versions:', '; '.join(changed) if changed else 'all keys current')
    return 0


if __name__ == '__main__':
    sys.exit(main())
