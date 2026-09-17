#!/usr/bin/env python3
"""scripts/toolchain.py [--check] — the PureScript compiler by pinned hash (2026-09-17).

`purs` used to arrive as the npm package `purescript`, whose install script
(purescript-installer) downloads the release tarball through make-fetch-happen
and unpacks it by subclassing tar 6's Unpack. Four of the audit's ten
advisories hung off that path (tar, cacache, make-fetch-happen, the installer),
none with an upstream fix, and the only "fix" npm offered was a downgrade of
the compiler to 0.14. The compiler is a release binary, so it now comes the
way the corpus sources do (scripts/sources.py): downloaded from the GitHub
release named in tests/_support/toolchain.json, verified against the tarball's
pinned sha256, the one member `purescript/purs` read out of it (never an
extraction by member name — nothing a hostile archive says about paths is
obeyed), verified again against the binary's pinned sha256, and written to
local/bin/purs (git-ignored). A copy already there that matches costs no
network; one that does not is replaced. `make toolchain` is the road, `make
psbuild` runs it first, and both workflows cache local/bin by the pin file's
hash. The npm `build:ps` script puts local/bin on PATH so spago finds purs.

  --check   verify local/bin/purs against the pin and exit 1 if absent or
            wrong; never downloads
"""
import hashlib
import io
import json
import os
import platform
import sys
import tarfile
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PIN = os.path.join(ROOT, 'tests', '_support', 'toolchain.json')
BIN_DIR = os.path.join(ROOT, 'local', 'bin')
PURS = os.path.join(BIN_DIR, 'purs')
MEMBER = 'purescript/purs'


def sha256_bytes(data):
    return hashlib.sha256(data).hexdigest()


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def platform_key():
    """'linux-x64', 'darwin-arm64', … — the keys of the pin file's assets."""
    system = platform.system().lower()
    machine = platform.machine().lower()
    arch = 'arm64' if machine in ('arm64', 'aarch64') else 'x64'
    return system + '-' + arch


def load_pin(path=PIN):
    with open(path, encoding='utf-8') as f:
        return json.load(f)['purs']


def installed_ok(entry, purs=PURS):
    return os.path.exists(purs) and sha256_file(purs) == entry['purs_sha256']


def extract_purs(tarball, entry):
    """The verify road, pure over bytes: the tarball must hash to the pin, the
    one member is read out by its fixed name, and the binary must hash to its
    pin. Raises SystemExit with the reason on any mismatch."""
    got = sha256_bytes(tarball)
    if got != entry['sha256']:
        raise SystemExit('toolchain: %s hashes to %s, the pin says %s — refusing' % (entry['asset'], got, entry['sha256']))
    with tarfile.open(fileobj=io.BytesIO(tarball), mode='r:gz') as tf:
        try:
            member = tf.getmember(MEMBER)
        except KeyError:
            raise SystemExit('toolchain: %s carries no %s' % (entry['asset'], MEMBER))
        if not member.isfile():
            raise SystemExit('toolchain: %s in %s is not a plain file' % (MEMBER, entry['asset']))
        data = tf.extractfile(member).read()
    got = sha256_bytes(data)
    if got != entry['purs_sha256']:
        raise SystemExit('toolchain: the purs binary hashes to %s, the pin says %s — refusing' % (got, entry['purs_sha256']))
    return data


def download(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'merecatholicity-toolchain/1'})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


def install(pin, entry):
    url = pin['release'] + entry['asset']
    print('toolchain: fetching purs %s (%s)' % (pin['version'], url))
    data = extract_purs(download(url), entry)
    os.makedirs(BIN_DIR, exist_ok=True)
    tmp = PURS + '.tmp'
    with open(tmp, 'wb') as f:
        f.write(data)
    os.chmod(tmp, 0o755)
    os.replace(tmp, PURS)
    print('toolchain: purs %s in place at %s' % (pin['version'], os.path.relpath(PURS, ROOT)))


def main(argv):
    pin = load_pin()
    key = platform_key()
    entry = pin['assets'].get(key)
    if not entry:
        sys.exit('toolchain: no pinned purs asset for %s (the pin file names %s)' % (key, ', '.join(sorted(pin['assets']))))
    if installed_ok(entry):
        print('toolchain: purs %s already in place (%s)' % (pin['version'], os.path.relpath(PURS, ROOT)))
        return 0
    if '--check' in argv:
        sys.exit('toolchain: %s is absent or does not match the pin — run make toolchain' % os.path.relpath(PURS, ROOT))
    install(pin, entry)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
