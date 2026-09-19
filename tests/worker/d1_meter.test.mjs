/* The day's D1 write meter, handed to the librarian's pipeline (2026-09-19).
 *
 * D1's free tier allows 100,000 row writes per ACCOUNT per day. The ingest has
 * to decide how much of the corpus to push BEFORE it pushes any of it, and it
 * holds no Cloudflare credential (GitHub OIDC only, CICD §4) — so the worker
 * reads the meter for it and hands the figure back on the roster the ingest
 * fetches anyway.
 *
 * What would break silently, and why each test is here: a reading that counts
 * one database instead of every database on the account (the cap is account-
 * wide, and the three librarian rooms and the comments database all draw on
 * it); a failed read answered as ZERO, which the ingest would read as a whole
 * free day and spend accordingly — the precise behaviour this change exists to
 * remove; and a meter outage taking the roster down with it, which would stop
 * the ingest entirely rather than slow it. The pacing arithmetic on the other
 * side of the wire is tests/py/test_ingest_pacing.py. */
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadWorker, makeEnv, freshDb, freshLibDb, identity, resetCaches, call, d1 } from '../_support/worker.mjs';
import { fetchD1Writes, d1WritesSelect } from '../../comments-worker/src/usage.ts';
import { FREE } from '../../comments-worker/src/usagecalc.ts';

const HOST = 'https://merecatholicity-comments.example.workers.dev';
const ENV = { CF_USAGE_TOKEN: 't', CF_ACCOUNT_ID: 'a' };
let worker, ADMIN;
before(async () => {
  ({ worker } = await loadWorker());
  ADMIN = await identity('librarian-admin');
});

/* A fetch answering the D1 analytics dataset with one row per database, or
   throwing when `rows` is null (the analytics API down). */
const realFetch = globalThis.fetch;
const realLog = console.log;
let lastQuery = '';
function stubFetch(rows) {
  globalThis.fetch = async (url, init) => {
    lastQuery = JSON.parse(init.body).query;
    if (rows == null) throw new Error('analytics down');
    return { status: 200, json: async () => ({ data: { viewer: { accounts: [
      { d1AnalyticsAdaptiveGroups: rows }] } } }) };
  };
}
const room = (id, written) => ({ dimensions: { databaseId: id }, sum: { rowsRead: 0, rowsWritten: written } });
beforeEach(() => { resetCaches(); console.log = realLog; });
after(() => { globalThis.fetch = realFetch; console.log = realLog; });

test('the reading sums EVERY database on the account, against the 100,000 daily cap', async () => {
  stubFetch([
    room('af00d34a-c1bc-46a3-b51f-1a2fdfec3eb8', 1729),   // comments
    room('c21d00ec-55d3-4288-b462-a373315f95e7', 33),
    room('98e30c6d-dacf-4c6b-8417-ee6ad176c9a2', 61_400),  // a librarian room mid-ingest
  ]);
  const m = await fetchD1Writes(ENV, Date.UTC(2026, 8, 19, 4, 10, 0));
  assert.equal(m.used, 1729 + 33 + 61_400, 'the cap is account-wide, so the reading must be too');
  assert.equal(m.limit, FREE.d1RowsWrittenDay);
  assert.equal(m.limit, 100_000);
  assert.match(lastQuery, /d1AnalyticsAdaptiveGroups/);
  assert.doesNotMatch(lastQuery, /aiInferenceAdaptiveGroups|r2OperationsAdaptiveGroups|workersInvocationsAdaptive/,
    'one select: the ingest pays for the figure it asked for, not the whole usage page');
});

test('the select asks for today only — a window wider than the day would read as spent', () => {
  assert.match(d1WritesSelect('2026-09-19T00:00:00Z'), /datetime_geq: "2026-09-19T00:00:00Z"/);
});

test('a meter that cannot be read THROWS — it never answers zero', async () => {
  stubFetch(null);
  await assert.rejects(() => fetchD1Writes(ENV), /analytics down/,
    'a zero here would read to the ingest as a whole free day');
  stubFetch([]);              // the token works but the dataset is empty/absent
  const empty = await fetchD1Writes(ENV);
  assert.equal(empty.used, 0, 'an EMPTY dataset is a real zero: nothing has been written today');
});

function libEnv() {
  const env = makeEnv({ db: freshDb(), libdb: freshLibDb(), vars: { ADMIN_HASHES: ADMIN.hash } });
  env.LIBDB2 = d1(freshLibDb());
  env.LIBDB3 = d1(freshLibDb());
  env.CF_USAGE_TOKEN = 't'; env.CF_ACCOUNT_ID = 'a';
  return env;
}
const roster = (env) => call(worker, env, 'POST', '/api/merecat/works', { key: ADMIN.key }, { host: HOST, origin: null });

test('the roster carries the reading, so the ingest learns the day before it spends it', async () => {
  stubFetch([room('af00d34a-c1bc-46a3-b51f-1a2fdfec3eb8', 12_500)]);
  const r = await roster(libEnv());
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.d1_rows_written, 12_500);
  assert.equal(r.json.d1_rows_limit, 100_000);
});

test('an unreadable meter costs the roster NOTHING: the works still come, the fields simply are not there', async () => {
  stubFetch(null);
  console.log = () => {};      // the merecat_works_d1meter_unread line is not this test's output
  const r = await roster(libEnv());
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.ok(Array.isArray(r.json.works), 'the roster is the ingest\'s whole state — a meter outage must not take it');
  assert.equal('d1_rows_written' in r.json, false, 'absent, never 0 — a 0 would buy the ingest a full day');
  assert.equal('d1_rows_limit' in r.json, false);
});

test('no usage token at all asks NOTHING and still answers the roster', async () => {
  let asked = 0;
  globalThis.fetch = async () => { asked++; throw new Error('should never be called'); };
  console.log = () => {};
  const env = libEnv();
  delete env.CF_USAGE_TOKEN; delete env.CF_ACCOUNT_ID;
  const r = await roster(env);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal('d1_rows_written' in r.json, false);
  assert.equal(asked, 0, 'an unconfigured meter must not spend a subrequest per run to be told 401');
});
