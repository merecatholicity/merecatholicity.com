#!/usr/bin/env python3
"""scripts/backup_check.py <comments-YYYY-MM-DD.sql.gz> — the restore drill.

Gunzips one of the worker's daily D1 backups (lib.ts dumpDatabase, fetched by
scripts/backup_fetch.sh) and replays it into an in-memory SQLite, TWICE — the
dump is meant to be idempotent (INSERT OR REPLACE, every index IF NOT EXISTS)
and the second replay must change nothing. Prints every table's row count and
exits 1 on any error, an empty dump, or a second replay that changed a count.

The search index: the dump ends with the FTS5 virtual table, its triggers and
a rebuild. A Python whose SQLite lacks FTS5 cannot run those; the check then
replays without them and says so (the tables are the backup; the index is
derived data the worker rebuilds). `make comments-backup` runs fetch + check."""
import gzip
import re
import sqlite3
import sys

FTS_LINE = re.compile(r"^(CREATE VIRTUAL TABLE|CREATE TRIGGER|INSERT INTO comments_fts\()", re.I)


def split_fts(sql):
    """The dump's statements are newline-joined; the FTS part is the tail whose
    statements start with CREATE VIRTUAL TABLE / CREATE TRIGGER / the rebuild.
    Returns (base, fts) as two scripts."""
    base, fts, in_fts = [], [], False
    for stmt in re.split(r";\n(?=CREATE |INSERT |--)", sql):
        s = stmt.strip()
        if not s:
            continue
        if FTS_LINE.match(s):
            in_fts = True
        (fts if in_fts and FTS_LINE.match(s) else base).append(s.rstrip(";") + ";")
    return "\n".join(base), "\n".join(fts)


def user_tables(db):
    rows = db.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND sql IS NOT NULL "
        "AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'comments_fts%' ORDER BY name"
    ).fetchall()
    return [r[0] for r in rows]


def counts(db):
    return {t: db.execute('SELECT COUNT(*) FROM "%s"' % t).fetchone()[0] for t in user_tables(db)}


def is_legacy(sql):
    """A dump the worker wrote before 2026-09-16: plain INSERT INTO. It restores
    into an EMPTY database (the drill's first replay) but cannot be replayed
    onto itself — that is what the OR REPLACE rewrite fixed."""
    return re.search(r'^INSERT INTO "', sql, re.M) is not None and re.search(r'^INSERT OR REPLACE INTO "', sql, re.M) is None


def replay(sql):
    """Replay the dump into a fresh in-memory database, then a second time.
    Returns (counts, notes): the per-table counts after the first replay and
    the notes a human should read (the FTS fallback; a legacy dump; a count
    the second replay changed or a statement it refused — "not idempotent",
    which fails the drill for a dump of the current shape). Raises on a SQL
    error in the first replay: the backup does not restore."""
    notes = []
    base, fts = split_fts(sql)
    legacy = is_legacy(sql)
    db = sqlite3.connect(":memory:")
    db.executescript(base)
    fts_ok = True
    if fts:
        try:
            db.executescript(fts)
        except sqlite3.OperationalError as e:
            fts_ok = False
            notes.append("search index skipped (this sqlite cannot run it: %s) — the worker rebuilds it" % e)
    first = counts(db)
    if legacy:
        notes.append("legacy dump (plain INSERT, written before 2026-09-16): restores into an empty database; a second replay is not attempted")
    else:
        try:
            db.executescript(base)
            if fts and fts_ok:
                db.executescript(fts)
            second = counts(db)
            for t in first:
                if first[t] != second.get(t):
                    notes.append("second replay changed %s: %d -> %d (the dump is not idempotent)" % (t, first[t], second.get(t, -1)))
        except sqlite3.Error as e:
            notes.append("second replay refused: %s (the dump is not idempotent)" % e)
    if fts and fts_ok:
        hits = db.execute("SELECT COUNT(*) FROM comments_fts").fetchone()[0]
        notes.append("search index rebuilt: %d rows" % hits)
    db.close()
    return first, notes


def main(argv):
    if len(argv) != 2:
        print(__doc__)
        return 2
    path = argv[1]
    with gzip.open(path, "rb") as f:
        sql = f.read().decode("utf-8")
    head = sql.split("\n", 1)[0]
    if not head.startswith("-- merecatholicity-comments backup "):
        print("not a merecatholicity backup: first line is %r" % head[:80])
        return 1
    try:
        c, notes = replay(sql)
    except sqlite3.Error as e:
        print("REPLAY FAILED: %s" % e)
        return 1
    if not c:
        print("the dump holds no table")
        return 1
    width = max(len(t) for t in c)
    for t in sorted(c):
        print("  %-*s %8d" % (width, t, c[t]))
    print("%d tables, %d rows, from %s" % (len(c), sum(c.values()), head[len("-- merecatholicity-comments backup "):]))
    bad = False
    for n in notes:
        print("note: " + n)
        bad = bad or "not idempotent" in n
    if bad:
        return 1
    print("restore drill OK: " + ("the legacy object restores into an empty database" if is_legacy(sql) else "replayed twice, same ledger both times"))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
