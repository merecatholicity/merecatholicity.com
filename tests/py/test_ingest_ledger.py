"""The ingest's parse ledger (librarian/ingest.py, 2026-09-10), and the
credential and the config split every push rides on (2026-09-17).

The server's `works.hash` decides what is PUSHED; the ledger only remembers
what was PARSED, so an unchanged source is not parsed again — the difference
between a four-minute run and a few seconds when only the private shelf
changed. These tests hold its three promises: a signature moves when any of
its inputs move (the parser version, the manifest entry, the source bytes);
a matching signature yields the remembered hash; and a missing, empty or
corrupt ledger is simply no memory, never an error.

Since 2026-09-17 the pipeline carries no key: in a GitHub Actions job the
push sends the job's OIDC token (asked for again before it lapses), and the
persona and the dials leave the corpus run for a job a reviewer approves —
so the corpus run must never push them, and the config job pushes only what
changed.
"""
import base64
import contextlib
import io
import json
import os
import sys
import tempfile
import time
import unittest
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, 'librarian'))
import ingest  # noqa: E402


def source():
    with open(os.path.join(ROOT, 'librarian', 'ingest.py'), encoding='utf-8') as f:
        return f.read()


class Signature(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.path = os.path.join(self.dir, 'work.txt')
        with open(self.path, 'w', encoding='utf-8') as f:
            f.write('# A chapter\n\nSome text.\n')
        self.entry = {'src': 'private/x.txt', 'title': 'X', 'kind': 'text', 'tier': 8, 'store': 'deep2'}

    def test_stable_for_the_same_inputs(self):
        self.assertEqual(ingest.source_sig(self.entry, self.path), ingest.source_sig(dict(self.entry), self.path))

    def test_moves_with_the_source_bytes(self):
        a = ingest.source_sig(self.entry, self.path)
        with open(self.path, 'a', encoding='utf-8') as f:
            f.write('More.\n')
        self.assertNotEqual(a, ingest.source_sig(self.entry, self.path))

    def test_moves_with_the_manifest_entry(self):
        a = ingest.source_sig(self.entry, self.path)
        self.assertNotEqual(a, ingest.source_sig(dict(self.entry, tier=9), self.path))

    def test_moves_with_the_parser_version(self):
        a = ingest.source_sig(self.entry, self.path)
        old = ingest.PARSER_VERSION
        try:
            ingest.PARSER_VERSION = old + 'x'
            self.assertNotEqual(a, ingest.source_sig(self.entry, self.path))
        finally:
            ingest.PARSER_VERSION = old


class Memory(unittest.TestCase):
    def test_round_trip_and_lookup(self):
        d = tempfile.mkdtemp()
        path = os.path.join(d, '.ledger.json')
        ledger = {'credo': {'sig': 'abc', 'hash': 'h1', 'chunks': 12}}
        ingest.save_ledger(path, ledger)
        back = ingest.load_ledger(path)
        self.assertEqual(back, ledger)
        self.assertEqual(ingest.ledger_lookup(back, 'credo', 'abc'), ('h1', 12))
        self.assertIsNone(ingest.ledger_lookup(back, 'credo', 'zzz'), 'a changed signature is a fresh parse')
        self.assertIsNone(ingest.ledger_lookup(back, 'other', 'abc'))
        self.assertFalse(os.path.exists(path + '.tmp'), 'the write is atomic: no temp file left behind')

    def test_no_ledger_is_no_memory(self):
        self.assertEqual(ingest.load_ledger(''), {})
        self.assertEqual(ingest.load_ledger('/nonexistent/ledger.json'), {})
        d = tempfile.mkdtemp()
        p = os.path.join(d, 'bad.json')
        with open(p, 'w', encoding='utf-8') as f:
            f.write('{not json')
        self.assertEqual(ingest.load_ledger(p), {})
        with open(p, 'w', encoding='utf-8') as f:
            json.dump([1, 2], f)
        self.assertEqual(ingest.load_ledger(p), {}, 'a ledger that is not a mapping is no ledger')
        ingest.save_ledger('', {'x': 1})   # nothing to write to: a no-op, never an error
        deep = os.path.join(d, 'not', 'yet', 'there', '.ledger.json')
        ingest.save_ledger(deep, {'x': {'sig': 's', 'hash': 'h', 'chunks': 1}})   # a missing directory is made, not a crash
        self.assertEqual(ingest.load_ledger(deep)['x']['hash'], 'h')

    def test_a_remembered_work_is_never_a_reason_to_skip_the_push(self):
        """The ledger answers 'was this parsed', never 'was this pushed': the
        push decision compares the remembered hash against the SERVER's, so a
        remembered work the server lacks is still pushed (and parsed for real
        then). The main loop's shape is held here as a source-text check."""
        src = source()
        loop = src[src.index('known = ledger_lookup(ledger, wid, sig)'):src.index('push_work(args.api, auth, wid, entry, chunks, chash)')]
        self.assertIn('if server.get(wid, {}).get("hash") == chash:', loop)
        self.assertIn('if chunks is None:', loop)


def jwt(exp):
    part = lambda o: base64.urlsafe_b64encode(json.dumps(o).encode()).decode().rstrip('=')
    return part({'alg': 'RS256', 'kid': 'k'}) + '.' + part({'exp': exp, 'aud': 'merecatholicity-comments'}) + '.c2ln'


class Runner:
    """the Actions runtime's token door: what it was asked, what it handed out"""
    def __init__(self, lifetimes):
        self.asked, self.lifetimes = [], list(lifetimes)

    def __call__(self, req, timeout=None):
        self.asked.append((req.full_url, req.get_header('Authorization')))
        body = json.dumps({'value': jwt(int(time.time()) + self.lifetimes.pop(0))}).encode()
        return contextlib.closing(io.BytesIO(body))


ACTIONS = {'ACTIONS_ID_TOKEN_REQUEST_URL': 'https://runtime.example/token?api-version=2.0',
           'ACTIONS_ID_TOKEN_REQUEST_TOKEN': 'the-runner-grant', 'GITHUB_ACTIONS': 'true',
           'MC_ADMIN_KEY': 'an-admin-key-on-the-runner', 'MC_INGEST_KEY': 'the-retired-static-key'}


class Credential(unittest.TestCase):
    def test_in_a_job_the_token_is_the_credential_and_no_key_travels(self):
        runner = Runner([300, 300])
        out = io.StringIO()
        with mock.patch.object(ingest.urllib.request, 'urlopen', runner), contextlib.redirect_stdout(out):
            auth = ingest.PipelineAuth(ACTIONS)
            headers, body = auth.sign({'mode': 'begin'})
            again, _ = auth.sign({'mode': 'append'})
        self.assertTrue(headers['Authorization'].startswith('Bearer '))
        self.assertEqual(headers, again, 'a live token is reused')
        self.assertEqual(body, {'mode': 'begin'}, 'no key rides in the body — not the admin key, not the retired one')
        self.assertEqual(len(runner.asked), 1)
        url, grant = runner.asked[0]
        self.assertEqual(url, 'https://runtime.example/token?api-version=2.0&audience=merecatholicity-comments')
        self.assertEqual(grant, 'bearer the-runner-grant')
        self.assertIn('::add-mask::' + headers['Authorization'][7:], out.getvalue(), 'the token is masked in the job log')

    def test_a_token_a_minute_from_its_end_is_asked_for_again(self):
        runner = Runner([30, 300])
        with mock.patch.object(ingest.urllib.request, 'urlopen', runner), contextlib.redirect_stdout(io.StringIO()):
            auth = ingest.PipelineAuth(ACTIONS)
            first, _ = auth.sign({})
            second, _ = auth.sign({})
        self.assertEqual(len(runner.asked), 2)
        self.assertNotEqual(first, second)

    def test_by_hand_the_admin_key_then_the_file_and_never_the_static_key(self):
        auth = ingest.PipelineAuth({'MC_ADMIN_KEY': 'admin-1', 'MC_INGEST_KEY': 'ingest-1'})
        self.assertEqual(auth.sign({'x': 1}), ({}, {'x': 1, 'key': 'admin-1'}))
        keyfile = os.path.join(ROOT, 'librarian', '.key')
        if not os.path.exists(keyfile):
            with self.assertRaises(SystemExit):
                ingest.PipelineAuth({'MC_INGEST_KEY': 'ingest-1'})

    def test_the_static_key_is_gone_from_the_script(self):
        src = source()
        self.assertNotIn('MC_INGEST_KEY', src)


class Config(unittest.TestCase):
    files = {'persona': 'You are merecat.', 'persona_hash': 'p' * 64, 'config': {'topk': 10}, 'config_hash': 'c' * 64}

    def test_only_what_changed_is_pushed_each_with_its_hash(self):
        same = {'persona_file_hash': 'p' * 64, 'config_file_hash': 'c' * 64}
        self.assertIsNone(ingest.config_body(ingest.config_changes(same, self.files), self.files))
        dials = ingest.config_body(ingest.config_changes(dict(same, config_file_hash=''), self.files), self.files)
        self.assertEqual(dials, {'config': {'topk': 10, 'config_file_hash': 'c' * 64}}, 'the dials alone; the persona stays')
        persona = ingest.config_body(ingest.config_changes(dict(same, persona_file_hash='x'), self.files), self.files)
        self.assertEqual(persona, {'persona': 'You are merecat.', 'config': {'persona_file_hash': 'p' * 64}},
                         'the persona alone: a dashboard edit of the dials stands')
        forced = ingest.config_body(ingest.config_changes(same, self.files), self.files, force=True)
        self.assertEqual(forced, {'persona': 'You are merecat.',
                                  'config': {'topk': 10, 'config_file_hash': 'c' * 64, 'persona_file_hash': 'p' * 64}})

    def test_the_files_hash_their_bytes(self):
        files = ingest.config_files()
        with open(os.path.join(ROOT, 'librarian', 'config.yml'), 'rb') as f:
            import hashlib
            self.assertEqual(files['config_hash'], hashlib.sha256(f.read()).hexdigest())
        self.assertIsInstance(files['config'], dict)

    def test_the_corpus_run_never_pushes_the_persona_or_the_dials(self):
        src = source()
        main = src[src.index('def main():'):]
        corpus = main[main.index('if args.config_status or args.config:'):]
        self.assertEqual(corpus.count('"/config"'), 1, 'one /config call in the corpus run')
        self.assertIn('post(args.api, "/config", {"config": stamp}, auth, tries=2)', corpus, 'and it is the stamp')
        code = [ln for ln in corpus.split('\nif __name__')[0].splitlines() if not ln.strip().startswith('#')]
        self.assertEqual([ln for ln in code if 'persona' in ln or 'config.yml' in ln], [], 'the corpus run reads neither file')

    def test_the_status_is_a_step_output(self):
        d = tempfile.mkdtemp()
        out = os.path.join(d, 'out')
        with mock.patch.dict(os.environ, {'GITHUB_OUTPUT': out}):
            ingest.write_output('changed', 'true')
        with open(out, encoding='utf-8') as f:
            self.assertEqual(f.read(), 'changed=true\n')


if __name__ == '__main__':
    unittest.main()
