/* The CSP report collector (P2-7, 2026-09-16): the Report-Only policy's
 * report-uri / report-to. Both browser shapes are read, reports are TALLIED
 * (directive · blocked origin · document path, a count, first and last seen,
 * the top hundred), never stored whole; anything unreadable is a quiet 204;
 * the Health card reads the tally. What would break silently: a collector
 * that 400s and fills the browser console; one that stores a member's page
 * URLs with query strings; a body with no violation counted as one. */
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadWorker, makeEnv, freshDb, identity, call, resetCaches } from '../_support/worker.mjs';
import { readOps } from '../../comments-worker/src/ops.ts';

let worker, adm;
before(async () => { ({ worker } = await loadWorker()); adm = await identity('the-admin'); });
beforeEach(resetCaches);
const tally = (db) => { const r = db.prepare("SELECT v FROM app_settings WHERE k = 'csp_report_tally'").get(); return r ? JSON.parse(r.v) : null; };

test('the legacy report-uri shape and the Reporting API shape both tally by directive, blocked origin and document path', async () => {
  const db = freshDb();
  const env = makeEnv({ db });
  const legacy = { 'csp-report': { 'document-uri': 'https://merecatholicity.com/messages.html?t=7&secret=1', 'effective-directive': 'img-src', 'blocked-uri': 'blob:https://merecatholicity.com/abc-123', 'violated-directive': 'img-src' } };
  let r = await call(worker, env, 'POST', '/api/comments/csp-report', legacy, { headers: { 'Content-Type': 'application/csp-report' }, origin: null });
  assert.equal(r.status, 204);
  const modern = [
    { type: 'csp-violation', url: 'https://merecatholicity.com/community.html', body: { documentURL: 'https://merecatholicity.com/community.html', effectiveDirective: 'script-src', blockedURL: 'https://evil.example/x.js', disposition: 'report' } },
    { type: 'csp-violation', url: 'https://merecatholicity.com/messages.html', body: { documentURL: 'https://merecatholicity.com/messages.html', effectiveDirective: 'img-src', blockedURL: 'blob:https://merecatholicity.com/def-456' } },
    { type: 'deprecation', url: 'https://merecatholicity.com/', body: {} },
  ];
  r = await call(worker, env, 'POST', '/api/comments/csp-report', modern, { headers: { 'Content-Type': 'application/reports+json' }, origin: null });
  assert.equal(r.status, 204);
  const t = tally(db);
  assert.equal(t.total, 3);
  assert.deepEqual(t.rows.map((x) => [x.directive, x.blocked, x.document, x.n]).sort(), [
    ['img-src', 'blob', '/messages.html', 2],
    ['script-src', 'https://evil.example', '/community.html', 1],
  ].sort(), 'the blob: image on the messages page twice (the query string never kept), the foreign script once');
  const h = await readOps(env);
  assert.equal(h.csp.total, 3, 'the Health card reads the tally');
  db.close();
});

test('a collector never argues: garbage, an empty report, an oversize body are a quiet 204 and tally nothing; the limiter still stands', async () => {
  const db = freshDb();
  const env = makeEnv({ db });
  for (const body of ['not json', {}, { 'csp-report': {} }, [{ type: 'other' }]]) {
    const r = await call(worker, env, 'POST', '/api/comments/csp-report', body, { headers: { 'Content-Type': 'application/csp-report' }, origin: null });
    assert.equal(r.status, 204, JSON.stringify(body));
  }
  const big = { 'csp-report': { 'effective-directive': 'img-src', 'blocked-uri': 'x'.repeat(20000) } };
  const r = await call(worker, env, 'POST', '/api/comments/csp-report', big, { headers: { 'Content-Type': 'application/csp-report' }, origin: null });
  assert.equal(r.status, 204);
  assert.equal(tally(db), null, 'nothing tallied');
  const slow = { ...env, READ_LIMIT: { limit: async () => ({ success: false }) } };
  const lim = await call(worker, slow, 'POST', '/api/comments/csp-report', { 'csp-report': { 'effective-directive': 'img-src', 'blocked-uri': 'inline' } }, { origin: null });
  assert.equal(lim.status, 429);
  db.close();
});

test('extensions fold into one origin, and the top hundred is kept', async () => {
  const db = freshDb();
  const env = makeEnv({ db });
  const ext = (i) => ({ 'csp-report': { 'document-uri': 'https://merecatholicity.com/p' + i + '.html', 'effective-directive': 'script-src', 'blocked-uri': 'chrome-extension://abc' + i + '/inject.js' } });
  for (let i = 0; i < 105; i++) await call(worker, env, 'POST', '/api/comments/csp-report', ext(i), { origin: null });
  const t = tally(db);
  assert.equal(t.rows.length, 100, 'the top hundred');
  assert.ok(t.rows.every((x) => x.blocked === 'extension'), 'an extension is noise, named as such');
  assert.equal(t.total, 105);
  db.close();
});
