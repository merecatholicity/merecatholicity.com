-- merecat, the librarian bot: corpus, config, and usage counters.
-- Lives in its own D1 database (merecat-library, binding LIBDB) so the bot's
-- knowledge is decoupled from the comments store. Everything here is DERIVED
-- data: librarian/ingest.py rebuilds it from the repo at any time, which is
-- why the backup cron deliberately does not mirror this database.
--
-- Apply (from comments-worker/):
--   deno run -A npm:wrangler d1 execute merecat-library --remote --file=schema-librarian.sql

-- One row per ingested work (a site page, a Bible, a volume, an extra/ file).
-- hash is the content hash ingest.py computed last push; it makes re-ingest
-- incremental (unchanged works are skipped).
CREATE TABLE IF NOT EXISTS works (
  id         TEXT PRIMARY KEY,          -- works.yml key, e.g. "book", "anf01"
  title      TEXT NOT NULL,
  url        TEXT NOT NULL,             -- reader-facing page, e.g. "book.html"
  tier       INTEGER NOT NULL DEFAULT 2,-- 1 = our positions, 2 = the shelf, 3 = deep corpus
  kind       TEXT,                      -- parser used: pandoc | hand | bible | text
  hash       TEXT,                      -- ingest content hash
  updated_at INTEGER
);

-- The retrieval unit: a few hundred words of one work, carrying the deep
-- anchor a citation should land on. cid ("work#seq") is the stable string id
-- shared with the Vectorize index; the integer id is the FTS rowid.
CREATE TABLE IF NOT EXISTS chunks (
  id      INTEGER PRIMARY KEY,
  cid     TEXT NOT NULL UNIQUE,
  work_id TEXT NOT NULL,
  seq     INTEGER NOT NULL,
  heading TEXT,                         -- breadcrumb, e.g. "First Apology > Chapter LXVI"
  anchor  TEXT,                         -- URL fragment on the work's page ('' = page top)
  text    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS chunks_work_idx ON chunks(work_id, seq);

-- BM25 search over the whole corpus, the same external-content FTS5 shape as
-- the forum's comments_fts (schema.sql): index only, text read back from
-- chunks by rowid, triggers keeping lockstep. detail stays full so quoted
-- phrases keep working under buildMatch.
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  heading, text, content='chunks', content_rowid='id', tokenize='porter unicode61'
);
CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
  INSERT INTO chunks_fts(rowid, heading, text) VALUES (new.id, new.heading, new.text);
END;
CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, heading, text) VALUES ('delete', old.id, old.heading, old.text);
END;
CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, heading, text) VALUES ('delete', old.id, old.heading, old.text);
  INSERT INTO chunks_fts(rowid, heading, text) VALUES (new.id, new.heading, new.text);
END;

-- The bot's brain-settings, pushed by `make librarian`: persona (the system
-- prompt), model (the Workers AI model id), caps, topk. Editing librarian/
-- files and re-running the make target changes behavior with no redeploy.
CREATE TABLE IF NOT EXISTS config (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);

-- Shared-budget bookkeeping, one row per UTC day. q counts answered
-- questions; the token tallies estimate neuron spend for the stats view.
CREATE TABLE IF NOT EXISTS usage (
  day     TEXT PRIMARY KEY,             -- YYYY-MM-DD (UTC)
  q       INTEGER NOT NULL DEFAULT 0,
  in_tok  INTEGER NOT NULL DEFAULT 0,
  out_tok INTEGER NOT NULL DEFAULT 0
);

-- Per-member daily count behind the per-user cap. No question text is stored
-- anywhere: counters only.
CREATE TABLE IF NOT EXISTS user_usage (
  day  TEXT NOT NULL,
  hash TEXT NOT NULL,
  q    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, hash)
);
