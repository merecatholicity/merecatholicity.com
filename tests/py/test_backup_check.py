"""The restore drill's checker (scripts/backup_check.py) on a dump of the
worker's shape: the tables replay twice to the same counts, the FTS tail is
found and — where this Python's SQLite lacks FTS5 — skipped with a note rather
than failing the drill, and a dump that is NOT idempotent is named. What would
break silently: a checker that passes a dump whose second replay doubled a
table, or one that fails every drill on a box without FTS5."""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'scripts'))
import backup_check  # noqa: E402

HEAD = "-- merecatholicity-comments backup 2026-09-16T03:15:00.000Z\n"
TABLES = (
    'CREATE TABLE IF NOT EXISTS profiles (hash TEXT PRIMARY KEY, nick TEXT, handle TEXT);\n'
    'INSERT OR REPLACE INTO "profiles" ("hash", "nick", "handle") VALUES\n'
    "('a', 'Ann', 'ann'),\n('b', 'it''s Bob', NULL);\n"
    'CREATE TABLE IF NOT EXISTS comments (id INTEGER PRIMARY KEY, body TEXT);\n'
    'INSERT OR REPLACE INTO "comments" ("id", "body") VALUES\n'
    "(1, 'the quick brown fox'),\n(2, 'jumps over the lazy dog');\n"
    'CREATE UNIQUE INDEX IF NOT EXISTS profiles_handle ON profiles(handle);\n'
)
FTS = (
    "CREATE VIRTUAL TABLE IF NOT EXISTS comments_fts USING fts5(body, content='comments', content_rowid='id');\n"
    "CREATE TRIGGER IF NOT EXISTS comments_ai AFTER INSERT ON comments BEGIN INSERT INTO comments_fts(rowid, body) VALUES (new.id, new.body); END;\n"
    "INSERT INTO comments_fts(comments_fts) VALUES('rebuild');"
)


class BackupCheck(unittest.TestCase):
    def test_the_tables_replay_twice_to_the_same_counts(self):
        counts, notes = backup_check.replay(HEAD + TABLES + FTS)
        self.assertEqual(counts, {'comments': 2, 'profiles': 2})
        self.assertFalse(any('not idempotent' in n for n in notes), notes)
        # the FTS tail is either rebuilt or skipped with a note — never a failure
        self.assertTrue(any(n.startswith('search index') for n in notes), notes)

    def test_the_fts_tail_is_split_from_the_tables(self):
        base, fts = backup_check.split_fts(HEAD + TABLES + FTS)
        self.assertIn('CREATE UNIQUE INDEX IF NOT EXISTS profiles_handle', base)
        self.assertNotIn('comments_fts', base)
        self.assertIn('CREATE VIRTUAL TABLE', fts)
        self.assertIn("VALUES('rebuild')", fts)

    def test_a_current_dump_that_is_not_idempotent_is_named(self):
        # OR REPLACE on one table, a plain INSERT on another: the current shape, broken
        bad = HEAD + ('CREATE TABLE IF NOT EXISTS ok (v TEXT PRIMARY KEY);\nINSERT OR REPLACE INTO "ok" ("v") VALUES\n(\'a\');\n'
                      'CREATE TABLE IF NOT EXISTS t (v TEXT);\nINSERT INTO "t" ("v") VALUES\n(\'x\');\n')
        counts, notes = backup_check.replay(bad)
        self.assertEqual(counts, {'ok': 1, 't': 1})
        self.assertTrue(any('second replay changed t: 1 -> 2' in n for n in notes), notes)
        refused = HEAD + ('CREATE TABLE IF NOT EXISTS ok (v TEXT PRIMARY KEY);\nINSERT OR REPLACE INTO "ok" ("v") VALUES\n(\'a\');\n'
                          'CREATE TABLE IF NOT EXISTS u (v TEXT PRIMARY KEY);\nINSERT INTO "u" ("v") VALUES\n(\'x\');\n')
        counts, notes = backup_check.replay(refused)
        self.assertTrue(any(n.startswith('second replay refused:') and 'not idempotent' in n for n in notes), notes)

    def test_a_legacy_dump_restores_once_and_is_named_not_failed(self):
        # what the worker wrote before 2026-09-16 (the 2026-09-01 object): plain INSERT, a UNIQUE index
        legacy = HEAD + ('CREATE TABLE IF NOT EXISTS admins (hash TEXT PRIMARY KEY);\nINSERT INTO "admins" ("hash") VALUES\n(\'a\'),\n(\'b\');\n'
                         'CREATE UNIQUE INDEX admins_hash ON admins(hash);\n')
        self.assertTrue(backup_check.is_legacy(legacy))
        self.assertFalse(backup_check.is_legacy(HEAD + TABLES))
        counts, notes = backup_check.replay(legacy)
        self.assertEqual(counts, {'admins': 2})
        self.assertTrue(any(n.startswith('legacy dump') for n in notes), notes)
        self.assertFalse(any('not idempotent' in n for n in notes), notes)

    def test_a_broken_dump_raises(self):
        with self.assertRaises(backup_check.sqlite3.Error):
            backup_check.replay(HEAD + 'CREATE TABLE IF NOT EXISTS t (v TEXT);\nINSERT OR REPLACE INTO "t" ("nope") VALUES\n(1);\n')


if __name__ == '__main__':
    unittest.main()
