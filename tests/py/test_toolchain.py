"""The PureScript compiler comes by pinned hash (scripts/toolchain.py over
tests/_support/toolchain.json, 2026-09-17), not from the npm package whose
installer carried four advisories nothing upstream fixes. What would break
silently: a pin file that stops naming a real asset for the platforms CI and
the dev box run on; a verify road that accepts a tarball or a binary whose
hash is not the pin's; the npm package (and its approved install script)
creeping back into package.json; a workflow that compiles before it fetches,
or caches local/bin under a key that survives a version bump."""
import hashlib
import io
import json
import os
import re
import sys
import tarfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
import toolchain  # noqa: E402

HEX64 = re.compile(r'^[0-9a-f]{64}$')


def read(*parts):
    with open(os.path.join(ROOT, *parts), encoding='utf-8') as f:
        return f.read()


def fake_tarball(binary):
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode='w:gz') as tf:
        info = tarfile.TarInfo(toolchain.MEMBER)
        info.size = len(binary)
        info.mode = 0o755
        tf.addfile(info, io.BytesIO(binary))
    return buf.getvalue()


class Pin(unittest.TestCase):
    def setUp(self):
        self.pin = toolchain.load_pin()

    def test_the_pin_names_a_version_and_every_platform_we_build_on(self):
        self.assertRegex(self.pin['version'], r'^\d+\.\d+\.\d+$')
        self.assertTrue(self.pin['release'].endswith('/v' + self.pin['version'] + '/'), 'the release URL names the version')
        for key in ('linux-x64', 'darwin-x64', 'darwin-arm64'):
            entry = self.pin['assets'][key]
            self.assertTrue(entry['asset'].endswith('.tar.gz'), key)
            self.assertRegex(entry['sha256'], HEX64, key + ': the tarball pin')
            self.assertRegex(entry['purs_sha256'], HEX64, key + ': the binary pin')
        self.assertIn(toolchain.platform_key(), ('linux-x64', 'darwin-x64', 'darwin-arm64'),
                      'this box is a platform the pin file knows')


class Verify(unittest.TestCase):
    def test_accepts_the_pinned_tarball_and_returns_the_binary(self):
        binary = b'#!/bin/sh\necho purs 0.0.0\n'
        tarball = fake_tarball(binary)
        entry = {'asset': 'fake.tar.gz', 'sha256': hashlib.sha256(tarball).hexdigest(),
                 'purs_sha256': hashlib.sha256(binary).hexdigest()}
        self.assertEqual(toolchain.extract_purs(tarball, entry), binary)

    def test_refuses_a_tarball_whose_hash_is_not_the_pin(self):
        binary = b'purs'
        tarball = fake_tarball(binary)
        entry = {'asset': 'fake.tar.gz', 'sha256': '0' * 64, 'purs_sha256': hashlib.sha256(binary).hexdigest()}
        with self.assertRaises(SystemExit) as cm:
            toolchain.extract_purs(tarball, entry)
        self.assertIn('refusing', str(cm.exception))

    def test_refuses_a_binary_whose_hash_is_not_the_pin(self):
        binary = b'purs'
        tarball = fake_tarball(binary)
        entry = {'asset': 'fake.tar.gz', 'sha256': hashlib.sha256(tarball).hexdigest(), 'purs_sha256': '0' * 64}
        with self.assertRaises(SystemExit) as cm:
            toolchain.extract_purs(tarball, entry)
        self.assertIn('refusing', str(cm.exception))

    def test_refuses_a_tarball_without_the_member(self):
        buf = io.BytesIO()
        with tarfile.open(fileobj=buf, mode='w:gz') as tf:
            info = tarfile.TarInfo('purescript/README')
            info.size = 0
            tf.addfile(info, io.BytesIO(b''))
        tarball = buf.getvalue()
        entry = {'asset': 'fake.tar.gz', 'sha256': hashlib.sha256(tarball).hexdigest(), 'purs_sha256': '0' * 64}
        with self.assertRaises(SystemExit):
            toolchain.extract_purs(tarball, entry)


class TheBuildFetchesBeforeItCompiles(unittest.TestCase):
    def test_the_npm_package_and_its_install_script_are_gone(self):
        pkg = json.loads(read('package.json'))
        self.assertNotIn('purescript', pkg.get('devDependencies', {}), 'the compiler is not an npm package any more')
        self.assertNotIn('allowScripts', pkg, 'no install script needs approving')
        self.assertIn('local/bin', pkg['scripts']['build:ps'], 'spago finds purs on PATH under local/bin')

    def test_make_psbuild_runs_the_toolchain_first(self):
        mk = read('Makefile')
        self.assertIn('\ntoolchain:\n\tpython3 scripts/toolchain.py\n', mk, 'the make road')
        self.assertIn('\npsbuild: toolchain\n', mk, 'psbuild depends on it')

    def test_both_workflows_fetch_before_they_compile_and_cache_by_the_pin(self):
        for wf in ('build.yml', 'workers.yml'):
            text = read('.github', 'workflows', wf)
            fetch = text.index('run: make toolchain')
            compile_at = min(i for i in (text.find('make bundle'), text.find('make psbuild')) if i >= 0)
            self.assertLess(fetch, compile_at, wf + ': the compiler is fetched before anything compiles')
            self.assertIn("purs-bin-${{ hashFiles('tests/_support/toolchain.json') }}", text,
                          wf + ': local/bin is cached under the pin file\'s hash')
            self.assertIn("hashFiles('purescript/src/**', 'purescript/spago.yaml', 'package-lock.json', 'tests/_support/toolchain.json')", text,
                          wf + ': a compiler bump invalidates the PureScript output cache')


if __name__ == '__main__':
    unittest.main()
