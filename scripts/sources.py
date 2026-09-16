#!/usr/bin/env python3
"""scripts/sources.py manifest | pack | publish | fetch | check — the corpus sources
out of git (P2-6, 2026-09-16).

resources/ carried 364 MB of tracked corpus material: 237 generated `*-body.tex`
(272 MB), 50 preserved `*-src.html`, 30 ThML/XML sources, 8 source PDFs. They are
inputs the build needs and outputs converters produced once — not source anyone
edits by hand — and they made every clone a 190 MB download. They now live as
tarballs attached to the GitHub Release `sources` of this (public) repository,
pinned by sha256 in resources/SOURCES.json, which IS tracked:

  manifest  write resources/SOURCES.json from the files on disk (path, sha256,
            bytes, shard) — run after a converter regenerates a body
  pack      build local/sources/<shard>-<sha12>.tar.xz for every shard whose
            files changed (the manifest names the asset)
  publish   `gh release upload sources <tarballs> --clobber` (creates the
            release the first time); needs `gh auth` with repo scope — the dev
            box's road, done BEFORE the manifest is committed
  fetch     for every shard with a missing or mismatched file: take the tarball
            from local/sources/ if it is there and matches, else download it
            anonymously from the release (the repository is public — no secret
            is needed, so a pull_request build works), verify, extract into
            resources/, verify every file. `make fetch-sources`; the Makefile's
            html and pdf targets run it first; build.yml caches local/sources/.
  check     every listed file present and matching (exit 1 otherwise)

Shards: body-tex (resources/*-body.tex), src-html (resources/*-src.html), xml
(resources/*.xml), pdf (resources/docs-src/*.pdf, resources/catena-src/*.pdf).
tests/py/test_sources_manifest.py holds the manifest to the tree."""
import glob
import hashlib
import io
import json
import os
import subprocess
import sys
import tarfile
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RES = os.path.join(ROOT, 'resources')
MANIFEST = os.path.join(RES, 'SOURCES.json')
LOCAL = os.path.join(ROOT, 'local', 'sources')
RELEASE = 'sources'
REPO = 'merecatholicity/merecatholicity.com'
DOWNLOAD = 'https://github.com/%s/releases/download/%s/' % (REPO, RELEASE)
SHARDS = {
    'body-tex': ['*-body.tex'],
    'src-html': ['*-src.html'],
    'xml': ['*.xml'],
    'pdf': ['docs-src/*.pdf', 'catena-src/*.pdf'],
}


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def shard_files(shard):
    out = []
    for pat in SHARDS[shard]:
        out += glob.glob(os.path.join(RES, pat))
    return sorted(os.path.relpath(p, RES) for p in out)


def load_manifest():
    with open(MANIFEST, encoding='utf-8') as f:
        return json.load(f)


def write_manifest(m):
    with open(MANIFEST, 'w', encoding='utf-8') as f:
        json.dump(m, f, indent=1, sort_keys=True)
        f.write('\n')


def manifest():
    old = load_manifest() if os.path.exists(MANIFEST) else {'shards': {}}
    m = {'_note': 'the corpus sources, pinned (scripts/sources.py); the files live on the GitHub Release "sources", not in git',
         'files': {}, 'shards': {}}
    for shard in SHARDS:
        files = shard_files(shard)
        if not files:
            files = [p for p, e in old.get('files', {}).items() if e['shard'] == shard]
        entries = {}
        for rel in files:
            path = os.path.join(RES, rel)
            if os.path.exists(path):
                entries[rel] = {'sha256': sha256_file(path), 'bytes': os.path.getsize(path), 'shard': shard}
            else:
                entries[rel] = old['files'][rel]
        m['files'].update(entries)
        prev = old.get('shards', {}).get(shard, {})
        m['shards'][shard] = {'files': sorted(entries), 'asset': prev.get('asset'), 'sha256': prev.get('sha256'), 'bytes': prev.get('bytes'),
                              'content': hashlib.sha256(''.join(rel + ':' + entries[rel]['sha256'] + '\n' for rel in sorted(entries)).encode()).hexdigest()}
    write_manifest(m)
    return m


