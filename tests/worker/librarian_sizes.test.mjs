/* The librarian's text sizes, stamped at import (2026-09-17).
 *
 * What would break silently: the pipeline's size projection drifting from the
 * text it measures (a room nearing its 500 MB wall read as roomy); a room made
 * before the column never gaining it, or gaining it with zeros; the roster or
 * the stats going back to scanning every chunk. So: RUN the ingest door and the
 * two readers against real SQLite rooms, one of them built from the old schema. */
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadWorker, makeEnv, freshDb, freshLibDb, identity, resetCaches, call, d1 } from '../_support/worker.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = readFileSync(join(root, 'comments-worker', 'src', 'routes', 'merecat.ts'), 'utf8');
const INGEST = 'ingest-key-for-tests';
const HOST = 'https://merecatholicity-comments.example.workers.dev';
let worker, ADMIN;
before(async () => {
  ({ worker } = await loadWorker());
  ADMIN = await identity('librarian-admin');
});
beforeEach(resetCaches);

/* a room as it stood before 2026-09-17: works without text_bytes */
function oldRoom() {
  const db = new DatabaseSync(':memory:');
  const schema = readFileSync(join(root, 'comments-worker', 'schema-librarian.sql'), 'utf8')
    .replace(/updated_at INTEGER,[\s\S]*?text_bytes INTEGER NOT NULL DEFAULT 0\n/, 'updated_at INTEGER\n');
  assert.ok(!/text_bytes/.test(schema.split('CREATE TABLE IF NOT EXISTS chunks')[0].replace(/--.*$/gm, '')), 'the old shape has no column');
  db.exec(schema);
  return db;
}
const scan = (db) => Number(db.prepare("SELECT COALESCE(SUM(LENGTH(text) + LENGTH(COALESCE(heading, ''))), 0) AS b FROM chunks").get().b);
function seed(db, id, rows, stamp = true) {
  db.prepare("INSERT INTO works (id, title, url, tier, kind, hash, chunks) VALUES (?, ?, '', 3, 'text', 'h', ?)").run(id, id, stamp ? rows.length : 0);
  rows.forEach((r, i) => db.prepare('INSERT INTO chunks (cid, work_id, seq, heading, anchor, text) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id + '#' + i, id, i, r.heading ?? null, '', r.text));
}

function envWith(rooms) {
  const env = makeEnv({ db: freshDb(), libdb: rooms[0], vars: { MERECAT_INGEST_KEY: INGEST, ADMIN_HASHES: ADMIN.hash } });
  env.LIBDB2 = d1(rooms[1]);
  env.LIBDB3 = d1(rooms[2]);
  return env;
}
const post = (env, path, body) => call(worker, env, 'POST', path, body, { host: HOST, origin: null });

test('a room from before the column gains it, backfilled to exactly what the old scan measured', async () => {
  const one = freshLibDb(), deep = oldRoom(), deep2 = oldRoom();
  seed(one, 'book', [{ heading: 'Preface', text: 'In the beginning' }, { text: 'Ἐν ἀρχῇ ἦν ὁ λόγος' }]);
  seed(deep, 'anf01', [{ heading: 'I > II', text: 'x'.repeat(500) }, { text: 'y'.repeat(20) }]);
  seed(deep, 'half-done', [{ text: 'an interrupted push' }], false);
  seed(deep2, 'cicero', [{ heading: 'De Officiis', text: 'Quamquam te, Marce fili' }]);
  const before = [scan(one), scan(deep), scan(deep2)];
  const env = envWith([one, deep, deep2]);
  const r = await post(env, '/api/merecat/works', { key: INGEST });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const cols = deep.prepare('PRAGMA table_info(works)').all().map((c) => c.name);
  assert.ok(cols.includes('text_bytes'), 'the deep room gained the column');
  /* the unfinished work (no chunk count stamped) has no size yet, as it has no count */
  const halfDone = Number(deep.prepare("SELECT text_bytes FROM works WHERE id = 'half-done'").get().text_bytes);
  assert.equal(halfDone, 0);
  const unfinished = 'an interrupted push'.length;
  assert.deepEqual([r.json.text_bytes, r.json.text_bytes_deep, r.json.text_bytes_deep2], [before[0], before[1] - unfinished, before[2]],
    'the same numbers the scan gave, less the push that never ended');
  /* a second call reads the column alone: rooms that have it are not altered again */
  const again = await post(env, '/api/merecat/works', { key: INGEST });
  assert.deepEqual([again.json.text_bytes, again.json.text_bytes_deep, again.json.text_bytes_deep2], [r.json.text_bytes, r.json.text_bytes_deep, r.json.text_bytes_deep2]);
});

test('the end of a push stamps the size from the work\'s own chunks; a re-push replaces it', async () => {
  const one = freshLibDb(), deep = freshLibDb(), deep2 = freshLibDb();
  const env = envWith([one, deep, deep2]);
  const work = { id: 'tract', title: 'Tract', url: '', tier: 3, kind: 'text' };
  const push = async (texts) => {
    assert.equal((await post(env, '/api/merecat/ingest', { key: INGEST, mode: 'begin', store: 'deep', work })).status, 200);
    const chunks = texts.map((t, i) => ({ cid: 'tract#' + i, seq: i, heading: 'H' + i, anchor: '', text: t }));
    assert.equal((await post(env, '/api/merecat/ingest', { key: INGEST, mode: 'append', store: 'deep', work, chunks })).status, 200);
    assert.equal((await post(env, '/api/merecat/ingest', { key: INGEST, mode: 'end', store: 'deep', work: { ...work, hash: 'h' + texts.length, chunks: texts.length } })).status, 200);
  };
  await push(['alpha', 'beta gamma']);
  const size = () => Number(deep.prepare("SELECT text_bytes FROM works WHERE id = 'tract'").get().text_bytes);
  assert.equal(size(), 'alpha'.length + 'H0'.length + 'beta gamma'.length + 'H1'.length);
  assert.equal(size(), scan(deep));
  await push(['one']);
  assert.equal(size(), 'one'.length + 'H0'.length, 're-pushed: the old chunks and their size are gone');
  const r = await post(env, '/api/merecat/works', { key: INGEST });
  assert.equal(r.json.text_bytes_deep, scan(deep));
  assert.equal(r.json.text_bytes, 0);
});

test('the stats sum the stamped counts; neither reader scans the chunk store', async () => {
  const one = freshLibDb(), deep = freshLibDb(), deep2 = freshLibDb();
  seed(one, 'a', [{ text: '1' }, { text: '2' }]);
  seed(deep, 'b', [{ text: '3' }, { text: '4' }, { text: '5' }]);
  seed(deep2, 'c', [{ text: '6' }]);
  const env = envWith([one, deep, deep2]);
  const r = await call(worker, env, 'POST', '/api/merecat/stats', { key: ADMIN.key });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.chunks, 6);
  const readers = src.slice(src.indexOf('async function handleMerecatWorks('), src.indexOf('/* Every dial the librarian has'))
    + src.slice(src.indexOf('async function handleMerecatStats('), src.indexOf('async function handleMerecatStats(') + 1600);
  assert.ok(!/FROM chunks/.test(readers), 'no reader of the roster or the stats touches the chunk store');
});
