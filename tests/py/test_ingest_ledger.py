"""The ingest's parse ledger (librarian/ingest.py, 2026-09-10).

The server's `works.hash` decides what is PUSHED; the ledger only remembers
what was PARSED, so an unchanged source is not parsed again — the difference
between a four-minute run and a few seconds when only the private shelf
changed. These tests hold its three promises: a signature moves when any of
its inputs move (the parser version, the manifest entry, the source bytes);
a matching signature yields the remembered hash; and a missing, empty or
corrupt ledger is simply no memory, never an error.
"""
import json
import os
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, 'librarian'))
import ingest  # noqa: E402


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

    def test_a_remembered_work_is_never_a_reason_to_skip_the_push(self):
        """The ledger answers 'was this parsed', never 'was this pushed': the
        push decision compares the remembered hash against the SERVER's, so a
        remembered work the server lacks is still pushed (and parsed for real
        then). The main loop's shape is held here as a source-text check."""
        src = open(os.path.join(ROOT, 'librarian', 'ingest.py'), encoding='utf-8').read()
        loop = src[src.index('known = ledger_lookup(ledger, wid, sig)'):src.index('push_work(args.api, key, wid, entry, chunks, chash)')]
        self.assertIn('if server.get(wid, {}).get("hash") == chash:', loop)
        self.assertIn('if chunks is None:', loop)


class Credential(unittest.TestCase):
    def test_the_pipeline_key_wins_then_the_admin_key_then_the_file(self):
        old = dict(os.environ)
        try:
            os.environ['MC_INGEST_KEY'] = 'ingest-1'
            os.environ['MC_ADMIN_KEY'] = 'admin-1'
            self.assertEqual(ingest.push_key(), 'ingest-1')
            del os.environ['MC_INGEST_KEY']
            self.assertEqual(ingest.push_key(), 'admin-1')
        finally:
            os.environ.clear(); os.environ.update(old)


if __name__ == '__main__':
    unittest.main()