def pack():
    m = manifest()
    os.makedirs(LOCAL, exist_ok=True)
    for shard, s in m['shards'].items():
        want = '%s-%s.tar.xz' % (shard, s['content'][:12])
        target = os.path.join(LOCAL, want)
        if s.get('asset') == want and os.path.exists(target) and sha256_file(target) == s.get('sha256'):
            print('%-9s unchanged: %s' % (shard, want))
            continue
        with tarfile.open(target, 'w:xz', preset=3) as tar:
            for rel in s['files']:
                tar.add(os.path.join(RES, rel), arcname=rel, recursive=False)
        s['asset'], s['sha256'], s['bytes'] = want, sha256_file(target), os.path.getsize(target)
        print('%-9s packed: %s (%.1f MB)' % (shard, want, s['bytes'] / 1048576))
    write_manifest(m)


def publish():
    m = load_manifest()
    have = subprocess.run(['gh', 'release', 'view', RELEASE, '--repo', REPO, '--json', 'tagName'], capture_output=True, text=True)
    if have.returncode != 0:
        subprocess.run(['gh', 'release', 'create', RELEASE, '--repo', REPO, '--title', 'Corpus sources',
                        '--notes', 'The corpus sources the build fetches (scripts/sources.py; resources/SOURCES.json pins each file by sha256). Not a software release: a shelf. Assets are replaced in place when a source changes.'],
                       check=True)
    assets = [os.path.join(LOCAL, s['asset']) for s in m['shards'].values() if s.get('asset')]
    for a in assets:
        if not os.path.exists(a):
            sys.exit('missing tarball %s — run pack first' % a)
    subprocess.run(['gh', 'release', 'upload', RELEASE, '--repo', REPO, '--clobber'] + assets, check=True)
    print('published %d asset(s) to release %s' % (len(assets), RELEASE))


def verify_files(m, files):
    bad = []
    for rel in files:
        path = os.path.join(RES, rel)
        e = m['files'][rel]
        if not os.path.exists(path):
            bad.append(rel + ': missing')
        elif os.path.getsize(path) != e['bytes'] or sha256_file(path) != e['sha256']:
            bad.append(rel + ': differs from the manifest')
    return bad


def fetch():
    m = load_manifest()
    os.makedirs(LOCAL, exist_ok=True)
    for shard, s in m['shards'].items():
        bad = verify_files(m, s['files'])
        if not bad:
            print('%-9s ok (%d files)' % (shard, len(s['files'])))
            continue
        if not s.get('asset'):
            sys.exit('%s: %d file(s) missing and no asset published yet — run pack and publish' % (shard, len(bad)))
        target = os.path.join(LOCAL, s['asset'])
        if not (os.path.exists(target) and sha256_file(target) == s['sha256']):
            url = DOWNLOAD + s['asset']
            print('%-9s downloading %s' % (shard, url))
            req = urllib.request.Request(url, headers={'User-Agent': 'merecatholicity-build (scripts/sources.py)'})
            with urllib.request.urlopen(req, timeout=120) as r, open(target + '.part', 'wb') as f:
                while True:
                    chunk = r.read(1 << 20)
                    if not chunk:
                        break
                    f.write(chunk)
            if sha256_file(target + '.part') != s['sha256']:
                os.remove(target + '.part')
                sys.exit('%s: the downloaded tarball does not match the manifest' % shard)
            os.replace(target + '.part', target)
        with tarfile.open(target, 'r:xz') as tar:
            for member in tar.getmembers():
                if member.name not in s['files'] or not member.isfile():
                    sys.exit('%s: unexpected member %s' % (shard, member.name))
            tar.extractall(RES, filter='data')
        still = verify_files(m, s['files'])
        if still:
            sys.exit('%s: after extraction:\n  ' % shard + '\n  '.join(still))
        print('%-9s fetched %d file(s)' % (shard, len(bad)))


def check():
    m = load_manifest()
    bad = verify_files(m, sorted(m['files']))
    for b in bad:
        print(b)
    print('sources: %s (%d files, %d shards)' % ('ok' if not bad else '%d problem(s)' % len(bad), len(m['files']), len(m['shards'])))
    return 1 if bad else 0


def main(argv):
    mode = argv[1] if len(argv) > 1 else ''
    if mode == 'manifest':
        m = manifest(); print('manifest: %d files in %d shards' % (len(m['files']), len(m['shards']))); return 0
    if mode == 'pack':
        pack(); return 0
    if mode == 'publish':
        publish(); return 0
    if mode == 'fetch':
        fetch(); return 0
    if mode == 'check':
        return check()
    print(__doc__)
    return 2


if __name__ == '__main__':
    sys.exit(main(sys.argv))
